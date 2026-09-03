CREATE TYPE "public"."quote_language" AS ENUM('ar', 'he');--> statement-breakpoint
ALTER TABLE "quote_versions" ADD COLUMN "is_ai_generated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_versions" ADD COLUMN "ai_prompt_notes" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "language" "quote_language" DEFAULT 'ar' NOT NULL;