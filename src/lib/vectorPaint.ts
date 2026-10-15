import type { BiomeArea, Selection, Territory } from '../types'
import { hexToRgb, type MapBase, type ViewOptions } from './layers'
import { pathData, loopsBounds, type Loop } from './trace'
import { BIOMES } from './biomes'

/**
 * Desenho vetorial do mapa.
 *
 * As mesmas cores e misturas do caminho raster (ver composeInto em layers.ts),
 * so que aplicadas a contornos em vez de pixels: a fronteira sai afiada em
 * qualquer zoom e o traco nao engorda junto com a ampliacao.
 */

export interface Shape {
  path: Path2D
  /** x0, y0, x1, y1 em coordenadas da imagem. */
  bounds: [number, number, number, number]
  /** O mesmo contorno em texto, para exportar SVG. */
  d: string
}

export function toShape(loops: Loop[]): Shape | null {
  const bounds = loopsBounds(loops)
  if (!bounds) return null
  const d = pathData(loops)
  if (!d) return null
  return { path: new Path2D(d), bounds, d }
}

/** Mistura duas cores como o raster faz: `pct` por cento da segunda. */
function mix(baseHex: string, hex: string, pct: number): [number, number, number] {
  const a = hexToRgb(baseHex)
  const b = hexToRgb(hex)
  const keep = 100 - pct
  return [
    (a[0] * keep + b[0] * pct) / 100,
    (a[1] * keep + b[1] * pct) / 100,
    (a[2] * keep + b[2] * pct) / 100,
  ]
}

const rgb = (c: [number, number, number], factor = 1) =>
  'rgb(' +
  Math.round(c[0] * factor) +
  ',' +
  Math.round(c[1] * factor) +
  ',' +
  Math.round(c[2] * factor) +
  ')'

/** A cor cheia de um territorio: a tinta dele sobre a terra ou sobre o mar. */
export function territoryFill(entity: Territory, base: MapBase): [number, number, number] {
  return mix(entity.kind === 'country' ? base.landColor : base.waterColor, entity.color, 78)
}

export interface SceneEntry<T> {
  entity: T
  shape: Shape
}

export interface Scene {
  land: Shape | null
  territories: SceneEntry<Territory>[]
  biomes: SceneEntry<BiomeArea>[]
}

export interface DrawOptions {
  base: MapBase
  view: ViewOptions
  /** Zoom em uso: o traco da fronteira tem largura fixa na tela. */
  scale: number
  selection: Selection
  /** Desenha so este territorio, sem fundo nem vizinhos (recorte isolado). */
  only?: number
  /** Traca a linha da costa em vez de usar a imagem do desenho original. */
  coastline?: boolean
}

const BORDER_WIDTH = 1.25
/** A linha da costa, em pixels de tela: nao engorda com o zoom. */
const COAST_WIDTH = 1.7
/**
 * De longe o mapa tem costa demais: com a linha cheia, cada ilhota ganha um
 * contorno preto e o conjunto escurece. A tinta entao acompanha o zoom --
 * quase um fantasma no mapa inteiro, firme quando se chega perto.
 */
const COAST_ALPHA_FAR = 0.14
const COAST_ALPHA_NEAR = 0.88
const COAST_ZOOM_FAR = 0.3
const COAST_ZOOM_NEAR = 1.2

function coastAlpha(scale: number): number {
  const t = (scale - COAST_ZOOM_FAR) / (COAST_ZOOM_NEAR - COAST_ZOOM_FAR)
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t
  // Curva suave: a linha some devagar em vez de apagar de uma vez.
  const eased = clamped * clamped * (3 - 2 * clamped)
  return COAST_ALPHA_FAR + (COAST_ALPHA_NEAR - COAST_ALPHA_FAR) * eased
}
const BIOME_FLAT = 88
const BIOME_HATCH = 65
/** Mesmo passo da hachura raster: faixa de 7 a cada 16, na diagonal. */
const HATCH_STEP = 16
const HATCH_BAND = 7

