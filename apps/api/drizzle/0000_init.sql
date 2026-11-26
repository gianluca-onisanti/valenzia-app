CREATE TYPE "public"."body_origin" AS ENUM('image', 'blank');--> statement-breakpoint
CREATE TYPE "public"."layer_kind" AS ENUM('terrain', 'territory', 'biome');--> statement-breakpoint
CREATE TYPE "public"."material_phase" AS ENUM('solid', 'liquid', 'gas');--> statement-breakpoint
CREATE TYPE "public"."territory_kind" AS ENUM('country', 'sea', 'zone');--> statement-breakpoint
CREATE TABLE "biome_areas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"body_id" uuid NOT NULL,
	"slot" integer NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"descricao" text,
	CONSTRAINT "biome_areas_body_slot" UNIQUE("body_id","slot")
);
--> statement-breakpoint
CREATE TABLE "bodies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"parent_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"radius_km" double precision NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"origin" "body_origin" NOT NULL,
	"thumbnail" "bytea",
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "layers" (
	"body_id" uuid NOT NULL,
	"kind" "layer_kind" NOT NULL,
	"png" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "layers_body_id_kind_pk" PRIMARY KEY("body_id","kind")
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"body_id" uuid NOT NULL,
	"code" smallint NOT NULL,
	"name" text NOT NULL,
	"phase" "material_phase" NOT NULL,
	"color" text NOT NULL,
	"texture" jsonb,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "materials_body_code" UNIQUE("body_id","code")
);
--> statement-breakpoint
CREATE TABLE "pois" (
	"id" uuid PRIMARY KEY NOT NULL,
	"body_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"descricao" text
);
--> statement-breakpoint
CREATE TABLE "territories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"body_id" uuid NOT NULL,
	"slot" integer NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" "territory_kind" NOT NULL,
	"color" text NOT NULL,
	"governo" text,
	"populacao" text,
	"descricao" text,
	"label_x" real,
	"label_y" real,
	CONSTRAINT "territories_body_slot" UNIQUE("body_id","slot")
);
--> statement-breakpoint
ALTER TABLE "biome_areas" ADD CONSTRAINT "biome_areas_body_id_bodies_id_fk" FOREIGN KEY ("body_id") REFERENCES "public"."bodies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bodies" ADD CONSTRAINT "bodies_parent_id_bodies_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."bodies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layers" ADD CONSTRAINT "layers_body_id_bodies_id_fk" FOREIGN KEY ("body_id") REFERENCES "public"."bodies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_body_id_bodies_id_fk" FOREIGN KEY ("body_id") REFERENCES "public"."bodies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pois" ADD CONSTRAINT "pois_body_id_bodies_id_fk" FOREIGN KEY ("body_id") REFERENCES "public"."bodies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territories" ADD CONSTRAINT "territories_body_id_bodies_id_fk" FOREIGN KEY ("body_id") REFERENCES "public"."bodies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bodies_parent_idx" ON "bodies" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "bodies_owner_idx" ON "bodies" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "pois_body_idx" ON "pois" USING btree ("body_id");