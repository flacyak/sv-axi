#!/usr/bin/env node
import { run } from "./cli.js";
import { EXIT, emitError } from "./output.js";

run(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    // Last-resort guard: translate any unexpected failure into a structured
    // error on stdout instead of leaking a raw stack trace (AXI §6).
    process.exit(
      emitError(err instanceof Error ? err.message : String(err), { code: EXIT.ERROR }),
    );
  },
);
