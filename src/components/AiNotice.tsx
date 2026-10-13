import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { checkApiKey, runningInTauri } from "../lib/backend";

/**
 * Raden som visas när svaren kommer från en gratismodell.
 *
 * Två saker kan avgöra det: kontots läge (betalmodellerna kan inte användas
 * alls) eller ett enskilt svar (`fallback` från backend). Läget frågas bara en
 * gång per appkörning, så raden kostar ingenting att visa på flera sidor.
 *
 * Är allt som det ska renderas ingenting – ingen grön skenlösning.
 */
let creditsPromise: Promise<boolean> | null = null;

function creditsAvailable(): Promise<boolean> {
  if (!creditsPromise) {
    creditsPromise = checkApiKey()
      .then((status) => status.creditsOk)
      .catch(() => {
        // Går läget inte att läsa visas ingen rad. Ett uteblivet svar är inte
        // samma sak som att kontot saknar krediter.
        creditsPromise = null;
        return true;
      });
  }

  return creditsPromise;
}

interface AiNoticeProps {
  /** Modellen som svarade, när svaret kom från en gratismodell. */
  fallback?: string | null;
}

export default function AiNotice({ fallback = null }: AiNoticeProps) {
  const [creditsOk, setCreditsOk] = useState<boolean | null>(null);

  useEffect(() => {
    if (!runningInTauri) return undefined;
    let active = true;

    creditsAvailable().then((ok) => {
      if (active) setCreditsOk(ok);
    });

    return () => {
      active = false;
    };
  }, []);

  if (!fallback && creditsOk !== false) return null;

  return (
    <p className="ai-notice">
      <Info size={15} strokeWidth={2.2} aria-hidden />
      <span>
        AI använder just nu en gratismodell eftersom premiummodellen inte är
        tillgänglig.{fallback ? ` Svaret kommer från ${fallback}.` : ""}
      </span>
    </p>
  );
}
