import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  Lightbulb,
  MessagesSquare,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import RichText from "../components/RichText";
import {
  askLumi,
  conversationToContext,
  createQuiz,
  formatCost,
  formatDate,
  isMissingBackend,
  listStudyMaterial,
  runningInTauri,
  saveStudyMaterial,
  toLumiError,
  type ChatMessage,
  type StudyMaterial,
} from "../lib/backend";

interface Turn {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const STARTERS = [
  "Förklara Pythagoras sats steg för steg",
  "Vad är skillnaden mellan mitos och meios?",
  "Varför bröt första världskriget ut?",
  "Förklara fotosyntesen på ett enkelt sätt",
];

const SIMPLER_PROMPT =
  "Förklara det där igen, men enklare och med ett annat exempel.";

function newId(): string {
  return Math.random().toString(36).slice(2);
}

function TypingDots() {
  return (
    <span className="typing" aria-label="Lumi skriver">
      <span />
      <span />
      <span />
    </span>
  );
}

interface BubbleProps {
  turn: Turn;
}

function Bubble({ turn }: BubbleProps) {
  const isUser = turn.role === "user";

  return (
    <div className={`bubble ${isUser ? "bubble--user" : "bubble--assistant"}`}>
      {!isUser && (
        <span className="bubble__avatar" aria-hidden>
          <Sparkles size={15} strokeWidth={2.2} />
        </span>
      )}
      <div className="bubble__body">
        {isUser ? <p className="bubble__text">{turn.content}</p> : <RichText text={turn.content} />}
      </div>
    </div>
  );
}

export default function TeacherChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamedText, setStreamedText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastUsage, setLastUsage] = useState<{ model: string; cost: number | null } | null>(null);

  const [materials, setMaterials] = useState<StudyMaterial[]>([]);
  const [contextId, setContextId] = useState("");
  const [contextOpen, setContextOpen] = useState(false);

  const [quizOpen, setQuizOpen] = useState(false);
  const [quizSubject, setQuizSubject] = useState("");
  const [quizCount, setQuizCount] = useState(5);
  const [quizBusy, setQuizBusy] = useState(false);
  const [quizResult, setQuizResult] = useState<string | null>(null);
  // Sätts när modellen nådde sin längdgräns mitt i ett svar. Svaret visas
  // ändå, men eleven får veta att det kan saknas något på slutet.
  const [truncationNotice, setTruncationNotice] = useState<string | null>(null);

  // Texten ackumuleras i en ref också, så att den går att läsa av direkt efter
  // att svaret är klart utan att vänta på en ny rendering.
  const bufferRef = useRef("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!runningInTauri) return undefined;
    let active = true;
    listStudyMaterial()
      .then((items) => {
        if (active) setMaterials(items);
      })
      .catch(() => {
        /* Underlaget är frivilligt och ska inte kunna stoppa chatten. */
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [turns, streamedText]);

  const contextMaterial = useMemo(
    () => materials.find((item) => item.id === contextId) ?? null,
    [materials, contextId]
  );

  const lastAssistant = useMemo(() => {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      if (turns[index].role === "assistant") return turns[index];
    }
    return null;
  }, [turns]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;

    const userTurn: Turn = { id: newId(), role: "user", content: question };
    const history: ChatMessage[] = [...turns, userTurn].map((turn) => ({
      role: turn.role,
      content: turn.content,
    }));

    setTurns((previous) => [...previous, userTurn]);
    setDraft("");
    setBusy(true);
    setStreaming(true);
    setStreamedText("");
    setError(null);
    setQuizResult(null);
    setTruncationNotice(null);
    bufferRef.current = "";

    try {
      const usage = await askLumi({
        messages: history,
        materialId: contextId || null,
        onDelta: (chunk) => {
          bufferRef.current += chunk;
          setStreamedText(bufferRef.current);
        },
      });

      const answer = bufferRef.current.trim();
      setLastUsage({ model: usage.model, cost: usage.cost });

      if (!answer) {
        setError("AI:n skickade inget svar. Försök igen.");
      } else {
        setTurns((previous) => [
          ...previous,
          { id: newId(), role: "assistant", content: answer },
        ]);

        if (usage.truncated) {
          setTruncationNotice(
            "Svaret blev avhugget eftersom det nådde sin längdgräns. Be om en kortare förklaring om något verkar saknas."
          );
        }
      }
    } catch (raw) {
      if (!isMissingBackend(raw)) setError(toLumiError(raw).message);
    } finally {
      bufferRef.current = "";
      setStreaming(false);
      setStreamedText("");
      setBusy(false);
    }
  }

  async function createQuizFromChat() {
    const subject = quizSubject.trim();
    if (!subject) {
      setQuizResult("Skriv vilket ämne quizet hör till.");
      return;
    }

    setQuizBusy(true);
    setQuizResult(null);

    try {
      const context = await conversationToContext(
        turns.map((turn) => ({ role: turn.role, content: turn.content }))
      );

      const generated = await createQuiz({
        subject,
        topic: subject,
        count: quizCount,
        difficulty: "medel",
        context,
      });

      const saved = await saveStudyMaterial({
        kind: "quiz",
        subject: generated.subject,
        title: generated.title,
        content: generated.content,
        model: generated.model,
      });

      setMaterials((previous) => [saved, ...previous]);
      setQuizResult(`Sparat i Plugga: ${saved.title}`);
      setQuizOpen(false);
      setQuizSubject("");
    } catch (raw) {
      setQuizResult(toLumiError(raw).message);
    } finally {
      setQuizBusy(false);
    }
  }

  const isEmpty = turns.length === 0 && !streaming;

  return (
    <section className="chat-page">
      <header className="chat-page__head">
        <div className="chat-page__intro">
          <span className="page__badge">
            <MessagesSquare size={24} strokeWidth={1.8} aria-hidden />
          </span>
          <div>
            <p className="eyebrow">Lärare-Chat</p>
            <h1 className="page-title">Fråga om vad som helst</h1>
            <p className="page-lead">
              Lumi förklarar steg för steg och kommer ihåg hela samtalet.
            </p>
          </div>
        </div>

        <div className="chat-page__tools">
          <button
            type="button"
            className={`chip${contextMaterial ? " is-on" : ""}`}
            onClick={() => setContextOpen((open) => !open)}
            aria-expanded={contextOpen}
          >
            <BookOpen size={15} strokeWidth={2.1} aria-hidden />
            {contextMaterial ? contextMaterial.title : "Använd eget material"}
          </button>

          <button
            type="button"
            className="chip"
            onClick={() => {
              setTurns([]);
              setError(null);
              setLastUsage(null);
              setQuizResult(null);
            }}
            disabled={turns.length === 0 || busy}
          >
            <Trash2 size={15} strokeWidth={2.1} aria-hidden />
            Ny chatt
          </button>
        </div>
      </header>

      {contextOpen && (
        <div className="chat-context">
          <p className="chat-context__title">Använd sparat material som underlag</p>
          {materials.length === 0 ? (
            <p className="chat-context__hint">
              Du har inget sparat material ännu. Skapa något under Plugga först.
            </p>
          ) : (
            <div className="chat-context__list">
              {materials.map((material) => (
                <button
                  key={material.id}
                  type="button"
                  className={`context-item${material.id === contextId ? " is-on" : ""}`}
                  onClick={() => {
                    setContextId(material.id === contextId ? "" : material.id);
                    setContextOpen(false);
                  }}
                >
                  <span className="context-item__title">{material.title}</span>
                  <span className="context-item__meta">
                    {material.subject} · {formatDate(material.createdAtMs)}
                  </span>
                  {material.id === contextId && <Check size={15} strokeWidth={2.4} aria-hidden />}
                </button>
              ))}
            </div>
          )}
          {contextMaterial && (
            <p className="chat-context__hint">
              Lumi säger till när något inte står i underlaget, så du vet vad som är
              materialet och vad som är Lumis egen förklaring.
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="notice notice--error">
          <span>{error}</span>
          <button type="button" className="notice__action" onClick={() => setError(null)}>
            Stäng
          </button>
        </div>
      )}

      <div className="chat-page__scroll">
        {isEmpty ? (
          <div className="chat-empty">
            <p className="chat-empty__title">Vad vill du förstå idag?</p>
            <p className="chat-empty__text">
              Välj ett exempel eller skriv din egen fråga. Du kan be om en enklare
              förklaring när som helst.
            </p>
            <div className="chat-starters">
              {STARTERS.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  className="starter"
                  onClick={() => send(starter)}
                >
                  {starter}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="chat-thread">
            {turns.map((turn) => (
              <Bubble key={turn.id} turn={turn} />
            ))}

            {streaming && (
              <div className="bubble bubble--assistant">
                <span className="bubble__avatar" aria-hidden>
                  <Sparkles size={15} strokeWidth={2.2} />
                </span>
                <div className="bubble__body">
                  {streamedText ? <RichText text={streamedText} /> : <TypingDots />}
                </div>
              </div>
            )}

            {!streaming && lastAssistant && (
              <div className="chat-followups">
                <button
                  type="button"
                  className="chip chip--soft"
                  onClick={() => send(SIMPLER_PROMPT)}
                  disabled={busy}
                >
                  <Lightbulb size={15} strokeWidth={2.1} aria-hidden />
                  Förklara enklare
                </button>
                <button
                  type="button"
                  className="chip chip--soft"
                  onClick={() => setQuizOpen((open) => !open)}
                  disabled={busy}
                >
                  <Sparkles size={15} strokeWidth={2.1} aria-hidden />
                  Gör quiz av samtalet
                </button>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {quizOpen && (
        <div className="chat-quiz">
          <p className="chat-quiz__title">Skapa quiz av samtalet</p>
          <div className="chat-quiz__row">
            <input
              className="field"
              placeholder="Ämne, t.ex. Biologi"
              value={quizSubject}
              onChange={(event) => setQuizSubject(event.target.value)}
            />
            <label className="field field--inline">
              <span>Antal frågor</span>
              <input
                type="number"
                min={1}
                max={20}
                value={quizCount}
                onChange={(event) => setQuizCount(Number(event.target.value) || 1)}
              />
            </label>
            <button
              type="button"
              className="button button--primary"
              onClick={createQuizFromChat}
              disabled={quizBusy}
            >
              {quizBusy ? "Skapar …" : "Skapa och spara"}
            </button>
          </div>
        </div>
      )}

      {quizResult && <div className="notice notice--ok">{quizResult}</div>}
      {truncationNotice && <div className="notice notice--warn">{truncationNotice}</div>}

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
      >
        <textarea
          className="composer__input"
          placeholder="Skriv din fråga …"
          rows={1}
          value={draft}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send(draft);
            }
          }}
        />
        <button
          type="submit"
          className="composer__send"
          aria-label="Skicka"
          disabled={busy || draft.trim().length === 0}
        >
          <Send size={18} strokeWidth={2.2} aria-hidden />
        </button>
      </form>

      {lastUsage && (
        <p className="chat-usage">
          Svar från {lastUsage.model}
          {formatCost(lastUsage.cost) ? ` · ${formatCost(lastUsage.cost)}` : ""}
        </p>
      )}
    </section>
  );
}
