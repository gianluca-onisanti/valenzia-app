import type { RingSpec } from '@valenzia/shared'
import { hexToRgb } from './layers'

/**
 * Aneis planetarios, desenhados no canvas.
 *
 * O anel fica no plano do equador. Visto de uma latitude `lat`, ele vira uma
 * elipse achatada por sen(lat) -- de frente para o polo e um disco, de lado
 * e um risco. A metade de tras (mais longe do olho) tem de ser desenhada
 * antes do planeta, e a da frente depois: e isso que faz o anel "passar por
 * tras" da esfera. Com lat > 0 (olhando de cima), a metade da frente e a de
 * baixo.
 *
 * As faixas e as falhas (como a de Cassini em Saturno) saem de um sorteio
 * com semente fixa: o mesmo `seed` desenha sempre o mesmo anel.
 */

/** Gerador pseudoaleatorio pequeno e deterministico. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

export interface RingStop {
  offset: number
  color: string
}

const STOPS = 56

/** As paradas do degrade radial: cor, brilho e transparencia de cada faixa. */
export function ringStops(spec: RingSpec): RingStop[] {
  const rand = mulberry32(spec.seed * 9301 + 49297)
  const c1 = hexToRgb(spec.color)
  const c2 = hexToRgb(spec.color2 ?? spec.color)
  // Uma ou duas falhas escuras, em posicoes sorteadas.
  const gaps = Array.from({ length: 1 + Math.floor(rand() * 2) }, () => ({
    at: 0.25 + rand() * 0.55,
    width: 0.02 + rand() * 0.04,
  }))
  // Faixas: valor sorteado por faixa, suavizado com a vizinha.
  let previous = 0.7
  const stops: RingStop[] = []
  for (let i = 0; i <= STOPS; i++) {
    const x = i / STOPS
    const band = previous * 0.45 + (0.45 + rand() * 0.55) * 0.55
    previous = band
    let alpha = band * spec.opacity
    for (const g of gaps) {
      const d = Math.abs(x - g.at)
      if (d < g.width) alpha *= 0.08 + 0.92 * smooth(g.width * 0.4, g.width, d)
    }
    alpha *= smooth(0, 0.05, x) * (1 - smooth(0.93, 1, x))
    const light = 0.82 + rand() * 0.3
    const r = (c1[0] + (c2[0] - c1[0]) * x) * light
    const g = (c1[1] + (c2[1] - c1[1]) * x) * light
    const b = (c1[2] + (c2[2] - c1[2]) * x) * light
    stops.push({
      offset: x,
      color:
        'rgba(' +
        Math.min(255, Math.round(r)) + ',' +
        Math.min(255, Math.round(g)) + ',' +
        Math.min(255, Math.round(b)) + ',' +
        alpha.toFixed(3) + ')',
    })
  }
  return stops
}

/**
 * Desenha metade do anel de um corpo com centro (cx, cy) e raio r na tela.
 * `sinLat` e o seno da latitude de onde se olha.
 */
export function drawRingHalf(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  spec: RingSpec,
  sinLat: number,
  half: 'back' | 'front',
  stops: RingStop[] = ringStops(spec),
): void {
  const outer = spec.outer * r
  const inner = spec.inner * r
  // De lado, o anel ainda aparece como um fio, nao some.
  const squash = Math.max(Math.abs(sinLat), 0.012)
  // Olhando de cima, a frente e a metade de baixo; de baixo, a de cima.
  const lowerHalf = (half === 'front') === sinLat >= 0

  ctx.save()
  ctx.beginPath()
  if (lowerHalf) ctx.rect(cx - outer - 2, cy, outer * 2 + 4, outer + 2)
  else ctx.rect(cx - outer - 2, cy - outer - 2, outer * 2 + 4, outer + 2)
  ctx.clip()
  ctx.translate(cx, cy)
  ctx.scale(1, squash)
  const gradient = ctx.createRadialGradient(0, 0, inner, 0, 0, outer)
  for (const s of stops) gradient.addColorStop(s.offset, s.color)
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(0, 0, outer, 0, Math.PI * 2)
  ctx.arc(0, 0, inner, 0, Math.PI * 2, true)
  ctx.fill()
  ctx.restore()
}
