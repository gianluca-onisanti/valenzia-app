import type { Rect } from '../types'

/**
 * O gabarito imutavel do mundo, vindo de `npm run prepare:map`. A mascara de
 * terra e o que impede a tinta de vazar para o mar (e vice-versa).
 */
export interface MapBase {
  width: number
  height: number
  /** 1 = terra, 0 = agua, indexado por `y * width + x`. */
  land: Uint8Array
  landColor: string
  waterColor: string
  coast: HTMLImageElement
}

/* ------------------------------------------------------------- retangulos */

export function rectOf(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x0, y0, x1, y1 }
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b
  if (!b) return a
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  }
}

/** Cresce o retangulo, sem sair da imagem. Usado para pegar as fronteiras. */
export function padRect(rect: Rect, pad: number, base: MapBase): Rect {
  return {
    x0: Math.max(0, rect.x0 - pad),
    y0: Math.max(0, rect.y0 - pad),
    x1: Math.min(base.width - 1, rect.x1 + pad),
    y1: Math.min(base.height - 1, rect.y1 + pad),
  }
}

/* ----------------------------------------------------------------- historia */

/**
 * Registro do que uma pincelada mudou, para o desfazer. Guarda indice e valor
 * anterior em arrays tipados: um balde pode alterar mais de um milhao de
 * pixels, e uma lista de objetos nessa escala comeria memoria demais.
 */
export class Journal {
  private idx: Int32Array
  private val: Uint16Array
  private n = 0

  constructor(capacity = 1 << 14) {
    this.idx = new Int32Array(capacity)
    this.val = new Uint16Array(capacity)
  }

  record(index: number, previous: number): void {
    if (this.n === this.idx.length) {
      const idx = new Int32Array(this.n * 2)
      const val = new Uint16Array(this.n * 2)
      idx.set(this.idx)
      val.set(this.val)
      this.idx = idx
      this.val = val
    }
    this.idx[this.n] = index
    this.val[this.n] = previous
    this.n++
  }

  get size(): number {
    return this.n
  }

  /** Memoria aproximada, para o historico saber quando descartar passos. */
  get bytes(): number {
    return this.idx.length * 4 + this.val.length * 2
  }

  /** Desfaz de tras para a frente, para aguentar o mesmo pixel repintado. */
  revert(layer: Uint16Array): void {
    for (let k = this.n - 1; k >= 0; k--) layer[this.idx[k]] = this.val[k]
  }

  area(width: number, height: number): Rect | null {
    if (this.n === 0) return null
    let x0 = width
    let y0 = height
    let x1 = 0
    let y1 = 0
    for (let k = 0; k < this.n; k++) {
      const i = this.idx[k]
      const x = i % width
      const y = (i - x) / width
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    return rectOf(x0, y0, x1, y1)
  }
}

/* ------------------------------------------------------------- ferramentas */

/**
 * Carimba um disco de tinta. `onLand` decide em que metade do mundo a tinta
 * pega: paises e biomas so na terra, mares so na agua. Devolve a area que
 * mudou de verdade, ou null se nada mudou.
 */
export function stampDisc(
  target: Uint16Array,
  base: MapBase,
  cx: number,
  cy: number,
  radius: number,
  value: number,
  onLand: boolean,
  journal?: Journal,
): Rect | null {
  const { width, height, land } = base
  const wanted = onLand ? 1 : 0
  const x0 = Math.max(0, Math.floor(cx - radius))
  const x1 = Math.min(width - 1, Math.ceil(cx + radius))
  const y0 = Math.max(0, Math.floor(cy - radius))
  const y1 = Math.min(height - 1, Math.ceil(cy + radius))
  const r2 = radius * radius
  let dirty: Rect | null = null

  for (let y = y0; y <= y1; y++) {
    const dy = y - cy
    const row = y * width
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx
      if (dx * dx + dy * dy > r2) continue
      const i = row + x
      if (land[i] !== wanted || target[i] === value) continue
      journal?.record(i, target[i])
      target[i] = value
      if (!dirty) dirty = rectOf(x, y, x, y)
      else {
        if (x < dirty.x0) dirty.x0 = x
        if (x > dirty.x1) dirty.x1 = x
        if (y < dirty.y0) dirty.y0 = y
        if (y > dirty.y1) dirty.y1 = y
      }
    }
  }
  return dirty
}

/**
 * Liga dois pontos com discos. Sem isso o traco sai pontilhado quando o mouse
 * se move rapido, porque o navegador nao entrega todos os pontos do caminho.
 */
