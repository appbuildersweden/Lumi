import { ShieldCheck } from "lucide-react";
import { ROLE_LABELS, setAccountRole, type UserRole } from "../../lib/backend";
import type { AdminPageProps } from "../types";
import { AdminPage, Empty, Feedback, Tag, useFeedback } from "../ui";

const ROLE_OPTIONS: UserRole[] = ["elev", "lärare", "admin"];

/**
 * Roller och behörigheter.
 *
 * Listan över vad varje roll får göra kommer från backend, liksom rollen på
 * varje konto. Gränssnittet hittar inte på egna behörigheter, och en elev eller
 * lärare kan inte ändra sin egen roll – kommandot nekas i backend.
 */
export default function Roles({ data }: AdminPageProps) {
  const feedback = useFeedback(data.reload);

  const counts = (slug: UserRole) =>
    data.accounts.filter((account) => account.role === slug).length;

  return (
    <AdminPage
      badge={<ShieldCheck size={24} strokeWidth={1.8} aria-hidden />}
      eyebrow="Adminpanel"
      title="Roller"
      lead="Tre roller styr vad man kommer till efter inloggningen. Rollen läses alltid från backend."
    >
      <Feedback notice={feedback.notice} error={feedback.error} />

      <div className="admin-cols">
        {data.roles.map((role) => (
          <div className="panel" key={role.slug}>
            <div className="panel__head">
              <h2 className="panel__title">{role.label}</h2>
              <Tag tone={role.slug === "admin" ? "info" : "muted"}>{counts(role.slug)} konton</Tag>
            </div>

            <p className="panel__text">{role.description}</p>
            <p className="panel__hint">Efter inloggning: {role.landsIn}</p>

            <ul className="section-block__bullets">
              {role.can.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Vem har vilken roll</h2>
        </div>

        <p className="panel__text">
          Den sista administratören kan inte byta roll eller inaktiveras, så att
          panelen aldrig låses ute. Eleven och läraren kan inte ändra sin egen roll.
        </p>

        {data.accounts.length === 0 ? (
          <Empty
            title="Inga konton att visa."
            hint="Skapa konton under Konton, så går rollerna att ändra här."
          />
        ) : (
          <ul className="rows">
            {data.accounts.map((account) => (
              <li key={account.id} className="row">
                <div className="row__main">
                  <span className="row__title">{account.displayName}</span>
                  <span className="row__meta">
                    {account.email}
                    {account.personName ? ` · ${account.personName}` : ""}
                  </span>
                </div>

                <div className="row__actions">
                  <Tag tone={account.active ? "ok" : "bad"}>
                    {account.active ? account.roleLabel : "Inaktiverat"}
                  </Tag>
                  <label className="field field--inline">
                    <span>Roll</span>
                    <select
                      value={account.role}
                      disabled={feedback.busy}
                      onChange={(event) =>
                        void feedback.run(
                          () => setAccountRole(account.id, event.target.value as UserRole),
                          `Rollen ändrades till ${ROLE_LABELS[event.target.value as UserRole]}.`
                        )
                      }
                    >
                      {ROLE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {ROLE_LABELS[option]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminPage>
  );
}
