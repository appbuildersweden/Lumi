import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronLeft,
  Layers,
  ListChecks,
  NotebookPen,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import AiNotice from "../components/AiNotice";
import {
  createMaterial,
  deleteStudyMaterial,
  formatDate,
  isMissingBackend,
  listStudyMaterial,
  saveQuizResult,
  saveStudyMaterial,
  toLumiError,
  type Difficulty,
  type MaterialOf,
  type MaterialKind,
  type StudyMaterial,
} from "../lib/backend";

const KIND_ORDER: MaterialKind[] = [
  "quiz",
  "flashcards",
  "summary",
  "practice-exam",
  "notes",
  "study-plan",
];

const KIND_META: Record<MaterialKind, { label: string; hint: string; icon: typeof BookOpen }> = {
  quiz: {
    label: "Quiz",
    hint: "Frågor med svarsalternativ, rätt svar och förklaring.",
    icon: ListChecks,
  },
  flashcards: {
    label: "Flashcards",
    hint: "Fråga på framsidan, svar på baksidan.",
    icon: Layers,
  },
  summary: {
    label: "Sammanfattning",
    hint: "Tydliga avsnitt om ett ämne eller underlag.",
    icon: BookOpen,
  },
  "practice-exam": {
    label: "Övningsprov",
    hint: "Öppna frågor med poäng och facit.",
    icon: NotebookPen,
  },
  notes: {
    label: "Anteckningar",
    hint: "Rubriker och punkter med viktiga begrepp.",
    icon: NotebookPen,
  },
  "study-plan": {
    label: "Studieplan",
    hint: "Vad du ska plugga och i vilken ordning.",
    icon: Sparkles,
  },
};

const COUNT_KINDS: MaterialKind[] = ["quiz", "flashcards", "practice-exam"];

const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: "latt", label: "Lätt" },
  { value: "medel", label: "Medel" },
  { value: "svar", label: "Svår" },
];

/** Tar bort ett enskilt avsnitt, kort eller en fråga ur materialet. */
function withoutItem(material: StudyMaterial, index: number): StudyMaterial {
  switch (material.kind) {
    case "quiz":
      return {
        ...material,
        content: {
          questions: material.content.questions.filter((_, item) => item !== index),
        },
      };
    case "practice-exam":
      return {
        ...material,
        content: {
          ...material.content,
          questions: material.content.questions.filter((_, item) => item !== index),
        },
      };
    case "flashcards":
      return {
        ...material,
        content: { cards: material.content.cards.filter((_, item) => item !== index) },
      };
    case "notes":
      return {
        ...material,
        content: {
          sections: material.content.sections.filter((_, item) => item !== index),
        },
      };
    case "study-plan":
      return {
        ...material,
        content: { ...material.content, steps: material.content.steps.filter((_, item) => item !== index) },
      };
    default:
      return {
        ...material,
        content: {
          sections: material.content.sections.filter((_, item) => item !== index),
        },
      };
  }
}

function itemCount(material: StudyMaterial): number {
  switch (material.kind) {
    case "quiz":
    case "practice-exam":
      return material.content.questions.length;
    case "flashcards":
      return material.content.cards.length;
    case "study-plan":
      return material.content.steps.length;
    default:
      return material.content.sections.length;
  }
}

// ── Interaktiv visning av sparat material ─────────────────────────────────

interface MaterialViewProps {
  material: StudyMaterial;
  onClose: () => void;
  onDelete: (material: StudyMaterial) => void;
  onResult: (message: string) => void;
}

