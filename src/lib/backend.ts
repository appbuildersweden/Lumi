// Lumi · kopplingen mot Rust-backend.
//
// Allt som rör AI, API-nyckeln och filerna går genom den här filen. Nyckeln
// passerar aldrig hit – gränssnittet kan bara fråga om en nyckel finns.
//
// Funktionerna är döpta efter vad de gör i Lumi, så att anropen i sidorna
// läser som vanligt språk.

import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ── Typer ─────────────────────────────────────────────────────────────────

export type MaterialKind =
  | "summary"
  | "quiz"
  | "flashcards"
  | "practice-exam"
  | "notes"
  | "study-plan";

export type Difficulty = "latt" | "medel" | "svar";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
  cost: number | null;
  /** Sant när modellen nådde sin längdgräns innan den var klar. */
  truncated: boolean;
}

/** Modellen som varje roll använder, så som backend har konfigurerat den. */
export interface ModelRoles {
  main: string;
  study: string;
  economy: string;
  backup: string;
}

export interface AiStatus {
  configured: boolean;
  /** "environment" eller "none". */
  source: string;
  model: string;
  defaultModel: string;
  baseUrl: string;
  suggestedModels: string[];
  roles: ModelRoles;
}

export interface ModelInfo {
  id: string;
  name: string;
  contextLength: number;
  promptPrice: number;
  completionPrice: number;
}

export interface KeyStatus {
  usage: number;
  limit: number | null;
}

/** Rollen ett konto har. Rollen bestäms alltid i backend. */
export type UserRole = "admin" | "lärare" | "elev";

/** Ett konto som gränssnittet får se. Lösenordshashen lämnar aldrig backend. */
export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  /** Rollens namn i gränssnittet, från backend. */
  roleLabel: string;
  active: boolean;
  personId: string | null;
}

/** En person i skolan. Kopplas till ett konto. */
export interface Person {
  id: string;
  /** "elever" eller "personal". */
  kind: string;
  firstName: string;
  lastName: string;
  className: string;
  email: string;
  subjects: string[];
  active: boolean;
  createdAtMs: number;
}

/** Ett konto tillsammans med personen det hör till. */
export interface AccountRow extends PublicUser {
  personName: string;
  className: string;
  /** "", "elever" eller "personal". */
  kind: string;
}

export interface AdminOverview {
  students: number;
  staff: number;
  accounts: number;
  inactiveAccounts: number;
  accountsWithoutPerson: number;
  publishedAssignments: number;
  exams: number;
  scheduleEntries: number;
}

/** Vad en roll får göra, enligt backend. */
export interface RoleInfo {
  slug: UserRole;
  label: string;
  description: string;
  landsIn: string;
  can: string[];
}

export interface Assignment {
  id: string;
  title: string;
  subject: string;
  instructions: string;
  /** ISO-datum, ÅÅÅÅ-MM-DD. */
  dueDate: string;
  classNames: string[];
  studentIds: string[];
  published: boolean;
  createdAtMs: number;
  createdByName: string;
}

export interface Submission {
  id: string;
  assignmentId: string;
  studentId: string;
  submittedAtMs: number | null;
  note: string;
  grade: string;
  comment: string;
}

export interface Exam {
  id: string;
  title: string;
  subject: string;
  date: string;
  classNames: string[];
  studentIds: string[];
  description: string;
  createdAtMs: number;
}

export interface ExamResult {
  id: string;
  examId: string;
  studentId: string;
  score: number | null;
  maxScore: number | null;
  grade: string;
  comment: string;
  recordedAtMs: number;
}

/** En rad i schemat. `weekday` är 1 = måndag till 7 = söndag. */
export interface ScheduleEntry {
  id: string;
  /** "lektion", "prov" eller "aktivitet". */
  kind: string;
  title: string;
  subject: string;
  className: string;
  weekday: number;
  start: string;
  end: string;
  room: string;
  teacherId: string;
  createdAtMs: number;
}

/** En nyhet eller ett viktigt meddelande. */
export interface AdminMessage {
  id: string;
  /** "nyhet" eller "meddelande". */
  kind: string;
  title: string;
  body: string;
  createdAtMs: number;
  authorName: string;
}

export interface ActivityEntry {
  id: string;
  atMs: number;
  actorId: string;
  actorName: string;
  action: string;
  detail: string;
}

/** Uppgifterna för att skapa ett konto, och eventuellt personen samtidigt. */
export interface NewAccountInput {
  email: string;
  password: string;
  role: UserRole;
  displayName: string;
  personId: string | null;
  firstName: string;
  lastName: string;
  className: string;
}

