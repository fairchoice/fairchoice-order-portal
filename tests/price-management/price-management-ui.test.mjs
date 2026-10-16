import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=await mkdtemp(path.join(tmpdir(),'fairchoice-price-ui-'));
after(()=>rm(output,{recursive:true,force:true}));
const names=['PriceApprovalDialog','BulkDatabaseToOrders','SingleDatabaseToOrder'];
await writeFile(path.join(output,'entry.mjs'),names.map(name=>`export {default as ${name}} from ${JSON.stringify(path.join(root,'src/pages/AdminSetup/PriceManagement',name+'.jsx'))};`).join('\n'));
await promisify(execFile)(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'build','--ssr',path.join(output,'entry.mjs'),'--outDir',path.join(output,'build')],{cwd:root});
await symlink(path.join(root,'node_modules'),path.join(output,'build/node_modules'),'dir');
const components=await import(pathToFileURL(path.join(output,'build/entry.js')));
test('approval dialog renders a masked password field and explicit approve/cancel actions',()=>{
 const html=renderToStaticMarkup(React.createElement(components.PriceApprovalDialog,{approval:{action:'Update Warehouse',password:'',busy:false},onPasswordChange(){},onApprove(){},onCancel(){}}));
 assert.match(html,/type="password"/);assert.match(html,/Approve update/);assert.match(html,/Cancel/);assert.match(html,/role="dialog"/);
});
const props={brands:[],seriesList:[],filteredProducts:[],pagedProducts:[],selectedIds:[],products:[],previewRows:[],orderStatus:'both',safePage:1,totalPages:1,loading:false};
for(const name of ['BulkDatabaseToOrders','SingleDatabaseToOrder'])test(`${name} offers Received and Warehouse with a separate apply button`,()=>{
 const html=renderToStaticMarkup(React.createElement(components[name],props));
 assert.match(html,/value="both" selected=""/);assert.match(html,/value="Received"/);assert.match(html,/value="Warehouse Packing"/);
 assert.match(html,/Update Prices in Orders \/ Warehouse/);
});
