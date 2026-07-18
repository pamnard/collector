import type { ReactNode } from "react";

interface SidebarMenuProps {
  title: string;
  children: ReactNode;
}

export function SidebarMenu({ title, children }: SidebarMenuProps) {
  return (
    <div>
      <p className="text-sm font-semibold text-muted uppercase tracking-wider mb-3 mt-6 px-2">
        {title}
      </p>
      {children}
    </div>
  );
}
