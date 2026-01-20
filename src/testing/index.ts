/**
 * Testing Utilities Module
 *
 * Provides utilities for testing agents without real API calls:
 * - MockChatModel: Deterministic LLM for integration testing
 * - Log capture: Utilities for verifying logging behavior
 */

export {
  type CapturedLog,
  createLogCapture,
  LogCapture,
} from "./log-capture.js";
export {
  createCompletionMock,
  createErrorMock,
  createLoopingMock,
  createSlowMock,
  MockChatModel,
  type MockLLMOptions,
} from "./mock-llm.js";
