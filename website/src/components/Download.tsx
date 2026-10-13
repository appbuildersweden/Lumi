import { Download as DownloadIcon } from "lucide-react";
import { DOWNLOAD, DOWNLOAD_PENDING_NOTE, DOWNLOAD_TEXT, DOWNLOAD_TITLE } from "../content";
import { Reveal } from "./Reveal";

/**
 * Nedladdningen. Så länge installationsfilen inte finns visas en inaktiverad
 * knapp i stället för en länk som inte leder någonstans. När DOWNLOAD.available
 * sätts till true och url fylls i blir knappen en riktig nedladdningslänk.
 */
export function DownloadSection() {
  const { available, url, version, requirements, steps } = DOWNLOAD;
  const ready = available && url !== null;

  return (
    <section className="section section--download" id="ladda-ner">
      <div className="shell">
        <Reveal className="download">
          <div className="download__copy">
            <p className="eyebrow eyebrow--on-dark">Nedladdning</p>
            <h2 className="download__title">{DOWNLOAD_TITLE}</h2>
            <p className="download__lead">{DOWNLOAD_TEXT}</p>
            {ready && version && <p className="download__version">Version {version}</p>}
          </div>

          <div className="download__action">
            {ready ? (
              <a className="button button--light button--large" href={url} download>
                <DownloadIcon size={18} aria-hidden="true" />
                Ladda ner Lumi
              </a>
            ) : (
              <>
                <button className="button button--disabled button--large" type="button" disabled>
                  Kommer snart
                </button>
                <p className="download__note">{DOWNLOAD_PENDING_NOTE}</p>
              </>
            )}
          </div>
        </Reveal>

        {(requirements.length > 0 || steps.length > 0) && (
          <div className="download__details">
            {requirements.length > 0 && (
              <div className="download__detail">
                <h3 className="download__detail-title">Systemkrav</h3>
                <ul className="download__list">
                  {requirements.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {steps.length > 0 && (
              <div className="download__detail">
                <h3 className="download__detail-title">Installation</h3>
                <ol className="download__list download__list--ordered">
                  {steps.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
