import { readFileSync, existsSync } from 'fs'
import glob from 'fast-glob'
import { resolve } from 'pathe'
import type {
  DesignToken,
  DesignTokenType,
  TokenSource,
  DesignSystemReport,
  HarvestConfig,
} from '../types.js'

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
}

function extractTokensFromCSS(
  cssContent: string,
  filePath: string,
  componentName?: string
): RawToken[] {
  const tokens: RawToken[] = []

  // Parse CSS declarations
  const declarationPattern = /([\w-]+)\s*:\s*([^;{}]+);/g
  let match

  while ((match = declarationPattern.exec(cssContent)) !== null) {
    const property = match[1].trim()
    const rawValue = match[2].trim()
    const line = cssContent.slice(0, match.index).split('\n').length

    // Skip CSS variable references (already tokenized)
    if (rawValue.startsWith('var(')) continue

    // Check if this is a CSS variable definition
    if (property.startsWith('--')) {
      const tokenType = inferTokenType(property, rawValue)
      if (tokenType) {
        tokens.push({
          value: rawValue,
          type: tokenType,
          source: {
            file: filePath,
            line,
            context: 'css-variable',
          },
        })
      }
      continue
    }

    const tokenType = PROPERTY_TOKEN_MAP[property]
    if (!tokenType) continue

    // For shorthand properties, we might get multiple values
    if (tokenType === 'color') {
      const colors = extractColorsFromValue(rawValue)
      for (const color of colors) {
        tokens.push({
          value: color,
          type: 'color',
          source: { file: filePath, line, context: 'css-value' },
        })
      }
    } else if (tokenType === 'spacing' && isValidSpacing(rawValue)) {
      // Split shorthand spacing (e.g., "8px 16px")
      const parts = rawValue.split(/\s+/)
      for (const part of parts) {
        if (SPACING_PATTERN.test(part) && !isAutoOrNone(part)) {
          tokens.push({
            value: part,
            type: 'spacing',
            source: { file: filePath, line, context: 'css-value' },
          })
        }
      }
    } else {
      tokens.push({
        value: rawValue,
        type: tokenType,
        source: { file: filePath, line, context: 'css-value' },
      })
    }
  }

  return tokens
}

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

  if (/color|bg|background|fill|stroke/i.test(lowerProp)) return 'color'
  if (/font-size|text-size/i.test(lowerProp)) return 'font-size'
  if (/font-family/i.test(lowerProp)) return 'font-family'
  if (/font-weight/i.test(lowerProp)) return 'font-weight'
  if (/spacing|gap|padding|margin/i.test(lowerProp)) return 'spacing'
  if (/radius/i.test(lowerProp)) return 'border-radius'
  if (/shadow/i.test(lowerProp)) return 'shadow'
  if (/z-index/i.test(lowerProp)) return 'z-index'
  if (/opacity/i.test(lowerProp)) return 'opacity'
  if (/transition|duration|animation/i.test(lowerProp)) return 'transition'

  // Infer from value
  if (extractColorsFromValue(value).length > 0) return 'color'
  if (FONT_SIZE_PATTERN.test(value)) return 'font-size'

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

  // 1. Analyze Vue SFC styles
  if (analyzedComponents) {
    for (const [name, comp] of analyzedComponents) {
      for (const style of comp.styles) {
        const tokens = extractTokensFromCSS(style.source, comp.filePath, name)
        allTokens.push(...tokens)
      }
    }
  }

  // 2. Scan standalone CSS/SCSS files
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
    const tokens = extractTokensFromCSS(content, file)
    allTokens.push(...tokens)
  }

  // 3. Deduplicate and aggregate tokens
  return buildReport(allTokens, analyzedComponents?.size || 0)
}

function buildReport(
  rawTokens: RawToken[],
  componentsAnalyzed: number
): DesignSystemReport {
  // Aggregate by value + type
  const tokenMap = new Map<string, DesignToken>()

  for (const raw of rawTokens) {
    const key = `${raw.type}:${raw.value}`
    const existing = tokenMap.get(key)

    if (existing) {
      existing.usageCount++
      // Track source component if available
    } else {
      tokenMap.set(key, {
        name: generateTokenName(raw.type, raw.value, tokenMap),
        value: raw.value,
        type: raw.type,
        source: raw.source,
        usageCount: 1,
        usedBy: [],
      })
    }
  }

  const tokens = [...tokenMap.values()].sort(
    (a, b) => b.usageCount - a.usageCount
  )

  // Group by type
  const byType: Record<DesignTokenType, DesignToken[]> = {} as any
  for (const token of tokens) {
    if (!byType[token.type]) byType[token.type] = []
    byType[token.type].push(token)
  }

  // Build palette
  const colorTokens = byType['color'] || []
  const paletteMap = new Map<string, { hex: string; usageCount: number }>()

  for (const ct of colorTokens) {
    const hex = ct.value.startsWith('#')
      ? normalizeHex(ct.value)
      : ct.value
    const existing = paletteMap.get(hex)
    if (existing) {
      existing.usageCount += ct.usageCount
    } else {
      paletteMap.set(hex, { hex, usageCount: ct.usageCount })
    }
  }

  const palette = [...paletteMap.values()].sort(
    (a, b) => b.usageCount - a.usageCount
  )

  // Typography
  const fontFamilies = (byType['font-family'] || []).map((t) => t.value)
  const fontSizes = (byType['font-size'] || []).map((t) => t.value)
  const fontWeights = (byType['font-weight'] || []).map((t) => t.value)
  const lineHeights = (byType['line-height'] || []).map((t) => t.value)

  // Spacing
  const spacingTokens = (byType['spacing'] || []).map((t) => t.value)
  const uniqueSpacing = [...new Set(spacingTokens)].sort(sortNumericValues)

  // Radii
  const radii = [...new Set((byType['border-radius'] || []).map((t) => t.value))]

  // Shadows
  const shadows = [...new Set((byType['shadow'] || []).map((t) => t.value))]

  // Calculate tokenization rate
  const cssVarTokens = tokens.filter(
    (t) => t.source.context === 'css-variable'
  ).length
  const totalTokens = tokens.length
  const tokenizationRate =
    totalTokens > 0 ? cssVarTokens / totalTokens : 0

  return {
    tokens,
    byType,
    palette,
    typography: {
      families: [...new Set(fontFamilies)],
      sizes: [...new Set(fontSizes)].sort(sortNumericValues),
      weights: [...new Set(fontWeights)],
      lineHeights: [...new Set(lineHeights)],
    },
    spacing: uniqueSpacing,
    radii,
    shadows,
    stats: {
      totalTokens,
      uniqueColors: palette.length,
      uniqueFontSizes: new Set(fontSizes).size,
      uniqueSpacingValues: uniqueSpacing.length,
      componentsAnalyzed,
      tokenizationRate,
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
