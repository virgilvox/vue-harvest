import { resolve, dirname, join } from 'pathe'
import { existsSync } from 'fs'
import type {
  AnalyzedComponent,
  ComponentGraph,
  ComponentEdge,
} from '../types.js'

// --- Path Resolution ---

function resolveImportPath(
  specifier: string,
  fromFile: string,
  projectRoot: string,
  aliases: Record<string, string>
): string | null {
  let targetPath: string

  for (const [alias, aliasPath] of Object.entries(aliases)) {
    if (specifier === alias || specifier.startsWith(alias + '/')) {
      const rest = specifier.slice(alias.length)
      targetPath = join(aliasPath, rest)
      return resolveFile(targetPath)
    }
  }

  if (specifier.startsWith('.')) {
    targetPath = resolve(dirname(fromFile), specifier)
    return resolveFile(targetPath)
  }

  if (specifier.startsWith('/')) {
    targetPath = resolve(projectRoot, specifier.slice(1))
    return resolveFile(targetPath)
  }

  return null
}

function resolveFile(basePath: string): string | null {
  if (existsSync(basePath)) return basePath

  const extensions = [
    '.vue',
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '/index.vue',
    '/index.ts',
    '/index.js',
  ]
  for (const ext of extensions) {
    const candidate = basePath + ext
    if (existsSync(candidate)) return candidate
  }

  return null
}

// --- Graph Construction ---

export function buildComponentGraph(
  components: AnalyzedComponent[],
  projectRoot: string,
  aliases: Record<string, string>
): ComponentGraph {
  const nodeMap = new Map<string, AnalyzedComponent>()
  const pathToName = new Map<string, string>()
  const edges: ComponentEdge[] = []

  for (const comp of components) {
    nodeMap.set(comp.name, comp)
    pathToName.set(comp.absolutePath, comp.name)
  }

  for (const comp of components) {
    for (const dep of comp.dependencies) {
      if (dep.kind !== 'internal-component') continue

      const resolvedPath = resolveImportPath(
        dep.specifier,
        comp.absolutePath,
        projectRoot,
        aliases
      )

      if (resolvedPath) {
        dep.resolvedPath = resolvedPath
        const targetName = pathToName.get(resolvedPath)
        if (targetName) {
          edges.push({
            source: comp.name,
            target: targetName,
            type: 'imports',
          })
        }
      }
    }
  }

  // Build adjacency lists
  const outgoing = new Map<string, Set<string>>()
  const incoming = new Map<string, Set<string>>()

  for (const comp of components) {
    outgoing.set(comp.name, new Set())
    incoming.set(comp.name, new Set())
  }

  for (const edge of edges) {
    outgoing.get(edge.source)?.add(edge.target)
    incoming.get(edge.target)?.add(edge.source)
  }

  const roots = components
    .filter((c) => (incoming.get(c.name)?.size || 0) === 0)
    .map((c) => c.name)

  const leaves = components
    .filter((c) => (outgoing.get(c.name)?.size || 0) === 0)
    .map((c) => c.name)

  const cycles = detectCycles(
    components.map((c) => c.name),
    outgoing
  )

  // Compute transitive deps
  for (const comp of components) {
    const transitive = new Set<string>()
    const visited = new Set<string>()
    const stack = [...(outgoing.get(comp.name) || [])]

    while (stack.length > 0) {
      const current = stack.pop()!
      if (visited.has(current)) continue
      visited.add(current)
      transitive.add(current)

      const deps = outgoing.get(current)
      if (deps) {
        for (const dep of deps) {
          if (!visited.has(dep)) stack.push(dep)
        }
      }
    }

    comp.transitiveDeps = [...transitive]
  }

  return {
    nodes: components.map((c) => ({
      id: c.name,
      filePath: c.filePath,
      tier: c.tier,
      confidence: c.extractionConfidence,
    })),
    edges,
    roots,
    leaves,
    cycles,
  }
}

// --- Tarjan's SCC ---

function detectCycles(
  nodes: string[],
  adjacency: Map<string, Set<string>>
): string[][] {
  let index = 0
  const stack: string[] = []
  const onStack = new Set<string>()
  const indices = new Map<string, number>()
  const lowlinks = new Map<string, number>()
  const sccs: string[][] = []

  function strongConnect(v: string) {
    indices.set(v, index)
    lowlinks.set(v, index)
    index++
    stack.push(v)
    onStack.add(v)

    const neighbors = adjacency.get(v) || new Set()
    for (const w of neighbors) {
      if (!indices.has(w)) {
        strongConnect(w)
        lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!))
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!))
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc: string[] = []
      let w: string
      do {
        w = stack.pop()!
        onStack.delete(w)
        scc.push(w)
      } while (w !== v)

      if (scc.length > 1) {
        sccs.push(scc)
      }
    }
  }

  for (const node of nodes) {
    if (!indices.has(node)) {
      strongConnect(node)
    }
  }

  return sccs
}

// --- Graph Queries ---

export function getDependencyClosure(
  componentName: string,
  graph: ComponentGraph
): string[] {
  const visited = new Set<string>()

  // Seed with direct dependencies of the root component
  const directDeps = graph.edges
    .filter((e) => e.source === componentName)
    .map((e) => e.target)

  const stack = [...directDeps]

  while (stack.length > 0) {
    const current = stack.pop()!
    if (visited.has(current)) continue
    visited.add(current)

    const deps = graph.edges
      .filter((e) => e.source === current)
      .map((e) => e.target)

    for (const dep of deps) {
      if (!visited.has(dep)) {
        stack.push(dep)
      }
    }
  }

  return [...visited]
}

export function getDependents(
  componentName: string,
  graph: ComponentGraph
): string[] {
  const visited = new Set<string>()
  const stack = [componentName]

  while (stack.length > 0) {
    const current = stack.pop()!

    const dependents = graph.edges
      .filter((e) => e.target === current)
      .map((e) => e.source)

    for (const dep of dependents) {
      if (!visited.has(dep)) {
        visited.add(dep)
        stack.push(dep)
      }
    }
  }

  return [...visited]
}
