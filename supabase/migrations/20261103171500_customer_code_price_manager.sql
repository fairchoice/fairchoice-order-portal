CREATE OR REPLACE FUNCTION public.fc_manage_applied_code_prices_v1(p_username text, p_session_token text, p_changes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$ DECLARE actor record; item jsonb; existing record; owner_id uuid; new_mode text; new_price numeric; action text; changed int:=0; BEGIN SELECT * INTO STRICT actor FROM public.fc_require_session_permission_v2(p_username,p_session_token,'page.product.pricing_rules'); IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_changes) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Choose 1 to 100 price rows'; END IF; IF (SELECT count(distinct x->>'id') FROM jsonb_array_elements(p_changes)x)<>jsonb_array_length(p_changes) THEN RAISE EXCEPTION 'Duplicate price rows'; END IF; INSERT INTO public.fc_individual_price_context(transaction_id,backend_pid,actor) VALUES(txid_current(),pg_backend_pid(),actor.username); FOR item IN SELECT value FROM jsonb_array_elements(p_changes) LOOP SELECT x.id,x.product_id,x.price_code_id,x.price,x.price_mode,x.active INTO existing FROM public.product_price_code_prices x WHERE x.id=(item->>'id')::uuid FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Price record no longer exists'; END IF; SELECT customer_account_id INTO owner_id FROM public.customer_price_codes WHERE id=existing.price_code_id; IF owner_id IS NULL THEN RAISE EXCEPTION 'Only individual customer code prices may be edited here'; END IF; IF existing.price_mode IS DISTINCT FROM (item->>'expected_mode') OR existing.price IS DISTINCT FROM (item->>'expected_price')::numeric THEN RAISE EXCEPTION 'Price changed since preview. Refresh and retry.' USING errcode='40001'; END IF; action:=item->>'action'; IF action='remove' THEN DELETE FROM public.product_price_code_prices WHERE id=existing.id; ELSIF action='update' THEN new_mode:=item->>'mode'; IF new_mode NOT IN ('inc vat','ex vat') THEN RAISE EXCEPTION 'Choose EX VAT or INC VAT'; END IF; new_price:=round((item->>'price')::numeric,2); IF new_price<=0 OR new_price>=100000000 THEN RAISE EXCEPTION 'Enter a valid positive price'; END IF; UPDATE public.product_price_code_prices SET price=new_price,price_mode=new_mode,updated_at=now() WHERE id=existing.id; ELSE RAISE EXCEPTION 'Unsupported price action'; END IF; INSERT INTO public.customer_individual_price_audit(changed_by,customer_id,code_id,action,before_state,after_state) VALUES(actor.username,owner_id,existing.price_code_id,'MANAGE_PRODUCT_PRICE',jsonb_build_object('id',existing.id,'product_id',existing.product_id,'price',existing.price,'price_mode',existing.price_mode,'active',existing.active),jsonb_build_object('id',existing.id,'action',action,'price',case when action='remove' then null else new_price end,'price_mode',case when action='remove' then null else new_mode end)); changed:=changed+1; END LOOP; DELETE FROM public.fc_individual_price_context WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid(); RETURN jsonb_build_object('updated',changed); 

END; $function$;


-- Customer Price Code management permissions

REVOKE ALL ON FUNCTION
public.fc_manage_applied_code_prices_v1(text,text,jsonb)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
public.fc_manage_applied_code_prices_v1(text,text,jsonb)
TO anon, authenticated;
