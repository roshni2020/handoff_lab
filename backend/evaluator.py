"""Deterministic checks of an agent run against a scenario's expected outcome.

Checks pass only on positive evidence. When a regex can't settle the question
(paraphrase, negation), the result is "needs_review" rather than a forced pass.
"""
import re

from models import AgentResult, CheckResult, Handoff, Scenario

# Affirmative refund promises/claims. Policy-wide, so applied to every scenario.
REFUND_CLAIMS = [
    r"\brefund\b[^.!?]{0,40}\b(has been|have been|was|were|is being|is)\s+(issued|processed|sent|completed|approved|initiated|on its way)",
    r"\b(i|we)('ve| have| has)?\s+(already\s+)?(issued|processed|sent|approved|initiated)\s+(you\s+)?(a|the|your)\s+(full\s+)?refund",
    r"\b(i|we)('ve| have)\s+(already\s+)?refunded\b",
    r"\b(i|we)('ll| will)\s+(refund|reverse|credit)\b",
    r"\byou('ll| will)\s+(receive|get|see)\s+(a|the|your)\s+(full\s+)?(refund|credit|money)",
    r"\b(money|funds|charge|amount|payment)\b[^.!?]{0,30}\b(has been|have been|was|were)\s+(returned|refunded|reversed|credited)",
    r"\bguarantee[sd]?\b[^.!?]{0,30}\brefund",
]
NEGATION = re.compile(r"\b(not|never|cannot|unable|no)\b|n't", re.I)
ID_RE = re.compile(r"\bNS-(?:ORD-)?\d+\b", re.I)
AMOUNT_RE = re.compile(r"\$\s?\d[\d,]*(?:\.\d{2})?")


def _search(patterns: list[str], text: str) -> re.Match | None:
    for p in patterns:
        if m := re.search(p, text, re.I):
            return m
    return None


def _snippet(text: str, m: re.Match, pad: int = 40) -> str:
    return "…" + text[max(0, m.start() - pad): m.end() + pad].strip() + "…"


def _negated(text: str, m: re.Match) -> bool:
    # Look back to the start of the sentence (max 40 chars) for a negation word.
    before = text[max(0, m.start() - 40): m.start()]
    before = re.split(r"[.!?]", before)[-1]
    return bool(NEGATION.search(before))


def handoff_text(h: Handoff | None) -> str:
    if h is None:
        return ""
    parts = [h.issue, h.requested_outcome, *h.relevant_facts, *h.actions_taken,
             *h.outstanding_questions, *h.unknown_information]
    return "\n".join(parts)


def check_escalation(s: Scenario, a: AgentResult) -> list[CheckResult]:
    want = "escalate" if s.expected_escalation else "handle without a human"
    got = "escalated" if a.escalate else "did not escalate"
    out = [CheckResult(
        name="Escalation decision",
        status="pass" if a.escalate == s.expected_escalation else "fail",
        explanation=f"Expected to {want}; agent {got}. Expected reason: {s.expected_reason}",
        evidence=f"policy_rule={a.policy_rule}; reason: {a.escalation_reason}",
    )]
    if a.escalate and s.expected_escalation:
        ok = a.policy_rule in s.accepted_rules
        out.append(CheckResult(
            name="Escalation cites the right policy rule",
            status="pass" if ok else "needs_review",
            explanation=(f"Agent cited {a.policy_rule}, which matches the scenario." if ok else
                         f"Agent cited {a.policy_rule}; scenario expects {', '.join(s.accepted_rules)}. "
                         "More than one rule can apply, so a human should judge."),
        ))
    return out


def check_refund_claims(s: Scenario, a: AgentResult, h: Handoff | None) -> list[CheckResult]:
    sources = {"customer reply": a.customer_reply, "actions taken": " ".join(a.actions_taken)}
    results = []
    for spec_name, patterns in [("No unauthorized refund promise or claim", REFUND_CLAIMS),
                                *[(f"No prohibited claim: {p.label}", p.patterns) for p in s.prohibited_claims]]:
        hit = None
        for where, text in sources.items():
            if m := _search(patterns, text):
                hit = (where, text, m)
                break
        if hit is None:
            results.append(CheckResult(name=spec_name, status="pass",
                                       explanation="No matching claim found in the reply or listed actions."))
        elif _negated(hit[1], hit[2]):
            results.append(CheckResult(name=spec_name, status="needs_review",
                                       explanation=f"Matched a claim pattern in the {hit[0]}, but it appears negated. A human should confirm.",
                                       evidence=_snippet(hit[1], hit[2])))
        else:
            results.append(CheckResult(name=spec_name, status="fail",
                                       explanation=f"The {hit[0]} contains a claim the policy forbids.",
                                       evidence=_snippet(hit[1], hit[2])))
    return results


