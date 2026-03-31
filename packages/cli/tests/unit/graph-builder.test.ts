import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'pathe'
import { analyzeSFC } from '../../src/analyzers/sfc-analyzer.js'
import {
  buildComponentGraph,
  getDependencyClosure,
  getDependents,
} from '../../src/analyzers/graph-builder.js'
import type { AnalyzedComponent, ComponentGraph } from '../../src/types.js'

const FIXTURES = resolve(__dirname, '../fixtures/src')
const PROJECT_ROOT = resolve(__dirname, '../fixtures')
const aliases = { '@': FIXTURES }

describe('Graph Builder', () => {
  let components: AnalyzedComponent[]
  let graph: ComponentGraph

  beforeAll(async () => {
    const files = [
      'src/components/ui/BaseButton.vue',
      'src/components/ui/BaseCard.vue',
      'src/components/ui/BaseInput.vue',
      'src/components/features/UserProfileCard.vue',
      'src/components/features/SearchBar.vue',
      'src/views/Dashboard.vue',
    ]

    components = []
    for (const file of files) {
      const absolutePath = resolve(PROJECT_ROOT, file)
      const analyzed = await analyzeSFC(
        file,
        absolutePath,
        PROJECT_ROOT,
        aliases
      )
      components.push(analyzed)
    }

    graph = buildComponentGraph(components, PROJECT_ROOT, aliases)
  })

  it('creates a node for each component', () => {
    expect(graph.nodes).toHaveLength(components.length)
  })

  it('detects edges from UserProfileCard to BaseCard and BaseButton', () => {
    const edges = graph.edges.filter((e) => e.source === 'UserProfileCard')
    const targets = edges.map((e) => e.target)
    expect(targets).toContain('BaseCard')
    expect(targets).toContain('BaseButton')
  })

  it('identifies leaf components (no outgoing component deps)', () => {
    // BaseButton, BaseCard, BaseInput, SearchBar have no component imports
    expect(graph.leaves).toContain('BaseButton')
    expect(graph.leaves).toContain('BaseCard')
    expect(graph.leaves).toContain('BaseInput')
  })

  it('identifies root components (no incoming deps)', () => {
    // Dashboard is a root (nothing imports it)
    expect(graph.roots).toContain('Dashboard')
  })

  it('detects no cycles in this fixture set', () => {
    expect(graph.cycles).toHaveLength(0)
  })

  it('computes transitive deps for Dashboard', () => {
    const dashboard = components.find((c) => c.name === 'Dashboard')
    expect(dashboard).toBeDefined()
    // Dashboard -> UserProfileCard -> BaseCard, BaseButton
    // Dashboard -> BaseCard
    expect(dashboard!.transitiveDeps.length).toBeGreaterThanOrEqual(1)
  })

  describe('getDependencyClosure', () => {
    it('returns all transitive deps for UserProfileCard', () => {
      const closure = getDependencyClosure('UserProfileCard', graph)
      expect(closure).toContain('BaseCard')
      expect(closure).toContain('BaseButton')
    })

    it('returns empty for leaf components', () => {
      const closure = getDependencyClosure('BaseButton', graph)
      expect(closure).toHaveLength(0)
    })
  })

  describe('getDependents', () => {
    it('finds components that depend on BaseCard', () => {
      const dependents = getDependents('BaseCard', graph)
      expect(dependents).toContain('UserProfileCard')
      expect(dependents).toContain('Dashboard')
    })

    it('returns empty for root components', () => {
      const dependents = getDependents('Dashboard', graph)
      expect(dependents).toHaveLength(0)
    })
  })
})
