<img src="public/logo.png" alt="SlopPress logo" width="100%">

# SlopPress

A CMS where the web server **is** an LLM.

Every HTTP request — the homepage, a blog post, the login form, the admin
editor, the 404 page, even the stylesheet — is handed to a language model
along with a single markdown file that sketches the site. The LLM decides what
to render and responds via tool calls. No templates. No router. No ORM.

Each refresh is re-improvised. The vibes drift. That's the point.

## Running it

1. Copy `.env.example` to `.env` and fill in `OPENAI_API_KEY` (any
   OpenAI-compatible endpoint works — OpenAI, Ollama, LM Studio, vLLM, or
   Anthropic's OpenAI-compat endpoint).
2. Pick one:
   - `npm install && npm run dev` — local tsx watcher, dev mode (activity panel) on, hot-reloads on file change.
   - `npm start` — local tsx, dev mode off.
   - `npm run docker:dev` — containerized, dev mode on.
   - `npm run docker:run` — containerized, production-like, dev mode off.
   - `npm run docker:down` — stop the container.
3. Open <http://localhost:8080>.

Localhost-only by default. Don't expose this to the internet — user
passwords live in a markdown file and the LLM judges login attempts.

## Dev mode (show thinking)

`npm run dev` and `npm run docker:dev` flip `SLOPPRESS_DEV_MODE=true`. Every
page load returns a tiny SPA wrapper that streams the LLM's activity — the
request envelope, model messages, thinking tokens (if the model exposes
them), tool calls, state diffs — then hot-swaps the final HTML into the
document when the LLM calls `render_response`. The flag lives in the npm
scripts, not in `.env`.

## The tools the LLM has

| Tool | Effect |
|---|---|
| `render_response({ status, headers, body, set_cookies })` | Terminal. Sends the HTTP response. |
| `read_pages({ slugs })` / `read_posts({ slugs })` | Fetch full bodies on demand — the default payload only carries the manifest. |
| `write_page` / `write_post` / `delete_page` / `delete_post` | Create/update/remove one record. The manifest rebuilds automatically. |
| `write_site({ contents })` | Overwrite `state/site.md` (site config + users list). |
| `write_sessions({ contents })` | Overwrite `state/sessions.json` (login/logout). |
| `generate_image({ cache_key, prompt })` / `bust_image_cache` | Produce / invalidate images served from `/__images/<key>.png`. |

Everything else — routing, layout, styling, auth checks, 404 copy — the LLM invents each request.

## Source of truth

Everything under `state/`:

- `site.md` — site config frontmatter (title, tagline, vibe) + the Users list with cleartext passwords.
- `pages/*.md`, `posts/*.md` — one markdown file per record. Front-matter holds metadata; the body can contain `[imagine: …]`, `[continue]`, and `[image: …]` directives that the LLM resolves at render time.
- `index.json` — auto-generated manifest (titles, slugs, excerpts). Rebuilt on every write; always shipped to the LLM so it can route without reading every file.
- `sessions.json` — currently-valid auth sessions.
- `system-prompt.md` — the LLM's brief. Re-read per request; edit freely without restarting.
- `images/*.png` — cached generated images.

Edit files by hand or let the LLM rewrite them through the admin UI.

## Model routing

- `SLOPPRESS_MODEL_READ` — unauthenticated GETs (default: fast/cheap).
- `SLOPPRESS_MODEL_ADMIN` — anything authenticated, any POST, any path
  starting with `/admin` (default: smarter/slower).
- `SLOPPRESS_MODEL` — override both.

## Paths

SlopPress uses generic paths (`/login`, `/admin`, `/logout`). WordPress-
specific URLs like `/wp-login.php` are intentionally avoided — they
attract a firehose of bot scans, and you don't want each one racking up
LLM tokens.
