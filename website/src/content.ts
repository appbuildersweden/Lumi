import { BookOpen, ListChecks, Sparkles, TrendingUp, type LucideIcon } from "lucide-react";

/**
 * Innehållet på webbplatsen samlas här, så att text och navigering går att
 * ändra på ett ställe. All text är på svenska och beskriver bara sådant som
 * faktiskt finns i Lumi – inga påståenden om funktioner som inte är byggda.
 */

export interface NavLink {
  href: string;
  label: string;
}

/** Menyns länkar. Avsnitten ligger på samma sida. */
export const NAV_LINKS: NavLink[] = [
  { href: "#startsida", label: "Startsida" },
  { href: "#funktioner", label: "Funktioner" },
  { href: "#om-lumi", label: "Om Lumi" },
];

/** Dit menyns och hjältens knappar leder. */
export const DOWNLOAD_ANCHOR = "#ladda-ner";

export interface Feature {
  id: string;
  icon: LucideIcon;
  title: string;
  text: string;
}

export const FEATURES: Feature[] = [
  {
    id: "ai",
    icon: Sparkles,
    title: "AI-stödd inlärning",
    text: "Fråga om det du tycker är svårt och få förklaringar steg för steg. Lumi utgår från ditt eget material i stället för att svara i allmänna ordalag.",
  },
  {
    id: "ovningar",
    icon: ListChecks,
    title: "Frågor och övningar",
    text: "Skapa quiz, flashcards och övningsprov ur materialet du arbetar med, och se vad du redan kan och vad som behöver repeteras.",
  },
  {
    id: "material",
    icon: BookOpen,
    title: "Studiematerial",
    text: "Sammanfattningar, anteckningar och studieplaner samlas per ämne, så att du hittar tillbaka till det du arbetade med.",
  },
  {
    id: "framsteg",
    icon: TrendingUp,
    title: "Framsteg",
    text: "Resultaten från dina övningar sparas och sammanställs, så att utvecklingen går att följa över tid i stället för att bara kännas av.",
  },
];

/** En ärlig rad om att appen fortfarande växer fram. */
export const FEATURES_NOTE =
  "Lumi är under utveckling. Funktionerna finns i appen och byggs ut steg för steg.";

export interface Step {
  title: string;
  text: string;
}

export const STEPS: Step[] = [
  {
    title: "Öppna Lumi",
    text: "Installera appen på din Windows-dator och logga in med det konto du har fått av skolan.",
  },
  {
    title: "Arbeta med ditt studiematerial och öva",
    text: "Utgå från ämnet du läser, ställ frågor om det du undrar över och skapa övningar att testa dig med.",
  },
  {
    title: "Följ dina framsteg och fortsätt lära dig",
    text: "Se vad som gick bra, repetera det som var svårt och fortsätt i din egen takt.",
  },
];

/**
 * Nedladdningen. Version 0.1.1 är publicerad och knappen är aktiv.
 *
 * Adressen är den fasta adressen till senaste releasen: filen heter alltid
 * `Lumi-setup.exe` där, så samma länk fungerar för varje version utan ändring.
 * Så länge `available` är false skapas ingen länk – knappen visar
 * "Kommer snart" i stället för en adress som inte leder någonstans.
 *
 * Hur en ny version publiceras finns i docs/release-och-uppdateringar.md.
 */
export interface DownloadInfo {
  available: boolean;
  url: string | null;
  version: string;
  requirements: string[];
  steps: string[];
}

export const DOWNLOAD: DownloadInfo = {
  available: true,
  url: "https://github.com/appbuildersweden/Lumi/releases/latest/download/Lumi-setup.exe",
  version: "0.1.1",
  requirements: [
    "Windows 10 eller 11 (64-bitars)",
    "Ingen administratörsbehörighet behövs – Lumi installeras för din egen användare",
  ],
  steps: [
    "Hämta installationsfilen",
    "Kör filen. Visar Windows en varning eftersom filen inte är signerad med ett kodsigneringscertifikat, välj Mer information och Kör ändå.",
    "Starta Lumi och logga in med kontot du har fått av skolan",
  ],
};

export const DOWNLOAD_TITLE = "Ladda ner Lumi för Windows";

export const DOWNLOAD_TEXT =
  "Lumi installeras på din Windows-dator och frågar aldrig om administratörsbehörighet. Hämta filen och kör den – sedan är appen redo att använda.";

/** Texten som visas i stället för knappen så länge filen saknas. */
export const DOWNLOAD_PENDING_NOTE =
  "Versionsnummer, systemkrav och installationssteg publiceras här när installationsfilen finns.";
