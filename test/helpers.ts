import { ethers } from 'hardhat'
import { AbiCoder, id, zeroPadValue } from 'ethers'
import type { ContractTransactionReceipt } from 'ethers'

export const PRECOMPILE = '0x0000000000000000000000000000000000000FD2'
export const CHAIN_KEY = 1n

/// Aave V3: Repay(address indexed reserve, address indexed user, address indexed repayer, uint256, bool)
export const REPAY_TOPIC = id('Repay(address,address,address,uint256,bool)')
export const BORROWER_TOPIC = 2
export const AMOUNT_WORD = 0

export const EMPTY_MERKLE = { root: ethers.ZeroHash, siblings: [] }
export const EMPTY_CONTINUITY = { lowerEndpointDigest: ethers.ZeroHash, roots: [] }

const coder = AbiCoder.defaultAbiCoder()
const COMMON = ['uint64', 'uint64', 'address', 'bool', 'address', 'uint256', 'bytes']
const RECEIPT = ['uint8', 'uint64', 'tuple(address,bytes32[],bytes)[]', 'bytes']

export type Log = { addr: string; topics: string[]; data: string }

/**
 * Rebuilds the blob Attestcoin attests, in the layout confirmed against a real
 * proof. Group 1 is transaction-type specific and never read, so it is empty.
 */
export function encodeTx(opts: { from: string; to: string; status?: number; logs: Log[] }) {
  const common = coder.encode(COMMON, [7, 200000, opts.from, false, opts.to, 0, '0x'])
  const receipt = coder.encode(RECEIPT, [
    opts.status ?? 1,
    50000,
    opts.logs.map((l) => [l.addr, l.topics, l.data]),
    '0x'
  ])
  return coder.encode(['uint8', 'bytes[]'], [2, [common, '0x', receipt]])
}

export function encodeFromReceipt(from: string, to: string, receipt: ContractTransactionReceipt) {
  const common = coder.encode(COMMON, [1, 500000, from, false, to, 0, '0x'])
  const logs = receipt.logs.map((l) => [l.address, [...l.topics], l.data])
  const encoded = coder.encode(RECEIPT, [receipt.status ?? 1, receipt.gasUsed, logs, '0x'])
  return coder.encode(['uint8', 'bytes[]'], [2, [common, '0x', encoded]])
}

export function repayLog(pool: string, borrower: string, amount: bigint, asset?: string): Log {
  return {
    addr: pool,
    topics: [
      REPAY_TOPIC,
      zeroPadValue(asset ?? '0x1111111111111111111111111111111111111111', 32),
      zeroPadValue(borrower, 32),
      zeroPadValue('0x2222222222222222222222222222222222222222', 32)
    ],
    data: coder.encode(['uint256', 'bool'], [amount, false])
  }
}

/** Drops a stand-in for the precompile at the address the contract really calls. */
export async function installVerifier(name: string) {
  const mock = await ethers.deployContract(name)
  const code = await ethers.provider.getCode(await mock.getAddress())
  await ethers.provider.send('hardhat_setCode', [PRECOMPILE, code])
}
