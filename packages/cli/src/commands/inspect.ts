import { defineCommand } from 'citty'
import { resolve } from 'pathe'
import consola from 'consola'

export default defineCommand({
  meta: {
    name: 'inspect',
    description: 'Deep-inspect a single component',
  },
  args: {
    name: {
      type: 'positional',
      description: 'Component name in PascalCase',
      required: true,
    },
    path: {
      type: 'string',
      description: 'Project root path',
      default: '.',
    },
    json: {
      type: 'boolean',
      description: 'Output JSON',
    },
  },
  async run({ args }) {
    const { analyze } = await import('../index.js')

    const report = await analyze(resolve(args.path))
    const comp = report.components.get(args.name)

    if (!comp) {
      const available = [...report.components.keys()].join(', ')
      consola.error(`Component "${args.name}" not found. Available: ${available}`)
      process.exit(1)
    }

    if (args.json) {
      process.stdout.write(JSON.stringify(comp, null, 2))
      return
    }

    const pct = Math.round(comp.extractionConfidence * 100)

    consola.log(`\n  ${comp.name}`)
    consola.log(`  ${'─'.repeat(40)}`)
    consola.log(`  File:       ${comp.filePath}`)
    consola.log(`  Tier:       ${comp.tier}`)
    consola.log(`  Confidence: ${pct}%`)
    consola.log(`  Script:     ${comp.scriptVariant}`)
    consola.log(`  LOC:        ${comp.loc.total} (template: ${comp.loc.template}, script: ${comp.loc.script}, style: ${comp.loc.style})`)

    if (comp.props.length > 0) {
      consola.log(`\n  Props:`)
      for (const p of comp.props) {
        consola.log(`    ${p.name}${p.required ? '' : '?'}: ${p.type}${p.default ? ` = ${p.default}` : ''}`)
      }
    }

    if (comp.emits.length > 0) {
      consola.log(`\n  Events:`)
      for (const e of comp.emits) {
        consola.log(`    ${e.name}${e.payload ? `: ${e.payload}` : ''}`)
      }
    }

    if (comp.slots.length > 0) {
      consola.log(`\n  Slots:`)
      for (const s of comp.slots) {
        consola.log(`    #${s.name}${s.bindings.length > 0 ? ` (${s.bindings.map((b) => b.name).join(', ')})` : ''}`)
      }
    }

    if (comp.couplingIssues.length > 0) {
      consola.log(`\n  Coupling Issues:`)
      for (const i of comp.couplingIssues) {
        consola.log(`    [${i.severity}] ${i.type}: ${i.description}`)
        if (i.suggestedFix) consola.log(`      Fix: ${i.suggestedFix}`)
      }
    }

    if (comp.dependencies.length > 0) {
      consola.log(`\n  Dependencies:`)
      for (const d of comp.dependencies) {
        consola.log(`    [${d.kind}] ${d.specifier}${d.typeOnly ? ' (type-only)' : ''}`)
      }
    }

    consola.log('')
  },
})
