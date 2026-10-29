import { useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import { CatmullRomCurve3, Vector3, type Group, type Mesh, type MeshStandardMaterial, type PerspectiveCamera } from 'three'
import type { CheckStatus, Stage } from './api'

export type NodeState = 'idle' | 'active' | 'done' | 'fail'
export type ReviewState = 'none' | 'pending' | 'approved' | 'revision'
export const STAGES: Stage[] = ['customer', 'agent', 'policy', 'human']

const STATION = [new Vector3(-4.5, 0, 0.7), new Vector3(-1.5, 0, -0.5), new Vector3(1.5, 0, -0.5), new Vector3(4.5, 0, 0.7)]
const TRACK = new CatmullRomCurve3(STATION)
const C = { idle: '#3a465c', active: '#4c8dff', done: '#34b3a0', fail: '#e0605a', warn: '#d9a441', dim: '#232c3b' }
const CHECK_COLOR: Record<CheckStatus, string> = { pass: C.done, fail: C.fail, needs_review: C.warn }
const stateColor = (s: NodeState) => C[s]

function Material({ color, glow = 0 }: { color: string; glow?: number }) {
  return <meshStandardMaterial color={color} emissive={color} emissiveIntensity={glow} roughness={0.55} metalness={0.1} />
}

function Footprint() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
      <circleGeometry args={[0.85, 48]} />
      <meshBasicMaterial color="#000" transparent opacity={0.35} />
    </mesh>
  )
}

/** The customer's message: a short stack of slabs. */
function Customer({ state }: { state: NodeState }) {
  const color = stateColor(state)
  return (
    <group position={STATION[0]}>
      <Footprint />
      {[0, 1, 2].map(i => (
        <mesh key={i} position={[i * 0.06 - 0.06, 0.08 + i * 0.13, -i * 0.05]} rotation={[0, 0.25, 0]}>
          <boxGeometry args={[0.9, 0.07, 0.6]} />
          <Material color={i === 2 ? color : C.idle} glow={i === 2 && state !== 'idle' ? 0.25 : 0} />
        </mesh>
      ))}
    </group>
  )
}

/** The AI agent: two counter-rotating rings the conversation passes through. */
function Agent({ state, reduced }: { state: NodeState; reduced: boolean }) {
  const outer = useRef<Mesh>(null)
  const inner = useRef<Mesh>(null)
  useFrame((_, dt) => {
    if (reduced || state !== 'active') return
    outer.current!.rotation.z += dt * 1.2
    inner.current!.rotation.z -= dt * 1.8
  })
  const color = stateColor(state)
  return (
    <group position={STATION[1]}>
      <Footprint />
      <group position={[0, 0.62, 0]} rotation={[0, Math.PI / 2 - 0.35, 0]}>
        <mesh ref={outer}><torusGeometry args={[0.55, 0.05, 12, 6]} /><Material color={color} glow={state === 'active' ? 0.6 : 0.15} /></mesh>
        <mesh ref={inner}><torusGeometry args={[0.36, 0.035, 12, 6]} /><Material color={state === 'idle' ? C.idle : '#9fb8e8'} glow={0.1} /></mesh>
      </group>
    </group>
  )
}

/** Policy checks: one bar per deterministic check, coloured by its result. */
function Policy({ state, checks, reduced }: { state: NodeState; checks: CheckStatus[]; reduced: boolean }) {
  const bars = Math.max(checks.length, 6)
  const group = useRef<Group>(null)
  const revealed = useRef(0)
  useFrame((_, dt) => {
    if (!group.current) return
    // While checks run, bars light one by one; afterwards all show their result.
    revealed.current = state === 'active' && !reduced ? (revealed.current + dt * 9) % (bars + 3) : bars
    group.current.children.forEach((bar, i) => {
      const m = (bar as Mesh).material as MeshStandardMaterial
      m.emissiveIntensity = state === 'active' ? (i < revealed.current ? 0.7 : 0.05) : state === 'idle' ? 0 : 0.3
    })
  })
  const spacing = 0.17
  return (
    <group position={STATION[2]}>
      <Footprint />
      <group ref={group} rotation={[0, 0.15, 0]}>
        {Array.from({ length: bars }, (_, i) => {
          const status = checks[i]
          const color = state === 'done' || state === 'fail' ? (status ? CHECK_COLOR[status] : C.dim) : state === 'active' ? C.active : C.idle
          return (
            <mesh key={i} position={[(i - (bars - 1) / 2) * spacing, 0.5, 0]}>
              <boxGeometry args={[0.08, 1, 0.08]} />
              <Material color={color} />
            </mesh>
          )
        })}
      </group>
    </group>
  )
}