function MaterialView({ material, onClose, onDelete, onResult }: MaterialViewProps) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [revealed, setRevealed] = useState(false);
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [selfGrades, setSelfGrades] = useState<Record<number, boolean>>({});
  const [savedScore, setSavedScore] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function gradeQuiz(questions: MaterialOf<"quiz">["content"]["questions"]) {
    const correct = questions.reduce(
      (sum, question, index) => sum + (answers[index] === question.correctIndex ? 1 : 0),
      0
    );
    setRevealed(true);

    if (savedScore) return;
    try {
      await saveQuizResult(material.id, correct, questions.length);
      setSavedScore(true);
      onResult(`Resultatet ${correct}/${questions.length} sparades under Framsteg.`);
    } catch (raw) {
      onResult(`Kunde inte spara resultatet: ${toLumiError(raw).message}`);
    }
  }

  async function gradeExam(questions: MaterialOf<"practice-exam">["content"]["questions"]) {
    const graded = Object.keys(selfGrades).length;
    if (graded < questions.length) {
      onResult("Markera rätt eller fel på varje fråga först.");
      return;
    }

    const correct = questions.reduce(
      (sum, _question, index) => sum + (selfGrades[index] ? 1 : 0),
      0
    );

    try {
      await saveQuizResult(material.id, correct, questions.length);
      onResult(`Resultatet ${correct}/${questions.length} sparades under Framsteg.`);
      setSavedScore(true);
    } catch (raw) {
      onResult(`Kunde inte spara resultatet: ${toLumiError(raw).message}`);
    }
  }

  return (
    <section className="material">
      <button type="button" className="link-back" onClick={onClose}>
        <ChevronLeft size={16} strokeWidth={2.2} aria-hidden />
        Tillbaka till allt material
      </button>

      <header className="material__head">
        <div>
          <p className="eyebrow">{KIND_META[material.kind].label}</p>
          <h1 className="page-title">{material.title}</h1>
          <p className="page-lead">
            {material.subject} · {itemCount(material)} st · {formatDate(material.createdAtMs)}
          </p>
        </div>

        <button
          type="button"
          className="chip chip--danger"
          onClick={() => {
            if (confirmDelete) {
              onDelete(material);
            } else {
              setConfirmDelete(true);
            }
          }}
        >
          <Trash2 size={15} strokeWidth={2.1} aria-hidden />
          {confirmDelete ? "Bekräfta borttagning" : "Ta bort"}
        </button>
      </header>

      {material.kind === "quiz" && (
        <ol className="quiz">
          {material.content.questions.map((question, index) => {
            const picked = answers[index];
            return (
              <li key={index} className="quiz__item">
                <p className="quiz__question">{question.question}</p>
                <div className="quiz__options">
                  {question.options.map((option, optionIndex) => {
                    const isPicked = picked === optionIndex;
                    const isCorrect = question.correctIndex === optionIndex;
                    const state = revealed
                      ? isCorrect
                        ? "is-correct"
                        : isPicked
                          ? "is-wrong"
                          : ""
                      : isPicked
                        ? "is-picked"
                        : "";
                    return (
                      <button
                        key={optionIndex}
                        type="button"
                        className={`option ${state}`}
                        disabled={revealed}
                        onClick={() => setAnswers((all) => ({ ...all, [index]: optionIndex }))}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
                {revealed && <p className="quiz__why">{question.explanation}</p>}
              </li>
            );
          })}
        </ol>
      )}

      {material.kind === "quiz" && (
        <div className="material__actions">
          <button
            type="button"
            className="button button--primary"
            onClick={() => gradeQuiz(material.content.questions)}
            disabled={Object.keys(answers).length < material.content.questions.length}
          >
            Rätta quizet
          </button>
          {revealed && (
            <button
              type="button"
              className="button"
              onClick={() => {
                setAnswers({});
                setRevealed(false);
              }}
            >
              <Undo2 size={15} strokeWidth={2.1} aria-hidden />
              Gör om
            </button>
          )}
        </div>
      )}

      {material.kind === "flashcards" && (
        <div className="flashcards">
          <button
            type="button"
            className={`flashcard${flipped ? " is-flipped" : ""}`}
            onClick={() => setFlipped((value) => !value)}
          >
            <span className="flashcard__label">{flipped ? "Svar" : "Fråga"}</span>
            <span className="flashcard__text">
              {flipped
                ? material.content.cards[cardIndex].back
                : material.content.cards[cardIndex].front}
            </span>
            <span className="flashcard__hint">Klicka för att vända</span>
          </button>

          <div className="flashcards__nav">
            <button
              type="button"
              className="button"
              onClick={() => {
                setFlipped(false);
                setCardIndex((index) => Math.max(0, index - 1));
              }}
              disabled={cardIndex === 0}
            >
              Föregående
            </button>
            <span className="flashcards__count">
              {cardIndex + 1} / {material.content.cards.length}
            </span>
            <button
              type="button"
              className="button"
              onClick={() => {
                setFlipped(false);
                setCardIndex((index) =>
                  Math.min(material.content.cards.length - 1, index + 1)
                );
              }}
              disabled={cardIndex === material.content.cards.length - 1}
            >
              Nästa
            </button>
          </div>
        </div>
      )}

      {material.kind === "practice-exam" && (
        <>
          <p className="exam__instructions">{material.content.instructions}</p>
          <ol className="exam">
            {material.content.questions.map((question, index) => (
              <li key={index} className="exam__item">
                <p className="exam__question">
                  {question.question}
                  <span className="exam__points">{question.points} p</span>
                </p>
                <details className="exam__facit">
                  <summary>Visa facit</summary>
                  <p className="exam__answer">{question.answer}</p>
                  <p className="exam__why">{question.explanation}</p>
                </details>
                <div className="exam__grade">
                  <button
                    type="button"
                    className={`option option--grade${
                      selfGrades[index] === true ? " is-correct" : ""
                    }`}
                    onClick={() => setSelfGrades((all) => ({ ...all, [index]: true }))}
                  >
                    <Check size={14} strokeWidth={2.6} aria-hidden />
                    Rätt
                  </button>
                  <button
                    type="button"
                    className={`option option--grade${
                      selfGrades[index] === false ? " is-wrong" : ""
                    }`}
                    onClick={() => setSelfGrades((all) => ({ ...all, [index]: false }))}
                  >
                    <X size={14} strokeWidth={2.6} aria-hidden />
                    Fel
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <div className="material__actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => gradeExam(material.content.questions)}
            >
              Spara resultat
            </button>
          </div>
        </>
      )}

      {(material.kind === "summary" || material.kind === "notes") && (
        <div className="sections">
          {material.content.sections.map((section, index) => (
            <article key={index} className="section-block">
              <h2 className="section-block__heading">{section.heading}</h2>
              {"body" in section ? (
                <p className="section-block__body">{section.body}</p>
              ) : (
                <ul className="section-block__bullets">
                  {section.bullets.map((bullet, bulletIndex) => (
                    <li key={bulletIndex}>{bullet}</li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}

      {material.kind === "study-plan" && (
        <div className="plan">
          <p className="plan__summary">{material.content.summary}</p>
          <ol className="plan__steps">
            {material.content.steps.map((step, index) => (
              <li key={index} className="plan__step">
                <span className="plan__number">{index + 1}</span>
                <div>
                  <p className="plan__title">{step.title}</p>
                  <p className="plan__focus">{step.focus}</p>
                </div>
                <span className="plan__minutes">{step.minutes} min</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

// ── Plugga ────────────────────────────────────────────────────────────────

export default function Study() {
  const [materials, setMaterials] = useState<StudyMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filterKind, setFilterKind] = useState<MaterialKind | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [kind, setKind] = useState<MaterialKind>("quiz");
  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("medel");
  const [count, setCount] = useState(5);
  const [sourceId, setSourceId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<StudyMaterial | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    listStudyMaterial()
      .then((items) => {
        if (active) setMaterials(items);
      })
      .catch((raw) => {
        // Saknad backend visas som en egen notis, inte som ett fel här.
        if (active && !isMissingBackend(raw)) setError(toLumiError(raw).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const subjects = useMemo(
    () => [...new Set(materials.map((material) => material.subject))].sort(),
    [materials]
  );

  const visible = useMemo(
    () =>
      filterKind === "all"
        ? materials
        : materials.filter((material) => material.kind === filterKind),
    [materials, filterKind]
  );

  const openMaterial = materials.find((material) => material.id === openId) ?? null;

  async function generate() {
    if (!subject.trim() || !topic.trim()) {
      setError("Fyll i både ämne och vad materialet ska handla om.");
      return;
    }

    setGenerating(true);
    setError(null);
    setNotice(null);

    try {
      const generated = await createMaterial({
        kind,
        subject: subject.trim(),
        topic: topic.trim(),
        difficulty,
        count: COUNT_KINDS.includes(kind) ? count : undefined,
        materialId: sourceId || null,
      });
      setPreview(generated);
    } catch (raw) {
      if (!isMissingBackend(raw)) setError(toLumiError(raw).message);
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    if (!preview) return;
    setSaving(true);
    setError(null);

    try {
      const saved = await saveStudyMaterial({
        kind: preview.kind,
        subject: preview.subject,
        title: preview.title,
        content: preview.content,
        model: preview.model,
      });
      setMaterials((previous) => [saved, ...previous]);
      setNotice(`Sparat: ${saved.title}`);
      setPreview(null);
      setCreateOpen(false);
      setTopic("");
    } catch (raw) {
      if (!isMissingBackend(raw)) setError(toLumiError(raw).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(material: StudyMaterial, closeAfter: boolean) {
    try {
      const removed = await deleteStudyMaterial(material.id);
      if (!removed) {
        setError("Materialet fanns inte längre.");
        return;
      }
      setMaterials((previous) => previous.filter((item) => item.id !== material.id));
      if (closeAfter) setOpenId(null);
      setNotice(`Borttaget: ${material.title}`);
    } catch (raw) {
      if (!isMissingBackend(raw)) setError(toLumiError(raw).message);
    }
  }

  if (openMaterial) {
    return (
      <section className="page page--wide">
        {notice && <div className="notice notice--ok">{notice}</div>}
        {error && <div className="notice notice--error">{error}</div>}
        <MaterialView
          material={openMaterial}
          onClose={() => setOpenId(null)}
          onDelete={(material) => remove(material, true)}
          onResult={setNotice}
        />
      </section>
    );
  }

  return (
    <section className="page page--wide">
      <header className="study-head">
        <div>
          <p className="eyebrow">Plugga</p>
          <h1 className="page-title">Ditt studiematerial</h1>
          <p className="page-lead">
            Låt Lumi skapa quiz, flashcards, sammanfattningar och prov. Du granskar
            allt innan det sparas.
          </p>
        </div>

        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            setCreateOpen((open) => !open);
            setPreview(null);
            setError(null);
          }}
        >
          <Plus size={16} strokeWidth={2.4} aria-hidden />
          Skapa nytt
        </button>
      </header>

      <AiNotice />

      {error && <div className="notice notice--error">{error}</div>}
      {notice && <div className="notice notice--ok">{notice}</div>}

      {createOpen && (
        <div className="create">
          <div className="create__kinds">
            {KIND_ORDER.map((value) => {
              const meta = KIND_META[value];
              const Icon = meta.icon;
              return (
                <button
                  key={value}
                  type="button"
                  className={`kind-card${kind === value ? " is-on" : ""}`}
                  onClick={() => setKind(value)}
                  aria-pressed={kind === value}
                >
                  <Icon size={18} strokeWidth={2} aria-hidden />
                  <span className="kind-card__label">{meta.label}</span>
                  <span className="kind-card__hint">{meta.hint}</span>
                </button>
              );
            })}
          </div>

          <div className="create__fields">
            <label className="field">
              <span>Ämne</span>
              <input
                list="lumi-subjects"
                value={subject}
                placeholder="t.ex. Biologi"
                onChange={(event) => setSubject(event.target.value)}
              />
              <datalist id="lumi-subjects">
                {subjects.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </label>

            <label className="field">
              <span>Vad ska det handla om?</span>
              <input
                value={topic}
                placeholder="t.ex. Fotosyntesen"
                onChange={(event) => setTopic(event.target.value)}
              />
            </label>

            <label className="field">
              <span>Nivå</span>
              <select
                value={difficulty}
                onChange={(event) => setDifficulty(event.target.value as Difficulty)}
              >
                {DIFFICULTIES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {COUNT_KINDS.includes(kind) && (
              <label className="field">
                <span>Antal</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={count}
                  onChange={(event) => setCount(Number(event.target.value) || 1)}
                />
              </label>
            )}

            {materials.length > 0 && (
              <label className="field field--wide">
                <span>Använd sparat material som underlag (frivilligt)</span>
                <select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
                  <option value="">Inget underlag</option>
                  {materials.map((material) => (
                    <option key={material.id} value={material.id}>
                      {material.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="create__actions">
            <button
              type="button"
              className="button button--primary"
              onClick={generate}
              disabled={generating}
            >
              <Sparkles size={16} strokeWidth={2.2} aria-hidden />
              {generating ? "Skapar …" : "Skapa med AI"}
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                setCreateOpen(false);
                setPreview(null);
              }}
            >
              Avbryt
            </button>
          </div>
        </div>
      )}

      {preview && (
        <div className="preview">
          <div className="preview__head">
            <span className="preview__badge">Förhandsgranskning</span>
            <p className="preview__hint">
              Kontrollera innehållet. Du kan byta rubrik och ta bort sådant du inte vill
              spara.
            </p>
          </div>

          <div className="preview__fields">
            <label className="field">
              <span>Ämne</span>
              <input
                value={preview.subject}
                onChange={(event) =>
                  setPreview({ ...preview, subject: event.target.value } as StudyMaterial)
                }
              />
            </label>
            <label className="field">
              <span>Rubrik</span>
              <input
                value={preview.title}
                onChange={(event) =>
                  setPreview({ ...preview, title: event.target.value } as StudyMaterial)
                }
              />
            </label>
          </div>

          <PreviewBody
            material={preview}
            onRemove={(index) => setPreview(withoutItem(preview, index))}
          />

          <div className="create__actions">
            <button
              type="button"
              className="button button--primary"
              onClick={save}
              disabled={saving}
            >
              <Check size={16} strokeWidth={2.4} aria-hidden />
              {saving ? "Sparar …" : "Spara i Plugga"}
            </button>
            <button type="button" className="button" onClick={generate} disabled={generating}>
              <RefreshCw size={15} strokeWidth={2.1} aria-hidden />
              Skapa ett nytt förslag
            </button>
            <button type="button" className="button" onClick={() => setPreview(null)}>
              Släng
            </button>
          </div>
        </div>
      )}

      <div className="study-filters">
        <button
          type="button"
          className={`chip${filterKind === "all" ? " is-on" : ""}`}
          onClick={() => setFilterKind("all")}
        >
          Allt ({materials.length})
        </button>
        {KIND_ORDER.map((value) => {
          const amount = materials.filter((material) => material.kind === value).length;
          if (amount === 0) return null;
          return (
            <button
              key={value}
              type="button"
              className={`chip${filterKind === value ? " is-on" : ""}`}
              onClick={() => setFilterKind(value)}
            >
              {KIND_META[value].label} ({amount})
            </button>
          );
        })}
      </div>

      {loading ? (
        <p className="panel__text">Läser in ditt material …</p>
      ) : visible.length === 0 ? (
        <div className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Inget material ännu</h2>
          </div>
          <p className="panel__text">
            När du skapar quiz, flashcards eller sammanfattningar hamnar de här och
            finns kvar nästa gång du öppnar Lumi.
          </p>
        </div>
      ) : (
        <div className="material-grid">
          {visible.map((material) => {
            const meta = KIND_META[material.kind];
            const Icon = meta.icon;
            return (
              <article key={material.id} className="material-card">
                <button
                  type="button"
                  className="material-card__open"
                  onClick={() => {
                    setOpenId(material.id);
                    setNotice(null);
                    setError(null);
                  }}
                >
                  <span className="material-card__icon">
                    <Icon size={18} strokeWidth={1.9} aria-hidden />
                  </span>
                  <span className="material-card__kind">{meta.label}</span>
                  <span className="material-card__title">{material.title}</span>
                  <span className="material-card__meta">
                    {material.subject} · {itemCount(material)} st ·{" "}
                    {formatDate(material.createdAtMs)}
                  </span>
                </button>
                <button
                  type="button"
                  className="material-card__delete"
                  aria-label={`Ta bort ${material.title}`}
                  onClick={() => remove(material, false)}
                >
                  <Trash2 size={15} strokeWidth={2} aria-hidden />
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

interface PreviewBodyProps {
  material: StudyMaterial;
  onRemove: (index: number) => void;
}

/** Kort genomgång av det AI:n föreslagit, med möjlighet att stryka objekt. */
function PreviewBody({ material, onRemove }: PreviewBodyProps) {
  const remove = (index: number) => (
    <button
      type="button"
      className="preview__remove"
      onClick={() => onRemove(index)}
      aria-label="Ta bort"
    >
      <Trash2 size={14} strokeWidth={2} aria-hidden />
    </button>
  );

  if (material.kind === "quiz") {
    return (
      <ol className="quiz quiz--preview">
        {material.content.questions.map((question, index) => (
          <li key={index} className="quiz__item">
            <div className="preview__row">
              <p className="quiz__question">{question.question}</p>
              {remove(index)}
            </div>
            <div className="quiz__options">
              {question.options.map((option, optionIndex) => (
                <span
                  key={optionIndex}
                  className={`option is-static${
                    question.correctIndex === optionIndex ? " is-correct" : ""
                  }`}
                >
                  {option}
                </span>
              ))}
            </div>
            <p className="quiz__why">{question.explanation}</p>
          </li>
        ))}
      </ol>
    );
  }

  if (material.kind === "flashcards") {
    return (
      <div className="sections">
        {material.content.cards.map((card, index) => (
          <article key={index} className="section-block">
            <div className="preview__row">
              <h2 className="section-block__heading">{card.front}</h2>
              {remove(index)}
            </div>
            <p className="section-block__body">{card.back}</p>
          </article>
        ))}
      </div>
    );
  }

  if (material.kind === "practice-exam") {
    return (
      <>
        <p className="exam__instructions">{material.content.instructions}</p>
        <ol className="exam">
          {material.content.questions.map((question, index) => (
            <li key={index} className="exam__item">
              <div className="preview__row">
                <p className="exam__question">
                  {question.question}
                  <span className="exam__points">{question.points} p</span>
                </p>
                {remove(index)}
              </div>
              <p className="exam__answer">Facit: {question.answer}</p>
              <p className="exam__why">{question.explanation}</p>
            </li>
          ))}
        </ol>
      </>
    );
  }

  if (material.kind === "study-plan") {
    return (
      <div className="plan">
        <p className="plan__summary">{material.content.summary}</p>
        <ol className="plan__steps">
          {material.content.steps.map((step, index) => (
            <li key={index} className="plan__step">
              <span className="plan__number">{index + 1}</span>
              <div>
                <p className="plan__title">{step.title}</p>
                <p className="plan__focus">{step.focus}</p>
              </div>
              <span className="plan__minutes">{step.minutes} min</span>
              {remove(index)}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="sections">
      {material.content.sections.map((section, index) => (
        <article key={index} className="section-block">
          <div className="preview__row">
            <h2 className="section-block__heading">{section.heading}</h2>
            {remove(index)}
          </div>
          {"body" in section ? (
            <p className="section-block__body">{section.body}</p>
          ) : (
            <ul className="section-block__bullets">
              {section.bullets.map((bullet, bulletIndex) => (
                <li key={bulletIndex}>{bullet}</li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </div>
  );
}
