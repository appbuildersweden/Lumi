import { useState } from "react";
import { KeyRound, LogOut, Save, UserCog } from "lucide-react";
import {
  changePassword,
  formatDate,
  ROLE_LABELS,
  toLumiError,
  updateProfile,
  type PublicUser,
} from "../../lib/backend";
import { fullName } from "../derive";
import type { AdminPageProps } from "../types";
import { AdminPage, Tag, useFeedback } from "../ui";

/**
 * Profilhantering: administratörens eget konto.
 *
 * Namn och e-postadress går att ändra och sparas i Lumis egen användardatabas,
 * så att de finns kvar efter utloggning. Lösenordet byts genom att det
 * nuvarande lösenordet anges först – backend kontrollerar det. Rollen kan inte
 * ändras här, och det egna kontot kan inte ge sig själv nya behörigheter.
 */
export default function AdminProfile({ user, data, onSignOut, onUserChange }: AdminPageProps) {
  const feedback = useFeedback(data.reload);

  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);

  const person = data.accounts.find((account) => account.id === user.id) ?? null;
  const fullPerson = person
    ? data.people.find((item) => item.id === person.personId) ?? null
    : null;

  const ownActivity = data.activity.filter((entry) => entry.actorId === user.id).slice(0, 8);

  const unchanged = displayName.trim() === user.displayName && email.trim() === user.email;

  async function saveProfile() {
    await feedback.run(async () => {
      // Svaret från backend är sanningen, så fälten fylls i med det som sparades.
      const updated: PublicUser = await updateProfile(displayName.trim(), email.trim());
      setDisplayName(updated.displayName);
      setEmail(updated.email);
      // Sidopanelen visar samma namn direkt, utan att appen startas om.
      onUserChange?.(updated);
    }, "Uppgifterna sparades.");
  }

  async function savePassword() {
    setPasswordError(null);
    setPasswordNotice(null);

    if (newPassword !== repeatPassword) {
      setPasswordError("De nya lösenorden stämmer inte överens.");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("Det nya lösenordet måste vara minst 8 tecken.");
      return;
    }
    if (currentPassword.length === 0) {
      setPasswordError("Ange ditt nuvarande lösenord.");
      return;
    }

    setPasswordBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setRepeatPassword("");
      setPasswordNotice("Lösenordet byttes. Använd det nya nästa gång du loggar in.");
    } catch (raw) {
      setPasswordError(toLumiError(raw).message);
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <AdminPage
      badge={<UserCog size={24} strokeWidth={1.8} aria-hidden />}
      eyebrow="Adminpanel"
      title="Profilhantering"
      lead="Ditt eget konto i Lumi: namn, e-postadress, lösenord och utloggning. Rollen bestäms i backend."
    >
      {feedback.notice && (
        <div className="notice notice--ok" role="status">
          {feedback.notice}
        </div>
      )}
      {feedback.error && (
        <div className="notice notice--error" role="alert">
          {feedback.error}
        </div>
      )}

      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Mina uppgifter</h2>
          <Tag tone={user.active ? "ok" : "warn"}>
            {user.active ? user.roleLabel : "Kontot är inaktiverat"}
          </Tag>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>Namn</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Ditt namn"
              autoComplete="name"
            />
          </label>
          <label className="field">
            <span>E-postadress</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="namn@edu.ronneby.se"
              autoComplete="email"
            />
          </label>
        </div>

        <div className="toolbar">
          <button
            type="button"
            className="button button--primary"
            onClick={saveProfile}
            disabled={feedback.busy || unchanged || !displayName.trim() || !email.trim()}
          >
            <Save size={15} strokeWidth={2.1} aria-hidden />
            Spara uppgifterna
          </button>
          <button
            type="button"
            className="button"
            onClick={() => {
              setDisplayName(user.displayName);
              setEmail(user.email);
            }}
            disabled={unchanged}
          >
            Ångra
          </button>
        </div>

        <ul className="section-block__bullets">
          <li>Roll: {ROLE_LABELS[user.role]}</li>
          <li>
            Kopplad person:{" "}
            {fullPerson ? fullName(fullPerson) : "kontot är inte kopplat till någon person"}
          </li>
          {person?.className && <li>Klass: {person.className}</li>}
        </ul>

        <p className="hint">
          Rollen ändras under Konton och Roller av en behörig administratör. E-postadressen
          är den du loggar in med.
        </p>
      </div>

      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">
            <KeyRound className="panel__icon" size={18} strokeWidth={2.2} aria-hidden />
            Byt lösenord
          </h2>
        </div>

        {passwordNotice && (
          <div className="notice notice--ok" role="status">
            {passwordNotice}
          </div>
        )}
        {passwordError && (
          <div className="notice notice--error" role="alert">
            {passwordError}
          </div>
        )}

        <div className="field-grid">
          <label className="field">
            <span>Nuvarande lösenord</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <label className="field">
            <span>Nytt lösenord (minst 8 tecken)</span>
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="field">
            <span>Upprepa nytt lösenord</span>
            <input
              type="password"
              value={repeatPassword}
              onChange={(event) => setRepeatPassword(event.target.value)}
              autoComplete="new-password"
            />
          </label>
        </div>

        <div className="toolbar">
          <button
            type="button"
            className="button button--primary"
            onClick={savePassword}
            disabled={passwordBusy || !currentPassword || !newPassword || !repeatPassword}
          >
            Byt lösenord
          </button>
        </div>

        <p className="hint">
          Lösenordet lagras alltid som en hash och visas aldrig. Det nuvarande lösenordet
          måste anges för att bytet ska gå igenom.
        </p>
      </div>

      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Mina senaste ändringar</h2>
        </div>

        {ownActivity.length === 0 ? (
          <p className="hint">Inga administrativa ändringar är loggade för ditt konto ännu.</p>
        ) : (
          <ul className="rows">
            {ownActivity.map((entry) => (
              <li className="row" key={entry.id}>
                <div className="row__main">
                  <span className="row__title">{entry.action}</span>
                  <span className="row__meta">
                    {entry.detail ? `${entry.detail} · ` : ""}
                    {formatDate(entry.atMs)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Utloggning</h2>
        </div>
        <p className="panel__text">
          Du loggas ut direkt. Sessionen ligger i appen och sparas varken på disk eller i
          webbläsaren.
        </p>
        <div className="toolbar">
          <button type="button" className="button" onClick={onSignOut}>
            <LogOut size={16} strokeWidth={2.1} aria-hidden /> Logga ut
          </button>
        </div>
      </div>
    </AdminPage>
  );
}
