import type { LucideIcon } from "lucide-react";

interface PlaceholderPageProps {
  title: string;
  description: string;
  icon: LucideIcon;
  /** Rubrik i sidans tomma läge. */
  note?: string;
  /** Förklarande rad under rubriken. */
  hint?: string;
}

/** Enhetlig sida för de kategorier som byggs ut i senare delar. */
export default function PlaceholderPage({
  title,
  description,
  icon: Icon,
  note,
  hint,
}: PlaceholderPageProps) {
  return (
    <section className="page">
      <span className="page__badge">
        <Icon size={24} strokeWidth={1.8} aria-hidden />
      </span>

      <p className="eyebrow">Lumi</p>
      <h1 className="page-title">{title}</h1>
      <p className="page-lead">{description}</p>

      <div className="page__note">
        <p className="page__note-title">
          {note ?? "Den här sidan är en platshållare."}
        </p>
        <p className="page__note-hint">
          {hint ?? "Innehållet byggs i ett senare steg."}
        </p>
      </div>
    </section>
  );
}
