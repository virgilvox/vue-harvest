import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'pathe'
import type {
  AnalyzedComponent,
  ComponentGraph,
  HarvestRegistry,
  RegistryEntry,
  HarvestConfig,
  ExtractionResult,
} from '../types.js'

function componentToRegistryEntry(comp: AnalyzedComponent): RegistryEntry {
  return {
    name: comp.name,
    type: 'component',
    description: inferDescription(comp),
    tier: comp.tier,
    files: [comp.filePath, ...comp.transitiveDeps],
    dependencies: comp.dependencies
      .filter((d) => d.kind === 'internal-component' && d.resolvedPath)
      .map((d) => d.imports[0] || d.specifier),
    peerDependencies: comp.peerPackages,
    registryDependencies: comp.transitiveDeps,
    cssVars: comp.styles.flatMap((s) => s.cssVarsUsed),
    meta: {
      props: comp.props,
      emits: comp.emits,
      slots: comp.slots,
      loc: comp.loc.total,
    },
  }
}

function inferDescription(comp: AnalyzedComponent): string {
  const parts: string[] = []

  if (comp.tier === 'primitive') parts.push('UI primitive')
  else if (comp.tier === 'composite') parts.push('Composite component')
  else if (comp.tier === 'feature') parts.push('Feature component')

  if (comp.props.length > 0) parts.push(`${comp.props.length} props`)
  if (comp.slots.length > 0) parts.push(`${comp.slots.length} slots`)
  if (comp.emits.length > 0) parts.push(`${comp.emits.length} events`)

  return parts.join(' — ') || comp.name
}

export function generateRegistry(
  components: Map<string, AnalyzedComponent>,
  graph: ComponentGraph,
  config: HarvestConfig,
  sourceInfo: { name: string; version?: string; repo?: string }
): HarvestRegistry {
  const all = [...components.values()]
  const autoExtractable = all.filter(
    (c) => c.extractionConfidence >= config.extractionThreshold
  )

  return {
    $schema: 'https://vue-harvest.dev/schema/registry.json',
    name: sourceInfo.name,
    version: sourceInfo.version || '0.0.0',
    source: sourceInfo.repo || config.root,
    generatedAt: new Date().toISOString(),
    config: { extractionThreshold: config.extractionThreshold },
    components: all
      .filter((c) => c.tier !== 'app-specific')
      .map(componentToRegistryEntry),
    composables: [],
    utils: [],
    graph,
    stats: {
      totalComponents: all.length,
      autoExtractable: autoExtractable.length,
      needsReview: all.filter(
        (c) =>
          c.extractionConfidence >= 0.3 &&
          c.extractionConfidence < config.extractionThreshold
      ).length,
      appSpecific: all.filter((c) => c.tier === 'app-specific').length,
      totalFiles: all.reduce((sum, c) => sum + 1 + c.transitiveDeps.length, 0),
    },
  }
}

export function writeRegistry(
  registry: HarvestRegistry,
  outputDir: string,
  extractions?: Map<string, ExtractionResult>
): void {
  mkdirSync(outputDir, { recursive: true })

  writeFileSync(
    join(outputDir, 'registry.json'),
    JSON.stringify(registry, null, 2)
  )

  const componentsDir = join(outputDir, 'components')
  mkdirSync(componentsDir, { recursive: true })

  if (extractions) {
    for (const [name, result] of extractions) {
      const compDir = join(componentsDir, name)
      mkdirSync(compDir, { recursive: true })

      writeFileSync(
        join(compDir, 'manifest.json'),
        JSON.stringify(result.manifest, null, 2)
      )

      for (const [filePath, content] of Object.entries(result.files)) {
        const fullPath = join(compDir, filePath)
        const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))
        mkdirSync(dir, { recursive: true })
        writeFileSync(fullPath, content)
      }
    }
  }
}

// --- Catalog HTML ---

