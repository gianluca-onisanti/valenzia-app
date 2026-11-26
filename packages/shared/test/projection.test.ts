import { describe, expect, it } from 'vitest'
import { equirectHeight, mercatorMaxLat, mercatorRowMap, mercatorY, remapRows } from '../src/projection'

const deg = (rad: number) => (rad * 180) / Math.PI

describe('projecao Mercator', () => {
  it('sabe ate onde a imagem vai', () => {
    expect(deg(mercatorMaxLat(2048, 1024))).toBeCloseTo(66.5, 0)
    expect(deg(mercatorMaxLat(4096, 1878))).toBeCloseTo(63.4, 1)
    expect(equirectHeight(4096)).toBe(2048)
  })

  it('leva o equador ao centro e deixa as calotas de fora', () => {
    const map = mercatorRowMap(4096, 1878, 2048)
    // Linha logo acima do equador vem da linha logo acima do centro da origem.
    expect(map[1023]).toBe(938)
    expect(map[1024]).toBe(939)
    // Alem de ~63,4 graus (linha ~303 de 2048), calota.
    expect(map[0]).toBe(-1)
    expect(map[295]).toBe(-1)
    expect(map[310]).toBeGreaterThanOrEqual(0)
    expect(map[2047]).toBe(-1)
    // Monotonico onde ha imagem.
    let last = -1
    for (const row of map) {
      if (row < 0) continue
      expect(row).toBeGreaterThanOrEqual(last)
      last = row
    }
  })

  it('a posicao continua concorda com o mapa de linhas', () => {
    const map = mercatorRowMap(4096, 1878, 2048)
    for (const sy of [100.5, 500.5, 939.5, 1500.5, 1800.5]) {
      const dy = Math.floor(mercatorY(sy, 4096, 1878, 2048))
      expect(Math.abs(map[dy] - Math.floor(sy))).toBeLessThanOrEqual(2)
    }
  })

  it('copia linhas inteiras e preenche a calota', () => {
    const src = Uint16Array.from([1, 1, 2, 2, 3, 3])
    const out = remapRows(src, 2, Int32Array.from([-1, 0, 1, 2, -1]), [9])
    expect(Array.from(out)).toEqual([9, 9, 1, 1, 2, 2, 3, 3, 9, 9])
    const rgba = new Uint8ClampedArray([10, 20, 30, 255])
    const out2 = remapRows(rgba, 1, Int32Array.from([-1, 0]), [1, 2, 3, 255], 4)
    expect(Array.from(out2)).toEqual([1, 2, 3, 255, 10, 20, 30, 255])
  })
})
