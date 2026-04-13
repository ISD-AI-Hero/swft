// AI assistant overlay: model/persona picker, auto-context wiring, and streaming chat UI.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, Transition } from "@headlessui/react";
import {
  ChatBubbleBottomCenterTextIcon,
  ChevronDownIcon,
  DocumentTextIcon,
  FaceSmileIcon,
  RocketLaunchIcon,
  ShieldCheckIcon,
  ShieldExclamationIcon,
  TableCellsIcon,
  WrenchScrewdriverIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

import {
  type AssistantConfig,
  type AssistantFacet,
  type AssistantHistoryDepth,
  type AssistantPersona,
  type AssistantRequest,
  type AssistantResponse,
  type AssistantStreamEvent,
} from "@lib/types";
import { fetchAssistantConfig, postAssistantMessage, streamAssistantMessage } from "@lib/api";
import { InfoPopover } from "@components/InfoPopover";

type AssistantPanelProps = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  runId: string;
  initialFacet?: AssistantFacet;
  initialPrompt?: string;
  contextArtifacts: {
    run?: string | null;
    sbom?: string | null;
    trivy?: string | null;
    appDesign?: string | null;
  };
};

type ConversationEntry = {
  id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: AssistantResponse["metadata"];
};

const personaLabels: Record<AssistantPersona, string> = {
  security_assessor: "Security Assessor",
  compliance_officer: "Compliance Officer",
  devops_engineer: "DevOps Engineer",
  software_developer: "Software Developer",
};

const personaIcons: Record<AssistantPersona, JSX.Element> = {
  security_assessor: <ShieldCheckIcon className="h-5 w-5" />,
  compliance_officer: <ShieldExclamationIcon className="h-5 w-5" />,
  devops_engineer: <WrenchScrewdriverIcon className="h-5 w-5" />,
  software_developer: <RocketLaunchIcon className="h-5 w-5" />,
};

const DEFAULT_CONTEXT_CHAR_LIMIT = 12000;
const CHARS_PER_TOKEN_ESTIMATE = 4;
const CONTEXT_SAFETY_RATIO = 0.6;

const truncateContext = (label: string, value: string | null | undefined, limit: number): string | null => {
  if (!value) return null;
  const boundary = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_CONTEXT_CHAR_LIMIT;
  if (value.length <= boundary) return value;
  const truncated = value.slice(0, boundary);
  return `${truncated}\n\n/* ${label} truncated to ${boundary} characters to fit model context. */`;
};

const compactJson = (value: string | null | undefined): string | null => {
  if (!value) return null;
  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    return value;
  }
};

const facetDefinitions: Record<
  AssistantFacet,
  { label: string; description: string; icon: JSX.Element; prompts: string[]; context: string }
> = {
  run_manifest: {
    label: "Run Manifest",
    description: "Pipeline telemetry, policy status, and promotion readiness",
    icon: <DocumentTextIcon className="h-5 w-5" />,
    context: "Includes the run manifest metadata (assessment summary, deployment, and policy status).",
    prompts: [
      "Summarize the pipeline outcome for this run.",
      "What control failures should block authorization?",
      "Compare this run's policy status with the previous approved run.",
    ],
  },
  sbom: {
    label: "SBOM",
    description: "Component inventory, licensing, and supplier drift",
    icon: <TableCellsIcon className="h-5 w-5" />,
    context: "Includes the run manifest and the CycloneDX SBOM artifact for component analysis.",
    prompts: [
      "Highlight critical supply-chain risks in this SBOM.",
      "Which licenses require legal review before deployment?",
      "List components that changed since the prior run.",
    ],
  },
  trivy: {
    label: "Trivy",
    description: "Vulnerability landscape and remediation priorities",
    icon: <ShieldExclamationIcon className="h-5 w-5" />,
    context: "Includes the run manifest and Trivy vulnerability report for this container image.",
    prompts: [
      "Summarize high and critical findings and their fixes.",
      "What runtime exposure does the top CVE introduce?",
      "Which findings lack patches and how should we mitigate them?",
    ],
  },
  general: {
    label: "General",
    description: "Cross-run trends, architecture, and compliance alignment",
    icon: <ChatBubbleBottomCenterTextIcon className="h-5 w-5" />,
    context: "Includes the run manifest, Trivy findings, and architecture notes (no SBOM content).",
    prompts: [
      "Explain how this system satisfies IL4/IL5 controls.",
      "What evidence should the AO review before signing off?",
      "How does this pipeline support code-to-production traceability?",
    ],
  },
  architecture: {
    label: "Architecture",
    description: "Deep dive into app-design.md design intent and controls",
    icon: <FaceSmileIcon className="h-5 w-5" />,
    context: "Includes the run manifest and the uploaded app-design.md narrative for this run.",
    prompts: [
      "Explain the architecture risks called out in app-design.md.",
      "Which controls or dependencies are critical in this design?",
      "Summarize the mission objectives captured in app-design.md.",
    ],
  },
};

