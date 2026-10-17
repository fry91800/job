import { Bell, Pause, Play, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { JOB_ALERT_FREQUENCIES, MAX_JOB_ALERTS } from "@job/shared";
import { useMe } from "../api/queries";
import { errorMessage } from "../lib/errors";
import { formatDate } from "../lib/format";
import { toast } from "../lib/toast";
import { useAlerts, useDeleteAlert, useUpdateAlert } from "./queries";

// The account's job alerts, in Settings (GROWTH.md phase 2): open the search, frequency,
// pause, delete.
export function AlertsCard({ card }: { card: (title: string, children: ReactNode) => ReactNode }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const user = useMe().data?.user ?? null;
  const alerts = useAlerts();
  const update = useUpdateAlert();
  const remove = useDeleteAlert();
  const onError = (error: unknown) => toast(errorMessage(t, error), "error");

  if (!user || user.isGuest) return card(t("alerts.title"), <p className="text-sm text-fg-muted">{t("alerts.guestIntro")}</p>);

  return card(
    t("alerts.title"),
    <>
      <p className="-mt-2 text-sm text-fg-muted">{t("alerts.intro", { max: MAX_JOB_ALERTS })}</p>
      {!user.emailVerified && <p className="rounded-control bg-warning/10 px-3 py-2 text-sm text-warning">{t("alerts.unverified")}</p>}
      {alerts.data?.length === 0 && (
        <p className="flex items-center gap-1.5 text-sm text-fg-subtle">
          <Bell size={14} /> {t("alerts.empty")}
        </p>
      )}
      <ul className="flex flex-col divide-y divide-border">
        {alerts.data?.map((alert) => (
          <li key={alert.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
            <div className="flex min-w-0 flex-1 flex-col">
              <button type="button" onClick={() => navigate({ pathname: "/", search: `?${alert.query}&sort=recent` })} className={`truncate text-left text-sm font-medium hover:text-accent ${alert.paused ? "text-fg-subtle line-through" : ""}`}>
                {alert.label}
              </button>
              <span className="text-xs text-fg-subtle">
                {alert.paused ? t("alerts.paused") : alert.lastSentAt ? t("alerts.lastSent", { date: formatDate(alert.lastSentAt, i18n.language) }) : t("alerts.noneSent")}
              </span>
            </div>
            <select
              aria-label={t("alerts.frequency")}
              value={alert.frequency}
              onChange={(event) => update.mutate({ id: alert.id, frequency: event.target.value as (typeof JOB_ALERT_FREQUENCIES)[number] }, { onError })}
              className="h-8 rounded-control border border-border bg-bg px-2 text-sm outline-none focus:border-accent"
            >
              {JOB_ALERT_FREQUENCIES.map((value) => (
                <option key={value} value={value}>
                  {t(`alerts.frequencies.${value}`)}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={alert.paused ? t("alerts.resume") : t("alerts.pause")}
              title={alert.paused ? t("alerts.resume") : t("alerts.pause")}
              onClick={() => update.mutate({ id: alert.id, paused: !alert.paused }, { onError })}
              className="flex size-8 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-hover hover:text-fg"
            >
              {alert.paused ? <Play size={15} /> : <Pause size={15} />}
            </button>
            <button
              type="button"
              aria-label={t("alerts.delete")}
              title={t("alerts.delete")}
              onClick={() => remove.mutate(alert.id, { onError })}
              className="flex size-8 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ul>
    </>,
  );
}
