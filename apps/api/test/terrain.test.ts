import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { decodeLayerPng, encodeLayerPng } from '../src/terrain/codec'
import { extractTerrain, terrainFromExtraction } from '../src/terrain/extract'

describe('codec de camada', () => {
  it('ida e volta sem perder nenhum valor, inclusive acima de 255', async () => {
    const width = 64
    const height = 32
    const layer = new Uint16Array(width * height)
    for (let i = 0; i < layer.length; i++) layer[i] = (i * 7919) % 65536
    layer[0] = 0
    layer[1] = 255
    layer[2] = 256
    layer[3] = 65535
    const png = await encodeLayerPng(layer, width, height)
    const back = await decodeLayerPng(png)
    expect(back.width).toBe(width)
    expect(back.height).toBe(height)
    expect(Array.from(back.layer)).toEqual(Array.from(layer))
  })

  it('le PNG RGBA como o navegador gera (alpha 255)', async () => {
    const width = 4
    const height = 2
    const raw = Buffer.alloc(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      raw[i * 4] = i
      raw[i * 4 + 1] = 1
      raw[i * 4 + 3] = 255
    }
    const png = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer()
    const { layer } = await decodeLayerPng(png)
    expect(Array.from(layer)).toEqual([256, 257, 258, 259, 260, 261, 262, 263])
  })
})

/** Imagem sintetica: mar azul, um continente verde contornado de preto. */
async function syntheticMap(width = 200, height = 100): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3
      const dx = x - 120
      const dy = y - 50
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d < 28) {
        raw[o] = 0x83
        raw[o + 1] = 0xe6
        raw[o + 2] = 0x4b
      } else if (d < 30) {
        // traco de costa
        raw[o] = 20
        raw[o + 1] = 20
        raw[o + 2] = 20
      } else {
        raw[o] = 0x5f
        raw[o + 1] = 0xdb
        raw[o + 2] = 0xff
      }
    }
  }
  // Um ponto de ruido de 1px no mar: tem de sumir.
  const o = (10 * width + 10) * 3
  raw[o] = 0x83
  raw[o + 1] = 0xe6
  raw[o + 2] = 0x4b
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer()
}

describe('extractTerrain', () => {
  it('separa terra e mar, reparte o traco e limpa o ruido', async () => {
    const result = await extractTerrain(await syntheticMap())
    expect(result.width).toBe(200)
    expect(result.height).toBe(100)
    expect(result.waterColor).toBe('#5fdbff')
    expect(result.landColor).toBe('#83e64b')
    expect(result.mask[50 * 200 + 120]).toBe(1) // centro do continente
    expect(result.mask[50 * 200 + 20]).toBe(0) // mar aberto
    expect(result.mask[10 * 200 + 10]).toBe(0) // ruido removido
    // O traco (raio 28..30) foi repartido: nenhum pixel ficou indefinido e a
    // area de terra fica entre o miolo e o contorno externo.
    const area = result.landPixels
    expect(area).toBeGreaterThan(Math.PI * 27 * 27)
    expect(area).toBeLessThan(Math.PI * 31 * 31)

    const { terrain, materials } = terrainFromExtraction(result, { landColor: '#112233' })
    expect(terrain[50 * 200 + 120]).toBe(1)
    expect(terrain[50 * 200 + 20]).toBe(0)
    expect(materials.find((m) => m.code === 1)).toMatchObject({ phase: 'solid', color: '#112233' })
    expect(materials.find((m) => m.code === 0)).toMatchObject({ phase: 'liquid', color: '#5fdbff' })
  })

  it('recusa imagem de uma cor so', async () => {
    const raw = Buffer.alloc(30 * 20 * 3, 200)
    const png = await sharp(raw, { raw: { width: 30, height: 20, channels: 3 } }).png().toBuffer()
    await expect(extractTerrain(png)).rejects.toThrow(/duas cores/)
  })

  it('reduz imagem maior que o limite do editor', async () => {
    const raw = Buffer.alloc(5000 * 10 * 3)
    for (let i = 0; i < 5000 * 10; i++) raw[i * 3 + 2] = i % 5000 > 2500 ? 255 : 0
    for (let i = 0; i < 5000 * 10; i++) raw[i * 3 + 1] = 180
    const png = await sharp(raw, { raw: { width: 5000, height: 10, channels: 3 } }).png().toBuffer()
    const result = await extractTerrain(png)
    expect(result.resized).toBe(true)
    expect(result.width).toBeLessThanOrEqual(4096)
  })
})
