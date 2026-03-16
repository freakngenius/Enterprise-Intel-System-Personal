import asyncio
import json
import re
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any, AsyncIterator

from agents import Agent, Runner
from docx import Document
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openai import OpenAI
from openai.types.responses import ResponseTextDeltaEvent
from pypdf import PdfReader
from pydantic import BaseModel, Field

from backend.agents import (
    SPECIALIST_AGENTS,
    chart_agent,
    research_agent,
    synthesis_agent,
    triage_agent,
)
from backend.comparison_agents import comparison_agent, context_agent

load_dotenv(Path(__file__).with_name(".env"))
openai_client = OpenAI()

TRIAGE_RESULT_TOKEN = "[TRIAGE_RESULT]"
HANDOFF_RESEARCH_TOKEN = "[HANDOFF_RESEARCH]"
HANDOFF_COMPARISON_TOKEN = "[HANDOFF_COMPARISON]"
HANDOFF_SYNTHESIS_TOKEN = "[HANDOFF_SYNTHESIS]"
CHART_DATA_TOKEN = "[CHART_DATA]"
USAGE_TOKEN = "[USAGE]"
GPT_4_1_INPUT_COST_PER_MILLION = 2.00
GPT_4_1_OUTPUT_COST_PER_MILLION = 8.00
SPECIALIST_AGENT_ORDER = ["recon", "financial", "competitor", "risk", "people"]
COMPARISON_SPECIALIST_AGENT_ORDER = [
    "recon",
    "financial",
    "competitor",
    "risk",
    "people",
]
JSON_OBJECT_PATTERN = re.compile(r"\{.*\}", re.DOTALL)
COMPARE_FOCUS_TO_AGENT_INSTRUCTIONS: dict[str, dict[str, str]] = {
    "Business Model": {
        "financial": "Pay particular attention to business model structure and pricing strategy.",
    },
    "Pricing Strategy": {
        "financial": "Pay particular attention to business model structure and pricing strategy.",
    },
    "Product Roadmap": {
        "recon": "Prioritize finding product announcements, roadmap signals, recent feature launches, and product strategy.",
    },
    "Features & Capabilities": {
        "recon": "Prioritize finding product announcements, roadmap signals, recent feature launches, and product strategy.",
    },
    "Company Size": {
        "financial": "Focus on headcount, funding rounds, investor names, valuation, and company stage.",
    },
    "Funds Raised & Stage": {
        "financial": "Focus on headcount, funding rounds, investor names, valuation, and company stage.",
    },
    "Marketing & GTM": {
        "recon": "Find marketing campaigns, go-to-market moves, channel strategy, and customer acquisition approaches.",
    },
    "Target Demographics": {
        "recon": "Identify target customer segments, ICP, and demographic positioning.",
    },
    "Technology Stack": {
        "recon": "Research tech stack, infrastructure choices, API strategy, and technical architecture signals.",
    },
    "Talent & Culture": {
        "people": "Focus on hiring patterns, key role additions, employer brand signals, and culture indicators.",
    },
    "Regulatory & Compliance": {
        "risk": "Focus specifically on regulatory compliance status, certifications, and compliance risks.",
    },
}

app = FastAPI(title="Enterprise AI Agent Demo")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    company: str = Field(..., min_length=1, max_length=200)
    request: str = Field(..., min_length=1, max_length=4000)
    company_url: str | None = Field(default=None, max_length=500)


class ResolveCompanyRequest(BaseModel):
    company_name: str = Field(..., min_length=1, max_length=200)
    mode: str = Field(default="intel", max_length=50)


class TriageSelection(BaseModel):
    agents: list[str]
    reasoning: str


@dataclass
class AgentRunCapture:
    agent_key: str
    output: str
    result: Any | None


def format_sse(event: str, data: Any) -> str:
    payload = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
    lines = payload.splitlines() or [""]
    body = "".join(f"data: {line}\n" for line in lines)
    return f"event: {event}\n{body}\n"


