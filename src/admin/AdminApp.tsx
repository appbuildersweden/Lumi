import { useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { ROLE_LABELS, type PublicUser } from "../lib/backend";
import { ADMIN_NAV, adminNavItem, type AdminViewId } from "./nav";
import type { AdminPageProps } from "./types";
import { useAdminData } from "./useAdminData";
import Accounts from "./pages/Accounts";
import AdminHome from "./pages/AdminHome";
import AdminProfile from "./pages/AdminProfile";
import Assignments from "./pages/Assignments";
import Exams from "./pages/Exams";
import Roles from "./pages/Roles";
import ScheduleAdmin from "./pages/ScheduleAdmin";
import Staff from "./pages/Staff";
import StudentAssignments from "./pages/StudentAssignments";
import StudentControl from "./pages/StudentControl";
import StudentOverview from "./pages/StudentOverview";
import Students from "./pages/Students";

interface AdminAppProps {
  user: PublicUser;
  onSignOut: () => void;
  /** Sätts när det egna kontot har ändrats, så att sidopanelen följer med. */
  onUserChange?: (user: PublicUser) => void;
}

function initial(name: string): string {
  const letter = name.trim().charAt(0);
  return letter ? letter.toLocaleUpperCase("sv-SE") : "?";
}

/**
 * Adminpanelen. Samma app och samma byggstenar som elevens Lumi, men med ett
 * blått och vitt tema och en egen sidomeny. Rollen är redan kontrollerad av
 * backend innan den här vyn visas.
 */
export default function AdminApp({ user, onSignOut, onUserChange }: AdminAppProps) {
  const [view, setView] = useState<AdminViewId>("home");
  // Varifrån man kom, så att en vy utan egen plats i sidopanelen kan gå tillbaka.
  const [previous, setPrevious] = useState<AdminViewId>("home");
  // Eleven som elevöversikten ska öppnas på, satt från elevlistan.
  const [focusStudentId, setFocusStudentId] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  const data = useAdminData();

  const active = adminNavItem(view);
  // Vyerna i sidopanelen är Startsida och de sex kategorierna. Elevöversikten,
  // Elev-uppgifter, Elev-prov och Elev-kontroll nås inifrån dem tills de får en
  // egen plats i en senare uppdatering.
  const isCategory = ADMIN_NAV.some((item) => item.id === view);

  function navigate(next: AdminViewId) {
    if (next !== view) setPrevious(view);
    setView(next);
  }

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [view]);

  const pageProps: AdminPageProps = {
    user,
    data,
    go: navigate,
    onSignOut,
    onUserChange,
    focusStudentId,
    focusStudent: (personId) => {
      setFocusStudentId(personId);
      navigate("student-overview");
    },
  };

  return (
    <div className="app-shell theme-admin">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand__logo" role="img" aria-label="Lumi" />
          <span className="admin-tag">Admin</span>
        </div>

        <hr className="brand-divider" />

        <nav className="nav" aria-label="Adminpanelens sidopanel">
          {ADMIN_NAV.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === view;
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-item${isActive ? " is-active" : ""}`}
                aria-current={isActive ? "page" : undefined}
                onClick={() => navigate(item.id)}
                title={item.scope}
              >
                <Icon className="nav-item__icon" size={20} strokeWidth={1.9} aria-hidden />
                <span className="nav-item__label">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Profilområdet längst ner: öppnar Profilhantering och loggar ut.
            Det är ett eget område och ersätter ingen av kategorierna. */}
        <div className="nav nav--footer">
          <div
            className={`account${view === "admin-profile" ? " is-open" : ""}`}
            title={`${user.displayName} · ${ROLE_LABELS[user.role]}`}
          >
            <button
              type="button"
              className="account__open"
              onClick={() => navigate("admin-profile")}
              aria-label={`Öppna profilhantering för ${user.displayName}`}
              title="Öppna profilhantering"
            >
              <span className="account__avatar" aria-hidden>
                {initial(user.displayName)}
              </span>
              <span className="account__info">
                <span className="account__name">{user.displayName}</span>
                <span className="account__role">{user.roleLabel}</span>
              </span>
            </button>
            <button
              type="button"
              className="account__signout"
              onClick={onSignOut}
              aria-label="Logga ut"
              title="Logga ut"
            >
              <LogOut size={16} strokeWidth={2.1} aria-hidden />
            </button>
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <div className="content" ref={contentRef}>
          {data.error && (
            <div className="notice notice--error" role="alert">
              {data.error}
            </div>
          )}

          {view !== "home" && view !== "admin-profile" && (
            <p className="admin-scope">
              {!isCategory && (
                <button
                  type="button"
                  className="button admin-scope__back"
                  onClick={() => navigate(previous === view ? "home" : previous)}
                >
                  Tillbaka
                </button>
              )}
              <strong>{active.label}</strong> · {active.scope}
            </p>
          )}

          {view === "home" && <AdminHome {...pageProps} />}
          {view === "students" && <Students {...pageProps} />}
          {view === "staff" && <Staff {...pageProps} />}
          {view === "accounts" && <Accounts {...pageProps} />}
          {view === "roles" && <Roles {...pageProps} />}
          {view === "assignments" && <Assignments {...pageProps} />}
          {view === "schedule-admin" && <ScheduleAdmin {...pageProps} />}
          {view === "student-assignments" && <StudentAssignments {...pageProps} />}
          {view === "student-exams" && <Exams {...pageProps} />}
          {view === "student-control" && <StudentControl {...pageProps} />}
          {view === "student-overview" && <StudentOverview {...pageProps} />}
          {view === "admin-profile" && <AdminProfile {...pageProps} />}
        </div>
      </main>
    </div>
  );
}
