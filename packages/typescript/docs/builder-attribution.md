# Verify Hyperliquid builder attribution without signing

This guide separates a requested builder fee, an actual fill fee, and credit recorded for the specified builder. These are different evidence. No command here signs, submits, cancels, approves fees, transfers collateral, or claims rewards. No mainnet trade is approved by this guide. The helper accepts no private keys, tokens, custom endpoints, or alternative builder destinations.

The canonical Omni builder is `0x733f40a4fa0cd13d59abade04b9ed2e9acac6457`. An order's `f` is measured in **tenths of a basis point**: `25` means 2.5 bp, or 0.025%. The owner's approved maximum is separate from the requested fee. An agent key cannot grant that approval. Official requirements include ≥100 USDC perps account value and standard account abstraction for the builder. [Official builder contract](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes)

An unfilled ALO order establishes no earned builder fee. A builder field in a submitted payload establishes request construction only. A native fill's `builderFee` establishes a charged amount but does not name its recipient. Native fill `fee` already includes `builderFee`; do not add them together. [Official info schemas](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)

## Prerequisites

Use Node 22 on Linux and an installed `@omni-terminal/sdk` release containing `HyperliquidPublicClient`. The supplied `examples/agents/builder-attribution-readonly.mjs` imports that public package entry only. It performs one bounded unsigned `/info` request with retries disabled, then creates one private proof JSON using exclusive creation. An existing proof file causes failure before any request. On failure, its empty/incomplete new file is removed. The helper never loads a `.env` file, payer, wallet, or signer.

Copy the [read-only helper](../examples/agents/builder-attribution-readonly.mjs) into a package consumer directory with `@omni-terminal/sdk` already installed. Verify its syntax without any network request:

```sh
node --check builder-attribution-readonly.mjs
node builder-attribution-readonly.mjs --help
```

Only these network values are accepted:

| Value | Fixed info endpoint |
| --- | --- |
| `testnet` | `https://api.hyperliquid-testnet.xyz/info` |
| `mainnet` | `https://api.hyperliquid.xyz/info` |

Hyperliquid documents using the same info requests on its testnet endpoint. [Official network guidance](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api)

## 1. Read aggregate credit for the exact builder

```sh
node builder-attribution-readonly.mjs ledger testnet builder-before.json
```

Expected proof: explicit testnet endpoint, canonical builder, observation timestamps, `selected.builderRewards`, token-indexed builder rewards, parsed-response JSON hash (not original HTTP bytes), zero venue writes and zero paid usage. `builderRewards` is cumulative; it is not current withdrawable rewards. `unclaimedRewards` mixes reward sources and is not a replacement attribution metric.

For a raw diagnostic read, this unsigned request restricts displayed fields to builder rewards. It does not perform the helper's schema validation and is not a validated proof artifact:

```sh
curl --fail-with-body --max-time 15 \
  -H 'Content-Type: application/json' \
  --data '{"type":"referral","user":"0x733f40a4fa0cd13d59abade04b9ed2e9acac6457"}' \
  https://api.hyperliquid-testnet.xyz/info |
  node --input-type=module -e 'let s=""; for await (const c of process.stdin) s+=c; const r=JSON.parse(s); console.log(JSON.stringify({builderRewards:r.builderRewards,tokenToState:r.tokenToState?.map(([token,state])=>({token,builderRewards:state.builderRewards}))}));'
```

For a mainnet **read**, replace the host with `https://api.hyperliquid.xyz/info` or pass `mainnet` to the helper. Never compare a testnet before snapshot with a mainnet after snapshot. This guide does not grant trading permission on either network.

The audit verified that the canonical builder has a cumulative testnet ledger response. Keep observed amounts in local run evidence, rather than treating a historical snapshot as the current balance. Existing aggregate venue credit is not evidence that a newly proposed SDK or MCP test order paid this builder.

## 2. Map an already-authorised order to native fills

Use the actual owner account, exact symbol, and cloid from the persisted request journal. Do not use the agent signer's address as a replacement for the owning account. Do not print or include the private key, signature, or reusable payment proof.

```sh
# Replace these with exact public identifiers from an existing journal.
OWNER=0xEXACT_OWNING_ACCOUNT
CLOID=0xEXACT_16_BYTE_CLIENT_ORDER_ID
SYMBOL=BTC
node builder-attribution-readonly.mjs order testnet order-proof.json "$OWNER" "$CLOID" "$SYMBOL"
```

The helper rejects an instrument or cloid mismatch. If `unknownOid` is returned, the outcome is uncertain; do not submit another order. Recover that original journal through authoritative status/fill reconciliation. A known order response supplies the numeric `oid` required by the next command.

```sh
# Exact integer values from the existing order/proof; at most a ten-minute window.
START_MS=EXACT_START_EPOCH_MILLISECONDS
END_MS=EXACT_END_EPOCH_MILLISECONDS
OID=EXACT_NUMERIC_ORDER_ID
node builder-attribution-readonly.mjs fills testnet fills-proof.json \
  "$OWNER" "$START_MS" "$END_MS" "$SYMBOL" "$OID"
```

