import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMe } from "../api/queries";
import { useAuthDialog } from "./session";

// Guests with data (a guest exists only once it has saved something, FEATURE G1) are
// reminded, without blocking anything, that an account keeps their data. Dismissed for a
// week.
const KEY = "job.guestReminderDismissed";
const WEEK = 7 * 24 * 3600 * 1000;

function dismissedRecently(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(KEY) ?? 0) < WEEK;
  } catch {
    return false;
  }
}

export function GuestReminder() {
  const { t } = useTranslation();
  const user = useMe().data?.user ?? null;
  const open = useAuthDialog((state) => state.open);
  const [hidden, setHidden] = useState(dismissedRecently);
  if (!user?.isGuest || hidden) return null;
  return (
    <div className="animate-fade-in m-2 flex gap-2 rounded-box border border-accent/30 bg-accent-soft p-3 text-sm">
      <div className="flex flex-1 flex-col gap-2">
        <p>{t("auth.guestReminder")}</p>
        <button type="button" onClick={() => open("signup")} className="self-start font-medium text-accent hover:underline">
          {t("account.signUp")}
        </button>
      </div>
      <button
        type="button"
        aria-label={t("tabs.close")}
        onClick={() => {
          try {
            localStorage.setItem(KEY, String(Date.now()));
          } catch {
            // Hidden for this page only.
          }
          setHidden(true);
        }}
        className="flex size-6 shrink-0 items-center justify-center rounded-control text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
      >
        <X size={14} />
      </button>
    </div>
  );
}