export interface SummaryContent {
  sections: { heading: string; body: string }[];
}

export interface QuizContent {
  questions: {
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  }[];
}

export interface FlashcardsContent {
  cards: { front: string; back: string }[];
}

export interface PracticeExamContent {
  instructions: string;
  questions: {
    question: string;
    points: number;
    answer: string;
    explanation: string;
  }[];
}

export interface NotesContent {
  sections: { heading: string; bullets: string[] }[];
}

export interface StudyPlanContent {
  summary: string;
  steps: { title: string; focus: string; minutes: number }[];
}

export type MaterialContentFor<K extends MaterialKind> = K extends "summary"
  ? SummaryContent
  : K extends "quiz"
    ? QuizContent
    : K extends "flashcards"
      ? FlashcardsContent
      : K extends "practice-exam"
        ? PracticeExamContent
        : K extends "notes"
          ? NotesContent
          : StudyPlanContent;

/**
 * Sparat material. Unionen är uppdelad per `kind`, så att `content` får rätt
 * form så snart materialtypen är känd.
 */
export type StudyMaterial = {
  [K in MaterialKind]: {
    id: string;
    kind: K;
    subject: string;
    title: string;
    createdAtMs: number;
    model: string;
    content: MaterialContentFor<K>;
  };
}[MaterialKind];

/** Material av en bestämd typ, t.ex. `MaterialOf<"quiz">`. */
export type MaterialOf<K extends MaterialKind> = Extract<StudyMaterial, { kind: K }>;

export interface Attempt {
  id: string;
  materialId: string;
  subject: string;
  kind: string;
  correct: number;
  total: number;
  completedAtMs: number;
}

export interface Settings {
  model: string | null;
}

export interface GenerateRequest {
  kind: MaterialKind;
  subject: string;
  topic: string;
  difficulty?: Difficulty;
  count?: number;
  materialId?: string | null;
  context?: string | null;
}

export interface AppErrorShape {
  kind: string;
  message: string;
}

// ── Fel ───────────────────────────────────────────────────────────────────

/** Fel från backend, med en `kind` som gränssnittet kan växla på. */
export class LumiError extends Error {
  readonly kind: string;

  constructor(kind: string, message: string) {
    super(message);
    this.name = "LumiError";
    this.kind = kind;
  }
}

/** Sant när felet bara beror på att backend saknas (webbläsarläge). */
export function isMissingBackend(raw: unknown): boolean {
  return toLumiError(raw).kind === "no-backend";
}

export function toLumiError(raw: unknown): LumiError {
  if (raw instanceof LumiError) return raw;

  if (raw && typeof raw === "object" && "kind" in raw && "message" in raw) {
    const { kind, message } = raw as AppErrorShape;
    return new LumiError(String(kind), String(message));
  }

  if (typeof raw === "string" && raw.trim()) {
    return new LumiError("unknown", raw);
  }

  return new LumiError("unknown", "Något gick fel. Försök igen.");
}

// ── Anrop ─────────────────────────────────────────────────────────────────

/** Sant bara när appen körs i Tauri-fönstret, inte i en webbläsarflik. */
export const runningInTauri =
  typeof window !== "undefined" &&
  "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!runningInTauri) {
    throw new LumiError(
      "no-backend",
      "Lumi körs i webbläsarläge utan backend. Starta appen med npm run tauri dev."
    );
  }

  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    throw toLumiError(raw);
  }
}

// ── API-nyckel och modell ─────────────────────────────────────────────────

export function getAiStatus(): Promise<AiStatus> {
  return call<AiStatus>("ai_status");
}

export function checkApiKey(): Promise<KeyStatus> {
  return call<KeyStatus>("check_api_key");
}

export function listModels(query?: string): Promise<ModelInfo[]> {
  return call<ModelInfo[]>("list_models", { query: query ?? null });
}

export function getSettings(): Promise<Settings> {
  return call<Settings>("get_settings");
}

export function setModel(model: string | null): Promise<Settings> {
  return call<Settings>("update_settings", { model });
}

// ── Lärare-Chat ───────────────────────────────────────────────────────────

export interface AskOptions {
  messages: ChatMessage[];
  model?: string | null;
  /** Id för sparat material som ska användas som underlag. */
  materialId?: string | null;
  onDelta: (text: string) => void;
}

