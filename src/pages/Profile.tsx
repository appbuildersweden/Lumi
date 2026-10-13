import { useEffect, useState } from "react";
import {
  Check,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import {
  checkApiKey,
  getAiStatus,
  getSettings,
  listModels,
  runningInTauri,
  setModel,
  toLumiError,
  type AiStatus,
  type ModelInfo,
  type PublicUser,
  type ServiceStatus,
} from "../lib/backend";

interface ProfileProps {
  /** Den inloggade eleven. Profilen visas bara för den som är inloggad. */
  user: PublicUser | null;
}

/**
 * Varifrån adressen till AI-tjänsten kommer.
 *
 * Nyckeln till OpenRouter finns bara hos tjänsten och visas aldrig här – det
 * finns ingenting att visa.
 */
const SOURCE_TEXT: Record<string, string> = {
  "built-in": "den inbyggda tjänsten i appen",
  environment: "miljövariabler på den här datorn (utvecklingsläge)",
};

export default function Profile({ user }: ProfileProps) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [model, setModelState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [service, setService] = useState<ServiceStatus | null>(null);

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelQuery, setModelQuery] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);

  useEffect(() => {
    if (!runningInTauri) return undefined;
    let active = true;

    Promise.all([getAiStatus(), getSettings()])
      .then(([ai, settings]) => {
        if (!active) return;
        setStatus(ai);
        setModelState(settings.model);
      })
      .catch((raw) => {
        if (active) setError(toLumiError(raw).message);
      });

    return () => {
      active = false;
    };
  }, []);

  async function testConnection() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const info = await checkApiKey();
      setService(info);
      setNotice(
        info.creditsOk
          ? "AI-tjänsten svarar och kontot kan använda standardmodellerna."
          : "AI-tjänsten svarar. Kontot saknar krediter, så svaren kommer från en gratismodell."
      );
    } catch (raw) {
      setError(toLumiError(raw).message);
    } finally {
      setBusy(false);
    }
  }

  async function changeModel(next: string | null) {
    setBusy(true);
    setError(null);
    try {
      const settings = await setModel(next);
      setModelState(settings.model);
      setNotice(
        settings.model
          ? `Lumi använder nu ${settings.model}.`
          : "Lumi använder standardmodellen igen."
      );
    } catch (raw) {
      setError(toLumiError(raw).message);
    } finally {
      setBusy(false);
    }
  }

  async function loadModels() {
    setModelsLoading(true);
    setError(null);
    try {
      const all = await listModels(modelQuery || undefined);
      setModels(all.slice(0, 60));
    } catch (raw) {
      setError(toLumiError(raw).message);
    } finally {
      setModelsLoading(false);
    }
  }

  return (
    <section className="page">
      <span className="page__badge">
        <UserRound size={24} strokeWidth={1.8} aria-hidden />
      </span>

      <p className="eyebrow">Profil</p>
      <h1 className="page-title">Inställningar</h1>
      <p className="page-lead">
        Din egen profil. Uppgifterna sköts av skolan, och här ser du hur
        AI-anslutningen mår och vilken modell Lumi använder.
      </p>

      {error && <div className="notice notice--error">{error}</div>}
      {notice && <div className="notice notice--ok">{notice}</div>}

      {/* Elever ser bara sin egen profil, och den är läsbar – namn, adress och
          roll ändras av skolan. Ingen annan elevs profil går att öppna. */}
      <div className="panel" style={{ marginTop: 22 }}>
        <div className="panel__head">
          <h2 className="panel__title">
            <UserRound className="panel__icon" size={18} strokeWidth={2.1} aria-hidden />
            Mitt konto
          </h2>
        </div>

        {user ? (
          <ul className="section-block__bullets">
            <li>Namn: {user.displayName}</li>
            <li>E-postadress: {user.email}</li>
            <li>Roll: {user.roleLabel}</li>
            <li>Status: {user.active ? "aktivt" : "inaktiverat"}</li>
          </ul>
        ) : (
          <p className="panel__text">Ingen är inloggad.</p>
        )}

        <p className="hint">
          Namn, adress, klass och lösenord hanteras av skolan. Be din lärare eller
          administratör om något ska ändras.
        </p>
      </div>

      <div className="panel" style={{ marginTop: 22 }}>
        <div className="panel__head">
          <h2 className="panel__title">
            <KeyRound className="panel__icon" size={18} strokeWidth={2.1} aria-hidden />
            AI-anslutning
          </h2>
          {status && (
            <span className={`status-pill${status.configured ? " is-on" : ""}`}>
              {status.configured ? (
                <>
                  <Check size={13} strokeWidth={2.6} aria-hidden />
                  Ansluten
                </>
              ) : (
                <>
                  <X size={13} strokeWidth={2.6} aria-hidden />
                  Saknas
                </>
              )}
            </span>
          )}
        </div>

        {status?.configured ? (
          <p className="panel__text">
            Lumi skickar varje AI-fråga till {SOURCE_TEXT[status.source] ?? "AI-tjänsten"},
            som i sin tur anropar OpenRouter. Nyckeln till OpenRouter ligger hos
            tjänsten och finns därför varken i appen, i installationsfilen eller i
            projektet – den behöver aldrig skrivas in här.
          </p>
        ) : (
          <p className="panel__text">
            Appen är inte kopplad till någon AI-tjänst. Kontakta din administratör.
          </p>
        )}

        <div className="profile__actions">
          <button type="button" className="button" onClick={testConnection} disabled={busy}>
            <RefreshCw size={15} strokeWidth={2.1} aria-hidden />
            {busy ? "Testar …" : "Testa anslutningen"}
          </button>
        </div>

        {service && (
          <p className="panel__hint">
            {service.creditsOk
              ? `Kontot kan använda standardmodellerna. ${service.creditsLeft.toFixed(2)} USD kvar.`
              : `Kontot saknar krediter för standardmodellerna. Svaren kommer från ${
                  service.fallbackModels[0] ?? "en gratismodell"
                } så länge.`}
          </p>
        )}
      </div>

      <div className="panel" style={{ marginTop: 34 }}>
        <div className="panel__head">
          <h2 className="panel__title">
            <Sparkles className="panel__icon" size={18} strokeWidth={2.1} aria-hidden />
            Modell
          </h2>
        </div>

        <p className="panel__text">
          Lumi använder <strong>{status?.model ?? "…"}</strong>
          {model ? " (vald av dig)" : " (standardmodellen i Lumi)"}.
        </p>

        <div className="profile__row">
          <select
            className="field"
            value={model ?? ""}
            onChange={(event) => changeModel(event.target.value || null)}
            disabled={busy}
          >
            <option value="">Standard – {status?.defaultModel ?? "…"}</option>
            {(status?.suggestedModels ?? []).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        {status && (
          <ul className="section-block__bullets">
            <li>
              Lärachatt och förklaringar: <strong>{status.roles.main}</strong>
            </li>
            <li>
              Plugga – quiz, flashcards och prov: <strong>{status.roles.study}</strong>
            </li>
            <li>
              Enklare uppgifter: <strong>{status.roles.economy}</strong>
            </li>
            <li>
              Reservmodell när en modell inte svarar: <strong>{status.roles.backup}</strong>
            </li>
          </ul>
        )}

        <details className="models">
          <summary>Sök bland alla modeller som tjänsten erbjuder</summary>
          <div className="profile__row">
            <input
              className="field"
              placeholder="t.ex. gemini"
              value={modelQuery}
              onChange={(event) => setModelQuery(event.target.value)}
            />
            <button
              type="button"
              className="button"
              onClick={loadModels}
              disabled={modelsLoading || !status?.configured}
            >
              {modelsLoading ? "Hämtar …" : "Hämta lista"}
            </button>
          </div>

          {models.length > 0 && (
            <div className="model-list">
              {models.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`model-item${item.id === model ? " is-on" : ""}`}
                  onClick={() => changeModel(item.id)}
                >
                  <span className="model-item__id">{item.id}</span>
                  <span className="model-item__meta">
                    {Math.round(item.contextLength / 1000)}k kontext · in{" "}
                    {(item.promptPrice * 1_000_000).toFixed(2)} $/M · ut{" "}
                    {(item.completionPrice * 1_000_000).toFixed(2)} $/M
                  </span>
                </button>
              ))}
            </div>
          )}
        </details>
      </div>

      <div className="panel" style={{ marginTop: 34 }}>
        <div className="panel__head">
          <h2 className="panel__title">
            <ShieldCheck className="panel__icon" size={18} strokeWidth={2.1} aria-hidden />
            Så skyddas AI-nyckeln
          </h2>
        </div>
        <ul className="section-block__bullets">
          <li>Nyckeln till OpenRouter finns bara hos AI-tjänsten, som en hemlighet på servern.</li>
          <li>Den finns inte i appen, i installationsfilen, i gränssnittet eller i projektet.</li>
          <li>Alla AI-frågor går genom Rust-backend till tjänsten – gränssnittet ser dem aldrig direkt.</li>
          <li>AI-genererat material valideras i backend innan det får sparas i Plugga.</li>
        </ul>
      </div>
    </section>
  );
}
