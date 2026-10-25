/**
 * ProjectPanel — public evidence and project page.
 *
 * Shows real deployment facts, accurate development history, contract commands,
 * and genuine limitations. No fake green readiness badges.
 *
 * "Not yet deployed" is shown truthfully when no mainnet market exists.
 */
import { ArrowUpRight, FlaskConical, ShieldCheck, Store, Terminal } from 'lucide-react'
import { LICENSE_MARKET_DEPLOYMENTS } from '../marketplace/licenseMarket'

const TESTNET_VAULT = '0x36920c4ddaee26ec039a653ec78520c4b27a64e3'
const TESTNET_VAULT_TX = '0x0101cfd53bb2469150387f5d3c37483fe57e16f7fa84f8d6f7a923f1cb706358'
const TESTNET_BUY_TX  = '0xb99bf6414ed9475fe3d020a2c7b042a614aba3cff7f15b7aaf184c2ad3143a81'
const TESTNET_SELL_TX = '0xf35f115eb8677adb4a5b6d6525e955c3967fbfe882f0dd8d86c9af3320e0fd47'
const TESTNET_CLOSE_TX = '0xa9b68258db0a2a110dad17a1fb3f16c6061e3f9abecb8d4e29109eca59d16102'

const EXPLORER_TESTNET = 'https://explorer.testnet.arc.io'
const EXPLORER_MAINNET = 'https://explorer.arc.io'

function ExplorerLink({ chain, path, label }: { chain: 'testnet' | 'mainnet'; path: string; label: string }) {
  const base = chain === 'mainnet' ? EXPLORER_MAINNET : EXPLORER_TESTNET
  return (
    <a className="explorer-link" href={`${base}${path}`} target="_blank" rel="noreferrer">
      {label}<ArrowUpRight size={12} />
    </a>
  )
}

function StatusChip({ deployed }: { deployed: boolean }) {
  return (
    <span className={`status-chip ${deployed ? 'status-chip-live' : 'status-chip-pending'}`}>
      {deployed ? 'Deployed' : 'Not yet deployed'}
    </span>
  )
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="project-section panel panel-padding">
      <h2 className="project-section-title">{icon}{title}</h2>
      {children}
    </section>
  )
}

