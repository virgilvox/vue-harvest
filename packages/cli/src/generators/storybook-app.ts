// ============================================================================
// Vue Harvest — Storybook App Generator
// Generates a Vite + Vue 3 app that renders the project's actual components
// and auto-discovered CSS component classes in a storybook-like interface.
// ============================================================================

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join, relative, resolve } from 'pathe'
import { stripLayerWrappers } from '../utils/css-parser.js'
import type {
  AnalyzedComponent,
  HarvestRegistry,
  DesignSystemReport,
  ComponentGraph,
  CSSComponentReport,
  HarvestConfig,
} from '../types.js'

interface StorybookInput {
  config: HarvestConfig
  registry: HarvestRegistry
  components: Map<string, AnalyzedComponent>
  graph: ComponentGraph
  designSystem?: DesignSystemReport
  cssComponents?: CSSComponentReport
  projectName: string
  projectVersion?: string
}

export function generateStorybookApp(input: StorybookInput): void {
  const viewerDir = join(input.config.outDir, 'viewer')
  const srcDir = join(viewerDir, 'src')
  const dataDir = join(srcDir, 'data')

  for (const dir of [viewerDir, srcDir, dataDir]) {
    mkdirSync(dir, { recursive: true })
  }

  // Analysis data
  const analysisData = {
    projectName: input.projectName,
    projectVersion: input.projectVersion,
    components: [...input.components.entries()].map(([name, c]) => ({
      name,
      filePath: c.filePath,
      tier: c.tier,
      confidence: Math.round(c.extractionConfidence * 100),
      props: c.props,
      emits: c.emits,
      slots: c.slots,
      couplingIssues: c.couplingIssues.map(i => ({
        type: i.type, description: i.description,
        severity: i.severity, suggestedFix: i.suggestedFix,
      })),
      dependencies: c.dependencies.filter(d => d.kind !== 'vue-core').map(d => ({
        specifier: d.specifier, kind: d.kind, imports: d.imports,
      })),
      loc: c.loc,
      scriptVariant: c.scriptVariant,
      peerPackages: c.peerPackages,
    })),
    graph: {
      nodes: input.graph.nodes.length,
      edges: input.graph.edges.length,
      roots: input.graph.roots.length,
      leaves: input.graph.leaves.length,
      cycles: input.graph.cycles.length,
    },
    stats: input.registry.stats,
    designSystem: input.designSystem ? {
      projectTokenCount: input.designSystem.stats.projectTokenCount,
      varReferenceCount: input.designSystem.stats.varReferenceCount,
      hardcodedCount: input.designSystem.stats.hardcodedCount,
      tokenizationRate: Math.round(input.designSystem.stats.tokenizationRate * 100),
      palette: input.designSystem.palette.slice(0, 60),
      typography: input.designSystem.typography,
      spacing: input.designSystem.spacing.slice(0, 30),
      radii: input.designSystem.radii,
      shadows: input.designSystem.shadows.slice(0, 12),
      projectTokens: input.designSystem.projectTokens.slice(0, 80),
      googleFonts: input.designSystem.googleFonts,
    } : null,
    cssComponents: input.cssComponents || null,
  }

  writeFileSync(join(dataDir, 'analysis.json'), JSON.stringify(analysisData, null, 2))

  // Theme CSS
  if (input.designSystem?.themeCSS) {
    let css = input.designSystem.themeCSS
    css = css.replace(/@import\s+url\([^)]+\)\s*;/g, '')
    css = stripLayerWrappers(css)
    writeFileSync(join(dataDir, 'theme.css'), css)
  }

  // Generate app files
  const relRoot = relative(join(input.config.outDir, 'viewer'), input.config.root) || '.'
  const googleFonts = input.designSystem?.googleFonts || []

  writeFileSync(join(viewerDir, 'package.json'), JSON.stringify({
    name: `${input.projectName}-viewer`,
    private: true,
    type: 'module',
    scripts: { dev: 'vite', build: 'vite build' },
    dependencies: { vue: '^3.5.0' },
    devDependencies: { vite: '^6.0.0', '@vitejs/plugin-vue': '^5.0.0' },
  }, null, 2))

  writeFileSync(join(viewerDir, 'vite.config.ts'), `import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
const projectRoot = resolve(__dirname, '${relRoot.replace(/\\/g, '/')}')
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '~': projectRoot, '@': resolve(projectRoot, 'src') } },
  server: { port: 5174, open: true },
})
`)

  const fontLink = googleFonts.length > 0
    ? `\n    <link href="https://fonts.googleapis.com/css2?${googleFonts.map(f => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700;800`).join('&')}&display=swap" rel="stylesheet">`
    : ''

  writeFileSync(join(viewerDir, 'index.html'), `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(input.projectName)} — Vue Harvest</title>${fontLink}
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" crossorigin="anonymous">
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`)

  writeFileSync(join(srcDir, 'main.ts'), `import { createApp } from 'vue'
import App from './App.vue'
import './data/theme.css'
createApp(App).mount('#app')
`)

  writeFileSync(join(srcDir, 'App.vue'), generateAppVue(input))
}

