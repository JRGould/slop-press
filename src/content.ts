import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import process from "node:process";

const STATE_DIR = process.env.SLOPPRESS_STATE_DIR ?? path.resolve("state");
const SITE_MD = path.join(STATE_DIR, "site.md");
const PAGES_DIR = path.join(STATE_DIR, "pages");
const POSTS_DIR = path.join(STATE_DIR, "posts");
const INDEX_JSON = path.join(STATE_DIR, "index.json");

const EXCERPT_LEN = 140;

export interface ManifestPage {
  slug: string;
  title: string;
  excerpt: string;
  updated_at: string;
}

export interface ManifestPost {
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  updated_at: string;
}

export interface Manifest {
  pages: ManifestPage[];
  posts: ManifestPost[];
}

export interface PageRecord {
  slug: string;
  title: string;
  body: string;
  updated_at: string;
}

export interface PostRecord {
  slug: string;
  title: string;
  date: string;
  body: string;
  updated_at: string;
}

async function ensureDirs(): Promise<void> {
  for (const d of [STATE_DIR, PAGES_DIR, POSTS_DIR]) {
    if (!existsSync(d)) await mkdir(d, { recursive: true });
  }
}

// --- frontmatter -------------------------------------------------------------

export function parseFrontmatter(raw: string): {
  meta: Record<string, string>;
  body: string;
} {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!match) return { meta: {}, body: raw };
  const [, fmBlock = "", body = ""] = match;
  const meta: Record<string, string> = {};
  for (const line of fmBlock.split("\n")) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (m && m[1]) meta[m[1]] = (m[2] ?? "").trim();
  }
  return { meta, body };
}

