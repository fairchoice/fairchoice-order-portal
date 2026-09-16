DO $$
DECLARE
  v_def text;
  v_old text := $old$
elsif v_action = 'Cannot Supply' and not (v_old_status='In Stock' and v_new_status='Cannot Supply') then
    raise exception 'Cannot Supply must change In Stock to Cannot Supply' using errcode='22023';
$old$;
  v_new text := $new$
elsif v_action = 'Cannot Supply' and not (v_old_status in ('In Stock','Next Supplier') and v_new_status='Cannot Supply') then
    raise exception 'Cannot Supply must change In Stock or Next Supplier to Cannot Supply' using errcode='22023';
$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.fc_record_warehouse_operational_event_v1(text,text,jsonb)'::regprocedure
  ) INTO v_def;

  IF position($check$v_old_status in ('In Stock','Next Supplier')$check$ in v_def) > 0 THEN
    RETURN;
  END IF;

  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION 'Expected Cannot Supply transition block was not found';
  END IF;

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END $$;
