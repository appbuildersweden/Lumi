import { useMemo, useState, type ReactNode } from "react";
import { Plus, Search } from "lucide-react";
import {
  createAccount,
  formatDate,
  savePerson,
  setPersonActive,
  type Person,
} from "../lib/backend";
import {
  SUBMISSION_LABELS,
  SUBMISSION_TONE,
  fullName,
  isStudent,
  shortDate,
  statusFor,
  todayIso,
  type SubmissionStatus,
} from "./derive";
import type { AdminPageProps } from "./types";
import { AdminPage, ConfirmButton, Empty, Feedback, Tag, useFeedback } from "./ui";

interface PersonAdminProps extends AdminPageProps {
  /** `elever` eller `personal`. */
  kind: string;
  badge: ReactNode;
  eyebrow: string;
  title: string;
  lead: string;
  /** Personal har ämnen i stället för klass. */
  withSubjects: boolean;
}

/** Vad profilen visar om en person, uträknat ur den data panelen redan har. */
interface ProfileInfo {
  /** Klasser personen hör till (elevens klass, eller de klasser personalen har pass i). */
  classes: string[];
  /** Antal elever i de klasserna, för personal. */
  students: number;
  /** Personens egna pass i schemat: elevens klass, eller personalens lektioner. */
  lessons: number;
  /** Publicerade uppgifter som gäller personen. */
  assignments: {
    id: string;
    title: string;
    subject: string;
    dueDate: string;
    status: SubmissionStatus;
  }[];
  exams: { id: string; title: string; subject: string; date: string; result: string }[];
  absent: number;
}

/**
 * Registret för elever eller personal.
 *
 * Personen registreras först och kopplas sedan till ett konto i samma sida.
 * Varje rad kan fällas ut till en profil med klass, konto, schema, uppgifter
 * och prov – och tillhörigheten går att ändra, utan att bygga dubbla poster.
 */
