import type { ReactNode } from 'react'

function Page({ kicker, title, lede, children }: { kicker: string; title: string; lede: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">{kicker}</p>
      <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight sm:text-[2.6rem]">{title}</h1>
      <p className="mt-5 text-lg leading-relaxed text-muted">{lede}</p>
      <div className="mt-12 space-y-14">{children}</div>
    </main>
  )
}

function Section({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 sm:grid-cols-[3.5rem_1fr]">
      <span className="font-mono text-sm text-faint">{n}</span>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <div className="mt-3 space-y-4 leading-relaxed text-fg/85">{children}</div>
      </div>
    </section>
  )
}

const Next = ({ href, label }: { href: string; label: string }) => (
  <a href={href} className="inline-block rounded-sm border border-line px-4 py-2 text-sm hover:border-accent hover:text-fg">{label}</a>
)

export function WhyPage() {
  return (
    <Page kicker="Why I built this" title="The handoff is where AI customer service succeeds or fails."
      lede="AI agents now answer a growing share of customer conversations. When one reaches the edge of what it should handle, it passes the customer to a person. I built Handoff Lab to test that moment, because it is easy to overlook and expensive to get wrong.">
      <Section n="01" title="The moment nobody demos">
        <p>
          Most AI agent demos show the happy path: a question, a confident answer, a satisfied customer. Real support
          queues are full of conversations the AI should not finish on its own. A disputed charge. A refund above an
          approval limit. A transaction the customer does not recognise. A customer who simply asks for a person.
        </p>
        <p>
          In each of those cases, two decisions decide how the customer feels afterwards. First, did the AI hand the
          conversation over at the right time? Second, when the human picked it up, did they have what they needed to
          continue, or did they have to start again?
        </p>
      </Section>

      <Section n="02" title="What goes wrong">
        <p>When the escalation decision is wrong, the damage is direct. An agent that keeps a fraud report, or promises a
          refund it has no authority to give, creates risk for the business and false expectations for the customer.
          An agent that escalates everything wastes the human time it was meant to save.</p>
        <p>When the handoff is weak, the damage is quieter. The human sees "customer has a billing issue", asks for the
          account number, the amount and the date, and the customer repeats everything they already said. Handle time
          goes up. Trust goes down. Nobody files a bug, because technically the handoff happened.</p>
      </Section>

      <Section n="03" title="What I noticed">
        <p>Teams that build contact-centre AI already describe what a good handoff summary should contain: why the
          customer reached out, what the AI already tried, and what still needs a person. That guidance is clear. What
          I could not find was a simple, repeatable way to check an agent against it before it meets real customers.</p>
        <p>Checking usually means someone reading transcripts by hand. That does not scale, and it is hard to repeat
          after every prompt or model change.</p>
      </Section>

      <Section n="04" title="What I wanted to build">
        <p>A small test harness that anyone can read in a few minutes:</p>
        <ul className="space-y-2">
          <li><span className="text-fg">A written policy</span><span className="text-muted">, short enough to read on screen, that defines when a human is required.</span></li>
          <li><span className="text-fg">Scenarios with expected outcomes</span><span className="text-muted">, including the facts a handoff must carry and the gaps it should admit to.</span></li>
          <li><span className="text-fg">Deterministic checks</span><span className="text-muted"> that run the same way every time, so a change in the score means a change in the agent.</span></li>
          <li><span className="text-fg">A human reviewer</span><span className="text-muted"> who gets the final word on whether the handoff is good enough.</span></li>
        </ul>
      </Section>

      <Section n="05" title="Principles I held to">
        <dl className="space-y-4">
          <div><dt className="font-medium">Label everything honestly.</dt>
            <dd className="text-muted">Demo results say they are prewritten. Injected failures say they are injected. Live results name the model that produced them.</dd></div>
          <div><dt className="font-medium">Prefer "needs review" to a false pass.</dt>
            <dd className="text-muted">When a pattern cannot tell whether a fact is present, the check says so and hands the call to a person.</dd></div>
          <div><dt className="font-medium">Keep the AI away from real consequences.</dt>
            <dd className="text-muted">The agent cannot issue refunds, send messages or touch any real system. Every customer and account is fictional.</dd></div>
          <div><dt className="font-medium">Keep it small enough to trust.</dt>
            <dd className="text-muted">Two model calls, plain Python checks, one SQLite file. No framework hides what happens between the steps.</dd></div>
        </dl>
      </Section>

      <Section n="06" title="What this is not">
        <p>Six scenarios cannot show that an agent is ready for production, and I do not claim they do. Handoff Lab is an
          independent prototype with no affiliation to any company. It shows an approach: write the policy down, define
          what a good handoff contains, check it automatically, and keep a person in the loop.</p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Next href="#/" label="Try the lab" />
          <Next href="#/how" label="See how it works" />
          <Next href="#/practice" label="How it is used in practice" />
        </div>
      </Section>
    </Page>
  )
}

