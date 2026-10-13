import { About } from "./components/About";
import { DownloadSection } from "./components/Download";
import { Features } from "./components/Features";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { HowItWorks } from "./components/HowItWorks";

/**
 * Lumis webbplats. En sida med avsnitt: startsida, funktioner, så fungerar det,
 * nedladdning och om Lumi. Ingen inloggning, ingen databas och ingen AI här –
 * de delarna finns i skrivbordsappen.
 */
export default function App() {
  return (
    <>
      <a className="skip-link" href="#funktioner">
        Hoppa till innehållet
      </a>
      <Header />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <DownloadSection />
        <About />
      </main>
      <Footer />
    </>
  );
}
