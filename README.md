# vue-harvest

Point it at a Vue project. It finds every component, figures out which ones are reusable, and extracts them. It also pulls out your design tokens (colors, spacing, typography) and gives you a visual report.

The hard cases that need judgment (store-coupled components, ambiguous dependencies) get handled by an MCP server that feeds structured analysis to an LLM.

## What it does

**Component extraction.** Parses every `.vue` file in a project using `@vue/compiler-sfc`. For each component it extracts the full interface (props, emits, slots), maps out the dependency graph, detects coupling issues, and scores a confidence level for safe extraction. Components above the threshold get auto-extracted into standalone bundles with rewritten imports and a manifest of peer dependencies.

**Design token extraction.** Scans all CSS (scoped styles, standalone stylesheets) and pulls out colors, font families, font sizes, font weights, spacing values, border radii, and shadows. Outputs a CSS custom properties file, a JSON dump, and a visual HTML explorer showing swatches and scales.

**MCP server.** Twelve tools that give an LLM the structured data it needs to reason about the harder cases: components in the 30-70% confidence range that could be extracted with some refactoring. The LLM can deep-analyze coupling, generate decoupling suggestions with before/after code, create composable wrappers for store-bound components, and do full rewrite-and-extract in one shot.

## Install

```bash
npm install -g vue-harvest

# or run directly
npx vue-harvest analyze ./my-app
```

For the MCP server:

```bash
npm install -g vue-harvest-mcp
```

## CLI

### `vue-harvest analyze [path]`

Full analysis pipeline. Discovers `.vue` files, parses interfaces, builds the dependency graph, classifies every component, auto-extracts the safe ones, and generates a registry + catalog.

```bash
vue-harvest analyze
vue-harvest analyze ./path/to/project
vue-harvest analyze --threshold 60
vue-harvest analyze --output ./harvested
vue-harvest analyze --json | jq '.summary'
```

Output goes to `.vue-harvest/` by default:

```
.vue-harvest/
  registry.json       Component registry (shadcn-compatible format)
  catalog.html        Browsable catalog with tier filters
  analysis.json       Full analysis dump for the MCP server
  SUMMARY.md          Human-readable report
  components/         Extracted component bundles
    Button/
      Button.vue
      manifest.json
    Card/
      Card.vue
      manifest.json
```

### `vue-harvest list [path]`

Lists all components sorted by extraction confidence.

```bash
vue-harvest list
vue-harvest list --tier primitive
vue-harvest list --json
```

### `vue-harvest inspect <name>`

Full breakdown of a single component: props, events, slots, dependencies, coupling issues, style analysis.

```bash
vue-harvest inspect Button
vue-harvest inspect UserProfileCard --json
```

### `vue-harvest extract <name>`

Extracts a specific component and all its local dependencies into a standalone bundle.

```bash
vue-harvest extract Button
vue-harvest extract UserProfileCard --force
vue-harvest extract Card --output ./my-components
```

### `vue-harvest tokens [path]`

Extracts design system tokens from the project.

```bash
vue-harvest tokens
vue-harvest tokens --json
vue-harvest tokens --output ./design-system
```

Outputs:
- `tokens.css` with CSS custom properties
- `tokens.json` with the full token dataset
- `design-system.html` with a visual explorer (color swatches, font scales, spacing visualization)

### `vue-harvest init`

Creates a `harvest.config.json` with detected project settings.

## Configuration

Optional. Place a `harvest.config.json` in the project root:

```json
{
  "include": ["**/*.vue"],
  "exclude": [
    "node_modules/**",
    "dist/**",
    "**/*.test.*",
    "**/*.story.*"
  ],
  "extractionThreshold": 70,
  "outDir": ".vue-harvest",
  "registry": "json"
}
```

Path aliases are auto-detected from `tsconfig.json`. If your project has `@` mapped to `./src`, vue-harvest picks that up.

## Component classification

Every component gets classified into a reusability tier based on its interface, dependencies, and coupling:

| Tier | Confidence | What it means |
|------|-----------|---------------|
| Primitive | 85-100% | Pure UI, no business logic. Button, Input, Card. |
| Composite | 70-85% | Built from primitives, minimal logic. FormField, DataTable. |
| Feature | 50-70% | Has business logic but potentially reusable. UserAvatar, SearchBar. |
| Page-bound | 30-50% | Tightly coupled to a specific page or route. |
| App-specific | 0-30% | Deeply coupled to app state. Not reusable as-is. |

Components at or above the extraction threshold (default 70%) are auto-extracted. The 30-70% band is where the MCP server comes in.

## Coupling issues

The analyzer detects these coupling patterns:

| Issue | Severity | Description |
|-------|----------|-------------|
| `direct-store-access` | warning | Imports a Pinia/Vuex store directly |
| `hardcoded-api` | warning | Contains hardcoded API endpoint URLs |
| `router-dependency` | info | Uses vue-router |
| `i18n-dependency` | warning | Uses vue-i18n |
| `global-inject` | warning | Uses `inject()` for app-level provides |
| `env-variable` | warning | References `import.meta.env` |
| `unscoped-css` | warning | Has unscoped styles that leak globally |
| `deep-provide-chain` | warning | Relies on provide/inject chains |
| `implicit-global` | warning | Uses globally registered components without importing them |
| `side-effect-import` | warning | Has imports that execute side effects |

## MCP server

