//! Lumis eget konto- och inloggningssystem.
//!
//! Inloggningen sker helt i Rust-backenden. Lösenordet sparas som en
//! Argon2id-hash med eget salt, och jämförelsen görs här. Gränssnittet får
//! bara ett litet objekt med id, e-post, namn och roll – aldrig hashen och
//! aldrig lösenordet.
//!
//! Ingen e-postverifiering behövs: ett konto skapas av administratören och
//! kan användas direkt.

use std::sync::OnceLock;

use argon2::password_hash::{
    rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
};
use argon2::Argon2;
use serde::Serialize;
use uuid::Uuid;

use crate::error::AppError;
use crate::storage::{now_ms, Role, Storage, User};

/// Miljövariablerna som skapar det första administratörskontot.
pub const ADMIN_EMAIL_ENV: &str = "LUMI_ADMIN_EMAIL";
pub const ADMIN_PASSWORD_ENV: &str = "LUMI_ADMIN_PASSWORD";

/// Kortaste tillåtna lösenord när ett konto skapas.
pub const MIN_PASSWORD_LEN: usize = 8;

/// Den del av ett konto som gränssnittet får se. Hashen är inte med.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicUser {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub role: Role,
    /// Rollens namn i gränssnittet.
    pub role_label: String,
    pub active: bool,
    /// Personen kontot hör till, om det är kopplat.
    pub person_id: Option<String>,
    /// Vad rollen får göra, enligt backend. Gränssnittet visar bara det som
    /// står här i stället för att gissa utifrån rollnamnet.
    pub permissions: Vec<String>,
}

impl User {
    /// Plockar ut det gränssnittet behöver. Lösenordshashen stannar i backend.
    pub fn public(&self) -> PublicUser {
        PublicUser {
            id: self.id.clone(),
            email: self.email.clone(),
            display_name: self.display_name.clone(),
            role: self.role,
            role_label: self.role.label().to_string(),
            active: self.active,
            person_id: self.person_id.clone(),
            permissions: self
                .role
                .permissions()
                .iter()
                .map(|name| name.to_string())
                .collect(),
        }
    }
}

// ── Skydd mot upprepade försök ────────────────────────────────────────────

/// Antal felaktiga försök för samma adress innan den spärras.
pub const MAX_ATTEMPTS: u32 = 5;

/// Hur länge en spärr gäller.
pub const LOCK_SECS: u64 = 60;

#[derive(Debug, Clone, Copy)]
struct Attempts {
    count: u32,
    locked_until_ms: u64,
}

/// Räknar felaktiga inloggningsförsök per e-postadress.
///
/// Räknaren ligger i minnet och försvinner när appen stängs. Det räcker för att
/// stoppa någon som sitter och gissar lösenord, utan att låsa ute en elev som
/// skrev fel en gång.
#[derive(Default)]
pub struct LoginGuard {
    attempts: std::sync::Mutex<std::collections::HashMap<String, Attempts>>,
}

impl LoginGuard {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, std::collections::HashMap<String, Attempts>> {
        self.attempts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Antal sekunder adressen är spärrad. 0 betyder att inloggning är tillåten.
    pub fn locked_for(&self, email: &str) -> u64 {
        let key = normalize_email(email);
        let mut attempts = self.lock();

        let Some(entry) = attempts.get(&key) else {
            return 0;
        };
        if entry.locked_until_ms == 0 {
            return 0;
        }

        let now = crate::storage::now_ms();
        if entry.locked_until_ms <= now {
            attempts.remove(&key);
            return 0;
        }

        (entry.locked_until_ms - now).div_ceil(1000)
    }

    /// Noterar ett felaktigt försök. Returnerar antalet sekunder adressen
    /// spärras, eller 0 om fler försök fortfarande är tillåtna.
    pub fn record_failure(&self, email: &str) -> u64 {
        let key = normalize_email(email);
        let mut attempts = self.lock();

        let entry = attempts.entry(key).or_insert(Attempts {
            count: 0,
            locked_until_ms: 0,
        });
        entry.count += 1;

        if entry.count < MAX_ATTEMPTS {
            return 0;
        }

        entry.count = 0;
        entry.locked_until_ms = crate::storage::now_ms() + LOCK_SECS * 1_000;
        LOCK_SECS
    }

