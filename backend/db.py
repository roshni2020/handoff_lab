import json
import os
import sqlite3
from pathlib import Path

DB_PATH = Path(os.getenv("HANDOFF_DB", Path(__file__).parent / "handoff_lab.db"))
JSON_COLS = ("agent", "handoff", "evaluation", "trace", "debug", "jev")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, scenario_id TEXT NOT NULL, mode TEXT NOT NULL, source TEXT NOT NULL,
        model TEXT, status TEXT NOT NULL, error TEXT,
        agent TEXT, handoff TEXT, evaluation TEXT, trace TEXT, debug TEXT,
        started_at TEXT NOT NULL, completed_at TEXT,
        review_status TEXT, review_note TEXT, reviewed_at TEXT, jev TEXT)""")
    if "jev" not in {r[1] for r in conn.execute("PRAGMA table_info(runs)")}:
        conn.execute("ALTER TABLE runs ADD COLUMN jev TEXT")  # databases created before Jev was added
    return conn


def _row(r: sqlite3.Row) -> dict:
    d = dict(r)
    for c in JSON_COLS:
        d[c] = json.loads(d[c]) if d[c] else None
    return d


def save_run(run: dict) -> None:
    row = {k: (json.dumps(v) if k in JSON_COLS and v is not None else v) for k, v in run.items()}
    with connect() as c:
        c.execute(f"INSERT INTO runs ({', '.join(row)}) VALUES ({', '.join('?' * len(row))})", list(row.values()))


def get_run(run_id: str) -> dict | None:
    with connect() as c:
        r = c.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
    return _row(r) if r else None


def list_runs(limit: int = 20) -> list[dict]:
    with connect() as c:
        rows = c.execute("SELECT id, scenario_id, mode, source, status, evaluation, started_at, review_status "
                         "FROM runs ORDER BY started_at DESC LIMIT ?", (limit,)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["summary"] = json.loads(d.pop("evaluation"))["summary"] if r["evaluation"] else None
        out.append(d)
    return out


def save_review(run_id: str, status: str, note: str | None, at: str) -> None:
    with connect() as c:
        c.execute("UPDATE runs SET review_status = ?, review_note = ?, reviewed_at = ? WHERE id = ?",
                  (status, note, at, run_id))
