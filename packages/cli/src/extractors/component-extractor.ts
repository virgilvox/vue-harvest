import { readFileSync, existsSync } from 'fs'
import { relative, basename } from 'pathe'
import type {
  AnalyzedComponent,
  ExtractionManifest,
  ExtractionResult,
  ComponentGraph,
  HarvestConfig,
} from '../types.js'
import { getDependencyClosure } from '../analyzers/graph-builder.js'

// --- Import Rewriting ---

interface RewriteRule {
  original: string
  replacement: string
}

function buildRewriteRules(
  component: AnalyzedComponent,
  allComponents: Map<string, AnalyzedComponent>
): RewriteRule[] {
  const rules: RewriteRule[] = []

  for (const dep of component.dependencies) {
    if (dep.typeOnly || dep.isPeer) continue

    switch (dep.kind) {
      case 'internal-component': {
        if (dep.resolvedPath) {
          const target = [...allComponents.values()].find(
            (c) => c.absolutePath === dep.resolvedPath
          )
          if (target) {
            rules.push({
              original: dep.specifier,
              replacement: `./${target.name}.vue`,
            })
          }
        }
        break
      }
      case 'internal-composable':
      case 'internal-util': {
        if (dep.resolvedPath && existsSync(dep.resolvedPath)) {
          const fileName = basename(dep.resolvedPath)
          rules.push({
            original: dep.specifier,
            replacement: `./utils/${fileName}`,
          })
        }
        break
      }
      case 'internal-style': {
        if (dep.resolvedPath && existsSync(dep.resolvedPath)) {
          const fileName = basename(dep.resolvedPath)
          rules.push({
            original: dep.specifier,
            replacement: `./styles/${fileName}`,
          })
        }
        break
      }
    }
  }

  return rules
}

function applyRewriteRules(source: string, rules: RewriteRule[]): string {
  let result = source

  for (const rule of rules) {
    const escaped = rule.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const patterns = [
      new RegExp(`from\\s+['"]${escaped}['"]`, 'g'),
      new RegExp(`import\\s+['"]${escaped}['"]`, 'g'),
    ]

    for (const pattern of patterns) {
      result = result.replace(pattern, (match) => {
        const quote = match.includes("'") ? "'" : '"'
        if (match.startsWith('from')) {
          return `from ${quote}${rule.replacement}${quote}`
        }
        return `import ${quote}${rule.replacement}${quote}`
      })
    }
  }

  return result
}

// --- File Collection ---

interface CollectedFile {
  from: string
  to: string
  content: string
  role: ExtractionManifest['files'][0]['role']
  needsTransform: boolean
}

function collectFiles(
  component: AnalyzedComponent,
  allComponents: Map<string, AnalyzedComponent>,
  graph: ComponentGraph,
  projectRoot: string
): CollectedFile[] {
  const files: CollectedFile[] = []

  // The component itself
  files.push({
    from: component.filePath,
    to: `${component.name}.vue`,
    content: component.rawSource,
    role: 'component',
    needsTransform: true,
  })

  // Internal component dependencies (recursive)
  const componentDeps = getDependencyClosure(component.name, graph)
  for (const depName of componentDeps) {
    const depComp = allComponents.get(depName)
    if (depComp) {
      files.push({
        from: depComp.filePath,
        to: `${depComp.name}.vue`,
        content: depComp.rawSource,
        role: 'component',
        needsTransform: true,
      })
    }
  }

  // Composables, utilities, styles, types
  for (const dep of component.dependencies) {
    if (dep.typeOnly || dep.isPeer) continue
    if (!dep.resolvedPath || !existsSync(dep.resolvedPath)) continue

    const content = readFileSync(dep.resolvedPath, 'utf-8')
    const fileName = basename(dep.resolvedPath)

    if (dep.kind === 'internal-composable' || dep.kind === 'internal-util') {
      files.push({
        from: relative(projectRoot, dep.resolvedPath),
        to: `utils/${fileName}`,
        content,
        role: dep.kind === 'internal-composable' ? 'composable' : 'util',
        needsTransform: true,
      })
    } else if (dep.kind === 'internal-style') {
      files.push({
        from: relative(projectRoot, dep.resolvedPath),
        to: `styles/${fileName}`,
        content,
        role: 'style',
        needsTransform: false,
      })
    } else if (dep.kind === 'internal-type') {
      files.push({
        from: relative(projectRoot, dep.resolvedPath),
        to: `types/${fileName}`,
        content,
        role: 'type',
        needsTransform: false,
      })
    }
  }

  return files
}

