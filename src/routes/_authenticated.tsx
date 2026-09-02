import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { isSupabaseConfigured } from "@/integrations/supabase/config";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    if (!isSupabaseConfigured) {
      throw redirect({
        to: "/auth",
        search: {
          redirect: location.href,
          reason: "config",
        },
      });
    }

    const redirectToAuth = (reason?: "network" | "session"): never => {
      throw redirect({
        to: "/auth",
        search: {
          redirect: location.href,
          ...(reason ? { reason } : {}),
        },
      });
    };

    let sessionUserEmail: string | undefined;

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

      const session = sessionData.session;

      if (sessionError) {
        redirectToAuth("session");
      }

      if (!session) {
        redirectToAuth("session");
      }

      const { data: userData, error: userError } = await supabase.auth.getUser();
      const user = userData.user;

      if (userError) {
        await supabase.auth.signOut({ scope: "local" });
        redirectToAuth("session");
      }

      if (!user) {
        await supabase.auth.signOut({ scope: "local" });
        redirectToAuth("session");
      }

      sessionUserEmail = user!.email ?? session!.user.email;
    } catch (error) {
      if (error instanceof Response) throw error;
      redirectToAuth("network");
    }

    return {
      userEmail: sessionUserEmail,
    };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { userEmail } = Route.useRouteContext();

  return (
    <AppShell userEmail={userEmail}>
      <Outlet />
    </AppShell>
  );
}
