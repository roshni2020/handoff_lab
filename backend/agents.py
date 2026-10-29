"""Live Anthropic calls for the two agents. Server-side only; the key never leaves this process."""
import json
import os

import anthropic
from pydantic import BaseModel, ValidationError

import tracing
from models import AgentResult, Handoff, Scenario

AGENT_SYSTEM = """You are the AI customer service agent for Northstar Support, a fictional company.
Follow the policy exactly. You cannot issue refunds, reverse charges, lock accounts, or take any real action;
you can only reply and decide whether a human must take over.
- Keep customer_reply under 90 words, friendly and plain.
- Set escalate=true only when a policy rule requires a human; set policy_rule to that rule, otherwise NONE.
- actions_taken lists only what you actually did here (e.g. "Reviewed account context"). Never claim an action you cannot take.
- If information is missing, say it is unknown. Do not invent details.
- Write plain sentences; do not use em dashes.

POLICY:
{policy}"""

HANDOFF_SYSTEM = """You write handoff summaries for a human support specialist at Northstar Support (fictional).
Use ONLY facts present in the customer message, the account context, and the AI agent's reply.
Never invent names, IDs, amounts, dates, or outcomes. If something critical is missing or unverified,
list it under unknown_information. Keep every list item to one short sentence."""


class LiveModelError(Exception):
    def __init__(self, message: str, debug: dict | None = None):
        super().__init__(message)
        self.debug = debug or {}


def live_config() -> tuple[str | None, str | None]:
    return os.getenv("ANTHROPIC_API_KEY") or None, os.getenv("ANTHROPIC_MODEL") or None


def _call(client: anthropic.Anthropic, model: str, system: str, user: str, schema: type[BaseModel], step: str):
    """One structured-output call, recorded as a Langfuse generation when tracing is on."""
    with tracing.generation(step, model=model, input={"system": system, "user": user}) as gen:
        try:
            result, usage, meta = _request(client, model, system, user, schema, step)
        except LiveModelError as e:
            gen.update(level="ERROR", status_message=str(e), metadata=e.debug)
            raise
        gen.update(output=result.model_dump(), metadata=meta,
                   usage_details={"input": usage.input_tokens, "output": usage.output_tokens})
        return result, usage


def _request(client: anthropic.Anthropic, model: str, system: str, user: str, schema: type[BaseModel], step: str):
    output_config: dict = {"format": {"type": "json_schema", "schema": schema.model_json_schema()}}
    if effort := os.getenv("ANTHROPIC_EFFORT", "low"):
        output_config["effort"] = effort
    try:
        resp = client.messages.create(
            model=model, max_tokens=int(os.getenv("ANTHROPIC_MAX_TOKENS", "4000")),
            system=system, messages=[{"role": "user", "content": user}],
            output_config=output_config,
        )
    except anthropic.AuthenticationError:
        raise LiveModelError(f"{step}: the API key was rejected. Check ANTHROPIC_API_KEY.")
    except anthropic.NotFoundError:
        raise LiveModelError(f"{step}: model '{model}' was not found. Check ANTHROPIC_MODEL.")
    except anthropic.RateLimitError:
        raise LiveModelError(f"{step}: rate limited by the Anthropic API. Try again shortly.")
    except anthropic.APITimeoutError:
        raise LiveModelError(f"{step}: the model call timed out.")
    except anthropic.APIStatusError as e:
        raise LiveModelError(f"{step}: Anthropic API error {e.status_code}: {e.message}")
    except anthropic.APIConnectionError:
        raise LiveModelError(f"{step}: could not reach the Anthropic API.")

    raw = next((b.text for b in resp.content if b.type == "text"), "")
    debug = {"step": step, "stop_reason": resp.stop_reason, "request_id": resp._request_id, "raw_output": raw[:2000]}
    if resp.stop_reason == "refusal":
        raise LiveModelError(f"{step}: the model declined to respond.", debug)
    if resp.stop_reason == "max_tokens":
        raise LiveModelError(f"{step}: output was cut off at max_tokens.", debug)
    try:
        meta = {"stop_reason": resp.stop_reason, "request_id": resp._request_id}
        return schema.model_validate(json.loads(raw)), resp.usage, meta
    except (json.JSONDecodeError, ValidationError) as e:
        debug["validation_error"] = str(e)[:1000]
        raise LiveModelError(f"{step}: the model returned invalid structured output.", debug)


def run_live(s: Scenario, policy: str) -> tuple[AgentResult, Handoff | None, list[str]]:
    key, model = live_config()
    if not key or not model:
        raise LiveModelError("Live mode needs ANTHROPIC_API_KEY and ANTHROPIC_MODEL set on the server.")
    client = anthropic.Anthropic(api_key=key, timeout=60.0, max_retries=1)
    notes = []

    convo = f"ACCOUNT CONTEXT (fictional):\n{s.account_context}\n\nCUSTOMER MESSAGE:\n{s.customer_message}"
    agent, usage = _call(client, model, AGENT_SYSTEM.format(policy=policy), convo, AgentResult, "Customer service agent")
    notes.append(f"Agent call: {usage.input_tokens} in / {usage.output_tokens} out tokens")
    if not agent.escalate:
        return agent, None, notes

    handoff_input = f"{convo}\n\nAI AGENT REPLY:\n{agent.customer_reply}\n\nAGENT ESCALATION REASON:\n{agent.escalation_reason}"
    handoff, usage = _call(client, model, HANDOFF_SYSTEM, handoff_input, Handoff, "Handoff summarizer")
    notes.append(f"Handoff call: {usage.input_tokens} in / {usage.output_tokens} out tokens")
    return agent, handoff, notes