// --- Manifest ---

function buildManifest(
  component: AnalyzedComponent,
  files: CollectedFile[],
  rewriteRules: RewriteRule[],
  projectDeps: Record<string, string>
): ExtractionManifest {
  const peerDependencies: Record<string, string> = {}
  for (const pkg of component.peerPackages) {
    peerDependencies[pkg] = projectDeps[pkg] || '*'
  }
  peerDependencies['vue'] = projectDeps['vue'] || '^3.4.0'

  const requiredGlobals: string[] = []
  const issueTypes = component.couplingIssues.map((i) => i.type)
  if (issueTypes.includes('router-dependency')) requiredGlobals.push('vue-router')
  if (issueTypes.includes('i18n-dependency')) requiredGlobals.push('vue-i18n')
  if (issueTypes.includes('global-inject'))
    requiredGlobals.push('provide/inject ancestors')

  const requiredCssVars = component.styles
    .flatMap((s) => s.cssVarsUsed)
    .filter((v) => !component.styles.some((s) => s.cssVarsDefined.includes(v)))

  const notes: string[] = []
  for (const issue of component.couplingIssues) {
    if (issue.severity !== 'info') {
      notes.push(`${issue.severity.toUpperCase()}: ${issue.description}`)
      if (issue.suggestedFix) notes.push(`  Fix: ${issue.suggestedFix}`)
    }
  }

  return {
    component: component.name,
    files: files.map((f) => ({
      from: f.from,
      to: f.to,
      needsTransform: f.needsTransform,
      role: f.role,
    })),
    peerDependencies,
    requiredGlobals,
    importRewrites: Object.fromEntries(
      rewriteRules.map((r) => [r.original, r.replacement])
    ),
    requiredCssVars,
    notes,
  }
}

// ============================================================================
// Main Extraction
// ============================================================================

export function extractComponent(
  componentName: string,
  allComponents: Map<string, AnalyzedComponent>,
  graph: ComponentGraph,
  config: HarvestConfig,
  projectDeps: Record<string, string>
): ExtractionResult {
  const component = allComponents.get(componentName)

  if (!component) {
    return {
      success: false,
      manifest: {
        component: componentName,
        files: [],
        peerDependencies: {},
        requiredGlobals: [],
        importRewrites: {},
        requiredCssVars: [],
        notes: [`Component "${componentName}" not found.`],
      },
      files: {},
      issues: [
        { severity: 'error', message: `Component "${componentName}" not found.` },
      ],
    }
  }

  const issues: ExtractionResult['issues'] = []

  if (component.extractionConfidence < config.extractionThreshold) {
    issues.push({
      severity: 'warning',
      message: `Confidence ${Math.round(component.extractionConfidence * 100)}% is below threshold ${Math.round(config.extractionThreshold * 100)}%.`,
    })
  }

  const collectedFiles = collectFiles(component, allComponents, graph, config.root)
  const rewriteRules = buildRewriteRules(component, allComponents)

  const outputFiles: Record<string, string> = {}
  for (const file of collectedFiles) {
    let content = file.content
    if (file.needsTransform) {
      content = applyRewriteRules(content, rewriteRules)
    }
    outputFiles[file.to] = content
  }

  const manifest = buildManifest(component, collectedFiles, rewriteRules, projectDeps)

  // Warn about unresolvable deps
  for (const dep of component.dependencies) {
    if (dep.kind === 'internal-store') {
      issues.push({
        severity: 'warning',
        message: `Store dependency: ${dep.specifier}`,
        suggestion: 'Use MCP "generate-wrapper" to create a composable wrapper.',
      })
    }
    if (dep.kind === 'unknown') {
      issues.push({
        severity: 'warning',
        message: `Unresolvable import: ${dep.specifier}`,
        file: component.filePath,
        suggestion: 'Manually verify this import.',
      })
    }
  }

  return {
    success: issues.every((i) => i.severity !== 'error'),
    manifest,
    files: outputFiles,
    issues,
  }
}

// --- Batch Extraction ---

export function autoExtract(
  allComponents: Map<string, AnalyzedComponent>,
  graph: ComponentGraph,
  config: HarvestConfig,
  projectDeps: Record<string, string>
): Map<string, ExtractionResult> {
  const results = new Map<string, ExtractionResult>()

  for (const [name, comp] of allComponents) {
    if (comp.extractionConfidence >= config.extractionThreshold) {
      results.set(
        name,
        extractComponent(name, allComponents, graph, config, projectDeps)
      )
    }
  }

  return results
}
