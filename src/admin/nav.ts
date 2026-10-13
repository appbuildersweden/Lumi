import {
  CalendarDays,
  ChartColumn,
  ClipboardCheck,
  ClipboardList,
  FileText,
  GraduationCap,
  House,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

export type AdminViewId =
  | "home"
  | "students"
  | "staff"
  | "accounts"
  | "roles"
  | "assignments"
  | "schedule-admin"
  | "student-assignments"
  | "student-exams"
  | "student-control"
  | "student-overview"
  | "admin-profile";

export interface AdminNavItem {
  id: AdminViewId;
  label: string;
  /** Vad kategorin ansvarar för. */
  scope: string;
  icon: LucideIcon;
}

/**
 * Sidopanelens sju poster: Startsida och de sex hanteringskategorierna, i den
 * ordning de visas. Fler kategorier läggs inte till här – Elev-uppgifter,
 * Elev-prov, Elev-kontroll, Elevöversikt, en egen lärarvy och en separat
 * Profilhantering sparas till senare uppdateringar.
 */
export const ADMIN_NAV: AdminNavItem[] = [
  {
    id: "home",
    label: "Startsida",
    scope: "Datum, vecka, nyheter, meddelanden och kommande händelser.",
    icon: House,
  },
  {
    id: "students",
    label: "Elever",
    scope: "Elevregistret: profiler, klass och koppling till konto.",
    icon: GraduationCap,
  },
  {
    id: "staff",
    label: "Personal",
    scope: "Lärare och övrig personal, med ämnen och konton.",
    icon: Users,
  },
  {
    id: "accounts",
    label: "Konton",
    scope: "Skapa konton, koppla dem till personer och återställa uppgifter.",
    icon: KeyRound,
  },
  {
    id: "roles",
    label: "Roller",
    scope: "Vad admin, lärare och elev får göra – och vem som har vilken roll.",
    icon: ShieldCheck,
  },
  {
    id: "schedule-admin",
    label: "Scheman-hantering",
    scope: "Lektioner, prov och aktiviteter i veckoschemat.",
    icon: CalendarDays,
  },
  {
    id: "assignments",
    label: "Uppgifter",
    scope: "Skapa, redigera och publicera uppgifter till klasser och elever.",
    icon: ClipboardList,
  },
];

/**
 * Vyer som finns kvar med sin kod och sina data, men som inte visas som egna
 * kategorier i sidopanelen ännu.
 *
 * De nås fortfarande inifrån kategorierna – till exempel en elevs samlade läge
 * från elevregistret, och den egna profilen från profilområdet längst ned.
 */
export const ADMIN_EXTRA_NAV: AdminNavItem[] = [
  {
    id: "student-assignments",
    label: "Elev-uppgifter",
    scope: "Inlämnat, saknat och försenat – per elev, klass och ämne.",
    icon: ClipboardCheck,
  },
  {
    id: "student-exams",
    label: "Elev-prov",
    scope: "Planerade och genomförda prov, deltagare och resultat.",
    icon: FileText,
  },
  {
    id: "student-control",
    label: "Elev-kontroll",
    scope: "Kontoproblem och uppgifter som behöver följas upp.",
    icon: ShieldAlert,
  },
  {
    id: "student-overview",
    label: "Elevöversikt",
    scope: "En elevs samlade läge: framsteg, uppgifter, prov och resultat.",
    icon: ChartColumn,
  },
  {
    id: "admin-profile",
    label: "Profilhantering",
    scope: "Ditt eget konto, rollen och utloggning.",
    icon: UserCog,
  },
];

/** Alla vyer, inklusive dem som ännu inte har en egen plats i sidopanelen. */
export const ALL_ADMIN_NAV: AdminNavItem[] = [...ADMIN_NAV, ...ADMIN_EXTRA_NAV];

export function adminNavItem(id: AdminViewId): AdminNavItem {
  return ALL_ADMIN_NAV.find((item) => item.id === id) ?? ADMIN_NAV[0];
}
