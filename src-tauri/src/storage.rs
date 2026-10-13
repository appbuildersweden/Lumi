//! Beständig lagring av studiematerial, resultat och inställningar.
//!
//! Allt sparas som JSON-filer i appens datamapp, så att elevens material finns
//! kvar efter omstart. Modulen känner inte till Tauri, vilket gör den möjlig
//! att testa mot en tillfällig mapp.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::AppError;

pub const MATERIALS_FILE: &str = "studiematerial.json";
pub const ATTEMPTS_FILE: &str = "resultat.json";
/// Äldre material och resultat som saknade kontoägare. Bevaras, men visas
/// aldrig för någon elev eftersom ägaren inte går att fastställa.
pub const LEGACY_MATERIALS_FILE: &str = "studiematerial-aldre.json";
pub const LEGACY_ATTEMPTS_FILE: &str = "resultat-aldre.json";
pub const SETTINGS_FILE: &str = "installningar.json";
pub const USERS_FILE: &str = "anvandare.json";
pub const PEOPLE_FILE: &str = "personer.json";
pub const ASSIGNMENTS_FILE: &str = "uppgifter.json";
pub const SUBMISSIONS_FILE: &str = "inlamningar.json";
pub const EXAMS_FILE: &str = "prov.json";
pub const EXAM_RESULTS_FILE: &str = "provresultat.json";
pub const SCHEDULE_FILE: &str = "schema.json";
pub const MESSAGES_FILE: &str = "meddelanden.json";
pub const ACTIVITY_FILE: &str = "aktivitetslogg.json";

/// Hur många rader aktivitetsloggen behåller. Äldre rader faller bort.
pub const ACTIVITY_LIMIT: usize = 500;

/// Serde-standard: poster som saknar fältet i en äldre fil är aktiva.
fn default_true() -> bool {
    true
}

/// Alla poster som kan lagras i en lista har ett id.
pub trait HasId {
    fn id(&self) -> &str;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyMaterial {
    pub id: String,

    /// Kontot materialet tillhör. Tomt betyder att posten är äldre och att
    /// ägaren inte går att fastställa – då flyttas den undan av migreringen.
    #[serde(default)]
    pub owner_id: String,
    pub kind: String,
    pub subject: String,
    pub title: String,
    pub created_at_ms: u64,
    pub model: String,
    pub content: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attempt {
    pub id: String,
    /// Kontot resultatet tillhör. Samma regel som för materialet.
    #[serde(default)]
    pub owner_id: String,
    pub material_id: String,
    pub subject: String,
    pub kind: String,
    pub correct: u32,
    pub total: u32,
    pub completed_at_ms: u64,
}

/// Inställningar för modellval.
///
/// `model` är standarden för hela installationen och `models_by_user` är
/// elevernas egna val. En elevs val lämnar aldrig backend till någon annan.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// Standardmodellen. `None` betyder att modellen i koden används.
    #[serde(default)]
    pub model: Option<String>,
    /// Personliga modellval, ett per konto-id.
    #[serde(default)]
    pub models_by_user: BTreeMap<String, String>,
}

impl HasId for StudyMaterial {
    fn id(&self) -> &str {
        &self.id
    }
}

impl HasId for Attempt {
    fn id(&self) -> &str {
        &self.id
    }
}

/// Vad en migrering av ägarlös data gjorde.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LegacyMigration {
    pub materials: usize,
    pub attempts: usize,
    /// Filnamnen på de säkerhetskopior som skapades.
    pub backups: Vec<String>,
}

impl LegacyMigration {
    /// Sant när inget behövde flyttas.
    pub fn is_empty(&self) -> bool {
        self.materials == 0 && self.attempts == 0
    }
}

/// Rollen ett konto har: administratör, lärare eller elev.
///
/// Rollen lagras och skickas som text (`"admin"`, `"lärare"`, `"elev"`), så
/// att den är lätt att läsa i både databasen och gränssnittet. Äldre värden
/// (`user`, `teacher`, `student`) läses fortfarande in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Role {
    #[serde(rename = "admin")]
    Admin,
    #[serde(rename = "lärare", alias = "larare", alias = "teacher")]
    Teacher,
    #[serde(rename = "elev", alias = "user", alias = "student")]
    Student,
}

impl Role {
    /// Sant bara för administratören. Rollen kommer alltid från backend.
    pub fn is_admin(self) -> bool {
        matches!(self, Role::Admin)
    }

    pub fn is_teacher(self) -> bool {
        matches!(self, Role::Teacher)
    }

