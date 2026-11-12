select jsonb_object_agg(k, h) from (
 select 'col:'||table_schema||'.'||table_name||'.'||column_name k, md5(data_type||coalesce(column_default,'')||is_nullable) h from information_schema.columns where table_schema in ('public','private')
 union all
 select 'fn:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', md5(p.prosrc||coalesce(array_to_string(p.proconfig,','),'')||p.prosecdef::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname not like 'aicos%'
 union all
 select 'pol:'||schemaname||'.'||tablename||'.'||policyname, md5(cmd||coalesce(qual,'')||coalesce(with_check,'')||array_to_string(roles,',')) from pg_policies where schemaname in ('public','private','storage')
 union all
 select 'idx:'||schemaname||'.'||indexname, md5(indexdef) from pg_indexes where schemaname in ('public','private')
 union all
 select 'con:'||conrelid::regclass::text||'.'||conname, md5(pg_get_constraintdef(oid)) from pg_constraint where connamespace in ('public'::regnamespace,'private'::regnamespace)
 union all
 select 'trg:'||tgrelid::regclass::text||'.'||tgname, md5(pg_get_triggerdef(oid)) from pg_trigger where not tgisinternal and tgrelid::regclass::text not like 'storage.%' and tgrelid::regclass::text not like 'auth.%'
 union all
 select 'grant:'||table_schema||'.'||table_name||':'||grantee||':'||privilege_type, '1' from information_schema.role_table_grants where table_schema in ('public','private') and grantee in ('anon','authenticated')
) x
