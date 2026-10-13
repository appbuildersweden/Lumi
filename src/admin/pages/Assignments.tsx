import { useMemo, useState } from "react";
import { ClipboardList, Pencil, Plus } from "lucide-react";
import { deleteAssignment, saveAssignment, type Assignment } from "../../lib/backend";
import { assignmentStudents, classNames, fullName, isStudent, shortDate, todayIso } from "../derive";
import type { AdminPageProps } from "../types";
import { AdminPage, ConfirmButton, Empty, Feedback, Tag, useFeedback } from "../ui";

const EMPTY_FORM = {
  id: "",
  title: "",
  subject: "",
  instructions: "",
  dueDate: "",
  published: false,
};

/** Uppgifter: skapa, redigera och publicera till klasser eller enskilda elever. */
export default function Assignments({ data }: AdminPageProps) {
  const feedback = useFeedback(data.reload);
  const [form, setForm] = useState(EMPTY_FORM);
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);

  const classes = useMemo(() => classNames(data.people), [data.people]);
  const students = useMemo(() => data.people.filter(isStudent), [data.people]);
  const editing = form.id !== "";

  function reset() {
    setForm(EMPTY_FORM);
    setSelectedClasses([]);
    setSelectedStudents([]);
  }

  function edit(assignment: Assignment) {
    setForm({
      id: assignment.id,
      title: assignment.title,
      subject: assignment.subject,
      instructions: assignment.instructions,
      dueDate: assignment.dueDate,
      published: assignment.published,
    });
    setSelectedClasses(assignment.classNames);
    setSelectedStudents(assignment.studentIds);
  }

  async function save(published = form.published) {
    const ok = await feedback.run(
      () =>
        saveAssignment({
          id: form.id,
          title: form.title,
          subject: form.subject,
          instructions: form.instructions,
          dueDate: form.dueDate,
          classNames: selectedClasses,
          studentIds: selectedStudents,
          published,
          createdAtMs: 0,
          createdByName: "",
        }),
      published ? "Uppgiften sparades och är publicerad." : "Uppgiften sparades som utkast."
    );

    if (ok) reset();
  }

  return (
    <AdminPage
      badge={<ClipboardList size={24} strokeWidth={1.8} aria-hidden />}
      eyebrow="Adminpanel"
      title="Uppgifter"
      lead="Skapa en uppgift med ämne, instruktioner och deadline. Publicera den till en klass eller enskilda elever."
    >
      <Feedback notice={feedback.notice} error={feedback.error} />

      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">
            <Plus className="panel__icon" size={18} strokeWidth={2.2} aria-hidden />
            {editing ? "Redigera uppgift" : "Ny uppgift"}
          </h2>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>Rubrik</span>
            <input
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="t.ex. Läsläxa kapitel 4"
            />
          </label>
          <label className="field">
            <span>Ämne</span>
            <input
              value={form.subject}
              onChange={(event) => setForm({ ...form, subject: event.target.value })}
              placeholder="t.ex. Matematik"
            />
          </label>
          <label className="field">
            <span>Deadline</span>
            <input
              type="date"
              value={form.dueDate}
              onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
            />
          </label>
        </div>

        <div className="field-grid">
          <label className="field field--wide">
            <span>Instruktioner</span>
            <input
              value={form.instructions}
              onChange={(event) => setForm({ ...form, instructions: event.target.value })}
              placeholder="Vad eleven ska göra"
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
                      on
                        ? selectedClasses.filter((item) => item !== name)
                        : [...selectedClasses, name]
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
            onClick={() => save(true)}
            disabled={feedback.busy || !form.title.trim() || !form.subject.trim() || !form.dueDate}
          >
            {editing ? "Spara och publicera" : "Publicera"}
          </button>
          <button
            type="button"
            className="button"
            onClick={() => save(false)}
            disabled={feedback.busy || !form.title.trim() || !form.subject.trim() || !form.dueDate}
          >
            Spara som utkast
          </button>
          {editing && (
            <button type="button" className="button" onClick={reset}>
              Avbryt
            </button>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Alla uppgifter ({data.assignments.length})</h2>
        </div>

        {data.assignments.length === 0 ? (
          <Empty
            title="Inga uppgifter ännu."
            hint="Skapa den första uppgiften ovan. Utkast syns bara här."
          />
        ) : (
          <ul className="rows">
            {data.assignments.map((assignment) => {
              const targets = assignmentStudents(assignment, data.people);
              const overdue = assignment.dueDate < todayIso();
              return (
                <li key={assignment.id} className="row">
                  <div className="row__main">
                    <span className="row__title">{assignment.title}</span>
                    <span className="row__meta">
                      {assignment.subject} · deadline {shortDate(assignment.dueDate)} ·{" "}
                      {targets.length} elever
                      {assignment.createdByName ? ` · ${assignment.createdByName}` : ""}
                    </span>
                    {assignment.instructions && (
                      <span className="row__meta">{assignment.instructions}</span>
                    )}
                  </div>

                  <div className="row__actions">
                    <Tag tone={assignment.published ? "ok" : "muted"}>
                      {assignment.published ? "Publicerad" : "Utkast"}
                    </Tag>
                    {overdue && <Tag tone="warn">Deadline passerad</Tag>}

                    <button type="button" className="button" onClick={() => edit(assignment)}>
                      <Pencil size={15} strokeWidth={2} aria-hidden />
                      Redigera
                    </button>

                    <ConfirmButton
                      label="Ta bort"
                      question={`Ta bort "${assignment.title}"?`}
                      confirmLabel="Ja, ta bort"
                      disabled={feedback.busy}
                      onConfirm={() =>
                        void feedback.run(
                          () => deleteAssignment(assignment.id),
                          "Uppgiften togs bort."
                        )
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AdminPage>
  );
}
