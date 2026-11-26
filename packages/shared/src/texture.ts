import type { TextureSpec } from './domain'

/**
 * Texturas procedurais dos materiais de terreno.
 *
 * Nada de imagem: um bloco de ruido de 256x256, calculado uma vez e repetido,
 * basta para tirar a cor chapada do oceano ou da rocha. O mesmo bloco serve a
 * todos os padroes -- ruido, faixas de gigante gasoso e crateras --, e o
 * resultado e deterministico: o mesmo pixel sai sempre igual, em qualquer
 * repintura parcial.
 */

const SIZE = 256
const MASK = SIZE - 1

/** Inteiro pseudoaleatorio de 0 a 1, estavel para cada vertice da grade. */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 982451653) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967295
}

/**
 * Ruido de valor fractal que se repete a cada SIZE pixels nas duas direcoes,
 * sem emenda: cada oitava usa uma grade que divide SIZE certinho.
 */
function buildTile(seed: number): Float32Array {
  const tile = new Float32Array(SIZE * SIZE)
  let amplitude = 1
  let total = 0
  for (let octave = 0; octave < 5; octave++) {
    const cells = 4 << octave
    const step = SIZE / cells
    for (let y = 0; y < SIZE; y++) {
      const gy = y / step
      const y0 = Math.floor(gy)
      const ty = gy - y0
      const sy = ty * ty * (3 - 2 * ty)
      for (let x = 0; x < SIZE; x++) {
        const gx = x / step
        const x0 = Math.floor(gx)
        const tx = gx - x0
        const sx = tx * tx * (3 - 2 * tx)
        const a = hash(x0 % cells, y0 % cells, seed + octave)
        const b = hash((x0 + 1) % cells, y0 % cells, seed + octave)
        const c = hash(x0 % cells, (y0 + 1) % cells, seed + octave)
        const d = hash((x0 + 1) % cells, (y0 + 1) % cells, seed + octave)
        const top = a + (b - a) * sx
        const bottom = c + (d - c) * sx
        tile[y * SIZE + x] += (top + (bottom - top) * sy) * amplitude
      }
    }
    total += amplitude
    amplitude *= 0.5
  }
  for (let i = 0; i < tile.length; i++) tile[i] /= total
  return tile
}

let tiles: [Float32Array] | null = null

function noiseTiles(): [Float32Array] {
  if (!tiles) tiles = [buildTile(17)]
  return tiles
}

/** Amostra o bloco com escala: `scale` e o tamanho do padrao no mapa. */
function sample(tile: Float32Array, x: number, y: number, scale: number): number {
  const u = (x * SIZE) / (scale * 4)
  const v = (y * SIZE) / (scale * 4)
  const x0 = Math.floor(u)
  const y0 = Math.floor(v)
  const fx = u - x0
  const fy = v - y0
  const i00 = (y0 & MASK) * SIZE + (x0 & MASK)
  const i10 = (y0 & MASK) * SIZE + ((x0 + 1) & MASK)
  const i01 = ((y0 + 1) & MASK) * SIZE + (x0 & MASK)
  const i11 = ((y0 + 1) & MASK) * SIZE + ((x0 + 1) & MASK)
  const top = tile[i00] + (tile[i10] - tile[i00]) * fx
  const bottom = tile[i01] + (tile[i11] - tile[i01]) * fx
  return top + (bottom - top) * fy
}

export const PATTERN_IDS = ['liso', 'ruido', 'faixas', 'crateras'] as const

export const PATTERN_LABELS: Record<TextureSpec['pattern'], string> = {
  liso: 'Liso',
  ruido: 'Ruido',
  faixas: 'Faixas',
  crateras: 'Crateras',
}

/** Textura ja decodificada, pronta para o laco de pixels. */
export interface CompiledTexture {
  kind: 0 | 1 | 2 | 3
  /** Cor secundaria; sem ela, o padrao so clareia e escurece. */
  r2: number
  g2: number
  b2: number
  hasColor2: boolean
  intensity: number
  scale: number
}

