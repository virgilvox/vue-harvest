import { parse } from '@vue/compiler-sfc'
import { readFileSync } from 'fs'
import { basename, dirname, extname } from 'pathe'
import { init, parse as parseImports } from 'es-module-lexer'
import { createHash } from 'crypto'
import type {
  AnalyzedComponent,
  PropDefinition,
  EmitDefinition,
  SlotDefinition,
  Dependency,
  DependencyKind,
  StyleBlock,
  CouplingIssue,
  ScriptVariant,
  ReusabilityTier,
} from '../types.js'

let esModuleReady = false

async function ensureInit() {
  if (!esModuleReady) {
    await init
    esModuleReady = true
  }
}

// --- Balanced Brace Matching ---

/** Extract the content between the outermost { } after a keyword like defineProps */
function matchBalancedBraces(source: string, keyword: string): string | null {
  const idx = source.indexOf(keyword)
  if (idx === -1) return null

  // Find the first { after the keyword
  let start = -1
  for (let i = idx + keyword.length; i < source.length; i++) {
    if (source[i] === '{') {
      start = i
      break
    }
  }
  if (start === -1) return null

  let depth = 1
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') depth--
    if (depth === 0) {
      return source.slice(start + 1, i)
    }
  }
  return null
}

// --- Name Derivation ---

function toComponentName(filePath: string): string {
  const name = basename(filePath, extname(filePath))
  if (name === 'index') {
    const dir = basename(dirname(filePath))
    return toPascalCase(dir)
  }
  return toPascalCase(name)
}

function toPascalCase(str: string): string {
  return str
    .replace(/[-_./\\]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^(.)/, (_, c) => c.toUpperCase())
}

// --- Script Variant Detection ---

function detectScriptVariant(
  descriptor: ReturnType<typeof parse>['descriptor']
): ScriptVariant {
  const hasSetup = !!descriptor.scriptSetup
  const hasScript = !!descriptor.script

  if (!hasSetup && !hasScript) return 'none'

  const lang = descriptor.scriptSetup?.lang || descriptor.script?.lang
  const isTs = lang === 'ts' || lang === 'tsx'

  if (hasSetup) return isTs ? 'setup-ts' : 'setup-js'

  const content = descriptor.script?.content || ''
  const hasSetupFn = /setup\s*\(/.test(content)

  if (hasSetupFn) return isTs ? 'composition-ts' : 'composition-js'
  return isTs ? 'options-ts' : 'options-js'
}

// --- Props Extraction ---

export function extractProps(
  scriptContent: string,
  variant: ScriptVariant
): PropDefinition[] {
  if (variant.startsWith('setup')) {
    return extractSetupProps(scriptContent)
  }

  if (variant.startsWith('options') || variant.startsWith('composition')) {
    const propsBody = matchBalancedBraces(scriptContent, 'props')
    if (propsBody) return parseObjectProps(propsBody)
  }

  return []
}

function extractSetupProps(scriptContent: string): PropDefinition[] {
  // Generic type syntax: defineProps<{ foo: string; bar?: number }>()
  const genericMatch = scriptContent.match(
    /defineProps\s*<\s*\{([^}]+)\}\s*>\s*\(\s*\)/
  )
  if (genericMatch) {
    return parseTypeProps(genericMatch[1])
  }

  // withDefaults(defineProps<...>(), { ... })
  const withDefaultsMatch = scriptContent.match(
    /withDefaults\s*\(\s*defineProps\s*<\s*\{([^}]+)\}\s*>\s*\(\s*\)\s*,\s*\{([^}]+)\}\s*\)/
  )
  if (withDefaultsMatch) {
    const props = parseTypeProps(withDefaultsMatch[1])
    const defaultsBody = withDefaultsMatch[2]

    for (const prop of props) {
      const defaultMatch = defaultsBody.match(
        new RegExp(`${prop.name}\\s*:\\s*(.+?)(?:,|$)`)
      )
      if (defaultMatch) {
        prop.default = defaultMatch[1].trim()
        prop.required = false
      }
    }
    return props
  }

  // Object syntax: defineProps({ ... })
  const objectMatch = matchBalancedBraces(scriptContent, 'defineProps')
  if (objectMatch) {
    return parseObjectProps(objectMatch)
  }

  return []
}

function parseTypeProps(typeBody: string): PropDefinition[] {
  const props: PropDefinition[] = []
  const lines = typeBody.split(/[;\n]/).filter((l) => l.trim())

  for (const line of lines) {
    const match = line.trim().match(/^(\w+)(\?)?:\s*(.+)$/)
    if (match) {
      props.push({
        name: match[1],
        type: match[3].trim().replace(/,\s*$/, ''),
        required: !match[2],
      })
    }
  }
  return props
}

