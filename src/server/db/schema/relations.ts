import { relations } from "drizzle-orm";
import { users, userPermissions, permissions, sessions } from "./auth";
import { customers } from "./customers";
import { vehicles, vehicleResponsibilityHistory, fuelLogs } from "./vehicles";
import {
  jobs,
  jobItems,
  jobAssignments,
  measurements,
  measurementAttachments,
} from "./jobs";
import { jobStatuses, workTypes, glassTypes, compensationRules } from "./lookups";
import { appointments, appointmentAssignees } from "./appointments";
import {
  quotes,
  quoteVersions,
  quoteItems,
  quoteSignatures,
  quotePublicLinks,
} from "./quotes";
import {
  productionRequests,
  factorySubmissions,
  factoryPublicLinks,
} from "./production";
import {
  jobCosts,
  customerPayments,
  cashAccounts,
  cashTransactions,
  cashTransfers,
  incomingChecks,
} from "./finance";
import { technicianLedgerEntries, commissions } from "./compensation";
import { externalContractors } from "./contractors";
import { repairs } from "./repairs";
import { approvalRequests, notifications } from "./system";

export const usersRelations = relations(users, ({ many, one }) => ({
  grantedPermissions: many(userPermissions),
  defaultVehicle: one(vehicles, {
    fields: [users.defaultVehicleId],
    references: [vehicles.id],
  }),
  sessions: many(sessions),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  grants: many(userPermissions),
}));

export const userPermissionsRelations = relations(
  userPermissions,
  ({ one }) => ({
    user: one(users, {
      fields: [userPermissions.userId],
      references: [users.id],
    }),
    permission: one(permissions, {
      fields: [userPermissions.permissionKey],
      references: [permissions.key],
    }),
  }),
);

export const customersRelations = relations(customers, ({ many }) => ({
  jobs: many(jobs),
  quotes: many(quotes),
  payments: many(customerPayments),
  incomingChecks: many(incomingChecks),
}));

export const jobStatusesRelations = relations(jobStatuses, ({ many }) => ({
  jobs: many(jobs),
}));

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  customer: one(customers, {
    fields: [jobs.customerId],
    references: [customers.id],
  }),
  status: one(jobStatuses, {
    fields: [jobs.statusId],
    references: [jobStatuses.id],
  }),
  measuredBy: one(users, {
    fields: [jobs.measuredByUserId],
    references: [users.id],
  }),
  pricingResponsible: one(users, {
    fields: [jobs.pricingResponsibleUserId],
    references: [users.id],
  }),
  dealClosedBy: one(users, {
    fields: [jobs.dealClosedByUserId],
    references: [users.id],
  }),
  sourceQuoteVersion: one(quoteVersions, {
    fields: [jobs.sourceQuoteVersionId],
    references: [quoteVersions.id],
  }),
  items: many(jobItems),
  assignments: many(jobAssignments),
  measurements: many(measurements),
  appointments: many(appointments),
  quotes: many(quotes),
  productionRequests: many(productionRequests),
  costs: many(jobCosts),
  payments: many(customerPayments),
  repairs: many(repairs),
  commissions: many(commissions),
}));

export const jobItemsRelations = relations(jobItems, ({ one, many }) => ({
  job: one(jobs, { fields: [jobItems.jobId], references: [jobs.id] }),
  workType: one(workTypes, {
    fields: [jobItems.workTypeId],
    references: [workTypes.id],
  }),
  assignments: many(jobAssignments),
}));

export const jobAssignmentsRelations = relations(jobAssignments, ({ one }) => ({
  job: one(jobs, { fields: [jobAssignments.jobId], references: [jobs.id] }),
  jobItem: one(jobItems, {
    fields: [jobAssignments.jobItemId],
    references: [jobItems.id],
  }),
  user: one(users, {
    fields: [jobAssignments.userId],
    references: [users.id],
  }),
  externalContractor: one(externalContractors, {
    fields: [jobAssignments.externalContractorId],
    references: [externalContractors.id],
  }),
}));

export const measurementsRelations = relations(measurements, ({ one, many }) => ({
  job: one(jobs, { fields: [measurements.jobId], references: [jobs.id] }),
  measuredBy: one(users, {
    fields: [measurements.measuredByUserId],
    references: [users.id],
  }),
  pricingResponsible: one(users, {
    fields: [measurements.pricingResponsibleUserId],
    references: [users.id],
  }),
  glassType: one(glassTypes, {
    fields: [measurements.glassTypeId],
    references: [glassTypes.id],
  }),
  attachments: many(measurementAttachments),
}));

export const glassTypesRelations = relations(glassTypes, ({ many }) => ({
  measurements: many(measurements),
}));

export const measurementAttachmentsRelations = relations(
  measurementAttachments,
  ({ one }) => ({
    measurement: one(measurements, {
      fields: [measurementAttachments.measurementId],
      references: [measurements.id],
    }),
    uploadedBy: one(users, {
      fields: [measurementAttachments.uploadedByUserId],
      references: [users.id],
    }),
  }),
);

export const appointmentsRelations = relations(appointments, ({ one, many }) => ({
  job: one(jobs, { fields: [appointments.jobId], references: [jobs.id] }),
  assignees: many(appointmentAssignees),
}));

export const appointmentAssigneesRelations = relations(
  appointmentAssignees,
  ({ one }) => ({
    appointment: one(appointments, {
      fields: [appointmentAssignees.appointmentId],
      references: [appointments.id],
    }),
    user: one(users, {
      fields: [appointmentAssignees.userId],
      references: [users.id],
    }),
  }),
);

