"""Handoff Lab API. Run from backend/: uvicorn main:app --port 8010

There is no login: keep it on 127.0.0.1 (the default). Binding to 0.0.0.0 would let anyone on the
network start paid live runs and read reviewer notes.
"""
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

load_dotenv(Path(__file__).parent.parent / ".env")
load_dotenv(Path(__file__).parent / ".env")

import db  # noqa: E402  (env must be loaded before db reads HANDOFF_DB)
import jev  # noqa: E402
import tracing  # noqa: E402
from agents import LiveModelError, live_config, run_live  # noqa: E402
from evaluator import evaluate  # noqa: E402
from models import AgentResult, Handoff, ReviewRequest, RunRequest, Scenario  # noqa: E402

DATA = Path(__file__).parent / "data"
POLICY = (DATA / "policy.md").read_text(encoding="utf-8")
SCENARIOS = {s["id"]: Scenario(**s) for s in json.loads((DATA / "scenarios.json").read_text(encoding="utf-8"))}
DEMO = json.loads((DATA / "demo_outputs.json").read_text(encoding="utf-8"))

app = FastAPI(title="Handoff Lab API", description="Independent prototype. Fictional data only.")
CSRF_HEADER = "X-Handoff-Lab"


@app.middleware("http")
async def require_app_header(request: Request, call_next):
    # A web page on another site can't add a custom header without a CORS preflight, which this API
    # never approves, so this stops other pages in the same browser from starting paid live runs.
    if request.method == "POST" and request.headers.get(CSRF_HEADER) != "1":
        return JSONResponse({"detail": f"Missing {CSRF_HEADER} header."}, status_code=403)
    return await call_next(request)


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


@app.get("/api/health")
def health():
    key, model = live_config()
    return {"ok": True, "live_available": bool(key and model), "model": model if key else None,
            "jev_available": jev.available(), "tracing_enabled": tracing.enabled()}


@app.get("/api/policy")
def policy():
    return {"markdown": POLICY}


@app.get("/api/scenarios")
def scenarios():
    return [s.model_dump() for s in SCENARIOS.values()]


@app.post("/api/runs")
def create_run(req: RunRequest):
    s = SCENARIOS.get(req.scenario_id)
    if not s:
        raise HTTPException(404, f"Unknown scenario '{req.scenario_id}'")
    if req.mode == "live" and req.inject_failure:
        raise HTTPException(400, "Sample failure injection is only available in demo mode.")

    # Only live runs are traced: demo mode stays fully offline.
    live = req.mode == "live"
    with tracing.span("Handoff Lab run", active=live, metadata={"mode": req.mode},
                      input={"scenario": s.id, "customer_message": s.customer_message}) as root:
        run = _execute(s, req)
        root.update(output={"status": run["status"], "error": run["error"],
                            "summary": run["evaluation"]["summary"] if run["evaluation"] else None})
        if live and (url := tracing.trace_url()):
            run["trace"].append({"at": now(), "stage": "policy", "label": "Langfuse trace recorded", "detail": url})
    db.save_run(run)
    return run


def _execute(s: Scenario, req: RunRequest) -> dict:
    trace = []
    log = lambda stage, label, detail="": trace.append({"at": now(), "stage": stage, "label": label, "detail": detail})
    source = "live_model" if req.mode == "live" else ("demo_injected_failure" if req.inject_failure else "demo_sample")
    run = {"id": uuid.uuid4().hex[:12], "scenario_id": s.id, "mode": req.mode, "source": source,
           "model": None, "status": "completed", "error": None, "agent": None, "handoff": None,
           "evaluation": None, "jev": None, "trace": trace, "debug": None, "started_at": now()}
    log("customer", "Customer message received", s.customer_message)

    if req.mode == "live":
        _, model = live_config()
        run["model"] = model
        log("agent", "Calling live model", f"Model: {model}")
        try:
            agent, handoff, notes = run_live(s, POLICY)
            for n in notes:
                log("agent", "Live model call completed", n)
        except LiveModelError as e:
            run.update(status="error", error=str(e), debug=e.debug or None, completed_at=now())
            log("agent", "Live run failed", str(e))
            return run
        if jev.available():
            try:
                run["jev"] = jev.signals(s.customer_message)
                log("policy", "Jev signals received (TypeSafe)",
                    f"{run['jev']['model']}: rules triggered: {', '.join(run['jev']['rules']) or 'none'}")
            except Exception as e:  # Jev is optional: any failure must not lose the paid agent result
                log("policy", "Jev unavailable; continuing without it", type(e).__name__)
    else:
        sample = DEMO[s.id]["faulty"] if req.inject_failure else DEMO[s.id]
        label = ("Loaded PREDEFINED FAULTY response (injected sample failure, not a model call)"
                 if req.inject_failure else "Loaded prewritten demo response (not a live model call)")
        log("agent", label)
        agent = AgentResult(**sample["agent"])
        handoff = Handoff(**sample["handoff"]) if sample["handoff"] else None

    log("agent", f"Agent decision: {'escalate' if agent.escalate else 'handle directly'}",
        f"Rule: {agent.policy_rule}. {agent.escalation_reason}")
    if handoff:
        log("agent", "Handoff summary generated", handoff.issue)

    with tracing.span("Deterministic checks", active=req.mode == "live") as checks_span:
        evaluation = evaluate(s, agent, handoff, POLICY, run["jev"])
        sm = evaluation["summary"]
        checks_span.update(output=evaluation)
    if req.mode == "live":  # scores attach to the live run's trace
        tracing.score("checks_failed", sm["fail"])
        tracing.score("checks_needs_review", sm["needs_review"])
        tracing.score("escalation_correct", float(agent.escalate == s.expected_escalation))
    log("policy", "Deterministic policy checks complete",
        f"{sm['pass']} passed, {sm['fail']} failed, {sm['needs_review']} need review")
    log("human", "Awaiting human review of handoff" if handoff else "No handoff, so no human review is needed")

    run.update(agent=agent.model_dump(), handoff=handoff.model_dump() if handoff else None,
               evaluation=evaluation, completed_at=now())
    return run


@app.get("/api/runs")
def runs():
    return db.list_runs()


@app.get("/api/runs/{run_id}")
def get_run(run_id: str):
    run = db.get_run(run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return run


@app.post("/api/runs/{run_id}/review")
def review(run_id: str, req: ReviewRequest):
    """Simulated review: records the decision in SQLite only. Sends nothing anywhere."""
    run = db.get_run(run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    if not run["handoff"]:
        raise HTTPException(400, "This run has no handoff to review.")
    note = (req.note or "").strip()[:2000] or None
    db.save_review(run_id, req.status, note, now())
    return db.get_run(run_id)