const historyOptions: { label: string; value: AssistantHistoryDepth }[] = [
  { label: "0", value: 0 },
  { label: "2", value: 2 },
  { label: "5", value: 5 },
  { label: "7", value: 7 },
  { label: "10", value: 10 },
  { label: "15", value: 15 },
  { label: "All", value: "all" },
];

const MarkdownContent = ({ content }: { content: string }) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    rehypePlugins={[rehypeHighlight as never]}
    components={{
      h1: ({ node, ...props }) => <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100" {...props} />,
      h2: ({ node, ...props }) => <h2 className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-100" {...props} />,
      h3: ({ node, ...props }) => <h3 className="mt-4 text-sm font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-400" {...props} />,
      p: ({ node, ...props }) => <p className="mb-3 leading-6 text-slate-700 dark:text-slate-300" {...props} />,
      ul: ({ node, ...props }) => <ul className="mb-3 list-disc space-y-2 pl-5 text-slate-700 dark:text-slate-300" {...props} />,
      ol: ({ node, ...props }) => <ol className="mb-3 list-decimal space-y-2 pl-5 text-slate-700 dark:text-slate-300" {...props} />,
      li: ({ node, ...props }) => <li className="pl-1" {...props} />,
      code: ({ className, children, ...props }) => {
        const isBlock = /language-/.test(className ?? "");
        if (!isBlock) {
          return <code className="rounded bg-slate-200 px-1.5 py-0.5 text-sm text-slate-900 dark:bg-slate-700 dark:text-slate-100" {...props}>{children}</code>;
        }
        return (
          <pre className="mb-4 overflow-x-auto rounded-lg bg-slate-900/80 p-4 text-sm text-slate-100 shadow-inner dark:bg-slate-800">
            <code className={className}>{children}</code>
          </pre>
        );
      },
      table: ({ node, ...props }) => (
        <div className="mb-4 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-left text-sm text-slate-800 dark:text-slate-200" {...props} />
        </div>
      ),
      th: ({ node, ...props }) => <th className="bg-slate-100 px-3 py-2 font-semibold dark:bg-slate-800/80" {...props} />,
      td: ({ node, ...props }) => <td className="px-3 py-2 align-top text-slate-700 dark:text-slate-300" {...props} />,
      blockquote: ({ node, ...props }) => (
        <blockquote className="border-l-4 border-slate-400/60 pl-4 italic text-slate-700 dark:border-slate-600 dark:text-slate-300" {...props} />
      ),
    }}
  >
    {content}
  </ReactMarkdown>
);

const TypingIndicator = () => (
  <div className="flex items-center gap-1 px-1 py-1" aria-label="Assistant is thinking">
    <span className="h-2 w-2 rounded-full bg-slate-400 dark:bg-slate-500 animate-bounce [animation-delay:-0.3s]" />
    <span className="h-2 w-2 rounded-full bg-slate-400 dark:bg-slate-500 animate-bounce [animation-delay:-0.15s]" />
    <span className="h-2 w-2 rounded-full bg-slate-400 dark:bg-slate-500 animate-bounce" />
  </div>
);

