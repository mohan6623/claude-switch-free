import { describe, expect, test } from "bun:test"

import type { StartupConfig } from "../src/lib/startup-config"

import { persistSwitchConfig } from "../src/lib/switch-persistence"

describe("switch persistence", () => {
  test("runs claude sync before saving startup config", async () => {
    const calls: Array<string> = []
    const config: StartupConfig = {
      version: 1,
      providers: [],
      activeProviderId: undefined,
    }

    await persistSwitchConfig({
      config,
      sync: () => {
        calls.push("sync")
        return Promise.resolve()
      },
      save: () => {
        calls.push("save")
        return Promise.resolve()
      },
    })

    expect(calls).toEqual(["sync", "save"])
  })
})
