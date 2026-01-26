/**
 * Dev Agent API Routes
 */

import type { Client as TemporalClient } from "@temporalio/client";
import express from "express";
import {
  createDevAgentEventsHandler,
  type EventsRequest,
  type EventsResponse,
} from "./events.js";

export interface DevAgentRoutesOptions {
  workflowClient: TemporalClient;
  slackChannel: string;
}

export function createDevAgentRoutes(
  options: DevAgentRoutesOptions,
): express.Router {
  const router = express.Router();

  // Raw body middleware for signature verification
  router.use(express.json({ type: "*/*" }));

  // Health check
  router.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "dev-agent" });
  });

  // Events endpoint
  const eventsHandler = createDevAgentEventsHandler({
    workflowClient: options.workflowClient,
    slackChannel: options.slackChannel,
  });

  router.post("/events", async (req, res) => {
    const request: EventsRequest = {
      headers: req.headers as Record<string, string | undefined>,
      rawBody: JSON.stringify(req.body),
    };

    const response: EventsResponse = {
      status: (code: number) => ({
        json: (body: unknown) => res.status(code).json(body),
      }),
    };

    await eventsHandler(request, response);
  });

  return router;
}