def extract_usage(result: Any) -> dict[str, int]:
    if result is None:
        return {
            "input_tokens": 0,
            "output_tokens": 0,
            "total_tokens": 0,
        }

    usage = getattr(getattr(result, "context_wrapper", None), "usage", None)
    return {
        "input_tokens": int(getattr(usage, "input_tokens", 0) or 0),
        "output_tokens": int(getattr(usage, "output_tokens", 0) or 0),
        "total_tokens": int(getattr(usage, "total_tokens", 0) or 0),
    }


def calculate_usage_payload(*results: Any) -> dict[str, int | float]:
    aggregated_usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}

    for result in results:
        usage = extract_usage(result)
        aggregated_usage["input_tokens"] += usage["input_tokens"]
        aggregated_usage["output_tokens"] += usage["output_tokens"]
        aggregated_usage["total_tokens"] += usage["total_tokens"]

    cost_usd = (
        aggregated_usage["input_tokens"] / 1_000_000 * GPT_4_1_INPUT_COST_PER_MILLION
        + aggregated_usage["output_tokens"] / 1_000_000 * GPT_4_1_OUTPUT_COST_PER_MILLION
    )

    return {
        **aggregated_usage,
        "cost_usd": round(cost_usd, 4),
    }


async def build_chart_payload(
    company: str,
    research_output: str,
    synthesis_output: str,
    comparison_output: str | None = None,
) -> tuple[str, Any | None]:
    prompt_parts = [
        "You have just completed a full intelligence analysis. Extract visualization data from this:",
        "",
        "RESEARCH MEMO:",
        research_output.strip() or "Not available.",
    ]

    if comparison_output and comparison_output.strip():
        prompt_parts.extend(
            [
                "",
                "COMPARISON ANALYSIS:",
                comparison_output.strip(),
            ]
        )

    prompt_parts.extend(
        [
            "",
            "EXECUTIVE BRIEF:",
            synthesis_output.strip() or "Not available.",
            "",
            "Output ONLY valid JSON. No markdown fences, no explanation. Raw JSON only.",
        ]
    )

    try:
        chart_result = await Runner.run(chart_agent, input="\n".join(prompt_parts))
    except Exception as exc:
        print(f"[CHART_AGENT] Runner failed: {exc}")
        return "{}", None

    final_output = getattr(chart_result, "final_output", "")
    if isinstance(final_output, dict):
        raw_output = json.dumps(final_output, ensure_ascii=False)
    elif hasattr(final_output, "model_dump"):
        raw_output = json.dumps(final_output.model_dump(), ensure_ascii=False)
    else:
        raw_output = str(final_output or "").strip()

    print(f"[CHART_AGENT] Raw output length: {len(raw_output)}")
    print(f"[CHART_AGENT] First 200 chars: {raw_output[:200]}")

    cleaned = re.sub(r"^```(?:json)?\s*", "", raw_output, flags=re.MULTILINE)
    cleaned = re.sub(r"```\s*$", "", cleaned, flags=re.MULTILINE)
    cleaned = cleaned.strip()

    if cleaned and not cleaned.startswith("{"):
        matched = JSON_OBJECT_PATTERN.search(cleaned)
        if matched:
            cleaned = matched.group(0).strip()

    try:
        parsed = json.loads(cleaned)
        if not isinstance(parsed, dict):
            raise json.JSONDecodeError("Chart output was not a JSON object.", cleaned, 0)
    except json.JSONDecodeError as exc:
        print(f"[CHART_AGENT] JSON parse failed: {exc}")
        return "{}", chart_result

    normalized = json.dumps(parsed, ensure_ascii=False, separators=(",", ":"))
    print(f"[DEBUG] Chart JSON: {normalized[:100]}")
    return normalized, chart_result


def build_triage_prompt(payload: AnalyzeRequest) -> str:
    return f"""Company: {payload.company}
Request: {payload.request}

Decide which specialist agents should be activated and return JSON only."""


