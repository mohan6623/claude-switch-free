# claude-switch-free

A free-first, multi-provider proxy designed to let you use **Claude Code** for free by routing its internal models (Opus, Sonnet, Haiku) to any AI provider on the internet. 

Break free from vendor lock-in and test Claude Code without relying exclusively on Anthropic's platform! 

## Why use this proxy?

Claude Code expects to talk to Anthropic's servers using three slots: `opus`, `sonnet`, and `haiku`. This proxy sits in the middle and lets you map **different providers and different models to each slot simultaneously**.

- **Use Claude Code for Free**: Map slots to providers that offer free API access (e.g., OpenRouter, NVIDIA, Google AI Studio) to use Claude Code without paying.
- **Mix & Match Providers**: You are **not** bound to one provider per session. Slots are completely independent and incredibly flexible:
  - Assign Google's **Gemini 3.1 Pro** to the `opus` slot.
  - Assign **GitHub Copilot's** models to the `sonnet` slot.
  - Assign NVIDIA's **Qwen 2.5** to the `haiku` slot.
  - *Or, use the same provider for multiple slots if you prefer!*
- **Full OpenAI/Anthropic Compatibility**: Exposes endpoints that seamlessly translate requests for any standard client.

## Installation & Usage

To prevent conflicts with other packages on the internet, our command is named `claude-switch-free`. You can use it via `npx` (requires Node.js) or by downloading a standalone executable (no dependencies required).

### Prerequisites

- **Standalone executable:** no Node.js, npm, npx, or Bun required.
- **`npx` install:** Node.js is required.
- **Source/developer setup:** Node.js 18+ and Bun 1.2+ are required.
- **Proxy access:** you still need either a GitHub Copilot account or a provider API key, depending on how you configure the proxy.

### Option 1: Using `npx` (Recommended)

If you have Node.js installed, you can run the proxy immediately without downloading anything manually:

```sh
npx claude-switch-free start
```

### Option 2: Standalone Executable (No Node.js Required)

If you don't want to install Node.js or npm, you can download the standalone binary for your operating system from the [Releases](https://github.com/mohan6623/claude-switch-free/releases) page.

**Windows**
```powershell
Invoke-WebRequest -Uri "https://github.com/mohan6623/claude-switch-free/releases/latest/download/claude-switch-free-windows-x64.exe" -OutFile "$env:USERPROFILE\claude-switch-free.exe"
& "$env:USERPROFILE\claude-switch-free.exe" start
```

**macOS**
```sh
curl -L -o claude-switch-free https://github.com/mohan6623/claude-switch-free/releases/latest/download/claude-switch-free-mac
chmod +x claude-switch-free
./claude-switch-free start
```

**Linux**
```sh
curl -L -o claude-switch-free https://github.com/mohan6623/claude-switch-free/releases/latest/download/claude-switch-free-linux
chmod +x claude-switch-free
./claude-switch-free start
```

## Basic Commands

Once downloaded or via `npx`, the proxy runs locally.

### 1. First-Time Setup
If this is your first time using the proxy, you need to configure your providers and link them to slots.
```sh
claude-switch-free switch
```
*Configure your providers, assign the desired models to the `opus`, `sonnet`, and `haiku` slots, then save and exit.*

### 2. Daily Usage
If you have already configured your provider settings, you don't need to run `switch` every time. Simply start the proxy:
```sh
claude-switch-free start
```
*The proxy will use your saved configuration and start routing traffic automatically.*

### 3. Stop & Revert (Original State)
If you want to stop using the proxy and go back to the original, normal state of Claude Code (relying entirely on Anthropic's platform or your subscription), run:
```sh
claude-switch-free stop
```
*This will revert any local changes made by the proxy and restore Claude Code to its default behavior.*

### Other Commands
- `claude-switch-free auth` - Re-authenticate with GitHub Copilot (if using Copilot as a provider).
- `claude-switch-free check-usage` - Check your token usage.

---

## Developer Setup

If you want to contribute, modify the proxy, or build it yourself, follow the instructions below. 

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [Bun](https://bun.sh/) (v1.2+)

### 1. Clone & Install
```sh
git clone https://github.com/mohan6623/claude-switch-free.git
cd claude-switch-free
bun install
```

### 2. Run in Development Mode
Start the development server with hot-reload enabled:
```sh
bun run dev
```

### 3. Build the Project
To compile the TypeScript code into the `dist/` directory:
```sh
bun run build
```

### 4. Build Standalone Executables
You can compile the project into single-file native executables for all platforms. The output files will be placed in the `dist/` folder:
```sh
# Build for all platforms
bun run build:exe:all

# Or build for specific platforms:
bun run build:exe:win
bun run build:exe:mac
bun run build:exe:linux
```

### 5. Quality Checks
Run tests and the linter before submitting a pull request:
```sh
bun test
bun run lint
```
