import { CalendarDays, Megaphone, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  formatDate,
  isMissingBackend,
  listAttempts,
  listStudyMaterial,
  myAdminMessages,
  runningInTauri,
  toLumiError,
  type AdminMessage,
  type Attempt,
  type MaterialKind,
  type StudyMaterial,
} from "../lib/backend";
import type { ViewId } from "../navigation";

/** Hälsning utifrån tiden på dagen. */
function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 10) return "God morgon!";
  if (hour >= 10 && hour < 13) return "God dag!";
  if (hour >= 13 && hour < 18) return "God eftermiddag!";
  return "God kväll!";
}

const KIND_WORDS: Record<MaterialKind, string> = {
  summary: "Ny sammanfattning",
  quiz: "Nytt quiz",
  flashcards: "Nya flashcards",
  "practice-exam": "Nytt övningsprov",
  notes: "Nya anteckningar",
  "study-plan": "Ny studieplan",
};

interface HomeProps {
  onNavigate: (view: ViewId) => void;
}

export default function Home({ onNavigate }: HomeProps) {
  const [now, setNow] = useState(() => new Date());
  const [materials, setMaterials] = useState<StudyMaterial[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Uppdaterar hälsningen om appen står öppen över ett tidsgräns.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!runningInTauri) return undefined;
    let active = true;

    Promise.all([listStudyMaterial(), listAttempts(), myAdminMessages()])
      .then(([savedMaterials, savedAttempts, fromSchool]) => {
        if (!active) return;
        setMaterials(savedMaterials);
        setAttempts(savedAttempts);
        setMessages(fromSchool);
      })
      .catch((raw) => {
        if (active && !isMissingBackend(raw)) setError(toLumiError(raw).message);
      });

    return () => {
      active = false;
    };
  }, []);

  const updates = useMemo(() => materials.slice(0, 3), [materials]);

  const progress = useMemo(() => {
    const correct = attempts.reduce((sum, attempt) => sum + attempt.correct, 0);
    const total = attempts.reduce((sum, attempt) => sum + attempt.total, 0);
    return {
      attempts: attempts.length,
      correct,
      total,
      percent: total === 0 ? 0 : Math.round((correct / total) * 100),
    };
  }, [attempts]);

  const plans = useMemo(
    () => materials.filter((material) => material.kind === "study-plan"),
    [materials]
  );

  /** Skolans senaste information och meddelanden, nyaste först. */
  const fromSchool = useMemo(
    () => [...messages].sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, 2),
    [messages]
  );

  return (
    <>
      {/* Bannern ligger längst upp i huvudytan och når ända ut till
          sidomenyn och högerkanten. Hälsningen ligger ovanpå bilden. */}
      <header className="hero">
        <img
          className="hero__image"
          src="/ronneby.webp"
          alt="Ronneby – kanalen med gamla hus och blommor i förgrunden"
        />
        <span className="hero__scrim" aria-hidden />

        <div className="hero__content">
          <h1 className="hero__greeting">{greetingFor(now.getHours())}</h1>
          <p className="hero__subtitle">
            Välkommen till Lumi – vad vill du fokusera på idag?
          </p>
        </div>
      </header>

      <div className="home">
        {error && <div className="notice notice--error">{error}</div>}

        <section className="panel" aria-labelledby="from-school-title">
          <div className="panel__head">
            <h2 className="panel__title" id="from-school-title">
              <Megaphone className="panel__icon" size={18} strokeWidth={2.1} aria-hidden />
              Från skolan
            </h2>
            <button
              type="button"
              className="link-inline"
              onClick={() => onNavigate("info")}
            >
              visa allt
            </button>
          </div>

          {fromSchool.length === 0 ? (
            <p className="panel__text">
              Här visas nyheter och viktiga meddelanden från skolan.
            </p>
          ) : (
            <ul className="updates">
              {fromSchool.map((message) => (
                <li key={message.id} className="updates__item">
                  <span className="updates__title">
                    {message.kind === "meddelande" ? "Viktigt: " : ""}
                    {message.title}
                  </span>
                  <span className="updates__meta">
                    {message.body} · {formatDate(message.createdAtMs)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel" aria-labelledby="updates-title">
          <div className="panel__head">
            <h2 className="panel__title" id="updates-title">
              Senaste uppdateringar
            </h2>
            <span className="panel__label">Uppdateringar</span>
          </div>

          {updates.length === 0 ? (
            <p className="panel__text">Inga nya uppdateringar ännu.</p>
          ) : (
            <ul className="updates">
              {updates.map((material) => (
                <li key={material.id} className="updates__item">
                  <span className="updates__title">
                    {KIND_WORDS[material.kind]}: {material.title}
                  </span>
                  <span className="updates__meta">
                    {material.subject} · {formatDate(material.createdAtMs)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="home__grid">
          <section className="panel" aria-labelledby="progress-title">
            <div className="panel__head">
              <h2 className="panel__title" id="progress-title">
                <TrendingUp className="panel__icon" size={18} strokeWidth={2.1} aria-hidden />
                Mina framsteg
              </h2>
            </div>

            {progress.attempts === 0 ? (
              <>
                <p className="panel__text">
                  Här kommer din översikt över studier och framsteg att visas.
                </p>
                <div className="progress-track" aria-hidden>
                  <span />
                </div>
                <p className="panel__hint">Fylls i när du börjar plugga</p>
              </>
            ) : (
              <>
                <p className="panel__text">
                  Du har gjort {progress.attempts}{" "}
                  {progress.attempts === 1 ? "prov" : "prov"} och fått{" "}
                  {progress.correct} av {progress.total} rätt.
                </p>
                <div className="progress-track progress-track--filled" aria-hidden>
                  <span style={{ width: `${progress.percent}%` }} />
                </div>
                <p className="panel__hint">
                  {progress.percent} % rätt ·{" "}
                  <button
                    type="button"
                    className="link-inline"
                    onClick={() => onNavigate("progress")}
                  >
                    se alla framsteg
                  </button>
                </p>
              </>
            )}
          </section>

          <section className="panel" aria-labelledby="schedule-title">
            <div className="panel__head">
              <h2 className="panel__title" id="schedule-title">
                <CalendarDays className="panel__icon" size={18} strokeWidth={2.1} aria-hidden />
                Mitt schema
              </h2>
            </div>

            {plans.length === 0 ? (
              <>
                <p className="panel__text">
                  Dina prov, pluggtider och aktiviteter kommer att visas här när du
                  lägger in dem.
                </p>
                <p className="panel__empty">Inget schema tillagt ännu.</p>
              </>
            ) : (
              <>
                <p className="panel__text">
                  Du har {plans.length}{" "}
                  {plans.length === 1 ? "studieplan" : "studieplaner"} från Plugga.
                </p>
                <ul className="updates">
                  {plans.slice(0, 2).map((plan) => (
                    <li key={plan.id} className="updates__item">
                      <span className="updates__title">{plan.title}</span>
                      <span className="updates__meta">
                        {plan.content.steps.length} steg ·{" "}
                        {plan.content.steps.reduce((sum, step) => sum + step.minutes, 0)} min
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="panel__hint">
                  <button
                    type="button"
                    className="link-inline"
                    onClick={() => onNavigate("schema")}
                  >
                    öppna schemat
                  </button>
                </p>
              </>
            )}
          </section>
        </div>

        <p className="home__footer">Lumi · Lär dig i din egen takt</p>
      </div>
    </>
  );
}
