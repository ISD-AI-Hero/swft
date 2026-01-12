// Authorization signals dashboard with Nivo charts (Trivy, SBOM, cosign, evidence, cadence).
import { useMemo, useState, type ComponentProps } from "react";
import { useNavigate } from "react-router-dom";
import { ResponsiveLine as NivoResponsiveLine, type Point, type PointSymbolProps, type SliceTooltipProps } from "@nivo/line";
import { useTheme } from "@hooks/useTheme";
import type { RunSummary } from "@lib/types";

/**
 * Supported comparison window sizes exposed to the user. Keeping the list short prevents analysis fatigue.
 */
type WindowOption = 2 | 3 | 5 | 7 | 9 | 11;
const WINDOW_OPTIONS: WindowOption[] = [2, 3, 5, 7, 9, 11];

type ChronologicalRun = RunSummary & { label: string };
type LineDatum = { x: string; y: number | null; runId: string; createdAtLabel: string; [key: string]: unknown };
type LineSeries = Array<{ id: string; color: string; data: LineDatum[] }>;

/**
 * Convert an ISO timestamp into a stable human-readable label.
 */
const formatTimestamp = (value: string | null): string => {
  if (!value) return "Timestamp unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

/**
 * Derive a Nivo theme palette that mirrors the current Tailwind light/dark styling.
 */
const useNivoTheme = (isDark: boolean) =>
  useMemo(
    () => ({
      textColor: isDark ? "#cbd5f5" : "#334155",
      grid: { line: { stroke: isDark ? "rgba(148, 163, 184, 0.2)" : "rgba(148, 163, 184, 0.35)", strokeWidth: 1 } },
      axis: {
        ticks: { text: { fill: isDark ? "#e2e8f0" : "#475569", fontSize: 12 } },
        legend: { text: { fill: isDark ? "#e2e8f0" : "#475569", fontSize: 12 } },
        domain: { line: { stroke: isDark ? "rgba(148, 163, 184, 0.35)" : "rgba(148, 163, 184, 0.5)", strokeWidth: 1 } }
      },
      crosshair: { line: { stroke: isDark ? "#38bdf8" : "#0ea5e9", strokeWidth: 1, strokeOpacity: 0.65 } },
      tooltip: {
        container: {
          background: isDark ? "#0f172a" : "#ffffff",
          color: isDark ? "#e2e8f0" : "#1f2937",
          fontSize: 13,
          borderRadius: 12,
          padding: 12,
          boxShadow: isDark ? "0 10px 30px rgba(15, 23, 42, 0.45)" : "0 10px 35px rgba(15, 23, 42, 0.15)"
        }
      }
    }),
    [isDark]
  );

const COSIGN_SCALE = {
  passed: 1,
  failed: 0
} as const;

const ARTIFACT_KEYS: Array<{ 
  field: string; 
  label: string; 
  color: string;
  requiredCount?: number; // Required count for completeness (default: 1)
}> = [
  { field: "run", label: "Run metadata", color: "#2563eb" },
  { field: "sbom", label: "SBOM", color: "#38bdf8" },
  { field: "finalassessment", label: "Final Assessment", color: "#8b5cf6" },
  { field: "codeql", label: "CodeQL", color: "#ec4899", requiredCount: 2 },
  { field: "trivy", label: "Trivy report", color: "#14b8a6", requiredCount: 2 },
  { field: "dockerinspect", label: "Docker Inspect", color: "#f59e0b" },
  { field: "sonarqube", label: "SonarQube", color: "#10b981" }
];

const CustomPoint = ({ size, color, borderWidth, borderColor }: PointSymbolProps) => (
  <circle
    r={size / 2}
    fill={color ?? "#2563eb"}
    stroke={borderColor ?? "#ffffff"}
    strokeWidth={borderWidth ?? 2}
  />
);

type SafeResponsiveLineProps = ComponentProps<typeof NivoResponsiveLine>;

/**
 * @nivo/line 0.85 marks several props as required via PropTypes but does not provide defaults
 * when consuming the responsive wrapper. This shim injects the expected values so React dev
 * builds stay quiet regardless of how the chart is rendered.
 */
const ResponsiveLine = (props: SafeResponsiveLineProps) => {
  const {
    defs = [],
    fill = [],
    enableCrosshair = true,
    role = "img",
    ...rest
  } = props;
  return <NivoResponsiveLine defs={defs} fill={fill} enableCrosshair={enableCrosshair} role={role} {...rest} />;
};

/**
 * Secure build insights rendered as multiple focused charts so Authorizing Officials can spot "authorization smells" instantly.
 */
export const RunHistoryCard = ({ projectId, runs }: { projectId: string; runs: RunSummary[] }) => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  // Default to five runs for a balanced view, but adapt when the dataset is smaller.
  const preferredDefault = WINDOW_OPTIONS.includes(5) ? 5 : WINDOW_OPTIONS[0];
  const [windowSize, setWindowSize] = useState<WindowOption>(preferredDefault);

  const effectiveCount = Math.min(windowSize, runs.length);
  const recentRuns = useMemo(() => runs.slice(0, effectiveCount), [runs, effectiveCount]);

  // Keep runs chronological for easier reading left-to-right.
  const chronological: ChronologicalRun[] = useMemo(
    () =>
      recentRuns
        .slice()
        .reverse()
        .map((run) => ({
          ...run,
          label: formatTimestamp(run.created_at)
        })),
    [recentRuns]
  );

  const nivoTheme = useNivoTheme(isDark);

  const vulnerabilitySeries: LineSeries = useMemo(
    () => [
      {
        id: "Total findings",
        color: "#fb923c",
        data: chronological.map((run) => ({
          x: run.run_id,
          y: run.final_assessment_findings_total ?? null,
          runId: run.run_id,
          createdAtLabel: run.label,
          hasData: run.final_assessment_findings_total !== null
        }))
      },
      {
        id: "Sec+",
        color: "#ef4444",
        data: chronological.map((run) => ({
          x: run.run_id,
          y: run.final_assessment_findings_failset ?? null,
          runId: run.run_id,
          createdAtLabel: run.label,
          hasData: run.final_assessment_findings_failset !== null
        }))
      }
    ],
    [chronological]
  );

  const sbomSeries: LineSeries = useMemo(
    () => [
      {
        id: "SBOM components",
        color: "#38bdf8",
        data: chronological.map((run) => ({
          x: run.run_id,
          y: run.sbom_component_total ?? null,
          runId: run.run_id,
          createdAtLabel: run.label
        }))
      }
    ],
    [chronological]
  );

  const cosignSeries: LineSeries = useMemo(
    () => [
      {
        id: "Cosign verification",
        color: "#22c55e",
        data: chronological.map((run) => {
          const normalized = run.cosign_status ? COSIGN_SCALE[run.cosign_status as keyof typeof COSIGN_SCALE] ?? null : null;
          return {
            x: run.run_id,
            y: normalized,
            runId: run.run_id,
            createdAtLabel: run.label,
            status: run.cosign_status ?? "unknown"
          };
        })
      }
    ],
    [chronological]
  );

  const evidenceSeries: LineSeries = useMemo(
    () =>
      ARTIFACT_KEYS.map((key) => ({
        id: key.label,
        color: key.color,
        data: chronological.map((run) => {
          const count = (run.artifact_counts?.[key.field] as number | undefined) ?? 0;
          // Check if required count is met (2 for codeql/trivy, 1+ for others)
          const required = key.requiredCount ?? 1;
          const isComplete = count >= required;
          return {
            x: run.run_id,
            y: isComplete ? 1 : 0,
            runId: run.run_id,
            createdAtLabel: run.label,
            count: count, // Store count for tooltip
            required: required
          };
        })
      })),
    [chronological]
  );

  const cadenceSeries: LineSeries = useMemo(() => {
    const seriesData = chronological.map((run, index) => {
      if (index === 0) {
        return { x: run.run_id, y: null, runId: run.run_id, createdAtLabel: run.label };
      }
      const previous = chronological[index - 1];
      if (!run.created_at || !previous.created_at) return { x: run.run_id, y: null, runId: run.run_id, createdAtLabel: run.label };
      const currentTime = new Date(run.created_at).getTime();
      const previousTime = new Date(previous.created_at).getTime();
      const diffHours = (currentTime - previousTime) / (1000 * 60 * 60);
      const diffDays = diffHours / 24;
      return {
        x: run.run_id,
        y: Number(diffDays.toFixed(2)),
        runId: run.run_id,
        createdAtLabel: run.label
      };
    });

    return [
      {
        id: "Days since prior run",
        color: "#a855f7",
        data: seriesData
      }
    ];
  }, [chronological]);

  const handlePointClick = (point: Point) => {
    const runId = (point.data as { runId?: string }).runId;
    if (runId) navigate(`/projects/${projectId}/runs/${runId}`);
  };

  const windowLabel = effectiveCount < windowSize ? `${effectiveCount} of ${windowSize}` : `${effectiveCount}`;

const renderLineChart = (
  series: LineSeries,
  options?: {
    yMin?: number;
    yMax?: number | "auto";
    axisLeftLabel?: string;
      axisLeftFormat?: (value: number) => string;
      tooltipFormatter?: (slice: SliceTooltipProps["slice"]) => JSX.Element;
    }
  ) => {
    const palette = series.map((serie) => (typeof serie.color === "string" ? serie.color : "#2563eb"));
    return (
    <ResponsiveLine
      data={series}
      margin={{ top: 20, right: 32, bottom: 80, left: 56 }}
      xScale={{ type: "point" }}
      yScale={{ type: "linear", min: options?.yMin ?? 0, max: options?.yMax ?? "auto", stacked: false }}
      theme={nivoTheme}
      colors={palette}
      lineWidth={3}
      enablePoints
      pointColor={{ from: "color" }}
      pointSize={10}
      pointBorderWidth={2}
      pointBorderColor={isDark ? "#0f172a" : "#ffffff"}
      pointSymbol={CustomPoint}
      enableSlices="x"
      sliceTooltip={({ slice }) =>
        options?.tooltipFormatter ? (
          options.tooltipFormatter(slice)
        ) : (
          <div className="rounded-xl bg-white p-3 text-sm text-slate-700 shadow-lg ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Run {(slice.points[0]?.data as { runId?: string }).runId ?? ""}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{(slice.points[0]?.data as { createdAtLabel?: string }).createdAtLabel ?? ""}</div>
            <div className="mt-2 space-y-1">
              {slice.points.map((point) => (
                <div key={point.id} className="flex items-center gap-2">
                  <span className="inline-flex h-2.5 w-2.5 flex-none rounded-full" style={{ background: point.serieColor }} />
                  <span className="flex-1 text-xs">{point.serieId}</span>
                  <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">{point.data.yFormatted}</span>
                </div>
              ))}
            </div>
          </div>
        )
      }
      axisBottom={{ tickRotation: -35, legend: "Run ID", legendOffset: 60, legendPosition: "middle" }}
      axisLeft={{
        legend: options?.axisLeftLabel ?? "Count",
        legendOffset: -45,
        legendPosition: "middle",
        format: options?.axisLeftFormat
      }}
      crosshairType="x"
      onClick={handlePointClick}
      useMesh
      motionConfig="gentle"
      animate
    />
  );
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition dark:border-slate-800 dark:bg-slate-950/50">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Authorization Signals</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Evidence trends across recent runs. Click any point to jump straight into the detailed run view.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100/70 p-1 dark:border-slate-700 dark:bg-slate-900/60">
          {WINDOW_OPTIONS.map((option) => {
            const isActive = option === windowSize;
            const disabled = runs.length < 2 && option > 2;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setWindowSize(option)}
                disabled={disabled}
                className={`rounded-full px-3 py-1 text-sm font-medium transition ${
                  isActive ? "bg-white text-blue-600 shadow-sm dark:bg-slate-700 dark:text-blue-200" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Showing {windowLabel} most recent runs</div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800 dark:bg-slate-950/40">
          <header className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Vulnerability posture</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Track assessment findings and the subset that breaks policy thresholds.
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 italic mt-1">
              Note: Gaps indicate runs without the final assessment artifact.
            </p>
          </header>
          <div className="mt-4 h-64">
            {renderLineChart(vulnerabilitySeries, {
              tooltipFormatter: (slice) => {
                const hasAnyData = slice.points.some((point) => {
                  const pointData = point.data as { hasData?: boolean; y?: number | null };
                  return pointData.hasData === true && pointData.y !== null;
                });
                
                return (
                  <div className="rounded-xl bg-white p-3 text-sm text-slate-700 shadow-lg ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Run {(slice.points[0]?.data as { runId?: string }).runId ?? ""}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{(slice.points[0]?.data as { createdAtLabel?: string }).createdAtLabel ?? ""}</div>
                    {!hasAnyData ? (
                      <div className="mt-2 text-xs text-amber-600 dark:text-amber-400 italic">
                        Final assessment not available for this run
                      </div>
                    ) : (
                      <div className="mt-2 space-y-1">
                        {slice.points.map((point) => {
                          const pointData = point.data as { hasData?: boolean; y?: number | null };
                          const hasData = pointData.hasData === true && pointData.y !== null;
                          return (
                            <div key={point.id} className="flex items-center gap-2">
                              <span className="inline-flex h-2.5 w-2.5 flex-none rounded-full" style={{ background: point.serieColor }} />
                              <span className="flex-1 text-xs">{point.serieId}</span>
                              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                                {hasData ? point.data.yFormatted : "—"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }
            })}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800 dark:bg-slate-950/40">
          <header className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">SBOM inventory</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Surface area trends driven by component count changes in the SBOM.</p>
          </header>
          <div className="mt-4 h-64">{renderLineChart(sbomSeries)}</div>
        </div>

        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800 dark:bg-slate-950/40">
          <header className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Signature health</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Watch for consecutive cosign failures or runs lacking attestation.</p>
          </header>
          <div className="mt-4 h-64">
            {renderLineChart(cosignSeries, {
              yMin: 0,
              yMax: 1,
              axisLeftLabel: "Verification",
              axisLeftFormat: (value) => (value === 1 ? "Passed" : value === 0 ? "Failed" : ""),
              tooltipFormatter: (slice) => (
                <div className="rounded-xl bg-white p-3 text-sm text-slate-700 shadow-lg ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Run {(slice.points[0]?.data as { runId?: string }).runId ?? ""}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{(slice.points[0]?.data as { createdAtLabel?: string }).createdAtLabel ?? ""}</div>
                  {slice.points.map((point) => (
                    <div key={point.id} className="mt-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {((point.data as unknown as { status?: string }).status ?? "unknown").toUpperCase()}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800 dark:bg-slate-950/40">
          <header className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Evidence completeness</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Verify that run, SBOM, Final Assessment, CodeQL, Trivy, Docker Inspect, and SonarQube artifacts land together every time.</p>
          </header>
          <div className="mt-4 h-64">
            {renderLineChart(evidenceSeries, {
              yMin: 0,
              yMax: 1,
              axisLeftLabel: "Artifact present",
              axisLeftFormat: (value) => (value === 1 ? "Yes" : value === 0 ? "No" : ""),
              tooltipFormatter: (slice) => {
                // Create a map of points by serieId for quick lookup
                const pointsBySerieId = new Map(slice.points.map((point) => [point.serieId, point]));
                return (
                  <div className="min-w-[220px] rounded-xl bg-white p-3 text-sm text-slate-700 shadow-lg ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Run {(slice.points[0]?.data as { runId?: string }).runId ?? ""}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{(slice.points[0]?.data as { createdAtLabel?: string }).createdAtLabel ?? ""}</div>
                    <div className="mt-2 space-y-1">
                      {ARTIFACT_KEYS.map((key) => {
                        const point = pointsBySerieId.get(key.label);
                        if (!point) return null;
                        const pointData = point.data as { count?: number; required?: number; y?: number };
                        const count = pointData.count ?? 0;
                        const required = pointData.required ?? 1;
                        const isComplete = (pointData.y as number) === 1;
                        return (
                          <div key={point.id} className="flex items-center justify-between gap-3 text-xs">
                            <span>{point.serieId}</span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {isComplete ? `Present (${count}/${required})` : `Missing (${count}/${required})`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }
            })}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800 dark:bg-slate-950/40 xl:col-span-2">
          <header className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Delivery cadence</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Large gaps can indicate stalled pipelines or environments drifting without new evidence.
            </p>
          </header>
          <div className="mt-4 h-64">
            {renderLineChart(cadenceSeries, {
              axisLeftLabel: "Days between runs",
              axisLeftFormat: (value) => value.toString()
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
