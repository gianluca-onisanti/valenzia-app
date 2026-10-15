/**
 * Transforma as camadas pintadas em contornos.
 *
 * A pintura e raster por natureza -- balde, pincel e laco trabalham em pixel.
 * O desenho na tela, porem, nao precisa ser: o que o mapa mostra sao regioes
 * de cor chapada, e isso e descrito muito melhor por um contorno do que por
 * sete milhoes de pixels. Com o contorno, a fronteira fica afiada em qualquer
 * zoom e o recorte de um pais pode sair em SVG.
 *
 * O traco segue as frestas entre pixels (nao os centros), entao o contorno
 * cai exatamente em cima da borda que o usuario pintou.
 */

/** Um anel fechado: pares x,y. O ultimo ponto liga de volta no primeiro. */
export type Loop = Float32Array

export interface TraceOptions {
  /** Tolerancia do Douglas-Peucker, em pixels. 0 preserva o degrau do raster. */
  epsilon?: number
  /** Passadas de Chaikin para arredondar o degrau que sobrar. */
  smooth?: number
  /** Aneis com perimetro menor que isto sao descartados. */
  minPerimeter?: number
}

/**
 * O mesmo ajuste vale para a terra, os paises e os biomas: tracados com a
 * mesma tolerancia, os contornos coincidem onde devem coincidir -- a linha da
 * costa cai exatamente em cima da borda do pais que termina na praia.
 */
const DEFAULTS: Required<TraceOptions> = { epsilon: 0.6, smooth: 1, minPerimeter: 6 }

/**
 * Direcoes em coordenadas de tela (y cresce para baixo):
 * 0 = direita, 1 = baixo, 2 = esquerda, 3 = cima.
 */
function dirOf(from: number, to: number, stride: number): number {
  const d = to - from
  if (d === 1) return 0
  if (d === stride) return 1
  if (d === -1) return 2
  return 3
}

/**
 * Contorna todas as regioes de uma camada de uma vez.
 *
 * Cada fresta entre um pixel e um vizinho de valor diferente vira um segmento
 * orientado com o interior a esquerda. Ligando os segmentos ponta com ponta
 * saem aneis fechados: o de fora num sentido, os furos no sentido contrario --
 * que e exatamente o que a regra "nonzero" do canvas espera para desenhar
 * buraco como buraco.
 */
export function traceLayer(
  layer: Uint16Array | Uint8Array,
  width: number,
  height: number,
  options: TraceOptions = {},
): Map<number, Loop[]> {
  const opts = { ...DEFAULTS, ...options }
  const stride = width + 1

  // Arestas por slot: vertice de saida -> vertices de chegada.
  const edges = new Map<number, Map<number, number[]>>()
  const add = (slot: number, from: number, to: number) => {
    let byVertex = edges.get(slot)
    if (!byVertex) {
      byVertex = new Map()
      edges.set(slot, byVertex)
    }
    const list = byVertex.get(from)
    if (list) list.push(to)
    else byVertex.set(from, [to])
  }

  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      const v = layer[row + x]
      if (v === 0) continue
      const a = y * stride + x
      const b = a + 1
      const c = a + stride
      const d = c + 1
      if (y === 0 || layer[row + x - width] !== v) add(v, b, a)
      if (y === height - 1 || layer[row + x + width] !== v) add(v, c, d)
      if (x === 0 || layer[row + x - 1] !== v) add(v, a, c)
      if (x === width - 1 || layer[row + x + 1] !== v) add(v, d, b)
    }
  }

  const result = new Map<number, Loop[]>()
  for (const [slot, byVertex] of edges) {
    const loops = linkLoops(byVertex, stride, opts)
    if (loops.length) result.set(slot, loops)
  }
  return result
}

/** O mesmo, para a mascara de terra: 1 e terra, 0 e agua. */
export function traceMask(
  mask: Uint16Array | Uint8Array,
  width: number,
  height: number,
  options: TraceOptions = {},
): Loop[] {
  return traceLayer(mask, width, height, options).get(1) ?? []
}

function linkLoops(
  byVertex: Map<number, number[]>,
  stride: number,
  opts: Required<TraceOptions>,
): Loop[] {
  // Saidas ja consumidas de cada vertice.
  const spent = new Map<number, boolean[]>()
  const take = (vertex: number, index: number) => {
    let flags = spent.get(vertex)
    if (!flags) {
      flags = new Array(byVertex.get(vertex)?.length ?? 0).fill(false)
      spent.set(vertex, flags)
    }
    flags[index] = true
  }
  const free = (vertex: number, index: number) => !spent.get(vertex)?.[index]

  const loops: Loop[] = []

  for (const [start, outs] of byVertex) {
    for (let k = 0; k < outs.length; k++) {
      if (!free(start, k)) continue
      take(start, k)

      const pts: number[] = []
      let from = start
      let to = outs[k]
      const limit = byVertex.size * 4 + 16

      for (;;) {
        pts.push(from % stride, (from - (from % stride)) / stride)
        if (to === start) break
        if (pts.length > limit * 2) break

        const next = byVertex.get(to)
        if (!next || next.length === 0) break
        const incoming = dirOf(from, to, stride)
        // Prefere virar a esquerda: assim dois pixels que so se tocam na
        // diagonal viram dois aneis, igual ao balde, que anda em 4 vizinhos.
        let chosen = -1
        let chosenIndex = -1
        for (const turn of [3, 0, 1, 2]) {
          const want = (incoming + turn) % 4
          for (let j = 0; j < next.length; j++) {
            if (!free(to, j)) continue
            if (dirOf(to, next[j], stride) !== want) continue
            chosen = next[j]
            chosenIndex = j
            break
          }
          if (chosen >= 0) break
        }
        if (chosen < 0) break
        take(to, chosenIndex)
        from = to
        to = chosen
      }

      if (pts.length >= 6) {
        const ring = finish(pts, opts)
        if (ring) loops.push(ring)
      }
    }
  }
  return loops
}

