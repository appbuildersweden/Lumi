//! Beständig inloggning – "Håll mig inloggad".
//!
//! Sessionen ligger normalt bara i minnet och försvinner när Lumi stängs. Med
//! "Håll mig inloggad" sparas en liten fil i appens datamapp i stället, så att
//! nästa start kan återställa samma konto utan att lösenordet skrivs igen.
//!
//! Filen skyddas med Windows DPAPI (`CryptProtectData`). Den kan därför bara
//! läsas av samma Windows-konto som sparade den, och innehållet ligger inte i
//! klartext på disken. Det som sparas är kontots id, ett avtryck av kontots
//! lösenordshash och tidpunkten – aldrig lösenordet, aldrig hashen i klartext
//! och ingen token som går att använda mot något annat.
//!
//! Vid återställningen läses kontot om från databasen och kontrolleras: finns
//! det, är det aktivt, och har lösenordet inte ändrats sedan sessionen
//! sparades. Ändras lösenordet, inaktiveras kontot eller tas det bort, slutar
//! den sparade sessionen alltså att gälla av sig själv.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::auth::PublicUser;
use crate::error::AppError;
use crate::storage::{now_ms, Storage};

/// Filen med den sparade sessionen, i appens datamapp.
pub const SESSION_FILE: &str = "session.skyddad";

/// Det som sparas mellan appstarter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSession {
    pub user_id: String,
    /// Kontots lösenordshash när sessionen sparades. Den används bara som
    /// jämförelsevärde: är hashen en annan har lösenordet ändrats och
    /// sessionen gäller inte längre.
    pub revision: String,
    pub saved_at_ms: u64,
}

/// Var den sparade sessionen ligger.
pub fn session_path(dir: &Path) -> PathBuf {
    dir.join(SESSION_FILE)
}

/// Sparar sessionen för ett konto.
pub fn remember(storage: &Storage, dir: &Path, user_id: &str) -> Result<(), AppError> {
    let Some(user) = storage.user_by_id(user_id)? else {
        return clear(dir);
    };

    save(
        dir,
        &SavedSession {
            user_id: user.id,
            revision: user.password_hash,
            saved_at_ms: now_ms(),
        },
    )
}

/// Sparar en session, krypterad med DPAPI innan den når disken.
pub fn save(dir: &Path, session: &SavedSession) -> Result<(), AppError> {
    let json = serde_json::to_vec(session)?;
    let protected = protect(&json)?;

    let path = session_path(dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, protected)?;
    Ok(())
}

/// Läser den sparade sessionen. Saknas filen är svaret `None`, inte ett fel:
/// det betyder bara att ingen har bett att få vara inloggad.
pub fn load(dir: &Path) -> Result<Option<SavedSession>, AppError> {
    let Ok(bytes) = std::fs::read(session_path(dir)) else {
        return Ok(None);
    };

    // Går filen inte att låsa upp – den är skadad, eller kopierad från ett
    // annat Windows-konto – är svaret att ingen session finns. Filen tas bort
    // i stället för att ligga kvar och störa vid varje start, och appen visar
    // inloggningen som vanligt.
    let Ok(plain) = unprotect(&bytes) else {
        clear(dir).ok();
        return Ok(None);
    };

    match serde_json::from_slice(&plain) {
        Ok(session) => Ok(Some(session)),
        Err(_) => {
            clear(dir).ok();
            Ok(None)
        }
    }
}

/// Tar bort den sparade sessionen. Saknas filen är det redan klart.
pub fn clear(dir: &Path) -> Result<(), AppError> {
    match std::fs::remove_file(session_path(dir)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AppError::Storage(error.to_string())),
    }
}

/// Läser den sparade sessionen och kontrollerar den mot databasen.
///
/// Returnerar kontot om sessionen fortfarande gäller, annars `None`. En
/// session som inte längre är giltig tas bort, så att nästa start visar
/// inloggningen direkt.
pub fn restore(storage: &Storage, dir: &Path) -> Result<Option<PublicUser>, AppError> {
    let Some(saved) = load(dir)? else {
        return Ok(None);
    };

    let Some(user) = storage.user_by_id(&saved.user_id)? else {
        clear(dir)?;
        return Ok(None);
    };

    // Rollen läses från databasen varje gång – den här kontrollen avgör bara
    // om kontot fortfarande får vara inloggat utan lösenord.
    if !user.active || user.password_hash != saved.revision {
        clear(dir)?;
        return Ok(None);
    }

    Ok(Some(user.public()))
}

// ── Skydd med Windows DPAPI ───────────────────────────────────────────────
//
// Krypteringen görs av Windows självt, knuten till den inloggade
// Windows-användaren. Nyckeln lämnar aldrig systemet och behöver inte hanteras
// av Lumi. På andra plattformar än Windows finns ingen sparad session alls.

#[cfg(windows)]
fn protect(plain: &[u8]) -> Result<Vec<u8>, AppError> {
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};

    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: plain.len() as u32,
            pbData: plain.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();

        let ok = CryptProtectData(
            &input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            &mut output,
        );

        if ok == 0 {
            let error = std::io::Error::last_os_error();
            return Err(AppError::Storage(format!(
                "kunde inte skydda sessionen ({error})"
            )));
        }

        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        free_local(output.pbData);
        Ok(bytes)
    }
}

#[cfg(windows)]
fn unprotect(data: &[u8]) -> Result<Vec<u8>, AppError> {
    use windows_sys::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();

        let ok = CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            &mut output,
        );

        if ok == 0 {
            let error = std::io::Error::last_os_error();
            return Err(AppError::Storage(format!(
                "kunde inte läsa den sparade sessionen ({error})"
            )));
        }

        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        free_local(output.pbData);
        Ok(bytes)
    }
}

