//! Kommandona som gränssnittet anropar.
//!
//! Allt som rör API-nyckeln, nätverket och filerna sker här. Frontend får
//! aldrig se nyckeln – den kan bara fråga om en nyckel finns.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::auth::{self, PublicUser};
use crate::chat;
use crate::config::{self, ModelRole};
use crate::error::AppError;
use crate::materials::{self, GenerateRequest};
use crate::openrouter::{ChatMessage, ChatUsage, ModelInfo, OpenRouterClient, ServiceStatus};
use crate::session;
use crate::storage::{
    now_ms, same_class, ActivityEntry, AdminMessage, Assignment, Attempt, Audience, Exam,
    ExamResult, Person, ScheduleEntry, Settings, Storage, StudyMaterial, Submission,
};

pub struct AppState {
    pub storage: Storage,
    /// Klienten skapas en gång vid start. Nyckeln ändras inte medan appen kör,
    /// så det behövs varken lås eller omladdning.
    pub client: OpenRouterClient,
    /// Modellistan cachas eftersom den sällan ändras och är stor.
    pub models: tokio::sync::Mutex<Option<Vec<ModelInfo>>>,
    /// Den inloggade eleven. Sessionen ligger i minnet i backend, så inga
    /// tokens eller lösenord sparas i gränssnittet.
    pub session: std::sync::Mutex<Option<PublicUser>>,
    /// Mappen där en sparad session kan ligga när "Håll mig inloggad" är
    /// aktiverat. Filen är skyddad med Windows DPAPI – se `session`.
    pub session_dir: PathBuf,
    /// Bromsar någon som gissar lösenord om och om igen.
    pub login_guard: auth::LoginGuard,
}

// ---------------------------------------------------------------------------
// Inloggning
// ---------------------------------------------------------------------------

/// Låset kan bara bli giftigt om en tråd panikerar medan den håller det.
/// Då är en tom session rätt svar, inte en krasch.
fn session(state: &AppState) -> std::sync::MutexGuard<'_, Option<PublicUser>> {
    state
        .session
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Kräver en inloggad användare och returnerar kontot.
///
/// Kontot läses om från lagringen varje gång, i stället för att litas på en
/// kopia i minnet. Då får en inaktiverad eller nedgraderad användare sina
/// rättigheter indragna direkt, utan att behöva starta om appen. Sessionen är
/// alltså bara ett id – aldrig en behörighet i sig.
fn require_session(state: &AppState) -> Result<PublicUser, AppError> {
    let signed_in = session(state).clone().ok_or(AppError::NotSignedIn)?;

    match state.storage.user_by_id(&signed_in.id)? {
        Some(user) if user.active => Ok(user.public()),
        Some(_) => Err(AppError::AccountInactive),
        None => Err(AppError::NotSignedIn),
    }
}

/// Kräver ett inloggat administratörskonto.
///
/// Rollen läses ur databasen vid varje anrop, så en vanlig användare kan inte
/// ge sig själv behörighet genom att ändra något i gränssnittet – och en
/// nedgraderad administratör tappar panelen direkt.
fn require_admin(state: &AppState) -> Result<PublicUser, AppError> {
    let user = require_session(state)?;
    if user.role.is_admin() {
        Ok(user)
    } else {
        Err(AppError::NotAdmin)
    }
}

/// Loggar in. Uppgifterna kontrolleras mot den hashade lösenordsposten i
/// databasen – det finns ingen genväg och inget inbyggt konto i koden.
#[tauri::command]
pub fn auth_login(
    state: State<'_, AppState>,
    email: String,
    password: String,
    remember: bool,
) -> Result<PublicUser, AppError> {
    let remaining = state.login_guard.locked_for(&email);
    if remaining > 0 {
        return Err(AppError::TooManyAttempts(remaining));
    }

    match auth::login(&state.storage, &email, &password) {
        Ok(user) => {
            state.login_guard.record_success(&email);
            *session(&state) = Some(user.clone());

            // "Håll mig inloggad": sessionen sparas skyddad på disken. Utan
            // krysset tas en tidigare sparad session bort, så att valet gäller
            // och inte bara blev kvar från förra gången.
            let saved = if remember {
                session::remember(&state.storage, &state.session_dir, &user.id)
            } else {
                session::clear(&state.session_dir)
            };

            // Går det inte att spara stoppas inte inloggningen: allt fungerar
            // den här gången, det är bara minnet till nästa start som saknas.
            if let Err(error) = saved {
                eprintln!("Lumi: sessionen kunde inte sparas ({error}).");
            }

            Ok(user)
        }
        Err(error) => {
            // Bara felaktiga uppgifter räknas. Ett inaktiverat konto ska inte
            // kunna spärra en adress.
            if error.kind() == "invalid-credentials" {
                let locked = state.login_guard.record_failure(&email);
                if locked > 0 {
                    return Err(AppError::TooManyAttempts(locked));
                }
            }
            Err(error)
        }
    }
}

#[tauri::command]
pub fn auth_logout(state: State<'_, AppState>) -> Result<(), AppError> {
    *session(&state) = None;

    // Utloggning ska också ta bort den sparade sessionen, så att nästa start
    // kräver en ny inloggning.
    session::clear(&state.session_dir)?;
    Ok(())
}

/// Återställer en sparad session vid start ("Håll mig inloggad").
///
/// Kontot läses om från databasen och kontrolleras här i backend – precis som
/// vid en vanlig inloggning. Gäller inte sessionen längre returneras `None`,
/// och gränssnittet visar inloggningen i stället.
#[tauri::command]
pub fn auth_restore_session(state: State<'_, AppState>) -> Result<Option<PublicUser>, AppError> {
    match session::restore(&state.storage, &state.session_dir)? {
        Some(user) => {
            *session(&state) = Some(user.clone());
            Ok(Some(user))
        }
        None => Ok(None),
    }
}

/// Vem som är inloggad just nu. Gör att en omladdning av fönstret behåller
/// inloggningen utan att lösenordet sparas någonstans.
#[tauri::command]
pub fn auth_current_user(state: State<'_, AppState>) -> Result<Option<PublicUser>, AppError> {
    Ok(session(&state).clone())
}

/// Skapar ett konto. Bara ett inloggat administratörskonto kommer förbi, och
/// rollen tolkas i backend.
#[tauri::command]
pub fn auth_create_user(
    state: State<'_, AppState>,
    email: String,
    password: String,
    display_name: String,
    role: String,
) -> Result<PublicUser, AppError> {
    require_admin(&state)?;
    auth::create_user(
        &state.storage,
        &email,
        &password,
        &display_name,
        auth::parse_role(&role)?,
    )
}

/// Listar kontona utan lösenordshashar. Bara för administratören.
#[tauri::command]
pub fn auth_list_users(state: State<'_, AppState>) -> Result<Vec<PublicUser>, AppError> {
    require_admin(&state)?;
    Ok(state
        .storage
        .users()?
        .into_iter()
        .map(|user| user.public())
        .collect())
}

// ---------------------------------------------------------------------------
// Egen profil
// ---------------------------------------------------------------------------
//
// Den inloggade administratören kan ändra sitt eget namn, sin e-postadress och
// sitt lösenord. Rollen kan inte ändras här – den byts bara under Konton och
// Roller. Kontot som ändras är alltid det som sessionen pekar på, aldrig ett id
// som gränssnittet skickar med.
//
// Bara ett administratörskonto kommer förbi. En elev eller lärare kan alltså
// inte ändra sina egna uppgifter ens genom att anropa kommandot direkt, och
// elevens profilsida är läsbar. Namn, klass och lösenord hanteras av skolan.

/// Ändrar namn och e-postadress på sitt eget konto.
#[tauri::command]
pub fn auth_update_profile(
    state: State<'_, AppState>,
    display_name: String,
    email: String,
) -> Result<PublicUser, AppError> {
    let actor = require_admin(&state)?;
    update_own_profile(&state, &actor, &display_name, &email)
}

/// Själva ändringen av den egna profilen.
///
/// Den är en egen funktion, utanför Tauri-kommandot, så att hela kedjan – konto,
/// personpost och session – går att köra i ett test.
fn update_own_profile(
    state: &AppState,
    actor: &PublicUser,
    display_name: &str,
    email: &str,
) -> Result<PublicUser, AppError> {
    // Personposten räknas fram först, så att en krock i registret stoppar
    // hela ändringen innan något har skrivits.
    let person = person_after_profile_change(state, actor, display_name, email)?;

    let user = auth::update_profile(&state.storage, &actor.id, display_name, email)?;

    let detail = match &person {
        Some(person) => {
            state.storage.save_person(person)?;
            format!("{} · personposten uppdaterad", user.email)
        }
        None => user.email.clone(),
    };

    // Sessionen följer med, så att namnet syns direkt i gränssnittet.
    *session(state) = Some(user.clone());
    log_action(state, &user, "Profil ändrad", detail);
    Ok(user)
}

/// Byter lösenord på sitt eget konto. Det nuvarande lösenordet krävs.
#[tauri::command]
pub fn auth_change_password(
    state: State<'_, AppState>,
    current_password: String,
    new_password: String,
) -> Result<PublicUser, AppError> {
    let actor = require_admin(&state)?;
    let user = auth::change_password(&state.storage, &actor.id, &current_password, &new_password)?;

    *session(&state) = Some(user.clone());
    // Bara att lösenordet byttes loggas – aldrig något av lösenorden.
    log_action(&state, &user, "Lösenord ändrat", user.email.clone());
    Ok(user)
}

// ---------------------------------------------------------------------------
// Adminpanelen
// ---------------------------------------------------------------------------
//
// Varje kommando här börjar med `require_admin`, som låser upp rollen ur
// sessionen. Gränssnittet får aldrig avgöra vem som är administratör.

/// Skriver en rad i aktivitetsloggen. Adresser och lösenord loggas aldrig.
fn log_action(state: &AppState, actor: &PublicUser, action: &str, detail: impl Into<String>) {
    state.storage.log_activity(&ActivityEntry {
        id: Uuid::new_v4().to_string(),
        at_ms: now_ms(),
        actor_id: actor.id.clone(),
        actor_name: actor.display_name.clone(),
        action: action.to_string(),
        detail: detail.into(),
    });
}

fn require_text(value: &str, label: &str) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(format!("{label} måste fyllas i.")));
    }
    Ok(trimmed.to_string())
}

/// Kontrollerar att ett datum är skrivet som `ÅÅÅÅ-MM-DD`.
fn require_date(value: &str, label: &str) -> Result<String, AppError> {
    let trimmed = value.trim();
    let looks_like_a_date = trimmed.len() == 10
        && trimmed.as_bytes()[4] == b'-'
        && trimmed.as_bytes()[7] == b'-'
        && trimmed.chars().filter(char::is_ascii_digit).count() == 8;

    if !looks_like_a_date {
        return Err(AppError::Validation(format!(
            "{label} måste vara ett datum som 2026-05-14."
        )));
    }
    Ok(trimmed.to_string())
}

/// Fyller i id och tidsstämpel för en ny post. En befintlig post behåller sitt id.
fn prepare(id: &mut String, created_at_ms: &mut u64) {
    if id.trim().is_empty() {
        *id = Uuid::new_v4().to_string();
    }
    if *created_at_ms == 0 {
        *created_at_ms = now_ms();
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminOverview {
    pub students: usize,
    pub staff: usize,
    pub accounts: usize,
    pub inactive_accounts: usize,
    pub accounts_without_person: usize,
    pub published_assignments: usize,
    pub exams: usize,
    pub schedule_entries: usize,
}

#[tauri::command]
pub fn admin_overview(state: State<'_, AppState>) -> Result<AdminOverview, AppError> {
    require_admin(&state)?;

    let people = state.storage.people()?;
    let users = state.storage.users()?;

    Ok(AdminOverview {
        students: people.iter().filter(|person| person.is_student()).count(),
        staff: people.iter().filter(|person| !person.is_student()).count(),
        accounts: users.len(),
        inactive_accounts: users.iter().filter(|user| !user.active).count(),
        accounts_without_person: users.iter().filter(|user| user.person_id.is_none()).count(),
        published_assignments: state
            .storage
            .assignments()?
            .iter()
            .filter(|assignment| assignment.published)
            .count(),
        exams: state.storage.exams()?.len(),
        schedule_entries: state.storage.schedule()?.len(),
    })
}

// -- Personer -------------------------------------------------------------

#[tauri::command]
pub fn list_people(
    state: State<'_, AppState>,
    kind: Option<String>,
) -> Result<Vec<Person>, AppError> {
    require_admin(&state)?;

    let people = state.storage.people()?;
    let Some(kind) = kind.map(|value| value.trim().to_lowercase()) else {
        return Ok(people);
    };

    Ok(people
        .into_iter()
        .filter(|person| person.kind == kind)
        .collect())
}

#[tauri::command]
pub fn save_person(state: State<'_, AppState>, person: Person) -> Result<Person, AppError> {
    let actor = require_admin(&state)?;
    store_person(&state, &actor, person)
}

/// Sparar en person i registret.
///
/// Ligger utanför Tauri-kommandot så att hela kedjan – städning, dubblett-
/// kontroll och kopplingen till kontot – går att köra i ett test.
fn store_person(
    state: &AppState,
    actor: &PublicUser,
    person: Person,
) -> Result<Person, AppError> {
    let mut person = person;
    let is_new = person.id.trim().is_empty();
    prepare(&mut person.id, &mut person.created_at_ms);

    person.first_name = require_text(&person.first_name, "Förnamnet")?;
    person.last_name = require_text(&person.last_name, "Efternamnet")?;
    person.email = person.email.trim().to_lowercase();
    ensure_person_is_unique(&state.storage, &person)?;
    person.kind = match person.kind.trim().to_lowercase().as_str() {
        "elever" | "elev" => "elever".to_string(),
        "personal" | "lärare" | "larare" => "personal".to_string(),
        other => {
            return Err(AppError::Validation(format!(
                "Typen \"{other}\" finns inte. Använd elever eller personal."
            )))
        }
    };

    state.storage.save_person(&person)?;

    // Har personen ett konto följer kontots visningsnamn med, så att namn-
    // ändringen i registret inte lämnar kontot med ett gammalt namn.
    if let Some(account) = account_after_person_change(state, &person)? {
        if account.id == actor.id {
            *session(state) = Some(account);
        }
    }

    log_action(
        state,
        actor,
        if is_new { "Person skapad" } else { "Person ändrad" },
        person.full_name(),
    );

    Ok(person)
}

#[tauri::command]
pub fn set_person_active(
    state: State<'_, AppState>,
    id: String,
    active: bool,
) -> Result<Person, AppError> {
    let actor = require_admin(&state)?;

    let mut person = state
        .storage
        .person(&id)?
        .ok_or_else(|| AppError::Validation("Personen hittades inte.".to_string()))?;
    person.active = active;
    state.storage.save_person(&person)?;

    log_action(
        &state,
        &actor,
        if active {
            "Person aktiverad"
        } else {
            "Person inaktiverad"
        },
        person.full_name(),
    );

    Ok(person)
}

// -- Konton ---------------------------------------------------------------

/// Ett konto tillsammans med personen det hör till, för listningen i panelen.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountRow {
    #[serde(flatten)]
    pub account: PublicUser,
    pub person_name: String,
    pub class_name: String,
    pub kind: String,
}

/// Uppgifterna för att skapa ett konto, och eventuellt personen samtidigt.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAccountInput {
    pub email: String,
    pub password: String,
    pub role: String,
    #[serde(default)]
    pub display_name: String,
    /// Befintlig person att koppla kontot till.
    #[serde(default)]
    pub person_id: Option<String>,
    /// Ny person att registrera i samma steg.
    #[serde(default)]
    pub first_name: String,
    #[serde(default)]
    pub last_name: String,
    #[serde(default)]
    pub class_name: String,
}

