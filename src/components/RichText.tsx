import { Fragment, type ReactNode } from "react";

/** Delar upp en textrad i fetstil kring **markeringar**. */
function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

interface RichTextProps {
  text: string;
}

/**
 * Enkel visning av AI-text: stycken, punktlistor, numrerade listor och fetstil.
 * Avsiktligt liten – vi tolkar inte hela Markdown, bara det som faktiskt
 * förekommer i Lumis svar.
 */
export default function RichText({ text }: RichTextProps) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];

  let paragraph: string[] = [];
  let bullets: string[] = [];
  let numbers: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(<p key={blocks.length}>{renderInline(paragraph.join(" "))}</p>);
    paragraph = [];
  };

  const flushBullets = () => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={blocks.length}>
        {bullets.map((item, index) => (
          <li key={index}>{renderInline(item)}</li>
        ))}
      </ul>
    );
    bullets = [];
  };

  const flushNumbers = () => {
    if (numbers.length === 0) return;
    blocks.push(
      <ol key={blocks.length}>
        {numbers.map((item, index) => (
          <li key={index}>{renderInline(item)}</li>
        ))}
      </ol>
    );
    numbers = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushBullets();
    flushNumbers();
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushAll();
      continue;
    }

    // Rubriker i Markdown visas som fetstil på egen rad.
    const heading = /^#{1,6}\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushAll();
      blocks.push(
        <p className="rich__heading" key={blocks.length}>
          {renderInline(heading[1])}
        </p>
      );
      continue;
    }

    const bullet = /^[-*•]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      flushNumbers();
      bullets.push(bullet[1]);
      continue;
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (numbered) {
      flushParagraph();
      flushBullets();
      numbers.push(numbered[1]);
      continue;
    }

    flushBullets();
    flushNumbers();
    paragraph.push(trimmed);
  }

  flushAll();

  return <div className="rich">{blocks}</div>;
}
