import { STEPS } from "../content";
import { Reveal } from "./Reveal";

/** Så fungerar Lumi – tre steg. */
export function HowItWorks() {
  return (
    <section className="section section--steps" id="sa-fungerar-det">
      <div className="shell">
        <Reveal className="section__head">
          <p className="eyebrow">Så fungerar Lumi</p>
          <h2 className="section__title">Tre steg, sedan är du igång</h2>
        </Reveal>

        <Reveal>
          <ol className="steps">
            {STEPS.map((step, index) => (
              <li className="step" key={step.title}>
                <span className="step__number" aria-hidden="true">
                  {index + 1}
                </span>
                <h3 className="step__title">
                  <span className="visually-hidden">Steg {index + 1}: </span>
                  {step.title}
                </h3>
                <p className="step__text">{step.text}</p>
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}
