-- Per-staff report scope. Assignment uses the existing audited Access Control
-- permission-save API; no staff names or agency assignments are hard-coded.
begin;
insert into public.fc_permissions(permission_key,permission_name,category,description,active)
values
 ('agency.middleton_england','Middleton England','Agencies','View Middleton England agency reports.',true),
 ('agency.south_england','South England','Agencies','View South England agency reports.',true),
 ('agency.west_england','West England','Agencies','View West England agency reports.',true),
 ('agency.east_england','East England','Agencies','View East England agency reports.',true),
 ('agency.wales','Wales','Agencies','View Wales agency reports.',true),
 ('agency.shared_totals','Shared stock and business expenses','Agencies','View country-wide stock and business-wide expenses alongside assigned agency reports.',true)
on conflict(permission_key) do update set permission_name=excluded.permission_name,category=excluded.category,
 description=excluded.description,active=true,updated_at=now();

create or replace function public.fc_require_agency_access_v1(p_username text,p_session_token text,p_group text)
returns table(staff_id uuid,staff_role text,effective_permissions jsonb,can_view_shared_totals boolean)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor record; v_key text; v_all boolean;
begin
 select * into strict actor from public.fc_require_session_permission_v2(p_username,p_session_token,'order.checkout.payment');
 if actor.staff_id is null or lower(coalesce(actor.staff_role,''))='customer' then
  raise exception 'Active staff access required.' using errcode='42501'; end if;
 v_all:=coalesce((actor.effective_permissions->>'all_access')::boolean,false);
 v_key:=case p_group when 'Middleton England' then 'agency.middleton_england' when 'South England' then 'agency.south_england'
  when 'West England' then 'agency.west_england' when 'East England' then 'agency.east_england' when 'Wales' then 'agency.wales' end;
 -- The legacy all-England report has no agency parameter. Only system-wide
 -- administrators may use it; group-assigned staff must use scoped endpoints.
 if p_group is null then
  if not v_all then raise exception 'Agency access denied. Use your assigned agency report.' using errcode='42501';end if;
 elsif v_key is null then raise exception 'Invalid Performance Group.';
 elsif not (v_all or coalesce((actor.effective_permissions->>v_key)::boolean,false)) then
  raise exception 'Agency access denied. Ask an administrator to assign this agency.' using errcode='42501';
 end if;
 return query select actor.staff_id,actor.staff_role,actor.effective_permissions,
  v_all or coalesce((actor.effective_permissions->>'agency.shared_totals')::boolean,false);
end;$$;
revoke all on function public.fc_require_agency_access_v1(text,text,text) from public,anon,authenticated;

create or replace function public.fc_agency_access_snapshot_v1(p_username text,p_session_token text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor record; v_all boolean; v_groups jsonb;
begin
 select * into strict actor from public.fc_require_session_permission_v2(p_username,p_session_token,'order.checkout.payment');
 if actor.staff_id is null or lower(coalesce(actor.staff_role,''))='customer' then raise exception 'Active staff access required.' using errcode='42501';end if;
 v_all:=coalesce((actor.effective_permissions->>'all_access')::boolean,false);
 select coalesce(jsonb_agg(g.name order by g.position),'[]'::jsonb) into v_groups
 from (values (1,'Middleton England','agency.middleton_england'),(2,'South England','agency.south_england'),
  (3,'West England','agency.west_england'),(4,'East England','agency.east_england'),(5,'Wales','agency.wales')) g(position,name,key)
 where v_all or coalesce((actor.effective_permissions->>g.key)::boolean,false);
 return jsonb_build_object('groups',v_groups,'can_view_shared_totals',
  v_all or coalesce((actor.effective_permissions->>'agency.shared_totals')::boolean,false));
end;$$;
revoke all on function public.fc_agency_access_snapshot_v1(text,text) from public;
grant execute on function public.fc_agency_access_snapshot_v1(text,text) to anon,authenticated;

-- Harden every existing report entry point, including older client endpoints.
-- Fail if an unexpected implementation no longer contains the reviewed guard.
do $migration$
declare signature text; definition text; replacement text;
 guard text := 'from public.fc_require_session_permission_v2(p_username,p_session_token,''order.checkout.payment'');';
begin
 foreach signature in array array[
  'public.fc_agency_performance_v1(text,text,date,date,text,text)',
  'public.fc_agency_performance_v2(text,text,date,date,text,text,text)',
  'public.fc_agency_customer_sales_v1(text,text,date,date,text,text,text,integer)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  replacement:='from public.fc_require_agency_access_v1(p_username,p_session_token,' ||
   case when signature like 'public.fc_agency_performance_v1(%' then 'null' else 'p_performance_group' end || ');';
  if position(guard in definition)>0 then
   definition:=replace(definition,guard,replacement);
  elsif position(replacement in definition)=0 then
   raise exception 'Agency report session guard differs: %. Review before applying.',signature;
  end if;
  if signature like 'public.fc_agency_performance_v2(%' and position('shared_totals_visible' in definition)=0 then
   definition:=replace(definition,'return result;',
    'result:=result-''unlocated_accounts'';
     if actor.can_view_shared_totals then result:=result||jsonb_build_object(''shared_totals_visible'',true);
     else result:=result||jsonb_build_object(''shared_totals_visible'',false,''stock_units'',null,''stock_locations'',''[]''::jsonb,''shared_expenses'',null);end if;
     return result;');
  end if;
  execute definition;
 end loop;
end;
$migration$;
notify pgrst,'reload schema';
commit;