export function stampStroke(
  target: Uint16Array,
  base: MapBase,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius: number,
  value: number,
  onLand: boolean,
  journal?: Journal,
): Rect | null {
  const dist = Math.hypot(toX - fromX, toY - fromY)
  const steps = Math.max(1, Math.ceil(dist / Math.max(1, radius * 0.4)))
  let dirty: Rect | null = null
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    dirty = unionRect(
      dirty,
      stampDisc(
        target,
        base,
        fromX + (toX - fromX) * t,
        fromY + (toY - fromY) * t,
        radius,
        value,
        onLand,
        journal,
      ),
    )
  }
  return dirty
}

let scratchQueue: Int32Array | null = null

/**
 * Balde de tinta: espalha a partir de (x,y) por todos os pixels vizinhos que
 * tenham o mesmo valor atual, sem atravessar a linha da costa. Clicar em
 * terra livre pinta a massa inteira; clicar dentro de um pais ja pintado
 * repinta aquele pais.
 */
export function bucketFill(
  target: Uint16Array,
  base: MapBase,
  x: number,
  y: number,
  value: number,
  onLand: boolean,
  journal?: Journal,
): Rect | null {
  const { width, height, land } = base
  const total = width * height
  const px = Math.floor(x)
  const py = Math.floor(y)
  if (px < 0 || py < 0 || px >= width || py >= height) return null

  const start = py * width + px
  const wanted = onLand ? 1 : 0
  if (land[start] !== wanted) return null
  const from = target[start]
  if (from === value) return null

  if (!scratchQueue || scratchQueue.length < total) {
    scratchQueue = new Int32Array(total)
  }
  const queue = scratchQueue
  let head = 0
  let tail = 0
  queue[tail++] = start
  journal?.record(start, from)
  target[start] = value
  const dirty = rectOf(px, py, px, py)

  while (head < tail) {
    const p = queue[head++]
    const cx = p % width
    const cy = (p - cx) / width
    if (cx < dirty.x0) dirty.x0 = cx
    if (cx > dirty.x1) dirty.x1 = cx
    if (cy < dirty.y0) dirty.y0 = cy
    if (cy > dirty.y1) dirty.y1 = cy

    if (cx > 0 && target[p - 1] === from && land[p - 1] === wanted) {
      journal?.record(p - 1, from)
      target[p - 1] = value
      queue[tail++] = p - 1
    }
    if (cx < width - 1 && target[p + 1] === from && land[p + 1] === wanted) {
      journal?.record(p + 1, from)
      target[p + 1] = value
      queue[tail++] = p + 1
    }
    if (cy > 0 && target[p - width] === from && land[p - width] === wanted) {
      journal?.record(p - width, from)
      target[p - width] = value
      queue[tail++] = p - width
    }
    if (cy < height - 1 && target[p + width] === from && land[p + width] === wanted) {
      journal?.record(p + width, from)
      target[p + width] = value
      queue[tail++] = p + width
    }
  }
  return dirty
}

/**
 * Preenche a area cercada por um traco livre.
 *
 * Em vez de decidir "dentro" por paridade de cruzamentos -- que abre buracos
 * quando o traco se cruza -- o caminho e rasterizado como uma cerca e a
 * inundacao comeca de fora da moldura. O que a agua de fora nao alcanca e o
 * miolo. Aguenta rabisco com no, laco em oito e volta por cima do proprio
 * traco, sempre com o resultado que a mao esperava.
 *
 * A cerca e desenhada em 8-vizinhos e a inundacao anda em 4-vizinhos: uma
 * diagonal da cerca entao veda de verdade, sem vazar pelo canto.
 */
