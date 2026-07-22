"""The three-agent contract review crew.

  1. Clause Extractor — pulls the contract's clauses via the API.
  2. Risk Flagger     — for each clause, retrieves similar clauses for context,
                        assesses risk, and flags it (risk level + rationale).
  3. Sign-off Agent   — approves clauses that pass (low risk).

The LLM is configurable (defaults to Claude via LiteLLM). Prompts are kept
simple and deterministic-ish — the demo's point is authorization, not model
quality.
"""

from __future__ import annotations

from crewai import Agent, Crew, LLM, Process, Task

from .app_client import AppClient
from .tools import RunContext, make_tools


def build_crew(
    client: AppClient,
    ctx: RunContext,
    contract_id: str,
    llm_model: str,
    llm_api_key: str | None = None,
) -> Crew:
    # BYOK: the visitor's key is supplied per-run and passed straight to the LLM;
    # it is used only for this crew and never stored. When absent (local dev), the
    # LLM falls back to the provider key in the environment.
    llm = LLM(model=llm_model, api_key=llm_api_key) if llm_api_key else LLM(model=llm_model)
    tools = make_tools(client, ctx)

    extractor = Agent(
        role="Clause Extractor",
        goal="Retrieve every clause of the contract so it can be reviewed.",
        backstory=(
            "You are meticulous and only work from the clauses returned by the "
            "API. You never invent clauses."
        ),
        tools=tools,
        llm=llm,
        verbose=False,
    )
    flagger = Agent(
        role="Risk Flagger",
        goal=(
            "For each clause, retrieve similar clauses for context, judge its "
            "risk (low/medium/high), and flag it with a one-sentence rationale."
        ),
        backstory=(
            "You are a cautious contracts analyst. Liability, indemnification, "
            "termination and governing-law clauses tend to carry more risk; "
            "boilerplate definitions tend to be low risk."
        ),
        tools=tools,
        llm=llm,
        verbose=False,
    )
    signoff = Agent(
        role="Sign-off Agent",
        goal="Approve the clauses that pass review (low risk).",
        backstory=(
            "You give final approval only to clauses assessed as low risk; you "
            "leave medium/high-risk clauses flagged for a human."
        ),
        tools=tools,
        llm=llm,
        verbose=False,
    )

    extract_task = Task(
        description=(
            f"Fetch all clauses for contract {contract_id} using "
            f"get_contract_clauses. List each clause's id and index."
        ),
        expected_output="A list of the contract's clause ids and their text.",
        agent=extractor,
    )
    flag_task = Task(
        description=(
            "For each clause from the previous step: call retrieve_similar_clauses "
            "with the clause text for context, decide a risk level "
            "(low/medium/high), and call flag_clause with the clause id, the risk "
            "level, and a one-sentence rationale."
        ),
        expected_output="Every clause flagged with a risk level and rationale.",
        agent=flagger,
        context=[extract_task],
    )
    signoff_task = Task(
        description=(
            "Approve every clause that was assessed as low risk by calling "
            "approve_clause with its clause id. Leave medium/high-risk clauses "
            "flagged (do not approve them)."
        ),
        expected_output="Low-risk clauses approved; risky ones left flagged.",
        agent=signoff,
        context=[flag_task],
    )

    return Crew(
        agents=[extractor, flagger, signoff],
        tasks=[extract_task, flag_task, signoff_task],
        process=Process.sequential,
        verbose=False,
    )