fn account_rows(state: &AppState) -> Result<Vec<AccountRow>, AppError> {
    let people = state.storage.people()?;
    Ok(state
        .storage
        .users()?
        .into_iter()
        .map(|user| {
            let person = user
                .person_id
                .as_deref()
                .and_then(|id| people.iter().find(|person| person.id == id));
            AccountRow {
                person_name: person.map(Person::full_name).unwrap_or_default(),
                class_name: person.map(|person| person.class_name.clone()).unwrap_or_default(),
                kind: person.map(|person| person.kind.clone()).unwrap_or_default(),
                account: user.public(),
            }
        })
        .collect())
}

#[tauri::command]
pub fn list_accounts(state: State<'_, AppState>) -> Result<Vec<AccountRow>, AppError> {
    require_admin(&state)?;
    account_rows(&state)
}

/// Skapar ett konto och kan samtidigt registrera personen det hör till.
#[tauri::command]
pub fn create_account(
    state: State<'_, AppState>,
    input: NewAccountInput,
) -> Result<AccountRow, AppError> {
    let actor = require_admin(&state)?;
    let role = auth::parse_role(&input.role)?;

    // Antingen kopplas kontot till en befintlig person, eller så skapas
    // personen först i samma arbetsflöde.
    let person_id = if let Some(existing) = input
        .person_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        Some(existing.to_string())
    } else if input.first_name.trim().is_empty() && input.last_name.trim().is_empty() {
        None
    } else {
        let person = Person {
            id: Uuid::new_v4().to_string(),
            kind: if role.is_teacher() || role.is_admin() {
                "personal"
            } else {
                "elever"
            }
            .to_string(),
            first_name: require_text(&input.first_name, "Förnamnet")?,
            last_name: require_text(&input.last_name, "Efternamnet")?,
            class_name: input.class_name.trim().to_string(),
            email: input.email.trim().to_lowercase(),
            subjects: Vec::new(),
            active: true,
            created_at_ms: now_ms(),
        };

        state.storage.save_person(&person)?;
        log_action(&state, &actor, "Person skapad", person.full_name());
        Some(person.id)
    };

    let display_name = if input.display_name.trim().is_empty() {
        match person_id.as_deref().and_then(|id| state.storage.person(id).ok().flatten()) {
            Some(person) => person.full_name(),
            None => input.email.trim().to_lowercase(),
        }
    } else {
        input.display_name.trim().to_string()
    };

    let account = auth::create_account(
        &state.storage,
        auth::NewAccount {
            email: input.email,
            password: input.password,
            display_name,
            role,
            person_id,
        },
    )?;

    log_action(
        &state,
        &actor,
        "Konto skapat",
        format!("{} ({})", account.email, account.role_label),
    );

    account_rows(&state)?
        .into_iter()
        .find(|row| row.account.id == account.id)
        .ok_or(AppError::UnreadableResponse)
}

#[tauri::command]
pub fn set_account_role(
    state: State<'_, AppState>,
    account_id: String,
    role: String,
) -> Result<PublicUser, AppError> {
    let actor = require_admin(&state)?;
    let role = auth::parse_role(&role)?;

    let current = state
        .storage
        .user_by_id(&account_id)?
        .ok_or_else(|| AppError::Validation("Kontot hittades inte.".to_string()))?;

    // Att ta bort adminbehörigheten från den sista administratören skulle låsa
    // ute hela skolan från panelen.
    if current.role.is_admin() && !role.is_admin() && auth::active_admins(&state.storage)? <= 1 {
        return Err(AppError::Validation(
            "Det sista administratörskontot kan inte byta roll.".to_string(),
        ));
    }

    let account = auth::set_role(&state.storage, &account_id, role)?;
    log_action(
        &state,
        &actor,
        "Roll ändrad",
        format!("{} → {}", account.email, role.label()),
    );
    Ok(account)
}

#[tauri::command]
pub fn set_account_active(
    state: State<'_, AppState>,
    account_id: String,
    active: bool,
) -> Result<PublicUser, AppError> {
    let actor = require_admin(&state)?;

    let current = state
        .storage
        .user_by_id(&account_id)?
        .ok_or_else(|| AppError::Validation("Kontot hittades inte.".to_string()))?;

    if !active && current.role.is_admin() && auth::active_admins(&state.storage)? <= 1 {
        return Err(AppError::Validation(
            "Det sista administratörskontot kan inte inaktiveras.".to_string(),
        ));
    }

    let account = auth::set_active(&state.storage, &account_id, active)?;
    log_action(
        &state,
        &actor,
        if active {
            "Konto aktiverat"
        } else {
            "Konto inaktiverat"
        },
        account.email.clone(),
    );
    Ok(account)
}

/// Sätter ett nytt lösenord åt ett konto. Det nya lösenordet returneras aldrig
/// och loggas aldrig – administratören skriver det till personen själv.
#[tauri::command]
pub fn reset_account_password(
    state: State<'_, AppState>,
    account_id: String,
    new_password: String,
) -> Result<PublicUser, AppError> {
    let actor = require_admin(&state)?;

    let account = auth::reset_password(&state.storage, &account_id, &new_password)?;
    log_action(
        &state,
        &actor,
        "Lösenord återställt",
        account.email.clone(),
    );
    Ok(account)
}

#[tauri::command]
pub fn set_account_person(
    state: State<'_, AppState>,
    account_id: String,
    person_id: Option<String>,
) -> Result<PublicUser, AppError> {
    let actor = require_admin(&state)?;

    let account = auth::set_person(&state.storage, &account_id, person_id)?;
    log_action(
        &state,
        &actor,
        "Konto kopplat till person",
        account.email.clone(),
    );
    Ok(account)
}

// -- Roller ---------------------------------------------------------------

/// Vad en roll får göra, så som backend ser det. Gränssnittet visar listan
/// i stället för att hitta på egna behörigheter.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleInfo {
    pub slug: String,
    pub label: String,
    pub description: String,
    pub lands_in: String,
    pub can: Vec<String>,
}

#[tauri::command]
pub fn list_roles(state: State<'_, AppState>) -> Result<Vec<RoleInfo>, AppError> {
    require_admin(&state)?;

    let role = |slug: &str, label: &str, description: &str, lands_in: &str, can: &[&str]| RoleInfo {
        slug: slug.to_string(),
        label: label.to_string(),
        description: description.to_string(),
        lands_in: lands_in.to_string(),
        can: can.iter().map(|item| item.to_string()).collect(),
    };

    Ok(vec![
        role(
            "admin",
            "Administratör",
            "Sköter konton, roller, uppgifter, scheman och översikter.",
            "adminpanelen",
            &[
                "Skapa och inaktivera konton",
                "Ändra roller",
                "Återställa lösenord",
                "Hantera uppgifter, prov och scheman",
                "Se elevernas samlade läge",
            ],
        ),
        role(
            "lärare",
            "Lärare",
            "Undervisar och följer sina elever. Har inte tillgång till adminpanelen.",
            "Lumis elevgränssnitt",
            &[
                "Använda AI-läraren och Plugga",
                "Publicera information till elever och klasser",
                "Ändra och ta bort sina egna informationsposter",
                "Se sina egna elever när lärargränssnittet är klart",
            ],
        ),
        role(
            "elev",
            "Elev",
            "Studerar med AI-läraren, Plugga och sitt schema.",
            "Lumis startsida",
            &[
                "Läsa information som gäller eleven och elevens klass",
                "Använda AI-läraren och Plugga",
                "Se sitt eget schema och sina resultat",
            ],
        ),
    ])
}

// -- Uppgifter och inlämningar --------------------------------------------

#[tauri::command]
pub fn list_assignments(state: State<'_, AppState>) -> Result<Vec<Assignment>, AppError> {
    require_admin(&state)?;
    state.storage.assignments()
}

#[tauri::command]
pub fn save_assignment(
    state: State<'_, AppState>,
    assignment: Assignment,
) -> Result<Assignment, AppError> {
    let actor = require_admin(&state)?;

    let mut assignment = assignment;
    let is_new = assignment.id.trim().is_empty();
    prepare(&mut assignment.id, &mut assignment.created_at_ms);

    validate_assignment(&mut assignment)?;

    assignment.created_by_name = actor.display_name.clone();
    state.storage.save_assignment(&assignment)?;

    log_action(
        &state,
        &actor,
        if is_new {
            "Uppgift skapad"
        } else {
            "Uppgift ändrad"
        },
        format!("{} · {}", assignment.title, assignment.subject),
    );

    Ok(assignment)
}

#[tauri::command]
pub fn delete_assignment(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    let actor = require_admin(&state)?;
    let title = state
        .storage
        .assignments()?
        .into_iter()
        .find(|assignment| assignment.id == id)
        .map(|assignment| assignment.title)
        .unwrap_or_default();

    state.storage.remove_assignment(&id)?;
    log_action(&state, &actor, "Uppgift borttagen", title);
    Ok(())
}

#[tauri::command]
pub fn list_submissions(state: State<'_, AppState>) -> Result<Vec<Submission>, AppError> {
    require_admin(&state)?;
    state.storage.submissions()
}

#[tauri::command]
pub fn save_submission(
    state: State<'_, AppState>,
    submission: Submission,
) -> Result<Submission, AppError> {
    let actor = require_admin(&state)?;

    let mut submission = submission;
    submit_prepare(&mut submission);

    state.storage.save_submission(&submission)?;
    log_action(
        &state,
        &actor,
        "Inlämning registrerad",
        format!("{} · {}", submission.assignment_id, submission.student_id),
    );
    Ok(submission)
}

fn submit_prepare(submission: &mut Submission) {
    if submission.id.trim().is_empty() {
        submission.id = Uuid::new_v4().to_string();
    }
    if submission.submitted_at_ms.is_none() {
        submission.submitted_at_ms = Some(now_ms());
    }
}

// -- Prov -----------------------------------------------------------------

#[tauri::command]
pub fn list_exams(state: State<'_, AppState>) -> Result<Vec<Exam>, AppError> {
    require_admin(&state)?;
    state.storage.exams()
}

#[tauri::command]
pub fn save_exam(state: State<'_, AppState>, exam: Exam) -> Result<Exam, AppError> {
    let actor = require_admin(&state)?;

    let mut exam = exam;
    let is_new = exam.id.trim().is_empty();
    prepare(&mut exam.id, &mut exam.created_at_ms);

    validate_exam(&mut exam)?;

    state.storage.save_exam(&exam)?;
    log_action(
        &state,
        &actor,
        if is_new { "Prov skapat" } else { "Prov ändrat" },
        format!("{} · {}", exam.title, exam.date),
    );
    Ok(exam)
}

#[tauri::command]
pub fn delete_exam(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    let actor = require_admin(&state)?;
    let title = state
        .storage
        .exams()?
        .into_iter()
        .find(|exam| exam.id == id)
        .map(|exam| exam.title)
        .unwrap_or_default();

    state.storage.remove_exam(&id)?;
    log_action(&state, &actor, "Prov borttaget", title);
    Ok(())
}

#[tauri::command]
pub fn list_exam_results(state: State<'_, AppState>) -> Result<Vec<ExamResult>, AppError> {
    require_admin(&state)?;
    state.storage.exam_results()
}

#[tauri::command]
pub fn save_exam_result(
    state: State<'_, AppState>,
    result: ExamResult,
) -> Result<ExamResult, AppError> {
    let actor = require_admin(&state)?;

    let mut result = result;
    if result.id.trim().is_empty() {
        result.id = Uuid::new_v4().to_string();
    }
    if result.recorded_at_ms == 0 {
        result.recorded_at_ms = now_ms();
    }
    if let (Some(score), Some(max)) = (result.score, result.max_score) {
        if max == 0 || score > max {
            return Err(AppError::Validation(
                "Poängen kan inte vara högre än maxpoängen.".to_string(),
            ));
        }
    }

    state.storage.save_exam_result(&result)?;
    log_action(
        &state,
        &actor,
        "Provresultat sparat",
        format!("{} · {}", result.exam_id, result.student_id),
    );
    Ok(result)
}

// -- Schema ---------------------------------------------------------------

#[tauri::command]
pub fn list_schedule(state: State<'_, AppState>) -> Result<Vec<ScheduleEntry>, AppError> {
    require_admin(&state)?;
    state.storage.schedule()
}

/// Schemaposterna en person ska se.
///
/// Eleven ser sin klass och de poster som gäller alla, läraren ser dessutom
/// de pass den ansvarar för. Urvalet görs här i backend, så ingen får se en
/// annan klass schema genom att ändra något i gränssnittet.
fn schedule_for_user(storage: &Storage, user: &PublicUser) -> Result<Vec<ScheduleEntry>, AppError> {
    let Some(person) = user
        .person_id
        .as_deref()
        .filter(|id| !id.trim().is_empty())
        .and_then(|id| storage.person(id).ok().flatten())
    else {
        return Ok(Vec::new());
    };

    Ok(storage
        .schedule()?
        .into_iter()
        .filter(|entry| {
            entry.teacher_id == person.id
                || entry.class_name.is_empty()
                || (!person.class_name.is_empty() && entry.class_name == person.class_name)
        })
        .collect())
}

/// Elevens och lärarens eget schema.
///
/// Läser samma lagring som adminpanelen skriver till, så skolans schema och
/// schemat på elevens sida kan inte bli två olika scheman.
#[tauri::command]
pub fn my_schedule(state: State<'_, AppState>) -> Result<Vec<ScheduleEntry>, AppError> {
    let user = require_session(&state)?;
    schedule_for_user(&state.storage, &user)
}

#[tauri::command]
pub fn save_schedule_entry(
    state: State<'_, AppState>,
    entry: ScheduleEntry,
) -> Result<ScheduleEntry, AppError> {
    let actor = require_admin(&state)?;

    let mut entry = entry;
    let is_new = entry.id.trim().is_empty();
    prepare(&mut entry.id, &mut entry.created_at_ms);

    entry.title = require_text(&entry.title, "Rubriken")?;
    entry.start = require_clock(&entry.start, "Starttiden")?;
    if !entry.end.trim().is_empty() {
        entry.end = require_clock(&entry.end, "Sluttiden")?;
    }
    if !(1..=7).contains(&entry.weekday) {
        return Err(AppError::Validation(
            "Veckodagen måste vara mellan måndag och söndag.".to_string(),
        ));
    }

    validate_schedule_slot(&state.storage, &entry)?;
    entry.kind = match entry.kind.trim().to_lowercase().as_str() {
        "lektion" | "" => "lektion".to_string(),
        "prov" => "prov".to_string(),
        "aktivitet" => "aktivitet".to_string(),
        other => {
            return Err(AppError::Validation(format!(
                "Typen \"{other}\" finns inte i schemat."
            )))
        }
    };

    state.storage.save_schedule_entry(&entry)?;
    log_action(
        &state,
        &actor,
        if is_new {
            "Schemapost skapad"
        } else {
            "Schemapost ändrad"
        },
        format!("{} · {}", entry.title, entry.start),
    );
    Ok(entry)
}

/// Kontrollerar tiderna på en schemapost.
///
/// Sluttiden måste ligga efter starttiden, och två pass för samma klass får
/// inte gå i varandra. Pass utan klass gäller hela skolan och jämförs därför
/// inte med varandra.
fn validate_schedule_slot(storage: &Storage, entry: &ScheduleEntry) -> Result<(), AppError> {
    if !entry.end.is_empty() && entry.end <= entry.start {
        return Err(AppError::Validation(
            "Sluttiden måste vara efter starttiden.".to_string(),
        ));
    }

    if entry.class_name.is_empty() || entry.end.is_empty() {
        return Ok(());
    }

    let overlapping = storage.schedule()?.into_iter().find(|other| {
        other.id != entry.id
            && other.weekday == entry.weekday
            && other.class_name == entry.class_name
            && !other.end.is_empty()
            && other.start < entry.end
            && entry.start < other.end
    });

    match overlapping {
        Some(other) => Err(AppError::Validation(format!(
            "Tiden överlappar \"{}\" ({}–{}) i {}.",
            other.title, other.start, other.end, other.class_name
        ))),
        None => Ok(()),
    }
}

