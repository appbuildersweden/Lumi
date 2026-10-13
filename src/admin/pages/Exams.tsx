import { useMemo, useState } from "react";
import { FileText, Plus } from "lucide-react";
import { deleteExam, saveExam, saveExamResult, type Exam } from "../../lib/backend";
import {
  averageScore,
  classNames,
  examStudents,
  fullName,
  isStudent,
  shortDate,
  todayIso,
} from "../derive";
import type { AdminPageProps } from "../types";
import { AdminPage, ConfirmButton, Empty, Feedback, Tag, useFeedback } from "../ui";

const EMPTY_FORM = {
  id: "",
  title: "",
  subject: "",
  date: "",
  description: "",
};

/** Elev-prov: planerade och genomförda prov, deltagare och resultat. */
export default function Exams({ data }: AdminPageProps) {
  const feedback = useFeedback(data.reload);
  const today = todayIso();

  const [form, setForm] = useState(EMPTY_FORM);
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [resultExamId, setResultExamId] = useState("");
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState("");

  const classes = useMemo(() => classNames(data.people), [data.people]);
  const students = useMemo(() => data.people.filter(isStudent), [data.people]);

  /** Filtreringen gäller titel, ämne, klass och de elever provet gäller. */
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.exams.filter((exam) => {
      const participants = examStudents(exam, data.people);

      if (
        classFilter &&
        !exam.classNames.includes(classFilter) &&
        !participants.some((student) => student.className === classFilter)
      ) {
        return false;
      }

      if (!needle) return true;
      return [exam.title, exam.subject, exam.description, exam.classNames.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [data.exams, data.people, query, classFilter]);

  const planned = shown.filter((exam) => exam.date >= today);
  const done = shown.filter((exam) => exam.date < today);
  const resultExam = data.exams.find((exam) => exam.id === resultExamId) ?? null;

  function edit(exam: Exam) {
    setForm({
      id: exam.id,
      title: exam.title,
      subject: exam.subject,
      date: exam.date,
      description: exam.description,
    });
    setSelectedClasses(exam.classNames);
    setSelectedStudents(exam.studentIds);
  }

  async function save() {
    const ok = await feedback.run(
      () =>
        saveExam({
          id: form.id,
          title: form.title,
          subject: form.subject,
          date: form.date,
          classNames: selectedClasses,
          studentIds: selectedStudents,
          description: form.description,
          createdAtMs: 0,
        }),
      form.id ? "Provet sparades." : "Provet lades in."
    );

    if (ok) {
      setForm(EMPTY_FORM);
      setSelectedClasses([]);
      setSelectedStudents([]);
    }
  }

  return (
    <AdminPage
      badge={<FileText size={24} strokeWidth={1.8} aria-hidden />}
      eyebrow="Adminpanel"
      title="Elev-prov"
      lead="Planera prov, se vilka elever som ska göra dem och registrera resultat."
    >
      <Feedback notice={feedback.notice} error={feedback.error} />

      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">
            <Plus className="panel__icon" size={18} strokeWidth={2.2} aria-hidden />
            {form.id ? "Redigera prov" : "Nytt prov"}
          </h2>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>Rubrik</span>
            <input
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="t.ex. Prov i matematik"
            />
          </label>
          <label className="field">
            <span>Ämne</span>
            <input
              value={form.subject}
              onChange={(event) => setForm({ ...form, subject: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Provdatum</span>
            <input
              type="date"
              value={form.date}
              onChange={(event) => setForm({ ...form, date: event.target.value })}
            />
          </label>
        </div>

        <div className="field-grid">
          <label className="field field--wide">
            <span>Beskrivning</span>
            <input
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="Vad provet omfattar"
            />
          </label>
        </div>

        <p className="panel__label" style={{ marginTop: 18 }}>
          Klasser
        </p>
        {classes.length === 0 ? (
          <Empty
            title="Inga klasser i registret."
            hint="Klasser hämtas från elevernas klass i elevregistret."
          />
        ) : (
          <div className="toolbar">
            {classes.map((name) => {
              const on = selectedClasses.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  className={`chip${on ? " is-on" : ""}`}
                  onClick={() =>
                    setSelectedClasses(
                      on ? selectedClasses.filter((item) => item !== name) : [...selectedClasses, name]
                    )
                  }
                >
                  {name}
                </button>
              );
            })}
          </div>
        )}

        <p className="panel__label" style={{ marginTop: 18 }}>
          Enskilda elever ({selectedStudents.length} valda)
        </p>
        {students.length === 0 ? (
          <Empty
            title="Inga elever i registret."
            hint="Registrera elever under Elever först, så går de att välja här."
          />
        ) : (
          <div className="toolbar toolbar--scroll">
            {students.map((student) => {
              const on = selectedStudents.includes(student.id);
              return (
                <button
                  key={student.id}
                  type="button"
                  className={`chip${on ? " is-on" : ""}`}
                  onClick={() =>
                    setSelectedStudents(
                      on
                        ? selectedStudents.filter((id) => id !== student.id)
                        : [...selectedStudents, student.id]
                    )
                  }
                >
                  {fullName(student)}
                </button>
              );
            })}
          </div>
        )}

        <div className="toolbar">
          <button
            type="button"
            className="button button--primary"
            onClick={save}
            disabled={feedback.busy || !form.title.trim() || !form.subject.trim() || !form.date}
          >
            {form.id ? "Spara provet" : "Lägg in provet"}
          </button>
          {form.id && (
            <button type="button" className="button" onClick={() => setForm(EMPTY_FORM)}>
              Avbryt
            </button>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Filtrera prov</h2>
          <span className="panel__label">
            {shown.length} av {data.exams.length}
          </span>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>Sök</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rubrik, ämne eller klass"
            />
          </label>
          <label className="field">
            <span>Klass</span>
            <select
              value={classFilter}
              onChange={(event) => setClassFilter(event.target.value)}
            >
              <option value="">Alla klasser</option>
              {classes.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Planerade prov ({planned.length})</h2>
        </div>

        {planned.length === 0 ? (
          <Empty
            title="Inga planerade prov."
            hint={
              data.exams.length > 0 && query.trim() === "" && classFilter === ""
                ? "Prov med ett datum framåt i tiden visas här."
                : "Ingen träff med filtret. Prova en annan klass eller en annan sökning."
            }
          />
        ) : (
          <ul className="rows">
            {planned.map((exam) => (
              <ExamRow
                key={exam.id}
                exam={exam}
                data={data}
                busy={feedback.busy}
                onEdit={() => edit(exam)}
                onDelete={() =>
                  void feedback.run(() => deleteExam(exam.id), "Provet togs bort.")
                }
              />
            ))}
          </ul>
        )}
      </div>

      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Genomförda prov ({done.length})</h2>
        </div>

        {done.length === 0 ? (
          <Empty
            title="Inga genomförda prov."
            hint={
              data.exams.length > 0 && query.trim() === "" && classFilter === ""
                ? "Prov med ett datum som har passerat hamnar här tillsammans med resultaten."
                : "Ingen träff med filtret."
            }
          />
        ) : (
          <ul className="rows">
            {done.map((exam) => (
              <ExamRow
                key={exam.id}
                exam={exam}
                data={data}
                busy={feedback.busy}
                onEdit={() => edit(exam)}
                onDelete={() => void feedback.run(() => deleteExam(exam.id), "Provet togs bort.")}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Resultat och bedömningar</h2>
        </div>

        {data.exams.length === 0 ? (
          <Empty
            title="Inga prov att bedöma."
            hint="Lägg in ett prov först. Resultaten kopplas till provet och eleven."
          />
        ) : (
          <>
            <label className="field">
              <span>Prov</span>
              <select
                value={resultExamId}
                onChange={(event) => setResultExamId(event.target.value)}
              >
                <option value="">Välj prov…</option>
                {data.exams.map((exam) => (
                  <option key={exam.id} value={exam.id}>
                    {exam.title} · {shortDate(exam.date)}
                  </option>
                ))}
              </select>
            </label>

            {!resultExam ? (
              <Empty
                title="Välj ett prov."
                hint="Då visas eleverna som ska göra provet, och resultaten kan fyllas i."
              />
            ) : (
              <ul className="rows">
                {examStudents(resultExam, data.people).map((student) => {
                  const existing = data.examResults.find(
                    (result) =>
                      result.examId === resultExam.id && result.studentId === student.id
                  );

                  return (
                    <ResultRow
                      key={student.id}
                      studentName={fullName(student)}
                      className={student.className}
                      busy={feedback.busy}
                      score={existing?.score ?? null}
                      maxScore={existing?.maxScore ?? null}
                      grade={existing?.grade ?? ""}
                      comment={existing?.comment ?? ""}
                      onSave={(score, maxScore, grade, comment) =>
                        void feedback.run(
                          () =>
                            saveExamResult({
                              id: existing?.id ?? "",
                              examId: resultExam.id,
                              studentId: student.id,
                              score,
                              maxScore,
                              grade,
                              comment,
                              recordedAtMs: 0,
                            }),
                          `Resultatet för ${fullName(student)} sparades.`
                        )
                      }
                    />
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </AdminPage>
  );
}

interface ExamRowProps {
  exam: Exam;
  data: AdminPageProps["data"];
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

function ExamRow({ exam, data, busy, onEdit, onDelete }: ExamRowProps) {
  const participants = examStudents(exam, data.people);
  const results = data.examResults.filter((result) => result.examId === exam.id);
  const average = averageScore(results);

  return (
    <li className="row">
      <div className="row__main">
        <span className="row__title">
          {exam.title} · {shortDate(exam.date)}
        </span>
        <span className="row__meta">
          {exam.subject} · {participants.length} elever · {results.length} resultat
          {average !== null ? ` · snitt ${average} %` : ""}
        </span>
        {exam.description && <span className="row__meta">{exam.description}</span>}
      </div>

      <div className="row__actions">
        <Tag tone="info">{exam.classNames.join(", ") || "Enskilda elever"}</Tag>
        <button type="button" className="button" onClick={onEdit}>
          Redigera
        </button>
        <ConfirmButton
          label="Ta bort"
          question={`Ta bort "${exam.title}"? Resultaten ligger kvar men kopplas till ett prov som inte finns.`}
          confirmLabel="Ja, ta bort"
          disabled={busy}
          onConfirm={onDelete}
        />
      </div>
    </li>
  );
}

interface ResultRowProps {
  studentName: string;
  className: string;
  busy: boolean;
  score: number | null;
  maxScore: number | null;
  grade: string;
  comment: string;
  onSave: (
    score: number | null,
    maxScore: number | null,
    grade: string,
    comment: string
  ) => void;
}

function ResultRow({
  studentName,
  className,
  busy,
  score,
  maxScore,
  grade,
  comment,
  onSave,
}: ResultRowProps) {
  const [open, setOpen] = useState(false);
  const [localScore, setLocalScore] = useState(score === null ? "" : String(score));
  const [localMax, setLocalMax] = useState(maxScore === null ? "" : String(maxScore));
  const [localGrade, setLocalGrade] = useState(grade);
  const [localComment, setLocalComment] = useState(comment);

  return (
    <li className="row">
      <div className="row__main">
        <span className="row__title">{studentName}</span>
        <span className="row__meta">
          {className ? `${className} · ` : ""}
          {score !== null && maxScore !== null
            ? `${score} av ${maxScore} poäng`
            : "Inget resultat registrerat"}
          {grade ? ` · betyg ${grade}` : ""}
        </span>
      </div>

      <div className="row__actions">
        <Tag tone={score === null ? "muted" : "ok"}>
          {score === null ? "Saknas" : "Registrerat"}
        </Tag>
        <button type="button" className="button" onClick={() => setOpen((value) => !value)}>
          {score === null ? "Registrera" : "Ändra"}
        </button>
      </div>

      {open && (
        <div className="row__form">
          <div className="field-grid">
            <label className="field">
              <span>Poäng</span>
              <input
                value={localScore}
                onChange={(event) => setLocalScore(event.target.value)}
                inputMode="numeric"
              />
            </label>
            <label className="field">
              <span>Maxpoäng</span>
              <input
                value={localMax}
                onChange={(event) => setLocalMax(event.target.value)}
                inputMode="numeric"
              />
            </label>
            <label className="field">
              <span>Betyg</span>
              <input value={localGrade} onChange={(event) => setLocalGrade(event.target.value)} />
            </label>
            <label className="field">
              <span>Kommentar</span>
              <input
                value={localComment}
                onChange={(event) => setLocalComment(event.target.value)}
              />
            </label>
          </div>
          <div className="toolbar">
            <button
              type="button"
              className="button button--primary"
              disabled={busy}
              onClick={() => {
                onSave(
                  localScore === "" ? null : Number(localScore),
                  localMax === "" ? null : Number(localMax),
                  localGrade,
                  localComment
                );
                setOpen(false);
              }}
            >
              Spara resultat
            </button>
            <button type="button" className="button" onClick={() => setOpen(false)}>
              Avbryt
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
