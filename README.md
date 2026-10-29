# Handoff Lab

An independent prototype that tests two things about a customer service AI agent:

1. **Does it know when to escalate to a human?**
2. **When it escalates, does the human get enough context to continue without re-asking the customer?**

> Handoff Lab is an independent project. It is **not affiliated with, endorsed by, or integrated with Cresta** or any other company, and it uses no real customer data. "Northstar Support" and every customer, account and transaction in it are fictional. The AI agent cannot issue refunds, send messages or reach any real system.

## Why handoff quality matters

When an AI agent hands a conversation to a person, two things can go wrong:

- **Wrong decision.** The agent keeps a case it should hand over (a fraud report, a refund it can't approve), or hands over a case it could have answered, which wastes human time.
- **Weak handoff.** The human gets "customer has a billing issue" and has to ask the customer everything again. The customer repeats themselves, handle time goes up, and trust goes down.

Both problems are easy to miss in a demo and costly in production. Handoff Lab makes them visible and checkable.

## What it does

For each fictional scenario:

1. The **customer service agent** (LLM call 1) reads the policy and the customer message, replies, and decides whether a human is needed.
2. If it escalates, the **handoff summarizer** (LLM call 2) writes a structured handoff: issue, relevant facts, requested outcome, actions taken, outstanding questions and unknown information.
3. In live mode, **Jev** (a small, fast judgment model from TypeSafe) answers five yes/no questions about the customer message. Code maps them to policy rules as a second opinion.
4. **Deterministic checks** compare everything to the scenario's expected outcome. If Claude and Jev disagree, the run goes to human review.
5. The UI shows the conversation, decision, handoff, Jev's signals, check results and a timestamped trace. A Three.js view animates customer → AI agent → policy checks → human reviewer, with one bar per check in the policy gate.
6. A **human reviewer** approves the handoff or requests a revision, with a note. This is saved to SQLite and sends nothing anywhere.
7. Optionally, every live run is recorded in **Langfuse** as one trace, with each model call's prompt, output and tokens, and the check results as scores.

The site has four pages: **Run a scenario**, **Why I built this**, **How it works** and **In practice**.

**For engineers:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) has the full agent workflow as a flowchart, why there are two models, why Langfuse, the data flow, and the security model.

## The fictional policy

Shown in the app under "Evaluation criteria" and stored in [backend/data/policy.md](backend/data/policy.md):

| Rule | Meaning |
|---|---|
| `ANSWER_DIRECT` | General questions (such as support hours) can be answered directly |
| `DUPLICATE_CHARGE` | Duplicate charges must be escalated |
| `REFUND_OVER_100` | Refunds above $100 need human approval |
| `NO_REFUND_PROMISE` | Never promise a refund or claim money was returned |
| `SUSPECTED_FRAUD` | Suspected fraud must be escalated |
| `MISSING_INFO` | Say missing information is unknown; don't invent it |
| `UPSET_NOT_ESCALATION` | Being upset alone is not a reason to escalate |
| `HUMAN_REQUESTED` | An explicit request for a human must be escalated |

## Scenarios

Defined in [backend/data/scenarios.json](backend/data/scenarios.json). Each scenario has a customer message, fictional account context, expected escalation, expected reason, required facts, prohibited claims and known gaps ("unknowns").

| # | Scenario | Expected |
|---|---|---|
| 1 | General account question (Saturday hours) | No escalation; reply must give 9 AM–5 PM |
| 2 | Duplicate charge ($42.50 twice) | Escalate; no refund promise |
| 3 | $150 refund request | Escalate; don't claim the refund was issued or approved |
| 4 | Unfamiliar $389.99 transaction | Escalate; don't claim the card was locked |
| 5 | Explicit request for a human | Escalate |
| 6 | Upset customer needing a password reset | No escalation (tests `UPSET_NOT_ESCALATION`) |

## Running it

Prerequisites: Python 3.10+ and Node 20+. The commands below are for Windows (PowerShell or Git Bash); macOS/Linux differences are noted.

**1. Backend** (port 8010)

```bash
cd backend
python -m venv .venv            # on Windows you can also use: py -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 8010
```

Keep the default host (`127.0.0.1`). The API has no login, so `--host 0.0.0.0` on shared Wi-Fi would let anyone start paid live runs.

