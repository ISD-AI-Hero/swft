// Artifact identifiers supported by the backend.
export type ArtifactType = "sbom" | "trivy" | "run" | "appdesign" | "codeql" | "sonarqube" | "dockerinspect" | "finalassessment" | "other";

// Lightweight project list entry.
export interface ProjectSummary {
  project_id: string;
  run_count: number;
  latest_run_at: string | null;
}

// Aggregated run row used in tables/charts.
export interface RunSummary {
  project_id: string;
  run_id: string;
  created_at: string | null;
  artifact_counts: Record<string, number>;
  sbom_component_total: number | null;
  cosign_status: string | null;
  trivy_findings_total: number | null;
  trivy_findings_failset: number | null;
  final_assessment_findings_total: number | null;
  final_assessment_findings_failset: number | null;
  final_assessment_overall_risk_level: string | null;
  deployment_url: string | null;
}

// Descriptor for a stored artifact blob.
export interface ArtifactDescriptor {
  project_id: string;
  run_id: string;
  artifact_type: ArtifactType;
  blob_name: string;
  container: string;
  last_modified: string | null;
  size_bytes: number | null;
}

// Full run detail returned by the backend.
export interface RunDetail {
  summary: RunSummary;
  artifacts: ArtifactDescriptor[];
  metadata: Record<string, unknown>;
}

// Standard async state shape for useApi.
export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// Assistant persona/facet/history selector options.
export type AssistantPersona = "security_assessor" | "compliance_officer" | "devops_engineer" | "software_developer";
export type AssistantFacet = "run_manifest" | "sbom" | "trivy" | "general" | "architecture";
export type AssistantHistoryDepth = 0 | 2 | 5 | 7 | 10 | 15 | "all";

// Message passed to/returned from the assistant.
export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

// Payload sent to /assistant/chat or /assistant/chat/stream.
export interface AssistantRequest {
  question: string;
  persona: AssistantPersona;
  facet: AssistantFacet;
  selected_model?: string;
  history?: AssistantMessage[];
  history_depth: AssistantHistoryDepth;
  conversation_id?: string;
  context?: Record<string, string>;
  project_id?: string;
  run_id?: string;
}

// Metadata describing the assistant answer/model.
export interface AssistantMetadata {
  provider: string;
  model_key: string;
  model_identifier: string;
  persona: AssistantPersona;
  facet: AssistantFacet;
  history_included: number;
  max_output_tokens?: number | null;
  max_input_tokens?: number | null;
  total_context_window?: number | null;
}

// Synchronous assistant response.
export interface AssistantResponse {
  answer: string;
  conversation_id: string;
  metadata: AssistantMetadata;
}

// Model option shown in the assistant model picker.
export interface AssistantModelOption {
  key: string;
  label: string;
  response_format?: string | null;
  total_context_window?: number | null;
  max_input_tokens?: number | null;
  max_output_tokens?: number | null;
}

// Assistant configuration payload from /assistant/config.
export interface AssistantConfig {
  provider: string;
  models: AssistantModelOption[];
  personas: AssistantPersona[];
  facets: AssistantFacet[];
  history_depths: AssistantHistoryDepth[];
  streaming_enabled: boolean;
}

// Streamed assistant events over NDJSON.
export type AssistantStreamEvent =
  | {
      type: "metadata";
      conversation_id: string;
      metadata: AssistantMetadata;
    }
  | {
      type: "delta";
      delta: string;
    }
  | {
      type: "final";
      conversation_id: string;
      answer: string;
      metadata: AssistantMetadata;
    }
  | {
      type: "error";
      error: string;
    };

// SWFT project boundary record.
export interface SwftProject {
  project_id: string;
  services: string[];
  regions: string[];
  boundary_description: string | null;
}

// Payload for creating/updating a SWFT project boundary.
export interface SwftProjectPayload {
  services: string[];
  regions: string[];
  boundary_description?: string | null;
}

// Control parameter detail for workspace forms.
export interface SwftParameter {
  control_id: string;
  param_id: string;
  label?: string | null;
  description?: string | null;
  allowed_values: string[];
  current_value?: string | null;
}

// OSCAL catalog sync result.
export interface CatalogSyncResult {
  catalog: Record<string, unknown>;
  baseline: Record<string, unknown>;
}

// Azure Policy initiative import result.
export interface PolicyImportResult {
  initiative: string;
  scope: string;
  policies: number;
  mappings: number;
  version: string;
}

// Policy state import result.
export interface PolicyStateResult {
  processed: number;
  inserted: number;
}

// Evidence ingestion result for a single artifact upload.
export interface EvidenceResult {
  evidence_id: number;
  run_id: string;
  kind: "sbom" | "trivy" | "signature";
  metadata?: Record<string, unknown>;
}

// Itemized status for auto-import evidence.
export interface StorageEvidenceItem {
  kind: string;
  status: "stored" | "missing" | "failed";
  message?: string | null;
  evidence_id?: number | null;
  metadata?: Record<string, unknown>;
}

// Auto-import evidence response wrapper.
export interface StorageEvidenceResponse {
  project_id: string;
  run_id: string;
  results: StorageEvidenceItem[];
}

// Built-in Azure Policy set descriptor.
export interface AzurePolicySet {
  id: string;
  label: string;
  default_scope: string;
  description: string;
}
