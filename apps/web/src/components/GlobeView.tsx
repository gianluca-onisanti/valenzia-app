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
  /** Monta a textura do mapa, com ou sem fronteiras e costa. */
  makeTexture: (borders: boolean) => HTMLCanvasElement | null
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

const rad = (deg: number) => (deg * Math.PI) / 180

/**
 * Um corpo do sistema, no seu lugar da disposicao comum. A disposicao e uma
 * so, medida em raios do planeta (o planeta tem tamanho 1, no centro), e nao
 * depende de quem esta em foco: trocar de foco so muda o centro da camera e o
 * zoom. Assim, a lua vista do planeta e o planeta visto da lua guardam
 * exatamente a mesma proporcao de tamanho e de distancia.
 */
interface Member {
  body: BodySummary
  /** Raio aparente, em raios do planeta. */
  size: number
  /** Raio da orbita em volta do planeta, em raios do planeta (0 = o planeta). */
  orbit: number
  phase: number
  speed: number
  stops: RingStop[] | null
}

interface Companion extends Member {
  texture: Texture
}

/**
 * Tamanho aparente de uma lua, relativo ao planeta. A escala real nao cabe
 * na tela (a Lua vista da Terra ficaria a 60 raios de distancia), entao as
 * distancias sao de mentira e os tamanhos sao comprimidos -- grande continua
 * maior que pequeno, mas um satelite minusculo ainda aparece como um ponto.
 */
function apparentSize(ratio: number): number {
  return Math.min(3, Math.max(0.05, Math.pow(ratio, 0.8)))
}

/** O sistema inteiro: o planeta no centro e as luas em fila, sem encostar. */
function systemLayout(planet: BodySummary, moons: BodySummary[]): Member[] {
  const members: Member[] = [
    {
      body: planet,
      size: 1,
      orbit: 0,
      phase: 0,
      speed: 0,
      stops: planet.rings ? ringStops(planet.rings) : null,
    },
  ]
  let edge = Math.max(1, planet.rings?.outer ?? 0) + 0.9
  moons.forEach((body, k) => {
    const size = apparentSize(body.radiusKm / planet.radiusKm)
    const reach = size * Math.max(1, body.rings?.outer ?? 0)
    const orbit = edge + reach
    edge = orbit + reach + 0.6
    members.push({
      body,
      size,
      orbit,
      // Fases espalhadas pelo angulo de ouro: ninguem nasce em cima de ninguem.
      phase: k * 2.39996 + 0.6,
      speed: ORBIT / (1 + k * 0.55),
      stops: body.rings ? ringStops(body.rings) : null,
    })
  })
  return members
}

/** Onde o membro esta no plano do equador do planeta: [x, profundidade]. */
function positionOf(m: Member, t: number): [number, number] {
  if (!m.orbit) return [0, 0]
  const a = m.phase + m.speed * t
  return [m.orbit * Math.sin(a), m.orbit * Math.cos(a)]
}

/**
 * Onde cai na tela (relativo ao centro do foco) um ponto do plano do equador
 * do planeta, a (rx, rz) do foco: gira pela camera, achata pela inclinacao do
 * olhar e tomba com o eixo do planeta. A mesma conta serve ao desenho e ao
 * enquadramento.
 */
function screenOffset(
  rx: number,
  rz: number,
  cam: number,
  sinLat: number,
  roll: number,
  unit: number,
): [number, number] {
  const sx = rx * Math.cos(cam) - rz * Math.sin(cam)
  const sz = rz * Math.cos(cam) + rx * Math.sin(cam)
  const ox = sx * unit
  const oy = sz * sinLat * unit
  return [ox * Math.cos(roll) - oy * Math.sin(roll), ox * Math.sin(roll) + oy * Math.cos(roll)]
}

