import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { BodyMeta, BodySummary, RingSpec } from '@valenzia/shared'
import type { Poi, World } from '../types'
import type { MapBase } from '../lib/layers'
import {
  clampLat,
  lonLatOf,
  projectPoint,
  renderGlobe,
  type Rotation,
  type Sphere,
  type Texture,
} from '../lib/globe'
import { drawRingHalf, ringStops, type RingStop } from '../lib/rings'
import { api } from '../lib/api'
import { POI_TYPES } from '../lib/poiTypes'

interface GlobeViewProps {
  /** O corpo em foco: tamanho, aneis, a quem orbita. */
  body: BodyMeta
  base: MapBase
  world: World
  /** A textura do mapa, pronta, vinda do proprio editor. */
  source: HTMLCanvasElement | null
  /** Pontos a mostrar; vazio esconde todos. */
  pois: Poi[]
  onSelectPoi: (id: string) => void
  /** Clique num corpo do ceu: abre o globo dele. */
  onOpenBody: (id: string) => void
  onClose: () => void
  /** Muda quando a textura do mapa foi repintada (visao, cores, pintura). */
  version: string
}

/**
 * Largura da textura lida. O globo tem no maximo uns 800px de diametro, e
 * 360 graus cabem nesse diametro: puxar os 4096 do mapa original so traria
 * tremulacao ao girar.
 */
const TEX_WIDTH = 1536
const MIN_R = 60
const MAX_R = 1400
/** Uma volta completa a cada ~40 segundos. */
const SPIN = 0.0004
/** A lua mais proxima da uma volta no ceu a cada ~30 segundos. */
const ORBIT = 0.00021

/** Um corpo do mesmo sistema, visto do corpo em foco. */
interface Companion {
  body: BodySummary
  texture: Texture
  /** Raio na tela, em multiplos do raio do foco. */
  size: number
  /** Distancia da orbita aparente, em multiplos do raio do foco. */
  distance: number
  phase: number
  speed: number
  stops: RingStop[] | null
}

/**
 * Tamanho aparente de um vizinho. A escala real nao cabe na tela (a Lua vista
 * da Terra a escala ficaria a 60 raios de distancia), entao as distancias sao
 * de mentira e os tamanhos sao comprimidos -- grande continua maior que
 * pequeno, mas um satelite minusculo ainda aparece como um ponto.
 */
function apparentSize(ratio: number): number {
  // Menor que o foco: encolhe devagar ate virar um ponto. Maior (o planeta
  // visto da lua): cresce com moderacao e domina o fundo sem engolir a tela.
  if (ratio <= 1) return Math.max(0.05, Math.pow(ratio, 0.8))
  return Math.min(2, Math.pow(ratio, 0.5))
}

/**
 * Os vizinhos de um corpo: o planeta mostra as luas; a lua mostra o planeta
 * e as irmas. Distancias em fila, de dentro para fora, sem encostar.
 */
function layout(focus: BodyMeta, bodies: BodySummary[]) {
  let edge = Math.max(1, focus.rings?.outer ?? 0) + 0.9
  return bodies.map((body, k) => {
    const size = apparentSize(body.radiusKm / focus.radiusKm)
    const reach = size * Math.max(1, body.rings?.outer ?? 0)
    const distance = edge + reach
    edge = distance + reach + 0.6
    return {
      body,
      size,
      distance,
      // Fases espalhadas pelo angulo de ouro: ninguem nasce em cima de ninguem.
      phase: k * 2.39996 + 0.6,
      speed: ORBIT / (1 + k * 0.55),
      stops: body.rings ? ringStops(body.rings) : null,
    }
  })
}

/** Quantos raios do foco o sistema ocupa para cada lado. */
function extentOf(focus: BodyMeta, companions: Pick<Companion, 'size' | 'distance' | 'body'>[]) {
  let extent = Math.max(1, focus.rings?.outer ?? 0)
  for (const c of companions) {
    extent = Math.max(extent, c.distance + c.size * Math.max(1, c.body.rings?.outer ?? 0))
  }
  return extent
}

