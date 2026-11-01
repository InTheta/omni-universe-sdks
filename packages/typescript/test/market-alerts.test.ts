import test from "node:test";
import assert from "node:assert/strict";
import {x402Client} from "@x402/core/client";
import {encodePaymentResponseHeader} from "@x402/core/http";
import {OmniX402Client,OmniMcpClient,validateMcpToolArguments,parseMcpToolJson,OmniContractError} from "../src/index.js";
const receipt={success:true,network:"eip155:84532" as const,transaction:`0x${"ab".repeat(32)}`};
const envelope={service:"omni.public_market_alerts",schema:"public_market_alerts.v1",symbol:"xyz:SPCX",venue:"hyperliquid",market_type:"perp",events:[],coverage:{sampled:true,complete_window:"unknown",quiet_window_proven:false}};
test("market alert REST/MCP recipes retain exact namespace, cursor and public event identity",async()=>{
  let seen:URL|undefined;
  const client=new OmniX402Client({paymentClient:new x402Client(),fetch:async(input)=>{
    seen=new URL(input instanceof Request?input.url:String(input));return Response.json(envelope,{headers:{"payment-response":encodePaymentResponseHeader(receipt)}});
  }});
  const cursor=Date.now()-60_000;
  const result=await client.marketAlerts("xyz:SPCX",{limit:20,lookback_hours:24,before_timestamp:cursor,types:["large_trader_action","large_liquidation"]});
  assert.equal(seen?.pathname,"/api/x402/v1/market-alerts/xyz%3ASPCX");assert.equal(seen?.searchParams.get("before_timestamp"),String(cursor));assert.equal(seen?.searchParams.get("types"),"large_trader_action,large_liquidation");
  assert.equal(result.data.coverage.complete_window,"unknown");assert.equal(result.data.coverage.quiet_window_proven,false);
  const mcp=Object.create(OmniMcpClient.prototype) as OmniMcpClient;
  mcp.callJsonTool=async(name,args)=>{assert.equal(name,"get_market_alerts");assert.equal(args?.symbol,"xyz:SPCX");return {data:envelope,payment:receipt,raw:{}} as never;};
  assert.equal((await mcp.marketAlertsData("xyz:SPCX",{limit:1})).data.symbol,"xyz:SPCX");
});
test("market alert query rejects unsupported, future, private and unbounded requests before transport",async()=>{
  let calls=0;const client=new OmniX402Client({paymentClient:new x402Client(),fetch:async()=>{calls++;throw new Error("must not fetch");}});
  const invalid=[{limit:21},{lookback_hours:25},{before_timestamp:1_700_000_000},{before_timestamp:Date.now()+86_400_000},{types:[]},{types:["large_liquidation","large_liquidation"]},{types:["liquidation_burst"]},{chat_id:"private"}];
  for(const query of invalid){await assert.rejects(client.marketAlerts("BTC",query as never));assert.throws(()=>validateMcpToolArguments("get_market_alerts",{...query,symbol:"BTC"}));}
  await assert.rejects(client.marketAlerts("BTC/../../private"));assert.equal(calls,0);
});
test("market alert paid result mismatches require reconciliation and cannot be silently retried",async()=>{
  for(const patch of [{events:[null]},{symbol:"BTC"},{events:[{symbol:"xyz:SPCX",address:"0x123"}]},{schema:"other.v1"}]){
    const client=new OmniX402Client({paymentClient:new x402Client(),fetch:async()=>Response.json({...envelope,...patch},{headers:{"payment-response":encodePaymentResponseHeader(receipt)}})});
    await assert.rejects(client.marketAlerts("xyz:SPCX"),(error:unknown)=>{assert(error instanceof OmniContractError);assert.equal(error.requiresReconciliation,true);assert.equal(error.retryable,false);return true;});
  }
  assert.throws(()=>parseMcpToolJson("get_market_alerts",{content:[{type:"text",text:JSON.stringify(envelope)}],paymentMade:false,paymentResponse:receipt}));
});
