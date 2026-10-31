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
