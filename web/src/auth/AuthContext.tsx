import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

// Resolving the athlete is a distinct state from "session loading" because
// a valid session can still fail to resolve an athlete (no athlete row, or
// more than one — the latter should be structurally impossible given
// athletes.user_id UNIQUE, but is treated as a config error rather than an
// arbitrary pick, matching the same discipline already applied server-side
// in supabase/functions/daily-run/index.ts).
export type AthleteResolution =
  | { status: "loading" }
  | { status: "resolved"; athleteId: string }
  | { status: "no_athlete" }
  | { status: "config_error"; message: string };

interface AuthState {
  session: Session | null;
  user: User | null;
  athleteId: string | null;
  athleteResolution: AthleteResolution;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [athleteResolution, setAthleteResolution] = useState<AthleteResolution>({ status: "loading" });

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) {
      setAthleteResolution({ status: "loading" });
      return;
    }

    let active = true;
    setAthleteResolution({ status: "loading" });

    // RLS (athletes_own_data) already scopes this to the caller's own row —
    // no .eq("user_id", ...) filter is added or needed here.
    supabase
      .from("athletes")
      .select("id")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setAthleteResolution({ status: "config_error", message: error.message });
          return;
        }
        if (!data || data.length === 0) {
          setAthleteResolution({ status: "no_athlete" });
          return;
        }
        if (data.length > 1) {
          setAthleteResolution({ status: "config_error", message: "Multiple athletes resolved for this user." });
          return;
        }
        setAthleteResolution({ status: "resolved", athleteId: data[0].id });
      });

    return () => {
      active = false;
    };
  }, [session?.user?.id]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const athleteId = athleteResolution.status === "resolved" ? athleteResolution.athleteId : null;

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        athleteId,
        athleteResolution,
        loading,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
