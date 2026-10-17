import { FileText, History, Image, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, Settings, Star } from "lucide-react";
import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TabKind } from "../tabs/model";
import { useTabsStore } from "../tabs/store";
import { useWorkspace } from "../tabs/workspace";
import { GuestReminder } from "../auth/GuestReminder";
import { useFeedbackDialog } from "../feedback/FeedbackDialog";
import { ResultList } from "../search/ResultList";
import { SearchBlock } from "../search/SearchBlock";
import { AccountMenu } from "./AccountMenu";
import { IconButton } from "./IconButton";
import { useSidebarStore } from "./sidebar-store";

// The sidebar (FRONTEND.md §2.1): tools and account, search, results.

const TOOLS: { kind: TabKind; icon: typeof FileText; label: string }[] = [
  { kind: "resumes", icon: FileText, label: "tools.resumes" },
  { kind: "photos", icon: Image, label: "tools.photos" },
  { kind: "saved", icon: Star, label: "tools.saved" },
  { kind: "history", icon: History, label: "tools.history" },
  { kind: "settings", icon: Settings, label: "tools.settings" },
];

function Tools({ vertical = false }: { vertical?: boolean }) {
  const { t } = useTranslation();
  const { open } = useWorkspace();
  const activeKey = useTabsStore((state) => state.activeKey);
  return (
    <div className={`flex gap-0.5 ${vertical ? "flex-col" : ""}`}>
      {TOOLS.map((tool) => (
        <IconButton key={tool.kind} icon={tool.icon} label={t(tool.label)} active={activeKey === tool.kind} onClick={() => open({ kind: tool.kind })} />
      ))}
    </div>
  );
}

// Drag the edge to resize; double-click it to go back to the default width.
function ResizeHandle() {
  const { t } = useTranslation();
  const setWidth = useSidebarStore((state) => state.setWidth);
  const start = useRef<{ x: number; width: number } | null>(null);
  const onPointerDown = (event: ReactPointerEvent) => {
    start.current = { x: event.clientX, width: useSidebarStore.getState().width };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    if (start.current) setWidth(start.current.width + event.clientX - start.current.x);
  };
  const onPointerUp = () => {
    start.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("sidebar.resize")}
      className="group absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={() => setWidth(340)}
    >
      <div className="mx-auto h-full w-px bg-transparent transition-colors duration-150 group-hover:bg-accent" />
    </div>
  );
}

export function Sidebar({ phone = false }: { phone?: boolean }) {
  const { t } = useTranslation();
  const { width, collapsed, toggle } = useSidebarStore();
  const openFeedback = useFeedbackDialog((state) => state.open);

  if (collapsed && !phone) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center gap-2 border-r border-border bg-sidebar py-2">
        <IconButton icon={PanelLeftOpen} label={t("sidebar.expand")} onClick={toggle} />
        <div className="h-px w-6 bg-border" />
        <Tools vertical />
        <div className="mt-auto flex flex-col items-center gap-1">
          <IconButton icon={MessageSquarePlus} label={t("feedback.open")} onClick={openFeedback} />
          <AccountMenu compact />
        </div>
      </aside>
    );
  }

  return (
    <aside className="relative flex h-full shrink-0 flex-col border-r border-border bg-sidebar" style={phone ? { width: "100%" } : { width }}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-2">
        <Tools />
        <div className="flex items-center">
          <IconButton icon={MessageSquarePlus} label={t("feedback.open")} onClick={openFeedback} />
          <AccountMenu />
          {!phone && <IconButton icon={PanelLeftClose} label={t("sidebar.collapse")} onClick={toggle} />}
        </div>
      </div>
      <SearchBlock />
      <ResultList />
      <GuestReminder />
      {!phone && <ResizeHandle />}
    </aside>
  );
}
