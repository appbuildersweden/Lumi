import { useEffect, useState } from "react";
import { Info, Mail } from "lucide-react";
import {
  AUDIENCE_LABELS,
  formatDate,
  isMissingBackend,
  myAdminMessages,
  toLumiError,
  type AdminMessage,
} from "../lib/backend";

/** Texten som skiljer de två sidorna åt. */
const PAGES = {
  nyhet: {
    eyebrow: "Information",
    title: "Information från skolan",
    lead: "Nyheter och information som skolan har lagt ut till dig.",
    icon: Info,
    emptyTitle: "Ingen information ännu.",
    emptyHint:
      "Här samlas nyheter från skolan. Så snart något publiceras syns det här.",
  },
  meddelande: {
    eyebrow: "Meddelanden",
    title: "Viktiga meddelanden",
    lead: "Meddelanden som skolan vill att du ska läsa särskilt noga.",
    icon: Mail,
    emptyTitle: "Inga meddelanden ännu.",
    emptyHint: "Viktiga meddelanden från skolan hamnar här.",
  },
} as const;

interface AnnouncementsProps {
  /** `nyhet` visar information, `meddelande` visar viktiga meddelanden. */
  kind: "nyhet" | "meddelande";
}

/**
 * Skolans information och meddelanden, så som eleven och läraren ser dem.
 *
 * Allt kommer från backend, som avgör vad den inloggade får läsa utifrån sin
 * roll. Sidan filtrerar bara på typ – aldrig på behörighet.
 */
export default function Announcements({ kind }: AnnouncementsProps) {
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const page = PAGES[kind];

  useEffect(() => {
    let active = true;
    setLoading(true);

    myAdminMessages()
      .then((items) => {
        if (!active) return;
        setMessages(items.filter((item) => item.kind === kind));
      })
      .catch((raw) => {
        if (active && !isMissingBackend(raw)) setError(toLumiError(raw).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [kind]);

  const Icon = page.icon;

  return (
    <section className="page">
      <span className="page__badge">
        <Icon size={24} strokeWidth={1.8} aria-hidden />
      </span>

      <p className="eyebrow">{page.eyebrow}</p>
      <h1 className="page-title">{page.title}</h1>
      <p className="page-lead">{page.lead}</p>

      {error && <div className="notice notice--error">{error}</div>}

      {loading ? (
        <p className="panel__text" style={{ marginTop: 22 }}>
          Läser in …
        </p>
      ) : messages.length === 0 ? (
        <div className="page__note">
          <p className="page__note-title">{page.emptyTitle}</p>
          <p className="page__note-hint">{page.emptyHint}</p>
        </div>
      ) : (
        <ul className="message-list">
          {messages.map((message) => (
            <li key={message.id} className="message-item">
              <div className="message-item__head">
                <h2 className="message-item__title">{message.title}</h2>
                {message.audience !== "alla" && (
                  <span className="message-item__tag">
                    {AUDIENCE_LABELS[message.audience]}
                  </span>
                )}
              </div>

              <p className="message-item__body">{message.body}</p>

              <p className="message-item__meta">
                {message.authorName ? `${message.authorName} · ` : ""}
                {formatDate(message.createdAtMs)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