/** Human reviewer: a desk that waits, then shows the review decision. */
function Human({ state, review, reduced }: { state: NodeState; review: ReviewState; reduced: boolean }) {
  const screen = useRef<Mesh>(null)
  const color = review === 'approved' ? C.done : review === 'revision' ? C.warn : state === 'active' ? C.active : C.idle
  useFrame(({ clock }) => {
    const m = screen.current?.material as MeshStandardMaterial | undefined
    if (m) m.emissiveIntensity = review === 'pending' && !reduced ? 0.35 + Math.sin(clock.elapsedTime * 3) * 0.25 : review === 'none' ? 0 : 0.35
  })
  return (
    <group position={STATION[3]} rotation={[0, -0.4, 0]}>
      <Footprint />
      <mesh position={[0, 0.06, 0]}><cylinderGeometry args={[0.6, 0.65, 0.12, 6]} /><Material color={C.idle} /></mesh>
      <mesh ref={screen} position={[0, 0.5, -0.1]} rotation={[-0.15, 0, 0]}>
        <boxGeometry args={[0.8, 0.5, 0.05]} />
        <Material color={color} />
      </mesh>
    </group>
  )
}

/** The conversation itself, travelling along the track to the furthest stage reached. */
function Token({ target, reduced }: { target: number; reduced: boolean }) {
  const ref = useRef<Mesh>(null)
  const t = useRef(target)
  useFrame((_, dt) => {
    t.current = reduced ? target : t.current + (target - t.current) * Math.min(1, dt * 3)
    const p = TRACK.getPoint(t.current)
    ref.current?.position.set(p.x, 1.2, p.z)
    if (ref.current && !reduced) ref.current.rotation.y += dt
  })
  return <mesh ref={ref}><octahedronGeometry args={[0.13]} /><meshBasicMaterial color="#e6e9ef" /></mesh>
}

// Keep the whole track in frame at any aspect ratio, viewed from slightly above.
function FitCamera() {
  const camera = useThree(s => s.camera) as PerspectiveCamera
  const aspect = useThree(s => s.size.width / s.size.height)
  const invalidate = useThree(s => s.invalidate)
  useLayoutEffect(() => {
    const t = Math.tan((camera.fov * Math.PI) / 360)
    const dist = Math.max(7.2 / t / aspect, 2.2 / t)
    camera.position.copy(new Vector3(0, 0.45, 1).normalize().multiplyScalar(dist))
    camera.lookAt(0, 0.45, 0)
    invalidate()
  }, [camera, aspect, invalidate])
  return null
}

export default function Scene3D({ states, checks, review, reduced }: {
  states: Record<Stage, NodeState>; checks: CheckStatus[]; review: ReviewState; reduced: boolean
}) {
  const reached = STAGES.reduce((acc, s, i) => (states[s] !== 'idle' ? i : acc), 0)
  const trackPts = useMemo(() => TRACK.getPoints(120), [])
  const donePts = useMemo(() => TRACK.getPoints(120).slice(0, Math.round((reached / 3) * 120) + 1), [reached])
  return (
    <Canvas dpr={[1, 1.5]} camera={{ fov: 35 }} frameloop={reduced ? 'demand' : 'always'} aria-hidden="true">
      <FitCamera />
      <ambientLight intensity={0.55} />
      <directionalLight position={[-3, 6, 4]} intensity={1.6} />
      <Line points={trackPts} color={C.dim} lineWidth={1.5} />
      {reached > 0 && <Line points={donePts} color={states.agent === 'fail' ? C.fail : C.done} lineWidth={2} />}
      <Customer state={states.customer} />
      <Agent state={states.agent} reduced={reduced} />
      <Policy state={states.policy} checks={checks} reduced={reduced} />
      <Human state={states.human} review={review} reduced={reduced} />
      {states.customer !== 'idle' && <Token target={reached / 3} reduced={reduced} />}
    </Canvas>
  )
}
