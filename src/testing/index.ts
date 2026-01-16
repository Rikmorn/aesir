/**
 * Testing Utilities Module
 *
 * Provides utilities for testing agents without real API calls:
 * - MockChatModel: Deterministic LLM for integration testing
 * - Log capture: Utilities for verifying logging behavior
 */

export {
  MockChatModel,
  createCompletionMock,
  createLoopingMock,
  createSlowMock,
  createErrorMock,
  type MockLLMOptions,
} from "./mock-llm.js";

export {
  LogCapture,
  createLogCapture,
  type CapturedLog,
} from "./log-capture.js";
