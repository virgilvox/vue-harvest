import { defineCommand, runMain } from 'citty'

const main = defineCommand({
  meta: {
    name: 'vue-harvest',
    version: '0.0.2',
    description:
      'Extract reusable component libraries and design tokens from Vue applications',
  },
  subCommands: {
    analyze: () => import('./commands/analyze.js').then((m) => m.default),
    list: () => import('./commands/list.js').then((m) => m.default),
    inspect: () => import('./commands/inspect.js').then((m) => m.default),
    extract: () => import('./commands/extract.js').then((m) => m.default),
    tokens: () => import('./commands/tokens.js').then((m) => m.default),
    init: () => import('./commands/init.js').then((m) => m.default),
  },
})

runMain(main)