def parse_triage_output(raw_output: Any) -> TriageSelection:
    payload: dict[str, Any]

    if isinstance(raw_output, dict):
        payload = raw_output
    elif hasattr(raw_output, "model_dump"):
        payload = raw_output.model_dump()
    else:
        raw_text = str(raw_output or "").strip()
        matched = JSON_OBJECT_PATTERN.search(raw_text)
        payload = json.loads(matched.group(0) if matched else raw_text)

    requested_agents = payload.get("agents", [])
    selected = [
        key
        for key in SPECIALIST_AGENT_ORDER
        if key in {str(agent).strip().lower() for agent in requested_agents}
    ]

    if "recon" not in selected:
        selected.insert(0, "recon")

    reasoning = str(payload.get("reasoning", "")).strip() or "Triage selected the specialist team."
    return TriageSelection(agents=selected, reasoning=reasoning)


def build_specialist_prompt(agent_key: str, payload: AnalyzeRequest) -> str:
    company_url_context = (
        f"Official website: {payload.company_url}\nTreat this URL as authoritative company context.\n"
        if payload.company_url
        else ""
    )
    return f"""Company: {payload.company}
{company_url_context}Request: {payload.request}
Specialist role: {agent_key}

Use web search as needed and respond directly in the specialist format."""


def build_research_prompt(
    payload: AnalyzeRequest, triage_selection: TriageSelection, specialist_context: str
) -> str:
    return f"""Company: {payload.company}
Request: {payload.request}

Triage reasoning: {triage_selection.reasoning}

The activated agents list is provided in the context below and must strictly bound the scope of the memo.

Research context:
{specialist_context}

Create the structured research memo using only the activated agents that actually produced output. Begin each sourced section with the source agent in brackets."""


def build_synthesis_prompt(payload: AnalyzeRequest, research_memo: str) -> str:
    return f"""Company: {payload.company}
Request: {payload.request}

Research memo:
{research_memo}

Produce the final executive brief."""


def build_context_prompt(base_company: str, base_url: str | None, docs_context: str) -> str:
    website_line = base_url.strip() if base_url else "Not provided"
    docs_block = docs_context.strip() if docs_context.strip() else "No uploaded documents provided."
    return f"""Base company: {base_company}
Website URL: {website_line}

If a website URL is provided, treat it as the primary source for factual company information.

Uploaded document content:
{docs_block}

Build the structured base company profile using uploaded materials as the primary source and web search to fill gaps."""


def build_comparison_specialist_request(
    base_company: str, competitor_company: str, focus_summary: str | None
) -> str:
    focus_line = f"Pay particular attention to: {focus_summary}" if focus_summary else ""
    return (
        f"Gather public intelligence on {competitor_company} so it can be compared against "
        f"{base_company}. Focus on current positioning, products, execution signals, and any "
        f"important market developments. {focus_line}"
    ).strip()


def build_comparison_prompt(
    base_company: str,
    competitor_company: str,
    base_profile: str,
    competitor_research_memo: str,
    focus_summary: str | None,
) -> str:
    focus_line = f"\nPay particular attention to: {focus_summary}\n" if focus_summary else "\n"
    return f"""BASE COMPANY: {base_company}
TARGET/COMPETITOR COMPANY: {competitor_company}

BASE COMPANY PROFILE:
{base_profile}

COMPETITOR INTELLIGENCE MEMO:
{competitor_research_memo}
{focus_line}
Generate the head-to-head comparison for the base company."""


def build_comparison_synthesis_prompt(
    base_company: str, competitor_company: str, comparison_report: str
) -> str:
    return f"""You are preparing a polished executive deliverable.

Base company: {base_company}
Competitor: {competitor_company}

Comparison report:
{comparison_report}

Turn this into a polished executive summary and recommendations document for senior leadership."""


def build_specialist_context(
    captures: list[AgentRunCapture], activated_agents: list[str]
) -> str:
    sections: list[str] = []
    for capture in captures:
        label = capture.agent_key.capitalize()
        body = capture.output.strip() or "No output captured."
        sections.append(f"## {label} Agent\n{body}")
    activated_agents_line = f"Activated agents: {', '.join(activated_agents)}"
    return f"{activated_agents_line}\n\nSpecialist outputs:\n" + "\n\n".join(sections)


def normalize_focus_areas(focus_areas: list[str] | None) -> list[str]:
    seen: set[str] = set()
    normalized: list[str] = []

    for focus_area in focus_areas or []:
        cleaned = str(focus_area).strip()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        normalized.append(cleaned)

    return normalized


