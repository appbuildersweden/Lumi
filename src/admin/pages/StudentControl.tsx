import { useMemo } from "react";
import { ShieldAlert } from "lucide-react";
import { examStudents, fullName, isStudent, shortDate, statusFor, todayIso } from "../derive";
import type { AdminPageProps } from "../types";
import { AdminPage, Empty, Tag } from "../ui";

interface Issue {
  id: string;
  tone: "ok" | "warn" | "bad" | "muted" | "info";
  label: string;
  name: string;
  detail: string;
  go: "accounts" | "students" | "student-overview" | "student-assignments" | "student-exams";
  /** Eleven raden gäller, så att genvägen öppnar rätt elev. */
  personId?: string;
}

/**
 * Elev-kontroll: det som behöver följas upp.
 *
 * Allt bygger på data som redan finns i registret, kontona, uppgifterna och
 * proven – inget eget övervakningssystem, och inga dolda uppgifter.
 */
export default function StudentControl({ data, go, focusStudent }: AdminPageProps) {
  const today = todayIso();

  const issues = useMemo(() => {
    const list: Issue[] = [];

    for (const account of data.accounts) {
      if (!account.personId) {
        list.push({
          id: `person-${account.id}`,
          tone: "warn",
          label: "Konto utan person",
          name: account.displayName,
          detail: `${account.email} hör inte till någon i registret.`,
          go: "accounts",
        });
      }
      if (!account.active) {
        list.push({
          id: `inactive-${account.id}`,
          tone: "muted",
          label: "Inaktiverat konto",
          name: account.displayName,
          detail: `${account.email} kan inte logga in.`,
          go: "accounts",
        });
      }
    }

    const linkedPeople = new Set(
      data.accounts.map((account) => account.personId).filter((id): id is string => !!id)
    );
    for (const person of data.people.filter(isStudent)) {
      if (!linkedPeople.has(person.id)) {
        list.push({
          id: `nologin-${person.id}`,
          tone: "warn",
          label: "Elev saknar konto",
          name: fullName(person),
          detail: `${person.className || "Ingen klass"} kan inte logga in i Lumi ännu.`,
          go: "students",
          personId: person.id,
        });
      }
    }

    for (const assignment of data.assignments) {
      if (!assignment.published) continue;
      for (const student of data.people.filter(isStudent)) {
        const applies =
          assignment.studentIds.includes(student.id) ||
          (student.className !== "" && assignment.classNames.includes(student.className));
        if (!applies) continue;

        const submission = data.submissions.find(
          (item) => item.assignmentId === assignment.id && item.studentId === student.id
        );
        const status = statusFor(assignment, submission, today);
        if (status === "saknad" || status === "sen") {
          list.push({
            id: `sub-${assignment.id}-${student.id}`,
            tone: status === "saknad" ? "bad" : "warn",
            label: status === "saknad" ? "Uppgift saknas" : "Uppgift försenad",
            name: `${fullName(student)} · ${assignment.title}`,
            detail: `Deadline var ${shortDate(assignment.dueDate)} (${assignment.subject}).`,
            go: "student-assignments",
            personId: student.id,
          });
        }
      }
    }

    for (const exam of data.exams) {
      if (exam.date >= today) continue;
      const participants = examStudents(exam, data.people);
      const recorded = data.examResults.filter((result) => result.examId === exam.id).length;
      if (participants.length > 0 && recorded < participants.length) {
        list.push({
          id: `exam-${exam.id}`,
          tone: "info",
          label: "Resultat saknas",
          name: `${exam.title} · ${shortDate(exam.date)}`,
          detail: `${recorded} av ${participants.length} resultat är registrerade.`,
          go: "student-exams",
        });
      }
    }

    return list;
  }, [data, today]);

  const counts = {
    bad: issues.filter((issue) => issue.tone === "bad").length,
    warn: issues.filter((issue) => issue.tone === "warn").length,
  };

  return (
    <AdminPage
      badge={<ShieldAlert size={24} strokeWidth={1.8} aria-hidden />}
      eyebrow="Adminpanel"
      title="Elev-kontroll"
      lead="Kontoproblem och uppgifter som behöver följas upp. Bara det som redan finns i registret – ingen dold övervakning."
    >
      <div className="stat-row">
        <div className="stat">
          <span className="stat__label">Saknas</span>
          <span className="stat__value">{counts.bad}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Att följa upp</span>
          <span className="stat__value">{counts.warn}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Totalt</span>
          <span className="stat__value">{issues.length}</span>
        </div>
      </div>

      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Att följa upp ({issues.length})</h2>
        </div>

        {issues.length === 0 ? (
          <Empty
            title="Inget att följa upp."
            hint="Konton, inlämningar och provresultat ser kompletta ut. Här samlas nya saker när de behöver åtgärdas."
          />
        ) : (
          <ul className="rows">
            {issues.map((issue) => (
              <li className="row" key={issue.id}>
                <div className="row__main">
                  <span className="row__title">{issue.name}</span>
                  <span className="row__meta">{issue.detail}</span>
                </div>
                <div className="row__actions">
                  <Tag tone={issue.tone}>{issue.label}</Tag>
                  <button
                    type="button"
                    className="button"
                    onClick={() =>
                      issue.personId && focusStudent
                        ? focusStudent(issue.personId)
                        : go(issue.go)
                    }
                  >
                    Öppna
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminPage>
  );
}
