-- Production dependency repair. Original migrations remain for clean installs.
-- No legacy overlay backfill, generated codes, repricing, or saved-row updates.
-- Existing installations are a no-op. Partial installations fail for review.
set local lock_timeout='5s';
set local statement_timeout='60s';
create temporary table fc_pricing_install_baseline(table_name text primary key, row_count bigint, fingerprint text) on commit drop;
do $snapshot$
declare r record; n bigint; h text; excluded text[];
begin
 for r in select tablename from pg_tables where schemaname='public' order by tablename loop
  execute format('lock table public.%I in share mode',r.tablename);
  excluded:=case r.tablename when 'customer_accounts' then array['customer_price_overlay_code_ids']
   when 'customer_price_codes' then array['applies_to_price_mode','customer_account_id'] else '{}'::text[] end;
  execute format($hash$select count(*),md5(coalesce(string_agg(h, '' order by h),'')) from (select md5((to_jsonb(t)-$1)::text) h from public.%I t) s$hash$,r.tablename) into n,h using excluded;
  insert into fc_pricing_install_baseline values(r.tablename,n,h);
 end loop;
end;$snapshot$;
do $install$
begin
 if to_regprocedure('public.fc_generate_individual_customer_code_v1(text,text,uuid,jsonb)') is not null then
  if to_regprocedure('public.fc_apply_individual_customer_prices_v1(text,text,jsonb,jsonb,jsonb)') is null or
     to_regprocedure('public.fc_edit_individual_customer_percent_v1(text,text,uuid,numeric,numeric)') is null then
   raise exception 'Partial individual pricing installation; review before proceeding';
  end if;
 else
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='customer_price_codes' and column_name='customer_account_id')
   or to_regclass('public.customer_code_change_history') is not null then
   raise exception 'Partial pricing schema exists; review before proceeding';
  end if;
  execute $pricing_ddl$
-- Additional exact-price offer codes. The original single code remains compatible.
-- Existing customer_accounts access rules and grants are retained.
alter table public.customer_accounts
  add column if not exists customer_price_overlay_code_ids uuid[] not null default '{}';

comment on column public.customer_accounts.customer_price_overlay_code_ids is
  'Additional exact-price Sub Codes. Lowest matching offer price wins; Base Code is the fallback.';

-- Only customer pricing configuration is affected. No orders, invoices, ledger,
-- payments, credits or existing assignments/modes are updated by this migration.
alter table public.customer_price_codes add column if not exists applies_to_price_mode text not null default 'both'
 check (applies_to_price_mode in ('inc vat','ex vat','both'));

create table public.customer_code_change_history (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null,
 changed_at timestamptz not null default now(), changed_by text not null,
 before_state jsonb not null, after_state jsonb not null,
 reason text, reverses_change_id uuid references public.customer_code_change_history(id)
);
create index customer_code_change_history_customer_time on public.customer_code_change_history(customer_id,changed_at desc);
alter table public.customer_code_change_history enable row level security;
revoke all on public.customer_code_change_history from public,anon,authenticated,service_role;

create function public.fc_customer_code_state_v1(j jsonb) returns jsonb
 language sql immutable set search_path='' as $$ select jsonb_build_object(
 'default_price_mode',j->'default_price_mode','customer_price_code_id',j->'customer_price_code_id',
 'customer_price_overlay_code_id',j->'customer_price_overlay_code_id',
 'customer_price_overlay_code_ids',coalesce(j->'customer_price_overlay_code_ids','[]'::jsonb)) $$;
revoke all on function public.fc_customer_code_state_v1(jsonb) from public,anon,authenticated,service_role;
create function public.fc_customer_vat_mode_v1(mode text) returns text
 language sql immutable set search_path='' as $$ select case when lower(regexp_replace(regexp_replace(trim(coalesce(mode,'VAT')),'[._-]+',' ','g'),'\s+',' ','g'))
 in ('server','inc vat','incvat','royalty','owner offer','manager','manager offer') then 'inc vat' else 'ex vat' end $$;
revoke all on function public.fc_customer_vat_mode_v1(text) from public,anon,authenticated,service_role;

create function public.fc_audit_customer_code_change_v1() returns trigger
 language plpgsql security definer set search_path=pg_catalog,public as $$
