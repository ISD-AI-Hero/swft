// Shared app chrome: header, navigation, theme toggle, and page container.
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ThemeToggle } from "@components/ThemeToggle";
import { SWFT_WORKSPACE_ENABLED } from "@lib/features";

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
        </div>
      </div>
    </header>
    <main className="mx-auto max-w-6xl px-6 py-6 transition-colors dark:bg-transparent">{children}</main>
  </div>
);
