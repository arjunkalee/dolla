"use client";

import { formatAsOf } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export function AsOfText({
  iso,
  empty,
  inverted = false,
  className,
}: {
  iso?: string;
  empty?: string;
  inverted?: boolean;
  className?: string;
}) {
  const label = formatAsOf(iso) ?? empty;
  if (!label) return null;
  return (
    <p
      className={cn(
        "text-xs",
        inverted ? "text-primary-foreground/80" : "text-muted-foreground",
        className
      )}
    >
      {label}
    </p>
  );
}

export function BillPaidBadge({ paid }: { paid: boolean }) {
  if (!paid) return null;
  return (
    <Badge variant="secondary" className="shrink-0">
      Paid
    </Badge>
  );
}