/** Quantos raios do foco o sistema pode ocupar para cada lado. */
function extentFrom(focus: Member, others: Member[]): number {
  let extent = Math.max(1, focus.body.rings?.outer ?? 0)
  for (const o of others) {
    const reach = o.size * Math.max(1, o.body.rings?.outer ?? 0)
    extent = Math.max(extent, (o.orbit + focus.orbit + reach) / focus.size)
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
  /** Fronteiras e costa: desligadas por padrao, porque serrilham na esfera. */
  const [showBorders, setShowBorders] = useState(false)
  const [system, setSystem] = useState<{ focus: Member; others: Companion[] } | null>(null)
  const companions = useMemo(() => system?.others ?? [], [system])
  /**
   * Para onde a camera olha no sistema. So o arrasto mexe nela: o giro
   * automatico gira o corpo no proprio eixo, sem carregar o ceu junto.
   */
  const camLonRef = useRef(0)
  const camHomeRef = useRef(0)
  const draggingRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  /** A pessoa ja girou a camera: o enquadramento automatico nao mexe mais nela. */
  const draggedRef = useRef(false)
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
        const planet = tree.find((p) => p.id === (body.parentId ?? body.id))
        if (!planet) return
        const members = systemLayout(planet, planet.moons)
        const focus = members.find((m) => m.body.id === body.id)
        if (!focus) return
        const others = members.filter((m) => m !== focus)
        const textures = await Promise.all(others.map((m) => loadTexture(m.body)))
        if (!alive) return
        setSystem({ focus, others: others.map((m, i) => ({ ...m, texture: textures[i] })) })
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
    const extent = system ? extentFrom(system.focus, visible) : 1
    const fit = Math.min(size.w, size.h) * 0.42
    const wide = (size.w * 0.47) / extent
    // O foco nao encolhe demais so para caber o sistema inteiro: o que sobrar
    // sai pela borda (a roda do mouse afasta a camera para ver tudo). Numa
    // lua o piso e menor: o planeta, na escala certa, e bem maior que ela.
    const floor = Math.min(size.w, size.h) * (system?.focus.orbit ? 0.1 : 0.24)
    const next = Math.max(MIN_R, floor, Math.min(fit, wide))
    setRadius(next)

    // Numa lua, o planeta (na escala certa) fica longe e grande. A camera
    // nasce com ele por tras, puxado para o lado so o bastante para o centro
    // dele cair perto da borda da tela: aparece enorme no ceu, sem tampar a
    // lua. Depois que a pessoa arrasta, a camera e dela.
    const focus = system?.focus
    if (focus?.orbit && !draggedRef.current) {
      // Procura, entre 360 angulos de camera, o que poe o centro do planeta
      // mais perto do alto a esquerda da tela -- com a mesma conta do
      // desenho, inclinacao e achatamento inclusos.
      const planet = system?.others.find((o) => o.orbit === 0)
      const roll = rad(planet?.body.axialTilt ?? 0)
      const unit = next / focus.size
      const [fx, fz] = positionOf(focus, 0)
      const want = { x: -size.w * 0.3, y: -size.h * 0.32 }
      let best = 0
      let bestError = Infinity
      for (let i = 0; i < 360; i++) {
        const cam = (i / 360) * Math.PI * 2
        const [x, y] = screenOffset(-fx, -fz, cam, Math.sin(0.35), roll, unit)
        const error = Math.hypot(x - want.x, y - want.y)
        if (error < bestError) {
          bestError = error
          best = cam
        }
      }
      camHomeRef.current = best
      camLonRef.current = best
    }
  }, [size, system, visible])

  /**
   * A textura, reduzida uma vez e lida em memoria. Fica num efeito, e nao num
   * memo, porque quem repinta o mapa e um efeito de layout do editor: ler
   * durante a renderizacao pegaria a textura do quadro anterior.
   */
  const [texture, setTexture] = useState<Texture | null>(null)
  const { makeTexture } = props
  useEffect(() => {
    const source = makeTexture(showBorders)
    if (!source) return
    const h = Math.round((TEX_WIDTH * base.height) / base.width)
    const canvas = document.createElement('canvas')
    canvas.width = TEX_WIDTH
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, TEX_WIDTH, h)
    const image = ctx.getImageData(0, 0, TEX_WIDTH, h)
    setTexture({ data: image.data, width: TEX_WIDTH, height: h })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBorders, props.version, base.width, base.height])

  const sphere: Sphere = useMemo(
    () => ({ cx: size.w / 2, cy: size.h / 2, r: radius }),
    [size, radius],
  )

  /** Inclinacao do corpo em foco (ao vivo, vem do editor). */
  const focusRoll = rad(body.axialTilt ?? 0)
  /**
   * As luas orbitam no plano do equador do planeta: o sistema tomba com a
   * inclinacao dele. No planeta, e a do proprio foco.
   */
  const systemRoll = body.parentId
    ? rad(companions.find((c) => c.orbit === 0)?.body.axialTilt ?? 0)
    : focusRoll

  /* ---------------------------------------------------- o corpo em foco */
  // A esfera do foco e a parte cara: so e refeita quando gira ou muda de
  // tamanho, num canvas fora da tela. A cena por cima e montada a cada quadro.
  const focusRef = useRef<HTMLCanvasElement | null>(null)
  const dprRef = useRef(1)
  useEffect(() => {
    if (!texture || !size.w || !size.h || !radius) return
    // Teto de 1,5: o globo e uma imagem macia, e cada ponto a mais custa um
    // seno e um arco-tangente.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    dprRef.current = dpr
    // Em movimento (girando ou arrastando), desenha em meia resolucao e a
    // cena amplia com suavizacao: 4x menos conta, e o resultado fica macio
    // em vez de serrilhado. Parado, resolucao cheia.
    const scale = coarseRef.current || spinning ? 0.5 : 1
    const w = Math.max(1, Math.round(size.w * dpr * scale))
    const h = Math.max(1, Math.round(size.h * dpr * scale))
    const canvas = focusRef.current ?? document.createElement('canvas')
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const image = ctx.createImageData(w, h)
    const k = dpr * scale
    renderGlobe(
      image,
      texture,
      { cx: sphere.cx * k, cy: sphere.cy * k, r: sphere.r * k },
      rotation,
      1,
      focusRoll,
    )
    ctx.putImageData(image, 0, 0)
    focusRef.current = canvas
  }, [texture, sphere, rotation, size, radius, spinning, focusRoll])

  /* ---------------------------------------------------- a cena, a cada quadro */
  const focusMember = system?.focus ?? null
  const live = useRef({ rotation, sphere, visible, rings: body.rings, focusMember, focusRoll, systemRoll })
  live.current = { rotation, sphere, visible, rings: body.rings, focusMember, focusRoll, systemRoll }
  const focusStops = useMemo(() => (body.rings ? ringStops(body.rings) : null), [body.rings])
  const focusStopsRef = useRef(focusStops)
  focusStopsRef.current = focusStops
  /** A esfera de cada vizinho, guardada ate mudar de tamanho ou de inclinacao. */
  const spritesRef = useRef(new Map<string, { canvas: HTMLCanvasElement; key: string }>())
  const labelsRef = useRef(new Map<string, HTMLButtonElement>())

  useEffect(() => {
    let raf = 0
    const start = performance.now()

    /** Teto da esfera de um vizinho: maior que isso, a imagem e esticada. */
    const SPRITE_MAX = 420
    const sprite = (c: Companion, wanted: number, lat: number) => {
      const pr = Math.min(wanted, SPRITE_MAX)
      const roll = rad(c.body.axialTilt ?? 0)
      const key =
        Math.round(pr) + ':' + lat.toFixed(3) + ':' + roll.toFixed(3) + ':' + (coarseRef.current ? 2 : 1)
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
      renderGlobe(
        image,
        c.texture,
        { cx: d / 2, cy: d / 2, r: pr },
        { lon: c.phase, lat },
        coarseRef.current ? 2 : 1,
        roll,
      )
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
      roll: number,
    ) => {
      if (spec && stops) drawRingHalf(ctx, x, y, r, spec, sinLat, half, stops, roll)
    }

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      const canvas = canvasRef.current
      const focus = focusRef.current
      if (!canvas || !focus) return
      const full = live.current.sphere
      const cw = Math.round(full.cx * 2 * dprRef.current)
      const ch = Math.round(full.cy * 2 * dprRef.current)
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw
        canvas.height = ch
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const {
        rotation: rot,
        sphere: sp,
        visible: comps,
        rings,
        focusMember: fm,
        focusRoll: froll,
        systemRoll: sroll,
      } = live.current
      const dpr = dprRef.current
      const cx = sp.cx * dpr
      const cy = sp.cy * dpr
      const r = sp.r * dpr
      const sinLat = Math.sin(rot.lat)
      // Vista de uma lua, o ceu anda 5x mais devagar: o planeta enorme nao
      // sai de quadro em poucos segundos. As posicoes sao as mesmas.
      const t = (now - start) * (fm?.orbit ? 0.2 : 1)
      const cam = camLonRef.current
      const cos = Math.cos(cam)
      const sin = Math.sin(cam)
      // Pixels por raio do planeta: o foco tem `size` raios e ocupa `r`.
      const unit = fm ? r / fm.size : r
      const [fx, fz] = fm ? positionOf(fm, t) : [0, 0]

      // Onde cada vizinho esta agora, relativo ao foco, no plano do equador
      // do planeta, girado pela camera e achatado pela inclinacao.
      const placed = comps.map((c) => {
        const [px, pz] = positionOf(c, t)
        const rx = px - fx
        const rz = pz - fz
        const sz = rz * cos + rx * sin
        const pr = c.size * unit
        // A orbita no plano do equador do planeta, tombada com ele.
        const [ox, oy] = screenOffset(rx, rz, cam, sinLat, sroll, unit)
        const x = cx + ox
        const y = cy + oy
        const reach = pr * Math.max(1, c.body.rings?.outer ?? 0)
        const onScreen =
          x + reach > 0 && x - reach < canvas.width && y + reach > 0 && y - reach < canvas.height
        return { c, x, y, depth: sz, pr, onScreen }
      })
      placed.sort((a, b) => a.depth - b.depth)

      const drawCompanion = (p: (typeof placed)[number]) => {
        if (!p.onScreen) return
        const roll = rad(p.c.body.axialTilt ?? 0)
        ring(ctx, p.x, p.y, p.pr, p.c.body.rings, p.c.stops, sinLat, 'back', roll)
        const img = sprite(p.c, p.pr, rot.lat)
        // A esfera pode ter sido desenhada menor (teto) e e esticada aqui.
        const scale = p.pr / Math.min(p.pr, SPRITE_MAX)
        const dw = img.width * scale
        const dh = img.height * scale
        ctx.drawImage(img, p.x - dw / 2, p.y - dh / 2, dw, dh)
        ring(ctx, p.x, p.y, p.pr, p.c.body.rings, p.c.stops, sinLat, 'front', roll)
      }

      // Os vizinhos estao longe: ficam sempre no fundo, atras do corpo em
      // foco e dos aneis dele -- giram em volta, mas nunca tampam o que se
      // esta olhando. Entre eles, o mais distante primeiro.
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const p of placed) drawCompanion(p)
      ring(ctx, cx, cy, r, rings, focusStopsRef.current, sinLat, 'back', froll)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(focus, 0, 0, canvas.width, canvas.height)
      ring(ctx, cx, cy, r, rings, focusStopsRef.current, sinLat, 'front', froll)

      // Os nomes acompanham os corpos; quem esta escondido atras do foco some.
      for (const p of placed) {
        const label = labelsRef.current.get(p.c.body.id)
        if (!label) continue
        const hidden = !p.onScreen || Math.hypot(p.x - cx, p.y - cy) < r
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

  // Giro automatico, ate a mao encostar. No sentido normal (anti-horario
  // visto do polo norte, como a Terra) a superficie anda da esquerda para a
  // direita, e a longitude no centro da tela diminui; a retrograda inverte.
  const spinSign = body.retrograde ? 1 : -1
  useEffect(() => {
    if (!spinning) return
    let last = performance.now()
    const step = (now: number) => {
      const dt = now - last
      // ~30 quadros por segundo bastam para um giro lento, e deixam folga
      // para a esfera em resolucao cheia.
      if (dt >= 40) {
        last = now
        setRotation((r) => ({ ...r, lon: r.lon + spinSign * SPIN * dt }))
      }
      frameRef.current = requestAnimationFrame(step)
    }
    frameRef.current = requestAnimationFrame(step)
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
    }
  }, [spinning, spinSign])

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
    if (Math.hypot(dx, dy) > 3) {
      drag.moved = true
      draggedRef.current = true
    }
    drag.x = event.clientX
    drag.y = event.clientY
    // Um pixel de arrasto empurra o mesmo tanto de superficie, qualquer que
    // seja o tamanho do globo na tela. O arrasto e lido no referencial do
    // corpo inclinado, para a superficie seguir o mouse. A camera do sistema
    // gira junto.
    const bx = dx * Math.cos(focusRoll) + dy * Math.sin(focusRoll)
    const by = -dx * Math.sin(focusRoll) + dy * Math.cos(focusRoll)
    camLonRef.current -= bx / sphere.r
    setRotation((r) => ({
      lon: r.lon - bx / sphere.r,
      lat: clampLat(r.lat + by / sphere.r),
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
        const p = projectPoint(lon, lat, sphere, rotation, focusRoll)
        return { poi, ...p }
      })
      .filter((m) => m.visible)
  }, [props.pois, showPois, sphere, rotation, base.width, base.height, radius, focusRoll])

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
        <button
          className={'chip' + (showBorders ? ' active' : '')}
          title="Fronteiras e linha de costa na esfera"
          onClick={() => setShowBorders((v) => !v)}
        >
          Fronteiras
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
            camLonRef.current = camHomeRef.current
            draggedRef.current = false
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
