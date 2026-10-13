import { Lock, PenLine, ShieldCheck } from "lucide-react";
import { Reveal } from "./Reveal";

/** Om Lumi: varför appen finns och vad den vill göra möjligt. */
export function About() {
  return (
    <section className="section section--about" id="om-lumi">
      <div className="shell about">
        <Reveal className="about__copy">
          <p className="eyebrow">Om Lumi</p>
          <h2 className="section__title">Studier som är lätta att hitta tillbaka till</h2>
          <p className="about__text">
            Lumi började med en enkel tanke: att skolans studier ofta blir röriga i onödan.
            Material ligger i flera appar, övningar försvinner och resultaten är svåra att få
            överblick över.
          </p>
          <p className="about__text">
            Målet med Lumi är att göra studierna mer organiserade och lättillgängliga – att
            förklaringar, övningar och framsteg finns på ett ställe, i ett gränssnitt som är lugnt
            och begripligt.
          </p>
          <p className="about__text">
            Appen är under utveckling och nya delar tillkommer steg för steg. Det som redan finns
            är byggt för att fungera i skolans vardag, på svenska.
          </p>
        </Reveal>

        <Reveal className="about__points" delayMs={120}>
          <div className="about__point">
            <span className="about__point-icon" aria-hidden="true">
              <PenLine size={20} />
            </span>
            <div>
              <h3 className="about__point-title">Byggt kring ditt material</h3>
              <p className="about__point-text">
                Utgångspunkten är ämnet och materialet du arbetar med, inte allmänna svar.
              </p>
            </div>
          </div>

          <div className="about__point">
            <span className="about__point-icon" aria-hidden="true">
              <Lock size={20} />
            </span>
            <div>
              <h3 className="about__point-title">Ditt material stannar hos dig</h3>
              <p className="about__point-text">
                I skrivbordsappen sparas ditt studiematerial och dina resultat lokalt på din egen
                dator, kopplade till ditt konto.
              </p>
            </div>
          </div>

          <div className="about__point">
            <span className="about__point-icon" aria-hidden="true">
              <ShieldCheck size={20} />
            </span>
            <div>
              <h3 className="about__point-title">Ett konto per elev</h3>
              <p className="about__point-text">
                Varje konto ser bara sitt eget material och sina egna resultat.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
