# vue-harvest-mcp

MCP server for AI-assisted Vue component extraction and design system analysis.

This is the intelligence layer for [vue-harvest](https://www.npmjs.com/package/vue-harvest). It picks up where the CLI leaves off, handling the components in the 30-70% confidence range that need reasoning to extract safely.

## Setup

### Claude Desktop

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

### Claude Code

```bash
claude mcp add vue-harvest vue-harvest-mcp
```

### Cursor / other MCP clients

```bash
npx vue-harvest-mcp
```

The server communicates over stdio using the Model Context Protocol.

## Tools

The server exposes 12 tools:

### Analysis

| Tool | Description |
|------|-------------|
| `analyze-project` | Runs the full vue-harvest pipeline on a project. Required before using other tools. Takes a `path` argument. |
| `list-components` | Lists components with optional filters: `tier`, `minConfidence`, `maxConfidence`. |
| `inspect-component` | Returns the full analysis of a component including source code, interface, dependencies, and coupling issues. |
| `coupling-report` | Generates a project-wide coupling report grouped by issue type. Good for spotting systemic patterns. |

### Extraction

| Tool | Description |
|------|-------------|
| `extract-component` | Extracts a component into a standalone bundle. Set `force: true` to extract below threshold. |
| `deep-analyze` | Structured coupling analysis with source code. Returns data the LLM can reason about to suggest fixes. |
| `suggest-refactor` | Generates concrete refactoring suggestions with before/after code snippets. |
| `generate-wrapper` | Creates a composable wrapper that abstracts store access away from a component. |
| `adapt-and-extract` | Rewrites a component to remove all coupling, then extracts it. Best for the 30-70% confidence range. |
| `batch-triage` | Triages all reviewable components at once with prioritized effort estimates. |

### Design system

| Tool | Description |
|------|-------------|
| `analyze-design-system` | Extracts design tokens (colors, typography, spacing, shadows) from a project. |
| `get-design-tokens` | Returns extracted tokens, optionally filtered by type (color, font-size, spacing, etc). |

## Resources

After running `analyze-project`, these resources become available:

- `harvest://registry` : full component registry JSON
- `harvest://graph` : dependency graph (nodes, edges, cycles)
- `harvest://summary` : analysis summary
- `harvest://component/{name}` : individual component analysis
- `harvest://design-system` : extracted design tokens

## Prompts

| Prompt | Description |
|--------|-------------|
| `analyze-new-project` | Guided first analysis of a Vue project |
| `extraction-sprint` | Batch refactor and extract session |
| `refactor-component` | Single component deep refactor |
| `extract-design-system` | Design token extraction and analysis |

## Typical workflow

1. Ask the LLM to analyze your project. It will run `analyze-project`.
2. Ask what needs review. It will use `list-components` and `batch-triage`.
3. For each reviewable component, the LLM can `deep-analyze` it, figure out the right approach, and either `suggest-refactor`, `generate-wrapper`, or `adapt-and-extract`.
4. For design tokens, ask the LLM to run `analyze-design-system` and recommend a naming convention.

## Example prompts you can use

"Analyze my Vue project at /path/to/project"

"Show me all components between 40% and 70% confidence"

"Deep analyze the UserProfileCard and suggest how to remove the store dependency"

"Do an extraction sprint, start with the easiest wins"

"Extract the design tokens and suggest a consistent naming scheme"

## Requirements

- Node.js 20+
- An MCP-compatible client (Claude Desktop, Claude Code, Cursor, etc)

## License

MIT
