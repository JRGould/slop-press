import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const STATE_DIR = process.env.SLOPPRESS_STATE_DIR ?? path.resolve("state");
const STATE_MD = path.join(STATE_DIR, "state.md");
const SESSIONS_JSON = path.join(STATE_DIR, "sessions.json");

const DEFAULT_STATE_MD = `---
title: SlopPress
tagline: a vibe-coded CMS
vibe: minimal personal blog, sans-serif, generous whitespace
---

# Users

- admin / hunter2

# Pages

## /about
A short page about the site. Mentions it's built on SlopPress and every
response is generated on the fly.

## /contact
A contact page with an email address. No real form submission.

# Posts

## 2026-04-17 — Welcome to SlopPress
First post. Explains that the page you are reading was improvised by an
LLM from a tiny markdown file.
`;

const DEFAULT_SESSIONS_JSON = `{
  "sessions": []
}
`;

async function ensureStateDir(): Promise<void> {
  if (!existsSync(STATE_DIR)) {
    await mkdir(STATE_DIR, { recursive: true });
  }
}

export async function readStateMd(): Promise<string> {
  await ensureStateDir();
  if (!existsSync(STATE_MD)) {
    await writeFile(STATE_MD, DEFAULT_STATE_MD, "utf8");
  }
  return readFile(STATE_MD, "utf8");
}

export async function writeStateMd(contents: string): Promise<void> {
  await ensureStateDir();
  await writeFile(STATE_MD, contents, "utf8");
}

export async function readSessionsJson(): Promise<string> {
  await ensureStateDir();
  if (!existsSync(SESSIONS_JSON)) {
    await writeFile(SESSIONS_JSON, DEFAULT_SESSIONS_JSON, "utf8");
  }
  return readFile(SESSIONS_JSON, "utf8");
}

export async function writeSessionsJson(contents: string): Promise<void> {
  await ensureStateDir();
  await writeFile(SESSIONS_JSON, contents, "utf8");
}

export function statePaths() {
  return { STATE_DIR, STATE_MD, SESSIONS_JSON };
}
