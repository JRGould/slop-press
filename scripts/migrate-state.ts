/**
 * One-shot migration: split legacy state.md into site.md + pages/*.md + posts/*.md
 * and build index.json.
 *
 * Usage:  tsx scripts/migrate-state.ts [--dry-run] [--force]
 *
 * Heuristics (mirrors the format in the seed state.md):
 *   - Top `---` frontmatter block becomes site.md frontmatter (title, tagline, vibe).
 *   - `# Users` section (bulleted list of `name / password`) is preserved verbatim inside site.md.
 *   - `# Pages` section: each `## /slug` starts a page. Everything after the header
 *     (until the next `## ` or `# `) is the body. Title defaults to the slug.
 *   - `# Posts` section: each `## YYYY-MM-DD — Title` starts a post. A following
 *     `## Title` without a date prefix is appended as a sub-section of the previous
 *     post (preserved as a `## Title` heading inside the body).
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import process from "node:process";

import {
  contentPaths,
  rebuildManifest,
  writePage,
  writePost,
  writeSiteMd,
} from "../src/content.js";

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

const STATE_DIR = process.env.SLOPPRESS_STATE_DIR ?? path.resolve("state");
const LEGACY_STATE_MD = path.join(STATE_DIR, "state.md");

interface PageDraft {
  slug: string;
  title: string;
  body: string;
}

interface PostDraft {
  slug: string;
  date: string;
  title: string;
  body: string;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function parseLegacy(raw: string): {
  site: { frontmatter: string; users: string };
  pages: PageDraft[];
  posts: PostDraft[];
} {
  // Extract top frontmatter
  const fmMatch = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  const frontmatter = fmMatch ? fmMatch[1].trim() : "";
  const rest = fmMatch ? fmMatch[2] : raw;

  // Walk top-level headings
  const lines = rest.split("\n");
  type Section = "none" | "users" | "pages" | "posts";
  let section: Section = "none";
  let users = "";
  const pages: PageDraft[] = [];
  const posts: PostDraft[] = [];
  let buf: string[] = [];
  let currentPage: PageDraft | null = null;
  let currentPost: PostDraft | null = null;

  const flushPage = () => {
    if (currentPage) {
      currentPage.body = buf.join("\n").trim();
      pages.push(currentPage);
    }
    currentPage = null;
    buf = [];
  };
  const flushPost = () => {
    if (currentPost) {
      currentPost.body = buf.join("\n").trim();
      posts.push(currentPost);
    }
    currentPost = null;
    buf = [];
  };

  for (const line of lines) {
    const top = /^#\s+(.+)$/.exec(line);
    if (top) {
      if (section === "pages") flushPage();
      if (section === "posts") flushPost();
      const header = top[1].trim().toLowerCase();
      if (header === "users") section = "users";
      else if (header === "pages") section = "pages";
      else if (header === "posts") section = "posts";
      else section = "none";
      continue;
    }
    const sub = /^##\s+(.+)$/.exec(line);
    if (sub) {
      const heading = sub[1].trim();
      if (section === "pages") {
        flushPage();
        const slug = heading.startsWith("/") ? heading : "/" + slugify(heading);
        currentPage = { slug, title: slug, body: "" };
        continue;
      }
      if (section === "posts") {
        const dateMatch = /^(\d{4}-\d{2}-\d{2})\s*[—–-]\s*(.+)$/.exec(heading);
        if (dateMatch) {
          flushPost();
          const [, date, title] = dateMatch;
          currentPost = {
            slug: `${date}-${slugify(title)}`,
            date,
            title: title.trim(),
            body: "",
          };
          continue;
        }
        // Sub-heading inside a post — keep as ## in body
        buf.push(line);
        continue;
      }
    }
    if (section === "users") {
      users += line + "\n";
    } else if (section === "pages" && currentPage) {
      buf.push(line);
    } else if (section === "posts" && currentPost) {
      buf.push(line);
    }
  }
  if (section === "pages") flushPage();
  if (section === "posts") flushPost();

  return {
    site: { frontmatter, users: users.trim() },
    pages,
    posts,
  };
}

function buildSiteMd(frontmatter: string, users: string): string {
  return `---\n${frontmatter}\n---\n\n# Users\n\n${users}\n`;
}

async function main() {
  if (!existsSync(LEGACY_STATE_MD)) {
    console.error(`No legacy state.md at ${LEGACY_STATE_MD}. Nothing to migrate.`);
    process.exit(1);
  }

  const paths = contentPaths();
  const alreadyMigrated =
    existsSync(paths.SITE_MD) || existsSync(paths.INDEX_JSON);
  if (alreadyMigrated && !FORCE) {
    console.error(
      `Refusing to migrate: site.md or index.json already exists under ${paths.STATE_DIR}. Re-run with --force to overwrite.`,
    );
    process.exit(1);
  }

  const raw = await readFile(LEGACY_STATE_MD, "utf8");
  const parsed = parseLegacy(raw);

  console.log(`Parsed:`);
  console.log(`  site frontmatter: ${parsed.site.frontmatter.split("\n").length} lines`);
  console.log(`  users block: ${parsed.site.users ? "present" : "empty"}`);
  console.log(`  pages: ${parsed.pages.length}`);
  for (const p of parsed.pages) console.log(`    - ${p.slug}  (${p.body.length} chars)`);
  console.log(`  posts: ${parsed.posts.length}`);
  for (const p of parsed.posts)
    console.log(`    - ${p.slug}  "${p.title}"  (${p.body.length} chars)`);

  if (DRY_RUN) {
    console.log("\n(--dry-run: no files written)");
    return;
  }

  const siteMd = buildSiteMd(parsed.site.frontmatter, parsed.site.users);
  await writeSiteMd(siteMd);
  for (const p of parsed.pages) {
    await writePage({ slug: p.slug, title: p.title, body: p.body });
  }
  for (const p of parsed.posts) {
    await writePost({
      slug: p.slug,
      title: p.title,
      date: p.date,
      body: p.body,
    });
  }
  const manifest = await rebuildManifest();

  // Also write a backup of the old file
  const backup = LEGACY_STATE_MD + ".bak";
  await writeFile(backup, raw, "utf8");

  console.log(`\nWrote:`);
  console.log(`  ${paths.SITE_MD}`);
  console.log(`  ${paths.PAGES_DIR}/  (${manifest.pages.length} files)`);
  console.log(`  ${paths.POSTS_DIR}/  (${manifest.posts.length} files)`);
  console.log(`  ${paths.INDEX_JSON}`);
  console.log(`\nBackup of legacy state.md at ${backup}`);
  console.log(`Legacy state.md left in place; remove manually once the new flow is wired up.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