export function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  options: DrawOptions,
): void {
  const { base, view, scale, only } = options
  const showTerritory = view.mode !== 'biomas'
  const showBiomes = view.mode !== 'politica'
  const hatched = view.mode === 'mista'

  if (only === undefined) {
    ctx.fillStyle = base.waterColor
    ctx.fillRect(0, 0, base.width, base.height)
    if (scene.land) {
      ctx.fillStyle = base.landColor
      ctx.fill(scene.land.path)
    }
  }

  const territories = only === undefined
    ? scene.territories
    : scene.territories.filter((t) => t.entity.slot === only)

  // No recorte isolado o pais e a propria moldura: o que estiver fora dele
  // nao pode aparecer, nem o bioma que atravessa a fronteira.
  if (only !== undefined && territories.length) {
    ctx.save()
    ctx.clip(territories[0].shape.path)
  }

  if (showTerritory || only !== undefined) {
    for (const { entity, shape } of territories) {
      ctx.fillStyle = rgb(territoryFill(entity, base))
      ctx.fill(shape.path)
    }
  }

  if (showBiomes) {
    for (const { entity, shape } of scene.biomes) {
      const color = BIOMES[entity.type].color
      if (hatched) hatch(ctx, shape, color, BIOME_HATCH / 100)
      else {
        ctx.globalAlpha = BIOME_FLAT / 100
        ctx.fillStyle = color
        ctx.fill(shape.path)
        ctx.globalAlpha = 1
      }
    }
  }

  if (only !== undefined && territories.length) ctx.restore()

  if (view.showBorders) {
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.lineWidth = BORDER_WIDTH / scale
    for (const { entity, shape } of territories) {
      ctx.strokeStyle = rgb(territoryFill(entity, base), 0.45)
      ctx.stroke(shape.path)
    }
  }

  const selection = options.selection
  if (only === undefined && selection && selection.kind !== 'poi') {
    const list = selection.kind === 'territory' ? scene.territories : scene.biomes
    const found = list.find((e) => e.entity.slot === selection.slot)
    if (found) {
      ctx.globalAlpha = 0.34
      ctx.fillStyle = '#ffe8a5'
      ctx.fill(found.shape.path)
      ctx.globalAlpha = 1
    }
  }

  // Por ultimo, por cima de tudo: a costa. E a mesma fronteira terra/mar que
  // o desenho original marcava a tinta, agora como traco -- afiada em
  // qualquer zoom, enquanto a imagem virava degrau de pixel.
  if (options.coastline && scene.land && only === undefined) {
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.lineWidth = COAST_WIDTH / scale
    ctx.strokeStyle = 'rgba(15,15,15,' + coastAlpha(scale).toFixed(3) + ')'
    ctx.stroke(scene.land.path)
  }
}

/** Faixas diagonais dentro do contorno -- a hachura da visao mista. */
function hatch(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  color: string,
  alpha: number,
): void {
  const [x0, y0, x1, y1] = shape.bounds
  ctx.save()
  ctx.clip(shape.path)
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  // A faixa e medida na perpendicular, dai a divisao pela diagonal.
  ctx.lineWidth = HATCH_BAND / Math.SQRT2
  ctx.lineCap = 'butt'
  ctx.beginPath()
  const first = Math.floor((x0 + y0) / HATCH_STEP) * HATCH_STEP
  const last = Math.ceil((x1 + y1) / HATCH_STEP) * HATCH_STEP
  for (let k = first; k <= last; k += HATCH_STEP) {
    const c = k + HATCH_BAND / 2
    ctx.moveTo(x0 - 1, c - (x0 - 1))
    ctx.lineTo(x1 + 1, c - (x1 + 1))
  }
  ctx.stroke()
  ctx.restore()
}

/** Documento SVG de um recorte -- vetor de verdade, sem perder no zoom. */
export function sceneToSvg(
  scene: Scene,
  options: DrawOptions & { only: number },
): string {
  const { base, view, only } = options
  const entry = scene.territories.find((t) => t.entity.slot === only)
  if (!entry) return ''
  const [x0, y0, x1, y1] = entry.shape.bounds
  const w = Math.max(1, Math.ceil(x1 - x0))
  const h = Math.max(1, Math.ceil(y1 - y0))
  const defs: string[] = ['<clipPath id="corte"><path d="' + entry.shape.d + '"/></clipPath>']
  const body: string[] = [
    '<path d="' + entry.shape.d + '" fill="' + rgb(territoryFill(entry.entity, base)) + '"/>',
  ]

  if (view.mode !== 'politica') {
    const step = (HATCH_STEP / Math.SQRT2).toFixed(2)
    const band = (HATCH_BAND / Math.SQRT2).toFixed(2)
    scene.biomes.forEach(({ entity, shape }, i) => {
      const color = BIOMES[entity.type].color
      if (view.mode === 'mista') {
        // A hachura vira um padrao de faixas giradas: o SVG repete sozinho.
        const id = 'hachura' + i
        defs.push(
          '<pattern id="' + id + '" width="' + step + '" height="' + step +
            '" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">' +
            '<rect width="' + band + '" height="' + step + '" fill="' + color +
            '" fill-opacity="' + BIOME_HATCH / 100 + '"/></pattern>',
        )
        body.push('<path d="' + shape.d + '" fill="url(#' + id + ')"/>')
      } else {
        body.push(
          '<path d="' + shape.d + '" fill="' + color + '" fill-opacity="' +
            BIOME_FLAT / 100 + '"/>',
        )
      }
    })
  }

  const border = view.showBorders
    ? '<path d="' + entry.shape.d + '" fill="none" stroke="' +
      rgb(territoryFill(entry.entity, base), 0.45) +
      '" stroke-width="1.2" stroke-linejoin="round"/>'
    : ''

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' +
    x0.toFixed(2) + ' ' + y0.toFixed(2) + ' ' + w + ' ' + h +
    '" width="' + w + '" height="' + h + '">' +
    '<defs>' + defs.join('') + '</defs>' +
    '<g clip-path="url(#corte)">' + body.join('') + '</g>' +
    border +
    '</svg>'
  )
}
