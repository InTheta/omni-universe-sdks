import test from "node:test";
import assert from "node:assert/strict";
import {x402Client} from "@x402/core/client";
import {encodePaymentResponseHeader} from "@x402/core/http";
import {OmniX402Client,parseMcpScreenshot,validateMcpToolArguments,validateMcpToolResult,OmniContractError} from "../src/index.js";
const receipt={success:true,network:"eip155:84532" as const,transaction:`0x${"ab".repeat(32)}`};
test("expanded HTTP recipes retain qualified identity, bounded parameters and product schemas",async()=>{
  const seen:string[]=[];
  const client=new OmniX402Client({paymentClient:new x402Client(),fetch:async(input)=>{
    const u=new URL(input instanceof Request?input.url:String(input));seen.push(u.pathname);
    const history=u.pathname.includes("funding-history");
    return Response.json({service:history?"omni.hyperliquid_funding_history":"omni.hyperliquid_market_microstructure",schema:history?"hyperliquid_funding_history.v1":"hyperliquid_market_microstructure.v1",...(history?{rows:[]}:{trades:[]})},{headers:{"payment-response":encodePaymentResponseHeader(receipt)}});
  }});
  await client.marketMicrostructure("xyz:SPCX",{depth:10});await client.fundingHistory("xyz:SPCX",{lookback_hours:168,limit:100});
  assert.deepEqual(seen,["/api/x402/v1/market-microstructure/xyz%3ASPCX","/api/x402/v1/funding-history/xyz%3ASPCX"]);
  assert.throws(()=>client.marketMicrostructure("BTC/../../private"));assert.throws(()=>client.fundingHistory("BTC",{lookback_hours:169}));
});
test("MCP parity validates addresses, product-specific coverage, bounds and bucket consistency before transport",()=>{
  assert.deepEqual(validateMcpToolArguments("get_market_microstructure",{symbol:"xyz:SPCX",depth:1}),{symbol:"xyz:SPCX",depth:1});
  assert.deepEqual(validateMcpToolArguments("get_trader_leaderboard",{symbol:"DOGE",rank:"best"}),{symbol:"DOGE",rank:"best"});
  assert.throws(()=>validateMcpToolArguments("get_trader_profile",{address:"0x123"}));
  assert.throws(()=>validateMcpToolArguments("get_liquidation_levels_screenshot",{symbol:"xyz:SPCX"}));
  assert.throws(()=>validateMcpToolArguments("get_liquidation_bucket_screenshot",{symbol:"BTC",price:100,price_end:110,bucket_size:20}));
  assert.throws(()=>validateMcpToolArguments("get_funding_history",{symbol:"BTC",limit:169}));
  assert.throws(()=>validateMcpToolArguments("get_market_snapshot",{symbol:"BTC",include_liquidations:"true"}));
});
test("MCP native PNG parsing requires a paid settlement, exact product metadata and bounded PNG bytes",()=>{
  const name="get_liquidation_levels_screenshot" as const;
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=","base64");
  const content=[{type:"image",mimeType:"image/png",data:png.toString("base64")},{type:"text",text:JSON.stringify({service:"omni.liquidation_levels_screenshot",schema:"omni_screenshot.v1",product:name,bytes:png.length})}];
  const raw={content,paymentMade:true,paymentResponse:receipt};
  assert.equal(parseMcpScreenshot(name,raw).data.byteLength,png.length);
  assert.throws(()=>parseMcpScreenshot(name,{...raw,paymentMade:false}),OmniContractError);
  assert.throws(()=>parseMcpScreenshot(name,{...raw,paymentResponse:{success:false}}),OmniContractError);
  assert.throws(()=>parseMcpScreenshot(name,raw,8),OmniContractError);
  assert.throws(()=>parseMcpScreenshot("get_trader_profile_screenshot",raw),OmniContractError);
  assert.throws(()=>parseMcpScreenshot(name,{...raw,content:[{type:"image",mimeType:"image/png",data:"AAAA"}]}),OmniContractError);
});
test("public instrument discovery uses the unsigned transport and never accepts an MCP payment",async()=>{
  const client=new OmniX402Client({paymentClient:new x402Client(),fetch:async()=>Response.json({service:"omni.public_market_catalog",schema:"public_market_catalog.v1",rows:[]})});
  const result=await client.marketInstruments({limit:50,dex:"xyz"});assert.equal(result.payment,null);assert.deepEqual(result.data.rows,[]);
  assert.throws(()=>validateMcpToolArguments("list_market_instruments",{limit:51}));
  assert.throws(()=>validateMcpToolResult("list_market_instruments",{content:[{type:"text",text:"{}"}],paymentMade:true,paymentResponse:receipt}),OmniContractError);
});

