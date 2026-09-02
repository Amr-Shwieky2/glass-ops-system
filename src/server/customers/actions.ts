"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { customers } from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { isPlausiblePhone, normalizePhone } from "@/server/tokens";
import { searchCustomers } from "./queries";

/**
 * Called directly from a client component's onChange handler (not bound to
 * a <form>) — Next.js Server Actions support this as a normal async RPC,
 * not just form submission. Used by the "new job" customer combobox.
 */
export async function searchCustomersAction(term: string) {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.VIEW_CUSTOMERS)) return [];
  if (!term || term.trim().length < 2) return [];
  return searchCustomers(term);
}

export interface CustomerFormState {
  error?: string;
  success?: boolean;
  customerId?: string;
}

const CustomerSchema = z.object({
  name: z.string().trim().min(2, { error: "الاسم مطلوب (حرفان على الأقل)" }),
  phone: z.string().trim().min(1, { error: "رقم الهاتف مطلوب" }),
  nationalId: z.string().trim().optional(),
  address: z.string().trim().optional(),
  googleMapsUrl: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : undefined;
}

function parseCustomerForm(formData: FormData) {
  return CustomerSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    nationalId: emptyToUndefined(formData.get("nationalId")),
    address: emptyToUndefined(formData.get("address")),
    googleMapsUrl: emptyToUndefined(formData.get("googleMapsUrl")),
    notes: emptyToUndefined(formData.get("notes")),
  });
}

export async function createCustomer(
  _prevState: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.CREATE_CUSTOMER)) {
    return { error: "لا تملك صلاحية إضافة عملاء." };
  }

  const parsed = parseCustomerForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const phone = normalizePhone(parsed.data.phone);
  if (!isPlausiblePhone(phone)) {
    return { error: "رقم الهاتف غير صحيح" };
  }

  const [row] = await db
    .insert(customers)
    .values({
      name: parsed.data.name,
      phone,
      nationalId: parsed.data.nationalId,
      address: parsed.data.address,
      googleMapsUrl: parsed.data.googleMapsUrl,
      notes: parsed.data.notes,
      createdByUserId: user!.id,
    })
    .returning({ id: customers.id });

  await recordAudit({
    userId: user!.id,
    action: "customer.create",
    entityType: "customer",
    entityId: row.id,
    newValue: parsed.data,
  });

  revalidatePath("/customers");
  return { success: true, customerId: row.id };
}

export async function updateCustomer(
  customerId: string,
  _prevState: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.EDIT_CUSTOMER)) {
    return { error: "لا تملك صلاحية تعديل بيانات العملاء." };
  }

  const parsed = parseCustomerForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const phone = normalizePhone(parsed.data.phone);
  if (!isPlausiblePhone(phone)) {
    return { error: "رقم الهاتف غير صحيح" };
  }

  const existingRows = await db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) {
    return { error: "العميل غير موجود" };
  }

  await db
    .update(customers)
    .set({
      name: parsed.data.name,
      phone,
      nationalId: parsed.data.nationalId,
      address: parsed.data.address,
      googleMapsUrl: parsed.data.googleMapsUrl,
      notes: parsed.data.notes,
      updatedAt: new Date(),
    })
    .where(eq(customers.id, customerId));

  await recordAudit({
    userId: user!.id,
    action: "customer.update",
    entityType: "customer",
    entityId: customerId,
    oldValue: existing,
    newValue: parsed.data,
  });

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  return { success: true, customerId };
}
