/** Bottom-nav destinations. The center Log control is an action, not a route. */
export const NAV_TABS = [
  { href: "/", label: "Home" },
  { href: "/month", label: "Calendar" },
  { href: "/budget", label: "Budget" },
  { href: "/chat", label: "Chat" },
  { href: "/profile", label: "Profile" },
] as const;

export type NavTabHref = (typeof NAV_TABS)[number]["href"];

/**
 * Highlight a tab only on an exact path match.
 * `/plan`, `/activity`, `/savings`, `/envelopes`, `/bills`, and `/split`
 * are not tabs. `/split` redirects to the combined Budget tab.
 * Home is active only on `/`. Budget is active only on `/budget`.
 */
export function activeNavHref(pathname: string): NavTabHref | null {
  for (const tab of NAV_TABS) {
    if (tab.href === pathname) return tab.href;
  }
  return null;
}
