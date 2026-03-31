import { defineCommand } from 'citty'
import { resolve } from 'pathe'
import consola from 'consola'

export default defineCommand({
  meta: {
    name: 'tokens',
    description: 'Extract design system tokens from a Vue project',
  },
  args: {
    path: {
      type: 'positional',
      description: 'Path to the Vue project root',
      default: '.',
    },
    output: {
      type: 'string',
      description: 'Output directory',
      alias: 'o',
      default: '.vue-harvest',
    },
    json: {
      type: 'boolean',
      description: 'Output JSON to stdout',
    },
  },
  async run({ args }) {
    const { analyzeTokens, writeDesignSystemOutput } = await import(
      '../index.js'
    )

    const report = await analyzeTokens(resolve(args.path))

    if (args.json) {
      process.stdout.write(JSON.stringify(report, null, 2))
      return
    }

    await writeDesignSystemOutput(report, resolve(args.output))

    consola.box(
      [
        'Design System Tokens',
        '',
        `Colors:  ${report.stats.uniqueColors}`,
        `Fonts:   ${report.typography.families.length} families, ${report.stats.uniqueFontSizes} sizes`,
        `Spacing: ${report.stats.uniqueSpacingValues} values`,
        `Total:   ${report.stats.totalTokens} tokens`,
        `Tokenized: ${Math.round(report.stats.tokenizationRate * 100)}%`,
      ].join('\n')
    )
  },
})
