// ============================================================================
// Vue Harvest — Storybook App Generator
// Generates a Vite + Vue 3 app that renders the project's actual components
// and auto-discovered CSS component classes in a storybook-like interface.
// ============================================================================

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join, relative, resolve } from 'pathe'
import type {
  AnalyzedComponent,
  HarvestRegistry,
  DesignSystemReport,
  ComponentGraph,
  CSSComponentReport,
  CSSComponentGroup,
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
  const sectionsDir = join(srcDir, 'sections')
  const dataDir = join(srcDir, 'data')

  // Create directories
  for (const dir of [viewerDir, srcDir, sectionsDir, dataDir]) {
    mkdirSync(dir, { recursive: true })
  }

  // Write data files
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
      couplingIssues: c.couplingIssues.map(i => ({ type: i.type, description: i.description, severity: i.severity, suggestedFix: i.suggestedFix })),
      dependencies: c.dependencies.filter(d => d.kind !== 'vue-core').map(d => ({ specifier: d.specifier, kind: d.kind, imports: d.imports })),
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
      tokenizationRate: Math.round(input.designSystem.stats.tokenizationRate * 100),
      palette: input.designSystem.palette.slice(0, 40),
      typography: input.designSystem.typography,
      projectTokens: input.designSystem.projectTokens.slice(0, 50),
      googleFonts: input.designSystem.googleFonts,
    } : null,
    cssComponents: input.cssComponents || null,
  }

  writeFileSync(join(dataDir, 'analysis.json'), JSON.stringify(analysisData, null, 2))

  // Collect theme CSS (strip @import since fonts are loaded via <link> in index.html)
  if (input.designSystem?.themeCSS) {
    const cleanedCSS = input.designSystem.themeCSS.replace(/@import\s+url\([^)]+\)\s*;/g, '')
    writeFileSync(join(dataDir, 'theme.css'), cleanedCSS)
  }

  // Generate all files
  writeFileSync(join(viewerDir, 'package.json'), generatePackageJson(input.projectName))
  writeFileSync(join(viewerDir, 'vite.config.ts'), generateViteConfig(input.config))
  writeFileSync(join(viewerDir, 'index.html'), generateIndexHtml(input))
  writeFileSync(join(srcDir, 'main.ts'), generateMainTs(input))
  writeFileSync(join(srcDir, 'App.vue'), generateAppVue(input))
  writeFileSync(join(sectionsDir, 'TokensView.vue'), generateTokensView())
  writeFileSync(join(sectionsDir, 'CSSComponents.vue'), generateCSSComponentsView())
  writeFileSync(join(sectionsDir, 'VueComponents.vue'), generateVueComponentsView(input))
  writeFileSync(join(sectionsDir, 'OverviewView.vue'), generateOverviewView())
}

// ============================================================================
// File Generators
// ============================================================================

function generatePackageJson(projectName: string): string {
  return JSON.stringify({
    name: `${projectName}-storybook`,
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build',
    },
    dependencies: {
      vue: '^3.5.0',
    },
    devDependencies: {
      vite: '^6.0.0',
      '@vitejs/plugin-vue': '^5.0.0',
    },
  }, null, 2)
}

function generateViteConfig(config: HarvestConfig): string {
  // Compute relative path from viewer dir to project root
  const viewerDir = join(config.outDir, 'viewer')
  const relProjectRoot = relative(viewerDir, config.root) || '.'

  return `import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

const projectRoot = resolve(__dirname, '${relProjectRoot.replace(/\\/g, '/')}')

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '~': projectRoot,
      '@': resolve(projectRoot, 'src'),
    }
  },
  server: {
    port: 5174,
    open: true,
  },
})
`
}

function generateIndexHtml(input: StorybookInput): string {
  const googleFonts = input.designSystem?.googleFonts || []
  const fontLink = googleFonts.length > 0
    ? `\n    <link href="https://fonts.googleapis.com/css2?${googleFonts.map(f => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700;800`).join('&')}&display=swap" rel="stylesheet">`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(input.projectName)} — Vue Harvest Viewer</title>${fontLink}
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" crossorigin="anonymous">
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`
}

function generateMainTs(input: StorybookInput): string {
  return `import { createApp } from 'vue'
