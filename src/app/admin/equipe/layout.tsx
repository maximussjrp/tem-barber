import { requireManagerialAdmin } from "@/lib/admin-guard";

export default async function EquipeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireManagerialAdmin();
  return <>{children}</>;
}
