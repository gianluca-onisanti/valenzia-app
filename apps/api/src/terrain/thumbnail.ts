import sharp from 'sharp'
import { applyTexture, compileTexture, type Material, type Territory } from '@valenzia/shared'

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Miniatura de um corpo recem-criado, para o atlas (e o ceu do globo dos
 * vizinhos) ja terem imagem antes do primeiro Salvar. Desenhada direto no
 * tamanho final, amostrando o mapa, com as mesmas texturas do editor; sem
 * fronteiras. O Salvar do editor depois troca por uma copia fiel da tela.
 */
export async function renderThumbnail(
  terrain: Uint16Array,
  width: number,
  height: number,
  materials: Material[],
  territory?: { layer: Uint16Array; entities: Territory[] },
  thumbWidth = 512,
): Promise<Buffer> {
  const tw = Math.min(thumbWidth, width)
  const th = Math.max(1, Math.round((height * tw) / width))
  const ground = new Map(
    materials.map((m) => [m.code, { color: rgb(m.color), texture: compileTexture(m.texture, rgb) }]),
  )
  const paint = new Map((territory?.entities ?? []).map((t) => [t.slot, rgb(t.color)]))
  const raw = Buffer.alloc(tw * th * 3)
  const out: [number, number, number] = [0, 0, 0]

  for (let y = 0; y < th; y++) {
    const my = Math.min(height - 1, Math.floor(((y + 0.5) * height) / th))
    for (let x = 0; x < tw; x++) {
      const mx = Math.min(width - 1, Math.floor(((x + 0.5) * width) / tw))
      const i = my * width + mx
      const g = ground.get(terrain[i])
      let r = 128
      let gr = 128
      let b = 128
      if (g) {
        ;[r, gr, b] = g.color
        if (g.texture) {
          applyTexture(g.texture, mx, my, r, gr, b, out)
          ;[r, gr, b] = out
        }
      }
      const over = territory ? paint.get(territory.layer[i]) : undefined
      if (over) {
        // A mesma mistura do editor: 78% da tinta, 22% do chao.
        r = (r * 22 + over[0] * 78) / 100
        gr = (gr * 22 + over[1] * 78) / 100
        b = (b * 22 + over[2] * 78) / 100
      }
      const o = (y * tw + x) * 3
      raw[o] = Math.min(255, Math.max(0, r))
      raw[o + 1] = Math.min(255, Math.max(0, gr))
      raw[o + 2] = Math.min(255, Math.max(0, b))
    }
  }
  return sharp(raw, { raw: { width: tw, height: th, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toBuffer()
}
