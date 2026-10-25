import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { keccak256, toHex } from 'viem'
const root = path.resolve(import.meta.dirname, '..')
const out = path.resolve(root, 'contract-tools/out')
const artifacts = {}
for (const name of ['StrategyLicenseMarket', 'TestnetBotVault']) {
  const a = JSON.parse(fs.readFileSync(path.join(out, `${name}.sol`, `${name}.json`), 'utf8'))
  const meta = typeof a.metadata === 'string' ? JSON.parse(a.metadata) : a.metadata
  for (const [source, info] of Object.entries(meta.sources)) {
    const bytes = fs.readFileSync(path.resolve(root, source))
    if (keccak256(toHex(bytes)) !== info.keccak256) throw new Error(`Recompile changed source: ${source}`)
  }
  const runtime = a.deployedBytecode.object
  const refs = Object.values(a.deployedBytecode.immutableReferences ?? {}).flat()
  if (name === 'TestnetBotVault' && refs.length) throw new Error('Vault must have fixed runtime')
  const runtimeHashes = {}
  for (const chain of name === 'StrategyLicenseMarket' ? [5042, 5042002] : [5042002]) {
    let patched = runtime
    for (const ref of refs) {
      if (ref.length !== 32) throw new Error('Unexpected immutable size')
      const offset = 2 + ref.start * 2
      patched = patched.slice(0, offset) + BigInt(chain).toString(16).padStart(64, '0') + patched.slice(offset + 64)
    }
    // Market has only one immutable: expectedChainId. Tests check both chain runtimes.
    if (name === 'StrategyLicenseMarket' && Object.keys(a.deployedBytecode.immutableReferences).length !== 1) throw new Error('Re-review immutables')
    runtimeHashes[chain] = keccak256(patched)
  }
  artifacts[name] = { bytecode: a.bytecode.object, abi: a.abi, runtimeHashes,
    sourceSha256: '0x' + createHash('sha256').update(fs.readFileSync(path.join(root, 'contracts', `${name}.sol`))).digest('hex') }
}
fs.mkdirSync(path.join(root, 'src/onchain'), { recursive: true })
fs.writeFileSync(path.join(root, 'src/onchain/compiled.json'), JSON.stringify(artifacts))
console.log('Generated source-checked browser deployment artifacts; no chain writes.')
