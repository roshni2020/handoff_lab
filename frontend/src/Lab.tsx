import { useEffect, useRef, useState } from 'react'
import { api, type Run, type RunListItem, type Scenario, type Stage } from './api'
import Workflow from './Workflow'
import type { NodeState, ReviewState } from './Scene3D'
import {
  Conversation, Decision, JevPanel, ErrorPanel, Evaluation, HandoffCard, Panel, ResultsSkeleton, ReviewPanel, Skeleton, SourceBanner, Trace,
} from './Results'

type States = Record<Stage, NodeState>
const IDLE: States = { customer: 'idle', agent: 'idle', policy: 'idle', human: 'idle' }
const ORDER: Stage[] = ['customer', 'agent', 'policy', 'human']
const SOURCE: Record<Run['source'], [string, string]> = {
  demo_sample: ['Demo', 'text-warn'], demo_injected_failure: ['Injected', 'text-bad'], live_model: ['Live', 'text-ok'],
}

function finalStates(r: Run): { states: States; caption: string } {
  if (r.status === 'error') return { states: { ...IDLE, customer: 'done', agent: 'fail' }, caption: 'The live model call failed. Error details are in the results.' }
  const failed = r.evaluation!.summary.fail > 0
  const human: NodeState = !r.handoff ? 'idle' : r.review_status === 'approved' ? 'done' : r.review_status ? 'fail' : 'active'
  const caption = !r.handoff
    ? `The agent kept the conversation. Policy checks ${failed ? 'found violations' : 'found no failures'}.`
    : r.review_status ? `The reviewer ${r.review_status === 'approved' ? 'approved the handoff' : 'asked for a revision'}.`
    : `Escalated. Policy checks ${failed ? 'found violations' : 'found no failures'}. Waiting for human review.`
  return { states: { customer: 'done', agent: 'done', policy: failed ? 'fail' : 'done', human }, caption }
}

const reviewState = (r: Run | null): ReviewState =>
  !r?.handoff ? 'none' : r.review_status === 'approved' ? 'approved' : r.review_status ? 'revision' : 'pending'