// ============================================================================
// App.vue — The entire storybook in one SFC
// ============================================================================

function generateAppVue(input: StorybookInput): string {
  const cssGroups = input.cssComponents?.groups || []
  const hasCSSComponents = cssGroups.length > 0
  const hasTokens = !!input.designSystem

  return `<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import data from './data/analysis.json'

// --- State ---
const active = ref('overview')
const dark = ref(false)
const search = ref('')
const expandedGroups = ref<Set<string>>(new Set(['overview']))
const tierFilter = ref('all')

// --- Computed ---
const tiers = computed(() => {
  const counts: Record<string, number> = {}
  for (const c of data.components) counts[c.tier] = (counts[c.tier] || 0) + 1
  return counts
})

const filteredComponents = computed(() => {
  return data.components.filter((c: any) => {
    if (search.value && !c.name.toLowerCase().includes(search.value.toLowerCase())) return false
    if (tierFilter.value !== 'all' && c.tier !== tierFilter.value) return false
    return true
  })
})

const activeComponent = computed(() => {
  if (!active.value.startsWith('comp:')) return null
  const name = active.value.slice(5)
  return data.components.find((c: any) => c.name === name) || null
})

const activeCSSGroup = computed(() => {
  if (!active.value.startsWith('css:')) return null
  const cat = active.value.slice(4)
  return data.cssComponents?.groups?.find((g: any) => g.category === cat) || null
})

// --- Dark mode ---
function toggleDark() {
  dark.value = !dark.value
  document.documentElement.setAttribute('data-theme', dark.value ? 'dark' : '')
}

function toggleGroup(id: string) {
  if (expandedGroups.value.has(id)) expandedGroups.value.delete(id)
  else expandedGroups.value.add(id)
}

// --- Helpers ---
const tierColors: Record<string, string> = {
  primitive: '#16a34a', composite: '#2563eb', feature: '#d97706',
  'page-bound': '#dc2626', 'app-specific': '#6b7280',
}
const severityColors: Record<string, string> = { blocker: '#dc2626', warning: '#d97706', info: '#2563eb' }
const depKindColors: Record<string, string> = {
  'internal-component': '#7c3aed', 'internal-composable': '#2563eb',
  'internal-store': '#dc2626', 'internal-util': '#6b7280',
  'external-package': '#16a34a', 'provide-inject': '#d97706',
}

function hexLum(hex: string): number {
  const c = hex.replace('#', '')
  if (c.length < 6) return 0.5
  const r = parseInt(c.slice(0, 2), 16) / 255
  const g = parseInt(c.slice(2, 4), 16) / 255
  const b = parseInt(c.slice(4, 6), 16) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
</script>

<template>
<div class="shell" :class="{ dark }">
  <!-- SIDEBAR -->
  <aside class="sb">
    <div class="sb-head">
      <div class="sb-logo"><i class="fa-solid fa-seedling"></i> vue-harvest</div>
      <button class="sb-dark" @click="toggleDark" :title="dark ? 'Light mode' : 'Dark mode'">
        <i :class="dark ? 'fa-solid fa-sun' : 'fa-solid fa-moon'"></i>
      </button>
    </div>

    <div class="sb-search">
      <i class="fa-solid fa-search"></i>
      <input v-model="search" placeholder="Search..." />
    </div>

    <nav class="sb-tree">
      <!-- Overview -->
      <a class="sb-link" :class="{ on: active === 'overview' }" @click.prevent="active = 'overview'" href="#">
        <i class="fa-solid fa-chart-pie"></i> Overview
      </a>

${hasTokens ? `
      <!-- Design Tokens -->
      <div class="sb-group">
        <button class="sb-group-btn" @click="toggleGroup('tokens')">
          <i :class="expandedGroups.has('tokens') ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right'" class="sb-chevron"></i>
          <i class="fa-solid fa-palette"></i> Design Tokens
        </button>
        <div v-show="expandedGroups.has('tokens')" class="sb-children">
          <a class="sb-link" :class="{ on: active === 'tokens:colors' }" @click.prevent="active = 'tokens:colors'" href="#">Colors</a>
          <a class="sb-link" :class="{ on: active === 'tokens:typography' }" @click.prevent="active = 'tokens:typography'" href="#">Typography</a>
          <a class="sb-link" :class="{ on: active === 'tokens:spacing' }" @click.prevent="active = 'tokens:spacing'" href="#">Spacing</a>
          <a class="sb-link" :class="{ on: active === 'tokens:shadows' }" @click.prevent="active = 'tokens:shadows'" href="#">Shadows</a>
          <a class="sb-link" :class="{ on: active === 'tokens:all' }" @click.prevent="active = 'tokens:all'" href="#">All Tokens</a>
        </div>
      </div>
` : ''}

${hasCSSComponents ? `
      <!-- CSS Components -->
      <div class="sb-group">
        <button class="sb-group-btn" @click="toggleGroup('css')">
          <i :class="expandedGroups.has('css') ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right'" class="sb-chevron"></i>
          <i class="fa-solid fa-swatchbook"></i> CSS Components
          <span class="sb-count">${input.cssComponents?.totalClasses || 0}</span>
        </button>
        <div v-show="expandedGroups.has('css')" class="sb-children">
          <a v-for="g in data.cssComponents?.groups" :key="g.category"
            class="sb-link" :class="{ on: active === 'css:' + g.category }"
            @click.prevent="active = 'css:' + g.category" href="#">
            <i :class="g.icon" class="sb-icon"></i>
            {{ g.label }}
            <span class="sb-count">{{ g.components.length }}</span>
          </a>
        </div>
      </div>
` : ''}

      <!-- Vue Components -->
      <div class="sb-group">
        <button class="sb-group-btn" @click="toggleGroup('components')">
          <i :class="expandedGroups.has('components') ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right'" class="sb-chevron"></i>
          <i class="fa-solid fa-cubes"></i> Components
          <span class="sb-count">{{ data.components.length }}</span>
        </button>
        <div v-show="expandedGroups.has('components')" class="sb-children">
          <a class="sb-link" :class="{ on: active === 'catalog' }" @click.prevent="active = 'catalog'" href="#">
            <i class="fa-solid fa-table-list"></i> Full Catalog
          </a>
          <template v-for="(count, tier) in tiers" :key="tier">
            <div class="sb-tier-label">{{ tier }} ({{ count }})</div>
            <a v-for="c in data.components.filter((x: any) => x.tier === tier).slice(0, 20)" :key="c.name"
              class="sb-link sb-comp-link" :class="{ on: active === 'comp:' + c.name }"
              @click.prevent="active = 'comp:' + c.name" href="#">
              {{ c.name }}
            </a>
            <div v-if="data.components.filter((x: any) => x.tier === tier).length > 20" class="sb-more">
              +{{ data.components.filter((x: any) => x.tier === tier).length - 20 }} more
            </div>
          </template>
        </div>
      </div>
    </nav>
  </aside>

  <!-- MAIN CONTENT -->
  <main class="main">

    <!-- ===== OVERVIEW ===== -->
    <div v-if="active === 'overview'" class="page">
      <h1 class="page-title">{{ data.projectName }} <span v-if="data.projectVersion" class="page-version">v{{ data.projectVersion }}</span></h1>
      <p class="page-desc">Component analysis and design system overview.</p>

      <div class="stat-row">
        <div class="stat"><span class="stat-val">{{ data.stats.totalComponents }}</span><span class="stat-lbl">Components</span></div>
        <div class="stat"><span class="stat-val" style="color:#16a34a">{{ data.stats.autoExtractable }}</span><span class="stat-lbl">Extractable</span></div>
        <div class="stat"><span class="stat-val" style="color:#d97706">{{ data.stats.needsReview }}</span><span class="stat-lbl">Needs Review</span></div>
        <div class="stat" v-if="data.designSystem"><span class="stat-val" style="color:#2563eb">{{ data.designSystem.projectTokenCount }}</span><span class="stat-lbl">Design Tokens</span></div>
        <div class="stat" v-if="data.designSystem"><span class="stat-val" :style="{ color: data.designSystem.tokenizationRate >= 50 ? '#16a34a' : '#d97706' }">{{ data.designSystem.tokenizationRate }}%</span><span class="stat-lbl">Tokenized</span></div>
        <div class="stat" v-if="data.cssComponents"><span class="stat-val" style="color:#7c3aed">{{ data.cssComponents.totalClasses }}</span><span class="stat-lbl">CSS Components</span></div>
      </div>

      <div class="card" v-if="data.designSystem?.googleFonts?.length" style="margin-bottom:20px">
        <div class="card-label">Google Fonts</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <span v-for="f in data.designSystem.googleFonts" :key="f" class="pill" :style="{ fontFamily: f }">{{ f }}</span>
        </div>
      </div>

      <div class="card">
        <div class="card-label">Components by Tier</div>
        <div v-for="(count, tier) in tiers" :key="tier" class="bar-row">
          <span class="bar-label">{{ tier }}</span>
          <div class="bar-track"><div class="bar-fill" :style="{ width: (count / Math.max(...Object.values(tiers)) * 100) + '%', background: tierColors[tier as string] || '#999' }">{{ count }}</div></div>
        </div>
      </div>
    </div>

    <!-- ===== TOKENS: COLORS ===== -->
    <div v-if="active === 'tokens:colors' && data.designSystem" class="page">
      <h1 class="page-title">Color Palette</h1>
      <p class="page-desc">{{ data.designSystem.palette.length }} colors extracted from the project's design tokens.</p>
      <div class="color-grid">
        <div v-for="c in data.designSystem.palette" :key="c.hex" class="color-swatch">
          <div class="color-well" :style="{ background: c.hex, color: hexLum(c.hex) > 0.5 ? '#111' : '#fff' }">Aa</div>
          <div class="color-meta">
            <div class="color-name">{{ c.name || '' }}</div>
            <div class="color-hex">{{ c.hex }}</div>
            <div class="color-usage">{{ c.usageCount }}x</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== TOKENS: TYPOGRAPHY ===== -->
    <div v-if="active === 'tokens:typography' && data.designSystem" class="page">
      <h1 class="page-title">Typography</h1>
      <div v-for="font in data.designSystem.typography.families" :key="font" class="card" style="margin-bottom:16px">
        <div class="card-label">Font Family</div>
        <div :style="{ fontFamily: font, fontSize: '24px', marginBottom: '8px' }">{{ font }}</div>
        <div :style="{ fontFamily: font, fontSize: '14px', color: 'var(--shell-text-dim, #666)' }">The quick brown fox jumps over the lazy dog. 0123456789 !@#$%</div>
      </div>
      <div class="card" v-if="data.designSystem.typography.sizes.length" style="margin-bottom:16px">
        <div class="card-label">Type Scale</div>
        <div v-for="s in data.designSystem.typography.sizes.slice(0, 15)" :key="s" style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px">
          <span class="mono" style="min-width:60px;color:var(--shell-text-muted,#999)">{{ s }}</span>
          <span :style="{ fontSize: s }">The quick brown fox</span>
        </div>
      </div>
      <div class="card" v-if="data.designSystem.typography.weights.length">
        <div class="card-label">Font Weights</div>
        <div v-for="w in data.designSystem.typography.weights" :key="w" style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px">
          <span class="mono" style="min-width:60px;color:var(--shell-text-muted,#999)">{{ w }}</span>
          <span :style="{ fontWeight: w, fontSize: '18px' }">The quick brown fox</span>
        </div>
      </div>
    </div>

    <!-- ===== TOKENS: SPACING ===== -->
    <div v-if="active === 'tokens:spacing' && data.designSystem" class="page">
      <h1 class="page-title">Spacing & Radii</h1>
      <div class="card" style="margin-bottom:16px">
        <div class="card-label">Spacing Scale</div>
        <div v-for="s in data.designSystem.spacing" :key="s" style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
          <span class="mono" style="min-width:60px;text-align:right;color:var(--shell-text-muted,#999)">{{ s }}</span>
          <div :style="{ width: 'min(' + s + ', 300px)', height: '18px', background: 'var(--accent, #2563eb)', borderRadius: '3px', minWidth: '2px' }"></div>
        </div>
      </div>
      <div class="card" v-if="data.designSystem.radii.length">
        <div class="card-label">Border Radii</div>
        <div style="display:flex;flex-wrap:wrap;gap:16px">
          <div v-for="r in data.designSystem.radii" :key="r" style="text-align:center">
            <div :style="{ width: '48px', height: '48px', background: 'var(--accent, #2563eb)', borderRadius: r, margin: '0 auto 6px' }"></div>
            <span class="mono" style="font-size:11px;color:var(--shell-text-muted,#999)">{{ r }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== TOKENS: SHADOWS ===== -->
    <div v-if="active === 'tokens:shadows' && data.designSystem" class="page">
      <h1 class="page-title">Shadows</h1>
      <div style="display:flex;flex-wrap:wrap;gap:16px">
        <div v-for="s in data.designSystem.shadows" :key="s" class="shadow-demo" :style="{ boxShadow: s }">
          <span class="mono" style="font-size:10px;color:var(--shell-text-muted,#999);word-break:break-all">{{ s }}</span>
        </div>
      </div>
    </div>

    <!-- ===== TOKENS: ALL ===== -->
    <div v-if="active === 'tokens:all' && data.designSystem" class="page">
      <h1 class="page-title">All Design Tokens</h1>
      <p class="page-desc">{{ data.designSystem.projectTokens.length }} CSS custom properties defined in your project.</p>
      <table class="data-table">
        <thead><tr><th>Token</th><th>Value</th><th>Type</th><th>Refs</th></tr></thead>
        <tbody>
          <tr v-for="t in data.designSystem.projectTokens" :key="t.name">
            <td class="mono" style="font-weight:600">{{ t.name }}</td>
            <td>
              <span v-if="t.type === 'color'" class="color-dot" :style="{ background: t.value }"></span>
              <span class="mono" style="font-size:11px">{{ t.value.length > 50 ? t.value.slice(0, 48) + '...' : t.value }}</span>
            </td>
            <td><span class="pill pill-sm">{{ t.type }}</span></td>
            <td class="mono">{{ t.usageCount }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ===== CSS COMPONENT GROUP ===== -->
    <div v-if="activeCSSGroup" class="page">
      <h1 class="page-title"><i :class="activeCSSGroup.icon" style="margin-right:8px"></i>{{ activeCSSGroup.label }}</h1>
      <p class="page-desc">{{ activeCSSGroup.components.length }} CSS component classes in this category.</p>

      <div v-for="example in activeCSSGroup.examples" :key="example.label" class="story">
        <div class="story-label">{{ example.label }}</div>
        <div class="story-preview" v-html="example.html"></div>
        <details class="story-code-toggle">
          <summary class="mono" style="cursor:pointer;font-size:11px;color:var(--shell-text-muted,#999);padding:8px 0">Show HTML</summary>
          <pre class="story-code">{{ example.html }}</pre>
        </details>
      </div>
    </div>

    <!-- ===== COMPONENT CATALOG ===== -->
    <div v-if="active === 'catalog'" class="page">
      <h1 class="page-title">Component Catalog</h1>
      <p class="page-desc">{{ data.components.length }} analyzed Vue components.</p>

      <div class="filter-row">
        <button v-for="(count, tier) in { all: data.components.length, ...tiers }" :key="tier"
          class="filter-btn" :class="{ on: tierFilter === tier }"
          :style="tierFilter === tier ? { background: tierColors[tier as string] || '#333', borderColor: tierColors[tier as string] || '#333', color: '#fff' } : {}"
          @click="tierFilter = tier as string">
          {{ tier }} ({{ count }})
        </button>
      </div>

      <div v-for="c in filteredComponents" :key="c.name" class="catalog-row" @click="active = 'comp:' + c.name" style="cursor:pointer">
        <span class="mono" style="font-weight:600;min-width:180px">{{ c.name }}</span>
        <span class="pill pill-sm" :style="{ background: tierColors[c.tier] + '20', color: tierColors[c.tier] }">{{ c.tier }}</span>
        <span class="mono" style="color:var(--shell-text-muted,#999)">{{ c.confidence }}%</span>
        <span class="mono" style="color:var(--shell-text-muted,#999)">{{ c.loc.total }} LOC</span>
        <span class="mono" style="color:var(--shell-text-muted,#999)">{{ c.props.length }}p {{ c.emits.length }}e {{ c.slots.length }}s</span>
        <span v-if="c.couplingIssues.length" class="mono" style="color:#d97706"><i class="fa-solid fa-triangle-exclamation"></i> {{ c.couplingIssues.length }}</span>
      </div>
    </div>

    <!-- ===== SINGLE COMPONENT DETAIL ===== -->
    <div v-if="activeComponent" class="page">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
        <a href="#" @click.prevent="active = 'catalog'" class="back-link"><i class="fa-solid fa-arrow-left"></i> Catalog</a>
      </div>
      <h1 class="page-title">{{ activeComponent.name }}</h1>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:16px">
        <span class="pill" :style="{ background: tierColors[activeComponent.tier] + '20', color: tierColors[activeComponent.tier] }">{{ activeComponent.tier }}</span>
        <span class="mono" style="color:var(--shell-text-muted,#999)">{{ activeComponent.confidence }}% confidence</span>
        <span class="mono" style="color:var(--shell-text-muted,#999)">{{ activeComponent.scriptVariant }}</span>
        <span class="mono" style="color:var(--shell-text-muted,#999)">{{ activeComponent.filePath }}</span>
      </div>

      <div class="stat-row" style="margin-bottom:20px">
        <div class="stat stat-sm"><span class="stat-val">{{ activeComponent.loc.template }}</span><span class="stat-lbl">Template</span></div>
        <div class="stat stat-sm"><span class="stat-val">{{ activeComponent.loc.script }}</span><span class="stat-lbl">Script</span></div>
        <div class="stat stat-sm"><span class="stat-val">{{ activeComponent.loc.style }}</span><span class="stat-lbl">Style</span></div>
        <div class="stat stat-sm"><span class="stat-val">{{ activeComponent.loc.total }}</span><span class="stat-lbl">Total LOC</span></div>
      </div>

      <!-- Props -->
      <div v-if="activeComponent.props.length" class="card" style="margin-bottom:16px">
        <div class="card-label">Props ({{ activeComponent.props.length }})</div>
        <table class="data-table">
          <thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Default</th></tr></thead>
          <tbody>
            <tr v-for="p in activeComponent.props" :key="p.name">
              <td class="mono" style="font-weight:600">{{ p.name }}</td>
              <td class="mono" style="color:#2563eb">{{ p.type }}</td>
              <td><span v-if="p.required" style="color:#dc2626;font-size:10px;font-weight:700">REQUIRED</span><span v-else style="color:var(--shell-text-muted,#999);font-size:10px">optional</span></td>
              <td class="mono" style="font-size:11px;color:var(--shell-text-dim,#666)">{{ p.default || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Events -->
      <div v-if="activeComponent.emits.length" class="card" style="margin-bottom:16px">
        <div class="card-label">Events ({{ activeComponent.emits.length }})</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          <span v-for="e in activeComponent.emits" :key="e.name" class="pill">@{{ e.name }} <span v-if="e.payload" class="mono" style="opacity:0.6"> → {{ e.payload }}</span></span>
        </div>
      </div>

      <!-- Slots -->
      <div v-if="activeComponent.slots.length" class="card" style="margin-bottom:16px">
        <div class="card-label">Slots ({{ activeComponent.slots.length }})</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          <span v-for="s in activeComponent.slots" :key="s.name" class="pill" style="background:#f3f0ff;color:#7c3aed">#{{ s.name }}</span>
        </div>
      </div>

      <!-- Dependencies -->
      <div v-if="activeComponent.dependencies.length" class="card" style="margin-bottom:16px">
        <div class="card-label">Dependencies ({{ activeComponent.dependencies.length }})</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          <span v-for="d in activeComponent.dependencies" :key="d.specifier" class="pill pill-sm"
            :style="{ background: (depKindColors[d.kind] || '#999') + '15', color: depKindColors[d.kind] || '#999' }">
            {{ d.imports?.[0] || d.specifier }} <span style="opacity:0.5">{{ d.kind }}</span>
          </span>
        </div>
      </div>

      <!-- Coupling Issues -->
      <div v-if="activeComponent.couplingIssues.length" class="card" style="margin-bottom:16px">
        <div class="card-label" style="color:#d97706"><i class="fa-solid fa-triangle-exclamation"></i> Coupling Issues ({{ activeComponent.couplingIssues.length }})</div>
        <div v-for="(issue, i) in activeComponent.couplingIssues" :key="i" class="issue-row" :style="{ borderLeftColor: severityColors[issue.severity] || '#999' }">
          <span class="issue-severity" :style="{ color: severityColors[issue.severity] }">{{ issue.severity }}</span>
          <div>
            <div>{{ issue.description }}</div>
            <div v-if="issue.suggestedFix" style="font-size:11px;color:var(--shell-text-dim,#666);margin-top:2px"><i class="fa-solid fa-lightbulb" style="color:#d97706"></i> {{ issue.suggestedFix }}</div>
          </div>
        </div>
      </div>

      <!-- Usage -->
      <div class="card">
        <div class="card-label">Usage</div>
        <pre class="story-code">&lt;{{ activeComponent.name }}
<template v-for="p in activeComponent.props.filter((p: any) => p.required)" :key="p.name">  :{{ p.name }}="..."
</template>/&gt;</pre>
      </div>
    </div>

  </main>
</div>
</template>

<style>
:root {
  --s-bg: #fafafa; --s-surface: #fff; --s-border: #e8e8e8;
  --s-text: #1a1a1a; --s-text-dim: #555; --s-text-muted: #999;
  --s-accent: #16a34a; --s-accent-bg: rgba(22,163,74,0.08);
  --s-sidebar: #111; --s-sidebar-border: #2a2a2a;
  --s-mono: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
  --s-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --s-radius: 6px;
}
.shell.dark {
  --s-bg: #0a0a0a; --s-surface: #141414; --s-border: #2a2a2a;
  --s-text: #e5e5e5; --s-text-dim: #aaa; --s-text-muted: #666;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: var(--s-bg); }
.shell { display: flex; min-height: 100vh; font-family: var(--s-sans); font-size: 13px; color: var(--s-text); background: var(--s-bg); }

/* --- Sidebar --- */
.sb { width: 260px; flex-shrink: 0; background: var(--s-sidebar); color: #ccc; display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh; overflow-y: auto; border-right: 1px solid var(--s-sidebar-border); }
.sb-head { padding: 14px 16px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--s-sidebar-border); }
.sb-logo { font-family: var(--s-mono); font-size: 14px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 8px; }
.sb-logo i { color: var(--s-accent); }
.sb-dark { background: none; border: 1px solid #333; color: #888; width: 30px; height: 30px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 12px; }
.sb-dark:hover { border-color: #666; color: #fff; }
.sb-search { padding: 8px 12px; position: relative; }
.sb-search i { position: absolute; left: 22px; top: 50%; transform: translateY(-50%); font-size: 11px; color: #555; }
.sb-search input { width: 100%; background: #1a1a1a; border: 1px solid #333; color: #ccc; padding: 6px 8px 6px 28px; font-size: 12px; border-radius: 4px; outline: none; font-family: var(--s-sans); }
.sb-search input:focus { border-color: var(--s-accent); }
.sb-tree { flex: 1; padding: 4px 0; overflow-y: auto; }
.sb-link { display: flex; align-items: center; gap: 8px; padding: 6px 16px; color: #888; text-decoration: none; font-size: 12px; border-left: 3px solid transparent; transition: all 0.1s; cursor: pointer; }
.sb-link:hover { background: #1a1a1a; color: #ddd; }
.sb-link.on { background: var(--s-accent-bg); color: var(--s-accent); border-left-color: var(--s-accent); font-weight: 600; }
.sb-link i { width: 14px; font-size: 11px; flex-shrink: 0; }
.sb-comp-link { padding-left: 36px; font-family: var(--s-mono); font-size: 11px; }
.sb-group { margin-bottom: 2px; }
.sb-group-btn { display: flex; align-items: center; gap: 6px; width: 100%; padding: 8px 16px; background: none; border: none; color: #ccc; font-size: 12px; font-family: var(--s-sans); cursor: pointer; text-align: left; font-weight: 600; }
.sb-group-btn:hover { background: #1a1a1a; }
.sb-group-btn i:first-child { font-size: 8px; width: 10px; color: #555; }
.sb-chevron { font-size: 8px !important; width: 10px !important; color: #555 !important; }
.sb-children { padding-left: 8px; }
.sb-count { margin-left: auto; font-family: var(--s-mono); font-size: 10px; color: #555; }
.sb-icon { width: 14px; font-size: 11px; }
.sb-tier-label { padding: 8px 16px 2px 28px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #444; font-family: var(--s-mono); }
.sb-more { padding: 2px 16px 6px 36px; font-size: 10px; color: #444; font-family: var(--s-mono); }

/* --- Main --- */
.main { flex: 1; min-width: 0; }
.page { padding: 32px 40px; max-width: 960px; }
.page-title { font-size: 24px; font-weight: 800; margin-bottom: 6px; letter-spacing: -0.02em; }
.page-version { font-weight: 400; color: var(--s-text-muted); font-size: 16px; }
.page-desc { color: var(--s-text-muted); margin-bottom: 24px; }
.back-link { font-size: 11px; color: var(--s-text-muted); text-decoration: none; font-family: var(--s-mono); }
.back-link:hover { color: var(--s-accent); }

/* --- Stats --- */
.stat-row { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
.stat { background: var(--s-surface); border: 1px solid var(--s-border); border-radius: var(--s-radius); padding: 16px 20px; min-width: 120px; }
.stat-sm { padding: 10px 14px; min-width: 80px; }
.stat-val { display: block; font-family: var(--s-mono); font-size: 26px; font-weight: 700; }
.stat-sm .stat-val { font-size: 18px; }
.stat-lbl { font-size: 10px; color: var(--s-text-muted); text-transform: uppercase; letter-spacing: 0.04em; }

/* --- Cards --- */
.card { background: var(--s-surface); border: 1px solid var(--s-border); border-radius: var(--s-radius); padding: 16px 20px; }
.card-label { font-family: var(--s-mono); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--s-text-muted); margin-bottom: 12px; }

/* --- Bars --- */
.bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.bar-label { font-family: var(--s-mono); font-size: 11px; min-width: 100px; color: var(--s-text-dim); }
.bar-track { flex: 1; height: 22px; background: var(--s-border); border-radius: 3px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 3px; display: flex; align-items: center; justify-content: flex-end; padding-right: 8px; font-family: var(--s-mono); font-size: 11px; font-weight: 600; color: #fff; min-width: 28px; transition: width 0.3s; }

/* --- Pills --- */
.pill { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 4px; font-size: 12px; background: var(--s-border); font-family: var(--s-sans); }
.pill-sm { font-size: 10px; padding: 2px 8px; font-family: var(--s-mono); }

/* --- Colors --- */
.color-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 8px; }
.color-swatch { border: 1px solid var(--s-border); border-radius: var(--s-radius); overflow: hidden; background: var(--s-surface); }
.color-well { height: 56px; display: flex; align-items: center; justify-content: center; font-family: var(--s-mono); font-size: 14px; font-weight: 600; }
.color-meta { padding: 6px 8px; }
.color-name { font-family: var(--s-mono); font-size: 10px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.color-hex { font-family: var(--s-mono); font-size: 10px; color: var(--s-text-muted); }
.color-usage { font-family: var(--s-mono); font-size: 9px; color: var(--s-accent); }
.color-dot { display: inline-block; width: 12px; height: 12px; border-radius: 3px; vertical-align: middle; margin-right: 6px; border: 1px solid var(--s-border); }

/* --- Shadows --- */
.shadow-demo { width: 120px; height: 80px; background: var(--s-surface); border: 1px solid var(--s-border); border-radius: var(--s-radius); display: flex; align-items: center; justify-content: center; padding: 8px; }

/* --- Stories (CSS component previews) --- */
.story { margin-bottom: 24px; }
.story-label { font-family: var(--s-mono); font-size: 11px; font-weight: 600; color: var(--s-text-muted); margin-bottom: 8px; }
.story-preview { padding: 20px; border: 1px solid var(--s-border); border-radius: var(--s-radius); background: var(--s-surface); }
.story-code { background: #1a1a1a; color: #e5e5e5; padding: 12px 16px; border-radius: var(--s-radius); font-family: var(--s-mono); font-size: 11px; line-height: 1.6; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }

/* --- Tables --- */
.data-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.data-table th { text-align: left; padding: 6px 12px; font-family: var(--s-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--s-text-muted); border-bottom: 2px solid var(--s-border); }
.data-table td { padding: 6px 12px; border-bottom: 1px solid var(--s-border); }
.mono { font-family: var(--s-mono); }

/* --- Filters --- */
.filter-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
.filter-btn { padding: 4px 12px; border: 1px solid var(--s-border); border-radius: 4px; background: var(--s-surface); font-family: var(--s-mono); font-size: 10px; cursor: pointer; color: var(--s-text-dim); }
.filter-btn:hover { border-color: var(--s-accent); }
.filter-btn.on { background: var(--s-accent); color: #fff; border-color: var(--s-accent); }

/* --- Catalog rows --- */
.catalog-row { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border: 1px solid var(--s-border); border-radius: var(--s-radius); margin-bottom: 6px; background: var(--s-surface); transition: border-color 0.1s; }
.catalog-row:hover { border-color: var(--s-accent); }

/* --- Issues --- */
.issue-row { display: flex; gap: 8px; padding: 8px 12px; margin-bottom: 6px; border-radius: 4px; border-left: 3px solid; background: rgba(0,0,0,0.02); font-size: 12px; }
.issue-severity { font-family: var(--s-mono); font-size: 10px; font-weight: 700; text-transform: uppercase; flex-shrink: 0; padding-top: 2px; }

/* --- Responsive --- */
@media (max-width: 768px) {
  .sb { display: none; }
  .page { padding: 16px; }
}
</style>
`
}

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
