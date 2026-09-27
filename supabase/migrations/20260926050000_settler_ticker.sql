-- Every ten minutes, ask GitHub to run the settle workflow. GitHub's own
-- schedule fires hours late on a quiet repository; a workflow_dispatch from
-- here runs on time. The token is a fine-grained personal access token with
-- Actions read and write on the repository, stored in the vault as
-- github_settle_token (never in this file). Applied by hand after the token
-- is in place:
--
--   select vault.create_secret('<token>', 'github_settle_token');
--
-- and then this file.
select cron.schedule(
  'earnout-settle',
  '*/10 * * * *',
  $job$
  select net.http_post(
    url := 'https://api.github.com/repos/Cryptonomist/earnout/actions/workflows/settle.yml/dispatches',
    body := '{"ref":"main"}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_settle_token'),
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'earnout-settler-ticker',
      'Content-Type', 'application/json'
    )
  );
  $job$
);
