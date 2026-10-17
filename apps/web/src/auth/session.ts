import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { MeResponse } from "@job/shared";
import { create } from "zustand";
import { api } from "../api/client";
import { keys, queryClient, useMe } from "../api/queries";
import i18n, { setLanguage, type Language } from "../i18n";
import { track } from "../lib/analytics";

// Accounts (FEATURE A1–A6). After a login, sign-up or logout the session changed: every
// user-dependent answer (saved stars, match %, resumes…) is fetched again.

function sessionChanged(me: MeResponse | null) {
  if (me) queryClient.setQueryData(keys.me, me);
  void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "locations" && (me === null || query.queryKey[0] !== "me") });
}

export function useLogin() {
  return useMutation({
    mutationFn: (input: { email: string; password: string }) => api<MeResponse>("POST", "/api/auth/login", { body: input }),
    onSuccess: sessionChanged,
  });
}

export function useSignup() {
  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      api<MeResponse>("POST", "/api/auth/signup", { body: { ...input, uiLanguage: i18n.language } }),
    onSuccess: (me) => {
      track("signup");
      sessionChanged(me);
    },
  });
}

export function useResetRequest() {
  return useMutation({ mutationFn: (email: string) => api<void>("POST", "/api/auth/password-reset/request", { body: { email } }) });
}

export function useResetConfirm() {
  return useMutation({
    mutationFn: (input: { token: string; password: string }) => api<MeResponse>("POST", "/api/auth/password-reset/confirm", { body: input }),
    onSuccess: sessionChanged,
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: (everywhere: boolean) => api<void>("POST", everywhere ? "/api/auth/logout-all" : "/api/auth/logout"),
    onSuccess: () => sessionChanged(null),
  });
}

export function useResendVerification() {
  return useMutation({ mutationFn: () => api<void>("POST", "/api/auth/email-verification/resend") });
}

export const confirmEmail = (token: string) => api<void>("POST", "/api/auth/email-verification/confirm", { body: { token } });

// Which account dialog is open; `token` for a password reset link.
export type AuthMode = "login" | "signup" | "forgot" | "reset";
export const useAuthDialog = create<{ mode: AuthMode | null; token: string | null; open(mode: AuthMode, token?: string): void; close(): void }>((set) => ({
  mode: null,
  token: null,
  open: (mode, token) => set({ mode, token: token ?? null }),
  close: () => set({ mode: null, token: null }),
}));

// The interface follows the account's language; choosing a language saves it to the
// account when there is one (FEATURE L1).
export function useAccountLanguage() {
  const user = useMe().data?.user ?? null;
  const adopted = useRef<string | null>(null);
  useEffect(() => {
    if (user && adopted.current !== user.id) {
      adopted.current = user.id;
      if (user.uiLanguage !== i18n.language) setLanguage(user.uiLanguage as Language);
    }
    if (!user) adopted.current = null;
  }, [user]);
}

export function chooseLanguage(language: Language): void {
  setLanguage(language);
  const user = queryClient.getQueryData<MeResponse>(keys.me)?.user;
  if (user) {
    void api("PATCH", "/api/settings", { body: { uiLanguage: language } }).then(() =>
      queryClient.setQueryData<MeResponse>(keys.me, (me) => (me?.user ? { user: { ...me.user, uiLanguage: language } } : me)),
    );
  }
}
