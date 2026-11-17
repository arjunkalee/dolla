import { Suspense } from "react";
import { BudgetTab } from "@/components/budget-tab";

export default function BudgetPage() {
  return (
    <Suspense fallback={null}>
      <BudgetTab />
    </Suspense>
  );
}
