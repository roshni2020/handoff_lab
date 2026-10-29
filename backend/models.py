from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

PolicyRule = Literal["NONE", "DUPLICATE_CHARGE", "REFUND_OVER_100", "SUSPECTED_FRAUD", "HUMAN_REQUESTED"]
CheckStatus = Literal["pass", "fail", "needs_review"]


class Strict(BaseModel):
    # extra="forbid" emits additionalProperties:false, which structured outputs require.
    model_config = ConfigDict(extra="forbid")


class AgentResult(Strict):
    customer_reply: str
    escalate: bool
    policy_rule: PolicyRule
    escalation_reason: str
    actions_taken: list[str]


class Handoff(Strict):
    issue: str
    relevant_facts: list[str]
    requested_outcome: str
    actions_taken: list[str]
    outstanding_questions: list[str]
    unknown_information: list[str]


class FactSpec(BaseModel):
    label: str
    where: Literal["reply", "handoff"]
    patterns: list[str]


class PatternSpec(BaseModel):
    label: str
    patterns: list[str]


class Scenario(BaseModel):
    id: str
    title: str
    summary: str
    customer_message: str
    account_context: str
    expected_escalation: bool
    expected_reason: str
    accepted_rules: list[PolicyRule]
    required_facts: list[FactSpec]
    prohibited_claims: list[PatternSpec]
    unknowns: list[PatternSpec]


class CheckResult(BaseModel):
    name: str
    status: CheckStatus
    explanation: str
    evidence: str | None = None


class RunRequest(BaseModel):
    scenario_id: str
    mode: Literal["demo", "live"]
    inject_failure: bool = False


class ReviewRequest(BaseModel):
    status: Literal["approved", "revision_requested"]
    note: str | None = Field(None, max_length=2000)
