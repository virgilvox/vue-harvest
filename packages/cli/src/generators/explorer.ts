// ============================================================================
// Vue Harvest — Unified Design System & Component Explorer
// Generates a polished, storybook-style HTML page combining design tokens
// and component catalog with sidebar navigation and rich visual presentation.
// ============================================================================

import type {
  AnalyzedComponent,
  HarvestRegistry,
  DesignSystemReport,
  ComponentGraph,
  DesignToken,
} from '../types.js'

interface ExplorerInput {
  registry: HarvestRegistry
  components: Map<string, AnalyzedComponent>
  graph: ComponentGraph
  designSystem?: DesignSystemReport
  projectName: string
  projectVersion?: string
}

export function generateExplorerHTML(input: ExplorerInput): string {
  const { registry, components, graph, designSystem, projectName } = input
  const allComps = [...components.values()]
  const hasDS = !!designSystem
  const hasThemeCSS = hasDS && designSystem!.themeCSS
  const googleFonts = designSystem?.googleFonts || []

  // Scope the project's theme CSS inside .live-scope so it doesn't leak into explorer UI
  const scopedThemeCSS = hasThemeCSS ? scopeCSS(designSystem!.themeCSS!, '.live-scope') : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(projectName)} — Vue Harvest Explorer</title>
<script src="https://unpkg.com/vue@3/dist/vue.global.prod.js"><\/script>
${googleFonts.length > 0 ? `<link href="https://fonts.googleapis.com/css2?${googleFonts.map(f => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700;800`).join('&')}&display=swap" rel="stylesheet">` : ''}
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" crossorigin="anonymous">
<style>
${generateCSS()}
</style>
${scopedThemeCSS ? `<style id="project-theme">\n${scopedThemeCSS}\n</style>` : ''}
</head>
<body>
${generateMenuToggle()}
<div class="ds-overlay" onclick="toggleSidebar()"></div>
<div class="ds-layout">
  ${generateSidebar(hasDS, graph, hasThemeCSS)}
  <main class="ds-main">
    ${generateHeader(input)}
    <div class="ds-content">
      ${generateOverviewSection(registry, allComps, graph, designSystem)}
      ${hasDS ? generateColorsSection(designSystem!) : ''}
      ${hasDS ? generateTypographySection(designSystem!) : ''}
      ${hasDS ? generateSpacingSection(designSystem!) : ''}
      ${hasDS ? generateShadowsSection(designSystem!) : ''}
      ${hasThemeCSS ? generateLiveComponentsSection(designSystem!) : ''}
      ${generateComponentsSection(registry, components)}
      ${generateGraphSection(graph)}
    </div>
  </main>
</div>
<script>
${generateJS()}
</script>
</body>
</html>`
}

// ==========================================================================
// CSS
// ==========================================================================

function generateCSS(): string {
  return `
/* === RESET & TOKENS === */
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg: #fafafa;
  --bg-alt: #f0f0f0;
  --surface: #ffffff;
  --surface-hover: #f8f8f8;
  --border: #e2e2e2;
  --border-strong: #ccc;
  --text: #1a1a1a;
  --text-secondary: #555;
  --text-muted: #888;
  --accent: #0066ff;
  --accent-bg: rgba(0, 102, 255, 0.08);
  --accent-border: rgba(0, 102, 255, 0.25);
  --green: #16a34a;
  --green-bg: rgba(22, 163, 74, 0.08);
  --blue: #2563eb;
  --blue-bg: rgba(37, 99, 235, 0.08);
  --amber: #d97706;
  --amber-bg: rgba(217, 119, 6, 0.08);
  --red: #dc2626;
  --red-bg: rgba(220, 38, 38, 0.08);
  --purple: #7c3aed;
  --purple-bg: rgba(124, 58, 237, 0.08);
  --gray: #6b7280;

  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', monospace;

  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-md: 0 2px 8px rgba(0,0,0,0.08);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.1);

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;

  --sidebar-width: 260px;
  --header-height: 56px;
}

html { scroll-behavior: smooth; }

body {
  background: var(--bg);
  font-family: var(--font-sans);
  font-size: 14px;
  color: var(--text);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

/* === LAYOUT === */
.ds-layout { display: block; min-height: 100vh; }

.ds-sidebar {
  position: fixed; top: 0; left: 0; bottom: 0;
  width: var(--sidebar-width); max-width: 85vw;
  background: var(--text); color: #e5e5e5;
  border-right: 3px solid var(--accent);
  padding: 24px 16px;
  overflow-y: auto;
  z-index: 500;
  transform: translateX(-100%);
  transition: transform 0.25s ease;
}
.ds-sidebar.open { transform: translateX(0); }

.ds-overlay {
  display: none; position: fixed; inset: 0;
  background: rgba(0,0,0,0.4); z-index: 499;
}
.ds-overlay.open { display: block; }

.ds-main { margin-left: 0; min-height: 100vh; }

@media (min-width: 1100px) {
  .ds-sidebar { transform: translateX(0); }
  .ds-main { margin-left: var(--sidebar-width); }
  .ds-menu-toggle { display: none !important; }
}

/* === MENU TOGGLE === */
.ds-menu-toggle {
  display: flex; align-items: center; gap: 6px;
  position: fixed; top: 12px; left: 12px; z-index: 510;
  background: var(--text); color: #fff;
  border: 2px solid var(--accent);
  padding: 6px 12px; border-radius: var(--radius-sm);
  font-family: var(--font-mono); font-size: 12px;
  cursor: pointer; transition: background 0.15s;
}
.ds-menu-toggle:hover { background: var(--accent); }
.ds-menu-toggle svg { width: 16px; height: 16px; }

/* === SIDEBAR NAV === */
.ds-sidebar-logo {
  font-family: var(--font-mono); font-size: 15px; font-weight: 700;
  color: #fff; margin-bottom: 4px;
}
.ds-sidebar-logo span { color: var(--accent); }

.ds-sidebar-version {
  font-family: var(--font-mono); font-size: 11px;
  color: var(--accent); padding: 2px 8px;
  background: rgba(0,102,255,0.15);
  border-radius: var(--radius-sm);
  display: inline-block; margin-bottom: 24px;
}

.ds-nav-group { margin-bottom: 20px; }

.ds-nav-label {
  font-family: var(--font-mono); font-size: 10px;
  color: rgba(255,255,255,0.35); text-transform: uppercase;
  letter-spacing: 0.1em; margin-bottom: 6px; padding-left: 12px;
}

.ds-nav-link {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; color: rgba(255,255,255,0.6);
  text-decoration: none; font-size: 13px;
  border-left: 3px solid transparent;
  transition: all 0.1s; border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}
.ds-nav-link:hover { background: rgba(255,255,255,0.06); color: #fff; }
.ds-nav-link.active {
  background: rgba(0,102,255,0.15); color: #fff;
  border-left-color: var(--accent);
}
.ds-nav-link svg { width: 16px; height: 16px; flex-shrink: 0; }

/* === HEADER === */
.ds-header {
  background: var(--text); color: #fff;
  padding: 56px 32px 32px; position: relative;
  border-bottom: 3px solid var(--accent);
}
.ds-header-inner { max-width: 1200px; margin: 0 auto; }
.ds-header h1 {
  font-size: 28px; font-weight: 800; margin-bottom: 8px;
  letter-spacing: -0.02em;
}
.ds-header h1 span { color: var(--accent); }
.ds-header p { font-size: 14px; color: rgba(255,255,255,0.6); max-width: 600px; }

.ds-header-stats {
  display: flex; flex-wrap: wrap; gap: 24px; margin-top: 20px;
}
.ds-stat {
  text-align: center;
}
.ds-stat-value {
  font-family: var(--font-mono); font-size: 28px; font-weight: 700;
  color: var(--accent); display: block;
}
.ds-stat-label {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
  color: rgba(255,255,255,0.45);
}

/* === CONTENT === */
.ds-content {
  max-width: 1200px; margin: 0 auto;
  padding: 32px 24px;
}

@media (min-width: 768px) {
  .ds-header { padding: 64px 48px 40px; }
  .ds-header h1 { font-size: 36px; }
  .ds-content { padding: 40px 48px; }
}

/* === SECTIONS === */
.ds-section {
  margin-bottom: 56px;
  scroll-margin-top: 24px;
}

.ds-section-title {
  font-size: 22px; font-weight: 800;
  color: var(--text); margin-bottom: 6px;
  display: flex; align-items: center; gap: 10px;
  letter-spacing: -0.01em;
}
.ds-section-title svg { color: var(--accent); width: 22px; height: 22px; }

.ds-section-desc {
  font-size: 14px; color: var(--text-muted);
  margin-bottom: 24px; max-width: 700px;
}

.ds-subsection { margin-bottom: 28px; }

.ds-subsection-title {
  font-size: 15px; font-weight: 700; color: var(--text);
  margin-bottom: 12px; padding-bottom: 6px;
  border-bottom: 2px solid var(--border);
}

/* === DEMO BOX === */
.ds-demo {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 24px;
  box-shadow: var(--shadow-sm);
}

.ds-demo-label {
  font-family: var(--font-mono); font-size: 10px;
  color: var(--text-muted); text-transform: uppercase;
  letter-spacing: 0.06em; margin-bottom: 10px;
}

/* === GRIDS === */
.ds-grid-2 { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
.ds-grid-3 { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; }
.ds-grid-4 { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; }
.ds-grid-5 { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; }
.ds-flex { display: flex; flex-wrap: wrap; gap: 12px; }

/* === COLOR SWATCHES === */
.color-swatch {
  border: 1px solid var(--border); border-radius: var(--radius-md);
  overflow: hidden; background: var(--surface);
  transition: box-shadow 0.15s;
}
.color-swatch:hover { box-shadow: var(--shadow-md); }

.color-swatch-preview {
  aspect-ratio: 1.4; min-height: 64px;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-mono); font-size: 14px; font-weight: 600;
}

.color-swatch-info { padding: 10px 12px; border-top: 1px solid var(--border); }
.color-swatch-name { font-size: 12px; font-weight: 600; color: var(--text); }
.color-swatch-value {
  font-family: var(--font-mono); font-size: 11px;
  color: var(--text-muted); word-break: break-all;
}
.color-swatch-count {
  font-family: var(--font-mono); font-size: 10px; color: var(--accent);
}

/* === TYPOGRAPHY SAMPLES === */
.type-sample {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 20px 24px;
  margin-bottom: 12px; transition: box-shadow 0.15s;
}
.type-sample:hover { box-shadow: var(--shadow-sm); }

.type-sample-label {
  font-family: var(--font-mono); font-size: 10px;
  color: var(--text-muted); text-transform: uppercase;
  letter-spacing: 0.05em; margin-bottom: 8px;
}

.type-sample-text { margin-bottom: 8px; line-height: 1.3; }

.type-sample-meta {
  font-family: var(--font-mono); font-size: 11px;
  color: var(--text-muted); display: flex; gap: 16px;
}

/* === SPACING DEMOS === */
.space-demo {
  display: flex; align-items: center; gap: 16px;
  margin-bottom: 8px;
}
.space-demo-label {
  font-family: var(--font-mono); font-size: 12px;
  color: var(--text-muted); min-width: 80px; text-align: right;
}
.space-demo-bar {
  height: 20px; background: var(--accent);
  border-radius: 3px; transition: width 0.3s;
  min-width: 2px;
}

/* === SHADOW DEMOS === */
.shadow-demo {
  width: 100px; height: 80px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-md);
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-mono); font-size: 10px;
  color: var(--text-muted); text-align: center; padding: 8px;
}

