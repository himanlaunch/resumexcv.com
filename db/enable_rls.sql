-- ─────────────────────────────────────────────────────────────────────────────
-- Enable Row Level Security on all public tables
--
-- All database writes/reads in this app go through the Express API server via a
-- direct Postgres connection pool. That connection uses a privileged role that
-- bypasses RLS by default.
--
-- PostgREST (the Supabase REST API used by the browser) should NEVER have
-- direct access to these tables. Enabling RLS with no permissive policies
-- blocks all PostgREST/anon/authenticated access while leaving the API server
-- unaffected.
--
-- Run this once in the Supabase SQL editor:
-- https://supabase.com/dashboard/project/<your-project>/sql
-- ─────────────────────────────────────────────────────────────────────────────

-- User data tables
ALTER TABLE public.user_resume_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_generated_resumes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_resume_versions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_campaigns            ENABLE ROW LEVEL SECURITY;

-- Billing / credits tables
ALTER TABLE public.user_credits              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_checkout_sessions  ENABLE ROW LEVEL SECURITY;

-- Shared server-side cache tables
ALTER TABLE public.cached_job_searches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cached_tailoring_results  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cached_resume_parses      ENABLE ROW LEVEL SECURITY;

-- No RLS policies are created intentionally:
-- • RLS on with zero policies = deny all PostgREST access (safe default)
-- • The API server's Postgres role bypasses RLS — no policies needed there
-- ─────────────────────────────────────────────────────────────────────────────
