import { readFileSync, existsSync } from 'fs'
import glob from 'fast-glob'
import { resolve } from 'pathe'
import type {
  DesignToken,
  DesignTokenType,
  TokenSource,
  DesignSystemReport,
  ProjectToken,
  HarvestConfig,
} from '../types.js'
import {
  collectCSSVariables,
  resolveVariable,
  resolveValueVars,
  detectDarkModeRanges,
  extractGoogleFonts,
} from '../utils/css-parser.js'

// --- Color Detection ---

const HEX_PATTERN = /#(?:[0-9a-fA-F]{3,4}){1,2}\b/g
const RGB_PATTERN = /rgba?\(\s*[\d.]+%?\s*[,\s]\s*[\d.]+%?\s*[,\s]\s*[\d.]+%?\s*(?:[,/]\s*[\d.]+%?\s*)?\)/g
const HSL_PATTERN = /hsla?\(\s*[\d.]+\s*[,\s]\s*[\d.]+%\s*[,\s]\s*[\d.]+%\s*(?:[,/]\s*[\d.]+%?\s*)?\)/g
// --- Value Classification ---

const FONT_SIZE_PATTERN = /^\d+(\.\d+)?(px|rem|em|pt|vw|vh|%)$/
const SPACING_PATTERN = /^\d+(\.\d+)?(px|rem|em|%)$/

// CSS properties that map to token types
const PROPERTY_TOKEN_MAP: Record<string, DesignTokenType> = {
  'color': 'color',
  'background-color': 'color',
  'background': 'color',
  'border-color': 'color',
  'outline-color': 'color',
  'fill': 'color',
  'stroke': 'color',
  'caret-color': 'color',
  'accent-color': 'color',
  'text-decoration-color': 'color',
  'column-rule-color': 'color',

  'font-family': 'font-family',
  'font-size': 'font-size',
  'font-weight': 'font-weight',
  'line-height': 'line-height',
  'letter-spacing': 'letter-spacing',

  'padding': 'spacing',
  'padding-top': 'spacing',
  'padding-right': 'spacing',
  'padding-bottom': 'spacing',
  'padding-left': 'spacing',
  'margin': 'spacing',
  'margin-top': 'spacing',
  'margin-right': 'spacing',
  'margin-bottom': 'spacing',
  'margin-left': 'spacing',
  'gap': 'spacing',
  'row-gap': 'spacing',
  'column-gap': 'spacing',
  'top': 'spacing',
  'right': 'spacing',
  'bottom': 'spacing',
  'left': 'spacing',
  'width': 'spacing',
  'height': 'spacing',
  'min-width': 'spacing',
  'min-height': 'spacing',
  'max-width': 'spacing',
  'max-height': 'spacing',

  'border-radius': 'border-radius',
  'border-top-left-radius': 'border-radius',
  'border-top-right-radius': 'border-radius',
  'border-bottom-left-radius': 'border-radius',
  'border-bottom-right-radius': 'border-radius',

  'border-width': 'border-width',
  'border-top-width': 'border-width',
  'border-right-width': 'border-width',
  'border-bottom-width': 'border-width',
  'border-left-width': 'border-width',
  'outline-width': 'border-width',

  'box-shadow': 'shadow',
  'text-shadow': 'shadow',

  'opacity': 'opacity',
  'z-index': 'z-index',

  'transition': 'transition',
  'transition-duration': 'transition',
  'transition-timing-function': 'transition',
  'animation-duration': 'transition',
}

// --- Token Extraction ---

interface RawToken {
  value: string
  type: DesignTokenType
  source: TokenSource
  /** Original CSS custom property name (e.g., '--accent') if this is a variable definition */
  originalName?: string
  /** True if this value came from resolving a var() reference (i.e., using a token, not hardcoding) */
  isTokenUsage?: boolean
  /** True if this is a dark mode override */
  isDarkMode?: boolean
  /** If this token aliases another via var(), the name of the aliased token */
  aliasOf?: string
}

// collectCSSVariables, resolveVariable, resolveValueVars, detectDarkModeRanges,
// extractGoogleFonts are imported from ../utils/css-parser.js

// --- Font Stack Detection ---

const GENERIC_FONT_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
  'emoji', 'math', 'fangsong',
  '-apple-system', 'BlinkMacSystemFont',
])

