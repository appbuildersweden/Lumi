import {
  BookOpen,
  CalendarDays,
  House,
  Info,
  Mail,
  MessagesSquare,
  TrendingUp,
  UserRound,
  type LucideIcon,
} from "lucide-react";

/** Kategorierna i sidomenyn. Ordningen är fast. */
export type ViewId =
  | "home"
  | "teacher-chat"
  | "study"
  | "schema"
  | "progress"
  | "info"
  | "messages"
  | "profile";

export interface NavItem {
  id: ViewId;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Text i sidans tomma läge. Utan den visas standardsidan. */
  emptyTitle?: string;
  emptyHint?: string;
}

/** Huvudnavigeringen, i den ordning den ska visas. */
export const PRIMARY_NAV: NavItem[] = [
  {
    id: "home",
    label: "Startsida",
    description: "Översikt över Lumi.",
    icon: House,
  },
  {
    id: "teacher-chat",
    label: "Lärare-Chat",
    description: "Få hjälp att förstå svåra ämnen, steg för steg.",
    icon: MessagesSquare,
  },
  {
    id: "study",
    label: "Plugga",
    description: "Dina lektioner och övningar finns här.",
    icon: BookOpen,
  },
  {
    id: "schema",
    label: "Schema",
    description: "Prov, deadlines, aktiviteter och planerade pluggtider.",
    icon: CalendarDays,
    emptyTitle: "Inget i schemat ännu.",
    emptyHint:
      "Här samlas dina prov, deadlines, aktiviteter och pluggtider när du lägger in dem.",
  },
  {
    id: "progress",
    label: "Framsteg",
    description: "Din utveckling och vad du har lärt dig över tid.",
    icon: TrendingUp,
    emptyTitle: "Inga framsteg att visa ännu.",
    emptyHint:
      "Så snart du har börjat plugga ser du din utveckling över tid här.",
  },
  {
    id: "info",
    label: "Information",
    description: "Information om Lumi och hur appen fungerar.",
    icon: Info,
  },
  {
    id: "messages",
    label: "Meddelanden",
    description: "Dina meddelanden samlas här.",
    icon: Mail,
  },
];

/** Profil ligger separat, längst ner i sidomenyn. */
export const PROFILE_ITEM: NavItem = {
  id: "profile",
  label: "Profil",
  description: "Din profil och dina inställningar.",
  icon: UserRound,
};

export const NAV_ITEMS: NavItem[] = [...PRIMARY_NAV, PROFILE_ITEM];
