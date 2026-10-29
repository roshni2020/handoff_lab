"""Run every scenario against the live model and compare with the expected outcome and the demo sample.

Usage (from backend/, with ANTHROPIC_API_KEY and ANTHROPIC_MODEL set in .env):
    python compare.py              # one live run per scenario
    python compare.py --repeat 3   # three runs each, to see how consistent the model is
Each live run makes one or two small API calls. A JSON report is written to backend/reports/.
"""
import argparse
import json
from datetime import datetime
from pathlib import Path

import jev
import tracing
from agents import LiveModelError, live_config, run_live
from evaluator import evaluate
from main import DEMO, POLICY, SCENARIOS
from models import AgentResult, Handoff


def fmt(summary: dict) -> str:
    return f"{summary['pass']}/{summary['fail']}/{summary['needs_review']}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeat", type=int, default=1)
    args = ap.parse_args()
    key, model = live_config()
    if not key or not model:
        raise SystemExit("Set ANTHROPIC_API_KEY and ANTHROPIC_MODEL in .env first.")

    use_jev = jev.available()
    print(f"Model: {model}   Jev: {'on' if use_jev else 'off'}   runs per scenario: {args.repeat}   columns: pass/fail/review\n")
    print(f"{'scenario':24} {'expected':9} {'demo':8} {'live decision':16} {'live checks':12} {'jev':9} failed checks")
    report, escalation_hits, jev_hits, total = [], 0, 0, 0
    for s in SCENARIOS.values():
        d = DEMO[s.id]
        demo_eval = evaluate(s, AgentResult(**d["agent"]), Handoff(**d["handoff"]) if d["handoff"] else None, POLICY)
        for i in range(args.repeat):
            total += 1
            try:
                agent, handoff, notes = run_live(s, POLICY)
            except LiveModelError as e:
                print(f"{s.id:24} ERROR: {e}")
                report.append({"scenario": s.id, "run": i + 1, "error": str(e), "debug": e.debug})
                continue
            signals = None
            if use_jev:
                try:
                    signals = jev.signals(s.customer_message)
                    jev_hits += signals["escalate"] == s.expected_escalation
                except jev.TypeSafeError as e:
                    print(f"{s.id:24} Jev error: {type(e).__name__}")
            ev = evaluate(s, agent, handoff, POLICY, signals)
            hit = agent.escalate == s.expected_escalation
            escalation_hits += hit
            failed = [c["name"] for c in ev["checks"] if c["status"] == "fail"]
            print(f"{s.id:24} {'escalate' if s.expected_escalation else 'handle':9} {fmt(demo_eval['summary']):8} "
                  f"{('escalate' if agent.escalate else 'handle') + (' ok' if hit else ' WRONG'):16} "
                  f"{fmt(ev['summary']):12} {('-' if not signals else 'escalate' if signals['escalate'] else 'handle'):9} "
                  f"{'; '.join(failed) or '-'}")
            report.append({"scenario": s.id, "run": i + 1, "agent": agent.model_dump(),
                           "handoff": handoff.model_dump() if handoff else None,
                           "evaluation": ev, "jev": signals, "demo_summary": demo_eval["summary"], "usage": notes})

    print(f"\nEscalation decisions correct: agent {escalation_hits}/{total}" + (f", Jev {jev_hits}/{total}" if use_jev else ""))
    tracing.flush()
    out = Path(__file__).parent / "reports" / f"compare-{datetime.now():%Y%m%d-%H%M%S}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps({"model": model, "results": report}, indent=2), encoding="utf-8")
    print(f"Full report: {out}")


if __name__ == "__main__":
    main()
