import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Users,
  Briefcase,
  CalendarDays,
  CalendarCheck,
  FileText,
  Factory,
  Wrench,
  HardHat,
  Truck,
  Wallet,
  CheckSquare,
  BarChart3,
  Settings,
  ShieldCheck,
  ScrollText,
} from "lucide-react";
import { PERMISSIONS, type PermissionKey } from "@/server/auth/permission-keys";

/**
 * Single source of truth for the app's primary navigation. `permission`
 * undefined means "any authenticated user may see this"; an array means
 * "any one of these" (mirrors canAny()). Filtering happens server-side in
 * src/app/(app)/layout.tsx so a user's client bundle never even receives
 * the labels/hrefs of sections they can't open.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: PermissionKey | PermissionKey[];
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "لوحة التحكم", icon: LayoutDashboard },
  { href: "/my-day", label: "يومي", icon: CalendarCheck },
  {
    href: "/customers",
    label: "العملاء",
    icon: Users,
    permission: PERMISSIONS.VIEW_CUSTOMERS,
  },
  {
    href: "/jobs",
    label: "المهام",
    icon: Briefcase,
    permission: [PERMISSIONS.VIEW_ALL_JOBS, PERMISSIONS.VIEW_ASSIGNED_JOBS],
  },
  {
    href: "/calendar",
    label: "التقويم",
    icon: CalendarDays,
    permission: [PERMISSIONS.VIEW_ALL_JOBS, PERMISSIONS.VIEW_ASSIGNED_JOBS],
  },
  {
    href: "/quotes",
    label: "عروض الأسعار",
    icon: FileText,
    permission: [
      PERMISSIONS.CREATE_QUOTE,
      PERMISSIONS.SEND_QUOTE,
      PERMISSIONS.CLOSE_DEAL,
      PERMISSIONS.VIEW_ALL_JOBS,
    ],
  },
  {
    href: "/production",
    label: "الإنتاج والمصنع",
    icon: Factory,
    permission: [
      PERMISSIONS.CREATE_PRODUCTION_ORDER,
      PERMISSIONS.APPROVE_FACTORY_PRICE,
    ],
  },
  {
    href: "/repairs",
    label: "الإصلاحات (تيكون)",
    icon: Wrench,
    permission: PERMISSIONS.CREATE_REPAIR,
  },
  {
    href: "/contractors",
    label: "المقاولون الخارجيون",
    icon: HardHat,
    permission: PERMISSIONS.ASSIGN_INSTALLER,
  },
  {
    href: "/vehicles",
    label: "المركبات والوقود",
    icon: Truck,
    permission: [PERMISSIONS.MANAGE_VEHICLES, PERMISSIONS.ADD_FUEL],
  },
  {
    href: "/finance",
    label: "الشؤون المالية",
    icon: Wallet,
    permission: [
      PERMISSIONS.VIEW_TECHNICIAN_BALANCES,
      PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS,
      PERMISSIONS.MANAGE_CHECKS,
      PERMISSIONS.COLLECT_PAYMENT,
      PERMISSIONS.APPROVE_PAYMENT,
    ],
  },
  {
    href: "/approvals",
    label: "طلبات الموافقة",
    icon: CheckSquare,
    permission: PERMISSIONS.APPROVE_REQUESTS,
  },
  {
    href: "/reports",
    label: "التقارير",
    icon: BarChart3,
    // Must be `canAny` of every permission that unlocks at least one tab on
    // /reports (src/app/(app)/reports/page.tsx's hasReportAccess) — not a
    // narrower financial-only gate. Otherwise a user who can only open,
    // say, the vehicles-fuel or jobs tab (e.g. ADD_FUEL / VIEW_ALL_JOBS
    // without VIEW_PROFITABILITY) would have a working, permitted /reports
    // page hidden from their own nav.
    permission: [
      PERMISSIONS.VIEW_ALL_JOBS,
      PERMISSIONS.VIEW_TECHNICIAN_BALANCES,
      PERMISSIONS.MANAGE_VEHICLES,
      PERMISSIONS.ADD_FUEL,
      PERMISSIONS.VIEW_PROFITABILITY,
    ],
  },
  {
    href: "/admin/users",
    label: "المستخدمون والصلاحيات",
    icon: ShieldCheck,
    permission: [PERMISSIONS.MANAGE_USERS, PERMISSIONS.MANAGE_PERMISSIONS],
  },
  {
    href: "/admin/audit-log",
    label: "سجل التدقيق",
    icon: ScrollText,
    permission: PERMISSIONS.VIEW_AUDIT_LOG,
  },
  {
    href: "/settings",
    label: "الإعدادات",
    icon: Settings,
    permission: PERMISSIONS.MANAGE_SETTINGS,
  },
];
