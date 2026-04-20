import type { ToolSchema } from "./llm.js";
import type { RenderResponse, SseEvent } from "./events.js";
import {
  readStateMd,
  readSessionsJson,
  writeStateMd,
  writeSessionsJson,
} from "./state.js";
import { generateImage, bustImageCache } from "./images.js";

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "render_response",
      description:
        "Terminate the request by sending an HTTP response back to the browser. " +
        "Body is the full response body (HTML, CSS, JSON, etc). " +
        "Headers should include Content-Type. " +
        "For redirects, use status 302/303 with a Location header. " +
        "Use set_cookies to set auth cookies on login.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["status", "body"],
        properties: {
          status: {
            type: "integer",
            description: "HTTP status code (e.g. 200, 302, 404).",
          },
          headers: {
            type: "object",
            description:
              "Response headers as key/value pairs. Include Content-Type.",
            additionalProperties: { type: "string" },
          },
          body: {
            type: "string",
            description: "Full response body.",
          },
          set_cookies: {
            type: "array",
            items: { type: "string" },
            description:
              "Raw Set-Cookie header values (one per cookie). Example: " +
              "'sloppress_session=abc123; Path=/; HttpOnly; SameSite=Lax'.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_state",
      description:
        "Overwrite state.md with new contents. Use for admin edits (adding/editing pages, posts, users, site config). " +
        "You must supply the entire new file.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["contents"],
        properties: {
          contents: {
            type: "string",
            description: "Full new contents of state.md.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_sessions",
      description:
        "Overwrite sessions.json with new contents. Use on login, logout, or to expire sessions. " +
        "Must be valid JSON with shape { sessions: [...] }.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["contents"],
        properties: {
          contents: {
            type: "string",
            description: "Full new contents of sessions.json (stringified JSON).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_image",
      description:
        "Generate an image and cache it to disk. Returns a URL you can use in an <img> tag. " +
        "If an image with this cache_key already exists on disk, the cached version is returned instantly at no cost. " +
        "The URL format is always /__images/<cache_key>.png — you can embed this URL in your HTML before calling this tool " +
        "and they will both be processed in the same turn. " +
        "Choose stable, descriptive cache_keys for site-wide images (e.g. 'site-hero', 'author-avatar') " +
        "so they persist across requests. Use post-slug-based keys for per-post images (e.g. 'post-on-sandwiches-thumb').",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["cache_key", "prompt"],
        properties: {
          cache_key: {
            type: "string",
            description:
              "Slug-like identifier for this image, e.g. 'site-hero', 'author-avatar', 'post-dvorak-thumb'. " +
              "Only alphanumeric, hyphens, and underscores. Used as the filename (appended with .png).",
          },
          prompt: {
            type: "string",
            description:
              "Text prompt describing the image to generate. Ignored if the cache_key already has a cached file.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bust_image_cache",
      description:
        "Delete a cached image so it will be regenerated on the next generate_image call. " +
        "Used from the admin images panel to replace stale or unwanted images.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["cache_key"],
        properties: {
          cache_key: {
            type: "string",
            description: "The cache_key of the image to delete.",
          },
        },
      },
    },
  },
];

export type ExecutedTool =
  | {
      kind: "render";
      response: RenderResponse;
      toolCallId: string;
      resultJson: string;
    }
  | {
      kind: "mutation";
      toolCallId: string;
      resultJson: string;
    }
  | {
      kind: "error";
      toolCallId: string;
      resultJson: string;
    };

export async function executeTool(
  name: string,
  rawArgs: string,
  toolCallId: string,
  onEvent?: (event: SseEvent) => void,
): Promise<ExecutedTool> {
  let args: unknown;
  try {
    args = JSON.parse(rawArgs || "{}");
  } catch {
    const result = { error: "invalid JSON in tool arguments" };
    onEvent?.({
      type: "tool_result",
      id: toolCallId,
      name,
      result,
    });
    return {
      kind: "error",
      toolCallId,
      resultJson: JSON.stringify(result),
    };
  }

  if (name === "render_response") {
    const response = coerceRenderResponse(args);
    onEvent?.({
      type: "tool_result",
      id: toolCallId,
      name,
      result: { ok: true, status: response.status },
    });
    return {
      kind: "render",
      response,
      toolCallId,
      resultJson: JSON.stringify({ ok: true, status: response.status }),
    };
  }

  if (name === "write_state") {
    const contents = typeof (args as { contents?: unknown }).contents === "string"
      ? ((args as { contents: string }).contents)
      : "";
    const before = await readStateMd();
    await writeStateMd(contents);
    const diff = simpleDiff(before, contents);
    onEvent?.({ type: "state_write", file: "state.md", diff });
    const result = { ok: true, bytes: contents.length };
    onEvent?.({ type: "tool_result", id: toolCallId, name, result });
    return { kind: "mutation", toolCallId, resultJson: JSON.stringify(result) };
  }

  if (name === "write_sessions") {
    const contents = typeof (args as { contents?: unknown }).contents === "string"
      ? ((args as { contents: string }).contents)
      : "";
    try {
      JSON.parse(contents);
    } catch {
      const result = { error: "sessions.json contents must be valid JSON" };
      onEvent?.({ type: "tool_result", id: toolCallId, name, result });
      return {
        kind: "error",
        toolCallId,
        resultJson: JSON.stringify(result),
      };
    }
    const before = await readSessionsJson();
    await writeSessionsJson(contents);
    const diff = simpleDiff(before, contents);
    onEvent?.({ type: "state_write", file: "sessions.json", diff });
    const result = { ok: true, bytes: contents.length };
    onEvent?.({ type: "tool_result", id: toolCallId, name, result });
    return { kind: "mutation", toolCallId, resultJson: JSON.stringify(result) };
  }

  if (name === "generate_image") {
    const a = args as { cache_key?: unknown; prompt?: unknown };
    const cacheKey = typeof a.cache_key === "string" ? a.cache_key : "image";
    const prompt = typeof a.prompt === "string" ? a.prompt : "";
    const result = await generateImage(cacheKey, prompt);
    onEvent?.({ type: "tool_result", id: toolCallId, name, result });
    return { kind: "mutation", toolCallId, resultJson: JSON.stringify(result) };
  }

  if (name === "bust_image_cache") {
    const a = args as { cache_key?: unknown };
    const cacheKey = typeof a.cache_key === "string" ? a.cache_key : "";
    const result = await bustImageCache(cacheKey);
    onEvent?.({ type: "tool_result", id: toolCallId, name, result });
    return { kind: "mutation", toolCallId, resultJson: JSON.stringify(result) };
  }

  const result = { error: `unknown tool: ${name}` };
  onEvent?.({ type: "tool_result", id: toolCallId, name, result });
  return { kind: "error", toolCallId, resultJson: JSON.stringify(result) };
}

function coerceRenderResponse(args: unknown): RenderResponse {
  const a = (args ?? {}) as Record<string, unknown>;
  const status = typeof a.status === "number" ? a.status : 200;
  const body = typeof a.body === "string" ? a.body : "";
  const headers: Record<string, string> = {};
  if (a.headers && typeof a.headers === "object") {
    for (const [k, v] of Object.entries(a.headers as Record<string, unknown>)) {
      if (typeof v === "string") headers[k] = v;
    }
  }
  const set_cookies: string[] = [];
  if (Array.isArray(a.set_cookies)) {
    for (const c of a.set_cookies) {
      if (typeof c === "string") set_cookies.push(c);
    }
  }
  if (!headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "text/html; charset=utf-8";
  }
  return { status, headers, body, set_cookies };
}

function simpleDiff(before: string, after: string): string {
  if (before === after) return "(no changes)";
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const max = Math.max(beforeLines.length, afterLines.length);
  const out: string[] = [];
  for (let i = 0; i < max; i++) {
    const b = beforeLines[i];
    const a = afterLines[i];
    if (b === a) continue;
    if (b !== undefined) out.push(`- ${b}`);
    if (a !== undefined) out.push(`+ ${a}`);
  }
  return out.join("\n");
}
