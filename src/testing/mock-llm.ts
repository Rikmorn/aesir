/**
 * Mock LLM for Testing
 *
 * Provides a deterministic mock LLM that can simulate various scenarios
 * for integration testing without requiring real API calls.
 *
 * Design decisions:
 * - Extends BaseChatModel for proper LangChain integration
 * - Configurable responses for different test scenarios
 * - Loop mode for testing recursion/iteration limits
 * - Delay mode for testing timeouts
 * - Tracks call count for verification
 */

import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";

/**
 * Options for configuring the mock LLM behavior
 */
export interface MockLLMOptions {
  /** Predetermined responses to return in sequence */
  responses?: string[];
  /** If true, always return tool calls to simulate infinite loop */
  shouldLoop?: boolean;
  /** Delay in ms before responding (for timeout testing) */
  delayMs?: number;
  /** Error to throw on invocation */
  errorToThrow?: Error;
}

/**
 * Mock LLM for deterministic testing
 *
 * This mock can simulate various scenarios:
 * - Normal completion: Returns predetermined responses
 * - Infinite loop: Always returns tool calls
 * - Slow response: Adds configurable delay
 * - Errors: Throws specified error
 */
export class MockChatModel extends BaseChatModel {
  private responses: string[];
  private callCount = 0;
  private shouldLoop: boolean;
  private delayMs: number;
  private errorToThrow: Error | null;

  constructor(options: MockLLMOptions = {}) {
    super({});
    this.responses = options.responses ?? [
      "I'll help you generate some code. Here's a simple implementation.",
    ];
    this.shouldLoop = options.shouldLoop ?? false;
    this.delayMs = options.delayMs ?? 0;
    this.errorToThrow = options.errorToThrow ?? null;
  }

  _llmType(): string {
    return "mock";
  }

  async _generate(
    _messages: BaseMessage[],
    _options?: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    // Apply delay if configured (for timeout testing)
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    // Throw error if configured
    if (this.errorToThrow) {
      throw this.errorToThrow;
    }

    this.callCount++;

    // If shouldLoop, always return a tool call to simulate infinite loop
    if (this.shouldLoop) {
      return {
        generations: [
          {
            text: "",
            message: new AIMessage({
              content: "",
              tool_calls: [
                {
                  name: "generate_code",
                  args: {
                    taskDescription: `Loop iteration ${this.callCount}`,
                    language: "typescript",
                  },
                  id: `call_${this.callCount}`,
                },
              ],
            }),
          },
        ],
      };
    }

    // Return predetermined response (cycles through if more calls than responses)
    const responseIndex = Math.min(
      this.callCount - 1,
      this.responses.length - 1
    );
    const response = this.responses[responseIndex] ?? "Done.";
    return {
      generations: [
        {
          text: response,
          message: new AIMessage({
            content: response,
          }),
        },
      ],
    };
  }

  /**
   * Get the number of times the LLM was called
   */
  getCallCount(): number {
    return this.callCount;
  }

  /**
   * Reset the call count for reuse in multiple tests
   */
  reset(): void {
    this.callCount = 0;
  }
}

/**
 * Create a mock LLM that returns a simple completion
 */
export function createCompletionMock(response: string = "Done."): MockChatModel {
  return new MockChatModel({ responses: [response] });
}

/**
 * Create a mock LLM that simulates infinite tool call loops
 * Useful for testing recursion and iteration limits
 */
export function createLoopingMock(): MockChatModel {
  return new MockChatModel({ shouldLoop: true });
}

/**
 * Create a mock LLM with configurable delay
 * Useful for testing timeouts
 */
export function createSlowMock(delayMs: number): MockChatModel {
  return new MockChatModel({ delayMs, responses: ["Slow response complete."] });
}

/**
 * Create a mock LLM that throws an error
 * Useful for testing error handling
 */
export function createErrorMock(error: Error): MockChatModel {
  return new MockChatModel({ errorToThrow: error });
}
