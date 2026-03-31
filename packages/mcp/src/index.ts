import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { resolve } from 'pathe'
import { existsSync, readFileSync } from 'fs'
import type {
  AnalyzedComponent,
  HarvestRegistry,
  ComponentGraph,
  CouplingIssue,
  DesignSystemReport,
} from 'vue-harvest'

// --- State ---

interface ServerState {
  projectRoot: string | null
  components: Map<string, AnalyzedComponent> | null
  registry: HarvestRegistry | null
  graph: ComponentGraph | null
  designSystem: DesignSystemReport | null
  lastAnalysis: string | null
}

const state: ServerState = {
  projectRoot: null,
  components: null,
  registry: null,
  graph: null,
  designSystem: null,
  lastAnalysis: null,
}

// --- Helpers ---

function requireAnalysis(): void {
  if (!state.components) {
    throw new Error(
      'No analysis loaded. Run "analyze-project" first with the path to your Vue project.'
    )
  }
}

function getComponent(name: string): AnalyzedComponent {
  requireAnalysis()
  const comp = state.components!.get(name)
  if (!comp) {
    const available = [...state.components!.keys()].join(', ')
    throw new Error(`Component "${name}" not found. Available: ${available}`)
  }
  return comp
}

function formatComponentForLLM(comp: AnalyzedComponent): string {
  const sections: string[] = []

  sections.push(`# ${comp.name}`)
  sections.push(`File: ${comp.filePath}`)
  sections.push(
    `Tier: ${comp.tier} | Confidence: ${Math.round(comp.extractionConfidence * 100)}%`
  )
  sections.push(`Script: ${comp.scriptVariant} | LOC: ${comp.loc.total}`)

  if (comp.props.length > 0) {
    sections.push('\n## Props')
    for (const p of comp.props) {
      sections.push(
        `- ${p.name}${p.required ? '' : '?'}: ${p.type}${p.default ? ` = ${p.default}` : ''}`
      )
    }
  }

  if (comp.emits.length > 0) {
    sections.push('\n## Events')
    for (const e of comp.emits) {
      sections.push(`- ${e.name}${e.payload ? `: ${e.payload}` : ''}`)
    }
  }

  if (comp.slots.length > 0) {
    sections.push('\n## Slots')
    for (const s of comp.slots) {
      const binds =
        s.bindings.length > 0
          ? ` (bindings: ${s.bindings.map((b) => b.name).join(', ')})`
          : ''
      sections.push(`- #${s.name}${binds}`)
    }
  }

  if (comp.dependencies.length > 0) {
    sections.push('\n## Dependencies')
    for (const d of comp.dependencies) {
      sections.push(
        `- [${d.kind}] ${d.specifier}${d.typeOnly ? ' [type-only]' : ''}`
      )
    }
  }

  if (comp.couplingIssues.length > 0) {
    sections.push('\n## Coupling Issues')
    for (const i of comp.couplingIssues) {
      sections.push(`- [${i.severity}] ${i.type}: ${i.description}`)
      if (i.suggestedFix) sections.push(`  Fix: ${i.suggestedFix}`)
    }
  }

  sections.push('\n## Source')
  sections.push('```vue')
  sections.push(comp.rawSource)
  sections.push('```')

  return sections.join('\n')
}

function buildCouplingReport(components: AnalyzedComponent[]): string {
  const byType = new Map<
    string,
    Array<{ component: string; issue: CouplingIssue }>
  >()

  for (const comp of components) {
    for (const issue of comp.couplingIssues) {
      if (!byType.has(issue.type)) byType.set(issue.type, [])
      byType.get(issue.type)!.push({ component: comp.name, issue })
    }
  }

  const sections: string[] = []
  sections.push(`# Coupling Report`)
  sections.push(`${components.length} components analyzed\n`)

  for (const [type, entries] of byType) {
    sections.push(`## ${type} (${entries.length} occurrences)`)
    for (const { component, issue } of entries) {
      sections.push(`- **${component}**: ${issue.description}`)
    }
    sections.push('')
  }

  return sections.join('\n')
}

