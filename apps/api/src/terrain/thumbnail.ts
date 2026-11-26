import sharp from 'sharp'
import type { Material, Territory } from '@valenzia/shared'

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Miniatura de um corpo recem-criado, para o atlas ja ter previa antes do
 * primeiro Salvar. Cores chapadas -- sem textura nem fronteira; o Salvar do
 * editor depois troca por uma copia fiel do que aparece na tela.
 */
export async function renderThumbnail(
  terrain: Uint16Array,
  width: number,
  height: number,
  materials: Material[],
  territory?: { layer: Uint16Array; entities: Territory[] },
  thumbWidth = 512,
): Promise<Buffer> {
  const ground = new Map(materials.map((m) => [m.code, rgb(m.color)]))
  const paint = new Map((territory?.entities ?? []).map((t) => [t.slot, rgb(t.color)]))
  const raw = Buffer.alloc(width * height * 3)
  for (let i = 0; i < terrain.length; i++) {
    let [r, g, b] = ground.get(terrain[i]) ?? [128, 128, 128]
    const over = territory ? paint.get(territory.layer[i]) : undefined
    if (over) {
      // A mesma mistura do editor: 78% da tinta, 22% do chao.
      r = (r * 22 + over[0] * 78) / 100
      g = (g * 22 + over[1] * 78) / 100
      b = (b * 22 + over[2] * 78) / 100
    }
    raw[i * 3] = r
    raw[i * 3 + 1] = g
    raw[i * 3 + 2] = b
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .resize({ width: Math.min(thumbWidth, width) })
    .png({ compressionLevel: 9 })
    .toBuffer()
}
