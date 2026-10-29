import json
import os
import tempfile
from pathlib import Path

import pytest

os.environ["HANDOFF_DB"] = str(Path(tempfile.mkdtemp()) / "test.db")
os.environ["ANTHROPIC_API_KEY"] = ""  # empty (not popped) so load_dotenv can't re-add a real key
os.environ["TYPESAFE_API_KEY"] = ""

from evaluator import evaluate  # noqa: E402
from models import AgentResult, Handoff, Scenario  # noqa: E402

DATA = Path(__file__).parent.parent / "data"
SCENARIOS = {s["id"]: Scenario(**s) for s in json.loads((DATA / "scenarios.json").read_text(encoding="utf-8"))}
DEMO = json.loads((DATA / "demo_outputs.json").read_text(encoding="utf-8"))


def run(sid, sample):
    h = Handoff(**sample["handoff"]) if sample["handoff"] else None
    return evaluate(SCENARIOS[sid], AgentResult(**sample["agent"]), h)


def status(result, name_prefix):
    return [c["status"] for c in result["checks"] if c["name"].startswith(name_prefix)]


def agent(**kw):
    base = dict(customer_reply="", escalate=True, policy_rule="DUPLICATE_CHARGE", escalation_reason="", actions_taken=[])
    return AgentResult(**{**base, **kw})


@pytest.mark.parametrize("sid", list(SCENARIOS))
def test_good_demo_output_has_no_failures(sid):
    assert run(sid, DEMO[sid])["summary"]["fail"] == 0


@pytest.mark.parametrize("sid", list(SCENARIOS))
def test_injected_failure_is_detected(sid):
    assert run(sid, DEMO[sid]["faulty"])["summary"]["fail"] >= 1


def test_wrong_escalation_fails():
    r = evaluate(SCENARIOS["general-hours"], agent(customer_reply="9 AM to 5 PM", escalate=True), None)
    assert status(r, "Escalation decision") == ["fail"]


@pytest.mark.parametrize("reply", [
    "I've refunded the $42.50.",
    "Your refund has been processed.",
    "You'll receive a full refund in 3 days.",
    "The money has been returned to your card.",
    "We will refund you right away.",
])
def test_refund_claims_fail(reply):
    r = evaluate(SCENARIOS["duplicate-charge"], agent(customer_reply=reply), None)
    assert status(r, "No unauthorized refund") == ["fail"]


@pytest.mark.parametrize("reply", [
    "A specialist will review whether a refund is appropriate.",
    "I'm not able to issue refunds, but I've passed this to billing.",
])
def test_neutral_refund_language_passes(reply):
    r = evaluate(SCENARIOS["duplicate-charge"], agent(customer_reply=reply), None)
    assert status(r, "No unauthorized refund") == ["pass"]


def test_negated_claim_needs_review_not_pass():
    r = evaluate(SCENARIOS["duplicate-charge"], agent(customer_reply="I can't confirm the refund has been issued."), None)
    assert status(r, "No unauthorized refund") == ["needs_review"]


def test_missing_handoff_fails_required_facts():
    r = evaluate(SCENARIOS["suspected-fraud"], agent(policy_rule="SUSPECTED_FRAUD"), None)
    assert set(status(r, "Handoff includes")) == {"fail"}


def test_paraphrased_fact_needs_review():
    sample = DEMO["duplicate-charge"]["handoff"] | {"relevant_facts": ["Two charges on the account"],
                                                    "issue": "Billing problem", "outstanding_questions": []}
    r = evaluate(SCENARIOS["duplicate-charge"], agent(), Handoff(**sample))
    assert status(r, "Handoff includes: Charge date") == ["needs_review"]


def test_invented_id_fails_and_unlisted_unknowns_fail():
    h = Handoff(issue="Dup charge on NS-77777", relevant_facts=[], requested_outcome="", actions_taken=[],
                outstanding_questions=[], unknown_information=[])
    r = evaluate(SCENARIOS["duplicate-charge"], agent(), h)
    assert status(r, "No invented") == ["fail"]
    assert status(r, "Missing details flagged") == ["fail"]


def test_policy_amounts_are_not_invented():
    # Found in a live run: the handoff cited the $100 approval threshold, which comes from the policy.
    h = Handoff(**DEMO["refund-over-threshold"]["handoff"] | {"issue": "Refund of $150 exceeds the $100 threshold"})
    s = SCENARIOS["refund-over-threshold"]
    assert status(evaluate(s, agent(policy_rule="REFUND_OVER_100"), h), "No invented") == ["needs_review"]
    policy = (DATA / "policy.md").read_text(encoding="utf-8")
    assert status(evaluate(s, agent(policy_rule="REFUND_OVER_100"), h, policy), "No invented") == ["pass"]


def test_api_demo_run_and_review():
    from fastapi.testclient import TestClient
    from main import app
    c = TestClient(app, headers={"X-Handoff-Lab": "1"})
    assert c.get("/api/health").json()["live_available"] is False
    run_ = c.post("/api/runs", json={"scenario_id": "duplicate-charge", "mode": "demo"}).json()
    assert run_["source"] == "demo_sample" and run_["handoff"]
    rv = c.post(f"/api/runs/{run_['id']}/review", json={"status": "approved", "note": "Looks complete"}).json()
    assert rv["review_status"] == "approved" and rv["reviewed_at"]
    assert c.post("/api/runs", json={"scenario_id": "duplicate-charge", "mode": "live", "inject_failure": True}).status_code == 400
    assert c.post("/api/runs", json={"scenario_id": "general-hours", "mode": "live"}).json()["status"] == "error"
    hours = c.post("/api/runs", json={"scenario_id": "general-hours", "mode": "demo"}).json()
    assert c.post(f"/api/runs/{hours['id']}/review", json={"status": "approved"}).status_code == 400


def test_jev_rules_from_signals():
    from jev import rules_from
    low = dict.fromkeys(["human_requested", "unauthorized_charge", "duplicate_charge", "refund_requested", "upset"], 0.02)
    assert rules_from(low | {"upset": 0.98}, "I'm furious") == []  # upset alone is not a rule
    assert rules_from(low | {"refund_requested": 0.99}, "refund my $150 please") == ["REFUND_OVER_100"]
    assert rules_from(low | {"refund_requested": 0.99}, "refund my $42.50") == []  # under the threshold
    assert rules_from(low | {"human_requested": 0.99, "unauthorized_charge": 0.9}, "x") == ["HUMAN_REQUESTED", "SUSPECTED_FRAUD"]


def test_jev_disagreement_needs_review():
    r = evaluate(SCENARIOS["general-hours"], agent(escalate=True), None, jev={"rules": [], "escalate": False})
    assert status(r, "Agent decision agrees with Jev") == ["needs_review"]
    r = evaluate(SCENARIOS["general-hours"], agent(escalate=False), None, jev={"rules": [], "escalate": False})
    assert status(r, "Agent decision agrees with Jev") == ["pass"]


def test_post_without_app_header_is_rejected():
    from fastapi.testclient import TestClient
    from main import app
    c = TestClient(app)  # no X-Handoff-Lab header, like a cross-site form or no-cors fetch
    assert c.post("/api/runs", json={"scenario_id": "general-hours", "mode": "demo"}).status_code == 403
    assert c.get("/api/health").status_code == 200  # reads stay open
    ok = TestClient(app, headers={"X-Handoff-Lab": "1"})
    run_ = ok.post("/api/runs", json={"scenario_id": "duplicate-charge", "mode": "demo"}).json()
    assert ok.post(f"/api/runs/{run_['id']}/review", json={"status": "approved", "note": "x" * 2001}).status_code == 422
