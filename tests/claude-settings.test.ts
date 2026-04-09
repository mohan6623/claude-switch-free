import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  loadClaudeModelSlotsForTarget,
  mergeClaudeSettingsJson,
  resolveClaudeSettingsGlobalPath,
  resolveClaudeSettingsLocalPath,
  syncClaudeSettingsGlobal,
  syncClaudeSettingsLocal,
} from "../src/lib/claude-settings"

describe("claude settings sync", () => {
  test("merges slot env values into existing settings without losing other fields", () => {
    const merged = mergeClaudeSettingsJson(
      {
        env: {
          ANTHROPIC_AUTH_TOKEN: "existing-token",
          ANTHROPIC_MODEL: "old-model",
        },
        outputStyle: "Explanatory",
      },
      {
        ANTHROPIC_BASE_URL: "http://localhost:4141",
        ANTHROPIC_MODEL: "cpapi-route:openrouter::qwen%2Fqwen3.6-plus%3Afree",
      },
    )

    expect(merged.outputStyle).toBe("Explanatory")
    expect(merged.env.ANTHROPIC_AUTH_TOKEN).toBe("existing-token")
    expect(merged.env.ANTHROPIC_BASE_URL).toBe("http://localhost:4141")
    expect(merged.env.ANTHROPIC_MODEL).toBe(
      "cpapi-route:openrouter::qwen%2Fqwen3.6-plus%3Afree",
    )
  })

  test("resolves nearest settings.local.json by walking parent directories", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cpapi-claude-settings-"))
    const app = path.join(root, "app")
    const nested = path.join(app, "nested", "dir")
    const claudeDir = path.join(root, ".claude")
    const settingsPath = path.join(claudeDir, "settings.local.json")

    await fs.mkdir(nested, { recursive: true })
    await fs.mkdir(claudeDir, { recursive: true })
    await fs.writeFile(settingsPath, JSON.stringify({ env: {} }, null, 2), "utf8")

    const resolved = await resolveClaudeSettingsLocalPath(nested)
    expect(resolved).toBe(settingsPath)
  })

  test("resolves nearest settings.json when settings.local.json is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cpapi-claude-settings-"))
    const nested = path.join(root, "nested", "dir")
    const claudeDir = path.join(root, ".claude")
    const settingsPath = path.join(claudeDir, "settings.json")

    await fs.mkdir(nested, { recursive: true })
    await fs.mkdir(claudeDir, { recursive: true })
    await fs.writeFile(settingsPath, JSON.stringify({ env: {} }, null, 2), "utf8")

    const resolved = await resolveClaudeSettingsLocalPath(nested)
    expect(resolved).toBe(settingsPath)
  })

  test("writes synchronized env values to settings.local.json", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cpapi-claude-settings-"))
    const claudeDir = path.join(root, ".claude")
    const settingsPath = path.join(claudeDir, "settings.local.json")

    await fs.mkdir(claudeDir, { recursive: true })
    await fs.writeFile(
      settingsPath,
      JSON.stringify(
        {
          env: {
            ANTHROPIC_AUTH_TOKEN: "keep-me",
            ANTHROPIC_MODEL: "old-model",
          },
          outputStyle: "Explanatory",
        },
        null,
        2,
      ),
      "utf8",
    )

    const result = await syncClaudeSettingsLocal(root, {
      ANTHROPIC_BASE_URL: "http://localhost:4141",
      ANTHROPIC_MODEL: "cpapi-route:copilot::claude-sonnet-4.5",
    })

    expect(result.updated).toBe(true)
    expect(result.path).toBe(settingsPath)

    const after = JSON.parse(await fs.readFile(settingsPath, "utf8")) as {
      env: Record<string, string>
      outputStyle?: string
    }

    expect(after.outputStyle).toBe("Explanatory")
    expect(after.env.ANTHROPIC_AUTH_TOKEN).toBe("keep-me")
    expect(after.env.ANTHROPIC_BASE_URL).toBe("http://localhost:4141")
    expect(after.env.ANTHROPIC_MODEL).toBe("cpapi-route:copilot::claude-sonnet-4.5")
  })

  test("resolves global settings.json under home directory", () => {
    const resolved = resolveClaudeSettingsGlobalPath("/tmp/cpapi-home")
    expect(resolved).toBe(path.join("/tmp/cpapi-home", ".claude", "settings.json"))
  })

  test("loads slot models from local target using settings.local.json precedence", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cpapi-claude-settings-local-load-"))
    const claudeDir = path.join(root, ".claude")
    const settingsLocalPath = path.join(claudeDir, "settings.local.json")
    const settingsPath = path.join(claudeDir, "settings.json")

    await fs.mkdir(claudeDir, { recursive: true })
    await fs.writeFile(
      settingsPath,
      JSON.stringify(
        {
          env: {
            ANTHROPIC_MODEL: "cpapi-route:openrouter::gpt-5",
          },
        },
        null,
        2,
      ),
      "utf8",
    )
    await fs.writeFile(
      settingsLocalPath,
      JSON.stringify(
        {
          env: {
            ANTHROPIC_MODEL: "cpapi-route:copilot::claude-sonnet-4.5",
            ANTHROPIC_DEFAULT_SONNET_MODEL: "cpapi-route:copilot::claude-sonnet-4.5",
            ANTHROPIC_DEFAULT_OPUS_MODEL: "cpapi-route:copilot::gemini-3.1-pro",
            ANTHROPIC_DEFAULT_HAIKU_MODEL: "cpapi-route:opencode::minimax-m2.5-free",
          },
        },
        null,
        2,
      ),
      "utf8",
    )

    const loaded = await loadClaudeModelSlotsForTarget("local", root)

    expect(loaded?.path).toBe(settingsLocalPath)
    expect(loaded?.slots.defaultModel).toBe("cpapi-route:copilot::claude-sonnet-4.5")
    expect(loaded?.slots.bigModel).toBe("cpapi-route:copilot::gemini-3.1-pro")
    expect(loaded?.slots.haikuModel).toBe("cpapi-route:opencode::minimax-m2.5-free")
  })

  test("loads slot models from global target with settings.local.json fallback", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "cpapi-claude-settings-global-load-"))
    const claudeDir = path.join(homeDir, ".claude")
    const settingsLocalPath = path.join(claudeDir, "settings.local.json")

    await fs.mkdir(claudeDir, { recursive: true })
    await fs.writeFile(
      settingsLocalPath,
      JSON.stringify(
        {
          env: {
            ANTHROPIC_DEFAULT_SONNET_MODEL: "cpapi-route:copilot::claude-sonnet-4.5",
            ANTHROPIC_DEFAULT_OPUS_MODEL: "cpapi-route:copilot::gemini-3.1-pro",
            ANTHROPIC_SMALL_FAST_MODEL: "cpapi-route:opencode::minimax-m2.5-free",
          },
        },
        null,
        2,
      ),
      "utf8",
    )

    const loaded = await loadClaudeModelSlotsForTarget(
      "global",
      process.cwd(),
      { homeDir },
    )

    expect(loaded?.path).toBe(settingsLocalPath)
    expect(loaded?.slots.defaultModel).toBe("cpapi-route:copilot::claude-sonnet-4.5")
    expect(loaded?.slots.bigModel).toBe("cpapi-route:copilot::gemini-3.1-pro")
    expect(loaded?.slots.haikuModel).toBe("cpapi-route:opencode::minimax-m2.5-free")
  })

  test("writes synchronized env values to global settings.json", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "cpapi-claude-settings-global-"))
    const settingsPath = path.join(homeDir, ".claude", "settings.json")

    await fs.mkdir(path.dirname(settingsPath), { recursive: true })
    await fs.writeFile(
      settingsPath,
      JSON.stringify(
        {
          env: {
            ANTHROPIC_AUTH_TOKEN: "keep-me",
            ANTHROPIC_MODEL: "old-model",
          },
          outputStyle: "Explanatory",
        },
        null,
        2,
      ),
      "utf8",
    )

    const result = await syncClaudeSettingsGlobal(
      {
        ANTHROPIC_BASE_URL: "http://localhost:4141",
        ANTHROPIC_MODEL: "cpapi-route:openrouter::qwen%2Fqwen3.6-plus%3Afree",
      },
      { homeDir },
    )

    expect(result.updated).toBe(true)
    expect(result.path).toBe(settingsPath)

    const after = JSON.parse(await fs.readFile(settingsPath, "utf8")) as {
      env: Record<string, string>
      outputStyle?: string
    }

    expect(after.outputStyle).toBe("Explanatory")
    expect(after.env.ANTHROPIC_AUTH_TOKEN).toBe("keep-me")
    expect(after.env.ANTHROPIC_BASE_URL).toBe("http://localhost:4141")
    expect(after.env.ANTHROPIC_MODEL).toBe(
      "cpapi-route:openrouter::qwen%2Fqwen3.6-plus%3Afree",
    )
  })
})