/* === RADIUS DEMOS === */
.radius-demo {
  text-align: center;
}
.radius-demo-box {
  width: 56px; height: 56px; background: var(--accent);
  margin: 0 auto 8px; transition: border-radius 0.3s;
}
.radius-demo-label {
  font-family: var(--font-mono); font-size: 11px; color: var(--text-muted);
}

/* === OVERVIEW CARDS === */
.overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px; margin-bottom: 28px;
}
.overview-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 20px;
  transition: box-shadow 0.15s, border-color 0.15s;
}
.overview-card:hover { box-shadow: var(--shadow-md); border-color: var(--accent-border); }
.overview-card-value {
  font-family: var(--font-mono); font-size: 32px; font-weight: 700;
  display: block; margin-bottom: 4px;
}
.overview-card-label {
  font-size: 12px; color: var(--text-muted); text-transform: uppercase;
  letter-spacing: 0.04em;
}

.tier-bar {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 6px;
}
.tier-bar-label {
  font-family: var(--font-mono); font-size: 12px;
  min-width: 100px; color: var(--text-secondary);
}
.tier-bar-fill {
  height: 22px; border-radius: 3px; min-width: 2px;
  display: flex; align-items: center; justify-content: flex-end;
  padding-right: 6px; font-family: var(--font-mono);
  font-size: 11px; font-weight: 600; color: #fff;
  transition: width 0.4s ease;
}

/* === COMPONENT CATALOG === */
.catalog-controls {
  display: flex; flex-wrap: wrap; gap: 8px;
  margin-bottom: 20px; align-items: center;
}

.catalog-search {
  flex: 1; min-width: 200px; max-width: 360px;
  padding: 8px 12px 8px 36px;
  border: 1px solid var(--border); border-radius: var(--radius-md);
  font-family: var(--font-sans); font-size: 13px;
  background: var(--surface); outline: none;
  transition: border-color 0.15s;
}
.catalog-search:focus { border-color: var(--accent); }

.catalog-search-wrap {
  position: relative; flex: 1; min-width: 200px; max-width: 360px;
}
.catalog-search-wrap svg {
  position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
  width: 16px; height: 16px; color: var(--text-muted);
}

.filter-btn {
  padding: 6px 14px; border: 1px solid var(--border);
  border-radius: var(--radius-sm); background: var(--surface);
  font-family: var(--font-mono); font-size: 11px;
  color: var(--text-muted); cursor: pointer;
  transition: all 0.15s;
}
.filter-btn:hover { border-color: var(--accent); color: var(--accent); }
.filter-btn.active {
  background: var(--accent); color: #fff;
  border-color: var(--accent);
}

.catalog-count {
  font-family: var(--font-mono); font-size: 11px;
  color: var(--text-muted); margin-left: auto;
}

/* Component Cards */
.comp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 16px;
}

.comp-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-md); overflow: hidden;
  transition: box-shadow 0.15s, border-color 0.15s;
}
.comp-card:hover { box-shadow: var(--shadow-md); border-color: var(--accent-border); }

.comp-card-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 18px; border-bottom: 1px solid var(--border);
  background: var(--surface-hover);
}

.comp-card-name {
  font-family: var(--font-mono); font-size: 14px; font-weight: 700;
}

.comp-card-badge {
  font-family: var(--font-mono); font-size: 10px; font-weight: 600;
  padding: 3px 8px; border-radius: var(--radius-sm);
  text-transform: uppercase; letter-spacing: 0.03em;
}

.comp-card-body { padding: 14px 18px; }

.comp-card-meta {
  display: flex; flex-wrap: wrap; gap: 12px;
  font-family: var(--font-mono); font-size: 11px;
  color: var(--text-muted); margin-bottom: 10px;
}
.comp-card-meta .confidence {
  font-weight: 600;
}
.confidence-high { color: var(--green); }
.confidence-med { color: var(--amber); }
.confidence-low { color: var(--red); }

.comp-card-props {
  margin-top: 8px; border-top: 1px dashed var(--border); padding-top: 8px;
}

.prop-row {
  display: flex; gap: 6px; align-items: baseline;
  font-family: var(--font-mono); font-size: 11px;
  padding: 2px 0;
}
.prop-name { color: var(--text); font-weight: 600; }
.prop-type { color: var(--accent); }
.prop-required { color: var(--red); font-size: 10px; }

.comp-card-slots, .comp-card-events {
  margin-top: 6px;
  font-family: var(--font-mono); font-size: 11px;
  color: var(--text-secondary);
}
.comp-card-slots span, .comp-card-events span {
  display: inline-block; background: var(--bg-alt);
  padding: 1px 6px; border-radius: 3px; margin: 2px;
  font-size: 10px;
}

.comp-card-issues {
  margin-top: 8px; padding-top: 6px;
  border-top: 1px dashed var(--border);
  font-family: var(--font-mono); font-size: 11px;
  color: var(--amber);
}

.comp-card-path {
  font-family: var(--font-mono); font-size: 10px;
  color: var(--text-muted); margin-top: 8px;
  word-break: break-all;
}

.comp-card-deps {
  margin-top: 6px;
  font-family: var(--font-mono); font-size: 10px;
  color: var(--text-muted);
}
.comp-card-deps span {
  display: inline-block; background: var(--purple-bg);
  color: var(--purple); padding: 1px 6px;
  border-radius: 3px; margin: 2px;
}

.hide { display: none !important; }

/* === LIVE STORYBOOK === */
.sb-shell { display: flex; min-height: 500px; }
.sb-nav {
  width: 220px; flex-shrink: 0;
  border-right: 2px solid var(--border); padding: 16px 0;
  overflow-y: auto; max-height: 80vh; position: sticky; top: 0;
}
.sb-nav-header {
  padding: 0 16px 12px; border-bottom: 1px solid var(--border);
  margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;
}
.sb-nav-title { font-family: var(--font-mono); font-size: 13px; font-weight: 700; }
.sb-dark-toggle {
  padding: 4px 10px; font-size: 11px; cursor: pointer;
  font-family: var(--font-mono); background: var(--bg-alt); border: 1px solid var(--border);
  color: var(--text-secondary); border-radius: var(--radius-sm);
}
.sb-dark-toggle:hover { border-color: var(--accent); color: var(--accent); }
.sb-nav-group { margin-bottom: 4px; }
.sb-nav-group-label {
  font-family: var(--font-mono); font-size: 9px; text-transform: uppercase;
  letter-spacing: 0.12em; color: var(--text-muted); padding: 8px 16px 4px;
}
.sb-nav-item {
  display: block; padding: 6px 16px; font-size: 13px;
  color: var(--text-secondary); text-decoration: none; cursor: pointer;
  border-left: 3px solid transparent; transition: background 0.1s;
}
.sb-nav-item:hover { background: var(--bg-alt); color: var(--text); }
.sb-nav-item.active {
  background: var(--accent-bg); color: var(--accent);
  border-left-color: var(--accent); font-weight: 600;
}
.sb-main { flex: 1; padding: 32px; }
.sb-section { display: none; }
.sb-section.active { display: block; }
.sb-section-title {
  font-family: var(--font-mono); font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted);
  margin-bottom: 20px; padding-bottom: 8px; border-bottom: 2px solid var(--border);
}
.sb-subsection { margin-bottom: 28px; }
.sb-sub-label {
  font-family: var(--font-mono); font-size: 10px; color: var(--text-muted);
  margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.06em;
}
.sb-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 12px; }
.sb-col { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
.sb-card-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px; margin-bottom: 16px;
}
.sb-preview-box { padding: 24px; border: 1px solid var(--border); }
@media (max-width: 700px) {
  .sb-nav { display: none; }
  .sb-main { padding: 16px; }
}

/* === GRAPH SECTION === */
.graph-stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px; margin-bottom: 20px;
}
.graph-stat {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 16px;
}
.graph-stat-value {
  font-family: var(--font-mono); font-size: 24px; font-weight: 700;
  color: var(--accent);
}
.graph-stat-label {
  font-size: 11px; color: var(--text-muted); text-transform: uppercase;
  letter-spacing: 0.04em;
}

.cycle-warning {
  background: var(--red-bg); border: 1px solid rgba(220,38,38,0.2);
  border-radius: var(--radius-md); padding: 16px;
  font-family: var(--font-mono); font-size: 12px;
  color: var(--red); margin-bottom: 12px;
}
.cycle-warning strong { display: block; margin-bottom: 6px; font-size: 13px; }

.dep-list {
  columns: 2; column-gap: 24px;
  font-family: var(--font-mono); font-size: 12px;
  color: var(--text-secondary); list-style: none;
}
.dep-list li { padding: 3px 0; break-inside: avoid; }

@media (max-width: 600px) {
  .dep-list { columns: 1; }
  .comp-grid { grid-template-columns: 1fr; }
  .ds-header { padding: 48px 16px 24px; }
  .ds-content { padding: 24px 16px; }
}

