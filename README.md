# Claude Switch Proxy

> [!WARNING]
> This is a reverse-engineered proxy of GitHub Claude Switch. It is not supported by GitHub, and may break unexpectedly. Use at your own risk.

> [!WARNING]
> **GitHub Security Notice:**  
> Excessive automated or scripted use of Copilot (including rapid or bulk requests, such as via automated tools) may trigger GitHub's abuse-detection systems.  
> You may receive a warning from GitHub Security, and further anomalous activity could result in temporary suspension of your Copilot access.
>
> GitHub prohibits use of their servers for excessive automated bulk activity or any activity that places undue burden on their infrastructure.
>
> Please review:
>
> - [GitHub Acceptable Use Policies](https://docs.github.com/site-policy/acceptable-use-policies/github-acceptable-use-policies#4-spam-and-inauthentic-activity-on-github)
> - [GitHub Copilot Terms](https://docs.github.com/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot)
>
> Use this proxy responsibly to avoid account restrictions.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/E1E519XS7W)

---

**Note:** If you are using [opencode](https://github.com/sst/opencode), you do not need this project. Opencode supports GitHub Copilot provider out of the box.

---

## Project Overview

A reverse-engineered proxy for the GitHub Claude Switch that exposes it as an OpenAI and Anthropic compatible service. This allows you to use GitHub Copilot with any tool that supports the OpenAI Chat Completions API or the Anthropic Messages API, including to power [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview).

## Features

- **OpenAI & Anthropic Compatibility**: Exposes GitHub Copilot as an OpenAI-compatible (`/v1/chat/completions`, `/v1/models`, `/v1/embeddings`) and Anthropic-compatible (`/v1/messages`) API.
- **Claude Code Integration**: Easily configure and launch [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) to use Copilot as its backend with a simple command-line flag (`--claude-code`).
- **Interactive Startup Wizard**: On startup, choose `Copilot Pro` or `Providers`. Provider mode supports preset/custom providers, saved API keys, and saved model slots (default, opus, sonnet, haiku) with keep-or-change prompts on restart.
- **Usage Dashboard**: A web-based dashboard to monitor your Claude Switch usage, view quotas, and see detailed statistics.
- **Rate Limit Control**: Manage API usage with rate-limiting options (`--rate-limit`) and a waiting mechanism (`--wait`) to prevent errors from rapid requests.
- **Manual Request Approval**: Manually approve or deny each API request for fine-grained control over usage (`--manual`).
- **Token Visibility**: Option to display GitHub and Copilot tokens during authentication and refresh for debugging (`--show-token`).
- **Flexible Authentication**: Authenticate interactively or provide a GitHub token directly, suitable for CI/CD environments.
- **Support for Different Account Types**: Works with individual, business, and enterprise GitHub Copilot plans.

## Demo

https://github.com/user-attachments/assets/7654b383-669d-4eb9-b23c-06d7aefee8c5

## Prerequisites

- Bun (>= 1.2.x)
- GitHub account with Copilot subscription (individual, business, or enterprise)

## Installation

To install dependencies, run:

```sh
bun install
```

## Using with Docker

Build image

```sh
docker build -t claude-switch .
```

Run the container

```sh
# Create a directory on your host to persist the GitHub token and related data
mkdir -p ./copilot-data

# Run the container with a bind mount to persist the token
# This ensures your authentication survives container restarts

docker run -p 4141:4141 -v $(pwd)/copilot-data:/root/.local/share/claude-switch claude-switch
```

> **Note:**
> The GitHub token and related data will be stored in `copilot-data` on your host. This is mapped to `/root/.local/share/claude-switch` inside the container, ensuring persistence across restarts.

### Docker with Environment Variables

You can pass the GitHub token directly to the container using environment variables:

```sh
# Build with GitHub token
docker build --build-arg GH_TOKEN=your_github_token_here -t claude-switch .

# Run with GitHub token
docker run -p 4141:4141 -e GH_TOKEN=your_github_token_here claude-switch

# Run with additional options
docker run -p 4141:4141 -e GH_TOKEN=your_token claude-switch start --verbose --port 4141
```

### Docker Compose Example

```yaml
version: "3.8"
services:
  claude-switch:
    build: .
    ports:
      - "4141:4141"
    environment:
      - GH_TOKEN=your_github_token_here
    restart: unless-stopped
```

The Docker image includes:

- Multi-stage build for optimized image size
- Non-root user for enhanced security
- Health check for container monitoring
- Pinned base image version for reproducible builds

## Using with npx

You can run the project directly using npx:

```sh
npx claude-switch@latest start
```

With options:

```sh
npx claude-switch@latest start --port 8080
```

For authentication only:

```sh
npx claude-switch@latest auth
```

## Command Structure

Claude Switch now uses a subcommand structure with these main commands:

- `start`: Start the Claude Switch server. This command will also handle authentication if needed.
- `auth`: Run GitHub authentication flow without starting the server. This is typically used if you need to generate a token for use with the `--github-token` option, especially in non-interactive environments.
- `check-usage`: Show your current GitHub Copilot usage and quota information directly in the terminal (no server required).
- `debug`: Display diagnostic information including version, runtime details, file paths, and authentication status. Useful for troubleshooting and support.

## Command Line Options

### Start Command Options

The following command line options are available for the `start` command:

| Option                | Description                                                                               | Default    | Alias |
| --------------------- | ----------------------------------------------------------------------------------------- | ---------- | ----- |
| --port                | Port to listen on                                                                         | 4141       | -p    |
| --verbose             | Enable verbose logging                                                                    | false      | -v    |
| --account-type        | Account type to use (individual, business, enterprise)                                    | individual | -a    |
| --manual              | Enable manual request approval                                                            | false      | none  |
| --rate-limit          | Rate limit in seconds between requests                                                    | none       | -r    |
| --wait                | Wait instead of error when rate limit is hit                                              | false      | -w    |
| --github-token        | Provide GitHub token directly (must be generated using the `auth` subcommand)             | none       | -g    |
| --claude-code         | Generate a command to launch Claude Code with Claude Switch config                          | false      | -c    |
| --show-token          | Show GitHub and Copilot tokens on fetch and refresh                                       | false      | none  |
| --provider            | Provider preset override: `copilot`, `opencode`, `openrouter`, `groq`, `xai`, `nvidia-nim`, `gemini`, `custom` (omit to use interactive startup wizard) | none       | none  |
| --provider-base-url   | Override provider base URL                                                                | none       | none  |
| --provider-api-key    | Override provider API key                                                                 | none       | none  |
| --provider-model      | Preferred default model in provider mode                                                  | none       | none  |
| --provider-small-model| Preferred small model in provider mode                                                    | none       | none  |
| --provider-request-handling-mode | Provider request policy override: `strict`, `balanced`, `resilient`             | none       | none  |

### Interactive Startup Wizard

When no explicit `--provider*` overrides are passed, `start` launches an interactive flow:

1. Select backend mode: `Copilot Pro` or `Providers`
2. In provider mode, if you already have saved providers, choose one action:
   - `Continue with current config`
   - `Add provider`
   - `Update provider`
   - `Switch configured provider/model`
3. For first-time setup or add-provider flow, select a preset provider or add a custom provider, then enter API key (preset providers display a direct API key URL)
4. Choose a provider request handling mode (`strict`, `balanced`, or `resilient`)
5. Configure model slots one by one using featured model suggestions plus search/manual entry:
  - default model
  - big model (Opus slot)
  - sonnet model
  - haiku model
  - prompts include inline search status and hint text (`Type: to search`) similar to OpenCode/OpenRouter terminal UX
6. On later runs, existing provider configs can be reused directly without re-entering provider/model details.

Provider and model slot choices are persisted and reused on next startup.

When using `claude-switch switch`, you can choose where Claude env sync is written:
- local workspace file (`.claude/settings.local.json`)
- global user file (`~/.claude/settings.json`)

On entering switch mode, the slot summary is loaded from the selected target with this read order:
- local target: `.claude/settings.local.json`, then `.claude/settings.json`
- global target: `~/.claude/settings.json`, then `~/.claude/settings.local.json`

Startup output is concise by default and shows the configured slot summary (instead of printing every available provider model).

### Auth Command Options

| Option       | Description               | Default | Alias |
| ------------ | ------------------------- | ------- | ----- |
| --verbose    | Enable verbose logging    | false   | -v    |
| --show-token | Show GitHub token on auth | false   | none  |

### Debug Command Options

| Option | Description               | Default | Alias |
| ------ | ------------------------- | ------- | ----- |
| --json | Output debug info as JSON | false   | none  |

## API Endpoints

The server exposes several endpoints to interact with the Claude Switch. It provides OpenAI-compatible endpoints and now also includes support for Anthropic-compatible endpoints, allowing for greater flexibility with different tools and services.

### OpenAI Compatible Endpoints

These endpoints mimic the OpenAI API structure.

| Endpoint                    | Method | Description                                               |
| --------------------------- | ------ | --------------------------------------------------------- |
| `POST /v1/chat/completions` | `POST` | Creates a model response for the given chat conversation. |
| `GET /v1/models`            | `GET`  | Lists the currently available models.                     |
| `POST /v1/embeddings`       | `POST` | Creates an embedding vector representing the input text.  |

### Anthropic Compatible Endpoints

These endpoints are designed to be compatible with the Anthropic Messages API.

| Endpoint                         | Method | Description                                                  |
| -------------------------------- | ------ | ------------------------------------------------------------ |
| `POST /v1/messages`              | `POST` | Creates a model response for a given conversation.           |
| `POST /v1/messages/count_tokens` | `POST` | Calculates the number of tokens for a given set of messages. |

### Usage Monitoring Endpoints

New endpoints for monitoring your Copilot usage and quotas.

| Endpoint     | Method | Description                                                  |
| ------------ | ------ | ------------------------------------------------------------ |
| `GET /usage` | `GET`  | Get detailed Copilot usage statistics and quota information. |
| `GET /token` | `GET`  | Get the current Copilot token being used by the API.         |

## Example Usage

Using with npx:

```sh
# Basic usage with start command
npx claude-switch@latest start

# One-click OpenCode Zen mode (OpenAI-compatible provider)
npx claude-switch@latest start --provider opencode --provider-api-key YOUR_OPENCODE_KEY

# One-click OpenRouter mode
npx claude-switch@latest start --provider openrouter --provider-api-key YOUR_OPENROUTER_KEY

# One-click NVIDIA NIM mode
npx claude-switch@latest start --provider nvidia-nim --provider-api-key YOUR_NVIDIA_KEY

# One-click Gemini (OpenAI-compatible endpoint) mode
npx claude-switch@latest start --provider gemini --provider-api-key YOUR_GEMINI_KEY

# Run on custom port with verbose logging
npx claude-switch@latest start --port 8080 --verbose

# Use with a business plan GitHub account
npx claude-switch@latest start --account-type business

# Use with an enterprise plan GitHub account
npx claude-switch@latest start --account-type enterprise

# Enable manual approval for each request
npx claude-switch@latest start --manual

# Set rate limit to 30 seconds between requests
npx claude-switch@latest start --rate-limit 30

# Wait instead of error when rate limit is hit
npx claude-switch@latest start --rate-limit 30 --wait

# Provide GitHub token directly
npx claude-switch@latest start --github-token ghp_YOUR_TOKEN_HERE

# Run only the auth flow
npx claude-switch@latest auth

# Run auth flow with verbose logging
npx claude-switch@latest auth --verbose

# Show your Copilot usage/quota in the terminal (no server needed)
npx claude-switch@latest check-usage

# Display debug information for troubleshooting
npx claude-switch@latest debug

# Display debug information in JSON format
npx claude-switch@latest debug --json

```

### Provider Presets and Environment Variables

The server can run in two backend modes:

- `copilot` (default): Uses your GitHub Copilot Pro/Business/Enterprise subscription.
- `openai-compatible`: Uses provider presets and routes to `/chat/completions` style APIs.

You can configure provider mode entirely through environment variables (no code changes):

```sh
# Generic
PROVIDER=opencode
PROVIDER_API_KEY=YOUR_KEY
PROVIDER_MODEL=qwen3.6-plus-free
PROVIDER_SMALL_MODEL=qwen3.6-plus-free
PROVIDER_REQUEST_HANDLING_MODE=balanced

# Optional overrides
PROVIDER_BASE_URL=https://opencode.ai/zen/v1
```

Supported presets and default base URLs:

- `opencode` -> `https://opencode.ai/zen/v1`
- `openrouter` -> `https://openrouter.ai/api/v1`
- `groq` -> `https://api.groq.com/openai/v1`
- `xai` -> `https://api.x.ai/v1`
- `nvidia-nim` -> `https://integrate.api.nvidia.com/v1`
- `gemini` -> `https://generativelanguage.googleapis.com/v1beta/openai`
- `custom` -> provide your own `--provider-base-url` / `PROVIDER_BASE_URL`

Preset API key pages shown during startup:

- `opencode`: `https://opencode.ai/settings/keys`
- `openrouter`: `https://openrouter.ai/keys`
- `groq`: `https://console.groq.com/keys`
- `xai`: `https://console.x.ai/team/api-keys`
- `nvidia-nim`: `https://build.nvidia.com/settings/api-keys`
- `gemini`: `https://aistudio.google.com/app/apikey`

### Provider Request Handling Modes

Provider mode supports per-provider request policies:

- `strict`: Exactly one upstream call per incoming request. No automatic 429 retry and no compatibility fallback retry.
- `balanced` (default): Bounded 429 retries and compatibility fallback retries with a hard call budget.
- `resilient`: Larger bounded retry budget and compatibility fallback retries, still bounded by a hard call budget.

Set via switch wizard (recommended per provider), or with startup override:

```sh
npx claude-switch@latest start --provider openrouter --provider-api-key YOUR_KEY --provider-request-handling-mode strict
```

## Using the Usage Viewer

After starting the server, a URL to the Copilot Usage Dashboard will be displayed in your console. This dashboard is a web interface for monitoring your API usage.

1.  Start the server. For example, using npx:
    ```sh
    npx claude-switch@latest start
    ```
2.  The server will output a URL to the usage viewer. Copy and paste this URL into your browser. It will look something like this:
    `https://ericc-ch.github.io/claude-switch?endpoint=http://localhost:4141/usage`
    - If you use the `start.bat` script on Windows, this page will open automatically.

The dashboard provides a user-friendly interface to view your Copilot usage data:

- **API Endpoint URL**: The dashboard is pre-configured to fetch data from your local server endpoint via the URL query parameter. You can change this URL to point to any other compatible API endpoint.
- **Fetch Data**: Click the "Fetch" button to load or refresh the usage data. The dashboard will automatically fetch data on load.
- **Usage Quotas**: View a summary of your usage quotas for different services like Chat and Completions, displayed with progress bars for a quick overview.
- **Detailed Information**: See the full JSON response from the API for a detailed breakdown of all available usage statistics.
- **URL-based Configuration**: You can also specify the API endpoint directly in the URL using a query parameter. This is useful for bookmarks or sharing links. For example:
  `https://ericc-ch.github.io/claude-switch?endpoint=http://your-api-server/usage`

## Using with Claude Code

This proxy can be used to power [Claude Code](https://docs.anthropic.com/en/claude-code), an experimental conversational AI assistant for developers from Anthropic.

There are two ways to configure Claude Code to use this proxy:

### Interactive Setup with `--claude-code` flag

To get started, run the `start` command with the `--claude-code` flag:

```sh
# Copilot Pro backend
npx claude-switch@latest start --claude-code

# Any OpenAI-compatible provider backend
npx claude-switch@latest start --provider opencode --provider-api-key YOUR_OPENCODE_KEY --claude-code
```

You will be prompted to select a primary model and a "small, fast" model for background tasks.

After selection, the CLI now also syncs local Claude settings in your current workspace:
- If `.claude/settings.json` is missing, it creates it with the required proxy `env` keys.
- If the file exists and has unrelated user settings, it asks before merging.
- If existing JSON is invalid, it asks before overwriting.

The launch command is still copied to clipboard as a fallback/compatibility path.

Paste and run this command in a new terminal to launch Claude Code.
If you approved settings sync, future runs in the same workspace should already have the required `ANTHROPIC_*` values.

### Manual Configuration with `settings.json`

Alternatively, you can configure Claude Code by creating a `.claude/settings.json` file in your project's root directory. This file should contain the environment variables needed by Claude Code. This way you don't need to run the interactive setup every time.

Here is an example `.claude/settings.json` file:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:4141",
    "ANTHROPIC_AUTH_TOKEN": "dummy",
    "ANTHROPIC_MODEL": "gpt-4.1",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "gpt-4.1",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "gpt-4.1",
    "ANTHROPIC_SMALL_FAST_MODEL": "gpt-4.1",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "gpt-4.1",
    "DISABLE_NON_ESSENTIAL_MODEL_CALLS": "1",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
  },
  "permissions": {
    "deny": [
      "WebSearch"
    ]
  }
}
```

You can find more options here: [Claude Code settings](https://docs.anthropic.com/en/docs/claude-code/settings#environment-variables)

You can also read more about IDE integration here: [Add Claude Code to your IDE](https://docs.anthropic.com/en/docs/claude-code/ide-integrations)

## Running from Source

The project can be run from source in several ways:

### Development Mode

```sh
bun run dev
```

### Production Mode

```sh
bun run start
```

## Stable Global Snapshot (Dev-Safe)

If you actively develop in this repo, your global `claude-switch` command can become linked to the workspace and break when local builds fail.

Install a standalone stable snapshot (non-linked global install):

```sh
npm run stable:install
```

What this does:
- builds `dist`
- packs a tarball snapshot
- removes any existing global link/install
- installs a standalone global copy

After this, `claude-switch` is runnable from any directory and is not affected by ongoing local development changes until you run `npm run stable:install` again.

## Usage Tips

- To avoid hitting GitHub Copilot's rate limits, you can use the following flags:
  - `--manual`: Enables manual approval for each request, giving you full control over when requests are sent.
  - `--rate-limit <seconds>`: Enforces a minimum time interval between requests. For example, `claude-switch start --rate-limit 30` will ensure there's at least a 30-second gap between requests.
  - `--wait`: Use this with `--rate-limit`. It makes the server wait for the cooldown period to end instead of rejecting the request with an error. This is useful for clients that don't automatically retry on rate limit errors.
- If you have a GitHub business or enterprise plan account with Copilot, use the `--account-type` flag (e.g., `--account-type business`). See the [official documentation](https://docs.github.com/en/enterprise-cloud@latest/copilot/managing-copilot/managing-github-copilot-in-your-organization/managing-access-to-github-copilot-in-your-organization/managing-github-copilot-access-to-your-organizations-network#configuring-copilot-subscription-based-network-routing-for-your-enterprise-or-organization) for more details.