def build_focus_summary(focus_areas: list[str], custom_focus: str | None) -> str | None:
    parts: list[str] = []

    if focus_areas:
        parts.append(f"Focus areas: {', '.join(focus_areas)}")

    if custom_focus and custom_focus.strip():
        parts.append(f"Custom focus: {custom_focus.strip()}")

    return " | ".join(parts) if parts else None


def build_compare_focus_instruction_map(
    focus_areas: list[str], custom_focus: str | None
) -> dict[str, str]:
    instructions_by_agent: dict[str, list[str]] = {
        "recon": [],
        "financial": [],
        "risk": [],
        "people": [],
    }

    for focus_area in focus_areas:
        mapped_instructions = COMPARE_FOCUS_TO_AGENT_INSTRUCTIONS.get(focus_area, {})
        for agent_key, instruction in mapped_instructions.items():
            if instruction not in instructions_by_agent[agent_key]:
                instructions_by_agent[agent_key].append(instruction)

    if custom_focus and custom_focus.strip():
        custom_instruction = f"Also account for this custom focus from the user: {custom_focus.strip()}."
        instructions_by_agent["recon"].append(custom_instruction)

    return {
        agent_key: "\n".join(agent_instructions)
        for agent_key, agent_instructions in instructions_by_agent.items()
        if agent_instructions
    }


def build_runtime_agent(base_agent: Agent, extra_instructions: str | None) -> Agent:
    if not extra_instructions or not extra_instructions.strip():
        return base_agent

    return Agent(
        name=getattr(base_agent, "name"),
        model=getattr(base_agent, "model"),
        instructions=f"{getattr(base_agent, 'instructions').rstrip()}\n\n{extra_instructions.strip()}",
        tools=list(getattr(base_agent, "tools", []) or []),
    )


def build_specialist_runtime_agent(
    agent_key: str,
    payload: AnalyzeRequest,
    extra_instructions: str | None = None,
) -> Agent:
    instructions: list[str] = []
    url_instruction = (
        build_company_url_instruction(payload.company_url)
        if agent_key == "recon"
        else None
    )
    if url_instruction:
        instructions.append(url_instruction)
    if extra_instructions and extra_instructions.strip():
        instructions.append(extra_instructions.strip())

    return build_runtime_agent(
        SPECIALIST_AGENTS[agent_key],
        "\n".join(instructions) if instructions else None,
    )


def build_base_company_context(
    base_company: str, base_url: str | None, docs_context: str, context_output: str
) -> str:
    website_line = base_url.strip() if base_url else "Not provided"
    docs_summary = docs_context.strip() if docs_context.strip() else "No uploaded documents provided."
    return f"""Base company: {base_company}
Website URL: {website_line}

Uploaded document context:
{docs_summary}

Context agent profile:
{context_output}
"""


def build_company_url_instruction(company_url: str | None) -> str | None:
    if not company_url or not company_url.strip():
        return None

    return (
        f"The target company's official website is {company_url.strip()}. "
        "Use this as the authoritative source for company information."
    )


async def extract_pdf_text(file_bytes: bytes) -> str:
    reader = PdfReader(BytesIO(file_bytes))
    return "\n".join(page.extract_text() or "" for page in reader.pages).strip()


async def extract_docx_text(file_bytes: bytes) -> str:
    document = Document(BytesIO(file_bytes))
    return "\n".join(paragraph.text for paragraph in document.paragraphs if paragraph.text).strip()


async def extract_text_from_upload(upload: UploadFile) -> str:
    file_bytes = await upload.read()
    filename = upload.filename or "uploaded-file"
    suffix = Path(filename).suffix.lower()

    if not file_bytes:
        return ""

    if suffix == ".pdf":
        text = await extract_pdf_text(file_bytes)
    elif suffix == ".docx":
        text = await extract_docx_text(file_bytes)
    elif suffix in {".csv", ".txt"}:
        text = file_bytes.decode("utf-8", errors="ignore").strip()
    else:
        return ""

    if not text:
        return ""

    return f"### {filename}\n{text}"