/* === CODE BLOCKS === */
.ds-code {
  background: var(--text); border-radius: var(--radius-md);
  overflow: hidden; margin-top: 16px;
}
.ds-code-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 16px; background: rgba(255,255,255,0.06);
  border-bottom: 1px solid rgba(255,255,255,0.1);
}
.ds-code-lang {
  font-family: var(--font-mono); font-size: 11px; color: var(--accent);
}
.ds-code-copy {
  font-family: var(--font-mono); font-size: 11px;
  padding: 3px 10px; background: transparent;
  border: 1px solid rgba(255,255,255,0.25); color: rgba(255,255,255,0.7);
  border-radius: var(--radius-sm); cursor: pointer;
  transition: all 0.15s;
}
.ds-code-copy:hover { background: var(--accent); border-color: var(--accent); color: #fff; }
.ds-code pre {
  padding: 16px; color: #e5e5e5;
  font-family: var(--font-mono); font-size: 12px;
  line-height: 1.7; overflow-x: auto; white-space: pre-wrap;
}
`
}

// ==========================================================================
// ICONS (inline SVG)
// ==========================================================================

const icons = {
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
  palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="10.5" r="2.5" fill="currentColor" opacity="0.15"/><circle cx="8.5" cy="7.5" r="2.5" fill="currentColor" opacity="0.15"/><circle cx="6.5" cy="12.5" r="2.5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>',
  font: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
  spacing: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>',
  shadow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
  components: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
  graph: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M6 9v6c0 1 1 2 2 2h6M18 9v2"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
}

// ==========================================================================
// SECTIONS
// ==========================================================================

function generateMenuToggle(): string {
  return `<button class="ds-menu-toggle" onclick="toggleSidebar()">${icons.menu} Menu</button>`
}

function generateSidebar(hasDS: boolean, graph: ComponentGraph, hasThemeCSS?: boolean | string): string {
  return `
  <aside class="ds-sidebar" id="sidebar">
    <div class="ds-sidebar-logo">vue<span>-harvest</span></div>
    <span class="ds-sidebar-version">Explorer</span>
    <nav>
      <div class="ds-nav-group">
        <div class="ds-nav-label">Overview</div>
        <a href="#overview" class="ds-nav-link active" data-section="overview">${icons.overview} Overview</a>
      </div>
      ${hasDS ? `
      <div class="ds-nav-group">
        <div class="ds-nav-label">Design System</div>
        <a href="#colors" class="ds-nav-link" data-section="colors">${icons.palette} Colors</a>
        <a href="#typography" class="ds-nav-link" data-section="typography">${icons.font} Typography</a>
        <a href="#spacing" class="ds-nav-link" data-section="spacing">${icons.spacing} Spacing & Radii</a>
        <a href="#shadows" class="ds-nav-link" data-section="shadows">${icons.shadow} Shadows</a>
      </div>` : ''}
      ${hasThemeCSS ? `
      <div class="ds-nav-group">
        <div class="ds-nav-label">Live Preview</div>
        <a href="#live-components" class="ds-nav-link" data-section="live-components">${icons.components} Live Components</a>
      </div>` : ''}
      <div class="ds-nav-group">
        <div class="ds-nav-label">Components</div>
        <a href="#catalog" class="ds-nav-link" data-section="catalog">${icons.components} Component Catalog</a>
        <a href="#graph" class="ds-nav-link" data-section="graph">${icons.graph} Dependency Graph</a>
      </div>
    </nav>
  </aside>`
}

function generateHeader(input: ExplorerInput): string {
  const { projectName, projectVersion, registry, designSystem } = input

  const stats: Array<{ value: string; label: string }> = [
    { value: String(registry.stats.totalComponents), label: 'Components' },
    { value: String(registry.stats.autoExtractable), label: 'Extractable' },
  ]

  if (designSystem) {
    stats.push(
      { value: String(designSystem.stats.uniqueColors), label: 'Colors' },
      { value: String(designSystem.stats.totalTokens), label: 'Tokens' },
    )
  }

  return `
  <header class="ds-header">
    <div class="ds-header-inner">
      <h1>${esc(projectName)}${projectVersion ? ` <span>v${esc(projectVersion)}</span>` : ''}</h1>
      <p>Design system and component explorer generated by Vue Harvest. Analyzes your Vue components, extracts design tokens, and maps dependency relationships.</p>
      <div class="ds-header-stats">
        ${stats.map(s => `
          <div class="ds-stat">
            <span class="ds-stat-value">${s.value}</span>
            <span class="ds-stat-label">${s.label}</span>
          </div>
        `).join('')}
      </div>
    </div>
  </header>`
}

function generateOverviewSection(
  registry: HarvestRegistry,
  allComps: AnalyzedComponent[],
  graph: ComponentGraph,
  designSystem?: DesignSystemReport
): string {
  const tiers: Record<string, number> = {}
  allComps.forEach(c => { tiers[c.tier] = (tiers[c.tier] || 0) + 1 })

  const maxTier = Math.max(...Object.values(tiers), 1)
  const tierColors: Record<string, string> = {
    primitive: 'var(--green)',
    composite: 'var(--blue)',
    feature: 'var(--amber)',
    'page-bound': 'var(--red)',
    'app-specific': 'var(--gray)',
  }
  const tierLabels: Record<string, string> = {
    primitive: 'Primitive',
    composite: 'Composite',
    feature: 'Feature',
    'page-bound': 'Page-Bound',
    'app-specific': 'App-Specific',
  }

  const couplingCounts: Record<string, number> = {}
  allComps.forEach(c => c.couplingIssues.forEach(i => {
    couplingCounts[i.type] = (couplingCounts[i.type] || 0) + 1
  }))

  return `
  <section id="overview" class="ds-section">
    <h2 class="ds-section-title">${icons.overview} Overview</h2>
    <p class="ds-section-desc">High-level summary of the analyzed project — component classification, dependency graph shape, and coupling health.</p>

    <div class="overview-grid">
      <div class="overview-card">
        <span class="overview-card-value" style="color:var(--text)">${registry.stats.totalComponents}</span>
        <span class="overview-card-label">Total Components</span>
      </div>
      <div class="overview-card">
        <span class="overview-card-value" style="color:var(--green)">${registry.stats.autoExtractable}</span>
        <span class="overview-card-label">Auto-Extractable</span>
      </div>
      <div class="overview-card">
        <span class="overview-card-value" style="color:var(--amber)">${registry.stats.needsReview}</span>
        <span class="overview-card-label">Needs Review</span>
      </div>
      <div class="overview-card">
        <span class="overview-card-value" style="color:${graph.cycles.length > 0 ? 'var(--red)' : 'var(--green)'}">${graph.cycles.length}</span>
        <span class="overview-card-label">Circular Deps</span>
      </div>
    </div>

    <div class="ds-subsection">
      <h3 class="ds-subsection-title">Components by Tier</h3>
      <div class="ds-demo">
        ${Object.entries(tierLabels).map(([tier, label]) => {
          const count = tiers[tier] || 0
          if (count === 0) return ''
          const pct = Math.round((count / maxTier) * 100)
          return `
          <div class="tier-bar">
            <span class="tier-bar-label">${label}</span>
            <div class="tier-bar-fill" style="width:${Math.max(pct, 8)}%;background:${tierColors[tier]}">${count}</div>
          </div>`
        }).join('')}
      </div>
    </div>

    ${Object.keys(couplingCounts).length > 0 ? `
    <div class="ds-subsection">
      <h3 class="ds-subsection-title">Coupling Issues</h3>
      <div class="ds-demo">
        ${Object.entries(couplingCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([type, count]) => `
          <div class="tier-bar">
            <span class="tier-bar-label" style="min-width:160px">${type}</span>
            <div class="tier-bar-fill" style="width:${Math.max(Math.round((count / Math.max(...Object.values(couplingCounts))) * 100), 8)}%;background:var(--amber)">${count}</div>
          </div>
        `).join('')}
      </div>
    </div>` : ''}

    ${designSystem ? `
    <div class="ds-subsection">
      <h3 class="ds-subsection-title">Design Token Health</h3>
      <div class="overview-grid">
        <div class="overview-card">
          <span class="overview-card-value" style="color:var(--accent)">${designSystem.stats.projectTokenCount}</span>
          <span class="overview-card-label">Design Tokens Defined</span>
        </div>
        <div class="overview-card">
          <span class="overview-card-value" style="color:var(--green)">${designSystem.stats.varReferenceCount.toLocaleString()}</span>
          <span class="overview-card-label">Token References</span>
        </div>
        <div class="overview-card">
          <span class="overview-card-value" style="color:${designSystem.stats.tokenizationRate >= 0.5 ? 'var(--green)' : 'var(--amber)'}">${Math.round(designSystem.stats.tokenizationRate * 100)}%</span>
          <span class="overview-card-label">Tokenization Rate</span>
        </div>
        <div class="overview-card">
          <span class="overview-card-value" style="color:var(--amber)">${designSystem.stats.hardcodedCount.toLocaleString()}</span>
          <span class="overview-card-label">Hardcoded Values</span>
        </div>
      </div>
      ${designSystem.googleFonts.length > 0 ? `
      <div style="margin-top:12px;font-family:var(--font-mono);font-size:12px;color:var(--text-secondary)">
        Google Fonts loaded: ${designSystem.googleFonts.map(f => `<strong>${esc(f)}</strong>`).join(', ')}
      </div>` : ''}
    </div>` : ''}
  </section>`
}

// --- Design System Sections ---

function generateColorsSection(ds: DesignSystemReport): string {
  if (ds.palette.length === 0) return ''

  // Separate project tokens from hardcoded colors
  const tokenColors = ds.palette.filter(c => c.name).slice(0, 60)
  const hardcodedColors = ds.palette.filter(c => !c.name).slice(0, 20)

  return `
  <section id="colors" class="ds-section">
    <h2 class="ds-section-title">${icons.palette} Colors</h2>
    <p class="ds-section-desc">Your project defines ${tokenColors.length} color tokens as CSS custom properties. ${hardcodedColors.length > 0 ? `${hardcodedColors.length} additional hardcoded values were found.` : 'All color usage goes through tokens.'}</p>

    <div class="ds-subsection">
      <h3 class="ds-subsection-title">Design Tokens</h3>
      <div class="ds-grid-5">
        ${tokenColors.map(c => {
          const lum = hexLuminance(c.hex)
          const textColor = lum > 0.5 ? '#1a1a1a' : '#ffffff'
          return `
          <div class="color-swatch">
            <div class="color-swatch-preview" style="background:${escAttr(c.hex)};color:${textColor}">Aa</div>
            <div class="color-swatch-info">
              <div class="color-swatch-name">${escHtml(c.name || '')}</div>
              <div class="color-swatch-value">${escHtml(c.hex)}</div>
              <div class="color-swatch-count">${c.usageCount}x referenced</div>
            </div>
          </div>`
        }).join('')}
      </div>
    </div>

    ${hardcodedColors.length > 0 ? `
    <div class="ds-subsection">
      <h3 class="ds-subsection-title">Hardcoded Values <span style="font-weight:400;font-size:12px;color:var(--text-muted)">(not using tokens)</span></h3>
      <div class="ds-grid-5">
        ${hardcodedColors.map(c => {
          const lum = hexLuminance(c.hex)
          const textColor = lum > 0.5 ? '#1a1a1a' : '#ffffff'
          return `
          <div class="color-swatch" style="border-color:var(--amber);border-style:dashed">
            <div class="color-swatch-preview" style="background:${escAttr(c.hex)};color:${textColor}">Aa</div>
            <div class="color-swatch-info">
              <div class="color-swatch-value">${escHtml(c.hex)}</div>
              <div class="color-swatch-count" style="color:var(--amber)">${c.usageCount}x hardcoded</div>
            </div>
          </div>`
        }).join('')}
      </div>
    </div>` : ''}

    <div class="ds-code">
      <div class="ds-code-header">
        <span class="ds-code-lang">Project Color Tokens</span>
        <button class="ds-code-copy" onclick="copyCode(this)">Copy</button>
      </div>
      <pre>${tokenColors.slice(0, 25).map(c =>
        `${escHtml(c.name || '')}: ${escHtml(c.hex)};  /* ${c.usageCount}x */`
      ).join('\n')}</pre>
    </div>
  </section>`
}

function generateTypographySection(ds: DesignSystemReport): string {
  const { families, sizes, weights } = ds.typography
  if (families.length === 0 && sizes.length === 0) return ''

  return `
  <section id="typography" class="ds-section">
    <h2 class="ds-section-title">${icons.font} Typography</h2>
    <p class="ds-section-desc">Font families, sizes, and weights extracted from component stylesheets. Sizes are rendered at their actual values.</p>

    ${families.length > 0 ? `
    <div class="ds-subsection">
      <h3 class="ds-subsection-title">Font Families</h3>
      ${families.map(f => `
        <div class="type-sample">
          <div class="type-sample-label">Font Family</div>
          <div class="type-sample-text" style="font-family:${escAttr(f)};font-size:20px">${escHtml(f)}</div>
          <div class="type-sample-text" style="font-family:${escAttr(f)};font-size:14px;color:var(--text-secondary)">The quick brown fox jumps over the lazy dog. 0123456789</div>
          <div class="type-sample-meta"><span>${escHtml(f)}</span></div>
        </div>
      `).join('')}
    </div>` : ''}

    ${sizes.length > 0 ? `
    <div class="ds-subsection">
      <h3 class="ds-subsection-title">Type Scale</h3>
      <div class="ds-demo">
        ${sizes.slice(0, 20).map(s => `
          <div style="font-size:${escAttr(s)};margin-bottom:6px;line-height:1.3;display:flex;align-items:baseline;gap:12px">
            <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);min-width:60px">${escHtml(s)}</span>
            <span>The quick brown fox</span>
          </div>
        `).join('')}
        ${sizes.length > 20 ? `<p style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);margin-top:8px">+ ${sizes.length - 20} more sizes</p>` : ''}
      </div>
    </div>` : ''}

    ${weights.length > 0 ? `
    <div class="ds-subsection">
      <h3 class="ds-subsection-title">Font Weights</h3>
      <div class="ds-demo">
        ${weights.map(w => `
          <div style="font-weight:${escAttr(w)};font-size:18px;margin-bottom:8px;display:flex;align-items:baseline;gap:12px">
            <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);min-width:60px">${escHtml(w)}</span>
            <span>The quick brown fox jumps</span>
          </div>
        `).join('')}
      </div>
    </div>` : ''}
  </section>`
}

