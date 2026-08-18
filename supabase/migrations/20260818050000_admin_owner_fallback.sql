-- `create_tenant` upisuje vlasnika platforme kao `owner` člana svakog salona,
-- da nijedan salon ne ostane bez kontrole. Zato je `admin_salons` tražila
-- člana koji NIJE vlasnik platforme — inače bi svaki salon prikazivao njegovu
-- adresu umesto vlasničine.
--
-- Ali kad je vlasnica salona ujedno i vlasnik platforme, `create_tenant`
-- upiše samo jedno članstvo (drugi `insert` ima `po.user_id <> v_owner_id`),
-- pa taj filter izbaci jedinog člana i konzola prikaže „bez vlasnice" za
-- salon koji vlasnicu uredno ima.
--
-- Umesto izbacivanja, sad je redosled: pravi vlasnik prvo, vlasnik platforme
-- tek ako drugog nema. `false` se u Postgresu sortira pre `true`.

create or replace function admin_salons()
 RETURNS TABLE(id uuid, slug text, name text, suspended boolean, owner_email text, logo_url text, created_at timestamp with time zone, services_count integer, upcoming_count integer, last_booking_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    t.id,
    t.slug,
    t.name,
    t.suspended_at is not null,
    (
      select u.email::text
      from memberships m
      join auth.users u on u.id = m.user_id
      where m.tenant_id = t.id
        and m.role = 'owner'
      order by
        exists (select 1 from platform_owners po where po.user_id = m.user_id),
        m.created_at
      limit 1
    ),
    t.logo_url,
    t.created_at,
    (select count(*)::int from services s
      where s.tenant_id = t.id and s.active),
    (select count(*)::int from appointments a
      where a.tenant_id = t.id
        and a.status in ('pending', 'confirmed')
        and a.start_at >= now()),
    (select max(a.created_at) from appointments a where a.tenant_id = t.id)
  from tenants t
  where is_platform_owner()
  order by t.created_at
$function$;

revoke execute on function admin_salons() from public, anon;
grant execute on function admin_salons() to authenticated;