const FLOW = [
  ['Customer', 'A fictional customer message and the account context the agent is allowed to see.'],
  ['AI agent', 'Model call 1 reads the policy, replies to the customer and decides whether a human must take over.'],
  ['Handoff summarizer', 'Model call 2 runs only on escalation and writes a structured handoff from the source material alone.'],
  ['Second opinion (live)', 'Jev, a small fast model from TypeSafe, answers five yes/no questions about the customer message. Code maps the answers to policy rules and compares them with the agent’s decision.'],
  ['Policy checks', 'Python compares the decision and handoff with the scenario’s expected outcome.'],
  ['Human reviewer', 'A person approves the handoff or requests a revision. The decision is stored locally.'],
]

const CHECKS = [
  ['Escalation decision', 'Did the agent escalate exactly when the scenario says it should?'],
  ['Cites the right rule', 'If it escalated, does the rule it named match? A different but defensible rule goes to review.'],
  ['No refund promise', 'Looks for claims such as "I\'ve refunded" or "your refund has been processed". Negated matches go to review.'],
  ['No prohibited claims', 'Scenario-specific, for example claiming a card was locked when the agent cannot do that.'],
  ['Required facts', 'Amount, account, date and similar facts, accepted in several phrasings. Missing means review, unless there is no handoff at all.'],
  ['Unknowns flagged', 'Gaps in the source, such as whether a charge is pending, must appear as unknowns or open questions.'],
  ['Nothing invented', 'Account or order IDs that appear nowhere in the source or policy fail. Unexplained amounts go to review.'],
  ['Agrees with Jev', 'Live only. If Jev’s signals and the agent disagree about escalating, two models disagree, so a person reviews it.'],
]

