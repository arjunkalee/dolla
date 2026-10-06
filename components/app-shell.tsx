"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  CircleUser,
  House,
  Layers,
  MessageCircle,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { activeNavHref, NAV_TABS, type NavTabHref } from "@/lib/nav";
import { useDolla } from "./dolla-provider";
import { LogPurchaseDrawer } from "./log-purchase";

const ICONS: Record<NavTabHref, LucideIcon> = {
  "/": House,
  "/month": CalendarDays,
  "/split": Layers,
  "/chat": MessageCircle,
  "/profile": CircleUser,
};

/** Three destinations, then the raised Log button, then the rest — Log stays centered. */
const LEFT_TABS = NAV_TABS.slice(0, 3);
const RIGHT_TABS = NAV_TABS.slice(3);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const activeHref = activeNavHref(pathname);
  const { setLogOpen, loading, error, refresh } = useDolla();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-background">
      <main className="flex-1 px-4 pb-28 pt-[max(0.75rem,env(safe-area-inset-top))]">
        {loading ? (
          <div className="space-y-3 pt-6">
            <div className="h-8 w-40 animate-pulse rounded-lg bg-muted" />
            <div className="h-36 animate-pulse rounded-2xl bg-muted" />
            <div className="h-36 animate-pulse rounded-2xl bg-muted" />
          </div>
        ) : error ? (
          <div className="pt-16 text-center">
            <p className="text-lg font-medium">Couldn’t load your money.</p>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={() => refresh()}
              className="mt-6 h-12 rounded-xl bg-primary px-6 text-base font-medium text-primary-foreground"
            >
              Try again
            </button>
          </div>
        ) : (
          children
        )}
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-lg border-t border-border/80 bg-background/95 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur-md"
      >
        <div className="flex items-end px-1">
          <div className="grid min-w-0 flex-1 grid-cols-3">
            {LEFT_TABS.map((tab) => (
              <TabLink key={tab.href} tab={tab} active={activeHref === tab.href} />
            ))}
          </div>
          <button
            type="button"
            onClick={() => setLogOpen(true)}
            className="-mt-5 flex w-16 shrink-0 flex-col items-center justify-end gap-1 pb-1"
            aria-label="Log a purchase"
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_8px_24px_rgba(90,180,110,0.35)]">
              <Receipt className="size-6" />
            </span>
            <span className="text-[11px] font-medium text-primary">Log</span>
          </button>
          <div className="grid min-w-0 flex-1 grid-cols-2">
            {RIGHT_TABS.map((tab) => (
              <TabLink key={tab.href} tab={tab} active={activeHref === tab.href} />
            ))}
          </div>
        </div>
      </nav>
      <LogPurchaseDrawer />
    </div>
  );
}

function TabLink({
  tab,
  active,
}: {
  tab: (typeof NAV_TABS)[number];
  active: boolean;
}) {
  const Icon = ICONS[tab.href];
  return (
    <Link
      href={tab.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
        active ? "text-primary" : "text-muted-foreground"
      )}
    >
      <Icon className="size-5 shrink-0" />
      <span className="whitespace-nowrap">{tab.label}</span>
    </Link>
  );
}
