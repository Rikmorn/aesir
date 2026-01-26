/**
 * Product Agent API Routes
 *
 * Express router for product-agent HTTP endpoints:
 * - GET /health - Health check
 * - POST /events - Receive normalized events from dispatcher
 */

import type { Request, Response, Router } from "express";
import type { createProductAgentEventsHandler } from "./events.js";

/**
 * Configure product-agent routes on an Express router
 *
 * @param router - Express router to configure
 * @param eventsHandler - Handler for /events endpoint
 * @returns Configured router
 */
export function configureProductAgentRoutes(
  router: Router,
  eventsHandler: ReturnType<typeof createProductAgentEventsHandler>,
): Router {
  /**
   * Health check endpoint
   * Returns service status for Docker health checks
   */
  router.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "ok",
      service: "product-agent",
    });
  });

  /**
   * Events endpoint
   * Receives normalized events from Slack integration dispatcher
   */
  router.post("/events", async (req: Request, res: Response) => {
    // Adapt Express req/res to handler interface
    const handlerReq = {
      headers: req.headers as Record<string, string | undefined>,
      rawBody:
        typeof req.body === "string" ? req.body : JSON.stringify(req.body),
    };

    const handlerRes = {
      status: (code: number) => ({
        json: (body: unknown) => {
          res.status(code).json(body);
        },
      }),
    };

    await eventsHandler(handlerReq, handlerRes);
  });

  return router;
}
