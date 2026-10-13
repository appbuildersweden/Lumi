import { useState } from "react";
import { Eye, EyeOff, LoaderCircle, LogIn } from "lucide-react";
import { runningInTauri, signIn, toLumiError, type PublicUser } from "../lib/backend";

interface LoginProps {
  onSignedIn: (user: PublicUser) => void;
}

/**
 * Den gemensamma inloggningen för alla i Lumi.
 *
 * Uppgifterna skickas till Rust-backenden, som jämför dem mot den hashade
 * lösenordsposten i Lumis användardatabas. Gränssnittet avgör aldrig själv om
 * någon får komma in, och rollen bestäms helt av backend.
 */
export default function Login({ onSignedIn }: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // I webbläsarläget finns ingen backend som kan kontrollera uppgifterna.
  // Formuläret är därför avstängt i stället för att se ut att fungera.
  const canSubmit =
    runningInTauri && email.trim().length > 0 && password.length > 0 && !busy;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError(null);

    try {
      const user = await signIn(email, password);
      setPassword("");
      onSignedIn(user);
    } catch (raw) {
      setError(toLumiError(raw).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit} noValidate>
        <span className="login__logo" role="img" aria-label="Lumi" />

        <p className="eyebrow">Välkommen tillbaka</p>
        <h1 className="login__title">Logga in</h1>
        <p className="login__lead">
          Använd uppgifterna du har fått. Rollen avgör vilket gränssnitt du
          kommer till.
        </p>

        {!runningInTauri && (
          <div className="notice notice--warn">
            Webbläsarläget saknar Lumis backend, så inloggningen kan inte
            kontrolleras här. Öppna skrivbordsappen (<code>npm run tauri dev</code>)
            för att logga in.
          </div>
        )}

        {error && (
          <div className="notice notice--error" role="alert">
            {error}
          </div>
        )}

        <div className="login__field">
          <label className="login__label" htmlFor="login-email">
            E-postadress
          </label>
          <input
            id="login-email"
            className="field"
            type="email"
            name="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="namn@edu.ronneby.se"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy || !runningInTauri}
          />
        </div>

        <div className="login__field">
          <label className="login__label" htmlFor="login-password">
            Lösenord
          </label>
          <div className="login__password">
            <input
              id="login-password"
              className="field"
              type={showPassword ? "text" : "password"}
              name="password"
              autoComplete="current-password"
              placeholder="Ditt lösenord"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy || !runningInTauri}
            />
            <button
              type="button"
              className="login__toggle"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? "Dölj lösenordet" : "Visa lösenordet"}
              aria-pressed={showPassword}
              title={showPassword ? "Dölj lösenordet" : "Visa lösenordet"}
              disabled={busy}
            >
              {showPassword ? (
                <EyeOff size={17} strokeWidth={2} aria-hidden />
              ) : (
                <Eye size={17} strokeWidth={2} aria-hidden />
              )}
            </button>
          </div>
        </div>

        <button
          type="submit"
          className="button button--primary login__submit"
          disabled={!canSubmit}
        >
          {busy ? (
            <LoaderCircle className="login__spinner" size={17} strokeWidth={2.4} aria-hidden />
          ) : (
            <LogIn size={16} strokeWidth={2.2} aria-hidden />
          )}
          {busy ? "Loggar in …" : "Logga in"}
        </button>

        {busy && (
          <div className="login__loading" role="status">
            <span className="login__loading-bar" aria-hidden />
            <span className="login__loading-text">Kontrollerar uppgifterna …</span>
          </div>
        )}

        <p className="login__hint">
          Har du inget konto? Be administratören skapa ett åt dig.
        </p>
      </form>
    </div>
  );
}