/** Ställer en fråga till AI:n och tar emot svaret bit för bit. */
export async function askLumi({
  messages,
  model = null,
  materialId = null,
  onDelta,
}: AskOptions): Promise<ChatUsage> {
  if (!runningInTauri) {
    throw new LumiError(
      "no-backend",
      "Lumi körs i webbläsarläge utan backend. Starta appen med npm run tauri dev."
    );
  }

  const onEvent = new Channel<{ type: "delta"; text: string } | { type: "done"; usage: ChatUsage }>();
  onEvent.onmessage = (event) => {
    if (event.type === "delta") onDelta(event.text);
  };

  try {
    return await invoke<ChatUsage>("chat_stream", {
      messages,
      model,
      materialId,
      onEvent,
    });
  } catch (raw) {
    throw toLumiError(raw);
  }
}

/** Gör om en konversation till ett textunderlag. */
export function conversationToContext(messages: ChatMessage[]): Promise<string> {
  return call<string>("conversation_context", { messages });
}

// ── Studiematerial ────────────────────────────────────────────────────────

/** Skapar material och validerar det, utan att spara. */
export function createMaterial<K extends MaterialKind>(
  request: GenerateRequest & { kind: K },
  model?: string | null
): Promise<MaterialOf<K>> {
  return call<MaterialOf<K>>("generate_material", { request, model: model ?? null });
}

export function createSummary(
  request: Omit<GenerateRequest, "kind">,
  model?: string | null
): Promise<MaterialOf<"summary">> {
  return createMaterial<"summary">({ ...request, kind: "summary" }, model);
}

export function createQuiz(
  request: Omit<GenerateRequest, "kind">,
  model?: string | null
): Promise<MaterialOf<"quiz">> {
  return createMaterial<"quiz">({ ...request, kind: "quiz" }, model);
}

export function createFlashcards(
  request: Omit<GenerateRequest, "kind">,
  model?: string | null
): Promise<MaterialOf<"flashcards">> {
  return createMaterial<"flashcards">({ ...request, kind: "flashcards" }, model);
}

export function createPracticeExam(
  request: Omit<GenerateRequest, "kind">,
  model?: string | null
): Promise<MaterialOf<"practice-exam">> {
  return createMaterial<"practice-exam">({ ...request, kind: "practice-exam" }, model);
}

export function createNotes(
  request: Omit<GenerateRequest, "kind">,
  model?: string | null
): Promise<MaterialOf<"notes">> {
  return createMaterial<"notes">({ ...request, kind: "notes" }, model);
}

export function createStudyPlan(
  request: Omit<GenerateRequest, "kind">,
  model?: string | null
): Promise<MaterialOf<"study-plan">> {
  return createMaterial<"study-plan">({ ...request, kind: "study-plan" }, model);
}

/** Sparar materialet. Backend validerar en gång till innan det skrivs. */
export function saveStudyMaterial<K extends MaterialKind>(material: {
  kind: K;
  subject: string;
  title: string;
  content: MaterialContentFor<K>;
  model?: string | null;
}): Promise<MaterialOf<K>> {
  return call<MaterialOf<K>>("save_material", {
    material: {
      kind: material.kind,
      subject: material.subject,
      title: material.title,
      content: material.content,
      model: material.model ?? null,
    },
  });
}

export function listStudyMaterial(subject?: string): Promise<StudyMaterial[]> {
  return call<StudyMaterial[]>("list_materials", { subject: subject ?? null });
}

export function getSubjectMaterials(subject: string): Promise<StudyMaterial[]> {
  return call<StudyMaterial[]>("get_subject_materials", { subject });
}

export function getStudyMaterial(id: string): Promise<StudyMaterial | null> {
  return call<StudyMaterial | null>("get_material", { id });
}

export function deleteStudyMaterial(id: string): Promise<boolean> {
  return call<boolean>("delete_material", { id });
}

// ── Resultat ──────────────────────────────────────────────────────────────

export function saveQuizResult(
  materialId: string,
  correct: number,
  total: number
): Promise<Attempt> {
  return call<Attempt>("save_attempt", { materialId, correct, total });
}

/**
 * Elevens egna resultat från Plugga.
 *
 * En administratör kan skicka med ett konto-id och får då den elevens
 * resultat – backend nekar alla andra. Utan id blir svaret alltid ens eget.
 */
export function listAttempts(accountId?: string): Promise<Attempt[]> {
  return call<Attempt[]>("list_attempts", { accountId: accountId ?? null });
}

// ── Inloggning ────────────────────────────────────────────────────────────
//
// Lumis eget kontosystem. Uppgifterna kontrolleras i Rust-backenden mot
// hashade lösenord i användardatabasen. Sessionen ligger i backend, så inget
// lösenord eller någon token sparas i gränssnittet.

/**
 * Loggar in och returnerar kontot. Kastar ett fel om uppgifterna är fel.
 *
 * `remember` motsvarar krysset "Håll mig inloggad": sessionen sparas då
 * skyddad i backend, så att nästa start kan återställa den utan lösenord.
 */
