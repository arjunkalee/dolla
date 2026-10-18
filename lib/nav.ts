/** Bottom-nav destinations. The center Log control is an action, not a route. Profile is a header icon, not a tab. */
export const NAV_TABS = [
  { href: "/", label: "Home" },
  { href: "/month", label: "Calendar" },
  { href: "/budget", label: "Budget" },
  { href: "/chat", label: "Chat" },
] as const;

export type NavTabHref = (typeof NAV_TABS)[number]["href"];

/**
 * Highlight a tab only on an exact path match.
 * `/plan`, `/activity`, `/savings`, `/envelopes`, `/bills`, `/split`, and `/profile`
 * are not tabs. `/split` redirects to the combined Budget tab.
 * Profile opens from the header icon and stays on `/profile`.
 * Home is active only on `/`. Budget is active only on `/budget`.
 */
export function activeNavHref(pathname: string): NavTabHref | null {
  for (const tab of NAV_TABS) {
    if (tab.href === pathname) return tab.href;
  }
  return null;
}