    /// Rollens namn i gränssnittet.
    pub fn label(self) -> &'static str {
        match self {
            Role::Admin => "Administratör",
            Role::Teacher => "Lärare",
            Role::Student => "Elev",
        }
    }

}

/// Ett konto i Lumis egen användardatabas.
///
/// `password_hash` är en Argon2id-hash med eget salt. Lösenordet i klartext
/// finns inte i den här posten, inte i databasfilen och inte i gränssnittet.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    /// Alltid normaliserad till små bokstäver.
    pub email: String,
    pub display_name: String,
    pub role: Role,
    pub password_hash: String,
    pub created_at_ms: u64,
    /// Ett inaktiverat konto kan inte logga in, men raderas inte.
    #[serde(default = "default_true")]
    pub active: bool,
    /// Id för personen kontot hör till, om det är kopplat.
    #[serde(default)]
    pub person_id: Option<String>,
}

impl HasId for User {
    fn id(&self) -> &str {
        &self.id
    }
}

/// En person i skolan: elev eller personal.
///
/// Personen är den människa administratören registrerar; kontot är det hon
/// loggar in med. De kopplas ihop med `person_id` på kontot.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub id: String,
    /// `elever` eller `personal`.
    pub kind: String,
    pub first_name: String,
    pub last_name: String,
    /// Klass, till exempel "9A". Tom för personal.
    #[serde(default)]
    pub class_name: String,
    #[serde(default)]
    pub email: String,
    /// Ämnen för personal.
    #[serde(default)]
    pub subjects: Vec<String>,
    #[serde(default = "default_true")]
    pub active: bool,
    pub created_at_ms: u64,
}

impl Person {
    pub fn full_name(&self) -> String {
        format!("{} {}", self.first_name.trim(), self.last_name.trim())
            .trim()
            .to_string()
    }

    pub fn is_student(&self) -> bool {
        self.kind == "elever"
    }
}

impl HasId for Person {
    fn id(&self) -> &str {
        &self.id
    }
}

/// En uppgift som delats ut till elever eller en hel klass.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Assignment {
    pub id: String,
    pub title: String,
    pub subject: String,
    #[serde(default)]
    pub instructions: String,
    /// Deadline som ISO-datum, `ÅÅÅÅ-MM-DD`.
    pub due_date: String,
    #[serde(default)]
    pub class_names: Vec<String>,
    #[serde(default)]
    pub student_ids: Vec<String>,
    #[serde(default)]
    pub published: bool,
    pub created_at_ms: u64,
    #[serde(default)]
    pub created_by_name: String,
}

impl HasId for Assignment {
    fn id(&self) -> &str {
        &self.id
    }
}

/// En inlämning av en uppgift. Inlämnad tid saknas om eleven inte har lämnat in.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Submission {
    pub id: String,
    pub assignment_id: String,
    pub student_id: String,
    #[serde(default)]
    pub submitted_at_ms: Option<u64>,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub grade: String,
    #[serde(default)]
    pub comment: String,
}

impl HasId for Submission {
    fn id(&self) -> &str {
        &self.id
    }
}

/// Ett planerat prov.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Exam {
    pub id: String,
    pub title: String,
    pub subject: String,
    /// Provdatum som ISO-datum, `ÅÅÅÅ-MM-DD`.
    pub date: String,
    #[serde(default)]
    pub class_names: Vec<String>,
    #[serde(default)]
    pub student_ids: Vec<String>,
    #[serde(default)]
    pub description: String,
    pub created_at_ms: u64,
}

impl HasId for Exam {
    fn id(&self) -> &str {
        &self.id
    }
}

/// Resultatet för en elev på ett prov.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExamResult {
    pub id: String,
    pub exam_id: String,
    pub student_id: String,
    #[serde(default)]
    pub score: Option<u32>,
    #[serde(default)]
    pub max_score: Option<u32>,
    #[serde(default)]
    pub grade: String,
    #[serde(default)]
    pub comment: String,
    pub recorded_at_ms: u64,
}

impl HasId for ExamResult {
    fn id(&self) -> &str {
        &self.id
    }
}

/// En rad i schemat. `weekday` är 1 = måndag till 7 = söndag.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleEntry {
    pub id: String,
    /// `lektion`, `prov` eller `aktivitet`.
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub subject: String,
    #[serde(default)]
    pub class_name: String,
    pub weekday: u8,
    /// Klockslag som "08:30".
    pub start: String,
    #[serde(default)]
    pub end: String,
    #[serde(default)]
    pub room: String,
    #[serde(default)]
    pub teacher_id: String,
    pub created_at_ms: u64,
}

impl HasId for ScheduleEntry {
    fn id(&self) -> &str {
        &self.id
    }
}

