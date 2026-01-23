/**
 * MSW handlers for Slack Web API
 *
 * Mocks Slack's Web API endpoints for testing integration code
 * without hitting the real API.
 */
import { HttpResponse, http } from "msw";

/** Slack Web API base URL */
const SLACK_API = "https://slack.com/api";

/**
 * Mock channel data
 */
const mockChannel = {
  id: "C1234567890",
  name: "general",
  is_channel: true,
  is_group: false,
  is_im: false,
  is_private: false,
  is_archived: false,
  created: 1609459200,
  creator: "U1234567890",
  name_normalized: "general",
  num_members: 10,
  topic: {
    value: "General discussion",
    creator: "U1234567890",
    last_set: 1609459200,
  },
  purpose: {
    value: "General team communication",
    creator: "U1234567890",
    last_set: 1609459200,
  },
};

/**
 * Mock message data
 */
const mockMessage = {
  type: "message",
  user: "U1234567890",
  text: "Hello, world!",
  ts: "1609459200.000100",
  team: "T1234567890",
  thread_ts: undefined,
};

/**
 * Mock user data
 */
const mockUser = {
  id: "U1234567890",
  team_id: "T1234567890",
  name: "testuser",
  real_name: "Test User",
  profile: {
    email: "test@example.com",
    display_name: "Test User",
    image_48: "https://example.com/avatar.png",
  },
  is_admin: false,
  is_owner: false,
  is_bot: false,
};

/**
 * Mock bot info
 */
const mockBotInfo = {
  id: "B1234567890",
  name: "test-bot",
  app_id: "A1234567890",
  user_id: "U_BOT_001",
};

/**
 * Mock auth.test response
 */
const mockAuthTest = {
  ok: true,
  url: "https://testworkspace.slack.com/",
  team: "Test Workspace",
  user: "testbot",
  team_id: "T1234567890",
  user_id: "U_BOT_001",
  bot_id: "B1234567890",
  is_enterprise_install: false,
};

/**
 * Default MSW handlers for Slack Web API
 *
 * Usage:
 * ```ts
 * import { slackHandlers } from "@aesir/test-utils";
 * import { setupServer } from "msw/node";
 *
 * const server = setupServer(...slackHandlers);
 * ```
 */