declare previous jsonb; upcoming jsonb; code_id uuid; previous_codes uuid[]; next_codes uuid[];
begin
 previous:=public.fc_customer_code_state_v1(to_jsonb(old));upcoming:=public.fc_customer_code_state_v1(to_jsonb(new));
 if previous=upcoming then return new;end if;
 previous_codes:=array_remove(array[old.customer_price_code_id,old.customer_price_overlay_code_id]||old.customer_price_overlay_code_ids,null);
 next_codes:=array_remove(array[new.customer_price_code_id,new.customer_price_overlay_code_id]||new.customer_price_overlay_code_ids,null);
 if current_setting('fc.customer_code_restore',true) is distinct from 'verified' then
  if new.default_price_mode is distinct from old.default_price_mode and
   (previous-'default_price_mode') is distinct from (upcoming-'default_price_mode') then
   raise exception 'Code assignment cannot change the customer VAT mode. Change the VAT mode separately.' using errcode='23514';
  end if;
  foreach code_id in array next_codes loop
   if not code_id=any(previous_codes) and not exists(select 1 from public.customer_price_codes c where c.id=code_id and c.active and
    (c.applies_to_price_mode='both' or c.applies_to_price_mode=public.fc_customer_vat_mode_v1(new.default_price_mode))) then
    raise exception 'Code does not match the customer VAT mode.' using errcode='23514';
   end if;
  end loop;
 end if;
 insert into public.customer_code_change_history(customer_id,changed_by,before_state,after_state,reason,reverses_change_id)
 values(new.id,coalesce(nullif(current_setting('fc.customer_code_actor',true),''),session_user),previous,upcoming,
 nullif(current_setting('fc.customer_code_reason',true),''),nullif(current_setting('fc.customer_code_reversal',true),'')::uuid);
 return new;
end;$$;
revoke all on function public.fc_audit_customer_code_change_v1() from public,anon,authenticated,service_role;
create trigger fc_audit_customer_code_change before update on public.customer_accounts
 for each row execute function public.fc_audit_customer_code_change_v1();
create trigger fc_customer_code_history_immutable before update or delete on public.customer_code_change_history
 for each row execute function public.fc_deny_invoice_archive_changes_v1();
create trigger fc_customer_code_history_no_truncate before truncate on public.customer_code_change_history
 for each statement execute function public.fc_deny_invoice_archive_changes_v1();

create function public.fc_assign_customer_price_code_v1(p_username text,p_session_token text,p_customer_id uuid,p_code_id uuid,
 p_kind text,p_remove boolean,p_expected jsonb) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor record;a public.customer_accounts%rowtype;c public.customer_price_codes%rowtype;ids uuid[];
begin
 select * into strict actor from public.fc_require_session_permission_v2(p_username,p_session_token,'can_edit_pricing');
 if p_kind not in ('base','offer') or p_kind is null or p_remove is null then raise exception 'Invalid assignment action';end if;
 select * into strict a from public.customer_accounts where id=p_customer_id for update;
 if public.fc_customer_code_state_v1(to_jsonb(a)) is distinct from p_expected then raise exception 'Customer changed. Refresh and try again.' using errcode='40001';end if;
 if not p_remove then
  select * into strict c from public.customer_price_codes where id=p_code_id for share;
  if not c.active or (c.applies_to_price_mode<>'both' and c.applies_to_price_mode<>public.fc_customer_vat_mode_v1(a.default_price_mode)) then
   return jsonb_build_object('status','skipped','reason','VAT mode mismatch','state',p_expected);end if;
  if p_kind='base' and c.code_type='sub' then raise exception 'Sub Codes cannot replace a Base Code';end if;
  if p_kind='offer' and c.code_type='sub' and c.parent_price_code_id is distinct from a.customer_price_code_id then
   return jsonb_build_object('status','skipped','reason','Parent Base Code mismatch','state',p_expected);end if;
 end if;
 perform set_config('fc.customer_code_actor',actor.username,true);
 perform set_config('fc.customer_code_reason',case when p_remove then 'Remove ' else 'Assign ' end||p_kind||' code',true);
 if p_kind='base' then
  update public.customer_accounts set customer_price_code_id=case when p_remove then null else p_code_id end where id=a.id;
 else
  select coalesce(array_agg(distinct id order by id),'{}'::uuid[]) into ids from unnest(array[a.customer_price_overlay_code_id]||a.customer_price_overlay_code_ids) id where id is not null;
  if p_remove then ids:=array_remove(ids,p_code_id);
  elsif p_code_id is distinct from a.customer_price_code_id and not p_code_id=any(ids) then ids:=array_append(ids,p_code_id);end if;
  update public.customer_accounts set customer_price_overlay_code_ids=ids,customer_price_overlay_code_id=ids[1] where id=a.id;
 end if;
 select * into strict a from public.customer_accounts where id=p_customer_id;
 return jsonb_build_object('status','saved','state',public.fc_customer_code_state_v1(to_jsonb(a)));
