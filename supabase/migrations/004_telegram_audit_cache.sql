-- 004_telegram_audit_cache.sql
--
-- Stores completed audit analyses generated via the Telegram bot, as a
-- best-effort audit trail. The PDF is now generated and sent outright in
-- the same conversation turn (no button/callback flow), so this table is
-- no longer load-bearing for the user-facing flow — a failed insert here
-- does not block or degrade what the user sees. It exists so past bot
-- audits are queryable later (e.g. for a future /history command, or to
-- diff bot output against web-UI output for the same file).
--
-- Deliberately NOT the same table as public.audits: that table is scoped
-- to authenticated web-UI users via user_id + RLS. The Telegram bot
-- authenticates as a single shared service-bot Supabase user (see
-- getServiceAuthToken() in api/telegram-webhook.js), so per-user RLS
-- doesn't apply here — isolation instead comes from the bot's own
-- Telegram user allowlist (TELEGRAM_ALLOWED_USER_IDS).
--
-- Rows are not currently pruned automatically — see the cleanup note at
-- the bottom. Lower urgency now that this table isn't in the critical
-- path, but still worth wiring up before real volume.

create table if not exists public.telegram_audit_cache (
  id text primary key default encode(gen_random_bytes(9), 'base64url'),
  telegram_chat_id text not null,
  telegram_user_id text not null,
  file_name text,
  project_name text,
  analysis jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists telegram_audit_cache_created_idx
  on public.telegram_audit_cache (created_at);

alter table public.telegram_audit_cache enable row level security;
alter table public.telegram_audit_cache force row level security;

-- No anon/authenticated grants — this table is only ever touched by the
-- service-role key from within api/telegram-webhook.js (server-side,
-- never exposed to a browser client), so RLS policies for anon/authenticated
-- roles are intentionally omitted. force row level security above still
-- blocks any accidental client-side access even if a key were leaked.

-- Cleanup: rows older than 24h have no reason to still exist — a
-- contractor who wants a report should tap the button same-session. Run
-- this on a schedule (Supabase cron, or a simple periodic call) once the
-- bot has real usage. Not wired up automatically yet — flagging as a
-- known follow-up, not a blocker for shipping.
--
-- delete from public.telegram_audit_cache where created_at < now() - interval '24 hours';