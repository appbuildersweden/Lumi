import { useEffect, useMemo, useState } from "react";
import { ChartColumn } from "lucide-react";
import { formatDate, listAttempts, type Attempt } from "../../lib/backend";
import {
  SUBMISSION_LABELS,
  SUBMISSION_TONE,
  averageScore,
  classNames,
  examStudents,
  fullName,
  isStudent,
  isoWeekday,
  shortDate,
  statusFor,
  todayIso,
  weekdayLabel,
} from "../derive";
import type { AdminPageProps } from "../types";
import { AdminPage, Empty, Feedback, Tag } from "../ui";

/** Elevöversikt: en elevs samlade studieläge, med länkar vidare. */
export default function StudentOverview({ data, go, focusStudentId }: AdminPageProps) {
  const today = todayIso();
  const students = useMemo(() => data.people.filter(isStudent), [data.people]);

  const [studentId, setStudentId] = useState("");
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [attemptsError, setAttemptsError] = useState<string | null>(null);

  const classes = useMemo(() => classNames(data.people), [data.people]);
  const todayWeekday = isoWeekday();

  // Sökningen och klassfiltret begränsar listan, så att rätt elev går att hitta.
  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return students
      .filter((person) => !classFilter || person.className === classFilter)
      .filter((person) =>
        !needle
          ? true
          : [person.firstName, person.lastName, person.className, person.email]
              .join(" ")
              .toLowerCase()
              .includes(needle)
      );
  }, [students, search, classFilter]);

  // Kommer man från elevlistan öppnas just den eleven. Annars väljs den första
  // träffen, så att vyn varken är tom eller visar en elev som filtrerats bort.
  useEffect(() => {
    if (focusStudentId && students.some((person) => person.id === focusStudentId)) {
      setStudentId(focusStudentId);
      return;
    }
    if (matches.length > 0 && !matches.some((person) => person.id === studentId)) {
      setStudentId(matches[0].id);
    }
  }, [focusStudentId, matches, studentId, students]);

  const student = students.find((person) => person.id === studentId) ?? null;

  // Resultaten hör till kontot, inte till datorn. Backend lämnar bara ut en
  // elevs resultat till en administratör, och eleven måste ha ett konto.
  const account = student
    ? data.accounts.find((item) => item.personId === student.id) ?? null
    : null;
  const accountId = account?.id ?? "";

  useEffect(() => {
    if (!accountId) {
      setAttempts([]);
      setAttemptsError(null);
      return;
    }

    let active = true;
    listAttempts(accountId)
      .then((items) => {
        if (active) {
          setAttempts(items);
          setAttemptsError(null);
        }
      })
      .catch(() => {
        if (active) setAttemptsError("Resultaten från Plugga kunde inte hämtas.");
      });

    return () => {
      active = false;
    };
  }, [accountId]);

  /** Namnet på den lärare en schemapost är kopplad till. */
  const teacherName = (teacherId: string) => {
    const person = data.people.find((item) => item.id === teacherId);
    return person ? fullName(person) : "";
  };
  const rows = useMemo(() => {
    if (!student) return [];
    return data.assignments
      .filter(
        (assignment) =>
          assignment.published &&
          (assignment.studentIds.includes(student.id) ||
            (student.className !== "" && assignment.classNames.includes(student.className)))
      )
      .map((assignment) => {
        const submission = data.submissions.find(
          (item) => item.assignmentId === assignment.id && item.studentId === student.id
        );
        return {
          assignment,
          status: statusFor(assignment, submission, today),
          submittedAtMs: submission?.submittedAtMs ?? null,
          grade: submission?.grade ?? "",
        };
      });
  }, [data.assignments, data.submissions, student, today]);

  const exams = useMemo(() => {
    if (!student) return [];
    return data.exams
      .filter((exam) => examStudents(exam, data.people).some((person) => person.id === student.id))
      .map((exam) => ({
        exam,
        result:
          data.examResults.find(
            (item) => item.examId === exam.id && item.studentId === student.id
          ) ?? null,
      }));
  }, [data.exams, data.examResults, data.people, student]);

  const subjectProgress = useMemo(() => {
    const bySubject = new Map<string, { correct: number; total: number }>();
    for (const attempt of attempts) {
      const current = bySubject.get(attempt.subject) ?? { correct: 0, total: 0 };
      current.correct += attempt.correct;
      current.total += attempt.total;
      bySubject.set(attempt.subject, current);
    }
    return [...bySubject.entries()].map(([subject, value]) => ({ subject, ...value }));
  }, [attempts]);

  const schedule = useMemo(() => {
    if (!student || !student.className) return [];
    return data.schedule
      .filter((entry) => entry.className === student.className)
      .sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
  }, [data.schedule, student]);

  const submitted = rows.filter((row) => row.status === "inlamnad" || row.status === "sen").length;
  const examAverage = averageScore(
    exams.flatMap((entry) => (entry.result ? [entry.result] : []))
  );

  return (
    <AdminPage
      badge={<ChartColumn size={24} strokeWidth={1.8} aria-hidden />}
      eyebrow="Adminpanel"
      title="Elevöversikt"
      lead="En elevs samlade läge: konto, uppgifter, prov, resultat och framsteg i Plugga."
    >
      <Feedback notice={null} error={attemptsError} />

      {students.length === 0 ? (
        <Empty
          title="Inga elever i registret."
          hint="Registrera elever under Elever, så går översikten att öppna här."
        />
      ) : (
        <div className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Hitta elev</h2>
            <span className="panel__label">{matches.length} av {students.length}</span>
          </div>
          <div className="field-grid">
            <label className="field">
              <span>Sök</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Namn, klass eller e-postadress"
              />
            </label>
            <label className="field">
              <span>Klass</span>
              <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
                <option value="">Alla klasser</option>
                {classes.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Elev</span>
              <select value={studentId} onChange={(event) => setStudentId(event.target.value)}>
                {matches.map((person) => (
                  <option key={person.id} value={person.id}>
                    {fullName(person)}
                    {person.className ? ` (${person.className})` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {matches.length === 0 && (
            <p className="panel__hint">
              Ingen elev matchar sökningen. Rensa filtret för att se alla igen.
            </p>
          )}
        </div>
      )}

      {student && (
        <>
          <div className="panel">
            <div className="panel__head">
              <h2 className="panel__title">{fullName(student)}</h2>
              <Tag tone={account?.active ? "ok" : "warn"}>
                {account ? (account.active ? account.roleLabel : "Kontot är inaktiverat") : "Saknar konto"}
              </Tag>
            </div>

            <ul className="section-block__bullets">
              <li>Klass: {student.className || "inte angiven"}</li>
              <li>E-postadress: {student.email || "inte angiven"}</li>
              <li>
                Konto: {account ? account.email : "inget konto är kopplat till eleven"}
              </li>
              <li>Status i registret: {student.active ? "aktiv" : "inaktiverad"}</li>
            </ul>

            <div className="toolbar">
              <button type="button" className="button" onClick={() => go("accounts")}>
                Öppna konton
              </button>
              <button type="button" className="button" onClick={() => go("student-assignments")}>
                Elev-uppgifter
              </button>
              <button type="button" className="button" onClick={() => go("student-exams")}>
                Elev-prov
              </button>
            </div>
          </div>

          <div className="stat-row">
            <div className="stat">
              <span className="stat__label">Uppgifter</span>
              <span className="stat__value">
                {submitted}/{rows.length}
              </span>
            </div>
            <div className="stat">
              <span className="stat__label">Prov</span>
              <span className="stat__value">{exams.length}</span>
            </div>
            <div className="stat">
              <span className="stat__label">Snitt på prov</span>
              <span className="stat__value">{examAverage === null ? "–" : `${examAverage} %`}</span>
            </div>
            <div className="stat">
              <span className="stat__label">Övningar i Plugga</span>
              <span className="stat__value">{attempts.length}</span>
            </div>
          </div>

          <div className="panel">
            <div className="panel__head">
              <h2 className="panel__title">Uppgifter</h2>
            </div>

            {rows.length === 0 ? (
              <Empty
                title="Inga uppgifter gäller eleven."
                hint="Publicerade uppgifter för elevens klass eller eleven själv visas här."
              />
            ) : (
              <ul className="rows">
                {rows.map((row) => (
                  <li className="row" key={row.assignment.id}>
                    <div className="row__main">
                      <span className="row__title">{row.assignment.title}</span>
                      <span className="row__meta">
                        {row.assignment.subject} · deadline {shortDate(row.assignment.dueDate)}
                        {row.submittedAtMs ? ` · inlämnad ${formatDate(row.submittedAtMs)}` : ""}
                        {row.grade ? ` · betyg ${row.grade}` : ""}
                      </span>
                    </div>
                    <Tag tone={SUBMISSION_TONE[row.status]}>
                      {SUBMISSION_LABELS[row.status]}
                    </Tag>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel">
            <div className="panel__head">
              <h2 className="panel__title">Prov och resultat</h2>
            </div>

            {exams.length === 0 ? (
              <Empty
                title="Inga prov för eleven."
                hint="Prov som eleven ska göra eller har gjort visas här med resultat."
              />
            ) : (
              <ul className="rows">
                {exams.map(({ exam, result }) => (
                  <li className="row" key={exam.id}>
                    <div className="row__main">
                      <span className="row__title">{exam.title}</span>
                      <span className="row__meta">
                        {shortDate(exam.date)} · {exam.subject}
                        {result?.grade ? ` · betyg ${result.grade}` : ""}
                        {result?.comment ? ` · ${result.comment}` : ""}
                      </span>
                    </div>
                    <Tag tone={result ? "ok" : "muted"}>
                      {result
                        ? result.score !== null && result.maxScore !== null
                          ? `${result.score} av ${result.maxScore}`
                          : "Resultat registrerat"
                        : "Väntar på resultat"}
                    </Tag>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel">
            <div className="panel__head">
              <h2 className="panel__title">Schema</h2>
              <span className="panel__label">
                {student.className ? `Klass ${student.className}` : "Ingen klass angiven"}
              </span>
            </div>

            {schedule.length === 0 ? (
              <Empty
                title="Inga schemaposter för eleven."
                hint="Schemat hämtas från Scheman-hantering och visas här när elevens klass har pass inlagda."
              />
            ) : (
              <ul className="rows">
                {schedule.map((entry) => (
                  <li className="row" key={entry.id}>
                    <div className="row__main">
                      <span className="row__title">
                        {weekdayLabel(entry.weekday)} {entry.start}
                        {entry.end ? `–${entry.end}` : ""} · {entry.title}
                      </span>
                      <span className="row__meta">
                        {[entry.kind, entry.subject, entry.room, teacherName(entry.teacherId)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    {entry.weekday === todayWeekday && <Tag tone="info">Idag</Tag>}
                  </li>
                ))}
              </ul>
            )}

            <div className="toolbar">
              <button type="button" className="button" onClick={() => go("schedule-admin")}>
                Scheman-hantering
              </button>
            </div>
          </div>

          <div className="panel">
            <div className="panel__head">
              <h2 className="panel__title">Framsteg i Plugga</h2>
            </div>

            {subjectProgress.length === 0 ? (
              <Empty
                title="Inga övningar gjorda ännu."
                hint="När eleven gör quiz och övningar i Lumi sammanfattas resultatet per ämne här."
              />
            ) : (
              <div className="subject-list">
                {subjectProgress.map((entry) => {
                  const percent =
                    entry.total === 0 ? 0 : Math.round((entry.correct / entry.total) * 100);
                  return (
                    <div className="subject" key={entry.subject}>
                      <div className="subject__head">
                        <span className="subject__name">{entry.subject}</span>
                        <span className="subject__value">{percent} %</span>
                      </div>
                      <div className="progress-track progress-track--filled">
                        <span style={{ width: `${percent}%` }} />
                      </div>
                      <span className="subject__meta">
                        {entry.correct} rätt av {entry.total} frågor
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </AdminPage>
  );
}
