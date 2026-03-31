import { resolve } from 'pathe'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import glob from 'fast-glob'
import consola from 'consola'
import type {
  AnalyzedComponent,
  ComponentGraph,
  HarvestConfig,
  HarvestRegistry,
  ExtractionResult,
  DesignSystemReport,
} from './types.js'
import { resolveConfig, resolveProjectMeta } from './utils/config.js'
import { analyzeSFC } from './analyzers/sfc-analyzer.js'
import { buildComponentGraph } from './analyzers/graph-builder.js'
import { extractComponent, autoExtract } from './extractors/component-extractor.js'
import {
  generateRegistry,
  writeRegistry,
  generateCatalogHTML,
} from './generators/registry.js'
import {
  analyzeDesignSystem,
  generateTokenCSS,
  generateDesignSystemHTML,
} from './analyzers/design-system-analyzer.js'

// --- Analysis Report ---

export interface AnalysisReport {
  config: HarvestConfig
  components: Map<string, AnalyzedComponent>
  graph: ComponentGraph
  registry: HarvestRegistry
  extractions: Map<string, ExtractionResult>
  summary: {
    totalFiles: number
    analyzed: number
    errors: number
    byTier: Record<string, number>
    autoExtracted: number
    needsMCP: number
  }
}

// --- Full Pipeline ---

export async function analyze(
  rootPath: string,
  overrides: Partial<HarvestConfig> = {}
): Promise<AnalysisReport> {
  const root = resolve(rootPath)

  if (!existsSync(root)) {
    throw new Error(`Project root does not exist: ${root}`)
  }

  consola.start(`Analyzing Vue project at ${root}`)

  const config = resolveConfig(root, overrides)
  const meta = resolveProjectMeta(root)

  consola.info(
    `Detected: ${meta.framework} project ${meta.typescript ? '(TypeScript)' : '(JavaScript)'}${meta.tailwind ? ' + Tailwind' : ''}`
  )

  // Discover .vue files
  const files = await glob(config.include, {
    cwd: config.root,
    ignore: config.exclude,
    absolute: false,
  })

  files.sort()
  consola.info(`Found ${files.length} Vue files`)

  if (files.length === 0) {
    throw new Error('No .vue files found. Check your include/exclude patterns.')
  }

  // Analyze each SFC
  const components = new Map<string, AnalyzedComponent>()
  let errors = 0

  for (const file of files) {
    try {
      const absolutePath = resolve(config.root, file)
      const analyzed = await analyzeSFC(
        file,
        absolutePath,
        config.root,
        config.aliases
      )
      if (components.has(analyzed.name)) {
        const existing = components.get(analyzed.name)!
        consola.warn(
          `Duplicate component name "${analyzed.name}": ${file} conflicts with ${existing.filePath}. Using ${file}.`
        )
      }
      components.set(analyzed.name, analyzed)
    } catch (err: any) {
      consola.warn(`Failed to analyze ${file}: ${err.message}`)
      errors++
    }
  }

  consola.success(`Analyzed ${components.size} components (${errors} errors)`)

  // Build dependency graph
  const graph = buildComponentGraph(
    [...components.values()],
    config.root,
    config.aliases
  )

  consola.info(
    `Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.leaves.length} leaves, ${graph.cycles.length} cycles`
  )

  if (graph.cycles.length > 0) {
    consola.warn('Circular dependencies detected:')
    for (const cycle of graph.cycles) {
      consola.warn(`  ${cycle.join(' → ')} → ${cycle[0]}`)
    }
  }

  // Read project deps for extraction
  const pkgPath = resolve(root, 'package.json')
  const pkg = existsSync(pkgPath)
    ? JSON.parse(readFileSync(pkgPath, 'utf-8'))
    : {}
  const projectDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  }

  // Auto-extract safe components
  const extractions = autoExtract(components, graph, config, projectDeps)
  consola.success(
    `Auto-extracted ${extractions.size} components (confidence >= ${Math.round(config.extractionThreshold * 100)}%)`
  )

  // Generate registry
  const registry = generateRegistry(components, graph, config, {
    name: pkg.name || 'unnamed-project',
    version: pkg.version,
  })

  // Compute summary
  const byTier: Record<string, number> = {}
  for (const comp of components.values()) {
    byTier[comp.tier] = (byTier[comp.tier] || 0) + 1
  }

  const needsMCP = [...components.values()].filter(
    (c) =>
      c.extractionConfidence >= 0.3 &&
      c.extractionConfidence < config.extractionThreshold
  ).length

  return {
    config,
    components,
    graph,
    registry,
    extractions,
    summary: {
      totalFiles: files.length,
      analyzed: components.size,
      errors,
      byTier,
      autoExtracted: extractions.size,
      needsMCP,
    },
  }
}