/** A miniatura do atlas vira a textura do vizinho. */
function loadTexture(body: BodySummary): Promise<Texture> {
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

export function GlobeView(props: GlobeViewProps) {
  const { base, body } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [rotation, setRotation] = useState<Rotation>({ lon: 0, lat: 0.35 })
  const [radius, setRadius] = useState(0)
  const [spinning, setSpinning] = useState(true)
  const [showPois, setShowPois] = useState(true)
  const [showSystem, setShowSystem] = useState(true)
  const [companions, setCompanions] = useState<Companion[]>([])
  const draggingRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  /** A roda do mouse ja mexeu no zoom: o enquadramento automatico para. */
  const zoomedRef = useRef(false)
  /** Enquanto a mao gira, desenha em meia resolucao: quatro vezes menos conta. */
  const coarseRef = useRef(false)
  const frameRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    const node = hostRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ w: Math.round(width), h: Math.round(height) })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  /* ------------------------------------------------------------ vizinhos */
  useEffect(() => {
    let alive = true
    api
      .listBodies()
      .then(async (tree) => {
        let neighbours: BodySummary[] = []
        if (body.parentId) {
          const parent = tree.find((p) => p.id === body.parentId)
          if (parent) neighbours = [parent, ...parent.moons.filter((m) => m.id !== body.id)]
        } else {
          neighbours = tree.find((p) => p.id === body.id)?.moons ?? []
        }
        const placed = layout(body, neighbours)
        const textures = await Promise.all(placed.map((c) => loadTexture(c.body)))
        if (alive) setCompanions(placed.map((c, i) => ({ ...c, texture: textures[i] })))
      })
      .catch(() => {
        // Sem o atlas, o globo segue sozinho.
      })
    return () => {
      alive = false
    }
  }, [body])

  const visible = useMemo(() => (showSystem ? companions : []), [showSystem, companions])

  // Enquadramento: o globo e, se houver, o sistema inteiro, com folga. Para
  // de se ajustar quando a pessoa mexe no zoom.
  useEffect(() => {
    if (!size.w || !size.h || zoomedRef.current) return
    const extent = extentOf(body, visible)
    const fit = Math.min(size.w, size.h) * 0.42
    const wide = (size.w * 0.47) / extent
    // O foco nao encolhe alem de um quarto da tela so para caber o sistema
    // inteiro: o que sobrar sai pela borda nas pontas da orbita.
    const floor = Math.min(size.w, size.h) * 0.24
    setRadius(Math.max(MIN_R, floor, Math.min(fit, wide)))
  }, [size, body, visible])

  /**
   * A textura, reduzida uma vez e lida em memoria. Fica num efeito, e nao num
   * memo, porque quem repinta o mapa e um efeito de layout do editor: ler
   * durante a renderizacao pegaria a textura do quadro anterior.
   */
  const [texture, setTexture] = useState<Texture | null>(null)
  useEffect(() => {
    if (!props.source) return
    const h = Math.round((TEX_WIDTH * base.height) / base.width)
    const canvas = document.createElement('canvas')
    canvas.width = TEX_WIDTH
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(props.source, 0, 0, TEX_WIDTH, h)
    const image = ctx.getImageData(0, 0, TEX_WIDTH, h)
    setTexture({ data: image.data, width: TEX_WIDTH, height: h })
  }, [props.source, props.version, base.width, base.height])

  const sphere: Sphere = useMemo(
    () => ({ cx: size.w / 2, cy: size.h / 2, r: radius }),
    [size, radius],
  )

  /* ---------------------------------------------------- o corpo em foco */
  // A esfera do foco e a parte cara: so e refeita quando gira ou muda de
  // tamanho, num canvas fora da tela. A cena por cima e montada a cada quadro.
  const focusRef = useRef<HTMLCanvasElement | null>(null)
  const dprRef = useRef(1)
  useEffect(() => {
    if (!texture || !size.w || !size.h || !radius) return
    // Teto de 1,5: o globo e uma imagem macia, e cada ponto a mais custa um
    // seno e um arco-tangente. Girando, anda de 2 em 2 pixels.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    dprRef.current = dpr
    const step = coarseRef.current || spinning ? 2 : 1
    const w = Math.round(size.w * dpr)
    const h = Math.round(size.h * dpr)
    const canvas = focusRef.current ?? document.createElement('canvas')
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const image = ctx.createImageData(w, h)
    renderGlobe(
      image,
      texture,
      { cx: sphere.cx * dpr, cy: sphere.cy * dpr, r: sphere.r * dpr },
      rotation,
      step,
    )
    ctx.putImageData(image, 0, 0)
    focusRef.current = canvas
  }, [texture, sphere, rotation, size, radius, spinning])

  /* ---------------------------------------------------- a cena, a cada quadro */
  const live = useRef({ rotation, sphere, visible, rings: body.rings })
  live.current = { rotation, sphere, visible, rings: body.rings }
  const focusStops = useMemo(() => (body.rings ? ringStops(body.rings) : null), [body.rings])
  const focusStopsRef = useRef(focusStops)
  focusStopsRef.current = focusStops
  /** A esfera de cada vizinho, guardada ate mudar de tamanho ou de inclinacao. */
  const spritesRef = useRef(new Map<string, { canvas: HTMLCanvasElement; key: string }>())
  const labelsRef = useRef(new Map<string, HTMLButtonElement>())

  useEffect(() => {
    let raf = 0
    const start = performance.now()

    const sprite = (c: Companion, pr: number, lat: number) => {
      const key = Math.round(pr) + ':' + lat.toFixed(3) + ':' + (coarseRef.current ? 2 : 1)
      const cached = spritesRef.current.get(c.body.id)
      if (cached && cached.key === key) return cached.canvas
      const d = Math.max(2, Math.ceil(pr * 2) + 2)
      const canvas = cached?.canvas ?? document.createElement('canvas')
      canvas.width = d
      canvas.height = d
      const ctx = canvas.getContext('2d')
      if (!ctx) return canvas
      const image = ctx.createImageData(d, d)
      // Travado pela mare: o vizinho mostra sempre a mesma face.
      renderGlobe(image, c.texture, { cx: d / 2, cy: d / 2, r: pr }, { lon: c.phase, lat }, coarseRef.current ? 2 : 1)
      ctx.putImageData(image, 0, 0)
      spritesRef.current.set(c.body.id, { canvas, key })
      return canvas
    }

    const ring = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      r: number,
      spec: RingSpec | null,
      stops: RingStop[] | null,
      sinLat: number,
      half: 'back' | 'front',
    ) => {
      if (spec && stops) drawRingHalf(ctx, x, y, r, spec, sinLat, half, stops)
    }

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      const canvas = canvasRef.current
      const focus = focusRef.current
      if (!canvas || !focus) return
      if (canvas.width !== focus.width || canvas.height !== focus.height) {
        canvas.width = focus.width
        canvas.height = focus.height
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const { rotation: rot, sphere: sp, visible: comps, rings } = live.current
      const dpr = dprRef.current
      const cx = sp.cx * dpr
      const cy = sp.cy * dpr
      const r = sp.r * dpr
      const sinLat = Math.sin(rot.lat)
      const t = now - start

      // Onde cada vizinho esta agora: na orbita aparente, no plano do equador.
      const placed = comps.map((c) => {
        const phi = c.phase + c.speed * t - rot.lon
        return {
          c,
          x: cx + c.distance * r * Math.sin(phi),
          y: cy + c.distance * r * sinLat * Math.cos(phi),
          depth: Math.cos(phi),
          pr: c.size * r,
        }
      })
      placed.sort((a, b) => a.depth - b.depth)

      const drawCompanion = (p: (typeof placed)[number]) => {
        ring(ctx, p.x, p.y, p.pr, p.c.body.rings, p.c.stops, sinLat, 'back')
        const img = sprite(p.c, p.pr, rot.lat)
        ctx.drawImage(img, p.x - img.width / 2, p.y - img.height / 2)
        ring(ctx, p.x, p.y, p.pr, p.c.body.rings, p.c.stops, sinLat, 'front')
      }

      // Os vizinhos estao longe: ficam sempre no fundo, atras do corpo em
      // foco e dos aneis dele -- giram em volta, mas nunca tampam o que se
      // esta olhando. Entre eles, o mais distante primeiro.
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const p of placed) drawCompanion(p)
      ring(ctx, cx, cy, r, rings, focusStopsRef.current, sinLat, 'back')
      ctx.drawImage(focus, 0, 0)
      ring(ctx, cx, cy, r, rings, focusStopsRef.current, sinLat, 'front')

      // Os nomes acompanham os corpos; quem esta escondido atras do foco some.
      for (const p of placed) {
        const label = labelsRef.current.get(p.c.body.id)
        if (!label) continue
        const hidden = Math.hypot(p.x - cx, p.y - cy) < r
        const hit = Math.max(14, (p.pr * 2) / dpr)
        label.style.display = hidden ? 'none' : ''
        label.style.left = p.x / dpr + 'px'
        label.style.top = p.y / dpr + 'px'
        label.style.width = hit + 'px'
        label.style.height = hit + 'px'
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Giro automatico, ate a mao encostar.
  useEffect(() => {
    if (!spinning) return
    let last = performance.now()
    const step = (now: number) => {
      const dt = now - last
      last = now
      setRotation((r) => ({ ...r, lon: r.lon + SPIN * dt }))
      frameRef.current = requestAnimationFrame(step)
    }
    frameRef.current = requestAnimationFrame(step)
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
    }
  }, [spinning])

  const onPointerDown = (event: React.PointerEvent) => {
    ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
    draggingRef.current = { x: event.clientX, y: event.clientY, moved: false }
    coarseRef.current = true
    setSpinning(false)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = draggingRef.current
    if (!drag) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (Math.hypot(dx, dy) > 3) drag.moved = true
    drag.x = event.clientX
    drag.y = event.clientY
    // Um pixel de arrasto empurra o mesmo tanto de superficie, qualquer que
    // seja o tamanho do globo na tela.
    setRotation((r) => ({
      lon: r.lon - dx / sphere.r,
      lat: clampLat(r.lat + dy / sphere.r),
    }))
  }

  const onPointerUp = () => {
    draggingRef.current = null
    coarseRef.current = false
    // Um redesenho em resolucao cheia agora que a mao parou.
    setRotation((r) => ({ ...r }))
  }

  useEffect(() => {
    const node = hostRef.current
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      zoomedRef.current = true
      setRadius((r) => {
        const next = r * Math.exp(-event.deltaY * 0.0014)
        return next < MIN_R ? MIN_R : next > MAX_R ? MAX_R : next
      })
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [])

  /** Os pontos que estao na face visivel, ja na posicao da tela. */
  const marks = useMemo(() => {
    if (!showPois || !radius) return []
    return props.pois
      .map((poi) => {
        const [lon, lat] = lonLatOf(poi.x, poi.y, base.width, base.height)
        const p = projectPoint(lon, lat, sphere, rotation)
        return { poi, ...p }
      })
      .filter((m) => m.visible)
  }, [props.pois, showPois, sphere, rotation, base.width, base.height, radius])

  return (
    <div className="globe">
      <div className="globe-bar">
        <strong>{props.world.name}</strong>
        <span className="muted small">
          {((((rotation.lon * 180) / Math.PI + 540) % 360) - 180).toFixed(0)}deg,{' '}
          {((rotation.lat * 180) / Math.PI).toFixed(0)}deg
        </span>
        <div className="spacer" />
        <button
          className={'chip' + (spinning ? ' active' : '')}
          onClick={() => setSpinning((v) => !v)}
        >
          Girar
        </button>
        <button
          className={'chip' + (showPois ? ' active' : '')}
          onClick={() => setShowPois((v) => !v)}
        >
          Pontos
        </button>
        {companions.length > 0 && (
          <button
            className={'chip' + (showSystem ? ' active' : '')}
            title={body.parentId ? 'O planeta e as luas irmas' : 'As luas deste planeta'}
            onClick={() => setShowSystem((v) => !v)}
          >
            Sistema ({companions.length})
          </button>
        )}
        <button
          className="chip"
          onClick={() => {
            setRotation({ lon: 0, lat: 0.35 })
            zoomedRef.current = false
            setSize((s) => ({ ...s }))
          }}
        >
          Centralizar
        </button>
        <button className="icon-button" title="Voltar ao mapa (Esc)" onClick={props.onClose}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div
        className="globe-stage"
        ref={hostRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <canvas
          ref={canvasRef}
          style={{ width: size.w, height: size.h }}
          className="globe-canvas"
        />

        {/* O halo nao e enfeite: sem ele a borda do disco serrilha. */}
        <div
          className="globe-halo"
          style={{
            left: sphere.cx - radius,
            top: sphere.cy - radius,
            width: radius * 2,
            height: radius * 2,
          }}
        />

        {marks.map((m) => (
          <button
            key={m.poi.id}
            className="globe-poi"
            style={{ left: m.x, top: m.y }}
            title={m.poi.name + ' - ' + POI_TYPES[m.poi.type].label}
            onClick={(e) => {
              e.stopPropagation()
              props.onSelectPoi(m.poi.id)
            }}
          >
            <span style={{ background: POI_TYPES[m.poi.type].color }} />
          </button>
        ))}

        {visible.map((c) => (
          <button
            key={c.body.id}
            ref={(node) => {
              if (node) labelsRef.current.set(c.body.id, node)
              else labelsRef.current.delete(c.body.id)
            }}
            className="globe-body"
            title={'Ir para ' + c.body.name}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => props.onOpenBody(c.body.id)}
          >
            <span className="globe-body-name">
              {c.body.name}
              <small>{c.body.parentId ? 'lua' : 'planeta'}</small>
            </span>
          </button>
        ))}

        {!texture && <p className="muted small globe-hint">Montando o globo...</p>}
      </div>

      <p className="globe-foot muted small">
        Arraste para girar, roda do mouse para aproximar. Clique num corpo do ceu
        para ir ate ele. So o X (ou Esc) volta para o mapa.
      </p>
    </div>
  )
}
