import test from 'node:test';
import assert from 'node:assert/strict';
import {loadInvoiceFinancialSnapshot,withInvoiceFinancialState,currentInvoiceNotes} from './invoiceFinancialSnapshot.js';
import {applyAllocationsToInvoices} from '../utils/centralPaymentCalculations.js';
import {buildCustomerAccountTransactionModel} from '../utils/customerAccountTransactions.js';
const invoice={id:'invoice-1',customer_account_id:'account-1',invoice_number:'ORD-example',invoice_total:233.29,invoice_date:'2026-10-03T12:00:00Z',wallet_applied_amount:45.99};
const application={id:'wallet-1',customer_account_id:'account-1',invoice_id:invoice.id,direction:'DEBIT',amount:45.99,status:'ACTIVE',created_at:'2026-10-16T10:40:49Z',transaction_type:'MANUAL_INVOICE_DEBIT'};
test('Wallet application settles part of the invoice and appears as Return Paid once',()=>{
 const model=buildCustomerAccountTransactionModel({customer:{id:'account-1'},invoices:[invoice],walletApplications:[application,application]});
 const inv=model.transactions.find(r=>r.transaction_type==='INVOICE');const credit=model.transactions.find(r=>r.transaction_type==='RETURN_PAYMENT');
 assert.equal(inv.invoice_status,'PART PAID');assert.equal(inv.unallocated_amount,187.30);assert.equal(inv.allocated_amount,45.99);
 assert.equal(credit.status,'RETURN PAID');assert.equal(credit.credit_amount,45.99);assert.equal(credit.source_table,'customer_wallet_transactions');
 assert.equal(model.transactions.filter(r=>r.transaction_type==='RETURN_PAYMENT').length,1);
 assert.equal(model.summary.paymentTotal,0);assert.equal(model.summary.returnPaymentTotal,45.99);assert.equal(model.summary.closingBalance,187.30);
 assert.equal(model.reconciliation.balanced,true);assert.ok(model.paymentHistory.includes(credit));
});
test('cash plus return credit settles fully without duplicating cash collections',()=>{
 const cash={id:'payment-1',customer_account_id:'account-1',amount:187.30,status:'POSTED',payment_date:'2026-10-15T12:00:00Z'};
 const allocations=[{id:'allocation-1',payment_id:cash.id,invoice_reference:invoice.invoice_number,allocated_amount:187.30,status:'active'}];
 const model=buildCustomerAccountTransactionModel({customer:{id:'account-1'},invoices:[invoice],payments:[cash],allocations,walletApplications:[application]});
 assert.equal(model.transactions.find(r=>r.transaction_type==='INVOICE').invoice_status,'PAID');
 assert.equal(model.summary.paymentTotal,187.30);assert.equal(model.summary.returnPaymentTotal,45.99);assert.equal(model.summary.closingBalance,0);
 assert.equal(model.reconciliation.balanced,true);
});
test('inactive, other-account and other-invoice Wallet debits do not affect the statement',()=>{
 const apps=[{...application,status:'VOID'},{...application,id:'other',customer_account_id:'other'},{...application,id:'unknown',invoice_id:'other'}];
 const model=buildCustomerAccountTransactionModel({customer:{id:'account-1'},invoices:[{...invoice,wallet_applied_amount:0}],walletApplications:apps});
 assert.equal(model.summary.returnPaymentTotal,0);assert.equal(model.summary.closingBalance,233.29);
});
test('previous paid totals and Wallet baseline do not double-count acknowledged credit',()=>{
 const row={...invoice,invoice_total:100,collection_previous_paid_amount:50,collection_previous_allocated_amount:0,collection_previous_wallet_amount:20,wallet_applied_amount:20};
 assert.equal(applyAllocationsToInvoices([row],[])[0].paidAmount,50);
 assert.equal(applyAllocationsToInvoices([{...row,wallet_applied_amount:30}],[])[0].paidAmount,60);
});
test('printing receives the canonical status and amount due without replacing the order UUID',()=>{
 const state={...invoice,paid_amount:45.99,remaining_amount:187.30,invoice_status:'PART PAID'};
 const order=withInvoiceFinancialState({id:'order-1',notes:'Keep this note'},state);
 assert.equal(order.id,'order-1');assert.equal(order.invoice_id,invoice.id);assert.equal(order.payment_status,'PART PAID');
 assert.equal(order.amount_to_collect,187.30);assert.equal(order._financialStatusVerified,true);
 assert.equal(currentInvoiceNotes('Payment status: UNPAID. No Payment Now selected. Keep this note',true),'Keep this note');
 assert.equal(currentInvoiceNotes('Original note',false),'Original note');
});
test('financial snapshot passes scoped identifiers and session to one secured RPC',async()=>{
 const calls=[];const data={invoices:[invoice],wallet_applications:[application]};
 const result=await loadInvoiceFinancialSnapshot({customerAccountId:'account-1'},{session:{username:'staff',token:'fixture-token'},client:{rpc:async(name,params)=>{calls.push({name,params});return {data};}}});
 assert.equal(result,data);assert.equal(calls[0].name,'fc_invoice_financial_snapshot_v1');assert.equal(calls[0].params.p_customer_account_id,'account-1');
 await assert.rejects(loadInvoiceFinancialSnapshot({invoiceNumbers:['ORD-example']},{session:{username:'staff',token:'fixture-token'},client:{rpc:async()=>({error:new Error('denied')})}}),/denied/);
});
