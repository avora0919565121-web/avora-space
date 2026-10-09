-- KHỐI 0 (VMT 09/10) — one address for AVORA.
-- `private.app_origin(p_origin)` used to accept ANY *.rork.app / *.rork.live origin, so another Rork
-- app could make the link in a device email (a page that asks for the account password) point at
-- itself. Now: an exact list; anything else → the primary address.
-- The primary address lives in ONE place: private.app_origin_primary(). Client mirror: web/src/lib/app-origin.ts.

create or replace function private.app_origin_primary() returns text
language sql immutable set search_path = '' as $$
  select 'https://avorachat.com'
$$;

create or replace function private.app_origin(p_origin text) returns text
language sql immutable set search_path = '' as $$
  -- Device emails always lead to the primary address. The passed origin is only kept for the
  -- Rork preview build, so links made while testing a preview open that preview.
  select case
    when p_origin = 'https://9gn7yyx8sbtban1pcozwb-web.rork.live' then p_origin
    else private.app_origin_primary()
  end
$$;

/** The allowed list (for tests and the report); `app_origin` above sends all but the preview to the primary. */
create or replace function private.app_origin_allowed(p_origin text) returns boolean
language sql immutable set search_path = '' as $$
  select p_origin = any (array[
    'https://avorachat.com',
    'https://www.avorachat.com',
    'https://avoraspace.rork.app',
    'https://myavora.rork.app',
    'https://9gn7yyx8sbtban1pcozwb-web.rork.live'
  ])
$$;

revoke execute on function private.app_origin_primary() from public, anon, authenticated;
revoke execute on function private.app_origin(text) from public, anon, authenticated;
revoke execute on function private.app_origin_allowed(text) from public, anon, authenticated;
