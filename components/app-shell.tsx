"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDays,
  ChevronLeft,
  CircleUser,
  House,
  MessageCircle,
  PieChart,
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
  "/budget": PieChart,
  "/chat": MessageCircle,
};

const TAB_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
};

/** Home, Calendar, Budget | Log | Chat. Equal-width sides keep the raised Log button centered. */
const LEFT_TABS = NAV_TABS.slice(0, 3);
const RIGHT_TABS = NAV_TABS.slice(3);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const activeHref = activeNavHref(pathname);
  const { setLogOpen, loading, error, refresh } = useDolla();
  const onProfile = pathname === "/profile";

  function returnFromProfile() {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/");
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-background">
      <header className="sticky top-0 z-30 shrink-0 bg-background/95 pl-[max(0.25rem,env(safe-area-inset-left))] pr-[max(0.25rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className={cn("flex h-12 items-center", onProfile ? "justify-start" : "justify-end")}>
          {onProfile ? (
            <button
              type="button"
              onClick={returnFromProfile}
              aria-label="Back"
              className="inline-flex h-11 items-center gap-0.5 rounded-full pr-3 pl-1 text-sm font-medium text-foreground touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft className="size-5" aria-hidden />
              Back
            </button>
          ) : (
            <Link
              href="/profile"
              aria-label="Profile"
              className="mr-1 flex size-11 items-center justify-center rounded-full text-foreground touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-muted"
            >
              <CircleUser className="size-6" aria-hidden />
            </Link>
          )}
        </div>
      </header>
      <main className="flex-1 px-4 pb-28 pt-2">
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
          <div className={cn("grid min-w-0 flex-1", TAB_COLS[LEFT_TABS.length] ?? "grid-cols-3")}>
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
          <div className={cn("grid min-w-0 flex-1", TAB_COLS[RIGHT_TABS.length] ?? "grid-cols-3")}>
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
        "flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 text-[10px] font-medium leading-none tracking-tight min-[400px]:text-[11px]",
        active ? "text-primary" : "text-muted-foreground"
      )}
    >
      <Icon className="size-5 shrink-0" />
      <span className="whitespace-nowrap">{tab.label}</span>
    </Link>
  );
}