export function generateCatalogHTML(
  registry: HarvestRegistry,
  components: Map<string, AnalyzedComponent>
): string {
  const tierColors: Record<string, string> = {
    primitive: '#22c55e',
    composite: '#3b82f6',
    feature: '#f59e0b',
    'page-bound': '#ef4444',
    'app-specific': '#6b7280',
  }

  const tierLabels: Record<string, string> = {
    primitive: 'Primitive',
    composite: 'Composite',
    feature: 'Feature',
    'page-bound': 'Page-Bound',
    'app-specific': 'App-Specific',
  }

  const cards = registry.components
    .map((entry) => {
      const comp = components.get(entry.name)
      if (!comp) return ''

      const pct = Math.round(comp.extractionConfidence * 100)
      const color = tierColors[comp.tier] || '#6b7280'
      const issues = comp.couplingIssues.length

      return `
      <div class="card" data-tier="${comp.tier}" data-confidence="${pct}">
        <div class="card-hd">
          <h3>${esc(comp.name)}</h3>
          <span class="badge" style="--c:${color}">${tierLabels[comp.tier]}</span>
        </div>
        <div class="meta">
          <span class="${pct >= 70 ? 'hi' : pct >= 40 ? 'md' : 'lo'}">${pct}%</span>
          <span>${comp.loc.total} LOC</span>
          <span>${comp.scriptVariant}</span>
        </div>
        ${comp.props.length > 0 ? `<div class="sec"><strong>Props</strong><ul>${comp.props.map((p) => `<li><code>${esc(p.name)}${p.required ? '' : '?'}</code>: <em>${esc(p.type)}</em></li>`).join('')}</ul></div>` : ''}
        ${comp.slots.length > 0 ? `<div class="sec"><strong>Slots</strong><ul>${comp.slots.map((s) => `<li><code>#${esc(s.name)}</code></li>`).join('')}</ul></div>` : ''}
        ${issues > 0 ? `<div class="issues">${issues} coupling issue${issues > 1 ? 's' : ''}</div>` : ''}
      </div>`
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(registry.name)} — Vue Harvest</title>
<style>
:root{--bg:#0a0a0a;--sf:#141414;--bd:#2a2a2a;--tx:#e5e5e5;--mt:#888;--ac:#22d3ee;--fm:'JetBrains Mono',monospace}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--tx);font-family:'Inter',-apple-system,sans-serif;padding:2rem;line-height:1.6}
.hdr{max-width:1400px;margin:0 auto 2rem;border-bottom:1px solid var(--bd);padding-bottom:1.5rem}
.hdr h1{font-family:var(--fm);font-size:1.4rem;color:var(--ac)}
.stats{display:flex;gap:2rem;margin-top:.75rem;font-family:var(--fm);font-size:.8rem;color:var(--mt)}
.stats strong{color:var(--tx)}
.filters{max-width:1400px;margin:0 auto 1.5rem;display:flex;gap:.4rem;flex-wrap:wrap}
.fb{background:var(--sf);border:1px solid var(--bd);color:var(--mt);padding:.35rem .7rem;border-radius:4px;font-family:var(--fm);font-size:.75rem;cursor:pointer}
.fb:hover,.fb.on{border-color:var(--ac);color:var(--ac)}
.grid{max-width:1400px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:1rem}
.card{background:var(--sf);border:1px solid var(--bd);border-radius:8px;padding:1.2rem;transition:border-color .15s}
.card:hover{border-color:var(--ac)}
.card-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem}
.card-hd h3{font-family:var(--fm);font-size:.95rem}
.badge{font-family:var(--fm);font-size:.65rem;padding:.15rem .4rem;border-radius:3px;background:color-mix(in srgb,var(--c) 15%,transparent);color:var(--c);border:1px solid color-mix(in srgb,var(--c) 30%,transparent)}
.meta{display:flex;gap:.8rem;font-size:.75rem;color:var(--mt);margin-bottom:.8rem;font-family:var(--fm)}
.hi{color:#22c55e}.md{color:#f59e0b}.lo{color:#ef4444}
.sec{margin-bottom:.4rem}.sec strong{font-size:.7rem;color:var(--mt);text-transform:uppercase;letter-spacing:.05em}
.sec ul{list-style:none}.sec li{font-family:var(--fm);font-size:.75rem;padding:.1rem 0}
.sec em{color:var(--ac);font-style:normal}
.issues{font-family:var(--fm);font-size:.7rem;color:#f59e0b;margin-top:.5rem}
.hide{display:none!important}
</style>
</head>
<body>
<div class="hdr">
  <h1>vue-harvest // ${esc(registry.name)}</h1>
  <div class="stats">
    <span><strong>${registry.stats.totalComponents}</strong> components</span>
    <span><strong>${registry.stats.autoExtractable}</strong> extractable</span>
    <span><strong>${registry.stats.needsReview}</strong> review</span>
  </div>
</div>
<div class="filters">
  <button class="fb on" data-f="all">All</button>
  <button class="fb" data-f="primitive">Primitive</button>
  <button class="fb" data-f="composite">Composite</button>
  <button class="fb" data-f="feature">Feature</button>
  <button class="fb" data-f="page-bound">Page-Bound</button>
  <button class="fb" data-f="extractable">Extractable</button>
</div>
<div class="grid">${cards}</div>
<script>
document.querySelectorAll('.fb').forEach(b=>{b.addEventListener('click',()=>{
document.querySelectorAll('.fb').forEach(x=>x.classList.remove('on'));b.classList.add('on');
const f=b.dataset.f;document.querySelectorAll('.card').forEach(c=>{
if(f==='all')c.classList.remove('hide');
else if(f==='extractable')c.classList.toggle('hide',+c.dataset.confidence<70);
else c.classList.toggle('hide',c.dataset.tier!==f)})})})
</script>
</body></html>`
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
