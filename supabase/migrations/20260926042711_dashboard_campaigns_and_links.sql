-- Campaigns created from the dashboard, and the link slugs of their channels.
--
-- Public read: a campaign's rules are printed on every disclosure page anyway,
-- and the slugs are what /r/<slug> serves. Written only by the site's server
-- (secret key), and only after it has checked a confirmed transaction signed
-- by the advertiser that carries the row's content in a memo: the rules' hash
-- for a campaign, the slug itself for a link. Nothing here is ever updated;
-- a campaign's rules are final once its influencers start sending people.

create table public.campaigns (
  campaign text primary key,
  cluster text not null,
  advertiser text not null,
  name text not null,
  description text,
  destination text not null,
  rules jsonb not null,
  rules_hash text not null,
  rules_tx text not null,
  created_at timestamptz not null default now()
);
create index campaigns_cluster_idx on public.campaigns (cluster, created_at desc);
alter table public.campaigns enable row level security;
create policy "campaigns are public" on public.campaigns for select to anon, authenticated using (true);

create table public.links (
  slug text primary key,
  campaign text not null references public.campaigns (campaign),
  channel integer not null check (channel >= 0),
  link_tx text not null,
  created_at timestamptz not null default now(),
  unique (campaign, channel)
);
alter table public.links enable row level security;
create policy "links are public" on public.links for select to anon, authenticated using (true);