export const slackHandlers = [
  // Auth endpoints
  http.post(`${SLACK_API}/auth.test`, () => {
    return HttpResponse.json(mockAuthTest);
  }),

  // Chat endpoints
  http.post(`${SLACK_API}/chat.postMessage`, async ({ request }) => {
    const formData = await request.formData().catch(() => null);
    const jsonData = formData
      ? null
      : ((await request.json().catch(() => ({}))) as Record<string, unknown>);

    const channel =
      formData?.get("channel") || jsonData?.channel || mockChannel.id;
    const text = formData?.get("text") || jsonData?.text || "";
    const threadTs = formData?.get("thread_ts") || jsonData?.thread_ts;

    return HttpResponse.json({
      ok: true,
      channel: channel,
      ts: `${Date.now() / 1000}.000100`,
      message: {
        ...mockMessage,
        text: text,
        thread_ts: threadTs,
      },
    });
  }),

  http.post(`${SLACK_API}/chat.update`, async ({ request }) => {
    const formData = await request.formData().catch(() => null);
    const jsonData = formData
      ? null
      : ((await request.json().catch(() => ({}))) as Record<string, unknown>);

    const channel =
      formData?.get("channel") || jsonData?.channel || mockChannel.id;
    const ts = formData?.get("ts") || jsonData?.ts || mockMessage.ts;
    const text = formData?.get("text") || jsonData?.text || "";

    return HttpResponse.json({
      ok: true,
      channel: channel,
      ts: ts,
      text: text,
    });
  }),

  http.post(`${SLACK_API}/chat.delete`, async ({ request }) => {
    const formData = await request.formData().catch(() => null);
    const jsonData = formData
      ? null
      : ((await request.json().catch(() => ({}))) as Record<string, unknown>);

    const channel =
      formData?.get("channel") || jsonData?.channel || mockChannel.id;
    const ts = formData?.get("ts") || jsonData?.ts || mockMessage.ts;

    return HttpResponse.json({
      ok: true,
      channel: channel,
      ts: ts,
    });
  }),

  // Conversations endpoints
  http.post(`${SLACK_API}/conversations.list`, () => {
    return HttpResponse.json({
      ok: true,
      channels: [mockChannel],
      response_metadata: {
        next_cursor: "",
      },
    });
  }),

  http.post(`${SLACK_API}/conversations.history`, async ({ request }) => {
    const formData = await request.formData().catch(() => null);
    const jsonData = formData
      ? null
      : ((await request.json().catch(() => ({}))) as Record<string, unknown>);

    const channel = formData?.get("channel") || jsonData?.channel;

    return HttpResponse.json({
      ok: true,
      messages: [mockMessage],
      has_more: false,
      response_metadata: {
        next_cursor: "",
      },
      channel_id: channel || mockChannel.id,
    });
  }),

  http.post(`${SLACK_API}/conversations.info`, async ({ request }) => {
    const formData = await request.formData().catch(() => null);
    const jsonData = formData
      ? null
      : ((await request.json().catch(() => ({}))) as Record<string, unknown>);

    const channel = formData?.get("channel") || jsonData?.channel;

    return HttpResponse.json({
      ok: true,
      channel: {
        ...mockChannel,
        id: channel || mockChannel.id,
      },
    });
  }),

  http.post(`${SLACK_API}/conversations.replies`, async ({ request }) => {
    const formData = await request.formData().catch(() => null);
    const jsonData = formData
      ? null
      : ((await request.json().catch(() => ({}))) as Record<string, unknown>);

    const threadTs = formData?.get("ts") || jsonData?.ts || mockMessage.ts;

    return HttpResponse.json({
      ok: true,
      messages: [
        { ...mockMessage, thread_ts: threadTs, ts: threadTs },
        {
          ...mockMessage,
          thread_ts: threadTs,
          ts: `${Number.parseFloat(threadTs as string) + 1}.000100`,
        },
      ],
      has_more: false,
    });
  }),

  // Users endpoints
  http.post(`${SLACK_API}/users.info`, async ({ request }) => {
    const formData = await request.formData().catch(() => null);
    const jsonData = formData
      ? null
      : ((await request.json().catch(() => ({}))) as Record<string, unknown>);

    const user = formData?.get("user") || jsonData?.user;

    return HttpResponse.json({
      ok: true,
      user: {
        ...mockUser,
        id: user || mockUser.id,
      },
    });
  }),

  http.post(`${SLACK_API}/users.list`, () => {
    return HttpResponse.json({
      ok: true,
      members: [mockUser],
      response_metadata: {
        next_cursor: "",
      },
    });
  }),

  // Bots endpoints
  http.post(`${SLACK_API}/bots.info`, () => {
    return HttpResponse.json({
      ok: true,
      bot: mockBotInfo,
    });
  }),

  // Reactions endpoints
  http.post(`${SLACK_API}/reactions.add`, async ({ request }) => {
    const formData = await request.formData().catch(() => null);
    const jsonData = formData
      ? null
      : ((await request.json().catch(() => ({}))) as Record<string, unknown>);

    const channel = formData?.get("channel") || jsonData?.channel;
    const timestamp = formData?.get("timestamp") || jsonData?.timestamp;
    const name = formData?.get("name") || jsonData?.name;

    return HttpResponse.json({
      ok: true,
      channel: channel || mockChannel.id,
      timestamp: timestamp || mockMessage.ts,
      reaction: name || "thumbsup",
    });
  }),

  // Files endpoints
  http.post(`${SLACK_API}/files.upload`, () => {
    return HttpResponse.json({
      ok: true,
      file: {
        id: "F1234567890",
        name: "test-file.txt",
        title: "Test File",
        mimetype: "text/plain",
        filetype: "text",
        size: 100,
      },
    });
  }),
];

/**
 * Mock data exports for test assertions
 */
export const slackMockData = {
  channel: mockChannel,
  message: mockMessage,
  user: mockUser,
  botInfo: mockBotInfo,
  authTest: mockAuthTest,
};