export function fillPolygon(
  target: Uint16Array,
  base: MapBase,
  points: { x: number; y: number }[],
  value: number,
  onLand: boolean,
  journal?: Journal,
): Rect | null {
  const { width, height, land } = base
  if (points.length < 3) return null

  let bx0 = width
  let by0 = height
  let bx1 = 0
  let by1 = 0
  for (const p of points) {
    const px = Math.round(p.x)
    const py = Math.round(p.y)
    if (px < bx0) bx0 = px
    if (px > bx1) bx1 = px
    if (py < by0) by0 = py
    if (py > by1) by1 = py
  }
  // Uma folga de 1px garante uma moldura livre por onde a inundacao comeca.
  bx0 = Math.max(0, bx0 - 1)
  by0 = Math.max(0, by0 - 1)
  bx1 = Math.min(width - 1, bx1 + 1)
  by1 = Math.min(height - 1, by1 + 1)
  const w = bx1 - bx0 + 1
  const h = by1 - by0 + 1
  if (w < 3 || h < 3) return null

  const fence = new Uint8Array(w * h)
  const mark = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    fence[y * w + x] = 1
  }
  const line = (ax: number, ay: number, bx: number, by: number) => {
    let x0 = Math.round(ax) - bx0
    let y0 = Math.round(ay) - by0
    const x1 = Math.round(bx) - bx0
    const y1 = Math.round(by) - by0
    const dx = Math.abs(x1 - x0)
    const dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    for (;;) {
      mark(x0, y0)
      if (x0 === x1 && y0 === y1) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x0 += sx
      }
      if (e2 <= dx) {
        err += dx
        y0 += sy
      }
    }
  }
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    line(a.x, a.y, b.x, b.y)
  }

  // Inunda a partir da moldura: tudo que ela alcanca esta do lado de fora.
  const outside = new Uint8Array(w * h)
  const queue = new Int32Array(w * h)
  let head = 0
  let tail = 0
  const push = (i: number) => {
    if (outside[i] || fence[i]) return
    outside[i] = 1
    queue[tail++] = i
  }
  for (let x = 0; x < w; x++) {
    push(x)
    push((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    push(y * w)
    push(y * w + w - 1)
  }
  while (head < tail) {
    const p = queue[head++]
    const x = p % w
    const y = (p - x) / w
    if (x > 0) push(p - 1)
    if (x < w - 1) push(p + 1)
    if (y > 0) push(p - w)
    if (y < h - 1) push(p + w)
  }

  const wanted = onLand ? 1 : 0
  let dirty: Rect | null = null
  for (let y = 0; y < h; y++) {
    const srcRow = (by0 + y) * width + bx0
    const localRow = y * w
    for (let x = 0; x < w; x++) {
      if (outside[localRow + x]) continue
      const i = srcRow + x
      if (land[i] !== wanted || target[i] === value) continue
      journal?.record(i, target[i])
      target[i] = value
      const gx = bx0 + x
      const gy = by0 + y
      if (!dirty) dirty = rectOf(gx, gy, gx, gy)
      else {
        if (gx < dirty.x0) dirty.x0 = gx
        if (gx > dirty.x1) dirty.x1 = gx
        if (gy < dirty.y0) dirty.y0 = gy
        if (gy > dirty.y1) dirty.y1 = gy
      }
    }
  }
  return dirty
}

/** Apaga todos os pixels de um slot. Usado ao excluir um pais ou bioma. */
export function clearSlot(
  target: Uint16Array,
  width: number,
  slot: number,
  journal?: Journal,
): Rect | null {
  let dirty: Rect | null = null
  for (let i = 0; i < target.length; i++) {
    if (target[i] !== slot) continue
    journal?.record(i, slot)
    target[i] = 0
    const x = i % width
    const y = (i - x) / width
    if (!dirty) dirty = rectOf(x, y, x, y)
    else {
      if (x < dirty.x0) dirty.x0 = x
      if (x > dirty.x1) dirty.x1 = x
      if (y < dirty.y0) dirty.y0 = y
      if (y > dirty.y1) dirty.y1 = y
    }
  }
  return dirty
}

/** Quantos pixels cada slot ocupa, para mostrar area e achar o centro. */
export function measureSlots(
  layer: Uint16Array,
  width: number,
): Map<number, { area: number; bbox: Rect; sumX: number; sumY: number }> {
  const stats = new Map<
    number,
    { area: number; bbox: Rect; sumX: number; sumY: number }
  >()
  for (let i = 0; i < layer.length; i++) {
    const slot = layer[i]
    if (slot === 0) continue
    const x = i % width
    const y = (i - x) / width
    let s = stats.get(slot)
    if (!s) {
      s = { area: 0, bbox: rectOf(x, y, x, y), sumX: 0, sumY: 0 }
      stats.set(slot, s)
    }
    s.area++
    s.sumX += x
    s.sumY += y
    if (x < s.bbox.x0) s.bbox.x0 = x
    if (x > s.bbox.x1) s.bbox.x1 = x
    if (y < s.bbox.y0) s.bbox.y0 = y
    if (y > s.bbox.y1) s.bbox.y1 = y
  }
  return stats
}

/**
 * Procura um ponto que realmente pertenca ao slot, perto do centro de massa.
 * O centro puro cai fora em paises com formato de C, entao caminhamos em
 * espiral ate achar pixel do slot.
 */
export function anchorOf(
  layer: Uint16Array,
  width: number,
  height: number,
  slot: number,
  stats: { area: number; bbox: Rect; sumX: number; sumY: number },
): [number, number] {
  const cx = Math.round(stats.sumX / stats.area)
  const cy = Math.round(stats.sumY / stats.area)
  if (layer[cy * width + cx] === slot) return [cx, cy]
  const maxR = Math.max(
    stats.bbox.x1 - stats.bbox.x0,
    stats.bbox.y1 - stats.bbox.y0,
  )
  for (let r = 4; r <= maxR; r += 4) {
    for (let a = 0; a < 16; a++) {
      const angle = (a / 16) * Math.PI * 2
      const x = Math.round(cx + Math.cos(angle) * r)
      const y = Math.round(cy + Math.sin(angle) * r)
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      if (layer[y * width + x] === slot) return [x, y]
    }
  }
  return [cx, cy]
}

/* --------------------------------------------------------------- desenho */

export interface Palette {
  land: [number, number, number]
  water: [number, number, number]
  /** Cor por slot, em triplas; indice = slot * 3. */
  territory: Uint8Array
  biome: Uint8Array
}

/**
 * - politica: so as cores dos paises e mares.
 * - biomas:   so as cores dos biomas, mas as fronteiras continuam visiveis.
 * - mista:    as duas juntas, com o bioma em hachura por cima do pais.
 */
export type ViewMode = 'politica' | 'biomas' | 'mista'

export interface ViewOptions {
  mode: ViewMode
  showBorders: boolean
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Repinta um pedaco da textura composta. So este retangulo e recalculado a
 * cada pincelada -- repintar os 7,7M de pixels do mapa a cada movimento do
 * mouse seria inviavel.
 */
export function paintComposite(
  ctx: CanvasRenderingContext2D,
  base: MapBase,
  territory: Uint16Array,
  biome: Uint16Array,
  palette: Palette,
  view: ViewOptions,
  rect: Rect,
): void {
  const { width, height, land } = base
  const x0 = Math.max(0, rect.x0)
  const y0 = Math.max(0, rect.y0)
  const x1 = Math.min(width - 1, rect.x1)
  const y1 = Math.min(height - 1, rect.y1)
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  if (w <= 0 || h <= 0) return

  const image = ctx.createImageData(w, h)
  const out = image.data
  const [lr, lg, lb] = palette.land
  const [wr, wg, wb] = palette.water

  const showTerritory = view.mode !== 'biomas'
  const showBiomes = view.mode !== 'politica'
  // A hachura existe para deixar a cor do pais aparecer por baixo. Na visao
  // de biomas nao ha pais embaixo, entao a cor entra chapada.
  const hatched = view.mode === 'mista'
  const biomeMix = hatched ? 65 : 88

  for (let y = y0; y <= y1; y++) {
    const row = y * width
    const dstRow = (y - y0) * w
    for (let x = x0; x <= x1; x++) {
      const i = row + x
      const isLand = land[i] === 1
      let r = isLand ? lr : wr
      let g = isLand ? lg : wg
      let b = isLand ? lb : wb

      const slot = territory[i]
      if (slot !== 0 && showTerritory) {
        const o = slot * 3
        // Mistura forte, mas deixa passar um pouco do verde/azul do mundo.
        r = (r * 22 + palette.territory[o] * 78) / 100
        g = (g * 22 + palette.territory[o + 1] * 78) / 100
        b = (b * 22 + palette.territory[o + 2] * 78) / 100
      }

      if (showBiomes) {
        const bio = biome[i]
        // Faixa diagonal larga: nao cria moire quando o mapa e visto de longe.
        if (bio !== 0 && (!hatched || ((x + y) & 15) < 7)) {
          const o = bio * 3
          const keep = 100 - biomeMix
          r = (r * keep + palette.biome[o] * biomeMix) / 100
          g = (g * keep + palette.biome[o + 1] * biomeMix) / 100
          b = (b * keep + palette.biome[o + 2] * biomeMix) / 100
        }
      }

      if (view.showBorders && slot !== 0) {
        const differs =
          (x > 0 && territory[i - 1] !== slot) ||
          (x < width - 1 && territory[i + 1] !== slot) ||
          (y > 0 && territory[i - width] !== slot) ||
          (y < height - 1 && territory[i + width] !== slot)
        if (differs) {
          r *= 0.45
          g *= 0.45
          b *= 0.45
        }
      }

      const o = (dstRow + (x - x0)) * 4
      out[o] = r
      out[o + 1] = g
      out[o + 2] = b
      out[o + 3] = 255
    }
  }
  ctx.putImageData(image, x0, y0)
}
