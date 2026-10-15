import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapView, type MapViewHandle, type SlotStats } from './components/MapView'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { ToolDock } from './components/ToolDock'
import { useMapBase } from './hooks/useMapBase'
import { BIOMES, COUNTRY_COLORS, SEA_COLORS } from './lib/biomes'
import { POI_TYPES, POI_TYPE_LIST } from './lib/poiTypes'
import {
  Journal,
  anchorOf,
  clearSlot,
  hexToRgb,
  measureSlots,
  type MapBase,
  type Palette,
  type ViewOptions,
} from './lib/layers'
import {
  EMPTY_WORLD,
  clearDraft,
  decodeLayer,
  downloadBlob,
  encodeLayer,
  fetchLayer,
  fetchWorld,
  normalizeWorld,
  readDraft,
  saveDraft,
  saveToProject,
  uniqueId,
} from './lib/store'
import type {
  BiomeArea,
  BiomeType,
  EntityKind,
  PaintLayer,
  Poi,
  PoiType,
  Selection,
  Territory,
  Tool,
  World,
} from './types'

/** Teto de memoria do desfazer; um balde grande sozinho ja pesa megabytes. */
const HISTORY_BUDGET = 120 * 1024 * 1024

export default function App() {
  const state = useMapBase()
  if (state.status === 'loading') return <Splash title="Carregando" message={state.step} />
  if (state.status === 'missing') return <SetupGuide />
  if (state.status === 'error') return <Splash title="Deu ruim" message={state.message} />
  return <Editor base={state.base} />
}

