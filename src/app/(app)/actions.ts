"use server";

import { redirect } from "next/navigation";
import { destroyCurrentSession } from "@/server/auth/session";

export async function logoutAction(): Promise<void> {
  await destroyCurrentSession();
  redirect("/login");
}
