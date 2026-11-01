import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { TradingGateError } from "../errors.js";

/** Qualify the installed optional peer before official authentication receives keys. */
export function assertQualifiedCoinbaseDependency(): void {
  try {
    const require = createRequire(import.meta.url);
    const authFile = require.resolve("@coinbase/cdp-sdk/auth");
    const peerRoot = resolve(dirname(authFile), "../..");
    const peerRequire = createRequire(authFile);
    if (JSON.parse(readFileSync(join(peerRoot,"package.json"),"utf8")).version !== "1.60.0") throw new Error("version");
    for (const [name, expected] of [["zod","4.6.7"],["abitype","1.3.0"]]) {
      if (JSON.parse(readFileSync(peerRequire.resolve(`${name}/package.json`),"utf8")).version !== expected) throw new Error("dependency");
    }
    for (const [format, expected] of [
      ["_esm","0fd1960b56160d2d84d54617ddf6d304c25067f95e2580300fb6a004be35296a"],
      ["_cjs","60517fc6f3d1ae7a6b473bc10e6d336708cdb669550fafd0cd31ab8143806f89"],
    ]) {
      if (createHash("sha256").update(readFileSync(join(peerRoot,format!,"policies/evmSchema.js"))).digest("hex") !== expected) throw new Error("source");
    }
  } catch {
    throw new TradingGateError("Coinbase optional dependency is not security-qualified; follow docs/public-data-coverage.md for the pinned overrides and guarded schema migration before broker use");
  }
}
