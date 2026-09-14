"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type {
  AppState,
  BootstrapResponse,
  Category,
  CategoryId,
  Insights,
  PaycheckSettings,
  SavingsId,
  UpcomingBill,
} from "@/lib/types";

type DollaContextValue = {
  loading: boolean;
  error: string | null;
  state: AppState | null;
  insights: Insights | null;
  logOpen: boolean;
  setLogOpen: (open: boolean) => void;
  refresh: () => Promise<void>;
  logPurchase: (input: {
    amountCents: number;
    merchant: string;
    note?: string;
    categoryId?: CategoryId;
    date?: string;
  }) => Promise<void>;
  recategorize: (id: string, categoryId: CategoryId) => Promise<void>;
  removeExpense: (id: string) => Promise<void>;
  saveBudget: (categories: Category[]) => Promise<void>;
  savePaycheck: (paycheck: PaycheckSettings) => Promise<void>;
  saveChecking: (checkingCents: number) => Promise<void>;
  saveBills: (bills: UpcomingBill[]) => Promise<void>;
  saveSplit: (allocations: AppState["splitAllocations"]) => Promise<void>;
  setBillPaid: (id: string, paid: boolean) => Promise<void>;
  setBillFromThisCheck: (id: string, fromThisCheck: boolean) => Promise<void>;
  saveSavingsTargets: (savings: AppState["savings"]) => Promise<void>;
  confirmSetAsides: (amounts: Partial<Record<SavingsId, number>>) => Promise<void>;
  importCsv: (csvText: string) => Promise<{ added: number; skipped: number; duplicates: number; errors: string[] }>;
  resetData: (mode: "sample" | "empty" | "keep-settings" | "real") => Promise<void>;
  sendChat: (text: string) => Promise<void>;
};

const DollaContext = createContext<DollaContextValue | null>(null);

async function parseResponse(res: Response): Promise<BootstrapResponse> {
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data as BootstrapResponse;
}

export function DollaProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<AppState | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  const apply = useCallback((data: BootstrapResponse) => {
    setState(data.state);
    setInsights(data.insights);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/state", { cache: "no-store" });
    apply(await parseResponse(res));
  }, [apply]);

  useEffect(() => {
    refresh()
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not load Dolla.");
      })
      .finally(() => setLoading(false));
  }, [refresh]);

  const logPurchase = useCallback(
    async (input: {
      amountCents: number;
      merchant: string;
      note?: string;
      categoryId?: CategoryId;
      date?: string;
    }) => {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      apply(await parseResponse(res));
    },
    [apply]
  );

  const recategorize = useCallback(
    async (id: string, categoryId: CategoryId) => {
      const res = await fetch(`/api/expenses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId }),
      });
      apply(await parseResponse(res));
    },
    [apply]
  );

  const removeExpense = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/expenses/${id}`, { method: "DELETE" });
      apply(await parseResponse(res));
    },
    [apply]
  );

  const saveBudget = useCallback(
    async (categories: Category[]) => {
      const res = await fetch("/api/budget", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories }),
      });
      apply(await parseResponse(res));
    },
    [apply]
  );

  const savePaycheck = useCallback(
    async (paycheck: PaycheckSettings) => {
      const res = await fetch("/api/paycheck", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paycheck }),
      });
      apply(await parseResponse(res));
    },
    [apply]
  );

  const saveChecking = useCallback(
    async (checkingCents: number) => {
      const res = await fetch("/api/checking", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkingCents }),
      });
      apply(await parseResponse(res));
    },
    [apply]
  );

  const saveBills = useCallback(
    async (bills: UpcomingBill[]) => {
      const res = await fetch("/api/bills", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bills }),
      });
      apply(await parseResponse(res));
    },
    [apply]
  );

  const saveSplit = useCallback(
    async (allocations: AppState["splitAllocations"]) => {
      const res = await fetch("/api/split", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocations }),
      });
      apply(await parseResponse(res));
    },
    [apply]
  );

  const setBillPaid = useCallback(
    async (id: string, paid: boolean) => {
      const res = await fetch("/api/bills", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, paid }),
      });
      apply(await parseResponse(res));
    },
    [apply]
  );

  const setBillFromThisCheck = useCallback(
    async (id: string, fromThisCheck: boolean) => {
      const res = await fetch("/api/bills", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, fromThisCheck }),
      });
      apply(await parseResponse(res));
    },
    [apply]
  );

  const saveSavingsTargets = useCallback(
    async (savings: AppState["savings"]) => {
      const res = await fetch("/api/savings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ savings }),
      });
      apply(await parseResponse(res));
    },
    [apply]
  );

  const confirmSetAsides = useCallback(
    async (amounts: Partial<Record<SavingsId, number>>) => {
      const res = await fetch("/api/savings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amounts }),
      });
      apply(await parseResponse(res));
    },
    [apply]
  );

  const importCsv = useCallback(
    async (csvText: string) => {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      apply(data);
      return data.importMeta as {
        added: number;
        skipped: number;
        duplicates: number;
        errors: string[];
      };
    },
    [apply]
  );

  const sendChat = useCallback(
    async (text: string) => {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      apply(await parseResponse(res));
    },
    [apply]
  );

  const resetData = useCallback(
    async (mode: "sample" | "empty" | "keep-settings" | "real") => {
      const res = await fetch("/api/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      apply(await parseResponse(res));
    },
    [apply]
  );

  const value = useMemo(
    () => ({
      loading,
      error,
      state,
      insights,
      logOpen,
      setLogOpen,
      refresh,
      logPurchase,
      recategorize,
      removeExpense,
      saveBudget,
      savePaycheck,
      saveChecking,
      saveBills,
      saveSplit,
      setBillPaid,
      setBillFromThisCheck,
      saveSavingsTargets,
      confirmSetAsides,
      importCsv,
      resetData,
      sendChat,
    }),
    [
      loading,
      error,
      state,
      insights,
      logOpen,
      refresh,
      logPurchase,
      recategorize,
      removeExpense,
      saveBudget,
      savePaycheck,
      saveChecking,
      saveBills,
      saveSplit,
      setBillPaid,
      setBillFromThisCheck,
      saveSavingsTargets,
      confirmSetAsides,
      importCsv,
      resetData,
      sendChat,
    ]
  );

  return <DollaContext.Provider value={value}>{children}</DollaContext.Provider>;
}

export function useDolla() {
  const ctx = useContext(DollaContext);
  if (!ctx) throw new Error("useDolla must be used within DollaProvider");
  return ctx;
}
