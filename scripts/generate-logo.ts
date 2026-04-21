import OpenAI from "openai";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import process from "node:process";

const OUT = path.resolve("public/logo.png");
const PROMPT = `A minimalist, modern logo for "SlopPress" — a playful,
slightly absurd CMS where a Large Language Model acts as the web server.

Visual concept: a stylized quill or pen nib dripping a single glossy drop
of colorful ink onto an open book or document, with the drop subtly
fragmenting into pixelated cubes mid-fall — suggesting "slop" becoming
"press". Warm off-white background, bold confident linework, soft ink-wash
shading, limited palette (deep ink-black, a single accent of teal or
mustard). Square composition, centered subject, generous whitespace, no
text or letters anywhere in the image. Flat modern editorial illustration
style, reminiscent of a refined indie publication mark.`;

async function main() {
  const apiKey = process.env.SLOPPRESS_IMAGE_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Missing OPENAI_API_KEY / SLOPPRESS_IMAGE_API_KEY in env.");
    process.exit(1);
  }
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.SLOPPRESS_IMAGE_BASE_URL ?? process.env.OPENAI_BASE_URL,
  });
  const model = process.env.SLOPPRESS_IMAGE_MODEL ?? "gpt-image-1-mini";

  const params: Record<string, unknown> = {
    model,
    prompt: PROMPT,
    n: 1,
    size: "1024x1024",
  };
  if (model.startsWith("dall-e")) params.response_format = "b64_json";

  console.log(`Generating logo with ${model}…`);
  const response = await client.images.generate(
    params as Parameters<typeof client.images.generate>[0],
  );
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    console.error("No image data in response.");
    process.exit(1);
  }

  const dir = path.dirname(OUT);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(OUT, Buffer.from(b64, "base64"));
  console.log(`Wrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
