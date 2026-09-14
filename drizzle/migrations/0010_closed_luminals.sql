CREATE TABLE "scheduled_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger_type" text NOT NULL,
	"related_entity_id" uuid NOT NULL,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_reminders_trigger_entity_idx" ON "scheduled_reminders" USING btree ("trigger_type","related_entity_id");