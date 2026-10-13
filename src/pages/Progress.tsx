import { useEffect, useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import {
  formatDate,
  isMissingBackend,
  listAttempts,
  toLumiError,
  type Attempt,
} from "../lib/backend";

interface SubjectRow {
  subject: string;
  attempts: number;
  correct: number;
  total: number;
  percent: number;
}

export default function Progress() {
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listAttempts()
      .then((items) => {
        if (active) setAttempts(items);
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

  const totals = useMemo(() => {
    const correct = attempts.reduce((sum, attempt) => sum + attempt.correct, 0);
    const total = attempts.reduce((sum, attempt) => sum + attempt.total, 0);
    return {
      correct,
      total,
      percent: total === 0 ? 0 : Math.round((correct / total) * 100),
    };
  }, [attempts]);

  const perSubject = useMemo<SubjectRow[]>(() => {
    const map = new Map<string, SubjectRow>();

    for (const attempt of attempts) {
      const subject = attempt.subject || "Utan ämne";
      const row = map.get(subject) ?? {
        subject,
        attempts: 0,
        correct: 0,
        total: 0,
        percent: 0,
      };
      row.attempts += 1;
      row.correct += attempt.correct;
      row.total += attempt.total;
      row.percent = row.total === 0 ? 0 : Math.round((row.correct / row.total) * 100);
      map.set(subject, row);
    }

    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [attempts]);

  return (
    <section className="page">
      <span className="page__badge">
        <TrendingUp size={24} strokeWidth={1.8} aria-hidden />
      </span>

      <p className="eyebrow">Framsteg</p>
      <h1 className="page-title">Så går det för dig</h1>
      <p className="page-lead">
        Här visas bara resultat från quiz och prov du faktiskt har gjort i Lumi.
      </p>

      {error && <div className="notice notice--error">{error}</div>}

      {loading ? (
        <p className="panel__text" style={{ marginTop: 22 }}>
          Läser in dina resultat …
        </p>
      ) : attempts.length === 0 ? (
        <div className="panel" style={{ marginTop: 22 }}>
          <div className="panel__head">
            <h2 className="panel__title">Inga resultat ännu</h2>
          </div>
          <p className="panel__text">
            Gör ett quiz eller ett övningsprov under Plugga. När du rättar det sparas
            resultatet här.
          </p>
          <div className="progress-track" aria-hidden>
            <span />
          </div>
          <p className="panel__hint">Fylls i när du har gjort ditt första quiz</p>
        </div>
      ) : (
        <>
          <div className="stat-row">
            <div className="stat">
              <span className="stat__value">{attempts.length}</span>
              <span className="stat__label">Genomförda prov</span>
            </div>
            <div className="stat">
              <span className="stat__value">
                {totals.correct}/{totals.total}
              </span>
              <span className="stat__label">Rätta svar</span>
            </div>
            <div className="stat">
              <span className="stat__value">{totals.percent} %</span>
              <span className="stat__label">Andel rätt</span>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 34 }}>
            <div className="panel__head">
              <h2 className="panel__title">Per ämne</h2>
            </div>
            <div className="subject-list">
              {perSubject.map((row) => (
                <div key={row.subject} className="subject">
                  <div className="subject__head">
                    <span className="subject__name">{row.subject}</span>
                    <span className="subject__value">
                      {row.correct}/{row.total} · {row.percent} %
                    </span>
                  </div>
                  <div className="progress-track progress-track--filled" aria-hidden>
                    <span style={{ width: `${row.percent}%` }} />
                  </div>
                  <span className="subject__meta">
                    {row.attempts} {row.attempts === 1 ? "prov" : "prov"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel" style={{ marginTop: 34 }}>
            <div className="panel__head">
              <h2 className="panel__title">Senaste resultaten</h2>
            </div>
            <ul className="history">
              {attempts.map((attempt) => (
                <li key={attempt.id} className="history__item">
                  <span className="history__score">
                    {attempt.correct}/{attempt.total}
                  </span>
                  <span className="history__subject">
                    {attempt.subject || "Utan ämne"}
                  </span>
                  <span className="history__date">{formatDate(attempt.completedAtMs)}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
