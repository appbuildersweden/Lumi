import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import {
  formatDate,
  isMissingBackend,
  listStudyMaterial,
  mySchedule,
  toLumiError,
  type MaterialOf,
  type ScheduleEntry,
} from "../lib/backend";

/** Veckodagarna i den ordning schemat visas. 1 = måndag. */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

const WEEKDAY_NAMES = [
  "Måndag",
  "Tisdag",
  "Onsdag",
  "Torsdag",
  "Fredag",
  "Lördag",
  "Söndag",
];

/** Dagens veckodag enligt ISO: 1 = måndag … 7 = söndag. */
function todayWeekday(): number {
  const day = new Date().getDay();
  return day === 0 ? 7 : day;
}

export default function Schedule() {
  const [plans, setPlans] = useState<MaterialOf<"study-plan">[]>([]);
  const [school, setSchool] = useState<ScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const today = todayWeekday();

  useEffect(() => {
    let active = true;

    // Schemat kommer från samma lagring som skolan lägger in i adminpanelen.
    Promise.all([listStudyMaterial(), mySchedule()])
      .then(([items, entries]) => {
        if (!active) return;
        setPlans(
          items.filter((item): item is MaterialOf<"study-plan"> => item.kind === "study-plan")
        );
        setSchool(entries);
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
  }, []);

  return (
    <section className="page">
      <span className="page__badge">
        <CalendarDays size={24} strokeWidth={1.8} aria-hidden />
      </span>

      <p className="eyebrow">Schema</p>
      <h1 className="page-title">Din planering</h1>
      <p className="page-lead">
        Dina prov, deadlines, aktiviteter och pluggtider samlas här.
      </p>

      {error && <div className="notice notice--error">{error}</div>}

      {loading ? (
        <p className="panel__text" style={{ marginTop: 22 }}>
          Läser in …
        </p>
      ) : (
        <>
          <div className="panel" style={{ marginTop: 22 }}>
            <div className="panel__head">
              <h2 className="panel__title">Skolans schema</h2>
              {school.length > 0 && <span className="panel__label">{school.length} poster</span>}
            </div>

            {school.length === 0 ? (
              <>
                <p className="panel__text">
                  Här visas dina lektioner, prov och aktiviteter. Skolan lägger in dem,
                  och samma schema syns i Lumi.
                </p>
                <p className="panel__empty">Inget schema tillagt ännu.</p>
              </>
            ) : (
              <ul className="updates">
                {WEEKDAYS.flatMap((weekday) => {
                  const entries = school
                    .filter((entry) => entry.weekday === weekday)
                    .sort((a, b) => a.start.localeCompare(b.start));

                  return entries.map((entry) => (
                    <li key={entry.id} className="updates__item">
                      <span className="updates__title">
                        {WEEKDAY_NAMES[weekday - 1]}
                        {weekday === today ? " · idag" : ""} · {entry.start}
                        {entry.end ? `–${entry.end}` : ""} · {entry.title}
                      </span>
                      <span className="updates__meta">
                        {[entry.kind, entry.subject, entry.className, entry.room]
                          .filter(Boolean)
                          .join(" · ") || "Ingen plats angiven"}
                      </span>
                    </li>
                  ));
                })}
              </ul>
            )}
          </div>

          <div className="panel" style={{ marginTop: 34 }}>
            <div className="panel__head">
              <h2 className="panel__title">Studieplaner från Plugga</h2>
              <span className="panel__label">{plans.length} st</span>
            </div>

            {plans.length === 0 ? (
              <p className="panel__text">
                Skapa en studieplan under Plugga så samlas den här, med steg och
                uppskattad tid.
              </p>
            ) : (
              <div className="plan-list">
                {plans.map((plan) => {
                  const minutes = plan.content.steps.reduce(
                    (sum, step) => sum + step.minutes,
                    0
                  );
                  return (
                    <details key={plan.id} className="plan-item">
                      <summary>
                        <span className="plan-item__title">{plan.title}</span>
                        <span className="plan-item__meta">
                          {plan.content.steps.length} steg · {minutes} min ·{" "}
                          {formatDate(plan.createdAtMs)}
                        </span>
                      </summary>
                      <p className="plan__summary">{plan.content.summary}</p>
                      <ol className="plan__steps">
                        {plan.content.steps.map((step, index) => (
                          <li key={index} className="plan__step">
                            <span className="plan__number">{index + 1}</span>
                            <div>
                              <p className="plan__title">{step.title}</p>
                              <p className="plan__focus">{step.focus}</p>
                            </div>
                            <span className="plan__minutes">{step.minutes} min</span>
                          </li>
                        ))}
                      </ol>
                    </details>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
