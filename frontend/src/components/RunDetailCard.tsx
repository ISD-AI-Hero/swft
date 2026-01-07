// Run overview card: timeline, GitHub context, image provenance, artifacts list.
import type { RunDetail } from "@lib/types";
import { InfoPopover } from "@components/InfoPopover";

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleString() : "—");
const truncateCommit = (commit: string | undefined): string => (commit && commit.length > 7 ? commit.slice(0, 7) : commit ?? "—");

// Core layout for the run overview section. Accepts optional SBOM/Trivy highlights so the caller
// can decide how much context to render without duplicating formatting logic.
type SbomHighlights = {
  totalComponents?: number;
  uniqueTypes?: number;
  uniqueLicenses?: number;
  baseImage?: { name: string; version?: string; supplier?: string } | null;
  topLicenses?: { name: string; count: number }[];
} | null;

type TrivyHighlights = {
  platform?: {
    osFamily: string | null;
    osName: string | null;
    imageID: string | null;
    repoDigests: string[];
  };
} | null;

const overviewHelp = {
  timeline: {
    description: "Key signals coming from run.json that show when the workflow executed and whether the gatekeeping checks passed.",
    items: [
      { label: "Created", content: "UTC timestamp recorded in run.json for this workflow run." },
      { label: "Cosign verification", content: "Result of the signing verification step against the pushed image digest." },
      { label: "Trivy findings", content: "Total findings and those that triggered the fail-set in policy summarised from run.json." },
      { label: "Deployment URL", content: "Endpoint emitted by deployment steps so the accrediting official can inspect the live instance." }
    ]
  },
  github: {
    description: "Repository provenance captured in run.json so reviewers can trace the source commit and workflow invocation.",
    items: [
      { label: "Repository", content: "GitHub repository that produced this run." },
      { label: "Workflow & Branch", content: "The workflow file and branch/ref used during execution." },
      { label: "Commit & Run link", content: "Direct pointers to the commit SHA and GitHub Actions run for audit trails." }
    ]
  },
  image: {
    description: "Image provenance derived from run.json and SBOM summary to document what exactly was scanned and deployed.",
    items: [
      { label: "Source image", content: "Registry/name:tag that was built and published by the workflow." },
      { label: "Base image & OS", content: "Details from the SBOM indicating the parent image and OS component for hardening review." },
      { label: "Repo digest", content: "Immutable digest of the image that all findings relate to." }
    ]
  },
  artifacts: {
    description: "Artifacts uploaded alongside the run so stakeholders can download the SBOM, Trivy report, and run metadata directly.",
    items: [{ content: "Each entry shows the artifact type and the blob name stored in Azure/GitHub for reference." }]
  }
} as const;

