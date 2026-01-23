CREATE SCHEMA "linear";
--> statement-breakpoint
CREATE TABLE "linear"."credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"encrypted_access_token" text NOT NULL,
	"encrypted_refresh_token" text,
	"token_type" text DEFAULT 'Bearer',
	"scope" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "credentials_workspace_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE "linear"."webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_hash" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_delivery_id_unique" UNIQUE("delivery_id"),
	CONSTRAINT "webhook_deliveries_delivery_unique" UNIQUE("delivery_id")
);