/// Vilka som får läsa en nyhet eller ett meddelande: alla, eleverna eller
/// lärarna. Äldre poster saknar fältet och gäller alla.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Audience {
    #[serde(rename = "alla", alias = "", alias = "all")]
    Everyone,
    #[serde(rename = "elever", alias = "elev", alias = "student")]
    Students,
    #[serde(rename = "lärare", alias = "larare", alias = "teacher")]
    Teachers,
}

impl Default for Audience {
    fn default() -> Self {
        Audience::Everyone
    }
}

impl Audience {
    /// Sant när en inloggad roll får läsa posten. Administratören ser allt.
    pub fn includes(self, role: Role) -> bool {
        if role.is_admin() {
            return true;
        }

        match self {
            Audience::Everyone => true,
            Audience::Students => role == Role::Student,
            Audience::Teachers => role.is_teacher(),
        }
    }
}

/// En nyhet eller ett viktigt meddelande som visas på adminens startsida.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminMessage {
    pub id: String,
    /// `nyhet` eller `meddelande`.
    pub kind: String,
    pub title: String,
    pub body: String,
    pub created_at_ms: u64,
    #[serde(default)]
    pub author_name: String,
    /// Vilka posten är riktad till. Saknas i äldre poster och betyder då alla.
    #[serde(default)]
    pub audience: Audience,
}

impl AdminMessage {
    /// Sant när den här rollen får läsa posten.
    pub fn visible_to(&self, role: Role) -> bool {
        self.audience.includes(role)
    }
}

impl HasId for AdminMessage {
    fn id(&self) -> &str {
        &self.id
    }
}

/// En rad i aktivitetsloggen. Vem som gjorde vad, och när.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEntry {
    pub id: String,
    pub at_ms: u64,
    pub actor_id: String,
    pub actor_name: String,
    pub action: String,
    pub detail: String,
}

impl HasId for ActivityEntry {
    fn id(&self) -> &str {
        &self.id
    }
}

#[derive(Clone)]
pub struct Storage {
    dir: PathBuf,
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

impl Storage {
    pub fn new(dir: impl AsRef<Path>) -> Result<Self, AppError> {
        let dir = dir.as_ref().to_path_buf();
        fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    fn path(&self, file: &str) -> PathBuf {
        self.dir.join(file)
    }

    fn read<T>(&self, file: &str) -> Result<T, AppError>
    where
        T: serde::de::DeserializeOwned + Default,
    {
        let path = self.path(file);
        if !path.exists() {
            return Ok(T::default());
        }
        let raw = fs::read_to_string(&path)?;
        if raw.trim().is_empty() {
            return Ok(T::default());
        }
        // En trasig fil ska inte låsa hela appen. Vi rapporterar felet i stället
        // för att tyst skriva över elevens material.
        serde_json::from_str(&raw).map_err(|err| {
            AppError::Storage(format!(
                "{} kunde inte läsas ({}).",
                file,
                err
            ))
        })
    }

    fn write<T: Serialize>(&self, file: &str, value: &T) -> Result<(), AppError> {
        let path = self.path(file);
        let temporary = self.path(&format!("{file}.tmp"));
        let json = serde_json::to_string_pretty(value)?;
        fs::write(&temporary, json)?;
        // Byt ut filen i ett svep så att en krasch inte lämnar en halv fil.
        fs::rename(&temporary, &path)?;
        Ok(())
    }

    // -- Studiematerial ---------------------------------------------------
    //
    // Alla läsningar kräver ett konto-id. Det finns ingen öppen "läs allt"-väg,
    // så ett kommando kan inte råka visa en annan elevs material.

    /// Materialet som tillhör ett konto, nyast först.
    fn owned_materials(&self, owner_id: &str) -> Result<Vec<StudyMaterial>, AppError> {
        let mut materials: Vec<StudyMaterial> = self.read(MATERIALS_FILE)?;
        materials.retain(|material| material.owner_id == owner_id && !owner_id.is_empty());
        materials.sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms));
        Ok(materials)
    }

    pub fn materials_for_owner(&self, owner_id: &str) -> Result<Vec<StudyMaterial>, AppError> {
        self.owned_materials(owner_id)
    }

    pub fn materials_for_owner_and_subject(
        &self,
        owner_id: &str,
        subject: &str,
    ) -> Result<Vec<StudyMaterial>, AppError> {
        let subject = subject.trim().to_lowercase();
        Ok(self
            .owned_materials(owner_id)?
            .into_iter()
            .filter(|material| material.subject.to_lowercase() == subject)
            .collect())
    }

