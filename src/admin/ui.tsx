import { useCallback, useState, type ReactNode } from "react";
import { toLumiError } from "../lib/backend";

interface AdminPageProps {
  badge: ReactNode;
  eyebrow: string;
  title: string;
  lead: string;
  children: ReactNode;
}

/** Standardhuvudet för en sida i adminpanelen. */
export function AdminPage({ badge, eyebrow, title, lead, children }: AdminPageProps) {
  return (
    <section className="page page--wide">
      <span className="page__badge">{badge}</span>
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="page-title">{title}</h1>
      <p className="page-lead">{lead}</p>
      {children}
    </section>
  );
}

/** Tomt läge i stället för påhittat innehåll. */
export function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      <p className="empty__hint">{hint}</p>
    </div>
  );
}

interface Feedback {
  notice: string | null;
  error: string | null;
  busy: boolean;
  run: (action: () => Promise<unknown>, message: string) => Promise<boolean>;
  clear: () => void;
}

/**
 * Visar tydligt om en ändring sparades eller misslyckades.
 *
 * `run` kör ändringen, laddar om panelens data och sätter rätt meddelande.
 * Misslyckas den visas felet från backend, inte en tyst knapp.
 */
export function useFeedback(reload: () => Promise<void>): Feedback {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (action: () => Promise<unknown>, message: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await action();
        await reload();
        setNotice(message);
        return true;
      } catch (raw) {
        setError(toLumiError(raw).message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reload]
  );

  const clear = useCallback(() => {
    setNotice(null);
    setError(null);
  }, []);

  return { notice, error, busy, run, clear };
}

export function Feedback({ notice, error }: { notice: string | null; error: string | null }) {
  return (
    <>
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
    </>
  );
}

interface ConfirmButtonProps {
  label: string;
  question: string;
  confirmLabel?: string;
  disabled?: boolean;
  onConfirm: () => void;
}

/**
 * En knapp som frågar en gång innan något inte går att ångra, och som alltid
 * går att avbryta. Inget sparas förrän man bekräftar.
 */
export function ConfirmButton({
  label,
  question,
  confirmLabel = "Ja, fortsätt",
  disabled = false,
  onConfirm,
}: ConfirmButtonProps) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button
        type="button"
        className="button"
        disabled={disabled}
        onClick={() => setAsking(true)}
      >
        {label}
      </button>
    );
  }

  return (
    <span className="confirm">
      <span className="confirm__text">{question}</span>
      <button
        type="button"
        className="button button--danger"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="button" onClick={() => setAsking(false)}>
        Avbryt
      </button>
    </span>
  );
}

/** En liten etikett med status. */
export function Tag({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "ok" | "warn" | "bad" | "muted" | "info";
}) {
  return <span className={`tag tag--${tone}`}>{children}</span>;
}