/// Windows äger den krypterade bufferten, så den lämnas tillbaka.
#[cfg(windows)]
fn free_local(buffer: *mut u8) {
    unsafe {
        windows_sys::Win32::Foundation::LocalFree(buffer as *mut core::ffi::c_void);
    }
}

#[cfg(not(windows))]
fn protect(_plain: &[u8]) -> Result<Vec<u8>, AppError> {
    Err(AppError::Storage(
        "sparad inloggning används bara på Windows".to_string(),
    ))
}

#[cfg(not(windows))]
fn unprotect(_data: &[u8]) -> Result<Vec<u8>, AppError> {
    Err(AppError::Storage(
        "sparad inloggning används bara på Windows".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::{clear, load, remember, restore, save, session_path, SavedSession};
    use crate::auth::{create_user, reset_password, set_active};
    use crate::storage::{Role, Storage};

    /// Egen mapp per test, så att testerna kan köras var för sig.
    fn dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("lumi-session-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("kunde inte skapa testmappen");
        dir
    }

    #[test]
    fn a_saved_session_survives_a_restart() {
        let dir = dir();
        let storage = Storage::new(&dir).unwrap();
        let user = create_user(
            &storage,
            "elev@edu.ronneby.se",
            "Hemligt12345",
            "Elev",
            Role::Student,
        )
        .unwrap();

        remember(&storage, &dir, &user.id).unwrap();

        // Ny Storage-instans: samma sak som att appen startas om.
        let after_restart = Storage::new(&dir).unwrap();
        let restored = restore(&after_restart, &dir).unwrap().expect("sessionen borde gälla");
        assert_eq!(restored.id, user.id);
        assert_eq!(restored.email, "elev@edu.ronneby.se");
        assert_eq!(restored.role, Role::Student);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_saved_file_is_not_readable_text() {
        let dir = dir();
        let storage = Storage::new(&dir).unwrap();
        let user = create_user(
            &storage,
            "elev@edu.ronneby.se",
            "Hemligt12345",
            "Elev",
            Role::Student,
        )
        .unwrap();

        remember(&storage, &dir, &user.id).unwrap();

        let raw = std::fs::read(session_path(&dir)).expect("filen borde finnas");
        // DPAPI-krypterat: varken kontots id eller något annat går att läsa ut.
        let as_text = String::from_utf8_lossy(&raw);
        assert!(!as_text.contains(&user.id), "kontots id låg i klartext");
        assert!(!as_text.contains("elev@edu.ronneby.se"));
        assert!(!as_text.contains("$argon2"), "hashen låg i klartext");
        assert!(raw.len() > 0);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn logging_out_removes_the_saved_session() {
        let dir = dir();
        let storage = Storage::new(&dir).unwrap();
        let user = create_user(
            &storage,
            "elev@edu.ronneby.se",
            "Hemligt12345",
            "Elev",
            Role::Student,
        )
        .unwrap();

        remember(&storage, &dir, &user.id).unwrap();
        assert!(session_path(&dir).exists());

        clear(&dir).unwrap();
        assert!(!session_path(&dir).exists());
        assert!(restore(&storage, &dir).unwrap().is_none());

        // Att ta bort något som redan är borta är inte ett fel.
        clear(&dir).unwrap();

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn without_a_saved_session_nothing_is_restored() {
        let dir = dir();
        let storage = Storage::new(&dir).unwrap();

        assert!(load(&dir).unwrap().is_none());
        assert!(restore(&storage, &dir).unwrap().is_none());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_changed_password_invalidates_the_saved_session() {
        let dir = dir();
        let storage = Storage::new(&dir).unwrap();
        let user = create_user(
            &storage,
            "elev@edu.ronneby.se",
            "Hemligt12345",
            "Elev",
            Role::Student,
        )
        .unwrap();

        remember(&storage, &dir, &user.id).unwrap();
        assert!(restore(&storage, &dir).unwrap().is_some());

        // Ett återställt lösenord ska inte lämna en öppen dörr efter sig.
        reset_password(&storage, &user.id, "Annat123456").unwrap();
        assert!(restore(&storage, &dir).unwrap().is_none());
        assert!(!session_path(&dir).exists(), "ogiltig session borde tas bort");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_inactive_account_cannot_be_restored() {
        let dir = dir();
        let storage = Storage::new(&dir).unwrap();
        let user = create_user(
            &storage,
            "elev@edu.ronneby.se",
            "Hemligt12345",
            "Elev",
            Role::Student,
        )
        .unwrap();

        remember(&storage, &dir, &user.id).unwrap();
        set_active(&storage, &user.id, false).unwrap();

        assert!(restore(&storage, &dir).unwrap().is_none());
        assert!(!session_path(&dir).exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_session_for_a_deleted_account_is_removed() {
        let dir = dir();
        let storage = Storage::new(&dir).unwrap();

        save(
            &dir,
            &SavedSession {
                user_id: "finns-inte".to_string(),
                revision: "vad-som-helst".to_string(),
                saved_at_ms: 1,
            },
        )
        .unwrap();

        assert!(restore(&storage, &dir).unwrap().is_none());
        assert!(!session_path(&dir).exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_corrupt_file_is_ignored_and_removed() {
        let dir = dir();
        let storage = Storage::new(&dir).unwrap();

        std::fs::write(session_path(&dir), b"inte en riktig session").unwrap();
        assert!(load(&dir).unwrap().is_none());

        // Går filen inte att läsa ska appen visa inloggningen, inte krascha.
        assert!(restore(&storage, &dir).unwrap().is_none());

        std::fs::remove_dir_all(&dir).ok();
    }
}
