import { useMemo, useState } from "react";
import { CalendarDays, Plus } from "lucide-react";
import { deleteScheduleEntry, saveScheduleEntry } from "../../lib/backend";
import { classNames, fullName, isoWeek, isoWeekday, isStudent, weekdayLabel } from "../derive";
import type { AdminPageProps } from "../types";
import { AdminPage, ConfirmButton, Empty, Feedback, Tag, useFeedback } from "../ui";

const KINDS = ["lektion", "prov", "aktivitet"];
const DAYS = [1, 2, 3, 4, 5, 6, 7];

const EMPTY_FORM = {
  id: "",
  kind: "lektion",
  title: "",
  subject: "",
  className: "",
  weekday: 1,
  start: "08:30",
  end: "09:30",
  room: "",
  teacherId: "",
};

/** Scheman-hantering: lektioner, prov och aktiviteter i veckoschemat. */
export default function ScheduleAdmin({ data }: AdminPageProps) {
  const feedback = useFeedback(data.reload);
  const [form, setForm] = useState(EMPTY_FORM);

  // Veckan som visas och dagen som valts. Schemat sparas per veckodag och
  // gäller därför varje vecka – veckoväljaren visar vilka datum det blir.
  const [weekOffset, setWeekOffset] = useState(0);
  const [dayFilter, setDayFilter] = useState(0);

  const classes = useMemo(() => classNames(data.people), [data.people]);
  const staff = useMemo(() => data.people.filter((person) => !isStudent(person)), [data.people]);

  const shownWeek = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + weekOffset * 7);
  }, [weekOffset]);

  const weekNumber = isoWeek(shownWeek);

  const monday = useMemo(() => {
    const start = new Date(shownWeek);
    start.setDate(start.getDate() - (isoWeekday(shownWeek) - 1));
    return start;
  }, [shownWeek]);

  /** Datumet för en veckodag i den visade veckan. */
  function dateFor(day: number): string {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + day - 1);
    return `${date.getDate()}/${date.getMonth() + 1}`;
  }

  const shownDays = dayFilter === 0 ? DAYS : [dayFilter];
  const todayWeekday = isoWeekday();

  async function save() {
    const ok = await feedback.run(
      () =>
        saveScheduleEntry({
          id: form.id,
          kind: form.kind,
          title: form.title,
          subject: form.subject,
          className: form.className,
          weekday: Number(form.weekday),
          start: form.start,
          end: form.end,
          room: form.room,
          teacherId: form.teacherId,
          createdAtMs: 0,
        }),
      form.id ? "Schemaposten sparades." : "Schemaposten lades in."
    );

    if (ok) setForm(EMPTY_FORM);
  }

  return (
    <AdminPage
      badge={<CalendarDays size={24} strokeWidth={1.8} aria-hidden />}
      eyebrow="Adminpanel"
      title="Scheman-hantering"
      lead="Lägg in lektioner, prov och aktiviteter med tid, ämne, klass och ansvarig lärare."
    >
      <Feedback notice={feedback.notice} error={feedback.error} />

      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">
            <Plus className="panel__icon" size={18} strokeWidth={2.2} aria-hidden />
            {form.id ? "Redigera schemapost" : "Ny schemapost"}
          </h2>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>Typ</span>
            <select
              value={form.kind}
              onChange={(event) => setForm({ ...form, kind: event.target.value })}
            >
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Dag</span>
            <select
              value={form.weekday}
              onChange={(event) => setForm({ ...form, weekday: Number(event.target.value) })}
            >
              {DAYS.map((day) => (
                <option key={day} value={day}>
                  {weekdayLabel(day)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Start</span>
            <input
              value={form.start}
              onChange={(event) => setForm({ ...form, start: event.target.value })}
              placeholder="08:30"
            />
          </label>
          <label className="field">
            <span>Slut</span>
            <input
              value={form.end}
              onChange={(event) => setForm({ ...form, end: event.target.value })}
              placeholder="09:30"
            />
          </label>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>Rubrik</span>
            <input
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="t.ex. Matematik B"
            />
          </label>
          <label className="field">
            <span>Ämne</span>
            <input
              value={form.subject}
              onChange={(event) => setForm({ ...form, subject: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Klass</span>
            {classes.length > 0 ? (
              <select
                value={form.className}
                onChange={(event) => setForm({ ...form, className: event.target.value })}
              >
                <option value="">Alla</option>
                {classes.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={form.className}
                onChange={(event) => setForm({ ...form, className: event.target.value })}
                placeholder="9A"
              />
            )}
          </label>
          <label className="field">
            <span>Sal</span>
            <input
              value={form.room}
              onChange={(event) => setForm({ ...form, room: event.target.value })}
              placeholder="B204"
            />
          </label>
          <label className="field">
            <span>Ansvarig</span>
            <select
              value={form.teacherId}
              onChange={(event) => setForm({ ...form, teacherId: event.target.value })}
            >
              <option value="">Ingen angiven</option>
              {staff.map((person) => (
                <option key={person.id} value={person.id}>
                  {fullName(person)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="toolbar">
          <button
            type="button"
            className="button button--primary"
            onClick={save}
            disabled={feedback.busy || !form.title.trim() || !form.start.trim()}
          >
            {form.id ? "Spara" : "Lägg in i schemat"}
          </button>
          {form.id && (
            <button type="button" className="button" onClick={() => setForm(EMPTY_FORM)}>
              Avbryt
            </button>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Veckoschema ({data.schedule.length} poster)</h2>
          <span className="panel__label">Vecka {weekNumber}</span>
        </div>

        <div className="toolbar">
          <button type="button" className="button" onClick={() => setWeekOffset(weekOffset - 1)}>
            Förra veckan
          </button>
          <button
            type="button"
            className={`chip${weekOffset === 0 ? " is-on" : ""}`}
            onClick={() => setWeekOffset(0)}
          >
            Denna vecka
          </button>
          <button type="button" className="button" onClick={() => setWeekOffset(weekOffset + 1)}>
            Nästa vecka
          </button>
        </div>

        <div className="toolbar" role="tablist" aria-label="Välj dag">
          <button
            type="button"
            role="tab"
            aria-selected={dayFilter === 0}
            className={`chip${dayFilter === 0 ? " is-on" : ""}`}
            onClick={() => setDayFilter(0)}
          >
            Alla dagar
          </button>
          {DAYS.map((day) => (
            <button
              key={day}
              type="button"
              role="tab"
              aria-selected={dayFilter === day}
              className={`chip${dayFilter === day ? " is-on" : ""}`}
              onClick={() => setDayFilter(day)}
            >
              {weekdayLabel(day).slice(0, 3)} {dateFor(day)}
              {day === todayWeekday && weekOffset === 0 ? " (idag)" : ""}
            </button>
          ))}
        </div>

        <p className="panel__hint">
          Samma schema gäller varje vecka – tiderna nedan upprepas. Datumen visar
          vilka dagar den valda veckan (vecka {weekNumber}) motsvarar, och samma
          poster visas på elevens sida.
        </p>

        {data.schedule.length === 0 ? (
          <Empty
            title="Schemat är tomt."
            hint="Lägg in den första lektionen ovan. Den dyker upp direkt i veckovyn och på startsidan."
          />
        ) : (
          <div className="schedule-grid">
            {shownDays.map((day) => {
              const entries = data.schedule.filter((entry) => entry.weekday === day);
              return (
                <div className="schedule-day" key={day}>
                  <p className="schedule-day__head">
                    {weekdayLabel(day)} {dateFor(day)}
                    {day === todayWeekday && weekOffset === 0 ? " · idag" : ""}
                  </p>

                  {entries.length === 0 ? (
                    <p className="schedule-day__empty">Inget inlagt</p>
                  ) : (
                    <ul className="schedule-day__list">
                      {entries.map((entry) => (
                        <li className="schedule-slot" key={entry.id}>
                          <span className="schedule-slot__time">
                            {entry.start}
                            {entry.end ? `–${entry.end}` : ""}
                          </span>
                          <span className="schedule-slot__title">{entry.title}</span>
                          <span className="schedule-slot__meta">
                            {[entry.subject, entry.className, entry.room]
                              .filter(Boolean)
                              .join(" · ") || "Inga fler uppgifter"}
                          </span>
                          <span className="schedule-slot__actions">
                            <Tag tone={entry.kind === "prov" ? "warn" : "info"}>
                              {entry.kind}
                            </Tag>
                            <button
                              type="button"
                              className="button"
                              onClick={() =>
                                setForm({
                                  id: entry.id,
                                  kind: entry.kind,
                                  title: entry.title,
                                  subject: entry.subject,
                                  className: entry.className,
                                  weekday: entry.weekday,
                                  start: entry.start,
                                  end: entry.end,
                                  room: entry.room,
                                  teacherId: entry.teacherId,
                                })
                              }
                            >
                              Redigera
                            </button>
                            <ConfirmButton
                              label="Ta bort"
                              question={`Ta bort "${entry.title}"?`}
                              confirmLabel="Ja, ta bort"
                              disabled={feedback.busy}
                              onConfirm={() =>
                                void feedback.run(
                                  () => deleteScheduleEntry(entry.id),
                                  "Schemaposten togs bort."
                                )
                              }
                            />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AdminPage>
  );
}
