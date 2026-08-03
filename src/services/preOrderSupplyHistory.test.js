import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const service=fs.readFileSync(new URL("./preOrderSupplyHistory.js",import.meta.url),"utf8");
const page=fs.readFileSync(new URL("../pages/PreOrderSupply.jsx",import.meta.url),"utf8");
const migration=fs.readFileSync(new URL("../../supabase/migrations/20260801093000_preorder_supply_event_history.sql",import.meta.url),"utf8");
test("history uses secured paginated FC RPCs",()=>{assert.match(service,/fc_list_preorder_supply_events_v1/);assert.match(service,/fc_record_preorder_supply_event_v1/);assert.match(service,/p_before_created_at/);assert.match(page,/loadPreOrderSupplyHistory\(loggedInUser\)/);assert.match(migration,/client_action_id/);assert.match(migration,/fc_require_session_permission/);});
test("missing history migration warns without making browser history authoritative",()=>{assert.match(service,/42883/);assert.match(service,/PGRST202/);assert.match(service,/awaiting migration/);assert.doesNotMatch(page,/fairchoice_preorder_supply_history/);});