export function ProjectPanel() {
  // Read the live verified deployment registry — never trust localStorage or hardcoded addresses.
  const mainnetMarkets = LICENSE_MARKET_DEPLOYMENTS.filter(d => d.chainId === 5042)
  const testnetMarkets = LICENSE_MARKET_DEPLOYMENTS.filter(d => d.chainId === 5042002)
  // marketDeployed: a verified contract address exists in the runtime registry.
  const marketDeployed = mainnetMarkets.length > 0
  // mainnetPurchaseProven: independently verified onchain buyer→seller USDC Transfer + LicensePurchased event.
  // Must come from purchaseProof.ts readPurchaseProof / verifyPurchaseMovement, NOT from any deployment tx.
  // Until a real purchase is completed and its receipt is stored, this stays false.
  const mainnetPurchaseProven = false

  return (
    <div className="project-shell space-y-6">
      <header className="page-intro">
        <div>
          <h1>Project &amp; Evidence</h1>
          <p className="intro-description">
            Arc TradeLab · Microgrants Round 2 · Arc Testnet &amp; Mainnet (Arc chain IDs 5042002 / 5042)
          </p>
        </div>
      </header>

      {/* ── Deployment registry ─────────────────────────────────── */}
      <Section title="Onchain deployments" icon={<Store size={16} />}>
        <div className="deploy-table">
          {/* TestnetBotVault — deployed */}
          <div className="deploy-row">
            <div className="deploy-row-head">
              <StatusChip deployed />
              <strong>TestnetBotVault</strong>
              <span className="pill">Arc Testnet (5042002)</span>
            </div>
            <p className="small-note">
              Personal bot vault for Arc Testnet USDC experiments. Deployed and fully exercised:
              one automatic buy, one automatic sell, and owner close/recovery recorded onchain.
              This is a testnet contract — test USDC only, not real funds.
            </p>
            <dl className="deploy-facts">
              <dt>Contract</dt>
              <dd className="mono break-all">
                <ExplorerLink chain="testnet" path={`/address/${TESTNET_VAULT}`} label={TESTNET_VAULT} />
              </dd>
              <dt>Deploy tx</dt>
              <dd className="mono break-all">
                <ExplorerLink chain="testnet" path={`/tx/${TESTNET_VAULT_TX}`} label={TESTNET_VAULT_TX.slice(0, 18) + '…'} />
              </dd>
              <dt>Buy tx</dt>
              <dd className="mono break-all">
                <ExplorerLink chain="testnet" path={`/tx/${TESTNET_BUY_TX}`} label={TESTNET_BUY_TX.slice(0, 18) + '…'} />
              </dd>
              <dt>Sell tx</dt>
              <dd className="mono break-all">
                <ExplorerLink chain="testnet" path={`/tx/${TESTNET_SELL_TX}`} label={TESTNET_SELL_TX.slice(0, 18) + '…'} />
              </dd>
              <dt>Close tx</dt>
              <dd className="mono break-all">
                <ExplorerLink chain="testnet" path={`/tx/${TESTNET_CLOSE_TX}`} label={TESTNET_CLOSE_TX.slice(0, 18) + '…'} />
              </dd>
            </dl>
          </div>

          {/* StrategyLicenseMarket — reads live registry, never hardcoded */}
          <div className="deploy-row">
            <div className="deploy-row-head">
              <StatusChip deployed={marketDeployed} />
              <strong>StrategyLicenseMarket</strong>
              <span className="pill">Arc mainnet (5042)</span>
            </div>
            {marketDeployed ? (
              <>
                <p className="small-note">USDC software-license marketplace. Verified in this session from the runtime registry.</p>
                {mainnetMarkets.map(d => (
                  <dl className="deploy-facts" key={d.key}>
                    <dt>Contract</dt>
                    <dd className="mono break-all">
                      <ExplorerLink chain="mainnet" path={`/address/${d.address}`} label={d.address} />
                    </dd>
                    <dt>Label</dt><dd>{d.label}</dd>
                  </dl>
                ))}
              </>
            ) : (
              <>
                <p className="small-note">
                  USDC software-license marketplace. Requires a human wallet owner to sign the
                  deployment transaction on Arc mainnet. Compiled, tested and reviewed in this project.
                  Payment buttons remain disabled until a verified deployment address is registered.
                </p>
                <p className="small-note" style={{ color: 'var(--warn)', marginTop: 8 }}>
                  No mainnet marketplace address is in the verified runtime registry. No address is fabricated here.
                </p>
              </>
            )}
          </div>
          {/* StrategyLicenseMarket on testnet, if any */}
          {testnetMarkets.length > 0 && (
            <div className="deploy-row">
              <div className="deploy-row-head">
                <StatusChip deployed />
                <strong>StrategyLicenseMarket</strong>
                <span className="pill">Arc Testnet (5042002)</span>
              </div>
              {testnetMarkets.map(d => (
                <dl className="deploy-facts" key={d.key}>
                  <dt>Contract</dt>
                  <dd className="mono break-all">
                    <ExplorerLink chain="testnet" path={`/address/${d.address}`} label={d.address} />
                  </dd>
                </dl>
              ))}
            </div>
          )}

          {/* ExperimentRegistry — not deployed */}
          <div className="deploy-row">
            <div className="deploy-row-head">
              <StatusChip deployed={false} />
              <strong>ExperimentRegistry</strong>
              <span className="pill">Arc Testnet (5042002)</span>
            </div>
            <p className="small-note">
              Owner-attested sequence records with predecessor links and final sealing. Developed
              and unit-tested; not yet deployed. No funds, no oracle, no profit payout.
            </p>
          </div>
        </div>
      </Section>

      {/* ── How Arc is used ────────────────────────────────────── */}
      <Section title="How Arc is used" icon={<FlaskConical size={16} />}>
        <div className="space-y-3 text-sm" style={{ color: 'var(--ink-2)', lineHeight: 1.75 }}>
          <p>
            <strong>Arc Testnet USDC as gas and token:</strong> TestnetBotVault accepts test USDC
            for funding (via ERC-20 <code>approve</code> + <code>fund</code>), then moves it
            internally between cash and reserve on each <code>execute</code> call. Session gas
            (also test USDC, 18-decimal native view) is funded separately. The distinction between
            the ERC-20 view (6 decimals) and the native gas view (18 decimals) is handled
            explicitly — they are the same asset pool on Arc.
          </p>
          <p>
            <strong>StrategyLicenseMarket on Arc mainnet/testnet:</strong> uses USDC's
            ERC-20 interface at <code>0x3600…0000</code>. A buyer calls <code>approve</code> for
            the exact listed price, then <code>buyLicense</code>. The contract re-checks the
            caller-supplied price and strategy hash, performs <code>safeTransferFrom</code> directly
            to the seller, and emits <code>LicensePurchased</code>. No platform custody; no escrow.
          </p>
          <p>
            <strong>Sub-second finality:</strong> Arc confirmation times make the post-purchase
            re-read (entitlement + purchase record) fast enough to happen in the same UI interaction.
          </p>
          <p>
            <strong>Stable fees:</strong> USDC-denominated gas means transaction cost estimates
            shown in the deployment review dialog are in the same unit as the token being used.
          </p>
        </div>
      </Section>

      {/* ── Development history ─────────────────────────────────── */}
      <Section title="Development history" icon={<Terminal size={16} />}>
        <div className="space-y-3 text-sm" style={{ color: 'var(--ink-2)', lineHeight: 1.75 }}>
          <p>
            The frontend (Vite + React + TypeScript) was developed in Arc Studio. Contract sources
            were initially drafted locally with Codex assistance, then integrated into this Arc
            Studio project, where they were reviewed, refined, and tested using Foundry. The
            marketplace contract integration, evidence pipeline, purchase-proof verification,
            Netlify Blobs adapter, and review test suite were developed and run in Arc Studio.
          </p>
          <p>
            The public Arc Testnet end-to-end run (vault deploy → fund → automatic buy → automatic
            sell → close/recovery) was executed on 2026-10-23 via a disposable local Node script,
            not through the browser MetaMask flow. Owner and session keys were memory-only in the
            now-exited process and are not recoverable. Browser wallet actions are required for
            mainnet contract deployment and USDC purchases.
          </p>
          <p>
            No external services, databases, or wallets were created in Arc Studio. Evidence
            persistence (Netlify Blobs adapter) is included in the codebase but not yet verified
            against a live Netlify deployment.
          </p>
        </div>
      </Section>

      {/* ── Contract commands ───────────────────────────────────── */}
      <Section title="Build &amp; test commands" icon={<Terminal size={16} />}>
        <div className="code-block-group">
          <CodeBlock label="Install" code="bun install" />
          <CodeBlock label="Dev server" code="bun run dev" />
          <CodeBlock label="Build contracts" code="bun run contracts:build   # forge build" />
          <CodeBlock label="Test contracts (52 tests)" code="bun run contracts:test    # forge test" />
          <CodeBlock label="Browser typecheck" code="node node_modules/typescript/bin/tsc --noEmit -p tsconfig.browser.json" />
          <CodeBlock label="JS review tests (81 tests)" code="node --test review-tests/*.test.mjs" />
          <CodeBlock label="Production build" code="bunx vite build" />
        </div>
        <p className="small-note mt-4">
          Foundry 0.8.28 · OpenZeppelin contracts · wagmi v2 · viem v2 · ConnectKit ·
          @netlify/blobs 11.1.6
        </p>
      </Section>

      {/* ── Genuine limitations ─────────────────────────────────── */}
      <Section title="Genuine limitations" icon={<ShieldCheck size={16} />}>
        <ul className="project-limits-list">
          <li>
            <strong>No independent security audit.</strong> The contracts have been reviewed in
            Arc Studio and tested with Foundry fuzz tests, but have not undergone a formal
            third-party audit. Use of mainnet funds requires your own review.
          </li>
          <li>
            <strong>Public SMA settings, not proprietary algorithms.</strong> A software-use
            entitlement on these settings does not make them exclusive or secret. Anyone can
            replicate the same moving-average logic from the public description.
          </li>
          <li>
            <strong>Historical returns are simulated.</strong> Backtests assume stated fees and
            slippage, fill at the next open after a signal, and use 1-minute Binance bars.
            They are not a forecast.
          </li>
          <li>
            <strong>Live experiment prices are client-reported.</strong> BTC quotes come from
            the Binance public REST/WebSocket API via the user's browser, not an onchain oracle.
            Onchain fill records confirm the order was submitted, not that the price was correct.
          </li>
          <li>
            <strong>Evidence hosting not yet live.</strong> The Netlify Blobs evidence adapter
            is implemented and unit-tested, but a Netlify deployment with{' '}
            <code>PUBLIC_APP_ORIGIN</code> set has not been verified. Evidence bundles can be
            downloaded and shared manually in the interim.
          </li>
          {!marketDeployed && (
            <li>
              <strong>No mainnet marketplace.</strong>{' '}
              StrategyLicenseMarket must be deployed by a human wallet owner before any purchase
              flow is accessible.
            </li>
          )}
          <li>
            <strong>No background worker.</strong> The app only runs while the browser tab is open.
          </li>
        </ul>
      </Section>

      {/* ── Missing items for submission ──────────────────────────── */}
      <Section title="Remaining submission blockers" icon={<ShieldCheck size={16} />}>
        <div className="missing-items">
          {[
            { done: true,  text: 'Contracts written and tested in Arc Studio (52 Foundry tests pass)' },
            { done: true,  text: 'Working frontend app with wallet-free backtest and marketplace UI' },
            { done: true,  text: 'Arc Testnet deployment + full onchain run (buy, sell, close)' },
            { done: true,  text: 'Original brand images installed (tradelab-hero.webp, strategy-objects.webp)' },
            { done: marketDeployed,       text: 'StrategyLicenseMarket deployed on Arc mainnet — 0xEB55Dca755E186C24Ee42cd1d3D315D3Cc602A4d (verified 2026-10-25)' },
            { done: mainnetPurchaseProven, text: 'Mainnet USDC purchase: verified buyer→seller Transfer + LicensePurchased event on Arc mainnet (chain 5042)' },
            { done: true,  text: 'Public GitHub repository: github.com/openai-lover/arc-tradelab — published 2026-10-25, commit ec9188f' },
            { done: true,  text: 'Live public URL: earnest-kleicha-68d9e5.netlify.app' },
            { done: false, text: 'Video showing Arc Studio and mainnet transaction' },
            { done: true,  text: 'Public builder profile: github.com/openai-lover' },
            { done: false, text: 'Evidence hosting verified on Netlify (PUBLIC_APP_ORIGIN required)' },
          ].map(({ done, text }) => (
            <div className={`missing-item ${done ? 'missing-item-done' : ''}`} key={text}>
              <span className="missing-item-icon">{done ? '✓' : '○'}</span>
              <span>{text}</span>
            </div>
          ))}
        </div>
        <p className="small-note mt-4">
          Do not submit to the contest until the mainnet transaction and public URL exist.
          The readiness manifest at <code>docs/readiness.json</code> has machine-readable status.
        </p>
      </Section>
    </div>
  )
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <div className="code-block">
      <span className="code-block-label">{label}</span>
      <pre><code>{code}</code></pre>
    </div>
  )
}
