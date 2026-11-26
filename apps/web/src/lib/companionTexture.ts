import type { BodySummary } from '@valenzia/shared'
import { api } from './api'
import { BIOMES } from './biomes'
import { decodeLayer } from './store'
import type { Texture } from './globe'
import {
  createMapBase,
  hexToRgb,
  materialPalette,
  paintComposite,
  rectOf,
  syncPhases,
} from './layers'

/**
 * A pele dos vizinhos no globo (planeta-mae, luas, luas irmas).
 *
 * Regra: quem nao esta em foco aparece sempre na visao de **biomas** -- o
 * chao com as texturas dos materiais e os biomas por cima, sem paises. A
 * politica e coisa do corpo que se esta editando. Sai da mesma receita do
 * editor (paintComposite), lida das camadas do servidor, e e reduzida para
 * o tamanho de um vizinho no ceu.
 */

/** Largura maxima da textura de um vizinho: ele nunca passa de ~420px na tela. */
const COMPANION_WIDTH = 1024

const cache = new Map<string, Promise<Texture>>()

/** A textura do vizinho, montada uma vez por revisao. */
export function companionTexture(body: BodySummary): Promise<Texture> {
  const key = body.id + ':' + body.revision
  let pending = cache.get(key)
  if (!pending) {
    pending = build(body).catch(() => fromThumbnail(body))
    cache.set(key, pending)
  }
  return pending
}

async function build(body: BodySummary): Promise<Texture> {
  const doc = await api.getBody(body.id)
  const { width, height } = doc
  const [terrainBlob, biomeBlob] = await Promise.all([
    api.getLayer(body.id, 'terrain'),
    api.getLayer(body.id, 'biome'),
  ])
  const [terrain, biome] = await Promise.all([
    decodeLayer(terrainBlob, width, height),
    decodeLayer(biomeBlob, width, height),
  ])

  const base = createMapBase(width, height)
  base.terrain.set(terrain)
  syncPhases(base, doc.materials)

  // Tinta de bioma sem ficha (orfa) nao pinta nada.
  const known = new Set(doc.biomes.map((b) => b.slot))
  for (let i = 0; i < biome.length; i++) if (biome[i] !== 0 && !known.has(biome[i])) biome[i] = 0
  const maxB = doc.biomes.reduce((m, b) => Math.max(m, b.slot), 0)
  const biomePalette = new Uint8Array((maxB + 1) * 3 + 3)
  for (const b of doc.biomes) {
    const [r, g, bl] = hexToRgb(BIOMES[b.type].color)
    biomePalette[b.slot * 3] = r
    biomePalette[b.slot * 3 + 1] = g
    biomePalette[b.slot * 3 + 2] = bl
  }

  const full = document.createElement('canvas')
  full.width = width
  full.height = height
  const fullCtx = full.getContext('2d')
  if (!fullCtx) throw new Error('Canvas 2D indisponivel')
  paintComposite(
    fullCtx,
    base,
    new Uint16Array(width * height),
    biome,
    { ...materialPalette(doc.materials), territory: new Uint8Array(3), biome: biomePalette },
    { mode: 'biomas', showBorders: false, coastLine: false },
    rectOf(0, 0, width - 1, height - 1),
  )

  const w = Math.min(COMPANION_WIDTH, width)
  const h = Math.max(1, Math.round((height * w) / width))
  const small = document.createElement('canvas')
  small.width = w
  small.height = h
  const ctx = small.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D indisponivel')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(full, 0, 0, w, h)
  return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h }
}

/** Plano B: a miniatura do atlas (ou um cinza), se as camadas falharem. */
function fromThumbnail(body: BodySummary): Promise<Texture> {
  const flat = (): Texture => ({
    data: new Uint8ClampedArray([140, 140, 136, 255, 140, 140, 136, 255]),
    width: 2,
    height: 1,
  })
  if (!body.hasThumbnail) return Promise.resolve(flat())
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return resolve(flat())
      ctx.drawImage(img, 0, 0)
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
      resolve({ data: image.data, width: canvas.width, height: canvas.height })
    }
    img.onerror = () => resolve(flat())
    img.src = api.thumbnailUrl(body.id, body.revision)
  })
}