const KIND: Record<TextureSpec['pattern'], CompiledTexture['kind']> = {
  liso: 0,
  ruido: 1,
  faixas: 2,
  crateras: 3,
}

export function compileTexture(
  spec: TextureSpec | null | undefined,
  hexToRgb: (hex: string) => [number, number, number],
): CompiledTexture | null {
  if (!spec || spec.pattern === 'liso') return null
  const [r2, g2, b2] = spec.color2 ? hexToRgb(spec.color2) : [0, 0, 0]
  return {
    kind: KIND[spec.pattern],
    r2,
    g2,
    b2,
    hasColor2: Boolean(spec.color2),
    intensity: spec.intensity ?? 0.5,
    scale: spec.scale ?? 64,
  }
}

/**
 * Ruido sem repeticao visivel: o bloco repete a cada 4x a escala, entao soma
 * uma segunda amostra numa escala que nao divide a primeira (x2,7) e com
 * deslocamento. O olho deixa de achar o padrao.
 */
function fbm(tile: Float32Array, x: number, y: number, scale: number): number {
  return (
    sample(tile, x, y, scale) * 0.65 +
    sample(tile, x * 0.37 + 913, y * 0.37 + 557, scale) * 0.35
  )
}

/**
 * Crateras de verdade: o mapa e dividido em celulas do tamanho da escala, e
 * cada celula tem (ou nao) uma cratera redonda, com centro e raio sorteados.
 * Devolve -1 no fundo, +1 na borda e 0 fora de qualquer cratera.
 */
function crater(x: number, y: number, scale: number): number {
  const cx = Math.floor(x / scale)
  const cy = Math.floor(y / scale)
  let result = 0
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = cx + i
      const gy = cy + j
      if (hash(gx, gy, 7) < 0.45) continue
      const ox = (gx + 0.2 + hash(gx, gy, 11) * 0.6) * scale
      const oy = (gy + 0.2 + hash(gx, gy, 13) * 0.6) * scale
      const r = scale * (0.12 + hash(gx, gy, 17) * 0.38)
      const d = Math.hypot(x - ox, y - oy) / r
      if (d < 0.82) return -1
      if (d < 1) result = 1
    }
  }
  return result
}

/**
 * Aplica a textura a uma cor, no lugar: devolve a cor final do pixel (x, y)
 * em `out`. Com segunda cor, mistura rumo a ela; sem, clareia ou escurece.
 */
export function applyTexture(
  tex: CompiledTexture,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  out: [number, number, number],
): void {
  const [n1] = noiseTiles()
  let t: number // -1..1 sem segunda cor; 0..1 com ela
  if (tex.kind === 1) {
    const n = fbm(n1, x, y, tex.scale)
    t = tex.hasColor2 ? n : (n - 0.5) * 2
  } else if (tex.kind === 2) {
    // Faixas horizontais, tortas pela turbulencia: o jeito de Jupiter.
    const warp = (fbm(n1, x, y, tex.scale) - 0.5) * 5
    const v = Math.sin((y / tex.scale) * Math.PI + warp)
    t = tex.hasColor2 ? 0.5 + 0.5 * v : v
  } else {
    // Crateras: fundo escuro, borda clara, e um ruido leve no resto.
    const c = crater(x, y, tex.scale)
    const grain = (fbm(n1, x, y, tex.scale * 0.5) - 0.5) * 0.5
    if (tex.hasColor2) t = c === -1 ? 0.85 : c === 1 ? 0 : Math.max(0, grain)
    else t = c === -1 ? -0.75 : c === 1 ? 0.7 : grain
  }
  const k = tex.intensity
  if (tex.hasColor2) {
    const m = t * k
    out[0] = r + (tex.r2 - r) * m
    out[1] = g + (tex.g2 - g) * m
    out[2] = b + (tex.b2 - b) * m
  } else {
    const f = 1 + t * k * 0.45
    out[0] = r * f
    out[1] = g * f
    out[2] = b * f
  }
}
