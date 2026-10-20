import { requireManagerialAdmin } from "@/lib/admin-guard";

export default async function ClientesReativacaoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireManagerialAdmin();
  return <>{children}</>;
}