    /// Ett material, men bara om det tillhör kontot. Annat ägarskap ger samma
    /// svar som om materialet inte fanns.
    pub fn material_for_owner(
        &self,
        owner_id: &str,
        id: &str,
    ) -> Result<Option<StudyMaterial>, AppError> {
        Ok(self
            .owned_materials(owner_id)?
            .into_iter()
            .find(|item| item.id == id))
    }

    pub fn add_material(&self, material: &StudyMaterial) -> Result<(), AppError> {
        let mut materials: Vec<StudyMaterial> = self.read(MATERIALS_FILE)?;
        // Spara igen med samma id ersätter i stället för att dubblera.
        materials.retain(|item| item.id != material.id);
        materials.push(material.clone());
        self.write(MATERIALS_FILE, &materials)
    }

    pub fn remove_material_for_owner(&self, owner_id: &str, id: &str) -> Result<bool, AppError> {
        let mut materials: Vec<StudyMaterial> = self.read(MATERIALS_FILE)?;
        let before = materials.len();
        materials.retain(|item| !(item.id == id && item.owner_id == owner_id));
        let removed = materials.len() != before;
        if removed {
            self.write(MATERIALS_FILE, &materials)?;
        }
        Ok(removed)
    }

    // -- Resultat ---------------------------------------------------------

    /// Resultaten för ett konto, nyast först.
    pub fn attempts_for_owner(&self, owner_id: &str) -> Result<Vec<Attempt>, AppError> {
        let mut attempts: Vec<Attempt> = self.read(ATTEMPTS_FILE)?;
        attempts.retain(|attempt| attempt.owner_id == owner_id && !owner_id.is_empty());
        attempts.sort_by(|a, b| b.completed_at_ms.cmp(&a.completed_at_ms));
        Ok(attempts)
    }

    pub fn add_attempt(&self, attempt: &Attempt) -> Result<(), AppError> {
        let mut attempts: Vec<Attempt> = self.read(ATTEMPTS_FILE)?;
        attempts.push(attempt.clone());
        self.write(ATTEMPTS_FILE, &attempts)
    }

    // -- Inställningar ----------------------------------------------------

    /// Alla inställningar, inklusive andras modellval. Stannar i backend.
    pub fn settings(&self) -> Result<Settings, AppError> {
        self.read(SETTINGS_FILE)
    }

    /// Ett kontos eget modellval, om det finns.
    pub fn model_for_user(&self, user_id: &str) -> Result<Option<String>, AppError> {
        Ok(self
            .settings()?
            .models_by_user
            .get(user_id)
            .map(|model| model.trim().to_string())
            .filter(|model| !model.is_empty()))
    }

    /// Sätter eller tar bort ett kontos egna modellval. Andra kontons val rörs inte.
    pub fn set_model_for_user(
        &self,
        user_id: &str,
        model: Option<String>,
    ) -> Result<Settings, AppError> {
        if user_id.trim().is_empty() {
            return Err(AppError::Validation("Kontot saknas.".to_string()));
        }

        let mut settings = self.settings()?;
        let model = model
            .map(|model| model.trim().to_string())
            .filter(|model| !model.is_empty());

        match model {
            Some(model) => {
                settings.models_by_user.insert(user_id.to_string(), model);
            }
            None => {
                settings.models_by_user.remove(user_id);
            }
        }

        self.write(SETTINGS_FILE, &settings)?;
        Ok(settings)
    }

    // -- Äldre poster utan ägare ------------------------------------------

    /// Flyttar poster som saknar kontoägare till en egen bevarad fil.
    ///
    /// Ägaren går inte att fastställa i efterhand, så posterna får varken
    /// tillhöra en elev eller vara synliga för alla. De kopieras till en
    /// säkerhetskopia, flyttas till `*-aldre.json` och lämnar den vanliga
    /// filen. Körningen är idempotent: andra gången finns inget kvar att
    /// flytta, ingen ny kopia skrivs och inga dubbletter uppstår.
    pub fn migrate_ownerless_data(&self, stamp: &str) -> Result<LegacyMigration, AppError> {
        let materials = self.move_ownerless(
            MATERIALS_FILE,
            LEGACY_MATERIALS_FILE,
            stamp,
            |material: &StudyMaterial| material.owner_id.is_empty(),
        )?;
        let attempts = self.move_ownerless(
            ATTEMPTS_FILE,
            LEGACY_ATTEMPTS_FILE,
            stamp,
            |attempt: &Attempt| attempt.owner_id.is_empty(),
        )?;

        Ok(LegacyMigration {
            materials: materials.0,
            attempts: attempts.0,
            backups: vec![materials.1, attempts.1].into_iter().flatten().collect(),
        })
    }