function suggestAction(comp: AnalyzedComponent): string {
  const types = comp.couplingIssues.map((i) => i.type)

  if (types.length === 1 && types[0] === 'unscoped-css') {
    return 'Add scoped attribute — trivial fix, then auto-extract'
  }
  if (types.every((t) => t === 'direct-store-access')) {
    return 'generate-wrapper — create composable bridge for store access'
  }
  if (types.includes('hardcoded-api') && types.length <= 2) {
    return 'suggest-refactor — replace hardcoded API with prop-based fetch'
  }
  if (types.includes('router-dependency') && types.length === 1) {
    return 'suggest-refactor — replace router usage with navigation events'
  }
  if (comp.couplingIssues.some((i) => i.severity === 'blocker')) {
    return 'adapt-and-extract — needs significant restructuring'
  }
  if (types.length >= 3) {
    return 'adapt-and-extract — multiple issues, better to rewrite holistically'
  }
  return 'suggest-refactor — address issues individually'
}

function estimateEffort(comp: AnalyzedComponent): string {
  const blockers = comp.couplingIssues.filter(
    (i) => i.severity === 'blocker'
  ).length
  const warnings = comp.couplingIssues.filter(
    (i) => i.severity === 'warning'
  ).length
  const loc = comp.loc.total

  if (blockers > 0 && loc > 200) return 'large'
  if (blockers > 0 || warnings > 3) return 'medium'
  if (warnings > 1 || loc > 150) return 'small'
  return 'trivial'
}

// ============================================================================
// Server Setup
// ============================================================================

const server = new Server(
  { name: 'vue-harvest', version: '0.1.0' },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
)

