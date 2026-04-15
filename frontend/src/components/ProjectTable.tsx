// Sortable project listing used on the dashboard.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ProjectSummary } from "@lib/types";
import { SeverityBadge, severityOrder, riskLevelRank } from "@lib/severity";

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleString() : "—");

const headers = [
  { key: "index", label: "#", sortable: false },
  { key: "project", label: "Project", sortable: true },
  { key: "latestrisk", label: "Latest Overall Risk", sortable: true },
  { key: "runs", label: "Runs", sortable: true },
  { key: "latest", label: "Latest run", sortable: true }
] as const;

// Column-aware sorter so we can reuse the same table for name, run count, and timestamp views.
const sortProjects = (projects: ProjectSummary[], column: string, direction: "asc" | "desc") => {
  const sorted = [...projects].sort((a, b) => {
    switch (column) {
      case "project": {
        return a.project_id.localeCompare(b.project_id, undefined, { sensitivity: "base" });
      }
      case "latestrisk": {
        // Sort by severity order (CRITICAL first, then HIGH, MEDIUM, LOW, UNKNOWN, then nulls)
        const aRank = riskLevelRank(a.latest_overall_risk_level);
        const bRank = riskLevelRank(b.latest_overall_risk_level);
        return aRank - bRank;
      }
      case "runs": {
        return a.run_count - b.run_count;
      }
      case "latest": {
        const aTime = a.latest_run_at ? new Date(a.latest_run_at).getTime() : 0;
        const bTime = b.latest_run_at ? new Date(b.latest_run_at).getTime() : 0;
        return aTime - bTime;
      }
      default:
        return 0;
    }
  });
  if (direction === "desc") sorted.reverse();
  return sorted;
};

export const ProjectTable = ({ projects }: { projects: ProjectSummary[] }) => {
  const [sortColumn, setSortColumn] = useState<string>("latest");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // Keep the sorted rows memoised so re-renders stay cheap.
  const rows = useMemo(() => sortProjects(projects, sortColumn, sortDirection), [projects, sortColumn, sortDirection]);

  const handleSort = (column: string, sortable: boolean) => {
    // Follow the same UX pattern as RunTable: flip direction or jump to a new column.
    if (!sortable) return;
    if (column === sortColumn) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection(column === "project" ? "asc" : "desc");
    }
  };

  const sortIndicator = (column: string) => {
    if (column !== sortColumn) return null;
    return sortDirection === "asc" ? "▲" : "▼";
  };

  if (projects.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm dark:border-slate-800 dark:bg-slate-950/40">
        <p className="font-medium text-slate-700 dark:text-slate-200">No projects discovered yet</p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Projects appear here once a CI/CD workflow has run and uploaded artifacts to the portal.</p>
      </div>
    );
  }

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
          {rows.map((project, index) => (
            <tr key={project.project_id} className="transition hover:bg-slate-100 dark:hover:bg-slate-900/60">
              <td className="px-4 py-3 text-sm font-medium text-slate-500 dark:text-slate-400">{index + 1}</td>
              <td className="px-4 py-3 text-sm">
                <Link to={`/projects/${project.project_id}`} className="font-semibold text-slate-900 transition hover:text-blue-500 dark:text-white dark:hover:text-blue-300">
                  {project.project_id}
                </Link>
              </td>
              <td className="px-4 py-3 text-sm">
                {project.latest_overall_risk_level ? (
                  <SeverityBadge severity={project.latest_overall_risk_level} />
                ) : (
                  <span className="text-slate-400 dark:text-slate-500">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{project.run_count}</td>
              <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{formatDate(project.latest_run_at)}</td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  );
};