    fn move_ownerless<T>(
        &self,
        file: &str,
        legacy_file: &str,
        stamp: &str,
        ownerless: impl Fn(&T) -> bool,
    ) -> Result<(usize, Option<String>), AppError>
    where
        T: HasId + Clone + Serialize + serde::de::DeserializeOwned,
    {
        let all: Vec<T> = self.read(file)?;
        let (ownerless_items, kept): (Vec<T>, Vec<T>) = all.into_iter().partition(|item| ownerless(item));
        if ownerless_items.is_empty() {
            return Ok((0, None));
        }

        // Säkerhetskopia först, så att originalet går att återskapa.
        let backup = format!("{}-backup-{stamp}.json", file.trim_end_matches(".json"));
        fs::copy(self.path(file), self.path(&backup))?;

        // Flytta till den bevarade filen utan dubbletter.
        let mut legacy: Vec<T> = self.read(legacy_file)?;
        for item in &ownerless_items {
            if !legacy.iter().any(|existing| existing.id() == item.id()) {
                legacy.push(item.clone());
            }
        }
        self.write(legacy_file, &legacy)?;
        self.write(file, &kept)?;

        Ok((ownerless_items.len(), Some(backup)))
    }

    // -- Användarkonton ---------------------------------------------------

    pub fn users(&self) -> Result<Vec<User>, AppError> {
        let mut users: Vec<User> = self.read(USERS_FILE)?;
        users.sort_by(|a, b| a.created_at_ms.cmp(&b.created_at_ms));
        Ok(users)
    }

    /// Slår upp ett konto på e-postadress. Jämförelsen är skiftlägesokänslig.
    pub fn user_by_email(&self, email: &str) -> Result<Option<User>, AppError> {
        let email = email.trim().to_lowercase();
        Ok(self
            .users()?
            .into_iter()
            .find(|user| user.email == email))
    }

    /// Lägger till ett konto. Ett id som redan finns ersätter den gamla posten,
    /// men en e-postadress som redan är tagen avvisas.
    pub fn add_user(&self, user: &User) -> Result<(), AppError> {
        let mut users = self.users()?;

        if users
            .iter()
            .any(|item| item.email == user.email && item.id != user.id)
        {
            return Err(AppError::EmailTaken);
        }

        users.retain(|item| item.id != user.id);
        users.push(user.clone());
        self.write(USERS_FILE, &users)
    }

    pub fn user_by_id(&self, id: &str) -> Result<Option<User>, AppError> {
        Ok(self.users()?.into_iter().find(|user| user.id == id))
    }

    // -- Allmänna hjälpare för listor -------------------------------------

    fn list<T>(&self, file: &str) -> Result<Vec<T>, AppError>
    where
        T: serde::de::DeserializeOwned,
    {
        self.read(file)
    }

    /// Lägger till eller ersätter posten med samma id.
    fn upsert<T>(&self, file: &str, item: &T) -> Result<(), AppError>
    where
        T: HasId + Serialize + Clone + serde::de::DeserializeOwned,
    {
        let mut items: Vec<T> = self.read(file)?;
        items.retain(|existing| existing.id() != item.id());
        items.push(item.clone());
        self.write(file, &items)
    }

    /// Tar bort posten med angivet id. Sant om något togs bort.
    fn remove_item<T>(&self, file: &str, id: &str) -> Result<bool, AppError>
    where
        T: HasId + Serialize + serde::de::DeserializeOwned,
    {
        let mut items: Vec<T> = self.read(file)?;
        let before = items.len();
        items.retain(|existing| existing.id() != id);
        if items.len() == before {
            return Ok(false);
        }
        self.write(file, &items)?;
        Ok(true)
    }

    // -- Personer ---------------------------------------------------------

    pub fn people(&self) -> Result<Vec<Person>, AppError> {
        let mut people: Vec<Person> = self.list(PEOPLE_FILE)?;
        people.sort_by(|a, b| {
            let left = (a.last_name.to_lowercase(), a.first_name.to_lowercase());
            let right = (b.last_name.to_lowercase(), b.first_name.to_lowercase());
            left.cmp(&right)
        });
        Ok(people)
    }

    pub fn person(&self, id: &str) -> Result<Option<Person>, AppError> {
        Ok(self.people()?.into_iter().find(|person| person.id == id))
    }

    pub fn save_person(&self, person: &Person) -> Result<(), AppError> {
        self.upsert(PEOPLE_FILE, person)
    }

    // -- Uppgifter och inlämningar ----------------------------------------