import App from './App.vue'
import './data/theme.css'

createApp(App).mount('#app')
`
}

function generateAppVue(input: StorybookInput): string {
  const cssGroups = input.cssComponents?.groups || []
  const hasCSSComponents = cssGroups.length > 0
  const hasTokens = !!input.designSystem
  const hasVueComponents = input.components.size > 0

  return `<script setup lang="ts">
import { ref } from 'vue'
import OverviewView from './sections/OverviewView.vue'
${hasTokens ? "import TokensView from './sections/TokensView.vue'" : ''}
${hasCSSComponents ? "import CSSComponents from './sections/CSSComponents.vue'" : ''}
${hasVueComponents ? "import VueComponents from './sections/VueComponents.vue'" : ''}

import analysisData from './data/analysis.json'

const activeSection = ref('overview')
const dark = ref(false)

function toggleDark() {
  dark.value = !dark.value
  document.documentElement.setAttribute('data-theme', dark.value ? 'dark' : '')
}

const sections = [
  { id: 'overview', label: 'Overview', icon: 'fa-solid fa-circle-info', group: 'General' },
${hasTokens ? "  { id: 'tokens', label: 'Design Tokens', icon: 'fa-solid fa-palette', group: 'Design System' }," : ''}
${hasCSSComponents ? "  { id: 'css-components', label: 'CSS Components', icon: 'fa-solid fa-swatchbook', group: 'Live Preview' }," : ''}
${hasVueComponents ? "  { id: 'vue-components', label: 'Component Catalog', icon: 'fa-solid fa-cubes', group: 'Analysis' }," : ''}
]

const groupedSections = sections.reduce((acc, s) => {
  if (!acc[s.group]) acc[s.group] = []
  acc[s.group].push(s)
  return acc
}, {} as Record<string, typeof sections>)
</script>

<template>
  <div class="app-shell" :class="{ dark }">
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-logo">
          <i class="fa-solid fa-seedling"></i>
          <span>vue-harvest</span>
        </div>
        <button class="dark-toggle" @click="toggleDark">
          <i :class="dark ? 'fa-solid fa-sun' : 'fa-solid fa-moon'"></i>
        </button>
      </div>
      <nav class="sidebar-nav">
        <div v-for="(items, group) in groupedSections" :key="group" class="nav-group">
          <div class="nav-group-label">{{ group }}</div>
          <a v-for="item in items" :key="item.id"
             href="#" class="nav-item" :class="{ active: activeSection === item.id }"
             @click.prevent="activeSection = item.id">
            <i :class="item.icon"></i>
            <span>{{ item.label }}</span>
          </a>
        </div>
      </nav>
    </aside>
    <main class="main-content">
      <OverviewView v-if="activeSection === 'overview'" :data="analysisData" />
${hasTokens ? "      <TokensView v-if=\"activeSection === 'tokens'\" :data=\"analysisData\" />" : ''}
${hasCSSComponents ? "      <CSSComponents v-if=\"activeSection === 'css-components'\" :data=\"analysisData\" />" : ''}
${hasVueComponents ? "      <VueComponents v-if=\"activeSection === 'vue-components'\" :data=\"analysisData\" />" : ''}
    </main>
  </div>
</template>

<style>
/* App shell styles — uses its own CSS vars to avoid conflict with project CSS */
* { margin: 0; padding: 0; box-sizing: border-box; }

.app-shell {
  --shell-bg: #fafafa;
  --shell-text: #1a1a1a;
  --shell-text-dim: #666;
  --shell-text-muted: #999;
  --shell-border: #e5e5e5;
  --shell-surface: #fff;
  --shell-surface-hover: #f5f5f5;
  --shell-sidebar-bg: #111;
  --shell-sidebar-text: #e5e5e5;
  --shell-sidebar-dim: #666;
  --shell-sidebar-border: #333;
  --shell-accent: #22c55e;
  --shell-accent-bg: rgba(34, 197, 94, 0.1);
  --shell-mono: 'JetBrains Mono', 'Fira Code', monospace;

  display: flex;
  min-height: 100vh;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 14px;
  color: var(--shell-text);
  background: var(--shell-bg);
}

