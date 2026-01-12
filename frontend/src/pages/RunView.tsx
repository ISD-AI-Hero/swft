import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchArtifact, fetchRunDetail } from "@lib/api";
// [SWFT AI ASSISTANT - TEMPORARILY DISABLED] - Assistant-related imports
// import type { AssistantFacet } from "@lib/types";
// import { AssistantPanel } from "@components/assistant/AssistantPanel";
// import { SparklesIcon } from "@heroicons/react/24/outline";
import { SWFT_WORKSPACE_ENABLED } from "@lib/features";
import { useApi } from "@hooks/useApi";
import { LoadingState } from "@components/LoadingState";
import { ErrorState } from "@components/ErrorState";
import { Breadcrumbs } from "@components/Breadcrumbs";
import { RunDetailCard } from "@components/RunDetailCard";
import { CollapsibleSection } from "@components/CollapsibleSection";
import { JsonModal } from "@components/JsonModal";
import { InfoPopover } from "@components/InfoPopover";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Full run detail page: fetches the main run record, enriches it with SBOM/Trivy summaries,
// and renders a stack of cards with provenance and security insights.

type SbomSummary = {
  totalComponents: number;
  uniqueTypes: number;
  uniqueLicenses: number;
  typeBreakdown: { label: string; count: number }[];
  licenseGapsByType: Record<string, number>;
  components: { name: string; version: string; type: string; missingLicense: boolean; supplier?: string | null }[];
  topComponents: { name: string; version: string; type: string; missingLicense: boolean; supplier?: string | null }[];
  topLicenses: { name: string; count: number }[];
  baseImage: { name: string; version?: string; supplier?: string } | null;
  componentsWithoutLicense: number;
  topEcosystems: { name: string; count: number }[];
  generator: string | null;
};

type TrivyFinding = {
  id: string;
  severity: string;
  title: string;
  packageName: string;
  installedVersion: string;
  fixedVersion: string;
  target: string;
  publishedDate?: string | null;
  cvssScore?: number | null;
};

type TrivySummary = {
  totalFindings: number;
  severityCounts: { severity: string; count: number }[];
  topFindings: TrivyFinding[];
  packageFindings: {
    name: string;
    highestSeverity: string | null;
    fixableCount: number;
    total: number;
  }[];
  topTargets: {
    name: string;
    highestSeverity: string | null;
    total: number;
  }[];
  fixRecommendations: {
    packageName: string;
    installedVersion: string;
    fixedVersion: string;
    occurrences: number;
    highestSeverity: string | null;
  }[];
  cvssStats: {
    maxScore: number | null;
    averageScore: number | null;
    scoredFindings: number;
  };
  publishWindow: {
    newest: string | null;
    oldest: string | null;
  };
  platform: {
    osFamily: string | null;
    osName: string | null;
    imageID: string | null;
    repoDigests: string[];
  };
  scanner: {
    version: string | null;
    dbUpdatedAt: string | null;
  };
  highestSeverity: string | null;
  fixableCount: number;
  withoutFixCount: number;
  classBreakdown: { name: string; count: number }[];
  latestPublished: string | null;
};

type FinalAssessmentFinding = {
  finding: string;
  riskLevel: string;
  determination: string;
  source: string | null;
  lineNumber?: number;
  filePath?: string;
  prompt: string;
};

type FinalAssessmentSummary = {
  totalFindings: number;
  severityCounts: { severity: string; count: number }[];
  highestSeverity: string | null;
  topFindings: FinalAssessmentFinding[];
};

type CodeqlFinding = {
  ruleId: string;
  message: string;
  filePath: string;
  lineNumber: number;
  severity: string;
  securitySeverity: number | null;
  ruleName: string | null;
  helpText: string | null;
  helpMarkdown: string | null;
};

type CodeqlSummary = {
  totalFindings: number;
  severityCounts: { severity: string; count: number }[];
  highestSeverity: string | null;
  topFindings: CodeqlFinding[];
  ruleBreakdown: { ruleId: string; count: number; highestSeverity: string | null }[];
  fileBreakdown: { filePath: string; count: number; highestSeverity: string | null }[];
  securitySeverityStats: {
    maxScore: number | null;
    averageScore: number | null;
    scoredFindings: number;
  };
};

const severityOrder = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];
const codeqlSeverityOrder = ["error", "warning", "note"];
const severityColors: Record<string, string> = {
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
  error:
    "border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/20 dark:text-rose-200",
  warning:
    "border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/20 dark:text-amber-200",
  note:
    "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/20 dark:text-emerald-200"
};

// Quick reference copy for the info popovers so designers can tweak content in one place.
const infoHelp = {
  sbom: {
    description: "Summaries below come directly from sbom.cyclonedx.json and describe the components bundled in this container image.",
    items: [
      { label: "Generator", content: "Identifies the SBOM tool and version that produced this inventory so you know which engine to validate." },
      { label: "Base image & OS", content: "Shows the parent container and operating-system component detected in the SBOM for provenance and hardening checks." },
      { label: "Licensing alert", content: "Components missing license metadata are flagged so legal/compliance teams can review obligations before approval." },
      { label: "Package ecosystems", content: "Highlights the package registries represented in the SBOM to focus supply-chain reviews." }
    ]
  },
  trivyOverview: {
    description: "This section reflects the findings from trivy-report.json and offers context on severity, fix availability, and package classes.",
    items: [
      { label: "Highest severity", content: "The most severe vulnerability detected; if blank, no issues met the scan thresholds." },
      { label: "Fixable vs. no fix", content: "How many findings already have a patched version available versus items still waiting on a vendor fix." },
      { label: "Latest published CVE", content: "Timestamp of the newest disclosure among the detected findings to gauge how fresh the risk landscape is." }
    ]
  },
  trivyScanner: {
    description: "Tracks which Trivy binary and vulnerability database snapshot were used so the assessment can be reproduced or audited.",
    items: [
      { label: "Trivy version", content: "The CLI version invoked by the workflow (from run.json)." },
      { label: "DB updated", content: "When Trivy’s vulnerability database was last refreshed before this scan." },
      { label: "Repo digest", content: "The immutable container digest that was scanned to tie findings back to an exact image." }
    ]
  },
  trivyPolicy: {
    description: "Pulled from run.json to show how the scan was parameterised and what triggers a pipeline failure.",
    items: [
      { label: "Scan severities", content: "Only vulnerabilities at these severities were included in the report." },
      { label: "Fail-on severities", content: "Findings at these levels cause the policy to fail (subject to workflow flags)." },
      { label: "Ignore unfixed", content: "Whether vulnerabilities without a published fix are excluded from failing the run." }
    ]
  }
} as const;

// Extract the handful of SBOM stats the UI needs while tolerating partially populated documents.
const buildSbomSummary = (payload: Record<string, unknown>): SbomSummary => {
  const components = Array.isArray(payload.components) ? payload.components : [];
  const typeCounts = new Map<string, number>();
  const licenseCounts = new Map<string, number>();
  const componentList = [] as { name: string; version: string; type: string; missingLicense: boolean; supplier?: string | null }[];
  let baseImage: { name: string; version?: string; supplier?: string } | null = null;
  let componentsWithoutLicense = 0;
  const missingByType = new Map<string, number>();
  const ecosystemCounts = new Map<string, number>();
  const metadata = typeof payload.metadata === "object" && payload.metadata !== null ? (payload.metadata as Record<string, unknown>) : null;
  const metadataComponent = metadata && typeof metadata.component === "object" && metadata.component !== null ? (metadata.component as Record<string, unknown>) : null;
  let generator: string | null = null;
  if (metadataComponent) {
    const name = typeof metadataComponent.name === "string" ? metadataComponent.name : null;
    const version = typeof metadataComponent.version === "string" ? metadataComponent.version : undefined;
    const supplier =
      typeof metadataComponent.supplier === "object" && metadataComponent.supplier !== null
        ? (
            (metadataComponent.supplier as Record<string, unknown>).name ??
            (metadataComponent.supplier as Record<string, unknown>).url ??
            undefined
          )
        : undefined;
    if (name) {
      baseImage = { name, version, supplier: typeof supplier === "string" ? supplier : undefined };
    }
  }
  const toolsField = metadata ? (metadata as Record<string, unknown>).tools : null;
  const metadataTools = Array.isArray(toolsField) ? toolsField : null;
  if (metadataTools) {
    const tool = metadataTools.find((entry) => typeof entry === "object" && entry !== null) as Record<string, unknown> | undefined;
    if (tool) {
      const toolName = typeof tool.name === "string" ? tool.name : null;
      const toolVendor = typeof tool.vendor === "string" ? tool.vendor : null;
      const toolVersion = typeof tool.version === "string" ? tool.version : null;
      const parts = [toolVendor, toolName, toolVersion ? `v${toolVersion}` : null].filter((value): value is string => !!value);
      generator = parts.length > 0 ? parts.join(" ") : toolName ?? null;
    }
  }
  for (const entry of components) {
    if (typeof entry !== "object" || entry === null) continue;
    const component = entry as Record<string, unknown>;
    const name = typeof component.name === "string" ? component.name : "Unknown";
    const version = typeof component.version === "string" ? component.version : "N/A";
    const type = typeof component.type === "string" ? component.type : "unknown";
    const supplierField = component.supplier;
    const supplier =
      typeof supplierField === "object" && supplierField !== null
        ? (supplierField as Record<string, unknown>).name ?? (supplierField as Record<string, unknown>).url ?? null
        : typeof supplierField === "string"
          ? supplierField
          : null;
    const typeKey = type.toLowerCase();
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    const licenses = Array.isArray(component.licenses) ? component.licenses : [];
    const missingLicense = licenses.length === 0;
    if (missingLicense) {
      componentsWithoutLicense += 1;
      missingByType.set(typeKey, (missingByType.get(typeKey) ?? 0) + 1);
    }
    for (const lic of licenses) {
      if (typeof lic !== "object" || lic === null) continue;
      const licenseInfo = lic as Record<string, unknown>;
      const license =
        typeof licenseInfo.license === "object" && licenseInfo.license !== null
          ? (licenseInfo.license as Record<string, unknown>)
          : null;
      const licenseName =
        (license?.name as string | undefined) ??
        (license?.id as string | undefined) ??
        "Unknown";
      licenseCounts.set(licenseName, (licenseCounts.get(licenseName) ?? 0) + 1);
    }
    const purl = typeof component.purl === "string" ? component.purl : null;
    if (purl?.startsWith("pkg:")) {
      const remainder = purl.slice(4);
      const typeSegment = remainder.split("/")[0] ?? "";
      const ecosystemType = typeSegment.split("@")[0]?.split("?")[0]?.split("#")[0] ?? "";
      if (ecosystemType) {
        const label = ecosystemType.toUpperCase();
        ecosystemCounts.set(label, (ecosystemCounts.get(label) ?? 0) + 1);
      }
    }
    componentList.push({ name, version, type, missingLicense, supplier: typeof supplier === "string" ? supplier : null });
  }
  const sortedTypes = Array.from(typeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }));
  const sortedLicenses = Array.from(licenseCounts.entries()).sort((a, b) => b[1] - a[1]);
  const sortedEcosystems = Array.from(ecosystemCounts.entries()).sort((a, b) => b[1] - a[1]);
  return {
    totalComponents: components.length,
    uniqueTypes: typeCounts.size,
    uniqueLicenses: licenseCounts.size,
    typeBreakdown: sortedTypes.slice(0, 5),
    licenseGapsByType: Object.fromEntries(missingByType),
    components: componentList,
    topComponents: componentList.slice(0, 8),
    topLicenses: sortedLicenses.slice(0, 5).map(([name, count]) => ({ name, count })),
    baseImage,
    componentsWithoutLicense,
    topEcosystems: sortedEcosystems.slice(0, 5).map(([name, count]) => ({ name, count })),
    generator
  };
};