function parseObjectProps(body: string): PropDefinition[] {
  const props: PropDefinition[] = []

  // Split into top-level entries respecting brace depth
  const entries = splitTopLevel(body)

  for (const entry of entries) {
    const trimmed = entry.trim()
    if (!trimmed) continue

    // Simple: foo: String
    const simpleMatch = trimmed.match(
      /^(\w+)\s*:\s*(String|Number|Boolean|Array|Object|Function|Symbol)\s*$/
    )
    if (simpleMatch) {
      props.push({
        name: simpleMatch[1],
        type: simpleMatch[2].toLowerCase(),
        required: false,
      })
      continue
    }

    // Complex: foo: { type: String, required: true, default: 'bar' }
    const nameMatch = trimmed.match(/^(\w+)\s*:\s*\{/)
    if (nameMatch) {
      const name = nameMatch[1]
      // Extract the inner content of the braces
      const innerContent = matchInnerBraces(trimmed)
      if (innerContent) {
        const typeMatch = innerContent.match(/type\s*:\s*([\w[\]|]+)/)
        const requiredMatch = innerContent.match(/required\s*:\s*(true|false)/)
        const defaultMatch = innerContent.match(/default\s*:\s*(.+?)(?:,\s*$|$)/m)

        props.push({
          name,
          type: typeMatch?.[1]?.toLowerCase() || 'unknown',
          required: requiredMatch?.[1] === 'true',
          default: defaultMatch?.[1]?.trim(),
        })
      }
      continue
    }

    // Array type: foo: [String, Number]
    const arrayMatch = trimmed.match(/^(\w+)\s*:\s*\[([^\]]+)\]$/)
    if (arrayMatch) {
      props.push({
        name: arrayMatch[1],
        type: arrayMatch[2].toLowerCase().replace(/\s+/g, ''),
        required: false,
      })
    }
  }
  return props
}

/** Split a string by top-level commas (ignoring commas inside {} or []) */
function splitTopLevel(str: string): string[] {
  const entries: string[] = []
  let depth = 0
  let current = ''

  for (const ch of str) {
    if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') depth--

    if (ch === ',' && depth === 0) {
      entries.push(current)
      current = ''
    } else {
      current += ch
    }
  }

  if (current.trim()) entries.push(current)
  return entries
}

/** Extract content between the first { and its matching } */
function matchInnerBraces(str: string): string | null {
  const start = str.indexOf('{')
  if (start === -1) return null

  let depth = 1
  for (let i = start + 1; i < str.length; i++) {
    if (str[i] === '{') depth++
    else if (str[i] === '}') depth--
    if (depth === 0) return str.slice(start + 1, i)
  }
  return null
}

// --- Emits Extraction ---

