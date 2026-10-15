import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { x402Client } from "@x402/core/client";
import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { OmniX402Client, OmniContractError, OmniApiError, OmniPaymentError, createEvmPaymentClient, OMNI_USDC_ASSETS, OMNI_X402_RECEIVER } from "../src/index.js";

const png=Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=","base64"));
const receipt={success:true,network:"eip155:84532" as const,transaction:`0x${"ab".repeat(32)}`,payer:`0x${"12".repeat(20)}`};
const headers=()=>({"content-type":"image/png","payment-response":encodePaymentResponseHeader(receipt)});
const response=(body:BodyInit=png,extra:Record<string,string>={})=>new Response(body,{headers:{...headers(),...extra}});
const address=`0x${"12".repeat(20)}`;

test("all three public screenshot methods use exact routes and return bounded PNG bytes plus settlement metadata",async()=>{
 const seen:string[]=[];
 const client=new OmniX402Client({paymentClient:new x402Client(),fetch:async(input,init)=>{const req=input instanceof Request?input:new Request(input,init);seen.push(req.url);assert.equal(req.headers.get("accept"),"image/png");assert.equal(req.redirect,"error");return response();}});
 for(const result of [await client.liquidationLevelsScreenshot("BTC",{interval:"1d",layout:"standard"}),await client.liquidationBucketScreenshot("ETH",{price:2500,side:"sell",scope:"aggregate"}),await client.traderProfileScreenshot(address,{range:"30d",tab:"mixed",mode:"stats",symbol:"SOL"})]){
  assert.deepEqual(result.data.bytes,png);assert.equal(result.data.byteLength,png.length);assert.equal(result.data.contentType,"image/png");assert.equal(result.payment?.transaction,receipt.transaction);
 }
 assert.deepEqual(seen,["https://omniterminal.app/api/x402/v1/screenshots/liquidation-levels/BTC?interval=1d&layout=standard","https://omniterminal.app/api/x402/v1/screenshots/liquidation-bucket/ETH?price=2500&side=sell&scope=aggregate",`https://omniterminal.app/api/x402/v1/screenshots/trader-profile/${address}?range=30d&tab=mixed&mode=stats&symbol=SOL`]);
});

test("PNG methods reject invalid parameters without any fetch or signing",async()=>{
 const client=new OmniX402Client({paymentClient:new x402Client(),fetch:async()=>{assert.fail("invalid arguments must never reach transport");}});
 assert.throws(()=>client.liquidationBucketScreenshot("BTC",{price:NaN}));
 assert.throws(()=>client.liquidationBucketScreenshot("BTC",{price:1_000_000_001}));
 assert.throws(()=>client.liquidationBucketScreenshot("BTC",{price:100,side:"long" as never}));
 assert.throws(()=>client.liquidationLevelsScreenshot("BAD" as never));
 assert.throws(()=>client.traderProfileScreenshot("invalid"));
 assert.throws(()=>client.traderProfileScreenshot(address,{tab:"balances" as never}));
 assert.throws(()=>new OmniX402Client({paymentClient:new x402Client(),maxScreenshotBytes:17*1024*1024}));
 assert.throws(()=>new OmniX402Client({paymentClient:new x402Client(),screenshotTimeoutMs:NaN}));
});

test("invalid PNG contracts and missing/failed settlement metadata fail closed",async()=>{
 const responses=[response("not a png"),response(png,{"content-type":"application/json"}),response(png,{"content-length":"1"}),response(png,{"payment-response":"invalid-secret-proof"}),response(png,{"payment-response":encodePaymentResponseHeader({...receipt,success:false})}),new Response(png,{headers:{"content-type":"image/png"}})];
 for(const value of responses){const client=new OmniX402Client({paymentClient:new x402Client(),fetch:async()=>value});await assert.rejects(client.liquidationLevelsScreenshot("BTC"),OmniContractError);}
});

test("streamed and declared PNG oversize cancel the body rather than buffering unbounded data",async()=>{
 let cancelled=0;
 for(const declared of [false,true]){
  const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(png);},cancel(){cancelled++;}});
  const value=new Response(body,{headers:{...headers(),...(declared?{"content-length":String(png.length)}:{})}});
  const client=new OmniX402Client({paymentClient:new x402Client(),maxScreenshotBytes:8,fetch:async()=>value});
  await assert.rejects(client.liquidationLevelsScreenshot("BTC"),/byte budget/);
 }
 assert.equal(cancelled,2);
});

test("PNG stream and HTTP failures do not expose untrusted proof text or trigger a retry",async()=>{
 let calls=0;
 const secret="fixture-payment-proof-must-never-escape";
 for(const mode of ["http","stream","transport"]){
  const client=new OmniX402Client({paymentClient:new x402Client(),fetch:async()=>{calls++;if(mode==="transport")throw Error(secret);if(mode==="http")return new Response(secret,{status:503});return response(new ReadableStream({start(c){c.error(Error(secret));}}));}});
  await assert.rejects(client.liquidationLevelsScreenshot("BTC"),(error:unknown)=>{
   assert.ok(error instanceof OmniApiError||error instanceof OmniPaymentError);assert.ok(!JSON.stringify(error).includes(secret));assert.ok(!String(error).includes(secret));return true;
  });
 }
 assert.equal(calls,3);
});

