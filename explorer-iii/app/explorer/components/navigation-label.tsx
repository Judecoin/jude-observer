import type { ReactNode } from "react";
import { useLinkStatus } from "next/link";

export function NavigationLabel({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return <span data-navigation-pending={pending ? "true" : undefined} aria-busy={pending || undefined}>{children}</span>;
}
