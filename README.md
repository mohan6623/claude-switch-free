# claude-switch-free

Free-first, provider-flexible proxy for Claude Code and OpenAI/Anthropic-compatible clients.

Main idea:
- Start fast with free model providers.
- Keep full support for paid providers and GitHub Copilot subscriptions.
- Switch models per slot at runtime without being locked to a single provider.
- Keep usage simple with two daily commands: `claude-switch start` and `claude-switch switch`.

## Important Warnings

> [!WARNING]
> This project uses reverse-engineered behavior for some GitHub Copilot flows.
> It is not an official GitHub product and can break when upstream behavior changes.

> [!WARNING]
> Use responsibly. Excessive automation may violate provider or platform terms and can trigger throttling, temporary restrictions, or account action.

> [!WARNING]
> You are responsible for API key security, billing usage, and compliance with each provider's terms.

## What This Proxy Gives You

- One local gateway exposing OpenAI-compatible and Anthropic-compatible endpoints.
- Free + paid model access in one setup.
- GitHub Copilot subscription mode and provider mode in the same tool.
- Per-slot model routing (default, opus, sonnet, haiku) with runtime switching.
- Provider flexibility: use presets or configure custom providers not listed by default.
- Rate-limit controls and cooldown handling.
- Automatic context compaction when request context grows beyond model limits.

## Installation (First Priority)

## Prerequisites

- Bun 1.2+
- Node.js 18+
- At least one backend credential:
  - GitHub Copilot subscription (individual/business/enterprise), or
  - Provider API key (free or paid model provider)

## Option A: Run Without Cloning

```sh
npx claude-switch@latest start
```

## Option B: Local Install From Source

```sh
git clone https://github.com/mohan6623/claude-switch-free.git
cd claude-switch-free
bun install
bun run build
npm link
```

After linking, the global command is available:

```sh
claude-switch start
```

## First-Time Setup Guidance

Run:

```sh
claude-switch start
```

Startup wizard flow:

1. Choose backend mode:
   - Copilot Pro (GitHub subscription)
   - Providers (free/paid API providers)
2. In provider mode, choose one:
   - Continue current config
   - Add provider
   - Update provider
   - Switch configured provider/model
3. Configure slot models:
   - default
   - opus
   - sonnet
   - haiku

Your provider and slot selections are saved and reused on next start.

## Daily Usage (Simple)

Start server with saved config:

```sh
claude-switch start
```

Change provider/model slots at runtime:

```sh
claude-switch switch
```

That is the intended day-to-day workflow.

## Free-First, But Not Free-Limited

This repo is designed so users can prefer free models first, while still mixing paid models when needed.

Examples:
- Keep `default` on a free model for routine tasks.
- Route `opus` or `sonnet` slot to a paid model for harder tasks.
- Keep other slots on lower-cost or free tiers.

You can mix providers across slots instead of being forced into one provider for all slots.

## Custom Providers (Not Listed? Still Supported)

If your provider is not in the preset list, add it as a custom provider in switch/start flows by supplying:

- Provider base URL
- API key
- Model IDs for each slot

This keeps the system open for new and niche providers.

## Reliability and Cost-Control Features

- Client-side request pacing:
  - `--rate-limit <seconds>` enforces minimum delay between requests.
  - `--wait` waits for the next slot instead of failing fast.
- Upstream 429 handling:
  - Provider cooldown handling with bounded retries.
  - Copilot cooldown short-circuit after rate-limit responses.
- Context protection:
  - Automatic trimming/compaction of older conversation context before dispatch when prompt windows are near model limits.

## Core Commands

```sh
claude-switch start
claude-switch switch
claude-switch auth
claude-switch check-usage
claude-switch debug
```

Useful start flags:

```sh
claude-switch start --port 4141
claude-switch start --provider openrouter --provider-api-key YOUR_KEY
claude-switch start --provider custom --provider-base-url YOUR_BASE_URL --provider-api-key YOUR_KEY
claude-switch start --rate-limit 30 --wait
claude-switch start --manual
claude-switch start --claude-code
```

## Data Location

Runtime auth/config data is stored under:

- `~/.local/share/claude-switch`

## API Surface

OpenAI-compatible:

- `POST /v1/chat/completions`
- `GET /v1/models`
- `POST /v1/embeddings`

Anthropic-compatible:

- `POST /v1/messages`
- `POST /v1/messages/count_tokens`

Utility:

- `GET /usage`
- `GET /token`

## Development and Improvement (Last)

If you want to improve this proxy:

```sh
git clone https://github.com/mohan6623/claude-switch-free.git
cd claude-switch-free
bun install
bun run dev
```

Quality checks:

```sh
bun run build
bun run lint
bun test
```

Release/build scripts are in:

- `package.json`
- `scripts/`

Core runtime areas to extend:

- `src/start.ts` (startup and interactive flows)
- `src/switch.ts` (slot/provider switching)
- `src/services/` (provider and Copilot request pipelines)
- `src/routes/` (API compatibility routes)
