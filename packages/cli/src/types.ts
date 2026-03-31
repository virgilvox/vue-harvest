// ============================================================================
// Vue Harvest — Core Type System
// ============================================================================

// --- Configuration ---

export interface HarvestConfig {
  root: string
  include: string[]
  exclude: string[]
  aliases: Record<string, string>
  extractionThreshold: number
  outDir: string
  registry: 'json' | 'typescript'
}

// --- Component Interface Types ---

export interface PropDefinition {
  name: string
  type: string
  required: boolean
  default?: string
  validator?: string
  description?: string
}

export interface EmitDefinition {
  name: string
  payload?: string
  description?: string
}

export interface SlotDefinition {
  name: string
  bindings: Array<{ name: string; type: string }>
  description?: string
}

export interface ExposeDefinition {
  name: string
  type: string
  description?: string
}

export type ScriptVariant =
  | 'setup-ts'
  | 'setup-js'
  | 'options-ts'
  | 'options-js'
  | 'composition-ts'
  | 'composition-js'
  | 'none'

// --- Style Analysis ---

export interface StyleBlock {
  lang: 'css' | 'scss' | 'less' | 'postcss' | 'stylus'
  scoped: boolean
  module: boolean | string
  source: string
  cssVarsUsed: string[]
  cssVarsDefined: string[]
  externalImports: string[]
}

// --- Dependencies ---

export type DependencyKind =
  | 'internal-component'
  | 'internal-composable'
  | 'internal-util'
  | 'internal-store'
  | 'internal-type'
  | 'internal-asset'
  | 'internal-style'
  | 'external-package'
  | 'vue-core'
  | 'global-plugin'
  | 'provide-inject'
  | 'unknown'

export interface Dependency {
  specifier: string
  resolvedPath: string | null
  kind: DependencyKind
  imports: string[]
  typeOnly: boolean
  isPeer: boolean
  depth: number
}

// --- Coupling Analysis ---

export type CouplingIssueType =
  | 'direct-store-access'
  | 'hardcoded-api'
  | 'router-dependency'
  | 'i18n-dependency'
  | 'global-inject'
  | 'env-variable'
  | 'unscoped-css'
  | 'deep-provide-chain'
  | 'implicit-global'
  | 'side-effect-import'

export interface CouplingIssue {
  type: CouplingIssueType
  description: string
  line?: number
  column?: number
  severity: 'blocker' | 'warning' | 'info'
  suggestedFix?: string
}

// --- Component Classification ---

export type ReusabilityTier =
  | 'primitive'
  | 'composite'
  | 'feature'
  | 'page-bound'
  | 'app-specific'

export interface AnalyzedComponent {
  name: string
  filePath: string
  absolutePath: string
  fileSize: number

  props: PropDefinition[]
  emits: EmitDefinition[]
  slots: SlotDefinition[]
  expose: ExposeDefinition[]
  scriptVariant: ScriptVariant

  dependencies: Dependency[]
  transitiveDeps: string[]
  peerPackages: string[]

  styles: StyleBlock[]

  tier: ReusabilityTier
  extractionConfidence: number
  couplingIssues: CouplingIssue[]

  rawSource: string
  templateSummary?: string

  loc: { template: number; script: number; style: number; total: number }
  contentHash: string
}

// --- Dependency Graph ---

export interface ComponentEdge {
  source: string
  target: string
  type: 'imports' | 'slot-renders' | 'dynamic-component'
}

export interface ComponentGraph {
  nodes: Array<{
    id: string
    filePath: string
    tier: ReusabilityTier
    confidence: number
  }>
  edges: ComponentEdge[]
  roots: string[]
  leaves: string[]
  cycles: string[][]
}

// --- Extraction ---

export interface ExtractionManifest {
  component: string
  files: Array<{
    from: string
    to: string
    needsTransform: boolean
    role: 'component' | 'composable' | 'util' | 'type' | 'style' | 'asset'
  }>
  peerDependencies: Record<string, string>
  requiredGlobals: string[]
  importRewrites: Record<string, string>
  requiredCssVars: string[]
  notes: string[]
}

export interface ExtractionResult {
  success: boolean
  manifest: ExtractionManifest
  files: Record<string, string>
  issues: Array<{
    severity: 'error' | 'warning' | 'info'
    message: string
    file?: string
    suggestion?: string
  }>
}

// --- Registry (shadcn-compatible) ---

export interface RegistryEntry {
  name: string
  type: 'component' | 'composable' | 'util'
  description?: string
  tier: ReusabilityTier
  files: string[]
  dependencies: string[]
  peerDependencies: string[]
  registryDependencies: string[]
  cssVars: string[]
  meta: {
    props: PropDefinition[]
    emits: EmitDefinition[]
    slots: SlotDefinition[]
    loc: number
  }
}

