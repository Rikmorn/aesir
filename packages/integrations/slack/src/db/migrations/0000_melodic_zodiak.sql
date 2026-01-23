CREATE SCHEMA "slack";
--> statement-breakpoint
CREATE TABLE "slack"."event_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"team_id" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_deliveries_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "slack"."installations" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"enterprise_id" text,
	"user_id" text,
	"is_enterprise_install" boolean DEFAULT false NOT NULL,
	"encrypted_bot_token" text NOT NULL,
	"encrypted_user_token" text,
	"bot_id" text,
	"bot_user_id" text,
	"bot_scopes" text,
	"app_id" text,
	"token_type" text DEFAULT 'bot' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "installations_team_enterprise_unique" UNIQUE("team_id","enterprise_id")
);
--> statement-breakpoint
CREATE TABLE "slack"."mcp_tool_permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"allowed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "event_deliveries_event_id_idx" ON "slack"."event_deliveries" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_deliveries_created_at_idx" ON "slack"."event_deliveries" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_mcp_perm_agent_tool_idx" ON "slack"."mcp_tool_permissions" USING btree ("agent_id","tool_name");