/// Ser till att samma person bara finns en gång i registret.
///
/// En ny post med samma e-postadress avvisas alltid. Därutöver avvisas samma
/// namn i samma klass, eftersom det är så en elev identifieras. Personal utan
/// klass kan däremot heta samma sak som någon annan – där skiljer adressen
/// dem åt.
fn ensure_person_is_unique(storage: &Storage, person: &Person) -> Result<(), AppError> {
    let same_name_in_class = |other: &Person| {
        !person.class_name.is_empty()
            && other.class_name == person.class_name
            && other.first_name.eq_ignore_ascii_case(&person.first_name)
            && other.last_name.eq_ignore_ascii_case(&person.last_name)
    };

    let duplicate = storage.people()?.iter().any(|other| {
        other.id != person.id
            && ((!person.email.is_empty() && other.email == person.email)
                || same_name_in_class(other))
    });

    if duplicate {
        return Err(AppError::Validation(format!(
            "{} finns redan i registret.",
            person.full_name()
        )));
    }
    Ok(())
}

// -- Konto och personpost i takt ------------------------------------------
//
// Ett konto kan vara kopplat till en person i registret. Namnet ska då vara
// detsamma på båda ställena, annars visar panelen två olika namn för samma
// person. Kontots inloggningsadress ägs av kontot, medan registrets adress är
// kontaktuppgifter – de hålls i takt men skrivs aldrig över av misstag.

/// Delar ett namn i för- och efternamn, så som registret sparar det.
///
/// Allt utom det sista ordet blir förnamn. Består namnet av ett enda ord
/// behålls det befintliga efternamnet, så att inget namn försvinner.
fn split_display_name(display_name: &str, current_last_name: &str) -> (String, String) {
    let trimmed = display_name.trim();
    match trimmed.rsplit_once(' ') {
        Some((first, last)) if !first.trim().is_empty() && !last.trim().is_empty() => {
            (first.trim().to_string(), last.trim().to_string())
        }
        _ => (trimmed.to_string(), current_last_name.trim().to_string()),
    }
}

/// Räknar ut hur kontots personpost ska se ut efter en profiländring.
///
/// Namnet följer alltid med. Kontaktadressen uppdateras bara när den var tom
/// eller redan var kontots inloggningsadress; en egen kontaktadress i registret
/// lämnas orörd. Posten kontrolleras mot registret innan den lämnas tillbaka,
/// så att ingen annan person får samma namn i klassen eller samma adress.
fn person_after_profile_change(
    state: &AppState,
    account: &PublicUser,
    display_name: &str,
    email: &str,
) -> Result<Option<Person>, AppError> {
    let Some(person_id) = account.person_id.as_deref() else {
        return Ok(None);
    };
    let Some(mut person) = state.storage.person(person_id)? else {
        return Ok(None);
    };

    let (first_name, last_name) = split_display_name(display_name, &person.last_name);
    person.first_name = first_name;
    person.last_name = last_name;

    if person.email.is_empty() || person.email.eq_ignore_ascii_case(&account.email) {
        person.email = email.trim().to_lowercase();
    }

    ensure_person_is_unique(&state.storage, &person)?;
    Ok(Some(person))
}

/// Speglar registrets namn till det kopplade kontots visningsnamn.
///
/// Inloggningsadressen rörs inte här – den ägs av kontot och byts under
/// profilen eller Konton. Samma person får bara ha ett konto.
fn account_after_person_change(
    state: &AppState,
    person: &Person,
) -> Result<Option<PublicUser>, AppError> {
    let full_name = person.full_name();
    if full_name.is_empty() {
        return Ok(None);
    }

    let found = state
        .storage
        .users()?
        .into_iter()
        .find(|user| user.person_id.as_deref() == Some(person.id.as_str()));

    let Some(mut account) = found else {
        return Ok(None);
    };
    if account.display_name == full_name {
        return Ok(None);
    }

    account.display_name = full_name;
    state.storage.add_user(&account)?;
    Ok(Some(account.public()))
}

/// Reglerna för en uppgift: rubrik, ämne och ett riktigt datum.
///
/// En publicerad uppgift måste dessutom gälla någon – annars hamnar den hos
/// ingen elev alls. Ett utkast får sparas utan mottagare.
fn validate_assignment(assignment: &mut Assignment) -> Result<(), AppError> {
    assignment.title = require_text(&assignment.title, "Rubriken")?;
    assignment.subject = require_text(&assignment.subject, "Ämnet")?;
    assignment.due_date = require_date(&assignment.due_date, "Deadline")?;

    if assignment.published && assignment.class_names.is_empty() && assignment.student_ids.is_empty()
    {
        return Err(AppError::Validation(
            "Välj minst en klass eller elev innan uppgiften publiceras.".to_string(),
        ));
    }

    Ok(())
}

/// Reglerna för ett prov: rubrik, ämne, ett riktigt datum och minst en deltagare.
fn validate_exam(exam: &mut Exam) -> Result<(), AppError> {
    exam.title = require_text(&exam.title, "Rubriken")?;
    exam.subject = require_text(&exam.subject, "Ämnet")?;
    exam.date = require_date(&exam.date, "Provdatumet")?;

    if exam.class_names.is_empty() && exam.student_ids.is_empty() {
        return Err(AppError::Validation(
            "Välj minst en klass eller elev för provet.".to_string(),
        ));
    }

    Ok(())
}

/// Kontrollerar att en tid är skriven som `TT:MM` och finns på en klocka.
fn require_clock(value: &str, label: &str) -> Result<String, AppError> {
    let trimmed = value.trim();
    let wrong = || AppError::Validation(format!("{label} måste vara en tid som 08:30."));

    let looks_like_a_time = trimmed.len() == 5
        && trimmed.as_bytes()[2] == b':'
        && trimmed.chars().filter(char::is_ascii_digit).count() == 4;
    if !looks_like_a_time {
        return Err(wrong());
    }

    let hour: u32 = trimmed[0..2].parse().map_err(|_| wrong())?;
    let minute: u32 = trimmed[3..5].parse().map_err(|_| wrong())?;
    if hour > 23 || minute > 59 {
        return Err(wrong());
    }

    Ok(trimmed.to_string())
}

#[tauri::command]
pub fn delete_schedule_entry(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    let actor = require_admin(&state)?;
    let title = state
        .storage
        .schedule()?
        .into_iter()
        .find(|entry| entry.id == id)
        .map(|entry| entry.title)
        .unwrap_or_default();

    state.storage.remove_schedule_entry(&id)?;
    log_action(&state, &actor, "Schemapost borttagen", title);
    Ok(())
}

// -- Nyheter, meddelanden och aktivitetslogg ------------------------------

/// Kräver ett konto som får publicera information.
///
/// Behörigheten kommer från rollen i databasen – administratören och läraren
/// får publicera, eleven aldrig. Ingen kontroll sker i gränssnittet.
fn require_publisher(state: &AppState) -> Result<PublicUser, AppError> {
    let user = require_session(state)?;
    if user.role.can_publish_info() {
        Ok(user)
    } else {
        Err(AppError::NotAllowed)
    }
}

/// Sant när kontot får ändra eller ta bort en post som någon annan lade upp.
/// Administratören får allt; en lärare bara sina egna poster.
fn may_edit(actor: &PublicUser, author_id: &str) -> bool {
    actor.role.can_manage_info()
        || (!author_id.trim().is_empty() && author_id == actor.id)
}

/// Personen kontot hör till, om det är kopplat. Klassen och grupptillhörigheten
/// hämtas härifrån – gränssnittet kan aldrig skicka in ett eget namn eller id.
fn person_of(storage: &Storage, user: &PublicUser) -> Option<Person> {
    user.person_id
        .as_deref()
        .filter(|id| !id.trim().is_empty())
        .and_then(|id| storage.person(id).ok().flatten())
}

/// Klassen den inloggade går i, hämtad ur personregistret via kontots
/// person-id. Tom när kontot inte är kopplat till en elev.
fn class_of(storage: &Storage, user: &PublicUser) -> String {
    person_of(storage, user)
        .map(|person| person.class_name)
        .unwrap_or_default()
}

/// Klasserna en lärare undervisar i, enligt skolans schema. Det är den enda
/// kopplingen mellan en lärare och en klass som finns i Lumi.
fn teacher_classes(storage: &Storage, person_id: &str) -> Vec<String> {
    let mut classes: Vec<String> = Vec::new();
    if person_id.trim().is_empty() {
        return classes;
    }

    for entry in storage.schedule().unwrap_or_default() {
        if entry.teacher_id != person_id {
            continue;
        }

        let name = entry.class_name.trim();
        if name.is_empty() || classes.iter().any(|kept| same_class(kept, name)) {
            continue;
        }
        classes.push(name.to_string());
    }

    classes.sort();
    classes
}

/// Vad den inloggade får rikta information till.
///
/// Administratören når hela skolan. En lärare når sina egna klasser och de
/// elever som går i dem, aldrig någon annans. Urvalet byggs ur skolans data,
/// så en behörighet kan inte hittas på i gränssnittet.
struct InfoScope {
    /// Klasserna kontot får skicka till.
    classes: Vec<String>,
    /// Eleverna kontot får skicka till, som person-id.
    student_ids: Vec<String>,
    /// Sant för administratören: hela skolan, alla elever och personalen.
    everyone: bool,
}

impl InfoScope {
    fn build(storage: &Storage, actor: &PublicUser) -> Self {
        let students: Vec<Person> = storage
            .people()
            .unwrap_or_default()
            .into_iter()
            .filter(|person| person.is_student() && person.active)
            .collect();

        if actor.role.can_manage_info() {
            let mut classes: Vec<String> = Vec::new();
            for person in &students {
                let name = person.class_name.trim();
                if name.is_empty() || classes.iter().any(|kept| same_class(kept, name)) {
                    continue;
                }
                classes.push(name.to_string());
            }
            classes.sort();

            return InfoScope {
                classes,
                student_ids: students.iter().map(|person| person.id.clone()).collect(),
                everyone: true,
            };
        }

        let person_id = actor.person_id.clone().unwrap_or_default();
        let classes = teacher_classes(storage, &person_id);
        let student_ids = students
            .iter()
            .filter(|person| {
                classes
                    .iter()
                    .any(|kept| same_class(kept, &person.class_name))
            })
            .map(|person| person.id.clone())
            .collect();

        InfoScope {
            classes,
            student_ids,
            everyone: false,
        }
    }

    /// Sant när postens mottagare ligger inom det kontot får nå.
    fn may_reach(&self, audience: Audience, class_names: &[String], student_ids: &[String]) -> bool {
        match audience {
            // Rollen avgör redan dessa; hit kommer bara den som får alla.
            Audience::Everyone | Audience::Students | Audience::Teachers => self.everyone,
            Audience::Classes => class_names
                .iter()
                .all(|name| self.classes.iter().any(|kept| same_class(kept, name))),
            Audience::Group => student_ids
                .iter()
                .all(|id| self.student_ids.iter().any(|known| known == id)),
        }
    }
}

/// Klassnamnen städade: trimmade, utan tomma rader och utan dubbletter.
fn normalized_class_names(names: &[String]) -> Vec<String> {
    let mut cleaned: Vec<String> = Vec::new();
    for name in names {
        let trimmed = name.trim();
        if trimmed.is_empty() || cleaned.iter().any(|kept| same_class(kept, trimmed)) {
            continue;
        }
        cleaned.push(trimmed.to_string());
    }
    cleaned
}

/// Person-id:na städade på samma sätt: trimmade, utan tomma rader och utan
/// dubbletter.
fn normalized_student_ids(ids: &[String]) -> Vec<String> {
    let mut cleaned: Vec<String> = Vec::new();
    for id in ids {
        let trimmed = id.trim();
        if trimmed.is_empty() || cleaned.iter().any(|kept| kept == trimmed) {
            continue;
        }
        cleaned.push(trimmed.to_string());
    }
    cleaned
}

/// Posterna en inloggad får läsa. Regeln ligger utanför kommandot så att den
/// går att köra i test utan att starta ett appfönster.
fn messages_for_user(state: &AppState, user: &PublicUser) -> Result<Vec<AdminMessage>, AppError> {
    let class_name = class_of(&state.storage, user);
    let person_id = user.person_id.clone().unwrap_or_default();

    Ok(state
        .storage
        .admin_messages()?
        .into_iter()
        .filter(|message| message.visible_to(user.role, &class_name, &person_id))
        .collect())
}

/// Alla poster, för den som får publicera. Läraren ser listan för att kunna
/// följa och rätta sina egna poster; eleven kommer aldrig hit.
#[tauri::command]
pub fn list_admin_messages(state: State<'_, AppState>) -> Result<Vec<AdminMessage>, AppError> {
    require_publisher(&state)?;
    state.storage.admin_messages()
}

/// Klasserna att välja mellan när information ska riktas till en klass.
///
/// Administratören ser hela skolans klasser, en lärare bara sina egna. Listan
/// är alltså samma regel som publiceringen kontrolleras mot.
#[tauri::command]
pub fn list_classes(state: State<'_, AppState>) -> Result<Vec<String>, AppError> {
    let actor = require_publisher(&state)?;
    Ok(InfoScope::build(&state.storage, &actor).classes)
}

/// En elev som information kan riktas till i en grupp.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InfoRecipient {
    pub id: String,
    pub name: String,
    pub class_name: String,
}

/// Eleverna att välja mellan när information ska riktas till en grupp.
///
/// En lärare ser bara eleverna i sina egna klasser. Id:na är person-id, så
/// mottagaren är eleven och inte kontot.
#[tauri::command]
pub fn list_info_recipients(state: State<'_, AppState>) -> Result<Vec<InfoRecipient>, AppError> {
    let actor = require_publisher(&state)?;
    let scope = InfoScope::build(&state.storage, &actor);

    let mut recipients: Vec<InfoRecipient> = state
        .storage
        .people()?
        .into_iter()
        .filter(|person| {
            person.is_student() && person.active && scope.student_ids.contains(&person.id)
        })
        .map(|person| InfoRecipient {
            name: person.full_name(),
            class_name: person.class_name.trim().to_string(),
            id: person.id,
        })
        .collect();

    recipients.sort_by(|a, b| {
        a.class_name
            .cmp(&b.class_name)
            .then(a.name.cmp(&b.name))
    });
    Ok(recipients)
}

/// Nyheterna och meddelandena som den inloggade får läsa.
///
/// Elev och lärare använder den här vägen i stället för adminlistan. Rollen
/// och klassen läses ur databasen vid varje anrop och avgör vad som skickas
/// tillbaka – gränssnittet kan inte välja bort filtret, och en gäst får
/// ingenting alls.
#[tauri::command]
pub fn my_admin_messages(state: State<'_, AppState>) -> Result<Vec<AdminMessage>, AppError> {
    let viewer = require_session(&state)?;
    messages_for_user(&state, &viewer)
}

