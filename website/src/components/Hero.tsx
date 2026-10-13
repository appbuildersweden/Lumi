import { Download } from "lucide-react";
import { DOWNLOAD_ANCHOR } from "../content";
import { AppPreview } from "./AppPreview";

/** Startsidans topp: rubrik, kort beskrivning, två knappar och en förhandsvisning. */
export function Hero() {
  return (
    <section className="hero" id="startsida">
      <div className="hero__wash" aria-hidden="true" />

      <div className="shell hero__inner">
        <div className="hero__copy">
          <p className="eyebrow">Studieapp för Windows</p>

          <h1 className="hero__title">
            En studieapp som hjälper dig{" "}
            <span className="hero__accent">förstå, öva och följa framsteg</span>.
          </h1>

          <p className="hero__lead">
            Lumi är byggd för dig som studerar. Appen hjälper dig att förstå materialet du arbetar
            med, att öva på det du lärt dig och att samla dina studier på ett ställe – på svenska,
            utan krångel.
          </p>

          <div className="hero__actions">
            <a className="button button--primary" href={DOWNLOAD_ANCHOR}>
              <Download size={18} aria-hidden="true" />
              Ladda ner Lumi
            </a>
            <a className="button button--ghost" href="#funktioner">
              Upptäck funktionerna
            </a>
          </div>

          <p className="hero__note">Lumi är under utveckling. Appen installeras på Windows.</p>
        </div>

        <figure className="hero__preview">
          <AppPreview />
          <figcaption className="hero__caption">
            Illustration av gränssnittet i Lumi. Appen visar ditt eget material när du loggar in.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
