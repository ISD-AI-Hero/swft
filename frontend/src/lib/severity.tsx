// Single source of truth for severity colors, ordering, ranking, and the shared badge component.
// Imported by ProjectTable, RunTable, RunDetailCard, and RunView — edit here, changes apply everywhere.

export const severityOrder = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];

export const severityColors: Record<string, string> = {
  // Standard severity levels
  CRITICAL:
    "border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/20 dark:text-rose-200",
  HIGH:
    "border border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/40 dark:bg-orange-500/20 dark:text-orange-200",
  MEDIUM:
    "border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/20 dark:text-amber-200",
  LOW:
    "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/20 dark:text-emerald-200",
  UNKNOWN:
    "border border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-600/40 dark:bg-slate-600/30 dark:text-slate-200",
  // CodeQL severity aliases
  error:
    "border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/20 dark:text-rose-200",
  warning:
    "border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/20 dark:text-amber-200",
  note:
    "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/20 dark:text-emerald-200",
  // SonarQube severity aliases
  BLOCKER:
    "border border-red-200 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-500/20 dark:text-red-200",
  MAJOR:
    "border border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/40 dark:bg-orange-500/20 dark:text-orange-200",
  INFO:
    "border border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/20 dark:text-blue-200",
};

/** Maps a risk level string to its position in severityOrder (lower = more severe). Nulls sort last. */
export const riskLevelRank = (riskLevel: string | null): number => {
  if (!riskLevel) return severityOrder.length;
  const normalized = riskLevel.toUpperCase();
  const index = severityOrder.indexOf(normalized);
  return index === -1 ? severityOrder.length : index;
};

/** Colored pill badge for a severity level. Pass `count` to show a numeric count alongside the label. */
export const SeverityBadge = ({ severity, count }: { severity: string; count?: number }) => {
  const style = severityColors[severity] ?? severityColors.UNKNOWN;
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${style}`}>
      <span>{severity}</span>
      {typeof count === "number" && (
        <span className="text-slate-900 dark:text-slate-100">{count}</span>
      )}
    </span>
  );
};
