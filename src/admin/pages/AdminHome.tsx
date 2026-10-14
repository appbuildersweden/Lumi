import { useMemo, useState } from "react";
import { CalendarDays, ListChecks, Megaphone, Plus } from "lucide-react";
import InfoComposer from "../../components/InfoComposer";
import {
  deleteAdminMessage,
  formatDate,
  saveAdminMessage,
  type AdminMessage,
} from "../../lib/backend";
import { audienceText } from "../../lib/info";
import MonthCalendar from "../MonthCalendar";
import { WEEKDAY_SHORT, weekdaysWithEntries } from "../calendar";
import { isoWeek, isoWeekday, longDate, weekdayLabel, weekdayName } from "../derive";
import type { AdminPageProps } from "../types";
import { ConfirmButton, Feedback, Tag, useFeedback } from "../ui";

/** Hur många uppdateringar som visas innan man får välja att visa fler. */
const UPDATES_PREVIEW = 3;

/** Hälsning efter tiden på dagen, samma typ av hälsning som på elevens sida. */
function greetingFor(hour: number): string {
  if (hour < 5) return "God natt";
  if (hour < 10) return "God morgon";
  if (hour < 12) return "God förmiddag";
  if (hour < 17) return "God eftermiddag";
  if (hour < 23) return "God kväll";
  return "God natt";
}

const DAYS = [1, 2, 3, 4, 5, 6, 7];

/**
 * Adminens startsida.
 *
 * Välkomstsektionen högst upp, och därefter fyra kompakta kort i två kolumner:
 * dagens schema, veckans schema, kalender och uppdateringar. Resten av
 * administrationen ligger under sina kategorier i sidopanelen.
 */
