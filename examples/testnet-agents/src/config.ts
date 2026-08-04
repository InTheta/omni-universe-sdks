export const HARD_MAX_TESTNET_NOTIONAL_USD = 25;
export const TESTNET_ORDER_CONFIRMATION = "HYPERLIQUID_TESTNET_ONLY";

export interface TestnetExecutionConfig {
  accountAddress?: `0x${string}`;
  enabled: boolean;
  maxNotionalUsd: number;
  minConfidence: number;
  orderOffsetBps: number;
  privateKey?: `0x${string}`;
  symbol: string;
}

export function readTestnetExecutionConfig(
  env: NodeJS.ProcessEnv = process.env,
): TestnetExecutionConfig {
  const enabled = env.RUN_TESTNET_ORDERS === "true";
  const symbol = (env.TESTNET_SYMBOL || "BTC").trim();
  if (!/^[A-Za-z0-9:_-]{1,24}$/.test(symbol)) {
    throw new RangeError("TESTNET_SYMBOL must contain 1 to 24 market-symbol characters");
  }

  const maxNotionalUsd = readNumber(env.TESTNET_MAX_NOTIONAL_USD, 15, "TESTNET_MAX_NOTIONAL_USD");
  if (maxNotionalUsd < 10 || maxNotionalUsd > HARD_MAX_TESTNET_NOTIONAL_USD) {
    throw new RangeError(`TESTNET_MAX_NOTIONAL_USD must be between 10 and ${HARD_MAX_TESTNET_NOTIONAL_USD}`);
  }
  const minConfidence = readNumber(env.TESTNET_MIN_CONFIDENCE, 0.55, "TESTNET_MIN_CONFIDENCE");
  if (minConfidence < 0 || minConfidence > 1) {
    throw new RangeError("TESTNET_MIN_CONFIDENCE must be between zero and one");
  }
  const orderOffsetBps = readNumber(env.TESTNET_ORDER_OFFSET_BPS, 200, "TESTNET_ORDER_OFFSET_BPS");
  if (!Number.isInteger(orderOffsetBps) || orderOffsetBps < 50 || orderOffsetBps > 500) {
    throw new RangeError("TESTNET_ORDER_OFFSET_BPS must be an integer between 50 and 500");
  }

  const privateKey = optionalPrivateKey(env.HL_TESTNET_PRIVATE_KEY);
  const accountAddress = optionalAddress(env.HL_TESTNET_ACCOUNT_ADDRESS);
  if (enabled) {
    if (env.CONFIRM_TESTNET_ORDER !== TESTNET_ORDER_CONFIRMATION) {
      throw new Error(`CONFIRM_TESTNET_ORDER must equal ${TESTNET_ORDER_CONFIRMATION}`);
    }
    if (!privateKey) throw new Error("HL_TESTNET_PRIVATE_KEY is required when RUN_TESTNET_ORDERS=true");
  }

  return { accountAddress, enabled, maxNotionalUsd, minConfidence, orderOffsetBps, privateKey, symbol };
}

function readNumber(value: string | undefined, fallback: number, name: string): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${name} must be a finite number`);
  return parsed;
}

function optionalPrivateKey(value: string | undefined): `0x${string}` | undefined {
  if (!value?.trim()) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new TypeError("HL_TESTNET_PRIVATE_KEY must be a 32-byte hex key");
  return value as `0x${string}`;
}

function optionalAddress(value: string | undefined): `0x${string}` | undefined {
  if (!value?.trim()) return undefined;
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new TypeError("HL_TESTNET_ACCOUNT_ADDRESS must be a 20-byte EVM address");
  return value as `0x${string}`;
}
