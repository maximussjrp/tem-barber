import { requireManagerialAdmin } from "@/lib/admin-guard";

export default async function ComissoesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireManagerialAdmin();
  return <>{children}</>;
}