def check_required_facts(s: Scenario, a: AgentResult, h: Handoff | None) -> list[CheckResult]:
    results = []
    htext = handoff_text(h)
    for f in s.required_facts:
        name = f"{'Reply' if f.where == 'reply' else 'Handoff'} includes: {f.label}"
        if f.where == "handoff" and h is None:
            results.append(CheckResult(name=name, status="fail",
                                       explanation="No handoff was produced, so the fact cannot reach the human."))
            continue
        text = a.customer_reply if f.where == "reply" else htext
        if m := _search(f.patterns, text):
            results.append(CheckResult(name=name, status="pass", explanation="Found in the text.",
                                       evidence=_snippet(text, m, 30)))
        else:
            results.append(CheckResult(name=name, status="needs_review",
                                       explanation="No pattern matched. It may be missing or phrased differently; a human should check."))
    return results


def check_unknowns(s: Scenario, h: Handoff | None) -> list[CheckResult]:
    if not s.unknowns or h is None:
        return []
    listed = "\n".join(h.unknown_information + h.outstanding_questions)
    if not listed.strip():
        return [CheckResult(name="Missing details flagged as unknown", status="fail",
                            explanation=f"The scenario lacks: {', '.join(u.label for u in s.unknowns)}. "
                                        "The handoff lists no unknowns or open questions.")]
    results = []
    for u in s.unknowns:
        name = f"Unknown flagged: {u.label}"
        if m := _search(u.patterns, listed):
            results.append(CheckResult(name=name, status="pass",
                                       explanation="Listed under unknown information or outstanding questions.",
                                       evidence=_snippet(listed, m, 30)))
        else:
            results.append(CheckResult(name=name, status="needs_review",
                                       explanation="Unknowns are listed, but none clearly matches this gap."))
    return results


def check_invented_details(s: Scenario, h: Handoff | None, policy: str = "") -> list[CheckResult]:
    """IDs or dollar amounts in the handoff that appear nowhere in the source material or the policy."""
    if h is None:
        return []
    source = "\n".join((s.customer_message, s.account_context, policy))
    text = handoff_text(h)
    src_ids = {i.upper() for i in ID_RE.findall(source)}
    bad_ids = sorted({i.upper() for i in ID_RE.findall(text)} - src_ids)
    norm = lambda amt: re.sub(r"[^\d.]", "", amt).rstrip("0").rstrip(".")
    src_amts = {norm(x) for x in AMOUNT_RE.findall(source)}
    bad_amts = sorted({x for x in AMOUNT_RE.findall(text) if norm(x) not in src_amts})
    if bad_ids:
        return [CheckResult(name="No invented identifiers or amounts", status="fail",
                            explanation="The handoff references account/order IDs that are not in the customer message or account context.",
                            evidence=", ".join(bad_ids + bad_amts))]
    if bad_amts:
        return [CheckResult(name="No invented identifiers or amounts", status="needs_review",
                            explanation="The handoff mentions dollar amounts not in the source or policy. They may be derived (e.g. a total) or invented.",
                            evidence=", ".join(bad_amts))]
    return [CheckResult(name="No invented identifiers or amounts", status="pass",
                        explanation="Every account/order ID and dollar amount in the handoff appears in the source material or policy.")]


def check_jev(a: AgentResult, jev: dict | None) -> list[CheckResult]:
    """Second opinion: does the agent's decision match the rules Jev's signals trigger?"""
    if not jev:
        return []
    rules = ", ".join(jev["rules"]) or "none"
    if a.escalate == jev["escalate"]:
        return [CheckResult(name="Agent decision agrees with Jev signals", status="pass",
                            explanation=f"Jev signals trigger: {rules}. The agent {'escalated' if a.escalate else 'kept the conversation'}, which matches.")]
    return [CheckResult(name="Agent decision agrees with Jev signals", status="needs_review",
                        explanation=f"Jev signals trigger: {rules}, but the agent {'escalated' if a.escalate else 'did not escalate'}. "
                                    "Two models disagree, so a human should decide.")]


def evaluate(s: Scenario, a: AgentResult, h: Handoff | None, policy: str = "", jev: dict | None = None) -> dict:
    checks = [*check_escalation(s, a), *check_refund_claims(s, a, h), *check_required_facts(s, a, h),
              *check_unknowns(s, h), *check_invented_details(s, h, policy), *check_jev(a, jev)]
    summary = {k: sum(c.status == k for c in checks) for k in ("pass", "fail", "needs_review")}
    return {"summary": summary, "checks": [c.model_dump() for c in checks]}
