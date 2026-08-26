import { HardhatUserConfig } from 'hardhat/config'
import '@nomicfoundation/hardhat-toolbox'
import 'dotenv/config'

const deployerKey = process.env.DEPLOYER_KEY

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true
    }
  },
  networks: {
    creditcoinTestnet: {
      url: 'https://rpc.cc3-testnet.creditcoin.network',
      chainId: 102031,
      accounts: deployerKey ? [deployerKey] : []
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL ?? 'https://rpc.sepolia.org',
      chainId: 11155111,
      accounts: deployerKey ? [deployerKey] : []
    }
  },
  etherscan: {
    apiKey: { creditcoinTestnet: 'blockscout' },
    customChains: [
      {
        network: 'creditcoinTestnet',
        chainId: 102031,
        urls: {
          apiURL: 'https://creditcoin-testnet.blockscout.com/api',
          browserURL: 'https://creditcoin-testnet.blockscout.com'
        }
      }
    ]
  }
}

export default config