function generateSpacingSection(ds: DesignSystemReport): string {
  if (ds.spacing.length === 0 && ds.radii.length === 0) return ''

  return `
  <section id="spacing" class="ds-section">
    <h2 class="ds-section-title">${icons.spacing} Spacing & Radii</h2>
    <p class="ds-section-desc">Spacing values and border radii extracted from component styles. The bars visualize relative scale.</p>

    ${ds.spacing.length > 0 ? `
    <div class="ds-subsection">
      <h3 class="ds-subsection-title">Spacing Scale</h3>
      <div class="ds-demo">
        ${ds.spacing.slice(0, 24).map(s => `
          <div class="space-demo">
            <div class="space-demo-label">${escHtml(s)}</div>
            <div class="space-demo-bar" style="width:min(${escAttr(s)}, 400px)"></div>
          </div>
        `).join('')}
        ${ds.spacing.length > 24 ? `<p style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);margin-top:8px">+ ${ds.spacing.length - 24} more values</p>` : ''}
      </div>
    </div>` : ''}

    ${ds.radii.length > 0 ? `
    <div class="ds-subsection">
      <h3 class="ds-subsection-title">Border Radii</h3>
      <div class="ds-demo">
        <div class="ds-flex">
          ${ds.radii.map(r => `
            <div class="radius-demo">
              <div class="radius-demo-box" style="border-radius:${escAttr(r)}"></div>
              <div class="radius-demo-label">${escHtml(r)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>` : ''}
  </section>`
}

function generateShadowsSection(ds: DesignSystemReport): string {
  if (ds.shadows.length === 0) return ''

  return `
  <section id="shadows" class="ds-section">
    <h2 class="ds-section-title">${icons.shadow} Shadows</h2>
    <p class="ds-section-desc">Box shadows extracted from component styles — ${ds.shadows.length} unique values.</p>

    <div class="ds-demo">
      <div class="ds-flex">
        ${ds.shadows.slice(0, 16).map(s => `
          <div class="shadow-demo" style="box-shadow:${escAttr(s)}">${escHtml(s.length > 30 ? s.substring(0, 28) + '...' : s)}</div>
        `).join('')}
      </div>
    </div>

    <div class="ds-code">
      <div class="ds-code-header">
        <span class="ds-code-lang">CSS Shadows</span>
        <button class="ds-code-copy" onclick="copyCode(this)">Copy</button>
      </div>
      <pre>${ds.shadows.slice(0, 12).map((s, i) =>
        `--shadow-${i + 1}: ${escHtml(s)};`
      ).join('\n')}</pre>
    </div>
  </section>`
}

// --- Live Component Rendering ---

function generateLiveComponentsSection(ds: DesignSystemReport): string {
  if (!ds.themeCSS) return ''

  return `
  <section id="live-components" class="ds-section">
    <h2 class="ds-section-title">${icons.components} Live Components</h2>
    <p class="ds-section-desc">Vue-powered storybook rendering every component with your project's actual design tokens and CSS. Toggle dark mode to see theme adaptation.</p>

    <div id="storybook-app" class="live-scope" style="border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;margin-top:16px">
      ${generateStorybookTemplate()}
    </div>

    <script>
    (function() {
      if (typeof Vue === 'undefined') return;
      var app = Vue.createApp({
        setup() {
          var active = Vue.ref('buttons');
          var dark = Vue.ref(false);
          var navGroups = ${JSON.stringify(getStorybookNavGroups())};
          function toggleDark() {
            dark.value = !dark.value;
            document.getElementById('storybook-app').setAttribute('data-theme', dark.value ? 'dark' : '');
          }
          return { active: active, dark: dark, navGroups: navGroups, toggleDark: toggleDark };
        }
      });
      app.mount('#storybook-app');
    })();
    </script>
  </section>`
}

/** Clean project CSS for embedding — strip @layer wrappers and @import, remap :root to .live-scope */
function scopeCSS(css: string, scope: string): string {
  let clean = css
  // Strip @import (loaded via <link> instead)
  clean = clean.replace(/@import\s+url\([^)]+\)\s*;/g, '')

  // Strip @layer wrappers properly by tracking brace depth
  let result = ''
  let i = 0
  while (i < clean.length) {
    const layerMatch = clean.slice(i).match(/^@layer\s+[\w-]+\s*\{/)
    if (layerMatch) {
      // Skip the @layer opening, find its matching close brace
      i += layerMatch[0].length
      let depth = 1
      const start = i
      while (i < clean.length && depth > 0) {
        if (clean[i] === '{') depth++
        else if (clean[i] === '}') depth--
        if (depth > 0) i++
        else {
          // Emit inner content without the final }
          result += clean.slice(start, i)
          i++ // skip the closing }
        }
      }
    } else {
      result += clean[i]
      i++
    }
  }
  clean = result

  // Remap :root to .live-scope so token variables apply inside our container
  clean = clean.replace(/(?:^|\n):root\s*\{/g, '\n' + scope + ' {')
  // Remap [data-theme="dark"] to .live-scope[data-theme="dark"]
  clean = clean.replace(/\[data-theme=['"]dark['"]\]\s*\{/g, scope + '[data-theme="dark"] {')
  // Remap body { to .live-scope {
  clean = clean.replace(/(?:^|\n)body\s*\{/g, '\n' + scope + ' {')
  return clean
}

function getStorybookNavGroups() {
  return [
    { label: 'Actions', items: [
      { id: 'buttons', label: 'Buttons', icon: 'fa-solid fa-hand-pointer' },
      { id: 'tags', label: 'Tags & Badges', icon: 'fa-solid fa-tags' },
    ]},
    { label: 'Forms', items: [
      { id: 'forms', label: 'Form Controls', icon: 'fa-solid fa-keyboard' },
    ]},
    { label: 'Layout', items: [
      { id: 'cards', label: 'Cards', icon: 'fa-solid fa-rectangle-list' },
      { id: 'navigation', label: 'Navigation', icon: 'fa-solid fa-bars' },
      { id: 'layout', label: 'Layout & Sections', icon: 'fa-solid fa-table-columns' },
    ]},
    { label: 'Content', items: [
      { id: 'prose', label: 'Prose / Article', icon: 'fa-solid fa-book-open' },
      { id: 'prose-blocks', label: 'Content Blocks', icon: 'fa-solid fa-puzzle-piece' },
      { id: 'content-types', label: 'Content Types', icon: 'fa-solid fa-shapes' },
    ]},
    { label: 'Editor', items: [
      { id: 'editor-panels', label: 'Editor Panels', icon: 'fa-solid fa-sliders' },
      { id: 'editor-blocks', label: 'Block Library', icon: 'fa-solid fa-cubes' },
    ]},
    { label: 'Feedback', items: [
      { id: 'states', label: 'States', icon: 'fa-solid fa-spinner' },
    ]},
  ]
}


function generateStorybookTemplate(): string {
  return `
  <div class="sb-shell">
    <nav class="sb-nav">
      <div class="sb-nav-header">
        <span class="sb-nav-title"><i class="fa-solid fa-palette"></i> Storybook</span>
        <button class="sb-dark-toggle" @click="toggleDark">{{ dark ? 'Light' : 'Dark' }}</button>
      </div>
      <div class="sb-nav-group" v-for="group in navGroups" :key="group.label">
        <div class="sb-nav-group-label">{{ group.label }}</div>
        <a v-for="item in group.items" :key="item.id"
           class="sb-nav-item" :class="{ active: active === item.id }"
           @click.prevent="active = item.id" href="#">
          <i :class="item.icon" style="width:16px;margin-right:6px;font-size:11px"></i>{{ item.label }}
        </a>
      </div>
    </nav>
    <main class="sb-main">

      <!-- BUTTONS -->
      <section class="sb-section" :class="{ active: active === 'buttons' }">
        <div class="sb-section-title"><i class="fa-solid fa-hand-pointer"></i> Buttons</div>
        <div class="sb-subsection">
          <div class="sb-sub-label">Variants</div>
          <div class="sb-row">
            <button class="cpub-btn">Default</button>
            <button class="cpub-btn cpub-btn-primary"><i class="fa-solid fa-rocket"></i> Primary</button>
            <button class="cpub-btn cpub-btn-ghost"><i class="fa-solid fa-bookmark"></i> Ghost</button>
            <button class="cpub-btn" disabled>Disabled</button>
          </div>
        </div>
        <div class="sb-subsection">
          <div class="sb-sub-label">Sizes</div>
          <div class="sb-row">
            <button class="cpub-btn cpub-btn-sm">Small</button>
            <button class="cpub-btn">Default</button>
            <button class="cpub-btn cpub-btn-lg">Large</button>
          </div>
        </div>
        <div class="sb-subsection">
          <div class="sb-sub-label">Primary Sizes</div>
          <div class="sb-row">
            <button class="cpub-btn cpub-btn-primary cpub-btn-sm"><i class="fa-solid fa-plus"></i> Small</button>
            <button class="cpub-btn cpub-btn-primary">Default</button>
            <button class="cpub-btn cpub-btn-primary cpub-btn-lg"><i class="fa-solid fa-save"></i> Large</button>
          </div>
        </div>
        <div class="sb-subsection">
          <div class="sb-sub-label">Delete / Danger</div>
          <div class="sb-row">
            <button class="cpub-delete-btn"><i class="fa-solid fa-trash"></i> Delete</button>
            <button class="cpub-delete-btn cpub-delete-btn-sm"><i class="fa-solid fa-xmark"></i></button>
          </div>
        </div>
      </section>

      <!-- TAGS & BADGES -->
      <section class="sb-section" :class="{ active: active === 'tags' }">
        <div class="sb-section-title"><i class="fa-solid fa-tags"></i> Tags & Badges</div>
        <div class="sb-subsection">
          <div class="sb-sub-label">Tags</div>
          <div class="cpub-tag-row" style="margin-bottom:16px">
            <span class="cpub-tag">Default</span>
            <span class="cpub-tag cpub-tag-accent"><i class="fa-solid fa-star"></i> Accent</span>
            <span class="cpub-tag cpub-tag-green"><i class="fa-solid fa-check"></i> Success</span>
            <span class="cpub-tag cpub-tag-red"><i class="fa-solid fa-xmark"></i> Error</span>
            <span class="cpub-tag cpub-tag-yellow"><i class="fa-solid fa-bolt"></i> Warning</span>
            <span class="cpub-tag cpub-tag-purple"><i class="fa-solid fa-crown"></i> Purple</span>
            <span class="cpub-tag cpub-tag-teal"><i class="fa-solid fa-microchip"></i> Teal</span>
          </div>
        </div>
        <div class="sb-subsection">
          <div class="sb-sub-label">Badges</div>
          <div class="sb-row">
            <span class="cpub-badge">DEFAULT</span>
            <span class="cpub-badge cpub-badge-accent"><i class="fa-solid fa-star"></i> FEATURED</span>
            <span class="cpub-badge cpub-badge-green"><i class="fa-solid fa-check"></i> PUBLISHED</span>
            <span class="cpub-badge cpub-badge-red">DRAFT</span>
            <span class="cpub-badge cpub-badge-yellow"><i class="fa-solid fa-bolt"></i> WIP</span>
            <span class="cpub-badge cpub-badge-purple"><i class="fa-solid fa-crown"></i> PRO</span>
            <span class="cpub-badge cpub-badge-teal"><i class="fa-solid fa-microchip"></i> ESP32</span>
            <span class="cpub-badge cpub-badge-pink"><i class="fa-solid fa-heart"></i> POPULAR</span>
          </div>
        </div>
        <div class="sb-subsection">
          <div class="sb-sub-label">Content Type Badges</div>
          <div class="sb-row">
            <span data-content-type="article" class="cpub-badge" style="background:var(--badge-bg);color:var(--badge-color);border-color:var(--badge-color)">ARTICLE</span>
            <span data-content-type="blog" class="cpub-badge" style="background:var(--badge-bg);color:var(--badge-color);border-color:var(--badge-color)">BLOG</span>
            <span data-content-type="project" class="cpub-badge" style="background:var(--badge-bg);color:var(--badge-color);border-color:var(--badge-color)">PROJECT</span>
            <span data-content-type="explainer" class="cpub-badge" style="background:var(--badge-bg);color:var(--badge-color);border-color:var(--badge-color)">EXPLAINER</span>
            <span data-content-type="video" class="cpub-badge" style="background:var(--badge-bg);color:var(--badge-color);border-color:var(--badge-color)">VIDEO</span>
            <span data-content-type="tutorial" class="cpub-badge" style="background:var(--badge-bg);color:var(--badge-color);border-color:var(--badge-color)">TUTORIAL</span>
          </div>
        </div>
      </section>

      <!-- FORMS -->
      <section class="sb-section" :class="{ active: active === 'forms' }">
        <div class="sb-section-title"><i class="fa-solid fa-keyboard"></i> Forms</div>
        <div style="max-width:440px">
          <div class="sb-subsection">
            <div class="sb-sub-label">Text Input</div>
            <div class="cpub-form-group"><label class="cpub-form-label">Project Name</label><input class="cpub-input" type="text" placeholder="Enter project name..."><span class="cpub-form-hint">Choose a unique name for your project</span></div>
            <div class="cpub-form-group"><label class="cpub-form-label">Email</label><input class="cpub-input" type="email" placeholder="you@example.com"><span class="cpub-form-error"><i class="fa-solid fa-triangle-exclamation"></i> Invalid email format</span></div>
          </div>
          <div class="sb-subsection">
            <div class="sb-sub-label">Input Sizes</div>
            <div class="sb-col"><input class="cpub-input cpub-input-sm" type="text" placeholder="Small input"><input class="cpub-input" type="text" placeholder="Default input"><input class="cpub-input cpub-input-lg" type="text" placeholder="Large input"></div>
          </div>
          <div class="sb-subsection">
            <div class="sb-sub-label">Select</div>
            <div class="cpub-form-group"><label class="cpub-form-label">Category</label><select class="cpub-select"><option>Select category...</option><option>Robotics</option><option>IoT</option><option>3D Printing</option></select></div>
          </div>
          <div class="sb-subsection">
            <div class="sb-sub-label">Textarea</div>
            <div class="cpub-form-group"><label class="cpub-form-label">Description</label><textarea class="cpub-textarea" placeholder="Describe your project..." rows="3"></textarea></div>
          </div>
          <div class="sb-subsection">
            <div class="sb-sub-label">Checkboxes &amp; Radios</div>
            <div class="sb-col"><label class="cpub-checkbox"><input type="checkbox" checked> Published</label><label class="cpub-checkbox"><input type="checkbox"> Featured</label><label class="cpub-checkbox"><input type="checkbox" disabled> Archived (disabled)</label></div>
            <div class="sb-col" style="margin-top:12px"><label class="cpub-radio"><input type="radio" name="vis" checked> Public</label><label class="cpub-radio"><input type="radio" name="vis"> Unlisted</label><label class="cpub-radio"><input type="radio" name="vis"> Private</label></div>
          </div>
        </div>
      </section>

      <!-- CARDS -->
      <section class="sb-section" :class="{ active: active === 'cards' }">
        <div class="sb-section-title"><i class="fa-solid fa-rectangle-list"></i> Cards</div>
        <div class="sb-subsection">
          <div class="sb-sub-label">Base Card</div>
          <div class="sb-card-grid">
            <div class="cpub-card"><div class="cpub-card-body"><div style="font-weight:600;margin-bottom:6px">Card Title</div><div style="font-size:13px;color:var(--text-dim)">Basic card with body content. Hover to see lift + shadow effect.</div></div></div>
            <div class="cpub-card"><div class="cpub-card-body"><div class="cpub-badge cpub-badge-accent" style="margin-bottom:8px">FEATURED</div><div style="font-weight:600;margin-bottom:6px">Featured Project</div><div style="font-size:13px;color:var(--text-dim)">Card with badge and hover interaction.</div><div style="margin-top:12px;display:flex;gap:8px"><span class="cpub-tag cpub-tag-teal">ESP32</span><span class="cpub-tag">Robotics</span></div></div></div>
          </div>
        </div>
        <div class="sb-subsection">
          <div class="sb-sub-label">Sidebar Card</div>
          <div style="max-width:300px">
            <div class="cpub-sb-card"><div class="cpub-sb-title"><i class="fa-solid fa-fire"></i> Trending Topics</div><div style="display:flex;flex-direction:column;gap:8px"><a href="#" class="cpub-link" style="font-size:13px" onclick="return false">Getting Started with ESP32</a><a href="#" class="cpub-link" style="font-size:13px" onclick="return false">3D Printing Best Practices</a><a href="#" class="cpub-link" style="font-size:13px" onclick="return false">MQTT Protocol Guide</a></div></div>
          </div>
        </div>
      </section>

      <!-- NAVIGATION -->
      <section class="sb-section" :class="{ active: active === 'navigation' }">
        <div class="sb-section-title"><i class="fa-solid fa-bars"></i> Navigation</div>
        <div class="sb-subsection">
          <div class="sb-sub-label">Tab Bar</div>
          <div class="cpub-tab-bar" style="position:static"><button class="cpub-tab active"><i class="fa-solid fa-fire"></i> Trending</button><button class="cpub-tab">Recent</button><button class="cpub-tab">Featured</button><button class="cpub-tab">Following</button></div>
        </div>
        <div class="sb-subsection">
          <div class="sb-sub-label">Filter Chips</div>
          <div class="cpub-filter-bar"><button class="cpub-filter-chip active">All</button><button class="cpub-filter-chip">Articles</button><button class="cpub-filter-chip">Projects</button><button class="cpub-filter-chip">Tutorials</button><button class="cpub-filter-chip">Videos</button></div>
        </div>
        <div class="sb-subsection">
          <div class="sb-sub-label">Pagination</div>
          <div class="cpub-pagination"><button class="cpub-page-btn" disabled><i class="fa-solid fa-chevron-left"></i></button><button class="cpub-page-btn active">1</button><button class="cpub-page-btn">2</button><button class="cpub-page-btn">3</button><span class="cpub-page-ellipsis">...</span><button class="cpub-page-btn">12</button><button class="cpub-page-btn"><i class="fa-solid fa-chevron-right"></i></button></div>
        </div>
        <div class="sb-subsection">
          <div class="sb-sub-label">Links</div>
          <div class="sb-col"><a href="#" class="cpub-back-link" onclick="return false"><i class="fa-solid fa-arrow-left"></i> Back to projects</a><a href="#" class="cpub-link" onclick="return false">Standard link</a><a href="#" class="cpub-view-all" onclick="return false">View all <i class="fa-solid fa-arrow-right"></i></a></div>
        </div>
      </section>

      <!-- LAYOUT -->
      <section class="sb-section" :class="{ active: active === 'layout' }">
        <div class="sb-section-title"><i class="fa-solid fa-table-columns"></i> Layout &amp; Sections</div>
        <div class="sb-subsection">
          <div class="sb-sub-label">Section Headers</div>
          <div class="cpub-section-header" style="margin-bottom:16px"><span class="cpub-section-title" style="margin-bottom:0">RECENT PROJECTS</span><a href="#" class="cpub-view-all" onclick="return false">View all</a></div>
          <div class="cpub-section-title-lg" style="margin-bottom:16px">Large Section Title</div>
          <div class="cpub-section-head" style="margin-bottom:16px"><h2>Section Head</h2><div class="cpub-sec-head-right"><span class="cpub-sec-sub">12 items</span><button class="cpub-btn cpub-btn-sm">View All</button></div></div>
          <div class="cpub-hero-eyebrow">EYEBROW LABEL</div>
        </div>
        <div class="sb-subsection">
          <div class="sb-sub-label">Hero Section</div>
          <div class="cpub-hero" style="border:none"><div class="cpub-hero-title">Build Something Awesome</div><div class="cpub-hero-subtitle">Share your maker projects with the community. Learn, build, and collaborate.</div><div class="cpub-hero-actions"><button class="cpub-btn cpub-btn-primary"><i class="fa-solid fa-plus"></i> New Project</button><button class="cpub-btn">Explore</button></div></div>
        </div>
        <div class="sb-subsection">
          <div class="sb-sub-label">Stat Bar</div>
          <div class="cpub-stat-bar"><div class="cpub-stat-bar-item"><span class="cpub-stat-bar-value">2.4k</span><span class="cpub-stat-bar-label">Projects</span></div><div class="cpub-stat-bar-item"><span class="cpub-stat-bar-value">12.1k</span><span class="cpub-stat-bar-label">Members</span></div><div class="cpub-stat-bar-item"><span class="cpub-stat-bar-value">847</span><span class="cpub-stat-bar-label">Active</span></div></div>
        </div>
        <div class="sb-subsection">
          <div class="sb-sub-label">Toolbar</div>
          <div class="cpub-toolbar"><button class="cpub-btn cpub-btn-sm"><i class="fa-solid fa-bold"></i></button><button class="cpub-btn cpub-btn-sm"><i class="fa-solid fa-italic"></i></button><button class="cpub-btn cpub-btn-sm"><i class="fa-solid fa-link"></i></button><button class="cpub-btn cpub-btn-sm"><i class="fa-solid fa-image"></i></button><button class="cpub-btn cpub-btn-sm"><i class="fa-solid fa-code"></i></button></div>
        </div>
        <div class="sb-subsection">
          <div class="sb-sub-label">Sidebar</div>
          <div style="max-width:280px"><div class="cpub-sidebar-section"><div class="cpub-sidebar-heading">RELATED PROJECTS</div><div style="display:flex;flex-direction:column;gap:8px"><a href="#" class="cpub-link" style="font-size:13px" onclick="return false">Kiwi Robot v2</a><a href="#" class="cpub-link" style="font-size:13px" onclick="return false">Solar Weather Station</a></div></div></div>
        </div>
      </section>

      <!-- PROSE -->
      <section class="sb-section" :class="{ active: active === 'prose' }">
        <div class="sb-section-title"><i class="fa-solid fa-book-open"></i> Prose / Article Content</div>
        <div class="cpub-prose">
          <h2>Getting Started with ESP32</h2>
          <p>The ESP32 is a powerful microcontroller with built-in Wi-Fi and Bluetooth. It is perfect for <a href="#">IoT projects</a> and maker builds.</p>
          <h3>Requirements</h3>
          <ul><li>ESP32 development board</li><li>USB-C cable</li><li><code>platformio</code> CLI installed</li></ul>
          <blockquote><p>Pro tip: Use the ESP32-S3 variant for USB-native support and better debugging.</p></blockquote>
          <h4>Code Example</h4>
          <pre><code>#include &lt;WiFi.h&gt;

void setup() {
  Serial.begin(115200);
  WiFi.begin("ssid", "password");
}</code></pre>
          <p>For more details, check the <a href="#">full documentation</a>.</p>
          <hr>
          <div class="callout callout-tip"><strong>Tip:</strong> Use deep sleep mode to conserve battery on solar-powered builds.</div>
          <div class="callout callout-warning"><strong>Warning:</strong> The motor driver can overheat during extended use.</div>
          <div class="callout callout-danger"><strong>Danger:</strong> Always disconnect power before modifying circuits.</div>
          <div class="callout callout-info"><strong>Note:</strong> This project requires intermediate soldering skills.</div>
          <table><thead><tr><th>Pin</th><th>Function</th><th>Notes</th></tr></thead><tbody><tr><td>GPIO 2</td><td>LED</td><td>Built-in</td></tr><tr><td>GPIO 4</td><td>Motor A</td><td>PWM</td></tr><tr><td>GPIO 5</td><td>Motor B</td><td>PWM</td></tr></tbody></table>
        </div>
      </section>

      <!-- STATES -->
      <section class="sb-section" :class="{ active: active === 'states' }">
        <div class="sb-section-title"><i class="fa-solid fa-spinner"></i> States</div>
        <div class="sb-card-grid">
          <div><div class="sb-sub-label">Loading</div><div class="sb-preview-box"><div class="cpub-loading">Loading content...</div></div></div>
          <div><div class="sb-sub-label">Empty State</div><div class="sb-preview-box"><div class="cpub-empty-state" style="padding:24px"><div class="cpub-empty-state-icon"><i class="fa-solid fa-inbox"></i></div><div class="cpub-empty-state-title">No projects yet</div><div class="cpub-empty-state-desc">Create your first project to get started</div></div></div></div>
          <div><div class="sb-sub-label">Error State</div><div class="sb-preview-box"><div class="cpub-fetch-error"><div class="cpub-fetch-error-icon"><i class="fa-solid fa-circle-exclamation"></i></div><div class="cpub-fetch-error-msg">Failed to load data</div><button class="cpub-btn cpub-btn-sm">Retry</button></div></div></div>
        </div>
      </section>

      <!-- CONTENT TYPES -->
      <section class="sb-section" :class="{ active: active === 'content-types' }">
        <div class="sb-section-title"><i class="fa-solid fa-shapes"></i> Content Types</div>
        <div class="sb-subsection">
          <div class="sb-sub-label">Content Type Badges</div>
          <div class="sb-row">
            <span data-content-type="article" class="cpub-badge" style="background:var(--badge-bg);color:var(--badge-color);border-color:var(--badge-color)">ARTICLE</span>
            <span data-content-type="blog" class="cpub-badge" style="background:var(--badge-bg);color:var(--badge-color);border-color:var(--badge-color)">BLOG</span>
            <span data-content-type="project" class="cpub-badge" style="background:var(--badge-bg);color:var(--badge-color);border-color:var(--badge-color)">PROJECT</span>
            <span data-content-type="explainer" class="cpub-badge" style="background:var(--badge-bg);color:var(--badge-color);border-color:var(--badge-color)">EXPLAINER</span>
            <span data-content-type="video" class="cpub-badge" style="background:var(--badge-bg);color:var(--badge-color);border-color:var(--badge-color)">VIDEO</span>
            <span data-content-type="tutorial" class="cpub-badge" style="background:var(--badge-bg);color:var(--badge-color);border-color:var(--badge-color)">TUTORIAL</span>
          </div>
        </div>
      </section>

      <!-- PROSE CONTENT BLOCKS -->
      <section class="sb-section" :class="{ active: active === 'prose-blocks' }">
        <div class="sb-section-title"><i class="fa-solid fa-puzzle-piece"></i> Content Blocks</div>
        <div class="cpub-prose">
          <div class="sb-subsection">
            <div class="sb-sub-label">Build Step</div>
            <div class="cpub-build-step"><span class="cpub-build-step-number">Step 1 — Assemble the Chassis</span><p>Attach the four motor mounts to the base plate using M3 bolts. Ensure the mounts are aligned with the wheel cutouts.</p></div>
            <div class="cpub-build-step"><span class="cpub-build-step-number">Step 2 — Wire the Motors</span><p>Connect each motor to the driver board using the provided JST connectors. Match the color coding on the wires.</p></div>
          </div>
          <div class="sb-subsection">
            <div class="sb-sub-label">Parts List</div>
            <div class="cpub-parts-list" style="padding:var(--space-4, 16px)"><table style="width:100%;font-size:13px"><thead><tr><th>Part</th><th>Qty</th><th>Source</th></tr></thead><tbody><tr><td>ESP32-S3</td><td>1</td><td>DigiKey</td></tr><tr><td>DRV8833 Motor Driver</td><td>1</td><td>Adafruit</td></tr><tr><td>N20 Gear Motor</td><td>3</td><td>AliExpress</td></tr><tr><td>3D Printed Chassis</td><td>1</td><td>Print yourself</td></tr></tbody></table></div>
          </div>
          <div class="sb-subsection">
            <div class="sb-sub-label">Tool List</div>
            <div class="cpub-tool-list"><strong style="display:block;margin-bottom:8px;font-family:var(--font-mono,monospace);font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-dim,#666)">Tools Needed</strong><ul style="padding-left:20px;font-size:13px"><li>Soldering iron (fine tip)</li><li>Wire strippers</li><li>3D printer (FDM, PLA)</li><li>Multimeter</li></ul></div>
          </div>
          <div class="sb-subsection">
            <div class="sb-sub-label">Downloads</div>
            <div class="cpub-downloads"><strong style="display:block;margin-bottom:8px;font-family:var(--font-mono,monospace);font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-dim,#666)">Project Files</strong><div style="display:flex;flex-direction:column;gap:6px;font-size:13px"><a href="#" class="cpub-link" onclick="return false"><i class="fa-solid fa-file-zipper"></i> chassis_v2.stl (2.4 MB)</a><a href="#" class="cpub-link" onclick="return false"><i class="fa-solid fa-file-code"></i> firmware.zip (340 KB)</a><a href="#" class="cpub-link" onclick="return false"><i class="fa-solid fa-file-pdf"></i> schematic.pdf (1.1 MB)</a></div></div>
          </div>
          <div class="sb-subsection">
            <div class="sb-sub-label">Quiz</div>
            <div class="cpub-quiz"><div class="cpub-quiz-question">How many motors does a standard Kiwi Drive use?</div><div style="display:flex;flex-direction:column;gap:6px;font-size:13px"><label class="cpub-radio"><input type="radio" name="quiz1"> 2 motors</label><label class="cpub-radio"><input type="radio" name="quiz1" checked> 3 motors</label><label class="cpub-radio"><input type="radio" name="quiz1"> 4 motors</label></div></div>
          </div>
          <div class="sb-subsection">
            <div class="sb-sub-label">Checkpoint</div>
            <div class="cpub-checkpoint"><i class="fa-solid fa-circle-check"></i> Checkpoint — Your chassis should now be fully assembled with all three motors mounted.</div>
          </div>
          <div class="sb-subsection">
            <div class="sb-sub-label">Interactive Slider</div>
            <div class="cpub-interactive-slider"><strong style="display:block;margin-bottom:8px">Motor Speed Control</strong><input type="range" min="0" max="255" value="128" style="width:100%"><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-dim,#666);font-family:var(--font-mono,monospace)"><span>0 (stop)</span><span>128</span><span>255 (max)</span></div></div>
          </div>
          <div class="sb-subsection">
            <div class="sb-sub-label">Math Display</div>
            <div class="cpub-math"><div class="cpub-math-display">v = r &times; &omega;</div></div>
          </div>
          <div class="sb-subsection">
            <div class="sb-sub-label">Video Placeholder</div>
            <div class="cpub-video"><i class="fa-solid fa-play-circle" style="font-size:24px;margin-bottom:8px;display:block"></i>Video: Assembly Walkthrough (4:32)</div>
          </div>
          <div class="sb-subsection">
            <div class="sb-sub-label">Gallery</div>
            <div class="cpub-gallery"><div style="background:var(--surface2,#f4f4f2);border:2px solid var(--border,#1a1a1a);padding:32px;text-align:center;color:var(--text-dim,#666);font-size:12px"><i class="fa-solid fa-image" style="font-size:20px;display:block;margin-bottom:6px"></i>Photo 1</div><div style="background:var(--surface2,#f4f4f2);border:2px solid var(--border,#1a1a1a);padding:32px;text-align:center;color:var(--text-dim,#666);font-size:12px"><i class="fa-solid fa-image" style="font-size:20px;display:block;margin-bottom:6px"></i>Photo 2</div><div style="background:var(--surface2,#f4f4f2);border:2px solid var(--border,#1a1a1a);padding:32px;text-align:center;color:var(--text-dim,#666);font-size:12px"><i class="fa-solid fa-image" style="font-size:20px;display:block;margin-bottom:6px"></i>Photo 3</div></div>
          </div>
        </div>
      </section>

      <!-- EDITOR PANELS -->
      <section class="sb-section" :class="{ active: active === 'editor-panels' }">
        <div class="sb-section-title"><i class="fa-solid fa-sliders"></i> Editor Panels</div>
        <div style="max-width:320px">
          <div class="sb-subsection">
            <div class="sb-sub-label">Collapsible Section</div>
            <div class="cpub-ep-section"><button class="cpub-ep-section-header"><span class="cpub-ep-sec-icon"><i class="fa-solid fa-gear"></i></span><span class="cpub-ep-sec-label">Settings</span><span class="cpub-ep-sec-arrow"><i class="fa-solid fa-chevron-down"></i></span></button><div class="cpub-ep-section-body"><div class="cpub-ep-field"><span class="cpub-ep-flabel">Title</span><input class="cpub-ep-input" type="text" placeholder="Enter title..." value="My Project"></div><div class="cpub-ep-field"><span class="cpub-ep-flabel">Description</span><textarea class="cpub-ep-textarea" rows="2" placeholder="Describe...">A kiwi drive robot project</textarea></div><div class="cpub-ep-field"><span class="cpub-ep-flabel">Category</span><select class="cpub-ep-select"><option>Robotics</option><option>IoT</option><option>3D Printing</option></select><span class="cpub-ep-hint">Choose the primary category</span></div></div></div>
          </div>
          <div class="sb-subsection">
            <div class="sb-sub-label">Tag/Chip Input</div>
            <div class="cpub-ep-field"><span class="cpub-ep-flabel">Tags</span><div class="cpub-ep-chip-wrap"><span class="cpub-ep-chip">ESP32 <span class="cpub-ep-chip-x">&times;</span></span><span class="cpub-ep-chip">Robotics <span class="cpub-ep-chip-x">&times;</span></span><span class="cpub-ep-chip">3D Printing <span class="cpub-ep-chip-x">&times;</span></span><input class="cpub-ep-chip-input" placeholder="Add tag..."></div></div>
          </div>
          <div class="sb-subsection">
            <div class="sb-sub-label">Visibility Options</div>
            <div class="cpub-ep-vis-group"><button class="cpub-ep-vis-opt selected"><div class="cpub-ep-vis-radio"><div class="cpub-ep-vis-dot"></div></div><div class="cpub-ep-vis-info"><span class="cpub-ep-vis-label">Public</span><span class="cpub-ep-vis-desc">Anyone can view</span></div><span class="cpub-ep-vis-icon"><i class="fa-solid fa-globe"></i></span></button><button class="cpub-ep-vis-opt"><div class="cpub-ep-vis-radio"><div class="cpub-ep-vis-dot"></div></div><div class="cpub-ep-vis-info"><span class="cpub-ep-vis-label">Unlisted</span><span class="cpub-ep-vis-desc">Only with link</span></div><span class="cpub-ep-vis-icon"><i class="fa-solid fa-link"></i></span></button><button class="cpub-ep-vis-opt"><div class="cpub-ep-vis-radio"><div class="cpub-ep-vis-dot"></div></div><div class="cpub-ep-vis-info"><span class="cpub-ep-vis-label">Private</span><span class="cpub-ep-vis-desc">Only you</span></div><span class="cpub-ep-vis-icon"><i class="fa-solid fa-lock"></i></span></button></div>
          </div>
        </div>
      </section>

      <!-- BLOCK LIBRARY -->
      <section class="sb-section" :class="{ active: active === 'editor-blocks' }">
        <div class="sb-section-title"><i class="fa-solid fa-cubes"></i> Block Library</div>
        <div style="max-width:280px;border:2px solid var(--border,#1a1a1a)">
          <div class="cpub-ep-lib-header"><div class="cpub-ep-search"><i class="fa-solid fa-search"></i><input type="text" placeholder="Search blocks..."></div></div>
          <div class="cpub-ep-lib-body">
            <div class="cpub-ep-group"><div class="cpub-ep-group-label">Text</div><button class="cpub-ep-block-item"><span class="cpub-ep-block-icon"><i class="fa-solid fa-paragraph"></i></span> Text</button><button class="cpub-ep-block-item"><span class="cpub-ep-block-icon"><i class="fa-solid fa-heading"></i></span> Heading</button><button class="cpub-ep-block-item"><span class="cpub-ep-block-icon"><i class="fa-solid fa-quote-left"></i></span> Quote</button></div>
            <div class="cpub-ep-group"><div class="cpub-ep-group-label">Media</div><button class="cpub-ep-block-item"><span class="cpub-ep-block-icon"><i class="fa-solid fa-image"></i></span> Image</button><button class="cpub-ep-block-item"><span class="cpub-ep-block-icon"><i class="fa-solid fa-video"></i></span> Video</button><button class="cpub-ep-block-item"><span class="cpub-ep-block-icon"><i class="fa-solid fa-images"></i></span> Gallery</button></div>
            <div class="cpub-ep-group"><div class="cpub-ep-group-label">Interactive</div><button class="cpub-ep-block-item"><span class="cpub-ep-block-icon"><i class="fa-solid fa-code"></i></span> Code</button><button class="cpub-ep-block-item"><span class="cpub-ep-block-icon"><i class="fa-solid fa-circle-question"></i></span> Quiz</button><button class="cpub-ep-block-item"><span class="cpub-ep-block-icon"><i class="fa-solid fa-sliders"></i></span> Slider</button></div>
            <div class="cpub-ep-group"><div class="cpub-ep-group-label">Project</div><button class="cpub-ep-block-item"><span class="cpub-ep-block-icon"><i class="fa-solid fa-list-check"></i></span> Parts List</button><button class="cpub-ep-block-item"><span class="cpub-ep-block-icon"><i class="fa-solid fa-hammer"></i></span> Build Step</button><button class="cpub-ep-block-item"><span class="cpub-ep-block-icon"><i class="fa-solid fa-wrench"></i></span> Tool List</button><button class="cpub-ep-block-item"><span class="cpub-ep-block-icon"><i class="fa-solid fa-download"></i></span> Downloads</button></div>
          </div>
        </div>
      </section>

    </main>
  </div>`
}

// --- Component Catalog ---

function generateComponentsSection(
  registry: HarvestRegistry,
  components: Map<string, AnalyzedComponent>
): string {
  const tierColors: Record<string, { bg: string; text: string }> = {
    primitive: { bg: 'var(--green-bg)', text: 'var(--green)' },
    composite: { bg: 'var(--blue-bg)', text: 'var(--blue)' },
    feature: { bg: 'var(--amber-bg)', text: 'var(--amber)' },
    'page-bound': { bg: 'var(--red-bg)', text: 'var(--red)' },
    'app-specific': { bg: 'rgba(107,114,128,0.08)', text: 'var(--gray)' },
  }

  const cards = registry.components.map(entry => {
    const comp = components.get(entry.name)
    if (!comp) return ''

    const pct = Math.round(comp.extractionConfidence * 100)
    const colors = tierColors[comp.tier] || tierColors['app-specific']
    const confClass = pct >= 70 ? 'confidence-high' : pct >= 40 ? 'confidence-med' : 'confidence-low'
    const issues = comp.couplingIssues.length
    const internalDeps = comp.dependencies.filter(d => d.kind === 'internal-component')

    return `
    <div class="comp-card" data-tier="${comp.tier}" data-confidence="${pct}" data-name="${escAttr(comp.name.toLowerCase())}">
      <div class="comp-card-header">
        <span class="comp-card-name">${esc(comp.name)}</span>
        <span class="comp-card-badge" style="background:${colors.bg};color:${colors.text}">${comp.tier}</span>
      </div>
      <div class="comp-card-body">
        <div class="comp-card-meta">
          <span class="confidence ${confClass}">${pct}% confidence</span>
          <span>${comp.loc.total} LOC</span>
          <span>${comp.scriptVariant}</span>
        </div>
        ${comp.props.length > 0 ? `
        <div class="comp-card-props">
          ${comp.props.slice(0, 8).map(p => `
            <div class="prop-row">
              <span class="prop-name">${esc(p.name)}</span>
              <span class="prop-type">${esc(p.type)}</span>
              ${p.required ? '<span class="prop-required">required</span>' : ''}
            </div>
          `).join('')}
          ${comp.props.length > 8 ? `<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted)">+ ${comp.props.length - 8} more</div>` : ''}
        </div>` : ''}
        ${comp.emits.length > 0 ? `
        <div class="comp-card-events">Events: ${comp.emits.map(e => `<span>${esc(e.name)}</span>`).join(' ')}</div>
        ` : ''}
        ${comp.slots.length > 0 ? `
        <div class="comp-card-slots">Slots: ${comp.slots.map(s => `<span>#${esc(s.name)}</span>`).join(' ')}</div>
        ` : ''}
        ${issues > 0 ? `<div class="comp-card-issues">${issues} coupling issue${issues > 1 ? 's' : ''}: ${comp.couplingIssues.slice(0, 3).map(i => i.type).join(', ')}</div>` : ''}
        ${internalDeps.length > 0 ? `<div class="comp-card-deps">Uses: ${internalDeps.slice(0, 5).map(d => `<span>${esc(d.imports[0] || d.specifier)}</span>`).join(' ')}${internalDeps.length > 5 ? ` +${internalDeps.length - 5}` : ''}</div>` : ''}
        <div class="comp-card-path">${esc(comp.filePath)}</div>
      </div>
    </div>`
  }).join('')

  return `
  <section id="catalog" class="ds-section">
    <h2 class="ds-section-title">${icons.components} Component Catalog</h2>
    <p class="ds-section-desc">All ${registry.stats.totalComponents} analyzed components with props, events, slots, tier classification, and extraction confidence.</p>

    <div class="catalog-controls">
      <div class="catalog-search-wrap">
        ${icons.search}
        <input type="text" class="catalog-search" id="comp-search" placeholder="Search components..." oninput="filterComponents()">
      </div>
      <button class="filter-btn active" data-filter="all" onclick="setFilter(this)">All</button>
      <button class="filter-btn" data-filter="primitive" onclick="setFilter(this)">Primitive</button>
      <button class="filter-btn" data-filter="composite" onclick="setFilter(this)">Composite</button>
      <button class="filter-btn" data-filter="feature" onclick="setFilter(this)">Feature</button>
      <button class="filter-btn" data-filter="page-bound" onclick="setFilter(this)">Page-Bound</button>
      <button class="filter-btn" data-filter="extractable" onclick="setFilter(this)">Extractable</button>
      <span class="catalog-count" id="comp-count">${registry.stats.totalComponents} components</span>
    </div>

    <div class="comp-grid" id="comp-grid">
      ${cards}
    </div>
  </section>`
}

