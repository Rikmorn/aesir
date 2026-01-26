CREATE SCHEMA IF NOT EXISTS "github";
--> statement-breakpoint
CREATE TABLE "github"."credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"installation_id" text,
	"encrypted_access_token" text NOT NULL,
	"encrypted_refresh_token" text,
	"token_type" text DEFAULT 'Bearer',
	"scope" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "credentials_owner_unique" UNIQUE("owner")
);
--> statement-breakpoint
CREATE TABLE "github"."mcp_tool_permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"allowed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github"."webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_hash" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_delivery_id_unique" UNIQUE("delivery_id"),
	CONSTRAINT "webhook_deliveries_delivery_unique" UNIQUE("delivery_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "github_mcp_perm_agent_tool_idx" ON "github"."mcp_tool_permissions" USING btree ("agent_id","tool_name");