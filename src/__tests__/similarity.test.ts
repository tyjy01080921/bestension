import { describe, it, expect } from 'vitest'
import { cosineSimilarity } from '../similarity'

describe('cosineSimilarity', () => {
  it('identical vectors return 100', () => {
    const v = [0.8, 0.5, 0.3, 0.9, 0.1]
    expect(cosineSimilarity(v, v)).toBe(100)
  })

  it('zero vectors return 0', () => {
    expect(cosineSimilarity([0, 0, 0], [0, 0, 0])).toBe(0)
    expect(cosineSimilarity([0.5, 0.5], [0, 0])).toBe(0)
  })

  it('orthogonal vectors return 0', () => {
    // In FFT magnitude space (0..1) orthogonal → dot = 0 → similarity = 0
    const a = [1, 0, 0]
    const b = [0, 1, 0]
    expect(cosineSimilarity(a, b)).toBe(0)
  })

  it('mismatched lengths use shorter vector', () => {
    const a = [1, 0, 0, 0.5]
    const b = [1, 0, 0]
    // both share first 3 elements: [1,0,0] vs [1,0,0] → identical
    expect(cosineSimilarity(a, b)).toBe(100)
  })

  it('empty arrays return 0', () => {
    expect(cosineSimilarity([], [])).toBe(0)
  })

  it('returns 0..100 range for typical FFT data', () => {
    const best = Array.from({ length: 300 }, (_, i) => Math.abs(Math.sin(i * 0.1)) * 0.8)
    const similar = best.map(v => v * 0.95 + Math.random() * 0.05)  // ~95% similar
    const result = cosineSimilarity(best, similar)
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(100)
    expect(result).toBeGreaterThan(90)  // should be close to 100
  })

  it('averaged FFT is more stable than single-shot', () => {
    // Simulate: true signal + 3 noisy captures
    const signal = Array.from({ length: 300 }, (_, i) => Math.abs(Math.sin(i * 0.05)) * 0.9)
    const noise = () => (Math.random() - 0.5) * 0.1

    const hit1 = signal.map(v => Math.max(0, Math.min(1, v + noise())))
    const hit2 = signal.map(v => Math.max(0, Math.min(1, v + noise())))
    const hit3 = signal.map(v => Math.max(0, Math.min(1, v + noise())))

    const averaged = signal.map((_, i) => (hit1[i] + hit2[i] + hit3[i]) / 3)

    const singleShotSim = cosineSimilarity(signal, hit1)
    const averagedSim = cosineSimilarity(signal, averaged)

    // averaged should be closer to the true signal than single shot
    expect(averagedSim).toBeGreaterThanOrEqual(singleShotSim)
  })
})
