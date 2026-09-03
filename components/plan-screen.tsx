"use client";

import Link from "next/link";
import { LeftoverCard } from "./leftover-card";

export function PlanScreen() {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Paycheck vs checking</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Two different leftovers. This paycheck can be short while checking still has prior cash.
        </p>
      </header>
      <LeftoverCard />
      <Link href="/month" className="inline-flex min-h-12 items-center text-base font-medium text-primary">
        Open the Month plan
      </Link>
    </div>
  );
}