// ============================================================================
// TOOLS
// ============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'analyze-project',
      description:
        'Run the full vue-harvest analysis pipeline on a Vue project. Discovers .vue files, parses interfaces, builds dependency graph, classifies components, auto-extracts safe ones. Must be run before other tools.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          path: {
            type: 'string',
            description: 'Absolute path to the Vue project root',
          },
          threshold: {
            type: 'number',
            description:
              'Extraction confidence threshold 0-100 (default: 70)',
          },
        },
        required: ['path'],
      },
    },
    {
      name: 'list-components',
      description:
        'List all analyzed components with tier, confidence, LOC, and issues. Filter by tier or confidence range.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          tier: {
            type: 'string',
            enum: [
              'primitive',
              'composite',
              'feature',
              'page-bound',
              'app-specific',
            ],
          },
          minConfidence: { type: 'number' },
          maxConfidence: { type: 'number' },
        },
      },
    },
    {
      name: 'inspect-component',
      description:
        'Full analysis of a single component: source, props, events, slots, deps, coupling issues, styles.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: {
            type: 'string',
            description: 'Component name in PascalCase',
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'extract-component',
      description:
        'Extract a component into a standalone bundle with rewritten imports and manifest.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' },
          force: { type: 'boolean' },
        },
        required: ['name'],
      },
    },
    {
      name: 'deep-analyze',
      description:
        'Deep coupling analysis with structured data for reasoning about extractability.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      },
    },
    {
      name: 'suggest-refactor',
      description:
        'Generate concrete refactoring suggestions with before/after code to decouple a component.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' },
          issueTypes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific coupling issue types to address',
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'generate-wrapper',
      description:
        'Create a composable wrapper to abstract store access from a component.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      },
    },
    {
      name: 'adapt-and-extract',
      description:
        'Intelligently rewrite a component to remove all coupling, then extract it.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' },
          preserveApi: { type: 'boolean' },
        },
        required: ['name'],
      },
    },
    {
      name: 'batch-triage',
      description:
        'Triage all components needing review (30-70% confidence). Prioritized with effort estimates.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          maxComponents: { type: 'number' },
        },
      },
    },
    {
      name: 'coupling-report',
      description:
        'Project-wide coupling report showing all issues grouped by type.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'analyze-design-system',
      description:
        'Extract design tokens (colors, typography, spacing, shadows) from the project. Generates a CSS token library and visual explorer.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          path: {
            type: 'string',
            description: 'Project path (uses already-analyzed project if omitted)',
          },
        },
      },
    },
    {
      name: 'get-design-tokens',
      description:
        'Get the extracted design tokens as structured data. Run analyze-design-system first.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          type: {
            type: 'string',
            enum: [
              'color',
              'font-family',
              'font-size',
              'font-weight',
              'spacing',
              'border-radius',
              'shadow',
            ],
            description: 'Filter by token type',
          },
        },
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      case 'analyze-project': {
        const projectPath = resolve(args?.path as string)
        if (!existsSync(projectPath)) {
          throw new Error(`Path does not exist: ${projectPath}`)
        }

        const { analyze, writeOutput } = await import('vue-harvest')

        const threshold = (args?.threshold as number) ?? 70
        const report = await analyze(projectPath, {
          extractionThreshold: threshold / 100,
        })

        state.projectRoot = projectPath
        state.components = report.components
        state.registry = report.registry
        state.graph = report.graph
        state.lastAnalysis = new Date().toISOString()

        await writeOutput(report)

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'success',
                  projectRoot: projectPath,
                  summary: report.summary,
                  message: `Analyzed ${report.summary.analyzed} components. ${report.summary.autoExtracted} auto-extracted, ${report.summary.needsMCP} need review.`,
                },
                null,
                2
              ),
            },
          ],
        }
      }

      case 'list-components': {
        requireAnalysis()
        let components = [...state.components!.values()]

        if (args?.tier)
          components = components.filter((c) => c.tier === args.tier)
        if (args?.minConfidence !== undefined)
          components = components.filter(
            (c) =>
              c.extractionConfidence * 100 >= (args.minConfidence as number)
          )
        if (args?.maxConfidence !== undefined)
          components = components.filter(
            (c) =>
              c.extractionConfidence * 100 <= (args.maxConfidence as number)
          )

        components.sort(
          (a, b) => b.extractionConfidence - a.extractionConfidence
        )

        const list = components.map((c) => ({
          name: c.name,
          file: c.filePath,
          tier: c.tier,
          confidence: Math.round(c.extractionConfidence * 100),
          loc: c.loc.total,
          props: c.props.length,
          events: c.emits.length,
          slots: c.slots.length,
          issues: c.couplingIssues.length,
          issueTypes: [...new Set(c.couplingIssues.map((i) => i.type))],
        }))

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { count: list.length, components: list },
                null,
                2
              ),
            },
          ],
        }
      }

      case 'inspect-component': {
        const comp = getComponent(args?.name as string)
        return {
          content: [{ type: 'text', text: formatComponentForLLM(comp) }],
        }
      }

      case 'extract-component': {
        requireAnalysis()
        const { extractComponent, resolveConfig } = await import('vue-harvest')

        const pkgPath = resolve(state.projectRoot!, 'package.json')
        const pkg = existsSync(pkgPath)
          ? JSON.parse(readFileSync(pkgPath, 'utf-8'))
          : {}
        const projectDeps = {
          ...(pkg.dependencies || {}),
          ...(pkg.devDependencies || {}),
        }

        const config = resolveConfig(state.projectRoot!, {
          extractionThreshold: args?.force ? 0 : 0.7,
        })

        const result = extractComponent(
          args?.name as string,
          state.components!,
          state.graph!,
          config,
          projectDeps
        )

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: result.success,
                  files: Object.keys(result.files),
                  manifest: result.manifest,
                  issues: result.issues,
                },
                null,
                2
              ),
            },
          ],
        }
      }

      case 'deep-analyze': {
        const comp = getComponent(args?.name as string)

        const analysis = {
          component: comp.name,
          tier: comp.tier,
          confidence: Math.round(comp.extractionConfidence * 100),
          scriptVariant: comp.scriptVariant,
          interface: {
            hasProps: comp.props.length > 0,
            hasEmits: comp.emits.length > 0,
            hasSlots: comp.slots.length > 0,
            propsCount: comp.props.length,
            emitsCount: comp.emits.length,
            slotsCount: comp.slots.length,
          },
          dependencies: {
            total: comp.dependencies.length,
            byKind: comp.dependencies.reduce(
              (acc, d) => {
                acc[d.kind] = (acc[d.kind] || 0) + 1
                return acc
              },
              {} as Record<string, number>
            ),
            stores: comp.dependencies
              .filter((d) => d.kind === 'internal-store')
              .map((d) => ({
                specifier: d.specifier,
                imports: d.imports,
              })),
            externalPackages: comp.peerPackages,
          },
          coupling: {
            issueCount: comp.couplingIssues.length,
            blockers: comp.couplingIssues.filter(
              (i) => i.severity === 'blocker'
            ),
            warnings: comp.couplingIssues.filter(
              (i) => i.severity === 'warning'
            ),
          },
          styles: {
            allScoped: comp.styles.every((s) => s.scoped || s.module),
            cssVarsUsed: [
              ...new Set(comp.styles.flatMap((s) => s.cssVarsUsed)),
            ],
          },
          graphPosition: {
            transitiveDeps: comp.transitiveDeps,
            isLeaf: comp.transitiveDeps.length === 0,
            inCycle: state.graph!.cycles.some((c) =>
              c.includes(comp.name)
            ),
          },
          source: comp.rawSource,
        }

        return {
          content: [
            {
              type: 'text',
              text:
                `# Deep Analysis: ${comp.name}\n\n` +
                '```json\n' +
                JSON.stringify(analysis, null, 2) +
                '\n```\n\n' +
                '## Key Questions:\n' +
                '1. What specific code patterns cause the coupling issues?\n' +
                '2. What is the minimal change to fix each issue?\n' +
                '3. Would fixing all issues change the tier?\n' +
                '4. What is the estimated effort for each fix?\n' +
                '5. What is the recommended extraction strategy?',
            },
          ],
        }
      }

      case 'suggest-refactor': {
        const comp = getComponent(args?.name as string)
        const issueTypes = args?.issueTypes as string[] | undefined

        const issues =
          issueTypes && issueTypes.length > 0
            ? comp.couplingIssues.filter((i) => issueTypes.includes(i.type))
            : comp.couplingIssues

        if (issues.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `${comp.name} has no coupling issues. Ready for extraction.`,
              },
            ],
          }
        }

        const context = {
          component: comp.name,
          source: comp.rawSource,
          issues: issues.map((i) => ({
            type: i.type,
            severity: i.severity,
            description: i.description,
            suggestedFix: i.suggestedFix,
          })),
          currentProps: comp.props,
          dependencies: comp.dependencies.filter((d) => !d.typeOnly),
          storeImports: comp.dependencies
            .filter((d) => d.kind === 'internal-store')
            .map((d) => ({
              specifier: d.specifier,
              imports: d.imports,
              source:
                d.resolvedPath && existsSync(d.resolvedPath)
                  ? readFileSync(d.resolvedPath, 'utf-8')
                  : null,
            })),
        }

        return {
          content: [
            {
              type: 'text',
              text:
                `# Refactoring Plan: ${comp.name}\n\n` +
                `Current confidence: ${Math.round(comp.extractionConfidence * 100)}%\n` +
                `Issues to fix: ${issues.length}\n\n` +
                '```json\n' +
                JSON.stringify(context, null, 2) +
                '\n```\n\n' +
                REFACTORING_PATTERNS,
            },
          ],
        }
      }

      case 'generate-wrapper': {
        const comp = getComponent(args?.name as string)
        const storeAccess = comp.dependencies.filter(
          (d) => d.kind === 'internal-store'
        )

        if (storeAccess.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `${comp.name} doesn't access stores directly. No wrapper needed.`,
              },
            ],
          }
        }

        const stores = storeAccess.map((d) => ({
          specifier: d.specifier,
          imports: d.imports,
          source:
            d.resolvedPath && existsSync(d.resolvedPath)
              ? readFileSync(d.resolvedPath, 'utf-8')
              : null,
        }))

        return {
          content: [
            {
              type: 'text',
              text:
                `# Wrapper Generation: ${comp.name}\n\n` +
                `Imports ${storeAccess.length} store(s) directly.\n\n` +
                `## Component Source\n\`\`\`vue\n${comp.rawSource}\n\`\`\`\n\n` +
                `## Stores\n` +
                stores
                  .map(
                    (s) =>
                      `### ${s.specifier}\n${s.source ? `\`\`\`typescript\n${s.source}\n\`\`\`` : '*Source not available*'}`
                  )
                  .join('\n\n'),
            },
          ],
        }
      }

      case 'adapt-and-extract': {
        const comp = getComponent(args?.name as string)

        const depSources: Record<string, string> = {}
        for (const dep of comp.dependencies) {
          if (dep.resolvedPath && existsSync(dep.resolvedPath) && !dep.typeOnly) {
            try {
              depSources[dep.specifier] = readFileSync(dep.resolvedPath, 'utf-8')
            } catch {}
          }
        }

        return {
          content: [
            {
              type: 'text',
              text:
                `# Adapt & Extract: ${comp.name}\n\n` +
                `Tier: ${comp.tier} | Confidence: ${Math.round(comp.extractionConfidence * 100)}%\n\n` +
                `## Coupling Issues\n` +
                comp.couplingIssues
                  .map((i) => `- **${i.type}** [${i.severity}]: ${i.description}`)
                  .join('\n') +
                `\n\n## Source\n\`\`\`vue\n${comp.rawSource}\n\`\`\`\n\n` +
                `## Dependencies\n` +
                Object.entries(depSources)
                  .map(
                    ([spec, src]) =>
                      `### ${spec}\n\`\`\`\n${src.length > 3000 ? src.slice(0, 3000) + '\n// truncated' : src}\n\`\`\``
                  )
                  .join('\n\n'),
            },
          ],
        }
      }

      case 'batch-triage': {
        requireAnalysis()
        const max = (args?.maxComponents as number) ?? 20

        const candidates = [...state.components!.values()]
          .filter(
            (c) =>
              c.extractionConfidence >= 0.3 &&
              c.extractionConfidence < 0.7
          )
          .sort((a, b) => b.extractionConfidence - a.extractionConfidence)
          .slice(0, max)

        if (candidates.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No components need triage.',
              },
            ],
          }
        }

        const triage = candidates.map((comp) => ({
          name: comp.name,
          file: comp.filePath,
          tier: comp.tier,
          confidence: Math.round(comp.extractionConfidence * 100),
          issues: comp.couplingIssues.map((i) => ({
            type: i.type,
            severity: i.severity,
          })),
          suggestedAction: suggestAction(comp),
          effort: estimateEffort(comp),
        }))

        return {
          content: [
            {
              type: 'text',
              text:
                `# Batch Triage: ${candidates.length} Components\n\n` +
                '```json\n' +
                JSON.stringify(triage, null, 2) +
                '\n```',
            },
          ],
        }
      }

      case 'coupling-report': {
        requireAnalysis()
        return {
          content: [
            {
              type: 'text',
              text: buildCouplingReport([...state.components!.values()]),
            },
          ],
        }
      }

      case 'analyze-design-system': {
        const { analyzeTokens, writeDesignSystemOutput, resolveConfig } =
          await import('vue-harvest')

        const projectPath = (args?.path as string) || state.projectRoot
        if (!projectPath) {
          throw new Error('No project path. Provide a path or run analyze-project first.')
        }

        const report = await analyzeTokens(projectPath)
        state.designSystem = report

        const config = resolveConfig(projectPath)
        await writeDesignSystemOutput(report, config.outDir)

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'success',
                  stats: report.stats,
                  palette: report.palette.slice(0, 20),
                  typography: report.typography,
                  spacing: report.spacing,
                },
                null,
                2
              ),
            },
          ],
        }
      }

      case 'get-design-tokens': {
        if (!state.designSystem) {
          throw new Error('Run analyze-design-system first.')
        }

        const tokenType = args?.type as string | undefined
        let tokens = state.designSystem.tokens

        if (tokenType) {
          tokens = tokens.filter((t) => t.type === tokenType)
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  count: tokens.length,
                  tokens: tokens.slice(0, 100),
                },
                null,
                2
              ),
            },
          ],
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (err: any) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    }
  }
})

