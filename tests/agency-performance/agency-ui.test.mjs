import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,symlink,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AGENCY_ACCESS_OPTIONS,PERFORMANCE_GROUPS,requirePerformanceGroup,suggestPerformanceGroup} from '../../src/utils/performanceGroups.js';
import {STAFF_ROLES,canAccessPage,getAccessiblePageSections} from '../../src/security/accessControlRegistry.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=await mkdtemp(path.join(tmpdir(),'fc-agency-ui-'));
after(()=>rm(output,{recursive:true,force:true}));
await writeFile(path.join(output,'entry.mjs'),`export {default as Layout} from ${JSON.stringify(path.join(root,'src/pages/AdminSetup/BackOfficeLayout.jsx'))};export {default as Report} from ${JSON.stringify(path.join(root,'src/pages/reports/AgencyPerformanceReport.jsx'))};export {default as CustomerForm} from ${JSON.stringify(path.join(root,'src/pages/AdminSetup/CustomerForm.jsx'))};export {default as CustomerSales} from ${JSON.stringify(path.join(root,'src/pages/reports/AgencyCustomerSales.jsx'))};export {default as AgencyOptions} from ${JSON.stringify(path.join(root,'src/pages/AdminSetup/AgencyAccessOptions.jsx'))};`);
await promisify(execFile)(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'build','--ssr',path.join(output,'entry.mjs'),'--outDir',path.join(output,'build')],{cwd:root});
await symlink(path.join(root,'node_modules'),path.join(output,'build/node_modules'),'dir');
const {Layout,Report,CustomerForm,CustomerSales,AgencyOptions}=await import(pathToFileURL(path.join(output,'build/entry.js')));
test('every staff role has Agency Performance under Reports without gaining payment-write permissions',()=>{
 for(const role of STAFF_ROLES){const user={username:'staff',role,active:true,effective_permissions:{}};assert.ok(canAccessPage(user,'agencyPerformance'));assert.ok(getAccessiblePageSections(user).find(s=>s.title==='Reports')?.items.some(i=>i.key==='page.reports.agency_performance'));}
 for(const user of [{role:'Customer',effective_permissions:{all_access:true}},{role:'Admin',active:false}]) assert.equal(canAccessPage(user,'agencyPerformance'),false);
});
test('Warehouse and Brand Partner layouts render the new report and allow its content',()=>{
 for(const role of STAFF_ROLES){const html=renderToStaticMarkup(React.createElement(Layout,{page:'agencyPerformance',currentUser:{role,username:'staff',active:true},isWarehouse:role==='Warehouse',isAdmin:role==='Admin',setPage(){}},React.createElement('p',null,'Report body')));assert.match(html,/Agency Performance/);assert.match(html,/Report body/);assert.doesNotMatch(html,/You do not have/);}
});
test('report waits for server agency access without rendering unassigned tabs or fake totals',()=>{
 const html=renderToStaticMarkup(React.createElement(Report,{currentUser:{}}));assert.match(html,/Loading agency access/);assert.match(html,/Refresh agency access/);assert.doesNotMatch(html,/£0\.00/);assert.doesNotMatch(html,/>South England Performance</);
});
test('Sales Rep has a report entry and each staff duty allows the report route',async()=>{
 const source=await readFile(path.join(root,'src/pages/CustomerOrder.jsx'),'utf8');assert.match(source,/item.key === "page.reports.agency_performance"\) return canAccessPage/);assert.match(source,/setPage\("agencyPerformance"\)/);assert.match(source,/page === "agencyPerformance" && <AgencyPerformanceReport currentUser=\{activeUser\}/);
});

test('Performance Group selection is compulsory and all requested regional mappings agree',()=>{
 for(const city of ['Southampton','Portsmouth','Shillington']) assert.equal(suggestPerformanceGroup({town_city:city,country:'England'}),'South England');
 for(const [city,group] of [['Swindon','West England'],['Newport','Wales'],['Kent','East England'],['Bedford','Middleton England'],['Milton Keynes','Middleton England'],['Luton','Middleton England']]) assert.equal(suggestPerformanceGroup({town_city:city,country:'England'}),group);
 assert.throws(()=>requirePerformanceGroup(''),/required/);assert.throws(()=>requirePerformanceGroup('Unknown'),/required/);
 for(const group of PERFORMANCE_GROUPS) assert.equal(requirePerformanceGroup(group),group);
});
test('customer form renders required Performance Group dropdown and report defaults to Middleton',()=>{
 const form=renderToStaticMarkup(React.createElement(CustomerForm,{}));assert.match(form,/id="customer-performance-group" required=""/);
 for(const group of PERFORMANCE_GROUPS) assert.ok(form.includes(group));
 const report=renderToStaticMarkup(React.createElement(Report,{currentUser:{}}));assert.match(report,/Loading agency access/);assert.doesNotMatch(report,/>England Performance</);
});

test('customer sales table displays names and amounts with complete page navigation',()=>{
 const html=renderToStaticMarkup(React.createElement(CustomerSales,{data:{rows:[{customer_id:'1',customer_name:'Example shop',sales:123.45,invoice_count:2}],page:2,page_size:30,total_rows:65,total_pages:3,total_sales:1000},onPage(){}}));
 for(const text of ['Example shop','£123.45','Page 2 of 3','31–60 of 65','First','Previous','Next','Last','£1,000.00']) assert.ok(html.includes(text));
});
test('customer page boundaries disable navigation and show an accurate empty state',()=>{
 const empty=renderToStaticMarkup(React.createElement(CustomerSales,{data:{rows:[],page:1,page_size:30,total_rows:0,total_pages:1,total_sales:0},onPage(){}}));assert.match(empty,/No customers match/);assert.match(empty,/Showing 0–0 of 0/);assert.equal((empty.match(/disabled=""/g)||[]).length,4);
 const loading=renderToStaticMarkup(React.createElement(CustomerSales,{loading:true,data:{rows:[],page:2,total_pages:4},onPage(){}}));assert.equal((loading.match(/disabled=""/g)||[]).length,4);
});

test('Agencies offers per-person multi-group checkboxes and optional shared totals without granting defaults',()=>{
 const html=renderToStaticMarkup(React.createElement(AgencyOptions,{selectedKeys:new Set(['agency.middleton_england']),onToggle(){}}));
 for(const group of PERFORMANCE_GROUPS) assert.ok(html.includes(group));assert.match(html,/Several users can share/);assert.equal((html.match(/checked=""/g)||[]).length,1);assert.equal((html.match(/type="checkbox"/g)||[]).length,6);
 for(const role of ['Driver','Warehouse','Brand Partner']) {const user={role,username:'staff'};assert.ok(canAccessPage(user,'agencyPerformance'));}
});
test('agency permission keys are registered for Select All and Access Control saves',async()=>{
 const {ALL_REGISTERED_PERMISSION_KEYS,getRoleDefaultPermissionKeys}=await import('../../src/security/accessControlRegistry.js');
 for(const {key} of AGENCY_ACCESS_OPTIONS){assert.ok(ALL_REGISTERED_PERMISSION_KEYS.includes(key));assert.ok(getRoleDefaultPermissionKeys('Super Admin').includes(key));assert.ok(!getRoleDefaultPermissionKeys('Driver').includes(key));}
 const source=await readFile(path.join(root,'src/pages/AdminSetup/AccessControl.jsx'),'utf8');assert.match(source,/<AgencyAccessOptions/);assert.match(source,/keepAgencies\(selected.permission_keys\)/);
});
