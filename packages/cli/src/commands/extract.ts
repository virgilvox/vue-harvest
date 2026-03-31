import { defineCommand } from 'citty'
import { resolve } from 'pathe'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'pathe'
import consola from 'consola'

export default defineCommand({
  meta: {
    name: 'extract',
    description: 'Extract a component and its dependencies into a standalone bundle',
  },
  args: {
    name: {
      type: 'positional',
      description: 'Component name in PascalCase',
      required: true,
    },
    path: {
      type: 'string',
      description: 'Project root path',
      default: '.',
    },
    output: {
      type: 'string',
      description: 'Output directory',
      alias: 'o',
      default: '.vue-harvest/components',
    },
    force: {
      type: 'boolean',
      description: 'Extract even if below confidence threshold',
    },
  },
  async run({ args }) {
    const { analyze, extractComponent, resolveConfig } = await import('../index.js')

    const root = resolve(args.path)
    const report = await analyze(root)

    const comp = report.components.get(args.name)
    if (!comp) {
      const available = [...report.components.keys()].join(', ')
      consola.error(`Component "${args.name}" not found. Available: ${available}`)
      process.exit(1)
    }

    const config = resolveConfig(root)
    const thresholdPct = Math.round(config.extractionThreshold * 100)
    const pct = Math.round(comp.extractionConfidence * 100)

    if (pct < thresholdPct && !args.force) {
      consola.warn(
        `${args.name} confidence is ${pct}% (below ${thresholdPct}% threshold). Use --force to extract anyway.`
      )
      process.exit(1)
    }

    const pkgPath = resolve(root, 'package.json')
    const pkg = existsSync(pkgPath)
      ? JSON.parse(readFileSync(pkgPath, 'utf-8'))
      : {}
    const projectDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    }

    // If forcing, override threshold to 0 so extractor does not warn
    const extractConfig = args.force
      ? resolveConfig(root, { extractionThreshold: 0 })
      : config

    const result = extractComponent(
      args.name,
      report.components,
      report.graph,
      extractConfig,
      projectDeps
    )

    if (!result.success) {
      consola.error('Extraction failed:')
      for (const issue of result.issues) {
        consola.log(`  [${issue.severity}] ${issue.message}`)
      }
      process.exit(1)
    }

    // Write files
    const outDir = resolve(args.output, args.name)
    mkdirSync(outDir, { recursive: true })

    for (const [filePath, content] of Object.entries(result.files)) {
      const fullPath = join(outDir, filePath)
      const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))
      mkdirSync(dir, { recursive: true })
      writeFileSync(fullPath, content)
    }

    writeFileSync(
      join(outDir, 'manifest.json'),
      JSON.stringify(result.manifest, null, 2)
    )

    consola.success(`Extracted ${args.name} to ${outDir}`)
    consola.info(`  Files: ${Object.keys(result.files).length}`)
    consola.info(
      `  Peer deps: ${Object.keys(result.manifest.peerDependencies).join(', ')}`
    )

    if (result.issues.length > 0) {
      consola.warn('Notes:')
      for (const issue of result.issues) {
        consola.log(`  [${issue.severity}] ${issue.message}`)
      }
    }
  },
})