Expected proof: exact order-filtered native fills plus same-instrument fills for ambiguity checks. Preserve `oid`, `tid`, `hash`, price, size, side, time, fee token, actual builder fee, and actual total fee. This is one recent bounded response, **not complete account history**. A response of 2000 fills is potentially truncated. The venue exposes only the most recent 10000 fills through this time-range method. If required fills are absent, retention/coverage is uncertain, or parsing is ambiguous, attribution remains unproven. Do not infer zero fee from missing evidence.

## 3. Compare before/after builder ledger snapshots

After an independently authorised and completed testnet lifecycle, take another **read**, using a new file:

```sh
node builder-attribution-readonly.mjs ledger testnet builder-after.json
```

Compare token-specific cumulative rewards using decimal arithmetic, not binary floating-point. The helper reports token indices without guessing their symbols. A missing or empty token breakdown is explicit; do not reinterpret the legacy top-level reward field as currency-resolved proof. For a separately established validator-perps USDC scope, token 0 is the relevant ledger; unsupported or unresolved currency scope remains unproven. Compare the delta with the sum of actual native `builderFee` values for the entry and any cleanup fills. Keep each exact order scope separate. Funding payments and venue trading fees are different amounts.

The result can establish that the canonical builder's aggregate ledger increased by a specific amount during the observation window. It does **not** uniquely assign that increment to the test order: other users may use the same public builder simultaneously. An exact match is corroboration; an excess or shortfall is unresolved. Do not turn correlation into a per-order credit claim. There is no documented instant-update SLA; bounded polling may remain inconclusive. Do not repeat an order to make accounting appear.

## 4. Mainnet builder-specific fill export

The official documented per-builder export is **Mainnet only**:

```text
https://stats-data.hyperliquid.xyz/Mainnet/builder_fills/{lowercase_builder}/{YYYYMMDD}.csv.lz4
```

Use the executed fill's UTC day, not local wall-clock date. The address must be entirely lowercase; `Mainnet` has this exact case. The following example reads an existing historical Omni export and creates one new local proof file; it performs no trade:

```sh
DAY=20261005
FILE="builder-fills-$DAY.csv.lz4"
# Exclusive file creation prevents overwriting earlier evidence.
( set -o noclobber
  curl --fail-with-body --max-time 30 --max-filesize 67108864 \
    --write-out '%{stderr}HTTP %{http_code}; bytes %{size_download}\n' \
    "https://stats-data.hyperliquid.xyz/Mainnet/builder_fills/0x733f40a4fa0cd13d59abade04b9ed2e9acac6457/$DAY.csv.lz4" > "$FILE"
) && date -u +%Y-%m-%dT%H:%M:%SZ && sha256sum "$FILE"
```

Retain the exact URL, observation timestamp, SHA-256, HTTP result, network, date and compressed file. A failed download is not evidence; remove only that failed new file after inspection. No implicit redirect, endpoint substitution, API key, or signed request is needed. Decompress locally using an installed LZ4 tool or Python `lz4.frame`; preserve the original compressed evidence.

Actual inspected schema:

```text
time,user,coin,side,px,sz,crossed,special_trade_type,tif,is_trigger,counterparty,closed_pnl,twap_id,builder_fee
```

The export contains **no oid, cloid, tid or transaction hash**. Its timestamps have second resolution; native fill timestamps use milliseconds. Sides use `Bid`/`Ask`, versus native `B`/`A`. Match using a unique multiset fingerprint: lowercase owner, exact coin, normalized side, exact decimal price and size, UTC timestamp bucket, crossed flag, and actual decimal builder fee. This matching recipe is restricted to independently established USDC fee scope. A non-USDC native fee token, or an export without sufficient currency evidence, remains unproven; never apply an FX guess. Compare against **all** owner fills in that exact instrument/time window so a different order cannot accidentally match. Require one-to-one cardinality. Duplicate indistinguishable rows, rounding differences, missing fee fields, insufficient time precision or incomplete native history must produce `ambiguous`/`unproven`, not a guessed match. Do not round values to force agreement. The URL names the credited builder; the unique row mapping connects it to the observed fill, subject to these limitations.

A historical single-fill reproduction was integration-tested using one native account read and a unique builder-export row match. This establishes the historical mapping method; credit for a new SDK/MCP order remains a separate unverified requirement.

The audited 5 October file contained 61 rows and had a 6 October 01:03:54 UTC Last-Modified timestamp. This is a single observation, **not a promised daily publication deadline**. Official documentation gives no publication-delay SLA. A missing or HTTP-403 file can mean unavailable/not-yet-published data; it does not prove zero fills, zero credit, or permission to repeat a trade.

## Testnet limit and current completion state

No official testnet builder-fill export contract was found. The guessed `/Testnet/builder_fills/...` paths returned HTTP 403 during the audit. That does not prove no facility can exist; it means this guide cannot claim a supported testnet export. **Do not silently read the Mainnet file as proof for a testnet order.**

Aggregate venue credit for the canonical builder is verifiable now on testnet through `referral`. Credit for a **new** SDK/MCP test order remains unverified until the dedicated approved testnet signer/account, funded collateral, appropriate builder approval, actual fills, and sufficient authoritative credit evidence are available. The lifecycle itself and per-order builder attribution are separate gates. No mainnet order is authorised to close this gap. Seek a supported venue testnet attribution source or explicitly report per-order attribution unproven rather than weaken the completion requirement.
