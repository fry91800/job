import { Bell, BellRing, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMe } from "../api/queries";
import { useAuthDialog } from "../auth/session";
import { errorMessage } from "../lib/errors";
import { toast } from "../lib/toast";
import { alertQuery, hasAlertCriteria, type SearchState } from "../search/params";
import { useWorkspace } from "../tabs/workspace";
import { useAlerts, useCreateAlert } from "./queries";

// "Créer une alerte" under the search (GROWTH.md phase 2): saves the current search; its new
// offers are emailed every morning. Already saved: opens the alerts (Settings).
export function AlertButton({ state }: { state: SearchState }) {
  const { t } = useTranslation();
  const user = useMe().data?.user ?? null;
  const openAuth = useAuthDialog((store) => store.open);
  const { open } = useWorkspace();
  const alerts = useAlerts();
  const create = useCreateAlert();
  const query = alertQuery(state);
  const existing = alerts.data?.find((alert) => alert.query === query);

  const onClick = async () => {
    if (!user || user.isGuest) {
      toast(t("alerts.needAccount"), "info");
      openAuth("signup");
      return;
    }
    if (existing) return open({ kind: "settings" });
    if (!hasAlertCriteria(state)) return toast(t("alerts.needCriteria"), "info");
    const contracts = state.contractType.map((value) => t(`offer.contract.${value}`));
    const label = [state.q.trim(), state.locationName, ...contracts].filter(Boolean).join(" · ") || t("alerts.untitled");
    try {
      await create.mutateAsync({ query, label: label.slice(0, 200) });
      toast(user.emailVerified ? t("alerts.created") : t("alerts.createdUnverified"));
    } catch (error) {
      toast(errorMessage(t, error), "error");
    }
  };

  const Icon = create.isPending ? Loader2 : existing ? BellRing : Bell;
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      title={existing ? t("alerts.manage") : t("alerts.createHint")}
      className={`flex h-6 items-center gap-1 rounded-control px-1.5 text-xs transition-colors hover:bg-hover hover:text-fg ${existing ? "text-accent" : "text-fg-muted"}`}
    >
      <Icon size={13} className={create.isPending ? "animate-spin" : ""} /> {existing ? t("alerts.active") : t("alerts.create")}
    </button>
  );
}
