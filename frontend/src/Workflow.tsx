import { Component, lazy, Suspense, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import type { CheckStatus, Stage } from './api'
import type { NodeState, ReviewState } from './Scene3D'

const Scene3D = lazy(() => import('./Scene3D'))

const STEPS: { stage: Stage; name: string; what: string }[] = [
  { stage: 'customer', name: 'Customer', what: 'Message received' },
  { stage: 'agent', name: 'AI agent', what: 'Replies and decides' },
  { stage: 'policy', name: 'Policy checks', what: 'One bar per check' },
  { stage: 'human', name: 'Human reviewer', what: 'Approves or revises' },
]
const STATE_TEXT: Record<NodeState, string> = { idle: 'Waiting', active: 'In progress', done: 'Done', fail: 'Issue found' }
const STATE_DOT: Record<NodeState, string> = { idle: 'bg-faint', active: 'bg-accent', done: 'bg-ok', fail: 'bg-bad' }

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <SceneFallback reason="The 3D view failed to load." /> : this.props.children }
}

function SceneFallback({ reason }: { reason: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-sm text-faint">
      {reason} The step status below is still accurate.
    </div>
  )
}

function hasWebGL() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
const useReducedMotion = () => useSyncExternalStore(
  cb => { motionQuery.addEventListener('change', cb); return () => motionQuery.removeEventListener('change', cb) },
  () => motionQuery.matches,
)

export default function Workflow({ states, caption, checks, review }: {
  states: Record<Stage, NodeState>; caption: string; checks: CheckStatus[]; review: ReviewState
}) {
  const webgl = useMemo(hasWebGL, [])
  const reduced = useReducedMotion()
  return (
    <figure className="rounded-sm border border-line bg-panel">
      <div className="h-56 sm:h-72 border-b border-line">
        {webgl ? (
          <SceneBoundary>
            <Suspense fallback={<div className="h-full animate-pulse bg-raised" aria-label="Loading 3D view" />}>
              <Scene3D states={states} checks={checks} review={review} reduced={reduced} />
            </Suspense>
          </SceneBoundary>
        ) : <SceneFallback reason="WebGL is not available in this browser." />}
      </div>
      <ol className="grid grid-cols-2 sm:grid-cols-4 divide-line border-b border-line sm:divide-x">
        {STEPS.map(({ stage, name, what }, i) => (
          <li key={stage} className="px-4 py-3 border-line max-sm:odd:border-r max-sm:[&:nth-child(-n+2)]:border-b">
            <div className="font-mono text-[11px] text-faint">0{i + 1}</div>
            <div className="text-sm font-medium">{name}</div>
            <div className="text-xs text-faint">{what}</div>
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
              <span className={`size-1.5 ${STATE_DOT[states[stage]]}`} aria-hidden /> {STATE_TEXT[states[stage]]}
            </div>
          </li>
        ))}
      </ol>
      <figcaption className="px-4 py-2.5 text-xs text-muted" aria-live="polite">{caption}</figcaption>
    </figure>
  )
}
