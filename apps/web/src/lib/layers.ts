import {
  PHASE_BIT,
  applyTexture,
  compileTexture,
  type CompiledTexture,
  type Material,
} from '@valenzia/shared'
import type { Rect } from '../types'

/**
 * O gabarito do mundo: dimensoes e a camada de terreno.
 *
 * O terreno guarda, em cada pixel, o codigo de um material (mar, rocha,
 * gas...). E do mesmo tipo das outras camadas justamente para reaproveitar
 * pincel, balde, laco e desfazer. O que um material e -- solido, liquido ou
 * gasoso -- vem de `phaseBit`, consultado por codigo: e ele que impede a
 * tinta de um pais de vazar para o mar.
 */
export interface MapBase {
  width: number
  height: number
  /** Codigo do material em cada pixel, indexado por `y * width + x`. */
  terrain: Uint16Array
  /**
   * Bit da fase (PHASE_BIT) de cada codigo de material; 0 para codigo sem
   * material. Alterado no lugar por `syncPhases` quando os materiais mudam.
   */
  phaseBit: Uint8Array
}

export function createMapBase(width: number, height: number): MapBase {
  return {
    width,
    height,
    terrain: new Uint16Array(width * height),
    phaseBit: new Uint8Array(65536),
  }
}

/** Atualiza a tabela de fases depois de criar, editar ou excluir material. */
export function syncPhases(base: MapBase, materials: Material[]): void {
  base.phaseBit.fill(0)
  for (const m of materials) base.phaseBit[m.code] = PHASE_BIT[m.phase]
}

/**
 * Onde a tinta pode pegar: uma mascara de bits de fase (PHASE_BIT), ou null
 * para qualquer lugar. Pais = solido, mar = liquido, zona = gas, terreno =
 * qualquer lugar.
 */
export type Stencil = number | null

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
 * Carimba um disco de tinta, respeitando o estencil. Devolve a area que
 * mudou de verdade, ou null se nada mudou.
 */
export function stampDisc(
  target: Uint16Array,
  base: MapBase,
  cx: number,
  cy: number,
  radius: number,
  value: number,
  allowed: Stencil,
  journal?: Journal,
): Rect | null {
  const { width, height, terrain, phaseBit } = base
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
      if (target[i] === value) continue
      if (allowed !== null && (phaseBit[terrain[i]] & allowed) === 0) continue
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
  allowed: Stencil,
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
        allowed,
        journal,
      ),
    )
  }
  return dirty
}

let scratchQueue: Int32Array | null = null

/**
 * Balde de tinta: espalha a partir de (x,y) por todos os pixels vizinhos que
 * tenham o mesmo valor atual, sem sair da fase permitida. Clicar em terra
 * livre pinta a massa inteira; clicar dentro de um pais ja pintado repinta
 * aquele pais.
 */
