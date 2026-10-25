import { WalletButton } from './WalletButton'
import { Radio, WifiOff } from 'lucide-react'
import { useAccount, useReadContract } from 'wagmi'
import { erc20Abi, formatUnits } from 'viem'
import { USDC } from '../onchain/contracts'
import type { BtcPriceState } from '../hooks/useBtcPrice'

interface HeaderProps {
  btcState: BtcPriceState
  section: string
}

export function Header({ btcState }: HeaderProps) {
  const { address, chainId } = useAccount()
  const arc = chainId === 5042 || chainId === 5042002
  const balance = useReadContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: address ? [address] : undefined, chainId: chainId === 5042 ? 5042 : 5042002, query: { enabled: !!address && arc, refetchInterval: 15000 } })
  const live = !btcState.isStale && btcState.price !== null
  return <header className="workspace-header">
    <div className="header-actions">
      <span className={`feed-status ${live ? 'is-live' : ''}`} title={`Binance BTC/USDT · ${btcState.source ?? 'waiting'} · last received ${btcState.lastUpdated ? new Date(btcState.lastUpdated).toLocaleTimeString() : 'not yet'}`}>
        {live ? <Radio size={13} /> : <WifiOff size={13} />}{live ? 'Live data' : 'Connecting'}
      </span>
      {address && <span className={`pill ${chainId === 5042 ? 'pill-green' : ''}`}>{chainId === 5042 ? 'Mainnet' : chainId === 5042002 ? 'Testnet' : 'Other network'}</span>}
      {balance.data !== undefined && arc && <span className="wallet-balance">{Number(formatUnits(balance.data, 6)).toFixed(2)} {chainId === 5042 ? 'USDC' : 'test USDC'}</span>}
      <WalletButton />
    </div>
  </header>
}
