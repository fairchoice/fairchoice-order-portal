-- FairChoice centralized staff page and important-function access control.
-- Additive TEST migration. It does not remove existing login or permission data.

begin;

insert into public.fc_permissions(permission_key, permission_name, category, description)
values
  ('page.order.sales_rep','Sales Rep Order','Page Access / Order','Open the Sales Rep Order page.'),
  ('page.order.sales_invoice','Sales Invoice','Page Access / Order','Open Sales Invoice in read-only mode unless a separate action permission is granted.'),
  ('page.operations.received_orders','Received Orders','Page Access / Operations','Open Received Orders.'),
  ('page.operations.driver','Driver Portal','Page Access / Operations','Open Driver Portal.'),
  ('page.operations.returns','Returns','Page Access / Operations','Open Returns.'),
  ('page.operations.warehouse','Warehouse','Page Access / Operations','Open Warehouse.'),
  ('page.operations.pre_order_supply','Pre-Order Supply','Page Access / Operations','Open Pre-Order Supply.'),
  ('page.admin.staff_setup','Staff Setup','Page Access / Admin Setup','Open Staff Setup.'),
  ('page.admin.customer_setup','Customer Setup','Page Access / Admin Setup','Open Customer Setup.'),
  ('page.login.staff_login','Staff Login','Page Access / Login','Open staff onboarding, offboarding and login management.'),
  ('page.login.customer_login','Customer Login','Page Access / Login','Open customer portal onboarding, offboarding and login management.'),
  ('page.login.access_control','Access Control','Page Access / Login','Open centralized Access Control.'),
  ('page.product.categories','Categories','Page Access / Product Setup','Open Categories.'),
  ('page.product.home_content','Home Page Content','Page Access / Product Setup','Open Home Page Content.'),
  ('page.product.products','Products','Page Access / Product Setup','Open Products.'),
  ('page.product.stock_taking','Stock Taking','Page Access / Product Setup','Open Stock Taking.'),
  ('page.product.import','Product Import / Upload','Page Access / Product Setup','Open Product Import / Upload.'),
  ('page.product.pricing_rules','Pricing Rules','Page Access / Product Setup','Open Pricing Rules.'),
  ('page.product.price_management','Price Management','Page Access / Product Setup','Open Price Management.'),
  ('page.product.promotion','Promotion','Page Access / Product Setup','Open Promotion.'),
  ('page.supplier.setup','Supplier','Page Access / Supplier','Open Supplier setup.'),
  ('page.accounts.central_payment','Central Payment','Page Access / Accounts','Open Central Payment.'),
  ('page.accounts.customer_credit','Customer Credit','Page Access / Accounts','Open Customer Credit.'),
  ('page.accounts.invoices','Invoices','Page Access / Accounts','Open Invoices.'),
  ('page.accounts.weekly','Weekly Account','Page Access / Accounts','Open Weekly Account.'),
  ('page.accounts.supplier_accounts','Supplier Accounts','Page Access / Accounts','Open Supplier Accounts.'),
  ('page.accounts.expenses','Expenses','Page Access / Accounts','Open Expenses.'),
  ('page.accounts.branch_separation','Branch Separation','Page Access / Accounts','Open Branch Separation.'),
  ('page.reports.profit','Profit Portal','Page Access / Reports','Open Profit Portal.'),
  ('page.reports.product_line','Product Line Analysis','Page Access / Reports','Open Product Line Analysis.'),
  ('page.reports.sales','Sales Report','Page Access / Reports','Open Sales Report.'),
  ('page.reports.purchase_planning','Purchase Planning','Page Access / Reports','Open Purchase Planning.'),
  ('page.reports.outstanding_customer','Outstanding Customer','Page Access / Reports','Open Outstanding Customer.'),
  ('page.reports.collections','Collections Report','Page Access / Reports','Open Collections Report.'),
  ('page.reports.driver_collection','Driver Collection','Page Access / Reports','Open Driver Collection.'),
  ('page.system.audit_log','Audit Log','Page Access / System','Open Audit Log.'),
  ('page.system.import_export','Import / Export','Page Access / System','Open Import / Export.'),
  ('page.system.backup','Backup Tools','Page Access / System','Open Backup Tools.'),
  ('orders.receive','Receive Order','Important Functions / Orders','Receive an order.'),
  ('orders.status.change','Change Order Status','Important Functions / Orders','Change an operational order status.'),
  ('orders.items.change','Change Order Products','Important Functions / Orders','Add or remove products after order creation.'),
  ('orders.quantity.change','Change Order Quantity','Important Functions / Orders','Change an order item quantity.'),
  ('orders.amount.change','Change Order Amount','Important Functions / Orders','Change an order amount or item price.'),
  ('orders.discount.change','Change Order Discount','Important Functions / Orders','Apply or change an order discount.'),
  ('orders.price_mode.change','Change Price Mode','Important Functions / Orders','Change a restricted price mode.'),
  ('orders.archive','Archive Order','Important Functions / Orders','Archive or restore an order.'),
  ('orders.delete','Delete Order','Important Functions / Orders','Permanently delete an order where supported.'),
  ('orders.recall','Recall Order','Important Functions / Orders','Recall an order.'),
  ('orders.recall_all','Recall All Orders','Important Functions / Orders','Recall all eligible orders.'),
  ('invoices.amend','Amend Invoice','Important Functions / Invoices','Amend invoice lines or amount.'),
  ('invoices.void','Void Invoice','Important Functions / Invoices','Void an invoice.'),
  ('invoices.financial_void','Financially Void Invoice','Important Functions / Invoices','Financially void an invoice and reverse its impact.'),
  ('invoices.replace','Replace Invoice','Important Functions / Invoices','Regenerate or replace a financially significant invoice.'),
  ('payments.edit','Edit Payment','Important Functions / Payments','Edit a historical payment.'),
  ('payments.reverse','Reverse Payment','Important Functions / Payments','Reverse, remove or restore a payment.'),
  ('payments.delete','Delete Payment','Important Functions / Payments','Permanently delete a payment where supported.'),
  ('payments.amount.change','Change Payment Amount','Important Functions / Payments','Change a payment amount.'),
  ('payments.reallocate','Reallocate Payment','Important Functions / Payments','Change invoice allocations.'),
  ('payments.manual_credit','Create Manual Credit','Important Functions / Payments','Create a manual customer credit.'),
  ('customer_credit.opening_balance_edit','Change Opening Balance','Important Functions / Customer Credit','Change a customer opening balance.'),
  ('customer_credit.balance_adjust','Adjust Customer Balance','Important Functions / Customer Credit','Make a manual balance adjustment.'),
  ('customer_credit.credit_limit_edit','Change Credit Limit','Important Functions / Customer Credit','Change a customer credit limit.'),
  ('stock.manual_adjust','Manual Stock Adjustment','Important Functions / Stock','Manually adjust stock.'),
  ('stock.received_quantity_change','Change Received Stock Quantity','Important Functions / Stock','Change received stock quantity.'),
  ('stock.movement_reverse','Reverse Stock Movement','Important Functions / Stock','Delete or reverse a stock movement.'),
  ('stock.recall','Stock Recall','Important Functions / Stock','Recall stock.'),
  ('stock.take_difference_approve','Approve Stock-Taking Difference','Important Functions / Stock','Approve stock-taking differences.'),
  ('returns.approve','Approve Return','Important Functions / Stock','Approve a customer return.'),
  ('returns.reverse','Reverse Return','Important Functions / Stock','Reverse a return approval.'),
  ('returns.reconcile','Reconcile Return','Important Functions / Stock','Reconcile return history.'),
  ('system.import_sensitive','Import Sensitive Data','Important Functions / System','Import sensitive business data.'),
  ('system.export_sensitive','Export Sensitive Data','Important Functions / System','Export sensitive business data.'),
  ('system.backup_restore','Backup / Restore','Important Functions / System','Use backup or restore functions.'),
  ('system.delete_records','Delete Records','Important Functions / System','Delete high-impact administrative records.'),
  ('staff.manage','Manage Staff','Important Functions / System','Create and edit staff identities and staff login lifecycle.'),
  ('customers.create_login','Manage Customer Login','Important Functions / System','Create, enable, disable and reset customer portal logins.'),
  ('permissions.manage','Manage Access Control','Important Functions / System','Grant and revoke registered staff permissions.')