/** Checks if a value looks like a font-family stack */
function isFontStackValue(value: string): boolean {
  // Contains quoted font names like 'Poppins' or "Nunito"
  if (/['"][A-Za-z]/.test(value)) {
    // And contains commas (font stack separator)
    if (value.includes(',')) {
      // And contains generic family or system font keywords
      const lower = value.toLowerCase()
      for (const generic of GENERIC_FONT_FAMILIES) {
        if (lower.includes(generic.toLowerCase())) return true
      }
      // Still a font stack if it has quoted name + comma
      return true
    }
  }
  // Single generic font family
  if (GENERIC_FONT_FAMILIES.has(value.trim())) return true
  return false
}

/** Extracts the primary (first) font name from a font stack */
function extractPrimaryFont(fontStack: string): string {
  const first = fontStack.split(',')[0].trim()
  // Strip quotes
  return first.replace(/^['"]|['"]$/g, '').trim()
}

function extractTokensFromCSS(
  cssContent: string,
  filePath: string,
  componentName?: string,
  sharedVarMap?: Map<string, string>
): RawToken[] {
  const tokens: RawToken[] = []

  // Build CSS variable map for this file (merged with shared if provided)
  const localVars = collectCSSVariables(cssContent)
  const varMap = new Map<string, string>(sharedVarMap || [])
  for (const [k, v] of localVars) {
    varMap.set(k, v)
  }

  // Detect if we're inside a dark mode block
  const darkModeRanges = detectDarkModeRanges(cssContent)

  // Parse CSS declarations
  const declarationPattern = /([\w-]+)\s*:\s*([^;{}]+);/g
  let match

  while ((match = declarationPattern.exec(cssContent)) !== null) {
    const property = match[1].trim()
    const rawValue = match[2].trim()
    const line = cssContent.slice(0, match.index).split('\n').length
    const isDark = darkModeRanges.some(([s, e]) => match!.index >= s && match!.index <= e)

    // Check if this is a CSS variable definition
    if (property.startsWith('--')) {
      let resolvedValue = rawValue
      let aliasOf: string | undefined

      if (rawValue.includes('var(')) {
        // Track the alias relationship
        const varRef = rawValue.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/)
        if (varRef) aliasOf = varRef[1]

        const resolved = resolveValueVars(rawValue, varMap)
        if (resolved) {
          resolvedValue = resolved
        } else {
          // Can't resolve — still record the definition with original value
          resolvedValue = rawValue
        }
      }

      const tokenType = inferTokenType(property, resolvedValue)
      if (tokenType) {
        tokens.push({
          value: resolvedValue,
          type: tokenType,
          originalName: property,
          isDarkMode: isDark,
          aliasOf,
          source: {
            file: filePath,
            line,
            context: 'css-variable',
          },
        })
      }
      continue
    }

    // For standard properties, check if value uses var() (token usage) or is hardcoded
    let effectiveValue = rawValue
    const usesVar = rawValue.includes('var(')

    if (usesVar) {
      const resolved = resolveValueVars(rawValue, varMap)
      if (resolved) {
        effectiveValue = resolved
      } else {
        // Can't resolve the variable — skip this declaration
        continue
      }
    }

    const tokenType = PROPERTY_TOKEN_MAP[property]
    if (!tokenType) continue

    // For shorthand properties, we might get multiple values
    if (tokenType === 'color') {
      const colors = extractColorsFromValue(effectiveValue)
      for (const color of colors) {
        tokens.push({
          value: color,
          type: 'color',
          isTokenUsage: usesVar,
          source: { file: filePath, line, context: 'css-value' },
        })
      }
    } else if (tokenType === 'spacing' && isValidSpacing(effectiveValue)) {
      const parts = effectiveValue.split(/\s+/)
      for (const part of parts) {
        if (SPACING_PATTERN.test(part) && !isAutoOrNone(part)) {
          tokens.push({
            value: part,
            type: 'spacing',
            isTokenUsage: usesVar,
            source: { file: filePath, line, context: 'css-value' },
          })
        }
      }
    } else {
      tokens.push({
        value: effectiveValue,
        type: tokenType,
        isTokenUsage: usesVar,
        source: { file: filePath, line, context: 'css-value' },
      })
    }
  }

  return tokens
}

// detectDarkModeRanges is imported from ../utils/css-parser.js

function extractColorsFromValue(value: string): string[] {
  const colors: string[] = []

  // Hex colors
  const hexMatches = value.match(HEX_PATTERN)
  if (hexMatches) colors.push(...hexMatches)

  // RGB/RGBA
  const rgbMatches = value.match(RGB_PATTERN)
  if (rgbMatches) colors.push(...rgbMatches)

  // HSL/HSLA
  const hslMatches = value.match(HSL_PATTERN)
  if (hslMatches) colors.push(...hslMatches)

  return colors
}

function inferTokenType(property: string, value: string): DesignTokenType | null {
  const lowerProp = property.toLowerCase()

  // === Property-name based inference ===
  // Works for both standard properties and CSS custom properties (--font-sans, --color-primary, etc.)

  // Color: --color-*, --bg-*, --accent, --*-color, background, fill, stroke, etc.
  if (/(?:^--).*(?:color|bg|background|fill|stroke|accent|tint|brand|primary|secondary|surface|border-color|text-color|ink|highlight)/i.test(lowerProp) ||
      /^(?:color|background(?:-color)?|fill|stroke|caret-color|accent-color|outline-color|text-decoration-color|column-rule-color)$/.test(lowerProp)) {
    // Only if value actually looks like a color
    if (extractColorsFromValue(value).length > 0 || value === 'transparent' || value === 'currentColor') {
      return 'color'
    }
  }

  // Font size: --font-size-*, --text-size-*, --text-xs, --text-sm, etc.
  if (/(?:font-size|text-size|--text-(?:xs|sm|base|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl)$)/i.test(lowerProp)) return 'font-size'

  // Font weight: --font-weight-*, --fw-*, --weight-*
  if (/font-weight|--fw-|--weight-/i.test(lowerProp)) return 'font-weight'

  // Font family: --font-family-*, --font-sans, --font-serif, --font-mono, --font-display,
  // --font-body, --font-heading, --font-code, --font-ui, --ff-*
  // But NOT --font-size-* or --font-weight-*
  if (/font-family/i.test(lowerProp)) return 'font-family'
  if (/^--font-(?!size|weight)[\w-]+$/i.test(lowerProp)) return 'font-family'
  if (/^--ff-/i.test(lowerProp)) return 'font-family'

  // Line height
  if (/line-height|--leading-/i.test(lowerProp)) return 'line-height'

  // Letter spacing
  if (/letter-spacing|--tracking-/i.test(lowerProp)) return 'letter-spacing'

  // Spacing: --space-*, --spacing-*, --gap-*, --pad-*, --margin-*
  if (/spacing|^--space-|^--gap-|^--pad-|^--margin-/i.test(lowerProp)) return 'spacing'
  if (/^(?:padding|margin|gap|row-gap|column-gap|top|right|bottom|left|width|height|min-width|min-height|max-width|max-height)(?:-(?:top|right|bottom|left))?$/.test(lowerProp)) return 'spacing'

  // Border radius: --radius-*, --rounded-*
  if (/radius|^--rounded-/i.test(lowerProp)) return 'border-radius'

  // Shadow: --shadow-*
  if (/shadow/i.test(lowerProp)) return 'shadow'

  // Z-index: --z-*, --z-index-*
  if (/z-index|^--z-/i.test(lowerProp)) return 'z-index'

  // Opacity: --opacity-*
  if (/opacity/i.test(lowerProp)) return 'opacity'

  // Transition: --transition-*, --duration-*, --ease-*
  if (/transition|duration|animation|^--ease-/i.test(lowerProp)) return 'transition'

  // Border width
  if (/border-width|outline-width/i.test(lowerProp)) return 'border-width'

  // === Value-based inference (for generic --var names) ===

  // Check if value looks like a font stack
  if (isFontStackValue(value)) return 'font-family'

  // Check if value contains colors
  if (extractColorsFromValue(value).length > 0) return 'color'

  // Check if value looks like a font size
  if (FONT_SIZE_PATTERN.test(value)) return 'font-size'

  // Check if value looks like a font weight (100-900, bold, normal, etc.)
  if (/^(?:[1-9]00|bold|bolder|lighter|normal)$/.test(value)) return 'font-weight'

  // Check if value looks like a shadow
  if (/^\d+px\s+\d+px/.test(value)) return 'shadow'

  // Check if value looks like a transition
  if (/\d+(\.\d+)?m?s\b/.test(value) && /ease|linear|cubic-bezier/i.test(value)) return 'transition'

  return null
}

function isValidSpacing(value: string): boolean {
  const parts = value.split(/\s+/)
  return parts.every(
    (p) => SPACING_PATTERN.test(p) || p === 'auto' || p === '0'
  )
}

function isAutoOrNone(value: string): boolean {
  return ['auto', 'none', 'inherit', 'initial', 'unset', '0'].includes(value)
}

// --- Color Normalization ---

function normalizeHex(hex: string): string {
  let h = hex.toLowerCase()
  // Expand 3-char hex to 6-char
  if (h.length === 4) {
    h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`
  }
  return h
}

// --- Main Analysis ---

export async function analyzeDesignSystem(
  config: HarvestConfig,
  analyzedComponents?: Map<string, { name: string; filePath: string; styles: Array<{ source: string }> }>
): Promise<DesignSystemReport> {
  const allTokens: RawToken[] = []
  const googleFonts: string[] = []
  const themeCSSParts: string[] = []

  // Build a global CSS variable map from all sources first (two-pass approach)
  // This lets us resolve var() references across files
  const globalVarMap = new Map<string, string>()

  // Pass 1: Collect all CSS variable definitions and theme CSS
  const styleFiles = await glob(
    ['**/*.css', '**/*.scss', '**/*.less'],
    {
      cwd: config.root,
      ignore: config.exclude,
      absolute: false,
    }
  )

  for (const file of styleFiles) {
    const absolutePath = resolve(config.root, file)
    if (!existsSync(absolutePath)) continue
    const content = readFileSync(absolutePath, 'utf-8')
    const fileVars = collectCSSVariables(content)
    for (const [k, v] of fileVars) {
      globalVarMap.set(k, v)
    }
    // Collect theme CSS for live rendering
    themeCSSParts.push(`/* --- ${file} --- */\n${content}`)
    // Extract Google Fonts from @import URLs
    const fonts = extractGoogleFonts(content)
    for (const f of fonts) {
      if (!googleFonts.includes(f)) googleFonts.push(f)
    }
  }

  // Also scan CSS files from node_modules that are referenced in config
  // (e.g., @commonpub/ui/theme/*.css loaded via nuxt.config)
  const packageThemeCSS = await collectPackageThemeCSS(config.root)
  for (const { file, content } of packageThemeCSS) {
    const fileVars = collectCSSVariables(content)
    for (const [k, v] of fileVars) {
      // Only set if not already overridden by project CSS
      if (!globalVarMap.has(k)) globalVarMap.set(k, v)
    }
    themeCSSParts.unshift(`/* --- ${file} --- */\n${content}`)
    const fonts = extractGoogleFonts(content)
    for (const f of fonts) {
      if (!googleFonts.includes(f)) googleFonts.push(f)
    }
  }

  // Also collect vars from Vue SFC styles
  if (analyzedComponents) {
    for (const [, comp] of analyzedComponents) {
      for (const style of comp.styles) {
        const fileVars = collectCSSVariables(style.source)
        for (const [k, v] of fileVars) {
          globalVarMap.set(k, v)
        }
      }
    }
  }

  // Count var() references across all sources for usage tracking
  const varRefCounts = new Map<string, number>()
  const allCSS = themeCSSParts.join('\n')
  const varRefPattern = /var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)/g
  let refMatch
  while ((refMatch = varRefPattern.exec(allCSS)) !== null) {
    const name = refMatch[1]
    varRefCounts.set(name, (varRefCounts.get(name) || 0) + 1)
  }
  // Also count in SFC styles
  if (analyzedComponents) {
    for (const [, comp] of analyzedComponents) {
      for (const style of comp.styles) {
        const pat = /var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)/g
        let rm
        while ((rm = pat.exec(style.source)) !== null) {
          const name = rm[1]
          varRefCounts.set(name, (varRefCounts.get(name) || 0) + 1)
        }
      }
    }
  }

  // Pass 2: Extract tokens with full variable resolution

  // 2a. Standalone CSS/SCSS files (project + package)
  for (const file of styleFiles) {
    const absolutePath = resolve(config.root, file)
    if (!existsSync(absolutePath)) continue
    const content = readFileSync(absolutePath, 'utf-8')
    const tokens = extractTokensFromCSS(content, file, undefined, globalVarMap)
    allTokens.push(...tokens)
  }
  for (const { file, content } of packageThemeCSS) {
    const tokens = extractTokensFromCSS(content, file, undefined, globalVarMap)
    allTokens.push(...tokens)
  }

  // 2b. Vue SFC styles
  if (analyzedComponents) {
    for (const [name, comp] of analyzedComponents) {
      for (const style of comp.styles) {
        const tokens = extractTokensFromCSS(style.source, comp.filePath, name, globalVarMap)
        allTokens.push(...tokens)
      }
    }
  }

  // 3. Deduplicate and aggregate tokens
  return buildReport(
    allTokens,
    analyzedComponents?.size || 0,
    varRefCounts,
    googleFonts,
    themeCSSParts.join('\n\n'),
  )
}

/** Scan for CSS theme files from packages loaded via nuxt/vite config */
async function collectPackageThemeCSS(
  root: string
): Promise<Array<{ file: string; content: string }>> {
  const results: Array<{ file: string; content: string }> = []

  // Check nuxt.config.ts for css: [...] entries
  const nuxtConfig = resolve(root, 'nuxt.config.ts')
  const nuxtConfigAlt = resolve(root, 'nuxt.config.js')
  const configPath = existsSync(nuxtConfig) ? nuxtConfig : existsSync(nuxtConfigAlt) ? nuxtConfigAlt : null

  if (!configPath) return results

  try {
    const configContent = readFileSync(configPath, 'utf-8')
    // Extract CSS file references from the config
    // Match patterns like '@commonpub/ui/theme/base.css' or '~/assets/foo.css'
    const cssRefPattern = /['"](@[\w-]+\/[\w-]+\/[\w/.]+\.css)['"]/g
    let m
    while ((m = cssRefPattern.exec(configContent)) !== null) {
      const pkgPath = m[1]
      // Resolve from node_modules
      const fullPath = resolve(root, 'node_modules', pkgPath)
      if (existsSync(fullPath)) {
        try {
          const content = readFileSync(fullPath, 'utf-8')
          results.push({ file: pkgPath, content })
        } catch {
          // Skip unreadable files
        }
      }
    }
  } catch {
    // Skip if config can't be read
  }

  return results
}

function buildReport(
  rawTokens: RawToken[],
  componentsAnalyzed: number,
  varRefCounts: Map<string, number>,
  googleFonts: string[],
  themeCSS: string,
): DesignSystemReport {
  // === Separate project tokens (CSS variable definitions) from usage ===
  const projectTokenMap = new Map<string, ProjectToken>()
  const hardcodedTokens: RawToken[] = []
  const varUsageTokens: RawToken[] = []

  for (const raw of rawTokens) {
    if (raw.source.context === 'css-variable' && raw.originalName) {
      // This is a CSS custom property definition — a project token
      const existing = projectTokenMap.get(raw.originalName)
      if (!existing || raw.isDarkMode) {
        // Keep the light mode definition as primary, dark as override
        if (!existing) {
          projectTokenMap.set(raw.originalName, {
            name: raw.originalName,
            value: raw.value,
            type: raw.type,
            source: raw.source,
            usageCount: varRefCounts.get(raw.originalName) || 0,
            isDarkMode: raw.isDarkMode,
            aliasOf: raw.aliasOf,
          })
        }
        // If dark mode override, don't replace the light mode definition
      }
    } else if (raw.isTokenUsage) {
      // This value came from resolving a var() — it's token usage (good)
      varUsageTokens.push(raw)
    } else {
      // This is a truly hardcoded value
      hardcodedTokens.push(raw)
    }
  }

  const projectTokens = [...projectTokenMap.values()]
    .filter(t => !t.isDarkMode && !t.aliasOf) // Show only primary light-mode definitions
    .sort((a, b) => b.usageCount - a.usageCount)

  // === Build the legacy token list (for backward compat) ===
  const tokenMap = new Map<string, DesignToken>()
  for (const raw of rawTokens) {
    const key = `${raw.type}:${raw.value}`
    const existing = tokenMap.get(key)
    if (existing) {
      existing.usageCount++
    } else {
      tokenMap.set(key, {
        name: raw.originalName || generateTokenName(raw.type, raw.value, tokenMap),
        value: raw.value,
        type: raw.type,
        source: raw.source,
        usageCount: 1,
        usedBy: [],
      })
    }
  }

  const tokens = [...tokenMap.values()].sort((a, b) => b.usageCount - a.usageCount)

  // Group by type
  const byType: Record<DesignTokenType, DesignToken[]> = {} as any
  for (const token of tokens) {
    if (!byType[token.type]) byType[token.type] = []
    byType[token.type].push(token)
  }

  // === Build palette from project tokens first, then hardcoded ===
  const paletteMap = new Map<string, { hex: string; name?: string; usageCount: number }>()

  // Add project-defined color tokens with their real names
  for (const pt of projectTokens) {
    if (pt.type !== 'color') continue
    const hex = pt.value.startsWith('#') ? normalizeHex(pt.value) : pt.value
    const existing = paletteMap.get(hex)
    if (existing) {
      existing.usageCount += pt.usageCount
      // Prefer the shorter/more semantic name
      if (!existing.name || pt.name.length < existing.name.length) {
        existing.name = pt.name
      }
    } else {
      paletteMap.set(hex, { hex, name: pt.name, usageCount: pt.usageCount })
    }
  }

  // Add hardcoded colors (no name)
  for (const raw of hardcodedTokens) {
    if (raw.type !== 'color') continue
    const hex = raw.value.startsWith('#') ? normalizeHex(raw.value) : raw.value
    const existing = paletteMap.get(hex)
    if (existing) {
      existing.usageCount++
    } else {
      paletteMap.set(hex, { hex, usageCount: 1 })
    }
  }

  const palette = [...paletteMap.values()].sort((a, b) => b.usageCount - a.usageCount)

  // === Typography from project tokens ===
  const fontFamilies: string[] = []
  const seenPrimaryFonts = new Set<string>()

  // First from project tokens
  for (const pt of projectTokens) {
    if (pt.type !== 'font-family') continue
    const primary = extractPrimaryFont(pt.value)
    if (primary && !seenPrimaryFonts.has(primary.toLowerCase())) {
      seenPrimaryFonts.add(primary.toLowerCase())
      fontFamilies.push(pt.value)
    }
  }
  // Then from Google Fonts
  for (const gf of googleFonts) {
    if (!seenPrimaryFonts.has(gf.toLowerCase())) {
      seenPrimaryFonts.add(gf.toLowerCase())
      fontFamilies.push(gf)
    }
  }

  // Font sizes — prefer project token names
  const fontSizeTokens = projectTokens.filter(t => t.type === 'font-size')
  const fontSizes = fontSizeTokens.length > 0
    ? fontSizeTokens.map(t => t.value)
    : [...new Set((byType['font-size'] || []).map(t => t.value))]

  const fontWeights = [...new Set(
    projectTokens.filter(t => t.type === 'font-weight').map(t => t.value)
      .concat((byType['font-weight'] || []).map(t => t.value))
  )]

  const lineHeights = [...new Set(
    projectTokens.filter(t => t.type === 'line-height').map(t => t.value)
      .concat((byType['line-height'] || []).map(t => t.value))
  )]

  // Spacing from project tokens
  const spacingFromTokens = projectTokens.filter(t => t.type === 'spacing').map(t => t.value)
  const spacingFromHardcoded = hardcodedTokens.filter(t => t.type === 'spacing').map(t => t.value)
  const uniqueSpacing = [...new Set([...spacingFromTokens, ...spacingFromHardcoded])].sort(sortNumericValues)

  // Radii
  const radii = [...new Set(
    projectTokens.filter(t => t.type === 'border-radius').map(t => t.value)
      .concat((byType['border-radius'] || []).map(t => t.value))
  )]

  // Shadows
  const shadows = [...new Set(
    projectTokens.filter(t => t.type === 'shadow').map(t => t.value)
      .concat((byType['shadow'] || []).map(t => t.value))
  )]

  // === Hardcoded values for the report ===
  const hardcodedAggMap = new Map<string, DesignToken>()
  for (const raw of hardcodedTokens) {
    const key = `${raw.type}:${raw.value}`
    const existing = hardcodedAggMap.get(key)
    if (existing) {
      existing.usageCount++
    } else {
      hardcodedAggMap.set(key, {
        name: raw.value,
        value: raw.value,
        type: raw.type,
        source: raw.source,
        usageCount: 1,
        usedBy: [],
      })
    }
  }
  const hardcodedValues = [...hardcodedAggMap.values()].sort((a, b) => b.usageCount - a.usageCount)

  // === Tokenization rate: var() usages vs hardcoded usages ===
  const totalUsages = varUsageTokens.length + hardcodedTokens.length
  const tokenizationRate = totalUsages > 0 ? varUsageTokens.length / totalUsages : 0

  return {
    tokens,
    byType,
    palette,
    typography: {
      families: fontFamilies,
      sizes: [...new Set(fontSizes)].sort(sortNumericValues),
      weights: fontWeights,
      lineHeights,
    },
    spacing: uniqueSpacing,
    radii,
    shadows,
    projectTokens,
    hardcodedValues,
    themeCSS,
    googleFonts,
    stats: {
      totalTokens: tokens.length,
      uniqueColors: palette.length,
      uniqueFontSizes: new Set(fontSizes).size,
      uniqueSpacingValues: uniqueSpacing.length,
      componentsAnalyzed,
      tokenizationRate,
      projectTokenCount: projectTokens.length,
      varReferenceCount: varUsageTokens.length,
      hardcodedCount: hardcodedTokens.length,
    },
  }
}

function generateTokenName(
  type: DesignTokenType,
  value: string,
  existing: Map<string, DesignToken>
): string {
  const prefix = type.replace(/-/g, '_')
  // Use a short hash of the value
  const hash = Buffer.from(value).toString('base64url').slice(0, 6)
  return `--harvest-${prefix}-${hash}`
}

function sortNumericValues(a: string, b: string): number {
  const numA = parseFloat(a)
  const numB = parseFloat(b)
  if (!isNaN(numA) && !isNaN(numB)) return numA - numB
  return a.localeCompare(b)
}

// --- CSS Token Library Generation ---

export function generateTokenCSS(report: DesignSystemReport): string {
  const sections: string[] = []

  sections.push('/* ==========================================================')
  sections.push('   Vue Harvest — Design System Tokens')
  sections.push('   Generated automatically from project analysis')
  sections.push('   ========================================================== */')
  sections.push('')
  sections.push(':root {')

  // Colors
  if (report.palette.length > 0) {
    sections.push('  /* --- Colors --- */')
    for (let i = 0; i < report.palette.length; i++) {
      const c = report.palette[i]
      sections.push(`  --color-${i + 1}: ${c.hex}; /* used ${c.usageCount}x */`)
    }
    sections.push('')
  }

  // Typography
  if (report.typography.families.length > 0) {
    sections.push('  /* --- Font Families --- */')
    report.typography.families.forEach((f, i) => {
      sections.push(`  --font-family-${i + 1}: ${f};`)
    })
    sections.push('')
  }

  if (report.typography.sizes.length > 0) {
    sections.push('  /* --- Font Sizes --- */')
    report.typography.sizes.forEach((s, i) => {
      sections.push(`  --font-size-${i + 1}: ${s};`)
    })
    sections.push('')
  }

  if (report.typography.weights.length > 0) {
    sections.push('  /* --- Font Weights --- */')
    report.typography.weights.forEach((w, i) => {
      sections.push(`  --font-weight-${i + 1}: ${w};`)
    })
    sections.push('')
  }

  // Spacing
  if (report.spacing.length > 0) {
    sections.push('  /* --- Spacing Scale --- */')
    report.spacing.forEach((s, i) => {
      sections.push(`  --spacing-${i + 1}: ${s};`)
    })
    sections.push('')
  }

  // Border radii
  if (report.radii.length > 0) {
    sections.push('  /* --- Border Radii --- */')
    report.radii.forEach((r, i) => {
      sections.push(`  --radius-${i + 1}: ${r};`)
    })
    sections.push('')
  }

  // Shadows
  if (report.shadows.length > 0) {
    sections.push('  /* --- Shadows --- */')
    report.shadows.forEach((s, i) => {
      sections.push(`  --shadow-${i + 1}: ${s};`)
    })
    sections.push('')
  }

  sections.push('}')

  return sections.join('\n')
}

// --- Design System HTML Report ---

export function generateDesignSystemHTML(report: DesignSystemReport): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Design System — Vue Harvest</title>
  <style>
    :root { --bg: #0a0a0a; --surface: #141414; --border: #2a2a2a; --text: #e5e5e5; --muted: #888; --accent: #22d3ee; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: var(--bg); color: var(--text); font-family: 'Inter', -apple-system, sans-serif; padding: 2rem; line-height: 1.6; }
    h1 { color: var(--accent); font-family: 'JetBrains Mono', monospace; font-size: 1.5rem; margin-bottom: 0.5rem; }
    h2 { color: var(--text); font-size: 1.2rem; margin: 2rem 0 1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
    .stats { display: flex; gap: 2rem; margin: 1rem 0 2rem; font-family: monospace; font-size: 0.85rem; color: var(--muted); }
    .stats strong { color: var(--text); }
    .palette { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .swatch { width: 80px; text-align: center; }
    .swatch-color { width: 80px; height: 60px; border-radius: 6px; border: 1px solid var(--border); }
    .swatch-label { font-family: monospace; font-size: 0.65rem; color: var(--muted); margin-top: 0.3rem; word-break: break-all; }
    .swatch-count { font-family: monospace; font-size: 0.6rem; color: var(--accent); }
    .scale { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 0.5rem 0; }
    .scale-item { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 0.5rem 0.75rem; font-family: monospace; font-size: 0.8rem; }
    .scale-item small { color: var(--muted); font-size: 0.65rem; display: block; }
  </style>
</head>
<body>
  <h1>vue-harvest // design system</h1>
  <div class="stats">
    <span class="stat"><strong>${report.stats.uniqueColors}</strong> colors</span>
    <span class="stat"><strong>${report.stats.uniqueFontSizes}</strong> font sizes</span>
    <span class="stat"><strong>${report.stats.uniqueSpacingValues}</strong> spacing values</span>
    <span class="stat"><strong>${report.stats.totalTokens}</strong> total tokens</span>
    <span class="stat"><strong>${Math.round(report.stats.tokenizationRate * 100)}%</strong> tokenized</span>
  </div>

  <h2>Color Palette</h2>
  <div class="palette">
    ${report.palette.map(c => `
      <div class="swatch">
        <div class="swatch-color" style="background: ${escHtml(c.hex)}"></div>
        <div class="swatch-label">${escHtml(c.hex)}</div>
        <div class="swatch-count">${c.usageCount}x</div>
      </div>
    `).join('')}
  </div>

  <h2>Typography</h2>
  <h3 style="font-size:0.9rem;color:var(--muted);margin:0.5rem 0">Font Families</h3>
  <div class="scale">
    ${report.typography.families.map(f => `<div class="scale-item">${escHtml(f)}</div>`).join('')}
  </div>
  <h3 style="font-size:0.9rem;color:var(--muted);margin:0.5rem 0">Font Sizes</h3>
  <div class="scale">
    ${report.typography.sizes.map(s => `<div class="scale-item" style="font-size:${escAttr(s)}">${escHtml(s)}</div>`).join('')}
  </div>
  <h3 style="font-size:0.9rem;color:var(--muted);margin:0.5rem 0">Font Weights</h3>
  <div class="scale">
    ${report.typography.weights.map(w => `<div class="scale-item" style="font-weight:${escAttr(w)}">${escHtml(w)}</div>`).join('')}
  </div>

  <h2>Spacing Scale</h2>
  <div class="scale">
    ${report.spacing.map(s => `
      <div class="scale-item">
        <div style="background:var(--accent);height:8px;width:${escAttr(s)};max-width:200px;border-radius:2px;margin-bottom:4px"></div>
        ${escHtml(s)}
      </div>
    `).join('')}
  </div>

  <h2>Border Radii</h2>
  <div class="scale">
    ${report.radii.map(r => `
      <div class="scale-item">
        <div style="width:40px;height:40px;border:2px solid var(--accent);border-radius:${escAttr(r)};margin-bottom:4px"></div>
        ${escHtml(r)}
      </div>
    `).join('')}
  </div>

  ${report.shadows.length > 0 ? `
  <h2>Shadows</h2>
  <div class="scale">
    ${report.shadows.map(s => `
      <div class="scale-item">
        <div style="width:60px;height:40px;background:var(--surface);box-shadow:${escAttr(s)};border-radius:4px;margin-bottom:4px"></div>
        <small>${escHtml(s)}</small>
      </div>
    `).join('')}
  </div>` : ''}
</body>
</html>`
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
