# Supabase Setup

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local`.
3. Set `VITE_SUPABASE_URL` to your Project URL.
4. Set `VITE_SUPABASE_ANON_KEY` to your anon or publishable browser key.
5. In Supabase SQL Editor, run `supabase/migrations/001_initial_security.sql`.
6. In Authentication > URL Configuration, add your local site URL:
   `http://localhost:5173`
   (you can also add `http://127.0.0.1:5173` if you prefer).
7. Add redirect URLs:
   - `http://localhost:5173`
   - `http://localhost:5173/auth`
8. For production, add your real domain to Site URL and Redirect URLs.

The frontend key is allowed to be public. The database is protected by Row Level Security, so users can only read, insert, update, and delete their own audit rows.