#[tauri::command]
pub fn save_admin_message(
    state: State<'_, AppState>,
    message: AdminMessage,
) -> Result<AdminMessage, AppError> {
    let actor = require_publisher(&state)?;

    let mut message = message;
    let is_new = message.id.trim().is_empty();

    // Posten som ändras, om det är en ändring. Den avgör både vem som äger
    // posten och vem som står som publicerare.
    let previous = if is_new {
        None
    } else {
        state
            .storage
            .admin_messages()?
            .into_iter()
            .find(|item| item.id == message.id)
    };

    if let Some(previous) = &previous {
        if !may_edit(&actor, &previous.author_id) {
            return Err(AppError::NotAllowed);
        }
    }

    prepare(&mut message.id, &mut message.created_at_ms);

    message.title = require_text(&message.title, "Rubriken")?;
    message.body = require_text(&message.body, "Texten")?;
    message.kind = match message.kind.trim().to_lowercase().as_str() {
        "nyhet" | "" => "nyhet".to_string(),
        "meddelande" => "meddelande".to_string(),
        other => {
            return Err(AppError::Validation(format!(
                "Typen \"{other}\" finns inte."
            )))
        }
    };

    if !actor.role.can_address(message.audience) {
        return Err(AppError::NotAllowed);
    }

    message.class_names = normalized_class_names(&message.class_names);
    message.student_ids = normalized_student_ids(&message.student_ids);

    match message.audience {
        Audience::Classes => {
            if message.class_names.is_empty() {
                return Err(AppError::Validation(
                    "Välj minst en klass innan du publicerar.".to_string(),
                ));
            }
        }
        Audience::Group => {
            if message.student_ids.is_empty() {
                return Err(AppError::Validation(
                    "Välj minst en elev innan du publicerar.".to_string(),
                ));
            }
        }
        _ => {}
    }

    // Namnlistorna städas bort när de inte används, så en post aldrig bär
    // mottagare som inte hör till mottagartypen.
    if message.audience != Audience::Classes {
        message.class_names.clear();
    }
    if message.audience != Audience::Group {
        message.student_ids.clear();
    }

    // Läraren får bara nå sina egna klasser och elever. Kontrollen görs mot
    // skolans data, inte mot något gränssnittet skickade med.
    let scope = InfoScope::build(&state.storage, &actor);
    if !scope.may_reach(message.audience, &message.class_names, &message.student_ids) {
        return Err(AppError::NotAllowed);
    }

    // Publiceraren skrivs av backend ur sessionen, aldrig av gränssnittet. En
    // ändring behåller den som lade upp posten från början.
    match &previous {
        Some(previous) => {
            message.author_id = previous.author_id.clone();
            message.author_name = previous.author_name.clone();
        }
        None => {
            message.author_id = actor.id.clone();
            message.author_name = actor.display_name.clone();
        }
    }

    state.storage.save_admin_message(&message)?;
    log_action(
        &state,
        &actor,
        if is_new {
            "Information publicerad"
        } else {
            "Information ändrad"
        },
        message.title.clone(),
    );
    Ok(message)
}

#[tauri::command]
pub fn delete_admin_message(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    let actor = require_publisher(&state)?;

    let previous = state
        .storage
        .admin_messages()?
        .into_iter()
        .find(|item| item.id == id);

    if let Some(previous) = &previous {
        // En lärare tar bort sina egna poster; administratören allt.
        if !may_edit(&actor, &previous.author_id) {
            return Err(AppError::NotAllowed);
        }
    }

    state.storage.remove_admin_message(&id)?;
    log_action(
        &state,
        &actor,
        "Information borttagen",
        previous.map(|item| item.title).unwrap_or_default(),
    );
    Ok(())
}

