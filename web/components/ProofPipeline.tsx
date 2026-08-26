'use client'

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import { proofRun, stages } from '@/lib/proof-run'

const STEP_MS = 1150

export function ProofPipeline() {
  const reduce = useReducedMotion()
  const [active, setActive] = useState(-1)
  const [running, setRunning] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const clear = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }

  useEffect(() => clear, [])

  const run = useCallback(() => {
    clear()
    setRunning(true)
    setActive(-1)

    stages.forEach((_, i) => {
      timers.current.push(
        setTimeout(() => {
          setActive(i)
          if (i === stages.length - 1) setRunning(false)
        }, (i + 1) * (reduce ? 120 : STEP_MS))
      )
    })
  }, [reduce])

  // Play once on arrival so the page is never a static screenshot.
  useEffect(() => {
    const t = setTimeout(run, 400)
    return () => clearTimeout(t)
  }, [run])

  return (
    <section className="relative">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-proof">
            Chain of custody
          </p>
          <h2 className="text-2xl font-medium tracking-tight sm:text-3xl">
            Nothing here is taken on trust
          </h2>
        </div>

        <button
          onClick={run}
          disabled={running}
          className="hairline rounded-full px-5 py-2.5 font-mono text-xs tracking-wide text-muted transition hover:text-white disabled:opacity-40"
        >
          {running ? 'running…' : 'replay'}
        </button>
      </header>

      <ol className="relative">
        {/* The spine the nodes hang off. */}
        <div className="absolute left-[15px] top-2 bottom-2 w-px bg-edge" aria-hidden />
        <motion.div
          className="absolute left-[15px] top-2 w-px origin-top bg-gradient-to-b from-proof via-proof to-credit"
          aria-hidden
          initial={{ scaleY: 0 }}
          animate={{ scaleY: active < 0 ? 0 : (active + 1) / stages.length }}
          transition={{ duration: reduce ? 0 : 0.6, ease: [0.22, 1, 0.36, 1] }}
          style={{ bottom: 8 }}
        />

        {stages.map((stage, i) => {
          const state = i < active ? 'done' : i === active ? 'live' : 'waiting'

          return (
            <li key={stage.key} className="relative pb-9 pl-12 last:pb-0">
              <Node state={state} reduce={!!reduce} last={i === stages.length - 1} />

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{
                  opacity: state === 'waiting' ? 0.35 : 1,
                  y: 0
                }}
                transition={{ duration: reduce ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="text-base font-medium tracking-tight">{stage.title}</h3>
                  <AnimatePresence>
                    {state === 'live' && (
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="font-mono text-[10px] uppercase tracking-[0.18em] text-proof"
                      >
                        verified
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>

                <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted">
                  {stage.detail}
                </p>

                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5">
                  {stage.facts.map(([label, value]) => (
                    <div key={label} className="font-mono text-xs">
                      <span className="text-muted/60">{label} </span>
                      <span className="tabular text-white/90">{value}</span>
                    </div>
                  ))}
                </div>

                {stage.key === 'proof' && (
                  <MerklePath active={state !== 'waiting'} reduce={!!reduce} />
                )}

                {stage.link && (
                  <a
                    href={stage.link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-block font-mono text-xs text-credit/80 underline-offset-4 transition hover:text-credit hover:underline"
                  >
                    {stage.link.label} ↗
                  </a>
                )}
              </motion.div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function Node({
  state,
  reduce,
  last
}: {
  state: 'done' | 'live' | 'waiting'
  reduce: boolean
  last: boolean
}) {
  const colour = last ? '#a78bfa' : '#5eead4'

  return (
    <span className="absolute left-0 top-1 grid h-8 w-8 place-items-center">
      <motion.span
        className="absolute h-8 w-8 rounded-full"
        animate={{
          backgroundColor: state === 'waiting' ? 'rgba(255,255,255,0.03)' : `${colour}1a`,
          scale: state === 'live' && !reduce ? [1, 1.18, 1] : 1
        }}
        transition={{ duration: reduce ? 0 : 0.7 }}
      />
      <motion.span
        className="relative block rounded-full"
        animate={{
          width: state === 'waiting' ? 6 : 9,
          height: state === 'waiting' ? 6 : 9,
          backgroundColor: state === 'waiting' ? '#3a3d4d' : colour
        }}
        transition={{ duration: reduce ? 0 : 0.35 }}
      />
    </span>
  )
}

/** Separate Merkle paths collapsing onto the one continuity proof they share. */
function MerklePath({ active, reduce }: { active: boolean; reduce: boolean }) {
  const roots = proofRun.batch.continuityRoots

  return (
    <div className="mt-4 flex items-center gap-1.5" aria-hidden>
      {Array.from({ length: roots }).map((_, i) => (
        <motion.span
          key={i}
          className="w-1.5 rounded-full bg-proof/70"
          initial={{ height: 6, opacity: 0.3 }}
          animate={active ? { height: 24, opacity: 1 } : { height: 6, opacity: 0.3 }}
          transition={{
            duration: reduce ? 0 : 0.4,
            delay: reduce ? 0 : i * 0.05,
            ease: [0.22, 1, 0.36, 1]
          }}
        />
      ))}
      <motion.span
        className="ml-2 font-mono text-[10px] text-muted"
        initial={{ opacity: 0 }}
        animate={{ opacity: active ? 1 : 0 }}
        transition={{ delay: reduce ? 0 : roots * 0.05 }}
      >
        {proofRun.batch.count} proofs, one continuity chain
      </motion.span>
    </div>
  )
}
