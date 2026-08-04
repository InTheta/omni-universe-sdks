import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { scanPublicBoundary } from "../scripts/verify-public-boundary.js";

test("public boundary scanner reports private infrastructure without flagging public URLs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "omni-sdk-boundary-"));
  try {
    await writeFile(join(directory, "safe.txt"), "https://api.hyperliquid.xyz\nhttps://omniterminal.app\n");
    const privateAddress = ["10", "10", "0", "12"].join(".");
    await writeFile(join(directory, "leak.txt"), `internal=http://${privateAddress}:8010\n`);
    assert.deepEqual(await scanPublicBoundary(directory), [{ file: "leak.txt", rule: "RFC1918 IPv4 address" }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
