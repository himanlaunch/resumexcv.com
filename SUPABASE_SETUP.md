# Supabase setup

Use Supabase for both Postgres and Auth.

## Database

Use a Supabase Postgres connection string as `DATABASE_URL`.

For Vercel Functions, prefer the pooled connection string from Supabase:

```text
postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
```

Then apply the Drizzle schema:

```bash
DATABASE_URL="<supabase-pooled-connection-string>" pnpm --filter @workspace/db run push
```

Equivalent SQL:

```sql
create table if not exists shared_resumes (
  id text primary key,
  user_id text,
  resume jsonb not null,
  job_title text not null,
  job_company text not null,
  created_at timestamp not null default now(),
  expires_at timestamp not null
);

alter table shared_resumes add column if not exists user_id text;
create index if not exists shared_resumes_user_id_idx on shared_resumes (user_id);
```

## Auth

Enable Email auth in Supabase Auth. Add the deployed app URL to Supabase Auth redirect URLs:

```text
https://resumex100.com/app
```

Add these environment variables in Vercel:

```text
SUPABASE_URL=<your Supabase project URL>
SUPABASE_ANON_KEY=<your Supabase anon public key>
VITE_SUPABASE_URL=<your Supabase project URL>
VITE_SUPABASE_ANON_KEY=<your Supabase anon public key>
```

The browser uses the `VITE_` variables for sign-in. The API uses `SUPABASE_URL` and `SUPABASE_ANON_KEY` to verify bearer tokens from signed-in users.

For OTP-code login/signup, make sure the Supabase email template includes the token. In Supabase, go to Authentication -> Email Templates and include:

```text
{{ .Token }}
```

The app verifies that code with Supabase. New emails are allowed to create accounts automatically.
