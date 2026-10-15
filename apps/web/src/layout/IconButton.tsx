import * as Tooltip from "@radix-ui/react-tooltip";
import type { LucideIcon } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes } from "react";

// A square icon button with its label as tooltip and for screen readers.
export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; active?: boolean; size?: number }>(
  function IconButton({ icon: Icon, label, active, size = 18, className = "", ...props }, ref) {
    return (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            ref={ref}
            type="button"
            aria-label={label}
            className={`flex size-8 shrink-0 items-center justify-center rounded-control text-fg-muted transition-colors duration-150 hover:bg-hover hover:text-fg ${active ? "bg-hover text-fg" : ""} ${className}`}
            {...props}
          >
            <Icon size={size} strokeWidth={1.75} />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content side="bottom" sideOffset={6} className="animate-pop-in z-50 rounded-control bg-fg px-2 py-1 text-xs text-bg shadow-float">
            {label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    );
  },
);
