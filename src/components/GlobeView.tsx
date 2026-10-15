import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { POI_TYPES } from '../lib/poiTypes'

interface GlobeViewProps {
  base: MapBase
  world: World
  /** A textura do mapa, pronta, vinda do proprio editor. */
  source: HTMLCanvasElement | null
  /** Falso quando a costa ja vem desenhada na textura do mapa. */
  inkOverlay: boolean
  /** Pontos a mostrar; vazio esconde todos. */
  pois: Poi[]
  onSelectPoi: (id: string) => void
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
const MIN_R = 90
const MAX_R = 1400
/** Uma volta completa a cada ~40 segundos. */
const SPIN = 0.0004

export function GlobeView(props: GlobeViewProps) {
  const { base } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [rotation, setRotation] = useState<Rotation>({ lon: 0, lat: 0.35 })
  const [radius, setRadius] = useState(0)
  const [spinning, setSpinning] = useState(true)
  const [showPois, setShowPois] = useState(true)
  const draggingRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
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

  // Primeiro enquadramento: o globo entra inteiro, com folga.
  useEffect(() => {
    if (!size.w || !size.h || radius) return
    setRadius(Math.max(MIN_R, Math.min(size.w, size.h) * 0.42))
  }, [size, radius])

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
    // So quando a textura ainda nao traz a costa: senao sairiam duas linhas,
    // a tracada e a do desenho antigo, uma ao lado da outra.
    if (props.inkOverlay) ctx.drawImage(base.coast, 0, 0, TEX_WIDTH, h)
    const image = ctx.getImageData(0, 0, TEX_WIDTH, h)
    setTexture({ data: image.data, width: TEX_WIDTH, height: h })
  }, [props.source, props.version, props.inkOverlay, base.coast, base.width, base.height])

  const sphere: Sphere = useMemo(
    () => ({ cx: size.w / 2, cy: size.h / 2, r: radius }),
    [size, radius],
  )

  // Desenho. Sai do caminho do React: o giro e quadro a quadro.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !texture || !size.w || !size.h || !radius) return
    // Teto de 1,5: o globo e uma imagem macia, e cada ponto a mais custa um
    // seno e um arco-tangente. Girando, anda de 2 em 2 pixels.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const step = coarseRef.current || spinning ? 2 : 1
    const w = Math.round(size.w * dpr)
    const h = Math.round(size.h * dpr)
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
  }, [texture, sphere, rotation, size, radius, spinning])

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
        <button className="chip" onClick={() => setRotation({ lon: 0, lat: 0.35 })}>
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

        {!texture && <p className="muted small globe-hint">Montando o globo...</p>}
      </div>

      <p className="globe-foot muted small">
        Arraste para girar, roda do mouse para aproximar. So o X (ou Esc) volta
        para o mapa.
      </p>
    </div>
  )
}
