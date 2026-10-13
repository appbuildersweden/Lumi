import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { WEEKDAY_SHORT, monthGrid, monthLabel, shiftMonth } from "./calendar";

interface MonthCalendarProps {
  /** Veckodagar (ISO) som har poster i schemat, för den diskreta markeringen. */
  weekdaysWithEntries: number[];
}

/**
 * En liten månadskalender för adminpanelens startsida.
 *
 * Datumen räknas ut ur `Date`, så månadens längd, veckodagar och skottår
 * stämmer. Dagens datum markeras i adminpanelens blå färg, och dagar som har
 * poster i veckoschemat får en liten prick – inga påhittade händelser.
 */
export default function MonthCalendar({ weekdaysWithEntries }: MonthCalendarProps) {
  const today = useMemo(() => new Date(), []);
  const [view, setView] = useState({ year: today.getFullYear(), month: today.getMonth() });

  const days = useMemo(() => monthGrid(view.year, view.month, today), [view, today]);
  const busy = useMemo(() => new Set(weekdaysWithEntries), [weekdaysWithEntries]);

  const step = (delta: number) => setView((current) => shiftMonth(current.year, current.month, delta));

  return (
    <section className="panel panel--compact" aria-labelledby="admin-calendar-title">
      <div className="panel__head">
        <h2 className="panel__title" id="admin-calendar-title">
          <CalendarDays className="panel__icon" size={18} strokeWidth={2.1} aria-hidden />
          Kalender
        </h2>

        <span className="calendar__nav">
          <button
            type="button"
            className="icon-button"
            onClick={() => step(-1)}
            aria-label="Föregående månad"
            title="Föregående månad"
          >
            <ChevronLeft size={16} strokeWidth={2.2} aria-hidden />
          </button>
          <span className="calendar__month" aria-live="polite">
            {monthLabel(view.year, view.month)}
          </span>
          <button
            type="button"
            className="icon-button"
            onClick={() => step(1)}
            aria-label="Nästa månad"
            title="Nästa månad"
          >
            <ChevronRight size={16} strokeWidth={2.2} aria-hidden />
          </button>
        </span>
      </div>

      <div className="calendar">
        <div className="calendar__weekdays" aria-hidden>
          {WEEKDAY_SHORT.map((name) => (
            <span key={name} className="calendar__weekday">
              {name}
            </span>
          ))}
        </div>

        <div className="calendar__days" role="grid" aria-label={monthLabel(view.year, view.month)}>
          {days.map((day) => {
            const classes = [
              "calendar__day",
              day.inMonth ? "" : "is-outside",
              day.isToday ? "is-today" : "",
            ]
              .filter(Boolean)
              .join(" ");

            const hasSchedule = busy.has(day.isoWeekday);

            return (
              <span
                key={day.date.getTime()}
                className={classes}
                title={
                  hasSchedule
                    ? "Det finns poster i veckoschemat den här veckodagen"
                    : undefined
                }
              >
                {day.day}
                {hasSchedule && <span className="calendar__dot" aria-hidden />}
              </span>
            );
          })}
        </div>
      </div>

      <p className="panel__hint">
        Pricken visar dagar som har poster i veckoschemat. Dagens datum är markerat
        med blått.
      </p>
    </section>
  );
}
