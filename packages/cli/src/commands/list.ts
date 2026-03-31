import { defineCommand } from 'citty'
import { resolve } from 'pathe'
import consola from 'consola'

export default defineCommand({
  meta: {
    name: 'list',
    description: 'List all components sorted by extraction confidence',
  },
  args: {
    path: {
      type: 'positional',
      description: 'Path to the Vue project root',
      default: '.',
    },
    tier: {
      type: 'string',
      description: 'Filter by tier (primitive, composite, feature, page-bound, app-specific)',
    },
    json: {
      type: 'boolean',
      description: 'Output JSON',
    },
  },
  async run({ args }) {
    const { analyze } = await import('../index.js')

    const report = await analyze(resolve(args.path))
    let components = [...report.components.values()]

    if (args.tier) {
      components = components.filter((c) => c.tier === args.tier)
    }

    components.sort((a, b) => b.extractionConfidence - a.extractionConfidence)

    if (args.json) {
      const output = components.map((c) => ({
        name: c.name,
        file: c.filePath,
        tier: c.tier,
        confidence: Math.round(c.extractionConfidence * 100),
        loc: c.loc.total,
        props: c.props.length,
        emits: c.emits.length,
        slots: c.slots.length,
        issues: c.couplingIssues.length,
      }))
      process.stdout.write(JSON.stringify(output, null, 2))
      return
    }

    for (const c of components) {
      const pct = Math.round(c.extractionConfidence * 100)
      const bar = pct >= 70 ? '●' : pct >= 40 ? '◐' : '○'
      consola.log(
        `${bar} ${c.name.padEnd(30)} ${String(pct + '%').padStart(5)} ${c.tier.padEnd(12)} ${c.loc.total} LOC  ${c.couplingIssues.length > 0 ? `(${c.couplingIssues.length} issues)` : ''}`
      )
    }
  },
})
