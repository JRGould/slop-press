import type { ChatMessage } from "./llm.js";
import type { IncomingRequest } from "./events.js";
import { readSessionsJson } from "./state.js";
import { readSiteMd, readManifest } from "./content.js";
import { listCachedImages } from "./images.js";


export async function buildUserMessage(
  request: IncomingRequest,
): Promise<ChatMessage> {
  const [siteMd, manifest, sessionsJson, cachedImages] = await Promise.all([
    readSiteMd(),
    readManifest(),
    readSessionsJson(),
    listCachedImages(),
  ]);

  const headerLines = Object.entries(request.headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const bodySection = request.body ? `\n\n${request.body}` : "";

  const imagesSection =
    cachedImages.length === 0
      ? "(none)"
      : cachedImages
          .map(
            img =>
              `- ${img.cacheKey}  →  ${img.url}  (${Math.round(img.sizeBytes / 1024)} KB)`,
          )
          .join("\n");

  const content = [
    "## Incoming request",
    "```http",
    `${request.method} ${request.url} HTTP/1.1`,
    headerLines,
    bodySection,
    "```",
    "",
    "## site.md (site config + users — always full contents)",
    "```markdown",
    siteMd,
    "```",
    "",
    "## Content manifest (titles, slugs, excerpts — call read_pages / read_posts for full bodies)",
    "```json",
    JSON.stringify(manifest, null, 2),
    "```",
    "",
    "## sessions.json",
    "```json",
    sessionsJson,
    "```",
    "",
    "## Cached images",
    imagesSection,
  ].join("\n");

  return { role: "user", content };
}
