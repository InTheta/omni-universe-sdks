import {OmniContractError} from "./errors.js";
import type {PublicWalletGraphResult,PublicWalletGraphQuery,PublicWalletLinksQuery,PublicWalletGraphSymbol} from "./types.js";
export type WalletGraphView="graph"|"pair"|"links";
export function walletGraphSymbol(raw:unknown):PublicWalletGraphSymbol {if(typeof raw!=="string"||!["BTC","ETH","SOL"].includes(raw.trim().toUpperCase()))throw new RangeError("wallet graph supports aggregate BTC, ETH or SOL only");return raw.trim().toUpperCase() as PublicWalletGraphSymbol;}
export function walletGraphAddress(raw:unknown):string {if(typeof raw!=="string"||!/^0x[0-9a-fA-F]{40}$/.test(raw))throw new RangeError("wallet graph requires a full public wallet address");return raw.toLowerCase();}
export function validateWalletGraphQuery(query:PublicWalletGraphQuery|PublicWalletLinksQuery,view:WalletGraphView):void {
 if(!query||typeof query!=="object"||Array.isArray(query))throw new TypeError("wallet graph query must be an object");
 const keys=view==="graph"?["limit","edge_limit"]:view==="links"?["limit"]:[];
 for(const key of Object.keys(query))if(!keys.includes(key))throw new RangeError("unknown wallet graph query");
 for(const [key,value]of Object.entries(query)){const max=key==="edge_limit"?100:50;if(value!==undefined&&(typeof value!=="number"||!Number.isSafeInteger(value)||value<1||value>max))throw new RangeError("unbounded wallet graph query");}
}
export function walletGraphPaidFailure(error:unknown):never {if(error instanceof OmniContractError)Object.defineProperties(error,{requiresReconciliation:{value:true,enumerable:true},retryable:{value:false,enumerable:true},paymentOutcome:{value:"unconfirmed",enumerable:true}});throw error;}
export function assertWalletGraphIdentity(data:PublicWalletGraphResult,symbol:string,view:WalletGraphView,query:PublicWalletGraphQuery|PublicWalletLinksQuery={},a?:string,b?:string):void {
 const reject=():never=>walletGraphPaidFailure(new OmniContractError("Paid wallet graph response has an invalid scope, view, provenance or wallet identity","wallet-graph",undefined));
 const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
 const count=(v:unknown,max=1e9):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0&&v<=max;
 const clock=(v:unknown):number=>typeof v==="string"&&/(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v))&&Date.parse(v)>=1e12&&Date.parse(v)<=Date.now()+5000?Date.parse(v):NaN;
 const address=(v:unknown):v is string=>typeof v==="string"&&/^0x[0-9a-f]{40}$/.test(v);
 const score=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=1;
 if(!record(data)||data.service!=="omni.public_wallet_graph"||data.schema!=="public_wallet_graph.v1"||data.product_version!=="v1"||data.view!==view||data.symbol!==symbol||data.window!=="24h"||data.bucket!=="5m"||data.market_scope!=="observed_hyperliquid_perpetual_base_symbol_across_dexes"||!Array.isArray(data.nodes))return reject();
 const m=data.methodology,p=data.source_quality,c=data.coverage,f=data.freshness;
 if(!record(m)||m.method!=="nearest_neighbor_exposure_behavior_heuristic"||m.identity_proof!==false||m.history_bucket_basis!=="database_persistence_time"||[m.run_id,m.graph_version,m.feature_version,m.model_version,m.algo_version].some(v=>typeof v!=="string"||!/^[-a-zA-Z0-9._:]{1,100}$/.test(v)))return reject();
 if(!record(p)||!count(p.live_rows)||p.live_rows===0||p.qualified_live_rows!==p.live_rows||!count(p.history_rows)||p.history_rows===0||p.qualified_history_rows!==p.history_rows||p.population_complete!=="unknown"||p.complete_window!=="unknown"||p.excluded_population!=="configured_observed_population_filter")return reject();
 const earliest=clock(p.source_observed_min),through=clock(p.source_observed_through),hmin=clock(p.history_observed_min),hmax=clock(p.history_observed_through),generated=clock(data.artifact_generated_at);
 if([earliest,through,hmin,hmax,generated,clock(data.generated_at)].some(v=>!Number.isFinite(v))||earliest>through||hmin>hmax||through>generated||hmax>generated||data.data_as_of!==p.source_observed_min||!record(f)||f.data_as_of!==p.source_observed_min||f.basis!=="hyperliquid_clearinghouse_state_time_v1"||!["fresh","stale","unknown"].includes(String(f.status)))return reject();
 if(f.max_age_seconds!==300||f.status==="fresh"&&earliest<Date.now()-305000||f.age_seconds!==null&&!count(f.age_seconds))return reject();
 if(!record(c)||!count(c.source_nodes,1000)||!count(c.source_edges,20000)||c.returned_nodes!==data.nodes.length||!count(c.returned_edges,20000)||typeof c.truncated!=="boolean"||c.complete_graph!==false||view!=="graph"&&c.absence_means!=="not_present_in_observed_thresholded_graph")return reject();
 const nodes=new Set<string>();for(const row of data.nodes){if(!record(row)||!address(row.address)||nodes.has(row.address)||Object.keys(row).some(k=>!["address","gross_source_notional","net_source_notional","notional_currency","notional_basis"].includes(k))||typeof row.gross_source_notional!=="number"||!Number.isFinite(row.gross_source_notional)||row.gross_source_notional<0||typeof row.net_source_notional!=="number"||!Number.isFinite(row.net_source_notional)||Math.abs(row.net_source_notional)>row.gross_source_notional+1e-6||row.notional_currency!==null||row.notional_basis!=="upstream_position_value_aggregate_quote_identity_unknown")return reject();nodes.add(row.address);}
 let edges:unknown[];
 if(view==="graph"){if(data.view!=="graph"||!Array.isArray(data.edges)||data.nodes.length>((query as PublicWalletGraphQuery).limit??20)||data.edges.length>((query as PublicWalletGraphQuery).edge_limit??40))return reject();edges=data.edges;}
 else if(view==="pair"){if(data.view!=="pair"||data.wallet_a!==a||data.wallet_b!==b||[...nodes].some(v=>v!==a&&v!==b)||data.pair!==null&&!record(data.pair))return reject();edges=data.pair===null?[]:[data.pair];}
 else {if(data.view!=="links"||data.address!==a||!Array.isArray(data.links)||data.links.length>(query.limit??20))return reject();edges=data.links;}
 if(c.returned_edges!==edges.length||c.source_nodes<data.nodes.length||c.source_edges<edges.length)return reject();
 const pairs=new Set<string>(),participants=new Set<string>(a?[a]:[]);
 for(const row of edges){if(!record(row)||!address(row.source)||!address(row.target)||row.source===row.target||!nodes.has(row.source)||!nodes.has(row.target)||!["behavioral_similarity","direction_alignment","direction_opposition"].includes(String(row.relation))||![row.heuristic_score,row.overlap_score,row.size_similarity_score].every(score)||row.identity_confirmed!==false||row.correlation!==null||row.timing_synchronization!==null||!Array.isArray(row.unavailable_metrics)||row.unavailable_metrics.join(",")!=="correlation,timing_synchronization")return reject();const pair=[row.source,row.target].sort().join(":");if(pairs.has(pair))return reject();pairs.add(pair);if(view==="pair"&&![a,b].includes(row.source)||view==="pair"&&![a,b].includes(row.target)||view==="links"&&row.source!==a&&row.target!==a)return reject();participants.add(row.source);participants.add(row.target);}
 if(view==="links"&&[...nodes].some(v=>!participants.has(v)))return reject();
}
