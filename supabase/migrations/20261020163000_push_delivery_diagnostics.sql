
create table public.push_delivery_attempts (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 appointment_id uuid,
 subscription_id uuid,
 user_id uuid,
 endpoint_hash text,
 provider text,
 template text not null,
 tag text,
 receipt_token_hash text,
 attempted_at timestamptz not null default now(),
 finished_at timestamptz,
 send_status text not null default 'attempting' check(send_status in ('attempting','accepted','failed','expired','skipped','unavailable')),
 http_status integer,
 error_code text,
 duration_ms integer,
 unique(tenant_id,id),
 check(receipt_token_hash is null or receipt_token_hash ~ '^[0-9a-f]{64}$')
);
create index on public.push_delivery_attempts(tenant_id,attempted_at desc);
create index on public.push_delivery_attempts(subscription_id,attempted_at desc);

create table public.push_delivery_events (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 attempt_id uuid not null,
 event_id uuid not null,
 kind text not null check(kind in ('received','show_resolved','show_failed','clicked','closed','click_opened','click_failed','payload_invalid')),
 client_at timestamptz not null,
 recorded_at timestamptz not null default now(),
 details jsonb not null default '{}'::jsonb check(octet_length(details::text)<=4096),
 foreign key(tenant_id,attempt_id) references public.push_delivery_attempts(tenant_id,id) on delete cascade,
 unique(attempt_id,event_id)
);
create index on public.push_delivery_events(tenant_id,attempt_id,kind);

create table public.push_client_events (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 user_id uuid not null,
 kind text not null,
 endpoint_hash text,
 recorded_at timestamptz not null default now(),
 details jsonb not null default '{}'::jsonb check(octet_length(details::text)<=4096)
);
create index on public.push_client_events(tenant_id,recorded_at desc);

alter table public.push_delivery_attempts enable row level security;
alter table public.push_delivery_events enable row level security;
alter table public.push_client_events enable row level security;
create policy push_attempts_read on public.push_delivery_attempts for select to authenticated using(public.is_tenant_member(tenant_id));
create policy push_events_read on public.push_delivery_events for select to authenticated using(public.is_tenant_member(tenant_id));
create policy push_client_events_read on public.push_client_events for select to authenticated using(public.is_tenant_member(tenant_id));
revoke all on public.push_delivery_attempts,public.push_delivery_events,public.push_client_events from public,anon,authenticated;
grant select on public.push_delivery_attempts,public.push_delivery_events,public.push_client_events to authenticated;
grant all on public.push_delivery_attempts,public.push_delivery_events,public.push_client_events to service_role;

-- A per-message capability authenticates receipts even with the app closed or signed out.
-- It only appends bounded diagnostics; it cannot read or modify salon data.
create function public.record_push_receipt(
 p_attempt_id uuid,p_token_hash text,p_event_id uuid,p_kind text,p_client_at timestamptz,p_details jsonb
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_attempt public.push_delivery_attempts;
begin
 select * into v_attempt from public.push_delivery_attempts
 where id=p_attempt_id and receipt_token_hash=p_token_hash
 for update;
 if not found then return false; end if;
 if p_kind not in ('received','show_resolved','show_failed','clicked','closed','click_opened','click_failed','payload_invalid')
    or p_client_at is null or p_details is null or jsonb_typeof(p_details)<>'object'
    or octet_length(p_details::text)>4096 then return false; end if;
 if exists(select 1 from public.push_delivery_events where attempt_id=p_attempt_id and event_id=p_event_id) then return true; end if;
 if (select count(*) from public.push_delivery_events where attempt_id=p_attempt_id)>=64 then return false; end if;
 insert into public.push_delivery_events(tenant_id,attempt_id,event_id,kind,client_at,details)
 values(v_attempt.tenant_id,p_attempt_id,p_event_id,p_kind,p_client_at,p_details);
 return true;
end;
$$;
revoke execute on function public.record_push_receipt(uuid,text,uuid,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.record_push_receipt(uuid,text,uuid,text,timestamptz,jsonb) to service_role;

create function public.record_push_client_event(
 p_tenant_id uuid,p_user_id uuid,p_kind text,p_endpoint_hash text,p_details jsonb
) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.memberships where tenant_id=p_tenant_id and user_id=p_user_id) then return false; end if;
 if p_kind not in ('enable_clicked','disable_clicked','test_clicked','permission_result','subscription_error','subscription_saved','subscription_removed','test_result','browser_state','worker_registered','check_result')
 or p_details is null or jsonb_typeof(p_details)<>'object' or octet_length(p_details::text)>4096 then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||p_user_id::text,4));
 if (select count(*) from public.push_client_events where tenant_id=p_tenant_id and user_id=p_user_id and recorded_at>now()-interval '1 hour')>=300 then return false; end if;
 insert into public.push_client_events(tenant_id,user_id,kind,endpoint_hash,details)
 values(p_tenant_id,p_user_id,p_kind,p_endpoint_hash,p_details);
 return true;
end;
$$;
revoke execute on function public.record_push_client_event(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_push_client_event(uuid,uuid,text,text,jsonb) to service_role;

create view public.push_delivery_diagnostics with(security_invoker=true) as
select a.*,
 min(e.recorded_at) filter(where e.kind='received') as received_reported_at,
 min(e.client_at) filter(where e.kind='received') as device_received_at,
 min(e.recorded_at) filter(where e.kind='show_resolved') as show_resolved_reported_at,
 min(e.recorded_at) filter(where e.kind='show_failed') as show_failed_reported_at,
 min(e.recorded_at) filter(where e.kind='clicked') as clicked_reported_at,
 count(e.id) filter(where e.kind='clicked') as click_count,
 min(e.recorded_at) filter(where e.kind='closed') as closed_reported_at,
 case when count(e.id) filter(where e.kind='clicked')>0 then 'click_confirmed'
 when count(e.id) filter(where e.kind='show_failed')>0 then 'show_failed'
 when count(e.id) filter(where e.kind='show_resolved')>0 then 'show_call_resolved'
 when count(e.id) filter(where e.kind='received')>0 then 'worker_received'
 else 'receipt_unconfirmed' end as device_status
from public.push_delivery_attempts a left join public.push_delivery_events e on e.attempt_id=a.id and e.tenant_id=a.tenant_id
group by a.id;
revoke all on public.push_delivery_diagnostics from public,anon,authenticated;
grant select on public.push_delivery_diagnostics to authenticated,service_role;