export function bucketFill(
  target: Uint16Array,
  base: MapBase,
  x: number,
  y: number,
  value: number,
  allowed: Stencil,
  journal?: Journal,
): Rect | null {
  const { width, height, terrain, phaseBit } = base
  const total = width * height
  const px = Math.floor(x)
  const py = Math.floor(y)
  if (px < 0 || py < 0 || px >= width || py >= height) return null

  const start = py * width + px
  const ok = (i: number) => allowed === null || (phaseBit[terrain[i]] & allowed) !== 0
  if (!ok(start)) return null
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

    if (cx > 0 && target[p - 1] === from && ok(p - 1)) {
      journal?.record(p - 1, from)
      target[p - 1] = value
      queue[tail++] = p - 1
    }
    if (cx < width - 1 && target[p + 1] === from && ok(p + 1)) {
      journal?.record(p + 1, from)
      target[p + 1] = value
      queue[tail++] = p + 1
    }
    if (cy > 0 && target[p - width] === from && ok(p - width)) {
      journal?.record(p - width, from)
      target[p - width] = value
      queue[tail++] = p - width
    }
    if (cy < height - 1 && target[p + width] === from && ok(p + width)) {
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
 *
 * O traco pode sair do mapa (contornar uma ilha colada na borda, por
 * exemplo). A grade local entao passa um pixel da borda: os pontos de fora
 * sao trazidos para essa faixa, a cerca continua fechada, e so o que cai
 * dentro do mapa e pintado.
 */
export function fillPolygon(
  target: Uint16Array,
  base: MapBase,
  points: { x: number; y: number }[],
  value: number,
  allowed: Stencil,
  journal?: Journal,
): Rect | null {
  const { width, height, terrain, phaseBit } = base
  if (points.length < 3) return null

  // Fora do mapa, so interessa a faixa de 1px colada na borda.
  const pts = points.map((p) => ({
    x: Math.min(width, Math.max(-1, Math.round(p.x))),
    y: Math.min(height, Math.max(-1, Math.round(p.y))),
  }))
  let bx0 = width
  let by0 = height
  let bx1 = -1
  let by1 = -1
  for (const p of pts) {
    if (p.x < bx0) bx0 = p.x
    if (p.x > bx1) bx1 = p.x
    if (p.y < by0) by0 = p.y
    if (p.y > by1) by1 = p.y
  }
  // Uma folga de 1px garante uma moldura livre por onde a inundacao comeca.
  bx0 -= 1
  by0 -= 1
  bx1 += 1
  by1 += 1
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
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
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

  let dirty: Rect | null = null
  for (let y = 0; y < h; y++) {
    const gy = by0 + y
    if (gy < 0 || gy >= height) continue
    const localRow = y * w
    for (let x = 0; x < w; x++) {
      if (outside[localRow + x]) continue
      const gx = bx0 + x
      if (gx < 0 || gx >= width) continue
      const i = gy * width + gx
      if (target[i] === value) continue
      if (allowed !== null && (phaseBit[terrain[i]] & allowed) === 0) continue
      journal?.record(i, target[i])
      target[i] = value
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

/**
 * Depois de mexer no terreno, tira a tinta que ficou do lado errado.
 *
 * Carvar um canal no meio de um pais deixaria o pais pintado por cima da
 * agua nova; aterrar o mar deixaria um mar pintado em terra firme. Como o
 * estencil so vale na hora de pintar, a arrumacao tem de vir depois -- e so
 * dentro do retangulo mexido, nunca no mapa inteiro.
 *
 * `slotBit` diz em que fase cada territorio pode existir (PHASE_BIT do tipo
 * dele). Bioma so existe em solido.
 */
export function reconcileTerrain(
  base: MapBase,
  territory: Uint16Array,
  biome: Uint16Array,
  rect: Rect,
  slotBit: (slot: number) => number,
  journalTerritory?: Journal,
  journalBiome?: Journal,
): { territory: Rect | null; biome: Rect | null } {
  const { width, terrain, phaseBit } = base
  const solid = PHASE_BIT.solid
  let dirtyT: Rect | null = null
  let dirtyB: Rect | null = null
  for (let y = rect.y0; y <= rect.y1; y++) {
    const row = y * width
    for (let x = rect.x0; x <= rect.x1; x++) {
      const i = row + x
      const bit = phaseBit[terrain[i]]
      const slot = territory[i]
      if (slot !== 0 && (slotBit(slot) & bit) === 0) {
        journalTerritory?.record(i, slot)
        territory[i] = 0
        dirtyT = unionRect(dirtyT, rectOf(x, y, x, y))
      }
      if (biome[i] !== 0 && bit !== solid) {
        journalBiome?.record(i, biome[i])
        biome[i] = 0
        dirtyB = unionRect(dirtyB, rectOf(x, y, x, y))
      }
    }
  }
  return { territory: dirtyT, biome: dirtyB }
}

/** Troca todos os pixels de um valor por outro. Usado ao excluir material. */
export function replaceValue(
  target: Uint16Array,
  width: number,
  from: number,
  to: number,
  journal?: Journal,
): Rect | null {
  let dirty: Rect | null = null
  for (let i = 0; i < target.length; i++) {
    if (target[i] !== from) continue
    journal?.record(i, from)
    target[i] = to
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

/** Apaga todos os pixels de um slot. Usado ao excluir um pais ou bioma. */
export function clearSlot(
  target: Uint16Array,
  width: number,
  slot: number,
  journal?: Journal,
): Rect | null {
  return replaceValue(target, width, slot, 0, journal)
}

export interface SlotMeasure {
  area: number
  /** Area real, somando a area de cada pixel (que encolhe rumo aos polos). */
  km2: number
  bbox: Rect
  sumX: number
  sumY: number
}

/**
 * Quantos pixels cada slot ocupa -- e quantos km2, com `rowArea` (a area de
 * um pixel em cada linha, ver pixelAreaByRow) -- para mostrar area e achar
 * o centro.
 */
export function measureSlots(
  layer: Uint16Array,
  width: number,
  rowArea?: Float64Array,
): Map<number, SlotMeasure> {
  const stats = new Map<number, SlotMeasure>()
  for (let i = 0; i < layer.length; i++) {
    const slot = layer[i]
    if (slot === 0) continue
    const x = i % width
    const y = (i - x) / width
    let s = stats.get(slot)
    if (!s) {
      s = { area: 0, km2: 0, bbox: rectOf(x, y, x, y), sumX: 0, sumY: 0 }
      stats.set(slot, s)
    }
    s.area++
    if (rowArea) s.km2 += rowArea[y]
    s.sumX += x
    s.sumY += y
    if (x < s.bbox.x0) s.bbox.x0 = x
    if (x > s.bbox.x1) s.bbox.x1 = x
    if (y < s.bbox.y0) s.bbox.y0 = y
    if (y > s.bbox.y1) s.bbox.y1 = y
  }
  return stats
}

export type PhaseKey = 'solid' | 'liquid' | 'gas'

export interface PhaseTotals {
  pixels: Record<PhaseKey, number>
  km2: Record<PhaseKey, number>
}

/** Quanto do mapa e solido, liquido e gasoso, em pixels e em km2. */
export function measurePhases(base: MapBase, rowArea?: Float64Array): PhaseTotals {
  const { width, terrain, phaseBit } = base
  const totals: PhaseTotals = {
    pixels: { solid: 0, liquid: 0, gas: 0 },
    km2: { solid: 0, liquid: 0, gas: 0 },
  }
  for (let i = 0; i < terrain.length; i++) {
    const bit = phaseBit[terrain[i]]
    const key: PhaseKey | null =
      bit === PHASE_BIT.solid
        ? 'solid'
        : bit === PHASE_BIT.liquid
          ? 'liquid'
          : bit === PHASE_BIT.gas
            ? 'gas'
            : null
    if (!key) continue
    totals.pixels[key]++
    if (rowArea) totals.km2[key] += rowArea[(i / width) | 0]
  }
  return totals
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
  stats: SlotMeasure,
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
  /** Cor por codigo de material, em triplas; indice = codigo * 3. */
  material: Uint8Array
  /** Textura por codigo de material; null = cor chapada. */
  texture: (CompiledTexture | null)[]
  /** Cor por slot, em triplas; indice = slot * 3. */
  territory: Uint8Array
  biome: Uint8Array
}

/** Cor para pixel de terreno com codigo sem material: um cinza neutro. */
const ORPHAN = 128

export function materialPalette(
  materials: Material[],
): Pick<Palette, 'material' | 'texture'> {
  const max = materials.reduce((m, x) => Math.max(m, x.code), 0)
  const material = new Uint8Array((max + 1) * 3 + 3).fill(ORPHAN)
  const texture: (CompiledTexture | null)[] = new Array(max + 1).fill(null)
  for (const m of materials) {
    const [r, g, b] = hexToRgb(m.color)
    material[m.code * 3] = r
    material[m.code * 3 + 1] = g
    material[m.code * 3 + 2] = b
    texture[m.code] = compileTexture(m.texture, hexToRgb)
  }
  return { material, texture }
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

export interface ComposeResult {
  /** Pixels desenhados (so conta quando ha recorte). */
  pixels: number
  /** Pixels de cada slot de bioma dentro do recorte. */
  biomeArea: Map<number, number>
}

const scratchColor: [number, number, number] = [0, 0, 0]

/**
 * Coracao do desenho: calcula a cor final de cada pixel de uma regiao.
 *
 * O mapa inteiro e o recorte de um pais passam por aqui -- e por isso que o
 * recorte sai identico ao que se ve no mapa, sem uma segunda receita de cores
 * para manter sincronizada. `isolateSlot` deixa transparente tudo que nao for
 * daquele territorio; `terrainOnly` desenha so o chao, com textura, para o
 * caminho vetorial pintar o resto por cima.
 */
function composeInto(
  out: Uint8ClampedArray,
  base: MapBase,
  territory: Uint16Array,
  biome: Uint16Array,
  palette: Palette,
  view: ViewOptions,
  srcX0: number,
  srcY0: number,
  w: number,
  h: number,
  isolateSlot: number,
  terrainOnly: boolean,
): ComposeResult {
  const { width, height, terrain, phaseBit } = base
  const mat = palette.material
  const result: ComposeResult = { pixels: 0, biomeArea: new Map() }

  const showTerritory = !terrainOnly && view.mode !== 'biomas'
  const showBiomes = !terrainOnly && view.mode !== 'politica'
  // A hachura existe para deixar a cor do pais aparecer por baixo. Na visao
  // de biomas nao ha pais embaixo, entao a cor entra chapada.
  const hatched = view.mode === 'mista'
  const biomeMix = hatched ? 65 : 88

  for (let y = 0; y < h; y++) {
    const row = (srcY0 + y) * width + srcX0
    const dstRow = y * w
    const py = srcY0 + y
    for (let x = 0; x < w; x++) {
      const i = row + x
      const slot = territory[i]
      const o = (dstRow + x) * 4

      if (isolateSlot !== 0 && slot !== isolateSlot) {
        out[o + 3] = 0
        continue
      }
      result.pixels++

      const px = srcX0 + x
      const code = terrain[i]
      let r: number
      let g: number
      let b: number
      if (code * 3 + 2 < mat.length) {
        r = mat[code * 3]
        g = mat[code * 3 + 1]
        b = mat[code * 3 + 2]
        const tex = palette.texture[code]
        if (tex) {
          applyTexture(tex, px, py, r, g, b, scratchColor)
          r = scratchColor[0]
          g = scratchColor[1]
          b = scratchColor[2]
        }
      } else {
        r = g = b = ORPHAN
      }

      if (terrainOnly) {
        out[o] = r
        out[o + 1] = g
        out[o + 2] = b
        out[o + 3] = 255
        continue
      }

      // Slot sem cor na paleta e tinta orfa (a ficha sumiu num import, por
      // exemplo). Pular em vez de ler fora do array evita pintar de preto.
      if (slot !== 0 && showTerritory && slot * 3 + 2 < palette.territory.length) {
        const t = slot * 3
        // Mistura forte, mas deixa passar um pouco do chao (e da textura).
        r = (r * 22 + palette.territory[t] * 78) / 100
        g = (g * 22 + palette.territory[t + 1] * 78) / 100
        b = (b * 22 + palette.territory[t + 2] * 78) / 100
      }

      const bio = biome[i]
      if (bio !== 0 && isolateSlot !== 0) {
        result.biomeArea.set(bio, (result.biomeArea.get(bio) ?? 0) + 1)
      }
      if (showBiomes) {
        // Faixa diagonal larga: nao cria moire quando o mapa e visto de longe.
        if (
          bio !== 0 &&
          bio * 3 + 2 < palette.biome.length &&
          (!hatched || ((px + py) & 15) < 7)
        ) {
          const p = bio * 3
          const keep = 100 - biomeMix
          r = (r * keep + palette.biome[p] * biomeMix) / 100
          g = (g * keep + palette.biome[p + 1] * biomeMix) / 100
          b = (b * keep + palette.biome[p + 2] * biomeMix) / 100
        }
      }

      // A costa: onde a fase muda (terra e mar, rocha e gas...). Sai direto
      // do terreno, entao acompanha qualquer edicao.
      const bit = phaseBit[code]
      const beira =
        (px > 0 && phaseBit[terrain[i - 1]] !== bit) ||
        (px < width - 1 && phaseBit[terrain[i + 1]] !== bit) ||
        (py > 0 && phaseBit[terrain[i - width]] !== bit) ||
        (py < height - 1 && phaseBit[terrain[i + width]] !== bit)
      if (beira) {
        r *= 0.42
        g *= 0.42
        b *= 0.42
      }

      if (view.showBorders && slot !== 0) {
        const differs =
          (px > 0 && territory[i - 1] !== slot) ||
          (px < width - 1 && territory[i + 1] !== slot) ||
          (py > 0 && territory[i - width] !== slot) ||
          (py < height - 1 && territory[i + width] !== slot)
        if (differs) {
          r *= 0.45
          g *= 0.45
          b *= 0.45
        }
      }

      out[o] = r
      out[o + 1] = g
      out[o + 2] = b
      out[o + 3] = 255
    }
  }
  return result
}

function clampRect(base: MapBase, rect: Rect) {
  const x0 = Math.max(0, rect.x0)
  const y0 = Math.max(0, rect.y0)
  const x1 = Math.min(base.width - 1, rect.x1)
  const y1 = Math.min(base.height - 1, rect.y1)
  return { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
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
  const { x0, y0, w, h } = clampRect(base, rect)
  if (w <= 0 || h <= 0) return
  const image = ctx.createImageData(w, h)
  composeInto(image.data, base, territory, biome, palette, view, x0, y0, w, h, 0, false)
  ctx.putImageData(image, x0, y0)
}

/**
 * So o chao, com as texturas: o fundo sobre o qual o caminho vetorial pinta
 * paises, biomas e a costa.
 */
export function paintTerrain(
  ctx: CanvasRenderingContext2D,
  base: MapBase,
  palette: Palette,
  rect: Rect,
): void {
  const { x0, y0, w, h } = clampRect(base, rect)
  if (w <= 0 || h <= 0) return
  const image = ctx.createImageData(w, h)
  const view: ViewOptions = { mode: 'politica', showBorders: false }
  composeInto(image.data, base, base.terrain, base.terrain, palette, view, x0, y0, w, h, 0, true)
  ctx.putImageData(image, x0, y0)
}

/* --------------------------------------------------------------- faxina */

export interface CleanReport {
  /** Pixels isolados que voltaram a concordar com a vizinhanca. */
  repaired: number
  /** Pixels removidos por estarem em manchas pequenas demais. */
  removed: number
  /** Slots que sobraram na camada mas nao existem no mundo. */
  orphans: Map<number, number>
}

/**
 * Fecha frestas de 1 pixel deixadas pela ultima pincelada.
 *
 * Desenhar terra encostada na terra que ja existia quase sempre deixa um fio
 * de agua entre as duas: o contorno enxerga duas ilhas e risca a costa no meio
 * do continente, que foi exatamente o que apareceu em uso. A regra aqui e
 * direcional -- quem acabou de ser pintado vence a fresta: pintando terra,
 * fios de agua somem; pintando mar, fios de terra somem. Assim um canal
 * estreito feito de proposito continua de pe, desde que tenha 2px.
 *
 * Le de uma copia: sem isso um vao de 2px fecharia em cascata, coluna a
 * coluna, e o canal sumiria junto.
 */
export function closeSeams(
  layer: Uint16Array,
  width: number,
  height: number,
  rect: Rect,
  value: number,
  journal?: Journal,
): number {
  const x0 = Math.max(0, rect.x0)
  const y0 = Math.max(0, rect.y0)
  const x1 = Math.min(width - 1, rect.x1)
  const y1 = Math.min(height - 1, rect.y1)
  if (x1 < x0 || y1 < y0) return 0

  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  const before = new Uint16Array(w * h)
  for (let y = 0; y < h; y++) {
    before.set(layer.subarray((y0 + y) * width + x0, (y0 + y) * width + x1 + 1), y * w)
  }
  const at = (x: number, y: number) =>
    x >= x0 && x <= x1 && y >= y0 && y <= y1
      ? before[(y - y0) * w + (x - x0)]
      : layer[y * width + x]

  let changed = 0
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (at(x, y) === value) continue
      const entreColunas =
        x > 0 && x < width - 1 && at(x - 1, y) === value && at(x + 1, y) === value
      const entreLinhas =
        y > 0 && y < height - 1 && at(x, y - 1) === value && at(x, y + 1) === value
      if (!entreColunas && !entreLinhas) continue
      const i = y * width + x
      journal?.record(i, layer[i])
      layer[i] = value
      changed++
    }
  }
  return changed
}

/**
 * Mediana de 1 pixel dentro de um retangulo: se os quatro vizinhos concordam
 * entre si e discordam do pixel, ele cede.
 *
 * E o que fecha a emenda quando se desenha terra encostada na terra que ja
 * existia: por um pixel de agua que sobre entre as duas, o contorno enxerga
 * duas ilhas e risca a costa no meio do continente. Depois do remendo, o
 * traco contorna a area inteira, que e o que o olho espera.
 *
 * Le de uma copia, entao o resultado nao depende da ordem da varredura.
 */
export function medianPass(
  layer: Uint16Array,
  width: number,
  height: number,
  rect: Rect,
  journal?: Journal,
): number {
  const x0 = Math.max(0, rect.x0)
  const y0 = Math.max(0, rect.y0)
  const x1 = Math.min(width - 1, rect.x1)
  const y1 = Math.min(height - 1, rect.y1)
  if (x1 < x0 || y1 < y0) return 0

  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  const before = new Uint16Array(w * h)
  for (let y = 0; y < h; y++) {
    before.set(layer.subarray((y0 + y) * width + x0, (y0 + y) * width + x1 + 1), y * w)
  }
  const at = (x: number, y: number) =>
    x >= x0 && x <= x1 && y >= y0 && y <= y1
      ? before[(y - y0) * w + (x - x0)]
      : layer[y * width + x]

  let changed = 0
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * width + x
      const v = at(x, y)
      let first = -1
      let agree = true
      let seen = 0
      const look = (u: number) => {
        if (first < 0) first = u
        else if (u !== first) agree = false
        seen++
      }
      if (x > 0) look(at(x - 1, y))
      if (x < width - 1) look(at(x + 1, y))
      if (y > 0) look(at(x, y - 1))
      if (y < height - 1) look(at(x, y + 1))
      if (agree && seen >= 2 && first !== v) {
        journal?.record(i, layer[i])
        layer[i] = first
        changed++
      }
    }
  }
  return changed
}

/**
 * Tira a sujeira de uma camada recem-carregada.
 *
 * Um PNG que passa pelo canvas pode voltar com alguns pixels trocados em mais
 * ou menos um -- poucos, mas espalhados pelo mapa inteiro. Como o valor do
 * pixel aqui nao e cor e sim o numero do dono, um unico bit errado inventa um
 * pais no meio do oceano: a area fica errada, a caixa do territorio estoura
 * para o mapa todo e o recorte isolado vira uma chuva de pontinhos.
 *
 * Dois passes resolvem:
 *  1. mediana de 1 pixel -- se os vizinhos concordam entre si e discordam do
 *     pixel, ele cede. Tira pinta solta e tapa furo de 1px dentro do pais.
 *  2. despeckle -- manchas menores que `minComponent` somem. Nenhum pincel
 *     desta ferramenta desenha algo tao pequeno.
 */
export function cleanLayer(
  layer: Uint16Array,
  width: number,
  height: number,
  validSlots: Iterable<number> = [],
  minComponent = 8,
): CleanReport {
  const report: CleanReport = { repaired: 0, removed: 0, orphans: new Map() }

  report.repaired = medianPass(layer, width, height, rectOf(0, 0, width - 1, height - 1))

  const total = width * height
  const seen = new Uint8Array(total)
  const queue = new Int32Array(total)
  const members = new Int32Array(total)
  for (let start = 0; start < total; start++) {
    if (layer[start] === 0 || seen[start]) continue
    const slot = layer[start]
    let head = 0
    let tail = 0
    let n = 0
    queue[tail++] = start
    seen[start] = 1
    while (head < tail) {
      const p = queue[head++]
      members[n++] = p
      const px = p % width
      const py = (p - px) / width
      if (px > 0 && layer[p - 1] === slot && !seen[p - 1]) {
        seen[p - 1] = 1
        queue[tail++] = p - 1
      }
      if (px < width - 1 && layer[p + 1] === slot && !seen[p + 1]) {
        seen[p + 1] = 1
        queue[tail++] = p + 1
      }
      if (py > 0 && layer[p - width] === slot && !seen[p - width]) {
        seen[p - width] = 1
        queue[tail++] = p - width
      }
      if (py < height - 1 && layer[p + width] === slot && !seen[p + width]) {
        seen[p + width] = 1
        queue[tail++] = p + width
      }
    }
    if (n < minComponent) {
      for (let k = 0; k < n; k++) layer[members[k]] = 0
      report.removed += n
    }
  }

  // Tinta sem dono: nao apaga, so avisa. Pode ser trabalho de verdade que
  // perdeu a ficha num import, e apagar em silencio seria pior.
  const valid = new Set(validSlots)
  for (let i = 0; i < total; i++) {
    const slot = layer[i]
    if (slot === 0 || valid.has(slot)) continue
    report.orphans.set(slot, (report.orphans.get(slot) ?? 0) + 1)
  }
  return report
}
