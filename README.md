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
2. `docker compose up --build`
3. Open <http://localhost:8080>.

Localhost-only by default. Don't expose this to the internet — user
passwords live in a markdown file and the LLM judges login attempts.

## Dev mode (show thinking)

Set `SLOPPRESS_DEV_MODE=true` in `.env`. Every page load now returns a tiny
SPA wrapper that streams the LLM's activity — the request envelope, model
messages, thinking tokens (if the model exposes them), tool calls, state
diffs — then hot-swaps the final HTML into the document when the LLM calls
`render_response`.

## The three tools the LLM has

| Tool | Effect |
|---|---|
| `render_response({ status, headers, body, set_cookies })` | Terminal. Sends the HTTP response. |
| `write_state({ contents })` | Overwrite `state/state.md`. Used for admin edits. |
| `write_sessions({ contents })` | Overwrite `state/sessions.json`. Used for login/logout. |

That's it. Everything else the LLM invents.

## Source of truth

Two files under `state/`:

- `state.md` — site config, page/post sketches, users with cleartext
  passwords. The LLM treats this as source *material*, not a template.
- `sessions.json` — currently-valid auth sessions.

Edit either by hand or let the LLM rewrite them through the admin UI.

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
