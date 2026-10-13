import { Download, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { DOWNLOAD_ANCHOR, NAV_LINKS } from "../content";
import { Logo } from "./Logo";

/** Toppmenyn. Blir en utfällbar meny på små skärmar. */
export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Skuggan under menyn kommer först när sidan har skrollats, så att
  // startsidan känns lugn i toppen.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Esc stänger menyn, och den stängs också om fönstret blir bredare.
  useEffect(() => {
    if (!menuOpen) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const wide = window.matchMedia("(min-width: 861px)");
    const onWidthChange = () => {
      if (wide.matches) setMenuOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    wide.addEventListener("change", onWidthChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      wide.removeEventListener("change", onWidthChange);
    };
  }, [menuOpen]);

  return (
    <header className={`site-header${scrolled ? " is-scrolled" : ""}`}>
      <div className="shell site-header__inner">
        <a className="site-header__brand" href="#startsida">
          <Logo />
          <span className="visually-hidden">Lumi – till startsidan</span>
        </a>

        <nav className="site-nav" aria-label="Huvudmeny">
          <ul className="site-nav__list">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a className="site-nav__link" href={link.href}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="site-header__actions">
          <a className="button button--primary button--small site-header__cta" href={DOWNLOAD_ANCHOR}>
            <Download size={16} aria-hidden="true" />
            Ladda ner Lumi
          </a>

          <button
            className="site-header__toggle"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="mobilmeny"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
            <span className="visually-hidden">{menuOpen ? "Stäng menyn" : "Öppna menyn"}</span>
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="site-menu" id="mobilmeny">
          <nav aria-label="Meny">
            <ul className="site-menu__list">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a className="site-menu__link" href={link.href} onClick={() => setMenuOpen(false)}>
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <a
            className="button button--primary site-menu__cta"
            href={DOWNLOAD_ANCHOR}
            onClick={() => setMenuOpen(false)}
          >
            <Download size={17} aria-hidden="true" />
            Ladda ner Lumi
          </a>
        </div>
      )}
    </header>
  );
}
