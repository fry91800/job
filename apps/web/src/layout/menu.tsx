import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import type { ReactNode } from "react";

// Dropdown menu pieces with the workspace's look.
export const MenuRoot = Menu.Root;
export const MenuTrigger = Menu.Trigger;

export function MenuContent({ children, align = "start" }: { children: ReactNode; align?: "start" | "end" }) {
  return (
    <Menu.Portal>
      <Menu.Content align={align} sideOffset={6} className="animate-pop-in z-50 min-w-52 rounded-box border border-border bg-surface p-1 shadow-float">
        {children}
      </Menu.Content>
    </Menu.Portal>
  );
}

const itemClass = "flex cursor-default select-none items-center gap-2 rounded-control px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-hover data-[disabled]:text-fg-subtle";

export function MenuItem({ children, onSelect, disabled }: { children: ReactNode; onSelect?: () => void; disabled?: boolean }) {
  return (
    <Menu.Item className={itemClass} onSelect={onSelect} disabled={disabled}>
      {children}
    </Menu.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <Menu.Label className="px-2 pb-1 pt-2 text-xs font-medium text-fg-subtle">{children}</Menu.Label>;
}

export const MenuSeparator = () => <Menu.Separator className="my-1 h-px bg-border" />;

export function MenuChoice<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <Menu.RadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
      {options.map((option) => (
        <Menu.RadioItem key={option.value} value={option.value} className={itemClass} onSelect={(event) => event.preventDefault()}>
          <span className="flex w-4 justify-center">
            <Menu.ItemIndicator>
              <Check size={14} />
            </Menu.ItemIndicator>
          </span>
          {option.label}
        </Menu.RadioItem>
      ))}
    </Menu.RadioGroup>
  );
}
