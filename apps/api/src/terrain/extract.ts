/**
 * Gabarito a partir de uma imagem.
 *
 * Le uma imagem crua -- terra de uma cor, oceano de outra, costa desenhada
 * em preto -- e responde, para cada pixel, "terra ou mar?". E o antigo
 * `scripts/prepare.mjs`, agora rodando dentro da API e so em memoria: a
 * imagem enviada pela interface e lida, vira camada de terreno, e e
 * descartada. Nada e gravado em disco.
 */
import sharp, { type Metadata } from 'sharp'
import { MAX_MAP_HEIGHT, MAX_MAP_WIDTH, type Material } from '@valenzia/shared'
import { badRequest } from '../errors'

/**
 * Abaixo deste valor (o maximo do RGB) o pixel e traco de costa, nao terra
 * nem mar. O criterio e o valor e nao a luminancia porque cores saturadas
 * podem ser escuras em luminancia sem serem pretas.
 */
export const INK_VALUE = 105
/**
 * Manchas conexas menores que isto sao ruido de antialias, nao geografia:
 * um pontinho de 1px nao da para clicar nem pintar.
 */
export const MIN_FEATURE = 32

interface Rgb {
  r: number
  g: number
  b: number
}

function value(r: number, g: number, b: number): number {
  return r > g ? (r > b ? r : b) : g > b ? g : b
}

export function hex({ r, g, b }: Rgb): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

/**
 * As duas cores que dominam a imagem. A agua e a que toca o canto superior
 * esquerdo; a outra e a terra.
 */
function findColors(data: Buffer, total: number, channels: number) {
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (let i = 0; i < total; i++) {
    const o = i * channels
    const r = data[o]
    const g = data[o + 1]
    const b = data[o + 2]
    if (value(r, g, b) < INK_VALUE) continue
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const prev = counts.get(key)
    if (prev) {
      prev.n++
      prev.r += r
      prev.g += g
      prev.b += b
    } else {
      counts.set(key, { n: 1, r, g, b })
    }
  }
  const ranked = [...counts.values()]
    .map((c) => ({
      r: Math.round(c.r / c.n),
      g: Math.round(c.g / c.n),
      b: Math.round(c.b / c.n),
      n: c.n,
    }))
    .sort((a, b) => b.n - a.n)

  if (ranked.length < 2) {
    throw badRequest('A imagem precisa ter duas cores: uma de terra e uma de mar.')
  }

  const corner = { r: data[0], g: data[1], b: data[2] }
  const dist = (c: Rgb) => (c.r - corner.r) ** 2 + (c.g - corner.g) ** 2 + (c.b - corner.b) ** 2
  // O canto superior esquerdo e mar aberto, por convencao.
  const top = ranked.slice(0, 6)
  const water = top.reduce((best, c) => (dist(c) < dist(best) ? c : best), top[0])
  const land = top.find((c) => c !== water)!
  return { land, water }
}

/**
 * Troca de lado toda mancha conexa menor que MIN_FEATURE. Le e escreve na
 * propria mascara (1 terra, 0 mar).
 */
function despeckle(mask: Uint8Array, width: number, height: number): void {
  const total = width * height
  const seen = new Uint8Array(total)
  const stack = new Int32Array(total)
  const members: number[] = []

  for (let seed = 0; seed < total; seed++) {
    if (seen[seed]) continue
    const side = mask[seed]
    let sp = 0
    stack[sp++] = seed
    seen[seed] = 1
    members.length = 0
    while (sp > 0) {
      const p = stack[--sp]
      members.push(p)
      const x = p % width
      const y = (p - x) / width
      if (x > 0 && !seen[p - 1] && mask[p - 1] === side) {
        seen[p - 1] = 1
        stack[sp++] = p - 1
      }
      if (x < width - 1 && !seen[p + 1] && mask[p + 1] === side) {
        seen[p + 1] = 1
        stack[sp++] = p + 1
      }
      if (y > 0 && !seen[p - width] && mask[p - width] === side) {
        seen[p - width] = 1
        stack[sp++] = p - width
      }
      if (y < height - 1 && !seen[p + width] && mask[p + width] === side) {
        seen[p + width] = 1
        stack[sp++] = p + width
      }
    }
    if (members.length >= MIN_FEATURE) continue
    const flipped = side === 1 ? 0 : 1
    for (const p of members) mask[p] = flipped
  }
}

export interface Extraction {
  width: number
  height: number
  /** 1 = terra, 0 = mar. */
  mask: Uint8Array
  landColor: string
  waterColor: string
  landPixels: number
  /** A imagem passou do tamanho maximo e foi reduzida. */
  resized: boolean
  /** A mascara em preto e branco, reduzida, para conferir antes de criar. */
  previewPng: () => Promise<Buffer>
}

