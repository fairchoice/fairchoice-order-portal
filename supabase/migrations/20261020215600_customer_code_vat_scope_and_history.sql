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