function generateGraphSection(graph: ComponentGraph): string {
  // Find most-connected nodes
  const inDegree: Record<string, number> = {}
  const outDegree: Record<string, number> = {}
  graph.nodes.forEach(n => { inDegree[n.id] = 0; outDegree[n.id] = 0 })
  graph.edges.forEach(e => {
    outDegree[e.source] = (outDegree[e.source] || 0) + 1
    inDegree[e.target] = (inDegree[e.target] || 0) + 1
  })

  const mostDeps = Object.entries(outDegree)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  const mostUsed = Object.entries(inDegree)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  return `
  <section id="graph" class="ds-section">
    <h2 class="ds-section-title">${icons.graph} Dependency Graph</h2>
    <p class="ds-section-desc">How components relate to each other — ${graph.nodes.length} nodes, ${graph.edges.length} edges.</p>

    <div class="graph-stat-grid">
      <div class="graph-stat">
        <div class="graph-stat-value">${graph.nodes.length}</div>
        <div class="graph-stat-label">Nodes</div>
      </div>
      <div class="graph-stat">
        <div class="graph-stat-value">${graph.edges.length}</div>
        <div class="graph-stat-label">Edges</div>
      </div>
      <div class="graph-stat">
        <div class="graph-stat-value">${graph.roots.length}</div>
        <div class="graph-stat-label">Roots</div>
      </div>
      <div class="graph-stat">
        <div class="graph-stat-value">${graph.leaves.length}</div>
        <div class="graph-stat-label">Leaves</div>
      </div>
    </div>

    ${graph.cycles.length > 0 ? `
    <div class="ds-subsection">
      <h3 class="ds-subsection-title">Circular Dependencies</h3>
      ${graph.cycles.map(cycle => `
        <div class="cycle-warning">
          <strong>Cycle detected</strong>
          ${cycle.map(c => esc(c)).join(' → ')} → ${esc(cycle[0])}
        </div>
      `).join('')}
    </div>` : ''}

    ${mostDeps.length > 0 ? `
    <div class="ds-subsection">
      <h3 class="ds-subsection-title">Most Dependencies (imports the most)</h3>
      <div class="ds-demo">
        ${mostDeps.map(([name, count]) => `
          <div class="tier-bar">
            <span class="tier-bar-label" style="min-width:180px">${esc(name)}</span>
            <div class="tier-bar-fill" style="width:${Math.max(Math.round((count / mostDeps[0][1]) * 100), 8)}%;background:var(--purple)">${count}</div>
          </div>
        `).join('')}
      </div>
    </div>` : ''}

    ${mostUsed.length > 0 ? `
    <div class="ds-subsection">
      <h3 class="ds-subsection-title">Most Used (imported by the most)</h3>
      <div class="ds-demo">
        ${mostUsed.map(([name, count]) => `
          <div class="tier-bar">
            <span class="tier-bar-label" style="min-width:180px">${esc(name)}</span>
            <div class="tier-bar-fill" style="width:${Math.max(Math.round((count / mostUsed[0][1]) * 100), 8)}%;background:var(--green)">${count}</div>
          </div>
        `).join('')}
      </div>
    </div>` : ''}

    ${graph.roots.length > 0 ? `
    <div class="ds-subsection">
      <h3 class="ds-subsection-title">Root Components (nothing depends on them)</h3>
      <div class="ds-demo">
        <ul class="dep-list">
          ${graph.roots.slice(0, 40).map(r => `<li>${esc(r)}</li>`).join('')}
          ${graph.roots.length > 40 ? `<li style="color:var(--text-muted)">+ ${graph.roots.length - 40} more</li>` : ''}
        </ul>
      </div>
    </div>` : ''}
  </section>`
}