function PolicyText({ md }: { md: string }) {
  const lines = md.split('\n')
  const rules = lines.map(l => l.match(/^- \*\*(\w+)\*\*: (.*)/)).filter(Boolean) as RegExpMatchArray[]
  const reference = lines.filter(l => l.startsWith('- ') && !l.startsWith('- **')).map(l => l.slice(2))
  return (
    <div className="space-y-4 text-sm">
      <dl className="space-y-3">
        {rules.map(([, code, text]) => (
          <div key={code}>
            <dt className="font-mono text-xs text-accent">{code}</dt>
            <dd className="text-muted">{text}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-line pt-3">
        <p className="font-mono text-[11px] uppercase tracking-wider text-faint mb-1">Reference the agent may share</p>
        {reference.map(r => <p key={r} className="text-muted">{r}</p>)}
      </div>
    </div>
  )
}

export default function Lab() {
  const [health, setHealth] = useState<{ live_available: boolean; model: string | null } | null>(null)
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null)
  const [policy, setPolicy] = useState('')
  const [runs, setRuns] = useState<RunListItem[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<'demo' | 'live'>('demo')
  const [inject, setInject] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [states, setStates] = useState<States>(IDLE)
  const [caption, setCaption] = useState('Choose a scenario and run it to watch the conversation move through the workflow.')
  const playId = useRef(0)
  const resultsRef = useRef<HTMLDivElement>(null)

  const refreshRuns = () => api.runs().then(setRuns).catch(() => setRuns([]))
  useEffect(() => {
    Promise.all([api.health(), api.scenarios(), api.policy()])
      .then(([h, s, p]) => { setHealth(h); setScenarios(s); setPolicy(p.markdown); setSelected(s[0]?.id ?? null) })
      .catch(e => { setError(e.message); setScenarios([]) })
    refreshRuns()
  }, [])

  const show = (r: Run) => { const f = finalStates(r); setRun(r); setStates(f.states); setCaption(f.caption) }

  // Step through each stage so the 3D view reflects progress, then settle on the final state.
  async function playback(r: Run) {
    const id = ++playId.current
    const f = finalStates(r)
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const last = r.status === 'error' ? 1 : r.handoff ? 3 : 2
      for (let i = 2; i <= last; i++) {
        if (playId.current !== id) return
        setStates({ ...f.states, ...Object.fromEntries(ORDER.slice(i).map(s => [s, 'idle'])), [ORDER[i]]: 'active' } as States)
        setCaption(i === 2 ? 'Running deterministic policy checks.' : 'Routing the handoff to the human reviewer.')
        await new Promise(res => setTimeout(res, 900))
      }
    }
    if (playId.current === id) { setStates(f.states); setCaption(f.caption) }
  }

  async function start() {
    if (!selected) return
    playId.current++
    setError(null); setRunning(true); setRun(null)
    setStates({ ...IDLE, customer: 'done', agent: 'active' })
    setCaption(mode === 'live' ? `Calling ${health?.model} through the backend.` : 'Loading the prewritten demo response.')
    try {
      const r = await api.createRun(selected, mode, mode === 'demo' && inject)
      if (mode === 'demo') await new Promise(res => setTimeout(res, 600)) // let the agent stage register visually
      setRun(r)
      refreshRuns()
      await playback(r)
    } catch (e) {
      setError((e as Error).message); setStates(IDLE); setCaption('The run did not complete.')
    } finally {
      setRunning(false)
    }
  }

  async function reopen(id: string) {
    playId.current++
    setError(null)
    try { const r = await api.run(id); setSelected(r.scenario_id); show(r); resultsRef.current?.scrollIntoView({ behavior: 'smooth' }) }
    catch (e) { setError((e as Error).message) }
  }

  const scenario = scenarios?.find(s => s.id === (run?.scenario_id ?? selected))
  const liveOk = !!health?.live_available
  const checks = run?.evaluation?.checks.map(c => c.status) ?? []

  return (
    <main className="mx-auto max-w-7xl space-y-8 px-4 py-8">
      <section className="grid items-center gap-8 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-5">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Does the AI agent know when to hand off, and does the human get enough to continue?
          </h1>
          <p className="max-w-prose leading-relaxed text-muted">
            Handoff Lab runs a customer service AI agent against fictional scenarios. It checks the escalation decision
            and the handoff summary against a written policy, then lets a person approve the handoff or send it back.
          </p>
          <p className="text-sm text-faint">Every company, customer and account on this page is fictional.</p>
        </div>
        <div className="lg:col-span-7">
          <Workflow states={states} caption={caption} checks={states.policy === 'idle' ? [] : checks} review={reviewState(run)} />
        </div>
      </section>

      {error && <div role="alert" className="rounded-sm border border-bad/50 bg-panel px-4 py-3 text-sm text-bad">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <div id="scenarios" className="scroll-mt-4">
            <Panel label="01 Scenario">
              {!scenarios ? <Skeleton lines={6} /> : (
                <ul className="-my-1 divide-y divide-line">
                  {scenarios.map(s => (
                    <li key={s.id} className="py-1">
                      <button onClick={() => setSelected(s.id)} aria-pressed={selected === s.id}
                        className={`w-full rounded-sm px-2 py-2 text-left ${selected === s.id ? 'bg-raised' : 'hover:bg-raised/60'}`}>
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <span className={`size-1.5 shrink-0 ${selected === s.id ? 'bg-accent' : 'bg-transparent'}`} aria-hidden />
                          {s.title}
                        </span>
                        <span className="block pl-3.5 text-xs text-muted">{s.summary}</span>
                      </button>
                      <details className="pl-5.5 pb-1">
                        <summary className="cursor-pointer text-xs text-faint hover:text-muted">Expected outcome</summary>
                        <div className="mt-1 space-y-1 text-xs text-muted">
                          <p><span className="text-fg">{s.expected_escalation ? 'Escalate.' : 'No escalation.'}</span> {s.expected_reason}</p>
                          {s.required_facts.length > 0 && <p>Must include: {s.required_facts.map(f => f.label).join('; ')}</p>}
                          {s.unknowns.length > 0 && <p>Should flag as unknown: {s.unknowns.map(u => u.label).join('; ')}</p>}
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <Panel label="02 Run">
            <fieldset className="mb-4">
              <legend className="mb-1.5 text-xs text-muted">Mode</legend>
              <div className="grid grid-cols-2 border border-line text-sm">
                {(['demo', 'live'] as const).map(m => (
                  <button key={m} onClick={() => setMode(m)} disabled={m === 'live' && !liveOk} aria-pressed={mode === m}
                    className={`py-2 capitalize disabled:cursor-not-allowed disabled:text-faint ${mode === m ? 'bg-raised text-fg' : 'text-muted hover:text-fg'}`}>
                    {m}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-faint">
                {mode === 'demo' ? 'Prewritten sample outputs. No API call.' : `Calls ${health?.model} from the backend. The API key never reaches the browser.`}
                {!liveOk && ' Live mode needs ANTHROPIC_API_KEY and ANTHROPIC_MODEL on the server.'}
              </p>
            </fieldset>
            {mode === 'demo' && (
              <label className="mb-4 flex cursor-pointer items-start gap-2.5 text-sm">
                <input type="checkbox" checked={inject} onChange={e => setInject(e.target.checked)} className="mt-1 accent-[#e0605a]" />
                <span>Inject a sample failure<span className="block text-xs text-faint">Swaps in a labelled, predefined faulty agent response.</span></span>
              </label>
            )}
            <button onClick={start} disabled={running || !selected}
              className="w-full rounded-sm bg-accent-strong px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1d4fd0] disabled:opacity-50">
              {running ? (mode === 'live' ? 'Waiting for the model' : 'Running') : 'Run scenario'}
            </button>
          </Panel>

          <Panel label="Previous runs">
            {!runs ? <Skeleton lines={4} /> : runs.length === 0 ? <p className="text-sm text-faint">No runs yet.</p> : (
              <ul className="-mx-2 max-h-80 overflow-auto">
                {runs.map(r => (
                  <li key={r.id}>
                    <button onClick={() => reopen(r.id)}
                      className={`grid w-full grid-cols-[1fr_auto] gap-x-2 rounded-sm px-2 py-1.5 text-left text-xs ${run?.id === r.id ? 'bg-raised' : 'hover:bg-raised/60'}`}>
                      <span className="truncate text-fg">{scenarios?.find(s => s.id === r.scenario_id)?.title ?? r.scenario_id}</span>
                      <span className={`font-mono ${SOURCE[r.source][1]}`}>{SOURCE[r.source][0]}</span>
                      <span className="text-faint">
                        {new Date(r.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {r.review_status && ` · ${r.review_status === 'approved' ? 'approved' : 'revision'}`}
                      </span>
                      <span className="font-mono text-faint">
                        {r.summary ? `${r.summary.pass}/${r.summary.fail}/${r.summary.needs_review}` : r.status}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {runs && runs.length > 0 && <p className="mt-2 text-[11px] text-faint">Pass / fail / review</p>}
          </Panel>

          <div id="policy" className="scroll-mt-4">
            <Panel label="Evaluation criteria · Northstar policy">
              {policy ? <PolicyText md={policy} /> : <Skeleton lines={6} />}
            </Panel>
          </div>
        </div>

        <div ref={resultsRef} className="scroll-mt-4 space-y-4 lg:col-span-2">
          {running && !run ? <ResultsSkeleton /> : !run ? (
            <div className="rounded-sm border border-dashed border-line px-6 py-20 text-center text-sm text-faint">
              Results appear here after a run: the conversation, the escalation decision, the handoff, every check and a timestamped trace.
            </div>
          ) : (
            <>
              <SourceBanner run={run} />
              {scenario && <Conversation run={run} scenario={scenario} />}
              {run.status === 'error' && <ErrorPanel run={run} />}
              {run.agent && <Decision run={run} />}
              {run.jev && <JevPanel run={run} />}
              {run.handoff && <HandoffCard h={run.handoff} />}
              {run.handoff && <ReviewPanel run={run} onReviewed={r => { show(r); refreshRuns() }} />}
              {run.evaluation && <Evaluation run={run} />}
              <Trace run={run} />
            </>
          )}
        </div>
      </div>
    </main>
  )
}
