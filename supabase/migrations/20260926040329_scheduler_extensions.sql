-- The settler ticker: Supabase's scheduler (pg_cron) and HTTP client
-- (pg_net). The job itself is in 20260926050000_settler_ticker.sql, once
-- the GitHub token is in the vault.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
