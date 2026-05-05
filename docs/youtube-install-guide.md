# YouTube Install Guide: Claude Switch Free

## Video Title Ideas
- Use Claude Code FOR FREE with Copilot/OpenRouter Proxy!
- Stop Paying for Claude Code! Run Claude Switch Free in 2 Minutes
- Claude Code Free Proxy: Step-by-Step Installation

## Step 1: Explain What It Is (0:00 - 0:30)
**Visual:** Show the GitHub repository (`https://github.com/mohan6623/claude-switch-free`)
**Script:** "Hey everyone! Claude Code is amazing, but the API costs can add up fast. Today I'm going to show you an open-source proxy we built called **Claude Switch Free**. It lets you run Claude Code using your existing GitHub Copilot subscription, or cheap/free providers via OpenRouter or Gemini—all routed through a single local server. Let's get it installed!"

## Step 2: Choose Your Installation Method (0:30 - 1:30)

### Method A: For Developers (Using npm/npx)
**Visual:** Open a terminal and run the `npx` command.
**Script:** "If you already have Node.js installed, this is the easiest way. Just open your terminal and run:"
```sh
npx claude-switch-free start
```
"This will automatically download and start the proxy."

### Method B: Standalone File (No Node.js needed)
**Visual:** Show the GitHub "Releases" page, download the `.exe`, and run it.
**Script:** "If you don't have Node installed, no problem. Head over to the GitHub Releases page. Download the standalone executable for Windows, macOS, or Linux. For Windows, download `claude-switch-free-win.exe`, double click it, or run it from your terminal like this:"
```powershell
.\claude-switch-free-win.exe start
```

## Step 3: First-Time Setup (1:30 - 2:30)
**Visual:** Terminal showing the setup wizard prompts.
**Script:** "When you run it for the first time, the wizard will ask you to configure your first slot. You can set up GitHub Copilot as a free proxy, or drop in an OpenRouter API key. Just follow the prompts. Once you finish, the server will start on `http://localhost:4141`."

## Step 4: Using it with Claude Code (2:30 - 3:30)
**Visual:** Side-by-side terminal. One running the proxy, the other running Claude Code.
**Script:** "Now that the proxy is running, let's connect Claude Code to it! In a new terminal, tell Claude Code to use our local proxy by setting these environment variables:"

**For Windows (PowerShell):**
```powershell
$env:ANTHROPIC_BASE_URL="http://localhost:4141"
$env:ANTHROPIC_API_KEY="sk-proxy"
npx @anthropic-ai/claude-code
```

**For Mac/Linux:**
```sh
export ANTHROPIC_BASE_URL="http://localhost:4141"
export ANTHROPIC_API_KEY="sk-proxy"
npx @anthropic-ai/claude-code
```
**Script:** "And boom! Claude Code is now communicating through your free proxy. You can use it as much as you want without worrying about direct Anthropic API billing!"

## Step 5: Managing Models and Dashboard (3:30 - 4:00)
**Visual:** Show the `switch` command and the web dashboard.
**Script:** "If you ever want to change models, just open a new terminal and run:"
```sh
npx claude-switch-free switch
```
"Or open your browser to `http://localhost:4141/dashboard` to see your usage metrics. And that's it! The link to the GitHub repo is in the description. Don't forget to star the repo if this saved you money. See you next time!"
