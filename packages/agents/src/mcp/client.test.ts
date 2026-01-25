/**
 * Tests for MCP Client
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Use vi.hoisted to create the mock in a way that can be accessed by vi.mock
const { mockFetch } = vi.hoisted(() => {
	return {
		mockFetch: vi.fn(),
	};
});

// Mock fetch-retry-ts module
vi.mock("fetch-retry-ts", () => ({
	fetchBuilder: () => mockFetch,
}));

// Now import the module which will use the mocked fetchBuilder
import { McpError, callMcpTool } from "./index.js";

describe("callMcpTool", () => {
	beforeEach(() => {
		mockFetch.mockClear();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("should make POST request to correct URL", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ data: { id: "123" } }),
		} as Response);

		await callMcpTool({
			integration: "linear",
			tool: "get_issue",
			params: { issueId: "ABC-123" },
			agentId: "dev-agent",
			correlationId: "corr-123",
		});

		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining("/mcp/tools/get_issue"),
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					"Content-Type": "application/json",
					"X-Agent-ID": "dev-agent",
					"X-Correlation-ID": "corr-123",
				}),
			}),
		);
	});

	it("should return data from successful response", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ data: { title: "Test Issue" } }),
		} as Response);

		const result = await callMcpTool<{ title: string }>({
			integration: "linear",
			tool: "get_issue",
			params: { issueId: "ABC-123" },
			agentId: "dev-agent",
			correlationId: "corr-123",
		});

		expect(result).toEqual({ title: "Test Issue" });
	});

	it("should throw McpError on non-ok response", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 404,
			json: async () => ({
				error: "Issue not found",
				isError: true,
				meta: { correlation_id: "corr-123" },
			}),
		} as unknown as Response);

		await expect(
			callMcpTool({
				integration: "linear",
				tool: "get_issue",
				params: { issueId: "INVALID" },
				agentId: "dev-agent",
				correlationId: "corr-123",
			}),
		).rejects.toThrow(McpError);
	});

	it("should use correct URL for each integration", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => ({ data: {} }),
		} as Response);

		await callMcpTool({
			integration: "github",
			tool: "create_branch",
			params: {},
			agentId: "dev-agent",
			correlationId: "corr-123",
		});

		// Verify GitHub URL (not Linear)
		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining("github"),
			expect.any(Object),
		);
	});

	it("should use correct URL for Slack integration", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => ({ data: {} }),
		} as Response);

		await callMcpTool({
			integration: "slack",
			tool: "send_message",
			params: { channel: "C123", text: "Hello" },
			agentId: "dev-agent",
			correlationId: "corr-123",
		});

		// Verify Slack URL
		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining("slack"),
			expect.any(Object),
		);
	});

	it("should include params in request body", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ data: {} }),
		} as Response);

		const params = { issueId: "ABC-123", statusName: "In Progress" };

		await callMcpTool({
			integration: "linear",
			tool: "update_issue_status",
			params,
			agentId: "dev-agent",
			correlationId: "corr-123",
		});

		expect(mockFetch).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				body: JSON.stringify(params),
			}),
		);
	});

	it("should handle structuredContent response", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				structuredContent: { value: "structured data" },
			}),
		} as Response);

		const result = await callMcpTool({
			integration: "linear",
			tool: "get_issue",
			params: { issueId: "ABC-123" },
			agentId: "dev-agent",
			correlationId: "corr-123",
		});

		expect(result).toEqual({ value: "structured data" });
	});

	it("should handle response without data field", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				content: [{ type: "text", text: "success" }],
			}),
		} as Response);

		const result = await callMcpTool({
			integration: "linear",
			tool: "get_issue",
			params: { issueId: "ABC-123" },
			agentId: "dev-agent",
			correlationId: "corr-123",
		});

		// Should return the whole response when data and structuredContent are missing
		expect(result).toEqual({
			content: [{ type: "text", text: "success" }],
		});
	});
});
