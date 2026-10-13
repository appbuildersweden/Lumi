import { DOWNLOAD_ANCHOR, NAV_LINKS } from "../content";
import { Logo } from "./Logo";

/**
 * Sidfoten. Kontaktuppgifter och integritetspolicy är inte framtagna ännu, och
 * därför står det uttryckligen att de publiceras senare i stället för att en
 * påhittad länk visas.
 */
export function Footer() {
  return (
    <footer className="site-footer">
      <div className="shell site-footer__inner">
        <div className="site-footer__brand">
          <Logo size="footer" />
          <p className="site-footer__tagline">
            En studieapp för elever som vill ha ordning på studierna.
          </p>
          <a className="site-footer__download" href={DOWNLOAD_ANCHOR}>
            Ladda ner Lumi
          </a>
        </div>

        <nav className="site-footer__column" aria-label="Sidfot">
          <h2 className="site-footer__heading">Sidan</h2>
          <ul className="site-footer__list">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a className="site-footer__link" href={link.href}>
                  {link.label}
                </a>
              </li>
            ))}
            <li>
              <a className="site-footer__link" href={DOWNLOAD_ANCHOR}>
                Ladda ner
              </a>
            </li>
          </ul>
        </nav>

        <div className="site-footer__column">
          <h2 className="site-footer__heading">Kontakt och integritet</h2>
          <p className="site-footer__text">
            Kontaktuppgifter och integritetspolicy publiceras här när de är fastställda.
          </p>
        </div>
      </div>

      <div className="shell site-footer__bottom">
        <p>© {new Date().getFullYear()} Lumi · Under utveckling</p>
      </div>
    </footer>
  );
}