on conflict(permission_key) do update set
  permission_name = excluded.permission_name,
  category = excluded.category,
  description = excluded.description,
  active = true,
  updated_at = now();

-- Preserve current operational access before removing frontend role bypasses.
-- Existing Admin logins retain their full current workflow; future Admin role
-- defaults remain a template controlled by the application registry.
insert into public.fc_staff_permissions(staff_id, permission_key, allowed, granted_at, updated_at)
select distinct l.staff_id, p.permission_key, true, now(), now()
from public.login_users l
cross join public.fc_permissions p
where l.staff_id is not null
  and l.active is true
  and lower(trim(l.role)) = 'admin'
  and p.active is true
  and p.permission_key <> 'all_access'
on conflict(staff_id, permission_key) do nothing;

-- Common/default-visible pages and the requested role templates for existing staff.
with defaults(role_name, permission_key) as (
  values
    ('*','page.order.sales_invoice'), ('*','page.accounts.expenses'),
    ('salesrep','page.order.sales_rep'), ('salesrepresentative','page.order.sales_rep'),
    ('driver','page.operations.driver'),
    ('warehouse','page.operations.received_orders'), ('warehouse','page.operations.returns'),
    ('warehouse','page.operations.warehouse'), ('warehouse','page.operations.pre_order_supply'),
    ('admin','page.operations.received_orders'), ('admin','page.operations.driver'),
    ('admin','page.operations.returns'), ('admin','page.operations.warehouse'),
    ('admin','page.operations.pre_order_supply'), ('admin','page.product.categories'),
    ('admin','page.product.products'), ('admin','page.product.stock_taking'),
    ('driver','payments.collect_cash'), ('driver','delivery.complete'),
    ('salesrep','payments.collect_cash'), ('salesrep','orders.take'),
    ('salesrepresentative','payments.collect_cash'), ('salesrepresentative','orders.take')
)
insert into public.fc_staff_permissions(staff_id, permission_key, allowed, granted_at, updated_at)
select distinct l.staff_id, d.permission_key, true, now(), now()
from public.login_users l
join defaults d on d.role_name = '*' or d.role_name = replace(lower(trim(l.role)), ' ', '')
join public.fc_permissions p on p.permission_key = d.permission_key and p.active is true
where l.staff_id is not null and l.active is true and lower(trim(l.role)) <> 'customer'
on conflict(staff_id, permission_key) do nothing;

