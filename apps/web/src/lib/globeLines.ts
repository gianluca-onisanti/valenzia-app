import type { Loop } from './trace'
import { basis, type Rotation } from './globe'

/**
 * Costa e fronteiras no globo, em vetor.
 *
 * Os contornos do mapa plano viram pontos na esfera uma vez so (vetores
 * unitarios); a cada quadro eles sao girados, projetados e riscados direto na
 * tela. O traco tem a mesma espessura em qualquer zoom -- nada de linha
 * pintada na textura, que engorda e vira escada quando se chega perto.
 */

/** Uma linha continua na esfera: x, y, z de cada ponto, em sequencia. */
export type SpherePolyline = Float32Array

/** Tolerancia, em pixels do mapa, para dizer que um ponto esta na moldura. */
const EDGE = 0.75

/**
 * Leva os aneis do mapa para a esfera. Trechos que correm pela moldura do
 * mapa (o antimeridiano, nas laterais, e os polos, em cima e embaixo) nao sao
 * costa nem fronteira de verdade: la o mapa so foi cortado. Esses trechos
 * caem fora, e o anel e partido em pedacos ali. O mesmo vale para o que o
 * tracado da costa deixa passar por fora do mapa.
 */
export function toSphere(loops: Loop[], width: number, height: number): SpherePolyline[] {
  const out: SpherePolyline[] = []
  const onEdge = (x: number, y: number) =>
    x <= EDGE || x >= width - EDGE || y <= EDGE || y >= height - EDGE
  const outside = (x: number, y: number) => x < -EDGE || x > width + EDGE || y < -EDGE || y > height + EDGE
  const sameEdge = (ax: number, ay: number, bx: number, by: number) =>
    (ax <= EDGE && bx <= EDGE) ||
    (ax >= width - EDGE && bx >= width - EDGE) ||
    (ay <= EDGE && by <= EDGE) ||
    (ay >= height - EDGE && by >= height - EDGE)

  for (const ring of loops) {
    const n = ring.length / 2
    if (n < 2) continue
    let current: number[] = []
    const flush = () => {
      if (current.length >= 6) out.push(Float32Array.from(current))
      current = []
    }
    const push = (x: number, y: number) => {
      const lon = (x / width) * Math.PI * 2 - Math.PI
      const lat = Math.PI / 2 - (y / height) * Math.PI
      const c = Math.cos(lat)
      current.push(c * Math.cos(lon), Math.sin(lat), c * Math.sin(lon))
    }
    // O anel e fechado: o ultimo ponto liga de volta ao primeiro.
    for (let k = 0; k <= n; k++) {
      const i = (k % n) * 2
      const x = ring[i]
      const y = ring[i + 1]
      if (outside(x, y)) {
        flush()
        continue
      }
      if (k > 0) {
        const j = ((k - 1) % n) * 2
        const px = ring[j]
        const py = ring[j + 1]
        if (!outside(px, py) && onEdge(px, py) && onEdge(x, y) && sameEdge(px, py, x, y)) {
          flush()
        }
      }
      push(x, y)
    }
    flush()
  }
  return out
}

/**
 * Risca as linhas do lado visivel da esfera. Quem passa para tras do globo
 * levanta a caneta. Pontos a menos de meio pixel do ultimo desenhado sao
 * pulados: de longe, o mapa inteiro cabe em poucos pixels.
 */
export function strokeOnSphere(
  ctx: CanvasRenderingContext2D,
  lines: SpherePolyline[],
  rot: Rotation,
  cx: number,
  cy: number,
  r: number,
  roll: number,
): void {
  const b = basis(rot)
  const cr = Math.cos(roll)
  const sr = Math.sin(roll)
  ctx.beginPath()
  for (const pts of lines) {
    let pen = false
    let lx = 0
    let ly = 0
    let pending = false
    let qx = 0
    let qy = 0
    for (let i = 0; i < pts.length; i += 3) {
      const wx = pts[i]
      const wy = pts[i + 1]
      const wz = pts[i + 2]
      const nz = wx * b.fx + wy * b.fy + wz * b.fz
      if (nz <= 0) {
        if (pending) ctx.lineTo(qx, qy)
        pen = false
        pending = false
        continue
      }
      const nx = wx * b.rx + wz * b.rz
      const ny = wx * b.ux + wy * b.uy + wz * b.uz
      const bx = nx * r
      const by = -ny * r
      const x = cx + bx * cr - by * sr
      const y = cy + bx * sr + by * cr
      if (!pen) {
        ctx.moveTo(x, y)
        pen = true
        lx = x
        ly = y
        pending = false
      } else if (Math.abs(x - lx) + Math.abs(y - ly) > 0.5) {
        ctx.lineTo(x, y)
        lx = x
        ly = y
        pending = false
      } else {
        // Guarda o ponto pulado: se a linha acabar aqui, ele fecha o traco.
        pending = true
        qx = x
        qy = y
      }
    }
    if (pending) ctx.lineTo(qx, qy)
  }
  ctx.stroke()
}
