/**
 * Product Agent API Module
 *
 * Exports API handlers and route configuration for product-agent HTTP service.
 */

export {
  createProductAgentEventsHandler,
  type EventsRequest,
  type EventsResponse,
  type ProductAgentEventsHandlerDeps,
} from "./events.js";

export { configureProductAgentRoutes } from "./routes.js";
