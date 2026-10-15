import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  PaintLayer,
  Poi,
  PoiType,
  Rect,
  Selection,
  Tool,
  Viewport,
  World,
} from '../types'
import {
  Journal,
  bucketFill,
  fillPolygon,
  padRect,
  paintComposite,
  rectOf,
  stampDisc,
  stampStroke,
  type MapBase,
  type Palette,
  type ViewOptions,
} from '../lib/layers'
import { POI_TYPES } from '../lib/poiTypes'

const MAX_SCALE = 12
const MIN_ZOOM_FACTOR = 0.8

export interface SlotStats {
  area: number
  bbox: Rect
  anchor: [number, number]
}

export interface MapViewHandle {
  fit(): void
  zoomBy(factor: number): void
  focusOn(x: number, y: number, scale?: number): void
  /** Repinta a textura: um retangulo, ou o mapa inteiro se vier null. */
  repaint(rect: Rect | null): void
}

interface MapViewProps {
  base: MapBase
  territory: Uint16Array
  biome: Uint16Array
  world: World
  palette: Palette
  /** Muda quando alguma cor e editada, forcando repintura total. */
  paletteVersion: number
  view: ViewOptions
  tool: Tool
  paintLayer: PaintLayer
  /** Slot que o pincel aplica; 0 apaga. */
  activeSlot: number
  /** Mares pintam na agua; paises e biomas, na terra. */
  paintOnLand: boolean
  brushSize: number
  selection: Selection
  territoryStats: Map<number, SlotStats>
  onSelect: (selection: Selection) => void
  onStrokeEnd: (journal: Journal, layer: PaintLayer) => void
  placingPoi: PoiType | null
  onPlacePoi: (x: number, y: number) => void
  onMovePoi: (id: string, x: number, y: number) => void
  visiblePoiTypes: Set<PoiType>
  showPois: boolean
  showLabels: boolean
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

export const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  props,
  ref,
) {
  const {
    base,
    territory,
    biome,
    world,
    palette,
    paletteVersion,
    view,
    tool,
    paintLayer,
    activeSlot,
    paintOnLand,
    brushSize,
    selection,
    territoryStats,
    onSelect,
    onStrokeEnd,
    placingPoi,
    onPlacePoi,
    onMovePoi,
    visiblePoiTypes,
    showPois,
    showLabels,
  } = props

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const compositeRef = useRef<{
    canvas: HTMLCanvasElement
    ctx: CanvasRenderingContext2D
  } | null>(null)

  const [size, setSize] = useState({ w: 0, h: 0 })
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 })
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [draggingPoi, setDraggingPoi] = useState<string | null>(null)
  /** Traco do laco em andamento, em coordenadas da imagem. */
  const lassoRef = useRef<{ x: number; y: number }[] | null>(null)
  const [, bumpFrame] = useState(0)
  const animation = useRef<number | null>(null)

  /* ------------------------------------------------------------- dimensoes */
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ w: Math.round(width), h: Math.round(height) })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const fitScale = useMemo(() => {
    if (!size.w || !size.h) return 1
    return Math.min(size.w / base.width, size.h / base.height)
  }, [size, base.width, base.height])

  const fit = useCallback(() => {
    if (!size.w || !size.h) return
    setViewport({
      x: (size.w - base.width * fitScale) / 2,
      y: (size.h - base.height * fitScale) / 2,
      scale: fitScale,
    })
  }, [fitScale, size, base.width, base.height])

  const fitted = useRef(false)
  useLayoutEffect(() => {
    if (fitted.current || !size.w || !size.h) return
    fitted.current = true
    fit()
  }, [fit, size])

  /* ----------------------------------------------------- textura composta */
  const repaint = useCallback(
    (rect: Rect | null) => {
      const composite = compositeRef.current
      if (!composite) return
      // As fronteiras consultam o vizinho, entao a area repintada cresce 2px.
      const area = rect
        ? padRect(rect, 2, base)
        : rectOf(0, 0, base.width - 1, base.height - 1)
      paintComposite(composite.ctx, base, territory, biome, palette, view, area)
      bumpFrame((n) => n + 1)
    },
    [base, territory, biome, palette, view],
  )

  useLayoutEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width = base.width
    canvas.height = base.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    compositeRef.current = { canvas, ctx }
    paintComposite(
      ctx,
      base,
      territory,
      biome,
      palette,
      view,
      rectOf(0, 0, base.width - 1, base.height - 1),
    )
    bumpFrame((n) => n + 1)
    return () => {
      compositeRef.current = null
    }
    // Repintura total so quando o gabarito, as cores ou as camadas visiveis
    // mudam -- jamais a cada pincelada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, view, paletteVersion])

  /* --------------------------------------------------- mascara da selecao */
  const selectionMask = useMemo(() => {
    if (!selection || selection.kind === 'poi') return null
    const layer = selection.kind === 'territory' ? territory : biome
    const stats =
      selection.kind === 'territory' ? territoryStats.get(selection.slot) : undefined
    const bbox = stats?.bbox ?? rectOf(0, 0, base.width - 1, base.height - 1)
    const w = bbox.x1 - bbox.x0 + 1
    const h = bbox.y1 - bbox.y0 + 1
    if (w <= 0 || h <= 0) return null
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const image = ctx.createImageData(w, h)
    const out = image.data
    let found = false
    for (let y = 0; y < h; y++) {
      const src = (bbox.y0 + y) * base.width + bbox.x0
      const dst = y * w
      for (let x = 0; x < w; x++) {
        if (layer[src + x] !== selection.slot) continue
        found = true
        const o = (dst + x) * 4
        out[o] = 255
        out[o + 1] = 232
        out[o + 2] = 165
        out[o + 3] = 255
      }
    }
    if (!found) return null
    ctx.putImageData(image, 0, 0)
    return { canvas, x: bbox.x0, y: bbox.y0 }
  }, [selection, territory, biome, territoryStats, base.width, base.height])

  /* ---------------------------------------------------------------- desenho */
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const composite = compositeRef.current
    if (!canvas || !composite || !size.w || !size.h) return
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== size.w * dpr || canvas.height !== size.h * dpr) {
      canvas.width = size.w * dpr
      canvas.height = size.h * dpr
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { x, y, scale } = viewport

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#09131b'
    ctx.fillRect(0, 0, size.w, size.h)

    ctx.save()
    ctx.translate(x, y)
    ctx.scale(scale, scale)
    ctx.imageSmoothingEnabled = scale < 1
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(composite.canvas, 0, 0)

    if (selectionMask) {
      ctx.globalAlpha = 0.34
      ctx.drawImage(selectionMask.canvas, selectionMask.x, selectionMask.y)
      ctx.globalAlpha = 1
    }

    ctx.drawImage(base.coast, 0, 0)
    ctx.restore()

    if (showLabels) {
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const entity of world.territories) {
        const stats = territoryStats.get(entity.slot)
        if (!stats) continue
        const [ax, ay] = entity.labelPos ?? stats.anchor
        const sx = ax * scale + x
        const sy = ay * scale + y
        if (sx < -90 || sy < -40 || sx > size.w + 90 || sy > size.h + 40) continue
        const screenArea = stats.area * scale * scale
        if (screenArea < 900) continue
        const fontSize = clamp(Math.sqrt(screenArea) / 7, 9, 26)
        const sea = entity.kind === 'sea'
        ctx.font =
          (sea ? 'italic 600 ' : '600 ') +
          fontSize.toFixed(1) +
          'px Inter, Segoe UI, sans-serif'
        const text = sea ? entity.name : entity.name.toUpperCase()
        ctx.lineJoin = 'round'
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx.lineWidth = Math.max(2, fontSize / 4)
        ctx.strokeText(text, sx, sy)
        ctx.fillStyle = sea ? '#2b4a5c' : '#1b252f'
        ctx.fillText(text, sx, sy)
      }
    }

    // Traco do laco em andamento, ja mostrando a volta que vai fechar.
    const lasso = lassoRef.current
    if (lasso && lasso.length > 1) {
      ctx.beginPath()
      ctx.moveTo(lasso[0].x * scale + x, lasso[0].y * scale + y)
      for (let i = 1; i < lasso.length; i++) {
        ctx.lineTo(lasso[i].x * scale + x, lasso[i].y * scale + y)
      }
      ctx.closePath()
      ctx.fillStyle = 'rgba(255,211,122,0.25)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(0,0,0,0.65)'
      ctx.lineWidth = 3
      ctx.stroke()
      ctx.setLineDash([7, 5])
      ctx.strokeStyle = '#ffe9b0'
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.setLineDash([])
    }

    // Anel do pincel: mostra o alcance da tinta antes de encostar.
    if (cursor && (tool === 'brush' || tool === 'eraser')) {
      ctx.beginPath()
      ctx.arc(
        cursor.x * scale + x,
        cursor.y * scale + y,
        Math.max(2, brushSize * scale),
        0,
        Math.PI * 2,
      )
      ctx.strokeStyle = 'rgba(0,0,0,0.75)'
      ctx.lineWidth = 3
      ctx.stroke()
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
  })

  /* ------------------------------------------------------------- interacao */
  const toImage = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return {
        x: (clientX - rect.left - viewport.x) / viewport.scale,
        y: (clientY - rect.top - viewport.y) / viewport.scale,
      }
    },
    [viewport],
  )

  const slotAt = useCallback(
    (ix: number, iy: number, layer: Uint16Array) => {
      const px = Math.floor(ix)
      const py = Math.floor(iy)
      if (px < 0 || py < 0 || px >= base.width || py >= base.height) return 0
      return layer[py * base.width + px]
    },
    [base],
  )

  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number) => {
      setViewport((vp) => {
        const next = clamp(vp.scale * factor, fitScale * MIN_ZOOM_FACTOR, MAX_SCALE)
        const ratio = next / vp.scale
        return { scale: next, x: cx - (cx - vp.x) * ratio, y: cy - (cy - vp.y) * ratio }
      })
    },
    [fitScale],
  )

  useImperativeHandle(
    ref,
    () => ({
      fit,
      zoomBy: (factor: number) => zoomAt(factor, size.w / 2, size.h / 2),
      repaint,
      focusOn: (tx: number, ty: number, scale?: number) => {
        if (animation.current) cancelAnimationFrame(animation.current)
        const targetScale = scale ?? Math.max(viewport.scale, fitScale * 3)
        const target = {
          scale: targetScale,
          x: size.w / 2 - tx * targetScale,
          y: size.h / 2 - ty * targetScale,
        }
        const from = { ...viewport }
        const start = performance.now()
        const step = (now: number) => {
          const t = clamp((now - start) / 420, 0, 1)
          const e = 1 - Math.pow(1 - t, 3)
          setViewport({
            x: from.x + (target.x - from.x) * e,
            y: from.y + (target.y - from.y) * e,
            scale: from.scale + (target.scale - from.scale) * e,
          })
          if (t < 1) animation.current = requestAnimationFrame(step)
        }
        animation.current = requestAnimationFrame(step)
      },
    }),
    [fit, zoomAt, repaint, size, viewport, fitScale],
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      zoomAt(
        Math.exp(-event.deltaY * 0.0016),
        event.clientX - rect.left,
        event.clientY - rect.top,
      )
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  const gesture = useRef({
    mode: 'idle' as 'idle' | 'pan' | 'paint' | 'lasso',
    moved: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    lastX: 0,
    lastY: 0,
    journal: null as Journal | null,
  })

  const activeLayer = paintLayer === 'territory' ? territory : biome
  const paintValue = tool === 'eraser' ? 0 : activeSlot

  const onPointerDown = (event: React.PointerEvent) => {
    const g = gesture.current
    ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
    const armed = event.button === 0 && !placingPoi
    const wantsPaint = armed && (tool === 'brush' || tool === 'eraser')
    const wantsLasso = armed && tool === 'lasso' && activeSlot !== 0

    if (wantsLasso) {
      g.mode = 'lasso'
      lassoRef.current = [toImage(event.clientX, event.clientY)]
      return
    }

    // Botao do meio e o direito arrastam o mapa mesmo com o pincel ativo.
    if (!wantsPaint) {
      g.mode = 'pan'
      g.moved = false
      g.startX = event.clientX
      g.startY = event.clientY
      g.originX = viewport.x
      g.originY = viewport.y
      return
    }

    if (tool === 'brush' && activeSlot === 0) return

    const { x, y } = toImage(event.clientX, event.clientY)
    g.mode = 'paint'
    g.lastX = x
    g.lastY = y
    g.journal = new Journal()
    const dirty = stampDisc(
      activeLayer,
      base,
      x,
      y,
      brushSize,
      paintValue,
      paintOnLand,
      g.journal,
    )
    if (dirty) repaint(dirty)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const g = gesture.current
    const point = toImage(event.clientX, event.clientY)
    setCursor(point)

    if (draggingPoi) {
      onMovePoi(draggingPoi, Math.round(point.x), Math.round(point.y))
      return
    }

    if (g.mode === 'pan') {
      const dx = event.clientX - g.startX
      const dy = event.clientY - g.startY
      if (!g.moved && Math.hypot(dx, dy) > 4) g.moved = true
      if (g.moved) {
        setViewport((vp) => ({ ...vp, x: g.originX + dx, y: g.originY + dy }))
      }
      return
    }

    if (g.mode === 'lasso' && lassoRef.current) {
      const path = lassoRef.current
      const last = path[path.length - 1]
      // Um ponto a cada ~2px de tela: suave o bastante sem encher o caminho
      // de pontos praticamente repetidos.
      if (Math.hypot(point.x - last.x, point.y - last.y) >= 2 / viewport.scale) {
        path.push(point)
      }
      return
    }

    if (g.mode === 'paint' && g.journal) {
      const dirty = stampStroke(
        activeLayer,
        base,
        g.lastX,
        g.lastY,
        point.x,
        point.y,
        brushSize,
        paintValue,
        paintOnLand,
        g.journal,
      )
      g.lastX = point.x
      g.lastY = point.y
      if (dirty) repaint(dirty)
    }
  }

  const onPointerUp = (event: React.PointerEvent) => {
    const g = gesture.current

    if (draggingPoi) {
      setDraggingPoi(null)
      g.mode = 'idle'
      return
    }

    if (g.mode === 'lasso') {
      const path = lassoRef.current
      lassoRef.current = null
      g.mode = 'idle'
      if (path && path.length >= 3) {
        const journal = new Journal()
        const dirty = fillPolygon(
          activeLayer,
          base,
          path,
          activeSlot,
          paintOnLand,
          journal,
        )
        if (dirty) {
          repaint(dirty)
          onStrokeEnd(journal, paintLayer)
        }
      }
      return
    }

    if (g.mode === 'paint') {
      if (g.journal && g.journal.size > 0) onStrokeEnd(g.journal, paintLayer)
      g.journal = null
      g.mode = 'idle'
      return
    }

    if (g.mode === 'pan' && !g.moved && event.button === 0) {
      const { x, y } = toImage(event.clientX, event.clientY)
      if (placingPoi) {
        onPlacePoi(Math.round(x), Math.round(y))
      } else if (tool === 'move') {
        // Mover e so navegacao: um clique nao abre nem altera nada.
      } else if (tool === 'bucket' && activeSlot !== 0) {
        const journal = new Journal()
        const dirty = bucketFill(
          activeLayer,
          base,
          x,
          y,
          activeSlot,
          paintOnLand,
          journal,
        )
        if (dirty) {
          repaint(dirty)
          onStrokeEnd(journal, paintLayer)
        }
      } else {
        const slot = slotAt(x, y, territory)
        const bio = slotAt(x, y, biome)
        if (paintLayer === 'biome' && bio) onSelect({ kind: 'biome', slot: bio })
        else if (slot) onSelect({ kind: 'territory', slot })
        else if (bio) onSelect({ kind: 'biome', slot: bio })
        else onSelect(null)
      }
    }
    g.mode = 'idle'
  }

  /* --------------------------------------------------------------- overlay */
  const hovered = useMemo(() => {
    if (!cursor) return null
    const px = Math.floor(cursor.x)
    const py = Math.floor(cursor.y)
    if (px < 0 || py < 0 || px >= base.width || py >= base.height) return null
    const t = world.territories.find((e) => e.slot === slotAt(cursor.x, cursor.y, territory))
    const b = world.biomes.find((e) => e.slot === slotAt(cursor.x, cursor.y, biome))
    const parts = [t?.name, b?.name].filter(Boolean)
    if (parts.length > 0) return parts.join(' · ')
    return base.land[py * base.width + px] === 1 ? 'Terra livre' : 'Mar aberto'
  }, [cursor, slotAt, territory, biome, world, base])

  const visiblePois = useMemo(
    () => (showPois ? world.pois.filter((p) => visiblePoiTypes.has(p.type)) : []),
    [world.pois, visiblePoiTypes, showPois],
  )

  const cursorStyle =
    placingPoi || tool === 'lasso'
      ? 'crosshair'
      : tool === 'bucket'
        ? 'cell'
        : tool === 'brush' || tool === 'eraser'
          ? 'none'
          : tool === 'select'
            ? 'default'
            : 'grab'

  return (
    <div
      ref={containerRef}
      className="map"
      style={{ cursor: cursorStyle }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setCursor(null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} />

      <div className="map-overlay">
        {visiblePois.map((poi) => (
          <PoiMarker
            key={poi.id}
            poi={poi}
            viewport={viewport}
            selected={selection?.kind === 'poi' && selection.id === poi.id}
            onSelect={() => onSelect({ kind: 'poi', id: poi.id })}
            onDragStart={() => setDraggingPoi(poi.id)}
          />
        ))}
      </div>

      {placingPoi ? (
        <div className="map-status map-status--action">
          Clique para posicionar: {POI_TYPES[placingPoi].label} (Esc cancela)
        </div>
      ) : (
        hovered && <div className="map-status">{hovered}</div>
      )}
      <div className="map-scale">{Math.round(viewport.scale * 100)}%</div>
    </div>
  )
})

interface PoiMarkerProps {
  poi: Poi
  viewport: Viewport
  selected: boolean
  onSelect: () => void
  onDragStart: () => void
}

function PoiMarker({ poi, viewport, selected, onSelect, onDragStart }: PoiMarkerProps) {
  const info = POI_TYPES[poi.type]
  return (
    <div
      className={'poi' + (selected ? ' is-selected' : '')}
      style={{
        left: poi.x * viewport.scale + viewport.x,
        top: poi.y * viewport.scale + viewport.y,
      }}
      onPointerDown={(e) => {
        e.stopPropagation()
        onSelect()
        onDragStart()
      }}
    >
      <span className="poi-pin" style={{ background: info.color }}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {info.glyph}
        </svg>
      </span>
      {viewport.scale > 0.45 && <span className="poi-name">{poi.name}</span>}
    </div>
  )
}