### Setup with Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vue-harvest": {
      "command": "vue-harvest-mcp"
    }
  }
}
```

### Setup with Claude Code

```bash
claude mcp add vue-harvest vue-harvest-mcp
```

### Available tools

| Tool | What it does |
|------|-------------|
| `analyze-project` | Runs the full pipeline on a project path |
| `list-components` | Lists components with filters (tier, confidence range) |
| `inspect-component` | Full analysis with source code |
| `extract-component` | Extracts with force option |
| `deep-analyze` | Structured coupling analysis for LLM reasoning |
| `suggest-refactor` | Before/after code for decoupling |
| `generate-wrapper` | Creates composable wrappers for store-bound components |
| `adapt-and-extract` | Full rewrite + extract in one step |
| `batch-triage` | Prioritizes all reviewable components with effort estimates |
| `coupling-report` | Project-wide coupling patterns |
| `analyze-design-system` | Extracts design tokens |
| `get-design-tokens` | Returns tokens filtered by type |

### Resources

The server exposes these as MCP resources after analysis:

- `harvest://registry` : full registry JSON
- `harvest://graph` : dependency graph
- `harvest://summary` : analysis summary
- `harvest://component/{name}` : individual component analysis
- `harvest://design-system` : extracted design tokens

### Prompts

- `analyze-new-project` : guided first analysis
- `extraction-sprint` : batch refactor and extract session
- `refactor-component` : single component deep refactor
- `extract-design-system` : design token extraction and analysis

### Example conversations

> "Analyze my Vue project at /Users/me/projects/my-app"

> "Show me all the components that need review"

> "Deep analyze the UserProfileCard component and suggest how to decouple it from the auth store"

> "Do an extraction sprint, go through all reviewable components and extract what you can"

> "Extract the design system tokens and recommend a naming convention"

## Programmatic API

vue-harvest exports its analysis engine for use in other tools:

```typescript
import { analyze, writeOutput, analyzeTokens } from 'vue-harvest'

const report = await analyze('./my-vue-app', {
  extractionThreshold: 0.6,
})

console.log(report.summary)
// { totalFiles: 42, analyzed: 40, autoExtracted: 12, needsMCP: 8, ... }

await writeOutput(report)

// Design tokens
const tokens = await analyzeTokens('./my-vue-app')
console.log(tokens.palette)    // [{ hex: '#3b82f6', usageCount: 14 }, ...]
console.log(tokens.spacing)    // ['4px', '8px', '12px', '16px', '24px']
```

## Architecture

```
vue-harvest (monorepo)
  packages/
    cli/                        Published as "vue-harvest" on npm
      src/
        types.ts                Type system shared across the whole project
        index.ts                Pipeline orchestrator
        cli.ts                  CLI entry point (citty)
        analyzers/
          sfc-analyzer.ts       SFC parsing, interface extraction, coupling detection
          graph-builder.ts      Dependency graph with Tarjan's SCC for cycle detection
          design-system-analyzer.ts   Token extraction from CSS
        extractors/
          component-extractor.ts   Import rewriting, file bundling, manifest generation
        generators/
          registry.ts           Registry JSON + catalog HTML generation
        commands/               CLI command definitions
        utils/
          config.ts             Config resolution, alias detection from tsconfig
      tests/
        fixtures/               A real mini Vue project used as test input
        unit/                   66 tests across 5 suites

    mcp/                        Published as "vue-harvest-mcp" on npm
      src/
        index.ts                MCP server (12 tools, resources, prompts)
```

The split between CLI and MCP is deliberate. The CLI handles everything deterministic: parsing, graph building, classification, extraction. The MCP handles the 20% that needs reasoning: decoupling suggestions, refactoring code generation, ambiguity resolution.

## Development

```bash
git clone https://github.com/virgilvox/vue-harvest.git
cd vue-harvest
pnpm install
pnpm build
pnpm test
```

Watch mode for the CLI:

```bash
pnpm --filter vue-harvest dev
```

Run a specific test file:

```bash
npx vitest run packages/cli/tests/unit/sfc-analyzer.test.ts
```

## How it works internally

1. **Discovery.** Globs for `.vue` files, reads `tsconfig.json` for path aliases.
2. **SFC parsing.** `@vue/compiler-sfc` splits each file into template, script, and style blocks.
3. **Interface extraction.** Regex-based extraction of `defineProps`, `defineEmits`, `<slot>` tags. Handles generic type syntax, `withDefaults`, and object syntax with nested options.
4. **Dependency analysis.** `es-module-lexer` parses imports. Each import gets classified by kind (internal component, composable, store, util, external package, etc).
5. **Coupling detection.** Pattern matching on the script and template AST for store access, hardcoded APIs, router usage, i18n, inject, env vars, unscoped CSS.
6. **Classification.** Confidence scoring starts at 1.0 and gets penalized for coupling issues, store access, and page-path patterns. Boosted for props/slots interfaces and UI-path patterns.
7. **Graph building.** Resolves import paths, builds adjacency lists, runs Tarjan's strongly connected components algorithm for cycle detection, computes transitive dependency closures.
8. **Extraction.** For components above threshold: collects the component plus all its local deps (composables, utils, types, styles), rewrites import paths to be relative within the extracted bundle, generates a manifest listing peer dependencies and required globals.
9. **Token extraction.** PostCSS value parser identifies colors (hex, rgb, hsl), font properties, spacing values, radii, and shadows from CSS declarations. Deduplicates, normalizes hex values, and groups by type.

## License

MIT
