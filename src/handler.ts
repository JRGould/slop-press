import type { IncomingRequest, RenderResponse, SseEvent } from "./events.js";
import { callLLM, pickModel, type ChatMessage } from "./llm.js";
import { buildUserMessage } from "./prompt.js";
import { TOOL_SCHEMAS, executeTool } from "./tools.js";
import { readSessionsJson, readSystemPrompt } from "./state.js";

const MAX_TURNS = 6;

export async function handleRequest(
  request: IncomingRequest,
  onEvent?: (event: SseEvent) => void,
): Promise<RenderResponse> {
  onEvent?.({ type: "request", request });

  const [isAdmin, systemPrompt, userMessage] = await Promise.all([
    detectAdmin(request),
    readSystemPrompt(),
    buildUserMessage(request),
  ]);
  const model = pickModel({ isAdmin });

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    userMessage,
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const { assistantMessage, toolCalls, finishReason } = await callLLM({
      model,
      messages,
      tools: TOOL_SCHEMAS,
      onEvent,
    });

    messages.push(assistantMessage);

    if (toolCalls.length === 0) {
      // Model stopped without calling any tool. Emit an error render.
      const body = `<!doctype html><meta charset="utf-8"><title>SlopPress error</title><pre>${escapeHtml(
        (typeof assistantMessage.content === "string"
          ? assistantMessage.content
          : "") || `LLM ended turn with finish_reason=${finishReason} and no tool calls.`,
      )}</pre>`;
      const fallback: RenderResponse = {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body,
      };
      onEvent?.({ type: "render", response: fallback });
      return fallback;
    }

    let finalRender: RenderResponse | null = null;
    for (const tc of toolCalls) {
      const executed = await executeTool(tc.name, tc.arguments, tc.id, onEvent);
      messages.push({
        role: "tool",
        tool_call_id: executed.toolCallId,
        content: executed.resultJson,
      });
      if (executed.kind === "render") {
        finalRender = executed.response;
      }
    }

    if (finalRender) {
      const patched = fixupRedirect(finalRender, request);
      onEvent?.({ type: "render", response: patched });
      return patched;
    }
  }

  const err: RenderResponse = {
    status: 500,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: `<!doctype html><meta charset="utf-8"><title>SlopPress error</title><p>LLM exceeded ${MAX_TURNS} turns without calling render_response.</p>`,
  };
  onEvent?.({ type: "render", response: err });
  return err;
}

async function detectAdmin(request: IncomingRequest): Promise<boolean> {
  if (request.method !== "GET") return true;
  if (request.url.startsWith("/admin")) return true;
  const cookie = request.headers["cookie"] ?? request.headers["Cookie"];
  if (!cookie) return false;
  const match = /sloppress_session=([^;]+)/.exec(cookie);
  if (!match) return false;
  const token = match[1];
  try {
    const sessions = JSON.parse(await readSessionsJson()) as {
      sessions?: Array<{ token: string; expires?: string | number }>;
    };
    const now = Date.now();
    return Boolean(
      sessions.sessions?.some((s) => {
        if (s.token !== token) return false;
        if (s.expires === undefined || s.expires === null || s.expires === "") {
          return true;
        }
        // Accept either ISO 8601 strings or ms-since-epoch numbers.
        const exp =
          typeof s.expires === "number"
            ? s.expires
            : /^\d+$/.test(s.expires)
              ? Number.parseInt(s.expires, 10)
              : Date.parse(s.expires);
        return Number.isNaN(exp) ? true : exp > now;
      }),
    );
  } catch {
    return false;
  }
}

function fixupRedirect(
  response: RenderResponse,
  request: IncomingRequest,
): RenderResponse {
  if (response.status < 300 || response.status >= 400) return response;
  const headers = { ...(response.headers ?? {}) };
  const hasLocation = Object.keys(headers).some(
    (k) => k.toLowerCase() === "location",
  );
  if (hasLocation) return response;

  // Infer a sensible Location from request + cookie state.
  const sets = response.set_cookies ?? [];
  const settingSession = sets.some((c) =>
    /^sloppress_session=[^;\s]+/.test(c) && !/Max-Age=0/i.test(c),
  );
  const clearingSession = sets.some(
    (c) => /^sloppress_session=/.test(c) && /Max-Age=0/i.test(c),
  );

  let loc = "/";
  const url = request.url;
  if (settingSession) {
    loc = "/admin";
  } else if (clearingSession) {
    loc = "/";
  } else if (url.startsWith("/admin/pages")) {
    loc = "/admin/pages";
  } else if (url.startsWith("/admin/posts")) {
    loc = "/admin/posts";
  } else if (url.startsWith("/admin/users")) {
    loc = "/admin/users";
  } else if (url.startsWith("/admin/images")) {
    loc = "/admin/images";
  } else if (url.startsWith("/admin")) {
    loc = "/admin";
  } else if (url === "/login") {
    loc = "/login";
  }

  headers["Location"] = loc;
  return { ...response, headers };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
