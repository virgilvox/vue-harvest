import { defineCommand } from 'citty'
import { resolve, join } from 'pathe'
import { existsSync, writeFileSync } from 'fs'
import consola from 'consola'

export default defineCommand({
  meta: {
    name: 'init',
    description: 'Initialize a harvest.config.json with detected project settings',
  },
  args: {
    path: {
      type: 'positional',
      description: 'Path to the Vue project root',
      default: '.',
    },
  },
  async run({ args }) {
    const { resolveProjectMeta } = await import('../index.js')

    const root = resolve(args.path)
    const configPath = join(root, 'harvest.config.json')

    if (existsSync(configPath)) {
      consola.warn('harvest.config.json already exists. Skipping.')
      return
    }

    const meta = resolveProjectMeta(root)

    const config = {
      include: ['**/*.vue'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.test.*',
        '**/*.spec.*',
        '**/*.story.*',
        '**/*.stories.*',
      ],
      extractionThreshold: 70,
      outDir: '.vue-harvest',
      registry: 'json',
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2))

    consola.success('Created harvest.config.json')
    consola.info(`Detected: ${meta.framework} (${meta.typescript ? 'TypeScript' : 'JavaScript'})${meta.tailwind ? ' + Tailwind' : ''}`)
  },
})
