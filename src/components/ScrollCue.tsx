import { ArrowDown } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";

interface ScrollCueProps {
  target: RefObject<HTMLElement | null>;
}

/** Rund knapp som indikerar att det finns mer innehåll nedanför. */
export default function ScrollCue({ target }: ScrollCueProps) {
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    const el = target.current;
    if (!el) return undefined;

    const update = () => {
      const remaining = el.scrollHeight - el.clientHeight - el.scrollTop;
      setHasMore(remaining > 24);
    };

    update();
    el.addEventListener("scroll", update, { passive: true });

    const observer = new ResizeObserver(update);
    observer.observe(el);

    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [target]);

  if (!hasMore) return null;

  return (
    <button
      type="button"
      className="scroll-cue"
      aria-label="Visa mer"
      onClick={() => {
        const el = target.current;
        if (el) el.scrollBy({ top: el.clientHeight * 0.75, behavior: "smooth" });
      }}
    >
      <ArrowDown size={18} strokeWidth={2.4} aria-hidden />
    </button>
  );
}
