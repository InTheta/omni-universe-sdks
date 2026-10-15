import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const helper = resolve("examples/agents/builder-attribution-readonly.mjs");
const fixture = `import {writeSync} from 'node:fs';
let calls=0;
process.on('exit',()=>writeSync(2,'FIXTURE_READS:'+calls+'\\n'));
globalThis.fetch=async(url,init)=>{
 if(++calls!==1)throw new Error('More than one read');
 if(init.redirect!=='error')throw new Error('Redirects must be refused');
 if(String(url)!=='https://api.hyperliquid-testnet.xyz/info')throw new Error('Wrong endpoint');
 const request=JSON.parse(init.body);
 let response;
 if(request.type==='referral'){
  if(request.user!=='0x733f40a4fa0cd13d59abade04b9ed2e9acac6457')throw new Error('Wrong builder');
  response={builderRewards:'0.123456',tokenToState:[[0,{builderRewards:'0.123456',unrelated:'OMIT_ME'}]],unrelated:'OMIT_ME'};
 } else if(request.type==='orderStatus')response={status:'order',order:{status:'filled',statusTimestamp:1500,order:{oid:123,cloid:request.oid,coin:'BTC',side:'B',limitPx:'100000',origSz:'0.0001',sz:'0',reduceOnly:false,timestamp:1000,unrelated:'OMIT_ME'}}};
 else if(request.type==='userFillsByTime'){
  if(request.aggregateByTime!==false)throw new Error('Aggregation must be disabled');
  response=[{coin:'BTC',side:'B',px:'100000',sz:'0.0001',time:1500,oid:123,tid:456,hash:'0x'+'ab'.repeat(32),crossed:true,fee:'0.001',builderFee:'0.0001',feeToken:'USDC',unrelated:'OMIT_ME'}];
 }else throw new Error('Unexpected method');
 const variant=process.env.FIXTURE_VARIANT;
 if(variant==='bad-reward')response.builderRewards='NaN';
 if(variant==='bad-token')response.tokenToState=[[0,{}]];
 if(variant==='duplicate-token')response.tokenToState.push([0,{builderRewards:'1'}]);
 if(variant==='missing-tokens')delete response.tokenToState;
 if(variant==='wrong-cloid')response.order.order.cloid='0x'+'22'.repeat(16);
 if(variant==='wrong-symbol')response.order.order.coin='ETH';
 if(variant==='unsafe-order')response.order.order.oid=9007199254740992;
 if(variant==='bad-order-time')response.order.statusTimestamp=999;
 if(variant==='out-of-window')response[0].time=2001;
 if(variant==='unsafe-fill')response[0].oid=9007199254740992;
 if(variant==='aliased-fill')response[0].oid='00123';
 if(variant==='unsafe-trade')response[0].tid=9007199254740992;
 if(variant==='bad-builder-fee')response[0].builderFee='-0.1';
 if(variant==='bad-side')response[0].side='buy';
 if(variant==='bad-decimal')response[0].px='1e5';
 if(variant==='bad-token-name')response[0].feeToken='';
 if(variant==='non-usdc')response[0].feeToken='USDH';
 return Response.json(response);
};`;
const owner = `0x${"11".repeat(20)}`;
const cloid = `0x${"11".repeat(16)}`;

test("read-only builder helper validates scope and financial fields before persisting proof", async () => {
  const directory = await mkdtemp(join(tmpdir(), "omni-builder-proof-test-"));
  const fixturePath = join(directory, "fixture.mjs");
  await writeFile(fixturePath, fixture);
  let index = 0;
  const run = (mode: string, variant = "", input?: string[], network = "testnet") => {
    const output = join(directory, `proof-${++index}.json`);
    const args = input ?? (mode === "order" ? [owner, cloid, "BTC"] : mode === "fills" ? [owner, "1000", "2000", "BTC", "123"] : []);
    const result = spawnSync(process.execPath, ["--import", pathToFileURL(fixturePath).href, helper, mode, network, output, ...args], {encoding: "utf8", timeout: 15000, env: {...process.env, FIXTURE_VARIANT: variant}});
    return {output, result};
  };
  try {
    for (const mode of ["ledger", "order", "fills"]) {
      const {output, result} = run(mode);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stderr, /FIXTURE_READS:1/);
      const raw = await readFile(output, "utf8");
      const proof = JSON.parse(raw);
      assert.doesNotMatch(raw, /OMIT_ME/);
      assert.match(proof.parsedResponseJsonSha256, /^[a-f0-9]{64}$/);
      assert.match(proof.hashInput, /not original HTTP bytes/);
      assert.equal(proof.network, "testnet");
      assert.equal(proof.writesToVenue, 0);
      assert.equal((await stat(output)).mode & 0o777, 0o600);
      if (mode === "ledger") assert.equal(proof.selected.legacyFieldCurrency, "not_inferred");
      if (mode === "order") assert.equal(proof.selected.order.oid, 123);
      if (mode === "fills") assert.equal(proof.selected.matchingOrderFills.length, 1);
      const existing = spawnSync(process.execPath, ["--import", pathToFileURL(fixturePath).href, helper, "ledger", "testnet", output], {encoding: "utf8", timeout: 15000});
      assert.notEqual(existing.status, 0);
      assert.match(existing.stderr, /FIXTURE_READS:0/);
      assert.equal(await readFile(output, "utf8"), raw);
    }
    for (const [mode, variant] of [["ledger", "bad-reward"], ["ledger", "bad-token"], ["ledger", "duplicate-token"], ["order", "wrong-cloid"], ["order", "wrong-symbol"], ["order", "unsafe-order"], ["order", "bad-order-time"], ["fills", "out-of-window"], ["fills", "unsafe-fill"], ["fills", "aliased-fill"], ["fills", "unsafe-trade"], ["fills", "bad-builder-fee"], ["fills", "bad-side"], ["fills", "bad-decimal"], ["fills", "bad-token-name"]]) {
      const {output, result} = run(mode!, variant!);
      assert.notEqual(result.status, 0, `${mode}/${variant} must fail`);
      assert.match(result.stderr, /FIXTURE_READS:1/);
      await assert.rejects(stat(output), {code: "ENOENT"});
    }
    for (const oid of ["00123", "9007199254740992", "1e3", "-1"]) {
      const {output, result} = run("fills", "", [owner, "1000", "2000", "BTC", oid]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /FIXTURE_READS:0/);
      await assert.rejects(stat(output), {code: "ENOENT"});
    }
    const missing = run("ledger", "missing-tokens");
    assert.equal(missing.result.status, 0, missing.result.stderr);
    assert.equal(JSON.parse(await readFile(missing.output, "utf8")).selected.currencyCoverage, "missing_token_breakdown");
    const nonUsdc = run("fills", "non-usdc");
    assert.equal(nonUsdc.result.status, 0, nonUsdc.result.stderr);
    assert.equal(JSON.parse(await readFile(nonUsdc.output, "utf8")).selected.exportAttributionEligibility, "unproven_non_usdc_export_currency");
    const invalidNetwork = run("ledger", "", [], "https://example.com");
    assert.notEqual(invalidNetwork.result.status, 0);
    assert.match(invalidNetwork.result.stderr, /FIXTURE_READS:0/);
  } finally { await rm(directory, {recursive: true, force: true}); }
});
