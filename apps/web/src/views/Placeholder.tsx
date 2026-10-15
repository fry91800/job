import { useTranslation } from "react-i18next";
import { VIEWS, type TabViewProps } from "./registry";

// A tab whose content comes in a later step of the plan (FRONTEND.md §8).
export default function Placeholder({ tab }: TabViewProps) {
  const { t } = useTranslation();
  const { icon: Icon, step } = VIEWS[tab.kind];
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-3 p-10">
      <div className="flex size-10 items-center justify-center rounded-box bg-accent-soft text-accent">
        <Icon size={20} />
      </div>
      <h1 className="text-xl font-semibold tracking-tight">{t(`tabs.kinds.${tab.kind}`)}</h1>
      {tab.id && <p className="font-mono text-xs text-fg-subtle">{tab.id}</p>}
      <p className="text-fg-muted">{t("tabs.placeholder", { step })}</p>
    </div>
  );
}
