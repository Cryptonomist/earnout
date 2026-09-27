-- The settler's private state, one document per campaign. It maps wallets
-- to channels, which is exactly what Earnout keeps off chain, so nothing but
-- the secret key (the service role) may touch it: RLS on, no policies.
create table public.ledgers (
  campaign   text primary key,
  cluster    text not null,
  doc        jsonb not null,
  version    integer not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.ledgers enable row level security;

-- What the dashboard shows: counts per channel and settlement links, never a
-- wallet. Public to read, written only by the settler.
create table public.reports (
  campaign   text primary key,
  cluster    text not null,
  name       text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.reports enable row level security;
create policy "reports are public" on public.reports for select to anon, authenticated using (true);

-- Save a ledger only if nobody else saved it since it was read. Returns the
-- new version; raises if the expected one is stale. p_version 0 means "I
-- read nothing", which only inserts. This is what makes two settler runs
-- safe to overlap: the loser's pass fails instead of overwriting.
create or replace function public.save_ledger(p_campaign text, p_cluster text, p_doc jsonb, p_version integer)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v integer;
begin
  if p_version = 0 then
    insert into public.ledgers (campaign, cluster, doc) values (p_campaign, p_cluster, p_doc)
    on conflict (campaign) do nothing
    returning version into v;
  else
    update public.ledgers
       set doc = p_doc, version = version + 1, updated_at = now()
     where campaign = p_campaign and version = p_version
    returning version into v;
  end if;
  if v is null then
    raise exception 'ledger for % changed since it was read', p_campaign using errcode = '40001';
  end if;
  return v;
end;
$$;

revoke all on function public.save_ledger(text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.save_ledger(text, text, jsonb, integer) to service_role;
revoke all on table public.ledgers from anon, authenticated;
revoke insert, update, delete on table public.reports from anon, authenticated;
