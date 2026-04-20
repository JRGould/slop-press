import type { ChatMessage } from "./llm.js";
import type { IncomingRequest } from "./events.js";
import { readSessionsJson, readStateMd } from "./state.js";
import { listCachedImages } from "./images.js";


export async function buildUserMessage(
  request: IncomingRequest,
): Promise<ChatMessage> {
  const [stateMd, sessionsJson, cachedImages] = await Promise.all([
    readStateMd(),
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
    "## state.md",
    "```markdown",
    stateMd,
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
