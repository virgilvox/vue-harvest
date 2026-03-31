import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'pathe'
import { analyzeSFC } from '../../src/analyzers/sfc-analyzer.js'
import { buildComponentGraph } from '../../src/analyzers/graph-builder.js'
import {
  extractComponent,
  autoExtract,
} from '../../src/extractors/component-extractor.js'
import { resolveConfig } from '../../src/utils/config.js'
import type {
  AnalyzedComponent,
  ComponentGraph,
  HarvestConfig,
} from '../../src/types.js'

const FIXTURES = resolve(__dirname, '../fixtures/src')
const PROJECT_ROOT = resolve(__dirname, '../fixtures')
const aliases = { '@': FIXTURES }

describe('Component Extractor', () => {
  let components: Map<string, AnalyzedComponent>
  let graph: ComponentGraph
  let config: HarvestConfig
  const projectDeps = {
    vue: '^3.5.0',
    'vue-router': '^4.0.0',
    pinia: '^2.0.0',
    axios: '^1.0.0',
  }

  beforeAll(async () => {
    const files = [
      'src/components/ui/BaseButton.vue',
      'src/components/ui/BaseCard.vue',
      'src/components/ui/BaseInput.vue',
      'src/components/features/UserProfileCard.vue',
      'src/components/features/SearchBar.vue',
      'src/views/Dashboard.vue',
    ]

    components = new Map()
    for (const file of files) {
      const absolutePath = resolve(PROJECT_ROOT, file)
      const analyzed = await analyzeSFC(
        file,
        absolutePath,
        PROJECT_ROOT,
        aliases
      )
      components.set(analyzed.name, analyzed)
    }

    graph = buildComponentGraph([...components.values()], PROJECT_ROOT, aliases)
    config = resolveConfig(PROJECT_ROOT)
  })

  describe('extractComponent', () => {
    it('successfully extracts a primitive component', () => {
      const result = extractComponent(
        'BaseButton',
        components,
        graph,
        config,
        projectDeps
      )

      expect(result.success).toBe(true)
      expect(result.files).toHaveProperty('BaseButton.vue')
      expect(result.manifest.component).toBe('BaseButton')
      expect(result.manifest.peerDependencies).toHaveProperty('vue')
    })

    it('includes the component source in extracted files', () => {
      const result = extractComponent(
        'BaseButton',
        components,
        graph,
        config,
        projectDeps
      )

      const source = result.files['BaseButton.vue']
      expect(source).toContain('<script setup')
      expect(source).toContain('<template>')
      expect(source).toContain('<style scoped>')
    })

    it('returns error for nonexistent component', () => {
      const result = extractComponent(
        'DoesNotExist',
        components,
        graph,
        config,
        projectDeps
      )

      expect(result.success).toBe(false)
      expect(result.issues[0].severity).toBe('error')
    })

    it('warns about low confidence when extracting below-threshold components', () => {
      // Dashboard is well below threshold
      const result = extractComponent(
        'Dashboard',
        components,
        graph,
        config,
        projectDeps
      )

      const hasWarning = result.issues.some(
        (i) => i.severity === 'warning' && i.message.includes('Confidence')
      )
      expect(hasWarning).toBe(true)
    })

    it('warns about store dependencies', () => {
      const result = extractComponent(
        'UserProfileCard',
        components,
        graph,
        config,
        projectDeps
      )

      const hasStoreWarning = result.issues.some(
        (i) => i.message.includes('Store dependency')
      )
      expect(hasStoreWarning).toBe(true)
    })

    it('generates a manifest with peer dependencies', () => {
      const result = extractComponent(
        'BaseButton',
        components,
        graph,
        config,
        projectDeps
      )

      expect(result.manifest.peerDependencies['vue']).toBe('^3.5.0')
    })
  })

  describe('autoExtract', () => {
    it('only extracts components above threshold', () => {
      const results = autoExtract(components, graph, config, projectDeps)

      for (const [name] of results) {
        const comp = components.get(name)!
        expect(comp.extractionConfidence).toBeGreaterThanOrEqual(
          config.extractionThreshold
        )
      }
    })

    it('extracts primitive components', () => {
      const results = autoExtract(components, graph, config, projectDeps)
      expect(results.has('BaseButton')).toBe(true)
      expect(results.has('BaseCard')).toBe(true)
      expect(results.has('BaseInput')).toBe(true)
    })

    it('does not extract page-bound/app-specific components', () => {
      const results = autoExtract(components, graph, config, projectDeps)
      expect(results.has('Dashboard')).toBe(false)
    })
  })
})
