// ============================================================================
// Vue Harvest — CSS Component Auto-Discovery
// Parses project CSS to discover component-level class selectors,
// infer their categories, group variants, and generate HTML examples.
// Works for any CSS architecture (BEM, prefix-based, flat, etc.)
// ============================================================================

import { readFileSync, existsSync } from 'fs'
import glob from 'fast-glob'
import { resolve } from 'pathe'
import type {
  HarvestConfig,
  CSSComponentCategory,
  CSSNamingConvention,
  CSSComponentClass,
  CSSComponentVariant,
  CSSComponentGroup,
  GeneratedExample,
  CSSSystemType,
  CSSComponentReport,
} from '../types.js'
import { parseRuleBlocks, extractClassNames, type CSSRuleBlock } from '../utils/css-parser.js'

// ============================================================================
// Main Entry Point
// ============================================================================

export async function analyzeCSSComponents(
  config: HarvestConfig,
  analyzedComponents?: Map<string, { styles: Array<{ source: string; scoped: boolean }> }>
): Promise<CSSComponentReport> {
  // 1. Collect all non-scoped CSS
  const allBlocks: CSSRuleBlock[] = []

  // Standalone CSS files
  const styleFiles = await glob(
    ['**/*.css', '**/*.scss', '**/*.less'],
    { cwd: config.root, ignore: config.exclude, absolute: false }
  )

  for (const file of styleFiles) {
    const absolutePath = resolve(config.root, file)
    if (!existsSync(absolutePath)) continue
    const content = readFileSync(absolutePath, 'utf-8')
    const blocks = parseRuleBlocks(content, file)
    allBlocks.push(...blocks)
  }

  // Package CSS from config (e.g., @commonpub/ui/theme/*.css)
  const packageCSS = await collectPackageCSS(config.root)
  for (const { file, content } of packageCSS) {
    const blocks = parseRuleBlocks(content, file)
    allBlocks.push(...blocks)
  }

  // Vue SFC unscoped styles
  if (analyzedComponents) {
    for (const [, comp] of analyzedComponents) {
      for (const style of comp.styles) {
        if (!style.scoped) {
          const blocks = parseRuleBlocks(style.source, '(SFC unscoped)')
          allBlocks.push(...blocks)
        }
      }
    }
  }

  // 2. Filter to class selectors only (skip element, ID, attribute selectors)
  const classBlocks = allBlocks.filter(b => {
    const sel = b.selector.trim()
    // Must start with a class selector
    return /^\.[\w-]/.test(sel)
  })

  // 3. Build selector → properties map (merge duplicate selectors)
  const selectorMap = new Map<string, { properties: Record<string, string>; file: string }>()
  for (const block of classBlocks) {
    // Split compound selectors
    const selectors = block.selector.split(',').map(s => s.trim())
    for (const sel of selectors) {
      const baseClass = sel.split(/[\s:>+~[]/)[0].trim() // Get base class before pseudo/combinators
      if (!baseClass.startsWith('.')) continue
      const existing = selectorMap.get(baseClass)
      if (existing) {
        Object.assign(existing.properties, block.properties)
      } else {
        selectorMap.set(baseClass, { properties: { ...block.properties }, file: block.file })
      }
    }
  }

  // 4. Detect naming convention and prefix
  const allSelectors = [...selectorMap.keys()]
  const { convention, prefix } = detectNamingConvention(allSelectors)

  // 5. Group related selectors into components
  const componentGroups = groupRelatedSelectors(selectorMap, convention, prefix)

  // 6. Infer category for each component group
  const cssComponents: CSSComponentClass[] = []

  for (const [baseName, group] of componentGroups) {
    const baseEntry = selectorMap.get(group.base)
    if (!baseEntry) continue

    // Skip very small classes (likely utilities)
    if (Object.keys(baseEntry.properties).length < 2) continue

    const { category, confidence } = inferCategory(group.base, baseEntry.properties)

    // Classify variants
    const variants: CSSComponentVariant[] = []
    for (const variantSel of group.variants) {
      const varEntry = selectorMap.get(variantSel)
      if (!varEntry) continue
      const kind = classifyVariant(baseEntry.properties, variantSel, varEntry.properties)
      variants.push({
        selector: variantSel,
        kind,
        properties: varEntry.properties,
      })
    }

    const usesTokens = Object.values(baseEntry.properties).some(v => v.includes('var('))

    cssComponents.push({
      selector: group.base,
      category,
      confidence,
      variants,
      properties: baseEntry.properties,
      source: baseEntry.file,
      usesTokens,
    })
  }

  // 7. Group by category and generate examples
  const groups = buildComponentGroups(cssComponents)

  // 8. Detect system type
  const systemType = detectCSSSystemType(config.root, selectorMap.size, convention)

  // 9. Compute stats
  const stats = {
    buttonCount: cssComponents.filter(c => c.category === 'button').length,
    formCount: cssComponents.filter(c => ['input', 'select', 'textarea', 'checkbox'].includes(c.category)).length,
    layoutCount: cssComponents.filter(c => ['layout', 'navigation'].includes(c.category)).length,
    contentCount: cssComponents.filter(c => ['prose', 'card', 'badge', 'tag'].includes(c.category)).length,
    otherCount: cssComponents.filter(c => ['unknown', 'utility', 'modal', 'alert', 'table', 'list', 'media'].includes(c.category)).length,
  }

  return {
    systemType,
    namingConvention: convention,
    classPrefix: prefix,
    groups,
    totalClasses: cssComponents.length,
    stats,
  }
}

// ============================================================================
// Naming Convention Detection
// ============================================================================

function detectNamingConvention(
  selectors: string[]
): { convention: CSSNamingConvention; prefix: string | null } {
  const classNames = selectors.map(s => s.replace(/^\./, ''))

  // Check for BEM: __element, --modifier patterns
  const bemCount = classNames.filter(n => n.includes('__') || /--[a-z]/.test(n)).length
  if (bemCount > classNames.length * 0.2) {
    return { convention: 'bem', prefix: null }
  }

  // Check for common prefix (e.g., cpub-, v-, q-, p-, el-)
  const prefixCounts = new Map<string, number>()
  for (const name of classNames) {
    const match = name.match(/^([a-z]+-)/i)
    if (match && match[1].length >= 2 && match[1].length <= 8) {
      const p = match[1]
      prefixCounts.set(p, (prefixCounts.get(p) || 0) + 1)
    }
  }

  let bestPrefix: string | null = null
  let bestCount = 0
  for (const [p, count] of prefixCounts) {
    if (count > bestCount && count >= 5) {
      bestPrefix = p
      bestCount = count
    }
  }

  if (bestPrefix && bestCount > classNames.length * 0.15) {
    return { convention: 'prefix', prefix: bestPrefix }
  }

  // Check for SMACSS: is-*, l-*, m-*
  const smacssCount = classNames.filter(n => /^(is|l|m|s|t)-/.test(n)).length
  if (smacssCount > classNames.length * 0.2) {
    return { convention: 'smacss', prefix: null }
  }

  return { convention: 'flat', prefix: null }
}

// ============================================================================
// Selector Grouping
// ============================================================================

function groupRelatedSelectors(
  selectorMap: Map<string, { properties: Record<string, string>; file: string }>,
  convention: CSSNamingConvention,
  prefix: string | null
): Map<string, { base: string; variants: string[] }> {
  const groups = new Map<string, { base: string; variants: string[] }>()

  const selectors = [...selectorMap.keys()].sort()

  for (const sel of selectors) {
    const className = sel.replace(/^\./, '')
    let baseName: string

    if (convention === 'bem') {
      // BEM: extract block name (before __ or --)
      baseName = className.split(/__|--/)[0]
    } else if (convention === 'prefix' && prefix) {
      // Prefix: group by prefix + first segment
      if (!className.startsWith(prefix)) {
        baseName = className
      } else {
        const rest = className.slice(prefix.length)
        // e.g., "cpub-btn-primary" → base is "cpub-btn"
        const parts = rest.split('-')
        baseName = prefix + parts[0]
      }
    } else {
      // Flat: group by common base before last hyphen segment
      const parts = className.split('-')
      baseName = parts.length > 1 ? parts[0] : className
    }

    const baseSelector = '.' + baseName
    const existing = groups.get(baseName)

    if (existing) {
      if (sel !== existing.base) {
        existing.variants.push(sel)
      }
    } else {
      // If this selector IS the base, create the group
      if (sel === baseSelector || !selectorMap.has(baseSelector)) {
        groups.set(baseName, { base: sel, variants: [] })
      } else {
        // Base exists, this is a variant
        const baseGroup = groups.get(baseName)
        if (baseGroup) {
          baseGroup.variants.push(sel)
        } else {
          groups.set(baseName, { base: baseSelector, variants: [sel] })
        }
      }
    }
  }

  return groups
}

// ============================================================================
// Category Inference
// ============================================================================

function inferCategory(
  selector: string,
  properties: Record<string, string>
): { category: CSSComponentCategory; confidence: number } {
  const scores: Partial<Record<CSSComponentCategory, number>> = {}
  const add = (cat: CSSComponentCategory, weight: number) => {
    scores[cat] = (scores[cat] || 0) + weight
  }

  const name = selector.replace(/^\./, '').toLowerCase()
  const props = properties

  // --- Name-based signals (strongest) ---
  if (/btn|button/.test(name)) add('button', 5)
  if (/input|field/.test(name) && !/chip/.test(name)) add('input', 5)
  if (/select|dropdown/.test(name)) add('select', 5)
  if (/textarea/.test(name)) add('textarea', 5)
  if (/checkbox|check/.test(name)) add('checkbox', 5)
  if (/radio/.test(name)) add('checkbox', 4)
  if (/card/.test(name)) add('card', 5)
  if (/badge/.test(name)) add('badge', 5)
  if (/tag|chip|pill/.test(name) && !/input/.test(name)) add('tag', 5)
  if (/nav|menu|tab|breadcrumb/.test(name)) add('navigation', 5)
  if (/grid|layout|container|page|section|hero|stat/.test(name)) add('layout', 4)
  if (/prose|article|content|text|markdown/.test(name)) add('prose', 5)
  if (/modal|dialog|overlay/.test(name)) add('modal', 5)
  if (/alert|toast|notification|callout/.test(name)) add('alert', 5)
  if (/table/.test(name)) add('table', 5)
  if (/list|feed/.test(name)) add('list', 4)
  if (/loading|spinner|skeleton|empty/.test(name)) add('alert', 3)
  if (/link|back/.test(name)) add('navigation', 3)
  if (/pagination|page-btn/.test(name)) add('navigation', 4)
  if (/divider|separator/.test(name)) add('layout', 3)
  if (/toolbar|filter/.test(name)) add('navigation', 3)
  if (/form/.test(name)) add('input', 3)
  if (/error|fetch-error/.test(name)) add('alert', 4)
  if (/sidebar|sb-/.test(name)) add('card', 3)

  // --- Property-based signals ---
  if (props['cursor'] === 'pointer') add('button', 3)
  if (props['display'] === 'inline-flex' || props['display'] === 'inline-block') {
    add('button', 2)
    add('badge', 2)
    add('tag', 2)
  }
  if (props['width'] === '100%' && props['padding'] && props['border']) {
    add('input', 3)
  }
  if (props['appearance'] === 'none') add('select', 2)
  if (props['resize']) add('textarea', 3)
  if ((props['box-shadow'] || props['border']) && props['padding'] && props['overflow']) {
    add('card', 3)
  }
  if (props['display'] === 'grid' || (props['display'] === 'flex' && props['gap'])) {
    add('layout', 3)
  }
  if (props['position'] === 'sticky' || props['position'] === 'fixed') {
    add('navigation', 3)
  }
  if (props['z-index']) add('navigation', 1)
  if (props['font-family'] && props['line-height'] && props['max-width']) {
    add('prose', 3)
  }
  if (props['text-transform'] === 'uppercase' && props['letter-spacing'] && props['font-size']) {
    add('badge', 2)
    add('tag', 2)
  }

  // Find highest scoring category
  let best: CSSComponentCategory = 'unknown'
  let bestScore = 0
  for (const [cat, score] of Object.entries(scores) as Array<[CSSComponentCategory, number]>) {
    if (score > bestScore) {
      best = cat
      bestScore = score
    }
  }

  const confidence = Math.min(bestScore / 10, 1)
  return { category: best, confidence }
}

// ============================================================================
// Variant Classification
// ============================================================================

function classifyVariant(
  _baseProps: Record<string, string>,
  selector: string,
  variantProps: Record<string, string>
): 'size' | 'color' | 'state' | 'layout' | 'generic' {
  const name = selector.toLowerCase()
  const props = Object.keys(variantProps)

  // Name-based
  if (/sm|lg|xl|xs|small|large|medium|compact|mini/.test(name)) return 'size'
  if (/primary|secondary|accent|success|warning|danger|error|info|green|red|yellow|purple|teal|pink|blue/.test(name)) return 'color'
  if (/active|hover|focus|disabled|selected|open|closed|collapsed/.test(name)) return 'state'
  if (/ghost|outline|solid|flat|text|link/.test(name)) return 'color' // style variants

  // Property-based
  const sizeProps = props.filter(p => ['padding', 'font-size', 'height', 'min-height', 'width'].includes(p))
  const colorProps = props.filter(p => ['color', 'background', 'background-color', 'border-color'].includes(p))

  if (sizeProps.length > colorProps.length) return 'size'
  if (colorProps.length > 0) return 'color'

  return 'generic'
}

// ============================================================================
// Component Grouping & Example Generation
// ============================================================================

const CATEGORY_META: Record<CSSComponentCategory, { label: string; icon: string }> = {
  button: { label: 'Buttons', icon: 'fa-solid fa-hand-pointer' },
  input: { label: 'Text Inputs', icon: 'fa-solid fa-keyboard' },
  select: { label: 'Selects', icon: 'fa-solid fa-list' },
  textarea: { label: 'Textareas', icon: 'fa-solid fa-align-left' },
  checkbox: { label: 'Checkboxes & Radios', icon: 'fa-solid fa-square-check' },
  card: { label: 'Cards', icon: 'fa-solid fa-rectangle-list' },
  badge: { label: 'Badges', icon: 'fa-solid fa-certificate' },
  tag: { label: 'Tags', icon: 'fa-solid fa-tags' },
  navigation: { label: 'Navigation', icon: 'fa-solid fa-bars' },
  layout: { label: 'Layout', icon: 'fa-solid fa-table-columns' },
  prose: { label: 'Prose / Content', icon: 'fa-solid fa-book-open' },
  modal: { label: 'Modals', icon: 'fa-solid fa-window-restore' },
  alert: { label: 'Alerts & States', icon: 'fa-solid fa-bell' },
  table: { label: 'Tables', icon: 'fa-solid fa-table' },
  list: { label: 'Lists', icon: 'fa-solid fa-list-ul' },
  media: { label: 'Media', icon: 'fa-solid fa-image' },
  utility: { label: 'Utilities', icon: 'fa-solid fa-wrench' },
  unknown: { label: 'Other', icon: 'fa-solid fa-puzzle-piece' },
}

function buildComponentGroups(components: CSSComponentClass[]): CSSComponentGroup[] {
  const byCategory = new Map<CSSComponentCategory, CSSComponentClass[]>()
  for (const comp of components) {
    const list = byCategory.get(comp.category) || []
    list.push(comp)
    byCategory.set(comp.category, list)
  }

  const groups: CSSComponentGroup[] = []
  // Order categories sensibly
  const order: CSSComponentCategory[] = [
    'button', 'badge', 'tag', 'input', 'select', 'textarea', 'checkbox',
    'card', 'navigation', 'layout', 'prose', 'alert', 'modal', 'table', 'list', 'media', 'unknown',
  ]

  for (const cat of order) {
    const comps = byCategory.get(cat)
    if (!comps || comps.length === 0) continue

    const meta = CATEGORY_META[cat]
    const examples = generateExamplesForCategory(cat, comps)

    groups.push({
      label: meta.label,
      category: cat,
      icon: meta.icon,
      components: comps,
      examples,
    })
  }

  return groups
}

function generateExamplesForCategory(
  category: CSSComponentCategory,
  components: CSSComponentClass[]
): GeneratedExample[] {
  const examples: GeneratedExample[] = []

  for (const comp of components) {
    const cls = comp.selector.replace(/^\./, '')
    const colorVariants = comp.variants.filter(v => v.kind === 'color')
    const sizeVariants = comp.variants.filter(v => v.kind === 'size')
    const stateVariants = comp.variants.filter(v => v.kind === 'state')

    switch (category) {
      case 'button': {
        // Base + color variants
        const btns = [`<button class="${esc(cls)}">Default</button>`]
        for (const v of colorVariants.slice(0, 6)) {
          const vCls = v.selector.replace(/^\./, '')
          const label = vCls.replace(cls, '').replace(/^[-_]/, '') || vCls
          btns.push(`<button class="${esc(cls)} ${esc(vCls)}">${esc(capitalize(label))}</button>`)
        }
        examples.push({ label: comp.selector, html: `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">${btns.join('\n')}</div>`, classes: [cls] })

        // Size variants
        if (sizeVariants.length > 0) {
          const sizeBtns = sizeVariants.map(v => {
            const vCls = v.selector.replace(/^\./, '')
            const label = vCls.replace(cls, '').replace(/^[-_]/, '') || vCls
            return `<button class="${esc(cls)} ${esc(vCls)}">${esc(capitalize(label))}</button>`
          })
          examples.push({ label: 'Sizes', html: `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">${sizeBtns.join('\n')}</div>`, classes: sizeVariants.map(v => v.selector.replace(/^\./, '')) })
        }
        break
      }

      case 'input': {
        examples.push({
          label: comp.selector,
          html: `<div style="max-width:360px"><input class="${esc(cls)}" type="text" placeholder="Enter text..."></div>`,
          classes: [cls],
        })
        if (sizeVariants.length > 0) {
          const inputs = sizeVariants.map(v => {
            const vCls = v.selector.replace(/^\./, '')
            return `<input class="${esc(cls)} ${esc(vCls)}" type="text" placeholder="${esc(vCls)}">`
          })
          examples.push({ label: 'Sizes', html: `<div style="max-width:360px;display:flex;flex-direction:column;gap:8px">${inputs.join('\n')}</div>`, classes: sizeVariants.map(v => v.selector.replace(/^\./, '')) })
        }
        break
      }

      case 'select': {
        examples.push({
          label: comp.selector,
          html: `<div style="max-width:360px"><select class="${esc(cls)}"><option>Option 1</option><option>Option 2</option><option>Option 3</option></select></div>`,
          classes: [cls],
        })
        break
      }

      case 'textarea': {
        examples.push({
          label: comp.selector,
          html: `<div style="max-width:360px"><textarea class="${esc(cls)}" rows="3" placeholder="Write something..."></textarea></div>`,
          classes: [cls],
        })
        break
      }

      case 'checkbox': {
        examples.push({
          label: comp.selector,
          html: `<div style="display:flex;flex-direction:column;gap:8px"><label class="${esc(cls)}"><input type="checkbox" checked> Option A</label><label class="${esc(cls)}"><input type="checkbox"> Option B</label></div>`,
          classes: [cls],
        })
        break
      }

      case 'badge':
      case 'tag': {
        const items = [`<span class="${esc(cls)}">Default</span>`]
        for (const v of colorVariants.slice(0, 8)) {
          const vCls = v.selector.replace(/^\./, '')
          const label = vCls.replace(cls, '').replace(/^[-_]/, '') || vCls
          items.push(`<span class="${esc(cls)} ${esc(vCls)}">${esc(capitalize(label))}</span>`)
        }
        examples.push({ label: comp.selector, html: `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">${items.join('\n')}</div>`, classes: [cls] })
        break
      }

      case 'card': {
        examples.push({
          label: comp.selector,
          html: `<div style="max-width:320px"><div class="${esc(cls)}"><div class="${esc(cls)}-body" style="padding:16px"><div style="font-weight:600;margin-bottom:6px">Card Title</div><div style="font-size:13px;opacity:0.7">Card content goes here. This is a preview of the component.</div></div></div></div>`,
          classes: [cls],
        })
        break
      }

      case 'navigation': {
        if (/tab/.test(cls)) {
          examples.push({
            label: comp.selector,
            html: `<div class="${esc(cls)}" style="position:static"><button class="${esc(cls.replace(/bar|nav/, ''))}" style="font-family:inherit">Tab 1</button><button class="${esc(cls.replace(/bar|nav/, ''))}">Tab 2</button><button class="${esc(cls.replace(/bar|nav/, ''))}">Tab 3</button></div>`,
            classes: [cls],
          })
        } else if (/pagination/.test(cls)) {
          examples.push({
            label: comp.selector,
            html: `<div class="${esc(cls)}"><button class="${esc(cls.replace('pagination', 'page-btn'))}">1</button><button class="${esc(cls.replace('pagination', 'page-btn'))}">2</button><button class="${esc(cls.replace('pagination', 'page-btn'))}">3</button></div>`,
            classes: [cls],
          })
        } else {
          examples.push({
            label: comp.selector,
            html: `<nav class="${esc(cls)}"><a href="#" onclick="return false">Item 1</a><a href="#" onclick="return false">Item 2</a><a href="#" onclick="return false">Item 3</a></nav>`,
            classes: [cls],
          })
        }
        break
      }

      case 'layout': {
        examples.push({
          label: comp.selector,
          html: `<div class="${esc(cls)}" style="min-height:60px"><div style="background:rgba(0,0,0,0.05);padding:12px;text-align:center;font-size:12px">Column 1</div><div style="background:rgba(0,0,0,0.05);padding:12px;text-align:center;font-size:12px">Column 2</div></div>`,
          classes: [cls],
        })
        break
      }

      case 'prose': {
        examples.push({
          label: comp.selector,
          html: `<div class="${esc(cls)}"><h2>Heading</h2><p>This is a paragraph of text demonstrating the prose styling. It includes <a href="#">a link</a> and <code>inline code</code>.</p><ul><li>List item one</li><li>List item two</li></ul></div>`,
          classes: [cls],
        })
        break
      }

      case 'alert': {
        examples.push({
          label: comp.selector,
          html: `<div class="${esc(cls)}" style="padding:16px">${comp.selector.includes('error') || comp.selector.includes('danger') ? 'Error state content' : comp.selector.includes('loading') ? 'Loading...' : comp.selector.includes('empty') ? 'No items found' : 'Alert content'}</div>`,
          classes: [cls],
        })
        break
      }

      default: {
        examples.push({
          label: comp.selector,
          html: `<div class="${esc(cls)}" style="padding:12px">Content</div>`,
          classes: [cls],
        })
      }
    }
  }

  return examples
}

// ============================================================================
// CSS System Detection
// ============================================================================

function detectCSSSystemType(
  root: string,
  selectorCount: number,
  convention: CSSNamingConvention,
): CSSSystemType {
  // Check for Tailwind
  const tailwindConfigs = ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs', 'tailwind.config.mjs']
  for (const cfg of tailwindConfigs) {
    if (existsSync(resolve(root, cfg))) return 'tailwind'
  }

  // If many selectors with a prefix convention → custom property system
  if (convention === 'prefix' && selectorCount > 10) return 'custom-properties'

  // If very few selectors → likely scoped-only
  if (selectorCount < 5) return 'scoped-only'

  return 'mixed'
}

// ============================================================================
// Package CSS Collection
// ============================================================================

async function collectPackageCSS(
  root: string
): Promise<Array<{ file: string; content: string }>> {
  const results: Array<{ file: string; content: string }> = []

  // Check nuxt.config.ts/js for css: [...] entries
  for (const configName of ['nuxt.config.ts', 'nuxt.config.js']) {
    const configPath = resolve(root, configName)
    if (!existsSync(configPath)) continue

    try {
      const configContent = readFileSync(configPath, 'utf-8')
      const cssRefPattern = /['"](@[\w-]+\/[\w-]+\/[\w/.]+\.css)['"]/g
      let m
      while ((m = cssRefPattern.exec(configContent)) !== null) {
        const pkgPath = m[1]
        const fullPath = resolve(root, 'node_modules', pkgPath)
        if (existsSync(fullPath)) {
          try {
            const content = readFileSync(fullPath, 'utf-8')
            results.push({ file: pkgPath, content })
          } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }
    break
  }

  return results
}

// ============================================================================
// Utilities
// ============================================================================

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
