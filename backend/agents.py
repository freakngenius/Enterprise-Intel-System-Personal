from agents import Agent, WebSearchTool


triage_agent = Agent(
    name="TriageAgent",
    model="gpt-4.1",
    instructions="""Analyze the company name and request. Decide which specialist agents to activate from this list: recon, financial, competitor, risk, people.

Rules:
- Always include: recon
- Include financial if: earnings, revenue, funding, valuation, investment, acquisition, or company is likely public
- Include competitor if: competitive, market, rivals, landscape, positioning, alternatives
- Include risk if: risks, threats, concerns, legal, regulatory, controversy, red flags
- Include people if: leadership, CEO, executives, team, management, founders

Output ONLY valid JSON, nothing else. No explanation, no markdown:
{"agents": ["recon", "financial"], "reasoning": "brief one-line reason"}""",
)


recon_agent = Agent(
    name="ReconAgent",
    model="gpt-4.1",
    instructions="You are a live web reconnaissance agent. Search for the most recent news, announcements, and developments about the company from the last 90 days. Format each finding as a bullet starting with '→ ' followed by the finding and source domain in parentheses. Output 6-8 findings.",
    tools=[WebSearchTool()],
)


financial_agent = Agent(
    name="FinancialAgent",
    model="gpt-4.1",
    instructions="You are a financial intelligence agent. Search for the company's latest revenue figures, funding rounds, valuation, earnings reports, and investor information. Structure your output as: REVENUE, FUNDING, VALUATION, KEY INVESTORS, FINANCIAL OUTLOOK sections. Cite sources.",
    tools=[WebSearchTool()],
)


competitor_agent = Agent(
    name="CompetitorAgent",
    model="gpt-4.1",
    instructions="You are a competitive intelligence agent. Identify the top 3-5 direct competitors to this company. For each, provide: their core offering, key differentiator, and how they compare to the target company. Format as COMPETITOR: [name] — [comparison].",
    tools=[WebSearchTool()],
)


risk_agent = Agent(
    name="RiskAgent",
    model="gpt-4.1",
    instructions="You are a risk intelligence agent. Search for red flags, legal issues, regulatory concerns, executive departures, data breaches, controversy, or negative press about this company. Format each finding as '⚠ [risk finding] ([source.com])'.",
    tools=[WebSearchTool()],
)


people_agent = Agent(
    name="PeopleAgent",
    model="gpt-4.1",
    instructions="You are a people intelligence agent. Research the company's key executives: CEO, CTO, key founders, board members. For each person find their background, recent public statements or interviews, and any notable news. Format as: [NAME] — [Title]: [key insight].",
    tools=[WebSearchTool()],
)


research_agent = Agent(
    name="ResearchAgent",
    model="gpt-4.1",
    instructions="""You will receive outputs from the following specialist agents that were activated for this request: {activated_agents_list}

CRITICAL RULE: Only include sections in your research memo for agents that were actually activated and provided output. Do NOT add, infer, or generate content for sections corresponding to agents that were NOT activated (e.g., if Financial agent was not activated, do not include any financial data section; if People agent was not activated, do not include any leadership/executive section).

Structure your memo using only the sections that have corresponding agent output. Begin each section with the agent name that sourced it in brackets, e.g., [RECON], [COMPETITOR], [RISK].

If a section is missing because that agent was not activated, do not mention it, do not estimate it, do not fill it in from general knowledge.

Produce a structured research memo with an Executive Summary followed only by the sourced sections that are actually available.""",
)


synthesis_agent = Agent(
    name="SynthesisAgent",
    model="gpt-4.1",
    instructions="You receive a comprehensive research memo. Transform it into a polished board-ready executive brief. Use ## headers, bullet points, bold key terms. Structure: Executive Summary, Strategic Position, Key Opportunities, Key Risks, Recommended Actions. Write for a C-suite audience.",
)


chart_agent = Agent(
    name="ChartAgent",
    model="gpt-4.1",
    instructions="""You receive a completed research memo and executive brief about a company. Extract all quantitative and qualitative data points and structure them as JSON for dashboard visualization.

Output ONLY valid JSON. No explanation, no markdown, no code fences. Just the raw JSON object.

Use this exact structure — omit any key where no real data exists (do not fabricate numbers):

{
  "company": "Company Name",
  "generated_at": "YYYY-MM-DD",
  "summary_stats": [
    {"label": "Weekly Active Users", "value": "800M", "change": "+12%", "trend": "up"},
    {"label": "Enterprise Market Share", "value": "27%", "change": "-23pp", "trend": "down"},
    {"label": "Funding Raised", "value": "$11B", "change": null, "trend": "neutral"},
    {"label": "Valuation", "value": "$300B", "change": null, "trend": "neutral"}
  ],
  "market_share": [
    {"name": "OpenAI", "value": 27, "color": "#4f8ef7"},
    {"name": "Anthropic", "value": 40, "color": "#3dd68c"},
    {"name": "Google", "value": 21, "color": "#f5a623"},
    {"name": "Others", "value": 12, "color": "#5a5e72"}
  ],
  "risk_scores": [
    {"dimension": "Regulatory", "score": 8},
    {"dimension": "Competitive", "score": 9},
    {"dimension": "Financial", "score": 6},
    {"dimension": "Reputational", "score": 7},
    {"dimension": "Operational", "score": 5},
    {"dimension": "Legal", "score": 7}
  ],
  "opportunities": [
    {"name": "Enterprise Rollout", "impact": 9, "urgency": 8},
    {"name": "Agent Platform", "impact": 8, "urgency": 7},
    {"name": "Regulated Verticals", "impact": 7, "urgency": 6},
    {"name": "Data Integration", "impact": 6, "urgency": 5}
  ],
  "competitors": [
    {"name": "Anthropic", "market_share": 40, "momentum": 9, "threat_level": "high"},
    {"name": "Google Gemini", "market_share": 21, "momentum": 7, "threat_level": "medium"},
    {"name": "Microsoft Copilot", "market_share": 8, "momentum": 6, "threat_level": "medium"}
  ],
  "timeline": [
    {"date": "Mar 2026", "event": "GPT-5.4 launched", "type": "product"},
    {"date": "Feb 2026", "event": "$110B funding round closed", "type": "financial"},
    {"date": "Jan 2026", "event": "Frontier platform announced", "type": "product"},
    {"date": "Jan 2026", "event": "CFO departure", "type": "risk"}
  ],
  "key_findings": [
    {"category": "Strength", "text": "800M weekly users, dominant consumer brand"},
    {"category": "Weakness", "text": "Enterprise market share fell from 50% to 27%"},
    {"category": "Opportunity", "text": "Frontier platform + consultancy partnerships"},
    {"category": "Threat", "text": "Anthropic now leads enterprise deployments"}
  ]
}""",
)


SPECIALIST_AGENTS = {
    "recon": recon_agent,
    "financial": financial_agent,
    "competitor": competitor_agent,
    "risk": risk_agent,
    "people": people_agent,
}
