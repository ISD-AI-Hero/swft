// Sortable runs table for a single project.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { RunSummary } from "@lib/types";
import { SeverityBadge, severityOrder, riskLevelRank } from "@lib/severity";

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleString() : "—");
const statusColor = (status: string | null) => (status === "passed" ? "text-emerald-400" : status === "failed" ? "text-rose-400" : "text-slate-400");

const headers = [
  { key: "index", label: "#", sortable: false },
  { key: "run", label: "Run", sortable: true },
  { key: "overallrisk", label: "Overall Risk", sortable: true },
  { key: "finalassessment", label: "Assessment findings", sortable: true },
  { key: "cosign", label: "Cosign", sortable: true },
  { key: "created", label: "Created", sortable: true },
  { key: "actions", label: "", sortable: false }
] as const;

const severityRank = (status: string | null): number => {
  const normalized = (status ?? "").toLowerCase();
  if (normalized === "passed") return 1;
  if (normalized === "failed") return 2;
  return 3;
};

// Apply column-specific ordering rules so the table sort feels natural to reviewers.
const sortRuns = (runs: RunSummary[], column: string, direction: "asc" | "desc") => {
  const sorted = [...runs].sort((a, b) => {
    switch (column) {
      case "run":
        return a.run_id.localeCompare(b.run_id, undefined, { numeric: true });
      case "overallrisk": {
        // Sort by severity order (CRITICAL first, then HIGH, MEDIUM, LOW, UNKNOWN, then nulls)
        const aRank = riskLevelRank(a.final_assessment_overall_risk_level);
        const bRank = riskLevelRank(b.final_assessment_overall_risk_level);
        return aRank - bRank;
      }
      case "cosign":
        return severityRank(a.cosign_status) - severityRank(b.cosign_status);
      case "finalassessment": {
        // Treat null as -1 for sorting (nulls sort last)
        const aValue = a.final_assessment_findings_total ?? -1;
        const bValue = b.final_assessment_findings_total ?? -1;
        if (aValue === bValue) {
          const aFail = a.final_assessment_findings_failset ?? -1;
          const bFail = b.final_assessment_findings_failset ?? -1;
          return aFail - bFail;
        }
        return aValue - bValue;
      }
      case "created": {
        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
        return aTime - bTime;
      }
      default:
        return 0;
    }
  });
  if (direction === "desc") sorted.reverse();
  return sorted;
};

export const RunTable = ({ projectId, runs }: { projectId: string; runs: RunSummary[] }) => {
  const [sortColumn, setSortColumn] = useState<string>("created");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // Recompute the row order whenever the user changes the sort criteria.
  const rows = useMemo(() => sortRuns(runs, sortColumn, sortDirection), [runs, sortColumn, sortDirection]);

  const handleSort = (column: string, sortable: boolean) => {
    // Toggle between ascending/descending or swap to a new column on click.
    if (!sortable) return;
    if (column === sortColumn) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection(column === "run" ? "asc" : "desc");
    }
  };

  const sortIndicator = (column: string) => {
    if (column !== sortColumn) return null;
    return sortDirection === "asc" ? "▲" : "▼";
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition dark:border-slate-800 dark:bg-slate-950/40">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
        <thead className="bg-slate-100 dark:bg-slate-900/80">
          <tr>
            {headers.map((header) => (
              <th
                key={header.key}
                scope="col"
                tabIndex={header.sortable ? 0 : undefined}
                aria-sort={
                  !header.sortable
                    ? undefined
                    : header.key !== sortColumn
                    ? "none"
                    : sortDirection === "asc"
                    ? "ascending"
                    : "descending"
                }
                className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${header.sortable ? "cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500" : ""}`}
                onClick={() => handleSort(header.key, header.sortable)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleSort(header.key, header.sortable);
                  }
                }}
              >
                <span className="flex items-center gap-2">
                  {header.label}
                  {header.sortable && <span aria-hidden="true" className="text-slate-400 dark:text-slate-500">{sortIndicator(header.key)}</span>}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-900 dark:bg-slate-950/40">
            {rows.map((run, index) => (
            <tr key={run.run_id} className="transition hover:bg-slate-100 dark:hover:bg-slate-900/60">
              <td className="px-4 py-3 text-sm font-medium text-slate-500 dark:text-slate-400">{index + 1}</td>
              <td className="px-4 py-3 text-sm font-medium text-slate-900 dark:text-white">{run.run_id}</td>
              <td className="px-4 py-3 text-sm">
                {run.final_assessment_overall_risk_level ? (
                  <SeverityBadge severity={run.final_assessment_overall_risk_level} />
                ) : (
                  <span className="text-slate-400 dark:text-slate-500">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                {run.final_assessment_findings_total !== null && run.final_assessment_findings_failset !== null
                  ? `${run.final_assessment_findings_total} total · ${run.final_assessment_findings_failset} above threshold`
                  : "—"}
              </td>
              <td className={`px-4 py-3 text-sm font-medium ${statusColor(run.cosign_status)}`}>{run.cosign_status ?? "—"}</td>
              <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">{formatDate(run.created_at)}</td>
              <td className="px-4 py-3 text-right">
                <Link to={`/projects/${projectId}/runs/${run.run_id}`} className="rounded-lg border border-blue-500/40 px-3 py-1 text-sm font-medium text-blue-600 transition hover:border-blue-400 hover:text-blue-700 dark:text-blue-200 dark:hover:text-blue-100">View</Link>
              </td>
            </tr>
          ))}
          {runs.length === 0 && (
            <tr>
              <td colSpan={headers.length} className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">No runs found for this project.</td>
            </tr>
          )}
        </tbody>
        </table>
      </div>
    </div>
  );
};