async def run_specialist_agent(
    agent_key: str,
    payload: AnalyzeRequest,
    queue: asyncio.Queue[tuple[str, Any]],
    agent: Agent | None = None,
) -> AgentRunCapture:
    specialist_agent = agent or SPECIALIST_AGENTS[agent_key]
    streamed_result = Runner.run_streamed(
        specialist_agent, input=build_specialist_prompt(agent_key, payload)
    )
    output = ""

    try:
        async for event in streamed_result.stream_events():
            if event.type == "raw_response_event" and isinstance(
                event.data, ResponseTextDeltaEvent
            ):
                output += event.data.delta
                await queue.put(
                    (
                        "specialist_delta",
                        {
                            "agent": agent_key,
                            "delta": event.data.delta,
                        },
                    )
                )
    except Exception as exc:
        error_text = f"\n\nError while running {agent_key}: {exc}\n"
        output += error_text
        await queue.put(
            (
                "specialist_delta",
                {
                    "agent": agent_key,
                    "delta": error_text,
                },
            )
        )
        await queue.put(("delta", f"[AGENT_DONE_{agent_key}]"))
        return AgentRunCapture(agent_key=agent_key, output=output.strip(), result=None)

    final_output = getattr(streamed_result, "final_output", "")
    if not output and final_output:
        output = final_output if isinstance(final_output, str) else str(final_output)
        await queue.put(
            (
                "specialist_delta",
                {
                    "agent": agent_key,
                    "delta": output,
                },
            )
        )

    await queue.put(("delta", f"[AGENT_DONE_{agent_key}]"))
    return AgentRunCapture(agent_key=agent_key, output=output.strip(), result=streamed_result)


async def resolve_company_matches(company_name: str, mode: str) -> dict[str, Any]:
    def _run_completion() -> dict[str, Any]:
        response = openai_client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {
                    "role": "user",
                    "content": f"""Search your knowledge for companies named or commonly referred to as "{company_name}".

Return the 3-5 most likely matches as JSON only. No explanation. Format:
{{
  "matches": [
    {{
      "name": "Official Company Name",
      "description": "One sentence: what they do and where they're based",
      "domain": "website.com",
      "industry": "SaaS / Fintech / etc",
      "stage": "Public / Series B / Startup / etc",
      "confidence": "high/medium/low"
    }}
  ]
}}

Order by most likely match first. If only one obvious match exists, still return it alone with high confidence. Include disambiguation notes if the name is ambiguous (e.g. same name in different industries).

Mode: {mode}""",
                }
            ],
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content or '{"matches": []}'
        return json.loads(content)

    return await asyncio.to_thread(_run_completion)


