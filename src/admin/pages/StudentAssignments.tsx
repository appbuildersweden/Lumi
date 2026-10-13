import { useMemo, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { saveSubmission, type Submission } from "../../lib/backend";
import {
  SUBMISSION_LABELS,
  assignmentStudents,
  classNames,
  fullName,
  shortDate,
  statusFor,
  todayIso,
  type SubmissionRow,
  type SubmissionStatus,
} from "../derive";
import type { AdminPageProps } from "../types";
import { AdminPage, Empty, Feedback, Tag, useFeedback } from "../ui";

const STATUSES: SubmissionStatus[] = ["saknad", "sen", "inlamnad", "vantar"];

const STATUS_TONE: Record<SubmissionStatus, "ok" | "warn" | "bad" | "muted" | "info"> = {
  inlamnad: "ok",
  sen: "warn",
  saknad: "bad",
  vantar: "muted",
};

/** Elev-uppgifter: vad som är inlämnat, saknat och försenat. */
export default function StudentAssignments({ data, go, focusStudent }: AdminPageProps) {
  const feedback = useFeedback(data.reload);
  const today = todayIso();

  const [className, setClassName] = useState("");
  const [subject, setSubject] = useState("");
  const [studentId, setStudentId] = useState("");
  const [assignmentId, setAssignmentId] = useState("");
  const [status, setStatus] = useState<"" | SubmissionStatus>("");

  const classes = useMemo(() => classNames(data.people), [data.people]);
  const subjects = useMemo(
    () => [...new Set(data.assignments.map((assignment) => assignment.subject))].sort(),
    [data.assignments]
  );

  // En rad per elev och uppgift som gäller eleven.
  const rows = useMemo(() => {
    const list: SubmissionRow[] = [];

    for (const assignment of data.assignments) {
      for (const student of assignmentStudents(assignment, data.people)) {
        const submission = data.submissions.find(
          (item) => item.assignmentId === assignment.id && item.studentId === student.id
        );
        list.push({
          assignment,
          student,
          status: statusFor(assignment, submission, today),
          submittedAtMs: submission?.submittedAtMs ?? null,
          grade: submission?.grade ?? "",
          comment: submission?.comment ?? "",
        });
      }
    }

    return list.sort((a, b) => a.assignment.dueDate.localeCompare(b.assignment.dueDate));
  }, [data.assignments, data.people, data.submissions, today]);

  const filtered = rows.filter((row) => {
    if (className && row.student.className !== className) return false;
    if (subject && row.assignment.subject !== subject) return false;
    if (studentId && row.student.id !== studentId) return false;
    if (assignmentId && row.assignment.id !== assignmentId) return false;
    if (status && row.status !== status) return false;
    return true;
  });

  // Bara de elever och uppgifter som faktiskt förekommer går att filtrera på.
  const studentOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) {
      seen.set(row.student.id, `${fullName(row.student)}${row.student.className ? ` (${row.student.className})` : ""}`);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], "sv-SE"));
  }, [rows]);

  const assignmentOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) {
      seen.set(row.assignment.id, `${row.assignment.title} · ${row.assignment.subject}`);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], "sv-SE"));
  }, [rows]);

  function submissionFor(row: SubmissionRow): Submission {
    const existing = data.submissions.find(
      (item) => item.assignmentId === row.assignment.id && item.studentId === row.student.id
    );
    return (
      existing ?? {
        id: "",
        assignmentId: row.assignment.id,
        studentId: row.student.id,
        submittedAtMs: null,
        note: "",
        grade: "",
        comment: "",
      }
    );
  }

  return (
    <AdminPage
      badge={<ClipboardCheck size={24} strokeWidth={1.8} aria-hidden />}
      eyebrow="Adminpanel"
      title="Elev-uppgifter"
      lead="Vilka uppgifter som är inlämnade, saknade och försenade. Statusen räknas ut från deadline och inlämnad tid."
    >
      <Feedback notice={feedback.notice} error={feedback.error} />

      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Filtrera</h2>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>Klass</span>
            <select value={className} onChange={(event) => setClassName(event.target.value)}>
              <option value="">Alla klasser</option>
              {classes.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Ämne</span>
            <select value={subject} onChange={(event) => setSubject(event.target.value)}>
              <option value="">Alla ämnen</option>
              {subjects.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as "" | SubmissionStatus)}
            >
              <option value="">Alla statusar</option>
              {STATUSES.map((item) => (
                <option key={item} value={item}>
                  {SUBMISSION_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Elev</span>
            <select value={studentId} onChange={(event) => setStudentId(event.target.value)}>
              <option value="">Alla elever</option>
              {studentOptions.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Uppgift</span>
            <select
              value={assignmentId}
              onChange={(event) => setAssignmentId(event.target.value)}
            >
              <option value="">Alla uppgifter</option>
              {assignmentOptions.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="panel__hint">
          {filtered.length} rader av {rows.length}. Saknade och försenade räknas bara
          efter att deadlinen har passerat.
        </p>
      </div>

      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Uppgifter per elev</h2>
        </div>

        {filtered.length === 0 ? (
          <Empty
            title={rows.length === 0 ? "Inga uppgifter att följa upp." : "Ingen träff."}
            hint={
              rows.length === 0
                ? "Publicera en uppgift under Uppgifter och koppla den till en klass eller elev."
                : "Prova ett annat filter."
            }
          />
        ) : (
          <ul className="rows">
            {filtered.map((row) => (
              <SubmissionRowItem
                key={`${row.assignment.id}-${row.student.id}`}
                row={row}
                busy={feedback.busy}
                onOpenStudent={() => {
                  if (focusStudent) focusStudent(row.student.id);
                  else go("student-overview");
                }}
                onSave={(grade, comment, markSubmitted) =>
                  void feedback.run(
                    () =>
                      saveSubmission({
                        ...submissionFor(row),
                        submittedAtMs: markSubmitted
                          ? Date.now()
                          : submissionFor(row).submittedAtMs,
                        grade,
                        comment,
                      }),
                    markSubmitted ? "Inlämningen registrerades." : "Bedömningen sparades."
                  )
                }
              />
            ))}
          </ul>
        )}
      </div>
    </AdminPage>
  );
}

interface RowProps {
  row: SubmissionRow;
  busy: boolean;
  onOpenStudent: () => void;
  onSave: (grade: string, comment: string, markSubmitted: boolean) => void;
}

function SubmissionRowItem({ row, busy, onOpenStudent, onSave }: RowProps) {
  const [open, setOpen] = useState(false);
  const [grade, setGrade] = useState(row.grade);
  const [comment, setComment] = useState(row.comment);

  return (
    <li className="row">
      <div className="row__main">
        <span className="row__title">
          {fullName(row.student)} · {row.assignment.title}
        </span>
        <span className="row__meta">
          {row.assignment.subject} · deadline {shortDate(row.assignment.dueDate)}
          {row.student.className ? ` · ${row.student.className}` : ""}
          {row.grade ? ` · betyg ${row.grade}` : ""}
        </span>
      </div>

      <div className="row__actions">
        <Tag tone={STATUS_TONE[row.status]}>{SUBMISSION_LABELS[row.status]}</Tag>

        <button type="button" className="button" onClick={() => setOpen((value) => !value)}>
          Rätta
        </button>
        <button type="button" className="button" onClick={onOpenStudent}>
          Översikt
        </button>
      </div>

      {open && (
        <div className="row__form">
          <div className="field-grid">
            <label className="field">
              <span>Betyg</span>
              <input value={grade} onChange={(event) => setGrade(event.target.value)} />
            </label>
            <label className="field">
              <span>Kommentar</span>
              <input value={comment} onChange={(event) => setComment(event.target.value)} />
            </label>
          </div>
          <div className="toolbar">
            {row.submittedAtMs === null && (
              <button
                type="button"
                className="button button--primary"
                disabled={busy}
                onClick={() => {
                  onSave(grade, comment, true);
                  setOpen(false);
                }}
              >
                Markera inlämnad
              </button>
            )}
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => {
                onSave(grade, comment, false);
                setOpen(false);
              }}
            >
              Spara bedömning
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
