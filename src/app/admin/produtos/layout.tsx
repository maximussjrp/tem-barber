import { requireManagerialAdmin } from "@/lib/admin-guard";

export default async function ProdutosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireManagerialAdmin();
  return <>{children}</>;
}