    /// Rensar räknaren vid lyckad inloggning.
    pub fn record_success(&self, email: &str) {
        self.lock().remove(&normalize_email(email));
    }
}

// ── E-post och lösenord ───────────────────────────────────────────────────

/// E-postadresser lagras och jämförs alltid i små bokstäver.
pub fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

fn validate_email(email: &str) -> Result<(), AppError> {
    let looks_right = email.contains('@')
        && !email.starts_with('@')
        && !email.ends_with('@')
        && !email.contains(' ')
        && email.split('@').nth(1).is_some_and(|part| part.contains('.'));

    if looks_right {
        Ok(())
    } else {
        Err(AppError::Validation(
            "E-postadressen ser inte giltig ut.".to_string(),
        ))
    }
}

fn validate_password(password: &str) -> Result<(), AppError> {
    if password.chars().count() < MIN_PASSWORD_LEN {
        return Err(AppError::Validation(format!(
            "Lösenordet måste vara minst {MIN_PASSWORD_LEN} tecken."
        )));
    }
    Ok(())
}

/// Tolkar rollen som gränssnittet skickar. En okänd roll avvisas i stället för
/// att tyst bli en elev.
pub fn parse_role(value: &str) -> Result<Role, AppError> {
    match value.trim().to_lowercase().as_str() {
        "admin" => Ok(Role::Admin),
        "lärare" | "larare" | "teacher" => Ok(Role::Teacher),
        "elev" | "user" | "student" | "" => Ok(Role::Student),
        other => Err(AppError::Validation(format!(
            "Rollen \"{other}\" finns inte i Lumi."
        ))),
    }
}

// ── Hashning ──────────────────────────────────────────────────────────────

/// Skapar en Argon2id-hash med ett nytt slumpat salt.
pub fn hash_password(password: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|err| AppError::Storage(format!("kunde inte skydda lösenordet ({err})")))
}

/// Jämför ett lösenord mot en sparad hash. Fel format betyder nej, inte fel.
pub fn verify_password(password: &str, hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

/// En hash att jämföra mot när e-postadressen inte finns, så att svarstiden
/// inte avslöjar om ett konto finns. Skapas en gång och är ingen hemlighet.
fn dummy_hash() -> &'static str {
    static DUMMY: OnceLock<String> = OnceLock::new();
    DUMMY.get_or_init(|| hash_password("lumi-ingen-riktig-anvandare").unwrap_or_default())
}

// ── Inloggning ────────────────────────────────────────────────────────────

/// Kontrollerar uppgifterna mot databasen och returnerar kontot.
///
/// Samma fel används för okänd e-postadress och fel lösenord, så att svaret
/// inte berättar vilka konton som finns.
pub fn login(storage: &Storage, email: &str, password: &str) -> Result<PublicUser, AppError> {
    let email = normalize_email(email);
    if email.is_empty() || password.is_empty() {
        return Err(AppError::InvalidCredentials);
    }

    let Some(user) = storage.user_by_email(&email)? else {
        // Samma arbete som vid en riktig kontroll, för samma svarstid.
        let _ = verify_password(password, dummy_hash());
        return Err(AppError::InvalidCredentials);
    };

    if !verify_password(password, &user.password_hash) {
        return Err(AppError::InvalidCredentials);
    }

    // Kontot kontrolleras efter lösenordet, så att svaret inte avslöjar vilka
    // konton som är inaktiverade.
    if !user.active {
        return Err(AppError::AccountInactive);
    }

    Ok(user.public())
}

// ── Skapa konton ──────────────────────────────────────────────────────────

/// Uppgifterna för ett nytt konto.
pub struct NewAccount {
    pub email: String,
    pub password: String,
    pub display_name: String,
    pub role: Role,
    /// Personen kontot ska kopplas till, om personen redan finns.
    pub person_id: Option<String>,
}

/// Skapar ett konto med hashat lösenord. Rollen bestäms av anroparen, och
/// anroparen är alltid ett inloggat administratörskonto.
pub fn create_user(
    storage: &Storage,
    email: &str,
    password: &str,
    display_name: &str,
    role: Role,
) -> Result<PublicUser, AppError> {
    create_account(
        storage,
        NewAccount {
            email: email.to_string(),
            password: password.to_string(),
            display_name: display_name.to_string(),
            role,
            person_id: None,
        },
    )
}

