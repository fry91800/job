import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { create } from "zustand";

// Short confirmations ("Email confirmed", "Logged out"), bottom right, gone after a few
// seconds; read out by screen readers.

type Toast = { id: number; tone: "success" | "info" | "error"; text: string };

const useToasts = create<{ toasts: Toast[]; dismiss(id: number): void }>((set) => ({
  toasts: [],
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

let nextId = 1;
export function toast(text: string, tone: Toast["tone"] = "success"): void {
  const id = nextId++;
  useToasts.setState((state) => ({ toasts: [...state.toasts.slice(-2), { id, tone, text }] }));
  setTimeout(() => useToasts.getState().dismiss(id), tone === "error" ? 7000 : 4000);
}

const ICONS = { success: CheckCircle2, info: Info, error: XCircle };
const TONES = { success: "text-success", info: "text-accent", error: "text-danger" };

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(360px,calc(100vw-32px))] flex-col gap-2">
      {toasts.map((item) => {
        const Icon = ICONS[item.tone];
        return (
          <div key={item.id} role="status" className="animate-pop-in pointer-events-auto flex items-start gap-2 rounded-box border border-border bg-surface p-3 text-sm shadow-float">
            <Icon size={16} className={`mt-0.5 shrink-0 ${TONES[item.tone]}`} />
            <span className="flex-1">{item.text}</span>
            <button type="button" onClick={() => dismiss(item.id)} className="text-fg-subtle transition-colors hover:text-fg" aria-label="×">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