// --- Write Output ---

export async function writeOutput(report: AnalysisReport): Promise<void> {
  const outputDir = report.config.outDir

  consola.start(`Writing output to ${outputDir}`)

  writeRegistry(report.registry, outputDir, report.extractions)

  const catalogHTML = generateCatalogHTML(report.registry, report.components)
  writeFileSync(resolve(outputDir, 'catalog.html'), catalogHTML)

  // Full analysis dump for MCP
  const mcpDump = {
    generatedAt: new Date().toISOString(),
    components: Object.fromEntries(
      [...report.components.entries()].map(([name, comp]) => [
        name,
        { ...comp, rawSource: undefined },
      ])
    ),
    graph: report.graph,
    registry: report.registry,
  }

  writeFileSync(
    resolve(outputDir, 'analysis.json'),
    JSON.stringify(mcpDump, null, 2)
  )

  const summaryText = formatSummary(report)
  writeFileSync(resolve(outputDir, 'SUMMARY.md'), summaryText)

  consola.success('Output written:')
  consola.info('  registry.json  — Component registry')
  consola.info('  catalog.html   — Browsable catalog')
  consola.info('  analysis.json  — MCP server data')
  consola.info('  SUMMARY.md     — Human-readable report')
  consola.info('  components/    — Extracted bundles')
}

// --- Design System Pipeline ---

export async function analyzeTokens(
  rootPath: string,
  overrides: Partial<HarvestConfig> = {}
): Promise<DesignSystemReport> {
  const root = resolve(rootPath)
  const config = resolveConfig(root, overrides)

  consola.start('Analyzing design system tokens...')

  // Optionally run full component analysis first for richer data
  let componentData:
    | Map<string, { name: string; filePath: string; styles: Array<{ source: string }> }>
    | undefined

  try {
    const files = await glob(config.include, {
      cwd: config.root,
      ignore: config.exclude,
      absolute: false,
    })

    if (files.length > 0) {
      componentData = new Map()
      for (const file of files) {
        try {
          const absolutePath = resolve(config.root, file)
          const analyzed = await analyzeSFC(
            file,
            absolutePath,
            config.root,
            config.aliases
          )
          componentData.set(analyzed.name, {
            name: analyzed.name,
            filePath: analyzed.filePath,
            styles: analyzed.styles,
          })
        } catch {
          // Skip individual file errors
        }
      }
    }
  } catch {
    // Proceed without component data
  }

  const report = await analyzeDesignSystem(config, componentData)

  consola.success(
    `Found ${report.stats.totalTokens} tokens: ${report.stats.uniqueColors} colors, ${report.stats.uniqueFontSizes} font sizes, ${report.stats.uniqueSpacingValues} spacing values`
  )

  return report
}

