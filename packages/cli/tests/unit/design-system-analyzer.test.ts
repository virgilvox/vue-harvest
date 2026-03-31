import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'pathe'
import {
  analyzeDesignSystem,
  generateTokenCSS,
  generateDesignSystemHTML,
} from '../../src/analyzers/design-system-analyzer.js'
import { analyzeSFC } from '../../src/analyzers/sfc-analyzer.js'
import { resolveConfig } from '../../src/utils/config.js'
import type { DesignSystemReport } from '../../src/types.js'

const FIXTURES = resolve(__dirname, '../fixtures/src')
const PROJECT_ROOT = resolve(__dirname, '../fixtures')
const aliases = { '@': FIXTURES }

describe('Design System Analyzer', () => {
  let report: DesignSystemReport

  beforeAll(async () => {
    // Analyze fixture components first
    const files = [
      'src/components/ui/BaseButton.vue',
      'src/components/ui/BaseCard.vue',
      'src/components/ui/BaseInput.vue',
      'src/components/features/UserProfileCard.vue',
      'src/views/Dashboard.vue',
    ]

    const componentData = new Map<
      string,
      { name: string; filePath: string; styles: Array<{ source: string }> }
    >()

    for (const file of files) {
      const absolutePath = resolve(PROJECT_ROOT, file)
      const analyzed = await analyzeSFC(
        file,
        absolutePath,
        PROJECT_ROOT,
        aliases
      )
      componentData.set(analyzed.name, {
        name: analyzed.name,
        filePath: analyzed.filePath,
        styles: analyzed.styles,
      })
    }

    const config = resolveConfig(PROJECT_ROOT)
    report = await analyzeDesignSystem(config, componentData)
  })

  it('extracts color tokens', () => {
    expect(report.palette.length).toBeGreaterThan(0)
  })

  it('finds the primary blue color (#3b82f6)', () => {
    const blue = report.palette.find(
      (c) => c.hex === '#3b82f6'
    )
    expect(blue).toBeDefined()
    expect(blue!.usageCount).toBeGreaterThanOrEqual(1)
  })

  it('detects font sizes', () => {
    expect(report.typography.sizes.length).toBeGreaterThan(0)
  })

  it('detects spacing values', () => {
    expect(report.spacing.length).toBeGreaterThan(0)
  })

  it('detects border radii', () => {
    expect(report.radii.length).toBeGreaterThan(0)
  })

  it('groups tokens by type', () => {
    expect(report.byType).toBeDefined()
    expect(report.byType['color']).toBeDefined()
    expect(report.byType['color'].length).toBeGreaterThan(0)
  })

  it('provides stats', () => {
    expect(report.stats.totalTokens).toBeGreaterThan(0)
    expect(report.stats.uniqueColors).toBeGreaterThan(0)
    expect(report.stats.componentsAnalyzed).toBe(5)
  })

  describe('generateTokenCSS', () => {
    it('produces valid CSS with custom properties', () => {
      const css = generateTokenCSS(report)
      expect(css).toContain(':root {')
      expect(css).toContain('--color-')
      expect(css).toContain('}')
    })

    it('includes color tokens', () => {
      const css = generateTokenCSS(report)
      expect(css).toContain('#3b82f6')
    })
  })

  describe('generateDesignSystemHTML', () => {
    it('produces valid HTML', () => {
      const html = generateDesignSystemHTML(report)
      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('vue-harvest')
      expect(html).toContain('Color Palette')
    })

    it('includes color swatches', () => {
      const html = generateDesignSystemHTML(report)
      expect(html).toContain('swatch-color')
    })
  })
})
