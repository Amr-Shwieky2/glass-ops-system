"use server";

import { decideCustomerPaymentAction as decide, type ActionState } from "./decide";

export type { ActionState };

/**
 * Thin "use server" re-export of decideCustomerPaymentAction (src/server/
 * approvals/decide.ts). decide.ts is a "server-only" module whose action
 * carries a *function-level* "use server" directive (not a file-level
 * one) — deliberate, since createApprovalRequest in that same file takes
 * a non-serializable `tx` executor and is imported directly by
 * src/server/payments/record.ts (see decide.ts's own comment). That shape
 * works when the action is called from a Server Component, but Next.js
 * explicitly refuses to import a function-level "use server" export
 * straight into a Client Component — it would try to pull the whole
 * module (db/pg included) into the browser bundle instead of treating it
 * as a server action reference. This file is the boundary a Client
 * Component needs: a real top-level async function inside a proper
 * file-level "use server" module, calling straight through to decide.ts's
 * implementation.
 */
export async function decideCustomerPaymentAction(
  paymentId: string,
  prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return decide(paymentId, prevState, formData);
}
