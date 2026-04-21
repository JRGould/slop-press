# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # tsx watch — hot-reloads on file changes (except system-prompt.md, which reloads per-request automatically)
npm run typecheck    # tsc --noEmit — no build step, tsx runs TS directly
docker compose up --build   # production-like run, localhost:8080 only
```

No test suite. Output is non-deterministic by design.

## Architecture

SlopPress is a CMS where **every HTTP request is handled by an LLM**. There are no templates, routers, or controllers. The LLM receives the full request plus the site's markdown source-of-truth and responds by calling one of three tools.

### Request flow

```
HTTP request
  → server.ts (Hono catch-all)
    → [dev mode?] stash request, return loader.html; SSE stream via /__slop/stream
    → [direct mode] handler.ts
      → reads system-prompt.md + state.md + sessions.json + cached image list (all parallel)
      → LLM loop (up to 6 turns): callLLM → execute tool calls → repeat until render_response
      → HTTP response
```

### The three tools (`src/tools.ts`)

| Tool | Effect |
|---|---|
| `render_response` | Terminal — sends HTTP response. Always last. |
| `write_state` | Overwrites `state/state.md` (admin edits, page/post/user mutations). |
| `write_sessions` | Overwrites `state/sessions.json` (login/logout). |
| `generate_image` | Generates an image via the image provider; caches to `state/images/`. |
| `bust_image_cache` | Deletes a cached image so it regenerates on next request. |

### Persistent state (`state/`)

| File | Purpose |
|---|---|
| `state.md` | Site config, pages, posts, users (cleartext passwords). LLM source material, not a template. |
| `sessions.json` | Live auth sessions. Gitignored. |
| `system-prompt.md` | System prompt. Read fresh on **every request** — edit this file to change LLM behaviour without restarting. |
| `images/` | Cached generated images served at `/__images/<key>.png`. |

`state/` is a Docker bind-mount. All files there survive container restarts and are writable at runtime. `system-prompt.md` supports `{{SITE_URL}}` substitution (and any key added to the `vars` map in `src/state.ts:readSystemPrompt`).

### Dev mode (`src/dev-mode.ts` + `public/loader.html`)

When `SLOPPRESS_DEV_MODE=true`, every request returns the loader SPA instead of calling the LLM directly. The loader:
1. Opens an SSE connection to `/__slop/stream?rid=<rid>`.
2. Displays a persistent right-docked activity panel showing all LLM events in real time.
3. On `render` event, sets `iframe.srcdoc` with the final HTML.
4. Intercepts `<a>` clicks and `<form>` submits inside the iframe via `postMessage`, routing them through `POST /__slop/submit` to get a new `rid` and open a new SSE stream.

This means the activity panel persists across navigations and the page never does a real browser navigation.

### Model routing (`src/llm.ts:pickModel`)

- `SLOPPRESS_MODEL_READ` — unauthenticated GETs.
- `SLOPPRESS_MODEL_ADMIN` — authenticated requests, POSTs, `/admin/*`.
- `SLOPPRESS_MODEL` — overrides both.

Falls back to `gpt-4o-mini`. Image generation uses `SLOPPRESS_IMAGE_MODEL` (default `dall-e-3`) with optionally separate `SLOPPRESS_IMAGE_API_KEY` / `SLOPPRESS_IMAGE_BASE_URL`.

### Key conventions

- **No WordPress paths.** `/login`, `/admin`, `/logout` only. `/wp-login.php` etc. attract bot scans that burn LLM tokens.
- **Redirects must be tool calls.** `render_response({ status: 302, headers: { Location: "..." } })` — never HTML that says "Redirecting…".
- **`render_response` is always last.** The LLM loop returns a 500 if it exhausts 6 turns without calling it.
- **Image URLs are deterministic.** `/__images/<cache_key>.png` — the LLM can embed the URL and call `generate_image` in the same turn.
- The `loaderTemplateCache` in `server.ts` caches `loader.html` in memory. During local dev (`npm run dev`) this is fine; in Docker restart the container to pick up loader changes.

## Verification

Two dev environments can serve this app: `npm run dev` (tsx watch, hot-reload) and `docker compose up` (image rebuild required). They can drift — code edits only land in the tsx-watch process, not a running Docker container.

- When the user reports "still doesn't work" after a fix, **first confirm which environment they're hitting** (port, URL, `docker ps`) before re-debugging the code. The fix may already be correct but served from a stale container.
- After a code change, before declaring done, verify the new code is actually executing: check tsx reloaded, rebuild the Docker image if that's the target, or bust `loaderTemplateCache` / caches as needed.
- `state/system-prompt.md` is the exception — it reloads per-request, no restart needed.
