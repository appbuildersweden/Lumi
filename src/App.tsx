import { useEffect, useRef, useState } from "react";
import AdminApp from "./admin/AdminApp";
import BackendNotice from "./components/BackendNotice";
import ScrollCue from "./components/ScrollCue";
import Sidebar from "./components/Sidebar";
import { NAV_ITEMS, type ViewId } from "./navigation";
import Home from "./pages/Home";
import Login from "./pages/Login";
import PlaceholderPage from "./pages/PlaceholderPage";
import Profile from "./pages/Profile";
import Progress from "./pages/Progress";
import Schedule from "./pages/Schedule";
import Study from "./pages/Study";
import TeacherChat from "./pages/TeacherChat";
import {
  currentUser,
  landsInAdminPanel,
  onUpdateEvents,
  restoreSession,
  runningInTauri,
  signOut,
  type PublicUser,
} from "./lib/backend";

export default function App() {
  const [activeView, setActiveView] = useState<ViewId>("home");
  const [user, setUser] = useState<PublicUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [updating, setUpdating] = useState<{
    version: string;
    percent: number | null;
  } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const activeItem =
    NAV_ITEMS.find((item) => item.id === activeView) ?? NAV_ITEMS[0];

  // Frågar backend vem som är inloggad. Först om en sparad session finns
  // ("Håll mig inloggad"), annars om någon är inloggad i den här körningen.
  // Båda svaren kommer från Rust, som kontrollerar kontot mot databasen.
  useEffect(() => {
    if (!runningInTauri) {
      setAuthReady(true);
      return undefined;
    }

    let active = true;
    restoreSession()
      .then((saved) => saved ?? currentUser())
      .then((found) => {
        if (active) setUser(found ?? null);
      })
      .catch(() => {
        // Går sessionen inte att läsa är svaret att logga in på nytt.
      })
      .finally(() => {
        if (active) setAuthReady(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [activeView]);

  // En ny version hämtas och installeras av backend vid start. Här visas bara
  // att det pågår, så att den korta väntan inte ser ut som en krasch.
  useEffect(() => {
    if (!runningInTauri) return undefined;

    let active = true;
    let stop: (() => void) | null = null;

    onUpdateEvents({
      available: (info) => setUpdating({ version: info.version, percent: null }),
      progress: (progress) =>
        setUpdating((current) => ({
          version: current?.version ?? "",
          percent:
            progress.total && progress.total > 0
              ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
              : null,
        })),
      // Går uppdateringen inte igenom kör Lumi vidare som det är.
      failed: () => setUpdating(null),
    })
      .then((unlisten) => {
        if (active) stop = unlisten;
        else unlisten();
      })
      .catch(() => {
        // Utan händelser fungerar appen precis som vanligt.
      });

    return () => {
      active = false;
      stop?.();
    };
  }, []);

  async function handleSignOut() {
    try {
      await signOut();
    } catch {
      // Sessionen stängs i gränssnittet även om backend inte svarar.
    }
    setUser(null);
    setActiveView("home");
  }

  if (updating) {
    return (
      <div className="boot" aria-busy="true" role="status">
        <span className="boot__logo" role="img" aria-label="Lumi" />
        <p className="boot__text">
          Uppdaterar Lumi till version {updating.version}
          {updating.percent !== null ? ` … ${updating.percent} %` : " …"}
        </p>
      </div>
    );
  }

  if (!authReady) {
    return (
      <div className="boot" aria-busy="true">
        <span className="boot__logo" role="img" aria-label="Lumi" />
        <p className="boot__text">Startar Lumi …</p>
      </div>
    );
  }

  if (!user) {
    return <Login onSignedIn={setUser} />;
  }

  // Rollen kommer från backend. Administratören hamnar i adminpanelen, alla
  // andra i Lumis vanliga gränssnitt.
  if (landsInAdminPanel(user)) {
    return (
      <AdminApp user={user} onSignOut={handleSignOut} onUserChange={setUser} />
    );
  }

  return (
    <div className="app-shell">
      <Sidebar
        activeView={activeView}
        onNavigate={setActiveView}
        user={user}
        onSignOut={handleSignOut}
      />

      <main className="main-panel">
        <BackendNotice />

        <div className="content" ref={contentRef}>
          {activeView === "home" && <Home onNavigate={setActiveView} />}

          {activeView === "teacher-chat" && <TeacherChat />}

          {activeView === "study" && <Study />}

          {activeView === "schema" && <Schedule />}

          {activeView === "progress" && <Progress />}

          {activeView === "profile" && <Profile user={user} />}

          {(activeView === "info" || activeView === "messages") && (
            <PlaceholderPage
              title={activeItem.label}
              description={activeItem.description}
              icon={activeItem.icon}
              note={activeItem.emptyTitle}
              hint={activeItem.emptyHint}
            />
          )}
        </div>

        {/* Chatten har sin egen skrollist, så där behövs ingen indikator. */}
        {activeView !== "teacher-chat" && (
          <ScrollCue target={contentRef} />
        )}
      </main>
    </div>
  );
}