// Parse the Trivy JSON into a friendly shape that mirrors what security reviewers care about.
const buildTrivySummary = (payload: Record<string, unknown>): TrivySummary => {
  const results = Array.isArray(payload.Results) ? payload.Results : [];
  const severityCounts = new Map<string, number>();
  const findings: TrivyFinding[] = [];
  const targetAggregates = new Map<string, { name: string; highestSeverity: string | null; total: number }>();
  const fixRecommendations = new Map<string, { packageName: string; installedVersion: string; fixedVersion: string; occurrences: number; highestSeverity: string | null }>();
  const metadata = typeof payload.Metadata === "object" && payload.Metadata !== null ? (payload.Metadata as Record<string, unknown>) : null;
  const osInfo = metadata && typeof metadata.OS === "object" && metadata.OS !== null ? (metadata.OS as Record<string, unknown>) : null;
  const osFamily = osInfo && typeof osInfo.Family === "string" ? osInfo.Family : null;
  const osName = osInfo && typeof osInfo.Name === "string" ? osInfo.Name : null;
  const imageID = metadata && typeof metadata.ImageID === "string" ? metadata.ImageID : null;
  const repoDigests = metadata && Array.isArray(metadata.RepoDigests)
    ? (metadata.RepoDigests as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  const scannerVersion = metadata && typeof metadata.Version === "string" ? metadata.Version : null;
  const dbUpdatedAt = metadata && typeof metadata.UpdatedAt === "string" ? metadata.UpdatedAt : null;
  const classCounts = new Map<string, number>();
  let highestSeverity: string | null = null;
  let highestSeverityIndex = severityOrder.length;
  let fixableCount = 0;
  let withoutFixCount = 0;
  let latestPublished: string | null = null;
  let oldestPublished: string | null = null;
  const cvssScores: number[] = [];
  for (const entry of results) {
    if (typeof entry !== "object" || entry === null) continue;
    const result = entry as Record<string, unknown>;
    const target = typeof result.Target === "string" ? result.Target : "unknown";
    const vulns = Array.isArray(result.Vulnerabilities) ? result.Vulnerabilities : [];
    const resultClass = typeof result.Class === "string" ? result.Class : typeof result.Type === "string" ? result.Type : null;
    if (resultClass) {
      const label = resultClass.replace(/_/g, "-").toUpperCase();
      classCounts.set(label, (classCounts.get(label) ?? 0) + vulns.length);
    }
    for (const vulnEntry of vulns) {
      if (typeof vulnEntry !== "object" || vulnEntry === null) continue;
      const vuln = vulnEntry as Record<string, unknown>;
      const severity = typeof vuln.Severity === "string" ? vuln.Severity.toUpperCase() : "UNKNOWN";
      severityCounts.set(severity, (severityCounts.get(severity) ?? 0) + 1);
      const severityIndex = severityOrder.indexOf(severity);
      if (severityIndex !== -1 && severityIndex < highestSeverityIndex) {
        highestSeverityIndex = severityIndex;
        highestSeverity = severity;
      }
      const fixedVersion = typeof vuln.FixedVersion === "string" ? vuln.FixedVersion : "";
      const hasFix = fixedVersion && fixedVersion !== "0" && fixedVersion !== "-" && fixedVersion !== "—" && fixedVersion.toLowerCase() !== "none";
      if (hasFix) {
        fixableCount += 1;
      } else {
        withoutFixCount += 1;
      }
      const published = typeof vuln.PublishedDate === "string" ? vuln.PublishedDate : null;
      if (published) {
        if (!latestPublished) {
          latestPublished = published;
        } else if (new Date(published).getTime() > new Date(latestPublished).getTime()) {
          latestPublished = published;
        }
        if (!oldestPublished) {
          oldestPublished = published;
        } else if (new Date(published).getTime() < new Date(oldestPublished).getTime()) {
          oldestPublished = published;
        }
      }
      let vulnCvssScore: number | null = null;
      const cvssField = typeof vuln.CVSS === "object" && vuln.CVSS !== null ? (vuln.CVSS as Record<string, unknown>) : null;
      if (cvssField) {
        for (const entryPoint of Object.values(cvssField)) {
          if (!entryPoint || typeof entryPoint !== "object") continue;
          const cvss = entryPoint as Record<string, unknown>;
          const score =
            typeof cvss.V31Score === "number"
              ? cvss.V31Score
              : typeof cvss.V3Score === "number"
                ? cvss.V3Score
                : null;
          if (typeof score === "number" && Number.isFinite(score)) {
            cvssScores.push(score);
            vulnCvssScore = vulnCvssScore === null ? score : Math.max(vulnCvssScore, score);
          }
        }
      }
      findings.push({
        id: typeof vuln.VulnerabilityID === "string" ? vuln.VulnerabilityID : "N/A",
        severity,
        title: typeof vuln.Title === "string" ? vuln.Title : "No title provided",
        packageName: typeof vuln.PkgName === "string" ? vuln.PkgName : "unknown",
        installedVersion: typeof vuln.InstalledVersion === "string" ? vuln.InstalledVersion : "unknown",
        fixedVersion: typeof vuln.FixedVersion === "string" && vuln.FixedVersion.length > 0 ? vuln.FixedVersion : "—",
        target,
        publishedDate: published,
        cvssScore: vulnCvssScore
      });
      const targetKey = target.toLowerCase();
      const targetExisting = targetAggregates.get(targetKey);
      if (!targetExisting) {
        targetAggregates.set(targetKey, { name: target, highestSeverity: severity, total: 1 });
      } else {
        targetExisting.total += 1;
        const currentTargetRank = targetExisting.highestSeverity ? severityOrder.indexOf(targetExisting.highestSeverity) : severityOrder.length;
        if (severityIndex !== -1 && (currentTargetRank === -1 || severityIndex < currentTargetRank)) {
          targetExisting.highestSeverity = severity;
        }
      }
      if (fixedVersion && fixedVersion !== "—") {
        const key = typeof vuln.PkgName === "string" ? vuln.PkgName.toLowerCase() : null;
        if (key && hasFix) {
          const existingFix = fixRecommendations.get(key);
          const installed = typeof vuln.InstalledVersion === "string" ? vuln.InstalledVersion : "unknown";
          if (!existingFix) {
            fixRecommendations.set(key, {
              packageName: typeof vuln.PkgName === "string" ? vuln.PkgName : "unknown",
              installedVersion: installed,
              fixedVersion,
              occurrences: 1,
              highestSeverity: severity
            });
          } else {
            existingFix.occurrences += 1;
            const currentFixRank = existingFix.highestSeverity ? severityOrder.indexOf(existingFix.highestSeverity) : severityOrder.length;
            if (severityIndex !== -1 && (currentFixRank === -1 || severityIndex < currentFixRank)) {
              existingFix.highestSeverity = severity;
            }
            if (existingFix.fixedVersion === "—" && fixedVersion !== "—") {
              existingFix.fixedVersion = fixedVersion;
            }
          }
        }
      }
    }
  }
  const sortedSeverity = severityOrder
    .map((severity) => ({ severity, count: severityCounts.get(severity) ?? 0 }))
    .filter((entry) => entry.count > 0);
  const criticalAndHighFindings = findings.filter(
    (finding) => finding.severity === "CRITICAL" || finding.severity === "HIGH"
  );
  const prioritizedFindingsSource = criticalAndHighFindings.length > 0 ? criticalAndHighFindings : findings;
  const prioritizedFindings = [...prioritizedFindingsSource].sort((a, b) => {
    const aRank = severityOrder.indexOf(a.severity);
    const bRank = severityOrder.indexOf(b.severity);
    if (aRank === bRank) return a.id.localeCompare(b.id);
    return aRank - bRank;
  });

  const packageAggregates = new Map<string, { name: string; highestSeverity: string | null; fixableCount: number; total: number }>();
  const rankSeverity = (value: string | null) => (value ? severityOrder.indexOf(value) : severityOrder.length);
  for (const finding of findings) {
    const key = finding.packageName.toLowerCase();
    const current = packageAggregates.get(key);
    const severityRankValue = severityOrder.indexOf(finding.severity);
    if (!current) {
      packageAggregates.set(key, {
        name: finding.packageName,
        highestSeverity: finding.severity,
        fixableCount: finding.fixedVersion && finding.fixedVersion !== "—" ? 1 : 0,
        total: 1
      });
    } else {
      current.total += 1;
      if (finding.fixedVersion && finding.fixedVersion !== "—") current.fixableCount += 1;
      const currentRank = current.highestSeverity ? severityOrder.indexOf(current.highestSeverity) : severityOrder.length;
      if (severityRankValue !== -1 && (currentRank === -1 || severityRankValue < currentRank)) {
        current.highestSeverity = finding.severity;
      }
    }
  }
  const sortedPackages = Array.from(packageAggregates.values()).sort((a, b) => {
    const leftRank = rankSeverity(a.highestSeverity);
    const rightRank = rankSeverity(b.highestSeverity);
    if (leftRank !== rightRank) return leftRank - rightRank;
    return b.total - a.total;
  });
  const sortedTargets = Array.from(targetAggregates.values()).sort((a, b) => {
    const leftRank = rankSeverity(a.highestSeverity);
    const rightRank = rankSeverity(b.highestSeverity);
    if (leftRank !== rightRank) return leftRank - rightRank;
    return b.total - a.total;
  });
  const sortedFixRecommendations = Array.from(fixRecommendations.values()).sort((a, b) => {
    const leftRank = rankSeverity(a.highestSeverity);
    const rightRank = rankSeverity(b.highestSeverity);
    if (leftRank !== rightRank) return leftRank - rightRank;
    return b.occurrences - a.occurrences;
  });
  const maxCvss = cvssScores.length > 0 ? Math.max(...cvssScores) : null;
  const averageCvss =
    cvssScores.length > 0 ? Math.round((cvssScores.reduce((sum, value) => sum + value, 0) / cvssScores.length) * 10) / 10 : null;

  return {
    totalFindings: findings.length,
    severityCounts: sortedSeverity,
    topFindings: prioritizedFindings,
    packageFindings: sortedPackages,
    topTargets: sortedTargets,
    fixRecommendations: sortedFixRecommendations,
    cvssStats: {
      maxScore: maxCvss,
      averageScore: averageCvss,
      scoredFindings: cvssScores.length
    },
    publishWindow: {
      newest: latestPublished,
      oldest: oldestPublished
    },
    platform: {
      osFamily,
      osName,
      imageID,
      repoDigests
    },
    scanner: {
      version: scannerVersion,
      dbUpdatedAt
    },
    highestSeverity,
    fixableCount,
    withoutFixCount,
    classBreakdown: Array.from(classCounts.entries())
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }))
      .slice(0, 5),
    latestPublished
  };
};

const formatJson = (value: unknown): string => JSON.stringify(value, null, 2);

