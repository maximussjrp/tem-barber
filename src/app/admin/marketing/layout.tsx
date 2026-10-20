import { requireManagerialAdmin } from "@/lib/admin-guard";

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireManagerialAdmin();
  return <>{children}</>;
}
