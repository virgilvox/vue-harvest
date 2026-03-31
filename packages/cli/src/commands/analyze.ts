import { defineCommand } from 'citty'
import { resolve } from 'pathe'
import consola from 'consola'

export default defineCommand({
  meta: {
    name: 'analyze',
    description: 'Analyze a Vue project and extract reusable components',
  },
  args: {
    path: {
      type: 'positional',
      description: 'Path to the Vue project root',
      default: '.',
    },
    threshold: {
      type: 'string',
      description: 'Extraction confidence threshold 0-100 (default: 70)',
    },
    output: {
      type: 'string',
      description: 'Output directory (default: .vue-harvest)',
      alias: 'o',
    },
    json: {
      type: 'boolean',
      description: 'Output JSON to stdout',
    },
  },
  async run({ args }) {
    const { analyze, writeOutput } = await import('../index.js')

    const threshold = args.threshold ? parseInt(args.threshold, 10) / 100 : undefined

    const report = await analyze(resolve(args.path), {
      extractionThreshold: threshold,
      outDir: args.output,
    })

    if (args.json) {
      const output = {
        summary: report.summary,
        components: [...report.components.entries()].map(([name, c]) => ({
          name,
          tier: c.tier,
          confidence: Math.round(c.extractionConfidence * 100),
          loc: c.loc.total,
          props: c.props.length,
          issues: c.couplingIssues.length,
        })),
      }
      process.stdout.write(JSON.stringify(output, null, 2))
      return
    }

    await writeOutput(report)

    // Summary table
    consola.box(
      [
        `Vue Harvest Analysis`,
        ``,
        `Components: ${report.summary.analyzed}`,
        `Auto-extracted: ${report.summary.autoExtracted}`,
        `Needs review: ${report.summary.needsMCP}`,
        ``,
        Object.entries(report.summary.byTier)
          .sort((a, b) => b[1] - a[1])
          .map(([tier, count]) => `  ${tier}: ${count}`)
          .join('\n'),
      ].join('\n')
    )
  },
})
