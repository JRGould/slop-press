/**
 * Static site generator for SlopPress.
 *
 * Crawls all public pages and posts by calling handleRequest() directly
 * (no HTTP server needed), then writes the HTML to dist/.
 *
 * Usage:
 *   tsx --env-file=.env scripts/generate-static.ts [--out <dir>] [--concurrency <n>]
 *
 * Environment variables (read from .env via --env-file):
 *   SLOPPRESS_STATE_DIR   — path to state dir (default: ./state)
 *   SLOPPRESS_SITE_URL    — base URL embedded in system prompt (default: http://localhost:8080)
 *   SLOPPRESS_OUT_DIR     — output directory (default: ./dist)
 *   SLOPPRESS_MODEL_READ  — model used for unauthenticated GETs
 *   SLOPPRESS_MODEL       — overrides all model selection
 *
 * Output layout:
 *   dist/index.html           ← /
 *   dist/about/index.html     ← /about
 *   dist/posts/foo/index.html ← /posts/foo
 *   dist/__images/*.png       ← copied from state/images/
 */

import { mkdir, writeFile, copyFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import process from "node:process";

import { handleRequest } from "../src/handler.js";
import { readManifest } from "../src/content.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OUT_DIR =
  process.env.SLOPPRESS_OUT_DIR ??
  ((): string => {
    const argIdx = process.argv.indexOf("--out");
    return argIdx !== -1 && process.argv[argIdx + 1]
      ? (process.argv[argIdx + 1] as string)
      : path.resolve("dist");
  })();

const STATE_DIR =
  process.env.SLOPPRESS_STATE_DIR ?? path.resolve("state");

const SITE_URL =
  process.env.SLOPPRESS_SITE_URL ?? "http://localhost:8080";

const SITE_HOST = (() => {
  try {
    return new URL(SITE_URL).host;
  } catch {
    return "localhost:8080";
  }
})();

// Paths that are never rendered in static mode
const SKIP_PREFIXES = ["/admin", "/__", "/login", "/logout"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shouldSkip(pathname: string): boolean {
  return SKIP_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p + "?"));
}

/** Map a URL pathname to an output file path. */
function pathnameToOutFile(pathname: string): string {
  const clean = pathname.replace(/\/+$/, "") || "/";
  if (clean === "/") return path.join(OUT_DIR, "index.html");
  // Strip leading slash, then nest under a directory as index.html for clean URLs.
  return path.join(OUT_DIR, clean.slice(1), "index.html");
}

/** Extract same-origin href pathnames from HTML. */
function extractLinks(html: string): string[] {
  const results: string[] = [];
  const re = /href=["']([^"'#?][^"']*?)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (!href) continue;
    try {
      const u = new URL(href, SITE_URL);
      if (u.origin === new URL(SITE_URL).origin) {
        results.push(u.pathname);
      }
    } catch {
      // Relative paths without a scheme — treat as same-origin.
      if (href.startsWith("/")) results.push(href);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const manifest = await readManifest();

  // Seed with homepage + every known page slug + common guesses for posts.
  const seeds: string[] = [
    "/",
    ...manifest.pages.map((p) => p.slug),
    // Try both /posts/<slug> and /<slug> since the LLM picks the URL scheme.
    ...manifest.posts.flatMap((p) => [`/posts/${p.slug}`, `/${p.slug}`]),
    "/blog",
    "/posts",
  ];

  const visited = new Set<string>();
  const queue = [...seeds];
  let saved = 0;
  let skipped = 0;
  let errors = 0;

  console.log(`SlopPress static generator`);
  console.log(`  State:  ${STATE_DIR}`);
  console.log(`  Output: ${OUT_DIR}`);
  console.log(`  Seeds:  ${seeds.length} URLs\n`);

  while (queue.length > 0) {
    const pathname = queue.shift()!;
    if (visited.has(pathname) || shouldSkip(pathname)) continue;
    visited.add(pathname);

    process.stdout.write(`  GET ${pathname} … `);

    let response;
    try {
      response = await handleRequest({
        method: "GET",
        url: pathname,
        headers: {
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          host: SITE_HOST,
        },
        body: null,
      });
    } catch (err) {
      console.log(`ERROR\n    ${err}`);
      errors++;
      continue;
    }

    // Follow redirects (the LLM might redirect / → /home, etc.)
    if (response.status >= 300 && response.status < 400) {
      const loc =
        response.headers?.Location ?? response.headers?.location ?? "";
      console.log(`${response.status} → ${loc || "(no location)"}`);
      if (loc) {
        try {
          const u = new URL(loc, SITE_URL);
          if (
            u.origin === new URL(SITE_URL).origin &&
            !visited.has(u.pathname) &&
            !shouldSkip(u.pathname)
          ) {
            queue.push(u.pathname);
          }
        } catch {
          if (loc.startsWith("/") && !visited.has(loc) && !shouldSkip(loc)) {
            queue.push(loc);
          }
        }
      }
      skipped++;
      continue;
    }

    if (response.status !== 200) {
      console.log(`${response.status} (skipped)`);
      skipped++;
      continue;
    }

    const ct = Object.entries(response.headers ?? {}).find(
      ([k]) => k.toLowerCase() === "content-type",
    )?.[1] ?? "";

    if (!ct.includes("text/html")) {
      console.log(`${response.status} ${ct} (not HTML, skipped)`);
      skipped++;
      continue;
    }

    const outFile = pathnameToOutFile(pathname);
    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, response.body, "utf8");
    console.log(`${response.status} → ${path.relative(process.cwd(), outFile)}`);
    saved++;

    // Discover more URLs from the rendered HTML.
    for (const link of extractLinks(response.body)) {
      if (!visited.has(link) && !shouldSkip(link)) {
        queue.push(link);
      }
    }
  }

  // Copy generated images.
  const imagesDir = path.join(STATE_DIR, "images");
  const outImagesDir = path.join(OUT_DIR, "__images");
  if (existsSync(imagesDir)) {
    const files = await readdir(imagesDir);
    const pngs = files.filter((f) => f.endsWith(".png"));
    if (pngs.length > 0) {
      await mkdir(outImagesDir, { recursive: true });
      for (const file of pngs) {
        await copyFile(
          path.join(imagesDir, file),
          path.join(outImagesDir, file),
        );
        console.log(`  copy /__images/${file}`);
      }
      console.log(`  Copied ${pngs.length} image(s).`);
    }
  }

  console.log(
    `\nDone. ${saved} page(s) saved, ${skipped} skipped, ${errors} error(s).`,
  );
  console.log(`Output: ${OUT_DIR}`);

  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
