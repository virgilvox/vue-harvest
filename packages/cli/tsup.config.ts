import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node20',
  banner: ({ format }) => {
    // Only add shebang to CLI entry
    return {}
  },
  esbuildOptions(options) {
    options.banner = {
      js: '',
    }
  },
  onSuccess: 'node -e "const fs = require(\'fs\'); const p = \'dist/cli.js\'; const c = fs.readFileSync(p, \'utf8\'); if (!c.startsWith(\'#!/\')) fs.writeFileSync(p, \'#!/usr/bin/env node\\n\' + c); fs.chmodSync(p, 0o755);"',
})
