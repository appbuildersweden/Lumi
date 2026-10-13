import { Info } from "lucide-react";
import { runningInTauri } from "../lib/backend";

/**
 * Visas bara när gränssnittet körs i en vanlig webbläsare i stället för i
 * Tauri-fönstret. Där finns ingen Rust-backend alls, så AI:n och lagringen kan
 * inte fungera. I appen renderas ingenting – ingen grön skenlösning.
 */
export default function BackendNotice() {
  if (runningInTauri) return null;

  return (
    <div className="backend-notice">
      <div className="notice notice--warn">
        <Info size={16} strokeWidth={2.2} aria-hidden />
        <span>
          Du tittar på gränssnittet i en webbläsare. Lumis backend – som sköter
          AI:n och sparar materialet – startar bara i skrivbordsappen
          (<code>npm run tauri dev</code>). Innehållet här är därför tomt och
          knapparna gör ingenting.
        </span>
      </div>
    </div>
  );
}
