import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { KeyRound, Loader2, Mail } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { useAuth } from "@/lib/auth";
import { createCheckout } from "@/lib/api";

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const maybeMessage = "message" in error ? (error as { message?: unknown }).message : undefined;
    const maybeError = "error" in error ? (error as { error?: unknown }).error : undefined;
    if (typeof maybeMessage === "string" && maybeMessage.trim()) return maybeMessage;
    if (typeof maybeError === "string" && maybeError.trim()) return maybeError;
  }
  return fallback;
}

export default function AuthPage() {
  const { configured, loading, user, signInWithGoogle, sendEmailOtp, verifyEmailOtp } = useAuth();
  const [, navigate] = useLocation();
  const checkoutPriceId = new URLSearchParams(window.location.search).get("checkoutPriceId");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<"idle" | "google" | "sending" | "sent" | "verifying" | "checkout" | "error">("idle");
  const [message, setMessage] = useState("");
  const checkoutStarted = useRef(false);
  const isPositiveMessage = status === "sent" || status === "checkout";

  useEffect(() => {
    if (loading || !user || checkoutStarted.current) return;
    checkoutStarted.current = true;

    if (!checkoutPriceId) {
      navigate("/app");
      return;
    }

    setStatus("checkout");
    setMessage("Opening Stripe checkout...");
    createCheckout(checkoutPriceId)
      .then(({ url }) => {
        window.location.href = url;
      })
      .catch((err) => {
        checkoutStarted.current = false;
        setStatus("error");
        setMessage(getErrorMessage(err, "Could not start Stripe checkout."));
      });
  }, [checkoutPriceId, loading, navigate, user]);

  const startGoogleSignIn = async () => {
    setStatus("google");
    setMessage("");
    try {
      await signInWithGoogle(checkoutPriceId ? `/signin?checkoutPriceId=${encodeURIComponent(checkoutPriceId)}` : "/app");
    } catch (err) {
      setStatus("error");
      setMessage(getErrorMessage(err, "Could not start Google sign-in."));
    }
  };

  const sendOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return;
    setStatus("sending");
    setMessage("");
    try {
      await sendEmailOtp(email.trim());
      setStatus("sent");
      setMessage("We sent a one-time code to your email. Enter it below to continue.");
    } catch (err) {
      setStatus("error");
      setMessage(getErrorMessage(err, "Could not send the OTP code."));
    }
  };

  const verifyOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanToken = token.replace(/\D/g, "");
    if (!email.trim() || cleanToken.length < 6) return;
    setStatus("verifying");
    setMessage("");
    try {
      await verifyEmailOtp(email.trim(), cleanToken);
      setMessage("Signed in successfully.");
      if (!checkoutPriceId) navigate("/app");
    } catch (err) {
      setStatus("error");
      setMessage(getErrorMessage(err, "Invalid or expired OTP code."));
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: "#F2F4F5" }}>
      <div className="w-full max-w-md card-base p-6 md:p-8 rounded-2xl">
        <div className="mb-5 flex items-center">
          <BrandLogo imageClassName="h-10" />
        </div>
        {!configured ? (
          <div className="rounded-xl p-4 text-sm" style={{ backgroundColor: "#FEF3C7", color: "#92400E", border: "1px solid #FDE68A" }}>
            Supabase auth is not configured yet. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel to enable sign-in.
          </div>
        ) : (
          <div className="space-y-4">
            <button
              type="button"
              onClick={startGoogleSignIn}
              disabled={status === "google" || status === "sending" || status === "verifying" || status === "checkout"}
              className="w-full rounded-xl border bg-white px-4 py-3 text-sm font-semibold transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
              style={{ borderColor: "#D8E0EA", color: "#1F2937" }}
            >
              <span className="flex items-center justify-center gap-3">
                {status === "google" ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M21.6 12.23c0-.78-.07-1.53-.2-2.23H12v4.22h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.52Z" />
                    <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.43l-3.24-2.51c-.9.6-2.04.95-3.38.95-2.6 0-4.8-1.76-5.59-4.12H3.06v2.59A10 10 0 0 0 12 22Z" />
                    <path fill="#FBBC05" d="M6.41 13.89A6.02 6.02 0 0 1 6.1 12c0-.65.11-1.29.31-1.89V7.52H3.06A10 10 0 0 0 2 12c0 1.61.39 3.14 1.06 4.48l3.35-2.59Z" />
                    <path fill="#EA4335" d="M12 5.99c1.47 0 2.79.5 3.82 1.5l2.87-2.87C16.96 3.01 14.69 2 12 2a10 10 0 0 0-8.94 5.52l3.35 2.59C7.2 7.75 9.4 5.99 12 5.99Z" />
                  </svg>
                )}
                {status === "google" ? "Connecting to Google…" : status === "checkout" ? "Opening Stripe…" : "Continue with Google"}
              </span>
            </button>

            <div className="flex items-center gap-4">
              <div className="h-px flex-1" style={{ backgroundColor: "#D8E0EA" }} />
              <span className="text-xs font-semibold uppercase" style={{ color: "#94A3B8" }}>or</span>
              <div className="h-px flex-1" style={{ backgroundColor: "#D8E0EA" }} />
            </div>

            <form onSubmit={sendOtp} className="space-y-4">
            <label className="block">
              <span className="text-xs font-semibold mb-2 block" style={{ color: "#555" }}>Email address</span>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#888" }} />
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  disabled={status === "sending" || status === "verifying"}
                  required
                  placeholder="you@example.com"
                  className="w-full rounded-xl pl-10 pr-3 py-3 text-sm outline-none"
                  style={{ border: "1.5px solid #D0D5DD", backgroundColor: "white", color: "#0A0A0A" }}
                />
              </div>
            </label>

                <button className="btn-mint w-full" disabled={status === "sending" || status === "verifying" || status === "checkout"}>
              {status === "sending" ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending OTP…</> : status === "sent" ? "Resend OTP" : "Send OTP"}
            </button>
            </form>

            {(status === "sent" || status === "verifying" || (status === "error" && token.length > 0)) && (
              <form onSubmit={verifyOtp} className="space-y-4">
                <label className="block">
                  <span className="text-xs font-semibold mb-2 block" style={{ color: "#555" }}>One-time code</span>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#888" }} />
                    <input
                      value={token}
                      onChange={(event) => setToken(event.target.value.replace(/\D/g, "").slice(0, 6))}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      required
                      placeholder="123456"
                      className="w-full rounded-xl pl-10 pr-3 py-3 text-lg tracking-[0.35em] font-semibold outline-none"
                      style={{ border: "1.5px solid #D0D5DD", backgroundColor: "white", color: "#0A0A0A" }}
                    />
                  </div>
                </label>

                <button className="btn-dark w-full" disabled={status === "verifying" || token.replace(/\D/g, "").length < 6}>
                  {status === "verifying" ? <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</> : "Verify code"}
                </button>
              </form>
            )}

            {message && (
              <div className="rounded-xl p-3 text-sm" style={{
                backgroundColor: isPositiveMessage ? "#ECFFE0" : "#FEE2E2",
                color: isPositiveMessage ? "#005A3D" : "#991B1B",
                border: isPositiveMessage ? "1px solid rgba(0,240,160,0.35)" : "1px solid #FCA5A5",
              }}>
                {message}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
