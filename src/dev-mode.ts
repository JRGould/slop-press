import type { IncomingRequest, SseEvent } from "./events.js";
import { handleRequest } from "./handler.js";

type Pending = {
  request: IncomingRequest;
  createdAt: number;
};

const TTL_MS = 60_000;
const pending = new Map<string, Pending>();

export function devModeEnabled(): boolean {
  const v = (process.env.SLOPPRESS_DEV_MODE ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function stashRequest(request: IncomingRequest): string {
  cleanupExpired();
  const rid = cryptoRandomId();
  pending.set(rid, { request, createdAt: Date.now() });
  return rid;
}

export function takeRequest(rid: string): IncomingRequest | null {
  const p = pending.get(rid);
  if (!p) return null;
  pending.delete(rid);
  return p.request;
}

function cleanupExpired(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [rid, p] of pending) {
    if (p.createdAt < cutoff) pending.delete(rid);
  }
}

function cryptoRandomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function renderLoaderHtml(loaderTemplate: string, rid: string): string {
  return loaderTemplate.replace(/__SLOPPRESS_RID__/g, rid);
}

export async function* runWithEvents(
  rid: string,
): AsyncGenerator<SseEvent, void, void> {
  const request = takeRequest(rid);
  if (!request) {
    yield { type: "error", message: `no pending request for rid=${rid}` };
    return;
  }

  const queue: SseEvent[] = [];
  const waiters: Array<() => void> = [];
  let finished = false;

  const wake = (): void => {
    while (waiters.length > 0) {
      const w = waiters.shift();
      if (w) w();
    }
  };

  const onEvent = (event: SseEvent): void => {
    queue.push(event);
    wake();
  };

  const handlePromise = (async () => {
    try {
      await handleRequest(request, onEvent);
    } catch (err) {
      onEvent({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      finished = true;
      wake();
    }
  })();

  while (true) {
    if (queue.length > 0) {
      const next = queue.shift();
      if (next) yield next;
      continue;
    }
    if (finished) break;
    await new Promise<void>((resolve) => {
      waiters.push(resolve);
    });
  }

  await handlePromise;
}