/// Skapar ett konto, eventuellt kopplat till en person.
pub fn create_account(storage: &Storage, account: NewAccount) -> Result<PublicUser, AppError> {
    let email = normalize_email(&account.email);
    validate_email(&email)?;
    validate_password(&account.password)?;

    if storage.user_by_email(&email)?.is_some() {
        return Err(AppError::EmailTaken);
    }

    if let Some(person_id) = account.person_id.as_deref() {
        let person = storage
            .person(person_id)?
            .ok_or_else(|| AppError::Validation("Personen hittades inte.".to_string()))?;

        // Ett konto per person: annars blir kopplingen tvetydig.
        if storage
            .users()?
            .iter()
            .any(|user| user.person_id.as_deref() == Some(person.id.as_str()))
        {
            return Err(AppError::Validation(
                "Personen har redan ett konto.".to_string(),
            ));
        }
    }

    let display_name = match account.display_name.trim() {
        "" => email.split('@').next().unwrap_or(&email).to_string(),
        name => name.to_string(),
    };

    let user = User {
        id: Uuid::new_v4().to_string(),
        email,
        display_name,
        role: account.role,
        password_hash: hash_password(&account.password)?,
        created_at_ms: now_ms(),
        active: true,
        person_id: account.person_id,
    };

    storage.add_user(&user)?;
    Ok(user.public())
}

/// Läser in ett konto, eller beskriver att det inte finns.
fn require_user(storage: &Storage, user_id: &str) -> Result<User, AppError> {
    storage
        .user_by_id(user_id)?
        .ok_or_else(|| AppError::Validation("Kontot hittades inte.".to_string()))
}

/// Sätter ett nytt lösenord. Används av administratören för att återställa
/// inloggningsuppgifter – aldrig för att visa dem.
pub fn reset_password(
    storage: &Storage,
    user_id: &str,
    new_password: &str,
) -> Result<PublicUser, AppError> {
    validate_password(new_password)?;

    let mut user = require_user(storage, user_id)?;
    user.password_hash = hash_password(new_password)?;
    storage.add_user(&user)?;
    Ok(user.public())
}

/// Uppdaterar namn och e-postadress på sitt eget konto.
///
/// Adressen kontrolleras på samma sätt som när ett konto skapas, och en adress
/// som redan tillhör någon annan avvisas. Rollen rörs inte här – den ändras
/// bara av en administratör under Konton och Roller.
pub fn update_profile(
    storage: &Storage,
    user_id: &str,
    display_name: &str,
    email: &str,
) -> Result<PublicUser, AppError> {
    let email = normalize_email(email);
    validate_email(&email)?;

    let display_name = display_name.trim();
    if display_name.is_empty() {
        return Err(AppError::Validation("Namnet måste fyllas i.".to_string()));
    }

    let mut user = require_user(storage, user_id)?;

    if let Some(existing) = storage.user_by_email(&email)? {
        if existing.id != user.id {
            return Err(AppError::EmailTaken);
        }
    }

    user.email = email;
    user.display_name = display_name.to_string();
    storage.add_user(&user)?;
    Ok(user.public())
}

/// Byter lösenord på sitt eget konto.
///
/// Det nuvarande lösenordet måste stämma, så att en kvarglömd session inte
/// räcker för att byta ut lösenordet. Varken det gamla eller det nya
/// lösenordet skrivs ut någonstans.
pub fn change_password(
    storage: &Storage,
    user_id: &str,
    current_password: &str,
    new_password: &str,
) -> Result<PublicUser, AppError> {
    let mut user = require_user(storage, user_id)?;

    if !verify_password(current_password, &user.password_hash) {
        return Err(AppError::InvalidCredentials);
    }

    validate_password(new_password)?;
    user.password_hash = hash_password(new_password)?;
    storage.add_user(&user)?;
    Ok(user.public())
}

/// Byter roll på ett konto.
pub fn set_role(storage: &Storage, user_id: &str, role: Role) -> Result<PublicUser, AppError> {
    let mut user = require_user(storage, user_id)?;
    user.role = role;
    storage.add_user(&user)?;
    Ok(user.public())
}

/// Aktiverar eller inaktiverar ett konto.
pub fn set_active(storage: &Storage, user_id: &str, active: bool) -> Result<PublicUser, AppError> {
    let mut user = require_user(storage, user_id)?;
    user.active = active;
    storage.add_user(&user)?;
    Ok(user.public())
}

