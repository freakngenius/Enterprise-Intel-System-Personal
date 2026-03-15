"use client";

import {
  BookOpen,
  Brain,
  FileSearch,
  GitCompare,
  Search,
  ShieldAlert,
  Sparkles,
  Swords,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
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

type Mode = "intel" | "compare";
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

function buildAnalyzeUrl(company: string, request: string): string {
  const params = new URLSearchParams({ company, request });
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

function MarkdownDocument({
  content,
  placeholder,
}: {
  content: string;
  placeholder: string;
}) {
  if (!content.trim()) {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm leading-7 text-gray-300">
        {placeholder}
      </div>
    );
  }

  return (
    <div className="agent-markdown prose prose-invert max-w-none text-[0.95rem] leading-7 text-gray-200">
      <ReactMarkdown
        components={{
          h1: ({ children }) => (
            <h1 className="mt-0 text-2xl font-semibold tracking-tight text-white">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-8 text-xl font-semibold tracking-tight text-white">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-6 text-lg font-semibold tracking-tight text-white">
              {children}
            </h3>
          ),
          p: ({ children }) => <p className="my-4 text-gray-200">{children}</p>,
          ul: ({ children }) => <ul className="my-5 space-y-3">{children}</ul>,
          ol: ({ children }) => <ol className="my-5 space-y-3">{children}</ol>,
          li: ({ children }) => (
            <li className="relative pl-5 text-gray-200 before:absolute before:left-0 before:top-[0.78rem] before:h-1.5 before:w-1.5 before:rounded-full before:bg-sky-400/70">
              {children}
            </li>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-white">{children}</strong>
          ),
          em: ({ children }) => <em className="text-gray-100">{children}</em>,
          a: ({ children, href }) => (
            <a
              className="text-red-300 underline decoration-red-500/60 underline-offset-4"
              href={href}
              rel="noreferrer"
              target="_blank"
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-6 border-gray-600" />,
          code: ({ children }) => (
            <code
              className="bg-gray-700 px-1.5 py-0.5 text-[0.9em] text-gray-100"
              style={SURFACE_RADIUS_STYLE}
            >
              {children}
            </code>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function PrintMarkdownDocument({ content }: { content: string }) {
  return (
    <div className="print-markdown prose max-w-none text-black">
      <ReactMarkdown
        components={{
          h1: ({ children }) => (
            <h1 className="mt-0 text-2xl font-semibold tracking-tight text-black">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-8 text-xl font-semibold tracking-tight text-black">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-6 text-lg font-semibold tracking-tight text-black">
              {children}
            </h3>
          ),
          p: ({ children }) => <p className="my-4 text-black">{children}</p>,
          ul: ({ children }) => <ul className="my-5 space-y-3">{children}</ul>,
          ol: ({ children }) => <ol className="my-5 space-y-3">{children}</ol>,
          li: ({ children }) => <li className="ml-5 list-disc text-black">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-black">{children}</strong>
          ),
          em: ({ children }) => <em className="text-black">{children}</em>,
          a: ({ children, href }) => (
            <a className="text-black underline" href={href}>
              {children}
            </a>
          ),
          code: ({ children }) => (
            <code
              className="bg-gray-100 px-1 py-0.5 text-[0.9em] text-black"
              style={SURFACE_RADIUS_STYLE}
            >
              {children}
            </code>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
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
        className="inline-flex items-center gap-2 border border-gray-500 bg-gray-800 px-3 py-1 text-xs uppercase tracking-[0.22em] text-gray-200 print:hidden"
        style={SURFACE_RADIUS_STYLE}
      >
        <span className="text-sm leading-none text-white">✓</span>
        Complete
      </div>
    );
  }

  if (state === "active") {
    return (
      <div
        className="inline-flex items-center gap-2 border border-gray-500 bg-gray-800 px-3 py-1 text-xs uppercase tracking-[0.22em] text-gray-100 print:hidden"
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
      className="inline-flex items-center gap-2 border border-gray-500 bg-gray-800 px-3 py-1 text-xs uppercase tracking-[0.22em] text-gray-300 print:hidden"
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
      className={`border-t border-gray-500 pt-3 text-xs leading-6 text-gray-300 ${
        centered ? "mx-auto flex w-fit flex-col items-center text-center" : ""
      }`}
    >
      <p className="font-mono text-gray-200">
        <span className="font-semibold text-white">Tokens:</span>{" "}
        {numberFormatter.format(usageStats.total_tokens)} total (
        {numberFormatter.format(usageStats.input_tokens)} in /{" "}
        {numberFormatter.format(usageStats.output_tokens)} out)
      </p>
      <p className="font-mono text-gray-200">
        <span className="font-semibold text-white">Cost:</span> $
        {usageStats.cost_usd.toFixed(4)}
      </p>
    </div>
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
          active ? "animate-pulse bg-gray-700/70 text-white" : "bg-gray-800 text-gray-300"
        }`}
        style={{
          ...SURFACE_RADIUS_STYLE,
          borderColor: active ? accentColor : "rgba(107, 114, 128, 1)",
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
      className={`overflow-hidden border border-gray-600 bg-gray-900 transition duration-300 ${
        state === "waiting" ? "opacity-50" : "opacity-100"
      }`}
      style={getPipelineCardStyle(state, accentColor, glowColor)}
    >
      <div className="flex items-center justify-between border-b border-gray-600 px-5 py-4">
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
            <h3 className="text-base font-semibold text-white">{title}</h3>
            <p className="mt-1 text-xs uppercase tracking-[0.22em] text-gray-300">
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
        className="h-[24rem] overflow-y-auto bg-gray-900 px-5 py-5"
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
      className={`relative flex min-h-[120px] flex-col border bg-gray-800 p-4 transition-all duration-300 ${
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
        <Icon className="h-8 w-8 text-gray-300" strokeWidth={1.75} />
      </div>

      <div className="space-y-1">
        <p className="text-[0.68rem] uppercase tracking-[0.28em] text-white">
          {agent.name}
        </p>
        <p className="text-[0.68rem] leading-4 text-gray-300">
          {agent.description}
        </p>
      </div>
    </div>
  );
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("intel");

  const [intelCompany, setIntelCompany] = useState(INITIAL_INTEL_COMPANY);
  const [intelRequest, setIntelRequest] = useState(INITIAL_INTEL_REQUEST);

  const [baseCompany, setBaseCompany] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [competitorCompany, setCompetitorCompany] = useState("");
  const [compareFocus, setCompareFocus] = useState("");
  const [compareFiles, setCompareFiles] = useState<File[]>([]);

  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
  const [status, setStatus] = useState("Idle");
  const [focusAgent, setFocusAgent] = useState<AgentId>("triage");
  const [isLoading, setIsLoading] = useState(false);
  const [isDone, setIsDone] = useState(false);

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

  const deferredContextOutput = useDeferredValue(contextOutput);
  const deferredResearchOutput = useDeferredValue(researchOutput);
  const deferredComparisonOutput = useDeferredValue(comparisonOutput);
  const deferredSynthesisOutput = useDeferredValue(synthesisOutput);

  const todayLabel = new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
  }).format(new Date());

  const displayedRosterIds =
    mode === "intel" ? INTEL_ROSTER_IDS : COMPARE_ROSTER_IDS;
  const focusAgentLabel = getAgentConfig(focusAgent).name;
  const printIntelCompany = intelCompany.trim() || "Company Analysis";
  const printBaseCompany = baseCompany.trim() || "Base Company";
  const printCompetitorCompany = competitorCompany.trim() || "Competitor";

  const assembledAgentIds =
    mode === "intel"
      ? new Set<AgentId>(
          selectedSpecialists.length
            ? (["triage", "research", "synthesis", ...selectedSpecialists] as AgentId[])
            : [],
        )
      : compareRosterActivated
        ? new Set<AgentId>(COMPARE_ROSTER_IDS)
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

  function resetRunState(nextMode: Mode) {
    clearSequenceTimers();
    clearConnectorFlashes();
    doneReceivedRef.current = false;
    stageRef.current = "idle";
    currentRunModeRef.current = nextMode;
    expectedCloseRef.current = false;

    setStatus("Idle");
    setUsageStats(null);
    setIsLoading(false);
    setIsDone(false);
    setRosterPhase("idle");
    setRosterMessage("");
    setScanIndex(null);
    setCompareRosterActivated(false);
    setFocusAgent(nextMode === "intel" ? "triage" : "context");
    setCompletedAgents(new Set());
    setActiveAgents(new Set());
    setSelectedSpecialists(
      nextMode === "intel" ? [] : SPECIALIST_AGENT_IDS.slice(),
    );
    setTriageReasoning("");
    setSelectedSpecialistTab(nextMode === "intel" ? null : "recon");
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

    startTransition(() => {
      setResearchOutput((current) => current + chunk);
    });
  }

  function appendComparisonOutput(chunk: string) {
    if (!chunk) {
      return;
    }

    startTransition(() => {
      setComparisonOutput((current) => current + chunk);
    });
  }

  function appendSynthesisOutput(chunk: string) {
    if (!chunk) {
      return;
    }

    startTransition(() => {
      setSynthesisOutput((current) => current + chunk);
    });
  }

  function handleResearchHandoff() {
    stageRef.current = "research";
    setStreamStage("research");
    flashConnector("specialistResearch");
    markAgentActive("research");
  }

  function handleComparisonHandoff() {
    stageRef.current = "comparison";
    setStreamStage("comparison");
    flashConnector("researchComparison");
    markAgentComplete("research");
    markAgentActive("comparison");
  }

  function handleSynthesisHandoff() {
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
    markAgentComplete("synthesis");
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

    if (data.startsWith(USAGE_TOKEN)) {
      try {
        setUsageStats(JSON.parse(data.slice(USAGE_TOKEN.length).trimStart()) as UsageStats);
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
      stageRef.current = "context";
      setStreamStage("context");
      markAgentActive("context");
      return;
    }

    if (data === "[AGENT_DONE_context]") {
      markAgentComplete("context");
      return;
    }

    const agentStartMatch = data.match(/^\[AGENT_START_([a-z]+)\]$/);
    if (agentStartMatch) {
      const agentId = normalizeSpecialistAgent(agentStartMatch[1]);
      if (!agentId) {
        return;
      }
      markAgentActive(agentId);
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

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";

      for (const chunk of chunks) {
        const parsed = parseSseBlock(chunk);
        if (parsed) {
          handleParsedStreamEvent(parsed.event, parsed.data);
        }
      }
    }

    const trailing = buffer.trim();
    if (trailing) {
      const parsed = parseSseBlock(trailing);
      if (parsed) {
        handleParsedStreamEvent(parsed.event, parsed.data);
      }
    }
  }

  async function startCompareFetchStream(formData: FormData) {
    const controller = new AbortController();
    compareAbortRef.current = controller;

    try {
      const response = await fetch("/api/compare", {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
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
    setIsLoading(true);
    setStatus(
      runMode === "compare"
        ? "Connecting to the comparison pipeline."
        : "Connecting to the agent pipeline.",
    );
  }

  function handleIntelSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const company = intelCompany.trim();
    const request = intelRequest.trim();

    if (!company || !request) {
      setStatus("Both fields are required.");
      return;
    }

    prepareNewRun("intel");
    beginIntelRosterSequence();

    const source = new EventSource(buildAnalyzeUrl(company, request));
    sourceRef.current = source;

    source.onopen = () => {
      setStatus("Agent pipeline connected. Waiting for results.");
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

  function handleCompareSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedBaseCompany = baseCompany.trim();
    const trimmedCompetitorCompany = competitorCompany.trim();

    if (!trimmedBaseCompany || !trimmedCompetitorCompany) {
      setStatus("Base company and competitor are required.");
      return;
    }

    prepareNewRun("compare");
    beginCompareRosterSequence();
    setSelectedSpecialists(SPECIALIST_AGENT_IDS.slice());
    setSelectedSpecialistTab("recon");

    const formData = new FormData();
    formData.set("base_company", trimmedBaseCompany);
    formData.set("competitor_company", trimmedCompetitorCompany);

    if (baseUrl.trim()) {
      formData.set("base_url", baseUrl.trim());
    }

    if (compareFocus.trim()) {
      formData.set("focus", compareFocus.trim());
    }

    for (const file of compareFiles) {
      formData.append("files", file, file.name);
    }

    void startCompareFetchStream(formData);
  }

  function handleModeChange(nextMode: Mode) {
    if (mode === nextMode || isLoading) {
      return;
    }

    closeActiveStreams();
    resetRunState(nextMode);
    setMode(nextMode);
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
    window.print();
  }

  useEffect(() => {
    return () => {
      closeActiveStreams();
      clearSequenceTimers();
      clearConnectorFlashes();
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

  return (
    <main className="min-h-screen px-6 py-10 text-gray-100 sm:px-10 print:bg-white print:px-0 print:py-0 print:text-black">
      <div className="print:hidden">
        <div className="mx-auto flex max-w-7xl flex-col gap-8">
          <section
            className="overflow-hidden border border-gray-500 bg-gray-800 shadow-2xl shadow-black/20 backdrop-blur"
            style={SURFACE_RADIUS_STYLE}
          >
            <div className="border-b border-gray-500 px-8 py-8">
              <div className="mb-4 flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.32em] text-gray-200">
                <span
                  className="border border-red-400/40 bg-red-500/15 px-3 py-1 text-red-100"
                  style={SURFACE_RADIUS_STYLE}
                >
                  Enterprise AI Agent Demo
                </span>
                <span
                  className="border border-gray-500 bg-gray-800 px-3 py-1 text-gray-200"
                  style={SURFACE_RADIUS_STYLE}
                >
                  Agent: {focusAgentLabel}
                </span>
                <span
                  className="border border-gray-500 bg-gray-800 px-3 py-1 text-gray-200"
                  style={SURFACE_RADIUS_STYLE}
                >
                  {isLoading ? "Streaming" : "Ready"}
                </span>
              </div>

              <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
                <div className="space-y-3">
                  <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                    Enterprise Intel System
                  </h1>
                  <p className="max-w-2xl text-sm leading-7 text-gray-300 sm:text-base">
                    Multi-agent enterprise intelligence, powered by OpenAI Agents SDK
                  </p>
                  <p className="max-w-2xl text-sm text-gray-300">
                    Made by Kyle Kesterson | Demystified.ai
                  </p>
                </div>

                <div
                  className="border border-gray-500 bg-gray-800 p-5 text-sm text-white"
                  style={SURFACE_RADIUS_STYLE}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span className="uppercase tracking-[0.24em] text-gray-300">
                      Run status
                    </span>
                    <span className="text-xs text-white">
                      {isLoading ? "In progress" : "Standing by"}
                    </span>
                  </div>
                  <p className="min-h-16 leading-7 text-white">{status}</p>
                </div>
              </div>
            </div>

            <div className="space-y-6 px-8 py-8">
              <section className="space-y-4">
                <div className="inline-flex border border-gray-500 bg-gray-900 p-1" style={SURFACE_RADIUS_STYLE}>
                  {(["intel", "compare"] as Mode[]).map((modeOption) => {
                    const active = mode === modeOption;
                    return (
                      <button
                        key={modeOption}
                        className={`px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] transition ${
                          active ? "bg-red-500 text-white" : "text-gray-200 hover:bg-gray-800"
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
                          <span className="text-xs uppercase tracking-[0.24em] text-gray-300">
                            Company
                          </span>
                          <input
                            className="w-full border border-gray-600 bg-gray-900 px-4 py-3 text-sm text-white outline-none transition focus:border-red-400/60 focus:ring-2 focus:ring-red-500/15"
                            onChange={(event) => setIntelCompany(event.target.value)}
                            placeholder="Enter a company name"
                            style={SURFACE_RADIUS_STYLE}
                            value={intelCompany}
                          />
                        </label>

                        <button
                          className="inline-flex w-full items-center justify-center bg-red-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-300"
                          disabled={isLoading}
                          style={SURFACE_RADIUS_STYLE}
                          type="submit"
                        >
                          {isLoading ? "Running Analysis..." : "Run Analysis"}
                        </button>
                      </div>

                      <label className="flex min-h-[10.5rem] flex-col space-y-2 lg:min-h-0 lg:flex-1 lg:basis-[65%]">
                        <span className="text-xs uppercase tracking-[0.24em] text-gray-300">
                          Request
                        </span>
                        <textarea
                          className="min-h-[10.5rem] w-full flex-1 border border-gray-600 bg-gray-900 px-4 py-3 text-sm leading-7 text-white outline-none transition focus:border-red-400/60 focus:ring-2 focus:ring-red-500/15"
                          onChange={(event) => setIntelRequest(event.target.value)}
                          placeholder="Describe the analysis you want"
                          style={SURFACE_RADIUS_STYLE}
                          value={intelRequest}
                        />
                      </label>
                    </div>

                    {isDone && usageStats ? <UsageSummary usageStats={usageStats} /> : null}
                  </form>
                ) : (
                  <form className="space-y-4" onSubmit={handleCompareSubmit}>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                      <div className="space-y-4 lg:basis-1/2">
                        <p className="text-xs uppercase tracking-[0.24em] text-gray-300">
                          Your Company
                        </p>

                        <label className="block space-y-2">
                          <span className="text-xs uppercase tracking-[0.24em] text-gray-300">
                            Company Name
                          </span>
                          <input
                            className="w-full border border-gray-600 bg-gray-900 px-4 py-3 text-sm text-white outline-none transition focus:border-red-400/60 focus:ring-2 focus:ring-red-500/15"
                            onChange={(event) => setBaseCompany(event.target.value)}
                            placeholder="Enter your company"
                            style={SURFACE_RADIUS_STYLE}
                            value={baseCompany}
                          />
                        </label>

                        <label className="block space-y-2">
                          <span className="text-xs uppercase tracking-[0.24em] text-gray-300">
                            Website URL
                          </span>
                          <input
                            className="w-full border border-gray-600 bg-gray-900 px-4 py-3 text-sm text-white outline-none transition focus:border-red-400/60 focus:ring-2 focus:ring-red-500/15"
                            onChange={(event) => setBaseUrl(event.target.value)}
                            placeholder="https://..."
                            style={SURFACE_RADIUS_STYLE}
                            value={baseUrl}
                          />
                        </label>

                        <div className="space-y-2">
                          <p className="text-xs uppercase tracking-[0.24em] text-gray-300">
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
                            className="cursor-pointer border border-dashed border-gray-500 bg-gray-900 px-4 py-6 text-center transition hover:border-red-400/60 hover:bg-gray-800"
                            onClick={openFilePicker}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={handleFileDrop}
                            style={SURFACE_RADIUS_STYLE}
                          >
                            <p className="text-sm font-medium text-white">
                              Drop files here or click to browse
                            </p>
                            <p className="mt-2 text-xs leading-6 text-gray-300">
                              PDF, DOCX, CSV, TXT - pitch deck, financials, reports
                            </p>
                          </div>
                          {compareFiles.length ? (
                            <div className="flex flex-wrap gap-2">
                              {compareFiles.map((file, index) => (
                                <div
                                  key={`${file.name}-${index}`}
                                  className="inline-flex items-center gap-2 border border-gray-500 bg-gray-800 px-3 py-2 text-xs text-gray-200"
                                  style={SURFACE_RADIUS_STYLE}
                                >
                                  <span>{file.name}</span>
                                  <button
                                    className="text-gray-300 transition hover:text-white"
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
                          className="inline-flex w-full items-center justify-center bg-red-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-300"
                          disabled={isLoading}
                          style={SURFACE_RADIUS_STYLE}
                          type="submit"
                        >
                          {isLoading ? "Running Comparison..." : "Run Comparison"}
                        </button>
                      </div>

                      <div className="space-y-4 lg:basis-1/2">
                        <p className="text-xs uppercase tracking-[0.24em] text-gray-300">
                          Competitor
                        </p>

                        <label className="block space-y-2">
                          <span className="text-xs uppercase tracking-[0.24em] text-gray-300">
                            Company Name
                          </span>
                          <input
                            className="w-full border border-gray-600 bg-gray-900 px-4 py-3 text-sm text-white outline-none transition focus:border-red-400/60 focus:ring-2 focus:ring-red-500/15"
                            onChange={(event) =>
                              setCompetitorCompany(event.target.value)
                            }
                            placeholder="Enter a competitor"
                            style={SURFACE_RADIUS_STYLE}
                            value={competitorCompany}
                          />
                        </label>

                        <label className="block space-y-2">
                          <span className="text-xs uppercase tracking-[0.24em] text-gray-300">
                            Focus
                          </span>
                          <input
                            className="w-full border border-gray-600 bg-gray-900 px-4 py-3 text-sm text-white outline-none transition focus:border-red-400/60 focus:ring-2 focus:ring-red-500/15"
                            onChange={(event) => setCompareFocus(event.target.value)}
                            placeholder='e.g. "pricing strategy and product roadmap"'
                            style={SURFACE_RADIUS_STYLE}
                            value={compareFocus}
                          />
                        </label>
                      </div>
                    </div>

                    {isDone && usageStats ? <UsageSummary usageStats={usageStats} /> : null}
                  </form>
                )}
              </section>

              <section className="space-y-4">
                <p className="text-xs uppercase tracking-[0.28em] text-gray-300">
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

                <div className="min-h-5 text-xs uppercase tracking-[0.24em] text-gray-300">
                  {rosterMessage || "\u00a0"}
                </div>
              </section>

              {mode === "compare" ? (
                <section
                  className="border border-gray-600 bg-gray-900 p-5"
                  style={SURFACE_RADIUS_STYLE}
                >
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-white">
                        Base Company Context
                      </h2>
                      <p className="text-sm text-gray-300">
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
                className="border border-gray-600 bg-gray-900 p-5"
                ref={specialistPanelRef}
                style={SURFACE_RADIUS_STYLE}
              >
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">
                      Specialist Output
                    </h2>
                    <p className="text-sm text-gray-300">
                      {mode === "intel"
                        ? triageReasoning ||
                          "Specialist agents will appear here once triage assembles the team."
                        : "Competitor specialist agents stream in parallel here."}
                    </p>
                  </div>
                  <button
                    className="border border-gray-500 bg-gray-800 px-3 py-2 text-xs uppercase tracking-[0.22em] text-gray-200 transition hover:border-gray-400 hover:bg-gray-700"
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
                                  : "rgba(107, 114, 128, 1)",
                                backgroundColor: isSelectedTab
                                  ? `${agent.accentColor}22`
                                  : "rgba(55, 65, 81, 1)",
                                boxShadow:
                                  isRunning && isSelectedTab
                                    ? `0 0 20px ${agent.glowColor}`
                                    : "none",
                                color: isSelectedTab ? "#ffffff" : "#e5e7eb",
                              }}
                              type="button"
                            >
                              {agent.name}
                              {isRunning ? " - Live" : isComplete ? " - Done" : ""}
                            </button>
                          );
                        })
                      ) : (
                        <div className="text-xs uppercase tracking-[0.22em] text-gray-300">
                          Waiting for the pipeline to activate specialist agents.
                        </div>
                      )}
                    </div>

                    <div
                      className="h-[22rem] overflow-y-auto border border-gray-600 bg-gray-900 px-5 py-5"
                      ref={specialistPanelBodyRef}
                      style={SURFACE_RADIUS_STYLE}
                    >
                      {selectedSpecialistTab ? (
                        <MarkdownDocument
                          content={specialistOutputs[selectedSpecialistTab]}
                          placeholder={`Waiting for ${getAgentConfig(selectedSpecialistTab).name} output.`}
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-center text-sm leading-7 text-gray-300">
                          Run a request to stream specialist output here.
                        </div>
                      )}
                    </div>
                  </>
                ) : null}
              </section>

              <section
                className="border border-gray-600 bg-gray-900 p-5"
                style={SURFACE_RADIUS_STYLE}
              >
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">
                      Pipeline Output
                    </h2>
                    <p className="text-sm text-gray-300">
                      {mode === "intel"
                        ? "Research and synthesis stream below the specialist team."
                        : "Research, comparison, and synthesis stream after the specialist phase."}
                    </p>
                  </div>
                  <div
                    className="border border-red-500/20 bg-red-500/10 px-3 py-1 text-xs uppercase tracking-[0.22em] text-red-200"
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
                    <button
                      className="inline-flex items-center justify-center border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-100 transition hover:border-red-400/40 hover:bg-red-500/20"
                      onClick={handleDownloadAnalysis}
                      style={SURFACE_RADIUS_STYLE}
                      type="button"
                    >
                      Download Analysis
                    </button>
                    <UsageSummary centered usageStats={usageStats} />
                  </div>
                ) : null}
              </section>
            </div>
          </section>
        </div>
      </div>

      <div className="hidden print:block">
        {mode === "compare" ? (
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

        @media print {
          body {
            background: #ffffff !important;
            color: #111111 !important;
          }

          .print-doc {
            font-family:
              ui-serif, Georgia, Cambria, "Times New Roman", Times, serif;
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
        }
      `}</style>
    </main>
  );
}
