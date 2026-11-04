import assert from "node:assert/strict";
import test from "node:test";
import { saveInvoiceCollection } from "./invoiceCollectionService.js";
import { moneyCents, planInvoiceCollection, previousStatusPaidAmount } from "../utils/invoiceCollectionActions.js";
import { applyAllocationsToInvoices } from "../utils/centralPaymentCalculations.js";
import { resolveInvoiceRowFromAllocations } from "./invoiceAllocationStatus.js";

const invoice = (id, total = 100) => ({ id: `10000000-0000-4000-8000-${String(id).padStart(12,"0")}`, invoice_number: `ORD-${id}`, _collectionReference: `ORD-${id}`, invoice_total: total, remainingAmount: total });
const session = { username: "cash_staff", token: "test-session" };
const baseInput = { customerAccountId: "customer", paymentIntentId: "stable-intent", paymentSource: "SALES_REP_COLLECTION", amount: 0 };

test("previous full and part payments never enter new-money allocations or totals", () => {
  const plan = planInvoiceCollection([invoice(1), invoice(2), invoice(3), invoice(4)], {
    "ORD-1": { mode: "previous_paid" }, "ORD-2": { mode: "previous_part", amount: "25.50" },
    "ORD-3": { mode: "paid" }, "ORD-4": { mode: "part", amount: "10.25" },
  });
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.collectedTotal, 110.25);
  assert.equal(plan.previousTotal, 125.5);
  assert.deepEqual(plan.allocations.map(x => x.invoiceReference), ["ORD-3", "ORD-4"]);
  assert.deepEqual(plan.previousStatuses.map(x => x.invoiceReference), ["ORD-1", "ORD-2"]);
});

test("part-payment values must be positive, cents-exact and below the invoice balance", () => {
  for (const mode of ["part", "previous_part"]) for (const amount of ["", "0", "-1", "100", "101", "0.001", "NaN", "Infinity"]) {
    assert.ok(planInvoiceCollection([invoice(1)], {"ORD-1":{mode, amount}}).errors.length, `${mode}: ${amount}`);
  }
  assert.equal(moneyCents("43.65"), 4365);
  assert.equal(moneyCents("43.651"), null);
});

test("ambiguous, stale and non-canonical invoice choices cannot be saved", () => {
  assert.ok(planInvoiceCollection([invoice(1), invoice(1)], {}).errors.length);
  assert.ok(planInvoiceCollection([], {"ORD-1":{mode:"paid"}}).errors.length);
  assert.ok(planInvoiceCollection([{...invoice(1),id:"order-not-canonical"}], {"ORD-1":{mode:"paid"}}).errors.length);
  assert.ok(planInvoiceCollection([{...invoice(1),source:"orders"}], {"ORD-1":{mode:"previous_paid"}}).errors.length);
});

test("old allocation and previous acknowledgement are not added twice; later new payments increase the paid amount", () => {
  const row = {...invoice(1), collection_previous_paid_amount: 40, collection_previous_allocated_amount: 25};
  assert.equal(previousStatusPaidAmount(row, 25), 40);
  assert.equal(previousStatusPaidAmount(row, 45), 60);
  const [resolved] = applyAllocationsToInvoices([row], [{invoice_reference:"ORD-1",allocated_amount:45,status:"active"}]);
  assert.equal(resolved.paidAmount, 60);
  assert.equal(resolved.remainingAmount, 40);
  assert.equal(resolved.paymentStatus, "PARTIALLY PAID");
});

test("invoice status reader includes status-only acknowledgements without a payment record", () => {
  const row = {entry_type:"INVOICE",invoice_number:"ORD-1",collection_previous_paid_amount:100, collection_previous_allocated_amount:0};
  const resolved = resolveInvoiceRowFromAllocations({row, invoiceTotal:100});
  assert.equal(resolved.invoice_status,"PAID");
  assert.equal(resolved.remaining_amount,0);
});

test("zero-money previous status save requires no payer and calls only the atomic collection RPC", async () => {
  const calls=[];
  const previousStatuses=planInvoiceCollection([invoice(1)], {"ORD-1":{mode:"previous_paid"}}).previousStatuses;
  const client={rpc:async(name,params)=>{calls.push({name,params});return {data:{status_only:true,payment:null}};}};
  const result=await saveInvoiceCollection({...baseInput,previousStatuses},{client,session});
  assert.equal(result.status_only,true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].name,"fc_save_invoice_collection_v1");
  assert.equal(calls[0].params.p_amount,0);
  assert.deepEqual(calls[0].params.p_allocations,[]);
  assert.equal(calls[0].params.p_previous_statuses.length,1);
});

test("response-loss retries retain the same request key and selections", async () => {
  const calls=[];
  const client={rpc:async(name,params)=>{calls.push(params);return {data:{duplicate:calls.length>1}};}};
  const input={...baseInput,amount:20,paidBy:"Shop staff",allocations:[{invoiceReference:"ORD-1",allocatedAmount:20}]};
  await saveInvoiceCollection(input,{client,session});
  const result=await saveInvoiceCollection(input,{client,session});
  assert.equal(calls[0].p_request_key,calls[1].p_request_key);
  assert.deepEqual(calls[0].p_allocations,calls[1].p_allocations);
  assert.equal(result.duplicate,true);
});

test("missing migration and invalid new-money input fail without a fallback payment", async () => {
  let calls=0;
  const client={rpc:async()=>{calls++;return {error:{code:"PGRST202"}};}};
  await assert.rejects(saveInvoiceCollection({...baseInput,amount:20,paidBy:"Staff"},{client,session}),/database update is not installed/);
  assert.equal(calls,1);
  await assert.rejects(saveInvoiceCollection({...baseInput,amount:20},{client,session}),/who paid/);
  await assert.rejects(saveInvoiceCollection({...baseInput,amount:0.001,paidBy:"Staff"},{client,session}),/two decimals/);
  assert.equal(calls,1);
});


test("previous part-paid input is an absolute paid total, never a second incremental payment", () => {
  const i = {...invoice(1), remainingAmount:70, paidAmount:30};
  const plan = planInvoiceCollection([i], {"ORD-1":{mode:"previous_part",amount:"30"}});
  assert.deepEqual(plan.errors,[]);
  assert.equal(plan.previousStatuses[0].previouslyPaidAmount,30);
  assert.equal(plan.collectedTotal,0);
  assert.ok(planInvoiceCollection([i], {"ORD-1":{mode:"previous_part",amount:"20"}}).errors.length);
});

test("collection snapshot keeps canonical invoice identity and never falls back to orders", async () => {
  const { loadInvoiceCollectionSnapshot } = await import('./invoiceCollectionService.js');
  const canonical = {...invoice(1), source:'customer_invoices'};
  const calls=[];
  const client={rpc:async(name,params)=>{calls.push({name,params});return {data:{invoices:[canonical],allocations:[]}};}};
  const result=await loadInvoiceCollectionSnapshot({customerAccountId:'customer',selectedBranchId:''},{client,session});
  assert.equal(result.invoices[0].id,canonical.id);
  assert.equal(calls[0].name,'fc_invoice_collection_snapshot_v1');
  assert.equal(calls[0].params.p_customer_branch_id,null);
  await assert.rejects(loadInvoiceCollectionSnapshot({customerAccountId:'customer'},{session,client:{rpc:async()=>({error:new Error('Permission denied')})}}),/Permission denied/);
  await assert.rejects(loadInvoiceCollectionSnapshot({customerAccountId:'customer'},{session,client:{rpc:async()=>({data:null})}}),/Could not verify/);
});
