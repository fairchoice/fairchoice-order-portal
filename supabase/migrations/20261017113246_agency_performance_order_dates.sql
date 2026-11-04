-- orders.delivered_at/created_at are timestamp-without-time-zone columns.
-- The application writes UTC ISO timestamps into them. Interpret them as UTC
-- before applying the report's UK business-day boundaries (including BST).
begin;
do $migration$
declare definition text;
 old_expression text := 'coalesce(o.delivered_at,o.created_at) at time zone ''Europe/London''';
 new_expression text := 'coalesce(o.delivered_at,o.created_at) at time zone ''UTC''';
begin
 definition:=pg_get_functiondef('public.fc_agency_performance_v1(text,text,date,date,text,text)'::regprocedure);
 if position(old_expression in definition)>0 then
  execute replace(definition,old_expression,new_expression);
 elsif position(new_expression in definition)=0 then
  raise exception 'Agency report order-date implementation differs; review before updating.';
 end if;
end;
$migration$;
notify pgrst,'reload schema';
commit;
