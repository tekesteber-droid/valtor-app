-- Adds post-audit chatbot history as a JSONB array on the existing audits row.
-- Shape: [{ "role": "user" | "assistant", "content": "...", "ts": "ISO8601" }]
alter table public.audits
  add column if not exists chat_history jsonb not null default '[]'::jsonb;