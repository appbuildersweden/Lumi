import {
  BookOpen,
  CalendarDays,
  House,
  Info,
  Mail,
  MessagesSquare,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { Logo } from "./Logo";

/**
 * En ritad förhandsvisning av appens gränssnitt. Det är ingen skärmbild – den
 * är byggd i CSS för att visa hur Lumi ser ut, med samma meny och samma färger
 * som appen. Alla mått är relativa till behållarens bredd, så bilden skalar
 * utan att bli suddig.
 */
const MENU = [
  { icon: House, label: "Startsida", active: true },
  { icon: MessagesSquare, label: "Lärare-Chat" },
  { icon: BookOpen, label: "Plugga" },
  { icon: CalendarDays, label: "Schema" },
  { icon: TrendingUp, label: "Framsteg" },
  { icon: Info, label: "Information" },
  { icon: Mail, label: "Meddelanden" },
];

const MATERIALS = [
  { kind: "Sammanfattning", subject: "Kemi", topic: "Atomer och bindningar" },
  { kind: "Quiz", subject: "Historia", topic: "Industrialiseringen" },
  { kind: "Flashcards", subject: "Spanska", topic: "Verb i presens" },
];

export function AppPreview() {
  return (
    <div className="mock" aria-hidden="true">
      <div className="mock__window">
        <div className="mock__sidebar">
          <div className="mock__brand">
            <Logo size="mock" decorative />
          </div>

          <ul className="mock__menu">
            {MENU.map((item) => (
              <li key={item.label} className={`mock__menu-item${item.active ? " is-active" : ""}`}>
                <item.icon size="1.05em" aria-hidden="true" />
                <span>{item.label}</span>
              </li>
            ))}
          </ul>

          <div className="mock__menu-item mock__menu-item--profile">
            <UserRound size="1.05em" aria-hidden="true" />
            <span>Profil</span>
          </div>
        </div>

        <div className="mock__main">
          <div className="mock__banner">
            <p className="mock__greeting">God eftermiddag!</p>
            <p className="mock__greeting-sub">Här är din översikt för dagen.</p>
          </div>

          <div className="mock__stats">
            <div className="mock__stat">
              <span className="mock__stat-label">Övningar den här veckan</span>
              <span className="mock__stat-value">12</span>
            </div>
            <div className="mock__stat">
              <span className="mock__stat-label">Rätt svar</span>
              <span className="mock__stat-value">8 av 10</span>
            </div>
          </div>

          <p className="mock__heading">Senaste material</p>
          <ul className="mock__materials">
            {MATERIALS.map((material) => (
              <li key={material.kind} className="mock__material">
                <span className="mock__chip">{material.kind}</span>
                <span className="mock__material-text">
                  <strong>{material.subject}</strong>
                  {material.topic}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
