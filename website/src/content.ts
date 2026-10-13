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
 * Nedladdningen. Installationsfilen finns inte ännu, och därför visas inga
 * uppgifter om version, systemkrav eller installationssteg i gränssnittet.
 *
 * När filen är byggd och publicerad: sätt `available` till true, fyll i `url`
 * och lägg till de uppgifter som gäller. Ingen annan ändring behövs – sektionen
 * visar då en riktig nedladdningsknapp i stället för "Kommer snart".
 */
export interface DownloadInfo {
  available: boolean;
  url: string | null;
  version: string;
  requirements: string[];
  steps: string[];
}

export const DOWNLOAD: DownloadInfo = {
  available: false,
  url: null,
  version: "",
  requirements: [],
  steps: [],
};

export const DOWNLOAD_TITLE = "Ladda ner Lumi för Windows";

export const DOWNLOAD_TEXT =
  "Lumi installeras på din Windows-dator. Installationsfilen är inte publicerad ännu, så knappen visar Kommer snart tills den finns att hämta.";

/** Texten som visas i stället för knappen så länge filen saknas. */
export const DOWNLOAD_PENDING_NOTE =
  "Versionsnummer, systemkrav och installationssteg publiceras här när installationsfilen finns.";
