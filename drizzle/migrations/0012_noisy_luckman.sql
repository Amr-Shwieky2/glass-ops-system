ALTER TYPE "public"."ledger_entry_type" ADD VALUE 'overtime';--> statement-breakpoint
CREATE TABLE "vehicle_maintenance_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"incurred_at" date NOT NULL,
	"added_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "production_requests" ADD COLUMN "request_number" text NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicle_maintenance_costs" ADD CONSTRAINT "vehicle_maintenance_costs_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_maintenance_costs" ADD CONSTRAINT "vehicle_maintenance_costs_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicle_maintenance_costs_vehicle_idx" ON "vehicle_maintenance_costs" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "vehicle_maintenance_costs_incurred_at_idx" ON "vehicle_maintenance_costs" USING btree ("incurred_at");--> statement-breakpoint
ALTER TABLE "production_requests" ADD CONSTRAINT "production_requests_request_number_unique" UNIQUE("request_number");