-- Translate legacy JSON flags once, without deleting the original JSON.
with legacy_map(legacy_key, permission_key) as (
  values
    ('access_received_orders','page.operations.received_orders'),
    ('access_warehouse','page.operations.warehouse'),
    ('access_warehouse','page.operations.pre_order_supply'),
    ('access_driver','page.operations.driver'),
    ('access_sales_rep','page.order.sales_rep'),
    ('access_customer_setup','page.admin.customer_setup'),
    ('access_product_setup','page.product.products'),
    ('access_accounts','page.accounts.central_payment'),
    ('access_reports','page.reports.sales'),
    ('can_edit_security','page.login.staff_login'),
    ('can_edit_security','page.login.customer_login'),
    ('can_edit_security','page.login.access_control'),
    ('can_edit_security','staff.manage'),
    ('can_edit_security','customers.create_login'),
    ('can_edit_security','permissions.manage'),
    ('can_edit_pricing','page.product.pricing_rules'),
    ('can_receive_order','orders.receive'),
    ('can_change_order_status_in_progress','orders.status.change'),
    ('can_add_product_to_order','orders.items.change'),
    ('can_move_to_warehouse','orders.status.change'),
    ('can_cancel_order','orders.cancel'),
    ('can_archive_order','orders.archive')
)
insert into public.fc_staff_permissions(staff_id, permission_key, allowed, granted_at, updated_at)
select distinct l.staff_id, m.permission_key, true, now(), now()
from public.login_users l
join legacy_map m on coalesce(l.permissions -> m.legacy_key, 'false'::jsonb) = 'true'::jsonb
join public.fc_permissions p on p.permission_key = m.permission_key and p.active is true
where l.staff_id is not null and lower(trim(l.role)) <> 'customer'
on conflict(staff_id, permission_key) do nothing;

