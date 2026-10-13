import { FEATURES, FEATURES_NOTE } from "../content";
import { Reveal } from "./Reveal";

/** Funktionerna, ett kort per område. */
export function Features() {
  return (
    <section className="section" id="funktioner">
      <div className="shell">
        <Reveal className="section__head">
          <p className="eyebrow">Funktioner</p>
          <h2 className="section__title">Det Lumi hjälper dig med</h2>
          <p className="section__lead">
            Fyra delar som tillsammans gör studierna lättare att ta sig igenom.
          </p>
        </Reveal>

        <Reveal className="features">
          {FEATURES.map((feature) => (
            <article className="feature" key={feature.id}>
              <span className="feature__icon" aria-hidden="true">
                <feature.icon size={22} />
              </span>
              <h3 className="feature__title">{feature.title}</h3>
              <p className="feature__text">{feature.text}</p>
            </article>
          ))}
        </Reveal>

        <p className="section__note">{FEATURES_NOTE}</p>
      </div>
    </section>
  );
}
