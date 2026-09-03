ALTER TYPE "public"."appointment_status" ADD VALUE 'arrived' BEFORE 'completed';--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "arrived_at" timestamp with time zone;