CREATE TABLE "ban" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"display_name" text,
	"message" text NOT NULL,
	"room_url" text NOT NULL,
	"issued_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ban_identifier_idx" ON "ban" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "ban_created_at_idx" ON "ban" USING btree ("created_at");