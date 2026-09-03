ALTER TYPE "public"."approvable_entity_type" ADD VALUE 'cash_expense_report';--> statement-breakpoint
CREATE TABLE "glass_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label_en" text NOT NULL,
	"label_ar" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "glass_types_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "measurement_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"measurement_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_expense_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cash_account_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"description" text NOT NULL,
	"reported_by_user_id" uuid NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "measurements" ADD COLUMN "glass_type_id" uuid;--> statement-breakpoint
ALTER TABLE "measurements" ADD COLUMN "field_quoted_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "measurements" ADD COLUMN "field_quoted_price_includes_vat" boolean;--> statement-breakpoint
ALTER TABLE "measurement_attachments" ADD CONSTRAINT "measurement_attachments_measurement_id_measurements_id_fk" FOREIGN KEY ("measurement_id") REFERENCES "public"."measurements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_attachments" ADD CONSTRAINT "measurement_attachments_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_expense_reports" ADD CONSTRAINT "cash_expense_reports_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_expense_reports" ADD CONSTRAINT "cash_expense_reports_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_expense_reports" ADD CONSTRAINT "cash_expense_reports_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "measurement_attachments_measurement_idx" ON "measurement_attachments" USING btree ("measurement_id");--> statement-breakpoint
CREATE INDEX "cash_expense_reports_account_idx" ON "cash_expense_reports" USING btree ("cash_account_id");--> statement-breakpoint
CREATE INDEX "cash_expense_reports_status_idx" ON "cash_expense_reports" USING btree ("status");--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_glass_type_id_glass_types_id_fk" FOREIGN KEY ("glass_type_id") REFERENCES "public"."glass_types"("id") ON DELETE set null ON UPDATE no action;