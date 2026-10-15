import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapView, type MapViewHandle, type SlotStats } from './components/MapView'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { ToolDock } from './components/ToolDock'
import { IsolatedView } from './components/IsolatedView'
import { GlobeView } from './components/GlobeView'
import { useMapBase } from './hooks/useMapBase'
import { BIOMES, COUNTRY_COLORS, SEA_COLORS } from './lib/biomes'
import { POI_TYPES, POI_TYPE_LIST } from './lib/poiTypes'
import {
  Journal,
  anchorOf,
  cleanLayer,
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
  Rect,
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
  /** Slot aberto no recorte isolado, ou null com o modal fechado. */
  const [isolated, setIsolated] = useState<number | null>(null)
  // Mover e o padrao: so navega, nao altera nada do mundo por acidente.
  const [tool, setTool] = useState<Tool>('move')
  /** O globo e so visualizacao: o editor continua montado por tras. */
  const [globe, setGlobe] = useState(false)
  const [globeTexture, setGlobeTexture] = useState<HTMLCanvasElement | null>(null)
  /** Apagar e alvo de pintura: o laco e o balde e que dizem onde. */
  const [erasing, setErasing] = useState(false)
  const [activePaint, setActivePaint] = useState<{
    layer: PaintLayer
    slot: number
    onLand: boolean | null
  }>({ layer: 'territory', slot: 0, onLand: true })
  const [view, setView] = useState<ViewOptions>({
    mode: 'politica',
    showBorders: true,
    coastLine: true,
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
  /** So a costa: tracar a terra inteira custa caro, nao da para fazer a toa. */
  const [landVersion, setLandVersion] = useState(0)

  /** Um passo pode mexer em mais de uma camada: carvar mar apaga o pais. */
  const history = useRef<{ journal: Journal; layer: PaintLayer }[][]>([])
  const statsTimer = useRef<number | null>(null)
  const draftTimer = useRef<number | null>(null)

  const landPixels = useMemo(() => {
    let n = 0
    for (let i = 0; i < base.land.length; i++) n += base.land[i]
    return n
    // landVersion entra porque a mascara muda no lugar, sem nova identidade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base.land, landVersion])
  const waterPixels = total - landPixels

  /* ------------------------------------------------------------- carregar */
  useEffect(() => {
    let cancelled = false
    /**
     * Passa um pano nas camadas antes de usa-las. Ver cleanLayer: o PNG pode
     * voltar do canvas com pixels trocados em um, e um pixel trocado aqui e um
     * pais inteiro inventado num ponto perdido do mapa.
     */
    function sweep(current: World): string | null {
      const t = cleanLayer(
        layers.territory,
        base.width,
        base.height,
        current.territories.map((x) => x.slot),
      )
      const b = cleanLayer(
        layers.biome,
        base.width,
        base.height,
        current.biomes.map((x) => x.slot),
      )
      const sujeira = t.repaired + t.removed + b.repaired + b.removed
      const orfas = t.orphans.size + b.orphans.size
      const partes: string[] = []
      if (sujeira > 0) partes.push('Limpei ' + sujeira + ' pixels soltos das camadas')
      if (orfas > 0) {
        const px = [...t.orphans.values(), ...b.orphans.values()].reduce((a, c) => a + c, 0)
        partes.push(orfas + ' area(s) pintada(s) sem ficha (' + px + ' px) -- recrie a entidade ou apague')
      }
      return partes.length ? partes.join('. ') : null
    }

    async function load() {
      const draft = await readDraft()
      if (draft && !cancelled) {
        try {
          layers.territory.set(await decodeLayer(draft.territory, base.width, base.height))
          layers.biome.set(await decodeLayer(draft.biome, base.width, base.height))
          if (draft.land) {
            base.land.set(await decodeLayer(draft.land, base.width, base.height))
            setLandVersion((v) => v + 1)
          }
          const restored = normalizeWorld(draft.world)
          setWorld(restored)
          setDirty(true)
          setStatus(sweep(restored) ?? 'Rascunho do navegador restaurado')
          setLoading(false)
          return
        } catch {
          // Rascunho corrompido: segue para o que estiver no projeto.
        }
      }
      const saved = await fetchWorld()
      if (cancelled) return
      if (saved) setWorld(saved)
      const [t, b, l] = await Promise.all([
        fetchLayer('territory', base.width, base.height),
        fetchLayer('biome', base.width, base.height),
        // A costa editada, se existir, manda mais que a mascara do prepare.
        fetchLayer('land', base.width, base.height),
      ])
      if (cancelled) return
      if (t) layers.territory.set(t)
      if (b) layers.biome.set(b)
      if (l) {
        base.land.set(l)
        setLandVersion((v) => v + 1)
      }
      const note = sweep(saved ?? EMPTY_WORLD)
      if (note) {
        setStatus(note)
        setDirty(true)
      }
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
        const [t, b, l] = await Promise.all([
          encodeLayer(layers.territory, base.width, base.height),
          encodeLayer(layers.biome, base.width, base.height),
          encodeLayer(base.land, base.width, base.height),
        ])
        await saveDraft(nextWorld, t, b, l)
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
    (parts: { journal: Journal; layer: PaintLayer }[]) => {
      const uteis = parts.filter((p) => p.journal.size > 0)
      if (uteis.length === 0) return
      history.current.push(uteis)
      let bytes = history.current.reduce(
        (sum, step) => sum + step.reduce((n, p) => n + p.journal.bytes, 0),
        0,
      )
      while (history.current.length > 1 && bytes > HISTORY_BUDGET) {
        const saiu = history.current.shift()
        bytes -= saiu?.reduce((n, p) => n + p.journal.bytes, 0) ?? 0
      }
      setHistoryDepth(history.current.length)
      setDirty(true)
      if (uteis.some((p) => p.layer === 'land')) setLandVersion((v) => v + 1)
      scheduleStats()
      scheduleDraft(world)
    },
    [scheduleStats, scheduleDraft, world],
  )

  const undo = useCallback(() => {
    const step = history.current.pop()
    if (!step) return
    let area: Rect | null = null
    for (const parte of step) {
      const layer =
        parte.layer === 'territory'
          ? layers.territory
          : parte.layer === 'biome'
            ? layers.biome
            : base.land
      parte.journal.revert(layer)
      const r = parte.journal.area(base.width, base.height)
      area = area && r
        ? {
            x0: Math.min(area.x0, r.x0),
            y0: Math.min(area.y0, r.y0),
            x1: Math.max(area.x1, r.x1),
            y1: Math.max(area.y1, r.y1),
          }
        : (area ?? r)
    }
    mapRef.current?.repaint(area)
    setHistoryDepth(history.current.length)
    setDirty(true)
    if (step.some((p) => p.layer === 'land')) setLandVersion((v) => v + 1)
    scheduleStats()
  }, [layers, base, scheduleStats])

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
        setErasing(false)
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
        setErasing(false)
        setTool('lasso')
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
        history.current.push([{ journal, layer: which }])
        setHistoryDepth(history.current.length)
      }
      updateWorld((w) =>
        which === 'territory'
          ? { ...w, territories: w.territories.filter((t) => t.slot !== slot) }
          : { ...w, biomes: w.biomes.filter((b) => b.slot !== slot) },
      )
      setSelection(null)
      setIsolated((current) => (which === 'territory' && current === slot ? null : current))
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
      const [t, b, l] = await Promise.all([
        encodeLayer(layers.territory, base.width, base.height),
        encodeLayer(layers.biome, base.width, base.height),
        encodeLayer(base.land, base.width, base.height),
      ])
      const ok = await saveToProject(world, t, b, l)
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
        downloadBlob(l, 'land.png')
        setStatus('Sem servidor de dev: baixei os arquivos')
      }
    } finally {
      setBusy(false)
    }
  }, [world, layers, base.width, base.height])

  const exportAll = useCallback(async () => {
    setBusy(true)
    try {
      const [t, b, l] = await Promise.all([
        encodeLayer(layers.territory, base.width, base.height),
        encodeLayer(layers.biome, base.width, base.height),
        encodeLayer(base.land, base.width, base.height),
      ])
      downloadBlob(
        new Blob([JSON.stringify(world, null, 2)], { type: 'application/json' }),
        'world.json',
      )
      downloadBlob(t, 'territory.png')
      downloadBlob(b, 'biome.png')
      downloadBlob(l, 'land.png')
      setStatus('Exportado: world.json + as tres camadas')
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
      // Com o recorte aberto, o teclado e so dele: trocar de ferramenta por
      // tras do modal deixaria o usuario pintando sem ver.
      if (isolated !== null) {
        if (event.key === 'Escape') setIsolated(null)
        return
      }
      if (globe) {
        if (event.key === 'Escape') setGlobe(false)
        return
      }
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
      if (event.key === 'g') setTool('bucket')
      if (event.key === 'l') setTool('lasso')
      if (event.key === '1') setView((v) => ({ ...v, mode: 'politica' }))
      if (event.key === '2') setView((v) => ({ ...v, mode: 'biomas' }))
      if (event.key === '3') setView((v) => ({ ...v, mode: 'mista' }))
      if (event.key === 'e') setErasing((v) => !v)
      if (event.key === 'v') setTool('select')
      if (event.key === 'm') setTool('move')
      if (event.key === 'Delete' && selection?.kind === 'poi') deletePoi(selection.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [placingPoi, undo, selection, deletePoi, isolated, globe])

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
      : activePaint.layer === 'biome'
        ? world.biomes.find((b) => b.slot === activePaint.slot)
        : undefined

  // Na costa nao ha ficha nenhuma: o que o pincel aplica e terra ou mar.
  const pintandoCosta = activePaint.layer === 'land'
  const activeLabel = pintandoCosta
    ? activePaint.slot === 1
      ? 'Terra'
      : 'Mar'
    : (activeEntity?.name ?? null)
  const activeColor = pintandoCosta
    ? activePaint.slot === 1
      ? base.landColor
      : base.waterColor
    : activeEntity
      ? 'color' in activeEntity
        ? activeEntity.color
        : BIOMES[activeEntity.type].color
      : null

  // O recorte so existe se o territorio ja tem tinta no mapa: sem pixels nao
  // ha o que mostrar, e a bbox nem seria medida.
  const isolatedEntity =
    isolated === null ? null : (world.territories.find((t) => t.slot === isolated) ?? null)
  const isolatedBox = isolated === null ? null : (territoryStats.get(isolated)?.bbox ?? null)
  const isolatedPois =
    isolated === null ? [] : world.pois.filter((p) => poiOwners.get(p.id) === isolated)

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
        erasing={erasing}
        onToggleErasing={() => setErasing((v) => !v)}
        globe={globe}
        onToggleGlobe={() => {
          // A textura do globo e a mesma que o mapa ja tem pronta na tela.
          if (!globe) setGlobeTexture(mapRef.current?.texture() ?? null)
          setGlobe((v) => !v)
        }}
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
          layerVersion={layerVersion}
          landVersion={landVersion}
          view={view}
          tool={tool}
          paintLayer={activePaint.layer}
          activeSlot={activePaint.slot}
          paintOnLand={activePaint.onLand}
          erasing={erasing}
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

        <ToolDock tool={tool} onTool={setTool} />

        {globe && (
          <GlobeView
            base={base}
            world={world}
            source={globeTexture}
            inkOverlay={!view.coastLine}
            version={view.mode + view.showBorders + paletteVersion + ':' + layerVersion}
            pois={showPois ? world.pois.filter((p) => visiblePoiTypes.has(p.type)) : []}
            onSelectPoi={(id) => {
              setGlobe(false)
              setSelection({ kind: 'poi', id })
            }}
            onClose={() => setGlobe(false)}
          />
        )}

        <Sidebar
          world={world}
          selection={selection}
          activePaint={activePaint}
          territoryStats={territoryStats}
          biomeStats={biomeStats}
          poiOwners={poiOwners}
          landPixels={landPixels}
          waterPixels={waterPixels}
          landColor={base.landColor}
          waterColor={base.waterColor}
          onSelect={setSelection}
          onPaintWith={(layer, slot, onLand) => {
            setActivePaint({ layer, slot, onLand })
            setErasing(false)
            // Escolher um lado da costa ja entrega o laco na mao.
            if (layer === 'land') setTool('lasso')
          }}
          onFocus={(x, y, scale) => mapRef.current?.focusOn(x, y, scale)}
          onCreateTerritory={createTerritory}
          onCreateBiome={createBiome}
          onUpdateTerritory={updateTerritory}
          onUpdateBiome={updateBiome}
          onDeleteTerritory={(slot) => deleteEntity('territory', slot)}
          onDeleteBiome={(slot) => deleteEntity('biome', slot)}
          onUpdatePoi={updatePoi}
          onDeletePoi={deletePoi}
          onIsolate={setIsolated}
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

      {isolatedEntity && isolatedBox && (
        <IsolatedView
          base={base}
          territory={layers.territory}
          biome={layers.biome}
          view={view}
          entity={isolatedEntity}
          biomes={world.biomes}
          pois={isolatedPois}
          onClose={() => setIsolated(null)}
          onSelectPoi={(id) => {
            setIsolated(null)
            setSelection({ kind: 'poi', id })
          }}
        />
      )}
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
