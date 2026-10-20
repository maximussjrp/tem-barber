import { requireManagerialAdmin } from "@/lib/admin-guard";

export default async function FinanceiroLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireManagerialAdmin();
  return <>{children}</>;
}
