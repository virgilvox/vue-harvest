import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'pathe'
import { analyzeSFC } from '../../src/analyzers/sfc-analyzer.js'

const FIXTURES = resolve(__dirname, '../fixtures/src')
const PROJECT_ROOT = resolve(__dirname, '../fixtures')

const aliases = {
  '@': FIXTURES,
}

describe('SFC Analyzer', () => {
  describe('BaseButton (pure primitive)', () => {
    let result: Awaited<ReturnType<typeof analyzeSFC>>

    beforeAll(async () => {
      const filePath = 'src/components/ui/BaseButton.vue'
      const absolutePath = resolve(PROJECT_ROOT, filePath)
      result = await analyzeSFC(filePath, absolutePath, PROJECT_ROOT, aliases)
    })

    it('derives the correct component name', () => {
      expect(result.name).toBe('BaseButton')
    })

    it('detects setup-ts script variant', () => {
      expect(result.scriptVariant).toBe('setup-ts')
    })

    it('extracts all props with correct types', () => {
      expect(result.props).toHaveLength(4)

      const variant = result.props.find((p) => p.name === 'variant')
      expect(variant).toBeDefined()
      expect(variant!.type).toContain('primary')
      expect(variant!.required).toBe(false)

      const disabled = result.props.find((p) => p.name === 'disabled')
      expect(disabled).toBeDefined()
      expect(disabled!.type).toBe('boolean')
      expect(disabled!.required).toBe(false)
    })

    it('extracts emits', () => {
      expect(result.emits).toHaveLength(1)
      expect(result.emits[0].name).toBe('click')
      expect(result.emits[0].payload).toBe('MouseEvent')
    })

    it('detects the default slot', () => {
      expect(result.slots.length).toBeGreaterThanOrEqual(1)
      expect(result.slots.some((s) => s.name === 'default')).toBe(true)
    })

    it('has scoped styles', () => {
      expect(result.styles).toHaveLength(1)
      expect(result.styles[0].scoped).toBe(true)
    })

    it('classifies as primitive with high confidence', () => {
      expect(result.tier).toBe('primitive')
      expect(result.extractionConfidence).toBeGreaterThanOrEqual(0.85)
    })

    it('has no coupling issues', () => {
      expect(result.couplingIssues).toHaveLength(0)
    })

    it('has no external package dependencies', () => {
      expect(result.peerPackages).toHaveLength(0)
    })

    it('calculates LOC correctly', () => {
      expect(result.loc.total).toBeGreaterThan(0)
      expect(result.loc.template).toBeGreaterThan(0)
      expect(result.loc.script).toBeGreaterThan(0)
      expect(result.loc.style).toBeGreaterThan(0)
    })

    it('generates a content hash', () => {
      expect(result.contentHash).toMatch(/^[a-f0-9]{12}$/)
    })
  })

  describe('BaseCard (primitive with slots)', () => {
    let result: Awaited<ReturnType<typeof analyzeSFC>>

    beforeAll(async () => {
      const filePath = 'src/components/ui/BaseCard.vue'
      const absolutePath = resolve(PROJECT_ROOT, filePath)
      result = await analyzeSFC(filePath, absolutePath, PROJECT_ROOT, aliases)
    })

    it('extracts named slots', () => {
      const slotNames = result.slots.map((s) => s.name)
      expect(slotNames).toContain('default')
      expect(slotNames).toContain('header')
      expect(slotNames).toContain('footer')
    })

    it('classifies as primitive', () => {
      expect(result.tier).toBe('primitive')
    })

    it('extracts props', () => {
      expect(result.props.some((p) => p.name === 'title')).toBe(true)
      expect(result.props.some((p) => p.name === 'elevated')).toBe(true)
    })
  })

  describe('BaseInput (primitive with v-model)', () => {
    let result: Awaited<ReturnType<typeof analyzeSFC>>

    beforeAll(async () => {
      const filePath = 'src/components/ui/BaseInput.vue'
      const absolutePath = resolve(PROJECT_ROOT, filePath)
      result = await analyzeSFC(filePath, absolutePath, PROJECT_ROOT, aliases)
    })

    it('extracts modelValue prop', () => {
      const mv = result.props.find((p) => p.name === 'modelValue')
      expect(mv).toBeDefined()
      expect(mv!.type).toBe('string')
      expect(mv!.required).toBe(true)
    })

    it('extracts update:modelValue emit', () => {
      expect(result.emits.some((e) => e.name === 'update:modelValue')).toBe(
        true
      )
    })

    it('classifies as primitive', () => {
      expect(result.tier).toBe('primitive')
    })
  })

  describe('UserProfileCard (coupled component)', () => {
    let result: Awaited<ReturnType<typeof analyzeSFC>>

    beforeAll(async () => {
      const filePath = 'src/components/features/UserProfileCard.vue'
      const absolutePath = resolve(PROJECT_ROOT, filePath)
      result = await analyzeSFC(filePath, absolutePath, PROJECT_ROOT, aliases)
    })

    it('detects store dependency', () => {
      const storeDep = result.dependencies.find(
        (d) => d.kind === 'internal-store'
      )
      expect(storeDep).toBeDefined()
      expect(storeDep!.specifier).toBe('@/stores/userStore')
    })

    it('detects router dependency', () => {
      const routerDep = result.dependencies.find(
        (d) => d.specifier === 'vue-router'
      )
      expect(routerDep).toBeDefined()
      expect(routerDep!.kind).toBe('vue-core')
    })

    it('detects component imports', () => {
      const compDeps = result.dependencies.filter(
        (d) => d.kind === 'internal-component'
      )
      expect(compDeps.length).toBeGreaterThanOrEqual(1)
    })

    it('reports direct-store-access coupling issue', () => {
      expect(
        result.couplingIssues.some((i) => i.type === 'direct-store-access')
      ).toBe(true)
    })

    it('reports router-dependency coupling issue', () => {
      expect(
        result.couplingIssues.some((i) => i.type === 'router-dependency')
      ).toBe(true)
    })

    it('classifies below primitive/composite tier', () => {
      expect(['feature', 'page-bound', 'app-specific']).toContain(result.tier)
    })

    it('has lower confidence than primitives', () => {
      expect(result.extractionConfidence).toBeLessThan(0.85)
    })
  })

  describe('SearchBar (i18n coupled)', () => {
    let result: Awaited<ReturnType<typeof analyzeSFC>>

    beforeAll(async () => {
      const filePath = 'src/components/features/SearchBar.vue'
      const absolutePath = resolve(PROJECT_ROOT, filePath)
      result = await analyzeSFC(filePath, absolutePath, PROJECT_ROOT, aliases)
    })

    it('detects i18n dependency', () => {
      expect(
        result.couplingIssues.some((i) => i.type === 'i18n-dependency')
      ).toBe(true)
    })

    it('extracts object-syntax props', () => {
      expect(result.props.some((p) => p.name === 'modelValue')).toBe(true)
      expect(result.props.some((p) => p.name === 'placeholder')).toBe(true)
    })

    it('extracts emits', () => {
      expect(result.emits.some((e) => e.name === 'update:modelValue')).toBe(
        true
      )
      expect(result.emits.some((e) => e.name === 'search')).toBe(true)
    })
  })

  describe('Dashboard (page-bound view)', () => {
    let result: Awaited<ReturnType<typeof analyzeSFC>>

    beforeAll(async () => {
      const filePath = 'src/views/Dashboard.vue'
      const absolutePath = resolve(PROJECT_ROOT, filePath)
      result = await analyzeSFC(filePath, absolutePath, PROJECT_ROOT, aliases)
    })

    it('detects hardcoded API call', () => {
      expect(
        result.couplingIssues.some((i) => i.type === 'hardcoded-api')
      ).toBe(true)
    })

    it('detects unscoped CSS', () => {
      expect(
        result.couplingIssues.some((i) => i.type === 'unscoped-css')
      ).toBe(true)
    })

    it('classifies as page-bound or app-specific due to path and coupling', () => {
      expect(['page-bound', 'app-specific']).toContain(result.tier)
    })

    it('has low extraction confidence', () => {
      expect(result.extractionConfidence).toBeLessThan(0.5)
    })
  })
})