export function signIn(
  email: string,
  password: string,
  remember = false,
): Promise<PublicUser> {
  return call<PublicUser>("auth_login", { email, password, remember });
}

/**
 * Återställer en sparad session vid start. Backend kontrollerar den mot
 * databasen och svarar null om den inte längre gäller.
 */
export function restoreSession(): Promise<PublicUser | null> {
  return call<PublicUser | null>("auth_restore_session");
}

// ── Uppdateringar ─────────────────────────────────────────────────────────

/** En ny version finns och hämtas. */
export interface UpdateAvailable {
  version: string;
  currentVersion: string;
  notes: string | null;
}

/** Hur långt nedladdningen har kommit. */
export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

/** En uppdatering som inte gick att genomföra. Lumi kör vidare som förut. */
export interface UpdateFailed {
  version: string;
  message: string;
}

/**
 * Lyssnar på vad uppdateringsfunktionen gör. Backend hämtar och installerar
 * en ny version vid start; det här är bara så att väntan syns.
 *
 * Returnerar en funktion som slutar lyssna.
 */
export async function onUpdateEvents(handlers: {
  available?: (info: UpdateAvailable) => void;
  progress?: (progress: UpdateProgress) => void;
  failed?: (failure: UpdateFailed) => void;
}): Promise<() => void> {
  if (!runningInTauri) return () => {};

  const stops = await Promise.all([
    listen<UpdateAvailable>("lumi://update-available", (event) =>
      handlers.available?.(event.payload),
    ),
    listen<UpdateProgress>("lumi://update-progress", (event) =>
      handlers.progress?.(event.payload),
    ),
    listen<UpdateFailed>("lumi://update-failed", (event) =>
      handlers.failed?.(event.payload),
    ),
  ]);

  return () => stops.forEach((stop) => stop());
}

export function signOut(): Promise<void> {
  return call<void>("auth_logout");
}

/** Vem som är inloggad just nu, eller null om ingen är det. */
export function currentUser(): Promise<PublicUser | null> {
  return call<PublicUser | null>("auth_current_user");
}

/**
 * Skapar ett konto direkt via auth-kommandot. Kräver ett administratörskonto.
 *
 * Adminpanelen använder `createAccount` längre ned, som också kan registrera
 * personen i samma arbetsflöde. Den här är kvar som tunt skal kring det
 * befintliga auth-kommandot.
 */
export function createAuthUser(account: {
  email: string;
  password: string;
  displayName: string;
  role: UserRole;
}): Promise<PublicUser> {
  return call<PublicUser>("auth_create_user", {
    email: account.email,
    password: account.password,
    displayName: account.displayName,
    role: account.role,
  });
}

/** Listar kontona via auth-kommandot. Kräver ett administratörskonto. */
export function listAuthUsers(): Promise<PublicUser[]> {
  return call<PublicUser[]>("auth_list_users");
}

/**
 * Ändrar namn och e-postadress på sitt eget konto.
 *
 * Kontot är alltid det som sessionen pekar på, och backend kontrollerar att
 * adressen är ledig. Rollen kan inte ändras härifrån.
 */
export function updateProfile(displayName: string, email: string): Promise<PublicUser> {
  return call<PublicUser>("auth_update_profile", { displayName, email });
}

/** Byter lösenord på sitt eget konto. Det nuvarande lösenordet krävs. */
export function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<PublicUser> {
  return call<PublicUser>("auth_change_password", { currentPassword, newPassword });
}

/** Sant bara för ett adminkonto. Rollen kommer från backend. */
export function isAdmin(user: PublicUser | null | undefined): boolean {
  return user?.role === "admin";
}

/** Kontots roll i klartext, för visning. */
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administratör",
  lärare: "Lärare",
  elev: "Elev",
};

/** Vilket gränssnitt rollen ska hamna i efter inloggningen. */
export function landsInAdminPanel(user: PublicUser | null | undefined): boolean {
  return user?.role === "admin";
}

// ── Adminpanelen ─────────────────────────────────────────────────────────
//
// Alla anrop nedan kräver ett inloggat administratörskonto. Backend svarar
// `not-admin` för alla andra, oavsett vad gränssnittet visar.

export function getAdminOverview(): Promise<AdminOverview> {
  return call<AdminOverview>("admin_overview");
}

export function listPeople(kind?: string): Promise<Person[]> {
  return call<Person[]>("list_people", { kind: kind ?? null });
}

export function savePerson(person: Person): Promise<Person> {
  return call<Person>("save_person", { person });
}

