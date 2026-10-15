import i18n from "../i18n";
import { keys, queryClient } from "../api/queries";
import { errorMessage } from "../lib/errors";
import { toast } from "../lib/toast";
import { confirmEmail, useAuthDialog } from "./session";

// Links from the account emails (FEATURE A4, A6): /reset-password?token=… opens the new
// password dialog, /verify-email?token=… confirms the address. Each token is used once,
// even if the page handles the address twice.
const handled = new Set<string>();

export function handleEmailLink(pathname: string, search: string): boolean {
  if (pathname !== "/reset-password" && pathname !== "/verify-email") return false;
  const token = new URLSearchParams(search).get("token");
  if (!token || handled.has(token)) return true;
  handled.add(token);
  if (pathname === "/reset-password") {
    useAuthDialog.getState().open("reset", token);
  } else {
    confirmEmail(token)
      .then(() => {
        toast(i18n.t("auth.emailConfirmed"));
        void queryClient.invalidateQueries({ queryKey: keys.me });
      })
      .catch((error) => toast(errorMessage(i18n.t, error), "error"));
  }
  return true;
}
