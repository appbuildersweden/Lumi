import { LogOut } from "lucide-react";
import { ROLE_LABELS, type PublicUser } from "../lib/backend";
import { PRIMARY_NAV, PROFILE_ITEM, type NavItem, type ViewId } from "../navigation";

interface SidebarProps {
  activeView: ViewId;
  onNavigate: (view: ViewId) => void;
  user: PublicUser;
  onSignOut: () => void;
}

function NavButton({
  item,
  isActive,
  onNavigate,
}: {
  item: NavItem;
  isActive: boolean;
  onNavigate: (view: ViewId) => void;
}) {
  const Icon = item.icon;

  return (
    <button
      type="button"
      className={`nav-item${isActive ? " is-active" : ""}`}
      aria-current={isActive ? "page" : undefined}
      onClick={() => onNavigate(item.id)}
    >
      <Icon className="nav-item__icon" size={20} strokeWidth={1.9} aria-hidden />
      <span className="nav-item__label">{item.label}</span>
    </button>
  );
}

/** Första bokstaven i namnet, till den lilla cirkeln. */
function initial(name: string): string {
  const letter = name.trim().charAt(0);
  return letter ? letter.toLocaleUpperCase("sv-SE") : "?";
}

export default function Sidebar({
  activeView,
  onNavigate,
  user,
  onSignOut,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        {/* Logotypen innehåller både symbol och namnet Lumi. På smala ytor
            visas bara symbolen (se .brand__logo i global.css). */}
        <span className="brand__logo" role="img" aria-label="Lumi" />
      </div>

      <hr className="brand-divider" />

      <nav className="nav" aria-label="Huvudnavigering">
        {PRIMARY_NAV.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            isActive={item.id === activeView}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      <nav className="nav nav--footer" aria-label="Profil">
        <div className="account" title={`${user.displayName} · ${ROLE_LABELS[user.role]}`}>
          <span className="account__avatar" aria-hidden>
            {initial(user.displayName)}
          </span>
          <span className="account__info">
            <span className="account__name">{user.displayName}</span>
            <span className="account__role">{ROLE_LABELS[user.role]}</span>
          </span>
          <button
            type="button"
            className="account__signout"
            onClick={onSignOut}
            aria-label={`Logga ut ${user.displayName}`}
            title="Logga ut"
          >
            <LogOut size={16} strokeWidth={2.1} aria-hidden />
          </button>
        </div>

        <NavButton
          item={PROFILE_ITEM}
          isActive={PROFILE_ITEM.id === activeView}
          onNavigate={onNavigate}
        />
      </nav>
    </aside>
  );
}