export default function PersonAdmin({
  kind,
  badge,
  eyebrow,
  title,
  lead,
  withSubjects,
  data,
  go,
  focusStudent,
}: PersonAdminProps) {
  const feedback = useFeedback(data.reload);
  const today = todayIso();

  const [query, setQuery] = useState("");
  const [classNameFilter, setClassNameFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [className, setClassName] = useState("");
  const [email, setEmail] = useState("");
  const [subjects, setSubjects] = useState("");

  // Kontot som hör till en person, om något finns.
  const accountByPerson = useMemo(() => {
    const map = new Map<string, (typeof data.accounts)[number]>();
    for (const account of data.accounts) {
      if (account.personId) map.set(account.personId, account);
    }
    return map;
  }, [data.accounts]);

  /** Klasserna i registret, för filtreringen. */
  const allClasses = useMemo(() => {
    const names = new Set<string>();
    for (const person of data.people) {
      if (person.className.trim()) names.add(person.className.trim());
    }
    return [...names].sort((a, b) => a.localeCompare(b, "sv-SE"));
  }, [data.people]);

  /** Ämnena i registret, för filtreringen av personal. */
  const allSubjects = useMemo(() => {
    const names = new Set<string>();
    for (const person of data.people) {
      for (const subject of person.subjects) {
        if (subject.trim()) names.add(subject.trim());
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b, "sv-SE"));
  }, [data.people]);

  const people = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.people
      .filter((person) => person.kind === kind)
      .filter((person) => !classNameFilter || person.className === classNameFilter)
      .filter((person) => !subjectFilter || person.subjects.includes(subjectFilter))
      .filter((person) => {
        if (!needle) return true;
        return [person.firstName, person.lastName, person.className, person.email]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      });
  }, [data.people, kind, query, classNameFilter, subjectFilter]);

  /**
   * Profilen för en person. Eleven får sin klass, sina uppgifter och sina prov;
   * personalen får de klasser och elever de möter i schemat.
   */
  function profileFor(person: Person): ProfileInfo {
    const classes =
      person.kind === "elever"
        ? person.className
          ? [person.className]
          : []
        : [
            ...new Set(
              data.schedule
                .filter((entry) => entry.teacherId === person.id && entry.className)
                .map((entry) => entry.className)
            ),
          ].sort((a, b) => a.localeCompare(b, "sv-SE"));

    const students = data.people.filter(
      (item) => isStudent(item) && item.className && classes.includes(item.className)
    ).length;

    const lessons = data.schedule.filter((entry) =>
      person.kind === "elever"
        ? classes.includes(entry.className)
        : entry.teacherId === person.id
    ).length;

    const applies = (ids: string[], classNames: string[]) =>
      ids.includes(person.id) ||
      (person.className !== "" && classNames.includes(person.className));

    const assignments = data.assignments
      .filter((assignment) => assignment.published && applies(assignment.studentIds, assignment.classNames))
      .map((assignment) => {
        const submission = data.submissions.find(
          (item) => item.assignmentId === assignment.id && item.studentId === person.id
        );
        const status = statusFor(assignment, submission, today);
        return {
          id: assignment.id,
          title: assignment.title,
          subject: assignment.subject,
          dueDate: assignment.dueDate,
          status,
        };
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    const exams = data.exams
      .filter((exam) =>
        person.kind === "elever"
          ? applies(exam.studentIds, exam.classNames)
          : classes.includes(exam.classNames[0] ?? "")
      )
      .map((exam) => {
        const result = data.examResults.find(
          (item) => item.examId === exam.id && item.studentId === person.id
        );
        return {
          id: exam.id,
          title: exam.title,
          subject: exam.subject,
          date: exam.date,
          result:
            result?.score !== null && result?.score !== undefined
              ? `${result.score}${result.maxScore !== null ? ` av ${result.maxScore}` : ""}${
                  result.grade ? ` · betyg ${result.grade}` : ""
                }`
              : "",
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      classes,
      students,
      lessons,
      assignments,
      exams,
      absent: assignments.filter((item) => item.status === "saknad").length,
    };
  }

  async function register() {
    const ok = await feedback.run(
      () =>
        savePerson({
          id: "",
          kind,
          firstName,
          lastName,
          className: withSubjects ? "" : className,
          email,
          subjects: withSubjects
            ? subjects
                .split(",")
                .map((subject) => subject.trim())
                .filter(Boolean)
            : [],
          active: true,
          createdAtMs: 0,
        }),
      "Personen registrerades."
    );

    if (ok) {
      setFirstName("");
      setLastName("");
      setClassName("");
      setEmail("");
      setSubjects("");
    }
  }

  return (
    <AdminPage badge={badge} eyebrow={eyebrow} title={title} lead={lead}>
      <Feedback notice={feedback.notice} error={feedback.error} />

      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">
            <Plus className="panel__icon" size={18} strokeWidth={2.2} aria-hidden />
            Registrera ny
          </h2>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>Förnamn</span>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </label>
          <label className="field">
            <span>Efternamn</span>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </label>
          {withSubjects ? (
            <label className="field">
              <span>Ämnen (kommaseparerade)</span>
              <input
                value={subjects}
                onChange={(e) => setSubjects(e.target.value)}
                placeholder="Matematik, Fysik"
              />
            </label>
          ) : (
            <label className="field">
              <span>Klass</span>
              <input
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                placeholder="9A"
              />
            </label>
          )}
          <label className="field">
            <span>E-postadress</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="namn@edu.ronneby.se"
            />
          </label>
        </div>

        <div className="toolbar">
          <button
            type="button"
            className="button button--primary"
            onClick={register}
            disabled={feedback.busy || !firstName.trim() || !lastName.trim()}
          >
            Registrera
          </button>
          <button type="button" className="button" onClick={() => go("accounts")}>
            Skapa konto i stället
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">
            <Search className="panel__icon" size={18} strokeWidth={2.2} aria-hidden />
            Registret ({people.length})
          </h2>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>Sök</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Namn, klass eller e-postadress"
            />
          </label>
          <label className="field">
            <span>Klass</span>
            <select
              value={classNameFilter}
              onChange={(event) => setClassNameFilter(event.target.value)}
            >
              <option value="">Alla klasser</option>
              {allClasses.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {withSubjects && (
            <label className="field">
              <span>Ämne</span>
              <select
                value={subjectFilter}
                onChange={(event) => setSubjectFilter(event.target.value)}
              >
                <option value="">Alla ämnen</option>
                {allSubjects.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {people.length === 0 ? (
          <Empty
            title={data.people.some((person) => person.kind === kind) ? "Ingen träff." : "Inget register ännu."}
            hint={
              data.people.some((person) => person.kind === kind)
                ? "Prova ett annat namn, en annan klass eller ett annat ämne."
                : "Registrera den första personen ovan, så kopplas kontot på samma rad."
            }
          />
        ) : (
          <ul className="rows">
            {people.map((person) => (
              <PersonRow
                key={person.id}
                person={person}
                profile={profileFor(person)}
                account={accountByPerson.get(person.id)}
                classes={allClasses}
                busy={feedback.busy}
                onOpenOverview={
                  kind === "elever" && focusStudent
                    ? () => focusStudent(person.id)
                    : undefined
                }
                onGo={() => go("accounts")}
                onToggle={() =>
                  void feedback.run(
                    () => setPersonActive(person.id, !person.active),
                    person.active ? "Personen inaktiverades." : "Personen aktiverades."
                  )
                }
                onSave={(updated) =>
                  void feedback.run(
                    () => savePerson(updated),
                    `Uppgifterna för ${fullName(updated)} sparades.`
                  )
                }
                onCreateAccount={(password) =>
                  void feedback.run(
                    () =>
                      createAccount({
                        email: person.email || `${person.id}@edu.ronneby.se`,
                        password,
                        role: kind === "elever" ? "elev" : "lärare",
                        displayName: fullName(person),
                        personId: person.id,
                        firstName: "",
                        lastName: "",
                        className: "",
                      }),
                    `Kontot för ${fullName(person)} skapades.`
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

interface PersonRowProps {
  person: Person;
  profile: ProfileInfo;
  account: { email: string; active: boolean; roleLabel: string; id: string } | undefined;
  /** Klasserna i registret, som förslag när tillhörigheten ändras. */
  classes: string[];
  busy: boolean;
  /** Öppnar elevöversikten för eleven. Bara elever har en översikt. */
  onOpenOverview: (() => void) | undefined;
  onGo: () => void;
  onToggle: () => void;
  onSave: (updated: Person) => void;
  onCreateAccount: (password: string) => void;
}

function PersonRow({
  person,
  profile,
  account,
  classes,
  busy,
  onOpenOverview,
  onGo,
  onToggle,
  onSave,
  onCreateAccount,
}: PersonRowProps) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [password, setPassword] = useState("");

  const [firstName, setFirstName] = useState(person.firstName);
  const [lastName, setLastName] = useState(person.lastName);
  const [className, setClassName] = useState(person.className);
  const [email, setEmail] = useState(person.email);
  const [subjects, setSubjects] = useState(person.subjects.join(", "));

  const student = isStudent(person);

  const meta = [
    person.className || null,
    person.subjects.length > 0 ? person.subjects.join(", ") : null,
    person.email || null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="row">
      <div className="row__main">
        <span className="row__title">{fullName(person)}</span>
        <span className="row__meta">{meta || "Inga uppgifter angivna"}</span>
      </div>

      <div className="row__actions">
        {!person.active && <Tag tone="muted">Inaktiverad</Tag>}
        {account ? (
          <Tag tone={account.active ? "ok" : "bad"}>
            {account.active ? `Konto: ${account.roleLabel}` : "Kontot är inaktiverat"}
          </Tag>
        ) : (
          <Tag tone="warn">Saknar konto</Tag>
        )}
        {student && profile.absent > 0 && (
          <Tag tone="bad">{profile.absent} saknade uppgifter</Tag>
        )}

        <button type="button" className="button" onClick={() => setProfileOpen((value) => !value)}>
          {profileOpen ? "Stäng profil" : "Öppna profil"}
        </button>

        {!account && (
          <button type="button" className="button" onClick={() => setAccountOpen((value) => !value)}>
            Skapa konto
          </button>
        )}

        {onOpenOverview && (
          <button type="button" className="button" onClick={onOpenOverview}>
            Öppna översikt
          </button>
        )}

        <ConfirmButton
          label={person.active ? "Inaktivera" : "Aktivera"}
          question={
            person.active
              ? `${fullName(person)} inaktiveras. Kontot behålls men kan inte användas.`
              : `${fullName(person)} aktiveras igen.`
          }
          confirmLabel={person.active ? "Ja, inaktivera" : "Ja, aktivera"}
          disabled={busy}
          onConfirm={onToggle}
        />
      </div>

      {accountOpen && !account && (
        <div className="row__form">
          <label className="field">
            <span>Lösenord för {fullName(person)}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Minst 8 tecken"
              autoComplete="new-password"
            />
          </label>
          <label className="field">
            <span>E-postadress till kontot</span>
            <span className="field__static">{person.email || "Saknas – fylls i ovan först"}</span>
          </label>
          <div className="toolbar">
            <button
              type="button"
              className="button button--primary"
              disabled={password.length < 8 || !person.email}
              onClick={() => {
                onCreateAccount(password);
                setPassword("");
                setAccountOpen(false);
              }}
            >
              Skapa kontot
            </button>
            <button type="button" className="button" onClick={() => setAccountOpen(false)}>
              Avbryt
            </button>
          </div>
        </div>
      )}

      {profileOpen && (
        <div className="profile">
          <div className="profile__block">
            <p className="profile__label">
              {student ? "Elevprofil" : "Personalprofil"} · konto
            </p>
            <ul className="section-block__bullets">
              <li>Namn: {fullName(person)}</li>
              <li>E-postadress: {person.email || "inte angiven"}</li>
              <li>
                {student ? "Klass" : "Ämnen"}:{" "}
                {student
                  ? person.className || "inte angiven"
                  : person.subjects.length > 0
                    ? person.subjects.join(", ")
                    : "inga angivna"}
              </li>
              <li>
                Konto:{" "}
                {account
                  ? `${account.email} · ${account.roleLabel}${account.active ? "" : " · inaktiverat"}`
                  : "saknas"}
              </li>
              <li>Status i registret: {person.active ? "aktiv" : "inaktiverad"}</li>
            </ul>
          </div>

          <div className="profile__block">
            <p className="profile__label">{student ? "Schema" : "Undervisning"}</p>
            {student ? (
              profile.lessons === 0 ? (
                <p className="panel__text">
                  Inga schemaposter gäller klass {person.className || "–"} ännu.
                </p>
              ) : (
                <p className="panel__text">
                  {profile.lessons} schemaposter i klass {profile.classes.join(", ")}.
                </p>
              )
            ) : profile.classes.length === 0 ? (
              <p className="panel__text">
                Inga lektioner i schemat är kopplade till {fullName(person)} ännu.
                Välj personen som ansvarig när du lägger in ett pass.
              </p>
            ) : (
              <p className="panel__text">
                Klasser: {profile.classes.join(", ")} · {profile.lessons} pass ·{" "}
                {profile.students} elever i klasserna.
              </p>
            )}
          </div>

          <div className="profile__block">
            <p className="profile__label">Uppgifter ({profile.assignments.length})</p>
            {profile.assignments.length === 0 ? (
              <p className="panel__text">Inga publicerade uppgifter gäller personen.</p>
            ) : (
              <ul className="rows">
                {profile.assignments.slice(0, 6).map((row) => (
                  <li className="row" key={row.id}>
                    <div className="row__main">
                      <span className="row__title">{row.title}</span>
                      <span className="row__meta">
                        {row.subject} · deadline {shortDate(row.dueDate)}
                      </span>
                    </div>
                    <Tag tone={SUBMISSION_TONE[row.status]}>{SUBMISSION_LABELS[row.status]}</Tag>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="profile__block">
            <p className="profile__label">Prov ({profile.exams.length})</p>
            {profile.exams.length === 0 ? (
              <p className="panel__text">Inga prov gäller personen.</p>
            ) : (
              <ul className="rows">
                {profile.exams.slice(0, 6).map((exam) => (
                  <li className="row" key={exam.id}>
                    <div className="row__main">
                      <span className="row__title">{exam.title}</span>
                      <span className="row__meta">
                        {shortDate(exam.date)} · {exam.subject}
                      </span>
                    </div>
                    <Tag tone={exam.result ? "ok" : "muted"}>
                      {exam.result || "Väntar på resultat"}
                    </Tag>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="profile__block">
            <p className="profile__label">Ändra tillhörighet</p>
            <div className="field-grid">
              <label className="field">
                <span>Förnamn</span>
                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </label>
              <label className="field">
                <span>Efternamn</span>
                <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </label>
              {student ? (
                <label className="field">
                  <span>Klass</span>
                  <input
                    list={`klasser-${person.id}`}
                    value={className}
                    onChange={(e) => setClassName(e.target.value)}
                    placeholder="9A"
                  />
                  <datalist id={`klasser-${person.id}`}>
                    {classes.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </label>
              ) : (
                <label className="field">
                  <span>Ämnen (kommaseparerade)</span>
                  <input value={subjects} onChange={(e) => setSubjects(e.target.value)} />
                </label>
              )}
              <label className="field">
                <span>E-postadress</span>
                <input value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
            </div>

            <div className="toolbar">
              <button
                type="button"
                className="button button--primary"
                disabled={busy || !firstName.trim() || !lastName.trim()}
                onClick={() =>
                  onSave({
                    ...person,
                    firstName: firstName.trim(),
                    lastName: lastName.trim(),
                    className: student ? className.trim() : person.className,
                    email: email.trim(),
                    subjects: student
                      ? person.subjects
                      : subjects
                          .split(",")
                          .map((subject) => subject.trim())
                          .filter(Boolean),
                  })
                }
              >
                Spara uppgifterna
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setFirstName(person.firstName);
                  setLastName(person.lastName);
                  setClassName(person.className);
                  setEmail(person.email);
                  setSubjects(person.subjects.join(", "));
                }}
              >
                Ångra
              </button>
              <button type="button" className="button" onClick={onGo}>
                {account ? "Kontot" : "Skapa konto"}
              </button>
            </div>

            <p className="hint">
              Rollen ändras under Konton och Roller. Personen registrerades{" "}
              {formatDate(person.createdAtMs)}.
            </p>
          </div>
        </div>
      )}
    </li>
  );
}