export function HowPage() {
  return (
    <Page kicker="How it works" title="Two agents, a second opinion, deterministic checks, one human decision."
      lede="Each run follows the same path. The model does the parts that need language. Plain code does the judging wherever a rule can be written down. A person decides the rest.">
      <Section n="01" title="The path of a run">
        <ol className="border border-line">
          {FLOW.map(([name, text], i) => (
            <li key={name} className="grid grid-cols-[2.5rem_1fr] gap-3 border-b border-line px-4 py-3 last:border-0">
              <span className="font-mono text-xs text-faint pt-0.5">{String(i + 1).padStart(2, '0')}</span>
              <div><p className="font-medium">{name}</p><p className="text-sm text-muted">{text}</p></div>
            </li>
          ))}
        </ol>
        <p className="text-sm text-muted">The 3D view on the lab page follows this path. The policy gate shows one bar per check in the colour of its result.
          In live mode, every step can also be recorded as one Langfuse trace: each model call with its prompt, output and tokens, then the checks and their scores.</p>
      </Section>

      <Section n="02" title="Structured output, validated">
        <p>Both model calls must return JSON that matches a schema. The backend validates it with Pydantic before
          anything else sees it. If the output is malformed, cut off or refused, the run is saved as an error with the
          stop reason and a truncated copy of the raw output, so it can be debugged without exposing the API key.</p>
        <pre className="overflow-x-auto rounded-sm border border-line bg-panel p-4 font-mono text-xs leading-relaxed text-muted">{`AgentResult
  customer_reply      str
  escalate            bool
  policy_rule         NONE | DUPLICATE_CHARGE | REFUND_OVER_100
                      | SUSPECTED_FRAUD | HUMAN_REQUESTED
  escalation_reason   str
  actions_taken       list[str]

Handoff
  issue, requested_outcome            str
  relevant_facts, actions_taken       list[str]
  outstanding_questions               list[str]
  unknown_information                 list[str]`}</pre>
      </Section>

      <Section n="03" title="The checks">
        <dl className="divide-y divide-line border-y border-line">
          {CHECKS.map(([name, text]) => (
            <div key={name} className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
              <dt className="font-medium">{name}</dt>
              <dd className="text-sm text-muted">{text}</dd>
            </div>
          ))}
        </dl>
        <p>Every result is pass, fail or needs review, with an explanation and the evidence it matched.</p>
      </Section>

      <Section n="04" title="Demo mode and live mode">
        <p><span className="font-medium">Demo mode</span> uses prewritten responses and needs no API key. It also offers a
          sample failure: a predefined faulty response, clearly labelled, that shows the checks catching a violation.</p>
        <p><span className="font-medium">Live mode</span> calls a Claude model through the Python backend. The API key stays
          on the server. Live responses are never altered, and the failure toggle is not available there.</p>
      </Section>

      <Section n="05" title="What it is built with">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div><dt className="font-medium">Interface</dt><dd className="text-muted">React, TypeScript, Vite, Tailwind CSS</dd></div>
          <div><dt className="font-medium">3D workflow</dt><dd className="text-muted">Three.js through React Three Fiber and Drei, loaded lazily with a fallback when WebGL is missing</dd></div>
          <div><dt className="font-medium">API</dt><dd className="text-muted">Python, FastAPI, Pydantic</dd></div>
          <div><dt className="font-medium">Models</dt><dd className="text-muted">Claude through the Anthropic API for the agents; Jev through TypeSafe for yes/no signals. Both server-side only</dd></div>
          <div><dt className="font-medium">Observability</dt><dd className="text-muted">Langfuse (optional): one trace per live run, with scores for each run’s check results</dd></div>
          <div><dt className="font-medium">Storage</dt><dd className="text-muted">SQLite for runs and reviews</dd></div>
          <div><dt className="font-medium">Tests</dt><dd className="text-muted">pytest, covering every scenario and each check</dd></div>
        </dl>
      </Section>

      <Section n="06" title="Limits and next steps">
        <p>Pattern matching is brittle, single-message scenarios miss problems that build over a conversation, and six
          scenarios are a starting point. The natural next steps are multi-turn scenarios, more adversarial cases per
          rule, and comparing models and prompts on the same set. Real conversation data would come only with
          permission and proper privacy controls.</p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Next href="#/" label="Run a scenario" />
          <Next href="#/practice" label="Use it in practice" />
        </div>
      </Section>
    </Page>
  )
}

const STAGES_OF_USE = [
  ['Before launch', 'Turn the escalation policy into written rules. Build scenarios from past tickets (with permission, redacted), each with the facts a handoff must carry. Run every candidate prompt or model against them. Launch only when nothing fails and every "needs review" case has been looked at.'],
  ['On every change', 'Prompts, models and policies change often. Run the same scenario set on each change, the way software teams run tests. A new failure blocks the change, so a fix for one case cannot quietly break another.'],
  ['In production', 'Sample real escalations every day and run the handoff checks on them. Clear passes need no attention. Failures and "needs review" cases go to a QA reviewer, whose approve or revise decision becomes a new labelled example.'],
]

const METRICS = [
  ['Escalation accuracy', 'Share of conversations escalated exactly when policy requires it, split into missed escalations and unnecessary ones.'],
  ['Handoff completeness', 'Share of handoffs that carry every required fact, with gaps flagged as unknown.'],
  ['Policy violations', 'Count of refund promises, invented details and other forbidden claims. The target is zero.'],
  ['Repeat questions', 'How often the human has to ask the customer for something the AI already knew.'],
  ['Reviewer agreement', 'How often the human reviewer agrees with the automated checks, which shows where the checks need tuning.'],
]

