CREATE TABLE "report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reported_identifier" text NOT NULL,
	"reporter_identifier" text NOT NULL,
	"comment" text NOT NULL,
	"room_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "report_created_at_idx" ON "report" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "report_reported_identifier_idx" ON "report" USING btree ("reported_identifier");