# Preview picking migration preflight

Do not run these checks or migrations without explicit approval. Pause Picking before database deployment and keep it paused until the matching frontend is deployed and smoke-tested.

## Read-only checks
```sql
-- Required schemas and session guard.
select to_regprocedure('public.fc_require_session_permission(text,text,text)') as session_guard,
       to_regclass('public.orders') as orders_table,
       to_regclass('public.order_items') as order_items_table,
       to_regclass('public.stock_locations') as stock_locations_table,
       to_regclass('public.product_location_stock') as product_location_stock_table;

-- Expected columns. A missing column is omitted from this result and must block deployment.
select table_name,
       ordinal_position,
       column_name,
       data_type,
       udt_name,
       is_nullable,
       column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('stock_locations', 'product_location_stock')
order by table_name, ordinal_position;

-- This query must return zero rows. Expected Picking columns are:
-- stock_locations: id, location_name, country, active
-- product_location_stock: id, product_id, location_id, qty,
--                         low_stock_alert, updated_at
with expected(table_name, column_name) as (
  values
    ('stock_locations', 'id'),
    ('stock_locations', 'location_name'),
    ('stock_locations', 'country'),
    ('stock_locations', 'active'),
    ('product_location_stock', 'id'),
    ('product_location_stock', 'product_id'),
    ('product_location_stock', 'location_id'),
    ('product_location_stock', 'qty'),
    ('product_location_stock', 'low_stock_alert'),
    ('product_location_stock', 'updated_at')
)
select expected.table_name, expected.column_name as missing_column
from expected
left join information_schema.columns as columns
  on columns.table_schema = 'public'
 and columns.table_name = expected.table_name
 and columns.column_name = expected.column_name
where columns.column_name is null
order by expected.table_name, expected.column_name;

-- Primary, unique, foreign-key and CHECK constraints. Both tables must have a
-- primary key. product_location_stock must enforce one row per
-- (product_id, location_id), and its product/location foreign keys must exist.
select relation.relname as table_name,
       constraint_record.conname as constraint_name,
       constraint_record.contype as constraint_type,
       pg_get_constraintdef(constraint_record.oid, true) as definition
from pg_constraint as constraint_record
join pg_class as relation on relation.oid = constraint_record.conrelid
join pg_namespace as namespace on namespace.oid = relation.relnamespace
where namespace.nspname = 'public'
  and relation.relname in ('stock_locations', 'product_location_stock')
order by relation.relname, constraint_record.contype, constraint_record.conname;

-- Index definitions must show the primary-key indexes and a UNIQUE index or
-- constraint on product_location_stock(product_id, location_id).
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('stock_locations', 'product_location_stock')
order by tablename, indexname;

-- Active locations. Picking and product import require exactly one active
-- England location and exactly one active Wales location.
select id, location_name, country, active
from public.stock_locations
order by active desc, country, location_name, id;

with normalized as (
  select id,
         location_name,
         case
           when upper(replace(trim(country), '_', '-')) in ('ENGLAND', 'ENG', 'GB-ENG') then 'England'
           when upper(replace(trim(country), '_', '-')) in ('WALES', 'WLS', 'GB-WLS') then 'Wales'
           else null
         end as normalized_country
  from public.stock_locations
  where active is true
)
select required.country,
       count(normalized.id) as active_location_count,
       array_agg(normalized.location_name order by normalized.location_name)
         filter (where normalized.id is not null) as active_locations
from (values ('England'), ('Wales')) as required(country)
left join normalized on normalized.normalized_country = required.country
group by required.country
order by required.country;

-- This query must return zero rows: active locations with unsupported or empty countries.
select id, location_name, country
from public.stock_locations
where active is true
  and case
        when upper(replace(trim(country), '_', '-')) in ('ENGLAND', 'ENG', 'GB-ENG') then 'England'
        when upper(replace(trim(country), '_', '-')) in ('WALES', 'WLS', 'GB-WLS') then 'Wales'
        else null
      end is null
order by location_name, id;

-- Invalid inventory quantities. This query must return zero rows.
select id, product_id, location_id, qty, low_stock_alert
from public.product_location_stock
where qty is null
   or qty < 0
   or low_stock_alert is null
   or low_stock_alert < 0
order by product_id, location_id, id;

-- Duplicate exact location rows. This query must return zero rows and is also
-- protected by the required UNIQUE(product_id, location_id) constraint.
select product_id, location_id, count(*) as row_count
from public.product_location_stock
group by product_id, location_id
having count(*) > 1
order by product_id, location_id;

-- A product may not have multiple active rows for the same normalized country.
-- This query must return zero rows.
select pls.product_id,
       case
         when upper(replace(trim(sl.country), '_', '-')) in ('ENGLAND', 'ENG', 'GB-ENG') then 'England'
         when upper(replace(trim(sl.country), '_', '-')) in ('WALES', 'WLS', 'GB-WLS') then 'Wales'
         else null
       end as normalized_country,
       count(*) as active_row_count,
       array_agg(pls.location_id order by pls.location_id) as location_ids
from public.product_location_stock as pls
join public.stock_locations as sl on sl.id = pls.location_id
where sl.active is true
group by pls.product_id,
         case
           when upper(replace(trim(sl.country), '_', '-')) in ('ENGLAND', 'ENG', 'GB-ENG') then 'England'
           when upper(replace(trim(sl.country), '_', '-')) in ('WALES', 'WLS', 'GB-WLS') then 'Wales'
           else null
         end
having count(*) > 1
order by pls.product_id, normalized_country;

select id, order_id, qty, picking_action from public.order_items where qty is null or qty < 0;
select picking_action,count(*) from public.order_items where picking_action is not null and picking_action not in ('in_stock','pre_order','replace') group by picking_action;
select id,order_number,status,picking_status,picking_locked_by,picking_locked_by_name,picking_locked_at from public.orders where picking_locked_by is not null or picking_status in ('In Progress','Pending');
select indexname,indexdef from pg_indexes where schemaname='public' and tablename='order_items' and indexdef ilike '%unique%' order by indexname;
select routine_name,grantee,privilege_type from information_schema.routine_privileges where specific_schema='public' and routine_name in ('fc_apply_picking_quantity_v1','fc_recall_picking_quantities_v1','complete_order_picking') order by routine_name,grantee;
select client_action_id,count(*) from public.preorder_supply_events where client_action_id is not null group by client_action_id having count(*)>1;
```

## Controlled deployment order
1. Confirm Preview backup/PITR readiness.
2. Pause Picking and prevent new picking sessions.
3. Run and review the read-only checks above.
4. Clear active locks through the normal application flow.
5. Apply `20260801093000_preorder_supply_event_history.sql`.
6. Apply `20260801100000_quantity_picking_location_inventory.sql`.
7. Apply `20260801110000_legacy_inventory_bootstrap_for_picking.sql`.
8. Apply `20260801120000_fix_picking_inventory_rpc_runtime_errors.sql`.
9. Apply `20260802103000_sync_picking_status_to_received_orders.sql`.
10. Deploy the matching frontend immediately.
11. Reload sessions/schema cache and smoke-test permissions, England/Wales stock, partial quantity, replacement, recall, totals, and Pre-order history.
12. Resume Picking only after all tests pass.