end;$$;
revoke all on function public.fc_assign_customer_price_code_v1(text,text,uuid,uuid,text,boolean,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.fc_assign_customer_price_code_v1(text,text,uuid,uuid,text,boolean,jsonb) to anon,authenticated;

create function public.fc_customer_code_history_v1(p_username text,p_session_token text,p_customer_id uuid) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 perform public.fc_require_session_permission_v2(p_username,p_session_token,'can_edit_pricing');
 if lower(trim(p_username))<>'nisstaj_admin' then raise exception 'Only nisstaj_admin can review reversals' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(t) order by t.changed_at desc) from
 (select * from public.customer_code_change_history where customer_id=p_customer_id order by changed_at desc limit 50) t),'[]'::jsonb);
end;$$;
revoke all on function public.fc_customer_code_history_v1(text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.fc_customer_code_history_v1(text,text,uuid) to anon,authenticated;

create function public.fc_reverse_customer_code_change_v1(p_username text,p_session_token text,p_change_id uuid,p_reason text) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor record;h public.customer_code_change_history%rowtype;a public.customer_accounts%rowtype;
begin
 select * into strict actor from public.fc_require_session_permission_v2(p_username,p_session_token,'can_edit_pricing');
 if actor.username<>'nisstaj_admin' then raise exception 'Only nisstaj_admin can reverse a recorded change' using errcode='42501';end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'A specific reversal reason is required';end if;
 select * into strict h from public.customer_code_change_history where id=p_change_id;
 select * into strict a from public.customer_accounts where id=h.customer_id for update;
 if public.fc_customer_code_state_v1(to_jsonb(a)) is distinct from h.after_state then raise exception 'Customer changed again. This reversal is no longer safe.' using errcode='40001';end if;
 perform set_config('fc.customer_code_actor',actor.username,true);perform set_config('fc.customer_code_reason',trim(p_reason),true);
 perform set_config('fc.customer_code_restore','verified',true);perform set_config('fc.customer_code_reversal',h.id::text,true);
 update public.customer_accounts set default_price_mode=h.before_state->>'default_price_mode',
 customer_price_code_id=(h.before_state->>'customer_price_code_id')::uuid,
 customer_price_overlay_code_id=(h.before_state->>'customer_price_overlay_code_id')::uuid,
 customer_price_overlay_code_ids=array(select jsonb_array_elements_text(h.before_state->'customer_price_overlay_code_ids')::uuid)
 where id=a.id;
 perform set_config('fc.customer_code_restore','',true);perform set_config('fc.customer_code_reversal','',true);
 select * into strict a from public.customer_accounts where id=h.customer_id;
 return public.fc_customer_code_state_v1(to_jsonb(a));
end;$$;
revoke all on function public.fc_reverse_customer_code_change_v1(text,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.fc_reverse_customer_code_change_v1(text,text,uuid,text) to anon,authenticated;

-- Only the new-invoice calculation gains CODE:...|ex vat support. Existing
-- canonical invoices still return early from sync and cannot be recalculated.
do $patch$ declare definition text; begin
 select pg_get_functiondef('public.fc_invoice_document_total_v1(uuid)'::regprocedure) into definition;
 if position('mode in (''vat'',''admin'',''admin offer'',''long customer'',''long customers'',''super'') add_vat' in definition)=0 then
  raise exception 'Unexpected invoice calculation version. Review before installing.';
 end if;
 definition:=replace(definition,'mode in (''vat'',''admin'',''admin offer'',''long customer'',''long customers'',''super'') add_vat',
 '(mode in (''vat'',''admin'',''admin offer'',''long customer'',''long customers'',''super'') or (lower(trim(price_mode)) like ''code:%'' and lower(split_part(price_mode,''|'',2))=''ex vat'')) add_vat');
 execute definition;
end;$patch$;

-- Use the registered permission key, matching the existing Pricing Rules screen.
do $patch$ declare signature text; definition text; begin
 foreach signature in array array[
 'public.fc_assign_customer_price_code_v1(text,text,uuid,uuid,text,boolean,jsonb)',
 'public.fc_customer_code_history_v1(text,text,uuid)',
 'public.fc_reverse_customer_code_change_v1(text,text,uuid,text)'
 ] loop
  select pg_get_functiondef(signature::regprocedure) into definition;
  if position('''can_edit_pricing''' in definition)=0 then raise exception 'Unexpected code RPC permission version';end if;
  execute replace(definition,'''can_edit_pricing''','''page.product.pricing_rules''');
 end loop;
end;$patch$;

-- Additive installation only: no existing customer, price, order, invoice,
-- credit, payment or ledger row is rewritten. Generation is an explicit RPC.
alter table public.customer_price_codes add column customer_account_id uuid unique references public.customer_accounts(id);
create table public.customer_individual_price_audit (
 id uuid primary key default gen_random_uuid(),changed_at timestamptz not null default now(),
 changed_by text not null,customer_id uuid not null,code_id uuid not null,
 action text not null,before_state jsonb not null,after_state jsonb not null
);
alter table public.customer_individual_price_audit enable row level security;
revoke all on public.customer_individual_price_audit from public,anon,authenticated,service_role;
create index customer_individual_price_audit_customer on public.customer_individual_price_audit(customer_id,changed_at desc);
create trigger fc_individual_price_audit_immutable before update or delete on public.customer_individual_price_audit
 for each row execute function public.fc_deny_invoice_archive_changes_v1();
create trigger fc_individual_price_audit_no_truncate before truncate on public.customer_individual_price_audit
 for each statement execute function public.fc_deny_invoice_archive_changes_v1();

create table public.fc_individual_price_context (
 transaction_id bigint not null,backend_pid int not null,actor text not null,
 primary key(transaction_id,backend_pid)
);
alter table public.fc_individual_price_context enable row level security;
revoke all on public.fc_individual_price_context from public,anon,authenticated,service_role;

create function public.fc_guard_individual_customer_code_v1() returns trigger
 language plpgsql security definer set search_path=pg_catalog,public as $$
declare owned uuid;old_owner uuid;restricted boolean:=false;
begin
 if tg_table_name='customer_accounts' then
  select customer_account_id into owned from public.customer_price_codes where id=new.customer_price_code_id;
  if owned is not null then
   if owned<>new.id then raise exception 'Individual codes belong to one customer only.' using errcode='23514';end if;
   if new.customer_price_overlay_code_id is not null or cardinality(new.customer_price_overlay_code_ids)>0 then
    raise exception 'This customer has one individual code. Update its product prices instead of adding codes.' using errcode='23514';end if;
  end if;
  if tg_op='UPDATE' then
   select customer_account_id into old_owner from public.customer_price_codes where id=old.customer_price_code_id;
   if old_owner is not null and new.customer_price_code_id is distinct from old.customer_price_code_id
    and current_setting('fc.customer_code_restore',true) is distinct from 'verified' then
    raise exception 'Keep the individual customer code; edit its prices or percentage.' using errcode='23514';end if;
  end if;
  return new;
 elsif tg_table_name='customer_price_codes' then
  if tg_op<>'INSERT' then restricted:=old.customer_account_id is not null;end if;
  if tg_op<>'DELETE' then restricted:=restricted or new.customer_account_id is not null;end if;
 else
  if tg_op<>'INSERT' then restricted:=exists(select 1 from public.customer_price_codes where id=old.price_code_id and customer_account_id is not null);end if;
  if tg_op<>'DELETE' then restricted:=restricted or exists(select 1 from public.customer_price_codes where id=new.price_code_id and customer_account_id is not null);end if;
 end if;
 if restricted and not exists(select 1 from public.fc_individual_price_context where transaction_id=txid_current() and backend_pid=pg_backend_pid()) then
  raise exception 'Use the verified individual customer pricing action.' using errcode='42501';end if;
 return case when tg_op='DELETE' then old else new end;
end;$$;
revoke all on function public.fc_guard_individual_customer_code_v1() from public,anon,authenticated,service_role;
create trigger zz_fc_customer_individual_code before insert or update on public.customer_accounts
 for each row execute function public.fc_guard_individual_customer_code_v1();
create trigger fc_individual_code_write before insert or update or delete on public.customer_price_codes
 for each row execute function public.fc_guard_individual_customer_code_v1();
create trigger fc_individual_product_price_write before insert or update or delete on public.product_price_code_prices
 for each row execute function public.fc_guard_individual_customer_code_v1();

create function public.fc_generate_individual_customer_code_v1(p_username text,p_session_token text,p_customer_id uuid,p_expected jsonb) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor record;a public.customer_accounts%rowtype;c public.customer_price_codes%rowtype;
 previous jsonb;prefix text;label text;pct numeric:=0;base_id uuid;mode text;settings jsonb;tries int:=0;
begin
 select * into strict actor from public.fc_require_session_permission_v2(p_username,p_session_token,'page.product.pricing_rules');
 select * into strict a from public.customer_accounts where id=p_customer_id for update;
 previous:=public.fc_customer_code_state_v1(to_jsonb(a));
 if previous is distinct from p_expected then raise exception 'Customer changed. Refresh before generating a code.' using errcode='40001';end if;
 select * into c from public.customer_price_codes where customer_account_id=a.id;
 if found then
  if a.customer_price_code_id is distinct from c.id then raise exception 'An individual code already exists; review the recorded customer assignment.';end if;
  return jsonb_build_object('code',to_jsonb(c),'state',previous,'created',false);
 end if;
 mode:=public.fc_customer_vat_mode_v1(a.default_price_mode);
 select id,discount_percent into base_id,pct from public.customer_price_codes
 where id=a.customer_price_code_id and active and (applies_to_price_mode='both' or applies_to_price_mode=mode) for share;
 if base_id is null then
  select to_jsonb(s) into settings from public.pricing_settings s where id=1;
  pct:=case when mode='inc vat' then coalesce((settings->>'server_pricing_percent')::numeric,(settings->>'server_discount_percent')::numeric,0) else 0 end;
 end if;
 prefix:=left(upper(regexp_replace(coalesce(a.account_name,''),'[^a-zA-Z]','','g')),3);
 prefix:=rpad(coalesce(nullif(prefix,''),'CUS'),3,'X');
 insert into public.fc_individual_price_context values(txid_current(),pg_backend_pid(),actor.username);
 loop
  tries:=tries+1;if tries>25 then raise exception 'Could not allocate a unique code. Retry generation.';end if;
  label:=prefix||'-'||(100000+floor(random()*900000)::int)::text;
  begin
   insert into public.customer_price_codes(code,discount_percent,active,code_type,exact_only,applies_to_price_mode,customer_account_id)
   values(label,coalesce(pct,0),true,'base',false,'both',a.id) returning * into c;
   exit;
  exception when unique_violation then null;end;
 end loop;
 -- Copy exactly the previously effective explicit prices. Offers take priority
 -- over the old Base Code, matching the current legacy pricing calculation.
 with sources as (
  select x.id,coalesce(x.id=base_id,false) is_base from public.customer_price_codes x where x.active
   and (x.applies_to_price_mode='both' or x.applies_to_price_mode=mode)
   and (x.id=base_id or (x.id<>coalesce(base_id,'00000000-0000-0000-0000-000000000000'::uuid)
    and x.id=any(array[a.customer_price_overlay_code_id]||a.customer_price_overlay_code_ids)
    and (x.code_type<>'sub' or x.parent_price_code_id=a.customer_price_code_id)))
 ), effective as (
  select p.product_id,coalesce(min(p.price) filter(where not s.is_base),min(p.price) filter(where s.is_base)) price
  from public.product_price_code_prices p join sources s on s.id=p.price_code_id where p.active and p.price>0 group by p.product_id
 ) insert into public.product_price_code_prices(product_id,price_code_id,price,active)
 select product_id,c.id,price,true from effective where price>0;
 perform set_config('fc.customer_code_actor',actor.username,true);
 perform set_config('fc.customer_code_reason','Generate one individual customer code; preserve existing pricing',true);
 update public.customer_accounts set customer_price_code_id=c.id,customer_price_overlay_code_id=null,customer_price_overlay_code_ids='{}'::uuid[] where id=a.id;
 select * into strict a from public.customer_accounts where id=p_customer_id;
 insert into public.customer_individual_price_audit(changed_by,customer_id,code_id,action,before_state,after_state)
 values(actor.username,a.id,c.id,'GENERATE',previous,jsonb_build_object('code',to_jsonb(c),'customer',public.fc_customer_code_state_v1(to_jsonb(a)),
 'prices',coalesce((select jsonb_agg(to_jsonb(p) order by p.product_id) from public.product_price_code_prices p where p.price_code_id=c.id),'[]'::jsonb)));
 delete from public.fc_individual_price_context where transaction_id=txid_current() and backend_pid=pg_backend_pid();
 return jsonb_build_object('code',to_jsonb(c),'state',public.fc_customer_code_state_v1(to_jsonb(a)),'created',true);
end;$$;
revoke all on function public.fc_generate_individual_customer_code_v1(text,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.fc_generate_individual_customer_code_v1(text,text,uuid,jsonb) to anon,authenticated;

create function public.fc_apply_individual_customer_prices_v1(p_username text,p_session_token text,p_targets jsonb,p_prices jsonb,p_scope jsonb) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor record;t record;a public.customer_accounts%rowtype;c public.customer_price_codes%rowtype;p record;
 before_rows jsonb;after_rows jsonb;updated int:=0;skipped jsonb:='[]'::jsonb;mode text;
 country_filter text:=lower(trim(coalesce(p_scope->>'country','All')));city_filter text:=lower(trim(coalesce(p_scope->>'city','All')));
 mode_filter text:=coalesce(p_scope->>'priceMode','both');exclusions text[];
begin
 select * into strict actor from public.fc_require_session_permission_v2(p_username,p_session_token,'page.product.pricing_rules');
 if jsonb_typeof(p_targets) is distinct from 'array' or jsonb_array_length(p_targets) not between 1 and 500
 or jsonb_typeof(p_prices) is distinct from 'array' or jsonb_array_length(p_prices) not between 1 and 100
 or mode_filter not in('inc vat','ex vat','both') then raise exception 'Choose customers, products and a valid VAT-mode scope.';end if;
 if (select count(distinct x->>'id') from jsonb_array_elements(p_targets)x)<>jsonb_array_length(p_targets)
 or (select count(distinct x->>'product_id') from jsonb_array_elements(p_prices)x)<>jsonb_array_length(p_prices) then raise exception 'Duplicate or missing customers/products';end if;
 for p in select value v from jsonb_array_elements(p_prices) loop
  if not (p.v ? 'price') or (p.v->'price'<>'null'::jsonb and (round((p.v->>'price')::numeric,2)<=0 or (p.v->>'price')::numeric>='Infinity'::numeric)) then raise exception 'Exact prices must be positive; choose explicit removal to use the percentage.';end if;
  if not exists(select 1 from public.products where id=(p.v->>'product_id')::uuid) then raise exception 'Product no longer exists';end if;
 end loop;
 select coalesce(array_agg(lower(trim(x))),'{}'::text[]) into exclusions from jsonb_array_elements_text(coalesce(p_scope->'excludedCities','[]'::jsonb))x;
 insert into public.fc_individual_price_context values(txid_current(),pg_backend_pid(),actor.username);
 for t in select (x->>'id')::uuid id,(x->>'code_id')::uuid code_id,x->>'price_mode' price_mode from jsonb_array_elements(p_targets)x order by (x->>'id')::uuid loop
  select * into strict a from public.customer_accounts where id=t.id for update;
  if a.default_price_mode is distinct from t.price_mode or a.customer_price_code_id is distinct from t.code_id then raise exception 'Customer pricing changed. Refresh the preview before applying prices.' using errcode='40001';end if;
  mode:=public.fc_customer_vat_mode_v1(a.default_price_mode);
  if a.active is false or (country_filter not in('','all') and lower(trim(coalesce(a.country,'')))<>country_filter)
   or (city_filter not in('','all') and lower(trim(coalesce(a.town_city,'')))<>city_filter)
   or lower(trim(coalesce(a.town_city,'')))=any(exclusions) or (mode_filter<>'both' and mode<>mode_filter) then
   skipped:=skipped||jsonb_build_array(jsonb_build_object('id',a.id,'reason','Customer is outside the selected geographic/VAT-mode scope'));continue;
  end if;
  select * into c from public.customer_price_codes where id=a.customer_price_code_id and customer_account_id=a.id and active for update;
  if not found then raise exception 'Generate an individual code for every selected customer first.';end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.product_id),'[]'::jsonb) into before_rows from public.product_price_code_prices x where x.price_code_id=c.id and x.product_id in(select (v->>'product_id')::uuid from jsonb_array_elements(p_prices)v);
  for p in select (v->>'product_id')::uuid product_id,(v->>'price')::numeric price from jsonb_array_elements(p_prices)v order by (v->>'product_id')::uuid loop
   if p.price is null then delete from public.product_price_code_prices where price_code_id=c.id and product_id=p.product_id;
   else insert into public.product_price_code_prices(product_id,price_code_id,price,active,updated_at) values(p.product_id,c.id,round(p.price,2),true,now())
    on conflict(product_id,price_code_id) do update set price=excluded.price,active=true,updated_at=excluded.updated_at;end if;
  end loop;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.product_id),'[]'::jsonb) into after_rows from public.product_price_code_prices x where x.price_code_id=c.id and x.product_id in(select (v->>'product_id')::uuid from jsonb_array_elements(p_prices)v);
  insert into public.customer_individual_price_audit(changed_by,customer_id,code_id,action,before_state,after_state)
  values(actor.username,a.id,c.id,'PRODUCT_PRICES',jsonb_build_object('prices',before_rows,'price_mode',a.default_price_mode),jsonb_build_object('prices',after_rows,'scope',p_scope,'price_mode',a.default_price_mode));
  updated:=updated+1;
 end loop;
 delete from public.fc_individual_price_context where transaction_id=txid_current() and backend_pid=pg_backend_pid();
 return jsonb_build_object('updated_customers',updated,'skipped',skipped,'products',jsonb_array_length(p_prices));