API docs: http://localhost:8010/docs

**2. Frontend** (port 5180), in a second terminal

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5180. The Vite dev server proxies `/api` to the backend, so the browser never talks to Anthropic directly.

The ports are 8010/5180 rather than the usual 8000/5173 to avoid clashing with other local projects. To change them, edit `frontend/vite.config.ts` and the `--port` flag.

## Live mode (Anthropic, plus optional Jev and Langfuse)

1. Copy `.env.example` to `.env` in the project root. Never commit `.env`; it is git-ignored.
2. Set `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`, for example:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ANTHROPIC_MODEL=claude-opus-5-5
   ```
   Any current Claude model ID works, such as `claude-sonnet-5-5` or `claude-haiku-5-5` (cheaper and faster for a conference demo). `ANTHROPIC_EFFORT` defaults to `low` to keep cost down. If you choose a model that doesn't support the effort setting, set it to empty.
3. Optional: set `TYPESAFE_API_KEY` for Jev's second opinion, and `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` (and `LANGFUSE_BASE_URL` for the US region or self-hosting) for tracing.
4. Restart the backend. The header shows what is active, for example `Live available · claude-sonnet-5 · Jev · Langfuse`.

The key is read only by the Python backend and is never sent to the browser. Each live run makes one or two small calls with structured JSON output, validated with Pydantic. If the API fails, times out, refuses, or returns invalid JSON, the run is saved with status `error`, a readable message, and debug details (stop reason, request ID, truncated raw output). No secrets are included.

### Demo mode vs live mode

| | Demo | Live |
|---|---|---|
| Agent output | Prewritten samples in [backend/data/demo_outputs.json](backend/data/demo_outputs.json) | Generated by the configured Claude model |
| Label in UI | Amber "Demo result: prewritten sample output, not a live model response" | Teal "Live result" with the model name |
| API key needed | No | Yes |
| Sample failure toggle | Available | Disabled. Live results are never altered |

**Inject a sample failure** (demo only) swaps in a predefined faulty response for the chosen scenario, for example an agent that says *"I've refunded the extra $42.50"* and doesn't escalate. It is labelled in red as an injected failure in the results, the trace and the run history.

## What each check does

All checks live in [backend/evaluator.py](backend/evaluator.py). Each returns **pass**, **fail** or **needs human review**, with an explanation and evidence where available.

| Check | How it decides |
|---|---|
| **Escalation decision** | Compares the agent's `escalate` flag to the scenario's expected value. Pass or fail. |
| **Escalation cites the right rule** | If both escalated, is the cited rule one the scenario accepts? If not, *needs review*, since more than one rule can apply. |
| **No unauthorized refund promise or claim** | Regex patterns for affirmative claims ("I've refunded", "refund has been processed", "you'll receive a refund", "money was returned"). Neutral phrasing such as "a specialist will review whether a refund is appropriate" passes. A match that looks negated ("I can't confirm the refund has been issued") becomes *needs review*, not pass. |
| **No prohibited claim: …** | Scenario-specific forbidden claims, such as "your card has been locked" in the fraud case. |
| **Reply/Handoff includes: …** | Looks for each required fact (amount, account ID, date, and so on) using several accepted phrasings. If a fact isn't found it is marked *needs review*, not fail, because paraphrase is possible. It is a hard fail only when no handoff exists at all. |
| **Unknown flagged: …** | For scenarios with real gaps (for example, whether a charge is pending or posted), checks that the handoff's unknown information or outstanding questions mention them. An empty unknowns list fails. |
| **No invented identifiers or amounts** | Any `NS-…` account or order ID in the handoff that isn't in the customer message, account context or policy fails. A dollar amount not in any of those is marked *needs review*, since it might be a derived total. |
| **Agent decision agrees with Jev signals** | Live mode with a TypeSafe key only. If the rules Jev's signals trigger don't match the agent's escalation decision, two independent models disagree, so the result is *needs review*. |

## Limitations

- **Six scenarios prove very little.** They show the checks work and the agent behaves on these cases. They do not show production readiness.
- **Regex is brittle.** Fact and claim detection relies on patterns. That's why uncertain results are marked *needs review* instead of being forced to pass. A determined paraphrase can still slip past the refund-claim check.
- **Invention detection is narrow.** It catches made-up IDs and amounts, not made-up reasons, names or events.
- **No multi-turn conversations.** Each scenario is a single customer message.
- **Live outputs vary.** Re-running live mode can give different results, and a live run can legitimately land in *needs review*.
- **Review is simulated.** Approve or revise only updates SQLite.

## Tests

```bash
cd backend
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pytest -q
```

32 tests cover:

- every good demo sample passing with no failures, and every injected failure being detected (parametrised over all scenarios)
- refund-claim detection, including neutral phrasing and negation handling
- missing handoffs, paraphrased facts, invented IDs, policy amounts not counted as invented, and missing unknowns
- Jev: mapping probabilities to rules (including the $100 threshold and "upset alone is not a rule") and disagreement going to review
- Langfuse: one trace per run with correctly nested steps, demo runs never traced, and tracing fully off without keys (using an in-memory exporter, so no account or network is needed)
- the API: a demo run, a review, rejection of live-mode injection, live mode without a key returning an error, the CSRF header requirement and the note length limit

The tests never call Anthropic, TypeSafe or Langfuse.

### Comparing live model results

With live mode configured, `compare.py` runs every scenario against the real model and prints, for each one, the expected decision, the demo sample's score, the live decision, the live score (pass/fail/review), Jev's decision, and the names of any failed checks. Add `--repeat 3` to see how consistent the model is across runs. A full JSON report is saved to `backend/reports/`.

```bash
cd backend
python compare.py --repeat 1
```

## Project layout

```
backend/
  main.py          FastAPI routes, CSRF guard, run orchestration (_execute)
  agents.py        Live Claude calls (agent + handoff summarizer)
  jev.py           Jev second opinion (TypeSafe) and rule mapping
  evaluator.py     Deterministic checks (pure functions)
  tracing.py       Optional Langfuse tracing (no-op when unconfigured)
  models.py        Pydantic schemas
  db.py            SQLite persistence (stdlib sqlite3)
  compare.py       CLI: live results for every scenario vs expected and Jev
  data/            policy.md, scenarios.json, demo_outputs.json
  tests/           pytest suite
