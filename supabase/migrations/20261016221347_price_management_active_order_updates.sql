begin;
-- Apply the exact reviewed lines atomically, after validating the current FC login.
create or replace function public.fc_update_active_order_prices_v1(
  p_username text, p_session_token text, p_items jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  actor record; r jsonb; o public.orders%rowtype; i public.order_items%rowtype;
  v_price numeric; v_qty numeric; v_net numeric; v_vat numeric; v_gross numeric;
  v_product_price numeric; v_count integer:=0; v_order_id uuid; v_before jsonb;
begin
  select * into strict actor from public.fc_require_session_permission_v2(p_username,p_session_token,'page.product.price_management');
  if lower(trim(coalesce(actor.staff_role,''))) not in ('admin','administrator','super admin') then
    raise exception 'Admin approval is required for order price updates.' using errcode='42501';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'A reviewed order preview is required.'; end if;
  if jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>2000 then raise exception 'Review between 1 and 2000 order lines per update.'; end if;
  if (select count(distinct value->>'itemId') from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then raise exception 'Duplicate or missing order line IDs.'; end if;

  -- Consistent lock order prevents partial batches and stage changes during writes.
  for v_order_id in select distinct (value->>'orderId')::uuid from jsonb_array_elements(p_items) order by 1 loop
    perform 1 from public.orders where id=v_order_id for update;
    if not found then raise exception 'An order no longer exists. Preview again.'; end if;
  end loop;
  for r in select value from jsonb_array_elements(p_items) order by value->>'orderId',value->>'itemId' loop
    select * into strict o from public.orders where id=(r->>'orderId')::uuid;
    if o.status is null or o.status not in ('Received','Warehouse Packing') or o.status is distinct from r->>'orderStatus'
       or upper(coalesce(o.financial_status,'ACTIVE'))<>'ACTIVE' or o.financial_voided_at is not null then
      raise exception 'Order stage changed or order is no longer active. Preview again.';
    end if;
    if coalesce(o.price_mode,'') is distinct from coalesce(r->>'expectedPriceMode','') or
       coalesce(o.customer_country,'') is distinct from coalesce(r->>'expectedCountry','') then
      raise exception 'Order pricing mode changed. Preview again.';
    end if;
    select * into i from public.order_items where id=(r->>'itemId')::uuid and order_id=o.id and product_id=(r->>'productId')::uuid for update;
    if not found then raise exception 'An order line changed or no longer exists. Preview again.'; end if;
    if i.updated_at is distinct from (r->>'expectedUpdatedAt')::timestamptz or
       coalesce(i.price,i.unit_price,0) is distinct from (r->>'oldPrice')::numeric or
       coalesce(i.qty,i.picked_qty,0)::numeric is distinct from (r->>'qty')::numeric then
      raise exception 'An order line changed after review. Preview again.';
    end if;
    if lower(trim(coalesce(to_jsonb(i)->>'source_status',to_jsonb(i)->>'status',''))) in ('free','promotion free') then
      raise exception 'Free promotion lines cannot be repriced.';
    end if;
    select coalesce(vat_price,0) into v_product_price from public.products where id=i.product_id for share;
    if not found or v_product_price is distinct from (r->>'expectedVatPrice')::numeric then
      raise exception 'Product database price changed after review. Preview again.';
    end if;
    v_price:=(r->>'newPrice')::numeric;
    v_qty:=coalesce(i.qty,i.picked_qty,0);
    if v_price is null or v_price<0 or v_price::text in ('NaN','Infinity','-Infinity') or v_qty<0 or
       (r->>'vatRate') is null or (r->>'vatRate')::numeric not between 0 and 100 or
       (r->>'addVat') is null then raise exception 'Invalid reviewed price or VAT rate.'; end if;
    v_net:=round(v_price*v_qty,2);
    v_vat:=case when (r->>'addVat')::boolean then round(v_net*(r->>'vatRate')::numeric/100,2) else 0 end;
    v_gross:=v_net+v_vat;
    v_before:=to_jsonb(i);
    update public.order_items set price=v_price,unit_price=v_price,line_total=v_net,net_total=v_net,
      gross_total=v_gross,vat_amount=v_vat,vat_total=v_vat,vat_rate=(r->>'vatRate')::numeric,vat_type=r->>'vatRate',updated_at=now()
    where id=i.id;
    insert into public.financial_audit_log(action,entity_type,entity_id,reason,before_data,after_data,changed_by)
    values('PRICE_MANAGEMENT_UPDATE','ORDER_ITEM',i.id::text,'Apply reviewed product database price to active order',v_before,
      jsonb_build_object('price',v_price,'net_total',v_net,'vat_total',v_vat,'gross_total',v_gross,'order_id',o.id,'order_stage',o.status),actor.username);
    v_count:=v_count+1;
  end loop;
  -- Keep order header totals consistent with the saved line totals.
  for v_order_id in select distinct (value->>'orderId')::uuid from jsonb_array_elements(p_items) loop
    update public.orders target_order set net_total=t.net,subtotal=t.net,vat_total=t.vat,order_total=t.gross,updated_at=now()
    from (select coalesce(sum(net_total),0) net,coalesce(sum(vat_total),0) vat,coalesce(sum(gross_total),0) gross
      from public.order_items line where order_id=v_order_id
        and lower(trim(coalesce(to_jsonb(line)->>'source_status',to_jsonb(line)->>'status',''))) not in
          ('removed','cannot supply','need supplier','pre-order','pre order','pre-order supply','pre order supply','supply needed','next supplier')
        and (coalesce((to_jsonb(line)->>'include_in_picking')::boolean,true)
          or lower(trim(coalesce(to_jsonb(line)->>'source_status',to_jsonb(line)->>'status',''))) in ('in stock','available','supplied','free','promotion free'))
      ) t where target_order.id=v_order_id;
  end loop;
  return jsonb_build_object('ok',true,'updated_lines',v_count);
end; $$;
revoke all on function public.fc_update_active_order_prices_v1(text,text,jsonb) from public;
grant execute on function public.fc_update_active_order_prices_v1(text,text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
