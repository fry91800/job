import * as Dialog from "@radix-ui/react-alert-dialog";
import { useTranslation } from "react-i18next";
import { create } from "zustand";

// Confirmation before an action that can't be undone (delete a resume, a photo…):
// `await confirm({ … })` is true when confirmed.

type Request = { title: string; text: string; confirm: string; danger?: boolean; resolve: (ok: boolean) => void };
const useConfirmStore = create<{ request: Request | null }>(() => ({ request: null }));

export function confirm(options: Omit<Request, "resolve">): Promise<boolean> {
  return new Promise((resolve) => useConfirmStore.setState({ request: { ...options, resolve } }));
}

export function ConfirmDialog() {
  const { t } = useTranslation();
  const request = useConfirmStore((state) => state.request);
  const finish = (ok: boolean) => {
    request?.resolve(ok);
    useConfirmStore.setState({ request: null });
  };
  return (
    <Dialog.Root open={request !== null} onOpenChange={(open) => !open && finish(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade-in fixed inset-0 z-40 bg-overlay" />
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Content className="animate-pop-in pointer-events-auto w-full max-w-[420px] rounded-box border border-border bg-surface p-5 shadow-float">
            <Dialog.Title className="text-base font-semibold">{request?.title}</Dialog.Title>
            <Dialog.Description className="mt-2 text-fg-muted">{request?.text}</Dialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Cancel className="h-8 rounded-control border border-border px-3 text-sm transition-colors hover:bg-hover">{t("tabs.cancel")}</Dialog.Cancel>
              <Dialog.Action
                onClick={() => finish(true)}
                className={`h-8 rounded-control px-3 text-sm font-medium transition-opacity hover:opacity-90 ${request?.danger ? "bg-danger text-white" : "bg-accent text-accent-fg"}`}
              >
                {request?.confirm}
              </Dialog.Action>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