export const quotesRelations = relations(quotes, ({ one, many }) => ({
  customer: one(customers, {
    fields: [quotes.customerId],
    references: [customers.id],
  }),
  job: one(jobs, { fields: [quotes.jobId], references: [jobs.id] }),
  currentVersion: one(quoteVersions, {
    fields: [quotes.currentVersionId],
    references: [quoteVersions.id],
  }),
  signedVersion: one(quoteVersions, {
    fields: [quotes.signedVersionId],
    references: [quoteVersions.id],
  }),
  versions: many(quoteVersions),
  publicLinks: many(quotePublicLinks),
}));

export const quoteVersionsRelations = relations(
  quoteVersions,
  ({ one, many }) => ({
    quote: one(quotes, {
      fields: [quoteVersions.quoteId],
      references: [quotes.id],
    }),
    items: many(quoteItems),
    signature: one(quoteSignatures, {
      fields: [quoteVersions.id],
      references: [quoteSignatures.quoteVersionId],
    }),
  }),
);

export const quoteItemsRelations = relations(quoteItems, ({ one }) => ({
  version: one(quoteVersions, {
    fields: [quoteItems.quoteVersionId],
    references: [quoteVersions.id],
  }),
  workType: one(workTypes, {
    fields: [quoteItems.workTypeId],
    references: [workTypes.id],
  }),
}));

export const productionRequestsRelations = relations(
  productionRequests,
  ({ one, many }) => ({
    job: one(jobs, {
      fields: [productionRequests.jobId],
      references: [jobs.id],
    }),
    submissions: many(factorySubmissions),
    publicLinks: many(factoryPublicLinks),
  }),
);

export const factorySubmissionsRelations = relations(
  factorySubmissions,
  ({ one }) => ({
    productionRequest: one(productionRequests, {
      fields: [factorySubmissions.productionRequestId],
      references: [productionRequests.id],
    }),
  }),
);

export const jobCostsRelations = relations(jobCosts, ({ one }) => ({
  job: one(jobs, { fields: [jobCosts.jobId], references: [jobs.id] }),
  jobItem: one(jobItems, {
    fields: [jobCosts.jobItemId],
    references: [jobItems.id],
  }),
  externalContractor: one(externalContractors, {
    fields: [jobCosts.externalContractorId],
    references: [externalContractors.id],
  }),
}));

export const customerPaymentsRelations = relations(
  customerPayments,
  ({ one }) => ({
    customer: one(customers, {
      fields: [customerPayments.customerId],
      references: [customers.id],
    }),
    job: one(jobs, { fields: [customerPayments.jobId], references: [jobs.id] }),
    receivedBy: one(users, {
      fields: [customerPayments.receivedByUserId],
      references: [users.id],
    }),
  }),
);

export const cashAccountsRelations = relations(cashAccounts, ({ one, many }) => ({
  owner: one(users, {
    fields: [cashAccounts.ownerUserId],
    references: [users.id],
  }),
  transactions: many(cashTransactions),
}));

export const cashTransactionsRelations = relations(
  cashTransactions,
  ({ one }) => ({
    account: one(cashAccounts, {
      fields: [cashTransactions.cashAccountId],
      references: [cashAccounts.id],
    }),
  }),
);

export const cashTransfersRelations = relations(cashTransfers, ({ one }) => ({
  from: one(cashAccounts, {
    fields: [cashTransfers.fromCashAccountId],
    references: [cashAccounts.id],
  }),
  to: one(cashAccounts, {
    fields: [cashTransfers.toCashAccountId],
    references: [cashAccounts.id],
  }),
}));

export const technicianLedgerEntriesRelations = relations(
  technicianLedgerEntries,
  ({ one }) => ({
    user: one(users, {
      fields: [technicianLedgerEntries.userId],
      references: [users.id],
    }),
    job: one(jobs, {
      fields: [technicianLedgerEntries.relatedJobId],
      references: [jobs.id],
    }),
    compensationRule: one(compensationRules, {
      fields: [technicianLedgerEntries.compensationRuleId],
      references: [compensationRules.id],
    }),
  }),
);

export const commissionsRelations = relations(commissions, ({ one }) => ({
  job: one(jobs, { fields: [commissions.jobId], references: [jobs.id] }),
  closedBy: one(users, {
    fields: [commissions.closedByUserId],
    references: [users.id],
  }),
  ledgerEntry: one(technicianLedgerEntries, {
    fields: [commissions.ledgerEntryId],
    references: [technicianLedgerEntries.id],
  }),
}));

export const vehiclesRelations = relations(vehicles, ({ one, many }) => ({
  defaultResponsible: one(users, {
    fields: [vehicles.defaultResponsibleUserId],
    references: [users.id],
  }),
  responsibilityHistory: many(vehicleResponsibilityHistory),
  fuelLogs: many(fuelLogs),
}));

export const fuelLogsRelations = relations(fuelLogs, ({ one }) => ({
  vehicle: one(vehicles, {
    fields: [fuelLogs.vehicleId],
    references: [vehicles.id],
  }),
  addedBy: one(users, {
    fields: [fuelLogs.addedByUserId],
    references: [users.id],
  }),
}));

export const repairsRelations = relations(repairs, ({ one }) => ({
  job: one(jobs, { fields: [repairs.jobId], references: [jobs.id] }),
  responsible: one(users, {
    fields: [repairs.responsibleUserId],
    references: [users.id],
  }),
}));

export const approvalRequestsRelations = relations(
  approvalRequests,
  ({ one }) => ({
    requestedBy: one(users, {
      fields: [approvalRequests.requestedByUserId],
      references: [users.id],
    }),
    decidedBy: one(users, {
      fields: [approvalRequests.decidedByUserId],
      references: [users.id],
    }),
    job: one(jobs, {
      fields: [approvalRequests.relatedJobId],
      references: [jobs.id],
    }),
  }),
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));
