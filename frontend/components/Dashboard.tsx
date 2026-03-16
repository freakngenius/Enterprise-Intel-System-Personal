"use client";

import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type DashboardSummaryStat = {
  change?: string | null;
  label: string;
  trend?: "up" | "down" | "neutral" | string | null;
  value: string;
};

export type DashboardMarketShare = {
  color?: string;
  name: string;
  value: number;
};

export type DashboardRiskScore = {
  dimension: string;
  score: number;
};

export type DashboardOpportunity = {
  impact: number;
  name: string;
  urgency: number;
};

export type DashboardCompetitor = {
  market_share: number;
  momentum?: number;
  name: string;
  threat_level?: string;
};

export type DashboardTimelineItem = {
  date: string;
  event: string;
  type?: string;
};

export type DashboardFinding = {
  category: string;
  text: string;
};

export type DashboardData = {
  company?: string;
  competitors?: DashboardCompetitor[];
  generated_at?: string;
  key_findings?: DashboardFinding[];
  market_share?: DashboardMarketShare[];
  opportunities?: DashboardOpportunity[];
  risk_scores?: DashboardRiskScore[];
  summary_stats?: DashboardSummaryStat[];
  timeline?: DashboardTimelineItem[];
};

const SURFACE_STYLE = { borderRadius: "3px" } as const;

function DashboardCard({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <div
      className="dashboard-panel border border-[#2a2d36] bg-[#13161e] p-4"
      style={SURFACE_STYLE}
    >
      <p className="mb-4 text-xs uppercase tracking-[0.24em] text-gray-400">
        {title}
      </p>
      {children}
    </div>
  );
}

function renderThreatTone(threatLevel?: string) {
  if (threatLevel === "high") {
    return "bg-red-900 text-red-300";
  }
  if (threatLevel === "medium") {
    return "bg-yellow-900 text-yellow-300";
  }
  return "bg-slate-800 text-slate-300";
}