export async function extractTerrain(image: Buffer): Promise<Extraction> {
  let pipeline = sharp(image, { failOn: 'error' })
  let meta: Metadata
  try {
    meta = await pipeline.metadata()
  } catch {
    throw badRequest('Nao consegui ler a imagem. Envie PNG, JPG ou WebP.')
  }
  if (!meta.width || !meta.height) throw badRequest('Imagem sem dimensoes')

  const resized = meta.width > MAX_MAP_WIDTH || meta.height > MAX_MAP_HEIGHT
  if (resized) {
    pipeline = pipeline.resize({
      width: MAX_MAP_WIDTH,
      height: MAX_MAP_HEIGHT,
      fit: 'inside',
    })
  }

  const { data, info } = await pipeline
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  if (channels < 3) throw badRequest('A imagem precisa ser colorida (RGB).')
  const total = width * height

  const { land, water } = findColors(data, total, channels)

  // -1 = traco de costa, resolvido logo abaixo; 1 = terra; 0 = mar.
  const work = new Int8Array(total)
  for (let i = 0; i < total; i++) {
    const o = i * channels
    const r = data[o]
    const g = data[o + 1]
    const b = data[o + 2]
    if (value(r, g, b) < INK_VALUE) {
      work[i] = -1
      continue
    }
    const dl = (r - land.r) ** 2 + (g - land.g) ** 2 + (b - land.b) ** 2
    const dw = (r - water.r) ** 2 + (g - water.g) ** 2 + (b - water.b) ** 2
    work[i] = dl <= dw ? 1 : 0
  }

  // O traco da costa e repartido entre terra e mar pela vizinhanca: cada
  // pixel escuro vai para o lado mais proximo, e nao sobra pixel indefinido.
  const queue = new Int32Array(total)
  let head = 0
  let tail = 0
  for (let i = 0; i < total; i++) {
    if (work[i] === -1) continue
    const x = i % width
    const y = (i - x) / width
    if (
      (x > 0 && work[i - 1] === -1) ||
      (x < width - 1 && work[i + 1] === -1) ||
      (y > 0 && work[i - width] === -1) ||
      (y < height - 1 && work[i + width] === -1)
    ) {
      queue[tail++] = i
    }
  }
  while (head < tail) {
    const p = queue[head++]
    const v = work[p]
    const x = p % width
    const y = (p - x) / width
    if (x > 0 && work[p - 1] === -1) {
      work[p - 1] = v
      queue[tail++] = p - 1
    }
    if (x < width - 1 && work[p + 1] === -1) {
      work[p + 1] = v
      queue[tail++] = p + 1
    }
    if (y > 0 && work[p - width] === -1) {
      work[p - width] = v
      queue[tail++] = p - width
    }
    if (y < height - 1 && work[p + width] === -1) {
      work[p + width] = v
      queue[tail++] = p + width
    }
  }

  const mask = new Uint8Array(total)
  // Imagem toda de traco (nenhum vizinho resolvido): vira mar.
  for (let i = 0; i < total; i++) mask[i] = work[i] === 1 ? 1 : 0
  despeckle(mask, width, height)

  let landPixels = 0
  for (let i = 0; i < total; i++) landPixels += mask[i]

  return {
    width,
    height,
    mask,
    landColor: hex(land),
    waterColor: hex(water),
    landPixels,
    resized,
    previewPng: async () => {
      const gray = Buffer.alloc(total)
      for (let i = 0; i < total; i++) gray[i] = mask[i] ? 255 : 0
      return sharp(gray, { raw: { width, height, channels: 1 } })
        .resize({ width: Math.min(width, 1024) })
        .png({ compressionLevel: 9 })
        .toBuffer()
    },
  }
}

/** Codigos de terreno de um mapa vindo de imagem: 0 e o mar, 1 e a terra. */
export const WATER_CODE = 0
export const LAND_CODE = 1

/** A mascara vira camada de terreno com dois materiais. */
export function terrainFromExtraction(
  result: Pick<Extraction, 'mask' | 'landColor' | 'waterColor'>,
  colors: { landColor?: string; waterColor?: string } = {},
): { terrain: Uint16Array; materials: Material[] } {
  const terrain = new Uint16Array(result.mask.length)
  for (let i = 0; i < terrain.length; i++) {
    terrain[i] = result.mask[i] ? LAND_CODE : WATER_CODE
  }
  return {
    terrain,
    materials: [
      {
        code: WATER_CODE,
        name: 'Mar',
        phase: 'liquid',
        color: colors.waterColor ?? result.waterColor,
      },
      {
        code: LAND_CODE,
        name: 'Terra',
        phase: 'solid',
        color: colors.landColor ?? result.landColor,
      },
    ],
  }
}
