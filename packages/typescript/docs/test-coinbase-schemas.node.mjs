// Adapted from the reviewed Terminal migration283328a5; no network or real keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import {generateKeyPairSync} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
const cdpPath=path.resolve('node_modules/@coinbase/cdp-sdk');
const esm=await import(pathToFileURL(path.join(cdpPath,'_esm/policies/evmSchema.js')));
const cjs=createRequire(import.meta.url)(path.join(cdpPath,'_cjs/policies/evmSchema.js'));
const auth=await import(pathToFileURL(path.join(cdpPath,'_esm/auth/index.js')));
const {jwtVerify}=await import('jose');
test('migration refuses unreviewed source before either write and is idempotent',()=>{
 const root=fs.mkdtempSync(path.join(tmpdir(),'codex-test-cdp-schema-'));
 try{
  const script=fileURLToPath(new URL('./migrate-coinbase-schemas.cjs',import.meta.url));
  const originals=[];
  for(const[format,ns]of[['_esm','z'],['_cjs','zod_2.z']]){
   const dest=path.join(root,'node_modules/@coinbase/cdp-sdk',format,'policies/evmSchema.js');fs.mkdirSync(path.dirname(dest),{recursive:true});
   const original=fs.readFileSync(path.join(cdpPath,format,'policies/evmSchema.js'),'utf8').replace('types: '+ns+'.record('+ns+'.string(), '+ns+'.array(','types: '+ns+'.record('+ns+'.array(');
   fs.writeFileSync(dest,original);originals.push([dest,original]);
  }
  const run=(...args)=>spawnSync(process.execPath,[script,'--root',root,...args],{encoding:'utf8'});
  assert.notEqual(run('--check').status,0);
  fs.appendFileSync(originals[1][0],'\n// unreviewed');assert.notEqual(run().status,0);assert.equal(fs.readFileSync(originals[0][0],'utf8'),originals[0][1]);
  fs.writeFileSync(...originals[1]);assert.equal(run().status,0);assert.equal(run('--check').status,0);
  const first=fs.readFileSync(originals[0][0],'utf8');assert.equal(run().status,0);assert.equal(fs.readFileSync(originals[0][0],'utf8'),first);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('installed tree contains only patched Zod4 and reviewed CDP1.60',()=>{
 const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'));
 const entries=Object.entries(lock.packages).filter(([n])=>n.endsWith('/zod'));
 assert.ok(entries.length);for(const[,e]of entries)assert.equal(e.version,'4.6.7');
 assert.equal(JSON.parse(fs.readFileSync(path.join(cdpPath,'package.json'),'utf8')).version,'1.60.0');
});
for(const[format,sdk]of[['ESM',esm],['CommonJS',cjs]]){
 test(format+' EIP712 map retains names and rejects malformed values',()=>{
  const map=sdk.SignEvmTypedDataFieldCriterionSchema.shape.types;
  const input={primaryType:'Transfer',types:{Transfer:[{name:'to',type:'address'},{name:'amount',type:'uint256'}]}};
  assert.deepEqual(map.parse(input),input);
  assert.equal(map.safeParse({...input,types:{Transfer:[{name:7,type:'address'}]}}).success,false);
  assert.equal(map.safeParse({...input,types:{Transfer:'not-an-array'}}).success,false);
 });
 test(format+' oversized address collection fails with one early bound issue',()=>{
  const r=sdk.SignEvmTypedDataVerifyingContractCriterionSchema.safeParse({type:'evmTypedDataVerifyingContract',operator:'in',addresses:Array(10000).fill('invalid')});
  assert.equal(r.success,false);assert.equal(r.error.issues.length,1);assert.equal(r.error.issues[0].code,'too_big');
 });
}
test('patched validator rejects oversized collections before element refinements',()=>{
 let walked=0;const r=z.array(z.string().refine(()=>{walked++;return true;})).max(2).safeParse(Array(10000).fill('x'));
 assert.equal(r.success,false);assert.equal(walked,0);assert.equal(r.error.issues.length,1);
});
for(const kind of ['ed25519','ec'])test('official CDP '+kind+' JWT verifies with synthetic public key and exact URI',async()=>{
 const keys=kind==='ec'?generateKeyPairSync('ec',{namedCurve:'prime256v1'}):generateKeyPairSync('ed25519');
 const secret=kind==='ec'?keys.privateKey.export({type:'pkcs8',format:'pem'}):Buffer.concat([keys.privateKey.export({type:'pkcs8',format:'der'}).subarray(-32),keys.publicKey.export({type:'spki',format:'der'}).subarray(-32)]).toString('base64');
 const token=await auth.generateJwt({apiKeyId:'organizations/fixture/apiKeys/fixture',apiKeySecret:secret,requestMethod:'GET',requestHost:'api.cdp.coinbase.com',requestPath:'/platform/v2/x402/supported',expiresIn:120});
 const {payload,protectedHeader}=await jwtVerify(token,keys.publicKey,{algorithms:[kind==='ec'?'ES256':'EdDSA'],issuer:'cdp',subject:'organizations/fixture/apiKeys/fixture'});
 assert.deepEqual(payload.uris,['GET api.cdp.coinbase.com/platform/v2/x402/supported']);assert.equal(protectedHeader.kid,'organizations/fixture/apiKeys/fixture');assert.equal(typeof protectedHeader.nonce,'string');
 assert.ok(payload.exp-payload.nbf<=120);assert.ok(payload.exp>Math.floor(Date.now()/1000));
});