export function extractEmits(
  scriptContent: string,
  variant: ScriptVariant
): EmitDefinition[] {
  // defineEmits(['click', 'update:modelValue'])
  const arrayMatch = scriptContent.match(
    /defineEmits\s*\(\s*\[([^\]]*)\]\s*\)/
  )
  if (arrayMatch) {
    const items = arrayMatch[1].match(/['"]([^'"]+)['"]/g) || []
    return items.map((item) => ({ name: item.replace(/['"]/g, '') }))
  }

  // defineEmits<{ (e: 'click', value: number): void }>()
  const typeMatch = scriptContent.match(
    /defineEmits\s*<\s*\{([\s\S]*?)\}\s*>\s*\(\s*\)/
  )
  if (typeMatch) {
    const emits: EmitDefinition[] = []
    const callSigs =
      typeMatch[1].match(
        /\(\s*e\s*:\s*['"](\w[^'"]*)['"](.*?)\)\s*:\s*void/g
      ) || []

    for (const sig of callSigs) {
      const nameMatch = sig.match(/e\s*:\s*['"]([^'"]+)['"]/)
      const payloadMatch = sig.match(/,\s*(\w+)\s*:\s*(.+?)\)\s*:/)
      if (nameMatch) {
        emits.push({
          name: nameMatch[1],
          payload: payloadMatch?.[2]?.trim(),
        })
      }
    }
    return emits
  }

  // Options API: emits: ['click', 'update']
  const optionsMatch = scriptContent.match(/emits\s*:\s*\[([^\]]*)\]/)
  if (optionsMatch) {
    const items = optionsMatch[1].match(/['"]([^'"]+)['"]/g) || []
    return items.map((item) => ({ name: item.replace(/['"]/g, '') }))
  }

  return []
}

// --- Slots Extraction ---

export function extractSlots(templateContent: string): SlotDefinition[] {
  const slots: SlotDefinition[] = []
  const seen = new Set<string>()

  const slotPattern =
    /<slot\b([^>]*?)(?:\/>|>([\s\S]*?)<\/slot>)/g
  let match

  while ((match = slotPattern.exec(templateContent)) !== null) {
    const attrs = match[1]
    const nameMatch = attrs.match(/name\s*=\s*["']([^"']+)["']/)
    const name = nameMatch ? nameMatch[1] : 'default'

    if (seen.has(name)) continue
    seen.add(name)

    const bindings: SlotDefinition['bindings'] = []
    const bindPattern = /(?:v-bind:|:)(\w+)\s*=\s*["']([^"']+)["']/g
    let bindMatch
    while ((bindMatch = bindPattern.exec(attrs)) !== null) {
      if (bindMatch[1] !== 'name') {
        bindings.push({ name: bindMatch[1], type: 'unknown' })
      }
    }

    slots.push({ name, bindings })
  }

  return slots
}

// --- Dependency Extraction ---

function classifyDependency(
  specifier: string,
  aliases: Record<string, string>
): DependencyKind {
  if (['vue', 'vue-router', 'pinia', 'vuex'].includes(specifier)) {
    return 'vue-core'
  }

  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    if (specifier.includes('.vue')) return 'internal-component'
    if (/\/use[A-Z]/.test(specifier) || /\/composables\//.test(specifier))
      return 'internal-composable'
    if (/\/stores?\//.test(specifier)) return 'internal-store'
    if (/\/utils?\/|\/helpers?\/|\/lib\//.test(specifier))
      return 'internal-util'
    if (/\/types?\/|\.d\.ts/.test(specifier)) return 'internal-type'
    if (/\.(css|scss|less|styl)/.test(specifier)) return 'internal-style'
    if (/\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot)/.test(specifier))
      return 'internal-asset'
    return 'internal-util'
  }

  for (const alias of Object.keys(aliases)) {
    if (specifier.startsWith(alias + '/') || specifier === alias) {
      const afterAlias = specifier.slice(alias.length)
      if (afterAlias.includes('.vue') || /\/components\//.test(afterAlias))
        return 'internal-component'
      if (/\/use[A-Z]/.test(afterAlias) || /\/composables\//.test(afterAlias))
        return 'internal-composable'
      if (/\/stores?\//.test(afterAlias)) return 'internal-store'
      if (/\/types?\//.test(afterAlias)) return 'internal-type'
      return 'internal-util'
    }
  }

  return 'external-package'
}

export async function extractDependencies(
  scriptContent: string,
  aliases: Record<string, string>
): Promise<Dependency[]> {
  await ensureInit()

  const deps: Dependency[] = []

  try {
    const [imports] = parseImports(scriptContent)

    for (const imp of imports) {
      const specifier = scriptContent.slice(imp.s, imp.e)
      if (!specifier) continue

      const kind = classifyDependency(specifier, aliases)

      const importStatement = scriptContent.slice(
        scriptContent.lastIndexOf(
          'import',
          imp.ss !== -1 ? imp.ss : imp.s
        ),
        imp.e + 1
      )
      const namedMatch = importStatement.match(/\{([^}]+)\}/)
      const importNames = namedMatch
        ? namedMatch[1]
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : []

      const typeOnly =
        /\bimport\s+type\b/.test(importStatement) ||
        importNames.every((n) => n.startsWith('type '))

      deps.push({
        specifier,
        resolvedPath: null,
        kind,
        imports: importNames,
        typeOnly,
        isPeer: kind === 'external-package' || kind === 'vue-core',
        depth: 0,
      })
    }
  } catch {
    // Fallback: regex-based import detection
    const importRegex =
      /import\s+(?:type\s+)?(?:\{[^}]*\}|[\w*]+(?:\s*,\s*\{[^}]*\})?)\s+from\s+['"]([^'"]+)['"]/g
    let match
    while ((match = importRegex.exec(scriptContent)) !== null) {
      const specifier = match[1]
      deps.push({
        specifier,
        resolvedPath: null,
        kind: classifyDependency(specifier, aliases),
        imports: [],
        typeOnly: match[0].includes('import type'),
        isPeer: false,
        depth: 0,
      })
    }
  }

  return deps
}

// --- Coupling Issue Detection ---

export function detectCouplingIssues(
  scriptContent: string,
  templateContent: string,
  styles: StyleBlock[],
  deps: Dependency[]
): CouplingIssue[] {
  const issues: CouplingIssue[] = []

  // Direct store access
  for (const dep of deps.filter((d) => d.kind === 'internal-store')) {
    issues.push({
      type: 'direct-store-access',
      description: `Directly imports store: ${dep.specifier}`,
      severity: 'warning',
      suggestedFix:
        'Extract store data into props or provide a composable wrapper.',
    })
  }

  // Hardcoded API calls
  const apiPatterns = [
    /fetch\s*\(\s*['"`]\/api\//,
    /axios\.\w+\s*\(\s*['"`]\/api\//,
    /\$http\.\w+\s*\(\s*['"`]\//,
    /useFetch\s*\(\s*['"`]\/api\//,
  ]
  if (apiPatterns.some((p) => p.test(scriptContent))) {
    issues.push({
      type: 'hardcoded-api',
      description: 'Contains hardcoded API endpoint.',
      severity: 'warning',
      suggestedFix:
        'Accept a fetchFn prop or use a composable parameter for the endpoint.',
    })
  }

  // Router dependency
  if (
    /useRoute[r]?\s*\(/.test(scriptContent) ||
    /\$route[r]?[.\[]/.test(scriptContent) ||
    /router-link|RouterLink/.test(templateContent)
  ) {
    issues.push({
      type: 'router-dependency',
      description: 'Uses vue-router directly.',
      severity: 'info',
      suggestedFix:
        'Accept navigation handlers as props for maximum portability.',
    })
  }

  // i18n dependency
  if (
    /useI18n\s*\(/.test(scriptContent) ||
    /\$t\s*\(/.test(templateContent) ||
    /v-t\b/.test(templateContent)
  ) {
    issues.push({
      type: 'i18n-dependency',
      description: 'Uses vue-i18n. Consumer needs matching message keys.',
      severity: 'warning',
      suggestedFix:
        'Accept display strings as props or provide a translation map prop.',
    })
  }

  // inject() usage
  if (/inject\s*\(/.test(scriptContent)) {
    issues.push({
      type: 'global-inject',
      description: 'Uses inject() requiring a matching provide() ancestor.',
      severity: 'warning',
      suggestedFix:
        'Document required provide keys, or convert to props with defaults.',
    })
  }

  // Environment variables
  if (
    /import\.meta\.env/.test(scriptContent) ||
    /process\.env/.test(scriptContent)
  ) {
    issues.push({
      type: 'env-variable',
      description: 'References environment variables.',
      severity: 'warning',
      suggestedFix:
        'Accept config values as props or through a config composable.',
    })
  }

  // Unscoped CSS
  const unscopedStyles = styles.filter((s) => !s.scoped && !s.module)
  if (unscopedStyles.some((s) => s.source.trim().length > 0)) {
    issues.push({
      type: 'unscoped-css',
      description: 'Has unscoped styles that will leak into the global scope.',
      severity: 'warning',
      suggestedFix:
        'Add `scoped` attribute to <style> blocks, or convert to CSS Modules.',
    })
  }

  return issues
}

// --- Style Analysis ---

function analyzeStyles(
  descriptor: ReturnType<typeof parse>['descriptor']
): StyleBlock[] {
  return descriptor.styles.map((style) => {
    const source = style.content || ''

    const cssVarsUsed = [
      ...new Set(
        (source.match(/var\(--[\w-]+/g) || []).map((m) =>
          m.replace('var(', '')
        )
      ),
    ]

    const cssVarsDefined = [
      ...new Set(
        (source.match(/(--[\w-]+)\s*:/g) || []).map((m) =>
          m.replace(/\s*:$/, '')
        )
      ),
    ]

    const externalImports = (source.match(/@import\s+['"]([^'"]+)['"]/g) || [])
      .map((m) => {
        const match = m.match(/['"]([^'"]+)['"]/)
        return match ? match[1] : ''
      })
      .filter(Boolean)

    return {
      lang: (style.lang || 'css') as StyleBlock['lang'],
      scoped: !!style.scoped,
      module:
        style.module === true
          ? true
          : typeof style.module === 'string'
            ? style.module
            : false,
      source,
      cssVarsUsed,
      cssVarsDefined,
      externalImports,
    }
  })
}

// --- Reusability Classification ---

export function classifyReusability(
  component: Pick<
    AnalyzedComponent,
    'props' | 'dependencies' | 'couplingIssues' | 'slots' | 'filePath'
  >
): { tier: ReusabilityTier; confidence: number } {
  let score = 1.0

  const storeAccess = component.dependencies.filter(
    (d) => d.kind === 'internal-store'
  )
  const componentDeps = component.dependencies.filter(
    (d) => d.kind === 'internal-component'
  )
  const blockers = component.couplingIssues.filter(
    (i) => i.severity === 'blocker'
  )
  // Exclude direct-store-access from warning count since stores are penalized separately
  const warnings = component.couplingIssues.filter(
    (i) => i.severity === 'warning' && i.type !== 'direct-store-access'
  )

  // Penalties
  if (blockers.length > 0) score -= 0.4 * blockers.length
  if (storeAccess.length > 0) score -= 0.2 * storeAccess.length
  if (warnings.length > 0) score -= 0.1 * warnings.length

  // Positive signals
  if (component.props.length > 0) score += 0.1
  if (component.slots.length > 0) score += 0.1

  // Path-based signals
  if (/\/pages?\/|\/views?\//.test(component.filePath)) score -= 0.3
  if (/\/components?\/(ui|base|common|shared)\//.test(component.filePath))
    score += 0.15
  if (/\/layouts?\//.test(component.filePath)) score -= 0.1

  const confidence = Math.max(0, Math.min(1, score))

  let tier: ReusabilityTier
  if (
    confidence >= 0.85 &&
    componentDeps.length === 0 &&
    storeAccess.length === 0
  ) {
    tier = 'primitive'
  } else if (confidence >= 0.7 && storeAccess.length === 0) {
    tier = 'composite'
  } else if (confidence >= 0.5) {
    tier = 'feature'
  } else if (confidence >= 0.3) {
    tier = 'page-bound'
  } else {
    tier = 'app-specific'
  }

  return { tier, confidence }
}

// --- LOC Counter ---

function countLOC(
  descriptor: ReturnType<typeof parse>['descriptor']
): AnalyzedComponent['loc'] {
  const countLines = (s: string | undefined) =>
    s ? s.split('\n').filter((l) => l.trim()).length : 0

  const template = countLines(descriptor.template?.content)
  const script = countLines(
    descriptor.script?.content || descriptor.scriptSetup?.content
  )
  const style = descriptor.styles.reduce(
    (sum, s) => sum + countLines(s.content),
    0
  )

  return { template, script, style, total: template + script + style }
}

// ============================================================================
// Main Analyzer
// ============================================================================

export async function analyzeSFC(
  filePath: string,
  absolutePath: string,
  projectRoot: string,
  aliases: Record<string, string>
): Promise<AnalyzedComponent> {
  const source = readFileSync(absolutePath, 'utf-8')
  const { descriptor, errors } = parse(source, { filename: filePath })

  if (errors.length > 0) {
    console.warn(
      `[vue-harvest] Parse warnings for ${filePath}:`,
      errors.map((e) => e.message)
    )
  }

  const name = toComponentName(filePath)
  const variant = detectScriptVariant(descriptor)
  const scriptContent =
    descriptor.scriptSetup?.content || descriptor.script?.content || ''
  const templateContent = descriptor.template?.content || ''

  const props = extractProps(scriptContent, variant)
  const emits = extractEmits(scriptContent, variant)
  const slots = extractSlots(templateContent)
  const styles = analyzeStyles(descriptor)
  const dependencies = await extractDependencies(scriptContent, aliases)

  const couplingIssues = detectCouplingIssues(
    scriptContent,
    templateContent,
    styles,
    dependencies
  )

  const { tier, confidence } = classifyReusability({
    props,
    dependencies,
    couplingIssues,
    slots,
    filePath,
  })

  const contentHash = createHash('sha256')
    .update(source)
    .digest('hex')
    .slice(0, 12)

  const templateSummary =
    templateContent.length > 2000
      ? templateContent.slice(0, 2000) + '\n<!-- ... truncated -->'
      : templateContent

  return {
    name,
    filePath,
    absolutePath,
    fileSize: Buffer.byteLength(source, 'utf-8'),
    props,
    emits,
    slots,
    expose: [],
    scriptVariant: variant,
    dependencies,
    transitiveDeps: [],
    peerPackages: dependencies
      .filter((d) => d.kind === 'external-package' && !d.typeOnly)
      .map((d) => d.specifier),
    styles,
    tier,
    extractionConfidence: confidence,
    couplingIssues,
    rawSource: source,
    templateSummary,
    loc: countLOC(descriptor),
    contentHash,
  }
}
