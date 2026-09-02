import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { can, canAny } from "@/server/auth/permissions";
import { NAV_ITEMS } from "@/config/nav";
import { AppShell } from "./app-shell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const allowedHrefs = NAV_ITEMS.filter((item) => {
    if (!item.permission) return true;
    if (Array.isArray(item.permission)) return canAny(user, item.permission);
    return can(user, item.permission);
  }).map((item) => item.href);

  return (
    <AppShell
      userName={user.name}
      userPhone={user.phone}
      allowedHrefs={allowedHrefs}
    >
      {children}
    </AppShell>
  );
}
