import test from 'node:test';
import assert from 'node:assert/strict';
import {mergePendingPriceUpdates,removePendingPriceUpdates,readPendingPriceUpdates,writePendingPriceUpdates} from './priceUpdateQueue.js';
const storage=()=>{const values=new Map();return {getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};};
test('bulk and single database saves accumulate only saved product IDs without duplicates',()=>{
 const queue=mergePendingPriceUpdates(['elux'],['elux','product-b']);
 assert.deepEqual(queue,['elux','product-b']);
 assert.deepEqual(mergePendingPriceUpdates(queue,['single-product']),['elux','product-b','single-product']);
});
test('pending decisions survive page reload and stay separate for each login',()=>{
 const s=storage();writePendingPriceUpdates('login-a',['elux'],s);
 assert.deepEqual(readPendingPriceUpdates('login-a',s),['elux']);
 assert.deepEqual(readPendingPriceUpdates('login-b',s),[]);
});
test('apply removes only selected pending products; clear drops the pending decision',()=>{
 const s=storage();const remaining=removePendingPriceUpdates(['elux','other'],['elux']);
 assert.deepEqual(remaining,['other']);writePendingPriceUpdates('login',remaining,s);
 writePendingPriceUpdates('login',[],s);assert.deepEqual(readPendingPriceUpdates('login',s),[]);
 assert.deepEqual(mergePendingPriceUpdates([],['elux']),['elux']);
});
test('malformed saved queue cannot turn into the whole product catalog',()=>{
 const s=storage();for(const bad of ['invalid','{}','null']) {s.setItem('login',bad);assert.deepEqual(readPendingPriceUpdates('login',s),[]);}
});
