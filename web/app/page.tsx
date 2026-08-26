import { LiveStanding } from '@/components/LiveStanding'
import { ProofPipeline } from '@/components/ProofPipeline'
import { addresses, creditcoin, sourceChain } from '@/lib/contracts'

export default function Home() {
  return (
    <main className="relative min-h-screen">
      <div className="pointer-events-none absolute inset-0 grid-ground" aria-hidden />

      <div className="relative mx-auto max-w-5xl px-6 pb-28 pt-20 sm:pt-28">
        <Hero />

        <div className="mt-16">
          <LiveStanding />
        </div>

        <div className="mt-24">
          <ProofPipeline />
        </div>

        <Footer />
      </div>
    </main>
  )
}

function Hero() {
  return (
    <header>
      <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-proof" />
        live on {creditcoin.name}
      </p>

      <h1 className="max-w-3xl text-4xl font-medium leading-[1.08] tracking-tight sm:text-6xl">
        We read Aave.
        <br />
        <span className="text-muted">We read Compound.</span>
        <br />
        We wrote neither.
      </h1>

      <p className="mt-7 max-w-xl text-base leading-relaxed text-muted">
        Repay a loan on a real money market and prove it on Creditcoin. The proof is checked on
        chain in the same transaction that acts on it, so the record cannot be claimed, only
        earned. What follows is a loan with no collateral behind it.
      </p>

      <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2 font-mono text-xs text-muted">
        <span>
          markets <span className="text-white/80">Aave V3, Compound V3</span>
        </span>
        <span>
          source <span className="text-white/80">{sourceChain.name}</span>
        </span>
        <span>
          verifier <span className="text-white/80">0x0FD2</span>
        </span>
        <span>
          oracles <span className="text-white/80">none</span>
        </span>
        <span>
          bridges <span className="text-white/80">none</span>
        </span>
      </div>
    </header>
  )
}

function Footer() {
  const links: [string, string][] = [
    ['registry', `${creditcoin.explorer}/address/${addresses.registry}`],
    ['credit line', `${creditcoin.explorer}/address/${addresses.line}`],
    ['aave v3', `${sourceChain.explorer}/address/${addresses.aavePool}`],
    ['compound v3', `${sourceChain.explorer}/address/${addresses.cometPool}`]
  ]

  return (
    <footer className="mt-24 border-t border-white/5 pt-8">
      <div className="flex flex-wrap gap-x-8 gap-y-3 font-mono text-xs">
        {links.map(([label, href]) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-muted transition hover:text-white"
          >
            {label} ↗
          </a>
        ))}
      </div>
      <p className="mt-6 font-mono text-[11px] text-muted/60">Testnet deployment.</p>
    </footer>
  )
}
