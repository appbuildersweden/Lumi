//! Kalenderberäkning för adminpanelen.
//!
//! Allt räknas ut ur `Date`, så att månadens längd, veckodagar och skottår
//! alltid stämmer. Inga datum är hårdkodade.

export const MONTH_NAMES = [
  "januari",
  "februari",
  "mars",
  "april",
  "maj",
  "juni",
  "juli",
  "augusti",
  "september",
  "oktober",
  "november",
  "december",
];

/** Veckodagarna med måndag först, som svensk kalender. */
export const WEEKDAY_NAMES = [
  "Måndag",
  "Tisdag",
  "Onsdag",
  "Torsdag",
  "Fredag",
  "Lördag",
  "Söndag",
];

export const WEEKDAY_SHORT = ["Mån", "Tis", "Ons", "Tors", "Fre", "Lör", "Sön"];

/** En ruta i månadsrutnätet. */
export interface CalendarDay {
  /** Datumet i lokal tid. */
  date: Date;
  /** Dagen i månaden, 1–31. */
  day: number;
  /** Falskt för dagarna som hör till månaden före eller efter. */
  inMonth: boolean;
  isToday: boolean;
  /** Veckodag enligt ISO: 1 = måndag … 7 = söndag. */
  isoWeekday: number;
}

function two(value: number): string {
  return String(value).padStart(2, "0");
}

/** Datumet som ÅÅÅÅ-MM-DD i lokal tid. */
export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** Veckodag enligt ISO: 1 = måndag … 7 = söndag. */
export function isoWeekdayOf(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

/** Månadens namn och år, som "oktober 2026". */
export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[((month % 12) + 12) % 12]} ${year}`;
}

/** Månaden före eller efter, med rätt årsskifte. */
export function shiftMonth(
  year: number,
  month: number,
  delta: number
): { year: number; month: number } {
  const shifted = new Date(year, month + delta, 1);
  return { year: shifted.getFullYear(), month: shifted.getMonth() };
}

/** Veckodagarna (ISO) som har minst en post i schemat. */
export function weekdaysWithEntries(entries: { weekday: number }[]): number[] {
  return [...new Set(entries.map((entry) => entry.weekday))].sort((a, b) => a - b);
}

/**
 * Månadsrutnätet med måndag som första dag.
 *
 * Rutnätet har alltid sex veckor, så att kortet inte ändrar höjd när man
 * bläddrar. Rutor utanför månaden fylls ut med dagar från månaderna intill och
 * markeras med `inMonth: false`.
 */
export function monthGrid(year: number, month: number, today: Date = new Date()): CalendarDay[] {
  const first = new Date(year, month, 1);
  // Måndag = 0, så att rutnätet börjar på rätt veckodag.
  const leading = (first.getDay() + 6) % 7;

  return Array.from({ length: 42 }, (_, index) => {
    // Dag 1 minus antalet inledande dagar ger första rutan. Date hanterar
    // automatiskt månadens längd och skottår.
    const date = new Date(year, month, 1 - leading + index);
    return {
      date,
      day: date.getDate(),
      inMonth: date.getMonth() === ((month % 12) + 12) % 12 && date.getFullYear() === year,
      isToday:
        date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth() &&
        date.getDate() === today.getDate(),
      isoWeekday: isoWeekdayOf(date),
    };
  });
}
