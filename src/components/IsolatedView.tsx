import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { BiomeArea, Poi, Territory } from '../types'
import type { MapBase, ViewMode, ViewOptions } from '../lib/layers'
import { traceLayer } from '../lib/trace'
import { drawScene, sceneToSvg, toShape, type Scene } from '../lib/vectorPaint'
import { BIOMES } from '../lib/biomes'
import { POI_TYPES } from '../lib/poiTypes'
import { downloadBlob, slug } from '../lib/store'

interface IsolatedViewProps {
  base: MapBase
  territory: Uint16Array
  biome: Uint16Array
  /** A visao em uso no mapa: o recorte abre igualzinho ao que esta na tela. */
  view: ViewOptions
  entity: Territory
  biomes: BiomeArea[]
  /** Pontos que caem dentro deste territorio. */
  pois: Poi[]
  onClose: () => void
  onSelectPoi: (id: string) => void
}

/** Limite de ampliacao, para um pais minusculo nao virar uma mancha so. */
const MAX_ZOOM = 12

const MODES: { id: ViewMode; label: string }[] = [
  { id: 'politica', label: 'Politica' },
  { id: 'biomas', label: 'Biomas' },
  { id: 'mista', label: 'Mista' },
]

/**
 * O territorio sozinho, grande e centralizado -- as mesmas cores, hachuras e
 * fronteiras do mapa, so que sem os vizinhos e sem o mar em volta.
 *
 * Aqui o desenho e sempre vetorial: o recorte costuma aparecer bem maior que
 * no mapa, que e justo onde o raster entregaria o degrau do pixel.
 */