/** Tira colinear, simplifica e arredonda -- nessa ordem. */
function finish(points: number[], opts: Required<TraceOptions>): Loop | null {
  if (perimeter(points) < opts.minPerimeter) return null
  let ring = dropCollinear(points)
  if (ring.length < 6) return null
  if (opts.epsilon > 0) ring = simplifyClosed(ring, opts.epsilon)
  if (ring.length < 6) return null
  for (let i = 0; i < opts.smooth; i++) ring = chaikin(ring)
  return Float32Array.from(ring)
}

function perimeter(pts: number[]): number {
  let sum = 0
  const n = pts.length
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n
    sum += Math.abs(pts[j] - pts[i]) + Math.abs(pts[j + 1] - pts[i + 1])
  }
  return sum
}

function dropCollinear(pts: number[]): number[] {
  const n = pts.length / 2
  if (n < 3) return pts
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const px = pts[((i - 1 + n) % n) * 2]
    const py = pts[((i - 1 + n) % n) * 2 + 1]
    const cx = pts[i * 2]
    const cy = pts[i * 2 + 1]
    const nx = pts[((i + 1) % n) * 2]
    const ny = pts[((i + 1) % n) * 2 + 1]
    const cross = (cx - px) * (ny - cy) - (cy - py) * (nx - cx)
    if (cross !== 0) out.push(cx, cy)
  }
  return out.length >= 6 ? out : pts
}

/**
 * Douglas-Peucker num anel fechado. O anel e cortado em dois arcos entre o
 * ponto 0 e o mais distante dele; sem esse corte o algoritmo nao teria pontas
 * fixas onde se apoiar.
 */
function simplifyClosed(pts: number[], epsilon: number): number[] {
  const n = pts.length / 2
  if (n < 4) return pts
  let far = 0
  let best = -1
  for (let i = 1; i < n; i++) {
    const d = (pts[i * 2] - pts[0]) ** 2 + (pts[i * 2 + 1] - pts[1]) ** 2
    if (d > best) {
      best = d
      far = i
    }
  }
  return douglas(pts, 0, far, epsilon).concat(douglas(pts, far, n, epsilon))
}

/** Pontos de `from` ate `to` (exclusivo). `to` pode ser n, fechando o anel. */
function douglas(pts: number[], from: number, to: number, epsilon: number): number[] {
  const n = pts.length / 2
  const ax = pts[from * 2]
  const ay = pts[from * 2 + 1]
  const end = to % n
  const bx = pts[end * 2]
  const by = pts[end * 2 + 1]

  let worst = -1
  let worstIndex = -1
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  for (let i = from + 1; i < to; i++) {
    const px = pts[i * 2]
    const py = pts[i * 2 + 1]
    let d: number
    if (len2 === 0) d = Math.hypot(px - ax, py - ay)
    else {
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
      d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
    }
    if (d > worst) {
      worst = d
      worstIndex = i
    }
  }

  if (worst > epsilon && worstIndex > from) {
    return douglas(pts, from, worstIndex, epsilon).concat(
      douglas(pts, worstIndex, to, epsilon),
    )
  }
  return [ax, ay]
}

/** Chaikin: cada canto vira dois pontos, a 1/4 e a 3/4. Reta segue reta. */
function chaikin(pts: number[]): number[] {
  const n = pts.length / 2
  if (n < 3) return pts
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const ax = pts[i * 2]
    const ay = pts[i * 2 + 1]
    const bx = pts[((i + 1) % n) * 2]
    const by = pts[((i + 1) % n) * 2 + 1]
    out.push(ax + (bx - ax) * 0.25, ay + (by - ay) * 0.25)
    out.push(ax + (bx - ax) * 0.75, ay + (by - ay) * 0.75)
  }
  return out
}

/* ---------------------------------------------------------------- saida */

/** Vira `d` de SVG -- serve para exportar e para `new Path2D(d)`. */
export function pathData(loops: Loop[], precision = 2): string {
  const out: string[] = []
  for (const ring of loops) {
    if (ring.length < 6) continue
    const n = ring.length / 2
    let d = 'M' + ring[0].toFixed(precision) + ' ' + ring[1].toFixed(precision)
    for (let i = 1; i < n; i++) {
      d += 'L' + ring[i * 2].toFixed(precision) + ' ' + ring[i * 2 + 1].toFixed(precision)
    }
    out.push(d + 'Z')
  }
  return out.join('')
}

/** Caixa que contem os aneis, para enquadrar o recorte. */
export function loopsBounds(loops: Loop[]): [number, number, number, number] | null {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const ring of loops) {
    for (let i = 0; i < ring.length; i += 2) {
      if (ring[i] < x0) x0 = ring[i]
      if (ring[i] > x1) x1 = ring[i]
      if (ring[i + 1] < y0) y0 = ring[i + 1]
      if (ring[i + 1] > y1) y1 = ring[i + 1]
    }
  }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : null
}
