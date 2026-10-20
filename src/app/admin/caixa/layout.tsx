import { requireManagerialAdmin } from "@/lib/admin-guard";

export default async function CaixaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireManagerialAdmin();
  return <>{children}</>;
}