test("orderflow recipes preserve exact namespace and reject unbounded or ambiguous windows",async()=>{
  const seen:URL[]=[];
  const client=new OmniX402Client({paymentClient:new x402Client(),fetch:async(input)=>{
    const u=new URL(input instanceof Request?input.url:String(input));seen.push(u);
    const l4=u.pathname.includes("orderbook-l4");
    return Response.json({service:l4?"omni.hyperliquid_l4_snapshot":"omni.hyperliquid_realized_liquidations",schema:l4?"hyperliquid_l4_snapshot.v1":"hyperliquid_realized_liquidations.v1",...(l4?{bids:[]}:{windows:[]})},{headers:{"payment-response":encodePaymentResponseHeader(receipt)}});
  }});
  await client.l4BookSnapshot("xyz:SPCX",{orders_per_side:50});
  await client.realizedLiquidations("xyz:SPCX",{scope:"aggregate",windows:["1m","1h"]});
  assert.equal(seen[0]?.pathname,"/api/x402/v1/orderbook-l4/xyz%3ASPCX");assert.equal(seen[0]?.searchParams.get("orders_per_side"),"50");
  assert.equal(seen[1]?.searchParams.get("windows"),"1m,1h");
  assert.throws(()=>client.l4BookSnapshot("BTC",{orders_per_side:51}));
  assert.throws(()=>client.realizedLiquidations("BTC",{windows:["1m","1m"]}));
  assert.throws(()=>validateMcpToolArguments("get_l4_orderbook",{symbol:"BTC",orders_per_side:51}));
  assert.throws(()=>validateMcpToolArguments("get_realized_liquidations",{symbol:"BTC",windows:["24h"]}));
  assert.deepEqual(validateMcpToolArguments("get_realized_liquidations",{symbol:"xyz:SPCX",windows:["1m","1h"]}),{symbol:"xyz:SPCX",windows:["1m","1h"]});
});

test("spot recipes use explicit pair indices and keep metadata discovery unsigned",async()=>{
  const seen:URL[]=[];
  const client=new OmniX402Client({paymentClient:new x402Client(),fetch:async(input)=>{
    const u=new URL(input instanceof Request?input.url:String(input));seen.push(u);
    if(u.pathname.endsWith("spot-markets"))return Response.json({service:"omni.public_spot_market_catalog",schema:"public_spot_market_catalog.v1",rows:[]});
    const candle=u.pathname.includes("spot-candles");
    return Response.json({service:candle?"omni.hyperliquid_spot_candles":"omni.hyperliquid_spot_quote",schema:candle?"hyperliquid_spot_candles.v1":"hyperliquid_spot_quote.v1",market:{market_id:`hyperliquid:spot:${u.pathname.split("/").at(-1)}`,market_type:"spot",pair_index:Number(u.pathname.split("/").at(-1)),source_coin:u.pathname.endsWith("/0")?"PURR/USDC":"@"+u.pathname.split("/").at(-1)},...(candle?{candles:[]}:{})},{headers:{"payment-response":encodePaymentResponseHeader(receipt)}});
  }});
  assert.equal((await client.spotMarketInstruments({limit:25,revision:"a".repeat(64)})).payment,null);
  await client.spotMarketQuote(0,{depth:20});await client.spotCandles(107,{interval:"5m",limit:200});
  assert.equal(seen[1]?.pathname,"/api/x402/v1/spot-quote/0");assert.equal(seen[2]?.pathname,"/api/x402/v1/spot-candles/107");
  for(const index of [-1,1.5,10000000,NaN])await assert.rejects(client.spotMarketQuote(index));
  await assert.rejects(client.spotCandles(0,{limit:201}));
  assert.throws(()=>validateMcpToolArguments("get_spot_market_quote",{symbol:"BTC",pair_index:0}));
  assert.throws(()=>validateMcpToolArguments("get_spot_candles",{pair_index:"107"}));
  assert.throws(()=>validateMcpToolArguments("list_spot_market_instruments",{revision:"123"}));
  assert.deepEqual(validateMcpToolArguments("get_spot_candles",{pair_index:107,interval:"5m",limit:200}),{pair_index:107,interval:"5m",limit:200});
  assert.throws(()=>validateMcpToolResult("list_spot_market_instruments",{content:[{type:"text",text:"{}"}],paymentMade:true,paymentResponse:receipt}),OmniContractError);
  const wrong=new OmniX402Client({paymentClient:new x402Client(),fetch:async()=>Response.json({service:"omni.hyperliquid_spot_quote",schema:"hyperliquid_spot_quote.v1",market:{market_id:"hyperliquid:spot:1",market_type:"spot",pair_index:1,source_coin:"@1"}},{headers:{"payment-response":encodePaymentResponseHeader(receipt)}})});
  await assert.rejects(wrong.spotMarketQuote(0),(e:unknown)=>{assert(e instanceof OmniContractError);assert.equal(e.requiresReconciliation,true);assert.equal(e.retryable,false);return true;});
});
