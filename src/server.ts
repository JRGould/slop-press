import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { streamSSE } from "hono/streaming";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { IncomingRequest } from "./events.js";
import { handleRequest } from "./handler.js";
import {
  devModeEnabled,
  renderLoaderHtml,
  runWithEvents,
  stashRequest,
} from "./dev-mode.js";

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const PUBLIC_DIR = path.resolve("public");

const app = new Hono();

let loaderTemplateCache: string | null = null;
async function getLoaderTemplate(): Promise<string> {
  if (loaderTemplateCache) return loaderTemplateCache;
  loaderTemplateCache = await readFile(
    path.join(PUBLIC_DIR, "loader.html"),
    "utf8",
  );
  return loaderTemplateCache;
}

app.get("/__slop/stream", (c) => {
  const rid = c.req.query("rid");
  if (!rid) return c.text("missing rid", 400);

  return streamSSE(c, async (stream) => {
    try {
      for await (const event of runWithEvents(rid)) {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        });
      }
    } catch (err) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        }),
      });
    }
  });
});

app.all("*", async (c) => {
  const incoming = await toIncomingRequest(c.req.raw);

  if (devModeEnabled()) {
    const template = await getLoaderTemplate();
    const rid = stashRequest(incoming);
    const html = renderLoaderHtml(template, rid);
    return c.html(html);
  }

  const response = await handleRequest(incoming);
  const headers = new Headers(response.headers ?? {});
  for (const cookie of response.set_cookies ?? []) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(response.body, {
    status: response.status,
    headers,
  });
});

async function toIncomingRequest(req: Request): Promise<IncomingRequest> {
  const url = new URL(req.url);
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    headers[k] = v;
  });
  let body: string | null = null;
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      body = await req.text();
    } catch {
      body = null;
    }
  }
  return {
    method: req.method,
    url: url.pathname + url.search,
    headers,
    body,
  };
}

serve(
  {
    fetch: app.fetch,
    port: PORT,
    hostname: HOST,
  },
  (info) => {
    const devNote = devModeEnabled() ? " (dev mode: activity panel on)" : "";
    console.log(`SlopPress listening on http://${info.address}:${info.port}${devNote}`);
  },
);
