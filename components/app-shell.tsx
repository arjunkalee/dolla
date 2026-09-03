"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Layers, MessageCircle, Receipt, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDolla } from "./dolla-provider";
import { LogPurchaseDrawer } from "./log-purchase";

const TABS = [
  { href: "/month", label: "Calendar", icon: CalendarDays },
  { href: "/split", label: "Split", icon: Layers },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/more", label: "More", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
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

      <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-lg border-t border-border/80 bg-background/95 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur-md">
        <div className="grid grid-cols-5 items-end px-1">
          {TABS.slice(0, 2).map((tab) => (
            <TabLink key={tab.href} tab={tab} active={pathname === tab.href} />
          ))}
          <button
            type="button"
            onClick={() => setLogOpen(true)}
            className="-mt-5 flex flex-col items-center justify-end gap-1 pb-1"
            aria-label="Log a purchase"
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_8px_24px_rgba(90,180,110,0.35)]">
              <Receipt className="size-6" />
            </span>
            <span className="text-[11px] font-medium text-primary">Log</span>
          </button>
          {TABS.slice(2).map((tab) => {
            const extraActive =
              (tab.href === "/split" && pathname === "/plan") ||
              (tab.href === "/more" &&
                ["/", "/plan", "/activity", "/savings", "/budget"].includes(pathname));
            return (
              <TabLink
                key={tab.href}
                tab={tab}
                active={pathname === tab.href || extraActive}
              />
            );
          })}
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
  tab: (typeof TABS)[number];
  active: boolean;
}) {
  const Icon = tab.icon;
  return (
    <Link
      href={tab.href}
      className={cn(
        "flex min-h-12 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
        active ? "text-primary" : "text-muted-foreground"
      )}
    >
      <Icon className="size-5" />
      {tab.label}
    </Link>
  );
}
