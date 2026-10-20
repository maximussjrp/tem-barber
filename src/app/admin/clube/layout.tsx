import { requireManagerialAdmin } from "@/lib/admin-guard";

export default async function ClubeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireManagerialAdmin();
  return <>{children}</>;
}