export interface HarvestRegistry {
  $schema: string
  name: string
  version: string
  source: string
  generatedAt: string
  config: Partial<HarvestConfig>
  components: RegistryEntry[]
  composables: RegistryEntry[]
  utils: RegistryEntry[]
  graph: ComponentGraph
  stats: {
    totalComponents: number
    autoExtractable: number
    needsReview: number
    appSpecific: number
    totalFiles: number
  }
}

// --- Design System / Token Types ---

export interface DesignToken {
  name: string
  value: string
  type: DesignTokenType
  source: TokenSource
  usageCount: number
  /** Which components use this token */
  usedBy: string[]
}

export type DesignTokenType =
  | 'color'
  | 'font-family'
  | 'font-size'
  | 'font-weight'
  | 'line-height'
  | 'letter-spacing'
  | 'spacing'
  | 'border-radius'
  | 'border-width'
  | 'shadow'
  | 'opacity'
  | 'z-index'
  | 'transition'
  | 'breakpoint'

export interface TokenSource {
  file: string
  line?: number
  context: 'css-value' | 'css-variable' | 'tailwind-class' | 'inline-style' | 'js-constant'
}

export interface DesignSystemReport {
  tokens: DesignToken[]
  /** Grouped by type for easy consumption */
  byType: Record<DesignTokenType, DesignToken[]>
  /** Color palette (deduplicated, normalized) */
  palette: Array<{ hex: string; name?: string; usageCount: number }>
  /** Typography scale */
  typography: {
    families: string[]
    sizes: string[]
    weights: string[]
    lineHeights: string[]
  }
  /** Spacing scale (sorted, deduplicated) */
  spacing: string[]
  /** Border radii */
  radii: string[]
  /** Shadows */
  shadows: string[]
  /** CSS custom properties defined in the project (the project's own design tokens) */
  projectTokens: ProjectToken[]
  /** Hardcoded values used outside of CSS custom properties */
  hardcodedValues: DesignToken[]
  /** Raw project CSS (theme + component classes) for live rendering */
  themeCSS?: string
  /** Google Fonts loaded by the project */
  googleFonts: string[]
  /** Stats */
  stats: {
    totalTokens: number
    uniqueColors: number
    uniqueFontSizes: number
    uniqueSpacingValues: number
    componentsAnalyzed: number
    /** How many values are hardcoded vs tokenized */
    tokenizationRate: number
    /** How many CSS custom properties are defined */
    projectTokenCount: number
    /** How many var() references are used */
    varReferenceCount: number
    /** How many truly hardcoded values exist */
    hardcodedCount: number
  }
}

/** A CSS custom property defined in the project — the project's actual design tokens */
export interface ProjectToken {
  /** CSS custom property name (e.g., '--accent', '--font-sans') */
  name: string
  /** Resolved value (e.g., '#00e7ad', "'Poppins', system-ui, sans-serif") */
  value: string
  /** Token type */
  type: DesignTokenType
  /** Source file where defined */
  source: TokenSource
  /** Number of var() references to this token */
  usageCount: number
  /** Whether this is a dark mode override */
  isDarkMode?: boolean
  /** Whether this token aliases another via var() */
  aliasOf?: string
}

export interface TokenApplicationResult {
  file: string
  changes: Array<{
    line: number
    before: string
    after: string
    tokenName: string
    tokenType: DesignTokenType
  }>
}

// --- CSS Component Discovery ---

export type CSSComponentCategory =
  | 'button'
  | 'input'
  | 'select'
  | 'textarea'
  | 'checkbox'
  | 'card'
  | 'badge'
  | 'tag'
  | 'navigation'
  | 'layout'
  | 'prose'
  | 'modal'
  | 'alert'
  | 'table'
  | 'list'
  | 'media'
  | 'utility'
  | 'unknown'

export type CSSNamingConvention =
  | 'bem'
  | 'prefix'
  | 'smacss'
  | 'tailwind'
  | 'flat'
  | 'mixed'

export interface CSSComponentClass {
  selector: string
  category: CSSComponentCategory
  confidence: number
  variants: CSSComponentVariant[]
  properties: Record<string, string>
  source: string
  usesTokens: boolean
}

export interface CSSComponentVariant {
  selector: string
  kind: 'size' | 'color' | 'state' | 'layout' | 'generic'
  properties: Record<string, string>
}

export interface CSSComponentGroup {
  label: string
  category: CSSComponentCategory
  icon: string
  components: CSSComponentClass[]
  examples: GeneratedExample[]
}

export interface GeneratedExample {
  label: string
  html: string
  classes: string[]
}

export type CSSSystemType =
  | 'custom-properties'
  | 'tailwind'
  | 'component-library'
  | 'css-modules'
  | 'scoped-only'
  | 'mixed'

export interface CSSComponentReport {
  systemType: CSSSystemType
  namingConvention: CSSNamingConvention
  classPrefix: string | null
  groups: CSSComponentGroup[]
  totalClasses: number
  stats: {
    buttonCount: number
    formCount: number
    layoutCount: number
    contentCount: number
    otherCount: number
  }
}
