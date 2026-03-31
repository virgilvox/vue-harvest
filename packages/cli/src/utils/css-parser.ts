// ============================================================================
// Vue Harvest — Shared CSS Parsing Utilities
// Used by both design-system-analyzer and css-component-analyzer
// ============================================================================

// --- CSS Variable Collection & Resolution ---

/** Collects all CSS custom property definitions from a stylesheet */
export function collectCSSVariables(cssContent: string): Map<string, string> {
  const vars = new Map<string, string>()
  const pattern = /(--[\w-]+)\s*:\s*([^;{}]+);/g
  let m
  while ((m = pattern.exec(cssContent)) !== null) {
    vars.set(m[1].trim(), m[2].trim())
  }
  return vars
}

/** Resolves a var() reference chain to its final concrete value */
export function resolveVariable(
  name: string,
  varMap: Map<string, string>,
  seen?: Set<string>
): string | null {
  const visited = seen || new Set<string>()
  if (visited.has(name)) return null // cycle
  visited.add(name)

  const value = varMap.get(name)
  if (!value) return null

  const varRef = value.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/)
  if (varRef) {
    const resolved = resolveVariable(varRef[1], varMap, visited)
    return resolved || varRef[2] || null
  }

  return value
}

/** Resolves var() references embedded anywhere in a value string */
export function resolveValueVars(
  value: string,
  varMap: Map<string, string>,
): string | null {
  if (!value.includes('var(')) return value

  const simpleRef = value.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/)
  if (simpleRef) {
    return resolveVariable(simpleRef[1], varMap) || simpleRef[2] || null
  }

  let resolved = value
  let changed = false
  const varPattern = /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g
  let match
  while ((match = varPattern.exec(value)) !== null) {
    const concrete = resolveVariable(match[1], varMap)
    if (concrete) {
      resolved = resolved.replace(match[0], concrete)
      changed = true
    }
  }
  return changed ? resolved : null
}

// --- Dark Mode Detection ---