test("PNG transport uses ordinary exact-resource payment binding and shared aggregate authorization limits",async()=>{
 const path="/api/x402/v1/screenshots/liquidation-levels/BTC";
 let calls=0;
 const payer=createEvmPaymentClient(`0x${"11".repeat(32)}`,{allowedNetworks:["eip155:84532"],maxPaymentUsd:0.01,maxTotalPaymentUsd:0.01,maxPaymentAuthorizations:1});
 const client=new OmniX402Client({paymentClient:payer,fetch:async(input,init)=>{
  calls++;
  const req=input instanceof Request?input:new Request(input,init);
  if(req.headers.has("payment-signature"))return response();
  return new Response(null,{status:402,headers:{"payment-required":encodePaymentRequiredHeader({x402Version:2,resource:{url:req.url},accepts:[{scheme:"exact",network:"eip155:84532",asset:OMNI_USDC_ASSETS["eip155:84532"][0],amount:"10000",payTo:OMNI_X402_RECEIVER,maxTimeoutSeconds:60,extra:{name:"USDC",version:"2"}}]})}});
 }});
 const result=await client.liquidationLevelsScreenshot("BTC");assert.equal(result.data.byteLength,png.length);assert.equal(calls,2);
 await assert.rejects(client.liquidationLevelsScreenshot("BTC"),OmniPaymentError);assert.equal(calls,3);
 const mismatch=new OmniX402Client({paymentClient:payer,fetch:async()=>new Response(null,{status:402,headers:{"payment-required":encodePaymentRequiredHeader({x402Version:2,resource:{url:"https://omniterminal.app"+path+"?different=true"},accepts:[]})}})});
 await assert.rejects(mismatch.liquidationLevelsScreenshot("BTC"),OmniContractError);
});

async function boundedFailure(promise:Promise<unknown>):Promise<unknown>{
 let timer:ReturnType<typeof setTimeout>;
 try{return await Promise.race([promise.then(()=>"unexpected_success",error=>error),new Promise(resolve=>{timer=setTimeout(()=>resolve("still_pending"),500);})]);}
 finally{clearTimeout(timer!);}
}

test("PNG deadline bounds stalled body reads and cleanup even when custom fetch ignores abort",async()=>{
 let cancelled=0;
 const body=new ReadableStream<Uint8Array>({cancel(){cancelled++;return new Promise(()=>{});}});
 const client=new OmniX402Client({paymentClient:new x402Client(),screenshotTimeoutMs:10,fetch:async()=>response(body)});
 const error=await boundedFailure(client.liquidationLevelsScreenshot("BTC"));
 assert.ok(error instanceof OmniPaymentError);assert.equal(error.name,"TimeoutError");assert.equal(cancelled,1);
});

test("PNG oversize and header rejection never await an adapter cancellation promise",async()=>{
 for(const badHeader of [false,true]){
  let cancelled=0;
  const body=new ReadableStream<Uint8Array>({start(c){if(!badHeader)c.enqueue(png);},cancel(){cancelled++;return new Promise(()=>{});}});
  const client=new OmniX402Client({paymentClient:new x402Client(),maxScreenshotBytes:8,screenshotTimeoutMs:50,fetch:async()=>response(body,badHeader?{"content-type":"text/plain"}:{})});
  assert.ok(await boundedFailure(client.liquidationLevelsScreenshot("BTC")) instanceof OmniContractError);assert.equal(cancelled,1);
 }
});

test("a late challenge from an abort-ignoring adapter cannot create a payment after caller timeout",async()=>{
 let finish!:(response:Response)=>void;
 let authorizations=0;
 const payer=createEvmPaymentClient(`0x${"11".repeat(32)}`,{allowedNetworks:["eip155:84532"],maxPaymentAuthorizations:1});
 payer.onBeforePaymentCreation(async()=>{authorizations++;});
 const client=new OmniX402Client({paymentClient:payer,screenshotTimeoutMs:10,fetch:async()=>new Promise(resolve=>{finish=resolve;})});
 const error=await boundedFailure(client.liquidationLevelsScreenshot("BTC"));
 assert.ok(error instanceof OmniPaymentError);assert.equal(error.name,"TimeoutError");
 finish(new Response(null,{status:402,headers:{"payment-required":encodePaymentRequiredHeader({x402Version:2,resource:{url:"https://omniterminal.app/api/x402/v1/screenshots/liquidation-levels/BTC"},accepts:[{scheme:"exact",network:"eip155:84532",asset:OMNI_USDC_ASSETS["eip155:84532"][0],amount:"10000",payTo:OMNI_X402_RECEIVER,maxTimeoutSeconds:60,extra:{name:"USDC",version:"2"}}]})}}));
 await new Promise(resolve=>setTimeout(resolve,20));assert.equal(authorizations,0);
});

test("native fetch gzip PNG uses the decoded byte cap, not encoded Content-Length",async()=>{
 const compressed=gzipSync(png);
 assert.ok(compressed.length>png.length,"fixture must expose a wire length larger than decoded PNG");
 const server=createServer((_req,res)=>{res.writeHead(200,{...headers(),"content-encoding":"gzip","content-length":String(compressed.length)});res.end(compressed);});
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 try{
  const address=server.address();assert.ok(address&&typeof address!=="string");
  const baseUrl=`http://127.0.0.1:${address.port}`;
  const client=new OmniX402Client({baseUrl,paymentClient:new x402Client(),maxScreenshotBytes:png.length});
  const result=await client.liquidationLevelsScreenshot("BTC");assert.deepEqual(result.data.bytes,png);assert.equal(result.data.byteLength,png.length);
  const small=new OmniX402Client({baseUrl,paymentClient:new x402Client(),maxScreenshotBytes:8});
  await assert.rejects(small.liquidationLevelsScreenshot("BTC"),/byte budget/);
 }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
