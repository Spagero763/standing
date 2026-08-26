'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactNode, useState } from 'react'
import { WagmiProvider, createConfig, http } from 'wagmi'
import { defineChain } from 'viem'
import { creditcoin } from '@/lib/contracts'

export const creditcoinTestnet = defineChain({
  id: creditcoin.id,
  name: creditcoin.name,
  nativeCurrency: { name: 'Creditcoin', symbol: 'CTC', decimals: 18 },
  rpcUrls: { default: { http: [creditcoin.rpc] } },
  blockExplorers: { default: { name: 'Blockscout', url: creditcoin.explorer } },
  testnet: true
})

/**
 * No connectors are declared on purpose. Wallets announce themselves over
 * EIP-6963 and wagmi picks them up, which keeps the Coinbase SDK and its
 * optional native dependencies out of the bundle entirely.
 */
const config = createConfig({
  chains: [creditcoinTestnet],
  transports: { [creditcoinTestnet.id]: http(creditcoin.rpc) },
  ssr: true
})

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient())

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}
