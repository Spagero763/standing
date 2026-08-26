'use client'

import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { formatUnits } from 'viem'
import {
  useAccount,
  useConnect,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract
} from 'wagmi'
import { addresses, creditcoin, lineAbi, registryAbi } from '@/lib/contracts'

const DECIMALS = 6

function amount(v?: bigint) {
  if (v === undefined) return 'n/a'
  return Number(formatUnits(v, DECIMALS)).toLocaleString(undefined, {
    maximumFractionDigits: 4
  })
}

export function LiveStanding() {
  const { address, isConnected, chainId } = useAccount()
  const { connect, connectors, isPending: connecting } = useConnect()
  const { switchChain } = useSwitchChain()

  const wrongChain = isConnected && chainId !== creditcoin.id
  const target = address ?? '0x0000000000000000000000000000000000000000'

  const common = { chainId: creditcoin.id, query: { enabled: isConnected } } as const

  const { data: score, refetch: refetchScore } = useReadContract({
    address: addresses.registry as `0x${string}`,
    abi: registryAbi,
    functionName: 'scoreOf',
    args: [target],
    ...common
  })

  const { data: standing } = useReadContract({
    address: addresses.registry as `0x${string}`,
    abi: registryAbi,
    functionName: 'standingOf',
    args: [target],
    ...common
  })

  const { data: limit, refetch: refetchLimit } = useReadContract({
    address: addresses.line as `0x${string}`,
    abi: lineAbi,
    functionName: 'limitOf',
    args: [target],
    ...common
  })

  const { data: owed, refetch: refetchOwed } = useReadContract({
    address: addresses.line as `0x${string}`,
    abi: lineAbi,
    functionName: 'owedBy',
    args: [target],
    ...common
  })

  const { data: liquidity } = useReadContract({
    address: addresses.line as `0x${string}`,
    abi: lineAbi,
    functionName: 'available',
    chainId: creditcoin.id
  })

  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: mining, isSuccess } = useWaitForTransactionReceipt({ hash })

  useEffect(() => {
    if (!isSuccess) return
    refetchScore()
    refetchLimit()
    refetchOwed()
  }, [isSuccess, refetchScore, refetchLimit, refetchOwed])

  const headroom =
    limit !== undefined && owed !== undefined ? (limit > owed ? limit - owed : 0n) : undefined

  if (!isConnected) {
    return (
      <Panel>
        <p className="text-sm text-muted">
          Connect a wallet to read your standing straight off Creditcoin testnet.
        </p>
        <button
          onClick={() => connect({ connector: connectors[0] })}
          disabled={connecting || connectors.length === 0}
          className="mt-5 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-ink transition hover:bg-white/90 disabled:opacity-40"
        >
          {connecting ? 'connecting…' : 'Connect wallet'}
        </button>
        {connectors.length === 0 && (
          <p className="mt-3 font-mono text-xs text-warn">No injected wallet detected.</p>
        )}
      </Panel>
    )
  }

  if (wrongChain) {
    return (
      <Panel>
        <p className="text-sm text-muted">This lives on Creditcoin testnet.</p>
        <button
          onClick={() => switchChain({ chainId: creditcoin.id })}
          className="mt-5 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-ink transition hover:bg-white/90"
        >
          Switch network
        </button>
      </Panel>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <Panel accent="proof">
        <Label>Proven standing</Label>
        <Dial score={Number(score ?? 0n)} />

        <dl className="mt-6 space-y-2.5">
          <Row label="repayments proven" value={String(standing?.repayments ?? 0n)} />
          <Row label="markets" value={String(standing?.markets ?? 0n)} />
          <Row label="total repaid" value={amount(standing?.totalRepaid)} />
        </dl>
      </Panel>

      <Panel accent="credit">
        <Label>Credit line</Label>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <Big label="available to draw" value={amount(headroom)} />
          <Big label="currently owed" value={amount(owed)} />
        </div>

        <dl className="mt-5 space-y-2.5">
          <Row label="limit" value={amount(limit)} />
          <Row label="pool liquidity" value={amount(liquidity as bigint | undefined)} />
          <Row label="collateral required" value="none" />
        </dl>

        <div className="mt-6 flex flex-wrap gap-2.5">
          <button
            onClick={() =>
              writeContract({
                address: addresses.line as `0x${string}`,
                abi: lineAbi,
                functionName: 'draw',
                args: [headroom ?? 0n],
                chainId: creditcoin.id
              })
            }
            disabled={!headroom || headroom === 0n || isPending || mining}
            className="rounded-full bg-credit px-5 py-2.5 text-sm font-medium text-ink transition hover:opacity-90 disabled:opacity-30"
          >
            {isPending || mining ? 'drawing…' : 'Draw full line'}
          </button>

          <a
            href={`${creditcoin.explorer}/address/${addresses.line}`}
            target="_blank"
            rel="noreferrer"
            className="hairline rounded-full px-5 py-2.5 font-mono text-xs text-muted transition hover:text-white"
          >
            contract ↗
          </a>
        </div>

        {error && (
          <p className="mt-3 max-w-md font-mono text-xs leading-relaxed text-warn">
            {error.message.split('\n')[0]}
          </p>
        )}
        {hash && (
          <a
            href={`${creditcoin.explorer}/tx/${hash}`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 block font-mono text-xs text-proof underline-offset-4 hover:underline"
          >
            {isSuccess ? 'confirmed' : 'pending'} · {hash.slice(0, 14)}… ↗
          </a>
        )}
      </Panel>
    </div>
  )
}

function Panel({
  children,
  accent
}: {
  children: React.ReactNode
  accent?: 'proof' | 'credit'
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={`hairline rounded-2xl bg-surface/70 p-6 backdrop-blur ${
        accent === 'proof' ? 'glow-proof' : accent === 'credit' ? 'glow-credit' : ''
      }`}
    >
      {children}
    </motion.div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">{children}</p>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/5 pb-2">
      <dt className="font-mono text-xs text-muted">{label}</dt>
      <dd className="tabular font-mono text-sm text-white/90">{value}</dd>
    </div>
  )
}

function Big({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{label}</p>
      <p className="tabular mt-1 text-2xl font-medium tracking-tight">{value}</p>
    </div>
  )
}

function Dial({ score }: { score: number }) {
  const [shown, setShown] = useState(0)
  const pct = Math.min(score / 1000, 1)
  const R = 46
  const C = 2 * Math.PI * R

  useEffect(() => {
    let frame: number
    const started = performance.now()
    const from = shown

    const tick = (now: number) => {
      const t = Math.min((now - started) / 700, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setShown(Math.round(from + (score - from) * eased))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score])

  return (
    <div className="mt-4 flex items-center gap-5">
      <div className="relative h-28 w-28 shrink-0">
        <svg viewBox="0 0 110 110" className="h-full w-full -rotate-90">
          <circle cx="55" cy="55" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
          <motion.circle
            cx="55"
            cy="55"
            r={R}
            fill="none"
            stroke="#5eead4"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={C}
            initial={{ strokeDashoffset: C }}
            animate={{ strokeDashoffset: C * (1 - pct) }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className="tabular text-3xl font-medium tracking-tight">{shown}</span>
        </div>
      </div>

      <p className="max-w-[16rem] text-sm leading-relaxed text-muted">
        Built only from repayments proven from another chain. It cannot be self reported.
      </p>
    </div>
  )
}
