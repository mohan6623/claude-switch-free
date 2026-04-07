import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  mergeClaudeSettingsJson,
  resolveClaudeSettingsLocalPath,
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
})
