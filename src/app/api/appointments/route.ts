import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { can, canAny } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { getAppointmentsInRange } from "@/server/appointments/queries";

const APPOINTMENT_TYPE_LABEL_AR: Record<string, string> = {
  measurement: "قياس",
  installation: "تركيب",
  repair: "إصلاح",
  customer_meeting: "لقاء عميل",
  other: "أخرى",
};

// Distinct color per appointment type, reusing the theme's semantic colors
// where the meaning lines up (see src/app/globals.css) and a couple of
// plain hex fallbacks for the two types with no matching token.
const APPOINTMENT_TYPE_COLOR: Record<string, string> = {
  measurement: "#1d4ed8", // --info
  installation: "#15803d", // --success
  repair: "#dc2626", // --destructive
  customer_meeting: "#7e22ce", // purple, no matching theme token
  other: "#64748b", // --muted-foreground
};

/**
 * Appointments for the calendar view (section 40), shaped for FullCalendar.
 * A Route Handler is outside proxy.ts's matcher, so the permission check
 * here is the only thing standing between an authenticated user and
 * someone else's schedule (mirrors src/app/api/quotes/[quoteId]/pdf).
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "يجب تسجيل الدخول." }, { status: 401 });
  }
  if (!canAny(user, [PERMISSIONS.VIEW_ALL_JOBS, PERMISSIONS.VIEW_ASSIGNED_JOBS])) {
    return NextResponse.json({ error: "لا تملك صلاحية الوصول." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");
  const userIdParam = searchParams.get("userId");
  if (!startParam || !endParam) {
    return NextResponse.json({ error: "يجب تحديد تاريخي البداية والنهاية." }, { status: 400 });
  }

  const startUtc = new Date(startParam);
  const endUtc = new Date(endParam);
  if (Number.isNaN(startUtc.getTime()) || Number.isNaN(endUtc.getTime())) {
    return NextResponse.json({ error: "تواريخ غير صحيحة." }, { status: 400 });
  }

  const canViewAll = can(user, PERMISSIONS.VIEW_ALL_JOBS);
  let restrictToUserId: string | undefined;
  if (!canViewAll) {
    restrictToUserId = user.id;
  } else if (userIdParam && userIdParam !== "all") {
    restrictToUserId = userIdParam;
  }

  const appointments = await getAppointmentsInRange({
    startUtc,
    endUtc,
    restrictToUserId,
  });

  return NextResponse.json(
    appointments.map((a) => {
      const typeLabel = APPOINTMENT_TYPE_LABEL_AR[a.type] ?? a.type;
      const color = APPOINTMENT_TYPE_COLOR[a.type] ?? APPOINTMENT_TYPE_COLOR.other;
      return {
        id: a.id,
        title: `${a.jobNumber} - ${a.customerName} - ${typeLabel}`,
        start: a.scheduledStart.toISOString(),
        end: a.scheduledEnd ? a.scheduledEnd.toISOString() : null,
        backgroundColor: color,
        borderColor: color,
        extendedProps: {
          type: a.type,
          status: a.status,
          assigneeNames: a.assigneeNames,
          location: a.location,
          customerPhone: a.customerPhone,
          jobHref: `/jobs/${a.jobId}`,
        },
      };
    }),
  );
}