// Parse the Final Assessment JSON into a summary with findings and severity counts.
// Uses the same logic as Trivy for counting findings and determining severity.
const buildFinalAssessmentSummary = (payload: Record<string, unknown>): FinalAssessmentSummary => {
  const severityCounts = new Map<string, number>();
  let highestSeverity: string | null = null;
  let highestSeverityIndex = severityOrder.length;
  const findings: FinalAssessmentFinding[] = [];
  
  // Final Assessment JSON structure: { "Vulnerabilities": [...], ... }
  // Check for Vulnerabilities array (capital V)
  const vulnerabilities = Array.isArray(payload.Vulnerabilities) ? payload.Vulnerabilities : [];
  
  // Process each vulnerability
  for (const vulnEntry of vulnerabilities) {
    if (typeof vulnEntry !== "object" || vulnEntry === null) continue;
    const vuln = vulnEntry as Record<string, unknown>;
    
    // Extract RiskLevel (Final Assessment uses "RiskLevel" field)
    let severity: string = "UNKNOWN";
    if (typeof vuln.RiskLevel === "string") {
      // RiskLevel values are like "Critical", "High", "Unknown" (title case)
      // Normalize to uppercase to match severityOrder
      const riskLevel = vuln.RiskLevel.toUpperCase();
      
      // Map to severityOrder values
      if (riskLevel === "CRITICAL") {
        severity = "CRITICAL";
      } else if (riskLevel === "HIGH") {
        severity = "HIGH";
      } else if (riskLevel === "MEDIUM") {
        severity = "MEDIUM";
      } else if (riskLevel === "LOW") {
        severity = "LOW";
      } else {
        severity = "UNKNOWN";
      }
    }
    
    // Count by severity
    severityCounts.set(severity, (severityCounts.get(severity) ?? 0) + 1);
    
    // Track highest severity
    const severityIndex = severityOrder.indexOf(severity);
    if (severityIndex !== -1 && severityIndex < highestSeverityIndex) {
      highestSeverityIndex = severityIndex;
      highestSeverity = severity;
    }
    
    // Extract source from Prompt field
    let source: string | null = null;
    const prompt = typeof vuln.Prompt === "string" ? vuln.Prompt : "";
    if (prompt) {
      // Check for source names in the prompt (case-insensitive)
      const promptUpper = prompt.toUpperCase();
      if (promptUpper.includes("TRIVY")) {
        source = "Trivy";
      } else if (promptUpper.includes("SONARQUBE")) {
        source = "SonarQube";
      } else if (promptUpper.includes("CODEQL")) {
        source = "CodeQL";
      }
    }
    
    // Extract finding data for top findings
    const finding: FinalAssessmentFinding = {
      finding: typeof vuln.Finding === "string" ? vuln.Finding : "",
      riskLevel: severity,
      determination: typeof vuln.Determination === "string" ? vuln.Determination : "",
      source: source,
      lineNumber: typeof vuln.LineNumber === "number" ? vuln.LineNumber : undefined,
      filePath: typeof vuln.FilePath === "string" ? vuln.FilePath : undefined,
      prompt: prompt
    };
    findings.push(finding);
  }
  
  // Sort findings by severity (same logic as Trivy)
  const rankSeverity = (value: string) => {
    const idx = severityOrder.indexOf(value);
    return idx === -1 ? severityOrder.length : idx;
  };
  
  const prioritizedFindings = findings
    .sort((a, b) => {
      const aRank = rankSeverity(a.riskLevel);
      const bRank = rankSeverity(b.riskLevel);
      if (aRank !== bRank) return aRank - bRank;
      // If same severity, maintain original order
      return 0;
    })
    .slice(0, 20); // Limit to top 20 findings
  
  // Sort severity counts by severity order
  const sortedSeverity = severityOrder
    .filter((severity) => severityCounts.has(severity))
    .map((severity) => ({
      severity,
      count: severityCounts.get(severity) ?? 0
    }));
  
  return {
    totalFindings: vulnerabilities.length,
    severityCounts: sortedSeverity,
    highestSeverity,
    topFindings: prioritizedFindings
  };
};

// Parse the CodeQL SARIF JSON into a summary with findings and severity counts.
// SARIF structure: { "runs": [{ "results": [...], "tool": { "extensions": [{ "rules": [...] }] } }] }
const buildCodeqlSummary = (payload: Record<string, unknown>): CodeqlSummary => {
  const severityCounts = new Map<string, number>();
  let highestSeverity: string | null = null;
  let highestSeverityIndex = codeqlSeverityOrder.length;
  const findings: CodeqlFinding[] = [];
  const ruleCounts = new Map<string, { count: number; highestSeverity: string | null }>();
  const fileCounts = new Map<string, { count: number; highestSeverity: string | null }>();
  const securitySeverityScores: number[] = [];
  
  // Extract runs array
  const runs = Array.isArray(payload.runs) ? payload.runs : [];
  if (runs.length === 0) {
    return {
      totalFindings: 0,
      severityCounts: [],
      highestSeverity: null,
      topFindings: [],
      ruleBreakdown: [],
      fileBreakdown: [],
      securitySeverityStats: { maxScore: null, averageScore: null, scoredFindings: 0 }
    };
  }
  
  const run = runs[0] as Record<string, unknown>;
  
  // Build rule lookup map by matching result.ruleId to rule.id
  // Rules can be in tool.driver.rules or tool.extensions[].rules
  const ruleLookup = new Map<string, {
    name: string | null;
    helpText: string | null;
    helpMarkdown: string | null;
    securitySeverity: number | null;
    problemSeverity: string | null;
  }>();
  
  const tool = typeof run.tool === "object" && run.tool !== null ? (run.tool as Record<string, unknown>) : null;
  if (!tool) {
    return {
      totalFindings: 0,
      severityCounts: [],
      highestSeverity: null,
      topFindings: [],
      ruleBreakdown: [],
      fileBreakdown: [],
      securitySeverityStats: { maxScore: null, averageScore: null, scoredFindings: 0 }
    };
  }
  
  // Helper function to process a rules array
  const processRulesArray = (rules: unknown[]) => {
    for (const ruleEntry of rules) {
      if (typeof ruleEntry !== "object" || ruleEntry === null) continue;
      const rule = ruleEntry as Record<string, unknown>;
      const ruleId = typeof rule.id === "string" ? rule.id : null;
      if (!ruleId) continue;
      
      // Skip if we already have this rule (extensions take precedence)
      if (ruleLookup.has(ruleId)) continue;
      
      const properties = typeof rule.properties === "object" && rule.properties !== null
        ? (rule.properties as Record<string, unknown>)
        : null;
      
      // Extract security-severity from properties["security-severity"]
      // It can be a number or a string (SARIF allows both)
      let securitySeverity: number | null = null;
      if (properties && properties["security-severity"] !== undefined && properties["security-severity"] !== null) {
        const severityValue = properties["security-severity"];
        if (typeof severityValue === "number") {
          securitySeverity = severityValue;
        } else if (typeof severityValue === "string") {
          const parsed = parseFloat(severityValue);
          if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
            securitySeverity = parsed;
          }
        }
      }
      
      const problemSeverity = properties && typeof properties["problem.severity"] === "string"
        ? properties["problem.severity"]
        : null;
      
      const help = typeof rule.help === "object" && rule.help !== null
        ? (rule.help as Record<string, unknown>)
        : null;
      
      const helpText = help && typeof help.text === "string" ? help.text : null;
      const helpMarkdown = help && typeof help.markdown === "string" ? help.markdown : null;
      
      const name = typeof rule.name === "string" ? rule.name : null;
      
      ruleLookup.set(ruleId, {
        name,
        helpText,
        helpMarkdown,
        securitySeverity,
        problemSeverity
      });
    }
  };
  
  // Check tool.driver.rules first
  const driver = typeof tool.driver === "object" && tool.driver !== null ? (tool.driver as Record<string, unknown>) : null;
  if (driver) {
    const driverRules = Array.isArray(driver.rules) ? driver.rules : [];
    processRulesArray(driverRules);
  }
  
  // Check tool.extensions[].rules (these take precedence if same rule ID exists)
  const extensions = Array.isArray(tool.extensions) ? tool.extensions : [];
  for (const ext of extensions) {
    if (typeof ext !== "object" || ext === null) continue;
    const extension = ext as Record<string, unknown>;
    const rules = Array.isArray(extension.rules) ? extension.rules : [];
    processRulesArray(rules);
  }
  
  // Process results
  const results = Array.isArray(run.results) ? run.results : [];
  
  for (const resultEntry of results) {
    if (typeof resultEntry !== "object" || resultEntry === null) continue;
    const result = resultEntry as Record<string, unknown>;
    
    const ruleId = typeof result.ruleId === "string" ? result.ruleId : "unknown";
    const messageObj = typeof result.message === "object" && result.message !== null
      ? (result.message as Record<string, unknown>)
      : null;
    const message = messageObj && typeof messageObj.text === "string" ? messageObj.text : "";
    
    // Extract location (file path and line number)
    const locations = Array.isArray(result.locations) ? result.locations : [];
    let filePath = "";
    let lineNumber = 0;
    
    if (locations.length > 0) {
      const location = locations[0] as Record<string, unknown>;
      const physicalLocation = location && typeof location.physicalLocation === "object" && location.physicalLocation !== null
        ? (location.physicalLocation as Record<string, unknown>)
        : null;
      
      if (physicalLocation) {
        const artifactLocation = physicalLocation.artifactLocation && typeof physicalLocation.artifactLocation === "object" && physicalLocation.artifactLocation !== null
          ? (physicalLocation.artifactLocation as Record<string, unknown>)
          : null;
        
        if (artifactLocation && typeof artifactLocation.uri === "string") {
          filePath = artifactLocation.uri;
        }
        
        const region = physicalLocation.region && typeof physicalLocation.region === "object" && physicalLocation.region !== null
          ? (physicalLocation.region as Record<string, unknown>)
          : null;
        
        if (region && typeof region.startLine === "number") {
          lineNumber = region.startLine;
        }
      }
    }
    
    // Get rule metadata
    const ruleMeta = ruleLookup.get(ruleId);
    const securitySeverity = ruleMeta?.securitySeverity ?? null;
    
    // Use SARIF level directly: "error", "warning", "note"
    const level = result.level && typeof result.level === "string" ? result.level : ruleMeta?.problemSeverity ?? null;
    const severity: string = level && (level === "error" || level === "warning" || level === "note") ? level : "note";
    
    // Count by severity
    severityCounts.set(severity, (severityCounts.get(severity) ?? 0) + 1);
    
    // Track highest severity using CodeQL severity order
    const severityIndex = codeqlSeverityOrder.indexOf(severity);
    if (severityIndex !== -1 && severityIndex < highestSeverityIndex) {
      highestSeverityIndex = severityIndex;
      highestSeverity = severity;
    }
    
    // Track security severity scores
    if (securitySeverity !== null && Number.isFinite(securitySeverity)) {
      securitySeverityScores.push(securitySeverity);
    }
    
    // Track rule breakdown
    const ruleKey = ruleId.toLowerCase();
    const ruleExisting = ruleCounts.get(ruleKey);
    if (!ruleExisting) {
      ruleCounts.set(ruleKey, { count: 1, highestSeverity: severity });
    } else {
      ruleExisting.count += 1;
      const currentRank = ruleExisting.highestSeverity ? codeqlSeverityOrder.indexOf(ruleExisting.highestSeverity) : codeqlSeverityOrder.length;
      if (severityIndex !== -1 && (currentRank === -1 || severityIndex < currentRank)) {
        ruleExisting.highestSeverity = severity;
      }
    }
    
    // Track file breakdown
    if (filePath) {
      const fileKey = filePath.toLowerCase();
      const fileExisting = fileCounts.get(fileKey);
      if (!fileExisting) {
        fileCounts.set(fileKey, { count: 1, highestSeverity: severity });
      } else {
        fileExisting.count += 1;
        const currentRank = fileExisting.highestSeverity ? codeqlSeverityOrder.indexOf(fileExisting.highestSeverity) : codeqlSeverityOrder.length;
        if (severityIndex !== -1 && (currentRank === -1 || severityIndex < currentRank)) {
          fileExisting.highestSeverity = severity;
        }
      }
    }
    
    findings.push({
      ruleId,
      message,
      filePath,
      lineNumber,
      severity,
      securitySeverity,
      ruleName: ruleMeta?.name ?? null,
      helpText: ruleMeta?.helpText ?? null,
      helpMarkdown: ruleMeta?.helpMarkdown ?? null
    });
  }
  
  // Sort findings by severity using CodeQL severity order
  const rankCodeqlSeverity = (value: string) => {
    const idx = codeqlSeverityOrder.indexOf(value);
    return idx === -1 ? codeqlSeverityOrder.length : idx;
  };
  
  const prioritizedFindings = findings
    .sort((a, b) => {
      const aRank = rankCodeqlSeverity(a.severity);
      const bRank = rankCodeqlSeverity(b.severity);
      if (aRank !== bRank) return aRank - bRank;
      // If same severity, sort by security severity (higher first)
      const aScore = a.securitySeverity ?? 0;
      const bScore = b.securitySeverity ?? 0;
      if (bScore !== aScore) return bScore - aScore;
      // Then by rule ID
      return a.ruleId.localeCompare(b.ruleId);
    })
    .slice(0, 20); // Limit to top 20 findings
  
  // Sort severity counts by CodeQL severity order
  const sortedSeverity = codeqlSeverityOrder
    .filter((severity) => severityCounts.has(severity))
    .map((severity) => ({
      severity,
      count: severityCounts.get(severity) ?? 0
    }));
  
  // Sort rule breakdown
  // Show all rules (no limit) so all severity levels are visible
  const sortedRules = Array.from(ruleCounts.entries())
    .map(([ruleId, data]) => ({ ruleId, ...data }))
    .sort((a, b) => {
      const aRank = rankCodeqlSeverity(a.highestSeverity ?? "note");
      const bRank = rankCodeqlSeverity(b.highestSeverity ?? "note");
      if (aRank !== bRank) return aRank - bRank;
      return b.count - a.count;
    });
  
  // Sort file breakdown
  const sortedFiles = Array.from(fileCounts.entries())
    .map(([filePath, data]) => ({ filePath, ...data }))
    .sort((a, b) => {
      const aRank = rankCodeqlSeverity(a.highestSeverity ?? "note");
      const bRank = rankCodeqlSeverity(b.highestSeverity ?? "note");
      if (aRank !== bRank) return aRank - bRank;
      return b.count - a.count;
    })
    .slice(0, 10);
  
  // Calculate security severity stats
  const maxScore = securitySeverityScores.length > 0 ? Math.max(...securitySeverityScores) : null;
  const averageScore =
    securitySeverityScores.length > 0
      ? Math.round((securitySeverityScores.reduce((sum, value) => sum + value, 0) / securitySeverityScores.length) * 10) / 10
      : null;
  
  return {
    totalFindings: findings.length,
    severityCounts: sortedSeverity,
    highestSeverity,
    topFindings: prioritizedFindings,
    ruleBreakdown: sortedRules,
    fileBreakdown: sortedFiles,
    securitySeverityStats: {
      maxScore,
      averageScore,
      scoredFindings: securitySeverityScores.length
    }
  };
};