export function formatFrontmatter(
  meta: Record<string, string>,
  body: string,
): string {
  const lines = Object.entries(meta).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n\n${body.replace(/^\n+/, "")}`;
}

// --- slug <-> filename -------------------------------------------------------

export function pageSlugToFilename(slug: string): string {
  const clean = slug.replace(/^\/+|\/+$/g, "") || "index";
  const safe = clean.replace(/\//g, "--").replace(/[^A-Za-z0-9_\-.]/g, "_");
  return `${safe}.md`;
}

export function filenameToPageSlug(filename: string): string {
  const base = filename.replace(/\.md$/, "");
  if (base === "index") return "/";
  return "/" + base.replace(/--/g, "/");
}

export function postFilename(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_\-.]/g, "_");
  return `${safe}.md`;
}

// --- excerpt -----------------------------------------------------------------

export function buildExcerpt(body: string): string {
  const stripped = body
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length <= EXCERPT_LEN) return stripped;
  const cut = stripped.slice(0, EXCERPT_LEN);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

// --- site.md -----------------------------------------------------------------

export async function readSiteMd(): Promise<string> {
  await ensureDirs();
  if (!existsSync(SITE_MD)) return "";
  return readFile(SITE_MD, "utf8");
}

export async function writeSiteMd(contents: string): Promise<void> {
  await ensureDirs();
  await writeFile(SITE_MD, contents, "utf8");
}

// --- pages -------------------------------------------------------------------

export async function readPage(slug: string): Promise<PageRecord | null> {
  await ensureDirs();
  const file = path.join(PAGES_DIR, pageSlugToFilename(slug));
  if (!existsSync(file)) return null;
  const raw = await readFile(file, "utf8");
  const { meta, body } = parseFrontmatter(raw);
  return {
    slug: meta.slug ?? slug,
    title: meta.title ?? slug,
    body: body.trim(),
    updated_at: meta.updated_at ?? "",
  };
}

export async function writePage(
  record: Omit<PageRecord, "updated_at"> & { updated_at?: string },
): Promise<PageRecord> {
  await ensureDirs();
  const updated_at = record.updated_at ?? new Date().toISOString();
  const full: PageRecord = { ...record, updated_at };
  const file = path.join(PAGES_DIR, pageSlugToFilename(full.slug));
  const raw = formatFrontmatter(
    { title: full.title, slug: full.slug, updated_at },
    full.body,
  );
  await writeFile(file, raw, "utf8");
  await rebuildManifest();
  return full;
}

export async function deletePage(slug: string): Promise<boolean> {
  await ensureDirs();
  const file = path.join(PAGES_DIR, pageSlugToFilename(slug));
  if (!existsSync(file)) return false;
  await rm(file);
  await rebuildManifest();
  return true;
}

export async function listPageFiles(): Promise<string[]> {
  await ensureDirs();
  const entries = await readdir(PAGES_DIR);
  return entries.filter((e) => e.endsWith(".md"));
}

// --- posts -------------------------------------------------------------------

export async function readPost(id: string): Promise<PostRecord | null> {
  await ensureDirs();
  const file = path.join(POSTS_DIR, postFilename(id));
  if (!existsSync(file)) return null;
  const raw = await readFile(file, "utf8");
  const { meta, body } = parseFrontmatter(raw);
  return {
    slug: meta.slug ?? id,
    title: meta.title ?? id,
    date: meta.date ?? "",
    body: body.trim(),
    updated_at: meta.updated_at ?? "",
  };
}

export async function writePost(
  record: Omit<PostRecord, "updated_at"> & { updated_at?: string },
): Promise<PostRecord> {
  await ensureDirs();
  const updated_at = record.updated_at ?? new Date().toISOString();
  const full: PostRecord = { ...record, updated_at };
  const file = path.join(POSTS_DIR, postFilename(full.slug));
  const raw = formatFrontmatter(
    {
      title: full.title,
      slug: full.slug,
      date: full.date,
      updated_at,
    },
    full.body,
  );
  await writeFile(file, raw, "utf8");
  await rebuildManifest();
  return full;
}

export async function deletePost(id: string): Promise<boolean> {
  await ensureDirs();
  const file = path.join(POSTS_DIR, postFilename(id));
  if (!existsSync(file)) return false;
  await rm(file);
  await rebuildManifest();
  return true;
}

export async function listPostFiles(): Promise<string[]> {
  await ensureDirs();
  const entries = await readdir(POSTS_DIR);
  return entries.filter((e) => e.endsWith(".md"));
}

// --- manifest ----------------------------------------------------------------

export async function rebuildManifest(): Promise<Manifest> {
  await ensureDirs();
  const pages: ManifestPage[] = [];
  for (const file of await listPageFiles()) {
    const raw = await readFile(path.join(PAGES_DIR, file), "utf8");
    const { meta, body } = parseFrontmatter(raw);
    pages.push({
      slug: meta.slug ?? filenameToPageSlug(file),
      title: meta.title ?? file.replace(/\.md$/, ""),
      excerpt: buildExcerpt(body),
      updated_at: meta.updated_at ?? "",
    });
  }
  pages.sort((a, b) => a.slug.localeCompare(b.slug));

  const posts: ManifestPost[] = [];
  for (const file of await listPostFiles()) {
    const raw = await readFile(path.join(POSTS_DIR, file), "utf8");
    const { meta, body } = parseFrontmatter(raw);
    posts.push({
      slug: meta.slug ?? file.replace(/\.md$/, ""),
      title: meta.title ?? file.replace(/\.md$/, ""),
      date: meta.date ?? "",
      excerpt: buildExcerpt(body),
      updated_at: meta.updated_at ?? "",
    });
  }
  posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const manifest: Manifest = { pages, posts };
  await writeFile(INDEX_JSON, JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

export async function readManifest(): Promise<Manifest> {
  await ensureDirs();
  if (!existsSync(INDEX_JSON)) return rebuildManifest();
  try {
    const raw = await readFile(INDEX_JSON, "utf8");
    return JSON.parse(raw) as Manifest;
  } catch {
    return rebuildManifest();
  }
}

export function contentPaths() {
  return { STATE_DIR, SITE_MD, PAGES_DIR, POSTS_DIR, INDEX_JSON };
}
