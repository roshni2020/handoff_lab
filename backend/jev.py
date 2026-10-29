"""Second opinion from TypeSafe's Jev: typed yes/no signals for each escalation rule.

Jev answers narrow questions about the customer message; plain code turns the answers into
policy rules (including the $100 comparison, which is arithmetic, not a judgment).
"""
import os
import re

from typesafe_sdk import Noul, TypeSafeClient, TypeSafeError

import tracing

THRESHOLD = 0.5
QUESTIONS = {
    "human_requested": Noul(instructions="Does the customer explicitly ask to speak with a human, a real person, or a representative?"),
    "unauthorized_charge": Noul(instructions="Does the customer say a charge or transaction on their account was not made by them or is not recognised?"),
    "duplicate_charge": Noul(instructions="Does the customer report being charged more than once for the same thing?"),
    "refund_requested": Noul(instructions="Is the customer asking for a refund?"),
    "upset": Noul(instructions="Is the customer upset or frustrated?"),
}
LABELS = {
    "human_requested": "Asks for a human",
    "unauthorized_charge": "Reports a charge they did not make",
    "duplicate_charge": "Reports a duplicate charge",
    "refund_requested": "Asks for a refund",
    "upset": "Upset or frustrated (not a rule by itself)",
}
AMOUNT_RE = re.compile(r"\$\s?(\d[\d,]*(?:\.\d{2})?)")


def available() -> bool:
    return bool(os.getenv("TYPESAFE_API_KEY"))


def rules_from(p: dict[str, float], message: str) -> list[str]:
    amounts = [float(a.replace(",", "")) for a in AMOUNT_RE.findall(message)]
    rules = []
    if p["human_requested"] >= THRESHOLD:
        rules.append("HUMAN_REQUESTED")
    if p["unauthorized_charge"] >= THRESHOLD:
        rules.append("SUSPECTED_FRAUD")
    if p["duplicate_charge"] >= THRESHOLD:
        rules.append("DUPLICATE_CHARGE")
    if p["refund_requested"] >= THRESHOLD and any(a > 100 for a in amounts):
        rules.append("REFUND_OVER_100")
    return rules


def signals(message: str) -> dict:
    """Raises TypeSafeError on failure; callers treat Jev as optional."""
    model = os.getenv("TYPESAFE_MODEL", "jev-latest")
    with tracing.generation("Jev signals", model=model,
                            input={"customer_message": message, "questions": {k: q.instructions for k, q in QUESTIONS.items()}}) as gen:
        try:
            with TypeSafeClient(timeout=20.0) as client:
                r = client.system_one(model=model, state={"customer_message": message}, questions=QUESTIONS)
        except TypeSafeError as e:
            gen.update(level="ERROR", status_message=type(e).__name__)
            raise
        p = {k: round(r.answers[k].noul, 3) for k in QUESTIONS}
        rules = rules_from(p, message)
        usage = getattr(r, "usage", None)
        gen.update(output={"probabilities": p, "rules": rules},
                   usage_details={"input": usage.input_tokens, "output": usage.output_tokens} if usage else None)
    return {
        "model": getattr(r, "model", None),
        "signals": [{"id": k, "label": LABELS[k], "probability": v} for k, v in p.items()],
        "rules": rules,
        "escalate": bool(rules),
    }


__all__ = ["available", "rules_from", "signals", "TypeSafeError", "THRESHOLD"]
