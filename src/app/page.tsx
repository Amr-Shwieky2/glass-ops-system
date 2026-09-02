import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";

export default async function RootPage() {
  const user = await getCurrentUser();
  redirect(user ? "/dashboard" : "/login");
}
