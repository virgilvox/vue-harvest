import { describe, it, expect } from 'vitest'
import { resolve } from 'pathe'
import { resolveConfig, resolveProjectMeta } from '../../src/utils/config.js'

const PROJECT_ROOT = resolve(__dirname, '../fixtures')

describe('Config', () => {
  describe('resolveConfig', () => {
    it('returns default config for a project root', () => {
      const config = resolveConfig(PROJECT_ROOT)

      expect(config.root).toBe(PROJECT_ROOT)
      expect(config.include).toEqual(['**/*.vue'])
      expect(config.exclude).toContain('node_modules/**')
      expect(config.extractionThreshold).toBe(0.7)
      expect(config.registry).toBe('json')
    })

    it('reads aliases from tsconfig.json', () => {
      const config = resolveConfig(PROJECT_ROOT)
      expect(config.aliases).toHaveProperty('@')
      expect(config.aliases['@']).toContain('src')
    })

    it('applies overrides', () => {
      const config = resolveConfig(PROJECT_ROOT, {
        extractionThreshold: 0.5,
      })
      expect(config.extractionThreshold).toBe(0.5)
    })

    it('resolves outDir as absolute path', () => {
      const config = resolveConfig(PROJECT_ROOT)
      expect(config.outDir).toMatch(/^\//)
    })
  })

  describe('resolveProjectMeta', () => {
    it('detects project metadata', () => {
      const meta = resolveProjectMeta(PROJECT_ROOT)

      expect(meta.framework).toBeDefined()
      expect(meta.typescript).toBe(true)
      expect(meta.packageManager).toBeDefined()
    })
  })
})
