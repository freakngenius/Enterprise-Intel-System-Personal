"use client";

// NOTE: No API keys are hardcoded. User-provided keys can be stored in
// localStorage under 'eis_api_key'. To reset: clear localStorage.removeItem(
// 'eis_api_key') or use the Settings menu in the top-right UI.

import Dashboard, { type DashboardData } from "../components/Dashboard";
import {
  BarChart3,
  BookOpen,
  Brain,
  FileSearch,
  GitCompare,
  Search,
  Settings,
  ShieldAlert,
  Sparkles,
  Swords,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChangeEvent,
  CSSProperties,
  DragEvent,
  FormEvent,
  type RefObject,
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";

const INITIAL_INTEL_COMPANY = "OpenAI";
const INITIAL_INTEL_REQUEST =
  "Assess current product momentum, competitive positioning, near-term risks, and the most valuable enterprise opportunities for the next two quarters.";
const COMPARE_START_TOKEN = "[COMPARE_START]";
const TRIAGE_RESULT_TOKEN = "[TRIAGE_RESULT]";
const HANDOFF_RESEARCH_TOKEN = "[HANDOFF_RESEARCH]";
const HANDOFF_COMPARISON_TOKEN = "[HANDOFF_COMPARISON]";
const HANDOFF_SYNTHESIS_TOKEN = "[HANDOFF_SYNTHESIS]";
const CHART_DATA_TOKEN = "[CHART_DATA]";
const USAGE_TOKEN = "[USAGE]";
const SURFACE_RADIUS = "3px";
const SURFACE_RADIUS_STYLE = { borderRadius: SURFACE_RADIUS } as const;
const SCAN_STEP_MS = 100;
const SCAN_DURATION_MS = 800;
const TRIAGE_REVEAL_MS = 1800;
const ASSEMBLY_MESSAGE_MS = 1000;
const SCROLL_DELAY_MS = 300;
const CONNECTOR_FLASH_MS = 1400;
const ACCEPTED_FILE_EXTENSIONS = [".pdf", ".docx", ".csv", ".txt"];
const COMPARE_FOCUS_OPTIONS = [
  "Business Model",
  "Pricing Strategy",
  "Product Roadmap",
  "Features & Capabilities",
  "Company Size",
  "Funds Raised & Stage",
  "Marketing & GTM",
  "Target Demographics",
  "Technology Stack",
  "Talent & Culture",
  "Regulatory & Compliance",
  "Other",
] as const;
const OTHER_COMPARE_FOCUS = "Other";
const REPORT_STORAGE_KEY = "eis_reports";

type Mode = "intel" | "compare";
type ActiveView = "intel" | "dashboard" | "reports" | "research";
type RosterPhase = "idle" | "scanning" | "triage" | "assembled";
type StreamStage = "idle" | "context" | "research" | "comparison" | "synthesis";
type AgentCardState = "active" | "complete" | "waiting";
type SpecialistAgentId =
  | "recon"
  | "financial"
  | "competitor"
  | "risk"
  | "people";
type AgentId =
  | "triage"
  | "context"
  | SpecialistAgentId
  | "research"
  | "comparison"
  | "chart"
  | "synthesis";

type UsageStats = {
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
};

type TriageSelection = {
  agents: SpecialistAgentId[];
  reasoning: string;
};

type SpecialistOutputs = Record<SpecialistAgentId, string>;

type AgentConfig = {
  description: string;
  glowColor: string;
  icon: LucideIcon;
  id: AgentId;
  name: string;
  accentColor: string;
};

type ParsedSseEvent = {
  data: string;
  event: string;
};
type CompareFocusArea = (typeof COMPARE_FOCUS_OPTIONS)[number];
type ResolutionTarget = "intel" | "base" | "target";
type ResolutionMode = "intel" | "compare";

type CompanyResolutionMatch = {
  confidence?: "high" | "medium" | "low" | string;
  description?: string;
  domain?: string;
  industry?: string;
  name?: string;
  stage?: string;
};

type CompanyResolutionStep = {
  companyName: string;
  matches: CompanyResolutionMatch[];
  mode: ResolutionMode;
  target: ResolutionTarget;
};

type PendingIntelRun = {
  company: string;
  companyUrl: string | null;
  mode: "intel";
  request: string;
};

type PendingCompareRun = {
  baseCompany: string;
  baseUrl: string | null;
  competitorCompany: string;
  customFocus: string | null;
  files: File[];
  focusAreas: string[];
  mode: "compare";
  targetUrl: string | null;
};

type PendingRun = PendingIntelRun | PendingCompareRun;

type SavedReport = {
  agentsUsed: string[];
  chartData?: DashboardData;
  compareTarget?: string;
  comparisonOutput?: string;
  company: string;
  contextOutput?: string;
  costUsd?: number;
  createdAt: string;
  id: string;
  mode: Mode;
  researchOutput: string;
  synthesisOutput: string;
  tokenCount?: number;
  usageStats?: UsageStats;
};

function readSavedReports(): SavedReport[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(REPORT_STORAGE_KEY);
    const parsed = JSON.parse(rawValue || "[]") as SavedReport[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function createSavedReportId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `report-${Date.now()}`;
}

function formatTodayLabel() {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "America/Guayaquil",
  }).format(new Date());
}

function getReportUsage(report: SavedReport | null | undefined): UsageStats | null {
  if (!report) {
    return null;
  }

  if (report.usageStats) {
    return report.usageStats;
  }

  if (report.tokenCount || report.costUsd) {
    return {
      cost_usd: report.costUsd ?? 0,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: report.tokenCount ?? 0,
    };
  }

  return null;
}

function CreatorCredit() {
  return (
    <p className="mt-1 text-xs text-gray-600">
      Made by{" "}
      <a
        className="text-gray-500 underline underline-offset-2 hover:text-gray-300"
        href="https://www.linkedin.com/in/kylekesterson/"
        rel="noopener noreferrer"
        target="_blank"
      >
        Kyle Kesterson
      </a>{" "}
      |{" "}
      <a
        className="text-gray-500 underline underline-offset-2 hover:text-gray-300"
        href="https://www.demystified.ai/"
        rel="noopener noreferrer"
        target="_blank"
      >
        Demystified.ai
      </a>
    </p>
  );
}

const SPECIALIST_AGENT_IDS: SpecialistAgentId[] = [
  "recon",
  "financial",
  "competitor",
  "risk",
  "people",
];

const AGENT_CONFIGS: Record<AgentId, AgentConfig> = {
  triage: {
    id: "triage",
    name: "Triage",
    description: "Selects the specialist team for the request.",
    icon: Brain,
    accentColor: "#facc15",
    glowColor: "rgba(250, 204, 21, 0.35)",
  },
  context: {
    id: "context",
    name: "Context",
    description: "Builds the base company profile from docs and web context.",
    icon: BookOpen,
    accentColor: "#f59e0b",
    glowColor: "rgba(245, 158, 11, 0.35)",
  },
  recon: {
    id: "recon",
    name: "Recon",
    description: "Finds recent news, announcements, and developments.",
    icon: Search,
    accentColor: "#eab308",
    glowColor: "rgba(234, 179, 8, 0.35)",
  },
  financial: {
    id: "financial",
    name: "Financial",
    description: "Pulls revenue, funding, valuation, and investor signals.",
    icon: TrendingUp,
    accentColor: "#4ade80",
    glowColor: "rgba(74, 222, 128, 0.35)",
  },
  competitor: {
    id: "competitor",
    name: "Competitor",
    description: "Maps direct rivals, alternatives, and positioning gaps.",
    icon: Swords,
    accentColor: "#60a5fa",
    glowColor: "rgba(96, 165, 250, 0.35)",
  },
  risk: {
    id: "risk",
    name: "Risk",
    description: "Flags legal, regulatory, controversy, and red flags.",
    icon: ShieldAlert,
    accentColor: "#f87171",
    glowColor: "rgba(248, 113, 113, 0.35)",
  },
  people: {
    id: "people",
    name: "People",
    description: "Profiles leadership, founders, and executive moves.",
    icon: Users,
    accentColor: "#c084fc",
    glowColor: "rgba(192, 132, 252, 0.35)",
  },
  research: {
    id: "research",
    name: "Research",
    description: "Aggregates the gathered intelligence into a memo.",
    icon: FileSearch,
    accentColor: "#34d399",
    glowColor: "rgba(52, 211, 153, 0.35)",
  },
  comparison: {
    id: "comparison",
    name: "Comparison",
    description: "Generates the head-to-head strategic comparison.",
    icon: GitCompare,
    accentColor: "#fb7185",
    glowColor: "rgba(251, 113, 133, 0.35)",
  },
  chart: {
    id: "chart",
    name: "Chart",
    description: "Structures dashboard-ready data from the final brief.",
    icon: BarChart3,
    accentColor: "#818cf8",
    glowColor: "rgba(129, 140, 248, 0.35)",
  },
  synthesis: {
    id: "synthesis",
    name: "Synthesis",
    description: "Turns the memo into a board-ready executive brief.",
    icon: Sparkles,
    accentColor: "#22d3ee",
    glowColor: "rgba(34, 211, 238, 0.35)",
  },
};

const INTEL_ROSTER_IDS: AgentId[] = [
  "triage",
  "recon",
  "financial",
  "competitor",
  "risk",
  "people",
  "research",
  "synthesis",
  "chart",
];

const COMPARE_ROSTER_IDS: AgentId[] = [
  "context",
  "recon",
  "financial",
  "competitor",
  "risk",
  "people",
  "research",
  "comparison",
  "synthesis",
  "chart",
];

function createEmptySpecialistOutputs(): SpecialistOutputs {
  return {
    competitor: "",
    financial: "",
    people: "",
    recon: "",
    risk: "",
  };
}

function getAgentConfig(agentId: AgentId): AgentConfig {
  return AGENT_CONFIGS[agentId];
}

function isAgentId(value: string): value is AgentId {
  return value in AGENT_CONFIGS;
}

function isSpecialistAgent(agentId: AgentId): agentId is SpecialistAgentId {
  return SPECIALIST_AGENT_IDS.includes(agentId as SpecialistAgentId);
}

function normalizeSpecialistAgent(rawValue: string): SpecialistAgentId | null {
  const normalized = rawValue.trim().toLowerCase();
  return SPECIALIST_AGENT_IDS.includes(normalized as SpecialistAgentId)
    ? (normalized as SpecialistAgentId)
    : null;
}

function parseTriageSelection(rawValue: string): TriageSelection | null {
  try {
    const parsed = JSON.parse(rawValue) as {
      agents?: string[];
      reasoning?: string;
    };
    const selectedAgents = SPECIALIST_AGENT_IDS.filter((agentId) =>
      new Set(
        (parsed.agents ?? []).map((value) => value.trim().toLowerCase()),
      ).has(agentId),
    );

    if (!selectedAgents.includes("recon")) {
      selectedAgents.unshift("recon");
    }

    return {
      agents: selectedAgents,
      reasoning: parsed.reasoning?.trim() || "Triage assembled the specialist team.",
    };
  } catch {
    return null;
  }
}

function getCompareSelectedSpecialists(
  focusAreas: string[],
  customFocus?: string | null,
): SpecialistAgentId[] {
  if (!focusAreas.length && !customFocus?.trim()) {
    return SPECIALIST_AGENT_IDS.slice();
  }

  const selected = new Set<SpecialistAgentId>(["recon"]);

  if (
    focusAreas.includes("Business Model") ||
    focusAreas.includes("Pricing Strategy") ||
    focusAreas.includes("Company Size") ||
    focusAreas.includes("Funds Raised & Stage")
  ) {
    selected.add("financial");
  }

  if (focusAreas.includes("Talent & Culture")) {
    selected.add("people");
  }

  if (focusAreas.includes("Regulatory & Compliance")) {
    selected.add("risk");
  }

  return SPECIALIST_AGENT_IDS.filter((agentId) => selected.has(agentId));
}