async def stream_analysis(payload: AnalyzeRequest) -> AsyncIterator[str]:
    yield format_sse("status", f"Starting analysis for {payload.company}.")
    yield format_sse("status", "Triage agent is analyzing the request.")

    try:
        triage_result = await Runner.run(triage_agent, input=build_triage_prompt(payload))
        triage_selection = parse_triage_output(triage_result.final_output)
    except Exception as exc:
        yield format_sse("server-error", f"Triage failed: {exc}")
        return

    triage_payload = triage_selection.model_dump()
    yield format_sse("delta", f"{TRIAGE_RESULT_TOKEN}{json.dumps(triage_payload)}")
    yield format_sse("status", "Triage complete. Launching specialist agents.")

    specialist_queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()
    specialist_tasks = []

    for agent_key in triage_selection.agents:
        yield format_sse("delta", f"[AGENT_START_{agent_key}]")
        specialist_tasks.append(
            asyncio.create_task(
                run_specialist_agent(
                    agent_key,
                    payload,
                    specialist_queue,
                    agent=build_specialist_runtime_agent(agent_key, payload),
                )
            )
        )

    specialist_gather = asyncio.gather(*specialist_tasks)

    while not specialist_gather.done() or not specialist_queue.empty():
        try:
            event_name, event_payload = await asyncio.wait_for(specialist_queue.get(), timeout=0.1)
        except asyncio.TimeoutError:
            continue

        yield format_sse(event_name, event_payload)

    try:
        specialist_captures = await specialist_gather
    except Exception as exc:
        yield format_sse("server-error", f"Specialist agent execution failed: {exc}")
        return

    specialist_context = build_specialist_context(
        specialist_captures, triage_selection.agents
    )

    yield format_sse("delta", HANDOFF_RESEARCH_TOKEN)
    yield format_sse("status", "Research agent is synthesizing specialist findings.")

    research_result = Runner.run_streamed(
        research_agent,
        input=build_research_prompt(payload, triage_selection, specialist_context),
    )
    research_text = ""

    try:
        async for event in research_result.stream_events():
            if event.type == "raw_response_event" and isinstance(
                event.data, ResponseTextDeltaEvent
            ):
                research_text += event.data.delta
                yield format_sse("delta", event.data.delta)
    except Exception as exc:
        yield format_sse("server-error", f"Research agent failed: {exc}")
        return

    final_research = getattr(research_result, "final_output", "")
    if not research_text and final_research:
        research_text = final_research if isinstance(final_research, str) else str(final_research)
        yield format_sse("delta", research_text)

    yield format_sse("delta", HANDOFF_SYNTHESIS_TOKEN)
    yield format_sse("status", "Synthesis agent is preparing the executive brief.")

    synthesis_result = Runner.run_streamed(
        synthesis_agent,
        input=build_synthesis_prompt(payload, research_text.strip()),
    )
    synthesis_text = ""

    try:
        async for event in synthesis_result.stream_events():
            if event.type == "raw_response_event" and isinstance(
                event.data, ResponseTextDeltaEvent
            ):
                synthesis_text += event.data.delta
                yield format_sse("delta", event.data.delta)
    except Exception as exc:
        yield format_sse("server-error", f"Synthesis agent failed: {exc}")
        return

    final_synthesis = getattr(synthesis_result, "final_output", "")
    if not synthesis_text and final_synthesis:
        synthesis_text = (
            final_synthesis if isinstance(final_synthesis, str) else str(final_synthesis)
        )
        yield format_sse("delta", synthesis_text)

    yield format_sse("delta", "[AGENT_START_chart]")
    yield format_sse("status", "Chart agent is structuring dashboard data.")
    chart_payload, chart_result = await build_chart_payload(
        company=payload.company,
        research_output=research_text,
        synthesis_output=synthesis_text,
    )
    yield format_sse("delta", "[AGENT_DONE_chart]")
    yield f"data: {CHART_DATA_TOKEN}{chart_payload}\n\n"
    if chart_payload != "{}":
        print("[CHART_AGENT] Successfully emitted chart data")

    usage_payload = calculate_usage_payload(
        triage_result,
        *(capture.result for capture in specialist_captures),
        research_result,
        synthesis_result,
        chart_result,
    )
    yield format_sse("delta", f"{USAGE_TOKEN}{json.dumps(usage_payload)}")
    yield format_sse("done", "")