// ============================================================================
// RESOURCES
// ============================================================================

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const resources: Array<{
    uri: string
    name: string
    description: string
    mimeType: string
  }> = []

  if (state.registry) {
    resources.push(
      {
        uri: 'harvest://registry',
        name: 'Component Registry',
        description: 'Full registry JSON',
        mimeType: 'application/json',
      },
      {
        uri: 'harvest://graph',
        name: 'Dependency Graph',
        description: 'Component dependency graph',
        mimeType: 'application/json',
      },
      {
        uri: 'harvest://summary',
        name: 'Analysis Summary',
        description: 'Analysis summary',
        mimeType: 'text/markdown',
      }
    )

    if (state.components) {
      for (const name of state.components.keys()) {
        resources.push({
          uri: `harvest://component/${name}`,
          name: `Component: ${name}`,
          description: `Analysis of ${name}`,
          mimeType: 'text/markdown',
        })
      }
    }
  }

  if (state.designSystem) {
    resources.push({
      uri: 'harvest://design-system',
      name: 'Design System',
      description: 'Extracted design tokens',
      mimeType: 'application/json',
    })
  }

  return { resources }
})

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri

  if (uri === 'harvest://registry') {
    requireAnalysis()
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(state.registry, null, 2),
        },
      ],
    }
  }

  if (uri === 'harvest://graph') {
    requireAnalysis()
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(state.graph, null, 2),
        },
      ],
    }
  }

  if (uri === 'harvest://summary') {
    requireAnalysis()
    return {
      contents: [
        {
          uri,
          mimeType: 'text/markdown',
          text: [
            '# Vue Harvest Analysis',
            `Components: ${state.registry!.stats.totalComponents}`,
            `Auto-extractable: ${state.registry!.stats.autoExtractable}`,
            `Needs review: ${state.registry!.stats.needsReview}`,
          ].join('\n'),
        },
      ],
    }
  }

  if (uri.startsWith('harvest://component/')) {
    const compName = uri.replace('harvest://component/', '')
    const comp = getComponent(compName)
    return {
      contents: [
        { uri, mimeType: 'text/markdown', text: formatComponentForLLM(comp) },
      ],
    }
  }

  if (uri === 'harvest://design-system') {
    if (!state.designSystem) throw new Error('No design system analyzed')
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(state.designSystem, null, 2),
        },
      ],
    }
  }

  throw new Error(`Unknown resource: ${uri}`)
})

