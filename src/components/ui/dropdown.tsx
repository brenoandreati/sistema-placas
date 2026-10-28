"use client";

import { DropdownMenu as M } from "radix-ui";
import { cn } from "@/lib/cn";

export const Dropdown = M.Root;
export const DropdownTrigger = M.Trigger;

export function DropdownContent({ className, align = "end", ...props }: React.ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={6}
        className={cn(
          "z-50 min-w-48 rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-pop)] data-[state=open]:animate-pop-in",
          className,
        )}
        {...props}
      />
    </M.Portal>
  );
}

export function DropdownItem({
  className,
  tone = "default",
  ...props
}: React.ComponentProps<typeof M.Item> & { tone?: "default" | "danger" }) {
  return (
    <M.Item
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none select-none [&_svg]:size-4",
        tone === "danger"
          ? "text-negative data-[highlighted]:bg-negative-soft"
          : "text-ink data-[highlighted]:bg-ink/[0.05] [&_svg]:text-muted",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownSeparator() {
  return <M.Separator className="my-1 h-px bg-line" />;
}

export function DropdownLabel({ className, ...props }: React.ComponentProps<typeof M.Label>) {
  return <M.Label className={cn("px-2.5 pt-1.5 pb-1 text-xs font-medium text-muted", className)} {...props} />;
}
