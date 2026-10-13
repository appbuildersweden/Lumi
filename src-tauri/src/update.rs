//! Versionskontroll och uppdateringar.
//!
//! Kontrollen går mot releaseplatsen i `tauri.conf.json` (GitHub Releases) och
//! signaturen verifieras av Tauri med den publika nyckeln som står där. Den
//! privata nyckeln finns aldrig i appen, i repot eller på webbplatsen – den
//! behövs bara när en release byggs.
//!
//! En nyare version hämtas och installeras vid start, utan att någon behöver
//! besöka webbplatsen eller köra en installationsfil själv. Signaturen måste
//! stämma med den publika nyckeln i `tauri.conf.json` innan något installeras –
//! gör den inte det avbryts uppdateringen och Lumi kör vidare som förut.
//!
//! Under en pågående session installeras inget. En omstart mitt i arbetet
//! vore ett avbrott, så då kontrolleras bara läget och uppdateringen tas vid
//! nästa start i stället.

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

use crate::error::AppError;

/// Vad en versionskontroll gav.
///
/// Gränssnittet får bara versionen och versionsanteckningarna – inte
/// nedladdningsadresser eller signaturer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// Den version som finns att hämta.
    pub version: String,
    /// Versionen som körs just nu.
    pub current_version: String,
    /// Versionsanteckningar från releasen, om några finns.
    pub notes: Option<String>,
}

/// Frågar releaseplatsen vilken version som är den senaste.
///
/// `Ok(None)` betyder att den här installationen redan är den senaste. Ett
/// fel betyder att kontrollen inte kunde göras – oftast att nätet saknas eller
/// att ingen release finns ännu.
pub async fn check(app: &AppHandle) -> Result<Option<UpdateInfo>, AppError> {
    let updater = app
        .updater()
        .map_err(|error| AppError::Update(error.to_string()))?;

    match updater.check().await {
        Ok(Some(update)) => Ok(Some(UpdateInfo {
            version: update.version.clone(),
            current_version: update.current_version.clone(),
            notes: update.body.clone(),
        })),
        Ok(None) => Ok(None),
        // Vanligaste orsaken innan den första releasen finns: adressen svarar
        // 404. Felet har en egen sort, så att det inte blandas ihop med AI:ns
        // nätverksfel.
        Err(error) => Err(AppError::Update(error.to_string())),
    }
}

/// Samma kontroll, men anropbar från gränssnittet.
#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<Option<UpdateInfo>, AppError> {
    check(&app).await
}

// ── Nedladdning och installation ──────────────────────────────────────────

/// Händelser som gränssnittet lyssnar på.
pub const EVENT_AVAILABLE: &str = "lumi://update-available";
pub const EVENT_PROGRESS: &str = "lumi://update-progress";
pub const EVENT_FAILED: &str = "lumi://update-failed";

/// Hur ofta en ny version letas efter när appen redan kör. Tätare än så
/// behövs inte: en uppdatering som publiceras medan Lumi är öppen tas ändå
/// vid nästa start.
pub const CHECK_INTERVAL_HOURS: u64 = 6;

/// Hur långt nedladdningen har kommit, till gränssnittet.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressReport {
    pub downloaded: u64,
    /// Total storlek om servern anger den, annars inget.
    pub total: Option<u64>,
}

/// Ett misslyckande som gränssnittet kan visa utan att avbryta något.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedReport {
    pub version: String,
    pub message: String,
}

