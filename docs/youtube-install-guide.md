# YouTube Install Guide

## Video Title Ideas

- Run Claude Switch Free on Any Computer in 2 Minutes
- Free-First Claude Code Proxy Setup: No Node, No npm, No Build Step
- Install claude-switch-free From GitHub Releases

## Short Video Flow

1. Show the GitHub repository:
   `https://github.com/mohan6623/claude-switch-free`
2. Explain the goal:
   "This gives you a local OpenAI/Anthropic-compatible proxy for Claude Code and other tools, with free-first provider support and Copilot support."
3. Mention the requirement:
   "You only need one backend credential: either a provider API key or GitHub Copilot."
4. Install the binary for the operating system.
5. Run the first-time setup:
   `claude-switch start`
6. Change models later:
   `claude-switch switch`
7. Show the local dashboard:
   `http://localhost:4141/dashboard`

## Windows Commands

```powershell
Invoke-WebRequest -Uri "https://github.com/mohan6623/claude-switch-free/releases/latest/download/claude-switch-windows-x64.exe" -OutFile "$env:USERPROFILE\claude-switch.exe"
& "$env:USERPROFILE\claude-switch.exe" start
```

Optional shortcut after download:

```powershell
& "$env:USERPROFILE\claude-switch.exe" switch
```

## Linux Commands

```sh
curl -L -o claude-switch https://github.com/mohan6623/claude-switch-free/releases/latest/download/claude-switch-linux-x64
chmod +x claude-switch
./claude-switch start
```

## macOS Commands

```sh
curl -L -o claude-switch https://github.com/mohan6623/claude-switch-free/releases/latest/download/claude-switch-macos
chmod +x claude-switch
./claude-switch start
```

## Suggested Script

Today I am showing how to install `claude-switch-free`, a local proxy that lets Claude Code and OpenAI or Anthropic-compatible clients talk to multiple backends through one local server.

The easiest install path is the standalone GitHub release binary. You do not need to clone the repo, install dependencies, or build the project.

Download the binary for your operating system, run `claude-switch start`, and follow the setup wizard. You can use a GitHub Copilot subscription, or add a provider API key such as OpenRouter, Gemini-compatible providers, or a custom OpenAI-compatible endpoint.

After setup, the daily commands are simple:

```sh
claude-switch start
claude-switch switch
```

The server exposes OpenAI-compatible and Anthropic-compatible endpoints locally, and the dashboard is available at:

```text
http://localhost:4141/dashboard
```

Always keep your provider API keys private, and check each provider's usage limits and terms.
