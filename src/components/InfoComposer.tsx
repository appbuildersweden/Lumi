import { useEffect, useState } from "react";
import {
  PRIORITY_LABELS,
  type AdminMessage,
  type Audience,
  type InfoRecipient,
  type Priority,
} from "../lib/backend";

interface InfoComposerProps {
  /** Posten som ändras, eller null när en ny skrivs. */
  editing: AdminMessage | null;
  /** Klasserna kontot får skicka till. */
  classes: string[];
  /** Eleverna kontot får skicka till, för en grupp. */
  recipients: InfoRecipient[];
  /** Sant när kontot får rikta information till hela skolan och personalen. */
  canAddressEveryone: boolean;
  busy: boolean;
  /** Sparar posten. Svarar sant när backend tog emot den. */
  onSave: (message: AdminMessage) => Promise<boolean>;
  onCancel: () => void;
}

/**
 * Formuläret för att skriva eller ändra en nyhet eller ett viktigt meddelande.
 *
 * Samma formulär används i adminpanelen och av en lärare med behörighet, så
 * valen – typ, mottagare, klass, grupp, vikt och text – kan aldrig skilja sig
 * mellan rollerna. Vilka mottagare som erbjuds styrs av vad backend svarade
 * om kontot, och samma regel kontrolleras en gång till när posten sparas.
 */
export default function InfoComposer({
  editing,
  classes,
  recipients,
  canAddressEveryone,
  busy,
  onSave,
  onCancel,
}: InfoComposerProps) {
  const [kind, setKind] = useState(editing?.kind ?? "nyhet");
  const [audience, setAudience] = useState<Audience>(
    editing?.audience ?? (canAddressEveryone ? "alla" : "klass")
  );
  const [priority, setPriority] = useState<Priority>(editing?.priority ?? "normal");
  const [title, setTitle] = useState(editing?.title ?? "");
  const [body, setBody] = useState(editing?.body ?? "");
  const [chosenClasses, setChosenClasses] = useState<string[]>(
    editing?.classNames ?? []
  );
  const [chosenStudents, setChosenStudents] = useState<string[]>(
    editing?.studentIds ?? []
  );

  // När en annan post öppnas för ändring fylls formuläret med dess innehåll.
  useEffect(() => {
    setKind(editing?.kind ?? "nyhet");
    setAudience(editing?.audience ?? (canAddressEveryone ? "alla" : "klass"));
    setPriority(editing?.priority ?? "normal");
    setTitle(editing?.title ?? "");
    setBody(editing?.body ?? "");
    setChosenClasses(editing?.classNames ?? []);
    setChosenStudents(editing?.studentIds ?? []);
  }, [editing, canAddressEveryone]);

  const needsClass = audience === "klass";
  const needsGroup = audience === "grupp";
  const ready =
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    (!needsClass || chosenClasses.length > 0) &&
    (!needsGroup || chosenStudents.length > 0);

  function toggle(list: string[], value: string, set: (next: string[]) => void) {
    set(
      list.includes(value)
        ? list.filter((item) => item !== value)
        : [...list, value]
    );
  }

  async function submit() {
    if (!ready) return;

    const saved = await onSave({
      id: editing?.id ?? "",
      kind,
      title: title.trim(),
      body: body.trim(),
      createdAtMs: editing?.createdAtMs ?? 0,
      authorName: editing?.authorName ?? "",
      authorId: editing?.authorId ?? "",
      audience,
      classNames: needsClass ? chosenClasses : [],
      studentIds: needsGroup ? chosenStudents : [],
      priority,
    });

    if (saved && !editing) {
      setTitle("");
      setBody("");
      setChosenClasses([]);
      setChosenStudents([]);
      setPriority("normal");
    }
  }

  return (
    <div className="info-composer">
      <div className="field-grid">
        <label className="field">
          <span>Typ</span>
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="nyhet">Nyhet</option>
            <option value="meddelande">Viktigt meddelande</option>
          </select>
        </label>

        <label className="field">
          <span>Mottagare</span>
          <select
            value={audience}
            onChange={(event) => setAudience(event.target.value as Audience)}
          >
            {canAddressEveryone && <option value="alla">Alla</option>}
            {canAddressEveryone && <option value="elever">Alla elever</option>}
            <option value="klass">En eller flera klasser</option>
            <option value="grupp">En grupp av elever</option>
            {canAddressEveryone && <option value="lärare">Alla lärare</option>}
          </select>
        </label>

        <label className="field">
          <span>Vikt</span>
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as Priority)}
          >
            {(["normal", "viktig", "akut"] as Priority[]).map((level) => (
              <option key={level} value={level}>
                {PRIORITY_LABELS[level]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {needsClass && (
        <div className="field">
          <span>Klasser</span>
          {classes.length === 0 ? (
            <p className="field__hint">
              Inga klasser att välja. Lägg till elever med klass under
              Elevhantering först.
            </p>
          ) : (
            <div className="chip-row">
              {classes.map((name) => {
                const active = chosenClasses.includes(name);
                return (
                  <button
                    key={name}
                    type="button"
                    className={`chip${active ? " is-on" : ""}`}
                    aria-pressed={active}
                    onClick={() => toggle(chosenClasses, name, setChosenClasses)}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {needsGroup && (
        <div className="field">
          <span>Elever</span>
          {recipients.length === 0 ? (
            <p className="field__hint">
              Inga elever att välja. Eleverna som går att rikta information till
              avgörs av dina klasser.
            </p>
          ) : (
            <div className="chip-row">
              {recipients.map((person) => {
                const active = chosenStudents.includes(person.id);
                return (
                  <button
                    key={person.id}
                    type="button"
                    className={`chip chip--student${active ? " is-on" : ""}`}
                    aria-pressed={active}
                    title={person.className}
                    onClick={() => toggle(chosenStudents, person.id, setChosenStudents)}
                  >
                    {person.name}
                    {person.className ? (
                      <span className="chip__meta">{person.className}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <label className="field field--wide">
        <span>Rubrik</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="t.ex. Prov i matematik på fredag"
        />
      </label>

      <label className="field field--wide">
        <span>Text</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          placeholder="Skriv informationen så att den går att förstå direkt."
        />
      </label>

      <div className="toolbar toolbar--tight">
        <button
          type="button"
          className="button button--primary"
          onClick={submit}
          disabled={busy || !ready}
        >
          {editing ? "Spara ändringen" : "Publicera"}
        </button>
        <button type="button" className="button" onClick={onCancel} disabled={busy}>
          Avbryt
        </button>
      </div>
    </div>
  );
}
