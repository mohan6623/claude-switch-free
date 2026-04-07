#!/usr/bin/env node

import { defineCommand } from "citty"
import consola from "consola"

import { runSwitchConfiguration } from "./start"

interface RunSwitchOptions {
  verbose: boolean
}

export async function runSwitch(options: RunSwitchOptions): Promise<void> {
  if (options.verbose) {
    consola.level = 5
    consola.info("Verbose logging enabled")
  }

  await runSwitchConfiguration()
}

export const switchCommand = defineCommand({
  meta: {
    name: "switch",
    description: "Open interactive configuration switcher without starting the proxy server",
  },
  args: {
    verbose: {
      alias: "v",
      type: "boolean",
      default: false,
      description: "Enable verbose logging",
    },
  },
  run({ args }) {
    return runSwitch({
      verbose: args.verbose,
    })
  },
})
