import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../pages/AdminSetup/Driver.jsx',import.meta.url),'utf8');
const start=source.indexOf('  const loadPromotionRunOrderNumbers = async () => {');
const end=source.indexOf('\n  loadPromotionRunOrderNumbers();',start);
assert.ok(start>=0&&end>start);
const run=new (Object.getPrototypeOf(async function(){}).constructor)('supabase','loggedInUser','setPromotionRunOrderNumbers','setPromotionRunExclusionsLoaded','active',source.slice(start,end)+'\nreturn loadPromotionRunOrderNumbers();');
test('successful Promotion Run exclusions unblock Driver orders and retain the exclusion set',async()=>{
 let ready=false,excluded;
 await run({rpc:async()=>({data:[{order_number:'ORD-PROMOTION'},{order_number:'ORD-PROMOTION'}],error:null})},{username:'fixture',fc_session_token:'fixture'},value=>{excluded=value;},value=>{ready=value;},true);
 assert.equal(ready,true);assert.deepEqual([...excluded],['ORD-PROMOTION']);
});
test('an empty exclusion list still unblocks Driver, while an unmounted request changes no state',async()=>{
 for(const active of [true,false]){let ready=false,writes=0;
 await run({rpc:async()=>({data:[],error:null})},{username:'fixture',fc_session_token:'fixture'},()=>{writes++;},value=>{ready=value;},active);
 assert.equal(ready,active);assert.equal(writes,active?1:0);}
});
