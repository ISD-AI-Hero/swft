// Shared app chrome: header, navigation, theme toggle, and page container.
import { type ReactNode, useState, useRef, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useMsal } from "@azure/msal-react";
import { ThemeToggle } from "@components/ThemeToggle";
import { SWFT_WORKSPACE_ENABLED } from "@lib/features";
import { AUTH_ENABLED, REDIRECT_URI } from "@lib/auth";

const NavLink = ({ to, label }: { to: string; label: string }) => {
  const location = useLocation();
  const active = location.pathname === to || location.pathname.startsWith(`${to}/`);
  return (
    <Link
      to={to}
      className={`rounded-md px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        active
          ? "bg-blue-600 text-white"
          : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      }`}
    >
      {label}
    </Link>
  );
};

// Only rendered when AUTH_ENABLED = true (MsalProvider is guaranteed to be in the tree).
const UserMenu = () => {
  const { instance, accounts } = useMsal();
  const account = accounts[0];
  const name = account?.name ?? account?.username ?? "User";
  const email = account?.username ?? "";
  const claims = account?.idTokenClaims as Record<string, unknown> | undefined;
  const loginTimestamp = (claims?.iat ?? claims?.auth_time) as number | undefined;
  const lastLogin = loginTimestamp
    ? new Date(loginTimestamp * 1000).toLocaleString(undefined, {
        month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit",
      })
    : null;
  const initial = name.charAt(0).toUpperCase();

  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="relative border-l border-slate-200 pl-4 dark:border-slate-700" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`User menu for ${name}`}
        aria-expanded={open}
        aria-haspopup="true"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-sm font-bold text-white shadow-sm ring-2 ring-transparent transition hover:ring-blue-400 focus-visible:outline-none dark:hover:ring-blue-500"
      >
        {initial}
      </button>

      {open && (
        <div
          className="absolute right-0 top-11 z-50 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700/60 dark:bg-slate-900"
          role="menu"
        >
          {/* Identity block */}
          <div className="flex items-center gap-3 bg-slate-50 px-4 py-4 dark:bg-slate-800/50">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-base font-bold text-white shadow">
              {initial}
            </div>
            <div className="min-w-0 overflow-hidden">
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{name}</p>
              {email && (
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">{email}</p>
              )}
            </div>
          </div>

          {/* Last login */}
          {lastLogin && (
            <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-800">
              <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400 dark:text-slate-500">
                Last sign-in
              </p>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{lastLogin}</p>
            </div>
          )}

          {/* Sign out */}
          <div className="border-t border-slate-100 p-2 dark:border-slate-800">
            <button
              type="button"
              role="menuitem"
              onClick={() => void instance.logoutRedirect({ postLogoutRedirectUri: REDIRECT_URI })}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const AppShell = ({ children }: { children: ReactNode }) => (
  <div className="min-h-screen bg-slate-50 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
    <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/60">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">SCAI Security Portal</h1>
          <span className="text-sm text-slate-500 dark:text-slate-400">Supply Chain Assurance</span>
        </div>
        <div className="flex items-center gap-4">
          <nav className="flex items-center gap-2" aria-label="Main navigation">
            <NavLink to="/" label="Dashboard" />
            {SWFT_WORKSPACE_ENABLED && <NavLink to="/swft" label="SWFT Workspace" />}
          </nav>
          <ThemeToggle />
          {AUTH_ENABLED && <UserMenu />}
        </div>
      </div>
    </header>
    <main className="mx-auto max-w-6xl px-6 py-6 transition-colors dark:bg-transparent">{children}</main>
  </div>
);