function normalizeUrlForContext(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function getDisplayDomain(value: string): string {
  const normalized = normalizeUrlForContext(value);

  try {
    return new URL(normalized).host.replace(/^www\./, "");
  } catch {
    return value.replace(/^https?:\/\//i, "").replace(/^www\./, "");
  }
}

function buildAnalyzeUrl(
  company: string,
  request: string,
  companyUrl?: string,
  apiKey?: string,
): string {
  const params = new URLSearchParams({ company, request });
  if (companyUrl?.trim()) {
    params.set("company_url", companyUrl.trim());
  }
  if (apiKey?.trim()) {
    params.set("api_key", apiKey.trim());
  }
  return `/api/analyze?${params.toString()}`;
}

function parseSseBlock(block: string): ParsedSseEvent | null {
  if (!block.trim()) {
    return null;
  }

  let event = "message";
  const dataLines: string[] = [];

  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }

  return {
    data: dataLines.join("\n"),
    event,
  };
}

function getPipelineCardStyle(
  state: AgentCardState,
  accentColor: string,
  glowColor: string,
): CSSProperties {
  if (state === "active") {
    return {
      ...SURFACE_RADIUS_STYLE,
      boxShadow: `inset 4px 0 0 ${accentColor}, 0 0 28px ${glowColor}`,
    };
  }

  if (state === "complete") {
    return {
      ...SURFACE_RADIUS_STYLE,
      boxShadow: `inset 4px 0 0 ${accentColor}`,
    };
  }

  return SURFACE_RADIUS_STYLE;
}

function buildMarkdownComponents(variant: "screen" | "print") {
  const isPrint = variant === "print";

  return {
    h1: ({ children }: any) => <h1>{children}</h1>,
    h2: ({ children }: any) => <h2>{children}</h2>,
    h3: ({ children }: any) => <h3>{children}</h3>,
    p: ({ children }: any) => <p>{children}</p>,
    ul: ({ children }: any) => <ul>{children}</ul>,
    ol: ({ children }: any) => <ol>{children}</ol>,
    li: ({ children }: any) => <li>{children}</li>,
    strong: ({ children }: any) => <strong>{children}</strong>,
    em: ({ children }: any) => <em>{children}</em>,
    a: ({ children, href }: any) => (
      <a href={href} rel="noreferrer" target={isPrint ? undefined : "_blank"}>
        {children}
      </a>
    ),
    hr: () => <hr />,
    code: ({ children }: any) => <code>{children}</code>,
    table: ({ ...props }: any) => (
      <table
        className={`my-4 w-full border-collapse ${
          isPrint ? "text-[10pt]" : "text-sm"
        }`}
        {...props}
      />
    ),
    th: ({ ...props }: any) => (
      <th
        className={
          isPrint
            ? "border border-gray-300 px-3 py-2 text-left font-semibold text-black"
            : "border border-gray-600 bg-gray-800 px-3 py-2 text-left font-semibold text-white"
        }
        {...props}
      />
    ),
    td: ({ ...props }: any) => (
      <td
        className={
          isPrint
            ? "border border-gray-300 px-3 py-2 text-black"
            : "border border-gray-700 px-3 py-2 text-gray-300"
        }
        {...props}
      />
    ),
    tr: ({ ...props }: any) => (
      <tr className={isPrint ? "" : "even:bg-gray-900"} {...props} />
    ),
  };
}

function MarkdownDocument({
  content,
  placeholder,
}: {
  content: string;
  placeholder: string;
}) {
  if (!content.trim()) {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm leading-7 text-[#a6a39b]">
        {placeholder}
      </div>
    );
  }

  return (
    <div className="markdown-body agent-markdown max-w-none">
      <ReactMarkdown components={buildMarkdownComponents("screen")} remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

function PrintMarkdownDocument({ content }: { content: string }) {
  return (
    <div className="markdown-body print-markdown max-w-none text-black">
      <ReactMarkdown components={buildMarkdownComponents("print")} remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

function InlineResolvingStatus({ label }: { label: string }) {
  return (
    <div className="mt-2 inline-flex items-center gap-2 text-xs text-[#9f9b92]">
      <span className="h-2 w-2 animate-pulse rounded-full bg-[#9f9b92]" />
      <span>{label}</span>
    </div>
  );
}

function AgentStatusBadge({
  state,
  accentColor,
  waitingLabel,
}: {
  state: AgentCardState;
  accentColor: string;
  waitingLabel: string;
}) {
  if (state === "complete") {
    return (
      <div
        className="inline-flex items-center gap-2 border border-[#34312d] bg-[#1b1a18] px-3 py-1 text-xs uppercase tracking-[0.22em] text-[#d6d2ca] print:hidden"
        style={SURFACE_RADIUS_STYLE}
      >
        <span className="text-sm leading-none text-[#f3f1ea]">✓</span>
        Complete
      </div>
    );
  }

  if (state === "active") {
    return (
      <div
        className="inline-flex items-center gap-2 border border-[#34312d] bg-[#1b1a18] px-3 py-1 text-xs uppercase tracking-[0.22em] text-[#ebe8e1] print:hidden"
        style={SURFACE_RADIUS_STYLE}
      >
        <span
          className="h-2.5 w-2.5 rounded-full animate-pulse"
          style={{ backgroundColor: accentColor }}
        />
        Active
      </div>
    );
  }

  return (
    <div
      className="inline-flex items-center gap-2 border border-[#34312d] bg-[#1b1a18] px-3 py-1 text-xs uppercase tracking-[0.22em] text-[#9f9b92] print:hidden"
      style={SURFACE_RADIUS_STYLE}
    >
      <span className="h-2.5 w-2.5 rounded-full bg-gray-400" />
      {waitingLabel}
    </div>
  );
}

function UsageSummary({
  centered = false,
  usageStats,
}: {
  centered?: boolean;
  usageStats: UsageStats;
}) {
  const numberFormatter = new Intl.NumberFormat();

  return (
    <div
      className={`border-t border-[#2c2a27] pt-3 text-xs leading-6 text-[#a7a39a] ${
        centered ? "mx-auto flex w-fit flex-col items-center text-center" : ""
      }`}
    >
      <p className="font-mono text-[#d7d3cb]">
        <span className="font-semibold text-[#f3f1ea]">Tokens:</span>{" "}
        {numberFormatter.format(usageStats.total_tokens)} total (
        {numberFormatter.format(usageStats.input_tokens)} in /{" "}
        {numberFormatter.format(usageStats.output_tokens)} out)
      </p>
      <p className="font-mono text-[#d7d3cb]">
        <span className="font-semibold text-[#f3f1ea]">Cost:</span> $
        {usageStats.cost_usd.toFixed(4)}
      </p>
    </div>
  );
}

function ReportsView({
  onGraphs,
  pendingDeleteReportId,
  reports,
  onDelete,
  onDownload,
  onView,
}: {
  onGraphs: (report: SavedReport) => void;
  pendingDeleteReportId: string | null;
  reports: SavedReport[];
  onDelete: (reportId: string) => void;
  onDownload: (report: SavedReport) => void;
  onView: (report: SavedReport) => void;
}) {
  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const tokenFormatter = new Intl.NumberFormat();

  return (
    <section
      className="space-y-5 border border-[#282623] bg-[#161513] px-6 py-6"
      style={SURFACE_RADIUS_STYLE}
    >
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-[#f3f1ea]">REPORTS HISTORY</h2>
        <p className="mt-1 text-xs text-gray-600">
          Reports are stored locally in your browser. Clearing browser data will
          remove them.
        </p>
        <div className="border-t border-[#2a2d36]" />
      </div>

      {!reports.length ? (
        <div className="flex min-h-[16rem] items-center justify-center text-center">
          <p className="text-sm text-[#9f9b92]">
            No reports yet — run an analysis to save your first report
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => {
            const agentNames = report.agentsUsed
              .map((agentId) =>
                isAgentId(agentId) ? getAgentConfig(agentId).name : agentId,
              )
              .join(", ");

            return (
              <article
                key={report.id}
                className="mb-3 border border-[#2a2d36] bg-[#13161e] p-4"
                style={SURFACE_RADIUS_STYLE}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-semibold text-white">
                        {report.mode === "compare" && report.compareTarget
                          ? `${report.company} vs ${report.compareTarget}`
                          : report.company}
                      </p>
                      <span
                        className="border border-[#343846] bg-[#191d27] px-2 py-1 text-[0.68rem] uppercase tracking-[0.2em] text-gray-300"
                        style={SURFACE_RADIUS_STYLE}
                      >
                        {report.mode}
                      </span>
                    </div>
                    <p className="text-sm text-gray-400">Agents: {agentNames}</p>
                    <p className="font-mono text-xs text-gray-500">
                      {tokenFormatter.format(report.tokenCount ?? 0)} tokens · $
                      {(report.costUsd ?? 0).toFixed(2)}
                    </p>
                  </div>

                  <div className="space-y-3 text-right">
                    <p className="text-sm text-gray-500">
                      {dateFormatter.format(new Date(report.createdAt))}
                    </p>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        className="border border-[#34312d] bg-[#1b1a18] px-3 py-1.5 text-xs text-[#ddd9d1] transition hover:bg-[#24221f]"
                        onClick={() => onView(report)}
                        style={SURFACE_RADIUS_STYLE}
                        type="button"
                      >
                        View
                      </button>
                      <button
                        className="border border-[#34312d] bg-[#1b1a18] px-3 py-1.5 text-xs text-[#ddd9d1] transition hover:bg-[#24221f]"
                        onClick={() => onGraphs(report)}
                        style={SURFACE_RADIUS_STYLE}
                        type="button"
                      >
                        Graphs
                      </button>
                      <button
                        className="border border-[#34312d] bg-[#1b1a18] px-3 py-1.5 text-xs text-[#ddd9d1] transition hover:bg-[#24221f]"
                        onClick={() => onDownload(report)}
                        style={SURFACE_RADIUS_STYLE}
                        type="button"
                      >
                        Download
                      </button>
                      <button
                        className="border border-[#4a2d2d] bg-[#241515] px-3 py-1.5 text-xs text-[#f0c7c7] transition hover:bg-[#301b1b]"
                        onClick={() => onDelete(report.id)}
                        style={SURFACE_RADIUS_STYLE}
                        type="button"
                      >
                        {pendingDeleteReportId === report.id ? "Confirm?" : "Delete"}
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ResearchView({
  isMemoOpen,
  onToggleMemo,
  onDownload,
  researchMemo,
  synthesisMemo,
  usageStats,
}: {
  isMemoOpen: boolean;
  onDownload: () => void;
  onToggleMemo: () => void;
  researchMemo: string;
  synthesisMemo: string;
  usageStats: UsageStats | null;
}) {
  if (!synthesisMemo.trim()) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-500">
        <span className="font-mono">Run an analysis to populate Research.</span>
      </div>
    );
  }

  return (
    <section
      className="max-h-[calc(100vh-120px)] space-y-6 overflow-y-auto border border-[#282623] bg-[#161513] px-6 py-4"
      style={SURFACE_RADIUS_STYLE}
    >
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-[#f3f1ea]">RESEARCH VIEW</h2>
        <div className="border-t border-[#2a2d36]" />
      </div>

      <section className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.28em] text-gray-500">
            Executive Brief
          </p>
          <div className="border-t border-[#2a2d36]" />
        </div>
        <div className="markdown-body max-w-none">
          <ReactMarkdown
            components={buildMarkdownComponents("screen")}
            remarkPlugins={[remarkGfm]}
          >
            {synthesisMemo}
          </ReactMarkdown>
        </div>
      </section>

      <section className="space-y-4">
        <button
          className="flex w-full items-center justify-between border-b border-[#2a2d36] pb-3 text-left"
          onClick={onToggleMemo}
          type="button"
        >
          <span className="text-xs uppercase tracking-[0.28em] text-gray-500">
            Research Memo
          </span>
          <span className="text-sm text-gray-300">{isMemoOpen ? "▼" : "▶"}</span>
        </button>

        {isMemoOpen ? (
          <div className="markdown-body max-w-none">
            <ReactMarkdown
              components={buildMarkdownComponents("screen")}
              remarkPlugins={[remarkGfm]}
            >
              {researchMemo || "_No research memo available._"}
            </ReactMarkdown>
          </div>
        ) : null}
      </section>

      {usageStats ? (
        <div className="pt-2">
          <div className="mt-5 flex flex-col items-center gap-3">
            <button
              className="inline-flex items-center justify-center border border-[#34312d] bg-[#2a2825] px-4 py-3 text-sm font-semibold text-[#f3f1ea] transition hover:bg-[#34312d]"
              onClick={onDownload}
              style={SURFACE_RADIUS_STYLE}
              type="button"
            >
              Download Analysis
            </button>
            <UsageSummary centered usageStats={usageStats} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PipelineConnector({
  active,
  accentColor,
  label = "HANDOFF",
}: {
  active: boolean;
  accentColor: string;
  label?: string;
}) {
  const inactiveColor = "rgba(156, 163, 175, 0.75)";

  return (
    <div className="flex flex-col items-center gap-2 py-2 print:hidden">
      <div
        className={active ? "h-6 w-px animate-pulse" : "h-6 w-px"}
        style={{ backgroundColor: active ? accentColor : inactiveColor }}
      />
      <div
        className={`inline-flex min-w-32 flex-col items-center gap-1 border px-4 py-2 text-[0.68rem] uppercase tracking-[0.28em] transition ${
          active
            ? "animate-pulse bg-[#24221f] text-[#f3f1ea]"
            : "bg-[#161513] text-[#9f9b92]"
        }`}
        style={{
          ...SURFACE_RADIUS_STYLE,
          borderColor: active ? accentColor : "#35322f",
          boxShadow: active ? `0 0 20px ${accentColor}22` : "none",
        }}
      >
        <span>{label}</span>
        <span className="text-sm leading-none">↓</span>
      </div>
      <div
        className={active ? "h-6 w-px animate-pulse" : "h-6 w-px"}
        style={{ backgroundColor: active ? accentColor : inactiveColor }}
      />
    </div>
  );
}

function PipelineCard({
  accentColor,
  bodyRef,
  content,
  glowColor,
  state,
  subtitle,
  title,
  waitingLabel,
  placeholder,
}: {
  accentColor: string;
  bodyRef: RefObject<HTMLDivElement | null>;
  content: string;
  glowColor: string;
  state: AgentCardState;
  subtitle: string;
  title: string;
  waitingLabel: string;
  placeholder: string;
}) {
  return (
    <article
      className={`overflow-hidden border border-[#282623] bg-[#161513] transition duration-300 ${
        state === "waiting" ? "opacity-60" : "opacity-100"
      }`}
      style={getPipelineCardStyle(state, accentColor, glowColor)}
    >
      <div className="flex items-center justify-between border-b border-[#282623] px-5 py-4">
        <div className="flex items-center gap-3">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              state === "active" ? "animate-pulse" : ""
            }`}
            style={{
              backgroundColor: state === "waiting" ? "#9ca3af" : accentColor,
              boxShadow:
                state === "active"
                  ? `0 0 18px ${accentColor}`
                  : "none",
            }}
          />
          <div>
            <h3 className="text-base font-semibold text-[#f3f1ea]">{title}</h3>
            <p className="mt-1 text-xs uppercase tracking-[0.22em] text-[#9f9b92]">
              {subtitle}
            </p>
          </div>
        </div>
        <AgentStatusBadge
          accentColor={accentColor}
          state={state}
          waitingLabel={waitingLabel}
        />
      </div>
      <div
        className="h-[24rem] overflow-y-auto bg-[#161513] px-5 py-5"
        ref={bodyRef}
      >
        <MarkdownDocument content={content} placeholder={placeholder} />
      </div>
    </article>
  );
}

function RosterCard({
  active,
  complete,
  dimmed,
  highlight,
  isScanHighlight,
  agentId,
  onRef,
}: {
  active: boolean;
  complete: boolean;
  dimmed: boolean;
  highlight: boolean;
  isScanHighlight: boolean;
  agentId: AgentId;
  onRef: (element: HTMLDivElement | null) => void;
}) {
  const agent = getAgentConfig(agentId);
  const Icon = agent.icon;

  let borderColor = "rgba(107, 114, 128, 1)";
  let boxShadow = "none";

  if (isScanHighlight) {
    borderColor = "rgba(229, 231, 235, 0.95)";
    boxShadow = "0 0 20px rgba(229, 231, 235, 0.16)";
  }

  if (highlight) {
    borderColor = `${agent.accentColor}99`;
    boxShadow = `inset 0 0 0 1px ${agent.accentColor}66`;
  }

  if (complete) {
    borderColor = agent.accentColor;
    boxShadow = `inset 0 0 0 1px ${agent.accentColor}`;
  }

  if (active) {
    borderColor = agent.accentColor;
    boxShadow = `inset 0 0 0 1px ${agent.accentColor}, 0 0 28px ${agent.glowColor}`;
  }

  return (
    <div
      className={`relative flex min-h-[120px] flex-col border bg-[#1a1917] p-4 transition-all duration-300 ${
        dimmed ? "opacity-50" : "opacity-100"
      }`}
      ref={onRef}
      style={{
        ...SURFACE_RADIUS_STYLE,
        borderColor,
        boxShadow,
      }}
    >
      <div className="absolute right-3 top-3">
        {complete ? (
          <span className="text-sm font-semibold text-white">✓</span>
        ) : (
          <span
            className={`block h-2.5 w-2.5 rounded-full ${active ? "animate-pulse" : ""}`}
            style={{
              backgroundColor:
                active || highlight ? agent.accentColor : "#9ca3af",
              boxShadow: active ? `0 0 14px ${agent.glowColor}` : "none",
            }}
          />
        )}
      </div>

      <div className="flex flex-1 items-center justify-center">
        <Icon className="h-8 w-8 text-[#b5b1a8]" strokeWidth={1.75} />
      </div>

      <div className="space-y-1">
        <p className="text-[0.68rem] uppercase tracking-[0.28em] text-[#f3f1ea]">
          {agent.name}
        </p>
        <p className="text-[0.68rem] leading-4 text-[#a8a49b]">
          {agent.description}
        </p>
      </div>
    </div>
  );
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("intel");
  const [activeView, setActiveView] = useState<ActiveView>("intel");

  const [intelCompany, setIntelCompany] = useState(INITIAL_INTEL_COMPANY);
  const [intelCompanyUrl, setIntelCompanyUrl] = useState("");
  const [intelRequest, setIntelRequest] = useState(INITIAL_INTEL_REQUEST);

  const [baseCompany, setBaseCompany] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [competitorCompany, setCompetitorCompany] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [compareFocusAreas, setCompareFocusAreas] = useState<CompareFocusArea[]>(
    [],
  );
  const [compareCustomFocus, setCompareCustomFocus] = useState("");
  const [compareFiles, setCompareFiles] = useState<File[]>([]);
  const [resolvedIntelDomain, setResolvedIntelDomain] = useState<string | null>(null);
  const [resolvedBaseDomain, setResolvedBaseDomain] = useState<string | null>(null);
  const [resolvedTargetDomain, setResolvedTargetDomain] = useState<string | null>(null);
  const [resolvingLookup, setResolvingLookup] = useState<Record<ResolutionTarget, boolean>>({
    intel: false,
    base: false,
    target: false,
  });
  const [resolutionSteps, setResolutionSteps] = useState<CompanyResolutionStep[]>([]);
  const [currentResolutionIndex, setCurrentResolutionIndex] = useState(0);
  const [selectedResolutionDomain, setSelectedResolutionDomain] = useState<string | null>(
    null,
  );

  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
  const [chartData, setChartData] = useState<DashboardData | null>(null);
  const [lastAnalysisOutput, setLastAnalysisOutput] = useState<string | null>(null);
  const [isPrintingDashboard, setIsPrintingDashboard] = useState(false);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [pendingDeleteReportId, setPendingDeleteReportId] = useState<string | null>(null);
  const [status, setStatus] = useState("Idle");
  const [focusAgent, setFocusAgent] = useState<AgentId>("triage");
  const [isLoading, setIsLoading] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [todayLabel, setTodayLabel] = useState("");
  const [storedApiKey, setStoredApiKey] = useState("");
  const [showApiMenu, setShowApiMenu] = useState(false);
  const [showApiKeyPrompt, setShowApiKeyPrompt] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [hasHydrated, setHasHydrated] = useState(false);
  const [isResearchMemoOpen, setIsResearchMemoOpen] = useState(false);
  const [activeReport, setActiveReport] = useState<SavedReport | null>(null);

  const [rosterPhase, setRosterPhase] = useState<RosterPhase>("idle");
  const [rosterMessage, setRosterMessage] = useState("");
  const [scanIndex, setScanIndex] = useState<number | null>(null);
  const [compareRosterActivated, setCompareRosterActivated] = useState(false);

  const [completedAgents, setCompletedAgents] = useState<Set<AgentId>>(
    () => new Set(),
  );
  const [activeAgents, setActiveAgents] = useState<Set<AgentId>>(
    () => new Set(),
  );
  const [selectedSpecialists, setSelectedSpecialists] = useState<
    SpecialistAgentId[]
  >([]);
  const [triageReasoning, setTriageReasoning] = useState("");
  const [selectedSpecialistTab, setSelectedSpecialistTab] = useState<
    SpecialistAgentId | null
  >(null);
  const [specialistOutputs, setSpecialistOutputs] = useState<SpecialistOutputs>(
    createEmptySpecialistOutputs(),
  );
  const [specialistPanelCollapsed, setSpecialistPanelCollapsed] = useState(false);

  const [contextOutput, setContextOutput] = useState("");
  const [researchOutput, setResearchOutput] = useState("");
  const [comparisonOutput, setComparisonOutput] = useState("");
  const [synthesisOutput, setSynthesisOutput] = useState("");
  const [streamStage, setStreamStage] = useState<StreamStage>("idle");

  const [specialistResearchHandoffLive, setSpecialistResearchHandoffLive] =
    useState(false);
  const [researchComparisonHandoffLive, setResearchComparisonHandoffLive] =
    useState(false);
  const [researchSynthesisHandoffLive, setResearchSynthesisHandoffLive] =
    useState(false);
  const [comparisonSynthesisHandoffLive, setComparisonSynthesisHandoffLive] =
    useState(false);

  const sourceRef = useRef<EventSource | null>(null);
  const compareAbortRef = useRef<AbortController | null>(null);
  const rosterCardRefs = useRef<Partial<Record<AgentId, HTMLDivElement | null>>>(
    {},
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const specialistPanelRef = useRef<HTMLDivElement | null>(null);
  const specialistPanelBodyRef = useRef<HTMLDivElement | null>(null);
  const contextCardRef = useRef<HTMLElement | null>(null);
  const contextBodyRef = useRef<HTMLDivElement | null>(null);
  const researchCardRef = useRef<HTMLElement | null>(null);
  const researchBodyRef = useRef<HTMLDivElement | null>(null);
  const comparisonCardRef = useRef<HTMLElement | null>(null);
  const comparisonBodyRef = useRef<HTMLDivElement | null>(null);
  const synthesisCardRef = useRef<HTMLElement | null>(null);
  const synthesisBodyRef = useRef<HTMLDivElement | null>(null);

  const stageRef = useRef<StreamStage>("idle");
  const currentRunModeRef = useRef<Mode>("intel");
  const expectedCloseRef = useRef(false);
  const doneReceivedRef = useRef(false);
  const scanIntervalRef = useRef<number | null>(null);
  const sequenceTimeoutsRef = useRef<number[]>([]);
  const assemblyMessageTimeoutRef = useRef<number | null>(null);
  const pendingTriageSelectionRef = useRef<TriageSelection | null>(null);
  const phase3UnlockedRef = useRef(false);
  const activeScrollTimeoutRef = useRef<number | null>(null);
  const connectorTimeoutsRef = useRef<number[]>([]);
  const pendingRunRef = useRef<PendingRun | null>(null);
  const resolutionRequestIdRef = useRef(0);
  const printRestoreViewRef = useRef<ActiveView>("intel");
  const pendingDeleteTimeoutRef = useRef<number | null>(null);
  const runAgentsRef = useRef<string[]>([]);
  const researchOutputRef = useRef("");
  const synthesisOutputRef = useRef("");
  const comparisonOutputRef = useRef("");
  const contextOutputRef = useRef("");
  const chartDataRef = useRef<DashboardData | null>(null);
  const reportSavedForRunRef = useRef(false);
  const apiMenuRef = useRef<HTMLDivElement | null>(null);

  const deferredContextOutput = useDeferredValue(contextOutput);
  const deferredResearchOutput = useDeferredValue(researchOutput);
  const deferredComparisonOutput = useDeferredValue(comparisonOutput);
  const deferredSynthesisOutput = useDeferredValue(synthesisOutput);

  const displayedRosterIds =
    mode === "intel" ? INTEL_ROSTER_IDS : COMPARE_ROSTER_IDS;
  const focusAgentLabel = getAgentConfig(focusAgent).name;
  const printIntelCompany = intelCompany.trim() || "Company Analysis";
  const printBaseCompany = baseCompany.trim() || "Base Company";
  const printCompetitorCompany = competitorCompany.trim() || "Competitor";
  const otherFocusSelected = compareFocusAreas.includes(OTHER_COMPARE_FOCUS);
  const currentResolution = resolutionSteps[currentResolutionIndex] ?? null;
  const isResolvingCompanies =
    resolvingLookup.intel || resolvingLookup.base || resolvingLookup.target;
  const displayInitials = storedApiKey
    ? storedApiKey.slice(-4).toUpperCase()
    : "EIS";
  const displayName = "My Workspace";
  const displayRole = storedApiKey
    ? `API Key: ....${storedApiKey.slice(-6)}`
    : "API Key: not set";
  const activeApiKeyPreview = storedApiKey
    ? `...${storedApiKey.slice(-8)}`
    : "Not set";
  const latestResearchReport =
    activeReport ??
    savedReports.find((report) => report.synthesisOutput.trim()) ??
    null;
  const researchViewSynthesisOutput =
    synthesisOutput.trim() || latestResearchReport?.synthesisOutput || "";
  const researchViewResearchOutput =
    researchOutput.trim() || latestResearchReport?.researchOutput || "";
  const dashboardViewData =
    chartData || latestResearchReport?.chartData || null;
  const loadedUsageStats = usageStats || getReportUsage(latestResearchReport);
  const hasNavigableSections =
    Boolean(synthesisOutput.trim()) || savedReports.length > 0;

  const assembledAgentIds =
    mode === "intel"
      ? new Set<AgentId>(
          selectedSpecialists.length
            ? (["triage", "research", "synthesis", "chart", ...selectedSpecialists] as AgentId[])
            : [],
        )
      : compareRosterActivated
        ? new Set<AgentId>(
            [
              "context",
              "research",
              "comparison",
              "synthesis",
              "chart",
              ...selectedSpecialists,
            ] as AgentId[],
          )
        : new Set<AgentId>();

  const contextCardState: AgentCardState = activeAgents.has("context")
    ? "active"
    : completedAgents.has("context") || contextOutput.trim()
      ? "complete"
      : "waiting";

  const researchCardState: AgentCardState = activeAgents.has("research")
    ? "active"
    : completedAgents.has("research") || researchOutput.trim()
      ? "complete"
      : "waiting";

  const comparisonCardState: AgentCardState = activeAgents.has("comparison")
    ? "active"
    : completedAgents.has("comparison") || comparisonOutput.trim()
      ? "complete"
      : "waiting";

  const synthesisCardState: AgentCardState = activeAgents.has("synthesis")
    ? "active"
    : completedAgents.has("synthesis") || (isDone && synthesisOutput.trim())
      ? "complete"
      : "waiting";

  function clearSequenceTimers() {
    if (scanIntervalRef.current !== null) {
      window.clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }

    if (assemblyMessageTimeoutRef.current !== null) {
      window.clearTimeout(assemblyMessageTimeoutRef.current);
      assemblyMessageTimeoutRef.current = null;
    }

    sequenceTimeoutsRef.current.forEach((timeoutId) =>
      window.clearTimeout(timeoutId),
    );
    sequenceTimeoutsRef.current = [];
  }

  function clearConnectorFlashes() {
    connectorTimeoutsRef.current.forEach((timeoutId) =>
      window.clearTimeout(timeoutId),
    );
    connectorTimeoutsRef.current = [];
    setSpecialistResearchHandoffLive(false);
    setResearchComparisonHandoffLive(false);
    setResearchSynthesisHandoffLive(false);
    setComparisonSynthesisHandoffLive(false);
  }

  function closeActiveStreams(expectClose = true) {
    expectedCloseRef.current = expectClose;
    sourceRef.current?.close();
    sourceRef.current = null;

    if (compareAbortRef.current) {
      compareAbortRef.current.abort();
      compareAbortRef.current = null;
    }
  }

  function clearResolutionUi() {
    resolutionRequestIdRef.current += 1;
    pendingRunRef.current = null;
    setResolvingLookup({
      intel: false,
      base: false,
      target: false,
    });
    setResolutionSteps([]);
    setCurrentResolutionIndex(0);
    setSelectedResolutionDomain(null);
  }

  function persistSavedReports(
    updater: SavedReport[] | ((current: SavedReport[]) => SavedReport[]),
  ) {
    setSavedReports((current) => {
      const nextReports =
        typeof updater === "function" ? updater(current) : updater;
      const trimmedReports = nextReports.slice(0, 20);

      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          REPORT_STORAGE_KEY,
          JSON.stringify(trimmedReports),
        );
      }

      return trimmedReports;
    });
  }

  function recordAgentUsed(agentId: string) {
    if (runAgentsRef.current.includes(agentId)) {
      return;
    }

    runAgentsRef.current = [...runAgentsRef.current, agentId];
  }

  function handleApiKeySave() {
    const normalizedKey = apiKeyInput.trim();
    if (!normalizedKey) {
      return;
    }

    window.localStorage.setItem("eis_api_key", normalizedKey);
    setStoredApiKey(normalizedKey);
    setShowApiKeyPrompt(false);
  }

  function saveCurrentReport(usage: UsageStats) {
    if (reportSavedForRunRef.current) {
      return;
    }

    reportSavedForRunRef.current = true;

    const currentMode = currentRunModeRef.current;
    const report: SavedReport = {
      agentsUsed: [...runAgentsRef.current],
      chartData: chartDataRef.current ?? undefined,
      compareTarget:
        currentMode === "compare" ? competitorCompany.trim() || undefined : undefined,
      comparisonOutput: comparisonOutputRef.current.trim() || undefined,
      company:
        currentMode === "compare"
          ? baseCompany.trim() || "Base Company"
          : intelCompany.trim() || "Company Analysis",
      contextOutput: contextOutputRef.current.trim() || undefined,
      costUsd: usage.cost_usd,
      createdAt: new Date().toISOString(),
      id: createSavedReportId(),
      mode: currentMode,
      researchOutput: researchOutputRef.current.trim(),
      synthesisOutput: synthesisOutputRef.current.trim(),
      tokenCount: usage.total_tokens,
      usageStats: usage,
    };

    setActiveReport(report);
    persistSavedReports((current) => [report, ...current]);
  }

  function restoreSavedReport(
    report: SavedReport,
    nextView: ActiveView = "intel",
    preferredFocus: AgentId = nextView === "dashboard" ? "chart" : "synthesis",
  ) {
    closeActiveStreams();
    resetRunState(report.mode);
    doneReceivedRef.current = true;
    currentRunModeRef.current = report.mode;
    runAgentsRef.current = [...report.agentsUsed];
    reportSavedForRunRef.current = true;

    const specialistAgents = SPECIALIST_AGENT_IDS.filter((agentId) =>
      report.agentsUsed.includes(agentId),
    );
    const completedAgentIds = report.agentsUsed.filter(isAgentId);
    const chartSnapshot = report.chartData ?? null;
    const fallbackUsage =
      report.usageStats ??
      (report.tokenCount || report.costUsd
        ? {
            cost_usd: report.costUsd ?? 0,
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: report.tokenCount ?? 0,
          }
        : null);
    const restoredOutput =
      report.synthesisOutput ||
      report.comparisonOutput ||
      report.researchOutput ||
      report.contextOutput ||
      null;

    researchOutputRef.current = report.researchOutput;
    synthesisOutputRef.current = report.synthesisOutput;
    comparisonOutputRef.current = report.comparisonOutput || "";
    contextOutputRef.current = report.contextOutput || "";
    chartDataRef.current = chartSnapshot;

    setMode(report.mode);
    setActiveReport(report);
    setActiveView(nextView);
    setStatus("Loaded saved report.");
    setIsLoading(false);
    setIsDone(true);
    setUsageStats(fallbackUsage);
    setChartData(chartSnapshot);
    setLastAnalysisOutput(restoredOutput);
    setResearchOutput(report.researchOutput);
    setSynthesisOutput(report.synthesisOutput);
    setComparisonOutput(report.comparisonOutput || "");
    setContextOutput(report.contextOutput || "");
    setCompletedAgents(new Set(completedAgentIds));
    setActiveAgents(new Set());
    setSelectedSpecialists(specialistAgents);
    setSelectedSpecialistTab(
      specialistAgents[0] ?? (report.mode === "compare" ? "recon" : null),
    );
    const nextFocusAgent =
      preferredFocus === "chart" && chartSnapshot ? "chart" : "synthesis";
    setFocusAgent(nextFocusAgent);
    setRosterPhase("assembled");
    setRosterMessage("");
    setScanIndex(null);
    setTriageReasoning(
      report.mode === "intel" ? "Loaded from saved report." : "",
    );
    setSpecialistPanelCollapsed(false);
    setCompareRosterActivated(report.mode === "compare");

    if (report.mode === "intel") {
      setIntelCompany(report.company);
      setIntelCompanyUrl("");
      setResolvedIntelDomain(null);
    } else {
      setBaseCompany(report.company);
      setBaseUrl("");
      setResolvedBaseDomain(null);
      setCompetitorCompany(report.compareTarget || "");
      setTargetUrl("");
      setResolvedTargetDomain(null);
      setCompareFocusAreas([]);
      setCompareCustomFocus("");
      setCompareFiles([]);
    }

    if (nextView === "intel") {
      scheduleScrollToAgent(nextFocusAgent);
    }
  }

  function handleDeleteReportClick(reportId: string) {
    if (pendingDeleteTimeoutRef.current !== null) {
      window.clearTimeout(pendingDeleteTimeoutRef.current);
      pendingDeleteTimeoutRef.current = null;
    }

    if (pendingDeleteReportId === reportId) {
      persistSavedReports((current) =>
        current.filter((report) => report.id !== reportId),
      );
      setPendingDeleteReportId(null);
      return;
    }

    setPendingDeleteReportId(reportId);
    pendingDeleteTimeoutRef.current = window.setTimeout(() => {
      setPendingDeleteReportId(null);
      pendingDeleteTimeoutRef.current = null;
    }, 3000);
  }

  function handleDownloadSavedReport(report: SavedReport) {
    restoreSavedReport(report, "research", "synthesis");
    window.setTimeout(() => {
      handleDownloadAnalysis();
    }, 80);
  }

  function resetRunState(nextMode: Mode) {
    clearSequenceTimers();
    clearConnectorFlashes();
    clearResolutionUi();
    doneReceivedRef.current = false;
    stageRef.current = "idle";
    currentRunModeRef.current = nextMode;
    expectedCloseRef.current = false;
    runAgentsRef.current = [];
    researchOutputRef.current = "";
    synthesisOutputRef.current = "";
    comparisonOutputRef.current = "";
    contextOutputRef.current = "";
    chartDataRef.current = null;
    reportSavedForRunRef.current = false;

    setStatus("Idle");
    setUsageStats(null);
    setChartData(null);
    setLastAnalysisOutput(null);
    setIsPrintingDashboard(false);
    setIsLoading(false);
    setIsDone(false);
    setRosterPhase("idle");
    setRosterMessage("");
    setScanIndex(null);
    setCompareRosterActivated(false);
    setFocusAgent(nextMode === "intel" ? "triage" : "context");
    setCompletedAgents(new Set());
    setActiveAgents(new Set());
    setSelectedSpecialists([]);
    setTriageReasoning("");
    setSelectedSpecialistTab(null);
    setSpecialistOutputs(createEmptySpecialistOutputs());
    setSpecialistPanelCollapsed(false);
    setContextOutput("");
    setResearchOutput("");
    setComparisonOutput("");
    setSynthesisOutput("");
    setStreamStage("idle");
    pendingTriageSelectionRef.current = null;
    phase3UnlockedRef.current = false;
  }

  function scheduleScrollToAgent(agentId: AgentId) {
    if (activeScrollTimeoutRef.current !== null) {
      window.clearTimeout(activeScrollTimeoutRef.current);
    }

    const target =
      agentId === "triage"
        ? rosterCardRefs.current.triage
        : agentId === "chart"
          ? rosterCardRefs.current.chart
        : agentId === "context"
          ? contextCardRef.current
          : isSpecialistAgent(agentId)
            ? specialistPanelRef.current
            : agentId === "research"
              ? researchCardRef.current
              : agentId === "comparison"
                ? comparisonCardRef.current
                : synthesisCardRef.current;

    if (!target) {
      return;
    }

    activeScrollTimeoutRef.current = window.setTimeout(() => {
      target.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      activeScrollTimeoutRef.current = null;
    }, SCROLL_DELAY_MS);
  }

  function flashConnector(
    kind:
      | "specialistResearch"
      | "researchComparison"
      | "researchSynthesis"
      | "comparisonSynthesis",
  ) {
    if (kind === "specialistResearch") {
      setSpecialistResearchHandoffLive(true);
    } else if (kind === "researchComparison") {
      setResearchComparisonHandoffLive(true);
    } else if (kind === "researchSynthesis") {
      setResearchSynthesisHandoffLive(true);
    } else {
      setComparisonSynthesisHandoffLive(true);
    }

    const timeoutId = window.setTimeout(() => {
      if (kind === "specialistResearch") {
        setSpecialistResearchHandoffLive(false);
      } else if (kind === "researchComparison") {
        setResearchComparisonHandoffLive(false);
      } else if (kind === "researchSynthesis") {
        setResearchSynthesisHandoffLive(false);
      } else {
        setComparisonSynthesisHandoffLive(false);
      }
    }, CONNECTOR_FLASH_MS);

    connectorTimeoutsRef.current.push(timeoutId);
  }

  function markAgentActive(agentId: AgentId) {
    setFocusAgent(agentId);
    setActiveAgents((current) => {
      const next = new Set(current);
      next.add(agentId);
      return next;
    });
    setCompletedAgents((current) => {
      const next = new Set(current);
      next.delete(agentId);
      return next;
    });
    scheduleScrollToAgent(agentId);
  }

  function markAgentComplete(agentId: AgentId) {
    setActiveAgents((current) => {
      const next = new Set(current);
      next.delete(agentId);
      return next;
    });
    setCompletedAgents((current) => {
      const next = new Set(current);
      next.add(agentId);
      return next;
    });
  }

  function beginIntelRosterSequence() {
    clearSequenceTimers();
    phase3UnlockedRef.current = false;
    pendingTriageSelectionRef.current = null;
    setRosterPhase("scanning");
    setRosterMessage("");
    setScanIndex(0);
    setFocusAgent("triage");

    let currentIndex = 0;
    scanIntervalRef.current = window.setInterval(() => {
      currentIndex = (currentIndex + 1) % INTEL_ROSTER_IDS.length;
      setScanIndex(currentIndex);
    }, SCAN_STEP_MS);

    sequenceTimeoutsRef.current.push(
      window.setTimeout(() => {
        if (scanIntervalRef.current !== null) {
          window.clearInterval(scanIntervalRef.current);
          scanIntervalRef.current = null;
        }
        setScanIndex(null);
        setRosterPhase("triage");
        setRosterMessage("Triage Agent analyzing request...");
        scheduleScrollToAgent("triage");
      }, SCAN_DURATION_MS),
    );

    sequenceTimeoutsRef.current.push(
      window.setTimeout(() => {
        phase3UnlockedRef.current = true;
        if (pendingTriageSelectionRef.current) {
          applyTriageSelection(pendingTriageSelectionRef.current);
          pendingTriageSelectionRef.current = null;
        }
      }, TRIAGE_REVEAL_MS),
    );
  }

  function beginCompareRosterSequence() {
    clearSequenceTimers();
    setCompareRosterActivated(true);
    setRosterPhase("assembled");
    setRosterMessage("Comparison agents deployed.");
    setFocusAgent("context");

    if (assemblyMessageTimeoutRef.current !== null) {
      window.clearTimeout(assemblyMessageTimeoutRef.current);
    }

    assemblyMessageTimeoutRef.current = window.setTimeout(() => {
      setRosterMessage("");
      assemblyMessageTimeoutRef.current = null;
    }, ASSEMBLY_MESSAGE_MS);
  }

  function applyTriageSelection(selection: TriageSelection) {
    setSelectedSpecialists(selection.agents);
    setSelectedSpecialistTab(selection.agents[0] ?? null);
    setTriageReasoning(selection.reasoning);
    setRosterPhase("assembled");
    setRosterMessage("Team assembled. Deploying agents.");
    markAgentComplete("triage");

    if (assemblyMessageTimeoutRef.current !== null) {
      window.clearTimeout(assemblyMessageTimeoutRef.current);
    }

    assemblyMessageTimeoutRef.current = window.setTimeout(() => {
      setRosterMessage("");
      assemblyMessageTimeoutRef.current = null;
    }, ASSEMBLY_MESSAGE_MS);
  }

  function handleTriageSelection(selection: TriageSelection) {
    if (phase3UnlockedRef.current) {
      applyTriageSelection(selection);
    } else {
      pendingTriageSelectionRef.current = selection;
    }
  }

  function appendContextOutput(chunk: string) {
    if (!chunk) {
      return;
    }

    contextOutputRef.current += chunk;
    startTransition(() => {
      setContextOutput((current) => current + chunk);
    });
  }

  function appendSpecialistOutput(agentId: SpecialistAgentId, chunk: string) {
    if (!chunk) {
      return;
    }

    startTransition(() => {
      setSpecialistOutputs((current) => ({
        ...current,
        [agentId]: current[agentId] + chunk,
      }));
      setSelectedSpecialistTab(agentId);
    });
    setFocusAgent(agentId);
  }

  function appendResearchOutput(chunk: string) {
    if (!chunk) {
      return;
    }

    researchOutputRef.current += chunk;
    startTransition(() => {
      setResearchOutput((current) => current + chunk);
    });
  }

  function appendComparisonOutput(chunk: string) {
    if (!chunk) {
      return;
    }

    comparisonOutputRef.current += chunk;
    startTransition(() => {
      setComparisonOutput((current) => current + chunk);
    });
  }

  function appendSynthesisOutput(chunk: string) {
    if (!chunk) {
      return;
    }

    synthesisOutputRef.current += chunk;
    startTransition(() => {
      setSynthesisOutput((current) => current + chunk);
    });
  }

  function handleResearchHandoff() {
    recordAgentUsed("research");
    stageRef.current = "research";
    setStreamStage("research");
    flashConnector("specialistResearch");
    markAgentActive("research");
  }

  function handleComparisonHandoff() {
    recordAgentUsed("comparison");
    stageRef.current = "comparison";
    setStreamStage("comparison");
    flashConnector("researchComparison");
    markAgentComplete("research");
    markAgentActive("comparison");
  }

  function handleSynthesisHandoff() {
    recordAgentUsed("synthesis");
    stageRef.current = "synthesis";
    setStreamStage("synthesis");

    if (currentRunModeRef.current === "compare") {
      flashConnector("comparisonSynthesis");
      markAgentComplete("comparison");
    } else {
      flashConnector("researchSynthesis");
      markAgentComplete("research");
    }

    markAgentActive("synthesis");
  }

  function handleDoneEvent() {
    doneReceivedRef.current = true;
    if (activeAgents.has("chart")) {
      markAgentComplete("chart");
    } else {
      markAgentComplete("synthesis");
    }
    setStatus(
      currentRunModeRef.current === "compare"
        ? "Comparison complete."
        : "Analysis complete.",
    );
    setIsLoading(false);
    setIsDone(true);
  }

  function handleServerError(message: string) {
    setStatus(message || "The backend returned an error.");
    setIsLoading(false);
  }

  function handleDeltaEvent(data: string) {
    if (data.startsWith(TRIAGE_RESULT_TOKEN)) {
      const selection = parseTriageSelection(
        data.slice(TRIAGE_RESULT_TOKEN.length).trimStart(),
      );
      if (selection) {
        handleTriageSelection(selection);
      }
      return;
    }

    if (data === COMPARE_START_TOKEN) {
      setStatus("Comparison pipeline initialized.");
      return;
    }

    if (data.startsWith(CHART_DATA_TOKEN)) {
      console.log("[CHART_DATA]", data);
      const rawChartJson = data.slice(CHART_DATA_TOKEN.length).trimStart();
      if (!rawChartJson || rawChartJson === "{}") {
        chartDataRef.current = null;
        setChartData(null);
        return;
      }
      try {
        const parsed = JSON.parse(rawChartJson) as DashboardData;
        chartDataRef.current = parsed;
        setChartData(parsed);
      } catch (error) {
        console.error(
          "Chart data parse error:",
          error,
          rawChartJson,
        );
        chartDataRef.current = null;
        setChartData(null);
      }
      return;
    }

    if (data.startsWith(USAGE_TOKEN)) {
      try {
        const parsedUsage = JSON.parse(
          data.slice(USAGE_TOKEN.length).trimStart(),
        ) as UsageStats;
        setUsageStats(parsedUsage);
        saveCurrentReport(parsedUsage);
      } catch {
        setUsageStats(null);
      }
      return;
    }

    if (data === HANDOFF_RESEARCH_TOKEN) {
      handleResearchHandoff();
      return;
    }

    if (data === HANDOFF_COMPARISON_TOKEN) {
      handleComparisonHandoff();
      return;
    }

    if (data === HANDOFF_SYNTHESIS_TOKEN) {
      handleSynthesisHandoff();
      return;
    }

    if (data === "[AGENT_START_context]") {
      recordAgentUsed("context");
      stageRef.current = "context";
      setStreamStage("context");
      markAgentActive("context");
      return;
    }

    if (data === "[AGENT_DONE_context]") {
      markAgentComplete("context");
      return;
    }

    if (data === "[AGENT_START_chart]") {
      recordAgentUsed("chart");
      markAgentComplete("synthesis");
      markAgentActive("chart");
      return;
    }

    if (data === "[AGENT_DONE_chart]") {
      markAgentComplete("chart");
      return;
    }

    const agentStartMatch = data.match(/^\[AGENT_START_([a-z]+)\]$/);
    if (agentStartMatch) {
      const agentId = normalizeSpecialistAgent(agentStartMatch[1]);
      if (!agentId) {
        return;
      }
      recordAgentUsed(agentId);
      markAgentActive(agentId);
      setSelectedSpecialists((current) =>
        current.includes(agentId) ? current : [...current, agentId],
      );
      setSelectedSpecialistTab(agentId);
      return;
    }

    const agentDoneMatch = data.match(/^\[AGENT_DONE_([a-z]+)\]$/);
    if (agentDoneMatch) {
      const agentId = normalizeSpecialistAgent(agentDoneMatch[1]);
      if (!agentId) {
        return;
      }
      markAgentComplete(agentId);
      return;
    }

    if (currentRunModeRef.current === "compare" && stageRef.current === "context") {
      appendContextOutput(data);
      return;
    }

    if (stageRef.current === "research") {
      appendResearchOutput(data);
      return;
    }

    if (stageRef.current === "comparison") {
      appendComparisonOutput(data);
      return;
    }

    if (stageRef.current === "synthesis") {
      appendSynthesisOutput(data);
    }
  }

  function handleParsedStreamEvent(event: string, data: string) {
    if (event === "status") {
      setStatus(data);
      return;
    }

    if (event === "specialist_delta") {
      try {
        const parsed = JSON.parse(data) as {
          agent: string;
          delta: string;
        };
        const agentId = normalizeSpecialistAgent(parsed.agent);
        if (!agentId) {
          return;
        }
        appendSpecialistOutput(agentId, parsed.delta);
      } catch {
        // Ignore malformed specialist chunks.
      }
      return;
    }

    if (event === "server-error") {
      handleServerError(data);
      return;
    }

    if (event === "done") {
      handleDoneEvent();
      return;
    }

    if (event === "delta" || event === "message") {
      handleDeltaEvent(data);
    }
  }

  async function consumeFetchSse(response: Response) {
    if (!response.body) {
      throw new Error("The comparison stream returned no response body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "message";
    let dataLines: string[] = [];

    const flushEvent = () => {
      if (!dataLines.length) {
        currentEvent = "message";
        return;
      }

      handleParsedStreamEvent(currentEvent, dataLines.join("\n"));
      currentEvent = "message";
      dataLines = [];
    };

    const processLine = (line: string) => {
      if (line === "") {
        flushEvent();
        return;
      }

      if (line.startsWith("event:")) {
        currentEvent = line.slice("event:".length).trim() || "message";
        return;
      }

      if (line.startsWith("data: [CHART_DATA]")) {
        const jsonStr = line.slice("data: [CHART_DATA]".length).trim();
        console.log("[CHART] Received, length:", jsonStr.length);

        if (jsonStr && jsonStr !== "{}") {
          try {
            const parsed = JSON.parse(jsonStr) as DashboardData;
            console.log("[CHART] Parsed successfully:", Object.keys(parsed));
            chartDataRef.current = parsed;
            setChartData(parsed);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Unknown parse error";
            console.error("[CHART] Parse error:", message);
            console.error("[CHART] Raw string:", jsonStr.substring(0, 300));
          }
        }

        dataLines.push(`${CHART_DATA_TOKEN}${jsonStr}`);
        return;
      }

      if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).replace(/^ /, ""));
      }
    };

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        processLine(line);
      }
    }

    if (buffer) {
      processLine(buffer);
    }

    flushEvent();
  }

  async function startCompareFetchStream(formData: FormData) {
    const controller = new AbortController();
    compareAbortRef.current = controller;

    try {
      const response = await fetch("/api/compare", {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          ...(storedApiKey ? { "X-API-Key": storedApiKey } : {}),
        },
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Comparison request failed.");
      }

      await consumeFetchSse(response);

      if (!doneReceivedRef.current && !controller.signal.aborted) {
        setStatus("The stream connection was interrupted.");
        setIsLoading(false);
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      const message =
        error instanceof Error
          ? error.message
          : "The comparison request terminated unexpectedly.";
      setStatus(message);
      setIsLoading(false);
    } finally {
      compareAbortRef.current = null;
    }
  }

  function prepareNewRun(runMode: Mode) {
    closeActiveStreams();
    resetRunState(runMode);
    expectedCloseRef.current = false;
    doneReceivedRef.current = false;
    currentRunModeRef.current = runMode;
    if (runMode === "intel") {
      recordAgentUsed("triage");
    }
    setIsLoading(true);
    setStatus(
      runMode === "compare"
        ? "Connecting to the comparison pipeline."
        : "Connecting to the agent pipeline.",
    );
  }

  function setResolvingTarget(target: ResolutionTarget, resolving: boolean) {
    setResolvingLookup((current) => ({
      ...current,
      [target]: resolving,
    }));
  }

  async function resolveCompanyCandidates(
    companyName: string,
    resolutionMode: ResolutionMode,
  ): Promise<CompanyResolutionMatch[]> {
    const response = await fetch("/api/resolve-company", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(storedApiKey ? { "X-API-Key": storedApiKey } : {}),
      },
      body: JSON.stringify({
        company_name: companyName,
        mode: resolutionMode,
      }),
    });

    if (!response.ok) {
      throw new Error("Company resolution failed.");
    }

    const payload = (await response.json()) as { matches?: CompanyResolutionMatch[] };
    return Array.isArray(payload.matches) ? payload.matches : [];
  }

  function startIntelRun(run: PendingIntelRun) {
    prepareNewRun("intel");
    beginIntelRosterSequence();

    const source = new EventSource(
      buildAnalyzeUrl(
        run.company,
        run.request,
        run.companyUrl ?? undefined,
        storedApiKey || undefined,
      ),
    );
    sourceRef.current = source;

    source.onopen = () => {
      setStatus("Agent pipeline connected. Waiting for results.");
    };

    source.onmessage = (message) => {
      handleParsedStreamEvent("message", (message as MessageEvent<string>).data);
    };

    source.addEventListener("status", (message) => {
      handleParsedStreamEvent("status", (message as MessageEvent<string>).data);
    });

    source.addEventListener("specialist_delta", (message) => {
      handleParsedStreamEvent(
        "specialist_delta",
        (message as MessageEvent<string>).data,
      );
    });

    source.addEventListener("delta", (message) => {
      handleParsedStreamEvent("delta", (message as MessageEvent<string>).data);
    });

    source.addEventListener("server-error", (message) => {
      handleParsedStreamEvent(
        "server-error",
        (message as MessageEvent<string>).data,
      );
      expectedCloseRef.current = true;
      source.close();
    });

    source.addEventListener("done", () => {
      handleParsedStreamEvent("done", "");
      expectedCloseRef.current = true;
      source.close();
      sourceRef.current = null;
    });

    source.onerror = () => {
      if (expectedCloseRef.current) {
        expectedCloseRef.current = false;
        return;
      }
      setStatus("The stream connection was interrupted.");
      setIsLoading(false);
      source.close();
      sourceRef.current = null;
    };
  }

  function startCompareRun(run: PendingCompareRun) {
    prepareNewRun("compare");
    const selectedAgents = getCompareSelectedSpecialists(
      run.focusAreas,
      run.customFocus,
    );
    setSelectedSpecialists(selectedAgents);
    setSelectedSpecialistTab(selectedAgents[0] ?? null);
    beginCompareRosterSequence();

    const formData = new FormData();
    formData.set("base_company", run.baseCompany);
    formData.set("competitor_company", run.competitorCompany);

    if (run.baseUrl?.trim()) {
      formData.set("base_url", run.baseUrl.trim());
    }

    if (run.targetUrl?.trim()) {
      formData.set("target_url", run.targetUrl.trim());
    }

    for (const focusArea of run.focusAreas) {
      formData.append("focus_areas", focusArea);
    }

    if (run.customFocus?.trim()) {
      formData.set("custom_focus", run.customFocus.trim());
    }

    for (const file of run.files) {
      formData.append("files", file, file.name);
    }

    void startCompareFetchStream(formData);
  }

  function startPendingRun(run: PendingRun) {
    if (run.mode === "intel") {
      startIntelRun(run);
      return;
    }

    startCompareRun(run);
  }

  function openResolutionQueue(steps: CompanyResolutionStep[], pendingRun: PendingRun) {
    pendingRunRef.current = pendingRun;
    setResolutionSteps(steps);
    setCurrentResolutionIndex(0);
    setSelectedResolutionDomain(null);
    setStatus("Select the correct company match to continue.");
  }

  function applyResolutionSelection(match: CompanyResolutionMatch | null) {
    const step = currentResolution;
    if (!step) {
      return;
    }

    if (match) {
      const resolvedUrl = match.domain ? normalizeUrlForContext(match.domain) : null;
      const resolvedDomain = match.domain ? getDisplayDomain(match.domain) : null;

      if (step.target === "intel") {
        if (match.name?.trim()) {
          setIntelCompany(match.name.trim());
        }
        setResolvedIntelDomain(resolvedDomain);

        if (pendingRunRef.current?.mode === "intel") {
          pendingRunRef.current = {
            ...pendingRunRef.current,
            company: match.name?.trim() || pendingRunRef.current.company,
            companyUrl: resolvedUrl || pendingRunRef.current.companyUrl,
          };
        }
      } else if (step.target === "base") {
        if (match.name?.trim()) {
          setBaseCompany(match.name.trim());
        }
        setResolvedBaseDomain(resolvedDomain);

        if (pendingRunRef.current?.mode === "compare") {
          pendingRunRef.current = {
            ...pendingRunRef.current,
            baseCompany: match.name?.trim() || pendingRunRef.current.baseCompany,
            baseUrl: resolvedUrl || pendingRunRef.current.baseUrl,
          };
        }
      } else {
        if (match.name?.trim()) {
          setCompetitorCompany(match.name.trim());
        }
        setResolvedTargetDomain(resolvedDomain);

        if (pendingRunRef.current?.mode === "compare") {
          pendingRunRef.current = {
            ...pendingRunRef.current,
            competitorCompany:
              match.name?.trim() || pendingRunRef.current.competitorCompany,
            targetUrl: resolvedUrl || pendingRunRef.current.targetUrl,
          };
        }
      }
    }

    const nextIndex = currentResolutionIndex + 1;
    if (nextIndex < resolutionSteps.length) {
      setCurrentResolutionIndex(nextIndex);
      setSelectedResolutionDomain(null);
      return;
    }

    const pendingRun = pendingRunRef.current;
    clearResolutionUi();
    if (pendingRun) {
      startPendingRun(pendingRun);
    }
  }

  async function handleIntelSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (currentResolution || isResolvingCompanies) {
      setStatus(
        currentResolution
          ? "Select the correct company match to continue."
          : "Identifying company...",
      );
      return;
    }

    const company = intelCompany.trim();
    const request = intelRequest.trim();

    if (!company || !request) {
      setStatus("Both fields are required.");
      return;
    }

    const resolvedUrl = intelCompanyUrl.trim()
      ? normalizeUrlForContext(intelCompanyUrl)
      : resolvedIntelDomain
        ? normalizeUrlForContext(resolvedIntelDomain)
        : "";

    const pendingRun: PendingIntelRun = {
      company,
      companyUrl: resolvedUrl || null,
      mode: "intel",
      request,
    };

    if (pendingRun.companyUrl) {
      startIntelRun(pendingRun);
      return;
    }

    const requestId = resolutionRequestIdRef.current + 1;
    resolutionRequestIdRef.current = requestId;
    setResolvingTarget("intel", true);
    setStatus("Identifying company...");

    try {
      const matches = await resolveCompanyCandidates(company, "intel");
      if (requestId !== resolutionRequestIdRef.current) {
        return;
      }

      setResolvingTarget("intel", false);

      if (matches.length) {
        openResolutionQueue(
          [{ companyName: company, matches, mode: "intel", target: "intel" }],
          pendingRun,
        );
        return;
      }
    } catch {
      if (requestId !== resolutionRequestIdRef.current) {
        return;
      }
      setResolvingTarget("intel", false);
    }

    startIntelRun(pendingRun);
  }

  async function handleCompareSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (currentResolution || isResolvingCompanies) {
      setStatus(
        currentResolution
          ? "Select the correct company match to continue."
          : "Identifying company...",
      );
      return;
    }

    const trimmedBaseCompany = baseCompany.trim();
    const trimmedCompetitorCompany = competitorCompany.trim();

    if (!trimmedBaseCompany || !trimmedCompetitorCompany) {
      setStatus("Base company and competitor are required.");
      return;
    }

    if (otherFocusSelected && !compareCustomFocus.trim()) {
      setStatus("Describe your custom focus or deselect Other.");
      return;
    }

    const resolvedBaseUrl = baseUrl.trim()
      ? normalizeUrlForContext(baseUrl)
      : resolvedBaseDomain
        ? normalizeUrlForContext(resolvedBaseDomain)
        : "";
    const resolvedTargetUrl = targetUrl.trim()
      ? normalizeUrlForContext(targetUrl)
      : resolvedTargetDomain
        ? normalizeUrlForContext(resolvedTargetDomain)
        : "";

    const pendingRun: PendingCompareRun = {
      baseCompany: trimmedBaseCompany,
      baseUrl: resolvedBaseUrl || null,
      competitorCompany: trimmedCompetitorCompany,
      customFocus:
        otherFocusSelected && compareCustomFocus.trim()
          ? compareCustomFocus.trim()
          : null,
      files: [...compareFiles],
      focusAreas: compareFocusAreas.filter(
        (focusArea) => focusArea !== OTHER_COMPARE_FOCUS,
      ),
      mode: "compare",
      targetUrl: resolvedTargetUrl || null,
    };

    const stepsToResolve: ResolutionTarget[] = [];
    if (!pendingRun.baseUrl) {
      stepsToResolve.push("base");
    }
    if (!pendingRun.targetUrl) {
      stepsToResolve.push("target");
    }

    if (!stepsToResolve.length) {
      startCompareRun(pendingRun);
      return;
    }

    const requestId = resolutionRequestIdRef.current + 1;
    resolutionRequestIdRef.current = requestId;

    stepsToResolve.forEach((target) => setResolvingTarget(target, true));
    setStatus("Identifying company...");

    try {
      const [baseMatches, targetMatches] = await Promise.all([
        !pendingRun.baseUrl
          ? resolveCompanyCandidates(trimmedBaseCompany, "compare")
          : Promise.resolve([]),
        !pendingRun.targetUrl
          ? resolveCompanyCandidates(trimmedCompetitorCompany, "compare")
          : Promise.resolve([]),
      ]);

      if (requestId !== resolutionRequestIdRef.current) {
        return;
      }

      setResolvingTarget("base", false);
      setResolvingTarget("target", false);

      const steps: CompanyResolutionStep[] = [];
      if (!pendingRun.baseUrl && baseMatches.length) {
        steps.push({
          companyName: trimmedBaseCompany,
          matches: baseMatches,
          mode: "compare",
          target: "base",
        });
      }
      if (!pendingRun.targetUrl && targetMatches.length) {
        steps.push({
          companyName: trimmedCompetitorCompany,
          matches: targetMatches,
          mode: "compare",
          target: "target",
        });
      }

      if (steps.length) {
        openResolutionQueue(steps, pendingRun);
        return;
      }
    } catch {
      if (requestId !== resolutionRequestIdRef.current) {
        return;
      }
      setResolvingTarget("base", false);
      setResolvingTarget("target", false);
    }

    startCompareRun(pendingRun);
  }

  function handleModeChange(nextMode: Mode) {
    if (mode === nextMode || isLoading) {
      return;
    }

    closeActiveStreams();
    resetRunState(nextMode);
    setMode(nextMode);
    setActiveView("intel");
  }

  function toggleCompareFocusArea(focusArea: CompareFocusArea) {
    setCompareFocusAreas((current) => {
      const next = current.includes(focusArea)
        ? current.filter((value) => value !== focusArea)
        : [...current, focusArea];

      if (!next.includes(OTHER_COMPARE_FOCUS)) {
        setCompareCustomFocus("");
      }

      return next;
    });
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function filterAcceptedFiles(files: File[]) {
    return files.filter((file) => {
      const lowerName = file.name.toLowerCase();
      return ACCEPTED_FILE_EXTENSIONS.some((extension) =>
        lowerName.endsWith(extension),
      );
    });
  }

  function addCompareFiles(files: File[]) {
    const accepted = filterAcceptedFiles(files);
    if (!accepted.length) {
      return;
    }

    setCompareFiles((current) => [...current, ...accepted]);
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    addCompareFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function handleFileDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    addCompareFiles(Array.from(event.dataTransfer.files ?? []));
  }

  function removeCompareFile(index: number) {
    setCompareFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
  }

  function handleDownloadAnalysis() {
    const shouldPrintDashboard = activeView === "dashboard";

    if (!shouldPrintDashboard) {
      window.print();
      return;
    }

    printRestoreViewRef.current = activeView;
    const restoreAfterPrint = () => {
      setIsPrintingDashboard(false);
      setActiveView(printRestoreViewRef.current);
      window.onafterprint = null;
    };

    window.onafterprint = restoreAfterPrint;
    setIsPrintingDashboard(true);
    setActiveView("dashboard");

    window.setTimeout(() => {
      window.print();
    }, 80);
  }

  useEffect(() => {
    const storedKey = window.localStorage.getItem("eis_api_key") || "";
    const persistedReports = readSavedReports();
    setSavedReports(persistedReports);
    setTodayLabel(formatTodayLabel());
    setStoredApiKey(storedKey);
    setApiKeyInput(storedKey);
    setActiveReport(persistedReports[0] ?? null);
    setHasHydrated(true);
  }, []);

  useEffect(() => {
    if (!showApiMenu) {
      return;
    }

    function handleDocumentClick(event: MouseEvent) {
      if (apiMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setShowApiMenu(false);
    }

    document.addEventListener("mousedown", handleDocumentClick);
    return () => {
      document.removeEventListener("mousedown", handleDocumentClick);
    };
  }, [showApiMenu]);

  useEffect(() => {
    if (activeView === "research") {
      setIsResearchMemoOpen(false);
    }
  }, [activeView]);

  useEffect(() => {
    return () => {
      closeActiveStreams();
      clearSequenceTimers();
      clearConnectorFlashes();
      if (pendingDeleteTimeoutRef.current !== null) {
        window.clearTimeout(pendingDeleteTimeoutRef.current);
      }
      if (activeScrollTimeoutRef.current !== null) {
        window.clearTimeout(activeScrollTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!specialistPanelBodyRef.current || !selectedSpecialistTab) {
      return;
    }

    specialistPanelBodyRef.current.scrollTo({
      top: specialistPanelBodyRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [selectedSpecialistTab, specialistOutputs]);

  useEffect(() => {
    if (!contextBodyRef.current) {
      return;
    }

    contextBodyRef.current.scrollTo({
      top: contextBodyRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [deferredContextOutput]);

  useEffect(() => {
    if (!researchBodyRef.current) {
      return;
    }

    researchBodyRef.current.scrollTo({
      top: researchBodyRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [deferredResearchOutput]);

  useEffect(() => {
    if (!comparisonBodyRef.current) {
      return;
    }

    comparisonBodyRef.current.scrollTo({
      top: comparisonBodyRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [deferredComparisonOutput]);

  useEffect(() => {
    if (!synthesisBodyRef.current) {
      return;
    }

    synthesisBodyRef.current.scrollTo({
      top: synthesisBodyRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [deferredSynthesisOutput]);

  useEffect(() => {
    if (!isDone) {
      return;
    }

    const nextOutput =
      synthesisOutput.trim() ||
      comparisonOutput.trim() ||
      researchOutput.trim() ||
      contextOutput.trim();

    if (nextOutput) {
      setLastAnalysisOutput(nextOutput);
    }
  }, [comparisonOutput, contextOutput, isDone, researchOutput, synthesisOutput]);

  if (!hasHydrated) {
    return (
      <main className="min-h-screen bg-[#09090b]" />
    );
  }

  if (!storedApiKey) {
    return (
      <main className="min-h-screen bg-[#09090b] px-4 py-6 text-[#f3f1ea] sm:px-6">
        <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-[720px] items-center justify-center">
          <section
            className="w-full border border-[#262624] bg-[#11100f] px-8 py-10 shadow-[0_40px_120px_rgba(0,0,0,0.52)]"
            style={SURFACE_RADIUS_STYLE}
          >
            <div className="space-y-4">
              <h1 className="text-4xl font-semibold tracking-tight text-[#f3f1ea] sm:text-5xl">
                Enterprise Intel System
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-[#b3afa6] sm:text-base">
                Multi-agent enterprise intelligence, powered by OpenAI Agents SDK
              </p>
              <CreatorCredit />
            </div>

            <div className="mt-8 space-y-4">
              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.24em] text-[#8f8a7f]">
                  OpenAI API Key
                </span>
                <input
                  className="w-full border border-[#2d2b28] bg-[#12110f] px-4 py-3 text-sm text-[#f3f1ea] outline-none transition placeholder:text-[#76726a] focus:border-[#6d685f] focus:ring-2 focus:ring-[#6d685f]/15"
                  onChange={(event) => setApiKeyInput(event.target.value)}
                  placeholder="sk-..."
                  style={SURFACE_RADIUS_STYLE}
                  type="password"
                  value={apiKeyInput}
                />
              </label>

              <button
                className="inline-flex w-full items-center justify-center border border-[#34312d] bg-[#2a2825] px-4 py-3 text-sm font-semibold text-[#f3f1ea] transition hover:bg-[#34312d] disabled:cursor-not-allowed disabled:border-[#2a2825] disabled:bg-[#1b1a18] disabled:text-[#7f7b73]"
                disabled={!apiKeyInput.trim()}
                onClick={handleApiKeySave}
                style={SURFACE_RADIUS_STYLE}
                type="button"
              >
                Enter
              </button>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-6 text-[#f3f1ea] sm:px-6 print:bg-white print:px-0 print:py-0 print:text-black">
      <div className="print:hidden">
        <div className="mx-auto max-w-[1580px]">
          <section
            className="overflow-hidden border border-[#262624] bg-[#11100f] shadow-[0_40px_120px_rgba(0,0,0,0.52)]"
            style={SURFACE_RADIUS_STYLE}
          >
            <div className="flex min-h-[calc(100vh-3rem)]">
              <aside className="hidden w-[248px] shrink-0 flex-col border-r border-[#262624] bg-[#0f0e0c] lg:flex">
                <div className="border-b border-[#262624] px-5 py-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-[45px] w-[45px] shrink-0 items-center justify-center">
                      <img
                        alt="Enterprise Intel System logo"
                        className="h-[38px] w-[38px] object-contain"
                        src="/brand-mark.png?v=20260316png"
                      />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[#f3f1ea]">
                        Enterprise Intel
                      </p>
                      <p className="text-xs text-[#9f9b92]">Demystified.ai</p>
                    </div>
                  </div>

                  <div
                    className="mt-5 flex items-center gap-3 border border-[#2b2926] bg-[#161513] px-4 py-3"
                    style={SURFACE_RADIUS_STYLE}
                  >
                    <div
                      className="flex h-9 w-9 items-center justify-center border border-[#2c2a27] bg-[#181715] text-xs font-semibold text-[#f3f1ea]"
                      style={SURFACE_RADIUS_STYLE}
                    >
                      {displayInitials}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[#f3f1ea]">
                        {displayName}
                      </p>
                      <p className="mt-1 text-xs text-[#9f9b92]">
                        {displayRole}
                      </p>
                    </div>
                  </div>
                </div>

                <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
                  {[
                    { id: "intel", icon: Brain, label: "Intel Mode" },
                    { id: "compare", icon: GitCompare, label: "Compare Mode" },
                  ].map((item) => {
                    const Icon = item.icon;
                    const active =
                      activeView === "intel" &&
                      ((item.id === "intel" && mode === "intel") ||
                        (item.id === "compare" && mode === "compare"));

                    return (
                      <button
                        key={item.id}
                        className={`flex items-center gap-3 border px-3 py-3 text-left text-sm transition ${
                          active
                            ? "border-[#3a3834] bg-[#1a1917] text-[#f3f1ea]"
                            : "border-transparent text-[#9f9b92] hover:border-[#2c2a27] hover:bg-[#151412] hover:text-[#ebe8e1]"
                        }`}
                        onClick={() => {
                          if (item.id === "intel") {
                            if (mode !== "intel") {
                              handleModeChange("intel");
                            } else {
                              setActiveView("intel");
                            }
                            return;
                          }

                          if (mode !== "compare") {
                            handleModeChange("compare");
                          } else {
                            setActiveView("intel");
                          }
                        }}
                        style={SURFACE_RADIUS_STYLE}
                        type="button"
                      >
                        <Icon className="h-4 w-4" strokeWidth={1.75} />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}

                  <div className="my-2 border-t border-[#2a2d36]" />

                  {[
                    { id: "research", icon: FileSearch, label: "Research" },
                    {
                      id: "dashboard",
                      icon: BarChart3,
                      label: "Graph Dashboard",
                    },
                  ].map((item) => {
                    const Icon = item.icon;
                    const active =
                      (item.id === "research" && activeView === "research") ||
                      (item.id === "dashboard" && activeView === "dashboard");
                    const disabled = !hasNavigableSections;

                    return (
                      <button
                        key={item.id}
                        className={`flex items-center gap-3 border px-3 py-3 text-left text-sm transition ${
                          active
                            ? "border-[#3a3834] bg-[#1a1917] text-[#f3f1ea]"
                            : "border-transparent text-[#9f9b92] hover:border-[#2c2a27] hover:bg-[#151412] hover:text-[#ebe8e1]"
                        } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                        onClick={() =>
                          setActiveView(
                            item.id === "research" ? "research" : "dashboard",
                          )
                        }
                        style={SURFACE_RADIUS_STYLE}
                        title={disabled ? "Run an analysis to enable" : undefined}
                        type="button"
                      >
                        <Icon className="h-4 w-4" strokeWidth={1.75} />
                        <span>{item.label}</span>
                        {item.id === "dashboard" && dashboardViewData ? (
                          <span className="ml-auto h-1.5 w-1.5 rounded-full bg-green-400" />
                        ) : null}
                      </button>
                    );
                  })}

                  <div className="my-2 border-t border-[#2a2d36]" />

                  <button
                    className={`flex items-center gap-3 border px-3 py-3 text-left text-sm transition ${
                      activeView === "reports"
                        ? "border-[#3a3834] bg-[#1a1917] text-[#f3f1ea]"
                        : "border-transparent text-[#9f9b92] hover:border-[#2c2a27] hover:bg-[#151412] hover:text-[#ebe8e1]"
                    } ${!hasNavigableSections ? "cursor-not-allowed opacity-50" : ""}`}
                    onClick={() => setActiveView("reports")}
                    style={SURFACE_RADIUS_STYLE}
                    title={!hasNavigableSections ? "Run an analysis to enable" : undefined}
                    type="button"
                  >
                    <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                    <span>Reports</span>
                    {savedReports.length > 0 ? (
                      <span className="ml-auto font-mono text-xs text-gray-500">
                        {savedReports.length}
                      </span>
                    ) : null}
                  </button>
                </nav>

                <div className="border-t border-[#262624] px-5 py-5">
                  <div
                    className="border border-[#2b2926] bg-[#161513] px-4 py-4"
                    style={SURFACE_RADIUS_STYLE}
                  >
                    <p className="text-[0.68rem] uppercase tracking-[0.28em] text-[#8f8a7f]">
                      Live status
                    </p>
                    <p className="mt-3 text-sm text-[#f3f1ea]">
                      {isLoading ? "Pipeline running" : "Workspace idle"}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[#9f9b92]">
                      {mode === "intel"
                        ? "Triage-led intelligence workflow"
                        : "Head-to-head comparison workflow"}
                    </p>
                  </div>
                </div>
              </aside>

              <div className="flex min-w-0 flex-1 flex-col">
                <header className="flex items-center justify-between border-b border-[#262624] px-6 py-4">
                  <div className="flex items-center gap-3 text-[0.68rem] uppercase tracking-[0.3em] text-[#8f8a7f]">
                    <span className="text-[#b4b0a8]">
                      {activeView === "dashboard"
                        ? "Graph Dashboard"
                        : activeView === "research"
                          ? "Research"
                          : activeView === "reports"
                            ? "Reports"
                            : mode === "intel"
                              ? "Intel Mode"
                              : "Compare Mode"}
                    </span>
                    <span className="h-1 w-1 rounded-full bg-[#3b3935]" />
                    <span>{mode === "intel" ? "Intel Workspace" : "Comparison Workspace"}</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div
                      className="border border-[#312f2c] bg-[#1a1917] px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.26em] text-[#d7d3cb]"
                      style={SURFACE_RADIUS_STYLE}
                    >
                      {isLoading ? "Live run" : "Standby"}
                    </div>
                    <div className="relative" ref={apiMenuRef}>
                      <button
                        className="flex h-8 w-8 items-center justify-center border border-[#2a2d36] bg-[#1e2130] font-mono text-xs text-gray-400 hover:border-[#3d4150] hover:text-white"
                        onClick={() => setShowApiMenu((current) => !current)}
                        style={SURFACE_RADIUS_STYLE}
                        type="button"
                      >
                        <Settings size={14} />
                      </button>

                      {showApiMenu ? (
                        <div
                          className="absolute right-0 top-10 z-50 w-72 border border-[#2a2d36] bg-[#13161e] p-4 shadow-xl"
                          style={SURFACE_RADIUS_STYLE}
                        >
                          <p className="mb-2 text-xs uppercase tracking-wider text-gray-500">
                            API KEY
                          </p>
                          <p className="mb-3 text-xs font-mono text-gray-400">
                            Active: {activeApiKeyPreview}
                          </p>
                          <button
                            className="w-full py-1 text-left text-xs text-red-400 hover:text-red-300"
                            onClick={() => {
                              setApiKeyInput("");
                              setShowApiKeyPrompt(true);
                              setShowApiMenu(false);
                            }}
                            type="button"
                          >
                            Change API Key →
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </header>

                <div className="flex-1 overflow-y-auto">
                  {activeView === "dashboard" ? (
                    <div className="mx-auto max-w-[1160px] px-6 py-6">
                      {hasNavigableSections ? (
                        <section
                          className="border border-[#282623] bg-[#161513]"
                          style={SURFACE_RADIUS_STYLE}
                        >
                          <Dashboard data={dashboardViewData} />
                        </section>
                      ) : (
                        <div className="flex h-64 items-center justify-center text-sm text-gray-500">
                          <span className="font-mono">
                            Run an analysis to populate this section.
                          </span>
                        </div>
                      )}
                    </div>
                  ) : activeView === "reports" ? (
                    <div className="mx-auto max-w-[1160px] px-6 py-6">
                      {hasNavigableSections ? (
                        <ReportsView
                          onGraphs={(report) =>
                            restoreSavedReport(report, "dashboard", "chart")
                          }
                          onDelete={handleDeleteReportClick}
                          onDownload={handleDownloadSavedReport}
                          onView={(report) =>
                            restoreSavedReport(report, "research", "synthesis")
                          }
                          pendingDeleteReportId={pendingDeleteReportId}
                          reports={savedReports}
                        />
                      ) : (
                        <div className="flex h-64 items-center justify-center text-sm text-gray-500">
                          <span className="font-mono">
                            Run an analysis to populate this section.
                          </span>
                        </div>
                      )}
                    </div>
                  ) : activeView === "research" ? (
                    <div className="mx-auto max-w-[1160px] px-6 py-6">
                      {hasNavigableSections ? (
                        <ResearchView
                          isMemoOpen={isResearchMemoOpen}
                          onDownload={handleDownloadAnalysis}
                          onToggleMemo={() =>
                            setIsResearchMemoOpen((current) => !current)
                          }
                          researchMemo={researchViewResearchOutput}
                          synthesisMemo={researchViewSynthesisOutput}
                          usageStats={loadedUsageStats}
                        />
                      ) : (
                        <div className="flex h-64 items-center justify-center text-sm text-gray-500">
                          <span className="font-mono">
                            Run an analysis to populate this section.
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mx-auto flex max-w-[1160px] flex-col gap-6 px-6 py-6">
                    <section className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
                      <div
                        className="border border-[#282623] bg-[#161513] px-6 py-6"
                        style={SURFACE_RADIUS_STYLE}
                      >
                        <div className="mb-5 flex flex-wrap items-center gap-2 text-[0.68rem] uppercase tracking-[0.3em] text-[#9f9b92]">
                          <span
                            className="border border-[#36332f] bg-[#1c1b18] px-3 py-1 text-[#d9d5cc]"
                            style={SURFACE_RADIUS_STYLE}
                          >
                            Enterprise AI Agents
                          </span>
                          <span
                            className="border border-[#2f2d29] bg-[#12110f] px-3 py-1 text-[#9f9b92]"
                            style={SURFACE_RADIUS_STYLE}
                          >
                            Agent: {focusAgentLabel}
                          </span>
                          <span
                            className="border border-[#2f2d29] bg-[#12110f] px-3 py-1 text-[#9f9b92]"
                            style={SURFACE_RADIUS_STYLE}
                          >
                            {isLoading ? "Streaming" : "Ready"}
                          </span>
                        </div>

                        <div className="space-y-3">
                          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-[#f3f1ea] sm:text-5xl">
                            Enterprise Intel System
                          </h1>
                          <p className="max-w-2xl text-sm leading-7 text-[#b3afa6] sm:text-base">
                            Multi-agent enterprise intelligence, powered by OpenAI Agents SDK
                          </p>
                          <CreatorCredit />
                        </div>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                        <div
                          className="border border-[#282623] bg-[#161513] px-5 py-4"
                          style={SURFACE_RADIUS_STYLE}
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-xs uppercase tracking-[0.28em] text-gray-500">
                              Run status
                            </span>
                            <span className="text-xs text-[#f3f1ea]">
                              {isLoading ? "In progress" : "Standing by"}
                            </span>
                          </div>
                          <p className="text-sm text-gray-300 leading-relaxed">
                            {status}
                          </p>
                        </div>

                        <div
                          className="border border-[#282623] bg-[#161513] px-5 py-6"
                          style={SURFACE_RADIUS_STYLE}
                        >
                          <div className="mb-3 flex items-center justify-between">
                            <span className="text-xs uppercase tracking-[0.28em] text-gray-500">
                              How it works
                            </span>
                          </div>
                          <p className="text-sm text-gray-300 leading-relaxed">
                            Enter company info and run analysis. Select the correct
                            company from the results. Triage agent selects the
                            agent team, specialists fan out in parallel, research
                            aggregates their findings, synthesis finishes.
                          </p>
                        </div>
                      </div>
                    </section>

                    <section
                      className="space-y-4 border border-[#282623] bg-[#161513] px-6 py-6"
                      style={SURFACE_RADIUS_STYLE}
                    >
                <div
                  className="inline-flex border border-[#2f2d29] bg-[#12110f] p-1"
                  style={SURFACE_RADIUS_STYLE}
                >
                  {(["intel", "compare"] as Mode[]).map((modeOption) => {
                    const active = mode === modeOption;
                    return (
                      <button
                        key={modeOption}
                        className={`px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] transition ${
                          active
                            ? "border border-[#3b3935] bg-[#2a2825] text-[#f3f1ea]"
                            : "text-[#9f9b92] hover:bg-[#1a1917] hover:text-[#ebe8e1]"
                        }`}
                        disabled={isLoading}
                        onClick={() => handleModeChange(modeOption)}
                        style={SURFACE_RADIUS_STYLE}
                        type="button"
                      >
                        {modeOption === "intel" ? "INTEL" : "COMPARE"}
                      </button>
                    );
                  })}
                </div>

                {mode === "intel" ? (
                  <form className="space-y-4" onSubmit={handleIntelSubmit}>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
                      <div className="flex flex-col gap-4 lg:basis-[35%]">
                        <label className="block space-y-2">
                          <span className="text-xs uppercase tracking-[0.24em] text-[#8f8a7f]">
                            Company
                          </span>
                          <input
                            className="w-full border border-[#2d2b28] bg-[#12110f] px-4 py-3 text-sm text-[#f3f1ea] outline-none transition placeholder:text-[#76726a] focus:border-[#6d685f] focus:ring-2 focus:ring-[#6d685f]/15"
                            onChange={(event) => {
                              setIntelCompany(event.target.value);
                              setResolvedIntelDomain(null);
                            }}
                            placeholder="Enter a company name"
                            style={SURFACE_RADIUS_STYLE}
                            value={intelCompany}
                          />
                        </label>

                        {resolvedIntelDomain && !intelCompanyUrl.trim() ? (
                          <a
                            className="inline-flex w-fit items-center border border-[#34312d] bg-[#1b1a18] px-3 py-1.5 font-mono text-[0.72rem] text-[#9bb4ff]"
                            href={normalizeUrlForContext(resolvedIntelDomain)}
                            rel="noreferrer"
                            style={SURFACE_RADIUS_STYLE}
                            target="_blank"
                          >
                            {resolvedIntelDomain}
                          </a>
                        ) : null}

                        {resolvingLookup.intel ? (
                          <InlineResolvingStatus label="Identifying company..." />
                        ) : null}

                        <label className="block space-y-2">
                          <span className="text-xs uppercase tracking-[0.24em] text-[#8f8a7f]">
                            WEBSITE URL
                          </span>
                          <input
                            className="w-full border border-[#2d2b28] bg-[#12110f] px-4 py-3 text-sm text-[#f3f1ea] outline-none transition placeholder:text-[#76726a] focus:border-[#6d685f] focus:ring-2 focus:ring-[#6d685f]/15"
                            onChange={(event) => setIntelCompanyUrl(event.target.value)}
                            placeholder="https://company.com (optional)"
                            style={SURFACE_RADIUS_STYLE}
                            value={intelCompanyUrl}
                          />
                          <p className="text-xs text-[#8f8a7f]">
                            Providing a URL skips company disambiguation and improves accuracy
                          </p>
                        </label>

                        <button
                          className={`inline-flex w-full items-center justify-center border border-[#34312d] bg-[#2a2825] px-4 py-3 text-sm font-semibold text-[#f3f1ea] transition hover:bg-[#34312d] disabled:cursor-not-allowed disabled:border-[#2a2825] disabled:bg-[#1b1a18] disabled:text-[#7f7b73] ${
                            resolvingLookup.intel ? "opacity-85" : ""
                          }`}
                          disabled={isLoading}
                          style={SURFACE_RADIUS_STYLE}
                          type="submit"
                        >
                          {isLoading
                            ? "Running Analysis..."
                            : resolvingLookup.intel
                              ? "Identifying company..."
                              : "Run Analysis"}
                        </button>
                      </div>

                      <label className="flex min-h-[10.5rem] flex-col space-y-2 lg:min-h-0 lg:flex-1 lg:basis-[65%]">
                        <span className="text-xs uppercase tracking-[0.24em] text-[#8f8a7f]">
                          Request
                        </span>
                        <textarea
                          className="min-h-[10.5rem] w-full flex-1 border border-[#2d2b28] bg-[#12110f] px-4 py-3 text-sm leading-7 text-[#f3f1ea] outline-none transition placeholder:text-[#76726a] focus:border-[#6d685f] focus:ring-2 focus:ring-[#6d685f]/15"
                          onChange={(event) => setIntelRequest(event.target.value)}
                          placeholder="Describe the analysis you want"
                          style={SURFACE_RADIUS_STYLE}
                          value={intelRequest}
                        />
                      </label>
                    </div>

                    {currentResolution ? (
                      <div
                        className="space-y-4 border border-[#2a2d36] bg-[#13161e] px-5 py-5"
                        style={SURFACE_RADIUS_STYLE}
                      >
                        <div className="space-y-1">
                          <p className="text-xs uppercase tracking-[0.26em] text-white">
                            Which company did you mean?
                          </p>
                          <p className="text-sm text-gray-400">
                            Select the correct match to ensure accurate intelligence
                          </p>
                        </div>

                        <div className="space-y-3">
                          {currentResolution.matches.map((match, index) => {
                            const confidence = (match.confidence ?? "low").toLowerCase();
                            const confidenceColor =
                              confidence === "high"
                                ? "#4ade80"
                                : confidence === "medium"
                                  ? "#facc15"
                                  : "#9ca3af";
                            const cardKey =
                              match.domain || match.name || `${currentResolution.target}-${index}`;
                            const selected = selectedResolutionDomain === cardKey;
                            return (
                              <button
                                key={cardKey}
                                className={`w-full border px-4 py-4 text-left transition ${
                                  selected
                                    ? "border-blue-500 bg-[#1a2035]"
                                    : "border-[#2a2d36] bg-[#13161e] hover:border-[#3d4150]"
                                }`}
                                onClick={() => {
                                  setSelectedResolutionDomain(cardKey);
                                  window.setTimeout(() => applyResolutionSelection(match), 80);
                                }}
                                style={SURFACE_RADIUS_STYLE}
                                type="button"
                              >
                                <div className="flex items-start justify-between gap-4">
                                  <div className="space-y-2">
                                    <p className="text-sm font-semibold text-white">
                                      {match.name || currentResolution.companyName}
                                    </p>
                                    <p className="text-sm text-gray-400">
                                      {match.description || "No description available."}
                                    </p>
                                    {match.domain ? (
                                      <a
                                        className="font-mono text-xs text-blue-400 underline underline-offset-4"
                                        href={normalizeUrlForContext(match.domain)}
                                        onClick={(event) => event.stopPropagation()}
                                        rel="noreferrer"
                                        target="_blank"
                                      >
                                        {getDisplayDomain(match.domain)}
                                      </a>
                                    ) : null}
                                    <div className="flex flex-wrap gap-2">
                                      {match.industry ? (
                                        <span
                                          className="border border-[#343846] bg-[#191d27] px-2 py-1 text-[0.68rem] uppercase tracking-[0.2em] text-gray-300"
                                          style={SURFACE_RADIUS_STYLE}
                                        >
                                          {match.industry}
                                        </span>
                                      ) : null}
                                      {match.stage ? (
                                        <span
                                          className="border border-[#343846] bg-[#191d27] px-2 py-1 text-[0.68rem] uppercase tracking-[0.2em] text-gray-300"
                                          style={SURFACE_RADIUS_STYLE}
                                        >
                                          {match.stage}
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                  <span
                                    className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                                    style={{ backgroundColor: confidenceColor }}
                                  />
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        <button
                          className="text-sm text-gray-400 transition hover:text-gray-200"
                          onClick={() => applyResolutionSelection(null)}
                          type="button"
                        >
                          None of these - search anyway
                        </button>
                      </div>
                    ) : null}

                    {isDone && usageStats ? <UsageSummary usageStats={usageStats} /> : null}
                  </form>
                ) : (
                  <form className="space-y-4" onSubmit={handleCompareSubmit}>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                      <div className="space-y-4 lg:basis-1/2">
                        <p className="text-xs uppercase tracking-[0.24em] text-[#8f8a7f]">
                          BASE COMPANY
                        </p>

                        <label className="block space-y-2">
                          <span className="text-xs uppercase tracking-[0.24em] text-[#8f8a7f]">
                            Company Name
                          </span>
                          <input
                            className="w-full border border-[#2d2b28] bg-[#12110f] px-4 py-3 text-sm text-[#f3f1ea] outline-none transition placeholder:text-[#76726a] focus:border-[#6d685f] focus:ring-2 focus:ring-[#6d685f]/15"
                            onChange={(event) => {
                              setBaseCompany(event.target.value);
                              setResolvedBaseDomain(null);
                            }}
                            placeholder="Enter company name"
                            style={SURFACE_RADIUS_STYLE}
                            value={baseCompany}
                          />
                        </label>

                        {resolvedBaseDomain && !baseUrl.trim() ? (
                          <a
                            className="inline-flex w-fit items-center border border-[#34312d] bg-[#1b1a18] px-3 py-1.5 font-mono text-[0.72rem] text-[#9bb4ff]"
                            href={normalizeUrlForContext(resolvedBaseDomain)}
                            rel="noreferrer"
                            style={SURFACE_RADIUS_STYLE}
                            target="_blank"
                          >
                            {resolvedBaseDomain}
                          </a>
                        ) : null}

                        {resolvingLookup.base ? (
                          <InlineResolvingStatus label="Identifying company..." />
                        ) : null}

                        <label className="block space-y-2">
                          <span className="text-xs uppercase tracking-[0.24em] text-[#8f8a7f]">
                            BASE URL
                          </span>
                          <input
                            className="w-full border border-[#2d2b28] bg-[#12110f] px-4 py-3 text-sm text-[#f3f1ea] outline-none transition placeholder:text-[#76726a] focus:border-[#6d685f] focus:ring-2 focus:ring-[#6d685f]/15"
                            onChange={(event) => setBaseUrl(event.target.value)}
                            placeholder="https://..."
                            style={SURFACE_RADIUS_STYLE}
                            value={baseUrl}
                          />
                          <p className="text-xs text-[#8f8a7f]">
                            Providing a URL skips company disambiguation and improves accuracy
                          </p>
                        </label>

                        <div className="space-y-2">
                          <p className="text-xs uppercase tracking-[0.24em] text-[#8f8a7f]">
                            Upload Docs
                          </p>
                          <input
                            accept=".pdf,.docx,.csv,.txt"
                            className="hidden"
                            multiple
                            onChange={handleFileInputChange}
                            ref={fileInputRef}
                            type="file"
                          />
                          <div
                            className="cursor-pointer border border-dashed border-[#3b3935] bg-[#12110f] px-4 py-6 text-center transition hover:border-[#6d685f] hover:bg-[#171614]"
                            onClick={openFilePicker}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={handleFileDrop}
                            style={SURFACE_RADIUS_STYLE}
                          >
                            <p className="text-sm font-medium text-[#f3f1ea]">
                              Drop files here or click to browse
                            </p>
                            <p className="mt-2 text-xs leading-6 text-[#a6a39b]">
                              PDF, DOCX, CSV, TXT - pitch deck, financials, reports
                            </p>
                          </div>
                          {compareFiles.length ? (
                            <div className="flex flex-wrap gap-2">
                              {compareFiles.map((file, index) => (
                                <div
                                  key={`${file.name}-${index}`}
                                  className="inline-flex items-center gap-2 border border-[#34312d] bg-[#1b1a18] px-3 py-2 text-xs text-[#ddd9d1]"
                                  style={SURFACE_RADIUS_STYLE}
                                >
                                  <span>{file.name}</span>
                                  <button
                                    className="text-[#9f9b92] transition hover:text-[#f3f1ea]"
                                    onClick={(event) => {
                                      event.preventDefault();
                                      removeCompareFile(index);
                                    }}
                                    type="button"
                                  >
                                    x
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <button
                          className={`inline-flex w-full items-center justify-center border border-[#34312d] bg-[#2a2825] px-4 py-3 text-sm font-semibold text-[#f3f1ea] transition hover:bg-[#34312d] disabled:cursor-not-allowed disabled:border-[#2a2825] disabled:bg-[#1b1a18] disabled:text-[#7f7b73] ${
                            resolvingLookup.base || resolvingLookup.target ? "opacity-85" : ""
                          }`}
                          disabled={isLoading}
                          style={SURFACE_RADIUS_STYLE}
                          type="submit"
                        >
                          {isLoading
                            ? "Running Comparison..."
                            : resolvingLookup.base || resolvingLookup.target
                              ? "Identifying company..."
                              : "Run Comparison"}
                        </button>
                      </div>

                      <div className="space-y-4 lg:basis-1/2">
                        <p className="text-xs uppercase tracking-[0.24em] text-[#8f8a7f]">
                          TARGET COMPANY
                        </p>

                        <label className="block space-y-2">
                          <span className="text-xs uppercase tracking-[0.24em] text-[#8f8a7f]">
                            Company Name
                          </span>
                          <input
                            className="w-full border border-[#2d2b28] bg-[#12110f] px-4 py-3 text-sm text-[#f3f1ea] outline-none transition placeholder:text-[#76726a] focus:border-[#6d685f] focus:ring-2 focus:ring-[#6d685f]/15"
                            onChange={(event) => {
                              setCompetitorCompany(event.target.value);
                              setResolvedTargetDomain(null);
                            }}
                            placeholder="Enter a competitor"
                            style={SURFACE_RADIUS_STYLE}
                            value={competitorCompany}
                          />
                        </label>

                        {resolvedTargetDomain && !targetUrl.trim() ? (
                          <a
                            className="inline-flex w-fit items-center border border-[#34312d] bg-[#1b1a18] px-3 py-1.5 font-mono text-[0.72rem] text-[#9bb4ff]"
                            href={normalizeUrlForContext(resolvedTargetDomain)}
                            rel="noreferrer"
                            style={SURFACE_RADIUS_STYLE}
                            target="_blank"
                          >
                            {resolvedTargetDomain}
                          </a>
                        ) : null}

                        {resolvingLookup.target ? (
                          <InlineResolvingStatus label="Identifying company..." />
                        ) : null}

                        <label className="block space-y-2">
                          <span className="text-xs uppercase tracking-[0.24em] text-[#8f8a7f]">
                            TARGET URL
                          </span>
                          <input
                            className="w-full border border-[#2d2b28] bg-[#12110f] px-4 py-3 text-sm text-[#f3f1ea] outline-none transition placeholder:text-[#76726a] focus:border-[#6d685f] focus:ring-2 focus:ring-[#6d685f]/15"
                            onChange={(event) => setTargetUrl(event.target.value)}
                            placeholder="https://..."
                            style={SURFACE_RADIUS_STYLE}
                            value={targetUrl}
                          />
                          <p className="text-xs text-[#8f8a7f]">
                            Providing a URL skips company disambiguation and improves accuracy
                          </p>
                        </label>

                        <div className="space-y-3">
                          <span className="text-xs uppercase tracking-[0.24em] text-[#8f8a7f]">
                            Focus
                          </span>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {COMPARE_FOCUS_OPTIONS.map((focusArea) => {
                              const selected = compareFocusAreas.includes(focusArea);
                              return (
                                <button
                                  key={focusArea}
                                  className={`border px-3 py-2 text-left text-xs font-medium transition ${
                                    selected
                                      ? "border-blue-500 bg-blue-500 text-white"
                                      : "border-gray-600 bg-transparent text-gray-400 hover:border-gray-400 hover:text-gray-300"
                                  }`}
                                  onClick={() => toggleCompareFocusArea(focusArea)}
                                  style={SURFACE_RADIUS_STYLE}
                                  type="button"
                                >
                                  {focusArea}
                                </button>
                              );
                            })}
                          </div>

                          {otherFocusSelected ? (
                            <input
                              className="w-full border border-[#2d2b28] bg-[#12110f] px-4 py-3 text-sm text-[#f3f1ea] outline-none transition placeholder:text-[#76726a] focus:border-[#6d685f] focus:ring-2 focus:ring-[#6d685f]/15"
                              onChange={(event) => setCompareCustomFocus(event.target.value)}
                              placeholder="Describe your custom focus..."
                              style={SURFACE_RADIUS_STYLE}
                              value={compareCustomFocus}
                            />
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {currentResolution ? (
                      <div
                        className="space-y-4 border border-[#2a2d36] bg-[#13161e] px-5 py-5"
                        style={SURFACE_RADIUS_STYLE}
                      >
                        <div className="space-y-1">
                          <p className="text-xs uppercase tracking-[0.26em] text-white">
                            Which company did you mean?
                          </p>
                          <p className="text-sm text-gray-400">
                            Select the correct match to ensure accurate intelligence
                          </p>
                        </div>

                        <div className="space-y-3">
                          {currentResolution.matches.map((match, index) => {
                            const confidence = (match.confidence ?? "low").toLowerCase();
                            const confidenceColor =
                              confidence === "high"
                                ? "#4ade80"
                                : confidence === "medium"
                                  ? "#facc15"
                                  : "#9ca3af";
                            const cardKey =
                              match.domain || match.name || `${currentResolution.target}-${index}`;
                            const selected = selectedResolutionDomain === cardKey;
                            return (
                              <button
                                key={cardKey}
                                className={`w-full border px-4 py-4 text-left transition ${
                                  selected
                                    ? "border-blue-500 bg-[#1a2035]"
                                    : "border-[#2a2d36] bg-[#13161e] hover:border-[#3d4150]"
                                }`}
                                onClick={() => {
                                  setSelectedResolutionDomain(cardKey);
                                  window.setTimeout(() => applyResolutionSelection(match), 80);
                                }}
                                style={SURFACE_RADIUS_STYLE}
                                type="button"
                              >
                                <div className="flex items-start justify-between gap-4">
                                  <div className="space-y-2">
                                    <p className="text-sm font-semibold text-white">
                                      {match.name || currentResolution.companyName}
                                    </p>
                                    <p className="text-sm text-gray-400">
                                      {match.description || "No description available."}
                                    </p>
                                    {match.domain ? (
                                      <a
                                        className="font-mono text-xs text-blue-400 underline underline-offset-4"
                                        href={normalizeUrlForContext(match.domain)}
                                        onClick={(event) => event.stopPropagation()}
                                        rel="noreferrer"
                                        target="_blank"
                                      >
                                        {getDisplayDomain(match.domain)}
                                      </a>
                                    ) : null}
                                    <div className="flex flex-wrap gap-2">
                                      {match.industry ? (
                                        <span
                                          className="border border-[#343846] bg-[#191d27] px-2 py-1 text-[0.68rem] uppercase tracking-[0.2em] text-gray-300"
                                          style={SURFACE_RADIUS_STYLE}
                                        >
                                          {match.industry}
                                        </span>
                                      ) : null}
                                      {match.stage ? (
                                        <span
                                          className="border border-[#343846] bg-[#191d27] px-2 py-1 text-[0.68rem] uppercase tracking-[0.2em] text-gray-300"
                                          style={SURFACE_RADIUS_STYLE}
                                        >
                                          {match.stage}
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                  <span
                                    className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                                    style={{ backgroundColor: confidenceColor }}
                                  />
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        <button
                          className="text-sm text-gray-400 transition hover:text-gray-200"
                          onClick={() => applyResolutionSelection(null)}
                          type="button"
                        >
                          None of these - search anyway
                        </button>
                      </div>
                    ) : null}

                    {isDone && usageStats ? <UsageSummary usageStats={usageStats} /> : null}
                  </form>
                )}
              </section>

              <section
                className="space-y-4 border border-[#282623] bg-[#161513] px-6 py-6"
                style={SURFACE_RADIUS_STYLE}
              >
                <p className="text-xs uppercase tracking-[0.28em] text-[#8f8a7f]">
                  Agent Roster
                </p>
                <div className="grid gap-4 md:grid-cols-4 xl:grid-cols-5">
                  {displayedRosterIds.map((agentId, index) => {
                    const isSelected = assembledAgentIds.has(agentId);
                    const isActive =
                      activeAgents.has(agentId) ||
                      (mode === "intel" &&
                        rosterPhase === "triage" &&
                        agentId === "triage");
                    const isComplete =
                      completedAgents.has(agentId) &&
                      !(
                        mode === "intel" &&
                        rosterPhase === "triage" &&
                        agentId === "triage"
                      );
                    const isScanHighlight =
                      mode === "intel" &&
                      rosterPhase === "scanning" &&
                      scanIndex === index;
                    let dimmed = false;

                    if (mode === "intel") {
                      if (rosterPhase === "triage" && agentId !== "triage") {
                        dimmed = true;
                      } else if (
                        rosterPhase === "assembled" &&
                        assembledAgentIds.size > 0 &&
                        !isSelected
                      ) {
                        dimmed = true;
                      }
                    }

                    return (
                      <RosterCard
                        key={agentId}
                        active={isActive}
                        agentId={agentId}
                        complete={isComplete}
                        dimmed={dimmed}
                        highlight={isSelected}
                        isScanHighlight={isScanHighlight}
                        onRef={(element) => {
                          rosterCardRefs.current[agentId] = element;
                        }}
                      />
                    );
                  })}
                </div>

                <div className="min-h-5 text-xs uppercase tracking-[0.24em] text-[#9f9b92]">
                  {rosterMessage || "\u00a0"}
                </div>
              </section>

              {mode === "compare" ? (
                <section
                  className="border border-[#282623] bg-[#161513] p-5"
                  style={SURFACE_RADIUS_STYLE}
                >
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-[#f3f1ea]">
                        Base Company Context
                      </h2>
                      <p className="text-sm text-[#a6a39b]">
                        Context Agent combines uploaded material with live web context.
                      </p>
                    </div>
                  </div>
                  <article ref={contextCardRef}>
                    <PipelineCard
                      accentColor={AGENT_CONFIGS.context.accentColor}
                      bodyRef={contextBodyRef}
                      content={deferredContextOutput}
                      glowColor={AGENT_CONFIGS.context.glowColor}
                      placeholder="Waiting for the Context Agent to build the base company profile."
                      state={contextCardState}
                      subtitle="Base company profile"
                      title="Context Agent"
                      waitingLabel="Waiting"
                    />
                  </article>
                </section>
              ) : null}

              <section
                className="border border-[#282623] bg-[#161513] p-5"
                ref={specialistPanelRef}
                style={SURFACE_RADIUS_STYLE}
              >
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-[#f3f1ea]">
                      Specialist Output
                    </h2>
                    <p className="text-sm text-[#a6a39b]">
                      {mode === "intel"
                        ? triageReasoning ||
                          "Specialist agents will appear here once triage assembles the team."
                        : "Competitor specialist agents stream in parallel here."}
                    </p>
                  </div>
                  <button
                    className="border border-[#34312d] bg-[#1b1a18] px-3 py-2 text-xs uppercase tracking-[0.22em] text-[#ddd9d1] transition hover:border-[#4a4742] hover:bg-[#24221f]"
                    onClick={() => setSpecialistPanelCollapsed((current) => !current)}
                    style={SURFACE_RADIUS_STYLE}
                    type="button"
                  >
                    {specialistPanelCollapsed ? "Expand" : "Collapse"}
                  </button>
                </div>

                {!specialistPanelCollapsed ? (
                  <>
                    <div className="mb-4 flex flex-wrap gap-2">
                      {selectedSpecialists.length ? (
                        selectedSpecialists.map((agentId) => {
                          const agent = getAgentConfig(agentId);
                          const isSelectedTab = selectedSpecialistTab === agentId;
                          const isRunning = activeAgents.has(agentId);
                          const isComplete = completedAgents.has(agentId);

                          return (
                            <button
                              key={agentId}
                              className="border px-3 py-2 text-xs uppercase tracking-[0.22em] transition"
                              onClick={() => setSelectedSpecialistTab(agentId)}
                              style={{
                                ...SURFACE_RADIUS_STYLE,
                                borderColor: isSelectedTab
                                  ? agent.accentColor
                                  : "#35322f",
                                backgroundColor: isSelectedTab
                                  ? `${agent.accentColor}22`
                                  : "#23211e",
                                boxShadow:
                                  isRunning && isSelectedTab
                                    ? `0 0 20px ${agent.glowColor}`
                                    : "none",
                                color: isSelectedTab ? "#ffffff" : "#d7d3cb",
                              }}
                              type="button"
                            >
                              {agent.name}
                              {isRunning ? " - Live" : isComplete ? " - Done" : ""}
                            </button>
                          );
                        })
                      ) : (
                        <div className="text-xs uppercase tracking-[0.22em] text-[#9f9b92]">
                          Waiting for the pipeline to activate specialist agents.
                        </div>
                      )}
                    </div>

                    <div
                      className="h-[22rem] overflow-y-auto border border-[#2c2a27] bg-[#12110f] px-5 py-5"
                      ref={specialistPanelBodyRef}
                      style={SURFACE_RADIUS_STYLE}
                    >
                      {selectedSpecialistTab ? (
                        <MarkdownDocument
                          content={specialistOutputs[selectedSpecialistTab]}
                          placeholder={`Waiting for ${getAgentConfig(selectedSpecialistTab).name} output.`}
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-center text-sm leading-7 text-[#a6a39b]">
                          Run a request to stream specialist output here.
                        </div>
                      )}
                    </div>
                  </>
                ) : null}
              </section>

              <section
                className="border border-[#282623] bg-[#161513] p-5"
                style={SURFACE_RADIUS_STYLE}
              >
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-[#f3f1ea]">
                      Pipeline Output
                    </h2>
                    <p className="text-sm text-[#a6a39b]">
                      {mode === "intel"
                        ? "Research and synthesis stream below the specialist team."
                        : "Research, comparison, and synthesis stream after the specialist phase."}
                    </p>
                  </div>
                  <div
                    className="border border-[#34312d] bg-[#1b1a18] px-3 py-1 text-xs uppercase tracking-[0.22em] text-[#ddd9d1]"
                    style={SURFACE_RADIUS_STYLE}
                  >
                    {isLoading ? "Live" : "Idle"}
                  </div>
                </div>

                <div className="flex flex-col gap-5">
                  <PipelineConnector
                    active={specialistResearchHandoffLive}
                    accentColor={AGENT_CONFIGS.research.accentColor}
                  />

                  <article ref={researchCardRef}>
                    <PipelineCard
                      accentColor={AGENT_CONFIGS.research.accentColor}
                      bodyRef={researchBodyRef}
                      content={deferredResearchOutput}
                      glowColor={AGENT_CONFIGS.research.glowColor}
                      placeholder={
                        mode === "intel"
                          ? "Waiting for the specialist team to hand off to Research."
                          : "Waiting for competitor specialists to hand off to Research."
                      }
                      state={researchCardState}
                      subtitle={
                        mode === "intel"
                          ? "Aggregated research memo"
                          : "Competitor intelligence memo"
                      }
                      title="Research Agent"
                      waitingLabel="Waiting"
                    />
                  </article>

                  {mode === "compare" ? (
                    <>
                      <PipelineConnector
                        active={researchComparisonHandoffLive}
                        accentColor={AGENT_CONFIGS.comparison.accentColor}
                      />

                      <article ref={comparisonCardRef}>
                        <PipelineCard
                          accentColor={AGENT_CONFIGS.comparison.accentColor}
                          bodyRef={comparisonBodyRef}
                          content={deferredComparisonOutput}
                          glowColor={AGENT_CONFIGS.comparison.glowColor}
                          placeholder="Waiting for Research to hand off to Comparison."
                          state={comparisonCardState}
                          subtitle="Head-to-head strategic analysis"
                          title="Comparison Agent"
                          waitingLabel="Waiting"
                        />
                      </article>

                      <PipelineConnector
                        active={comparisonSynthesisHandoffLive}
                        accentColor={AGENT_CONFIGS.synthesis.accentColor}
                      />
                    </>
                  ) : (
                    <PipelineConnector
                      active={researchSynthesisHandoffLive}
                      accentColor={AGENT_CONFIGS.synthesis.accentColor}
                    />
                  )}

                  <article ref={synthesisCardRef}>
                    <PipelineCard
                      accentColor={AGENT_CONFIGS.synthesis.accentColor}
                      bodyRef={synthesisBodyRef}
                      content={deferredSynthesisOutput}
                      glowColor={AGENT_CONFIGS.synthesis.glowColor}
                      placeholder={
                        mode === "intel"
                          ? "Waiting for the research handoff."
                          : "Waiting for the comparison handoff."
                      }
                      state={synthesisCardState}
                      subtitle="Executive brief generation"
                      title="Synthesis Agent"
                      waitingLabel="Waiting"
                    />
                  </article>
                </div>

                {isDone && usageStats ? (
                  <div className="mt-5 flex flex-col items-center gap-3">
                    <div className="flex flex-wrap items-center justify-center gap-3">
                      <button
                        className="inline-flex items-center justify-center border border-[#34312d] bg-[#1b1a18] px-4 py-3 text-sm font-semibold text-[#f3f1ea] transition hover:bg-[#24221f]"
                        onClick={() => setActiveView("dashboard")}
                        style={SURFACE_RADIUS_STYLE}
                        type="button"
                      >
                        View Graph Dashboard
                      </button>
                      <button
                        className="inline-flex items-center justify-center border border-[#34312d] bg-[#2a2825] px-4 py-3 text-sm font-semibold text-[#f3f1ea] transition hover:bg-[#34312d]"
                        onClick={handleDownloadAnalysis}
                        style={SURFACE_RADIUS_STYLE}
                        type="button"
                      >
                        Download Analysis
                      </button>
                    </div>
                    <UsageSummary centered usageStats={usageStats} />
                  </div>
                ) : null}
              </section>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {showApiKeyPrompt ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 print:hidden">
          <div
            className="w-full max-w-md border border-[#2a2d36] bg-[#13161e] p-5 shadow-2xl"
            style={SURFACE_RADIUS_STYLE}
          >
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.24em] text-gray-500">
                API KEY
              </p>
              <h2 className="text-lg font-semibold text-white">
                Change API Key
              </h2>
              <p className="text-sm text-gray-400">
                Update the locally stored key used for this workspace shell.
              </p>
            </div>

            <label className="mt-5 block space-y-2">
              <span className="text-xs uppercase tracking-[0.24em] text-[#8f8a7f]">
                OpenAI API Key
              </span>
              <input
                className="w-full border border-[#2d2b28] bg-[#12110f] px-4 py-3 text-sm text-[#f3f1ea] outline-none transition placeholder:text-[#76726a] focus:border-[#6d685f] focus:ring-2 focus:ring-[#6d685f]/15"
                onChange={(event) => setApiKeyInput(event.target.value)}
                placeholder="sk-..."
                style={SURFACE_RADIUS_STYLE}
                type="password"
                value={apiKeyInput}
              />
            </label>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                className="border border-[#34312d] bg-[#1b1a18] px-4 py-2 text-xs font-semibold text-[#ddd9d1] transition hover:bg-[#24221f]"
                onClick={() => {
                  setApiKeyInput(storedApiKey);
                  setShowApiKeyPrompt(false);
                }}
                style={SURFACE_RADIUS_STYLE}
                type="button"
              >
                Cancel
              </button>
              <button
                className="border border-[#34312d] bg-[#2a2825] px-4 py-2 text-xs font-semibold text-[#f3f1ea] transition hover:bg-[#34312d] disabled:cursor-not-allowed disabled:border-[#2a2825] disabled:bg-[#1b1a18] disabled:text-[#7f7b73]"
                disabled={!apiKeyInput.trim()}
                onClick={handleApiKeySave}
                style={SURFACE_RADIUS_STYLE}
                type="button"
              >
                Save Key
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="hidden print:block">
        {isPrintingDashboard && chartData ? (
          <div className="dashboard-print print-doc px-12 py-10 text-black">
            <Dashboard data={chartData} />
          </div>
        ) : mode === "compare" ? (
          <div className="print-doc px-12 py-10 text-black">
            <section className="print-cover">
              <h1 className="mt-4 text-4xl font-semibold tracking-tight text-black">
                COMPARISON REPORT: {printBaseCompany} vs {printCompetitorCompany}
              </h1>
              <p className="mt-3 text-sm text-gray-700">{todayLabel}</p>
            </section>

            <section className="print-section print-page-break">
              <h2 className="text-2xl font-semibold text-black">
                Competitor Intelligence
              </h2>
              <PrintMarkdownDocument content={researchOutput || "_No output generated._"} />
            </section>

            <section className="print-section print-page-break">
              <h2 className="text-2xl font-semibold text-black">
                Base Company Profile
              </h2>
              <PrintMarkdownDocument content={contextOutput || "_No output generated._"} />
            </section>

            <section className="print-section print-page-break">
              <h2 className="text-2xl font-semibold text-black">
                Head-to-Head Comparison
              </h2>
              <PrintMarkdownDocument
                content={comparisonOutput || "_No output generated._"}
              />
            </section>

            <section className="print-section print-page-break">
              <h2 className="text-2xl font-semibold text-black">
                Executive Summary
              </h2>
              <PrintMarkdownDocument
                content={synthesisOutput || "_No output generated._"}
              />
            </section>
          </div>
        ) : (
          <div className="print-doc px-12 py-10 text-black">
            <p className="text-xs uppercase tracking-[0.28em] text-gray-600">
              ENTERPRISE AI AGENT DEMO | Demystified.ai
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-black">
              {printIntelCompany}
            </h1>
            <p className="mt-2 text-sm text-gray-700">{todayLabel}</p>

            <section className="print-section print-page-break">
              <h2 className="text-2xl font-semibold text-black">
                Executive Brief
              </h2>
              <PrintMarkdownDocument
                content={synthesisOutput || "_No output generated._"}
              />
            </section>

            <section className="print-section print-page-break">
              <h2 className="text-2xl font-semibold text-black">
                Research Analysis
              </h2>
              <PrintMarkdownDocument
                content={researchOutput || "_No output generated._"}
              />
            </section>
          </div>
        )}
      </div>

      <style jsx global>{`
        body {
          background:
            radial-gradient(circle at top left, rgba(113, 113, 122, 0.18), transparent 28%),
            radial-gradient(circle at top right, rgba(39, 39, 42, 0.28), transparent 26%),
            linear-gradient(180deg, #020202 0%, #09090b 42%, #000000 100%);
        }

        .markdown-body {
          color: #94a3b8;
        }

        .markdown-body h1 {
          margin-bottom: 0.5rem;
          font-size: 1.25rem;
          font-weight: 700;
          line-height: 1.35;
          color: #ffffff;
        }

        .markdown-body h2 {
          margin-top: 1rem;
          margin-bottom: 0.4rem;
          font-size: 1.1rem;
          font-weight: 600;
          line-height: 1.4;
          color: #e2e8f0;
        }

        .markdown-body h3 {
          margin-top: 0.85rem;
          margin-bottom: 0.3rem;
          font-size: 0.95rem;
          font-weight: 600;
          line-height: 1.45;
          color: #cbd5e1;
        }

        .markdown-body p {
          margin-bottom: 0.5rem;
          font-size: 0.875rem;
          font-weight: 400;
          line-height: 1.7;
          color: #94a3b8;
        }

        .markdown-body strong {
          font-weight: 700;
          color: #e2e8f0;
        }

        .markdown-body em {
          font-style: italic;
          color: #cbd5e1;
        }

        .markdown-body ul,
        .markdown-body ol {
          margin: 0.75rem 0;
          padding-left: 1.25rem;
        }

        .markdown-body li {
          margin-bottom: 0.35rem;
          font-size: 0.875rem;
          font-weight: 400;
          line-height: 1.6;
          color: #94a3b8;
        }

        .markdown-body li strong {
          font-weight: 700;
          color: #e2e8f0;
        }

        .markdown-body a {
          color: #e2e8f0;
          text-decoration: underline;
          text-decoration-color: rgba(148, 163, 184, 0.55);
          text-underline-offset: 3px;
        }

        .markdown-body hr {
          margin: 1rem 0;
          border: 0;
          border-top: 1px solid #374151;
        }

        .markdown-body code {
          border-radius: 3px;
          background: #1f2937;
          padding: 0.08rem 0.35rem;
          font-size: 0.82em;
          color: #e2e8f0;
        }

        @media print {
          body {
            background: #ffffff !important;
            color: #111111 !important;
          }

          .recharts-wrapper {
            display: block !important;
          }

          .recharts-surface {
            display: block !important;
          }

          .print-doc {
            font-family:
              ui-serif, Georgia, Cambria, "Times New Roman", Times, serif;
          }

          .dashboard-print,
          .dashboard-print * {
            color: #111111 !important;
          }

          .dashboard-print {
            font-family:
              ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }

          .dashboard-stat-card {
            border: 1px solid #ccc !important;
            background: white !important;
            color: black !important;
            padding: 8px !important;
          }

          .dashboard-chart-container {
            page-break-inside: avoid;
            margin-bottom: 20px;
          }

          .dashboard-print .dashboard-panel {
            border: 1px solid #ccc !important;
            background: white !important;
          }

          .print-section {
            width: 100%;
          }

          .print-page-break {
            break-before: page;
            page-break-before: always;
            margin-top: 0;
          }

          .print-markdown,
          .print-markdown * {
            color: #111111 !important;
          }

          .print-markdown code {
            background: #f3f4f6 !important;
            color: #111111 !important;
          }

          .markdown-body h1 {
            font-size: 18pt;
            font-weight: bold;
            color: #000 !important;
          }

          .markdown-body h2 {
            font-size: 14pt;
            font-weight: bold;
            color: #111 !important;
          }

          .markdown-body h3 {
            font-size: 12pt;
            font-weight: 600;
            color: #222 !important;
          }

          .markdown-body p,
          .markdown-body li {
            font-size: 10pt;
            font-weight: 400;
            color: #333 !important;
          }

          .markdown-body strong {
            font-weight: bold;
            color: #000 !important;
          }
        }
      `}</style>
    </main>
  );
}