/// Aktivitetsloggen. `limit` begränsar hur många rader som skickas.
#[tauri::command]
pub fn list_activity(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<ActivityEntry>, AppError> {
    require_admin(&state)?;

    let mut entries = state.storage.activity()?;
    if let Some(limit) = limit {
        entries.truncate(limit.min(500));
    }
    Ok(entries)
}

// ---------------------------------------------------------------------------
// AI-tjänsten
// ---------------------------------------------------------------------------

/// Tjänstens adress och markeringen som visar att anropet kommer från Lumi.
///
/// Normalt kommer båda från den byggda appen. Miljövariablerna `LUMI_AI_URL`
/// och `LUMI_AI_TOKEN` får bara användas under utveckling, mot en lokal tjänst.
///
/// Här finns ingen OpenRouter-nyckel: den ligger som en hemlighet hos tjänsten
/// och kan därför varken läsas ur appen eller ur en installationsfil.
pub fn gateway_config() -> (String, String, &'static str) {
    let url = std::env::var(config::GATEWAY_URL_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let token = std::env::var(config::GATEWAY_TOKEN_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    match (url, token) {
        (Some(url), Some(token)) => (url, token, "environment"),
        _ => (
            config::GATEWAY_URL.to_string(),
            config::GATEWAY_TOKEN.to_string(),
            "built-in",
        ),
    }
}

fn client(state: &AppState) -> OpenRouterClient {
    state.client.clone()
}

/// Klienten för en inloggad användare. Tjänsten räknar anrop per konto, så
/// varje anrop som kostar pengar skickar med vem som gör det.
fn client_for(state: &AppState, user_id: &str) -> OpenRouterClient {
    client(state).for_account(user_id)
}

/// Modellen som ska användas: kontots eget val i Profil om det finns, annars
/// installationens standard, annars rollens standardmodell.
///
/// Valet läses per konto-id från backend – gränssnittet kan inte peka ut ett
/// annat kontos modell.
fn resolve_model(
    state: &AppState,
    user_id: &str,
    requested: Option<String>,
    role: ModelRole,
) -> Result<String, AppError> {
    if let Some(model) = requested
        .map(|model| model.trim().to_string())
        .filter(|model| !model.is_empty())
    {
        return Ok(model);
    }

    if let Some(model) = state.storage.model_for_user(user_id)? {
        return Ok(model);
    }

    if let Some(model) = state
        .storage
        .settings()?
        .model
        .map(|model| model.trim().to_string())
        .filter(|model| !model.is_empty())
    {
        return Ok(model);
    }

    Ok(role.model().to_string())
}

/// Vilken modell varje roll använder just nu. Gränssnittet visar den utan att
/// behöva känna till några modellnamn själv.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRoles {
    pub main: String,
    pub study: String,
    pub economy: String,
    pub backup: String,
}

fn role_models() -> ModelRoles {
    ModelRoles {
        main: ModelRole::Main.model().to_string(),
        study: ModelRole::Study.model().to_string(),
        economy: ModelRole::Economy.model().to_string(),
        backup: ModelRole::Backup.model().to_string(),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    /// Sant när appen har en AI-tjänst att anropa.
    pub configured: bool,
    /// "environment" (under utveckling) eller "built-in".
    pub source: String,
    pub model: String,
    pub default_model: String,
    pub base_url: String,
    pub suggested_models: Vec<String>,
    pub roles: ModelRoles,
}

fn status_for(state: &AppState, user_id: &str) -> Result<AiStatus, AppError> {
    let (url, token, source) = gateway_config();
    let client = OpenRouterClient::new(&url, &token)?;

    Ok(AiStatus {
        configured: client.is_configured(),
        source: source.to_string(),
        model: resolve_model(state, user_id, None, ModelRole::Main)?,
        default_model: config::DEFAULT_MODEL.to_string(),
        // Adressen visas i Profil. Den är ingen hemlighet: nyckeln ligger hos
        // tjänsten, inte i adressen.
        base_url: url,
        suggested_models: config::SUGGESTED_MODELS
            .iter()
            .map(|model| model.to_string())
            .collect(),
        roles: role_models(),
    })
}

#[tauri::command]
pub fn ai_status(state: State<'_, AppState>) -> Result<AiStatus, AppError> {
    // AI-anslutningen är till för en inloggad elev. Är ingen inloggad finns
    // ingen anledning att berätta något om den.
    let user = require_session(&state)?;
    status_for(&state, &user.id)
}

/// Hämtar tjänstens läge: om betalmodellerna kan användas och vilka modeller
/// som tar över när de inte kan. Kostnadsfritt anrop, till skillnad från en
/// fråga till AI:n.
#[tauri::command]
pub async fn check_api_key(state: State<'_, AppState>) -> Result<ServiceStatus, AppError> {
    let user = require_session(&state)?;
    client_for(&state, &user.id).service_status().await
}

#[tauri::command]
pub async fn list_models(
    state: State<'_, AppState>,
    query: Option<String>,
) -> Result<Vec<ModelInfo>, AppError> {
    require_session(&state)?;

    let cached = state.models.lock().await.clone();
    let models = match cached {
        Some(models) => models,
        None => {
            let models = client(&state).list_models().await?;
            *state.models.lock().await = Some(models.clone());
            models
        }
    };

    let Some(query) = query
        .map(|query| query.trim().to_lowercase())
        .filter(|query| !query.is_empty())
    else {
        return Ok(models);
    };

    Ok(models
        .into_iter()
        .filter(|model| {
            model.id.to_lowercase().contains(&query) || model.name.to_lowercase().contains(&query)
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Lärare-Chat
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ChatEvent {
    Delta { text: String },
    Done { usage: ChatUsage },
}

#[tauri::command]
pub async fn chat_stream(
    state: State<'_, AppState>,
    messages: Vec<ChatMessage>,
    model: Option<String>,
    material_id: Option<String>,
    role: Option<ModelRole>,
    on_event: Channel<ChatEvent>,
) -> Result<ChatUsage, AppError> {
    if messages.is_empty() {
        return Err(AppError::Validation("Frågan är tom.".to_string()));
    }

    // AI:n kostar pengar. Bara en inloggad elev får använda den.
    let user = require_session(&state)?;

    let client = client_for(&state, &user.id);
    let model = resolve_model(&state, &user.id, model, role.unwrap_or(ModelRole::Main))?;
    // Underlaget måste tillhöra den inloggade eleven.
    let source = source_from_material(&state, &user.id, material_id.as_deref())?;
    let payload = chat::build_messages(&messages, source.as_deref());

    let usage = match client
        .stream_chat(&payload, &model, config::MAX_TOKENS_CHAT, |text| {
            let _ = on_event.send(ChatEvent::Delta {
                text: text.to_string(),
            });
        })
        .await
    {
        Ok(usage) => usage,
        // Reservmodellen tar bara över när modellen inte kan användas alls.
        // Vid nätverksfel, kreditbrist eller ogiltig nyckel vore ett byte till
        // en annan modell bara ett dyrare sätt att misslyckas.
        Err(error) if error.is_model_problem() => {
            client
                .stream_chat(&payload, config::BACKUP_MODEL, config::MAX_TOKENS_CHAT, |text| {
                    let _ = on_event.send(ChatEvent::Delta {
                        text: text.to_string(),
                    });
                })
                .await?
        }
        Err(error) => return Err(error),
    };

    let _ = on_event.send(ChatEvent::Done {
        usage: usage.clone(),
    });

    Ok(usage)
}

fn source_from_material(
    state: &AppState,
    owner_id: &str,
    material_id: Option<&str>,
) -> Result<Option<String>, AppError> {
    let Some(id) = material_id.map(str::trim).filter(|id| !id.is_empty()) else {
        return Ok(None);
    };

    state
        .storage
        .material_for_owner(owner_id, id)?
        .map(|material| materials::flatten(&material))
        .map(Some)
        .ok_or_else(|| AppError::Validation("Underlaget hittades inte.".to_string()))
}

/// Gör om en konversation till ett underlag, så att eleven kan be om övningar
/// utifrån det som redan sagts. Anropas från gränssnittet.
#[tauri::command]
pub fn conversation_context(messages: Vec<ChatMessage>) -> String {
    chat::transcript(&messages)
}

// ---------------------------------------------------------------------------
// Studiematerial
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn generate_material(
    state: State<'_, AppState>,
    request: GenerateRequest,
    model: Option<String>,
    role: Option<ModelRole>,
) -> Result<StudyMaterial, AppError> {
    // Skapandet av material kostar pengar på samma sätt som chatten.
    let user = require_session(&state)?;

    if !materials::is_known_kind(&request.kind) {
        return Err(AppError::Validation(format!(
            "Materialtypen \"{}\" finns inte i Lumi.",
            request.kind
        )));
    }
    if request.subject.trim().is_empty() {
        return Err(AppError::Validation("Välj ett ämne först.".to_string()));
    }
    if request.topic.trim().is_empty() {
        return Err(AppError::Validation("Skriv vad materialet ska handla om.".to_string()));
    }

    let client = client_for(&state, &user.id);
    let model = resolve_model(&state, &user.id, model, role.unwrap_or(ModelRole::Study))?;

    let source = match request.material_id.as_deref() {
        Some(id) => source_from_material(&state, &user.id, Some(id))?,
        None => request
            .context
            .as_deref()
            .map(str::trim)
            .filter(|context| !context.is_empty())
            .map(str::to_string),
    };

    let messages = materials::build_messages(&request, source.as_deref());
    let (raw, usage) = match client
        .chat_json(
            &messages,
            &model,
            materials::schema_name(&request.kind),
            materials::json_schema(&request.kind),
        )
        .await
    {
        Ok(result) => result,
        Err(error) if error.is_model_problem() => {
            client
                .chat_json(
                    &messages,
                    config::BACKUP_MODEL,
                    materials::schema_name(&request.kind),
                    materials::json_schema(&request.kind),
                )
                .await?
        }
        Err(error) => return Err(error),
    };

    // Innehållet valideras innan det visas, så att förhandsgranskningen alltid
    // är något som faktiskt går att spara.
    let content = materials::validate(&request.kind, &raw)?;

    Ok(StudyMaterial {
        id: Uuid::new_v4().to_string(),
        // Ägaren sätts av backend, aldrig av gränssnittet.
        owner_id: user.id.clone(),
        kind: request.kind.clone(),
        subject: request.subject.trim().to_string(),
        title: materials::default_title(&request.kind, &request.topic),
        created_at_ms: now_ms(),
        model: usage.model,
        content,
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMaterialRequest {
    pub kind: String,
    pub subject: String,
    #[serde(default)]
    pub title: String,
    pub content: Value,
    #[serde(default)]
    pub model: Option<String>,
}

// ── Material, resultat och modellval per konto ────────────────────────────
//
// Allt som hör till en elevs studier ägs av elevens konto. Ägaren kommer alltid
// från sessionen i backend – gränssnittet skickar aldrig in ett konto-id, och
// de här funktionerna ligger utanför Tauri-kommandona så att reglerna går att
// köra i test.

/// Materialet som hör till ett konto, nyast först.
fn materials_of(
    state: &AppState,
    owner_id: &str,
    subject: Option<&str>,
) -> Result<Vec<StudyMaterial>, AppError> {
    match subject.map(str::trim).filter(|subject| !subject.is_empty()) {
        Some(subject) => state
            .storage
            .materials_for_owner_and_subject(owner_id, subject),
        None => state.storage.materials_for_owner(owner_id),
    }
}

/// Sparar ett nytt material åt ett konto, efter en ny validering.
fn store_material(
    state: &AppState,
    owner_id: &str,
    request: SaveMaterialRequest,
) -> Result<StudyMaterial, AppError> {
    if owner_id.trim().is_empty() {
        return Err(AppError::NotSignedIn);
    }

    let content = materials::validate(&request.kind, &request.content)?;

    let subject = request.subject.trim();
    if subject.is_empty() {
        return Err(AppError::Validation("Ämnet saknas.".to_string()));
    }

    let title = request.title.trim();
    let saved = StudyMaterial {
        id: Uuid::new_v4().to_string(),
        // Ägaren sätts här, aldrig från anropet.
        owner_id: owner_id.to_string(),
        kind: request.kind.clone(),
        subject: subject.to_string(),
        title: if title.is_empty() {
            materials::kind_label(&request.kind).to_string()
        } else {
            title.to_string()
        },
        created_at_ms: now_ms(),
        model: request
            .model
            .unwrap_or_else(|| config::DEFAULT_MODEL.to_string()),
        content,
    };

    state.storage.add_material(&saved)?;
    Ok(saved)
}

/// Ett enskilt material, men bara om det tillhör kontot. Ett annat kontos
/// material ger samma svar som ett som inte finns.
fn material_of(
    state: &AppState,
    owner_id: &str,
    id: &str,
) -> Result<Option<StudyMaterial>, AppError> {
    state.storage.material_for_owner(owner_id, id)
}

fn delete_material_of(state: &AppState, owner_id: &str, id: &str) -> Result<bool, AppError> {
    state.storage.remove_material_for_owner(owner_id, id)
}

/// Registrerar ett resultat. Materialet måste tillhöra samma konto.
fn store_attempt(
    state: &AppState,
    owner_id: &str,
    material_id: &str,
    correct: u32,
    total: u32,
) -> Result<Attempt, AppError> {
    if total == 0 {
        return Err(AppError::Validation(
            "Provet hade inga frågor.".to_string(),
        ));
    }

    let material = state
        .storage
        .material_for_owner(owner_id, material_id)?
        .ok_or_else(|| AppError::Validation("Materialet hittades inte.".to_string()))?;

    let attempt = Attempt {
        id: Uuid::new_v4().to_string(),
        owner_id: owner_id.to_string(),
        material_id: material_id.to_string(),
        subject: material.subject.clone(),
        kind: material.kind.clone(),
        correct: correct.min(total),
        total,
        completed_at_ms: now_ms(),
    };

    state.storage.add_attempt(&attempt)?;
    Ok(attempt)
}

/// Resultaten en anropare får se.
///
/// Utan konto-id: sina egna. Med ett annat konto-id: bara en administratör,
/// och bara för ett konto som finns. Behörigheten kommer från rollen i
/// backend – id:t i anropet väljer bara vem resultaten gäller, aldrig vad man
/// får göra.
fn attempts_for(
    state: &AppState,
    caller: &PublicUser,
    account_id: Option<&str>,
) -> Result<Vec<Attempt>, AppError> {
    let target = account_id.map(str::trim).filter(|id| !id.is_empty());

    match target {
        Some(id) if id != caller.id => {
            if !caller.role.is_admin() {
                return Err(AppError::NotAdmin);
            }
            if state.storage.user_by_id(id)?.is_none() {
                return Ok(Vec::new());
            }
            state.storage.attempts_for_owner(id)
        }
        _ => state.storage.attempts_for_owner(&caller.id),
    }
}

/// Det ett konto ser av sina egna inställningar. Andra kontons modellval
/// lämnar aldrig backend.
fn settings_for(state: &AppState, owner_id: &str) -> Result<Settings, AppError> {
    Ok(Settings {
        model: state.storage.model_for_user(owner_id)?,
        models_by_user: Default::default(),
    })
}

/// Sätter kontots eget modellval, utan att röra någon annans.
fn set_model_for(
    state: &AppState,
    owner_id: &str,
    model: Option<String>,
) -> Result<Settings, AppError> {
    state.storage.set_model_for_user(owner_id, model)?;
    settings_for(state, owner_id)
}

/// Sparar materialet efter en ny validering. Gränssnittet kan alltså inte
/// kringgå kontrollen genom att skicka in något ogiltigt.
#[tauri::command]
pub fn save_material(
    state: State<'_, AppState>,
    material: SaveMaterialRequest,
) -> Result<StudyMaterial, AppError> {
    let user = require_session(&state)?;
    store_material(&state, &user.id, material)
}

#[tauri::command]
pub fn list_materials(
    state: State<'_, AppState>,
    subject: Option<String>,
) -> Result<Vec<StudyMaterial>, AppError> {
    let user = require_session(&state)?;
    materials_of(&state, &user.id, subject.as_deref())
}

#[tauri::command]
pub fn get_subject_materials(
    state: State<'_, AppState>,
    subject: String,
) -> Result<Vec<StudyMaterial>, AppError> {
    let user = require_session(&state)?;
    materials_of(&state, &user.id, Some(&subject))
}

#[tauri::command]
pub fn get_material(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<StudyMaterial>, AppError> {
    let user = require_session(&state)?;
    material_of(&state, &user.id, &id)
}

#[tauri::command]
pub fn delete_material(state: State<'_, AppState>, id: String) -> Result<bool, AppError> {
    let user = require_session(&state)?;
    delete_material_of(&state, &user.id, &id)
}

// ---------------------------------------------------------------------------
// Resultat och inställningar
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn save_attempt(
    state: State<'_, AppState>,
    material_id: String,
    correct: u32,
    total: u32,
) -> Result<Attempt, AppError> {
    let user = require_session(&state)?;
    store_attempt(&state, &user.id, &material_id, correct, total)
}

/// Egna resultat. En administratör kan också fråga efter en elevs resultat.
#[tauri::command]
pub fn list_attempts(
    state: State<'_, AppState>,
    account_id: Option<String>,
) -> Result<Vec<Attempt>, AppError> {
    let user = require_session(&state)?;
    attempts_for(&state, &user, account_id.as_deref())
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<Settings, AppError> {
    let user = require_session(&state)?;
    settings_for(&state, &user.id)
}

#[tauri::command]
pub fn update_settings(
    state: State<'_, AppState>,
    model: Option<String>,
) -> Result<Settings, AppError> {
    let user = require_session(&state)?;
    set_model_for(&state, &user.id, model)
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

/// Mappen där elevens material sparas. Skapas av `Storage::new`.
pub fn storage_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("data"))
        .map_err(|err| AppError::Storage(err.to_string()))
}

/// Mappen där en sparad session kan ligga. Samma mapp som `data`, men filen
/// ligger bredvid den så att den är lätt att hitta och att ta bort.
pub fn session_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|err| AppError::Storage(err.to_string()))
}#[cfg(test)]
mod tests {
    use super::{gateway_config, role_models};
    use crate::config;

    /// Sätter en miljövariabel under ett test och ställer tillbaka det exakta
    /// värdet efteråt.
    struct WithEnv {
        name: &'static str,
        previous: Option<String>,
    }

    impl WithEnv {
        fn set(name: &'static str, value: &str) -> Self {
            let previous = std::env::var(name).ok();
            // I Rust 2024 är ändring av processens miljö osäker eftersom andra
            // trådar kan läsa den samtidigt.
            unsafe { std::env::set_var(name, value) };
            Self { name, previous }
        }
    }

    impl Drop for WithEnv {
        fn drop(&mut self) {
            match self.previous.take() {
                Some(value) => unsafe { std::env::set_var(self.name, value) },
                None => unsafe { std::env::remove_var(self.name) },
            }
        }
    }

    /// Miljön rensas för de två variablerna, så att testerna inte påverkas av
    /// vad som råkar vara satt på datorn.
    fn without_environment<F: FnOnce()>(run: F) {
        let url = std::env::var(config::GATEWAY_URL_ENV).ok();
        let token = std::env::var(config::GATEWAY_TOKEN_ENV).ok();
        unsafe {
            std::env::remove_var(config::GATEWAY_URL_ENV);
            std::env::remove_var(config::GATEWAY_TOKEN_ENV);
        }

        run();

        unsafe {
            match url {
                Some(value) => std::env::set_var(config::GATEWAY_URL_ENV, value),
                None => std::env::remove_var(config::GATEWAY_URL_ENV),
            }
            match token {
                Some(value) => std::env::set_var(config::GATEWAY_TOKEN_ENV, value),
                None => std::env::remove_var(config::GATEWAY_TOKEN_ENV),
            }
        }
    }

    #[test]
    fn the_built_in_service_is_used_when_nothing_is_set() {
        without_environment(|| {
            let (url, token, source) = gateway_config();

            assert_eq!(url, config::GATEWAY_URL);
            assert_eq!(token, config::GATEWAY_TOKEN);
            assert_eq!(source, "built-in");
        });
    }

    #[test]
    fn the_environment_can_point_at_a_local_service() {
        without_environment(|| {
            let _url = WithEnv::set(config::GATEWAY_URL_ENV, "  http://127.0.0.1:8787  ");
            let _token = WithEnv::set(config::GATEWAY_TOKEN_ENV, "  lokal-markering  ");

            let (url, token, source) = gateway_config();
            assert_eq!(url, "http://127.0.0.1:8787");
            assert_eq!(token, "lokal-markering");
            assert_eq!(source, "environment");
        });
    }

    #[test]
    fn half_an_environment_falls_back_to_the_built_in_service() {
        // Bara en av de två satta: då används den inbyggda tjänsten, så att en
        // kvarglömd variabel inte pekar appen mot en halv konfiguration.
        without_environment(|| {
            let _url = WithEnv::set(config::GATEWAY_URL_ENV, "http://127.0.0.1:8787");

            let (url, _, source) = gateway_config();
            assert_eq!(source, "built-in");
            assert_eq!(url, config::GATEWAY_URL);
        });
    }

    #[test]
    fn the_app_holds_no_openrouter_credential() {
        // Nyckeln finns bara hos AI-tjänsten. Appen får inte ens ha en adress
        // eller en markering som liknar en nyckel.
        assert!(!config::GATEWAY_URL.contains("openrouter"));
        assert!(!looks_like_a_key(config::GATEWAY_TOKEN));
        assert!(!config::GATEWAY_TOKEN.is_empty());
    }

    /// Sant när texten innehåller något som ser ut som en riktig
    /// OpenRouter-nyckel: prefixet följt av minst 30 tecken.
    ///
    /// Korta förekomster av prefixet räknas inte – de är kontroller som den
    /// här, inte nycklar.
    fn looks_like_a_key(text: &str) -> bool {
        const PREFIX: &str = "sk-or-v1-";

        text.match_indices(PREFIX).any(|(index, _)| {
            let rest = &text[index + PREFIX.len()..];
            rest.chars()
                .take(40)
                .filter(char::is_ascii_alphanumeric)
                .count()
                >= 30
        })
    }

    /// Letar igenom projektets källkod efter en OpenRouter-nyckel.
    ///
    /// En nyckel som ligger i en fil följer med i bygget, i installationsfilen
    /// och i repot. Testet läser därför igenom källfilerna på riktigt i stället
    /// för att bara lita på att ingen skriver in en.
    #[test]
    fn no_source_file_contains_an_openrouter_key() {
        fn scan(dir: &std::path::Path, found: &mut Vec<String>) {
            let Ok(entries) = std::fs::read_dir(dir) else {
                return;
            };

            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                // Dolda filer (som .env) och byggda filer räknas inte: .env är
                // spärrad i .gitignore och följer inte med i ett bygge.
                if name.starts_with('.') || name == "target" || name == "node_modules" {
                    continue;
                }

                let path = entry.path();
                if path.is_dir() {
                    scan(&path, found);
                    continue;
                }

                if let Ok(text) = std::fs::read_to_string(&path) {
                    if looks_like_a_key(&text) {
                        found.push(path.display().to_string());
                    }
                }
            }
        }

        let mut found = Vec::new();
        for dir in [
            std::path::Path::new("src"),
            std::path::Path::new("../src"),
            std::path::Path::new("../ai-proxy/src"),
            std::path::Path::new("../ai-proxy/test"),
        ] {
            scan(dir, &mut found);
        }

        assert!(
            found.is_empty(),
            "en nyckel ligger i källkoden: {found:?}"
        );
    }

    #[test]
    fn the_status_sent_to_the_interface_has_the_fields_the_interface_reads() {
        // Gränssnittet läser `roles.main/study/economy/backup`, `defaultModel`
        // och `suggestedModels`. Ett felstavat fält skulle ge en tyst tom lista
        // i Profil i stället för ett fel, så namnformen låses här.
        let status = super::AiStatus {
            configured: true,
            source: "built-in".to_string(),
            model: config::MAIN_MODEL.to_string(),
            default_model: config::DEFAULT_MODEL.to_string(),
            base_url: config::GATEWAY_URL.to_string(),
            suggested_models: config::SUGGESTED_MODELS
                .iter()
                .map(|model| model.to_string())
                .collect(),
            roles: super::role_models(),
        };

        let json = serde_json::to_value(&status).unwrap();

        assert_eq!(json["configured"], true);
        assert_eq!(json["source"], "built-in");
        assert_eq!(json["defaultModel"], config::MAIN_MODEL);
        assert_eq!(json["baseUrl"], config::GATEWAY_URL);
        assert!(json["suggestedModels"].as_array().unwrap().len() >= 2);

        for role in ["main", "study", "economy", "backup"] {
            assert!(
                json["roles"][role].as_str().is_some_and(|model| !model.is_empty()),
                "rollen {role} saknas i svaret"
            );
        }

        // Nyckeln får aldrig följa med i svaret till gränssnittet.
        assert!(!json.to_string().contains("sk-or-"));
    }

    #[test]
    fn every_role_points_at_a_model() {
        let roles = role_models();

        for model in [&roles.main, &roles.study, &roles.economy, &roles.backup] {
            assert!(!model.trim().is_empty());
            // Modellnamn hos OpenRouter har formen "leverantör/modell".
            assert!(model.contains('/'), "{model} ser inte ut som ett modell-id");
        }

        // Reservmodellen ska vara en annan modell än huvudmodellen, annars
        // fyller den ingen funktion när huvudmodellen inte svarar.
        assert_ne!(roles.backup, roles.main);
    }
}

/// Testerna av själva grinden: vem som får göra vad.
///
/// Det här är kärnan i kravet att en vanlig användare inte kan göra sig själv
/// till administratör. Rollen läses alltid ur den inloggade sessionen, som i
/// sin tur kommer från databasen.
/// Testerna för "Håll mig inloggad". De gör samma sak som kommandona
/// `auth_login` med `remember`, `auth_restore_session` och `auth_logout`, fast
/// utan gränssnitt: samma lagring, samma skyddade fil och samma kontroller.
#[cfg(test)]
mod login_tests {
    use super::AppState;
    use crate::auth::{create_user, login, reset_password, set_active};
    use crate::openrouter::OpenRouterClient;
    use crate::session;
    use crate::storage::{Role, Storage};

    /// En AppState för en mapp. Precis som i appen ligger den sparade sessionen
    /// bredvid datamappen.
    fn state_in(dir: &std::path::Path) -> AppState {
        AppState {
            storage: Storage::new(dir).expect("kunde inte skapa lagringen"),
            client: OpenRouterClient::new(crate::config::GATEWAY_URL, crate::config::GATEWAY_TOKEN)
                .expect("kunde inte skapa klienten"),
            models: tokio::sync::Mutex::new(None),
            session: std::sync::Mutex::new(None),
            session_dir: dir.to_path_buf(),
            login_guard: crate::auth::LoginGuard::new(),
        }
    }

    fn temp_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("lumi-login-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("kunde inte skapa testmappen");
        dir
    }

    /// Inloggningen som `auth_login` gör den, inklusive valet att komma ihåg.
    fn sign_in(
        state: &AppState,
        email: &str,
        password: &str,
        remember: bool,
    ) -> Result<String, crate::error::AppError> {
        let user = login(&state.storage, email, password)?;
        let saved = if remember {
            session::remember(&state.storage, &state.session_dir, &user.id)
        } else {
            session::clear(&state.session_dir)
        };
        saved?;
        Ok(user.id)
    }

    #[test]
    fn a_remembered_login_comes_back_after_a_restart() {
        let dir = temp_dir();
        let state = state_in(&dir);
        let user = create_user(
            &state.storage,
            "elev@edu.ronneby.se",
            "Hemligt12345",
            "Elev",
            Role::Student,
        )
        .unwrap();

        let id = sign_in(&state, "elev@edu.ronneby.se", "Hemligt12345", true).unwrap();
        assert_eq!(id, user.id);

        // Ny AppState från samma mapp: appen har stängts och startats igen.
        let restarted = state_in(&dir);
        let restored = session::restore(&restarted.storage, &restarted.session_dir)
            .unwrap()
            .expect("den sparade sessionen borde gälla");
        assert_eq!(restored.id, user.id);
        assert_eq!(restored.role, Role::Student);
        assert!(restored.active);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn without_the_check_nothing_is_remembered() {
        let dir = temp_dir();
        let state = state_in(&dir);
        create_user(
            &state.storage,
            "elev@edu.ronneby.se",
            "Hemligt12345",
            "Elev",
            Role::Student,
        )
        .unwrap();

        sign_in(&state, "elev@edu.ronneby.se", "Hemligt12345", false).unwrap();

        let restarted = state_in(&dir);
        assert!(session::restore(&restarted.storage, &restarted.session_dir)
            .unwrap()
            .is_none());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn logging_out_ends_the_saved_session() {
        let dir = temp_dir();
        let state = state_in(&dir);
        create_user(
            &state.storage,
            "elev@edu.ronneby.se",
            "Hemligt12345",
            "Elev",
            Role::Student,
        )
        .unwrap();

        sign_in(&state, "elev@edu.ronneby.se", "Hemligt12345", true).unwrap();

        // Samma som `auth_logout`: sessionen i minnet och den sparade filen.
        session::clear(&state.session_dir).unwrap();

        let restarted = state_in(&dir);
        assert!(session::restore(&restarted.storage, &restarted.session_dir)
            .unwrap()
            .is_none());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn two_accounts_never_share_a_restored_session() {
        let dir = temp_dir();
        let state = state_in(&dir);
        let first = create_user(
            &state.storage,
            "elev@edu.ronneby.se",
            "Hemligt12345",
            "Elev",
            Role::Student,
        )
        .unwrap();
        let second = create_user(
            &state.storage,
            "larare@edu.ronneby.se",
            "Hemligt12345",
            "Lärare",
            Role::Teacher,
        )
        .unwrap();

        sign_in(&state, "elev@edu.ronneby.se", "Hemligt12345", true).unwrap();
        // Den som loggar in sist med krysset är den som kommer tillbaka.
        sign_in(&state, "larare@edu.ronneby.se", "Hemligt12345", true).unwrap();

        let restarted = state_in(&dir);
        let restored = session::restore(&restarted.storage, &restarted.session_dir)
            .unwrap()
            .expect("en session borde finnas");
        assert_eq!(restored.id, second.id);
        assert_ne!(restored.id, first.id);
        assert!(restored.role.is_teacher());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_inactive_or_reset_account_cannot_come_back() {
        let dir = temp_dir();
        let state = state_in(&dir);
        let user = create_user(
            &state.storage,
            "elev@edu.ronneby.se",
            "Hemligt12345",
            "Elev",
            Role::Student,
        )
        .unwrap();

        sign_in(&state, "elev@edu.ronneby.se", "Hemligt12345", true).unwrap();
        reset_password(&state.storage, &user.id, "Annat123456").unwrap();

        let restarted = state_in(&dir);
        assert!(session::restore(&restarted.storage, &restarted.session_dir)
            .unwrap()
            .is_none());

        // Och ett inaktiverat konto släpps inte in, även om filen finns kvar.
        sign_in(&restarted, "elev@edu.ronneby.se", "Annat123456", true).unwrap();
        set_active(&restarted.storage, &user.id, false).unwrap();

        let again = state_in(&dir);
        assert!(session::restore(&again.storage, &again.session_dir)
            .unwrap()
            .is_none());

        std::fs::remove_dir_all(&dir).ok();
    }
}

#[cfg(test)]
mod gate_tests {
    use super::{        account_after_person_change, attempts_for, class_of, delete_material_of,
        ensure_person_is_unique, material_of, materials_of, may_edit, messages_for_user,
        normalized_class_names, normalized_student_ids, person_after_profile_change, require_admin,
        require_publisher, require_session, resolve_model, schedule_for_user, session, set_model_for,
        settings_for, split_display_name, store_attempt, store_material, store_person,
        update_own_profile, validate_assignment, validate_exam, validate_schedule_slot, AppState,
        InfoScope, SaveMaterialRequest,
    };
    use crate::auth::{create_user, login, set_active, set_person, set_role, PublicUser};
    use crate::config::ModelRole;
    use crate::openrouter::OpenRouterClient;
    use crate::storage::{
        AdminMessage, Assignment, Audience, Exam, Person, Priority, Role, ScheduleEntry, Storage,
    };

    fn state() -> (AppState, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("lumi-gate-{}", uuid::Uuid::new_v4()));
        let state = AppState {
            storage: Storage::new(&dir).expect("kunde inte skapa testmappen"),
            client: OpenRouterClient::new(crate::config::GATEWAY_URL, crate::config::GATEWAY_TOKEN)
                .expect("kunde inte skapa klienten"),
            models: tokio::sync::Mutex::new(None),
            session: std::sync::Mutex::new(None),
            // I appen ligger den sparade sessionen bredvid datamappen.
            session_dir: dir.clone(),
            login_guard: crate::auth::LoginGuard::new(),
        };
        (state, dir)
    }

    /// Sparar en nyhet med en viss mottagare. Publicerad av kontot `konto-1`,
    /// vilket är samma id som `account` ger.
    fn news(state: &AppState, audience: Audience, title: &str) {
        news_from(state, "konto-1", audience, &[], Priority::Normal, title);
    }

    /// Sparar en post med vald mottagare, klass, vikt och avsändare.
    fn news_from(
        state: &AppState,
        author_id: &str,
        audience: Audience,
        class_names: &[&str],
        priority: Priority,
        title: &str,
    ) {
        state
            .storage
            .save_admin_message(&AdminMessage {
                id: uuid::Uuid::new_v4().to_string(),
                kind: "nyhet".to_string(),
                title: title.to_string(),
                body: "Text".to_string(),
                created_at_ms: 1,
                author_name: "Administratör".to_string(),
                author_id: author_id.to_string(),
                audience,
                class_names: class_names.iter().map(|name| name.to_string()).collect(),
                student_ids: Vec::new(),
                priority,
            })
            .expect("nyheten borde kunna sparas");
    }

    fn titles(messages: Vec<AdminMessage>) -> Vec<String> {
        let mut titles: Vec<String> = messages.into_iter().map(|message| message.title).collect();
        titles.sort();
        titles
    }

    // ── Nyheterna och behörigheten ────────────────────────────────────────

    #[test]
    fn each_role_sees_exactly_what_is_meant_for_it() {
        let (state, dir) = state();

        news(&state, Audience::Everyone, "Alla");
        news(&state, Audience::Students, "Eleverna");
        news(&state, Audience::Teachers, "Lärarna");

        assert_eq!(
            titles(messages_for_user(&state, &account(Role::Student)).unwrap()),
            vec!["Alla".to_string(), "Eleverna".to_string()]
        );
        assert_eq!(
            titles(messages_for_user(&state, &account(Role::Teacher)).unwrap()),
            vec!["Alla".to_string(), "Lärarna".to_string()]
        );
        // Administratören ser allt, och har dessutom den egna adminlistan.
        assert_eq!(
            titles(messages_for_user(&state, &account(Role::Admin)).unwrap()),
            vec!["Alla".to_string(), "Eleverna".to_string(), "Lärarna".to_string()]
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn without_a_session_nothing_is_read() {
        // Gränssnittet kan inte hoppa över rollkontrollen: utan inloggning
        // svarar backend med ett fel i stället för med skolans nyheter.
        let (state, dir) = state();
        news(&state, Audience::Everyone, "Alla");

        assert_eq!(
            require_session(&state).unwrap_err().kind(),
            "not-signed-in"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_old_news_item_without_audience_reaches_everyone() {
        // Poster som sparades innan mottagaren fanns saknar fältet. De ska
        // läsas som "alla" i stället för att bli osynliga.
        let old = serde_json::json!({
            "id": "gammal",
            "kind": "nyhet",
            "title": "Gammal nyhet",
            "body": "Text",
            "createdAtMs": 1,
            "authorName": "Administratör"
        });

        let message: AdminMessage = serde_json::from_value(old).expect("gammal post borde gå att läsa");
        assert_eq!(message.audience, Audience::Everyone);
        assert_eq!(message.priority, Priority::Normal);
        assert!(message.class_names.is_empty());
        assert!(message.visible_to(Role::Student, "9A", ""));
        assert!(message.visible_to(Role::Teacher, "", ""));
    }

    #[test]
    fn a_saved_news_item_carries_its_audience_back() {
        // Gränssnittet läser `audience` för att kunna visa vem posten gäller.
        let status = serde_json::to_value(AdminMessage {
            id: "1".to_string(),
            kind: "nyhet".to_string(),
            title: "Nyhet".to_string(),
            body: "Text".to_string(),
            created_at_ms: 1,
            author_name: "Administratör".to_string(),
            author_id: "konto-1".to_string(),
            audience: Audience::Students,
            class_names: vec!["9A".to_string()],
            student_ids: Vec::new(),
            priority: Priority::Urgent,
        })
        .unwrap();

        assert_eq!(status["audience"], "elever");
        assert_eq!(status["createdAtMs"], 1);
        assert_eq!(status["priority"], "akut");
        assert_eq!(status["classNames"][0], "9A");
        assert_eq!(status["authorId"], "konto-1");
    }

    // ── Information till en klass ─────────────────────────────────────────

    #[test]
    fn a_class_news_item_reaches_only_the_students_in_that_class() {
        let (state, dir) = state();

        news_from(&state, "konto-1", Audience::Classes, &["8A"], Priority::Normal, "Till 8A");
        news_from(&state, "konto-1", Audience::Students, &[], Priority::Normal, "Till alla elever");

        // Eleven i 9A ser det som gäller alla elever – men inte 8A:s post.
        let nine_a = PublicUser {
            id: "elev-9a".to_string(),
            person_id: Some(class_person(&state, "9A", "elever")),
            ..account(Role::Student)
        };
        assert_eq!(
            titles(messages_for_user(&state, &nine_a).unwrap()),
            vec!["Till alla elever".to_string()]
        );

        // Eleven i 8A ser båda.
        let eight_a = PublicUser {
            id: "elev-8a".to_string(),
            person_id: Some(class_person(&state, "8A", "elever")),
            ..account(Role::Student)
        };
        assert_eq!(
            titles(messages_for_user(&state, &eight_a).unwrap()),
            vec!["Till 8A".to_string(), "Till alla elever".to_string()]
        );

        // Läraren är inte elev: poster som gäller elever eller en klass når
        // inte lärarens informationsvy. Som publicerare ser läraren dem i
        // stället i publiceringslistan.
        assert!(messages_for_user(&state, &account(Role::Teacher))
            .unwrap()
            .is_empty());

        // Administratören ser allt, som förut.
        assert_eq!(
            titles(messages_for_user(&state, &account(Role::Admin)).unwrap()),
            vec!["Till 8A".to_string(), "Till alla elever".to_string()]
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_student_without_a_class_never_sees_a_class_news_item() {
        let (state, dir) = state();
        news_from(&state, "konto-1", Audience::Classes, &["8A"], Priority::Normal, "Till 8A");

        // Kontot saknar person, alltså finns ingen klass att matcha mot.
        assert!(messages_for_user(&state, &account(Role::Student))
            .unwrap()
            .is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_class_comes_from_the_person_register_and_not_from_the_interface() {
        let (state, dir) = state();
        let person_id = class_person(&state, "9A", "elever");
        let student = PublicUser {
            person_id: Some(person_id.clone()),
            ..account(Role::Student)
        };

        assert_eq!(class_of(&state.storage, &student), "9A");

        // Ett konto utan person har ingen klass, och ett påhittat person-id
        // ger ingen klass det heller.
        assert_eq!(class_of(&state.storage, &account(Role::Student)), "");
        let invented = PublicUser {
            person_id: Some("finns-inte".to_string()),
            ..account(Role::Student)
        };
        assert_eq!(class_of(&state.storage, &invented), "");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn student_ids_are_cleaned_and_deduplicated() {
        let cleaned = normalized_student_ids(&[
            " person-1 ".to_string(),
            "person-1".to_string(),
            "".to_string(),
            "person-2".to_string(),
        ]);
        assert_eq!(cleaned, vec!["person-1".to_string(), "person-2".to_string()]);
    }

    #[test]
    fn class_names_are_cleaned_and_deduplicated() {
        // "9a" och " 9A " är samma klass, och tomma rader faller bort.
        let cleaned = normalized_class_names(&[
            " 9A ".to_string(),
            "9a".to_string(),
            "".to_string(),
            "8B".to_string(),
        ]);
        assert_eq!(cleaned, vec!["9A".to_string(), "8B".to_string()]);
    }

    // ── Behörigheterna för information ────────────────────────────────────

    #[test]
    fn the_role_decides_who_may_publish() {
        // Administratör och lärare får publicera, eleven aldrig.
        assert!(Role::Admin.can_publish_info());
        assert!(Role::Teacher.can_publish_info());
        assert!(!Role::Student.can_publish_info());

        // Bara administratören får ändra och ta bort andras poster.
        assert!(Role::Admin.can_manage_info());
        assert!(!Role::Teacher.can_manage_info());
        assert!(!Role::Student.can_manage_info());
    }

    #[test]
    fn a_teacher_reaches_classes_and_groups_but_not_the_whole_school() {
        for audience in [Audience::Classes, Audience::Group] {
            assert!(Role::Teacher.can_address(audience));
            assert!(Role::Admin.can_address(audience));
            assert!(!Role::Student.can_address(audience));
        }

        // Hela skolan, alla elever och personalen är administratörens.
        for audience in [Audience::Everyone, Audience::Students, Audience::Teachers] {
            assert!(Role::Admin.can_address(audience));
            assert!(!Role::Teacher.can_address(audience));
            assert!(!Role::Student.can_address(audience));
        }
    }

    /// En lärare med en egen klass, kopplad via schemat.
    fn teacher_with_class(state: &AppState, class_name: &str) -> PublicUser {
        let person_id = class_person(state, class_name, "personal");
        state
            .storage
            .save_schedule_entry(&ScheduleEntry {
                id: uuid::Uuid::new_v4().to_string(),
                kind: "lektion".to_string(),
                title: "Matematik".to_string(),
                subject: "Matematik".to_string(),
                class_name: class_name.to_string(),
                weekday: 1,
                start: "08:30".to_string(),
                end: "09:30".to_string(),
                room: String::new(),
                teacher_id: person_id.clone(),
                created_at_ms: 1,
            })
            .expect("schemaposten borde kunna sparas");

        PublicUser {
            id: "konto-larare".to_string(),
            display_name: "Lärare Lind".to_string(),
            role: Role::Teacher,
            role_label: Role::Teacher.label().to_string(),
            person_id: Some(person_id),
            permissions: Role::Teacher
                .permissions()
                .iter()
                .map(|name| name.to_string())
                .collect(),
            ..account(Role::Teacher)
        }
    }

    #[test]
    fn a_teacher_only_reaches_its_own_classes() {
        let (state, dir) = state();
        class_person(&state, "8A", "elever");
        class_person(&state, "9A", "elever");
        let teacher = teacher_with_class(&state, "8A");
        let scope = InfoScope::build(&state.storage, &teacher);

        assert_eq!(scope.classes, vec!["8A".to_string()]);
        assert!(!scope.everyone);

        // Den egna klassen går bra, en annan klass nekas.
        assert!(scope.may_reach(Audience::Classes, &["8A".to_string()], &[]));
        assert!(!scope.may_reach(Audience::Classes, &["9A".to_string()], &[]));
        assert!(!scope.may_reach(
            Audience::Classes,
            &["8A".to_string(), "9A".to_string()],
            &[]
        ));

        // Hela skolan och alla elever är administratörens.
        assert!(!scope.may_reach(Audience::Everyone, &[], &[]));
        assert!(!scope.may_reach(Audience::Students, &[], &[]));

        // En lärare utan klass i schemat når ingen klass alls.
        let without = PublicUser {
            person_id: None,
            ..account(Role::Teacher)
        };
        let empty = InfoScope::build(&state.storage, &without);
        assert!(empty.classes.is_empty());
        assert!(!empty.may_reach(Audience::Classes, &["8A".to_string()], &[]));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_teacher_only_reaches_the_students_in_its_own_classes() {
        let (state, dir) = state();
        let in_class = class_person(&state, "8A", "elever");
        let other = class_person(&state, "9A", "elever");
        let teacher = teacher_with_class(&state, "8A");
        let scope = InfoScope::build(&state.storage, &teacher);

        assert!(scope.may_reach(Audience::Group, &[], &[in_class.clone()]));
        assert!(!scope.may_reach(Audience::Group, &[], &[other.clone()]));
        assert!(!scope.may_reach(
            Audience::Group,
            &[],
            &[in_class.clone(), other.clone()]
        ));

        // Administratören når alla elever i registret.
        let admin = InfoScope::build(&state.storage, &account(Role::Admin));
        assert!(admin.everyone);
        assert!(admin.may_reach(Audience::Group, &[], &[other.clone()]));
        assert!(admin.may_reach(Audience::Classes, &["9A".to_string()], &[]));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_group_news_item_reaches_only_the_named_students() {
        let (state, dir) = state();
        let linnea = class_person(&state, "9A", "elever");
        let linus = class_person(&state, "8A", "elever");

        state
            .storage
            .save_admin_message(&AdminMessage {
                id: uuid::Uuid::new_v4().to_string(),
                kind: "meddelande".to_string(),
                title: "Till Linnea".to_string(),
                body: "Text".to_string(),
                created_at_ms: 1,
                author_name: "Lärare Lind".to_string(),
                author_id: "konto-larare".to_string(),
                audience: Audience::Group,
                class_names: Vec::new(),
                student_ids: vec![linnea.clone()],
                priority: Priority::Normal,
            })
            .expect("posten borde kunna sparas");

        let addressed = PublicUser {
            person_id: Some(linnea.clone()),
            ..account(Role::Student)
        };
        let someone_else = PublicUser {
            person_id: Some(linus.clone()),
            ..account(Role::Student)
        };

        assert_eq!(
            titles(messages_for_user(&state, &addressed).unwrap()),
            vec!["Till Linnea".to_string()]
        );
        assert!(messages_for_user(&state, &someone_else)
            .unwrap()
            .is_empty());

        // Ett konto utan person får aldrig en gruppost.
        assert!(messages_for_user(&state, &account(Role::Student))
            .unwrap()
            .is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_teacher_only_edits_its_own_posts() {
        let teacher = PublicUser {
            id: "larare-1".to_string(),
            ..account(Role::Teacher)
        };
        let admin = account(Role::Admin);

        assert!(may_edit(&teacher, "larare-1"));
        assert!(!may_edit(&teacher, "larare-2"));
        // En äldre post utan avsändare går bara att ändra som administratör.
        assert!(!may_edit(&teacher, ""));
        assert!(may_edit(&admin, "larare-1"));

        // Eleven kommer aldrig förbi behörighetskontrollen först.
        assert!(!Role::Student.can_publish_info());
    }

    #[test]
    fn a_signed_out_visitor_cannot_publish() {
        let (state, dir) = state();
        assert_eq!(
            require_publisher(&state).unwrap_err().kind(),
            "not-signed-in"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_student_cannot_publish_and_a_teacher_can() {
        let (state, dir) = state();

        // En inloggad elev nekas med "inte behörig" – inte ett tomt svar.
        sign_in(&state, "elev@edu.ronneby.se", Role::Student);
        assert_eq!(
            require_publisher(&state).unwrap_err().kind(),
            "not-allowed"
        );

        // En inloggad lärare släpps igenom.
        sign_in(&state, "larare@edu.ronneby.se", Role::Teacher);
        assert!(require_publisher(&state).is_ok());

        // En inaktiverad lärare tappar behörigheten direkt.
        let teacher = sign_in(&state, "larare2@edu.ronneby.se", Role::Teacher);
        set_active(&state.storage, &teacher.id, false).unwrap();
        assert_eq!(
            require_publisher(&state).unwrap_err().kind(),
            "account-inactive"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    /// En person i registret, för schematesterna.
    fn person(name: &str, class_name: &str) -> Person {
        Person {
            id: uuid::Uuid::new_v4().to_string(),
            kind: if class_name.is_empty() {
                "personal".to_string()
            } else {
                "elever".to_string()
            },
            first_name: name.to_string(),
            last_name: "Testsson".to_string(),
            class_name: class_name.to_string(),
            email: String::new(),
            subjects: Vec::new(),
            active: true,
            created_at_ms: 0,
        }
    }

    /// Rubrikerna en person ser, i bokstavsordning. Ordningen i schemat har
    /// lagringen redan hand om, här kontrolleras urvalet.
    fn titles_for(state: &AppState, user: &PublicUser) -> Vec<String> {
        let mut titles: Vec<String> = schedule_for_user(&state.storage, user)
            .unwrap()
            .into_iter()
            .map(|entry| entry.title)
            .collect();
        titles.sort();
        titles
    }

    /// En schemapost, för schematesterna.
    fn entry(title: &str, class_name: &str) -> ScheduleEntry {
        ScheduleEntry {
            id: uuid::Uuid::new_v4().to_string(),
            kind: "lektion".to_string(),
            title: title.to_string(),
            subject: String::new(),
            class_name: class_name.to_string(),
            weekday: 1,
            start: "08:30".to_string(),
            end: "09:30".to_string(),
            room: String::new(),
            teacher_id: String::new(),
            created_at_ms: 1,
        }
    }

    fn account(role: Role) -> PublicUser {
        PublicUser {
            id: "konto-1".to_string(),
            email: "elev@edu.ronneby.se".to_string(),
            display_name: role.label().to_string(),
            role,
            role_label: role.label().to_string(),
            active: true,
            person_id: None,
            permissions: role
                .permissions()
                .iter()
                .map(|name| name.to_string())
                .collect(),
        }
    }

    /// Registrerar en person i en klass och svarar med personens id.
    fn class_person(state: &AppState, class_name: &str, kind: &str) -> String {
        let person = Person {
            id: uuid::Uuid::new_v4().to_string(),
            kind: kind.to_string(),
            first_name: "Elev".to_string(),
            last_name: "Testsson".to_string(),
            class_name: class_name.to_string(),
            email: String::new(),
            subjects: Vec::new(),
            active: true,
            created_at_ms: 1,
        };

        state
            .storage
            .save_person(&person)
            .expect("personen borde kunna sparas");
        person.id
    }

    /// En uppgift, för uppgiftstesterna.
    fn assignment(title: &str, subject: &str, due: &str) -> Assignment {
        Assignment {
            id: String::new(),
            title: title.to_string(),
            subject: subject.to_string(),
            instructions: String::new(),
            due_date: due.to_string(),
            class_names: Vec::new(),
            student_ids: Vec::new(),
            published: false,
            created_at_ms: 0,
            created_by_name: String::new(),
        }
    }

    /// Ett prov, för provtesterna.
    fn exam(title: &str, subject: &str, date: &str) -> Exam {
        Exam {
            id: String::new(),
            title: title.to_string(),
            subject: subject.to_string(),
            date: date.to_string(),
            class_names: Vec::new(),
            student_ids: Vec::new(),
            description: String::new(),
            created_at_ms: 0,
        }
    }

    #[test]
    fn an_assignment_needs_a_title_subject_and_a_real_deadline() {
        // Ett utkast får sparas utan mottagare, och texten städas.
        let mut draft = assignment("  Kapitel 3  ", " Matematik ", "2026-05-14");
        validate_assignment(&mut draft).unwrap();
        assert_eq!(draft.title, "Kapitel 3");
        assert_eq!(draft.subject, "Matematik");

        // Saknade fält och ett datum som inte är ett datum avvisas.
        assert!(validate_assignment(&mut assignment("", "Matematik", "2026-05-14")).is_err());
        assert!(validate_assignment(&mut assignment("Kapitel 3", "  ", "2026-05-14")).is_err());
        let bad_date = validate_assignment(&mut assignment("Kapitel 3", "Matematik", "14 maj"));
        assert_eq!(bad_date.unwrap_err().kind(), "validation");

        // En publicerad uppgift måste gälla minst en klass eller elev.
        let mut published = assignment("Kapitel 3", "Matematik", "2026-05-14");
        published.published = true;
        assert!(validate_assignment(&mut published).is_err());
        published.class_names = vec!["9A".to_string()];
        validate_assignment(&mut published).unwrap();
    }

    #[test]
    fn an_exam_needs_a_title_subject_date_and_a_participant() {
        let mut complete = exam("Prov 1", "Matematik", "2026-05-14");
        complete.class_names = vec!["9A".to_string()];
        validate_exam(&mut complete).unwrap();

        // Ett prov utan deltagare hamnar hos ingen elev och avvisas.
        assert!(validate_exam(&mut exam("Prov 1", "Matematik", "2026-05-14")).is_err());
        assert!(validate_exam(&mut exam("", "Matematik", "2026-05-14")).is_err());
        let bad_date = validate_exam(&mut exam("Prov 1", "Matematik", "inte-ett-datum"));
        assert_eq!(bad_date.unwrap_err().kind(), "validation");
    }

    /// En giltig quizfråga, så att materialet går genom valideringen.
    fn quiz_request(subject: &str) -> SaveMaterialRequest {
        SaveMaterialRequest {
            kind: "quiz".to_string(),
            subject: subject.to_string(),
            title: String::new(),
            model: None,
            content: serde_json::json!({
                "questions": [{
                    "question": "Vilken gas andas vi in?",
                    "options": ["Syre", "Kväve", "Koldioxid"],
                    "correctIndex": 0,
                    "explanation": "Vi tar upp syre från luften."
                }]
            }),
        }
    }

    /// Skapar ett konto, loggar in det och sätter sessionen – som i appen.
    fn sign_in(state: &AppState, email: &str, role: Role) -> PublicUser {
        create_user(&state.storage, email, "Hemligt12345", role.label(), role).unwrap();
        let user = login(&state.storage, email, "Hemligt12345").unwrap();
        *session(state) = Some(user.clone());
        user
    }

    /// Ett konto med en egen personpost i registret, kopplade till varandra.
    fn linked_pair(
        state: &AppState,
        email: &str,
        person_name: &str,
        class_name: &str,
    ) -> (Person, PublicUser) {
        let mut person = person(person_name, class_name);
        person.email = email.to_string();
        state.storage.save_person(&person).unwrap();

        let display_name = person.full_name();
        let created = create_user(
            &state.storage,
            email,
            "Hemligt12345",
            &display_name,
            Role::Admin,
        )
        .unwrap();
        let linked = set_person(&state.storage, &created.id, Some(person.id.clone())).unwrap();
        (person, linked)
    }

    // ── Konto och personpost i takt ───────────────────────────────────────

    #[test]
    fn a_name_is_split_into_first_and_last_name() {
        assert_eq!(
            split_display_name("Anna Andersson", ""),
            ("Anna".to_string(), "Andersson".to_string())
        );
        // Flera förnamn stannar i förnamnet.
        assert_eq!(
            split_display_name("Anna Stina Andersson", "Gammal"),
            ("Anna Stina".to_string(), "Andersson".to_string())
        );
        // Ett enda ord ändrar bara förnamnet, så att efternamnet inte försvinner.
        assert_eq!(
            split_display_name("  Anna  ", "Andersson"),
            ("Anna".to_string(), "Andersson".to_string())
        );
    }

    #[test]
    fn the_profile_and_the_person_record_keep_the_same_name() {
        let (state, dir) = state();
        let (_, linked) = linked_pair(&state, "anna@edu.ronneby.se", "Anna", "9A");

        // Profilen ändras: personposten följer med, och kontaktadressen byts
        // eftersom den redan var kontots adress.
        let person = person_after_profile_change(
            &state,
            &linked,
            "Anna Andersson",
            "Anna.Andersson@edu.ronneby.se",
        )
        .unwrap()
        .expect("personposten skulle uppdateras");
        assert_eq!(person.first_name, "Anna");
        assert_eq!(person.last_name, "Andersson");
        assert_eq!(person.email, "anna.andersson@edu.ronneby.se");
        // Resten av personposten är orörd.
        assert_eq!(person.class_name, "9A");
        assert_eq!(person.kind, "elever");
        assert!(person.active);

        // Registret ändras: kontots visningsnamn följer med.
        state.storage.save_person(&person).unwrap();
        let account = account_after_person_change(&state, &person)
            .unwrap()
            .expect("kontot skulle uppdateras");
        assert_eq!(account.display_name, "Anna Andersson");
        assert_eq!(account.person_id.as_deref(), Some(person.id.as_str()));
        // Konto och personpost visar nu samma namn.
        assert_eq!(
            person.full_name(),
            account.display_name,
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_collision_in_the_registry_stops_the_change_before_anything_is_written() {
        let (state, dir) = state();

        // Anna Testsson finns redan i klass 9A.
        let (existing, _) = linked_pair(&state, "anna@edu.ronneby.se", "Anna", "9A");
        let (_, elsa) = linked_pair(&state, "elsa@edu.ronneby.se", "Elsa", "9A");

        // Elsa får inte byta namn till samma namn och klass som Anna.
        let refused = person_after_profile_change(
            &state,
            &elsa,
            "Anna Testsson",
            "elsa@edu.ronneby.se",
        );
        assert_eq!(refused.unwrap_err().kind(), "validation");

        // Registret är orört efter det nekade försöket.
        let untouched = state.storage.person(&existing.id).unwrap().unwrap();
        assert_eq!(untouched.first_name, "Anna");
        let still_elsa = state
            .storage
            .person(&elsa.person_id.clone().unwrap())
            .unwrap()
            .unwrap();
        assert_eq!(still_elsa.first_name, "Elsa");

        std::fs::remove_dir_all(&dir).ok();
    }

    // ── Eget studiematerial, egna resultat och eget modellval ──────────────

    #[test]
    fn each_account_sees_only_its_own_material() {
        let (state, dir) = state();
        let anna = sign_in(&state, "anna@edu.ronneby.se", Role::Student);
        let bo = sign_in(&state, "bo@edu.ronneby.se", Role::Student);

        // Tomt från början för båda.
        assert!(materials_of(&state, &anna.id, None).unwrap().is_empty());
        assert!(materials_of(&state, &bo.id, None).unwrap().is_empty());

        let hers = store_material(&state, &anna.id, quiz_request("Biologi")).unwrap();
        assert_eq!(hers.owner_id, anna.id);

        // Anna ser sitt eget material, Bo ser inget av det.
        let annas = materials_of(&state, &anna.id, None).unwrap();
        assert_eq!(annas.len(), 1);
        assert_eq!(annas[0].id, hers.id);
        assert!(materials_of(&state, &bo.id, None).unwrap().is_empty());
        assert!(materials_of(&state, &bo.id, Some("Biologi")).unwrap().is_empty());
        assert_eq!(materials_of(&state, &anna.id, Some("Biologi")).unwrap().len(), 1);

        // Bo kan varken läsa eller radera Annas material, inte ens med rätt id.
        assert!(material_of(&state, &bo.id, &hers.id).unwrap().is_none());
        assert!(material_of(&state, &anna.id, &hers.id).unwrap().is_some());
        assert!(!delete_material_of(&state, &bo.id, &hers.id).unwrap());
        assert_eq!(materials_of(&state, &anna.id, None).unwrap().len(), 1);

        // Bo har sitt eget, och sitt eget går att ta bort.
        let his = store_material(&state, &bo.id, quiz_request("Historia")).unwrap();
        assert!(delete_material_of(&state, &bo.id, &his.id).unwrap());
        assert_eq!(materials_of(&state, &anna.id, None).unwrap().len(), 1);

        // Ett tomt konto-id ger inget material alls.
        assert!(materials_of(&state, "", None).unwrap().is_empty());
        assert!(store_material(&state, "", quiz_request("Biologi")).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn results_belong_to_the_account_that_took_the_test() {
        let (state, dir) = state();
        let anna = sign_in(&state, "anna@edu.ronneby.se", Role::Student);
        let bo = sign_in(&state, "bo@edu.ronneby.se", Role::Student);

        let hers = store_material(&state, &anna.id, quiz_request("Biologi")).unwrap();

        let attempt = store_attempt(&state, &anna.id, &hers.id, 4, 5).unwrap();
        assert_eq!(attempt.owner_id, anna.id);
        assert_eq!(attempt.subject, "Biologi");

        assert_eq!(state.storage.attempts_for_owner(&anna.id).unwrap().len(), 1);
        assert!(state.storage.attempts_for_owner(&bo.id).unwrap().is_empty());

        // Bo kan inte registrera ett resultat på Annas material.
        assert!(store_attempt(&state, &bo.id, &hers.id, 5, 5).is_err());
        assert!(state.storage.attempts_for_owner(&bo.id).unwrap().is_empty());

        // Ett material som inte finns avvisas också.
        assert!(store_attempt(&state, &bo.id, "finns-inte", 1, 2).is_err());
        assert!(store_attempt(&state, &bo.id, &hers.id, 1, 0).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn only_an_admin_can_read_another_accounts_results() {
        let (state, dir) = state();
        let anna = sign_in(&state, "anna@edu.ronneby.se", Role::Student);
        let bo = sign_in(&state, "bo@edu.ronneby.se", Role::Student);

        let hers = store_material(&state, &anna.id, quiz_request("Biologi")).unwrap();
        store_attempt(&state, &anna.id, &hers.id, 3, 5).unwrap();

        // Anna ser sitt eget resultat, både utan och med sitt eget id.
        assert_eq!(attempts_for(&state, &anna, None).unwrap().len(), 1);
        assert_eq!(attempts_for(&state, &anna, Some(&anna.id)).unwrap().len(), 1);

        // Bo får inte läsa Annas resultat, inte ens med rätt konto-id.
        assert_eq!(
            attempts_for(&state, &bo, Some(&anna.id)).unwrap_err().kind(),
            "not-admin"
        );
        assert!(attempts_for(&state, &bo, None).unwrap().is_empty());

        // En administratör får läsa en elevs resultat – det är elevöversikten.
        let admin = sign_in(&state, "admin@edu.ronneby.se", Role::Admin);
        assert_eq!(attempts_for(&state, &admin, Some(&anna.id)).unwrap().len(), 1);
        assert!(attempts_for(&state, &admin, Some(&bo.id)).unwrap().is_empty());

        // Ett konto som inte finns ger inga resultat, och adminens egna går bra.
        assert!(attempts_for(&state, &admin, Some("finns-inte"))
            .unwrap()
            .is_empty());
        assert!(attempts_for(&state, &admin, None).unwrap().is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_model_choice_is_personal() {
        let (state, dir) = state();
        let anna = sign_in(&state, "anna@edu.ronneby.se", Role::Student);
        let bo = sign_in(&state, "bo@edu.ronneby.se", Role::Student);

        assert!(settings_for(&state, &anna.id).unwrap().model.is_none());

        set_model_for(&state, &anna.id, Some("google/gemini-3.1-flash-lite".to_string())).unwrap();
        assert_eq!(
            settings_for(&state, &anna.id).unwrap().model.as_deref(),
            Some("google/gemini-3.1-flash-lite")
        );
        // Bos inställningar påverkas inte, och inga andra kontons val skickas med.
        let bos = settings_for(&state, &bo.id).unwrap();
        assert!(bos.model.is_none());
        assert!(bos.models_by_user.is_empty());

        set_model_for(&state, &bo.id, Some("openai/gpt-5-mini".to_string())).unwrap();
        assert_eq!(
            settings_for(&state, &anna.id).unwrap().model.as_deref(),
            Some("google/gemini-3.1-flash-lite")
        );

        // Modellen AI:n faktiskt använder följer kontot.
        assert_eq!(
            resolve_model(&state, &anna.id, None, ModelRole::Main).unwrap(),
            "google/gemini-3.1-flash-lite"
        );
        assert_eq!(
            resolve_model(&state, &bo.id, None, ModelRole::Main).unwrap(),
            "openai/gpt-5-mini"
        );

        // Att välja standard igen tar bort det egna valet.
        set_model_for(&state, &anna.id, None).unwrap();
        assert!(settings_for(&state, &anna.id).unwrap().model.is_none());
        assert_eq!(
            settings_for(&state, &bo.id).unwrap().model.as_deref(),
            Some("openai/gpt-5-mini")
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_profile_change_is_saved_on_both_the_account_and_the_person_record() {
        let (state, dir) = state();
        let (person, linked) = linked_pair(&state, "anna@edu.ronneby.se", "Anna", "9A");

        let updated = update_own_profile(
            &state,
            &linked,
            "Anna Andersson",
            "anna.andersson@edu.ronneby.se",
        )
        .unwrap();

        // Kontot i lagringen har det nya namnet och den nya adressen.
        assert_eq!(updated.display_name, "Anna Andersson");
        assert_eq!(updated.email, "anna.andersson@edu.ronneby.se");
        assert_eq!(
            state.storage.user_by_id(&linked.id).unwrap().unwrap().email,
            "anna.andersson@edu.ronneby.se"
        );

        // Personposten i registret har följt med, och resten är orörd.
        let saved = state.storage.person(&person.id).unwrap().unwrap();
        assert_eq!(saved.full_name(), "Anna Andersson");
        assert_eq!(saved.email, "anna.andersson@edu.ronneby.se");
        assert_eq!(saved.class_name, "9A");

        // Sessionen visar samma namn som lagringen.
        assert_eq!(session(&state).clone().unwrap().display_name, "Anna Andersson");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_person_change_is_saved_on_the_linked_account() {
        let (state, dir) = state();
        let (person, linked) = linked_pair(&state, "anna@edu.ronneby.se", "Anna", "9A");

        let mut renamed = person.clone();
        renamed.last_name = "Andersson".to_string();
        let actor = account(Role::Admin);
        store_person(&state, &actor, renamed).unwrap();

        // Kontot i lagringen har bytt namn, och inloggningsadressen är orörd.
        let saved = state.storage.user_by_id(&linked.id).unwrap().unwrap();
        assert_eq!(saved.display_name, "Anna Andersson");
        assert_eq!(saved.email, "anna@edu.ronneby.se");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_own_contact_address_in_the_registry_is_left_alone() {
        let (state, dir) = state();
        let mut person = person("Anna", "9A");
        person.email = "kontakt@ronneby.se".to_string();
        state.storage.save_person(&person).unwrap();

        let created = create_user(
            &state.storage,
            "anna@edu.ronneby.se",
            "Hemligt12345",
            "Anna Testsson",
            Role::Admin,
        )
        .unwrap();
        let linked = set_person(&state.storage, &created.id, Some(person.id.clone())).unwrap();

        let updated = person_after_profile_change(
            &state,
            &linked,
            "Anna Andersson",
            "ny@edu.ronneby.se",
        )
        .unwrap()
        .unwrap();
        // Kontaktadressen i registret skrivs inte över av kontots adress.
        assert_eq!(updated.email, "kontakt@ronneby.se");
        assert_eq!(updated.last_name, "Andersson");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_account_without_a_person_record_needs_no_sync() {
        let (state, dir) = state();
        let loose = create_user(
            &state.storage,
            "utan.person@edu.ronneby.se",
            "Hemligt12345",
            "Utan Person",
            Role::Admin,
        )
        .unwrap();

        assert!(person_after_profile_change(&state, &loose, "Nytt Namn", "ny@edu.ronneby.se")
            .unwrap()
            .is_none());

        // En person utan konto påverkas inte heller.
        let alone = person("Ensam", "9A");
        state.storage.save_person(&alone).unwrap();
        assert!(account_after_person_change(&state, &alone).unwrap().is_none());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn nothing_is_allowed_before_signing_in() {
        let (state, dir) = state();

        // AI:n kostar pengar och får inte användas utan inloggning.
        assert_eq!(require_session(&state).unwrap_err().kind(), "not-signed-in");
        assert_eq!(require_admin(&state).unwrap_err().kind(), "not-signed-in");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_normal_account_never_counts_as_admin() {
        let (state, dir) = state();

        sign_in(&state, "elev@edu.ronneby.se", Role::Student);
        assert!(require_session(&state).is_ok());
        assert_eq!(require_admin(&state).unwrap_err().kind(), "not-admin");

        // En lärare kommer inte heller in i adminpanelen.
        sign_in(&state, "larare@edu.ronneby.se", Role::Teacher);
        assert!(require_session(&state).is_ok());
        assert_eq!(require_admin(&state).unwrap_err().kind(), "not-admin");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_deactivated_or_demoted_account_loses_access_at_once() {
        let (state, dir) = state();
        let admin = sign_in(&state, "admin@edu.ronneby.se", Role::Admin);
        assert!(require_admin(&state).is_ok());

        // Rollen läses ur databasen, inte ur sessionen i minnet. Att bli
        // nedgraderad stänger panelen direkt i stället för vid nästa start.
        set_role(&state.storage, &admin.id, Role::Teacher).unwrap();
        assert_eq!(require_admin(&state).unwrap_err().kind(), "not-admin");
        assert_eq!(require_session(&state).unwrap().role, Role::Teacher);

        // En inaktiverad kontoinnehavare tappar också åtkomsten direkt.
        set_active(&state.storage, &admin.id, false).unwrap();
        assert_eq!(
            require_session(&state).unwrap_err().kind(),
            "account-inactive"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_same_person_cannot_be_registered_twice() {
        let (state, dir) = state();
        let mut first = person("Elsa", "9A");
        first.email = "elsa@edu.ronneby.se".to_string();
        state.storage.save_person(&first).unwrap();

        // Samma namn och klass, annat id och annan bokstavsstorlek, avvisas.
        let second = person("elsa", "9A");
        assert_eq!(
            ensure_person_is_unique(&state.storage, &second).unwrap_err().kind(),
            "validation"
        );

        // Samma adress i en annan klass avvisas också.
        let mut third = person("Annat", "9B");
        third.email = "elsa@edu.ronneby.se".to_string();
        assert!(ensure_person_is_unique(&state.storage, &third).is_err());

        // En annan elev i en annan klass går bra.
        let fourth = person("Kalle", "9B");
        assert!(ensure_person_is_unique(&state.storage, &fourth).is_ok());

        // Två lärare utan klass får heta samma sak – de skiljs åt av adressen.
        let teacher = person("Anna", "");
        state.storage.save_person(&teacher).unwrap();
        let namesake = person("anna", "");
        assert!(ensure_person_is_unique(&state.storage, &namesake).is_ok());

        // En befintlig post får sparas om utan att krocka med sig själv.
        assert!(ensure_person_is_unique(&state.storage, &first).is_ok());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_schedule_slot_must_end_after_it_starts_and_not_overlap_its_class() {
        let (state, dir) = state();

        let mut first = entry("Matematik 9A", "9A");
        first.start = "08:30".to_string();
        first.end = "09:30".to_string();
        validate_schedule_slot(&state.storage, &first).unwrap();
        state.storage.save_schedule_entry(&first).unwrap();

        // Slut före start avvisas.
        let mut backwards = entry("Fysik 9A", "9A");
        backwards.start = "10:00".to_string();
        backwards.end = "09:00".to_string();
        assert!(validate_schedule_slot(&state.storage, &backwards).is_err());

        // Samma start och slut avvisas också.
        let mut zero = entry("Kemi 9A", "9A");
        zero.start = "11:00".to_string();
        zero.end = "11:00".to_string();
        assert!(validate_schedule_slot(&state.storage, &zero).is_err());

        // Överlapp i samma klass avvisas, medan en annan klass får samma tid.
        let mut overlapping = entry("Svenska 9A", "9A");
        overlapping.start = "09:00".to_string();
        overlapping.end = "10:00".to_string();
        assert!(validate_schedule_slot(&state.storage, &overlapping).is_err());

        let mut other_class = entry("Svenska 9B", "9B");
        other_class.start = "09:00".to_string();
        other_class.end = "10:00".to_string();
        assert!(validate_schedule_slot(&state.storage, &other_class).is_ok());

        // Tiden efter det första passet går bra, och en post får sparas om.
        let mut later = entry("Fysik 9A", "9A");
        later.start = "09:30".to_string();
        later.end = "10:30".to_string();
        assert!(validate_schedule_slot(&state.storage, &later).is_ok());
        assert!(validate_schedule_slot(&state.storage, &first).is_ok());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_student_sees_their_own_class_and_the_shared_entries_in_the_schedule() {
        let (state, dir) = state();

        // Två klasser och en lärare, med ett pass var i schemat.
        let student = person("Elev Ett", "9A");
        let other = person("Elev Två", "9B");
        let teacher = person("Lärare", "");
        state.storage.save_person(&student).unwrap();
        state.storage.save_person(&other).unwrap();
        state.storage.save_person(&teacher).unwrap();

        let mut lesson_a = entry("Matematik 9A", "9A");
        lesson_a.teacher_id = teacher.id.clone();
        let lesson_b = entry("Svenska 9B", "9B");
        let shared = entry("Skolmöte", "");
        state.storage.save_schedule_entry(&lesson_a).unwrap();
        state.storage.save_schedule_entry(&lesson_b).unwrap();
        state.storage.save_schedule_entry(&shared).unwrap();

        let mut student_account = account(Role::Student);
        student_account.person_id = Some(student.id.clone());

        let titles = titles_for(&state, &student_account);
        assert_eq!(titles, vec!["Matematik 9A".to_string(), "Skolmöte".to_string()]);

        // Läraren ser sina egna pass plus det gemensamma.
        let mut teacher_account = account(Role::Teacher);
        teacher_account.person_id = Some(teacher.id.clone());
        let teacher_titles = titles_for(&state, &teacher_account);
        assert_eq!(
            teacher_titles,
            vec!["Matematik 9A".to_string(), "Skolmöte".to_string()]
        );

        // Ett konto utan person får inget schema, och inget läcker från 9B.
        let orphan = account(Role::Student);
        assert!(schedule_for_user(&state.storage, &orphan).unwrap().is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_admin_account_gets_through() {
        let (state, dir) = state();
        sign_in(&state, "admin@edu.ronneby.se", Role::Admin);

        assert_eq!(require_admin(&state).unwrap().role, Role::Admin);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_role_in_the_session_comes_from_the_database_and_not_from_the_caller() {
        let (state, dir) = state();
        create_user(
            &state.storage,
            "elev@edu.ronneby.se",
            "Hemligt12345",
            "Elev",
            Role::Student,
        )
        .unwrap();

        // Precis som ett riktigt inlogg ger kontot från databasen.
        let signed_in = login(&state.storage, "elev@edu.ronneby.se", "Hemligt12345").unwrap();
        *session(&state) = Some(signed_in);

        assert_eq!(require_admin(&state).unwrap_err().kind(), "not-admin");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn signing_out_closes_the_session() {
        let (state, dir) = state();
        *session(&state) = Some(account(Role::Admin));
        *session(&state) = None;

        assert!(require_session(&state).is_err());
        assert!(require_admin(&state).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }
}
