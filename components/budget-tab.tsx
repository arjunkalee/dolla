"use client";

import { useSearchParams } from "next/navigation";
import { BUDGET_CATEGORY_QUERY } from "@/lib/category-expenses";
import { BudgetBreakdownScreen } from "./budget-breakdown-screen";
import { BudgetCategoryScreen } from "./budget-category-screen";
import { SplitScreen } from "./split-screen";

export function BudgetTab() {
  const categoryId = useSearchParams().get(BUDGET_CATEGORY_QUERY);
  if (categoryId) {
    return <BudgetCategoryScreen categoryId={categoryId} />;
  }
  return (
    <div className="space-y-10">
      <BudgetBreakdownScreen />
      <SplitScreen embedded />
    </div>
  );
}