export default function AdminHome({ user, data, go }: AdminPageProps) {
  const now = new Date();
  const week = isoWeek(now);
  const day = isoWeekday(now);

  const feedback = useFeedback(data.reload);
  const [publishing, setPublishing] = useState(false);
  const [editing, setEditing] = useState<AdminMessage | null>(null);
  const [showAllUpdates, setShowAllUpdates] = useState(false);

  const byTime = (a: { start: string }, b: { start: string }) => a.start.localeCompare(b.start);

  const todayEntries = useMemo(
    () => data.schedule.filter((entry) => entry.weekday === day).sort(byTime),
    [data.schedule, day]
  );

  const weekEntries = useMemo(
    () =>
      DAYS.map((weekday) => ({
        weekday,
        entries: data.schedule.filter((entry) => entry.weekday === weekday).sort(byTime),
      })),
    [data.schedule]
  );

  const busyWeekdays = useMemo(() => weekdaysWithEntries(data.schedule), [data.schedule]);

  const updates = useMemo(
    () => [...data.messages].sort((a, b) => b.createdAtMs - a.createdAtMs),
    [data.messages]
  );

  const shownUpdates = showAllUpdates ? updates : updates.slice(0, UPDATES_PREVIEW);

  /** Sparar en ny eller ändrad post. Formuläret skickar hela innehållet. */
  async function save(message: AdminMessage) {
    const wasEdit = Boolean(editing);
    const ok = await feedback.run(
      () => saveAdminMessage(message),
      wasEdit ? "Uppdateringen sparades." : "Uppdateringen publicerades."
    );

    if (ok) {
      setEditing(null);
      setPublishing(false);
    }
    return ok;
  }

  return (
    <>
      {/* Välkomstsektionen – samma bannerbild och känsla som elevens sida. */}
      <header className="hero">
        <img
          className="hero__image"
          src="/ronneby.webp"
          alt="Ronneby – kanalen med gamla hus och blommor i förgrunden"
        />
        <span className="hero__scrim" aria-hidden />

        <div className="hero__content">
          <h1 className="hero__greeting">
            {greetingFor(now.getHours())}, {user.displayName}!
          </h1>
          <p className="hero__subtitle">
            {weekdayName(now)} {longDate(now)} · Vecka {week}
          </p>
          <p className="hero__subtitle">Lumi administration</p>
        </div>
      </header>

      <div className="admin-home">
        <Feedback notice={feedback.notice} error={feedback.error} />

        <div className="admin-grid">
          {/* Rad 1: dagens schema och veckans schema. */}
          <section className="panel panel--compact" aria-labelledby="admin-today-title">
            <div className="panel__head">
              <h2 className="panel__title" id="admin-today-title">
                <CalendarDays className="panel__icon" size={18} strokeWidth={2.1} aria-hidden />
                Dagens schema
              </h2>
              <button
                type="button"
                className="link-inline"
                onClick={() => go("schedule-admin")}
                title="Öppna scheman-hantering"
              >
                {weekdayLabel(day)}
              </button>
            </div>

            {todayEntries.length === 0 ? (
              <p className="card__empty">Inget inlagt idag.</p>
            ) : (
              <ul className="compact-list">
                {todayEntries.map((entry) => (
                  <li className="compact-list__item" key={entry.id}>
                    <span className="compact-list__time">
                      {entry.start}
                      {entry.end ? `–${entry.end}` : ""}
                    </span>
                    <span className="compact-list__main">
                      <span className="compact-list__title">{entry.title}</span>
                      <span className="compact-list__meta">
                        {[entry.kind, entry.subject, entry.className, entry.room]
                          .filter(Boolean)
                          .join(" · ") || "Ingen plats angiven"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel panel--compact" aria-labelledby="admin-week-title">
            <div className="panel__head">
              <h2 className="panel__title" id="admin-week-title">
                <ListChecks className="panel__icon" size={18} strokeWidth={2.1} aria-hidden />
                Veckans schema
              </h2>
              <span className="panel__label">Vecka {week}</span>
            </div>

            {data.schedule.length === 0 ? (
              <p className="card__empty">Inget schema tillagt ännu.</p>
            ) : (
              <ul className="week-list">
                {weekEntries.map(({ weekday, entries }) => (
                  <li
                    className={`week-row${weekday === day ? " is-today" : ""}`}
                    key={weekday}
                  >
                    <span className="week-row__day" title={weekdayLabel(weekday)}>
                      {WEEKDAY_SHORT[weekday - 1]}
                    </span>
                    <span className="week-row__slots">
                      {entries.length === 0 ? (
                        <span className="week-row__slots--empty">Inget inlagt</span>
                      ) : (
                        entries.map((entry) => (
                          <span key={entry.id} className="week-row__slot">
                            <strong>{entry.start}</strong> {entry.title}
                            {entry.className ? ` · ${entry.className}` : ""}
                          </span>
                        ))
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Rad 2: kalendern och uppdateringarna. */}
          <MonthCalendar weekdaysWithEntries={busyWeekdays} />

          <section className="panel panel--compact" aria-labelledby="admin-updates-title">
            <div className="panel__head">
              <h2 className="panel__title" id="admin-updates-title">
                <Megaphone className="panel__icon" size={18} strokeWidth={2.1} aria-hidden />
                Uppdateringar
              </h2>
              <button
                type="button"
                className="icon-button"
                onClick={() => {
                  setEditing(null);
                  setPublishing((open) => !open);
                }}
                aria-expanded={publishing}
                aria-label="Ny uppdatering"
                title="Ny uppdatering"
              >
                <Plus size={16} strokeWidth={2.2} aria-hidden />
              </button>
            </div>

            {updates.length === 0 ? (
              <p className="card__empty">Inga uppdateringar ännu.</p>
            ) : (
              <>
                <ul className="compact-list">
                  {shownUpdates.map((message) => (
                    <li className="compact-list__item" key={message.id}>
                      <span className="compact-list__main">
                        <span className="compact-list__title">
                          {message.title}
                          <Tag tone={message.kind === "meddelande" ? "warn" : "info"}>
                            {message.kind === "meddelande" ? "Meddelande" : "Nyhet"}
                          </Tag>
                          {message.audience !== "alla" && (
                            <Tag tone="muted">{audienceText(message)}</Tag>
                          )}
                          {message.priority !== "normal" && (
                            <Tag tone={message.priority === "akut" ? "bad" : "warn"}>
                              {message.priority === "akut" ? "Akut" : "Viktig"}
                            </Tag>
                          )}
                        </span>
                        <span className="compact-list__meta clamp-2">
                          {message.body} · {message.authorName} ·{" "}
                          {formatDate(message.createdAtMs)}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="button"
                        disabled={feedback.busy}
                        onClick={() => {
                          setEditing(message);
                          setPublishing(true);
                        }}
                      >
                        Ändra
                      </button>
                      <ConfirmButton
                        label="Ta bort"
                        question="Ta bort uppdateringen?"
                        confirmLabel="Ja, ta bort"
                        onConfirm={() =>
                          void feedback.run(
                            () => deleteAdminMessage(message.id),
                            "Uppdateringen togs bort."
                          )
                        }
                      />
                    </li>
                  ))}
                </ul>

                {updates.length > UPDATES_PREVIEW && (
                  <div className="toolbar toolbar--tight">
                    <button
                      type="button"
                      className="link-inline"
                      onClick={() => setShowAllUpdates((all) => !all)}
                    >
                      {showAllUpdates
                        ? "Visa färre"
                        : `Visa alla ${updates.length} uppdateringar`}
                    </button>
                  </div>
                )}
              </>
            )}

            {publishing && (
              <InfoComposer
                editing={editing}
                classes={data.classes}
                recipients={data.recipients}
                canAddressEveryone
                busy={feedback.busy}
                onSave={save}
                onCancel={() => {
                  setPublishing(false);
                  setEditing(null);
                }}
              />
            )}
          </section>
        </div>

        <p className="home__footer">Lumi · Adminpanel</p>
      </div>
    </>
  );
}
