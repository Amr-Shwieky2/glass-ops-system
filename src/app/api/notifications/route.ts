import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { getNotificationsForUser } from "@/server/notifications";

/**
 * Recent notifications for the header bell popover (section 63). A Route
 * Handler is outside proxy.ts's matcher, so the auth check here is the
 * only thing standing between a request and someone's inbox (mirrors
 * src/app/api/appointments/route.ts). No extra permission key — every
 * signed-in user may read their own notifications.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "يجب تسجيل الدخول." }, { status: 401 });
  }

  const notifications = await getNotificationsForUser(user.id);
  return NextResponse.json({ notifications });
}