function Editor({ base }: { base: MapBase }) {
  const total = base.width * base.height
  const mapRef = useRef<MapViewHandle>(null)

  // As camadas sao grandes demais para viverem no estado do React: ficam em
  // refs e sao alteradas no lugar; o que dispara redesenho e o retangulo sujo.
  const layersRef = useRef<{ territory: Uint16Array; biome: Uint16Array } | null>(null)
  if (!layersRef.current) {
    layersRef.current = {
      territory: new Uint16Array(total),
      biome: new Uint16Array(total),
    }
  }
  const layers = layersRef.current

  const [world, setWorld] = useState<World>(EMPTY_WORLD)
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const [selection, setSelection] = useState<Selection>(null)
  // Mover e o padrao: so navega, nao altera nada do mundo por acidente.
  const [tool, setTool] = useState<Tool>('move')
  const [brushSize, setBrushSize] = useState(28)
  const [activePaint, setActivePaint] = useState<{
    layer: PaintLayer
    slot: number
    onLand: boolean
  }>({ layer: 'territory', slot: 0, onLand: true })
  const [view, setView] = useState<ViewOptions>({
    mode: 'politica',
    showBorders: true,
  })
  const [showLabels, setShowLabels] = useState(true)
  const [showPois, setShowPois] = useState(true)
  const [placingPoi, setPlacingPoi] = useState<PoiType | null>(null)
  const [visiblePoiTypes, setVisiblePoiTypes] = useState<Set<PoiType>>(
    () => new Set(POI_TYPE_LIST),
  )
  const [paletteVersion, setPaletteVersion] = useState(0)
  const [territoryStats, setTerritoryStats] = useState<Map<number, SlotStats>>(new Map())
  const [biomeStats, setBiomeStats] = useState<Map<number, SlotStats>>(new Map())
  const [historyDepth, setHistoryDepth] = useState(0)
  /** Sobe a cada remedicao: avisa que a pintura mudou de baixo dos pontos. */
  const [layerVersion, setLayerVersion] = useState(0)

  const history = useRef<{ journal: Journal; layer: PaintLayer }[]>([])
  const statsTimer = useRef<number | null>(null)
  const draftTimer = useRef<number | null>(null)

  const landPixels = useMemo(() => {
    let n = 0
    for (let i = 0; i < base.land.length; i++) n += base.land[i]
    return n
  }, [base.land])
  const waterPixels = total - landPixels

  /* ------------------------------------------------------------- carregar */
  useEffect(() => {
    let cancelled = false
    async function load() {
      const draft = await readDraft()
      if (draft && !cancelled) {
        try {
          layers.territory.set(await decodeLayer(draft.territory, base.width, base.height))
          layers.biome.set(await decodeLayer(draft.biome, base.width, base.height))
          setWorld(normalizeWorld(draft.world))
          setDirty(true)
          setStatus('Rascunho do navegador restaurado')
          setLoading(false)
          return
        } catch {
          // Rascunho corrompido: segue para o que estiver no projeto.
        }
      }
      const saved = await fetchWorld()
      if (cancelled) return
      if (saved) setWorld(saved)
      const [t, b] = await Promise.all([
        fetchLayer('territory', base.width, base.height),
        fetchLayer('biome', base.width, base.height),
      ])
      if (cancelled) return
      if (t) layers.territory.set(t)
      if (b) layers.biome.set(b)
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!status) return
    const timer = setTimeout(() => setStatus(null), 4000)
    return () => clearTimeout(timer)
  }, [status])

  useEffect(() => {
    document.title = world.name + ' - Editor de Mundo'
  }, [world.name])

  /* ------------------------------------------------------------ medicoes */
  const recomputeStats = useCallback(() => {
    const build = (layer: Uint16Array) => {
      const raw = measureSlots(layer, base.width)
      const out = new Map<number, SlotStats>()
      for (const [slot, s] of raw) {
        out.set(slot, {
          area: s.area,
          bbox: s.bbox,
          anchor: anchorOf(layer, base.width, base.height, slot, s),
        })
      }
      return out
    }
    setTerritoryStats(build(layers.territory))
    setBiomeStats(build(layers.biome))
    setLayerVersion((v) => v + 1)
  }, [base.width, base.height, layers])

  /** Varrer os 7,7M de pixels e caro: so depois que a mao para. */
  const scheduleStats = useCallback(() => {
    if (statsTimer.current) clearTimeout(statsTimer.current)
    statsTimer.current = window.setTimeout(recomputeStats, 350)
  }, [recomputeStats])

  useEffect(() => {
    if (!loading) recomputeStats()
  }, [loading, recomputeStats])

  /**
   * De que pais e cada ponto. Nao e um vinculo guardado: e lido da camada de
   * territorio na coordenada do ponto. Assim, repintar uma fronteira ja troca
   * o dono da cidade, sem nada para sincronizar -- e um ponto no mar aberto
   * simplesmente nao tem dono.
   */
  const poiOwners = useMemo(() => {
    const owners = new Map<string, number>()
    for (const poi of world.pois) {
      const px = Math.floor(poi.x)
      const py = Math.floor(poi.y)
      const inside = px >= 0 && py >= 0 && px < base.width && py < base.height
      owners.set(poi.id, inside ? layers.territory[py * base.width + px] : 0)
    }
    return owners
    // layerVersion entra de proposito: a camada muda no lugar, sem nova
    // identidade que o React pudesse observar sozinho.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.pois, layerVersion, base.width, base.height])

  /* ----------------------------------------------------------- rascunho */
  const scheduleDraft = useCallback(
    (nextWorld: World) => {
      if (draftTimer.current) clearTimeout(draftTimer.current)
      draftTimer.current = window.setTimeout(async () => {
        const [t, b] = await Promise.all([
          encodeLayer(layers.territory, base.width, base.height),
          encodeLayer(layers.biome, base.width, base.height),
        ])
        await saveDraft(nextWorld, t, b)
      }, 4000)
    },
    [base.width, base.height, layers],
  )

  const touch = useCallback(
    (next: World) => {
      setDirty(true)
      scheduleDraft(next)
    },
    [scheduleDraft],
  )

  const updateWorld = useCallback(
    (recipe: (current: World) => World) => {
      setWorld((current) => {
        const next = recipe(current)
        touch(next)
        return next
      })
    },
    [touch],
  )

  /* ---------------------------------------------------------- pinturas */
  const onStrokeEnd = useCallback(
    (journal: Journal, layer: PaintLayer) => {
      history.current.push({ journal, layer })
      let bytes = history.current.reduce((sum, e) => sum + e.journal.bytes, 0)
      while (history.current.length > 1 && bytes > HISTORY_BUDGET) {
        bytes -= history.current[0].journal.bytes
        history.current.shift()
      }
      setHistoryDepth(history.current.length)
      setDirty(true)
      scheduleStats()
      scheduleDraft(world)
    },
    [scheduleStats, scheduleDraft, world],
  )

  const undo = useCallback(() => {
    const entry = history.current.pop()
    if (!entry) return
    const layer = entry.layer === 'territory' ? layers.territory : layers.biome
    entry.journal.revert(layer)
    mapRef.current?.repaint(entry.journal.area(base.width, base.height))
    setHistoryDepth(history.current.length)
    setDirty(true)
    scheduleStats()
  }, [layers, base.width, base.height, scheduleStats])

  /* ----------------------------------------------------------- entidades */
  const createTerritory = useCallback(
    (kind: EntityKind) => {
      updateWorld((w) => {
        const slot = w.territories.reduce((m, t) => Math.max(m, t.slot), 0) + 1
        const sameKind = w.territories.filter((t) => t.kind === kind).length
        const palette = kind === 'country' ? COUNTRY_COLORS : SEA_COLORS
        const name = kind === 'country' ? 'Novo pais' : 'Novo mar'
        const entity: Territory = {
          slot,
          id: uniqueId(name, w.territories.map((t) => t.id)),
          name,
          kind,
          color: palette[sameKind % palette.length],
        }
        setSelection({ kind: 'territory', slot })
        setActivePaint({ layer: 'territory', slot, onLand: kind === 'country' })
        setTool('bucket')
        return { ...w, territories: [...w.territories, entity] }
      })
    },
    [updateWorld],
  )

  const createBiome = useCallback(
    (type: BiomeType) => {
      updateWorld((w) => {
        const slot = w.biomes.reduce((m, b) => Math.max(m, b.slot), 0) + 1
        const sameType = w.biomes.filter((b) => b.type === type).length
        const name = BIOMES[type].label + (sameType ? ' ' + (sameType + 1) : '')
        const entity: BiomeArea = {
          slot,
          id: uniqueId(name, w.biomes.map((b) => b.id)),
          name,
          type,
        }
        setSelection({ kind: 'biome', slot })
        setActivePaint({ layer: 'biome', slot, onLand: true })
        setTool('brush')
        return { ...w, biomes: [...w.biomes, entity] }
      })
    },
    [updateWorld],
  )

  const updateTerritory = useCallback(
    (slot: number, patch: Partial<Territory>) => {
      updateWorld((w) => ({
        ...w,
        territories: w.territories.map((t) => (t.slot === slot ? { ...t, ...patch } : t)),
      }))
      if (patch.color) setPaletteVersion((v) => v + 1)
    },
    [updateWorld],
  )

  const updateBiome = useCallback(
    (slot: number, patch: Partial<BiomeArea>) => {
      updateWorld((w) => ({
        ...w,
        biomes: w.biomes.map((b) => (b.slot === slot ? { ...b, ...patch } : b)),
      }))
      if (patch.type) setPaletteVersion((v) => v + 1)
    },
    [updateWorld],
  )

  /** Excluir apaga tambem a tinta: senao sobrariam pixels de um dono morto. */
  const deleteEntity = useCallback(
    (which: PaintLayer, slot: number) => {
      const layer = which === 'territory' ? layers.territory : layers.biome
      const journal = new Journal()
      const dirtyRect = clearSlot(layer, base.width, slot, journal)
      if (journal.size > 0) {
        history.current.push({ journal, layer: which })
        setHistoryDepth(history.current.length)
      }
      updateWorld((w) =>
        which === 'territory'
          ? { ...w, territories: w.territories.filter((t) => t.slot !== slot) }
          : { ...w, biomes: w.biomes.filter((b) => b.slot !== slot) },
      )
      setSelection(null)
      setActivePaint((p) => (p.layer === which && p.slot === slot ? { ...p, slot: 0 } : p))
      if (dirtyRect) mapRef.current?.repaint(dirtyRect)
      scheduleStats()
    },
    [layers, base.width, updateWorld, scheduleStats],
  )

  /* --------------------------------------------------------------- pontos */
  const placePoi = useCallback(
    (x: number, y: number) => {
      if (!placingPoi) return
      updateWorld((w) => {
        const label = POI_TYPES[placingPoi].label
        const name = label + ' ' + (w.pois.filter((p) => p.type === placingPoi).length + 1)
        const poi: Poi = {
          id: uniqueId(name, w.pois.map((p) => p.id)),
          name,
          type: placingPoi,
          x,
          y,
        }
        setSelection({ kind: 'poi', id: poi.id })
        return { ...w, pois: [...w.pois, poi] }
      })
    },
    [placingPoi, updateWorld],
  )

  const updatePoi = useCallback(
    (id: string, patch: Partial<Poi>) => {
      updateWorld((w) => ({
        ...w,
        pois: w.pois.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      }))
    },
    [updateWorld],
  )

  const movePoi = useCallback(
    (id: string, x: number, y: number) => {
      setDirty(true)
      setWorld((w) => ({
        ...w,
        pois: w.pois.map((p) => (p.id === id ? { ...p, x, y } : p)),
      }))
    },
    [],
  )

  /** Armar um ponto com os marcadores escondidos deixaria o clique invisivel. */
  const armPoi = useCallback((type: PoiType | null) => {
    setPlacingPoi(type)
    if (type) setShowPois(true)
  }, [])

  const deletePoi = useCallback(
    (id: string) => {
      updateWorld((w) => ({ ...w, pois: w.pois.filter((p) => p.id !== id) }))
      setSelection(null)
    },
    [updateWorld],
  )

  /* ---------------------------------------------------------- persistencia */
  const save = useCallback(async () => {
    setBusy(true)
    try {
      const [t, b] = await Promise.all([
        encodeLayer(layers.territory, base.width, base.height),
        encodeLayer(layers.biome, base.width, base.height),
      ])
      const ok = await saveToProject(world, t, b)
      if (ok) {
        setDirty(false)
        await clearDraft()
        setStatus('Salvo em public/data/')
      } else {
        downloadBlob(
          new Blob([JSON.stringify(world, null, 2)], { type: 'application/json' }),
          'world.json',
        )
        downloadBlob(t, 'territory.png')
        downloadBlob(b, 'biome.png')
        setStatus('Sem servidor de dev: baixei os arquivos')
      }
    } finally {
      setBusy(false)
    }
  }, [world, layers, base.width, base.height])

  const exportAll = useCallback(async () => {
    setBusy(true)
    try {
      const [t, b] = await Promise.all([
        encodeLayer(layers.territory, base.width, base.height),
        encodeLayer(layers.biome, base.width, base.height),
      ])
      downloadBlob(
        new Blob([JSON.stringify(world, null, 2)], { type: 'application/json' }),
        'world.json',
      )
      downloadBlob(t, 'territory.png')
      downloadBlob(b, 'biome.png')
      setStatus('Exportado: world.json + as duas camadas')
    } finally {
      setBusy(false)
    }
  }, [world, layers, base.width, base.height])

  const importWorld = useCallback(
    async (file: File) => {
      try {
        const parsed = normalizeWorld(JSON.parse(await file.text()))
        setWorld(parsed)
        setDirty(true)
        setSelection(null)
        setPaletteVersion((v) => v + 1)
        setStatus('Importado: ' + file.name + ' (as camadas pintadas nao mudaram)')
      } catch {
        setStatus('Arquivo invalido')
      }
    },
    [],
  )

  /* ------------------------------------------------------------- teclado */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (event.key === 'Escape') {
        if (placingPoi) setPlacingPoi(null)
        else setSelection(null)
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        undo()
        return
      }
      if (event.key === '[') setBrushSize((s) => Math.max(2, Math.round(s * 0.8)))
      if (event.key === ']') setBrushSize((s) => Math.min(160, Math.round(s * 1.25) + 1))
      if (event.key === 'b') setTool('brush')
      if (event.key === 'g') setTool('bucket')
      if (event.key === 'l') setTool('lasso')
      if (event.key === '1') setView((v) => ({ ...v, mode: 'politica' }))
      if (event.key === '2') setView((v) => ({ ...v, mode: 'biomas' }))
      if (event.key === '3') setView((v) => ({ ...v, mode: 'mista' }))
      if (event.key === 'e') setTool('eraser')
      if (event.key === 'v') setTool('select')
      if (event.key === 'm') setTool('move')
      if (event.key === 'Delete' && selection?.kind === 'poi') deletePoi(selection.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [placingPoi, undo, selection, deletePoi])

  /* -------------------------------------------------------------- paleta */
  const palette: Palette = useMemo(() => {
    const maxT = world.territories.reduce((m, t) => Math.max(m, t.slot), 0)
    const territory = new Uint8Array((maxT + 1) * 3 + 3)
    for (const t of world.territories) {
      const [r, g, b] = hexToRgb(t.color)
      territory[t.slot * 3] = r
      territory[t.slot * 3 + 1] = g
      territory[t.slot * 3 + 2] = b
    }
    const maxB = world.biomes.reduce((m, b) => Math.max(m, b.slot), 0)
    const biome = new Uint8Array((maxB + 1) * 3 + 3)
    for (const b of world.biomes) {
      const [r, g, bl] = hexToRgb(BIOMES[b.type].color)
      biome[b.slot * 3] = r
      biome[b.slot * 3 + 1] = g
      biome[b.slot * 3 + 2] = bl
    }
    return {
      land: hexToRgb(base.landColor),
      water: hexToRgb(base.waterColor),
      territory,
      biome,
    }
  }, [world.territories, world.biomes, base.landColor, base.waterColor])

  const activeEntity =
    activePaint.layer === 'territory'
      ? world.territories.find((t) => t.slot === activePaint.slot)
      : world.biomes.find((b) => b.slot === activePaint.slot)

  const activeLabel = activeEntity?.name ?? null
  const activeColor = activeEntity
    ? 'color' in activeEntity
      ? activeEntity.color
      : BIOMES[activeEntity.type].color
    : null

  if (loading) return <Splash title="Carregando" message="Montando as camadas..." />

  return (
    <div className="app">
      <Toolbar
        worldName={world.name}
        activeLabel={activeLabel}
        activeColor={activeColor}
        view={view}
        onView={setView}
        showLabels={showLabels}
        onToggleLabels={() => setShowLabels((v) => !v)}
        showPois={showPois}
        onTogglePois={() => setShowPois((v) => !v)}
        dirty={dirty}
        status={status}
        busy={busy}
        canUndo={historyDepth > 0}
        onUndo={undo}
        onSave={() => void save()}
        onExport={() => void exportAll()}
        onImport={(file) => void importWorld(file)}
        onFit={() => mapRef.current?.fit()}
      />

      <div className="workspace">
        <MapView
          ref={mapRef}
          base={base}
          territory={layers.territory}
          biome={layers.biome}
          world={world}
          palette={palette}
          paletteVersion={paletteVersion}
          view={view}
          tool={tool}
          paintLayer={activePaint.layer}
          activeSlot={activePaint.slot}
          paintOnLand={activePaint.onLand}
          brushSize={brushSize}
          selection={selection}
          territoryStats={territoryStats}
          onSelect={setSelection}
          onStrokeEnd={onStrokeEnd}
          placingPoi={placingPoi}
          onPlacePoi={placePoi}
          onMovePoi={movePoi}
          visiblePoiTypes={visiblePoiTypes}
          showPois={showPois}
          showLabels={showLabels}
        />

        <ToolDock
          tool={tool}
          onTool={setTool}
          brushSize={brushSize}
          onBrushSize={setBrushSize}
        />

        <Sidebar
          world={world}
          selection={selection}
          activePaint={activePaint}
          territoryStats={territoryStats}
          biomeStats={biomeStats}
          poiOwners={poiOwners}
          landPixels={landPixels}
          waterPixels={waterPixels}
          onSelect={setSelection}
          onPaintWith={(layer, slot, onLand) => setActivePaint({ layer, slot, onLand })}
          onFocus={(x, y, scale) => mapRef.current?.focusOn(x, y, scale)}
          onCreateTerritory={createTerritory}
          onCreateBiome={createBiome}
          onUpdateTerritory={updateTerritory}
          onUpdateBiome={updateBiome}
          onDeleteTerritory={(slot) => deleteEntity('territory', slot)}
          onDeleteBiome={(slot) => deleteEntity('biome', slot)}
          onUpdatePoi={updatePoi}
          onDeletePoi={deletePoi}
          placingPoi={placingPoi}
          onPlacingPoi={armPoi}
          visiblePoiTypes={visiblePoiTypes}
          onTogglePoiType={(type) =>
            setVisiblePoiTypes((current) => {
              const next = new Set(current)
              if (next.has(type)) next.delete(type)
              else next.add(type)
              return next
            })
          }
        />
      </div>
    </div>
  )
}

function Splash({ title, message }: { title: string; message: string }) {
  return (
    <div className="splash">
      <div>
        <h1>{title}</h1>
        <p>{message}</p>
      </div>
    </div>
  )
}

function SetupGuide() {
  return (
    <div className="splash">
      <div className="setup">
        <h1>Falta preparar o mapa</h1>
        <p>O editor precisa saber onde e terra e onde e mar. Dois passos:</p>
        <ol>
          <li>
            Salve o mapa <strong>em branco</strong> -- so o verde da terra e o
            azul do oceano, sem fronteiras nem nomes -- em{' '}
            <code>public/source/base.png</code>.
          </li>
          <li>
            Rode <code>npm run prepare:map</code> e depois <code>npm run dev</code>.
          </li>
        </ol>
        <p className="muted small">
          Esse passo so responde "este pixel e terra ou mar?". Paises, mares,
          biomas e pontos voce pinta aqui dentro, e eles ficam guardados em
          camadas proprias -- a imagem nunca e alterada.
        </p>
      </div>
    </div>
  )
}
