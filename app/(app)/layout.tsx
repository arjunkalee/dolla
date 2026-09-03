import { DollaProvider } from "@/components/dolla-provider";
import { AppShell } from "@/components/app-shell";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DollaProvider>
      <AppShell>{children}</AppShell>
    </DollaProvider>
  );
}
