import { createPublicClient, createWalletClient, custom, encodeDeployData, erc20Abi, getAddress, http, keccak256, parseAbi } from 'viem'
import type { Abi, Address, EIP1193Provider, Hash, Hex } from 'viem'
import { arc, arcTestnet } from 'viem/chains'
import compiled from './compiled.json' with { type: 'json' }

export const USDC = '0x3600000000000000000000000000000000000000' as const
export type Network = 5042 | 5042002
export type ContractKind = keyof typeof compiled
export const network = (id: Network) => id === 5042 ? arc : arcTestnet
export const rpc = (id: Network) => createPublicClient({ chain: network(id), transport: http(undefined, { timeout: 15000, retryCount: 1 }) })
export const explorer = (id: Network) => network(id).blockExplorers.default.url
export const artifact = (kind: ContractKind) => compiled[kind]
export function runtimeHash(kind: ContractKind, id: Network): Hash {
  const hashes: Record<string, string> = compiled[kind].runtimeHashes
  if (!hashes[id]) throw new Error('This contract cannot run on the selected network.')
  return hashes[id] as Hash
}
export async function verifyContract(kind: ContractKind, id: Network, address: Address) {
  const client = rpc(id)
  if (await client.getChainId() !== id) throw new Error('RPC network mismatch')
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 })
  const [code, decimals] = await Promise.all([
    client.getBytecode({ address: getAddress(address), blockNumber }),
    client.readContract({ address: USDC, abi: erc20Abi, functionName: 'decimals', blockNumber }),
  ])
  if (!code || keccak256(code) !== runtimeHash(kind, id) || decimals !== 6) throw new Error('Deployed contract does not match this reviewed build.')
  return client
}
export async function checkedWallet(provider: EIP1193Provider, id: Network, owner: Address) {
  const wallet = createWalletClient({ chain: network(id), account: owner, transport: custom(provider) })
  const [actual, accounts] = await Promise.all([wallet.getChainId(), wallet.getAddresses()])
  if (actual !== id || accounts[0]?.toLowerCase() !== owner.toLowerCase()) throw new Error('Wallet account or network changed. Review again.')
  return wallet
}
export function deploymentData(kind: ContractKind, id: Network, args: readonly unknown[]): Hex {
  runtimeHash(kind, id)
  return encodeDeployData({ abi: compiled[kind].abi as Abi, bytecode: compiled[kind].bytecode as Hex, args })
}
export const VAULT_ABI = parseAbi([
  'function owner() view returns (address)', 'function session() view returns (address)',
  'function expiresAt() view returns (uint256)', 'function createdAt() view returns (uint256)',
  'function creationBlock() view returns (uint256)',
  'function reserve() view returns (address)',
  'function getRules() view returns ((bytes32 strategyHash,uint256 budget6,uint256 reserve6,uint256 order6,uint16 allocationBps,uint16 shortPeriod,uint16 longPeriod,uint16 stopLossBps))',
  'function getState() view returns ((uint256 cash6,uint256 btc8,uint256 cost6,int256 realized6,uint256 sequence,uint256 lastCandle,bool funded,bool closed))',
  'function fund()', 'function close()', 'function setSession(address next)',
  'function execute(bool buy,uint256 quote6,uint256 candle,uint256 observedAt,uint256 expectedSequence)',
  'event Fill(uint256 indexed sequence,bool buy,uint256 quote6,uint256 execution6,uint256 btc8,uint256 transfer6,uint256 fee6,uint256 candle,uint256 observedAt,int256 realized6)',
  'event Closed(bool positionAbandoned,uint256 returned6)',
])
export async function readVault(address: Address) {
  const client = await verifyContract('TestnetBotVault', 5042002, address)
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 })
  const base = { address, abi: VAULT_ABI, blockNumber } as const
  const [state, rules, owner, session, reserve, expiresAt, createdAt, creationBlock] = await Promise.all([
    client.readContract({ ...base, functionName: 'getState' }), client.readContract({ ...base, functionName: 'getRules' }),
    client.readContract({ ...base, functionName: 'owner' }), client.readContract({ ...base, functionName: 'session' }),
    client.readContract({ ...base, functionName: 'reserve' }), client.readContract({ ...base, functionName: 'expiresAt' }),
    client.readContract({ ...base, functionName: 'createdAt' }),
    client.readContract({ ...base, functionName: 'creationBlock' }),
  ])
  const reserve6 = await client.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [reserve], blockNumber })
  return { address, state, rules, owner, session, reserve, reserve6, expiresAt, createdAt, creationBlock, blockNumber }
}
export type VaultSnapshot = Awaited<ReturnType<typeof readVault>>