.app-shell.dark {
  --shell-bg: #0a0a0a;
  --shell-text: #e5e5e5;
  --shell-text-dim: #999;
  --shell-text-muted: #666;
  --shell-border: #2a2a2a;
  --shell-surface: #141414;
  --shell-surface-hover: #1a1a1a;
}

.sidebar {
  width: 240px;
  flex-shrink: 0;
  background: var(--shell-sidebar-bg);
  color: var(--shell-sidebar-text);
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
}

.sidebar-header {
  padding: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--shell-sidebar-border);
}

.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
  font-family: var(--shell-mono);
}

.sidebar-logo i { color: var(--shell-accent); }

.dark-toggle {
  background: none;
  border: 1px solid #444;
  color: #aaa;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.dark-toggle:hover { border-color: #888; color: #fff; }

.sidebar-nav { padding: 8px 0; flex: 1; }

.nav-group { margin-bottom: 8px; }

.nav-group-label {
  padding: 8px 16px 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--shell-sidebar-dim);
  font-family: var(--shell-mono);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  color: #999;
  text-decoration: none;
  font-size: 13px;
  border-left: 3px solid transparent;
  transition: all 0.1s;
}
.nav-item:hover { background: #1a1a1a; color: #e5e5e5; }
.nav-item.active {
  background: var(--shell-accent-bg);
  color: var(--shell-accent);
  border-left-color: var(--shell-accent);
  font-weight: 600;
}
.nav-item i { width: 16px; font-size: 12px; }

.main-content {
  flex: 1;
  padding: 32px 40px;
  max-width: 1100px;
  background: var(--shell-bg);
}

@media (max-width: 768px) {
  .app-shell { flex-direction: column; }
  .sidebar { width: 100%; height: auto; position: relative; flex-direction: row; overflow-x: auto; }
  .sidebar-nav { display: flex; padding: 0; }
  .nav-group { display: flex; margin: 0; }
  .nav-group-label { display: none; }
  .nav-item { white-space: nowrap; border-left: none; border-bottom: 3px solid transparent; padding: 12px 16px; }
  .nav-item.active { border-bottom-color: var(--shell-accent); }
  .main-content { padding: 20px 16px; }
}

/* Section styles */
.section-title {
  font-size: 24px;
  font-weight: 800;
  margin-bottom: 8px;
  letter-spacing: -0.02em;
}
.section-desc {
  color: var(--shell-text-muted);
  margin-bottom: 24px;
  max-width: 600px;
}
.subsection { margin-bottom: 28px; }
.subsection-title {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 12px;
  padding-bottom: 6px;
  border-bottom: 2px solid var(--shell-border);
}
.sub-label {
  font-family: var(--shell-mono);
  font-size: 10px;
  color: var(--shell-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 8px;
}
.preview-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}
.preview-box {
  padding: 20px;
  border: 1px solid var(--shell-border);
  border-radius: 6px;
  margin-bottom: 12px;
  background: var(--shell-surface);
}
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}
.stat-card {
  border: 1px solid var(--shell-border);
  border-radius: 6px;
  padding: 16px;
  background: var(--shell-surface);
}
.stat-value {
  font-family: var(--shell-mono);
  font-size: 28px;
  font-weight: 700;
}
.stat-label {
  font-size: 11px;
  color: var(--shell-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.color-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 8px;
}
.color-swatch {
  border: 1px solid var(--shell-border);
  border-radius: 6px;
  overflow: hidden;
}
.color-preview {
  height: 48px;
}
.color-info {
  padding: 6px 8px;
  font-size: 10px;
  font-family: var(--shell-mono);
  background: var(--shell-surface);
}
.color-name { font-weight: 600; font-size: 11px; }
.color-hex { color: var(--shell-text-muted); }
.comp-card {
  border: 1px solid var(--shell-border);
  border-radius: 6px;
  padding: 14px;
  margin-bottom: 8px;
  background: var(--shell-surface);
}
.comp-name {
  font-family: var(--shell-mono);
  font-weight: 700;
  font-size: 13px;
}
.comp-meta {
  font-size: 11px;
  color: var(--shell-text-muted);
  font-family: var(--shell-mono);
  margin-top: 4px;
}
.error-boundary {
  border: 1px dashed #ef4444;
  border-radius: 6px;
  padding: 16px;
  color: #ef4444;
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
}
</style>
`
}

// ============================================================================
// Section Views
// ============================================================================

function generateOverviewView(): string {
  return `<script setup lang="ts">
defineProps<{ data: any }>()
</script>

<template>
  <div>
    <h1 class="section-title">{{ data.projectName }}</h1>
    <p class="section-desc">Project analysis overview — {{ data.stats.totalComponents }} components analyzed.</p>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-value">{{ data.stats.totalComponents }}</div>
        <div class="stat-label">Components</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:#22c55e">{{ data.stats.autoExtractable }}</div>
        <div class="stat-label">Extractable</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:#f59e0b">{{ data.stats.needsReview }}</div>
        <div class="stat-label">Needs Review</div>
      </div>
      <div class="stat-card" v-if="data.designSystem">
        <div class="stat-value" style="color:#3b82f6">{{ data.designSystem.projectTokenCount }}</div>
        <div class="stat-label">Design Tokens</div>
      </div>
    </div>

    <div class="subsection" v-if="data.designSystem">
      <h3 class="subsection-title">Design Token Health</h3>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-value" :style="{ color: data.designSystem.tokenizationRate >= 50 ? '#22c55e' : '#f59e0b' }">
            {{ data.designSystem.tokenizationRate }}%
          </div>
          <div class="stat-label">Tokenization Rate</div>
        </div>
        <div class="stat-card" v-if="data.designSystem.googleFonts?.length">
          <div class="stat-value" style="font-size:16px">{{ data.designSystem.googleFonts.join(', ') }}</div>
          <div class="stat-label">Google Fonts</div>
        </div>
      </div>
    </div>

    <div class="subsection" v-if="data.cssComponents">
      <h3 class="subsection-title">CSS Component System</h3>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-value">{{ data.cssComponents.totalClasses }}</div>
          <div class="stat-label">CSS Components Discovered</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="font-size:16px">{{ data.cssComponents.classPrefix || 'none' }}</div>
          <div class="stat-label">Class Prefix</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="font-size:16px">{{ data.cssComponents.namingConvention }}</div>
          <div class="stat-label">Naming Convention</div>
        </div>
      </div>
    </div>

    <div class="subsection">
      <h3 class="subsection-title">Components by Tier</h3>
      <div v-for="comp in data.components.slice(0, 30)" :key="comp.name" class="comp-card">
        <div class="comp-name">{{ comp.name }}</div>
        <div class="comp-meta">
          {{ comp.tier }} · {{ comp.confidence }}% · {{ comp.loc }} LOC · {{ comp.props.length }} props
          <span v-if="comp.couplingIssues > 0" style="color:#f59e0b"> · {{ comp.couplingIssues }} issues</span>
        </div>
      </div>
    </div>
  </div>
</template>
`
}

function generateTokensView(): string {
  return `<script setup lang="ts">
defineProps<{ data: any }>()
</script>

<template>
  <div v-if="data.designSystem">
    <h1 class="section-title">Design Tokens</h1>
    <p class="section-desc">{{ data.designSystem.projectTokenCount }} CSS custom properties defined in your project.</p>

    <div class="subsection">
      <h3 class="subsection-title">Color Palette</h3>
      <div class="color-grid">
        <div v-for="color in data.designSystem.palette" :key="color.hex" class="color-swatch">
          <div class="color-preview" :style="{ background: color.hex }"></div>
          <div class="color-info">
            <div class="color-name">{{ color.name || '' }}</div>
            <div class="color-hex">{{ color.hex }}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="subsection" v-if="data.designSystem.typography?.families?.length">
      <h3 class="subsection-title">Typography</h3>
      <div v-for="font in data.designSystem.typography.families" :key="font" class="preview-box">
        <div class="sub-label">Font Family</div>
        <div :style="{ fontFamily: font, fontSize: '20px' }">{{ font }}</div>
        <div :style="{ fontFamily: font, fontSize: '14px', color: '#666', marginTop: '4px' }">
          The quick brown fox jumps over the lazy dog. 0123456789
        </div>
      </div>
    </div>

    <div class="subsection" v-if="data.designSystem.projectTokens?.length">
      <h3 class="subsection-title">All Tokens</h3>
      <div v-for="token in data.designSystem.projectTokens" :key="token.name" class="comp-card">
        <div class="comp-name">{{ token.name }}</div>
        <div class="comp-meta">{{ token.value }} · {{ token.type }} · {{ token.usageCount }} refs</div>
      </div>
    </div>
  </div>
  <div v-else>
    <h1 class="section-title">Design Tokens</h1>
    <p class="section-desc">No design token system detected in this project.</p>
  </div>
</template>
`
}

function generateCSSComponentsView(): string {
  return `<script setup lang="ts">
defineProps<{ data: any }>()
</script>

<template>
  <div v-if="data.cssComponents?.groups?.length">
    <h1 class="section-title">CSS Components</h1>
    <p class="section-desc">
      Auto-discovered {{ data.cssComponents.totalClasses }} CSS component classes
      using the "{{ data.cssComponents.classPrefix || 'flat' }}" naming convention.
    </p>

    <div v-for="group in data.cssComponents.groups" :key="group.category" class="subsection">
      <h3 class="subsection-title">
        <i :class="group.icon" style="margin-right:6px"></i>
        {{ group.label }}
        <span style="font-weight:400;font-size:12px;color:#999"> ({{ group.components.length }})</span>
      </h3>

      <div v-for="example in group.examples" :key="example.label" style="margin-bottom:16px">
        <div class="sub-label">{{ example.label }}</div>
        <div class="preview-box" v-html="example.html"></div>
      </div>
    </div>
  </div>
  <div v-else>
    <h1 class="section-title">CSS Components</h1>
    <p class="section-desc">No shared CSS component classes were discovered. Components may use scoped styles or utility classes.</p>
  </div>
</template>
`
}

function generateVueComponentsView(_input: StorybookInput): string {
  return `<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{ data: any }>()

const search = ref('')
const tierFilter = ref('all')
const expandedComponent = ref<string | null>(null)

const tiers = computed(() => {
  const counts: Record<string, number> = {}
  for (const c of props.data.components) {
    counts[c.tier] = (counts[c.tier] || 0) + 1
  }
  return counts
})

const filtered = computed(() => {
  return props.data.components.filter((c: any) => {
    if (search.value && !c.name.toLowerCase().includes(search.value.toLowerCase())) return false
    if (tierFilter.value !== 'all' && c.tier !== tierFilter.value) return false
    return true
  })
})

function toggle(name: string) {
  expandedComponent.value = expandedComponent.value === name ? null : name
}

const tierColors: Record<string, string> = {
  primitive: '#22c55e',
  composite: '#3b82f6',
  feature: '#f59e0b',
  'page-bound': '#ef4444',
  'app-specific': '#6b7280',
}

const severityColors: Record<string, string> = {
  blocker: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
}

const depKindColors: Record<string, string> = {
  'internal-component': '#8b5cf6',
  'internal-composable': '#3b82f6',
  'internal-store': '#ef4444',
  'internal-util': '#6b7280',
  'external-package': '#22c55e',
  'provide-inject': '#f59e0b',
  'global-plugin': '#f59e0b',
}
</script>

<template>
  <div>
    <h1 class="section-title">Component Catalog</h1>
    <p class="section-desc">
      {{ props.data.components.length }} analyzed components with full API documentation — props, events, slots, dependencies, and coupling analysis.
    </p>

    <!-- Search + Filters -->
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:20px">
      <div style="position:relative;flex:1;min-width:200px;max-width:360px">
        <i class="fa-solid fa-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#999;font-size:12px"></i>
        <input v-model="search" type="text" placeholder="Search components..."
          style="width:100%;padding:8px 12px 8px 32px;border:1px solid #ddd;border-radius:6px;font-size:13px;outline:none">
      </div>
      <button v-for="(count, tier) in { all: props.data.components.length, ...tiers }" :key="tier"
        @click="tierFilter = tier as string"
        :style="{
          padding: '5px 12px', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace',
          border: tierFilter === tier ? '2px solid ' + (tierColors[tier as string] || '#333') : '1px solid #ddd',
          borderRadius: '4px', cursor: 'pointer',
          background: tierFilter === tier ? (tierColors[tier as string] || '#333') : '#fff',
          color: tierFilter === tier ? '#fff' : '#666',
        }">
        {{ tier }} ({{ count }})
      </button>
      <span style="margin-left:auto;font-size:11px;color:#999;font-family:monospace">{{ filtered.length }} shown</span>
    </div>

    <!-- Component Cards -->
    <div v-for="comp in filtered" :key="comp.name"
      style="border:1px solid #e5e5e5;border-radius:8px;margin-bottom:12px;overflow:hidden;transition:border-color 0.15s"
      :style="{ borderColor: expandedComponent === comp.name ? (tierColors[comp.tier] || '#999') : '#e5e5e5' }">

      <!-- Header (always visible) -->
      <div @click="toggle(comp.name)" style="padding:14px 18px;cursor:pointer;display:flex;align-items:center;gap:12px"
        :style="{ background: expandedComponent === comp.name ? '#fafafa' : '#fff' }">
        <i :class="expandedComponent === comp.name ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right'"
          style="font-size:10px;color:#999;width:12px"></i>
        <span style="font-family:'JetBrains Mono',monospace;font-weight:700;font-size:14px">{{ comp.name }}</span>
        <span :style="{ fontSize:'10px', fontFamily:'JetBrains Mono,monospace', padding:'2px 8px', borderRadius:'3px',
          background: tierColors[comp.tier] + '18', color: tierColors[comp.tier], fontWeight:600, textTransform:'uppercase' }">
          {{ comp.tier }}
        </span>
        <span style="font-size:11px;color:#999;font-family:monospace">{{ comp.confidence }}%</span>
        <span style="font-size:11px;color:#999;font-family:monospace">{{ comp.loc.total }} LOC</span>
        <span style="font-size:11px;color:#999;font-family:monospace">{{ comp.scriptVariant }}</span>
        <span v-if="comp.props.length" style="font-size:11px;color:#666;margin-left:auto">
          {{ comp.props.length }} props · {{ comp.emits.length }} events · {{ comp.slots.length }} slots
        </span>
        <span v-if="comp.couplingIssues.length" style="font-size:10px;color:#f59e0b;font-family:monospace">
          <i class="fa-solid fa-triangle-exclamation"></i> {{ comp.couplingIssues.length }}
        </span>
      </div>

      <!-- Expanded Details -->
      <div v-if="expandedComponent === comp.name" style="border-top:1px solid #e5e5e5;padding:18px">
        <div style="font-size:11px;color:#999;font-family:monospace;margin-bottom:16px">{{ comp.filePath }}</div>

        <!-- LOC Breakdown -->
        <div style="display:flex;gap:24px;margin-bottom:16px;font-size:12px;font-family:monospace;color:#666">
          <span><strong style="color:#333">{{ comp.loc.template }}</strong> template</span>
          <span><strong style="color:#333">{{ comp.loc.script }}</strong> script</span>
          <span><strong style="color:#333">{{ comp.loc.style }}</strong> style</span>
        </div>

        <!-- Props Table -->
        <div v-if="comp.props.length" style="margin-bottom:20px">
          <div class="sub-label">Props</div>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead>
              <tr style="border-bottom:2px solid #e5e5e5;text-align:left">
                <th style="padding:6px 12px;font-family:monospace;font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.05em">Name</th>
                <th style="padding:6px 12px;font-family:monospace;font-size:10px;color:#999;text-transform:uppercase">Type</th>
                <th style="padding:6px 12px;font-family:monospace;font-size:10px;color:#999;text-transform:uppercase">Required</th>
                <th style="padding:6px 12px;font-family:monospace;font-size:10px;color:#999;text-transform:uppercase">Default</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in comp.props" :key="p.name" style="border-bottom:1px solid #f0f0f0">
                <td style="padding:6px 12px;font-family:monospace;font-weight:600">{{ p.name }}</td>
                <td style="padding:6px 12px;font-family:monospace;color:#3b82f6">{{ p.type }}</td>
                <td style="padding:6px 12px">
                  <span v-if="p.required" style="color:#ef4444;font-size:10px;font-weight:600">REQUIRED</span>
                  <span v-else style="color:#999;font-size:10px">optional</span>
                </td>
                <td style="padding:6px 12px;font-family:monospace;color:#666;font-size:11px">{{ p.default || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Events Table -->
        <div v-if="comp.emits.length" style="margin-bottom:20px">
          <div class="sub-label">Events</div>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead>
              <tr style="border-bottom:2px solid #e5e5e5;text-align:left">
                <th style="padding:6px 12px;font-family:monospace;font-size:10px;color:#999;text-transform:uppercase">Event</th>
                <th style="padding:6px 12px;font-family:monospace;font-size:10px;color:#999;text-transform:uppercase">Payload</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in comp.emits" :key="e.name" style="border-bottom:1px solid #f0f0f0">
                <td style="padding:6px 12px;font-family:monospace;font-weight:600">@{{ e.name }}</td>
                <td style="padding:6px 12px;font-family:monospace;color:#3b82f6">{{ e.payload || 'void' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Slots Table -->
        <div v-if="comp.slots.length" style="margin-bottom:20px">
          <div class="sub-label">Slots</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            <span v-for="s in comp.slots" :key="s.name"
              style="font-family:monospace;font-size:11px;padding:3px 10px;background:#f3f0ff;color:#7c3aed;border-radius:4px">
              #{{ s.name }}
              <span v-if="s.bindings.length" style="color:#999"> ({{ s.bindings.map((b: any) => b.name).join(', ') }})</span>
            </span>
          </div>
        </div>

        <!-- Dependencies -->
        <div v-if="comp.dependencies.length" style="margin-bottom:20px">
          <div class="sub-label">Dependencies</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">
            <span v-for="d in comp.dependencies" :key="d.specifier"
              :style="{
                fontFamily: 'monospace', fontSize: '10px', padding: '2px 8px', borderRadius: '3px',
                background: (depKindColors[d.kind] || '#999') + '15',
                color: depKindColors[d.kind] || '#999',
              }">
              {{ d.imports[0] || d.specifier }}
              <span style="opacity:0.6"> {{ d.kind }}</span>
            </span>
          </div>
        </div>

        <!-- Coupling Issues -->
        <div v-if="comp.couplingIssues.length" style="margin-bottom:20px">
          <div class="sub-label">Coupling Issues</div>
          <div v-for="issue in comp.couplingIssues" :key="issue.description"
            style="padding:8px 12px;margin-bottom:6px;border-radius:4px;font-size:12px;display:flex;align-items:flex-start;gap:8px"
            :style="{ background: (severityColors[issue.severity] || '#999') + '10', borderLeft: '3px solid ' + (severityColors[issue.severity] || '#999') }">
            <span :style="{ color: severityColors[issue.severity], fontWeight:600, fontSize:'10px', fontFamily:'monospace', textTransform:'uppercase', flexShrink:0, paddingTop:'2px' }">
              {{ issue.severity }}
            </span>
            <div>
              <div style="font-weight:500">{{ issue.description }}</div>
              <div v-if="issue.suggestedFix" style="color:#666;font-size:11px;margin-top:2px">
                <i class="fa-solid fa-lightbulb" style="color:#f59e0b;margin-right:4px"></i>{{ issue.suggestedFix }}
              </div>
            </div>
          </div>
        </div>

        <!-- Peer Dependencies -->
        <div v-if="comp.peerPackages?.length" style="margin-bottom:16px">
          <div class="sub-label">External Packages</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">
            <span v-for="pkg in comp.peerPackages" :key="pkg"
              style="font-family:monospace;font-size:10px;padding:2px 8px;background:#f0fdf4;color:#22c55e;border-radius:3px">
              {{ pkg }}
            </span>
          </div>
        </div>

        <!-- Usage Example -->
        <div style="margin-bottom:8px">
          <div class="sub-label">Usage</div>
          <pre style="background:#1a1a1a;color:#e5e5e5;padding:14px;border-radius:6px;font-size:12px;line-height:1.6;overflow-x:auto;font-family:'JetBrains Mono',monospace">&lt;{{ comp.name }}
  <template v-for="p in comp.props.filter((p: any) => p.required)" :key="p.name">{{ '  :' + p.name + '="..."' }}
</template>/&gt;</pre>
        </div>
      </div>
    </div>
  </div>
</template>
`
}

// ============================================================================
// Utilities
// ============================================================================

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"')
}