frontend/
  src/App.tsx      Shell: header, page routing, skip link, footer
  src/Lab.tsx      Run a scenario: selector, run panel, results, history
  src/Pages.tsx    Why I built this, How it works, In practice
  src/Results.tsx  Results, Jev, checks, trace, human review panels
  src/Workflow.tsx Workflow status with WebGL detection and fallback
  src/Scene3D.tsx  React Three Fiber scene (lazy-loaded)
docs/
  ARCHITECTURE.md  Flowchart, design decisions, data flow, security model
```

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Whether live mode, Jev and Langfuse are configured, and which model |
| GET | `/api/policy` | Policy markdown |
| GET | `/api/scenarios` | Scenario definitions |
| POST | `/api/runs` | `{scenario_id, mode: "demo"\|"live", inject_failure}` runs a scenario |
| GET | `/api/runs` | Recent runs (summary) |
| GET | `/api/runs/{id}` | Full run |
| POST | `/api/runs/{id}/review` | `{status: "approved"\|"revision_requested", note}` (note max 2000 characters) |

All POST requests must include the header `X-Handoff-Lab: 1`. The frontend sends it; it stops other websites from triggering runs.

## Privacy and security

- Demo mode makes no network calls. Live mode sends the policy and scenario to Anthropic, the customer message to TypeSafe, and, if configured, prompts, outputs and scores to Langfuse.
- API keys live only in `.env` on the server and never reach the browser, the database or traces.
- Runs and reviewer notes stay in a local SQLite file until you delete it.
- Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#security-model).

## Next steps

- Multi-turn scenarios, where the escalation signal emerges partway through a conversation.
- More scenarios per rule, including adversarial ones: refund promises in unusual phrasing, or customers pressuring the agent.
- An optional LLM-as-judge pass for handoff completeness, clearly labelled as an AI-generated assessment and shown alongside, never instead of, the deterministic checks.
- Track agreement between reviewer decisions and check results to see where the checks are too strict or too lenient.
- Compare models and prompts on the same scenario set.
- Real conversation data **only** if obtained with permission and with proper privacy controls (consent, PII redaction, access limits, retention rules). Never scrape or reuse customer transcripts without authorization.