export function setPersonActive(id: string, active: boolean): Promise<Person> {
  return call<Person>("set_person_active", { id, active });
}

export function listAccounts(): Promise<AccountRow[]> {
  return call<AccountRow[]>("list_accounts");
}

export function createAccount(input: NewAccountInput): Promise<AccountRow> {
  return call<AccountRow>("create_account", { input });
}

export function setAccountRole(accountId: string, role: UserRole): Promise<PublicUser> {
  return call<PublicUser>("set_account_role", { accountId, role });
}

export function setAccountActive(accountId: string, active: boolean): Promise<PublicUser> {
  return call<PublicUser>("set_account_active", { accountId, active });
}

/** Sätter ett nytt lösenord. Lösenordet skickas bara hit och visas aldrig igen. */
export function resetAccountPassword(
  accountId: string,
  newPassword: string
): Promise<PublicUser> {
  return call<PublicUser>("reset_account_password", { accountId, newPassword });
}

export function setAccountPerson(
  accountId: string,
  personId: string | null
): Promise<PublicUser> {
  return call<PublicUser>("set_account_person", { accountId, personId });
}

/** Rollerna och deras behörigheter, så som backend ser dem. */
export function listRoles(): Promise<RoleInfo[]> {
  return call<RoleInfo[]>("list_roles");
}

export function listAssignments(): Promise<Assignment[]> {
  return call<Assignment[]>("list_assignments");
}

export function saveAssignment(assignment: Assignment): Promise<Assignment> {
  return call<Assignment>("save_assignment", { assignment });
}

export function deleteAssignment(id: string): Promise<void> {
  return call<void>("delete_assignment", { id });
}

export function listSubmissions(): Promise<Submission[]> {
  return call<Submission[]>("list_submissions");
}

export function saveSubmission(submission: Submission): Promise<Submission> {
  return call<Submission>("save_submission", { submission });
}

export function listExams(): Promise<Exam[]> {
  return call<Exam[]>("list_exams");
}

export function saveExam(exam: Exam): Promise<Exam> {
  return call<Exam>("save_exam", { exam });
}

export function deleteExam(id: string): Promise<void> {
  return call<void>("delete_exam", { id });
}

export function listExamResults(): Promise<ExamResult[]> {
  return call<ExamResult[]>("list_exam_results");
}

export function saveExamResult(result: ExamResult): Promise<ExamResult> {
  return call<ExamResult>("save_exam_result", { result });
}

export function listSchedule(): Promise<ScheduleEntry[]> {
  return call<ScheduleEntry[]>("list_schedule");
}

export function saveScheduleEntry(entry: ScheduleEntry): Promise<ScheduleEntry> {
  return call<ScheduleEntry>("save_schedule_entry", { entry });
}

export function deleteScheduleEntry(id: string): Promise<void> {
  return call<void>("delete_schedule_entry", { id });
}

export function listAdminMessages(): Promise<AdminMessage[]> {
  return call<AdminMessage[]>("list_admin_messages");
}

export function saveAdminMessage(message: AdminMessage): Promise<AdminMessage> {
  return call<AdminMessage>("save_admin_message", { message });
}

export function deleteAdminMessage(id: string): Promise<void> {
  return call<void>("delete_admin_message", { id });
}

export function listActivity(limit?: number): Promise<ActivityEntry[]> {
  return call<ActivityEntry[]>("list_activity", { limit: limit ?? null });
}

// ── Eget schema ───────────────────────────────────────────────────────────
//
// Samma schemalagring som adminpanelen skriver till. Backend avgör vilka
// poster som hör till den inloggade personen och skickar bara dem.

/** Elevens och lärarens eget schema. Kräver en inloggad användare. */
export function mySchedule(): Promise<ScheduleEntry[]> {
  return call<ScheduleEntry[]>("my_schedule");
}

// ── Hjälpmedel ────────────────────────────────────────────────────────────

export const KIND_LABELS: Record<MaterialKind, string> = {
  summary: "Sammanfattning",
  quiz: "Quiz",
  flashcards: "Flashcards",
  "practice-exam": "Övningsprov",
  notes: "Anteckningar",
  "study-plan": "Studieplan",
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  latt: "Lätt",
  medel: "Medel",
  svar: "Svår",
};

/** Formaterar en tidsstämpel i millisekunder som svenskt datum. */
export function formatDate(ms: number): string {
  return new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

/** Kostnaden för ett anrop, avrundad så att små belopp syns. */
export function formatCost(cost: number | null | undefined): string | null {
  if (cost === null || cost === undefined) return null;
  if (cost === 0) return "0 kr";
  return `${cost.toFixed(cost < 0.01 ? 5 : 3)} USD`;
}