    pub fn assignments(&self) -> Result<Vec<Assignment>, AppError> {
        let mut items: Vec<Assignment> = self.list(ASSIGNMENTS_FILE)?;
        items.sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms));
        Ok(items)
    }

    pub fn save_assignment(&self, assignment: &Assignment) -> Result<(), AppError> {
        self.upsert(ASSIGNMENTS_FILE, assignment)
    }

    pub fn remove_assignment(&self, id: &str) -> Result<(), AppError> {
        self.remove_item::<Assignment>(ASSIGNMENTS_FILE, id).map(|_| ())
    }

    pub fn submissions(&self) -> Result<Vec<Submission>, AppError> {
        self.list(SUBMISSIONS_FILE)
    }

    pub fn save_submission(&self, submission: &Submission) -> Result<(), AppError> {
        self.upsert(SUBMISSIONS_FILE, submission)
    }

    // -- Prov -------------------------------------------------------------

    pub fn exams(&self) -> Result<Vec<Exam>, AppError> {
        let mut items: Vec<Exam> = self.list(EXAMS_FILE)?;
        items.sort_by(|a, b| a.date.cmp(&b.date));
        Ok(items)
    }

    pub fn save_exam(&self, exam: &Exam) -> Result<(), AppError> {
        self.upsert(EXAMS_FILE, exam)
    }

    pub fn remove_exam(&self, id: &str) -> Result<(), AppError> {
        self.remove_item::<Exam>(EXAMS_FILE, id).map(|_| ())
    }

    pub fn exam_results(&self) -> Result<Vec<ExamResult>, AppError> {
        self.list(EXAM_RESULTS_FILE)
    }

    pub fn save_exam_result(&self, result: &ExamResult) -> Result<(), AppError> {
        self.upsert(EXAM_RESULTS_FILE, result)
    }

    // -- Schema -----------------------------------------------------------

    pub fn schedule(&self) -> Result<Vec<ScheduleEntry>, AppError> {
        let mut items: Vec<ScheduleEntry> = self.list(SCHEDULE_FILE)?;
        items.sort_by(|a, b| a.weekday.cmp(&b.weekday).then(a.start.cmp(&b.start)));
        Ok(items)
    }

    pub fn save_schedule_entry(&self, entry: &ScheduleEntry) -> Result<(), AppError> {
        self.upsert(SCHEDULE_FILE, entry)
    }

    pub fn remove_schedule_entry(&self, id: &str) -> Result<(), AppError> {
        self.remove_item::<ScheduleEntry>(SCHEDULE_FILE, id)
            .map(|_| ())
    }

    // -- Meddelanden och aktivitetslogg -----------------------------------

    pub fn admin_messages(&self) -> Result<Vec<AdminMessage>, AppError> {
        let mut items: Vec<AdminMessage> = self.list(MESSAGES_FILE)?;
        items.sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms));
        Ok(items)
    }

    pub fn save_admin_message(&self, message: &AdminMessage) -> Result<(), AppError> {
        self.upsert(MESSAGES_FILE, message)
    }

    pub fn remove_admin_message(&self, id: &str) -> Result<(), AppError> {
        self.remove_item::<AdminMessage>(MESSAGES_FILE, id)
            .map(|_| ())
    }

    /// Aktivitetsloggen, nyaste först.
    pub fn activity(&self) -> Result<Vec<ActivityEntry>, AppError> {
        let mut items: Vec<ActivityEntry> = self.list(ACTIVITY_FILE)?;
        items.sort_by(|a, b| b.at_ms.cmp(&a.at_ms));
        Ok(items)
    }

    /// Skriver en rad i aktivitetsloggen och kapar den så att filen inte växer
    /// utan gräns. En trasig loggfil får aldrig stoppa en administratör.
    pub fn log_activity(&self, entry: &ActivityEntry) {
        let mut items: Vec<ActivityEntry> = self.list(ACTIVITY_FILE).unwrap_or_default();
        items.push(entry.clone());
        items.sort_by(|a, b| b.at_ms.cmp(&a.at_ms));
        items.truncate(ACTIVITY_LIMIT);
        let _ = self.write(ACTIVITY_FILE, &items);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        Attempt, LEGACY_ATTEMPTS_FILE, LEGACY_MATERIALS_FILE, MATERIALS_FILE, Storage,
        StudyMaterial,
    };
    use serde_json::json;
    use std::fs;

    /// Egen mapp per test, så att testerna kan köras samtidigt.
    fn storage() -> (Storage, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("lumi-test-{}", uuid::Uuid::new_v4()));
        let storage = Storage::new(&dir).expect("kunde inte skapa testmappen");
        (storage, dir)
    }

    /// Ett material som tillhör ett konto ("elev-a" om inget annat anges).
    fn material(id: &str, created_at_ms: u64) -> StudyMaterial {
        material_owned_by("elev-a", id, created_at_ms)
    }

    fn material_owned_by(owner: &str, id: &str, created_at_ms: u64) -> StudyMaterial {
        StudyMaterial {
            id: id.to_string(),
            owner_id: owner.to_string(),
            kind: "quiz".to_string(),
            subject: "Biologi".to_string(),
            title: "Cellens delar".to_string(),
            created_at_ms,
            model: "google/gemini-3.8-flash".to_string(),
            content: json!({ "questions": [] }),
        }
    }

    #[test]
    fn material_survives_a_restart() {
        let (storage, dir) = storage();
        storage.add_material(&material("a", 1)).unwrap();

        // En ny instans mot samma mapp motsvarar att appen startas om.
        let reopened = Storage::new(&dir).unwrap();
        let saved = reopened
            .material_for_owner("elev-a", "a")
            .unwrap()
            .expect("materialet saknades");

        assert_eq!(saved.owner_id, "elev-a");
        assert_eq!(saved.title, "Cellens delar");
        assert_eq!(saved.subject, "Biologi");
        assert_eq!(saved.content, json!({ "questions": [] }));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn saving_the_same_id_replaces_instead_of_duplicating() {
        let (storage, dir) = storage();
        storage.add_material(&material("a", 1)).unwrap();

        let mut updated = material("a", 2);
        updated.title = "Cellens delar (ny)".to_string();
        storage.add_material(&updated).unwrap();

        let materials = storage.materials_for_owner("elev-a").unwrap();
        assert_eq!(materials.len(), 1);
        assert_eq!(materials[0].title, "Cellens delar (ny)");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_newest_material_is_listed_first() {
        let (storage, dir) = storage();
        storage.add_material(&material("gammal", 100)).unwrap();
        storage.add_material(&material("ny", 900)).unwrap();

        let ids: Vec<String> = storage
            .materials_for_owner("elev-a")
            .unwrap()
            .into_iter()
            .map(|item| item.id)
            .collect();
        assert_eq!(ids, vec!["ny", "gammal"]);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn materials_can_be_filtered_by_subject() {
        let (storage, dir) = storage();
        storage.add_material(&material("a", 1)).unwrap();
        let mut other = material("b", 2);
        other.subject = "Historia".to_string();
        storage.add_material(&other).unwrap();

        let owner = "elev-a";
        assert_eq!(
            storage.materials_for_owner_and_subject(owner, "biologi").unwrap().len(),
            1
        );
        assert_eq!(
            storage.materials_for_owner_and_subject(owner, "Historia").unwrap().len(),
            1
        );
        assert_eq!(
            storage.materials_for_owner_and_subject(owner, "Matte").unwrap().len(),
            0
        );
        // En annan elev ser inget av materialet.
        assert!(storage
            .materials_for_owner_and_subject("elev-b", "biologi")
            .unwrap()
            .is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn deleting_reports_whether_anything_was_removed() {
        let (storage, dir) = storage();
        storage.add_material(&material("a", 1)).unwrap();

        // En annan elev kan inte radera materialet.
        assert!(!storage.remove_material_for_owner("elev-b", "a").unwrap());
        assert!(storage.remove_material_for_owner("elev-a", "a").unwrap());
        assert!(!storage.remove_material_for_owner("elev-a", "a").unwrap());
        assert!(storage.materials_for_owner("elev-a").unwrap().is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn attempts_are_stored_with_their_score() {
        let (storage, dir) = storage();
        storage
            .add_attempt(&Attempt {
                id: "r1".to_string(),
                owner_id: "elev-a".to_string(),
                material_id: "a".to_string(),
                subject: "Biologi".to_string(),
                kind: "quiz".to_string(),
                correct: 4,
                total: 5,
                completed_at_ms: 10,
            })
            .unwrap();

        let attempts = storage.attempts_for_owner("elev-a").unwrap();
        assert_eq!(attempts.len(), 1);
        assert_eq!(attempts[0].correct, 4);
        assert_eq!(attempts[0].total, 5);
        // En annan elev har sina egna resultat.
        assert!(storage.attempts_for_owner("elev-b").unwrap().is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_model_choice_is_stored_per_account() {
        let (storage, dir) = storage();

        assert!(storage.model_for_user("elev-a").unwrap().is_none());

        storage
            .set_model_for_user("elev-a", Some("google/gemini-3.1-flash-lite".to_string()))
            .unwrap();
        storage
            .set_model_for_user("elev-b", Some("openai/gpt-5-mini".to_string()))
            .unwrap();

        // Valet finns kvar efter omstart och blandas inte ihop.
        let reopened = Storage::new(&dir).unwrap();
        assert_eq!(
            reopened.model_for_user("elev-a").unwrap().as_deref(),
            Some("google/gemini-3.1-flash-lite")
        );
        assert_eq!(
            reopened.model_for_user("elev-b").unwrap().as_deref(),
            Some("openai/gpt-5-mini")
        );

        // Att välja standard igen tar bort det egna valet, utan att röra elev B.
        reopened.set_model_for_user("elev-a", None).unwrap();
        assert!(reopened.model_for_user("elev-a").unwrap().is_none());
        assert_eq!(
            reopened.model_for_user("elev-b").unwrap().as_deref(),
            Some("openai/gpt-5-mini")
        );

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ownerless_data_is_preserved_separately_and_never_shown() {
        let (storage, dir) = storage();

        // En äldre fil utan ägare, skriven direkt som den såg ut förut.
        storage.add_material(&material("min", 200)).unwrap();
        let mut old = material("gammal", 100);
        old.owner_id = String::new();
        storage.add_material(&old).unwrap();
        storage
            .add_attempt(&Attempt {
                id: "r-gammal".to_string(),
                owner_id: String::new(),
                material_id: "gammal".to_string(),
                subject: "Biologi".to_string(),
                kind: "quiz".to_string(),
                correct: 2,
                total: 5,
                completed_at_ms: 10,
            })
            .unwrap();

        let report = storage.migrate_ownerless_data("2026-10-13").unwrap();
        assert_eq!(report.materials, 1);
        assert_eq!(report.attempts, 1);
        assert_eq!(report.backups.len(), 2);

        // Det egna materialet är kvar, det ägarlösa är undanflyttat.
        let mine = storage.materials_for_owner("elev-a").unwrap();
        assert_eq!(mine.len(), 1);
        assert_eq!(mine[0].id, "min");
        assert!(storage.materials_for_owner("elev-b").unwrap().is_empty());

        // Den ägarlösa posten finns kvar, men i den bevarade filen.
        let kept: Vec<StudyMaterial> = serde_json::from_str(
            &fs::read_to_string(dir.join(LEGACY_MATERIALS_FILE)).unwrap(),
        )
        .unwrap();
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].id, "gammal");
        assert_eq!(kept[0].title, "Cellens delar");

        let kept_attempts: Vec<Attempt> = serde_json::from_str(
            &fs::read_to_string(dir.join(LEGACY_ATTEMPTS_FILE)).unwrap(),
        )
        .unwrap();
        assert_eq!(kept_attempts.len(), 1);

        // Säkerhetskopian går att läsa och innehåller originalet.
        let backup = dir.join(&report.backups[0]);
        let raw = fs::read_to_string(&backup).unwrap();
        assert!(raw.contains("gammal"));

        // Att köra igen gör ingenting: inga nya kopior och inga dubbletter.
        let again = storage.migrate_ownerless_data("2026-10-14").unwrap();
        assert!(again.is_empty());
        assert!(again.backups.is_empty());
        let kept_again: Vec<StudyMaterial> = serde_json::from_str(
            &fs::read_to_string(dir.join(LEGACY_MATERIALS_FILE)).unwrap(),
        )
        .unwrap();
        assert_eq!(kept_again.len(), 1);
        assert_eq!(storage.materials_for_owner("elev-a").unwrap().len(), 1);

        // Och appen fungerar som vanligt efter en omstart.
        let reopened = Storage::new(&dir).unwrap();
        assert_eq!(reopened.materials_for_owner("elev-a").unwrap().len(), 1);
        assert!(reopened
            .migrate_ownerless_data("2026-10-15")
            .unwrap()
            .is_empty());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_broken_file_is_reported_and_not_silently_erased() {
        let (storage, dir) = storage();
        let path = dir.join(MATERIALS_FILE);
        fs::write(&path, "{ inte giltig json").unwrap();

        let error = storage
            .materials_for_owner("elev-a")
            .expect_err("trasig fil borde ge ett fel");
        assert_eq!(error.kind(), "storage");

        // Elevens fil får inte skrivas över bara för att den inte gick att läsa.
        assert_eq!(fs::read_to_string(&path).unwrap(), "{ inte giltig json");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_finished_write_leaves_no_temporary_file_behind() {
        let (storage, dir) = storage();
        storage.add_material(&material("a", 1)).unwrap();

        assert!(dir.join(MATERIALS_FILE).exists());
        assert!(!dir.join(format!("{MATERIALS_FILE}.tmp")).exists());
        fs::remove_dir_all(&dir).ok();
    }
}
