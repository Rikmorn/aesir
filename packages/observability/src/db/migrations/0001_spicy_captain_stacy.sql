CREATE TABLE "observability"."agent_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"agent_type" text NOT NULL,
	"issue_id" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_ms" integer,
	"last_known_state" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_executions_status_started_idx" ON "observability"."agent_executions" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "agent_executions_workspace_idx" ON "observability"."agent_executions" USING btree ("workspace_id");