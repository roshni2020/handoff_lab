export type Stage = 'customer' | 'agent' | 'policy' | 'human'
export type CheckStatus = 'pass' | 'fail' | 'needs_review'

export interface Scenario {
  id: string
  title: string
  summary: string
  customer_message: string
  account_context: string
  expected_escalation: boolean
  expected_reason: string
  accepted_rules: string[]
  required_facts: { label: string; where: string }[]
  prohibited_claims: { label: string }[]
  unknowns: { label: string }[]
}

export interface AgentResult {
  customer_reply: string
  escalate: boolean
  policy_rule: string
  escalation_reason: string
  actions_taken: string[]
}

export interface Handoff {
  issue: string
  relevant_facts: string[]
  requested_outcome: string
  actions_taken: string[]
  outstanding_questions: string[]
  unknown_information: string[]
}

export interface Check { name: string; status: CheckStatus; explanation: string; evidence: string | null }
export type Summary = Record<CheckStatus, number>
export interface TraceEntry { at: string; stage: Stage; label: string; detail: string }

export interface JevResult {
  model: string | null
  signals: { id: string; label: string; probability: number }[]
  rules: string[]
  escalate: boolean
}

export interface Run {
  id: string
  scenario_id: string
  mode: 'demo' | 'live'
  source: 'demo_sample' | 'demo_injected_failure' | 'live_model'
  model: string | null
  status: 'completed' | 'error'
  error: string | null
  agent: AgentResult | null
  handoff: Handoff | null
  evaluation: { summary: Summary; checks: Check[] } | null
  trace: TraceEntry[]
  debug: Record<string, unknown> | null
  jev: JevResult | null
  started_at: string
  completed_at: string | null
  review_status: 'approved' | 'revision_requested' | null
  review_note: string | null
  reviewed_at: string | null
}

export interface RunListItem {
  id: string
  scenario_id: string
  mode: string
  source: Run['source']
  status: string
  started_at: string
  review_status: string | null
  summary: Summary | null
}

export interface Health { live_available: boolean; model: string | null; jev_available: boolean; tracing_enabled: boolean }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, { headers: { 'Content-Type': 'application/json', 'X-Handoff-Lab': '1' }, ...init })
  } catch {
    throw new Error('Cannot reach the Handoff Lab backend. Is it running on port 8010?')
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.detail ? String(body.detail) : `Request failed (${res.status})`)
  return body as T
}

export const api = {
  health: () => req<Health>('/api/health'),
  policy: () => req<{ markdown: string }>('/api/policy'),
  scenarios: () => req<Scenario[]>('/api/scenarios'),
  runs: () => req<RunListItem[]>('/api/runs'),
  run: (id: string) => req<Run>(`/api/runs/${id}`),
  createRun: (scenario_id: string, mode: 'demo' | 'live', inject_failure: boolean) =>
    req<Run>('/api/runs', { method: 'POST', body: JSON.stringify({ scenario_id, mode, inject_failure }) }),
  review: (id: string, status: 'approved' | 'revision_requested', note: string) =>
    req<Run>(`/api/runs/${id}/review`, { method: 'POST', body: JSON.stringify({ status, note }) }),
}
