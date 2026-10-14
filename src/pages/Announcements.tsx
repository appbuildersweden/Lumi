import { useCallback, useEffect, useState } from "react";
import { Info, Mail, Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import InfoComposer from "../components/InfoComposer";
import {
  canManageInfo,
  canPublishInfo,
  deleteAdminMessage,
  formatDate,
  isMissingBackend,
  listClasses,
  listInfoRecipients,
  myAdminMessages,
  saveAdminMessage,
  toLumiError,
  type AdminMessage,
  type InfoRecipient,
  type PublicUser,
} from "../lib/backend";
import { audienceText, priorityText, sortMessages } from "../lib/info";

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
  /** Det inloggade kontot. Behörigheten avgör om publicering visas. */
  user: PublicUser;
}

/**
 * Skolans information och meddelanden, så som eleven, läraren och
 * administratören ser dem.
 *
 * Allt kommer från backend, som avgör vad den inloggade får läsa utifrån sin
 * roll och sin klass. Sidan filtrerar bara på typ – aldrig på behörighet.
 * Den som har behörighet att publicera får dessutom skriva, ändra och ta bort
 * information här.
 */
export default function Announcements({ kind, user }: AnnouncementsProps) {
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [classes, setClasses] = useState<string[]>([]);
  const [recipients, setRecipients] = useState<InfoRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const [editing, setEditing] = useState<AdminMessage | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const page = PAGES[kind];
  const mayPublish = canPublishInfo(user);
  const mayManageAll = canManageInfo(user);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const items = await myAdminMessages();
      setMessages(items.filter((item) => item.kind === kind));
      setError(null);
    } catch (raw) {
      // Utan backend visas inget fel – appen är då bara en webbläsarflik.
      if (!isMissingBackend(raw)) setError(toLumiError(raw).message);
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    void load();
  }, [load]);

  // Klasserna och eleverna behövs bara av den som får publicera.
  useEffect(() => {
    if (!mayPublish) return undefined;
    let active = true;

    listClasses()
      .then((names) => {
        if (active) setClasses(names);
      })
      .catch(() => {
        // Utan klasslistan går det fortfarande att publicera till alla elever.
      });

    listInfoRecipients()
      .then((people) => {
        if (active) setRecipients(people);
      })
      .catch(() => {
        // Utan elevlistan går det fortfarande att publicera till en klass.
      });

    return () => {
      active = false;
    };
  }, [mayPublish]);

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await action();
      await load();
      setNotice(message);
      return true;
    } catch (raw) {
      setError(toLumiError(raw).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save(message: AdminMessage) {
    const wasEdit = Boolean(editing);
    const saved = await run(
      () => saveAdminMessage(message),
      wasEdit ? "Informationen sparades." : "Informationen publicerades."
    );

    if (saved) {
      setWriting(false);
      setEditing(null);
    }
    return saved;
  }

  /** Sant när den inloggade får ändra eller ta bort just den här posten. */
  function mayEdit(message: AdminMessage): boolean {
    return mayManageAll || (mayPublish && message.authorId === user.id);
  }

  const Icon = page.icon;
  const shown = sortMessages(messages);

  return (
    <section className="page">
      <span className="page__badge">
        <Icon size={24} strokeWidth={1.8} aria-hidden />
      </span>

      <p className="eyebrow">{page.eyebrow}</p>
      <h1 className="page-title">{page.title}</h1>
      <p className="page-lead">{page.lead}</p>

      {mayPublish && (
        <div className="toolbar toolbar--tight">
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              setEditing(null);
              setWriting((open) => !open);
            }}
            aria-expanded={writing}
          >
            <Plus size={16} strokeWidth={2.2} aria-hidden />
            {writing ? "Stäng" : "Publicera information"}
          </button>
        </div>
      )}

      {writing && mayPublish && (
        <InfoComposer
          editing={editing}
          classes={classes}
          recipients={recipients}
          canAddressEveryone={mayManageAll}
          busy={busy}
          onSave={save}
          onCancel={() => {
            setWriting(false);
            setEditing(null);
          }}
        />
      )}

      {notice && (
        <div className="notice notice--ok" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <p className="panel__text" style={{ marginTop: 22 }}>
          Läser in …
        </p>
      ) : shown.length === 0 ? (
        <div className="page__note">
          <p className="page__note-title">{page.emptyTitle}</p>
          <p className="page__note-hint">{page.emptyHint}</p>
        </div>
      ) : (
        <ul className="message-list">
          {shown.map((message) => (
            <li
              key={message.id}
              className={`message-item message-item--${message.priority}`}
            >
              <h2 className="message-item__title">{message.title}</h2>

              <div className="message-item__head">
                <span className={`message-item__priority is-${message.priority}`}>
                  {priorityText(message.priority)}
                </span>
                <span className="message-item__tag">{audienceText(message)}</span>
                {message.kind === "meddelande" && (
                  <span className="message-item__tag message-item__tag--quiet">
                    Meddelande
                  </span>
                )}
              </div>

              <p className="message-item__body">{message.body}</p>

              <div className="message-item__foot">
                <p className="message-item__meta">
                  {message.authorName ? `${message.authorName} · ` : ""}
                  {formatDate(message.createdAtMs)}
                </p>

                {mayEdit(message) && (
                  <div className="message-item__actions">
                    <button
                      type="button"
                      className="icon-button"
                      title="Ändra"
                      aria-label={`Ändra ${message.title}`}
                      disabled={busy}
                      onClick={() => {
                        setEditing(message);
                        setWriting(true);
                        setNotice(null);
                      }}
                    >
                      <Pencil size={15} strokeWidth={2.1} aria-hidden />
                    </button>

                    {removing === message.id ? (
                      <>
                        <button
                          type="button"
                          className="button button--danger"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () => deleteAdminMessage(message.id),
                              "Informationen togs bort."
                            ).then(() => setRemoving(null))
                          }
                        >
                          Ja, ta bort
                        </button>
                        <button
                          type="button"
                          className="button"
                          onClick={() => setRemoving(null)}
                        >
                          Avbryt
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="icon-button"
                        title="Ta bort"
                        aria-label={`Ta bort ${message.title}`}
                        disabled={busy}
                        onClick={() => setRemoving(message.id)}
                      >
                        <Trash2 size={15} strokeWidth={2.1} aria-hidden />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {mayPublish && shown.length > 0 && (
        <p className="panel__hint">
          <Megaphone size={14} strokeWidth={2.1} aria-hidden /> Du ser listan som
          publicerare. Eleverna ser bara det som gäller dem och deras klass.
        </p>
      )}
    </section>
  );
}
