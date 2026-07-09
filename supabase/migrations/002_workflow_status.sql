-- Optional workflow status helper for future automation.
alter table public.audits
  add column if not exists workflow_status text default 'draft';