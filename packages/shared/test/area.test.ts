import { describe, expect, it } from 'vitest'
import { pixelAreaByRow, sphereAreaKm2 } from '../src/area'

describe('pixelAreaByRow', () => {
  it('soma exatamente a superficie da esfera', () => {
    const width = 4096
    const height = 1878
    const radius = 9557
    const rows = pixelAreaByRow(width, height, radius)
    let total = 0
    for (const a of rows) total += a * width
    expect(total / sphereAreaKm2(radius)).toBeCloseTo(1, 9)
  })

  it('encolhe rumo aos polos e e simetrica', () => {
    const rows = pixelAreaByRow(360, 180, 6371)
    expect(rows[90]).toBeGreaterThan(rows[10])
    expect(rows[0]).toBeCloseTo(rows[179], 9)
    expect(rows[45]).toBeCloseTo(rows[134], 9)
  })
})