// ============================================================================
// PROMPTS
// ============================================================================

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: 'analyze-new-project',
      description:
        'Analyze a Vue project and provide extraction opportunities overview',
      arguments: [
        { name: 'path', description: 'Path to the Vue project', required: true },
      ],
    },
    {
      name: 'extraction-sprint',
      description:
        'Plan and execute an extraction sprint for reviewable components',
      arguments: [
        {
          name: 'path',
          description: 'Project path (if not already analyzed)',
          required: false,
        },
      ],
    },
    {
      name: 'refactor-component',
      description: 'Deep-analyze and generate complete refactoring code',
      arguments: [
        {
          name: 'component',
          description: 'Component name in PascalCase',
          required: true,
        },
      ],
    },
    {
      name: 'extract-design-system',
      description:
        'Extract and analyze design tokens from a Vue project',
      arguments: [
        { name: 'path', description: 'Path to the Vue project', required: true },
      ],
    },
  ],
}))

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  switch (name) {
    case 'analyze-new-project':
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text:
                `Analyze my Vue project at: ${args?.path}\n\n` +
                `1. Run analyze-project\n` +
                `2. Show the summary\n` +
                `3. List auto-extracted components\n` +
                `4. List components needing review\n` +
                `5. Run coupling-report\n` +
                `6. Recommend which to focus on first`,
            },
          },
        ],
      }

    case 'extraction-sprint':
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text:
                `Extraction sprint. ${args?.path ? `Project at ${args.path} — analyze first.` : 'Already analyzed.'}\n\n` +
                `1. Run batch-triage\n` +
                `2. For each component (highest confidence first):\n` +
                `   a. deep-analyze\n   b. Choose approach\n   c. Execute refactoring\n   d. Extract\n` +
                `3. Summarize results`,
            },
          },
        ],
      }

    case 'refactor-component':
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text:
                `Refactor ${args?.component} to make it extractable.\n\n` +
                `1. deep-analyze\n2. Identify coupling root causes\n3. suggest-refactor\n4. Show complete refactored code\n5. Extract\n6. Show manifest`,
            },
          },
        ],
      }

    case 'extract-design-system':
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text:
                `Extract design tokens from my Vue project at: ${args?.path}\n\n` +
                `1. Run analyze-design-system\n` +
                `2. Show the color palette\n` +
                `3. Show typography scale\n` +
                `4. Show spacing scale\n` +
                `5. Recommend token naming conventions\n` +
                `6. Suggest how to apply tokens to components`,
            },
          },
        ],
      }

    default:
      throw new Error(`Unknown prompt: ${name}`)
  }
})

// ============================================================================
// Refactoring Patterns Reference
// ============================================================================

const REFACTORING_PATTERNS = `## Refactoring Patterns:

**direct-store-access**: Replace \`useXxxStore()\` with props. Create a composable wrapper.
**hardcoded-api**: Replace \`fetch('/api/xxx')\` with a \`fetchFn\` prop or composable parameter.
**router-dependency**: Replace \`useRouter().push()\` with an \`onNavigate\` emit.
**i18n-dependency**: Accept display strings as props with defaults.
**global-inject**: Replace \`inject('key')\` with a prop that has a fallback.
**env-variable**: Replace \`import.meta.env.XXX\` with a config prop.
**unscoped-css**: Add \`scoped\` to the style block.`

// ============================================================================
// Start
// ============================================================================

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('Vue Harvest MCP server running on stdio')
}

main().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
