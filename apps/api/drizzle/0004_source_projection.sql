CREATE TYPE "public"."source_projection" AS ENUM('equirect', 'mercator');--> statement-breakpoint
ALTER TABLE "bodies" ADD COLUMN "source_projection" "source_projection" DEFAULT 'equirect' NOT NULL;