import { Switch, Route, Router as WouterRouter, Link, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import Landing from "@/pages/Landing";
import AppWorkspace from "@/pages/AppWorkspace";
import Campaigns from "@/pages/Campaigns";
import SharedResume from "@/pages/SharedResume";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/AuthPage";
import Blog from "@/pages/Blog";
import { AuthProvider, useAuth } from "@/lib/auth";

const queryClient = new QueryClient();

function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, user } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#F2F4F5", color: "#555" }}>
        <div className="text-sm font-semibold">Loading secure workspace…</div>
      </div>
    );
  }

  if (!user) return <AuthPage />;

  return <>{children}</>;
}

function HomeRoute() {
  const { loading, user } = useAuth();
  const [, navigate] = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#F2F4F5", color: "#555" }}>
        <div className="text-sm font-semibold">Loading…</div>
      </div>
    );
  }

  if (user) {
    navigate("/app", { replace: true });
    return null;
  }

  return <Landing />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Switch>
            <Route path="/" component={HomeRoute} />
            <Route path="/signin" component={AuthPage} />
            <Route path="/blog" component={Blog} />
            <Route path="/app">
              <RequireAuth><AppWorkspace /></RequireAuth>
            </Route>
            <Route path="/campaigns">
              <RequireAuth><Campaigns /></RequireAuth>
            </Route>
            <Route path="/r/:id" component={SharedResume} />
            <Route component={NotFound} />
          </Switch>
        </WouterRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
