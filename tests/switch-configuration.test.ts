import { describe, expect, test } from "bun:test"

import {
  buildSwitchConfigurationActions,
  resolveSwitchConfigurationDefaultAction,
} from "../src/start"

describe("switch configuration menu", () => {
  test("omits continue and provider switch shortcuts", () => {
    const actions = buildSwitchConfigurationActions()

    expect(actions).not.toContain("Continue with current config")
    expect(actions).not.toContain("Switch configured provider/model")
    expect(actions).toContain("Add provider")
    expect(actions).toContain("Change model mappings")
  })

  test("defaults to changing model mappings when opening switch mode", () => {
    expect(resolveSwitchConfigurationDefaultAction()).toBe(
      "Change model mappings",
    )
  })
})