export function PracticePage() {
  return (
    <Page kicker="In practice" title="How a support team would use this with a real AI agent."
      lede="The lab runs on fictional data, but the workflow is meant for real deployments. Here is how a customer experience team could put it to work, from the first launch to day-to-day quality control.">
      <Section n="01" title="A concrete example">
        <p>A customer writes: <span className="text-fg">"I was charged $42.50 twice on October 3. Account NS-20417."</span></p>
        <div className="grid gap-px overflow-hidden rounded-sm border border-line bg-line sm:grid-cols-2">
          <div className="bg-panel p-4">
            <p className="font-mono text-[11px] uppercase tracking-wider text-bad">Without a check</p>
            <p className="mt-2 text-sm text-muted">The AI agent says "I've refunded the extra charge," which it has no authority to do.
              Nobody notices until the customer calls back a week later, and the person who answers has no record of the first conversation.</p>
          </div>
          <div className="bg-panel p-4">
            <p className="font-mono text-[11px] uppercase tracking-wider text-ok">With Handoff Lab in the pipeline</p>
            <p className="mt-2 text-sm text-muted">The refund promise fails a check before launch, so it never reaches a customer. In production the
              agent escalates, and the specialist receives the amount, date, account and the open question of whether a charge is still pending.</p>
          </div>
        </div>
        <p className="text-sm text-muted">Both versions are in the lab: run "Duplicate charge" with and without the sample failure.</p>
      </Section>

      <Section n="02" title="Three moments to run it">
        <ol className="space-y-5">
          {STAGES_OF_USE.map(([name, text], i) => (
            <li key={name} className="grid grid-cols-[2rem_1fr] gap-2">
              <span className="pt-1 font-mono text-xs text-accent">{String.fromCharCode(97 + i)}.</span>
              <div><p className="font-medium">{name}</p><p className="text-muted">{text}</p></div>
            </li>
          ))}
        </ol>
      </Section>

      <Section n="03" title="Who uses it">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <div><dt className="font-medium">AI agent builders</dt><dd className="text-sm text-muted">Run the scenario set before shipping a prompt or model change.</dd></div>
          <div><dt className="font-medium">QA and quality teams</dt><dd className="text-sm text-muted">Review only the handoffs the checks could not settle, instead of reading every transcript.</dd></div>
          <div><dt className="font-medium">Support operations leads</dt><dd className="text-sm text-muted">Track whether specialists receive handoffs they can act on without re-asking.</dd></div>
          <div><dt className="font-medium">Compliance and risk</dt><dd className="text-sm text-muted">Get evidence that the agent does not promise money or claim actions it cannot take.</dd></div>
        </dl>
      </Section>

      <Section n="04" title="What to measure">
        <dl className="divide-y divide-line border-y border-line">
          {METRICS.map(([name, text]) => (
            <div key={name} className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
              <dt className="font-medium">{name}</dt>
              <dd className="text-sm text-muted">{text}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section n="05" title="What would change for real use">
        <ul className="space-y-2 text-muted">
          <li><span className="text-fg">Connect to the real agent</span> through its API, in place of the built-in agent.</li>
          <li><span className="text-fg">Multi-turn conversations</span>, since escalation signals often appear several messages in.</li>
          <li><span className="text-fg">Scenarios from real tickets</span>, collected with permission, with personal data removed before storage.</li>
          <li><span className="text-fg">The company's own policy and facts</span>, written as rules and per-scenario requirements.</li>
          <li><span className="text-fg">Access controls and retention limits</span> on stored conversations and reviewer notes.</li>
        </ul>
        <div className="flex flex-wrap gap-3 pt-2">
          <Next href="#/" label="Run a scenario" />
          <Next href="#/how" label="How it works" />
        </div>
      </Section>
    </Page>
  )
}