const SeverityBadge = ({ severity, count }: { severity: string; count?: number }) => {
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

const TypeBadge = ({ label, count }: { label: string; count: number }) => (
  <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
    <span className="uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
    <span>{count}</span>
  </span>
);

const SbomSummaryView = ({ summary, trivy }: { summary: SbomSummary; trivy?: TrivySummary | null }) => {
  type LensMode = "inventory" | "license" | "base" | "vuln" | "supplier";
  const [typeLens, setTypeLens] = useState<LensMode>("inventory");
  const lensLabels: Record<LensMode, string> = {
    inventory: "Inventory (count)",
    license: "License gaps",
    vuln: "Vulnerability risk",
    supplier: "Supplier trust",
    base: "Base/OS first"
  };
  const focusLensIds = new Set<LensMode>(["license", "vuln", "supplier"]);
  const focusLensOptions = [
    { id: "license" as const, label: lensLabels.license },
    { id: "vuln" as const, label: lensLabels.vuln },
    { id: "supplier" as const, label: lensLabels.supplier }
  ];
  const typeOnlyLensOptions = [
    { id: "inventory" as const, label: lensLabels.inventory },
    { id: "base" as const, label: lensLabels.base }
  ];
  const highlightLens: LensMode = focusLensIds.has(typeLens) ? typeLens : "inventory";
  const renderLensButton = (option: { id: LensMode; label: string }) => {
    const selected = option.id === typeLens;
    return (
      <button
        key={option.id}
        type="button"
        onClick={() => setTypeLens(option.id)}
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition ${
          selected
            ? "border-slate-900 bg-slate-900 text-white shadow-sm dark:border-white dark:bg-white dark:text-slate-900"
            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white"
        }`}
      >
        {option.label}
      </button>
    );
  };
  const typeCountLookup = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of summary.typeBreakdown) {
      map.set(entry.label.toLowerCase(), entry.count);
    }
    return map;
  }, [summary.typeBreakdown]);

  const licenseGapLookup = useMemo(() => {
    const map = new Map<string, number>();
    Object.entries(summary.licenseGapsByType ?? {}).forEach(([key, value]) => map.set(key.toLowerCase(), value));
    return map;
  }, [summary.licenseGapsByType]);

  const trivyPackageLookup = useMemo(() => {
    const map = new Map<string, { highestSeverity: string | null; fixableCount: number; total: number }>();
    if (trivy?.packageFindings) {
      for (const pkg of trivy.packageFindings) {
        map.set(pkg.name.toLowerCase(), {
          highestSeverity: pkg.highestSeverity,
          fixableCount: pkg.fixableCount,
          total: pkg.total
        });
      }
    }
    return map;
  }, [trivy?.packageFindings]);

  const typeBreakdown = useMemo(() => {
    const items = [...summary.typeBreakdown];
    if (typeLens === "license") {
      return items.sort((a, b) => {
        const aMissing = licenseGapLookup.get(a.label.toLowerCase()) ?? 0;
        const bMissing = licenseGapLookup.get(b.label.toLowerCase()) ?? 0;
        if (bMissing !== aMissing) return bMissing - aMissing;
        return b.count - a.count;
      });
    }
    if (typeLens === "base") {
      return items.sort((a, b) => {
        const aIsOs = a.label.toLowerCase() === "operating-system";
        const bIsOs = b.label.toLowerCase() === "operating-system";
        if (aIsOs && !bIsOs) return -1;
        if (bIsOs && !aIsOs) return 1;
        return b.count - a.count;
      });
    }
    return items;
  }, [licenseGapLookup, summary.typeBreakdown, typeLens]);

  const highlightedComponents = useMemo(() => {
    const list = summary.components?.length ? [...summary.components] : [...summary.topComponents];
    if (list.length === 0) return [];
    const aggregated = new Map<
      string,
      { name: string; version: string; type: string; missingLicense: boolean; count: number; supplier?: string | null }
    >();
    for (const item of list) {
      const key = `${item.name}@@${item.version}@@${item.type}`.toLowerCase();
      const existing = aggregated.get(key);
      if (existing) {
        existing.count += 1;
        existing.missingLicense = existing.missingLicense || item.missingLicense;
      } else {
        aggregated.set(key, { ...item, count: 1 });
      }
    }
    const aggregateList = Array.from(aggregated.values());
    if (highlightLens === "license") {
      return aggregateList
        .sort((a, b) => {
          if (a.missingLicense && !b.missingLicense) return -1;
          if (b.missingLicense && !a.missingLicense) return 1;
          const aMissing = licenseGapLookup.get(a.type.toLowerCase()) ?? 0;
          const bMissing = licenseGapLookup.get(b.type.toLowerCase()) ?? 0;
          if (bMissing !== aMissing) return bMissing - aMissing;
          if (b.count !== a.count) return b.count - a.count;
          return a.name.localeCompare(b.name) || a.version.localeCompare(b.version);
        })
        .slice(0, 8);
    }
    if (highlightLens === "vuln") {
      const severityRank = (severity: string | null) => {
        const idx = severity ? severityOrder.indexOf(severity) : -1;
        return idx === -1 ? severityOrder.length : idx;
      };
      return aggregateList
        .sort((a, b) => {
          const aPkg = trivyPackageLookup.get(a.name.toLowerCase());
          const bPkg = trivyPackageLookup.get(b.name.toLowerCase());
          const aRank = severityRank(aPkg?.highestSeverity ?? null);
          const bRank = severityRank(bPkg?.highestSeverity ?? null);
          if (aRank !== bRank) return aRank - bRank;
          const aFix = aPkg?.fixableCount ?? 0;
          const bFix = bPkg?.fixableCount ?? 0;
          if (bFix !== aFix) return bFix - aFix;
          const aTotal = aPkg?.total ?? 0;
          const bTotal = bPkg?.total ?? 0;
          if (bTotal !== aTotal) return bTotal - aTotal;
          return a.name.localeCompare(b.name) || a.version.localeCompare(b.version);
        })
        .slice(0, 8);
    }
    if (highlightLens === "supplier") {
      return aggregateList
        .sort((a, b) => {
          const aMissing = !a.supplier || `${a.supplier}`.trim().length === 0;
          const bMissing = !b.supplier || `${b.supplier}`.trim().length === 0;
          if (aMissing && !bMissing) return -1;
          if (bMissing && !aMissing) return 1;
          const aCount = typeCountLookup.get(a.type.toLowerCase()) ?? 0;
          const bCount = typeCountLookup.get(b.type.toLowerCase()) ?? 0;
          if (bCount !== aCount) return bCount - aCount;
          return a.name.localeCompare(b.name) || a.version.localeCompare(b.version);
        })
        .slice(0, 8);
    }
    if (typeLens === "base") {
      return aggregateList
        .sort((a, b) => {
          const aIsOs = a.type.toLowerCase() === "operating-system";
          const bIsOs = b.type.toLowerCase() === "operating-system";
          if (aIsOs && !bIsOs) return -1;
          if (bIsOs && !aIsOs) return 1;
          const aCount = typeCountLookup.get(a.type.toLowerCase()) ?? 0;
          const bCount = typeCountLookup.get(b.type.toLowerCase()) ?? 0;
          if (bCount !== aCount) return bCount - aCount;
          return a.name.localeCompare(b.name);
        })
        .slice(0, 8);
    }
    // Default: inventory prevalence (type frequency), then name
    return aggregateList
      .sort((a, b) => {
        const aCount = typeCountLookup.get(a.type.toLowerCase()) ?? 0;
        const bCount = typeCountLookup.get(b.type.toLowerCase()) ?? 0;
        if (bCount !== aCount) return bCount - aCount;
        if (b.count !== a.count) return b.count - a.count;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 8);
  }, [highlightLens, licenseGapLookup, summary.components, summary.topComponents, typeCountLookup, typeLens]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Component inventory, base image details, and license coverage derived from the uploaded SBOM.
        </p>
        <InfoPopover title="SBOM insights" description={infoHelp.sbom.description} items={infoHelp.sbom.items} />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-5 dark:border-blue-500/30 dark:bg-blue-500/10">
          <p className="text-sm text-blue-700 dark:text-blue-200">Total components</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{summary.totalComponents}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <p className="text-sm text-emerald-700 dark:text-emerald-200">Unique component types</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{summary.uniqueTypes}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-sm text-amber-700 dark:text-amber-200">Referenced licenses</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{summary.uniqueLicenses}</p>
        </div>
      </div>
      {summary.generator && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
          <span className="font-semibold text-slate-700 dark:text-slate-200">Generated by:</span> {summary.generator}
        </div>
      )}
      <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Component types</h4>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Type lenses</span>
              <div className="flex flex-wrap gap-2">
                {typeOnlyLensOptions.map((option) => renderLensButton(option))}
              </div>
              {focusLensIds.has(typeLens) && (
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
                  Focus lens: {lensLabels[typeLens]} (affects both sections)
                </span>
              )}
            </div>
          </div>
          {!focusLensIds.has(typeLens) && (
            <p className="text-xs text-slate-500 dark:text-slate-400">Need deeper context? Use the focus lenses next to the highlighted table to reshape both views.</p>
          )}
        <div className="flex flex-wrap gap-2">
          {typeBreakdown.length === 0 ? (
            <span className="text-sm text-slate-500 dark:text-slate-400">No component type data available.</span>
          ) : (
            typeBreakdown.map((item) => <TypeBadge key={item.label} label={item.label} count={item.count} />)
          )}
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Highlighted components</h4>
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Focus lenses (types + highlighted table)</span>
            <div className="flex flex-wrap gap-2">
              {focusLensOptions.map((option) => renderLensButton(option))}
            </div>
          </div>
        </div>
        {highlightedComponents.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No component details recorded.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
              <thead className="bg-slate-100 dark:bg-slate-900/70">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Version</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-900 dark:bg-slate-950/40">
                {highlightedComponents.map((component, index) => (
                  <tr key={`${component.name}-${component.version}-${index}`} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                    <td className="px-4 py-3 text-sm text-slate-900 dark:text-slate-100">{component.name}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{component.version}</td>
                    <td className="px-4 py-3 text-sm uppercase text-slate-500 dark:text-slate-400">{component.type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-700 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
        <h4 className="text-sm font-semibold uppercase tracking-wide">Compliance alert</h4>
        <p className="mt-2">
          {summary.componentsWithoutLicense} components report no license metadata in the SBOM. Treat these as unknown obligations until they are manually reviewed.
          {summary.totalComponents > 0 && (
            <span> ({Math.round((summary.componentsWithoutLicense / summary.totalComponents) * 100)}% of listed components)</span>
          )}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Top licenses</h4>
          {summary.topLicenses.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No license data recorded.</p>
          ) : (
            <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
              {summary.topLicenses.map((item) => (
                <li key={item.name} className="flex items-center justify-between">
                  <span className="font-medium text-slate-900 dark:text-slate-100">{item.name}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{item.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-3">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Package ecosystems</h4>
          {summary.topEcosystems.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No package ecosystem data detected.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {summary.topEcosystems.map((item) => (
                <span key={item.name} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
                  <span className="uppercase tracking-wide text-slate-500 dark:text-slate-400">{item.name}</span>
                  <span>{item.count}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const TrivySummaryView = ({
  summary,
  policy
}: {
  summary: TrivySummary;
  policy?: {
    scanSeverities: string | null;
    failSeverities: string | null;
    ignoreUnfixed: boolean | null;
    scannerVersion: string | null;
    scannerDbUpdatedAt: string | null;
  } | null;
}) => {
  const hasNoFindings = summary.totalFindings === 0;
  const borderColor = hasNoFindings
    ? "border-emerald-300 dark:border-emerald-500/40"
    : "border-rose-300 dark:border-rose-500/40";
  const backgroundColor = hasNoFindings
    ? "bg-emerald-50 dark:bg-emerald-500/10"
    : "bg-rose-50 dark:bg-rose-500/10";
  const labelColor = hasNoFindings
    ? "text-emerald-700 dark:text-emerald-200"
    : "text-rose-700 dark:text-rose-200";
  const valueColor = hasNoFindings
    ? "text-emerald-900 dark:text-white"
    : "text-rose-900 dark:text-white";
  const formatDateTime = (value: string | null) => (value ? new Date(value).toLocaleString() : "—");
  const fixablePercentage = summary.totalFindings > 0 ? Math.round((summary.fixableCount / summary.totalFindings) * 100) : 0;
  const ignoreUnfixedLabel = policy
    ? policy.ignoreUnfixed === null
      ? "—"
      : policy.ignoreUnfixed
        ? "Yes"
        : "No"
    : "—";
  const scannerVersion = summary.scanner.version ?? policy?.scannerVersion ?? null;
  const scannerDbUpdatedAt = summary.scanner.dbUpdatedAt ?? policy?.scannerDbUpdatedAt ?? null;
  const formatAge = (value: string | null) => {
    if (!value) return "—";
    const timestamp = new Date(value).getTime();
    if (Number.isNaN(timestamp)) return "—";
    const days = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
    if (days <= 0) return "Today";
    if (days === 1) return "1 day ago";
    if (days < 60) return `${days} days ago`;
    const months = Math.floor(days / 30);
    return months === 1 ? "1 month ago" : `${months} months ago`;
  };
  const formatCvss = (value: number | null) => (value === null ? "Not provided" : value.toFixed(1));
  const topPackages = summary.packageFindings.slice(0, 3);
  const topTargets = summary.topTargets.slice(0, 3);
  const fixPaths = summary.fixRecommendations.slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Vulnerability assessment from trivy-report.json with severity posture, fix availability, and scan policy context.
        </p>
        <InfoPopover title="Trivy scan insights" description={infoHelp.trivyOverview.description} items={infoHelp.trivyOverview.items} />
      </div>
      <div className={`rounded-xl border px-4 py-5 ${borderColor} ${backgroundColor}`}>
        <p className={`text-sm ${labelColor}`}>Total findings</p>
        <p className={`mt-2 text-3xl font-semibold ${valueColor}`}>{summary.totalFindings}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {summary.severityCounts.length === 0 ? (
          <span className="text-sm text-slate-500 dark:text-slate-400">No vulnerabilities detected.</span>
        ) : (
          summary.severityCounts.map((item) => <SeverityBadge key={item.severity} severity={item.severity} count={item.count} />)
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition dark:border-slate-800 dark:bg-slate-900/60">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Severity posture</h4>
          <dl className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
            <div className="flex items-center justify-between">
              <dt>Highest severity</dt>
              <dd className="text-slate-900 dark:text-slate-100">{summary.highestSeverity ?? "None detected"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>Fixable findings</dt>
              <dd>{summary.fixableCount} / {summary.totalFindings} ({fixablePercentage}%)</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>No fix available</dt>
              <dd>{summary.withoutFixCount}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>Latest published CVE</dt>
              <dd className="text-xs text-slate-500 dark:text-slate-400">{formatDateTime(summary.latestPublished)}</dd>
            </div>
          </dl>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition dark:border-slate-800 dark:bg-slate-900/60">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Package classes</h4>
          {summary.classBreakdown.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">No vulnerable package classes detected.</p>
          ) : (
            <ul className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
              {summary.classBreakdown.map((item) => (
                <li key={item.name} className="flex items-center justify-between">
                  <span className="font-medium text-slate-900 dark:text-slate-100">{item.name}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{item.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition dark:border-slate-800 dark:bg-slate-900/60">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Exploitability signals</h4>
          <dl className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
            <div className="flex items-center justify-between">
              <dt>Highest CVSS (any source)</dt>
              <dd className="text-right text-slate-900 dark:text-slate-100">{formatCvss(summary.cvssStats.maxScore)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>Average CVSS</dt>
              <dd className="text-right text-slate-900 dark:text-slate-100">
                {formatCvss(summary.cvssStats.averageScore)}
                <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">({summary.cvssStats.scoredFindings} scored)</span>
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>Highest severity</dt>
              <dd className="text-right">
                <SeverityBadge severity={summary.highestSeverity ?? "UNKNOWN"} />
              </dd>
            </div>
          </dl>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition dark:border-slate-800 dark:bg-slate-900/60">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Aging & freshness</h4>
          <dl className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
            <div className="flex items-center justify-between">
              <dt>Newest disclosure</dt>
              <dd className="text-right">
                <div className="text-slate-900 dark:text-slate-100">{formatDateTime(summary.publishWindow.newest)}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{formatAge(summary.publishWindow.newest)}</div>
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>Oldest disclosure</dt>
              <dd className="text-right">
                <div className="text-slate-900 dark:text-slate-100">{formatDateTime(summary.publishWindow.oldest)}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{formatAge(summary.publishWindow.oldest)}</div>
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>Age spread</dt>
              <dd className="text-right text-slate-900 dark:text-slate-100">
                {summary.publishWindow.newest && summary.publishWindow.oldest
                  ? `${formatAge(summary.publishWindow.oldest)} → ${formatAge(summary.publishWindow.newest)}`
                  : "—"}
              </dd>
            </div>
          </dl>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition dark:border-slate-800 dark:bg-slate-900/60">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Blast radius</h4>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Counts show findings affecting that package or target (overlaps; all severities).
          </p>
          {topPackages.length === 0 && topTargets.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">No package or target concentration detected.</p>
          ) : (
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Packages</p>
                {topPackages.map((pkg) => (
                  <div key={pkg.name} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <span
                        title={pkg.name}
                        className="block min-w-0 break-words text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100"
                      >
                        {pkg.name}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
                        {pkg.total} affecting
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                      <span>Highest severity</span>
                      <SeverityBadge severity={pkg.highestSeverity ?? "UNKNOWN"} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Targets</p>
                {topTargets.map((target) => (
                  <div key={target.name} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <span
                        title={target.name}
                        className="block min-w-0 break-words text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100"
                      >
                        {target.name}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
                        {target.total} affecting
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                      <span>Highest severity</span>
                      <SeverityBadge severity={target.highestSeverity ?? "UNKNOWN"} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition dark:border-slate-800 dark:bg-slate-900/60">
        <div className="flex items-start justify-between gap-3">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Fix path</h4>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {summary.fixRecommendations.length} package{summary.fixRecommendations.length === 1 ? "" : "s"} with a published fix
          </span>
        </div>
        {fixPaths.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">No fixes surfaced in this scan.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {fixPaths.map((fix) => (
              <li key={`${fix.packageName}-${fix.fixedVersion}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/40">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{fix.packageName}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Installed {fix.installedVersion}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Upgrade to</p>
                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-200">{fix.fixedVersion}</p>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                  <span>{fix.occurrences} finding{fix.occurrences === 1 ? "" : "s"} affected</span>
                  <div className="flex items-center gap-2">
                    <span>Highest severity</span>
                    <SeverityBadge severity={fix.highestSeverity ?? "UNKNOWN"} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-3">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Top findings</h4>
        {summary.topFindings.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No vulnerabilities reported in the selected severities.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
            <div className="max-h-96 overflow-y-auto">
              <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                <thead className="bg-slate-100 dark:bg-slate-900/70">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Severity</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Vulnerability</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Package</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Fixed version</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Target</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-900 dark:bg-slate-950/40">
                  {summary.topFindings.map((finding) => (
                    <tr key={`${finding.id}-${finding.packageName}`} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                      <td className="px-4 py-3 text-sm font-semibold uppercase text-slate-900 dark:text-slate-100">
                        <SeverityBadge severity={finding.severity} />
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-900 dark:text-slate-100">
                        <p className="font-medium">{finding.id}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{finding.title}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                        <p className="font-medium text-slate-900 dark:text-slate-100">{finding.packageName}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-500">Installed: {finding.installedVersion}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">{finding.fixedVersion}</td>
                      <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">{finding.target}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition dark:border-slate-800 dark:bg-slate-900/60">
          <div className="flex items-start justify-between gap-3">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Scanner metadata</h4>
            <InfoPopover title="Scanner metadata" description={infoHelp.trivyScanner.description} items={infoHelp.trivyScanner.items} align="left" />
          </div>
          <dl className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
            <div className="flex items-center justify-between">
              <dt>Trivy version</dt>
              <dd className="text-slate-900 dark:text-slate-100">{scannerVersion ?? "—"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>DB updated</dt>
              <dd className="text-xs text-slate-500 dark:text-slate-400">{formatDateTime(scannerDbUpdatedAt)}</dd>
            </div>
            <div className="flex items-start justify-between">
              <dt>Repo digest</dt>
              <dd className="text-xs text-slate-500 break-all dark:text-slate-400 md:max-w-xs">
                {summary.platform.repoDigests.length > 0 ? summary.platform.repoDigests[0] : "—"}
              </dd>
            </div>
          </dl>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition dark:border-slate-800 dark:bg-slate-900/60">
          <div className="flex items-start justify-between gap-3">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Policy context</h4>
            <InfoPopover title="Policy context" description={infoHelp.trivyPolicy.description} items={infoHelp.trivyPolicy.items} align="left" />
          </div>
          <dl className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
            <div className="flex items-center justify-between">
              <dt>Scan severities</dt>
              <dd className="text-right text-slate-900 dark:text-slate-100">{policy?.scanSeverities ?? "—"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>Fail-on severities</dt>
              <dd className="text-right text-slate-900 dark:text-slate-100">{policy?.failSeverities ?? "—"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>Ignore unfixed</dt>
              <dd>{ignoreUnfixedLabel}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
};

const CodeqlSummaryView = ({
  summary,
  onViewDetails
}: {
  summary: CodeqlSummary;
  onViewDetails: (title: string, content: string, mimeType: string, downloadExtension: string) => void;
}) => {
  const hasNoFindings = summary.totalFindings === 0;
  const borderColor = hasNoFindings
    ? "border-emerald-300 dark:border-emerald-500/40"
    : "border-rose-300 dark:border-rose-500/40";
  const backgroundColor = hasNoFindings
    ? "bg-emerald-50 dark:bg-emerald-500/10"
    : "bg-rose-50 dark:bg-rose-500/10";
  const labelColor = hasNoFindings
    ? "text-emerald-700 dark:text-emerald-200"
    : "text-rose-700 dark:text-rose-200";
  const valueColor = hasNoFindings
    ? "text-emerald-900 dark:text-white"
    : "text-rose-900 dark:text-white";
  const formatSecuritySeverity = (value: number | null) => (value === null ? "Not provided" : value.toFixed(1));
  // Show all rules and files (no limit) so all severity levels are visible
  const topRules = summary.ruleBreakdown;
  const topFiles = summary.fileBreakdown;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Static analysis findings from CodeQL with rule-based detection, security severity scores, and code locations.
        </p>
      </div>
      <div className={`rounded-xl border px-4 py-5 ${borderColor} ${backgroundColor}`}>
        <p className={`text-sm ${labelColor}`}>Total findings</p>
        <p className={`mt-2 text-3xl font-semibold ${valueColor}`}>{summary.totalFindings}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {summary.severityCounts.length === 0 ? (
          <span className="text-sm text-slate-500 dark:text-slate-400">No findings detected.</span>
        ) : (
          summary.severityCounts.map((item) => <SeverityBadge key={item.severity} severity={item.severity} count={item.count} />)
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition dark:border-slate-800 dark:bg-slate-900/60">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Exploitability signals</h4>
          <dl className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
            <div className="flex items-center justify-between">
              <dt>Highest CVSS (any source)</dt>
              <dd className="text-right text-slate-900 dark:text-slate-100">{formatSecuritySeverity(summary.securitySeverityStats.maxScore)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>Average CVSS</dt>
              <dd className="text-right text-slate-900 dark:text-slate-100">
                {formatSecuritySeverity(summary.securitySeverityStats.averageScore)}
                <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">({summary.securitySeverityStats.scoredFindings} scored)</span>
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>Highest severity</dt>
              <dd className="text-right">
                <SeverityBadge severity={summary.highestSeverity ?? "note"} />
              </dd>
            </div>
          </dl>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition dark:border-slate-800 dark:bg-slate-900/60">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Rule breakdown</h4>
          {summary.ruleBreakdown.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">No rules triggered findings.</p>
          ) : (
            <ul className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
              {topRules.map((item) => (
                <li key={item.ruleId} className="flex items-center justify-between">
                  <span className="font-medium text-slate-900 dark:text-slate-100">{item.ruleId}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400">{item.count}</span>
                    {item.highestSeverity && <SeverityBadge severity={item.highestSeverity} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition dark:border-slate-800 dark:bg-slate-900/60">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">File breakdown</h4>
        {summary.fileBreakdown.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">No files with findings detected.</p>
        ) : (
          <ul className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
            {topFiles.map((item) => (
              <li key={item.filePath} className="flex items-center justify-between">
                <span className="font-medium text-slate-900 dark:text-slate-100 break-all">{item.filePath}</span>
                <div className="flex items-center gap-2 ml-2">
                  <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{item.count}</span>
                  {item.highestSeverity && <SeverityBadge severity={item.highestSeverity} />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-3">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Top findings</h4>
        {summary.topFindings.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No findings reported.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
            <div className="max-h-96 overflow-y-auto">
              <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                <thead className="bg-slate-100 dark:bg-slate-900/70">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Severity</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Vulnerability</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Message</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Security Severity</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-900 dark:bg-slate-950/40">
                  {summary.topFindings.map((finding, index) => (
                    <tr key={`${finding.ruleId}-${finding.filePath}-${index}`} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                      <td className="px-4 py-3 text-sm font-semibold uppercase text-slate-900 dark:text-slate-100">
                        <SeverityBadge severity={finding.severity} />
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-900 dark:text-slate-100">
                        <p className="font-medium">{finding.ruleName || finding.ruleId}</p>
                        {finding.filePath && (
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {finding.filePath}{finding.lineNumber > 0 ? `:${finding.lineNumber}` : ""}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                        {finding.message}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                        {finding.securitySeverity !== null ? finding.securitySeverity.toFixed(1) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {(finding.helpText || finding.helpMarkdown) && (
                          <button
                            type="button"
                            onClick={() => {
                              const helpContent = finding.helpMarkdown || finding.helpText || "";
                              onViewDetails(
                                `CodeQL Rule - ${finding.ruleId}`,
                                helpContent,
                                finding.helpMarkdown ? "text/markdown" : "text/plain",
                                finding.helpMarkdown ? "md" : "txt"
                              );
                            }}
                            className="rounded-lg border border-blue-500/40 px-3 py-1 text-sm font-medium text-blue-600 transition hover:border-blue-400 hover:text-blue-700 dark:text-blue-200 dark:hover:text-blue-100"
                          >
                            View details
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const RunPage = () => {
  const { projectId, runId } = useParams<{ projectId: string; runId: string }>();
  const { data, loading, error } = useApi(() => fetchRunDetail(projectId ?? "", runId ?? ""), [projectId, runId]);
  const [sbomSummary, setSbomSummary] = useState<SbomSummary | null>(null);
  const [sbomRaw, setSbomRaw] = useState<string | null>(null);
  const [trivySummary, setTrivySummary] = useState<TrivySummary | null>(null);
  const [trivyRaw, setTrivyRaw] = useState<string | null>(null);
  // [APPDESIGN - TEMPORARILY DISABLED] - Architecture context state
  // const [appDesignContent, setAppDesignContent] = useState<string | null>(null);
  const [finalAssessmentSummary, setFinalAssessmentSummary] = useState<FinalAssessmentSummary | null>(null);
  const [finalAssessmentRaw, setFinalAssessmentRaw] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [codeqlSummary, setCodeqlSummary] = useState<CodeqlSummary | null>(null);
  const [codeqlRaw, setCodeqlRaw] = useState<string | null>(null);
  // [DOCKER INSPECT - TEMPORARILY DISABLED] - Docker Inspect state
  // const [dockerInspectRaw, setDockerInspectRaw] = useState<string | null>(null);
  // [SONARQUBE - TEMPORARILY DISABLED] - SonarQube state
  // const [sonarqubeRaw, setSonarqubeRaw] = useState<string | null>(null);
  const [finalAssessmentError, setFinalAssessmentError] = useState<string | null>(null);
  const [codeqlError, setCodeqlError] = useState<string | null>(null);
  // [DOCKER INSPECT - TEMPORARILY DISABLED] - Docker Inspect error state
  // const [dockerInspectError, setDockerInspectError] = useState<string | null>(null);
  // [SONARQUBE - TEMPORARILY DISABLED] - SonarQube error state
  // const [sonarqubeError, setSonarqubeError] = useState<string | null>(null);
  const [sbomError, setSbomError] = useState<string | null>(null);
  const [trivyError, setTrivyError] = useState<string | null>(null);
  const [loadingArtifacts, setLoadingArtifacts] = useState<boolean>(false);
  const [rawModal, setRawModal] = useState<{ title: string; content: string; fileName?: string; mimeType?: string; downloadExtension?: string; hideDownload?: boolean } | null>(null);
  // [SWFT AI ASSISTANT - TEMPORARILY DISABLED] - Assistant state and functions
  // const [assistantOpen, setAssistantOpen] = useState(false);
  // const [assistantFacet, setAssistantFacet] = useState<AssistantFacet>("run_manifest");
  // const [assistantPrompt, setAssistantPrompt] = useState<string | undefined>(undefined);

  // const openAssistant = (facet: AssistantFacet, prompt?: string) => {
  //   setAssistantFacet(facet);
  //   setAssistantPrompt(prompt);
  //   setAssistantOpen(true);
  // };

  useEffect(() => {
    let cancelled = false;
    // Once the base run loads, pull the heavy SBOM/Trivy JSON in parallel and condense it.
    const loadArtifacts = async () => {
      if (!data || !projectId || !runId) return;
      setLoadingArtifacts(true);
      try {
        const requests: Promise<void>[] = [];
        const hasSbom = data.artifacts.some((artifact) => artifact.artifact_type === "sbom" && !artifact.blob_name.endsWith(".sig"));
        if (hasSbom) {
          requests.push(
            fetchArtifact(projectId, runId, "sbom")
              .then((payload) => {
                if (cancelled) return;
                setSbomSummary(buildSbomSummary(payload as Record<string, unknown>));
                setSbomRaw(formatJson(payload));
                setSbomError(null);
              })
              .catch((err) => {
                if (cancelled) return;
                const errorMessage = err instanceof Error ? err.message : "Failed to load SBOM artifact";
                console.error("Failed to load SBOM:", err);
                setSbomSummary(null);
                setSbomRaw(null);
                setSbomError(errorMessage);
              })
          );
        } else {
          setSbomSummary(null);
          setSbomRaw(null);
          setSbomError(null);
        }
        const hasTrivy = data.artifacts.some((artifact) => artifact.artifact_type === "trivy" && !artifact.blob_name.endsWith(".sig"));
        if (hasTrivy) {
          requests.push(
            fetchArtifact(projectId, runId, "trivy")
              .then((payload) => {
                if (cancelled) return;
                setTrivySummary(buildTrivySummary(payload as Record<string, unknown>));
                setTrivyRaw(formatJson(payload));
                setTrivyError(null);
              })
              .catch((err) => {
                if (cancelled) return;
                const errorMessage = err instanceof Error ? err.message : "Failed to load Trivy artifact";
                console.error("Failed to load Trivy:", err);
                setTrivySummary(null);
                setTrivyRaw(null);
                setTrivyError(errorMessage);
              })
          );
        } else {
          setTrivySummary(null);
          setTrivyRaw(null);
          setTrivyError(null);
        }
        // [APPDESIGN - TEMPORARILY DISABLED] - Architecture context fetching logic
        // const hasAppDesign = data.artifacts.some((artifact) => artifact.artifact_type === "appdesign" && !artifact.blob_name.endsWith(".sig"));
        // if (hasAppDesign) {
        //   requests.push(
        //     fetchArtifact(projectId, runId, "appdesign").then((payload) => {
        //       if (cancelled) return;
        //       let content: string | null = null;
        //       if (typeof payload === "string") {
        //         content = payload;
        //       } else if (payload && typeof payload === "object" && "content" in payload) {
        //         const value = (payload as { content?: unknown }).content;
        //         content = typeof value === "string" ? value : value != null ? String(value) : "";
        //       }
        //       setAppDesignContent(content ?? "");
        //     })
        //   );
        // } else {
        //   setAppDesignContent(null);
        // }
        const hasFinalAssessment = data.artifacts.some(
          (artifact) =>
            artifact.artifact_type === "finalassessment" &&
            artifact.blob_name.startsWith("final_assessment_") &&
            artifact.blob_name.endsWith(".json") &&
            !artifact.blob_name.endsWith(".json.sig")
        );
        if (hasFinalAssessment) {
          requests.push(
            fetchArtifact(projectId, runId, "finalassessment")
              .then((payload) => {
                if (cancelled) return;
                setFinalAssessmentSummary(buildFinalAssessmentSummary(payload as Record<string, unknown>));
                setFinalAssessmentRaw(formatJson(payload));
                setFinalAssessmentError(null);
              })
              .catch((err) => {
                if (cancelled) return;
                const errorMessage = err instanceof Error ? err.message : "Failed to load Final Assessment artifact";
                console.error("Failed to load Final Assessment:", err);
                setFinalAssessmentSummary(null);
                setFinalAssessmentRaw(null);
                setFinalAssessmentError(errorMessage);
              })
          );
        } else {
          setFinalAssessmentSummary(null);
          setFinalAssessmentRaw(null);
          setFinalAssessmentError(null);
        }
        const hasCodeql = data.artifacts.some(
          (artifact) => artifact.artifact_type === "codeql" && artifact.blob_name.endsWith("codeql.sarif") && !artifact.blob_name.endsWith(".sig")
        );
        if (hasCodeql) {
          requests.push(
            fetchArtifact(projectId, runId, "codeql")
              .then((payload) => {
                if (cancelled) return;
                setCodeqlSummary(buildCodeqlSummary(payload as Record<string, unknown>));
                setCodeqlRaw(formatJson(payload));
                setCodeqlError(null);
              })
              .catch((err) => {
                if (cancelled) return;
                const errorMessage = err instanceof Error ? err.message : "Failed to load CodeQL artifact";
                console.error("Failed to load CodeQL:", err);
                setCodeqlSummary(null);
                setCodeqlRaw(null);
                setCodeqlError(errorMessage);
              })
          );
        } else {
          setCodeqlSummary(null);
          setCodeqlRaw(null);
          setCodeqlError(null);
        }
        // [DOCKER INSPECT - TEMPORARILY DISABLED] - Docker Inspect fetching logic
        // const hasDockerInspect = data.artifacts.some(
        //   (artifact) => artifact.artifact_type === "dockerinspect" && artifact.blob_name.endsWith("docker-inspect.json") && !artifact.blob_name.endsWith(".sig")
        // );
        // if (hasDockerInspect) {
        //   requests.push(
        //     fetchArtifact(projectId, runId, "dockerinspect")
        //       .then((payload) => {
        //         if (cancelled) return;
        //         setDockerInspectRaw(formatJson(payload));
        //         setDockerInspectError(null);
        //       })
        //       .catch((err) => {
        //         if (cancelled) return;
        //         const errorMessage = err instanceof Error ? err.message : "Failed to load Docker Inspect artifact";
        //         console.error("Failed to load Docker Inspect:", err);
        //         setDockerInspectRaw(null);
        //         setDockerInspectError(errorMessage);
        //       })
        //   );
        // } else {
        //   setDockerInspectRaw(null);
        //   setDockerInspectError(null);
        // }
        // [SONARQUBE - TEMPORARILY DISABLED] - SonarQube fetching logic
        // const hasSonarqube = data.artifacts.some(
        //   (artifact) => artifact.artifact_type === "sonarqube" && artifact.blob_name.endsWith("sonarqube_scan.json") && !artifact.blob_name.endsWith(".sig")
        // );
        // if (hasSonarqube) {
        //   requests.push(
        //     fetchArtifact(projectId, runId, "sonarqube")
        //       .then((payload) => {
        //         if (cancelled) return;
        //         setSonarqubeRaw(formatJson(payload));
        //         setSonarqubeError(null);
        //       })
        //       .catch((err) => {
        //         if (cancelled) return;
        //         const errorMessage = err instanceof Error ? err.message : "Failed to load SonarQube artifact";
        //         console.error("Failed to load SonarQube:", err);
        //         setSonarqubeRaw(null);
        //         setSonarqubeError(errorMessage);
        //       })
        //   );
        // } else {
        //   setSonarqubeRaw(null);
        //   setSonarqubeError(null);
        // }
        await Promise.all(requests);
      } catch (err) {
        // Individual artifact errors are handled in their respective catch blocks
        // This catch is for unexpected errors during the overall loading process
        if (!cancelled) {
          console.error("Unexpected error during artifact loading:", err);
        }
      } finally {
        if (!cancelled) setLoadingArtifacts(false);
      }
    };
    void loadArtifacts();
    return () => {
      cancelled = true;
    };
  }, [data, projectId, runId]);

  // Prepare formatted JSON strings ahead of time so the modal opens instantly.
  const runRaw = useMemo(() => (data ? formatJson(data.metadata) : null), [data]);
  // [APPDESIGN - TEMPORARILY DISABLED] - Architecture context useMemo variables
  // const appDesignArtifact = useMemo(() => data?.artifacts.find((artifact) => artifact.artifact_type === "appdesign"), [data]);
  // const appDesignFileName = appDesignArtifact?.blob_name ?? "app-design.md";
  // const hasAppDesignDocument = appDesignContent !== null;
  // const appDesignHasBody = (appDesignContent ?? "").trim().length > 0;
  const trivyPolicy = useMemo(() => {
    // Normalise the Trivy policy fields so we can display the exact scan/fail thresholds.
    if (!data) return null;
    const metadata = data.metadata ?? {};
    const assessment = typeof metadata.assessment === "object" && metadata.assessment !== null ? (metadata.assessment as Record<string, unknown>) : null;
    const trivyConfig = assessment && typeof assessment.trivy === "object" && assessment.trivy !== null ? (assessment.trivy as Record<string, unknown>) : null;
    if (!trivyConfig) return null;
    const scanSeverities =
      typeof trivyConfig.scanSeverities === "string"
        ? trivyConfig.scanSeverities
        : typeof trivyConfig.scan_levels === "string"
          ? trivyConfig.scan_levels
          : null;
    const failSeverities =
      typeof trivyConfig.failSeverities === "string"
        ? trivyConfig.failSeverities
        : typeof trivyConfig.fail_levels === "string"
          ? trivyConfig.fail_levels
          : null;
    const ignoreUnfixed =
      typeof trivyConfig.ignoreUnfixed === "boolean"
        ? trivyConfig.ignoreUnfixed
        : typeof trivyConfig.ignore_unfixed === "boolean"
          ? trivyConfig.ignore_unfixed
          : null;
    const scannerMeta =
      typeof trivyConfig.scanner === "object" && trivyConfig.scanner !== null
        ? (trivyConfig.scanner as Record<string, unknown>)
        : null;
    const scannerVersion =
      scannerMeta && typeof scannerMeta.version === "string" && scannerMeta.version.length > 0
        ? scannerMeta.version
        : null;
    const scannerDbUpdatedAt =
      scannerMeta && typeof scannerMeta.dbUpdatedAt === "string" && scannerMeta.dbUpdatedAt.length > 0
        ? scannerMeta.dbUpdatedAt
        : null;
    return {
      scanSeverities,
      failSeverities,
      ignoreUnfixed,
      scannerVersion,
      scannerDbUpdatedAt
    };
  }, [data]);

  if (!projectId || !runId) return <ErrorState message="Run reference incomplete" />;
  if (loading) return <LoadingState message={`Loading run ${runId}`} />;
  if (error || !data) return <ErrorState message={error ?? "Unable to load run detail"} />;

  // Helper for the "View raw JSON" buttons so each section stays uncluttered.
  const buildRawJsonButton = (label: string, content: string | null, fileName?: string) =>
    content
      ? (
        <button
          type="button"
          onClick={() => setRawModal({ title: label, content, fileName, mimeType: "application/json", downloadExtension: "json" })}
          className="rounded-lg border border-blue-300 px-3 py-1 text-sm font-medium text-blue-600 transition hover:border-blue-400 hover:text-blue-500 dark:border-blue-500/40 dark:text-blue-200 dark:hover:border-blue-400 dark:hover:text-blue-100"
        >
          View raw JSON
        </button>
      )
      : null;

  // Helper for the "View raw SARIF" button for CodeQL artifacts.
  const buildRawSarifButton = (label: string, content: string | null, fileName?: string) =>
    content
      ? (
        <button
          type="button"
          onClick={() => setRawModal({ title: label, content, fileName, mimeType: "application/sarif+json", downloadExtension: "sarif" })}
          className="rounded-lg border border-blue-300 px-3 py-1 text-sm font-medium text-blue-600 transition hover:border-blue-400 hover:text-blue-500 dark:border-blue-500/40 dark:text-blue-200 dark:hover:border-blue-400 dark:hover:text-blue-100"
        >
          View raw SARIF
        </button>
      )
      : null;

  // Helper functions to find artifacts by pattern (excluding .sig files).
  const findFinalAssessmentArtifact = () =>
    data?.artifacts.find(
      (artifact) =>
        artifact.artifact_type === "finalassessment" &&
        artifact.blob_name.startsWith("final_assessment_") &&
        artifact.blob_name.endsWith(".json") &&
        !artifact.blob_name.endsWith(".json.sig")
    );

  const findCodeqlArtifact = () =>
    data?.artifacts.find(
      (artifact) => artifact.artifact_type === "codeql" && artifact.blob_name.endsWith("codeql.sarif") && !artifact.blob_name.endsWith(".sig")
    );

  // [DOCKER INSPECT - TEMPORARILY DISABLED] - Docker Inspect helper function
  // const findDockerInspectArtifact = () =>
  //   data?.artifacts.find(
  //     (artifact) => artifact.artifact_type === "dockerinspect" && artifact.blob_name.endsWith("docker-inspect.json") && !artifact.blob_name.endsWith(".sig")
  //   );

  // [SONARQUBE - TEMPORARILY DISABLED] - SonarQube helper function
  // const findSonarqubeArtifact = () =>
  //   data?.artifacts.find(
  //     (artifact) => artifact.artifact_type === "sonarqube" && artifact.blob_name.endsWith("sonarqube_scan.json") && !artifact.blob_name.endsWith(".sig")
  //   );

  // [SWFT AI ASSISTANT - TEMPORARILY DISABLED] - Assistant functionality
  // const buildAssistantButton = (facetType: AssistantFacet, prompt: string) => (
  //   <button
  //     type="button"
  //     onClick={() => openAssistant(facetType, prompt)}
  //     className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
  //   >
  //     <SparklesIcon className="h-4 w-4" />
  //     Ask about this
  //   </button>
  // );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Breadcrumbs items={[{ label: "Projects", to: "/" }, { label: projectId, to: `/projects/${projectId}` }, { label: `Run ${runId}` }]} />
        <div className="flex flex-wrap items-center gap-2">
          {SWFT_WORKSPACE_ENABLED && (
            <Link
              to={`/swft/${encodeURIComponent(projectId)}?runId=${encodeURIComponent(runId)}`}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
            >
              Open SWFT workspace
            </Link>
          )}
          {/* [SWFT AI ASSISTANT - TEMPORARILY DISABLED] - Ask Assistant button */}
          {/* <button
            type="button"
            onClick={() => openAssistant("run_manifest")}
            className="inline-flex items-center gap-2 rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700"
          >
            <SparklesIcon className="h-5 w-5" />
            Ask Assistant
          </button> */}
        </div>
      </div>
      <CollapsibleSection
        title="Run overview"
        description="Execution details from the SWFT workflow and deployment output."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {buildRawJsonButton(
              "Run metadata (run.json)",
              runRaw,
              (data.artifacts.find((artifact) => artifact.artifact_type === "run" && !artifact.blob_name.endsWith(".sig"))?.blob_name) ?? "run.json"
            )}
            {/* [SWFT AI ASSISTANT - TEMPORARILY DISABLED] - Ask about this button */}
            {/* {buildAssistantButton("run_manifest", `Summarize run ${runId} for an Authorizing Official.`)} */}
          </div>
        }
        defaultOpen
      >
        <RunDetailCard
          detail={data}
          sbomHighlights={
            sbomSummary
              ? {
                  totalComponents: sbomSummary.totalComponents,
                  uniqueTypes: sbomSummary.uniqueTypes,
                  uniqueLicenses: sbomSummary.uniqueLicenses,
                  baseImage: sbomSummary.baseImage,
                  topLicenses: sbomSummary.topLicenses
                }
              : null
          }
          trivyHighlights={
            trivySummary
              ? {
                  platform: trivySummary.platform
                }
              : null
          }
        />
      </CollapsibleSection>
      <CollapsibleSection
        title="Final Assessment"
        description="AI-assisted review of all the findings reported."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {buildRawJsonButton("Final Assessment (final_assessment.json)", finalAssessmentRaw, findFinalAssessmentArtifact()?.blob_name)}
          </div>
        }
      >
        {loadingArtifacts ? (
          <LoadingState message="Loading Final Assessment" />
        ) : finalAssessmentError ? (
          <ErrorState message={finalAssessmentError} />
        ) : finalAssessmentRaw && finalAssessmentSummary ? (
          <div className="space-y-6">
            <div className={`rounded-xl border px-4 py-5 ${
              finalAssessmentSummary.totalFindings === 0
                ? "border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10"
                : "border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-500/10"
            }`}>
              <p className={`text-sm ${
                finalAssessmentSummary.totalFindings === 0
                  ? "text-emerald-700 dark:text-emerald-200"
                  : "text-rose-700 dark:text-rose-200"
              }`}>Total findings</p>
              <p className={`mt-2 text-3xl font-semibold ${
                finalAssessmentSummary.totalFindings === 0
                  ? "text-emerald-900 dark:text-white"
                  : "text-rose-900 dark:text-white"
              }`}>{finalAssessmentSummary.totalFindings}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {finalAssessmentSummary.severityCounts.length === 0 ? (
                <span className="text-sm text-slate-500 dark:text-slate-400">No findings detected.</span>
              ) : (
                finalAssessmentSummary.severityCounts.map((item) => (
                  <SeverityBadge key={item.severity} severity={item.severity} count={item.count} />
                ))
              )}
            </div>
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Top findings</h4>
                <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Source</span>
                  <div className="flex flex-wrap gap-2">
                    {/* [SONARQUBE - TEMPORARILY DISABLED] - SonarQube removed from source filter */}
                    {/* {["CodeQL", "Trivy", "SonarQube"].map((source) => { */}
                    {["CodeQL", "Trivy"].map((source) => {
                      const selected = sourceFilter === source;
                      return (
                        <button
                          key={source}
                          type="button"
                          onClick={() => setSourceFilter(selected ? null : source)}
                          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                            selected
                              ? "border-slate-900 bg-slate-900 text-white shadow-sm dark:border-white dark:bg-white dark:text-slate-900"
                              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white"
                          }`}
                        >
                          {source}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              {(() => {
                const filteredFindings = sourceFilter
                  ? finalAssessmentSummary.topFindings.filter((finding) => finding.source === sourceFilter)
                  : finalAssessmentSummary.topFindings;
                
                return filteredFindings.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {sourceFilter ? `No findings from ${sourceFilter}.` : "No findings reported."}
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                    <div className="max-h-96 overflow-y-auto">
                      <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                        <thead className="bg-slate-100 dark:bg-slate-900/70">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Risk Level</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Source</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Vulnerability</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Determination</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-900 dark:bg-slate-950/40">
                          {filteredFindings.map((finding, index) => (
                            <tr key={`${finding.finding}-${index}`} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                              <td className="px-4 py-3 text-sm font-semibold uppercase text-slate-900 dark:text-slate-100">
                                <SeverityBadge severity={finding.riskLevel} />
                              </td>
                              <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                                {finding.source || "—"}
                              </td>
                              <td className="px-4 py-3 text-sm text-slate-900 dark:text-slate-100">
                                <p className="font-medium">{finding.finding}</p>
                                {finding.filePath && (
                                  <p className="text-xs text-slate-500 dark:text-slate-400">
                                    {finding.filePath}{finding.lineNumber ? `:${finding.lineNumber}` : ""}
                                  </p>
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                                {finding.determination}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const promptText = finding.prompt || "";
                                    setRawModal({
                                      title: `AI Prompt - ${finding.finding}`,
                                      content: promptText,
                                      mimeType: "text/plain",
                                      downloadExtension: "txt",
                                      hideDownload: true
                                    });
                                  }}
                                  className="rounded-lg border border-blue-500/40 px-3 py-1 text-sm font-medium text-blue-600 transition hover:border-blue-400 hover:text-blue-700 dark:text-blue-200 dark:hover:text-blue-100"
                                >
                                  View AI Prompt
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">No Final Assessment artifact was captured for this run.</p>
        )}
      </CollapsibleSection>
      <CollapsibleSection
        title="Software Bill of Materials (SBOM)"
        description="Component inventory captured from the container image."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {buildRawJsonButton(
              "SBOM (sbom.cyclonedx.json)",
              sbomRaw,
              (data.artifacts.find((artifact) => artifact.artifact_type === "sbom" && !artifact.blob_name.endsWith(".sig"))?.blob_name) ?? "sbom.cyclonedx.json"
            )}
            {/* [SWFT AI ASSISTANT - TEMPORARILY DISABLED] - Ask about this button */}
            {/* {buildAssistantButton("sbom", `Highlight critical supply-chain risks in the SBOM for run ${runId}.`)} */}
          </div>
        }
      >
        {loadingArtifacts ? (
          <LoadingState message="Loading SBOM summary" />
        ) : sbomError ? (
          <ErrorState message={sbomError} />
        ) : sbomSummary ? (
          <SbomSummaryView summary={sbomSummary} trivy={trivySummary} />
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">No SBOM artifact was uploaded for this run.</p>
        )}
      </CollapsibleSection>
      <CollapsibleSection
        title="Code scanning (CodeQL)"
        description="Findings reported by CodeQL across the source code."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {buildRawSarifButton("CodeQL (codeql.sarif)", codeqlRaw, findCodeqlArtifact()?.blob_name)}
          </div>
        }
      >
        {loadingArtifacts ? (
          <LoadingState message="Loading CodeQL" />
        ) : codeqlError ? (
          <ErrorState message={codeqlError} />
        ) : codeqlRaw && codeqlSummary ? (
          <CodeqlSummaryView
            summary={codeqlSummary}
            onViewDetails={(title, content, mimeType, downloadExtension) => {
              setRawModal({
                title,
                content,
                mimeType,
                downloadExtension,
                hideDownload: true
              });
            }}
          />
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">No CodeQL artifact was captured for this run.</p>
        )}
      </CollapsibleSection>
      <CollapsibleSection
        title="Vulnerability scan (Trivy)"
        description="Findings reported by Trivy across the container image."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {buildRawJsonButton(
              "Trivy report (trivy-report.json)",
              trivyRaw,
              (data.artifacts.find((artifact) => artifact.artifact_type === "trivy" && !artifact.blob_name.endsWith(".sig"))?.blob_name) ?? "trivy-report.json"
            )}
            {/* [SWFT AI ASSISTANT - TEMPORARILY DISABLED] - Ask about this button */}
            {/* {buildAssistantButton("trivy", `Explain the highest-risk vulnerabilities from the Trivy scan for run ${runId}.`)} */}
          </div>
        }
      >
        {loadingArtifacts ? (
          <LoadingState message="Loading Trivy report" />
        ) : trivyError ? (
          <ErrorState message={trivyError} />
        ) : trivySummary ? (
          <TrivySummaryView summary={trivySummary} policy={trivyPolicy} />
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">No Trivy report was captured for this run.</p>
        )}
      </CollapsibleSection>
      {/* [DOCKER INSPECT - TEMPORARILY DISABLED] - Docker Inspect section */}
      {/* <CollapsibleSection
        title="Container inspection (Docker Inspect)"
        description="Configuration and metadata reported by Docker Inspect for the container image."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {buildRawJsonButton("Docker Inspect (docker-inspect.json)", dockerInspectRaw, findDockerInspectArtifact()?.blob_name)}
          </div>
        }
      >
        {loadingArtifacts ? (
          <LoadingState message="Loading Docker Inspect" />
        ) : dockerInspectError ? (
          <ErrorState message={dockerInspectError} />
        ) : dockerInspectRaw ? (
          <div className="text-sm text-slate-500 dark:text-slate-400">
            Content placeholder - to be implemented
          </div>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">No Docker Inspect artifact was captured for this run.</p>
        )}
      </CollapsibleSection> */}
      {/* [SONARQUBE - TEMPORARILY DISABLED] - SonarQube section */}
      {/* <CollapsibleSection
        title="Code quality analysis (SonarQube)"
        description="Findings reported by SonarQube across the source code."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {buildRawJsonButton("SonarQube (sonarqube_scan.json)", sonarqubeRaw, findSonarqubeArtifact()?.blob_name)}
          </div>
        }
      >
        {loadingArtifacts ? (
          <LoadingState message="Loading SonarQube" />
        ) : sonarqubeError ? (
          <ErrorState message={sonarqubeError} />
        ) : sonarqubeRaw ? (
          <div className="text-sm text-slate-500 dark:text-slate-400">
            Content placeholder - to be implemented
          </div>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">No SonarQube artifact was captured for this run.</p>
        )}
      </CollapsibleSection> */}
      {/* [APPDESIGN - TEMPORARILY DISABLED] - Architecture context section */}
      {/* <CollapsibleSection
        title="Architecture context (app-design.md)"
        description="Per-run design notes included with the workflow artifacts."
        actions={
          hasAppDesignDocument
            ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setRawModal({
                      title: "app-design.md",
                      content: appDesignContent ?? "",
                      fileName: appDesignFileName,
                      mimeType: "text/markdown",
                      downloadExtension: "md",
                    })
                  }
                  className="rounded-lg border border-blue-300 px-3 py-1 text-sm font-medium text-blue-600 transition hover:border-blue-400 hover:text-blue-500 dark:border-blue-500/40 dark:text-blue-200 dark:hover:border-blue-400 dark:hover:text-blue-100"
                >
                  View full document
                </button>
              </div>
            )
            : null
        }
        defaultOpen={false}
      >
        {loadingArtifacts ? (
          <LoadingState message="Loading architecture notes" />
        ) : hasAppDesignDocument ? (
          appDesignHasBody ? (
            <div className="max-h-[32rem] overflow-y-auto rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                className="prose prose-slate max-w-none dark:prose-invert prose-headings:scroll-mt-16"
              >
                {appDesignContent ?? ""}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">The uploaded document is empty.</p>
          )
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">No app-design.md artifact was provided for this run.</p>
        )}
      </CollapsibleSection> */}
      {/* [SWFT AI ASSISTANT - TEMPORARILY DISABLED] - AssistantPanel component */}
      {/* <AssistantPanel
        open={assistantOpen}
        onClose={() => {
          setAssistantOpen(false);
          setAssistantPrompt(undefined);
        }}
        projectId={projectId}
        runId={runId}
        initialFacet={assistantFacet}
        initialPrompt={assistantPrompt}
        contextArtifacts={{
          run: runRaw,
          sbom: sbomRaw,
          trivy: trivyRaw,
          appDesign: appDesignContent,
        }}
      /> */}
      {rawModal && (
        <JsonModal
          title={rawModal.title}
          content={rawModal.content}
          fileName={rawModal.fileName}
          mimeType={rawModal.mimeType}
          downloadExtension={rawModal.downloadExtension}
          hideDownload={rawModal.hideDownload}
          onClose={() => setRawModal(null)}
        />
      )}
    </div>
  );
};