create or replace function public.fc_effective_permissions_v2(
  p_login_id uuid,
  p_staff_id uuid,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_username text;
  v_permissions jsonb := '{}'::jsonb;
begin
  select lower(trim(username)) into v_username
  from public.login_users where id = p_login_id;

  if v_username = 'nisstaj_admin' or lower(trim(coalesce(p_role, ''))) = 'super admin' then
    return '{"all_access":true}'::jsonb;
  end if;

  select coalesce(jsonb_object_agg(p.permission_key, to_jsonb(sp.allowed)), '{}'::jsonb)
  into v_permissions
  from public.fc_staff_permissions sp
  join public.fc_permissions p on p.permission_key = sp.permission_key and p.active is true
  where sp.staff_id = p_staff_id and p.permission_key <> 'all_access';

  return coalesce(v_permissions, '{}'::jsonb);
end;
$$;

revoke all on function public.fc_effective_permissions_v2(uuid,uuid,text) from public;

create or replace function public.fc_protect_master_admin_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'login_users' and lower(trim(old.username)) = 'nisstaj_admin' then
    if tg_op = 'DELETE' then raise exception 'The protected master Admin login cannot be deleted.' using errcode='42501'; end if;
    if new.active is false
       or lower(trim(new.username)) <> 'nisstaj_admin'
       or lower(trim(coalesce(new.role,''))) not in ('admin','super admin')
       or new.staff_id is distinct from old.staff_id then
      raise exception 'The protected master Admin identity, role and active status cannot be changed.' using errcode='42501';
    end if;
  elsif tg_table_name = 'staff_users' and exists (
    select 1 from public.login_users l where l.staff_id = old.id and lower(trim(l.username)) = 'nisstaj_admin'
  ) then
    if tg_op = 'DELETE' then raise exception 'The protected master Admin staff record cannot be deleted.' using errcode='42501'; end if;
    if new.active is false
       or lower(trim(coalesce(new.role,new.job_role,''))) not in ('admin','super admin') then
      raise exception 'The protected master Admin staff record cannot be deactivated or assigned a non-admin role.' using errcode='42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists fc_protect_master_admin_login on public.login_users;
create trigger fc_protect_master_admin_login before update or delete on public.login_users
for each row execute function public.fc_protect_master_admin_v1();
drop trigger if exists fc_protect_master_admin_staff on public.staff_users;
create trigger fc_protect_master_admin_staff before update or delete on public.staff_users
for each row execute function public.fc_protect_master_admin_v1();

create or replace function public.fc_access_control_snapshot_v1(p_username text, p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor record;
  v_staff jsonb;
begin
  select * into v_actor from public.fc_require_session_permission_v2(p_username, p_session_token, 'permissions.manage');

  select coalesce(jsonb_agg(jsonb_build_object(
    'staff_id', s.id,
    'login_id', l.id,
    'staff_name', s.staff_name,
    'username', coalesce(l.username, s.username),
    'role', coalesce(l.role, s.role, 'Staff'),
    'staff_active', s.active,
    'login_enabled', coalesce(l.active, false),
    'last_login_at', ls.last_success_at,
    'permission_keys', coalesce(perms.permission_keys, '[]'::jsonb)
  ) order by s.staff_name), '[]'::jsonb)
  into v_staff
  from public.staff_users s
  left join lateral (
    select lu.* from public.login_users lu
    where lu.staff_id = s.id and lower(trim(coalesce(lu.role,''))) <> 'customer'
    order by lu.created_at desc nulls last limit 1
  ) l on true
  left join public.fc_login_security_state ls on ls.username_normalized = lower(trim(l.username))
  left join lateral (
    select jsonb_agg(sp.permission_key order by sp.permission_key) as permission_keys
    from public.fc_staff_permissions sp
    join public.fc_permissions p on p.permission_key = sp.permission_key and p.active is true
    where sp.staff_id = s.id and sp.allowed is true and sp.permission_key <> 'all_access'
  ) perms on true;

  return jsonb_build_object('staff', v_staff);
end;
$$;

revoke all on function public.fc_access_control_snapshot_v1(text,text) from public;
grant execute on function public.fc_access_control_snapshot_v1(text,text) to anon, authenticated;

create or replace function public.fc_save_staff_access_v1(
  p_username text,
  p_session_token text,
  p_target_staff_id uuid,
  p_target_login_id uuid,
  p_target_username text,
  p_new_password text,
  p_role text,
  p_staff_active boolean,
  p_login_enabled boolean,
  p_permission_keys text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor record;
  v_target public.login_users%rowtype;
  v_old_staff_active boolean;
  v_old_permissions jsonb;
  v_new_permissions jsonb;
  v_role text := trim(coalesce(p_role,''));
begin
  select * into v_actor from public.fc_require_session_permission_v2(p_username, p_session_token, 'permissions.manage');

  if v_role not in ('Admin','Accounts','Accountant','Sales Rep','Driver','Warehouse','Super Admin') then
    raise exception 'Unsupported staff role.' using errcode='22023';
  end if;
  if v_role = 'Super Admin' and lower(trim(v_actor.username)) <> 'nisstaj_admin' then
    raise exception 'Only Nisstaj_admin can grant Super Admin access.' using errcode='42501';
  end if;

  select active into v_old_staff_active from public.staff_users where id = p_target_staff_id;
  if not found then raise exception 'The selected staff record no longer exists.' using errcode='P0002'; end if;

  select * into v_target from public.login_users
  where id = p_target_login_id and staff_id = p_target_staff_id and lower(trim(coalesce(role,''))) <> 'customer';
  if found and lower(trim(v_target.username)) = 'nisstaj_admin' then
    raise exception 'Nisstaj_admin access is protected and cannot be changed.' using errcode='42501';
  end if;
  if lower(trim(coalesce(v_target.role,''))) = 'super admin' and lower(trim(v_actor.username)) <> 'nisstaj_admin' then
    raise exception 'Only Nisstaj_admin can change Super Admin access.' using errcode='42501';
  end if;
  if nullif(lower(trim(coalesce(p_target_username,''))),'') is null then
    raise exception 'A staff username is required.' using errcode='22023';
  end if;
  if v_target.id is null and length(coalesce(p_new_password,'')) < 8 then
    raise exception 'A password of at least 8 characters is required for a new staff login.' using errcode='22023';
  end if;
  if p_new_password is not null and length(p_new_password) < 8 then
    raise exception 'The new password must be at least 8 characters.' using errcode='22023';
  end if;

  select coalesce(jsonb_agg(permission_key order by permission_key), '[]'::jsonb)
  into v_old_permissions from public.fc_staff_permissions
  where staff_id = p_target_staff_id and allowed is true;

  update public.staff_users
  set role = v_role, job_role = v_role, active = coalesce(p_staff_active,true)
  where id = p_target_staff_id;

  if v_target.id is null then
    insert into public.login_users(staff_id, username, password, password_hash, role, customer_account_id, active, password_changed_at)
    values (p_target_staff_id, lower(trim(p_target_username)), null,
      extensions.crypt(p_new_password, extensions.gen_salt('bf',12)), v_role, null,
      coalesce(p_login_enabled,true), now())
    returning * into v_target;
  else
    update public.login_users
    set username = lower(trim(p_target_username)),
        role = v_role,
        active = coalesce(p_login_enabled,true),
        password_hash = case when p_new_password is not null then extensions.crypt(p_new_password, extensions.gen_salt('bf',12)) else password_hash end,
        password_changed_at = case when p_new_password is not null then now() else password_changed_at end,
        auth_version = case when active is distinct from coalesce(p_login_enabled,true)
          or username is distinct from lower(trim(p_target_username)) or p_new_password is not null then auth_version + 1 else auth_version end,
        updated_at = now()
    where id = v_target.id;
  end if;

  if p_login_enabled is false then
    update public.fc_login_sessions set revoked_at = now(), revoked_reason = 'ACCESS_CONTROL_DISABLED'
    where login_id = v_target.id and revoked_at is null;
  end if;

  delete from public.fc_staff_permissions where staff_id = p_target_staff_id;
  insert into public.fc_staff_permissions(staff_id, permission_key, allowed, granted_by_staff_id, granted_at, updated_at)
  select p_target_staff_id, p.permission_key, true, v_actor.staff_id, now(), now()
  from public.fc_permissions p
  where p.active is true
    and p.permission_key <> 'all_access'
    and p.permission_key = any(coalesce(p_permission_keys, array[]::text[]));

  select coalesce(jsonb_agg(permission_key order by permission_key), '[]'::jsonb)
  into v_new_permissions from public.fc_staff_permissions
  where staff_id = p_target_staff_id and allowed is true;

  insert into public.fc_security_events(event_type,severity,login_id,staff_id,username_normalized,session_id,entity_type,entity_id,details)
  values ('ACCESS_CONTROL_CHANGED','HIGH',v_actor.login_id,v_actor.staff_id,lower(trim(v_actor.username)),v_actor.session_id,
    'staff_users',p_target_staff_id::text,jsonb_build_object(
      'affected_login_id',v_target.id,'affected_username',v_target.username,
      'old_role',v_target.role,'new_role',v_role,
      'old_staff_active',v_old_staff_active,
      'new_staff_active',coalesce(p_staff_active,true),
      'old_login_enabled',v_target.active,'new_login_enabled',coalesce(p_login_enabled,true),
      'old_permissions',v_old_permissions,'new_permissions',v_new_permissions
    ));

  return jsonb_build_object('ok',true,'staff_id',p_target_staff_id,'permission_keys',v_new_permissions);
end;
$$;

revoke all on function public.fc_save_staff_access_v1(text,text,uuid,uuid,text,text,text,boolean,boolean,text[]) from public;
grant execute on function public.fc_save_staff_access_v1(text,text,uuid,uuid,text,text,text,boolean,boolean,text[]) to anon, authenticated;


-- Separate login lifecycle from page/action access so saving Access Control cannot
-- accidentally change usernames, passwords, active status or existing customer logins.
create or replace function public.fc_staff_login_snapshot_v1(p_username text, p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor record;
  v_staff jsonb;
begin
  select * into v_actor from public.fc_require_session_permission_v2(p_username, p_session_token, 'page.login.staff_login');
  select coalesce(jsonb_agg(jsonb_build_object(
    'staff_id',s.id,'login_id',l.id,'staff_name',s.staff_name,'username',coalesce(l.username,s.username),
    'role',coalesce(l.role,s.role,'Staff'),'staff_active',s.active,'login_enabled',coalesce(l.active,false),
    'last_login_at',ls.last_success_at
  ) order by s.staff_name), '[]'::jsonb) into v_staff
  from public.staff_users s
  left join lateral (
    select lu.* from public.login_users lu
    where lu.staff_id=s.id and lower(trim(coalesce(lu.role,''))) <> 'customer'
    order by lu.created_at desc nulls last limit 1
  ) l on true
  left join public.fc_login_security_state ls on ls.username_normalized=lower(trim(l.username));
  return jsonb_build_object('staff',v_staff);
end;
$$;
revoke all on function public.fc_staff_login_snapshot_v1(text,text) from public;
grant execute on function public.fc_staff_login_snapshot_v1(text,text) to anon, authenticated;

create or replace function public.fc_save_staff_permissions_v1(
  p_username text,
  p_session_token text,
  p_target_staff_id uuid,
  p_permission_keys text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor record;
  v_master boolean := false;
  v_old_permissions jsonb;
  v_new_permissions jsonb;
begin
  select * into v_actor from public.fc_require_session_permission_v2(p_username, p_session_token, 'permissions.manage');
  select exists(
    select 1 from public.login_users l
    where l.staff_id = p_target_staff_id and lower(trim(l.username)) = 'nisstaj_admin'
  ) into v_master;
  if v_master then
    raise exception 'Nisstaj_admin permissions are automatic and protected.' using errcode='42501';
  end if;
  if not exists(select 1 from public.staff_users where id = p_target_staff_id) then
    raise exception 'The selected staff record no longer exists.' using errcode='P0002';
  end if;

  select coalesce(jsonb_agg(permission_key order by permission_key), '[]'::jsonb) into v_old_permissions
  from public.fc_staff_permissions where staff_id = p_target_staff_id and allowed is true;

  delete from public.fc_staff_permissions where staff_id = p_target_staff_id;
  insert into public.fc_staff_permissions(staff_id, permission_key, allowed, granted_by_staff_id, granted_at, updated_at)
  select p_target_staff_id, p.permission_key, true, v_actor.staff_id, now(), now()
  from public.fc_permissions p
  where p.active is true and p.permission_key <> 'all_access'
    and p.permission_key = any(coalesce(p_permission_keys, array[]::text[]));

  select coalesce(jsonb_agg(permission_key order by permission_key), '[]'::jsonb) into v_new_permissions
  from public.fc_staff_permissions where staff_id = p_target_staff_id and allowed is true;

  insert into public.fc_security_events(event_type,severity,login_id,staff_id,username_normalized,session_id,entity_type,entity_id,details)
  values ('ACCESS_CONTROL_CHANGED','HIGH',v_actor.login_id,v_actor.staff_id,lower(trim(v_actor.username)),v_actor.session_id,
    'staff_users',p_target_staff_id::text,jsonb_build_object('old_permissions',v_old_permissions,'new_permissions',v_new_permissions));
  return jsonb_build_object('ok',true,'staff_id',p_target_staff_id,'permission_keys',v_new_permissions);
end;
$$;
revoke all on function public.fc_save_staff_permissions_v1(text,text,uuid,text[]) from public;
grant execute on function public.fc_save_staff_permissions_v1(text,text,uuid,text[]) to anon, authenticated;

create or replace function public.fc_save_staff_login_v1(
  p_username text, p_session_token text, p_target_staff_id uuid, p_target_login_id uuid,
  p_target_username text, p_new_password text, p_role text, p_staff_active boolean, p_login_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor record;
  v_target public.login_users%rowtype;
  v_role text := trim(coalesce(p_role,''));
  v_old_staff_active boolean;
begin
  select * into v_actor from public.fc_require_session_permission_v2(p_username, p_session_token, 'staff.manage');
  if v_role not in ('Admin','Accounts','Accountant','Sales Rep','Driver','Warehouse','Super Admin') then
    raise exception 'Unsupported staff role.' using errcode='22023';
  end if;
  if v_role = 'Super Admin' and lower(trim(v_actor.username)) <> 'nisstaj_admin' then
    raise exception 'Only Nisstaj_admin can grant Super Admin access.' using errcode='42501';
  end if;
  select active into v_old_staff_active from public.staff_users where id = p_target_staff_id;
  if not found then raise exception 'The selected staff record no longer exists.' using errcode='P0002'; end if;

  if p_target_login_id is not null then
    select * into v_target from public.login_users
    where id = p_target_login_id and staff_id = p_target_staff_id and lower(trim(coalesce(role,''))) <> 'customer';
  else
    select * into v_target from public.login_users
    where staff_id = p_target_staff_id and lower(trim(coalesce(role,''))) <> 'customer'
    order by created_at desc nulls last limit 1;
  end if;

  if v_target.id is not null and lower(trim(v_target.username)) = 'nisstaj_admin' then
    raise exception 'Nisstaj_admin login is protected and cannot be changed.' using errcode='42501';
  end if;
  if nullif(lower(trim(coalesce(p_target_username,''))),'') is null then
    raise exception 'A staff username is required.' using errcode='22023';
  end if;
  if v_target.id is null and length(coalesce(p_new_password,'')) < 8 then
    raise exception 'A password of at least 8 characters is required for a new staff login.' using errcode='22023';
  end if;
  if p_new_password is not null and length(p_new_password) < 8 then
    raise exception 'The new password must be at least 8 characters.' using errcode='22023';
  end if;

  update public.staff_users set role=v_role, job_role=v_role, active=coalesce(p_staff_active,true) where id=p_target_staff_id;

  if v_target.id is null then
    insert into public.login_users(staff_id,username,password,password_hash,role,customer_account_id,active,password_changed_at)
    values(p_target_staff_id,lower(trim(p_target_username)),null,extensions.crypt(p_new_password,extensions.gen_salt('bf',12)),v_role,null,coalesce(p_login_enabled,true),now())
    returning * into v_target;
  else
    update public.login_users set
      username=lower(trim(p_target_username)), role=v_role, active=coalesce(p_login_enabled,true),
      password=case when p_new_password is not null then null else password end,
      password_hash=case when p_new_password is not null then extensions.crypt(p_new_password,extensions.gen_salt('bf',12)) else password_hash end,
      password_changed_at=case when p_new_password is not null then now() else password_changed_at end,
      auth_version=case when active is distinct from coalesce(p_login_enabled,true) or username is distinct from lower(trim(p_target_username)) or p_new_password is not null then auth_version+1 else auth_version end,
      updated_at=now()
    where id=v_target.id returning * into v_target;
  end if;

  if p_login_enabled is false or p_staff_active is false then
    update public.fc_login_sessions set revoked_at=now(), revoked_reason='STAFF_OFFBOARDED'
    where login_id=v_target.id and revoked_at is null;
  end if;

  insert into public.fc_security_events(event_type,severity,login_id,staff_id,username_normalized,session_id,entity_type,entity_id,details)
  values ('STAFF_LOGIN_CHANGED','HIGH',v_actor.login_id,v_actor.staff_id,lower(trim(v_actor.username)),v_actor.session_id,'login_users',v_target.id::text,
    jsonb_build_object('affected_staff_id',p_target_staff_id,'affected_username',v_target.username,'role',v_role,'staff_active',coalesce(p_staff_active,true),'login_enabled',coalesce(p_login_enabled,true),'password_changed',p_new_password is not null,'old_staff_active',v_old_staff_active));
  return jsonb_build_object('ok',true,'login_id',v_target.id,'staff_id',p_target_staff_id);
end;
$$;
revoke all on function public.fc_save_staff_login_v1(text,text,uuid,uuid,text,text,text,boolean,boolean) from public;
grant execute on function public.fc_save_staff_login_v1(text,text,uuid,uuid,text,text,text,boolean,boolean) to anon, authenticated;

create or replace function public.fc_customer_login_snapshot_v1(p_username text, p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor record;
  v_customers jsonb;
begin
  select * into v_actor from public.fc_require_session_permission_v2(p_username, p_session_token, 'page.login.customer_login');
  select coalesce(jsonb_agg(jsonb_build_object(
    'customer_account_id',c.id,'account_name',c.account_name,'account_active',c.active,
    'login_id',l.id,'username',l.username,'login_enabled',coalesce(l.active,false),'last_login_at',ls.last_success_at
  ) order by c.account_name), '[]'::jsonb) into v_customers
  from public.customer_accounts c
  left join lateral (
    select lu.* from public.login_users lu
    where lu.customer_account_id=c.id and lower(trim(coalesce(lu.role,'')))='customer'
    order by lu.created_at desc nulls last limit 1
  ) l on true
  left join public.fc_login_security_state ls on ls.username_normalized=lower(trim(l.username));
  return jsonb_build_object('customers',v_customers);
end;
$$;
revoke all on function public.fc_customer_login_snapshot_v1(text,text) from public;
grant execute on function public.fc_customer_login_snapshot_v1(text,text) to anon, authenticated;

create or replace function public.fc_save_customer_login_v1(
  p_username text, p_session_token text, p_customer_account_id uuid, p_login_id uuid,
  p_target_username text, p_new_password text, p_login_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor record;
  v_target public.login_users%rowtype;
  v_account_name text;
begin
  select * into v_actor from public.fc_require_session_permission_v2(p_username,p_session_token,'customers.create_login');
  select account_name into v_account_name from public.customer_accounts where id=p_customer_account_id;
  if not found then raise exception 'The selected customer account no longer exists.' using errcode='P0002'; end if;

  if p_login_id is not null then
    select * into v_target from public.login_users
    where id=p_login_id and customer_account_id=p_customer_account_id and lower(trim(coalesce(role,'')))='customer';
  else
    select * into v_target from public.login_users
    where customer_account_id=p_customer_account_id and lower(trim(coalesce(role,'')))='customer'
    order by created_at desc nulls last limit 1;
  end if;

  if nullif(lower(trim(coalesce(p_target_username,''))),'') is null then
    raise exception 'A customer username is required.' using errcode='22023';
  end if;
  if v_target.id is null and length(coalesce(p_new_password,'')) < 8 then
    raise exception 'A password of at least 8 characters is required for a new customer login.' using errcode='22023';
  end if;
  if p_new_password is not null and length(p_new_password) < 8 then
    raise exception 'The new password must be at least 8 characters.' using errcode='22023';
  end if;

  if v_target.id is null then
    insert into public.login_users(staff_id,username,password,password_hash,role,customer_account_id,active,password_changed_at)
    values(null,lower(trim(p_target_username)),null,extensions.crypt(p_new_password,extensions.gen_salt('bf',12)),'Customer',p_customer_account_id,coalesce(p_login_enabled,true),now())
    returning * into v_target;
  else
    -- Critical compatibility rule: when p_new_password is null, existing password and password_hash are untouched.
    update public.login_users set
      username=lower(trim(p_target_username)), role='Customer', customer_account_id=p_customer_account_id, active=coalesce(p_login_enabled,true),
      password=case when p_new_password is not null then null else password end,
      password_hash=case when p_new_password is not null then extensions.crypt(p_new_password,extensions.gen_salt('bf',12)) else password_hash end,
      password_changed_at=case when p_new_password is not null then now() else password_changed_at end,
      auth_version=case when active is distinct from coalesce(p_login_enabled,true) or username is distinct from lower(trim(p_target_username)) or p_new_password is not null then auth_version+1 else auth_version end,
      updated_at=now()
    where id=v_target.id returning * into v_target;
  end if;

  if p_login_enabled is false then
    update public.fc_login_sessions set revoked_at=now(), revoked_reason='CUSTOMER_PORTAL_OFFBOARDED'
    where login_id=v_target.id and revoked_at is null;
  end if;

  insert into public.fc_security_events(event_type,severity,login_id,staff_id,username_normalized,session_id,entity_type,entity_id,details)
  values ('CUSTOMER_LOGIN_CHANGED','HIGH',v_actor.login_id,v_actor.staff_id,lower(trim(v_actor.username)),v_actor.session_id,'login_users',v_target.id::text,
    jsonb_build_object('customer_account_id',p_customer_account_id,'account_name',v_account_name,'affected_username',v_target.username,'login_enabled',coalesce(p_login_enabled,true),'password_changed',p_new_password is not null));
  return jsonb_build_object('ok',true,'login_id',v_target.id,'customer_account_id',p_customer_account_id);
end;
$$;
revoke all on function public.fc_save_customer_login_v1(text,text,uuid,uuid,text,text,boolean) from public;
grant execute on function public.fc_save_customer_login_v1(text,text,uuid,uuid,text,text,boolean) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
