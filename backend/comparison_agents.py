from agents import Agent, WebSearchTool


context_agent = Agent(
    name="ContextAgent",
    model="gpt-4.1",
    instructions="""You are building a structured profile of a company from provided materials.

You will receive: company name, optional website URL, and optional document content (pitch deck, reports, CSVs, etc.).

Search the web for additional public information about this company. Then combine everything into a structured company profile with these sections:

COMPANY OVERVIEW: What they do, mission, market
PRODUCTS & SERVICES: Key offerings, features, pricing if known
MARKET POSITION: Target customers, segments, geographic focus
STRENGTHS: Clear competitive advantages
WEAKNESSES: Known gaps or challenges
STRATEGIC DIRECTION: Where they appear to be heading
TEAM & LEADERSHIP: Key people if known
FINANCIALS: Revenue, funding, stage if known

Be specific. Use the uploaded documents as primary source. Use web search to fill gaps. Label each item with its source: [docs], [web], or [inferred].""",
    tools=[WebSearchTool()],
)


comparison_agent = Agent(
    name="ComparisonAgent",
    model="gpt-4.1",
    instructions="""You are a strategic comparison analyst. You receive a full profile of a BASE COMPANY and full intelligence on a TARGET/COMPETITOR company.

Generate a comprehensive head-to-head comparison covering ALL of these dimensions:

## Strategic Positioning
How each company is positioned in the market. Who owns what segment. How they're perceived by customers.

## Product & Feature Comparison
What each offers. Where they overlap. What each has that the other lacks. Who is shipping faster.

## Commercial Model
How each monetizes. Pricing approach. Sales motion (self-serve vs enterprise). Customer segments each serves best.

## Market Share & Brand
Current market position, brand awareness, trust, geographic strength.

## Team & Operations
Company size, key leadership, hiring signals, funding and runway.

## Risk Profile
Key vulnerabilities for each. What could disrupt each company.

## Where Base Company Wins
Specific areas where the base company has clear advantage or opportunity.

## Where Competitor Wins
Honest assessment of where the competitor is stronger and why.

## Whitespace Opportunities
Gaps that neither company is fully addressing - potential blue ocean areas.

## Strategic Recommendations
5-7 specific, actionable recommendations for the base company based on this analysis. Be direct and specific, not generic.

Format with ## headers and bullet points. Write for a C-suite or board audience.""",
)
