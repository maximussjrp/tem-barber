import { requireManagerialAdmin } from "@/lib/admin-guard";

export default async function ConfiguracoesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireManagerialAdmin();
  return <>{children}</>;
}