async def stream_comparison_analysis(
    base_company: str,
    base_url: str | None,
    competitor_company: str,
    target_url: str | None,
    focus_areas: list[str] | None,
    custom_focus: str | None,
    files: list[UploadFile] | None,
) -> AsyncIterator[str]:
    yield format_sse(
        "status",
        f"Starting comparison: {base_company} vs {competitor_company}.",
    )
    yield format_sse("delta", "[COMPARE_START]")

    docs_parts: list[str] = []
    for upload in files or []:
        try:
            extracted = await extract_text_from_upload(upload)
        except Exception as exc:
            extracted = f"### {upload.filename or 'uploaded-file'}\nFile extraction error: {exc}"

        if extracted:
            docs_parts.append(extracted)

    docs_context = "\n\n".join(part for part in docs_parts if part.strip())
    normalized_focus_areas = normalize_focus_areas(focus_areas)
    focus_summary = build_focus_summary(normalized_focus_areas, custom_focus)
    compare_focus_instruction_map = build_compare_focus_instruction_map(
        normalized_focus_areas, custom_focus
    )

    yield format_sse("delta", "[AGENT_START_context]")
    yield format_sse("status", "Context agent is building the base company profile.")

    context_result = Runner.run_streamed(
        context_agent,
        input=build_context_prompt(base_company, base_url, docs_context),
    )
    context_output = ""

    try:
        async for event in context_result.stream_events():
            if event.type == "raw_response_event" and isinstance(
                event.data, ResponseTextDeltaEvent
            ):
                context_output += event.data.delta
                yield format_sse("delta", event.data.delta)
    except Exception as exc:
        yield format_sse("server-error", f"Context agent failed: {exc}")
        return

    final_context = getattr(context_result, "final_output", "")
    if not context_output and final_context:
        context_output = final_context if isinstance(final_context, str) else str(final_context)
        yield format_sse("delta", context_output)

    yield format_sse("delta", "[AGENT_DONE_context]")
    yield format_sse("status", "Base company context complete. Launching competitor specialists.")

    compare_request = AnalyzeRequest(
        company=competitor_company,
        request=build_comparison_specialist_request(
            base_company=base_company,
            competitor_company=competitor_company,
            focus_summary=focus_summary,
        ),
        company_url=target_url,
    )

    specialist_queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()
    specialist_tasks: list[asyncio.Task[AgentRunCapture]] = []

    for agent_key in COMPARISON_SPECIALIST_AGENT_ORDER:
        yield format_sse("delta", f"[AGENT_START_{agent_key}]")
        runtime_agent = build_specialist_runtime_agent(
            agent_key,
            compare_request,
            compare_focus_instruction_map.get(agent_key),
        )
        specialist_tasks.append(
            asyncio.create_task(
                run_specialist_agent(
                    agent_key,
                    compare_request,
                    specialist_queue,
                    agent=runtime_agent,
                )
            )
        )

    specialist_gather = asyncio.gather(*specialist_tasks)

    while not specialist_gather.done() or not specialist_queue.empty():
        try:
            event_name, event_payload = await asyncio.wait_for(specialist_queue.get(), timeout=0.1)
        except asyncio.TimeoutError:
            continue

        yield format_sse(event_name, event_payload)

    try:
        specialist_captures = await specialist_gather
    except Exception as exc:
        yield format_sse("server-error", f"Competitor specialist execution failed: {exc}")
        return

    competitor_context = build_specialist_context(
        specialist_captures, COMPARISON_SPECIALIST_AGENT_ORDER
    )

    yield format_sse("delta", HANDOFF_RESEARCH_TOKEN)
    yield format_sse("status", "Research agent is building competitor intelligence.")

    research_result = Runner.run_streamed(
        research_agent,
        input=f"""Company: {competitor_company}
Request: Build a competitor intelligence memo that will support a head-to-head comparison with {base_company}.

{competitor_context}

Create the structured competitor research memo using only the available specialist outputs.""",
    )
    research_text = ""

    try:
        async for event in research_result.stream_events():
            if event.type == "raw_response_event" and isinstance(
                event.data, ResponseTextDeltaEvent
            ):
                research_text += event.data.delta
                yield format_sse("delta", event.data.delta)
    except Exception as exc:
        yield format_sse("server-error", f"Research agent failed: {exc}")
        return

    final_research = getattr(research_result, "final_output", "")
    if not research_text and final_research:
        research_text = final_research if isinstance(final_research, str) else str(final_research)
        yield format_sse("delta", research_text)

    yield format_sse("delta", HANDOFF_COMPARISON_TOKEN)
    yield format_sse("status", "Comparison agent is generating the head-to-head analysis.")

    comparison_result = Runner.run_streamed(
        comparison_agent,
        input=build_comparison_prompt(
            base_company=base_company,
            competitor_company=competitor_company,
            base_profile=build_base_company_context(
                base_company=base_company,
                base_url=base_url,
                docs_context=docs_context,
                context_output=context_output.strip(),
            ),
            competitor_research_memo=research_text.strip(),
            focus_summary=focus_summary,
        ),
    )
    comparison_text = ""

    try:
        async for event in comparison_result.stream_events():
            if event.type == "raw_response_event" and isinstance(
                event.data, ResponseTextDeltaEvent
            ):
                comparison_text += event.data.delta
                yield format_sse("delta", event.data.delta)
    except Exception as exc:
        yield format_sse("server-error", f"Comparison agent failed: {exc}")
        return

    final_comparison = getattr(comparison_result, "final_output", "")
    if not comparison_text and final_comparison:
        comparison_text = (
            final_comparison if isinstance(final_comparison, str) else str(final_comparison)
        )
        yield format_sse("delta", comparison_text)

    yield format_sse("delta", HANDOFF_SYNTHESIS_TOKEN)
    yield format_sse("status", "Synthesis agent is preparing the final comparison report.")

    synthesis_result = Runner.run_streamed(
        synthesis_agent,
        input=build_comparison_synthesis_prompt(
            base_company=base_company,
            competitor_company=competitor_company,
            comparison_report=comparison_text.strip(),
        ),
    )
    synthesis_text = ""

    try:
        async for event in synthesis_result.stream_events():
            if event.type == "raw_response_event" and isinstance(
                event.data, ResponseTextDeltaEvent
            ):
                synthesis_text += event.data.delta
                yield format_sse("delta", event.data.delta)
    except Exception as exc:
        yield format_sse("server-error", f"Synthesis agent failed: {exc}")
        return

    final_synthesis = getattr(synthesis_result, "final_output", "")
    if not synthesis_text and final_synthesis:
        synthesis_text = (
            final_synthesis if isinstance(final_synthesis, str) else str(final_synthesis)
        )
        yield format_sse("delta", synthesis_text)

    yield format_sse("delta", "[AGENT_START_chart]")
    yield format_sse("status", "Chart agent is structuring dashboard data.")
    chart_payload, chart_result = await build_chart_payload(
        company=competitor_company,
        research_output=research_text,
        comparison_output=comparison_text,
        synthesis_output=synthesis_text,
    )
    yield format_sse("delta", "[AGENT_DONE_chart]")
    yield f"data: {CHART_DATA_TOKEN}{chart_payload}\n\n"
    if chart_payload != "{}":
        print("[CHART_AGENT] Successfully emitted chart data")

    usage_payload = calculate_usage_payload(
        context_result,
        *(capture.result for capture in specialist_captures),
        research_result,
        comparison_result,
        synthesis_result,
        chart_result,
    )
    yield format_sse("delta", f"{USAGE_TOKEN}{json.dumps(usage_payload)}")
    yield format_sse("done", "")


