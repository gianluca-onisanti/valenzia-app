import { describe, expect, it } from 'vitest'
import { PHASE_BIT } from '@valenzia/shared'
import {
  Journal,
  bucketFill,
  createMapBase,
  fillPolygon,
  measurePhases,
  reconcileTerrain,
  rectOf,
  replaceValue,
  stampDisc,
  syncPhases,
  terrainSpecks,
} from '../src/lib/layers'
import { toSphere } from '../src/lib/globeLines'

/**
 * Mapa de 8x8: metade esquerda mar (codigo 0, liquido), metade direita terra
 * (codigo 1, solido), e a ultima coluna gas (codigo 2).
 */
function smallWorld() {
  const base = createMapBase(8, 8)
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) base.terrain[y * 8 + x] = x === 7 ? 2 : x >= 4 ? 1 : 0
  }
  syncPhases(base, [
    { code: 0, name: 'Mar', phase: 'liquid', color: '#0000ff' },
    { code: 1, name: 'Terra', phase: 'solid', color: '#00ff00' },
    { code: 2, name: 'Gas', phase: 'gas', color: '#ffff00' },
  ])
  return base
}

const count = (layer: Uint16Array, value: number) => layer.filter((v) => v === value).length

describe('estencil por fase', () => {
  it('balde de pais so pega no solido', () => {
    const base = smallWorld()
    const territory = new Uint16Array(64)
    const dirty = bucketFill(territory, base, 5, 3, 7, PHASE_BIT.solid)
    expect(dirty).not.toBeNull()
    expect(count(territory, 7)).toBe(3 * 8) // colunas 4..6
    expect(territory[0]).toBe(0)
    expect(territory[7]).toBe(0)
  })

  it('balde clicado fora da fase permitida nao faz nada', () => {
    const base = smallWorld()
    const territory = new Uint16Array(64)
    expect(bucketFill(territory, base, 1, 1, 7, PHASE_BIT.solid)).toBeNull()
    expect(count(territory, 7)).toBe(0)
  })

  it('laco de mar cobrindo tudo so pinta o liquido', () => {
    const base = smallWorld()
    const territory = new Uint16Array(64)
    const square = [
      { x: -1, y: -1 },
      { x: 9, y: -1 },
      { x: 9, y: 9 },
      { x: -1, y: 9 },
    ]
    fillPolygon(territory, base, square, 4, PHASE_BIT.liquid)
    expect(count(territory, 4)).toBe(4 * 8)
    expect(territory[5]).toBe(0)
  })

  it('terreno (estencil null) pinta em qualquer fase, e o diario desfaz', () => {
    const base = smallWorld()
    const journal = new Journal()
    stampDisc(base.terrain, base, 4, 4, 2.5, 1, null, journal)
    expect(base.terrain[4 * 8 + 3]).toBe(1) // era mar
    journal.revert(base.terrain)
    expect(base.terrain[4 * 8 + 3]).toBe(0)
  })
})

describe('reconcileTerrain', () => {
  it('apaga pais que ficou sobre agua e bioma fora do solido', () => {
    const base = smallWorld()
    const territory = new Uint16Array(64)
    const biome = new Uint16Array(64)
    bucketFill(territory, base, 5, 3, 7, PHASE_BIT.solid)
    biome.fill(3)
    // Carva um canal na coluna 5: vira mar.
    for (let y = 0; y < 8; y++) base.terrain[y * 8 + 5] = 0

    const jt = new Journal()
    const jb = new Journal()
    const slotBit = (slot: number) => (slot === 7 ? PHASE_BIT.solid : 0)
    reconcileTerrain(base, territory, biome, rectOf(0, 0, 7, 7), slotBit, jt, jb)

    expect(territory[3 * 8 + 5]).toBe(0) // canal: pais saiu
    expect(territory[3 * 8 + 4]).toBe(7) // terra vizinha: ficou
    expect(biome[3 * 8 + 1]).toBe(0) // mar: sem bioma
    expect(biome[3 * 8 + 4]).toBe(3) // terra: bioma fica
    expect(biome[3 * 8 + 7]).toBe(0) // gas: sem bioma
    jt.revert(territory)
    expect(territory[3 * 8 + 5]).toBe(7)
  })
})

describe('materiais', () => {
  it('excluir troca os pixels pelo substituto', () => {
    const base = smallWorld()
    replaceValue(base.terrain, base.width, 2, 1)
    expect(count(base.terrain, 2)).toBe(0)
    expect(count(base.terrain, 1)).toBe(4 * 8)
  })

  it('mede as fases em pixels e em km2', () => {
    const base = smallWorld()
    const rows = new Float64Array(8).fill(10)
    const totals = measurePhases(base, rows)
    expect(totals.pixels).toEqual({ liquid: 32, solid: 24, gas: 8 })
    expect(totals.km2.gas).toBe(80)
  })
})

describe('terrainSpecks', () => {
  // Mar (0) com um continente (1) de 6x6, uma ilhota de 2 px e, dentro do
  // continente, um lago de 1 px.
  const W = 12
  const H = 10
  const make = () => {
    const t = new Uint16Array(W * H)
    for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) t[y * W + x] = 1
    t[4 * W + 4] = 0
    t[1 * W + 10] = 1
    t[2 * W + 10] = 1
    return t
  }

  it('conta sem mexer', () => {
    const t = make()
    const before = t.slice()
    const report = terrainSpecks(t, W, H, 4)
    expect(report).toMatchObject({ count: 2, pixels: 3 })
    expect(t).toEqual(before)
  })

  it('troca cada mancha pelo material em volta, e o journal desfaz', () => {
    const t = make()
    const before = t.slice()
    const journal = new Journal()
    const report = terrainSpecks(t, W, H, 4, { journal })
    expect(report.count).toBe(2)
    expect(t[4 * W + 4]).toBe(1)
    expect(t[1 * W + 10]).toBe(0)
    expect(t[2 * W + 10]).toBe(0)
    expect(terrainSpecks(t, W, H, 4).count).toBe(0)
    journal.revert(t)
    expect(t).toEqual(before)
  })

  it('nao apaga o que e maior que o limite', () => {
    const t = make()
    expect(terrainSpecks(t, W, H, 1).count).toBe(1)
  })
})

describe('toSphere', () => {
  it('descarta o trecho que corre pela moldura do mapa', () => {
    // Um quadrado encostado na borda esquerda: o lado x=0 e corte, nao costa.
    const loop = Float32Array.from([0, 10, 5, 10, 5, 20, 0, 20])
    const lines = toSphere([loop], 100, 50)
    const points = lines.reduce((n, l) => n + l.length / 3, 0)
    expect(lines.length).toBe(1)
    expect(points).toBe(4)
    for (const l of lines) for (let i = 0; i < l.length; i += 3) {
      expect(Math.hypot(l[i], l[i + 1], l[i + 2])).toBeCloseTo(1, 5)
    }
  })
})
