import { useMemo, useState } from "react";
import { KeyRound, Plus, Search } from "lucide-react";
import {
  createAccount,
  resetAccountPassword,
  setAccountActive,
  setAccountPerson,
  setAccountRole,
  type UserRole,
} from "../../lib/backend";
import { fullName, isStudent } from "../derive";
import type { AdminPageProps } from "../types";
import { AdminPage, ConfirmButton, Empty, Feedback, Tag, useFeedback } from "../ui";

const ROLES: UserRole[] = ["elev", "lärare", "admin"];

/** Konton: skapa, koppla till personer och återställ inloggningsuppgifter. */
export default function Accounts({ data }: AdminPageProps) {
  const feedback = useFeedback(data.reload);

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"ny" | "befintlig">("ny");
  const [personId, setPersonId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [className, setClassName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("elev");

  // Personer som ännu inte har något konto.
  const freePeople = useMemo(() => {
    const taken = new Set(
      data.accounts.map((account) => account.personId).filter((id): id is string => !!id)
    );
    return data.people.filter((person) => !taken.has(person.id));
  }, [data.accounts, data.people]);

  const accounts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.accounts.filter((account) => {
      if (!needle) return true;
      return [account.displayName, account.email, account.personName, account.className, account.roleLabel]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [data.accounts, query]);

  async function create() {
    const ok = await feedback.run(
      () =>
        createAccount({
          email,
          password,
          role,
          displayName: mode === "befintlig" ? "" : `${firstName} ${lastName}`.trim(),
          personId: mode === "befintlig" ? personId || null : null,
          firstName: mode === "befintlig" ? "" : firstName,
          lastName: mode === "befintlig" ? "" : lastName,
          className: mode === "befintlig" || role === "admin" ? "" : className,
        }),
      "Kontot skapades. Skriv ner lösenordet och ge det till personen."
    );

    if (ok) {
      setEmail("");
      setPassword("");
      setFirstName("");
      setLastName("");
      setClassName("");
      setPersonId("");
    }
  }

  const canCreate =
    email.trim().length > 0 &&
    password.length >= 8 &&
    (mode === "befintlig"
      ? personId !== ""
      : firstName.trim().length > 0 && lastName.trim().length > 0);

  return (
    <AdminPage
      badge={<KeyRound size={24} strokeWidth={1.8} aria-hidden />}
      eyebrow="Adminpanel"
      title="Konton"
      lead="Skapa konton, koppla dem till rätt person och återställ uppgifter. Lösenord lagras alltid som hash och visas aldrig igen."
    >
      <Feedback notice={feedback.notice} error={feedback.error} />

      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">
            <Plus className="panel__icon" size={18} strokeWidth={2.2} aria-hidden />
            Skapa konto
          </h2>
        </div>

        <p className="panel__text">
          Registrera personen och kontot i samma steg, eller koppla kontot till någon
          som redan finns i registret.
        </p>

        <div className="toolbar">
          <button
            type="button"
            className={`chip${mode === "ny" ? " is-on" : ""}`}
            onClick={() => setMode("ny")}
          >
            Ny person
          </button>
          <button
            type="button"
            className={`chip${mode === "befintlig" ? " is-on" : ""}`}
            onClick={() => setMode("befintlig")}
          >
            Befintlig person ({freePeople.length})
          </button>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>Roll</span>
            <select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
              {ROLES.map((item) => (
                <option key={item} value={item}>
                  {item === "elev" ? "Elev" : item === "lärare" ? "Lärare" : "Administratör"}
                </option>
              ))}
            </select>
          </label>

          {mode === "befintlig" ? (
            <label className="field">
              <span>Person</span>
              <select value={personId} onChange={(event) => setPersonId(event.target.value)}>
                <option value="">Välj person…</option>
                {freePeople.map((person) => (
                  <option key={person.id} value={person.id}>
                    {fullName(person)}
                    {person.className ? ` (${person.className})` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className="field">
                <span>Förnamn</span>
                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </label>
              <label className="field">
                <span>Efternamn</span>
                <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </label>
              {role === "elev" && (
                <label className="field">
                  <span>Klass</span>
                  <input
                    value={className}
                    onChange={(e) => setClassName(e.target.value)}
                    placeholder="9A"
                  />
                </label>
              )}
            </>
          )}

          <label className="field">
            <span>E-postadress</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="namn@edu.ronneby.se"
            />
          </label>

          <label className="field">
            <span>Lösenord (minst 8 tecken)</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
        </div>

        <div className="toolbar">
          <button
            type="button"
            className="button button--primary"
            onClick={create}
            disabled={feedback.busy || !canCreate}
          >
            Skapa kontot
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">
            <Search className="panel__icon" size={18} strokeWidth={2.2} aria-hidden />
            Alla konton ({accounts.length})
          </h2>
        </div>

        <label className="field">
          <span>Sök</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Namn, e-postadress eller klass"
          />
        </label>

        {accounts.length === 0 ? (
          <Empty
            title={query ? "Ingen träff." : "Inga konton ännu."}
            hint={
              query
                ? "Prova ett annat namn eller en annan adress."
                : "Skapa det första kontot ovan. Personer utan konto syns under Elever och Personal."
            }
          />
        ) : (
          <ul className="rows">
            {accounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                freePeople={freePeople}
                busy={feedback.busy}
                onRole={(next) =>
                  void feedback.run(
                    () => setAccountRole(account.id, next),
                    `Rollen ändrades till ${next}.`
                  )
                }
                onActive={(next) =>
                  void feedback.run(
                    () => setAccountActive(account.id, next),
                    next ? "Kontot aktiverades." : "Kontot inaktiverades."
                  )
                }
                onReset={(next) =>
                  void feedback.run(
                    () => resetAccountPassword(account.id, next),
                    "Lösenordet byttes. Ge det nya lösenordet till personen."
                  )
                }
                onLink={(id) =>
                  void feedback.run(
                    () => setAccountPerson(account.id, id),
                    id ? "Kontot kopplades till personen." : "Kopplingen togs bort."
                  )
                }
              />
            ))}
          </ul>
        )}
      </div>
    </AdminPage>
  );
}

interface AccountRowProps {
  account: AdminPageProps["data"]["accounts"][number];
  freePeople: AdminPageProps["data"]["people"];
  busy: boolean;
  onRole: (role: UserRole) => void;
  onActive: (active: boolean) => void;
  onReset: (password: string) => void;
  onLink: (personId: string | null) => void;
}

function AccountRow({
  account,
  freePeople,
  busy,
  onRole,
  onActive,
  onReset,
  onLink,
}: AccountRowProps) {
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [personId, setPersonId] = useState("");

  return (
    <li className="row">
      <div className="row__main">
        <span className="row__title">{account.displayName}</span>
        <span className="row__meta">
          {account.email}
          {account.personName ? ` · ${account.personName}` : " · Ingen person kopplad"}
          {account.className ? ` · ${account.className}` : ""}
        </span>
      </div>

      <div className="row__actions">
        <Tag tone={account.active ? "ok" : "bad"}>
          {account.active ? "Aktivt" : "Inaktiverat"}
        </Tag>

        <label className="field field--inline">
          <span>Roll</span>
          <select
            value={account.role}
            disabled={busy}
            onChange={(event) => onRole(event.target.value as UserRole)}
          >
            {ROLES.map((item) => (
              <option key={item} value={item}>
                {item === "elev" ? "Elev" : item === "lärare" ? "Lärare" : "Administratör"}
              </option>
            ))}
          </select>
        </label>

        <button type="button" className="button" onClick={() => setPasswordOpen((v) => !v)}>
          Nytt lösenord
        </button>

        {!account.personId && (
          <button type="button" className="button" onClick={() => setLinkOpen((v) => !v)}>
            Koppla person
          </button>
        )}

        <ConfirmButton
          label={account.active ? "Inaktivera" : "Aktivera"}
          question={
            account.active
              ? "Kontot inaktiveras. Personen kan inte logga in förrän det aktiveras igen."
              : "Kontot aktiveras igen."
          }
          confirmLabel={account.active ? "Ja, inaktivera" : "Ja, aktivera"}
          disabled={busy}
          onConfirm={() => onActive(!account.active)}
        />
      </div>

      {passwordOpen && (
        <div className="row__form">
          <label className="field">
            <span>Nytt lösenord (minst 8 tecken)</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          <div className="toolbar">
            <button
              type="button"
              className="button button--primary"
              disabled={password.length < 8}
              onClick={() => {
                onReset(password);
                setPassword("");
                setPasswordOpen(false);
              }}
            >
              Byt lösenord
            </button>
            <button type="button" className="button" onClick={() => setPasswordOpen(false)}>
              Avbryt
            </button>
          </div>
        </div>
      )}

      {linkOpen && !account.personId && (
        <div className="row__form">
          <label className="field">
            <span>Person utan konto</span>
            <select value={personId} onChange={(event) => setPersonId(event.target.value)}>
              <option value="">Välj person…</option>
              {freePeople.map((person) => (
                <option key={person.id} value={person.id}>
                  {fullName(person)}
                  {isStudent(person) && person.className ? ` (${person.className})` : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="toolbar">
            <button
              type="button"
              className="button button--primary"
              disabled={!personId}
              onClick={() => {
                onLink(personId);
                setLinkOpen(false);
              }}
            >
              Koppla
            </button>
            <button type="button" className="button" onClick={() => setLinkOpen(false)}>
              Avbryt
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
