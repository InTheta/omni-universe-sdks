# Run agents from the installed SDK archive

Node >=22.12 on Linux is required. After the v0.8.3 release asset is published, create a fresh consumer directory:

```sh
mkdir omni-sdk-consumer
cd omni-sdk-consumer
npm init -y
npm install --ignore-scripts https://github.com/InTheta/omni-universe-sdks/releases/download/v0.8.3/omni-terminal-sdk-0.8.3.tgz
SDK=node_modules/@omni-terminal/sdk
```

The archive contains runnable JavaScript under `dist-examples/`. These commands need only the installed SDK and its regular dependencies. They require no `tsx`, TypeScript compiler, cloned repository, `.env` file, payer or signer. Source `.ts` examples remain included for inspection. A source checkout must run `npm ci && npm run build` in `packages/typescript` before its compiled example scripts are available. A source branch or merge does not prove that the release asset has been published.

## First public data request

```sh
node "$SDK/dist-examples/rest-api-key.js" --public-only
```

Expected: Omni health, exact public Hyperliquid instruments and candles, followed by confirmation that keyed news and Ask Omni were disabled. This makes free public reads only. `--public-only` overrides optional API-key flags in the process environment.

## Connect an MCP client

```sh
node "$SDK/dist-examples/mcp-all-tools.js" --free-only
```

Expected: actual MCP connection, tool listing and the free structured product catalog. No paid tool is called and no payer is constructed, even if paid flags exist in the environment. Omni's deployed MCP surface sells read-only data; connecting or buying data grants no trading permission.

## Structured research agent

```sh
RESEARCH_SYMBOL=BTC node "$SDK/dist-examples/agents/research-readonly.js" --free-only
```

Expected: `omni_research_agent.v1`, an exact active instrument, fresh public book, free MCP catalog, unsigned x402 payment requirements and `execution.authorized: false`. Account scope is `not_requested` unless the operator explicitly supplies `RESEARCH_ACCOUNT`. The paid assessment remains null and `paidData.attempted` is false. This uses real services without an LLM call or payment. `--free-only` overrides `RUN_PAID_RESEARCH=true`; missing or invalid symbols fail instead of substituting another market. See [research and payment recovery](research-and-payment-recovery.md) for the separate paid prerequisite.

## Guarded testnet preview and disabled permission

Supply the exact public owning account you intend to inspect. Reading an account grants no access to it. The placeholder below must be replaced; there is no account fallback.

```sh
export HL_TESTNET_ACCOUNT_ADDRESS=0xYOUR_EXACT_PUBLIC_TESTNET_OWNER
export TESTNET_SYMBOL=BTC
export TESTNET_MAX_NOTIONAL_USD=15
node "$SDK/dist-examples/agents/guarded-execution.js" --preview-only --probe-disabled-permission
```

Expected: live testnet metadata/book/account data, bounded order preview and `permission.code: TESTNET_EXECUTION_DISABLED`. `--preview-only` prevents signer construction and overrides `RUN_TESTNET_ORDERS=true`. The permission probe reaches the SDK's disabled-execution guard before any exchange request. It neither signs nor places an order. Missing account/symbol, unavailable exact instruments and stale data fail explicitly. See [guarded execution](guarded-testnet.md) for independently authorised funded prerequisites and recovery.

## Lifecycle and recovery runner

```sh
node "$SDK/dist-examples/agents/lifecycle-recovery.js"
```

Expected: `omni_lifecycle_recovery.v1`, `evidence: mock-tested`, nine deterministic scenarios and zero venue requests/signatures/orders. It exercises orchestration for rejection, stale/expired evidence, insufficient collateral, disconnect uncertainty without replay, unindexed fills, partial cleanup exposure, indexed reduction to flat and unfilled cancellation. It uses no signer or private key. These fixtures do not prove venue rejection semantics, sandbox execution or builder credit.

The separate compiled `payment-recovery.js` example uses a public deterministic fixture key to produce and discard local payment signatures. It makes no network request or payment. Run it only when that local-signing fixture scope is intended; it is not part of the unsigned lifecycle command above.

## Local MCP trading agent and source tests

The separate local stdio MCP trading adapter, its client and test suites are repository examples, **not included in the SDK tarball**. Use the matching tagged source when that path is needed:

```sh
git clone --branch v0.8.3 https://github.com/InTheta/omni-universe-sdks.git
cd omni-universe-sdks/packages/typescript
npm ci
npm run build
cd ../../examples/testnet-agents
npm ci
npm run typecheck
npm run test:mcp
```

Then follow [MCP trading and recovery](https://github.com/InTheta/omni-universe-sdks/blob/v0.8.3/examples/testnet-agents/MCP_TRADING.md) for the exact owner/symbol, private journal path and `RUN_TESTNET_MCP_TRADING=false` permission probe. Source `verify:live` also includes a separately labelled signed unfunded-account probe; it is not an unsigned-only quickstart. Trading through this local adapter still requires independently approved testnet authority, builder approval and funded collateral. The paid seller MCP server does not become a trading server.

Repository `test/*.ts`, including full guarded-executor and payment-policy regression suites, are omitted from the public SDK archive. Run them from the tagged source after `npm ci`; do not point an installed-package user at missing test files. The archive's unsigned lifecycle runner above remains available without a source checkout.

## Troubleshooting

- `Cannot find package 'tsx'`: a historical release's source-only example command was selected. Use the v0.8.3 compiled paths above; do not add unrelated consumer dependencies to disguise a packaging failure.
- `dist-examples/...` missing: confirm the installed release and archive contents. For a source checkout run its documented build before examples.
- `Set exact ...` or an invalid-symbol error: supply the precise public account/instrument; do not substitute another account.
- `TESTNET_EXECUTION_DISABLED` in the permission probe is the expected safe result.
- Timeout, stale book or an unavailable MCP/API service: retain the explicit error and rerun free reads only after investigating availability. Offline lifecycle fixtures remain usable without a network.
- A payment or order may have an uncertain outcome after a write. Preserve its journal and reconcile authoritative state before any newly authorised attempt. Free-read retry guidance does not authorise repeating payments or orders.

Successful free reads, permission denials and mock-tested recovery do not establish a funded lifecycle. [Builder attribution](builder-attribution.md) separately distinguishes request fields, fill fees, aggregate credit and uniquely matched builder exports.