/// Kopplar ett konto till en person.
///
/// En person har högst ett konto. Samma kontroll görs när ett konto skapas, så
/// att en person inte kan få två konton och kopplingen förbli tvetydig.
pub fn set_person(
    storage: &Storage,
    user_id: &str,
    person_id: Option<String>,
) -> Result<PublicUser, AppError> {
    if let Some(person_id) = person_id.as_deref() {
        storage
            .person(person_id)?
            .ok_or_else(|| AppError::Validation("Personen hittades inte.".to_string()))?;

        if storage
            .users()?
            .iter()
            .any(|user| user.id != user_id && user.person_id.as_deref() == Some(person_id))
        {
            return Err(AppError::Validation(
                "Personen har redan ett konto.".to_string(),
            ));
        }
    }

    let mut user = require_user(storage, user_id)?;
    user.person_id = person_id;
    storage.add_user(&user)?;
    Ok(user.public())
}

/// Antal aktiva administratörskonton. Används för att inte låsa ute sig själv.
pub fn active_admins(storage: &Storage) -> Result<usize, AppError> {
    Ok(storage
        .users()?
        .iter()
        .filter(|user| user.active && user.role.is_admin())
        .count())
}

/// Skapar administratörskontot från miljövariablerna om det inte redan finns.
///
/// Lösenordet läses ur `LUMI_ADMIN_PASSWORD` och lämnar aldrig den här
/// funktionen – det blir en hash innan det når databasen. Finns kontot redan
/// rörs det inte, så lösenordet byts medvetet och inte av misstag vid varje
/// start. Adressen returneras (aldrig lösenordet) så att anroparen kan skriva
/// en rad om vad som hände.
pub fn seed_admin(storage: &Storage) -> Result<Option<String>, AppError> {
    let email = std::env::var(ADMIN_EMAIL_ENV).unwrap_or_default();
    let password = std::env::var(ADMIN_PASSWORD_ENV).unwrap_or_default();
    seed_admin_with(storage, &email, &password)
}

/// Samma som [`seed_admin`], men med värdena som argument så att den går att
/// testa utan miljövariabler.
pub fn seed_admin_with(
    storage: &Storage,
    email: &str,
    password: &str,
) -> Result<Option<String>, AppError> {
    if email.trim().is_empty() || password.is_empty() {
        return Ok(None);
    }

    let email = normalize_email(email);
    if storage.user_by_email(&email)?.is_some() {
        return Ok(None);
    }

    create_user(storage, &email, password, "Administratör", Role::Admin)?;
    Ok(Some(email))
}

#[cfg(test)]
mod tests {
    use super::{
        active_admins, change_password, create_account, create_user, hash_password, login,
        normalize_email, parse_role, reset_password, seed_admin_with, set_active, set_person,
        update_profile, verify_password, LoginGuard, NewAccount, PublicUser, MAX_ATTEMPTS,
    };
    use crate::storage::{Person, Role, Storage, USERS_FILE};
    use std::fs;

