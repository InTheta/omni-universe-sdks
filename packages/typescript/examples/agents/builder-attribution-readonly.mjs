import { open, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { HyperliquidPublicClient } from '@omni-terminal/sdk';

const BUILDER = '0x733f40a4fa0cd13d59abade04b9ed2e9acac6457';
const ORIGINS = Object.freeze({testnet: 'https://api.hyperliquid-testnet.xyz', mainnet: 'https://api.hyperliquid.xyz'});
const usage = `One unsigned free /info read; one new private proof file; no retries.
  node builder-attribution-readonly.mjs ledger NETWORK OUTPUT.json
  node builder-attribution-readonly.mjs order NETWORK OUTPUT.json OWNER CLOID SYMBOL
  node builder-attribution-readonly.mjs fills NETWORK OUTPUT.json OWNER START_MS END_MS SYMBOL OID
NETWORK must be exactly testnet or mainnet. No keys, URLs or tokens are accepted.`;
const fail = message => { throw new Error(message); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeId = (value, label, minimum = 0) => {
  const number = typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < minimum || (typeof value === 'string' && String(number) !== value)) fail(`Invalid canonical safe integer ${label}`);
  return number;
};
const time = (value, label) => {
  const number = safeId(value, label, 1);
  if (number > Date.now() + 5000) fail(`Future ${label}`);
  return number;
};
const decimal = (value, label, {signed = false, positive = false} = {}) => {
  if (typeof value !== 'string' || value.length > 80 || !(signed ? /^-?(0|[1-9]\d*)(\.\d+)?$/ : /^(0|[1-9]\d*)(\.\d+)?$/).test(value)) fail(`Invalid decimal ${label}`);
  if (positive && !/[1-9]/.test(value)) fail(`Non-positive ${label}`);
  return value;
};
const address = value => {
  if (!/^0x[0-9a-f]{40}$/i.test(value ?? '')) fail('Exact owning account address required; private keys are not accepted');
  return value.toLowerCase();
};
const symbol = value => {
  if (!/^[A-Za-z0-9:_-]{1,40}$/.test(value ?? '')) fail('Exact instrument symbol required');
  return value;
};
const [mode, network, output, ...args] = process.argv.slice(2);
if (mode === '--help' && process.argv.length === 3) { console.log(usage); process.exit(0); }
if (!Object.hasOwn(ORIGINS, network ?? '') || !output || !['ledger', 'order', 'fills'].includes(mode ?? '')) fail(usage);
let request;
if (mode === 'ledger') {
  if (args.length) fail(usage);
  request = {type: 'referral', user: BUILDER};
} else if (mode === 'order') {
  if (args.length !== 3 || !/^0x[0-9a-f]{32}$/i.test(args[1] ?? '')) fail(usage);
  symbol(args[2]);
  request = {type: 'orderStatus', user: address(args[0]), oid: args[1]};
} else {
  if (args.length !== 5) fail(usage);
  const startTime = time(args[1], 'startTime'), endTime = time(args[2], 'endTime');
  safeId(args[4], 'order ID');
  if (endTime < startTime || endTime - startTime > 600000) fail('Exact window of at most ten minutes required');
  symbol(args[3]);
  request = {type: 'userFillsByTime', user: address(args[0]), startTime, endTime, aggregateByTime: false};
}
const handle = await open(output, 'wx', 0o600);
let completed = false;
try {
  const startedAt = new Date().toISOString();
  const client = new HyperliquidPublicClient({baseUrl: ORIGINS[network], timeoutMs: 15000, maxRetries: 0, fetch: async (input, init) => {
    if (String(input) !== `${ORIGINS[network]}/info`) fail('Refusing non-canonical info endpoint');
    return fetch(input, {...init, redirect: 'error'});
  }});
  const response = await client.info(request);
  let selected;
  if (mode === 'ledger') {
    if (!record(response)) fail('Invalid referral response');
    const builderRewards = decimal(response.builderRewards, 'builderRewards');
    let tokenToState = [];
    const hasTokens = Object.hasOwn(response, 'tokenToState');
    if (hasTokens) {
      if (!Array.isArray(response.tokenToState)) fail('Invalid tokenToState');
      const seen = new Set();
      tokenToState = response.tokenToState.map(row => {
        if (!Array.isArray(row) || row.length !== 2 || !record(row[1])) fail('Invalid token reward row');
        const token = safeId(row[0], 'reward token');
        if (seen.has(token)) fail('Duplicate reward token');
        seen.add(token);
        return {token, builderRewards: decimal(row[1].builderRewards, 'token builderRewards')};
      });
    }
    selected = {builderRewards, legacyFieldCurrency: 'not_inferred', tokenToState, currencyCoverage: hasTokens ? (tokenToState.length ? 'token_indices_only_symbols_not_resolved' : 'empty_token_breakdown') : 'missing_token_breakdown', attribution: 'aggregate_builder_credit_only_no_order_attribution'};
  } else if (mode === 'order') {
    if (record(response) && response.status === 'unknownOid') selected = {status: 'unknownOid', interpretation: 'uncertain_do_not_resubmit'};
    else {
      const order = response?.order?.order;
      if (!record(response) || response.status !== 'order' || !record(response.order) || !record(order) || typeof order.cloid !== 'string' || order.cloid.toLowerCase() !== args[1].toLowerCase() || order.coin !== args[2]) fail('Authoritative order does not match exact cloid and instrument');
      const oid = safeId(order.oid, 'response order ID');
      const timestamp = time(order.timestamp, 'order timestamp');
      const statusTimestamp = time(response.order.statusTimestamp, 'status timestamp');
      if (statusTimestamp < timestamp || typeof response.order.status !== 'string' || !/^[A-Za-z]{1,64}$/.test(response.order.status)) fail('Invalid order status or timestamp');
      if (!['B', 'A'].includes(order.side)) fail('Invalid order side');
      if (typeof order.reduceOnly !== 'boolean') fail('Invalid reduceOnly');
      selected = {status: response.order.status, statusTimestamp, order: {oid, cloid: order.cloid, coin: order.coin, side: order.side, limitPx: decimal(order.limitPx, 'limitPx', {positive: true}), origSz: decimal(order.origSz, 'origSz', {positive: true}), sz: decimal(order.sz, 'remaining size'), reduceOnly: order.reduceOnly, timestamp}};
    }
  } else {
    if (!Array.isArray(response) || response.length > 2000) fail('Invalid or oversized native fills response');
    const allFills = response.map(fill => {
      if (!record(fill)) fail('Invalid native fill');
      const timestamp = time(fill.time, 'fill timestamp');
      if (timestamp < request.startTime || timestamp > request.endTime) fail('Fill outside exact requested time window');
      const oid = safeId(fill.oid, 'fill order ID'), tid = safeId(fill.tid, 'fill trade ID');
      if (!['B', 'A'].includes(fill.side) || typeof fill.crossed !== 'boolean' || !/^0x[0-9a-f]{64}$/i.test(fill.hash ?? '')) fail('Invalid fill side, crossed flag or hash');
      if (typeof fill.feeToken !== 'string' || !/^[A-Za-z0-9:_-]{1,40}$/.test(fill.feeToken)) fail('Invalid fill feeToken');
      return {coin: symbol(fill.coin), side: fill.side, px: decimal(fill.px, 'fill price', {positive: true}), sz: decimal(fill.sz, 'fill size', {positive: true}), time: timestamp, oid, tid, hash: fill.hash, crossed: fill.crossed, fee: decimal(fill.fee, 'fee', {signed: true}), feeToken: fill.feeToken, ...(Object.hasOwn(fill, 'builderFee') ? {builderFee: decimal(fill.builderFee, 'builderFee')} : {})};
    });
    const fills = allFills.filter(fill => fill.coin === args[3]);
    selected = {requestedOrderId: args[4], responseCount: response.length, possiblyTruncated: response.length === 2000, coverage: 'single_recent_response_only_not_complete_history', instrumentFills: fills, matchingOrderFills: fills.filter(fill => String(fill.oid) === args[4]), exportAttributionEligibility: fills.some(fill => fill.feeToken !== 'USDC') ? 'unproven_non_usdc_export_currency' : 'requires_unique_builder_specific_export_match', attribution: 'builder_fee_fields_do_not_identify_builder'};
  }
  const proof = {schema: 'omni.builder-attribution.readonly.v1', startedAt, observedAt: new Date().toISOString(), network, endpoint: `${ORIGINS[network]}/info`, builder: BUILDER, request, parsedResponseJsonSha256: createHash('sha256').update(JSON.stringify(response)).digest('hex'), hashInput: 'UTF-8 JSON.stringify(parsed SDK response); not original HTTP bytes', selected, writesToVenue: 0, paidUsageUsdc: 0};
  await handle.writeFile(`${JSON.stringify(proof, null, 2)}\n`);
  await handle.sync(); completed = true;
  console.log(JSON.stringify({output, mode, network, writesToVenue: 0, paidUsageUsdc: 0}));
} finally {
  await handle.close();
  if (!completed) await unlink(output);
}