def sse_response(payload: AnalyzeRequest) -> StreamingResponse:
    return StreamingResponse(
        stream_analysis(payload),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def comparison_sse_response(
    base_company: str,
    base_url: str | None,
    competitor_company: str,
    target_url: str | None,
    focus_areas: list[str] | None,
    custom_focus: str | None,
    files: list[UploadFile] | None,
) -> StreamingResponse:
    return StreamingResponse(
        stream_comparison_analysis(
            base_company=base_company,
            base_url=base_url,
            competitor_company=competitor_company,
            target_url=target_url,
            focus_areas=focus_areas,
            custom_focus=custom_focus,
            files=files,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/analyze")
async def analyze(payload: AnalyzeRequest) -> StreamingResponse:
    return sse_response(payload)


@app.get("/analyze")
async def analyze_via_event_source(
    company: str = Query(..., min_length=1, max_length=200),
    request: str = Query(..., min_length=1, max_length=4000),
    company_url: str | None = Query(default=None, max_length=500),
) -> StreamingResponse:
    return sse_response(AnalyzeRequest(company=company, request=request, company_url=company_url))


@app.post("/compare")
async def compare(
    base_company: str = Form(...),
    competitor_company: str = Form(...),
    base_url: str | None = Form(default=None),
    target_url: str | None = Form(default=None),
    focus_areas: list[str] | None = Form(default=None),
    custom_focus: str | None = Form(default=None),
    files: list[UploadFile] | None = File(default=None),
) -> StreamingResponse:
    return comparison_sse_response(
        base_company=base_company,
        base_url=base_url,
        competitor_company=competitor_company,
        target_url=target_url,
        focus_areas=focus_areas,
        custom_focus=custom_focus,
        files=files,
    )


@app.post("/resolve-company")
async def resolve_company(data: ResolveCompanyRequest) -> dict[str, Any]:
    try:
        result = await resolve_company_matches(data.company_name, data.mode)
    except Exception:
        return {"matches": []}

    matches = result.get("matches", [])
    if not isinstance(matches, list):
        return {"matches": []}

    return {"matches": matches[:5]}
