#!/usr/bin/env node

import { defineCommand, runMain } from "citty"

import { auth } from "./auth"
import { checkUsage } from "./check-usage"
import { debug } from "./debug"
import { start } from "./start"
import { switchCommand } from "./switch"

const main = defineCommand({
  meta: {
    name: "claude-switch",
    description:
      "A wrapper around GitHub Claude Switch to make it OpenAI compatible, making it usable for other tools.",
  },
  subCommands: {
    auth,
    start,
    switch: switchCommand,
    "check-usage": checkUsage,
    debug,
  },
})

await runMain(main)
