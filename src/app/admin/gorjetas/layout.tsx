import { requireManagerialAdmin } from "@/lib/admin-guard";

export default async function GorjetasLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireManagerialAdmin();
  return <>{children}</>;
}
