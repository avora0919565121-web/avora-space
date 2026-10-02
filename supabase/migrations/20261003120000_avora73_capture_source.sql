-- AVORA-73 · C: where a photo / video came from. `camera` = AVORA's own Chụp ảnh / Quay button;
-- `library` = picked from the library or dropped in. Old files stay null: nothing is guessed.
alter table public.message_attachments
  add column if not exists capture_source text check (capture_source is null or capture_source in ('camera', 'library'));

-- Only the sender's send call writes it (inside send_message_with_attachments); nobody updates it later.
do $$ declare v_src text; begin
  select prosrc into v_src from pg_proc where oid = 'public.send_message_with_attachments(uuid, text, uuid, uuid[], uuid, jsonb)'::regprocedure;
  if v_src not like '%capture_source%' then
    v_src := replace(v_src,
      'file_name, mime_type, byte_size, width, height, duration_seconds, permission
  )',
      'file_name, mime_type, byte_size, width, height, duration_seconds, permission, capture_source
  )');
    v_src := replace(v_src,
      'coalesce(nullif(item ->> ''permission'', ''''), ''export'')
  from jsonb_array_elements(p_attachments) as item;',
      'coalesce(nullif(item ->> ''permission'', ''''), ''export''),
    case when item ->> ''kind'' = ''image'' or coalesce(item ->> ''mime_type'', '''') like ''video/%''
         then nullif(item ->> ''capture_source'', '''') end
  from jsonb_array_elements(p_attachments) as item;');
    if v_src not like '%capture_source%' then raise exception 'avora73_patch_failed'; end if;
    execute replace(pg_get_functiondef('public.send_message_with_attachments(uuid, text, uuid, uuid[], uuid, jsonb)'::regprocedure),
      (select prosrc from pg_proc where oid = 'public.send_message_with_attachments(uuid, text, uuid, uuid[], uuid, jsonb)'::regprocedure), v_src);
  end if;
end $$;

-- Nobody rewrites the mark after sending (the column stays out of any update grant).
revoke update (capture_source) on public.message_attachments from authenticated;