export const RunDetailCard = ({
  detail,
  sbomHighlights,
  trivyHighlights
}: {
  detail: RunDetail;
  sbomHighlights?: SbomHighlights;
  trivyHighlights?: TrivyHighlights;
}) => {
  const metadata = detail.metadata ?? {};
  // Defensive parsing because run.json values come from multiple CI scripts.
  const repo = typeof metadata.repository === "string" ? metadata.repository : "—";
  const workflow = typeof metadata.workflow === "string" ? metadata.workflow : "—";
  const ref = typeof metadata.ref === "string" ? metadata.ref : "—";
  const branch = ref.startsWith("refs/heads/") ? ref.replace("refs/heads/", "") : ref;
  const runInfo = typeof metadata.run === "object" && metadata.run !== null ? (metadata.run as Record<string, unknown>) : null;
  const runUrl = runInfo && typeof runInfo.url === "string" ? runInfo.url : undefined;
  const commitSha = typeof metadata.commitSha === "string" ? metadata.commitSha : undefined;
  const imageInfo = typeof metadata.image === "object" && metadata.image !== null ? (metadata.image as Record<string, unknown>) : null;
  const imageRegistry = imageInfo && typeof imageInfo.registry === "string" ? imageInfo.registry : null;
  const imageName = imageInfo && typeof imageInfo.name === "string" ? imageInfo.name : null;
  const imageTag = imageInfo && typeof imageInfo.tag === "string" ? imageInfo.tag : null;
  const imageDigest = imageInfo && typeof imageInfo.digest === "string" ? imageInfo.digest : null;
  const imageReferenceBase = [imageRegistry, imageName].filter(Boolean).join("/");
  const imageReference =
    imageReferenceBase.length > 0
      ? `${imageReferenceBase}${imageTag ? `:${imageTag}` : ""}`
      : imageTag ?? "";
  const osFamily = trivyHighlights?.platform?.osFamily ?? null;
  const osName = trivyHighlights?.platform?.osName ?? null;
  const repoDigest = trivyHighlights?.platform?.repoDigests?.[0];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition dark:border-slate-800 dark:bg-slate-900/60">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Run timeline</h3>
          <InfoPopover title="Run timeline" description={overviewHelp.timeline.description} items={overviewHelp.timeline.items} align="left" />
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Snapshot of when the run executed, whether signing and vulnerability checks passed, and where it was deployed.
        </p>
        <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">Run {detail.summary.run_id}</p>
        <dl className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
          <div className="flex items-center justify-between">
            <dt>Created</dt>
            <dd>{formatDate(detail.summary.created_at)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt>Cosign verification</dt>
            <dd className={detail.summary.cosign_status === "passed" ? "text-emerald-400" : "text-rose-400"}>{detail.summary.cosign_status ?? "unknown"}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt>Trivy findings</dt>
            <dd>{detail.summary.trivy_findings_total ?? 0} total / {detail.summary.trivy_findings_failset ?? 0} fail-set</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt>Deployment URL</dt>
            <dd>
              {detail.summary.deployment_url ? (
                <a href={detail.summary.deployment_url} className="text-blue-600 underline dark:text-blue-300" target="_blank" rel="noreferrer">Open Instance</a>
              ) : (
                <span className="text-slate-500 dark:text-slate-400">Not deployed</span>
              )}
            </dd>
          </div>
        </dl>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition dark:border-slate-800 dark:bg-slate-900/60">
       <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">GitHub context</h3>
          <InfoPopover title="GitHub context" description={overviewHelp.github.description} items={overviewHelp.github.items} align="left" />
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Provenance of the workflow execution so you can trace the source repository, commit, and actions run.
        </p>
        <dl className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
          <div className="flex items-center justify-between">
            <dt>Repository</dt>
            <dd className="text-slate-900 dark:text-slate-100">{repo}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt>Workflow</dt>
            <dd className="text-slate-600 dark:text-slate-300">{workflow}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt>Branch</dt>
            <dd className="text-slate-600 dark:text-slate-300">{branch}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt>Commit</dt>
            <dd className="text-slate-600 dark:text-slate-300">{truncateCommit(commitSha)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt>Run link</dt>
            <dd>
              {runUrl ? (
                <a href={runUrl} className="text-blue-600 underline dark:text-blue-300" target="_blank" rel="noreferrer">Open in GitHub</a>
              ) : (
                <span className="text-slate-500 dark:text-slate-400">Not provided</span>
              )}
            </dd>
          </div>
        </dl>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition dark:border-slate-800 dark:bg-slate-900/60 md:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Image provenance</h3>
          <InfoPopover title="Image provenance" description={overviewHelp.image.description} items={overviewHelp.image.items} align="left" />
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Shows the image reference, digest, and base components that the run built, scanned, and deployed.
        </p>
        <dl className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
          <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
            <dt className="font-medium">Source image</dt>
            <dd className="text-right text-slate-900 break-words dark:text-slate-100 md:max-w-xl">
              {imageReference.length > 0 ? imageReference : "—"}
            </dd>
          </div>
          <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
            <dt className="font-medium">Base OS</dt>
            <dd className="text-right text-slate-900 break-words dark:text-slate-100 md:max-w-xl">
              {osFamily || osName ? [osFamily, osName].filter(Boolean).join(" · ") : "—"}
            </dd>
          </div>
          <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
            <dt className="font-medium">Digest</dt>
            <dd className="text-xs text-slate-500 break-all dark:text-slate-400 md:max-w-xl">{imageDigest ?? "—"}</dd>
          </div>
          <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
            <dt className="font-medium">Base image (SBOM)</dt>
            <dd className="text-right text-slate-900 break-words dark:text-slate-100 md:max-w-xl">
              {sbomHighlights?.baseImage?.name
                ? `${sbomHighlights.baseImage.name}${sbomHighlights.baseImage.version ? `@${sbomHighlights.baseImage.version}` : ""}`
                : "—"}
            </dd>
          </div>
          <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
            <dt className="font-medium">Image supplier</dt>
            <dd className="text-right text-slate-900 break-words dark:text-slate-100 md:max-w-xl">
              {sbomHighlights?.baseImage?.supplier ?? "—"}
            </dd>
          </div>
          <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
            <dt className="font-medium">Repo digest</dt>
            <dd className="text-xs text-slate-500 break-all dark:text-slate-400 md:max-w-xl">{repoDigest ?? "—"}</dd>
          </div>
        </dl>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition dark:border-slate-800 dark:bg-slate-900/60 md:col-span-2">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Artifacts</h3>
          <InfoPopover title="Artifacts" description={overviewHelp.artifacts.description} items={overviewHelp.artifacts.items} align="left" />
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Downloadable outputs linked to this run—use them for independent review or archival.
        </p>
        <ul className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
          {detail.artifacts.map((artifact) => {
            const isSignature = artifact.blob_name.endsWith(".sig");
            const displayType = isSignature ? `${artifact.artifact_type} - SIG` : artifact.artifact_type;
            return (
              <li key={artifact.blob_name} className="flex items-center justify-between">
                <span className="font-medium text-slate-900 uppercase dark:text-slate-100">{displayType}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{artifact.blob_name}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};