/// Hämtar och installerar en nyare version om det finns någon.
///
/// Signaturen kontrolleras av uppdateringsfunktionen mot den publika nyckeln
/// innan filen godkänns, så en uppdatering som inte kan verifieras når aldrig
/// fram till en installation. Misslyckas något – inget nät, manifestet går
/// inte att läsa, signaturen stämmer inte eller installationen startar inte –
/// returneras felet och Lumi fortsätter köra som det är.
///
/// Returnerar versionen som installerades. På Windows avslutas appen när
/// installationsprogrammet har startat, och den nya versionen startas av
/// installationsprogrammet.
pub async fn check_and_install(app: &AppHandle) -> Result<Option<UpdateInfo>, AppError> {
    let updater = app
        .updater()
        .map_err(|error| AppError::Update(error.to_string()))?;

    let Some(update) = updater
        .check()
        .await
        .map_err(|error| AppError::Update(error.to_string()))?
    else {
        return Ok(None);
    };

    let info = UpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
    };

    // Gränssnittet får veta att en uppdatering är på väg, så att den korta
    // väntan syns i stället för att se ut som en krasch.
    let _ = app.emit(EVENT_AVAILABLE, &info);

    let handle = app.clone();
    let mut downloaded: u64 = 0;

    let result = update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = handle.emit(
                    EVENT_PROGRESS,
                    ProgressReport {
                        downloaded,
                        total: total.map(|value| value as u64),
                    },
                );
            },
            || {},
        )
        .await;

    match result {
        Ok(()) => Ok(Some(info)),
        Err(error) => {
            let message = error.to_string();
            let _ = app.emit(
                EVENT_FAILED,
                FailedReport {
                    version: info.version.clone(),
                    message: message.clone(),
                },
            );
            Err(AppError::Update(message))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::UpdateInfo;

    /// Konfigurationen läses precis som den ligger i filen. Testerna här
    /// fångar att en framtida ändring inte tyst tar bort versionskontrollen,
    /// den publika nyckeln eller installationen per användare.
    fn config() -> serde_json::Value {
        serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("tauri.conf.json gick inte att läsa")
    }

    #[test]
    fn the_update_endpoint_and_public_key_are_configured() {
        let config = config();
        let updater = &config["plugins"]["updater"];

        let pubkey = updater["pubkey"].as_str().unwrap_or_default();
        assert!(!pubkey.is_empty(), "den publika nyckeln för uppdateringar saknas");

        let endpoints: Vec<&str> = updater["endpoints"]
            .as_array()
            .expect("endpoints ska vara en lista")
            .iter()
            .filter_map(|value| value.as_str())
            .collect();
        assert_eq!(
            endpoints,
            ["https://github.com/appbuildersweden/Lumi/releases/latest/download/latest.json"],
            "releaseplatsen ska vara GitHub Releases"
        );
    }

    #[test]
    fn no_private_key_is_stored_in_the_configuration() {
        let text = include_str!("../tauri.conf.json");

        // Minisigns privata nycklar börjar med "untrusted comment: minisign
        // encrypted secret key". Den publika nyckeln får finnas – inget annat.
        assert!(!text.contains("secret key"), "en privat nyckel ligger i konfigurationen");
        assert!(!text.contains("PRIVATE KEY"), "en privat nyckel ligger i konfigurationen");
        assert!(
            !text.contains(".key"),
            "konfigurationen får inte peka på en nyckelfil"
        );
    }

    #[test]
    fn the_installer_is_per_user_and_updater_artifacts_are_created() {
        let config = config();

        assert_eq!(
            config["bundle"]["windows"]["nsis"]["installMode"], "currentUser",
            "installationen ska ske för den aktuella användaren, utan administratör"
        );
        assert_eq!(
            config["bundle"]["createUpdaterArtifacts"], true,
            "signerade uppdateringsfiler måste skapas vid bygget"
        );

        let targets: Vec<&str> = config["bundle"]["targets"]
            .as_array()
            .expect("targets ska vara en lista")
            .iter()
            .filter_map(|value| value.as_str())
            .collect();
        assert_eq!(targets, ["nsis"], "bara NSIS-installationen används");
    }

    /// Verifierar signaturen på en byggd installationsfil mot den publika
    /// nyckeln i konfigurationen – exakt den kontroll appen gör innan en
    /// uppdatering installeras. Kräver att en release har byggts först:
    ///
    /// ```bash
    /// npm run tauri build -- --bundles nsis
    /// cd src-tauri && cargo test -- --ignored the_installer_signature
    /// ```
    ///
    /// Saknas filen hoppar testet över med en rad om varför, eftersom det
    /// annars skulle fallera i en helt ny klon där inget har byggts.
    #[test]
    #[ignore = "kräver en byggd installationsfil – kör med cargo test -- --ignored"]
    fn the_installer_signature_verifies_with_the_configured_key() {
        use base64::Engine;

        fn decoded(value: &str) -> String {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(value.trim())
                .expect("värdet var inte base64");
            String::from_utf8(bytes).expect("base64 innehöll inte text")
        }

        let config = config();
        let version = config["version"].as_str().expect("versionen saknas");
        let installer = format!("target/release/bundle/nsis/Lumi_{version}_x64-setup.exe");

        let Ok(data) = std::fs::read(&installer) else {
            eprintln!("Hoppar över: {installer} finns inte – bygg releasen först.");
            return;
        };
        let signature_text = std::fs::read_to_string(format!("{installer}.sig"))
            .expect("signaturen saknas bredvid installationsfilen");

        let public_key = minisign_verify::PublicKey::decode(&decoded(
            config["plugins"]["updater"]["pubkey"]
                .as_str()
                .expect("den publika nyckeln saknas"),
        ))
        .expect("den publika nyckeln i konfigurationen kunde inte läsas");

        let signature = minisign_verify::Signature::decode(&decoded(&signature_text))
            .expect("signaturen kunde inte läsas");

        // Samma kontroll som uppdateringsfunktionen gör: stämmer signaturen med
        // nyckeln i konfigurationen får filen installeras.
        public_key
            .verify(&data, &signature, true)
            .expect("signaturen stämmer inte med den publika nyckeln");

        // Signaturen är gjord för just den här versionen.
        assert!(
            signature.trusted_comment().contains(&format!("version:{version}")),
            "signaturens kommentar nämner inte versionen: {}",
            signature.trusted_comment()
        );
    }

    /// Kontrollerar uppdateringsmanifestet som publiceras tillsammans med
    /// installationsfilen. Manifestet är det appen frågar efter, så pekar det
    /// på fel version, fel fil eller en signatur som inte hör ihop med filen
    /// slutar uppdateringarna att fungera.
    ///
    /// Saknas manifestet hoppar testet över: det skrivs först när en release
    /// förbereds, och en helt ny klon ska inte falla på det.
    #[test]
    #[ignore = "kräver ett förberett uppdateringsmanifest – kör med cargo test -- --ignored"]
    fn the_update_manifest_points_at_the_released_installer() {
        let config = config();
        let version = config["version"].as_str().expect("versionen saknas");
        let bundle = std::path::PathBuf::from("target/release/bundle/nsis");
        let manifest_path = bundle.join("latest.json");

        let Ok(raw) = std::fs::read_to_string(&manifest_path) else {
            eprintln!("Hoppar över: {} finns inte – förbered releasen först.", manifest_path.display());
            return;
        };
        let manifest: serde_json::Value =
            serde_json::from_str(&raw).expect("manifestet gick inte att läsa som JSON");

        // Rätt version, och samma som appen byggdes med.
        assert_eq!(
            manifest["version"].as_str(),
            Some(version),
            "manifestet pekar inte på den byggda versionen"
        );

        let platform = &manifest["platforms"]["windows-x86_64"];
        let url = platform["url"].as_str().expect("nedladdningsadressen saknas");
        assert!(
            url.contains("github.com/appbuildersweden/Lumi/releases"),
            "nedladdningen ska gå till releaseplatsen: {url}"
        );
        assert!(
            url.ends_with("Lumi-setup.exe"),
            "manifestet ska peka på installationsfilens fasta namn: {url}"
        );
        assert!(url.contains(version), "adressen nämner inte versionen: {url}");
        assert!(url.starts_with("https://"), "adressen måste vara krypterad");

        // Signaturen i manifestet måste vara signaturen för just den filen.
        let signature = platform["signature"]
            .as_str()
            .expect("signaturen saknas i manifestet");
        let installer_sig = std::fs::read_to_string(format!(
            "target/release/bundle/nsis/Lumi_{version}_x64-setup.exe.sig"
        ))
        .unwrap_or_default();
        assert_eq!(
            signature.trim(),
            installer_sig.trim(),
            "signaturen i manifestet hör inte till den byggda installationsfilen"
        );
    }

    #[test]
    fn update_info_is_serialised_with_camel_case_for_the_interface() {
        let json = serde_json::to_value(UpdateInfo {
            version: "0.2.0".to_string(),
            current_version: "0.1.0".to_string(),
            notes: Some("Första uppdateringen.".to_string()),
        })
        .unwrap();

        assert_eq!(json["version"], "0.2.0");
        assert_eq!(json["currentVersion"], "0.1.0");
        assert_eq!(json["notes"], "Första uppdateringen.");
    }
}