// ==========================================================================
// JAVASCRIPT
// ==========================================================================

function generateJS(): string {
  return `
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.querySelector('.ds-overlay').classList.toggle('open');
}

// Active nav link on scroll
const sections = document.querySelectorAll('.ds-section');
const navLinks = document.querySelectorAll('.ds-nav-link');

function updateActiveNav() {
  let current = '';
  sections.forEach(s => {
    const top = s.getBoundingClientRect().top;
    if (top < 120) current = s.id;
  });
  navLinks.forEach(link => {
    link.classList.toggle('active', link.dataset.section === current);
  });
}
window.addEventListener('scroll', updateActiveNav, { passive: true });

// Close sidebar on nav click (mobile)
navLinks.forEach(link => {
  link.addEventListener('click', () => {
    if (window.innerWidth < 1100) {
      document.getElementById('sidebar').classList.remove('open');
      document.querySelector('.ds-overlay').classList.remove('open');
    }
  });
});

// Component filtering
let currentFilter = 'all';

function setFilter(btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentFilter = btn.dataset.filter;
  filterComponents();
}

function filterComponents() {
  const query = (document.getElementById('comp-search').value || '').toLowerCase();
  const cards = document.querySelectorAll('.comp-card');
  let visible = 0;

  cards.forEach(card => {
    const name = card.dataset.name;
    const tier = card.dataset.tier;
    const conf = parseInt(card.dataset.confidence);

    let show = true;
    if (query && !name.includes(query)) show = false;
    if (currentFilter !== 'all') {
      if (currentFilter === 'extractable') {
        if (conf < 70) show = false;
      } else if (tier !== currentFilter) {
        show = false;
      }
    }

    card.classList.toggle('hide', !show);
    if (show) visible++;
  });

  document.getElementById('comp-count').textContent = visible + ' component' + (visible !== 1 ? 's' : '');
}

// Copy code blocks
function copyCode(btn) {
  const pre = btn.closest('.ds-code').querySelector('pre');
  navigator.clipboard.writeText(pre.textContent).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 1500);
  });
}
`
}

// ==========================================================================
// UTILITIES
// ==========================================================================

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escHtml(s: string): string {
  return esc(s)
}

function escAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function hexLuminance(hex: string): number {
  // Handle various color formats - return 0.5 for non-hex
  const clean = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{3,8}$/.test(clean)) return 0.5

  let r: number, g: number, b: number
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16)
    g = parseInt(clean[1] + clean[1], 16)
    b = parseInt(clean[2] + clean[2], 16)
  } else if (clean.length >= 6) {
    r = parseInt(clean.substring(0, 2), 16)
    g = parseInt(clean.substring(2, 4), 16)
    b = parseInt(clean.substring(4, 6), 16)
  } else {
    return 0.5
  }

  // Relative luminance
  const sR = r / 255, sG = g / 255, sB = b / 255
  const R = sR <= 0.03928 ? sR / 12.92 : Math.pow((sR + 0.055) / 1.055, 2.4)
  const G = sG <= 0.03928 ? sG / 12.92 : Math.pow((sG + 0.055) / 1.055, 2.4)
  const B = sB <= 0.03928 ? sB / 12.92 : Math.pow((sB + 0.055) / 1.055, 2.4)

  return 0.2126 * R + 0.7152 * G + 0.0722 * B
}