/** Detect character ranges inside dark mode selectors */
export function detectDarkModeRanges(css: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  // data-theme="dark", data-mode="dark", .dark class, html.dark
  const patterns = [
    /\[data-theme=["']dark["']\]\s*\{/g,
    /\[data-mode=["']dark["']\]\s*\{/g,
    /(?:html|body|\:root)\.dark\s*\{/g,
    /\.dark\s*\{/g,
  ]
  for (const pattern of patterns) {
    let m
    while ((m = pattern.exec(css)) !== null) {
      let depth = 1
      let i = m.index + m[0].length
      while (i < css.length && depth > 0) {
        if (css[i] === '{') depth++
        else if (css[i] === '}') depth--
        i++
      }
      ranges.push([m.index, i])
    }
  }
  // prefers-color-scheme
  const prefersPattern = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/g
  let m
  while ((m = prefersPattern.exec(css)) !== null) {
    let depth = 1
    let i = m.index + m[0].length
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
      i++
    }
    ranges.push([m.index, i])
  }
  return ranges
}

// --- Google Fonts Parsing ---

/** Extracts font family names from Google Fonts @import URLs */
export function extractGoogleFonts(cssContent: string): string[] {
  const fonts: string[] = []
  const importPattern = /@import\s+url\(\s*['"]?(https:\/\/fonts\.googleapis\.com\/css2?\?[^'")\s]+)['"]?\s*\)/g
  let m
  while ((m = importPattern.exec(cssContent)) !== null) {
    const url = m[1]
    const familyPattern = /family=([^&]+)/g
    let fm
    while ((fm = familyPattern.exec(url)) !== null) {
      const familyStr = decodeURIComponent(fm[1].replace(/\+/g, ' '))
      const name = familyStr.split(':')[0].trim()
      if (name) fonts.push(name)
    }
  }

  const linkPattern = /href=['"]?(https:\/\/fonts\.googleapis\.com\/css2?\?[^'">\s]+)/g
  while ((m = linkPattern.exec(cssContent)) !== null) {
    const url = m[1]
    const familyPattern = /family=([^&]+)/g
    let fm
    while ((fm = familyPattern.exec(url)) !== null) {
      const familyStr = decodeURIComponent(fm[1].replace(/\+/g, ' '))
      const name = familyStr.split(':')[0].trim()
      if (name && !fonts.includes(name)) fonts.push(name)
    }
  }

  return fonts
}

// --- CSS Rule Block Parsing ---

export interface CSSRuleBlock {
  /** The full selector string (e.g., ".cpub-btn:hover") */
  selector: string
  /** Parsed CSS properties */
  properties: Record<string, string>
  /** Source file */
  file: string
  /** Character offset in source */
  startIndex: number
  endIndex: number
}

/**
 * Parses CSS into rule blocks, properly handling nested braces.
 * Strips @layer wrappers and skips @keyframes/@media (returns inner rules for @media).
 */
export function parseRuleBlocks(css: string, file: string): CSSRuleBlock[] {
  const blocks: CSSRuleBlock[] = []
  // Strip @layer wrappers
  let clean = css.replace(/@layer\s+[\w-]+\s*\{/, '')
  // Remove trailing @layer closing brace (simplified)
  if (clean !== css) {
    const lastBrace = clean.lastIndexOf('}')
    if (lastBrace !== -1) clean = clean.substring(0, lastBrace) + clean.substring(lastBrace + 1)
  }
  // Strip @import
  clean = clean.replace(/@import\s+[^;]+;/g, '')

  let i = 0
  while (i < clean.length) {
    // Skip whitespace
    while (i < clean.length && /\s/.test(clean[i])) i++
    if (i >= clean.length) break

    // Skip comments
    if (clean[i] === '/' && clean[i + 1] === '*') {
      const end = clean.indexOf('*/', i + 2)
      i = end === -1 ? clean.length : end + 2
      continue
    }

    // Skip @keyframes blocks entirely
    if (clean[i] === '@' && /^@keyframes\s/.test(clean.substring(i, i + 20))) {
      const braceStart = clean.indexOf('{', i)
      if (braceStart === -1) break
      let depth = 1
      let j = braceStart + 1
      while (j < clean.length && depth > 0) {
        if (clean[j] === '{') depth++
        else if (clean[j] === '}') depth--
        j++
      }
      i = j
      continue
    }

    // Handle @media — parse inner rules
    if (clean[i] === '@' && /^@media\s/.test(clean.substring(i, i + 20))) {
      const braceStart = clean.indexOf('{', i)
      if (braceStart === -1) break
      let depth = 1
      let j = braceStart + 1
      const innerStart = j
      while (j < clean.length && depth > 0) {
        if (clean[j] === '{') depth++
        else if (clean[j] === '}') depth--
        j++
      }
      // Recursively parse inner content
      const innerCSS = clean.substring(innerStart, j - 1)
      const innerBlocks = parseRuleBlocks(innerCSS, file)
      blocks.push(...innerBlocks)
      i = j
      continue
    }

    // Skip other @ rules we don't handle
    if (clean[i] === '@') {
      const braceStart = clean.indexOf('{', i)
      const semicolon = clean.indexOf(';', i)
      if (semicolon !== -1 && (braceStart === -1 || semicolon < braceStart)) {
        i = semicolon + 1
      } else if (braceStart !== -1) {
        let depth = 1
        let j = braceStart + 1
        while (j < clean.length && depth > 0) {
          if (clean[j] === '{') depth++
          else if (clean[j] === '}') depth--
          j++
        }
        i = j
      } else {
        break
      }
      continue
    }

    // Find a selector + { properties } block
    const braceStart = clean.indexOf('{', i)
    if (braceStart === -1) break

    const selector = clean.substring(i, braceStart).trim()
    if (!selector || selector.startsWith('}')) {
      i = braceStart + 1
      continue
    }

    // Find matching closing brace
    let depth = 1
    let j = braceStart + 1
    while (j < clean.length && depth > 0) {
      if (clean[j] === '{') depth++
      else if (clean[j] === '}') depth--
      j++
    }

    const body = clean.substring(braceStart + 1, j - 1)

    // Parse properties from body
    const properties: Record<string, string> = {}
    const declPattern = /([\w-]+)\s*:\s*([^;{}]+)/g
    let dm
    while ((dm = declPattern.exec(body)) !== null) {
      const prop = dm[1].trim()
      const val = dm[2].trim()
      if (!prop.startsWith('--')) { // Skip CSS variable definitions
        properties[prop] = val
      }
    }

    if (selector && Object.keys(properties).length > 0) {
      blocks.push({
        selector,
        properties,
        file,
        startIndex: i,
        endIndex: j,
      })
    }

    i = j
  }

  return blocks
}

/** Extracts class names from a CSS selector string */
export function extractClassNames(selector: string): string[] {
  const matches = selector.match(/\.([\w-]+)/g)
  return matches ? matches.map(m => m.substring(1)) : []
}

/** Strips @layer wrappers from CSS */
export function stripLayerWrappers(css: string): string {
  let result = ''
  let i = 0
  while (i < css.length) {
    const layerMatch = css.slice(i).match(/^@layer\s+[\w-]+\s*\{/)
    if (layerMatch) {
      i += layerMatch[0].length
      let depth = 1
      const start = i
      while (i < css.length && depth > 0) {
        if (css[i] === '{') depth++
        else if (css[i] === '}') depth--
        if (depth > 0) i++
        else {
          result += css.slice(start, i)
          i++
        }
      }
    } else {
      result += css[i]
      i++
    }
  }
  return result
}
