import type { ToolSchema } from "./llm.js";
import type { RenderResponse, SseEvent } from "./events.js";
import {
  readSessionsJson,
  writeSessionsJson,
} from "./state.js";
import {
  readPage,
  readPost,
  writePage,
  writePost,
  deletePage,
  deletePost,
  readSiteMd,
  writeSiteMd,
} from "./content.js";
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
      name: "read_pages",
      description:
        "Fetch the full body of one or more pages by slug. The manifest in the user message lists available slugs. " +
        "Returns { pages: [{ slug, title, body, updated_at }], missing: [slug] }. " +
        "Batch slugs into a single call when possible to save turns.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["slugs"],
        properties: {
          slugs: {
            type: "array",
            items: { type: "string" },
            description: "Page slugs to fetch, e.g. [\"/about\", \"/contact\"].",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_posts",
      description:
        "Fetch the full body of one or more posts by id. The manifest lists available post ids (e.g. \"2026-04-10-on-sandwiches\"). " +
        "Returns { posts: [{ slug, title, date, body, updated_at }], missing: [slug] }. " +
        "Batch ids into a single call when possible to save turns.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["slugs"],
        properties: {
          slugs: {
            type: "array",
            items: { type: "string" },
            description: "Post ids to fetch.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_page",
      description:
        "Create or update a single page. Overwrites any existing page with the same slug. " +
        "The manifest and the page file are both updated atomically. " +
        "Only pass the fields for THIS page — other pages are untouched.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["slug", "title", "body"],
        properties: {
          slug: {
            type: "string",
            description: "Page slug starting with /, e.g. \"/about\".",
          },
          title: { type: "string" },
          body: {
            type: "string",
            description: "Full markdown body of the page.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_post",
      description:
        "Create or update a single post. Overwrites any existing post with the same slug id. " +
        "Only pass the fields for THIS post — other posts are untouched.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["slug", "title", "date", "body"],
        properties: {
          slug: {
            type: "string",
            description:
              "Post id, typically \"YYYY-MM-DD-slugified-title\", e.g. \"2026-04-18-introducing-sloppress\".",
          },
          title: { type: "string" },
          date: {
            type: "string",
            description: "Publication date in YYYY-MM-DD.",
          },
          body: {
            type: "string",
            description: "Full markdown body of the post.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_page",
      description: "Delete a page by slug. The manifest is updated.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["slug"],
        properties: {
          slug: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_post",
      description: "Delete a post by slug id. The manifest is updated.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["slug"],
        properties: {
          slug: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_site",
      description:
        "Overwrite site.md (site config frontmatter + Users list). Use for config edits, adding/removing users, or changing the password. " +
        "You must supply the entire new file contents.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["contents"],
        properties: {
          contents: {
            type: "string",
            description: "Full new contents of site.md.",
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
      kind: "read";
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
    return emitError(toolCallId, name, "invalid JSON in tool arguments", onEvent);
  }

  if (name === "render_response") {
    const response = coerceRenderResponse(args);
    const result = { ok: true, status: response.status };
    onEvent?.({ type: "tool_result", id: toolCallId, name, result });
    return {
      kind: "render",
      response,
      toolCallId,
      resultJson: JSON.stringify(result),
    };
  }

  if (name === "read_pages") {
    const slugs = asStringArray((args as { slugs?: unknown }).slugs);
    const pages: unknown[] = [];
    const missing: string[] = [];
    for (const s of slugs) {
      const rec = await readPage(s);
      if (rec) pages.push(rec);
      else missing.push(s);
    }
    const result = { pages, missing };
    onEvent?.({ type: "tool_result", id: toolCallId, name, result });
    return { kind: "read", toolCallId, resultJson: JSON.stringify(result) };
  }

  if (name === "read_posts") {
    const slugs = asStringArray((args as { slugs?: unknown }).slugs);
    const posts: unknown[] = [];
    const missing: string[] = [];
    for (const s of slugs) {
      const rec = await readPost(s);
      if (rec) posts.push(rec);
      else missing.push(s);
    }
    const result = { posts, missing };
    onEvent?.({ type: "tool_result", id: toolCallId, name, result });
    return { kind: "read", toolCallId, resultJson: JSON.stringify(result) };
  }

  if (name === "write_page") {
    const a = args as { slug?: unknown; title?: unknown; body?: unknown };
    if (typeof a.slug !== "string" || typeof a.title !== "string" || typeof a.body !== "string") {
      return emitError(toolCallId, name, "slug, title, body (all strings) required", onEvent);
    }
    const rec = await writePage({ slug: a.slug, title: a.title, body: a.body });
    onEvent?.({ type: "state_write", file: `pages/${rec.slug}`, diff: `wrote page ${rec.slug}` });
    const result = { ok: true, slug: rec.slug, updated_at: rec.updated_at };
    onEvent?.({ type: "tool_result", id: toolCallId, name, result });
    return { kind: "mutation", toolCallId, resultJson: JSON.stringify(result) };
  }

  if (name === "write_post") {
    const a = args as {
      slug?: unknown;
      title?: unknown;
      date?: unknown;
      body?: unknown;
    };
    if (
      typeof a.slug !== "string" ||
      typeof a.title !== "string" ||
      typeof a.date !== "string" ||
      typeof a.body !== "string"
    ) {
      return emitError(
        toolCallId,
        name,
        "slug, title, date, body (all strings) required",
        onEvent,
      );
    }
    const rec = await writePost({
      slug: a.slug,
      title: a.title,
      date: a.date,
      body: a.body,
    });
    onEvent?.({ type: "state_write", file: `posts/${rec.slug}`, diff: `wrote post ${rec.slug}` });
    const result = { ok: true, slug: rec.slug, updated_at: rec.updated_at };
    onEvent?.({ type: "tool_result", id: toolCallId, name, result });
    return { kind: "mutation", toolCallId, resultJson: JSON.stringify(result) };
  }

  if (name === "delete_page") {
    const slug = (args as { slug?: unknown }).slug;
    if (typeof slug !== "string") {
      return emitError(toolCallId, name, "slug (string) required", onEvent);
    }
    const ok = await deletePage(slug);
    onEvent?.({
      type: "state_write",
      file: `pages/${slug}`,
      diff: ok ? `deleted page ${slug}` : `page ${slug} not found`,
    });
    const result = { ok, slug };
    onEvent?.({ type: "tool_result", id: toolCallId, name, result });
    return { kind: "mutation", toolCallId, resultJson: JSON.stringify(result) };
  }

  if (name === "delete_post") {
    const slug = (args as { slug?: unknown }).slug;
    if (typeof slug !== "string") {
      return emitError(toolCallId, name, "slug (string) required", onEvent);
    }
    const ok = await deletePost(slug);
    onEvent?.({
      type: "state_write",
      file: `posts/${slug}`,
      diff: ok ? `deleted post ${slug}` : `post ${slug} not found`,
    });
    const result = { ok, slug };
    onEvent?.({ type: "tool_result", id: toolCallId, name, result });
    return { kind: "mutation", toolCallId, resultJson: JSON.stringify(result) };
  }

  if (name === "write_site") {
    const contents = (args as { contents?: unknown }).contents;
    if (typeof contents !== "string") {
      return emitError(toolCallId, name, "contents (string) required", onEvent);
    }
    const before = await readSiteMd();
    await writeSiteMd(contents);
    onEvent?.({ type: "state_write", file: "site.md", diff: simpleDiff(before, contents) });
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
      return emitError(toolCallId, name, "sessions.json contents must be valid JSON", onEvent);
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

  return emitError(toolCallId, name, `unknown tool: ${name}`, onEvent);
}

function emitError(
  toolCallId: string,
  name: string,
  message: string,
  onEvent?: (event: SseEvent) => void,
): ExecutedTool {
  const result = { error: message };
  onEvent?.({ type: "tool_result", id: toolCallId, name, result });
  return { kind: "error", toolCallId, resultJson: JSON.stringify(result) };
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
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
