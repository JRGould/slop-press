import OpenAI from "openai";
import { readFile, writeFile, unlink, readdir, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import process from "node:process";

const STATE_DIR = process.env.SLOPPRESS_STATE_DIR ?? path.resolve("state");
const IMAGES_DIR = path.join(STATE_DIR, "images");
const IMAGES_ROUTE = "/__images";

async function ensureImagesDir(): Promise<void> {
  if (!existsSync(IMAGES_DIR)) {
    await mkdir(IMAGES_DIR, { recursive: true });
  }
}

function sanitizeCacheKey(raw: string): string {
  // Allow only alphanumeric, hyphens, underscores. No path traversal.
  return raw.replace(/[^a-z0-9_-]/gi, "-").slice(0, 120);
}

function cacheKeyToFilename(cacheKey: string): string {
  return sanitizeCacheKey(cacheKey) + ".png";
}

function cacheKeyToUrl(cacheKey: string): string {
  return `${IMAGES_ROUTE}/${cacheKeyToFilename(cacheKey)}`;
}

let imageClient: OpenAI | null = null;
function getImageClient(): OpenAI {
  if (imageClient) return imageClient;
  imageClient = new OpenAI({
    apiKey: process.env.SLOPPRESS_IMAGE_API_KEY ?? process.env.OPENAI_API_KEY,
    baseURL: process.env.SLOPPRESS_IMAGE_BASE_URL ?? process.env.OPENAI_BASE_URL,
  });
  return imageClient;
}

export type GenerateImageResult = {
  url: string;
  cached: boolean;
  error?: string;
};

export async function generateImage(
  cacheKey: string,
  prompt: string,
): Promise<GenerateImageResult> {
  await ensureImagesDir();
  const filename = cacheKeyToFilename(cacheKey);
  const filePath = path.join(IMAGES_DIR, filename);

  if (existsSync(filePath)) {
    return { url: cacheKeyToUrl(cacheKey), cached: true };
  }

  const model = process.env.SLOPPRESS_IMAGE_MODEL ?? "dall-e-3";
  try {
    const client = getImageClient();
    const response = await client.images.generate({
      model,
      prompt,
      n: 1,
      size: "1024x1024",
      response_format: "b64_json",
    });
    const b64 = response.data?.[0]?.b64_json;
    if (!b64) {
      return {
        url: cacheKeyToUrl(cacheKey),
        cached: false,
        error: "no image data returned",
      };
    }
    const buffer = Buffer.from(b64, "base64");
    await writeFile(filePath, buffer);
    return { url: cacheKeyToUrl(cacheKey), cached: false };
  } catch (err) {
    return {
      url: cacheKeyToUrl(cacheKey),
      cached: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type CachedImage = {
  cacheKey: string;
  filename: string;
  url: string;
  sizeBytes: number;
};

export async function listCachedImages(): Promise<CachedImage[]> {
  await ensureImagesDir();
  let entries: string[];
  try {
    entries = await readdir(IMAGES_DIR);
  } catch {
    return [];
  }
  const results: CachedImage[] = [];
  for (const filename of entries.filter((f) => /\.(png|jpe?g|webp)$/i.test(f))) {
    const filePath = path.join(IMAGES_DIR, filename);
    try {
      const { size } = await stat(filePath);
      const cacheKey = filename.replace(/\.(png|jpe?g|webp)$/i, "");
      results.push({ cacheKey, filename, url: `${IMAGES_ROUTE}/${filename}`, sizeBytes: size });
    } catch {
      // skip unreadable files
    }
  }
  return results.sort((a, b) => a.cacheKey.localeCompare(b.cacheKey));
}

export async function bustImageCache(
  cacheKey: string,
): Promise<{ deleted: boolean }> {
  await ensureImagesDir();
  const filename = cacheKeyToFilename(cacheKey);
  const filePath = path.join(IMAGES_DIR, filename);
  if (!existsSync(filePath)) return { deleted: false };
  try {
    await unlink(filePath);
    return { deleted: true };
  } catch {
    return { deleted: false };
  }
}

export async function serveImage(
  filename: string,
): Promise<{ data: Buffer; contentType: string } | null> {
  // Sanitize: no path traversal, only known extensions.
  const safe = path.basename(filename);
  if (!/\.(png|jpe?g|webp)$/i.test(safe)) return null;
  const filePath = path.join(IMAGES_DIR, safe);
  if (!existsSync(filePath)) return null;
  try {
    const data = await readFile(filePath);
    const ext = safe.split(".").pop()?.toLowerCase() ?? "png";
    const contentType =
      ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "webp"
          ? "image/webp"
          : "image/png";
    return { data, contentType };
  } catch {
    return null;
  }
}
