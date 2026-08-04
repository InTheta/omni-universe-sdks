import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface PackResult {
  filename: string;
  name: string;
  version: string;
  files: Array<{ path: string }>;
}

const packageRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const packageMetadata = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
  name: string;
  version: string;
};
const temporaryRoot = mkdtempSync(join(tmpdir(), "omni-sdk-package-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

try {
  const packOutput = run(npm, ["pack", "--json", "--pack-destination", temporaryRoot], packageRoot);
  const packResults = JSON.parse(packOutput) as PackResult[];
  assert.equal(packResults.length, 1, "npm pack must produce exactly one artifact");
  const packed = packResults[0];
  assert.ok(packed, "npm pack omitted its artifact result");
  assert.equal(packed.name, packageMetadata.name);
  assert.equal(packed.version, packageMetadata.version);

  const paths = packed.files.map((file) => file.path);
  for (const required of [
    "dist/index.js",
    "dist/index.d.ts",
    "dist/brokers/index.js",
    "dist/brokers/index.d.ts",
    "examples/rest-api-key.ts",
    "examples/x402-all-routes.ts",
    "docs/trading-agents.md",
    "README.md",
    "LICENSE",
    "package.json",
  ]) {
    assert.ok(paths.includes(required), `package omitted required file: ${required}`);
  }

  for (const path of paths) {
    assert.doesNotMatch(path, /(^|\/)(src|test|scripts|node_modules)(\/|$)/, `package leaked development file: ${path}`);
    assert.doesNotMatch(path, /(^|\/)\.env(?:\.|$)/, `package leaked environment file: ${path}`);
  }

  const tarball = join(temporaryRoot, packed.filename);
  const consumer = join(temporaryRoot, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  run(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], consumer);

  const expectedVersion = JSON.stringify(packageMetadata.version);
  const smokeTest = `
    import * as sdk from "@omni-terminal/sdk";
    import * as brokers from "@omni-terminal/sdk/brokers";
    const required = ["OmniClient", "OmniMcpClient", "OmniX402Client", "HyperliquidPublicClient", "HyperliquidWebSocketClient"];
    for (const name of required) {
      if (typeof sdk[name] !== "function") throw new Error(\`missing root export: \${name}\`);
    }
    if (sdk.SDK_VERSION !== ${expectedVersion}) {
      throw new Error(\`SDK_VERSION \${sdk.SDK_VERSION} does not match package version ${packageMetadata.version}\`);
    }
    if (typeof brokers.CoinbaseAdvancedTradeClient !== "function") throw new Error("missing Coinbase broker export");
    if (typeof brokers.RobinhoodCryptoClient !== "function") throw new Error("missing Robinhood broker export");
  `;
  run(process.execPath, ["--input-type=module", "--eval", smokeTest], consumer);
  console.log(`Package consumer smoke passed: ${packed.name}@${packed.version} (${paths.length} files)`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(" ")} failed with exit code ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join("\n"));
  }
  return result.stdout.trim();
}