end;$$;
revoke all on function public.fc_apply_individual_customer_prices_v1(text,text,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.fc_apply_individual_customer_prices_v1(text,text,jsonb,jsonb,jsonb) to anon,authenticated;

create function public.fc_edit_individual_customer_percent_v1(p_username text,p_session_token text,p_code_id uuid,p_percent numeric,p_expected_percent numeric) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor record;c public.customer_price_codes%rowtype;old_pct numeric;
begin
 select * into strict actor from public.fc_require_session_permission_v2(p_username,p_session_token,'page.product.pricing_rules');
 if p_percent is null or p_percent<0 or p_percent>100 then raise exception 'Enter a reduction between 0 and 100 percent';end if;
 select * into strict c from public.customer_price_codes where id=p_code_id and customer_account_id is not null for update;
 if c.discount_percent is distinct from p_expected_percent then raise exception 'Percentage changed. Refresh and try again.' using errcode='40001';end if;
 old_pct:=c.discount_percent;
 insert into public.fc_individual_price_context values(txid_current(),pg_backend_pid(),actor.username);
 update public.customer_price_codes set discount_percent=round(p_percent,2),updated_at=now() where id=c.id returning * into c;
 insert into public.customer_individual_price_audit(changed_by,customer_id,code_id,action,before_state,after_state)
 values(actor.username,c.customer_account_id,c.id,'PERCENTAGE',jsonb_build_object('discount_percent',old_pct),jsonb_build_object('discount_percent',c.discount_percent));
 delete from public.fc_individual_price_context where transaction_id=txid_current() and backend_pid=pg_backend_pid();
 return to_jsonb(c);
end;$$;
revoke all on function public.fc_edit_individual_customer_percent_v1(text,text,uuid,numeric,numeric) from public,anon,authenticated,service_role;
grant execute on function public.fc_edit_individual_customer_percent_v1(text,text,uuid,numeric,numeric) to anon,authenticated;

$pricing_ddl$;
 end if;
end;$install$;
do $verify$
declare r record; n bigint; h text; excluded text[];
begin
 for r in select * from fc_pricing_install_baseline order by table_name loop
  excluded:=case r.table_name when 'customer_accounts' then array['customer_price_overlay_code_ids']
   when 'customer_price_codes' then array['applies_to_price_mode','customer_account_id'] else '{}'::text[] end;
  execute format($hash$select count(*),md5(coalesce(string_agg(h, '' order by h),'')) from (select md5((to_jsonb(t)-$1)::text) h from public.%I t) s$hash$,r.table_name) into n,h using excluded;
  if n<>r.row_count or h is distinct from r.fingerprint then
   raise exception 'Installation changed existing rows in %. Entire installation rolled back.',r.table_name;
  end if;
 end loop;
 raise notice 'Existing rows in all % public tables verified unchanged.',(select count(*) from fc_pricing_install_baseline);
end;$verify$;
notify pgrst,'reload schema';
