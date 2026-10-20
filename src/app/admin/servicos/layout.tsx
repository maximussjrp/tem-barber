import { requireManagerialAdmin } from "@/lib/admin-guard";

export default async function ServicosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireManagerialAdmin();
  return <>{children}</>;
}
