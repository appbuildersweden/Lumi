import type { Assignment, Exam, ExamResult, Person, Submission } from "../lib/backend";

// ── Datum och vecka ──────────────────────────────────────────────────────
//
// Datumet räknas ut lokalt i webbläsaren, så att "idag" stämmer med elevens
// och administratörens egen klocka och tidszon.

function two(value: number): string {
  return String(value).padStart(2, "0");
}

/** Dagens datum som ÅÅÅÅ-MM-DD, i lokal tid. */
export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

/** ISO-veckonummer, samma räknesätt som svenska kalendrar. */
export function isoWeek(now: Date = new Date()): number {
  const target = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  // Måndag = 1 … söndag = 7.
  const weekday = target.getUTCDay() || 7;
  // Flytta till veckans torsdag: den avgör vilket år och vilken vecka det är.
  target.setUTCDate(target.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/** Veckodagen skriven på svenska, med versal. */
export function weekdayName(now: Date = new Date()): string {
  const name = new Intl.DateTimeFormat("sv-SE", { weekday: "long" }).format(now);
  return name.charAt(0).toLocaleUpperCase("sv-SE") + name.slice(1);
}

/** Datumet skrivet som "14 maj 2026". */
export function longDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
}

/** Dagens veckodag enligt ISO: 1 = måndag … 7 = söndag. */
export function isoWeekday(now: Date = new Date()): number {
  const day = now.getDay();
  return day === 0 ? 7 : day;
}

/** Veckodagens namn på svenska, 1 = måndag. */
export function weekdayLabel(weekday: number): string {
  return (
    ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag", "Söndag"][weekday - 1] ??
    "Okänd dag"
  );
}

/** Ett ISO-datum skrivet som "14 maj". */
export function shortDate(iso: string): string {
  const parts = iso.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return iso;
  return new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short" }).format(
    new Date(parts[0], parts[1] - 1, parts[2])
  );
}

/** Hur många dagar ett ISO-datum ligger från idag. Negativt = passerat. */
export function daysUntil(iso: string, now: Date = new Date()): number {
  const parts = iso.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return 0;
  const target = new Date(parts[0], parts[1] - 1, parts[2]).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / 86_400_000);
}

// ── Statusar för uppgifter ───────────────────────────────────────────────

export type SubmissionStatus = "inlamnad" | "sen" | "saknad" | "vantar";

export interface SubmissionRow {
  assignment: Assignment;
  student: Person;
  status: SubmissionStatus;
  submittedAtMs: number | null;
  grade: string;
  comment: string;
}

export const SUBMISSION_LABELS: Record<SubmissionStatus, string> = {
  inlamnad: "Inlämnad",
  sen: "Försenad",
  saknad: "Saknas",
  vantar: "Väntar",
};

/** Färgen på etiketten för varje status. */
export const SUBMISSION_TONE: Record<
  SubmissionStatus,
  "ok" | "warn" | "bad" | "muted" | "info"
> = {
  inlamnad: "ok",
  sen: "warn",
  saknad: "bad",
  vantar: "muted",
};

/**
 * Räknar ut statusen för en elev och en uppgift.
 *
 * En inlämning efter deadline är försenad, ingen inlämning efter deadline är
 * saknad, och före deadline väntar den fortfarande. Ingen gissning: allt
 * bygger på de sparade datumen.
 */
export function statusFor(
  assignment: Assignment,
  submission: Submission | undefined,
  today = todayIso()
): SubmissionStatus {
  const overdue = assignment.dueDate < today;

  if (submission?.submittedAtMs) {
    return overdue && isoFromMs(submission.submittedAtMs) > assignment.dueDate
      ? "sen"
      : "inlamnad";
  }

  return overdue ? "saknad" : "vantar";
}

/** Datumet för en tidsstämpel i millisekunder, i lokal tid. */
export function isoFromMs(ms: number): string {
  return todayIso(new Date(ms));
}

/** Sant för en elevpost (inte personal). */
export function isStudent(person: Person): boolean {
  return person.kind === "elever";
}

/** Fullständigt namn, oavsett om något fält skulle vara tomt. */
export function fullName(person: Person): string {
  return `${person.firstName} ${person.lastName}`.trim();
}

/** De elever en uppgift gäller: valda elever plus alla i valda klasser. */
export function assignmentStudents(assignment: Assignment, people: Person[]): Person[] {
  return people.filter(
    (person) =>
      isStudent(person) &&
      (assignment.studentIds.includes(person.id) ||
        (person.className !== "" && assignment.classNames.includes(person.className)))
  );
}

/** De elever ett prov gäller. */
export function examStudents(exam: Exam, people: Person[]): Person[] {
  return people.filter(
    (person) =>
      isStudent(person) &&
      (exam.studentIds.includes(person.id) ||
        (person.className !== "" && exam.classNames.includes(person.className)))
  );
}

/** Alla klasser som förekommer i elevregistret. */
export function classNames(people: Person[]): string[] {
  const names = new Set<string>();
  for (const person of people) {
    if (isStudent(person) && person.className.trim()) {
      names.add(person.className.trim());
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, "sv-SE"));
}

/** Genomsnittlig andel rätt på ett prov, om något resultat finns. */
export function averageScore(results: ExamResult[]): number | null {
  const scored = results.filter(
    (result) =>
      result.score !== null && result.maxScore !== null && (result.maxScore ?? 0) > 0
  );
  if (scored.length === 0) return null;

  const sum = scored.reduce(
    (total, result) => total + (result.score ?? 0) / (result.maxScore ?? 1),
    0
  );
  return Math.round((sum / scored.length) * 100);
}
