import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=await mkdtemp(path.join(tmpdir(),'fairchoice-wallet-print-'));
after(()=>rm(output,{recursive:true,force:true}));
await promisify(execFile)(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'build','--ssr','src/services/centralInvoiceEngine.js','--outDir',output],{cwd:root});
await symlink(path.join(root,'node_modules'),path.join(output,'node_modules'),'dir');
const {buildStandardInvoiceHtml}=await import(pathToFileURL(path.join(output,'centralInvoiceEngine.js')));
const order={id:'order-1',invoice_number:'ORD-example',price_mode:'VAT',
 items:[{qty:1,price:194.41,net_total:194.41,gross_total:233.29,vat_rate:20}],
 wallet_applied_amount:45.99,paid_amount:45.99,remaining_amount:187.30,amount_to_collect:187.30,
 _financialStatusVerified:true,_documentPaymentStatus:'PART PAID',payment_status:'PART PAID',
 notes:'Payment status: UNPAID. No Payment Now selected. Keep delivery note.'};
test('printed invoice shows return credit before remaining grand total and current status',()=>{
 const html=buildStandardInvoiceHtml(order);
 assert.match(html,/233\.29/);assert.match(html,/Return \/ Wallet credit applied/);
 assert.match(html,/Grand Total Due/);assert.match(html,/187\.30/);assert.match(html,/PART PAID/);
 assert.ok(html.indexOf('Return / Wallet credit applied')<html.indexOf('Grand Total Due'));
 assert.doesNotMatch(html,/Payment status: UNPAID|No Payment Now selected/);
 assert.match(html,/Keep delivery note/);
});
test('fully settled invoice prints Paid and zero due with separate cash and Wallet deductions',()=>{
 const html=buildStandardInvoiceHtml({...order,paid_amount:233.29,remaining_amount:0,amount_to_collect:0,
  _documentPaymentStatus:'PAID',payment_status:'PAID'});
 assert.match(html,/Other paid amount/);assert.match(html,/187\.30/);
 assert.match(html,/Grand Total Due<\/div>\s*<div class="total-value">[^<]*0\.00/);
 assert.match(html,/Payment Status<\/div><div class="total-value">PAID/);
});
test('manual print return selections cannot duplicate or relabel applied Wallet credit',()=>{
 const html=buildStandardInvoiceHtml(order,{returnAdjustments:[{return_number:'unapplied-return',return_total:20}]});
 assert.match(html,/187\.30/);assert.doesNotMatch(html,/unapplied-return/);
});
