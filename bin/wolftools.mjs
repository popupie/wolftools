#!/usr/bin/env node

import { runCli } from "../src/cli.mjs";

runCli(process.argv.slice(2))
  .then((message) => process.stdout.write(`${message}\n`))
  .catch((error) => {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
