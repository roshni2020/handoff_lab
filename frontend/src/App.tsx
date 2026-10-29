import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { api, type Health } from './api'
import Lab from './Lab'
import { HowPage, PracticePage, WhyPage } from './Pages'

const PAGES = [
  { hash: '#/', label: 'Run a scenario' },
  { hash: '#/why', label: 'Why I built this' },
  { hash: '#/how', label: 'How it works' },
  { hash: '#/practice', label: 'In practice' },
]

const useHash = () => useSyncExternalStore(
  cb => { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb) },
  () => window.location.hash || '#/',
)

export default function App() {
  const hash = useHash()
  const route = PAGES.some(p => p.hash === hash) ? hash : '#/'
  const [health, setHealth] = useState<Health | null>(null)
  const content = useRef<HTMLDivElement>(null)
  const firstRoute = useRef(true)
  useEffect(() => { api.health().then(setHealth).catch(() => {}) }, [])
  useEffect(() => {
    window.scrollTo(0, 0)
    // Move focus to the new page so screen readers announce it (not on first load).
    if (firstRoute.current) firstRoute.current = false
    else content.current?.focus({ preventScroll: true })
  }, [route])

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-ink">
        <a href="#/" onClick={e => { e.preventDefault(); content.current?.focus() }}
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-10 focus:rounded-sm focus:bg-accent-strong focus:px-3 focus:py-2 focus:text-sm focus:text-white">
          Skip to content
        </a>
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <a href="#/" className="font-mono text-sm font-medium uppercase tracking-[0.18em]">Handoff Lab</a>
          <span className="text-xs text-faint">Independent prototype</span>
          <nav className="flex flex-wrap gap-x-5 gap-y-1 text-sm max-sm:order-last max-sm:w-full">
            {PAGES.map(p => (
              <a key={p.hash} href={p.hash} aria-current={route === p.hash ? 'page' : undefined}
                className={route === p.hash ? 'text-fg underline decoration-accent decoration-2 underline-offset-[6px]' : 'text-muted hover:text-fg'}>
                {p.label}
              </a>
            ))}
          </nav>
          <span className="ml-auto flex items-center gap-2 font-mono text-xs text-muted">
            <span className={`size-1.5 ${health === null ? 'bg-faint' : health.live_available ? 'bg-ok' : 'bg-warn'}`} aria-hidden />
            {health === null ? 'Connecting' : health.live_available ? `Live available · ${health.model}` : 'Demo mode only'}
            {health?.jev_available && ' · Jev'}
            {health?.tracing_enabled && ' · Langfuse'}
          </span>
        </div>
      </header>

      {/* Lab stays mounted so a run in progress survives a visit to the other pages. */}
      <div ref={content} tabIndex={-1} className="outline-none">
        <div hidden={route !== '#/'}><Lab /></div>
        {route === '#/why' && <WhyPage />}
        {route === '#/how' && <HowPage />}
        {route === '#/practice' && <PracticePage />}
      </div>

      <footer className="mt-auto border-t border-line">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 text-xs leading-relaxed text-faint sm:grid-cols-3">
          <div>
            <p className="mb-1 font-mono uppercase tracking-wider text-muted">Handoff Lab</p>
            An independent prototype. Not affiliated with or endorsed by any company.
          </div>
          <div id="privacy">
            <p className="mb-1 font-mono uppercase tracking-wider text-muted">Privacy</p>
            All scenarios are fictional. Runs and reviewer notes are kept in a local SQLite file on the machine running the
            backend until you delete it. There is no analytics. Demo mode makes no network calls. Live mode sends the
            policy and scenario to the Anthropic API and the customer message to TypeSafe (Jev). If Langfuse is configured,
            live prompts, outputs and check results are also sent there for tracing.
          </div>
          <div id="terms">
            <p className="mb-1 font-mono uppercase tracking-wider text-muted">Terms</p>
            Provided as-is for demonstration. Outputs are not advice. The agent cannot issue refunds, send messages or reach
            any real system, and review actions only update the local database.
          </div>
        </div>
      </footer>
    </div>
  )
}