    /// Egen mapp per test, så att testerna kan köras var för sig.
    fn storage() -> (Storage, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("lumi-auth-{}", uuid::Uuid::new_v4()));
        let storage = Storage::new(&dir).expect("kunde inte skapa testmappen");
        (storage, dir)
    }

    #[test]
    fn the_same_password_gives_different_hashes() {
        let first = hash_password(TEST_ADMIN_PASSWORD).unwrap();
        let second = hash_password(TEST_ADMIN_PASSWORD).unwrap();

        // Eget salt per hash: två identiska lösenord ska inte ge samma rad.
        assert_ne!(first, second);
        assert!(!first.contains(TEST_ADMIN_PASSWORD));
        assert!(first.starts_with("$argon2"));
    }

    #[test]
    fn a_stored_password_is_never_plain_text() {
        let (storage, dir) = storage();
        create_user(&storage, "elev@edu.ronneby.se", "Hemligt12345", "Elev", Role::Student)
            .unwrap();

        // Hela databasfilen läses som text: lösenordet får inte gå att hitta.
        let raw = fs::read_to_string(dir.join(USERS_FILE)).unwrap();
        assert!(!raw.contains("Hemligt12345"), "lösenordet låg i klartext");
        assert!(raw.contains("$argon2"), "hashen saknades");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_correct_password_verifies_and_a_wrong_one_does_not() {
        let hash = hash_password(TEST_ADMIN_PASSWORD).unwrap();

        assert!(verify_password(TEST_ADMIN_PASSWORD, &hash));
        assert!(!verify_password(&TEST_ADMIN_PASSWORD.to_lowercase(), &hash));
        assert!(!verify_password(&format!("{TEST_ADMIN_PASSWORD} "), &hash));
        assert!(!verify_password("", &hash));
    }

    #[test]
    fn a_broken_hash_is_rejected_instead_of_accepted() {
        assert!(!verify_password("vad som helst", "inte-en-hash"));
        assert!(!verify_password("vad som helst", ""));
    }

    #[test]
    fn the_right_credentials_log_in() {
        let (storage, dir) = storage();
        create_user(
            &storage,
            "elev@edu.ronneby.se",
            "Hemligt12345",
            "Linnéa",
            Role::Student,
        )
        .unwrap();

        let user = login(&storage, "elev@edu.ronneby.se", "Hemligt12345").unwrap();
        assert_eq!(user.email, "elev@edu.ronneby.se");
        assert_eq!(user.display_name, "Linnéa");
        assert_eq!(user.role, Role::Student);

        // Skiftläge och mellanslag runt adressen ska inte spela roll.
        let again = login(&storage, "  ELEV@Edu.Ronneby.SE ", "Hemligt12345").unwrap();
        assert_eq!(again.id, user.id);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn wrong_credentials_are_rejected_and_never_reveal_whether_an_account_exists() {
        let (storage, dir) = storage();
        create_user(&storage, "elev@edu.ronneby.se", "Hemligt12345", "Elev", Role::Student)
            .unwrap();

        let wrong_password = login(&storage, "elev@edu.ronneby.se", "fel-lösenord").unwrap_err();
        let unknown_account = login(&storage, "finns-inte@edu.ronneby.se", "Hemligt12345")
            .unwrap_err();

        assert_eq!(wrong_password.kind(), "invalid-credentials");
        assert_eq!(unknown_account.kind(), "invalid-credentials");
        assert_eq!(wrong_password.to_string(), unknown_account.to_string());

        // Tomma värden kommer inte förbi heller.
        assert!(login(&storage, "", "").is_err());
        assert!(login(&storage, "elev@edu.ronneby.se", "").is_err());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_profile_can_be_updated_but_not_onto_another_account() {
        let (storage, dir) = storage();
        let admin = create_user(
            &storage,
            "admin@edu.ronneby.se",
            "Hemligt12345",
            "Administratör",
            Role::Admin,
        )
        .unwrap();
        create_user(
            &storage,
            "elev@edu.ronneby.se",
            "Hemligt12345",
            "Elev",
            Role::Student,
        )
        .unwrap();

        // Namn och adress går att ändra, och rollen rörs inte.
        let updated = update_profile(&storage, &admin.id, "  Jenny Lind  ", "Jenny.Lind@EDU.ronneby.se")
            .unwrap();
        assert_eq!(updated.display_name, "Jenny Lind");
        assert_eq!(updated.email, "jenny.lind@edu.ronneby.se");
        assert!(updated.role.is_admin());

        // En adress som tillhör någon annan avvisas.
        let taken = update_profile(&storage, &admin.id, "Jenny Lind", "elev@edu.ronneby.se");
        assert_eq!(taken.unwrap_err().kind(), "email-taken");

        // Tomt namn och ogiltig adress avvisas också.
        assert!(update_profile(&storage, &admin.id, "   ", "jenny@edu.ronneby.se").is_err());
        assert!(update_profile(&storage, &admin.id, "Jenny", "utan-snabel").is_err());

        // Det egna kontot kan fortfarande logga in med den nya adressen.
        let logged_in = login(&storage, "jenny.lind@edu.ronneby.se", "Hemligt12345").unwrap();
        assert_eq!(logged_in.display_name, "Jenny Lind");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_person_can_only_be_linked_to_one_account() {
        let (storage, dir) = storage();

        let person = Person {
            id: "person-1".to_string(),
            kind: "elever".to_string(),
            first_name: "Elsa".to_string(),
            last_name: "Testsson".to_string(),
            class_name: "9A".to_string(),
            email: "elsa@edu.ronneby.se".to_string(),
            subjects: Vec::new(),
            active: true,
            created_at_ms: 1,
        };
        storage.save_person(&person).unwrap();

        let first = create_user(
            &storage,
            "elsa@edu.ronneby.se",
            "Hemligt12345",
            "Elsa",
            Role::Student,
        )
        .unwrap();
        let linked = set_person(&storage, &first.id, Some(person.id.clone())).unwrap();
        assert_eq!(linked.person_id.as_deref(), Some("person-1"));

        // Ett andra konto kan inte kopplas till samma person: kopplingen skulle
        // bli tvetydig i panelen.
        let second = create_user(
            &storage,
            "elsa.tva@edu.ronneby.se",
            "Hemligt12345",
            "Elsa Två",
            Role::Student,
        )
        .unwrap();
        let refused = set_person(&storage, &second.id, Some(person.id.clone()));
        assert_eq!(refused.unwrap_err().kind(), "validation");

        // Samma konto får kopplas om, och en person som inte finns avvisas.
        assert!(set_person(&storage, &first.id, Some(person.id.clone())).is_ok());
        assert!(set_person(&storage, &second.id, Some("finns-inte".to_string())).is_err());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_password_can_be_changed_only_with_the_current_one() {
        let (storage, dir) = storage();
        let user = create_user(
            &storage,
            "elev@edu.ronneby.se",
            "Hemligt12345",
            "Elev",
            Role::Student,
        )
        .unwrap();

        // Fel nuvarande lösenord nekar bytet.
        let wrong = change_password(&storage, &user.id, "fel-losenord", "NyttLosenord1");
        assert_eq!(wrong.unwrap_err().kind(), "invalid-credentials");

        // För kort nytt lösenord avvisas.
        assert!(change_password(&storage, &user.id, "Hemligt12345", "kort").is_err());

        // Rätt nuvarande lösenord byter, och det nya fungerar.
        change_password(&storage, &user.id, "Hemligt12345", "NyttLosenord1").unwrap();
        assert!(login(&storage, "elev@edu.ronneby.se", "Hemligt12345").is_err());
        assert!(login(&storage, "elev@edu.ronneby.se", "NyttLosenord1").is_ok());

        // Lösenordet ligger inte i klartext i databasen.
        let raw = std::fs::read_to_string(dir.join(USERS_FILE)).expect("kunde inte läsa databasen");
        assert!(!raw.contains("NyttLosenord1"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_public_user_never_carries_the_hash() {
        let (storage, dir) = storage();
        let user = create_user(
            &storage,
            "elev@edu.ronneby.se",
            "Hemligt12345",
            "Elev",
            Role::Student,
        )
        .unwrap();

        let json = serde_json::to_value(&user).unwrap();
        // Rollen skickas som texten "elev" till gränssnittet.
        assert_eq!(json["role"], "elev");
        assert_eq!(json["roleLabel"], "Elev");
        assert_eq!(json["email"], "elev@edu.ronneby.se");
        assert!(json.get("passwordHash").is_none());
        assert!(!json.to_string().contains("$argon2"));
        assert!(!json.to_string().contains("Hemligt12345"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_new_account_needs_a_real_address_and_a_long_enough_password() {
        let (storage, dir) = storage();

        for bad_email in ["", "utan-snabel", "@utan.namn", "namn@utan-punkt"] {
            let result = create_user(&storage, bad_email, "Hemligt12345", "Elev", Role::Student);
            assert!(result.is_err(), "{bad_email} borde avvisas");
        }

        let short = create_user(&storage, "elev@edu.ronneby.se", "kort", "Elev", Role::Student);
        assert_eq!(short.unwrap_err().kind(), "validation");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn two_accounts_cannot_share_an_email_address() {
        let (storage, dir) = storage();
        create_user(&storage, "elev@edu.ronneby.se", "Hemligt12345", "Elev", Role::Student)
            .unwrap();

        let again = create_user(
            &storage,
            "ELEV@edu.ronneby.se",
            "AnnatLosenord1",
            "Någon annan",
            Role::Admin,
        );
        assert_eq!(again.unwrap_err().kind(), "email-taken");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_normal_account_is_created_as_a_normal_account() {
        let (storage, dir) = storage();
        let user = create_user(&storage, "elev@edu.ronneby.se", "Hemligt12345", "Elev", Role::Student)
            .unwrap();

        assert!(!user.role.is_admin());
        // Namnet fylls i från adressen när inget anges.
        let without_name = create_user(
            &storage,
            "kompis@edu.ronneby.se",
            "Hemligt12345",
            "   ",
            Role::Student,
        )
        .unwrap();
        assert_eq!(without_name.display_name, "kompis");

        fs::remove_dir_all(&dir).ok();
    }

    // Testvärden. Det riktiga administratörskontot skapas ur `.env`, och dess
    // lösenord finns aldrig i källkoden – inte ens i ett test.
    //
    // E-postadresserna här är påhittade: den riktiga adressen står bara i
    // `.env`, så att den inte heller sprids med källkoden.
    const TEST_ADMIN_EMAIL: &str = "admin@exempel.se";
    const TEST_ADMIN_PASSWORD: &str = "Testlosenord123";
    const TEST_OTHER_PASSWORD: &str = "Nagot-annat-456";

    #[test]
    fn the_admin_account_is_created_once_and_then_left_alone() {
        let (storage, dir) = storage();

        let created = seed_admin_with(&storage, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
        assert_eq!(created.unwrap().as_deref(), Some(TEST_ADMIN_EMAIL));

        let admin = login(&storage, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD).unwrap();
        assert!(admin.role.is_admin());

        // Ett nytt försök med ett annat lösenord ska inte skriva över kontot.
        let again = seed_admin_with(&storage, TEST_ADMIN_EMAIL, TEST_OTHER_PASSWORD);
        assert!(again.unwrap().is_none());
        assert!(login(&storage, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD).is_ok());
        assert!(login(&storage, TEST_ADMIN_EMAIL, TEST_OTHER_PASSWORD).is_err());

        // Utan värden händer ingenting alls.
        assert!(seed_admin_with(&storage, "", "").unwrap().is_none());
        assert!(seed_admin_with(&storage, "nagon@exempel.se", "").unwrap().is_none());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn only_the_known_roles_are_accepted() {
        assert_eq!(parse_role("admin").unwrap(), Role::Admin);
        assert_eq!(parse_role("ADMIN").unwrap(), Role::Admin);
        assert_eq!(parse_role(" user ").unwrap(), Role::Student);
        assert_eq!(parse_role("").unwrap(), Role::Student);

        // En påhittad roll ska inte tyst bli en vanlig användare.
        assert!(parse_role("superadmin").is_err());
    }

    #[test]
    fn the_email_is_normalised_before_it_is_stored() {
        assert_eq!(normalize_email("  Elev@Edu.Ronneby.SE "), "elev@edu.ronneby.se");
    }

    #[test]
    fn the_interface_shape_is_what_the_login_page_reads() {
        let user = PublicUser {
            id: "1".to_string(),
            email: TEST_ADMIN_EMAIL.to_string(),
            display_name: "Administratör".to_string(),
            role: Role::Admin,
            role_label: Role::Admin.label().to_string(),
            active: true,
            person_id: None,
            permissions: vec!["info.publish".to_string(), "info.manage".to_string()],
        };

        let json = serde_json::to_value(&user).unwrap();
        assert_eq!(json["role"], "admin");
        assert_eq!(json["displayName"], "Administratör");
        assert_eq!(json["roleLabel"], "Administratör");
        assert_eq!(json["active"], true);
        assert_eq!(json["permissions"][0], "info.publish");
    }

    #[test]
    fn the_three_roles_are_read_and_written_as_the_interface_expects() {
        for (text, role) in [
            ("admin", Role::Admin),
            ("lärare", Role::Teacher),
            ("larare", Role::Teacher),
            ("elev", Role::Student),
        ] {
            assert_eq!(parse_role(text).unwrap(), role);
            let json = serde_json::to_value(role).unwrap();
            assert_eq!(json.as_str().unwrap(), text.replace("larare", "lärare"));
        }

        // Äldre värden läses fortfarande in.
        assert_eq!(parse_role("teacher").unwrap(), Role::Teacher);
        assert_eq!(parse_role("student").unwrap(), Role::Student);

        assert_eq!(Role::Admin.label(), "Administratör");
        assert_eq!(Role::Teacher.label(), "Lärare");
        assert_eq!(Role::Student.label(), "Elev");
        assert!(Role::Teacher.is_teacher());
        assert!(!Role::Teacher.is_admin());
        assert!(!Role::Student.is_admin());

        assert!(parse_role("superadmin").is_err());
    }

    #[test]
    fn an_inactive_account_cannot_log_in() {
        let (storage, dir) = storage();
        let created = create_user(
            &storage,
            "elev@edu.ronneby.se",
            "Hemligt12345",
            "Elev",
            Role::Student,
        )
        .unwrap();
        assert!(created.active);

        set_active(&storage, &created.id, false).unwrap();

        let error = login(&storage, "elev@edu.ronneby.se", "Hemligt12345").unwrap_err();
        assert_eq!(error.kind(), "account-inactive");

        set_active(&storage, &created.id, true).unwrap();
        assert!(login(&storage, "elev@edu.ronneby.se", "Hemligt12345").is_ok());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_password_can_be_reset_without_being_read_out() {
        let (storage, dir) = storage();
        let created = create_user(
            &storage,
            "elev@edu.ronneby.se",
            "Gammalt12345",
            "Elev",
            Role::Student,
        )
        .unwrap();

        reset_password(&storage, &created.id, "Nytt123456").unwrap();

        assert!(login(&storage, "elev@edu.ronneby.se", "Gammalt12345").is_err());
        assert!(login(&storage, "elev@edu.ronneby.se", "Nytt123456").is_ok());

        // Det gamla lösenordet ligger inte kvar i databasen.
        let raw = fs::read_to_string(dir.join(USERS_FILE)).unwrap();
        assert!(!raw.contains("Gammalt12345"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn repeated_failures_are_slowed_down() {
        let guard = LoginGuard::new();
        assert_eq!(guard.locked_for("elev@edu.ronneby.se"), 0);

        // De första försöken bromsas inte.
        for _ in 0..MAX_ATTEMPTS - 1 {
            assert_eq!(guard.record_failure("elev@edu.ronneby.se"), 0);
        }
        assert_eq!(guard.locked_for("elev@edu.ronneby.se"), 0);

        // Nästa felaktiga försök spärrar adressen.
        assert!(guard.record_failure("elev@edu.ronneby.se") > 0);
        assert!(guard.locked_for("elev@edu.ronneby.se") > 0);

        // Andra adresser påverkas inte.
        assert_eq!(guard.locked_for("nagon-annan@edu.ronneby.se"), 0);

        // Lyckad inloggning rensar räknaren.
        guard.record_success("elev@edu.ronneby.se");
        assert_eq!(guard.locked_for("elev@edu.ronneby.se"), 0);
    }

    #[test]
    fn a_person_can_be_connected_to_a_single_account() {
        use crate::storage::Person;

        let (storage, dir) = storage();
        let person = Person {
            id: "person-1".to_string(),
            kind: "elever".to_string(),
            first_name: "Linnéa".to_string(),
            last_name: "Jensen".to_string(),
            class_name: "9A".to_string(),
            email: "elev@edu.ronneby.se".to_string(),
            subjects: Vec::new(),
            active: true,
            created_at_ms: 1,
        };
        storage.save_person(&person).unwrap();
        assert_eq!(person.full_name(), "Linnéa Jensen");
        assert!(person.is_student());

        let account = create_account(
            &storage,
            NewAccount {
                email: "elev@edu.ronneby.se".to_string(),
                password: "Hemligt12345".to_string(),
                display_name: person.full_name(),
                role: Role::Student,
                person_id: Some(person.id.clone()),
            },
        )
        .unwrap();
        assert_eq!(account.person_id.as_deref(), Some("person-1"));

        // En person kan inte ha två konton, och en påhittad person avvisas.
        assert!(create_account(
            &storage,
            NewAccount {
                email: "annan@edu.ronneby.se".to_string(),
                password: "Hemligt12345".to_string(),
                display_name: "Annan".to_string(),
                role: Role::Student,
                person_id: Some("person-1".to_string()),
            },
        )
        .is_err());
        assert!(create_account(
            &storage,
            NewAccount {
                email: "tredje@edu.ronneby.se".to_string(),
                password: "Hemligt12345".to_string(),
                display_name: "Tredje".to_string(),
                role: Role::Student,
                person_id: Some("finns-inte".to_string()),
            },
        )
        .is_err());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_last_active_admin_can_be_counted() {
        let (storage, dir) = storage();
        assert_eq!(active_admins(&storage).unwrap(), 0);

        let admin = create_user(&storage, TEST_ADMIN_EMAIL, "Hemligt12345", "Admin", Role::Admin)
            .unwrap();
        assert_eq!(active_admins(&storage).unwrap(), 1);

        // En lärare räknas inte som administratör.
        create_user(&storage, "larare@exempel.se", "Hemligt12345", "Lärare", Role::Teacher)
            .unwrap();
        assert_eq!(active_admins(&storage).unwrap(), 1);

        set_active(&storage, &admin.id, false).unwrap();
        assert_eq!(active_admins(&storage).unwrap(), 0);

        fs::remove_dir_all(&dir).ok();
    }
}