export function IsolatedView(props: IsolatedViewProps) {
  const { base, entity } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<ViewMode>(props.view.mode)
  const [showPois, setShowPois] = useState(true)
  const [stage, setStage] = useState({ w: 0, h: 0 })

  // O recorte ja tem o proprio contorno; a linha da costa seria redundante.
  const view: ViewOptions = {
    mode,
    showBorders: props.view.showBorders,
    coastLine: false,
  }

  // Contorna as camadas uma vez, na abertura: a pintura nao muda com o modal
  // aberto, entao nao ha por que refazer isso a cada troca de visao.
  const scene: Scene | null = useMemo(() => {
    const shape = (() => {
      const loops = traceLayer(props.territory, base.width, base.height).get(entity.slot)
      return loops ? toShape(loops) : null
    })()
    if (!shape) return null
    const biomes = []
    for (const [slot, loops] of traceLayer(props.biome, base.width, base.height)) {
      const found = props.biomes.find((b) => b.slot === slot)
      const s = toShape(loops)
      if (found && s) biomes.push({ entity: found, shape: s })
    }
    return { land: null, territories: [{ entity, shape }], biomes }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity.slot, base.width, base.height])

  const bounds = scene?.territories[0].shape.bounds ?? [0, 0, 1, 1]
  const width = Math.max(1, bounds[2] - bounds[0])
  const height = Math.max(1, bounds[3] - bounds[1])

  // Mede a area util do modal para encaixar o recorte inteiro nela.
  useLayoutEffect(() => {
    const node = stageRef.current
    if (!node) return
    const observer = new ResizeObserver(([rect]) => {
      setStage({ w: rect.contentRect.width, h: rect.contentRect.height })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const scale = useMemo(() => {
    if (!stage.w || !stage.h) return 0
    return Math.min(MAX_ZOOM, Math.min(stage.w / width, stage.h / height))
  }, [stage, width, height])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !scene || !scale) return
    const dpr = window.devicePixelRatio || 1
    const total = scale * dpr
    canvas.width = Math.round(width * total)
    canvas.height = Math.round(height * total)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(total, 0, 0, total, -bounds[0] * total, -bounds[1] * total)
    drawScene(ctx, scene, { base, view, scale: total, selection: null, only: entity.slot })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, scale, mode, props.view.showBorders, base, entity.slot])

  /** Quanto de cada bioma cai dentro das fronteiras, lido da pintura. */
  const legend = useMemo(() => {
    const areas = new Map<number, number>()
    let total = 0
    const x0 = Math.max(0, Math.floor(bounds[0]))
    const y0 = Math.max(0, Math.floor(bounds[1]))
    const x1 = Math.min(base.width - 1, Math.ceil(bounds[2]))
    const y1 = Math.min(base.height - 1, Math.ceil(bounds[3]))
    for (let y = y0; y <= y1; y++) {
      const row = y * base.width
      for (let x = x0; x <= x1; x++) {
        if (props.territory[row + x] !== entity.slot) continue
        total++
        const bio = props.biome[row + x]
        if (bio !== 0) areas.set(bio, (areas.get(bio) ?? 0) + 1)
      }
    }
    const rows: { name: string; color: string; share: number }[] = []
    for (const [slot, area] of areas) {
      const b = props.biomes.find((x) => x.slot === slot)
      if (!b) continue
      rows.push({
        name: b.name,
        color: BIOMES[b.type].color,
        share: total ? (100 * area) / total : 0,
      })
    }
    return rows.sort((a, b) => b.share - a.share)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity.slot, props.biomes, base.width, base.height])

  /** PNG no dobro do tamanho do recorte: nitido sem virar arquivo gigante. */
  const savePng = () => {
    if (!scene) return
    const factor = 2
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * factor)
    canvas.height = Math.round(height * factor)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(factor, 0, 0, factor, -bounds[0] * factor, -bounds[1] * factor)
    drawScene(ctx, scene, { base, view, scale: factor, selection: null, only: entity.slot })
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, slug(entity.name) + '.png')
    })
  }

  const saveSvg = () => {
    if (!scene) return
    const svg = sceneToSvg(scene, {
      base,
      view,
      scale: 1,
      selection: null,
      only: entity.slot,
    })
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), slug(entity.name) + '.svg')
  }

  return (
    <div className="iso-backdrop" onPointerDown={props.onClose}>
      <div
        className="iso-modal"
        role="dialog"
        aria-label={'Recorte de ' + entity.name}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="iso-head">
          <span className="dot" style={{ background: entity.color }} />
          <strong>{entity.name}</strong>
          <span className="muted small">
            {Math.round(width)} x {Math.round(height)} px
          </span>
          <div className="spacer" />

          <div className="segmented">
            {MODES.map((m) => (
              <button
                key={m.id}
                className={mode === m.id ? 'active' : ''}
                onClick={() => setMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>

          <button
            className={'chip' + (showPois ? ' active' : '')}
            onClick={() => setShowPois((v) => !v)}
          >
            Pontos
          </button>
          <button className="chip" onClick={savePng}>
            PNG
          </button>
          <button className="chip" onClick={saveSvg} title="Vetor, sem perder no zoom">
            SVG
          </button>
          <button className="icon-button" title="Fechar (Esc)" onClick={props.onClose}>
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
        </header>

        <div className="iso-stage" ref={stageRef}>
          {!scene && <p className="muted small">Este territorio ainda nao tem pintura.</p>}
          <div
            className="iso-frame"
            style={{ width: width * scale, height: height * scale, opacity: scale ? 1 : 0 }}
          >
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />

            {showPois &&
              props.pois.map((poi) => (
                <button
                  key={poi.id}
                  className="iso-poi"
                  style={{
                    left: (poi.x - bounds[0]) * scale,
                    top: (poi.y - bounds[1]) * scale,
                  }}
                  title={POI_TYPES[poi.type].label}
                  onClick={() => props.onSelectPoi(poi.id)}
                >
                  <span
                    className="iso-poi-dot"
                    style={{ background: POI_TYPES[poi.type].color }}
                  />
                  <span className="iso-poi-name">{poi.name}</span>
                </button>
              ))}
          </div>
        </div>

        {legend.length > 0 && (
          <footer className="iso-legend">
            {legend.map((row) => (
              <span key={row.name} className="iso-legend-item">
                <span className="dot" style={{ background: row.color }} />
                {row.name}
                <span className="muted small">{row.share.toFixed(0)}%</span>
              </span>
            ))}
          </footer>
        )}
      </div>
    </div>
  )
}
