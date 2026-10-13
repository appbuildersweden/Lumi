// Lumi – Tauri-startpunkt.
//
// Del 1 var enbart frontend. Nu finns också AI-läraren, studiematerialet och
// den lokala lagringen på plats. Allt som rör API-nyckeln och nätverket sker
// i Rust; gränssnittet når aldrig nyckeln.

mod auth;
mod chat;
mod commands;
mod config;
mod error;
mod materials;
mod openrouter;
mod storage;

use tauri::Manager;

use crate::commands::AppState;

/// Tidsstämpel till namn på säkerhetskopior: sekunder sedan 1970 (UTC).
///
/// Sekunder i stället för ett datum: ingen tidszon kan göra namnet fel, och
/// två körningar får alltid olika namn.
fn backup_stamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs().to_string())
        .unwrap_or_else(|_| "okand-tid".to_string())
}
use crate::openrouter::OpenRouterClient;
use crate::storage::Storage;

/// Läser .env om den finns. Miljövariabler som redan är satta vinner, så en
/// nyckel i Windows miljövariabler skriver inte över en nyckel i .env under
/// utveckling.
fn load_local_env() {
    if dotenvy::dotenv().is_ok() {
        return;
    }
    for candidate in ["../.env", ".env", "../../.env"] {
        if dotenvy::from_filename(candidate).is_ok() {
            return;
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    load_local_env();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let directory = commands::storage_dir(app.handle())?;
            let storage = Storage::new(directory)?;
            let (api_key, _) = commands::resolve_api_key();

            // Administratörskontot skapas från miljövariablerna första gången
            // appen startar. Lösenordet blir en hash direkt och skrivs aldrig
            // ut – bara adressen loggas. Ett misslyckande stoppar inte appen,
            // men skrivs ut så att orsaken går att åtgärda.
            match auth::seed_admin(&storage) {
                Ok(Some(email)) => println!("Lumi: administratörskontot {email} skapades."),
                Ok(None) => {}
                Err(error) => {
                    eprintln!("Lumi: administratörskontot kunde inte skapas ({error}).")
                }
            }

            // Äldre material och resultat saknar kontoägare. De flyttas en gång
            // till en egen bevarad fil i stället för att bli synliga för alla
            // elever. Går det inte stoppas inte appen – men det skrivs ut.
            match storage.migrate_ownerless_data(&backup_stamp()) {
                Ok(report) if !report.is_empty() => println!(
                    "Lumi: {} material och {} resultat utan kontoägare bevarades i {}.",
                    report.materials,
                    report.attempts,
                    report.backups.join(", ")
                ),
                Ok(_) => {}
                Err(error) => eprintln!("Lumi: äldre data kunde inte flyttas ({error})."),
            }

            app.manage(AppState {
                storage,
                client: OpenRouterClient::new(api_key)?,
                models: tokio::sync::Mutex::new(None),
                session: std::sync::Mutex::new(None),
                login_guard: auth::LoginGuard::new(),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth_login,
            commands::auth_logout,
            commands::auth_current_user,
            commands::auth_create_user,
            commands::auth_list_users,
            commands::auth_update_profile,
            commands::auth_change_password,
            commands::admin_overview,
            commands::list_people,
            commands::save_person,
            commands::set_person_active,
            commands::list_accounts,
            commands::create_account,
            commands::set_account_role,
            commands::set_account_active,
            commands::reset_account_password,
            commands::set_account_person,
            commands::list_roles,
            commands::list_assignments,
            commands::save_assignment,
            commands::delete_assignment,
            commands::list_submissions,
            commands::save_submission,
            commands::list_exams,
            commands::save_exam,
            commands::delete_exam,
            commands::list_exam_results,
            commands::save_exam_result,
            commands::list_schedule,
            commands::my_schedule,
            commands::save_schedule_entry,
            commands::delete_schedule_entry,
            commands::list_admin_messages,
            commands::save_admin_message,
            commands::delete_admin_message,
            commands::list_activity,
            commands::ai_status,
            commands::check_api_key,
            commands::list_models,
            commands::chat_stream,
            commands::conversation_context,
            commands::generate_material,
            commands::save_material,
            commands::list_materials,
            commands::get_subject_materials,
            commands::get_material,
            commands::delete_material,
            commands::save_attempt,
            commands::list_attempts,
            commands::get_settings,
            commands::update_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::load_local_env;
    use crate::auth::{self, login};
    use crate::storage::{Storage, USERS_FILE};

    /// Verifierar hela kedjan: `.env` läses, administratörskontot skapas och
    /// uppgifterna fungerar att logga in med – och lösenordet hamnar inte i
    /// klartext i databasen.
    ///
    /// Märkt `#[ignore]` eftersom den läser projektets `.env`. Kör med:
    /// `cargo test -- --ignored`.
    #[test]
    #[ignore = "läser projektets .env – kör med: cargo test -- --ignored"]
    fn the_admin_account_is_created_from_the_env_file() {
        load_local_env();

        let email = std::env::var(auth::ADMIN_EMAIL_ENV)
            .expect("LUMI_ADMIN_EMAIL saknas både i miljön och i .env");
        let password = std::env::var(auth::ADMIN_PASSWORD_ENV)
            .expect("LUMI_ADMIN_PASSWORD saknas både i miljön och i .env");

        let dir = std::env::temp_dir().join(format!("lumi-seed-{}", uuid::Uuid::new_v4()));
        let storage = Storage::new(&dir).expect("kunde inte skapa testmappen");

        let created = auth::seed_admin(&storage).expect("kontot borde kunna skapas");
        assert_eq!(created.as_deref(), Some(email.as_str()));

        let admin = login(&storage, &email, &password).expect("adminkontot borde kunna logga in");
        assert!(admin.role.is_admin(), "kontot fick inte rollen admin");

        // Fel lösenord nekas fortfarande.
        assert!(login(&storage, &email, "fel-losenord").is_err());

        // Och lösenordet finns inte i klartext i databasfilen. Meddelandet
        // skriver aldrig ut värdet.
        let raw = std::fs::read_to_string(dir.join(USERS_FILE)).expect("kunde inte läsa databasen");
        assert!(raw.contains("$argon2"), "hashen saknades i databasen");
        assert!(!raw.contains(&password), "lösenordet låg i klartext");

        std::fs::remove_dir_all(&dir).ok();
    }
}