export default function Dashboard({ data }: { data: DashboardData | null }) {
  console.log("[CHART] chartData state updated:", data);

  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-500">
        <span className="font-mono">Run an analysis to populate the dashboard.</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">
            {data.company || "Intelligence Dashboard"}
          </h2>
          <p className="mt-1 font-mono text-xs uppercase tracking-[0.24em] text-gray-500">
            Intelligence Dashboard
            {data.generated_at ? ` · ${data.generated_at}` : ""}
          </p>
        </div>
      </div>

      {data.summary_stats?.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {data.summary_stats.map((stat, index) => (
            <div
              key={`${stat.label}-${index}`}
              className="dashboard-stat-card border border-[#2a2d36] bg-[#13161e] p-4"
              style={SURFACE_STYLE}
            >
              <p className="text-xs uppercase tracking-[0.24em] text-gray-500">
                {stat.label}
              </p>
              <p className="mt-1 text-2xl font-bold text-white">{stat.value}</p>
              {stat.change ? (
                <p
                  className={`mt-1 font-mono text-xs ${
                    stat.trend === "up"
                      ? "text-green-400"
                      : stat.trend === "down"
                        ? "text-red-400"
                        : "text-gray-500"
                  }`}
                >
                  {stat.change}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {data.market_share?.length ? (
          <div className="dashboard-chart-container">
            <DashboardCard title="Market Share">
            <ResponsiveContainer height={220} width="100%">
              <PieChart>
                <Pie
                  cx="50%"
                  cy="50%"
                  data={data.market_share}
                  dataKey="value"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={3}
                >
                  {data.market_share.map((entry, index) => (
                    <Cell
                      fill={entry.color || "#4f8ef7"}
                      key={`${entry.name}-${index}`}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#13161e",
                    border: "1px solid #2a2d36",
                    borderRadius: "4px",
                    color: "#fff",
                    fontSize: "12px",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-2 flex flex-wrap gap-2">
              {data.market_share.map((item, index) => (
                <div className="flex items-center gap-1" key={`${item.name}-${index}`}>
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: item.color || "#4f8ef7" }}
                  />
                  <span className="text-xs text-gray-400">
                    {item.name} {item.value}%
                  </span>
                </div>
              ))}
            </div>
            </DashboardCard>
          </div>
        ) : null}

        {data.risk_scores?.length ? (
          <div className="dashboard-chart-container">
            <DashboardCard title="Risk Profile">
            <ResponsiveContainer height={220} width="100%">
              <RadarChart data={data.risk_scores}>
                <PolarGrid stroke="#2a2d36" />
                <PolarAngleAxis
                  dataKey="dimension"
                  tick={{ fill: "#8b8fa8", fontSize: 11 }}
                />
                <Radar
                  dataKey="score"
                  fill="#e5534b"
                  fillOpacity={0.2}
                  stroke="#e5534b"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#13161e",
                    border: "1px solid #2a2d36",
                    borderRadius: "4px",
                    color: "#fff",
                    fontSize: "12px",
                  }}
                />
              </RadarChart>
            </ResponsiveContainer>
            </DashboardCard>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {data.opportunities?.length ? (
          <div className="dashboard-chart-container">
            <DashboardCard title="Opportunity Matrix (Impact vs Urgency)">
            <ResponsiveContainer height={200} width="100%">
              <ScatterChart margin={{ bottom: 20, left: 10, right: 10, top: 10 }}>
                <XAxis
                  dataKey="urgency"
                  domain={[0, 10]}
                  label={{
                    fill: "#5a5e72",
                    fontSize: 10,
                    position: "bottom",
                    value: "Urgency",
                  }}
                  name="Urgency"
                  tick={{ fill: "#8b8fa8", fontSize: 10 }}
                  type="number"
                />
                <YAxis
                  dataKey="impact"
                  domain={[0, 10]}
                  label={{
                    angle: -90,
                    fill: "#5a5e72",
                    fontSize: 10,
                    position: "insideLeft",
                    value: "Impact",
                  }}
                  name="Impact"
                  tick={{ fill: "#8b8fa8", fontSize: 10 }}
                  type="number"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#13161e",
                    border: "1px solid #2a2d36",
                    borderRadius: "4px",
                    color: "#fff",
                    fontSize: "12px",
                  }}
                  cursor={{ strokeDasharray: "3 3" }}
                />
                <Scatter data={data.opportunities} fill="#4f8ef7" />
              </ScatterChart>
            </ResponsiveContainer>
            <div className="mt-1 space-y-1">
              {data.opportunities.map((item, index) => (
                <div
                  className="flex items-center gap-2 text-xs text-gray-400"
                  key={`${item.name}-${index}`}
                >
                  <div className="h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" />
                  <span>{item.name}</span>
                  <span className="ml-auto text-gray-600">
                    Impact {item.impact} · Urgency {item.urgency}
                  </span>
                </div>
              ))}
            </div>
            </DashboardCard>
          </div>
        ) : null}

        {data.competitors?.length ? (
          <div className="dashboard-chart-container">
            <DashboardCard title="Competitive Landscape">
            <ResponsiveContainer height={200} width="100%">
              <BarChart data={data.competitors} layout="vertical" margin={{ left: 20 }}>
                <XAxis
                  domain={[0, 100]}
                  tick={{ fill: "#8b8fa8", fontSize: 10 }}
                  type="number"
                />
                <YAxis
                  dataKey="name"
                  tick={{ fill: "#c8cad8", fontSize: 11 }}
                  type="category"
                  width={110}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#13161e",
                    border: "1px solid #2a2d36",
                    borderRadius: "4px",
                    color: "#fff",
                    fontSize: "12px",
                  }}
                />
                <Bar dataKey="market_share" fill="#4f8ef7" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-2 space-y-1">
              {data.competitors.map((item, index) => (
                <div
                  className="flex items-center justify-between text-xs"
                  key={`${item.name}-${index}`}
                >
                  <span className="text-gray-300">{item.name}</span>
                  <span
                    className={`rounded px-2 py-0.5 font-mono text-xs ${renderThreatTone(
                      item.threat_level,
                    )}`}
                    style={SURFACE_STYLE}
                  >
                    {item.threat_level || "unknown"}
                  </span>
                </div>
              ))}
            </div>
            </DashboardCard>
          </div>
        ) : null}
      </div>

      {data.timeline?.length ? (
        <div className="dashboard-chart-container">
          <DashboardCard title="Key Event Timeline">
          <div className="relative">
            <div className="absolute bottom-0 left-0 top-0 ml-16 w-px bg-[#2a2d36]" />
            <div className="space-y-3">
              {data.timeline.map((item, index) => (
                <div className="flex items-start gap-4" key={`${item.date}-${index}`}>
                  <span className="w-16 flex-shrink-0 pt-0.5 font-mono text-xs text-gray-500">
                    {item.date}
                  </span>
                  <div
                    className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${
                      item.type === "product"
                        ? "bg-blue-400"
                        : item.type === "financial"
                          ? "bg-green-400"
                          : "bg-red-400"
                    }`}
                  />
                  <span className="text-sm text-gray-300">{item.event}</span>
                  <span
                    className="ml-auto rounded border border-[#2a2d36] px-2 py-0.5 text-[0.68rem] uppercase tracking-[0.18em] text-gray-500"
                    style={SURFACE_STYLE}
                  >
                    {item.type || "event"}
                  </span>
                </div>
              ))}
            </div>
          </div>
          </DashboardCard>
        </div>
      ) : null}

      {data.key_findings?.length ? (
        <DashboardCard title="Key Findings">
          <div className="grid gap-3 md:grid-cols-2">
            {data.key_findings.map((item, index) => (
              <div
                className="border border-[#262b35] bg-[#10141b] p-3"
                key={`${item.category}-${index}`}
                style={SURFACE_STYLE}
              >
                <p className="text-[0.68rem] uppercase tracking-[0.2em] text-gray-500">
                  {item.category}
                </p>
                <p className="mt-2 text-sm leading-6 text-gray-300">{item.text}</p>
              </div>
            ))}
          </div>
        </DashboardCard>
      ) : null}
    </div>
  );
}