const emptyMessageState: ConversationEntry[] = [
  {
    id: "assistant-welcome",
    role: "assistant",
    content:
      "Hello! I can help you interpret the run manifest, SBOM, Trivy scan, and the architecture context captured in `app-design.md`. Choose a facet, persona, and question to get started. Tip: press **⌘ + Enter** (Mac) or **Ctrl + Enter** (Windows/Linux) to send your message without leaving the keyboard.",
  },
];

export const AssistantPanel = ({
  open,
  onClose,
  projectId,
  runId,
  initialFacet,
  initialPrompt,
  contextArtifacts,
}: AssistantPanelProps) => {
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const canStream = config?.streaming_enabled === true;

  const [facet, setFacet] = useState<AssistantFacet>(initialFacet ?? "run_manifest");
  const [persona, setPersona] = useState<AssistantPersona>("security_assessor");
  const [modelKey, setModelKey] = useState<string | undefined>(undefined);
  const [historyDepth, setHistoryDepth] = useState<AssistantHistoryDepth>(2);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationEntry[]>(emptyMessageState);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [configExpanded, setConfigExpanded] = useState(true);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const models = useMemo(() => config?.models ?? [], [config]);
  const activeModel = useMemo(() => {
    if (models.length === 0) return null;
    if (modelKey) {
      return models.find((model) => model.key === modelKey) ?? models[0];
    }
    return models[0];
  }, [models, modelKey]);
  const contextCharBudget = useMemo(() => {
    const tokens = activeModel?.max_input_tokens ?? activeModel?.total_context_window ?? null;
    if (tokens && tokens > 0) {
      const estimatedChars = Math.floor(tokens * CHARS_PER_TOKEN_ESTIMATE * CONTEXT_SAFETY_RATIO);
      return Math.max(estimatedChars, DEFAULT_CONTEXT_CHAR_LIMIT);
    }
    return DEFAULT_CONTEXT_CHAR_LIMIT;
  }, [activeModel]);

  const buildContextPayload = useCallback((): Record<string, string> => {
    const payload: Record<string, string> = {};
    const runEntry = { key: "Run Manifest", label: "Run Manifest", value: compactJson(contextArtifacts.run), include: true };
    const sbomEntry = { key: "SBOM Artifact", label: "SBOM Artifact", value: compactJson(contextArtifacts.sbom), include: facet === "sbom" };
    const trivyEntry = { key: "Trivy Report", label: "Trivy Report", value: compactJson(contextArtifacts.trivy), include: facet === "trivy" || facet === "general" };
    const appDesignEntry = { key: "Architecture Context", label: "Architecture Context", value: contextArtifacts.appDesign ?? null, include: facet === "architecture" || facet === "general" };

    const candidates = [runEntry, sbomEntry, trivyEntry, appDesignEntry].filter((entry) => entry.include && entry.value);
    const slotCount = Math.max(candidates.length, 1);
    const perChunkLimit = Math.max(DEFAULT_CONTEXT_CHAR_LIMIT, Math.floor(contextCharBudget / slotCount));

    const pushContext = (entry: typeof runEntry) => {
      if (!entry.value) return;
      const text = truncateContext(entry.label, entry.value, perChunkLimit);
      if (text) {
        payload[entry.key] = text;
      }
    };

    pushContext(runEntry);
    candidates
      .filter((entry) => entry.key !== "Run Manifest")
      .forEach((entry) => pushContext(entry));

    return payload;
  }, [contextArtifacts.run, contextArtifacts.sbom, contextArtifacts.trivy, contextArtifacts.appDesign, facet, contextCharBudget]);
  useEffect(() => {
    if (!open || config) return;
    setLoadingConfig(true);
    setConfigError(null);
    fetchAssistantConfig()
      .then((result) => {
        setConfig(result);
        setModelKey((prev) => prev ?? result.models[0]?.key);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Unable to load assistant configuration.";
        setConfigError(message);
      })
      .finally(() => setLoadingConfig(false));
  }, [open, config]);

  useEffect(() => {
    if (!initialFacet) return;
    setFacet(initialFacet);
  }, [initialFacet]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [open, messages]);

  useEffect(() => {
    if (open && initialPrompt) {
      setInput(initialPrompt);
    }
  }, [open, initialPrompt]);

  const facets = useMemo(() => config?.facets ?? Object.keys(facetDefinitions), [config]);
  const personas = useMemo(() => config?.personas ?? (Object.keys(personaLabels) as AssistantPersona[]), [config]);
  const facetHelpItems = useMemo(
    () =>
      Object.values(facetDefinitions).map((definition) => ({
        label: definition.label,
        content: definition.context,
      })),
    []
  );

  const resetConversation = () => {
    setConversationId(null);
    setMessages(emptyMessageState);
    setSendError(null);
  };

  const handleQuickPrompt = (prompt: string) => {
    setInput(prompt);
  };

  const stopGeneration = () => {
    abortControllerRef.current?.abort();
  };

  const sendMessage = async (question: string) => {
    if (!config || !question.trim()) return;
    setSendError(null);
    setSending(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const trimmedQuestion = question.trim();
    const userEntry: ConversationEntry = { id: `user-${Date.now()}`, role: "user", content: trimmedQuestion };
    const canStream = config.streaming_enabled === true;
    const placeholderId = `assistant-${Date.now()}`;
    const placeholderEntry: ConversationEntry | null = canStream
      ? { id: placeholderId, role: "assistant", content: "" }
      : null;
    setMessages((prev) => (placeholderEntry ? [...prev, userEntry, placeholderEntry] : [...prev, userEntry]));
    setInput("");

    const payload: AssistantRequest = {
      question: trimmedQuestion,
      persona,
      facet,
      selected_model: modelKey,
      history_depth: historyDepth,
      conversation_id: conversationId ?? undefined,
      project_id: projectId,
      run_id: runId,
    };
    const contextPayload = buildContextPayload();
    if (Object.keys(contextPayload).length > 0) {
      payload.context = contextPayload;
    }

    if (canStream) {
      try {
        await streamAssistantMessage(payload, (event: AssistantStreamEvent) => {
          if (event.type === "metadata") {
            setConversationId(event.conversation_id);
            setMessages((prev) =>
              prev.map((entry) =>
                entry.id === placeholderId ? { ...entry, metadata: event.metadata } : entry
              )
            );
          } else if (event.type === "delta") {
            if (!event.delta) return;
            setMessages((prev) =>
              prev.map((entry) =>
                entry.id === placeholderId ? { ...entry, content: entry.content + event.delta } : entry
              )
            );
          } else if (event.type === "final") {
            setConversationId(event.conversation_id);
            setMessages((prev) =>
              prev.map((entry) =>
                entry.id === placeholderId
                  ? { ...entry, content: event.answer, metadata: event.metadata }
                  : entry
              )
            );
          } else if (event.type === "error") {
            setSendError(event.error);
            setMessages((prev) =>
              prev.map((entry) =>
                entry.id === placeholderId
                  ? { ...entry, content: `I couldn't complete that request: **${event.error}**` }
                  : entry
              )
            );
          }
        }, controller.signal);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setMessages((prev) =>
            prev.map((entry) =>
              entry.id === placeholderId && entry.content === ""
                ? { ...entry, content: "_Generation stopped._" }
                : entry
            )
          );
        } else {
          const message = error instanceof Error ? error.message : "Assistant request failed.";
          setSendError(message);
          setMessages((prev) =>
            prev.map((entry) =>
              entry.id === placeholderId
                ? { ...entry, content: `I couldn't complete that request: **${message}**` }
                : entry
            )
          );
        }
      } finally {
        abortControllerRef.current = null;
        setSending(false);
      }
      return;
    }

    try {
      const response = await postAssistantMessage(payload);
      const assistantEntry: ConversationEntry = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: response.answer,
        metadata: response.metadata,
      };
      setMessages((prev) => [...prev, assistantEntry]);
      setConversationId(response.conversation_id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Assistant request failed.";
      setSendError(message);
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          content: `I couldn't complete that request: **${message}**`,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const submitHandler = (event: React.FormEvent) => {
    event.preventDefault();
    void sendMessage(input);
  };

  const activeFacet = facetDefinitions[facet];
  const activeModelLabel = activeModel?.label ?? "Model";
  const historyLabel = historyDepth === "all" ? "All" : historyDepth;

  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog as="div" className="relative z-40" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 flex justify-end">
          <Transition.Child
            as={Fragment}
            enter="transform transition ease-out duration-200"
            enterFrom="translate-x-full"
            enterTo="translate-x-0"
            leave="transform transition ease-in duration-150"
            leaveFrom="translate-x-0"
            leaveTo="translate-x-full"
          >
            <Dialog.Panel className="flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl dark:bg-slate-950">
              <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
                <div>
                  <Dialog.Title className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    SWFT Assistant
                  </Dialog.Title>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    Project {projectId} · Run {runId}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={resetConversation}
                    className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
                  >
                    New conversation
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-transparent p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    onClick={onClose}
                    aria-label="Close assistant"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="grid flex-1 grid-rows-[auto,1fr,auto] gap-4 overflow-hidden">
                <section className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Assistant configuration</p>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        {activeFacet.label} · {personaLabels[persona]} · {activeModelLabel} · History {historyLabel}
                      </p>
                      {!configExpanded && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">{activeFacet.description}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-expanded={configExpanded}
                      onClick={() => setConfigExpanded((prev) => !prev)}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
                    >
                      {configExpanded ? "Hide settings" : "Show settings"}
                      <ChevronDownIcon className={`h-4 w-4 transition ${configExpanded ? "rotate-180" : "rotate-0"}`} />
                    </button>
                  </div>

                  {configExpanded && (
                    <div className="mt-4 space-y-4">
                      <div>
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Facet</p>
                          <InfoPopover title="Facet context" description="Artifacts automatically loaded for each facet." items={facetHelpItems} />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {facets.map((facetKey) => {
                            const definition = facetDefinitions[facetKey as AssistantFacet];
                            const active = facetKey === facet;
                            return (
                              <button
                                key={facetKey}
                                type="button"
                                onClick={() => {
                                  setFacet(facetKey as AssistantFacet);
                                  setSendError(null);
                                }}
                                className={`flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition ${
                                  active
                                    ? "border-blue-500 bg-blue-500 text-white shadow"
                                    : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-500"
                                }`}
                              >
                                {definition.icon}
                                <span>{definition.label}</span>
                              </button>
                            );
                          })}
                        </div>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{activeFacet.description}</p>
                      </div>

                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="col-span-1">
                          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Persona</p>
                          <div className="mt-2 grid gap-2">
                            {personas.map((personaKey) => {
                              const active = personaKey === persona;
                              return (
                                <button
                                  key={personaKey}
                                  type="button"
                                  onClick={() => setPersona(personaKey)}
                                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
                                    active
                                      ? "border-blue-500 bg-blue-500 text-white shadow"
                                    : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-500"
                                  }`}
                                >
                                  <span className="flex items-center gap-2">
                                    {personaIcons[personaKey]}
                                    {personaLabels[personaKey]}
                                  </span>
                                  {active && <FaceSmileIcon className="h-5 w-5" />}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="col-span-1">
                          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Model</p>
                          <div className="mt-2 grid gap-2">
                            {models.map((model) => {
                              const active = model.key === modelKey;
                              return (
                                <button
                                  key={model.key}
                                  type="button"
                                  onClick={() => setModelKey(model.key)}
                                  className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                                    active
                                      ? "border-blue-500 bg-blue-50 text-blue-700 shadow dark:bg-blue-500/20 dark:text-blue-100"
                                      : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-500"
                                  }`}
                                >
                                  <p className="font-medium">{model.label}</p>
                                  <p className="text-xs text-slate-500 dark:text-slate-400">
                                    {model.response_format === "json" ? "Structured JSON" : "Free-form"}
                                  </p>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="col-span-1">
                          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Context window</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {historyOptions.map((option) => {
                              const active = option.value === historyDepth;
                              return (
                                <button
                                  key={option.label}
                                  type="button"
                                  onClick={() => setHistoryDepth(option.value)}
                                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                                    active
                                      ? "border-blue-500 bg-blue-500 text-white shadow"
                                      : "border-slate-300 bg-white text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500"
                                  }`}
                                >
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>
                          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Choose how many previous messages the assistant should recall.</p>
                        </div>
                      </div>
                    </div>
                  )}
                </section>

                <section className="flex-1 overflow-y-auto px-6 py-4">
                  {loadingConfig && <p className="text-sm text-slate-500">Loading assistant configuration…</p>}
                  {configError && (
                    <div className="rounded-lg border border-rose-400 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-200">
                      {configError}
                    </div>
                  )}

                  <div className="space-y-4">
                    {messages.map((entry) => (
                      <div
                        key={entry.id}
                        className={`flex ${entry.role === "assistant" ? "justify-start" : "justify-end"}`}
                      >
                        <div
                          className={`max-w-xl rounded-2xl px-4 py-3 shadow-sm ${
                            entry.role === "assistant"
                              ? "bg-slate-100 text-slate-900 dark:bg-slate-800/80 dark:text-slate-100"
                              : "bg-blue-500 text-white"
                          }`}
                        >
                          {entry.role === "assistant" ? (
                            entry.content === "" ? (
                              <TypingIndicator />
                            ) : (
                              <MarkdownContent content={entry.content} />
                            )
                          ) : (
                            <p className="text-sm leading-6">{entry.content}</p>
                          )}
                          {entry.metadata && (
                            <footer className="mt-3 border-t border-white/20 pt-2 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-400">
                              Provider: {entry.metadata.provider} · Model: {entry.metadata.model_key} · Chat history sent:{" "}
                              {entry.metadata.history_included}
                            </footer>
                          )}
                        </div>
                      </div>
                    ))}
                    {sending && !canStream && (
                      <div className="flex justify-start">
                        <div className="max-w-xl rounded-2xl bg-slate-100 px-4 py-3 shadow-sm dark:bg-slate-800/80">
                          <TypingIndicator />
                        </div>
                      </div>
                    )}
                    <div ref={bottomRef} />
                  </div>
                </section>

                <section className="border-t border-slate-200 px-6 py-4 dark:border-slate-800">
                  {!!activeFacet.prompts.length && (
                    <div className="mb-3 flex flex-wrap gap-2">
                      {activeFacet.prompts.map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          onClick={() => handleQuickPrompt(prompt)}
                          className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 transition hover:border-blue-300 hover:bg-blue-100 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-200 dark:hover:border-blue-400 dark:hover:bg-blue-500/20"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  )}
                  {sendError && (
                    <div className="mb-3 rounded-md border border-rose-400 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-200">
                      {sendError}
                    </div>
                  )}
                  <form onSubmit={submitHandler} className="flex flex-col gap-3">
                    <textarea
                      className="h-24 w-full resize-none rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring focus:ring-blue-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-blue-400 dark:focus:ring-blue-400/30"
                      placeholder="Ask a question about this run…"
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                          event.preventDefault();
                          if (!sending && input.trim()) {
                            void sendMessage(input);
                          }
                        }
                      }}
                      disabled={sending || !!configError}
                    />
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Responses always cite `app-design.md`, Run Manifest schema, and the selected facet schema.
                      </p>
                      {sending ? (
                        <button
                          type="button"
                          onClick={stopGeneration}
                          className="inline-flex items-center gap-2 rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700"
                          aria-label="Stop generation"
                        >
                          <span className="h-3 w-3 rounded-sm bg-white" aria-hidden="true" />
                          Stop
                        </button>
                      ) : (
                        <button
                          type="submit"
                          disabled={!input.trim() || loadingConfig}
                          className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
                        >
                          Send
                        </button>
                      )}
                    </div>
                  </form>
                </section>
              </div>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition.Root>
  );
};
