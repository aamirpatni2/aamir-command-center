import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Permission, SessionResponse } from "@acc/shared";
import { api, ApiError, setCsrfToken, setUnauthorizedHandler } from "./api.js";

interface AuthState {
  status: "loading" | "authenticated" | "anonymous";
  session: SessionResponse | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (p: Permission) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [status, setStatus] = useState<AuthState["status"]>("loading");

  const apply = useCallback(
    (s: SessionResponse | null) => {
      setSession(s);
      setCsrfToken(s?.csrfToken ?? null);
      setStatus(s ? "authenticated" : "anonymous");
      if (!s) qc.clear();
    },
    [qc],
  );

  useEffect(() => {
    setUnauthorizedHandler(() => apply(null));
    api<SessionResponse>("/api/auth/me")
      .then(apply)
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401)) console.error(e);
        apply(null);
      });
    return () => setUnauthorizedHandler(null);
  }, [apply]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      session,
      login: async (email, password) => apply(await api<SessionResponse>("/api/auth/login", { method: "POST", body: { email, password } })),
      logout: async () => {
        try {
          await api("/api/auth/logout", { method: "POST" });
        } finally {
          apply(null);
        }
      },
      can: (p) => !!session?.permissions.includes(p),
    }),
    [status, session, apply],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
