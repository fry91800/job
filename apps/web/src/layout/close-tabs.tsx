import * as Dialog from "@radix-ui/react-alert-dialog";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { useTabsStore } from "../tabs/store";
import { useWorkspace } from "../tabs/workspace";

// Closing tabs: those with unsaved changes ask first (FRONTEND.md §2.2).
const usePendingClose = create<{ keys: string[] | null; set(keys: string[] | null): void }>((set) => ({ keys: null, set: (keys) => set({ keys }) }));

export function useCloseTabs() {
  const { close } = useWorkspace();
  return useCallback(
    (keys: string[]) => {
      const dirty = useTabsStore.getState().tabs.some((tab) => keys.includes(tab.key) && tab.dirty);
      if (dirty) usePendingClose.getState().set(keys);
      else close(keys);
    },
    [close],
  );
}

export function ConfirmCloseDialog() {
  const { t } = useTranslation();
  const { close } = useWorkspace();
  const { keys, set } = usePendingClose();
  return (
    <Dialog.Root open={keys !== null} onOpenChange={(open) => !open && set(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade-in fixed inset-0 z-40 bg-overlay" />
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
        <Dialog.Content className="animate-pop-in pointer-events-auto w-full max-w-[420px] rounded-box border border-border bg-surface p-5 shadow-float">
          <Dialog.Title className="text-base font-semibold">{t("tabs.unsavedTitle")}</Dialog.Title>
          <Dialog.Description className="mt-2 text-fg-muted">{t("tabs.unsavedText")}</Dialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Cancel className="h-8 rounded-control border border-border px-3 text-sm transition-colors hover:bg-hover">{t("tabs.cancel")}</Dialog.Cancel>
            <Dialog.Action
              className="h-8 rounded-control bg-danger px-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
              onClick={() => {
                if (keys) close(keys);
                set(null);
              }}
            >
              {t("tabs.unsavedConfirm")}
            </Dialog.Action>
          </div>
        </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
