import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { setApiAccessToken } from "@/lib/api";

interface AuthContextValue {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  signInWithGoogle: (redirectPath?: string) => Promise<void>;
  sendEmailOtp: (email: string) => Promise<void>;
  verifyEmailOtp: (email: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function describeAuthError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const maybeMessage = "message" in error ? (error as { message?: unknown }).message : undefined;
    const maybeError = "error" in error ? (error as { error?: unknown }).error : undefined;
    if (typeof maybeMessage === "string" && maybeMessage.trim()) return maybeMessage;
    if (typeof maybeError === "string" && maybeError.trim()) return maybeError;
  }
  return fallback;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!supabase) {
      setApiAccessToken(null);
      setLoading(false);
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
      setApiAccessToken(data.session?.access_token ?? null);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setApiAccessToken(nextSession?.access_token ?? null);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    configured: isSupabaseConfigured,
    loading,
    session,
    user: session?.user ?? null,
    async signInWithGoogle(redirectPath = "/app") {
      if (!supabase) throw new Error("Supabase is not configured.");
      const safeRedirectPath = redirectPath.startsWith("/") ? redirectPath : "/app";
      const redirectTo = `${window.location.origin}${safeRedirectPath}`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          queryParams: {
            access_type: "offline",
            prompt: "select_account",
          },
        },
      });
      if (error) throw new Error(describeAuthError(error, "Supabase could not start Google sign-in."));
    },
    async sendEmailOtp(email: string) {
      if (!supabase) throw new Error("Supabase is not configured.");
      const { error } = await withTimeout(
        supabase.auth.signInWithOtp({
          email,
          options: {
            shouldCreateUser: true,
          },
        }),
        20000,
        "Supabase did not respond while sending the OTP. Check Supabase Auth email/SMTP settings and try again."
      );
      if (error) throw new Error(describeAuthError(error, "Supabase could not send the OTP code."));
    },
    async verifyEmailOtp(email: string, token: string) {
      if (!supabase) throw new Error("Supabase is not configured.");
      let lastError: unknown = null;
      for (const type of ["email", "signup", "magiclink"] as const) {
        const { data, error } = await supabase.auth.verifyOtp({ email, token, type });
        if (!error) {
          setSession(data.session ?? null);
          setApiAccessToken(data.session?.access_token ?? null);
          return;
        }
        lastError = error;
      }
      throw lastError instanceof Error ? lastError : new Error("Invalid or expired OTP code.");
    },
    async signOut() {
      if (!supabase) return;
      await supabase.auth.signOut();
      setSession(null);
      setApiAccessToken(null);
    },
  }), [loading, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