export async function writeDesignSystemOutput(
  report: DesignSystemReport,
  outputDir: string
): Promise<void> {
  mkdirSync(outputDir, { recursive: true })

  // CSS tokens file
  const css = generateTokenCSS(report)
  writeFileSync(resolve(outputDir, 'tokens.css'), css)

  // JSON tokens
  writeFileSync(
    resolve(outputDir, 'tokens.json'),
    JSON.stringify(report, null, 2)
  )

  // Visual HTML report
  const html = generateDesignSystemHTML(report)
  writeFileSync(resolve(outputDir, 'design-system.html'), html)

  consola.success('Design system output written:')
  consola.info('  tokens.css         — CSS custom properties')
  consola.info('  tokens.json        — Full token data')
  consola.info('  design-system.html — Visual explorer')
}

// --- Summary Formatter ---

function formatSummary(report: AnalysisReport): string {
  const { summary, registry, graph } = report
  const lines: string[] = []

  lines.push('# Vue Harvest Analysis\n')
  lines.push(`**Project:** ${registry.name} v${registry.version}`)
  lines.push(`**Generated:** ${registry.generatedAt}\n`)

  lines.push('## Summary\n')
  lines.push('| Metric | Count |')
  lines.push('|--------|-------|')
  lines.push(`| .vue files | ${summary.totalFiles} |`)
  lines.push(`| Analyzed | ${summary.analyzed} |`)
  lines.push(`| Errors | ${summary.errors} |`)
  lines.push(`| Auto-extracted | ${summary.autoExtracted} |`)
  lines.push(`| Needs review | ${summary.needsMCP} |`)

  const tierDesc: Record<string, string> = {
    primitive: 'Pure UI, no business logic',
    composite: 'Composed of primitives',
    feature: 'Has business logic, potentially reusable',
    'page-bound': 'Coupled to specific page/route',
    'app-specific': 'Deeply coupled',
  }

  lines.push('\n## By Tier\n')
  lines.push('| Tier | Count | Description |')
  lines.push('|------|-------|-------------|')
  for (const [tier, count] of Object.entries(summary.byTier).sort(
    (a, b) => b[1] - a[1]
  )) {
    lines.push(`| ${tier} | ${count} | ${tierDesc[tier] || ''} |`)
  }

  if (graph.cycles.length > 0) {
    lines.push('\n## Circular Dependencies\n')
    for (const cycle of graph.cycles) {
      lines.push(`- ${cycle.join(' → ')} → ${cycle[0]}`)
    }
  }

  if (report.extractions.size > 0) {
    lines.push('\n## Auto-Extracted\n')
    for (const [name] of report.extractions) {
      const comp = report.components.get(name)!
      lines.push(
        `- **${name}** (${Math.round(comp.extractionConfidence * 100)}%)`
      )
    }
  }

  const mcpCandidates = [...report.components.values()]
    .filter(
      (c) =>
        c.extractionConfidence >= 0.3 &&
        c.extractionConfidence < report.config.extractionThreshold
    )
    .sort((a, b) => b.extractionConfidence - a.extractionConfidence)

  if (mcpCandidates.length > 0) {
    lines.push('\n## Needs MCP Review\n')
    for (const comp of mcpCandidates) {
      const pct = Math.round(comp.extractionConfidence * 100)
      const issue = comp.couplingIssues[0]
      lines.push(
        `- **${comp.name}** (${pct}%) — ${issue?.description || 'needs review'}`
      )
    }
  }

  return lines.join('\n')
}

// --- Re-exports ---
export type {
  AnalyzedComponent,
  ComponentGraph,
  HarvestConfig,
  HarvestRegistry,
  ExtractionResult,
  DesignSystemReport,
  CouplingIssue,
} from './types.js'
export { resolveConfig, resolveProjectMeta } from './utils/config.js'
export { extractComponent } from './extractors/component-extractor.js'
export { analyzeSFC } from './analyzers/sfc-analyzer.js'
export { buildComponentGraph } from './analyzers/graph-builder.js'
export {
  analyzeDesignSystem,
  generateTokenCSS,
  generateDesignSystemHTML,
} from './analyzers/design-system-analyzer.js'
