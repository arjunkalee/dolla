import { BudgetBreakdownScreen } from "@/components/budget-breakdown-screen";
import { SplitScreen } from "@/components/split-screen";

export default function BudgetPage() {
  return (
    <div className="space-y-10">
      <BudgetBreakdownScreen />
      <SplitScreen embedded />
    </div>
  );
}
