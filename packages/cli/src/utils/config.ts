import { resolve, join } from 'pathe'
import { existsSync, readFileSync } from 'fs'
import type { HarvestConfig } from '../types.js'

const DEFAULT_CONFIG: Omit<HarvestConfig, 'root'> = {
  include: ['**/*.vue'],
  exclude: [
    'node_modules/**',
    'dist/**',
    '**/*.test.*',
    '**/*.spec.*',
    '**/*.story.*',
    '**/*.stories.*',
    '**/e2e/**',
    '**/cypress/**',
  ],
  aliases: {},
  extractionThreshold: 0.7,
  outDir: '.vue-harvest',
  registry: 'json',
}

export interface ProjectMeta {
  framework: 'vite' | 'nuxt' | 'vue-cli' | 'unknown'
  typescript: boolean
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'unknown'
  tailwind: boolean
}

export function resolveConfig(
  root: string,
  overrides: Partial<HarvestConfig> = {}
): HarvestConfig {
  let fileConfig: Partial<HarvestConfig> = {}

  // Try to read config file
  const configPath = resolve(root, 'harvest.config.json')
  if (existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch {
      // Ignore malformed config
    }
  }

  // Detect aliases from tsconfig or vite config
  const aliases = {
    ...detectAliases(root),
    ...fileConfig.aliases,
    ...overrides.aliases,
  }

  const outDir = resolve(
    root,
    overrides.outDir ?? fileConfig.outDir ?? DEFAULT_CONFIG.outDir
  )

  return {
    root,
    include: overrides.include ?? fileConfig.include ?? DEFAULT_CONFIG.include,
    exclude: overrides.exclude ?? fileConfig.exclude ?? DEFAULT_CONFIG.exclude,
    aliases,
    extractionThreshold:
      overrides.extractionThreshold ??
      fileConfig.extractionThreshold ??
      DEFAULT_CONFIG.extractionThreshold,
    outDir,
    registry: overrides.registry ?? fileConfig.registry ?? DEFAULT_CONFIG.registry,
  }
}

export function resolveProjectMeta(root: string): ProjectMeta {
  const meta: ProjectMeta = {
    framework: 'unknown',
    typescript: false,
    packageManager: 'unknown',
    tailwind: false,
  }

  // Detect framework
  if (existsSync(join(root, 'nuxt.config.ts')) || existsSync(join(root, 'nuxt.config.js'))) {
    meta.framework = 'nuxt'
  } else if (existsSync(join(root, 'vite.config.ts')) || existsSync(join(root, 'vite.config.js'))) {
    meta.framework = 'vite'
  } else if (existsSync(join(root, 'vue.config.js'))) {
    meta.framework = 'vue-cli'
  }

  // TypeScript
  meta.typescript = existsSync(join(root, 'tsconfig.json'))

  // Package manager
  if (existsSync(join(root, 'pnpm-lock.yaml'))) meta.packageManager = 'pnpm'
  else if (existsSync(join(root, 'yarn.lock'))) meta.packageManager = 'yarn'
  else if (existsSync(join(root, 'package-lock.json'))) meta.packageManager = 'npm'

  // Tailwind
  meta.tailwind =
    existsSync(join(root, 'tailwind.config.js')) ||
    existsSync(join(root, 'tailwind.config.ts')) ||
    existsSync(join(root, 'tailwind.config.cjs'))

  return meta
}

function detectAliases(root: string): Record<string, string> {
  const aliases: Record<string, string> = {}

  // Read tsconfig paths
  const tsconfigPath = join(root, 'tsconfig.json')
  if (existsSync(tsconfigPath)) {
    try {
      const raw = readFileSync(tsconfigPath, 'utf-8')
      // Strip comments (basic JSON with comments support)
      const stripped = raw.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
      const tsconfig = JSON.parse(stripped)

      const paths = tsconfig.compilerOptions?.paths
      const baseUrl = tsconfig.compilerOptions?.baseUrl || '.'

      if (paths) {
        for (const [alias, targets] of Object.entries(paths)) {
          if (Array.isArray(targets) && targets.length > 0) {
            // "@/*" -> ["./src/*"] becomes "@" -> "/abs/path/to/src"
            const cleanAlias = alias.replace(/\/\*$/, '')
            const cleanTarget = (targets[0] as string).replace(/\/\*$/, '')
            aliases[cleanAlias] = resolve(root, baseUrl, cleanTarget)
          }
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Common Vite alias — if no @ alias detected, add default
  if (!aliases['@'] && existsSync(join(root, 'src'))) {
    aliases['@'] = resolve(root, 'src')
  }

  return aliases
}
