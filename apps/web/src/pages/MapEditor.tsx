import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  PHASE_BIT,
  TERRITORY_PHASE,
  pixelAreaByRow,
  type BodyMeta,
  type Phase,
} from '@valenzia/shared'
import { MapView, type MapViewHandle, type SlotStats } from '../components/MapView'
import { Sidebar } from '../components/Sidebar'
import { Toolbar } from '../components/Toolbar'
import { ToolDock, BRUSH_MAX, BRUSH_MIN } from '../components/ToolDock'
import { IsolatedView } from '../components/IsolatedView'
import { GlobeView } from '../components/GlobeView'
import { BodySettingsDialog } from '../components/BodySettingsDialog'
import { useBody, type LoadedBody } from '../hooks/useBody'
import { BIOMES, COUNTRY_COLORS, SEA_COLORS, ZONE_COLORS } from '../lib/biomes'
import { POI_TYPES, POI_TYPE_LIST } from '../lib/poiTypes'
import {
  Journal,
  anchorOf,
  cleanLayer,
  clearSlot,
  hexToRgb,
  materialPalette,
  measurePhases,
  measureSlots,
  reconcileTerrain,
  rectOf,
  replaceValue,
  syncPhases,
  unionRect,
  type Palette,
  type PhaseTotals,
  type Stencil,
  type ViewOptions,
} from '../lib/layers'
import { api, ApiError } from '../lib/api'
import {
  clearDraft,
  decodeLayer,
  downloadBlob,
  encodeLayer,
  newId,
  normalizeWorld,
  readDraft,
  saveDraft,
  slug,
  thumbnailOf,
} from '../lib/store'
import type {
  BiomeArea,
  BiomeType,
  Material,
  PaintLayer,
  Poi,
  PoiType,
  Rect,
  Selection,
  Territory,
  TerritoryKind,
  Tool,
  World,
} from '../types'

/** Teto de memoria do desfazer; um balde grande sozinho ja pesa megabytes. */
const HISTORY_BUDGET = 120 * 1024 * 1024

export function MapEditorPage() {
  const { bodyId = '' } = useParams()
  const [reloadKey, setReloadKey] = useState(0)
  const state = useBody(bodyId, reloadKey)

  if (state.status === 'loading') return <Splash title="Carregando" message={state.step} />
  if (state.status === 'error') {
    return (
      <Splash
        title={state.notFound ? 'Mapa nao encontrado' : 'Deu ruim'}
        message={state.message}
        back
      />
    )
  }
  // A chave remonta o editor inteiro ao recarregar: nenhum estado velho sobra.
  return (
    <Editor
      key={bodyId + ':' + reloadKey}
      body={state.body}
      onReload={() => setReloadKey((k) => k + 1)}
    />
  )
}

const NEW_NAME: Record<TerritoryKind, string> = {
  country: 'Novo pais',
  sea: 'Novo mar',
  zone: 'Nova zona',
}

const NEW_COLORS: Record<TerritoryKind, string[]> = {
  country: COUNTRY_COLORS,
  sea: SEA_COLORS,
  zone: ZONE_COLORS,
}

const NEW_MATERIAL: Record<Phase, { name: string; color: string }> = {
  solid: { name: 'Nova rocha', color: '#9b8466' },
  liquid: { name: 'Novo liquido', color: '#3f7fa5' },
  gas: { name: 'Novo gas', color: '#d8c3a0' },
}

function Editor({ body, onReload }: { body: LoadedBody; onReload: () => void }) {
  const { base } = body
  const navigate = useNavigate()
  const mapRef = useRef<MapViewHandle>(null)

  // As camadas sao grandes demais para viverem no estado do React: ficam em
  // refs e sao alteradas no lugar; o que dispara redesenho e o retangulo sujo.
  const layers = useRef({ territory: body.territory, biome: body.biome }).current

  const [meta, setMeta] = useState<BodyMeta>(body.doc)
  const [world, setWorld] = useState<World>(() => ({
    name: body.doc.name,
    materials: body.doc.materials,
    territories: body.doc.territories,
    biomes: body.doc.biomes,
    pois: body.doc.pois,
  }))
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  /** Alguem salvou este mapa em outro lugar: salvar daqui sobrescreveria. */
  const [conflict, setConflict] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [parent, setParent] = useState<{ id: string; name: string } | null>(null)

  const [selection, setSelection] = useState<Selection>(null)
  /** Slot aberto no recorte isolado, ou null com o modal fechado. */
  const [isolated, setIsolated] = useState<number | null>(null)
  // Mover e o padrao: so navega, nao altera nada do mundo por acidente.
  const [tool, setTool] = useState<Tool>('move')
  const [brushSize, setBrushSize] = useState(12)
  /** O globo e so visualizacao: o editor continua montado por tras. */
  const [globe, setGlobe] = useState(false)
  const [globeTexture, setGlobeTexture] = useState<HTMLCanvasElement | null>(null)
  /** Apagar e alvo de pintura: o laco e o balde e que dizem onde. */
  const [erasing, setErasing] = useState(false)
  const [activePaint, setActivePaint] = useState<{ layer: PaintLayer; slot: number }>({
    layer: 'territory',
    slot: 0,
  })
  const [view, setView] = useState<ViewOptions>({ mode: 'politica', showBorders: true })
  const [showLabels, setShowLabels] = useState(true)
  const [showPois, setShowPois] = useState(true)
  const [placingPoi, setPlacingPoi] = useState<PoiType | null>(null)
  const [visiblePoiTypes, setVisiblePoiTypes] = useState<Set<PoiType>>(
    () => new Set(POI_TYPE_LIST),
  )
  const [paletteVersion, setPaletteVersion] = useState(0)
  const [territoryStats, setTerritoryStats] = useState<Map<number, SlotStats>>(new Map())
  const [biomeStats, setBiomeStats] = useState<Map<number, SlotStats>>(new Map())
  const [materialStats, setMaterialStats] = useState<Map<number, { area: number; km2: number }>>(
    new Map(),
  )
  const [phaseTotals, setPhaseTotals] = useState<PhaseTotals>(() => measurePhases(base))
  const [historyDepth, setHistoryDepth] = useState(0)
  /** Sobe a cada remedicao: avisa que a pintura mudou de baixo dos pontos. */
  const [layerVersion, setLayerVersion] = useState(0)
  /** So o terreno: tracar a costa inteira custa caro, nao da para fazer a toa. */
  const [terrainVersion, setTerrainVersion] = useState(0)

  /** Um passo pode mexer em mais de uma camada: carvar mar apaga o pais. */
  const history = useRef<{ journal: Journal; layer: PaintLayer }[][]>([])
  const statsTimer = useRef<number | null>(null)
  const draftTimer = useRef<number | null>(null)

  /** Area de um pixel em cada linha, pelo raio do corpo. */
  const rowArea = useMemo(
    () => pixelAreaByRow(base.width, base.height, meta.radiusKm),
    [base.width, base.height, meta.radiusKm],
  )

  // A tabela de fases tem de acompanhar os materiais antes de qualquer
  // pintura ou desenho que dependa dela.
  useLayoutEffect(() => {
    syncPhases(base, world.materials)
  }, [base, world.materials])

  const layerOf = useCallback(
    (which: PaintLayer) =>
      which === 'territory' ? layers.territory : which === 'biome' ? layers.biome : base.terrain,
    [layers, base],
  )

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
      const draft = await readDraft(meta.id)
      if (draft && !cancelled) {
        // Rascunho feito sobre a versao que o servidor tem: e trabalho nao
        // salvo, volta sozinho. Feito sobre uma versao mais velha: alguem
        // salvou depois, entao a pessoa decide.
        const atual = draft.baseRevision === meta.revision
        const restaurar =
          atual ||
          confirm(
            'Ha um rascunho deste mapa no navegador, feito sobre uma versao mais antiga ' +
              'do que a salva no servidor.\n\nOK restaura o rascunho (e salvar vai pedir ' +
              'para sobrescrever). Cancelar descarta o rascunho e fica com a versao do servidor.',
          )
        if (restaurar) {
          try {
            base.terrain.set(await decodeLayer(draft.terrain, base.width, base.height))
            layers.territory.set(await decodeLayer(draft.territory, base.width, base.height))
            layers.biome.set(await decodeLayer(draft.biome, base.width, base.height))
            const restored = normalizeWorld(draft.world, world.materials)
            syncPhases(base, restored.materials)
            setWorld(restored)
            setDirty(true)
            setConflict(!atual)
            setTerrainVersion((v) => v + 1)
            setPaletteVersion((v) => v + 1)
            setStatus(sweep(restored) ?? 'Rascunho do navegador restaurado')
            setLoading(false)
            return
          } catch {
            // Rascunho corrompido: segue com o que veio do servidor.
          }
        } else {
          await clearDraft(meta.id)
        }
      }
      if (cancelled) return
      const note = sweep(world)
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

  // O planeta pai, para o caminho "Planeta > Lua" no topo.
  useEffect(() => {
    if (!meta.parentId) {
      setParent(null)
      return
    }
    let alive = true
    api
      .getBody(meta.parentId)
      .then((p) => alive && setParent({ id: p.id, name: p.name }))
      .catch(() => alive && setParent(null))
    return () => {
      alive = false
    }
  }, [meta.parentId])

  useEffect(() => {
    if (!status) return
    const timer = setTimeout(() => setStatus(null), 4000)
    return () => clearTimeout(timer)
  }, [status])

  useEffect(() => {
    document.title = world.name + ' - Valenzia'
  }, [world.name])

  // Fechar a aba com trabalho nao salvo: o rascunho segura, mas avisa.
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  /* ------------------------------------------------------------ medicoes */
  const recomputeStats = useCallback(() => {
    const build = (layer: Uint16Array) => {
      const raw = measureSlots(layer, base.width, rowArea)
      const out = new Map<number, SlotStats>()
      for (const [slot, s] of raw) {
        out.set(slot, {
          area: s.area,
          km2: s.km2,
          bbox: s.bbox,
          anchor: anchorOf(layer, base.width, base.height, slot, s),
        })
      }
      return out
    }
    setTerritoryStats(build(layers.territory))
    setBiomeStats(build(layers.biome))
    // O terreno tem codigo 0 de verdade (e um material), entao conta a parte.
    const mats = new Map<number, { area: number; km2: number }>()
    const terrain = base.terrain
    for (let y = 0; y < base.height; y++) {
      const row = y * base.width
      const a = rowArea[y]
      for (let x = 0; x < base.width; x++) {
        const code = terrain[row + x]
        const s = mats.get(code)
        if (s) {
          s.area++
          s.km2 += a
        } else mats.set(code, { area: 1, km2: a })
      }
    }
    setMaterialStats(mats)
    setPhaseTotals(measurePhases(base, rowArea))
    setLayerVersion((v) => v + 1)
  }, [base, layers, rowArea])

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
        const [terrain, territory, biome] = await Promise.all([
          encodeLayer(base.terrain, base.width, base.height),
          encodeLayer(layers.territory, base.width, base.height),
          encodeLayer(layers.biome, base.width, base.height),
        ])
        await saveDraft(meta.id, {
          world: nextWorld,
          terrain,
          territory,
          biome,
          baseRevision: meta.revision,
        })
      }, 4000)
    },
    [base, layers, meta.id, meta.revision],
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
  const pushHistory = useCallback((step: { journal: Journal; layer: PaintLayer }[]) => {
    const uteis = step.filter((p) => p.journal.size > 0)
    if (uteis.length === 0) return
    history.current.push(uteis)
    let bytes = history.current.reduce(
      (sum, s) => sum + s.reduce((n, p) => n + p.journal.bytes, 0),
      0,
    )
    while (history.current.length > 1 && bytes > HISTORY_BUDGET) {
      const saiu = history.current.shift()
      bytes -= saiu?.reduce((n, p) => n + p.journal.bytes, 0) ?? 0
    }
    setHistoryDepth(history.current.length)
  }, [])

  const onStrokeEnd = useCallback(
    (parts: { journal: Journal; layer: PaintLayer }[]) => {
      if (!parts.some((p) => p.journal.size > 0)) return
      pushHistory(parts)
      setDirty(true)
      if (parts.some((p) => p.layer === 'terrain')) setTerrainVersion((v) => v + 1)
      scheduleStats()
      scheduleDraft(world)
    },
    [pushHistory, scheduleStats, scheduleDraft, world],
  )

  const undo = useCallback(() => {
    const step = history.current.pop()
    if (!step) return
    let area: Rect | null = null
    for (const parte of step) {
      parte.journal.revert(layerOf(parte.layer))
      area = unionRect(area, parte.journal.area(base.width, base.height))
    }
    const terreno = step.some((p) => p.layer === 'terrain')
    mapRef.current?.repaint(area, terreno)
    setHistoryDepth(history.current.length)
    setDirty(true)
    if (terreno) setTerrainVersion((v) => v + 1)
    scheduleStats()
  }, [layerOf, base, scheduleStats])

  /**
   * Arruma o mapa inteiro depois de uma mudanca de fase: um material que
   * virou liquido nao pode continuar com pais pintado por cima.
   */
  const reconcileAll = useCallback(
    (territories: Territory[]): { journal: Journal; layer: PaintLayer }[] => {
      const bits = new Map(territories.map((t) => [t.slot, PHASE_BIT[TERRITORY_PHASE[t.kind]]]))
      const jt = new Journal()
      const jb = new Journal()
      reconcileTerrain(
        base,
        layers.territory,
        layers.biome,
        rectOf(0, 0, base.width - 1, base.height - 1),
        (slot) => bits.get(slot) ?? 0,
        jt,
        jb,
      )
      return [
        { journal: jt, layer: 'territory' },
        { journal: jb, layer: 'biome' },
      ]
    },
    [base, layers],
  )

  /* ----------------------------------------------------------- entidades */
  const createTerritory = useCallback(
    (kind: TerritoryKind) => {
      updateWorld((w) => {
        const slot = w.territories.reduce((m, t) => Math.max(m, t.slot), 0) + 1
        const sameKind = w.territories.filter((t) => t.kind === kind).length
        const colors = NEW_COLORS[kind]
        const entity: Territory = {
          id: newId(),
          slot,
          name: NEW_NAME[kind],
          kind,
          color: colors[sameKind % colors.length],
        }
        setSelection({ kind: 'territory', slot })
        setActivePaint({ layer: 'territory', slot })
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
        const entity: BiomeArea = {
          id: newId(),
          slot,
          name: BIOMES[type].label + (sameType ? ' ' + (sameType + 1) : ''),
          type,
        }
        setSelection({ kind: 'biome', slot })
        setActivePaint({ layer: 'biome', slot })
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
    (which: 'territory' | 'biome', slot: number) => {
      const layer = which === 'territory' ? layers.territory : layers.biome
      const journal = new Journal()
      const dirtyRect = clearSlot(layer, base.width, slot, journal)
      pushHistory([{ journal, layer: which }])
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
    [layers, base.width, updateWorld, scheduleStats, pushHistory],
  )

  /* ------------------------------------------------------------ materiais */
  const createMaterial = useCallback(
    (phase: Phase) => {
      updateWorld((w) => {
        const code = w.materials.reduce((m, x) => Math.max(m, x.code), -1) + 1
        const material: Material = { code, ...NEW_MATERIAL[phase], phase }
        setActivePaint({ layer: 'terrain', slot: code })
        setErasing(false)
        setTool('brush')
        return { ...w, materials: [...w.materials, material] }
      })
      setPaletteVersion((v) => v + 1)
    },
    [updateWorld],
  )

  const updateMaterial = useCallback(
    (code: number, patch: Partial<Material>) => {
      const phaseChanged = patch.phase !== undefined
      let territories: Territory[] = []
      updateWorld((w) => {
        territories = w.territories
        return {
          ...w,
          materials: w.materials.map((m) => (m.code === code ? { ...m, ...patch } : m)),
        }
      })
      setPaletteVersion((v) => v + 1)
      if (phaseChanged) {
        // A fase muda quem pode estar pintado em cima: arruma ja, num passo
        // so do desfazer (a fase em si volta pelo seletor).
        queueMicrotask(() => {
          const parts = reconcileAll(territories)
          if (parts.some((p) => p.journal.size > 0)) {
            pushHistory(parts)
            mapRef.current?.repaint(null)
          }
          setTerrainVersion((v) => v + 1)
          scheduleStats()
        })
      }
    },
    [updateWorld, reconcileAll, pushHistory, scheduleStats],
  )

  const deleteMaterial = useCallback(
    (code: number, replacement: number) => {
      const journal = new Journal()
      const dirtyRect = replaceValue(base.terrain, base.width, code, replacement, journal)
      const remaining = world.materials.filter((m) => m.code !== code)
      syncPhases(base, remaining)
      const parts = [{ journal, layer: 'terrain' as PaintLayer }, ...reconcileAll(world.territories)]
      pushHistory(parts)
      updateWorld((w) => ({ ...w, materials: w.materials.filter((m) => m.code !== code) }))
      setActivePaint((p) =>
        p.layer === 'terrain' && p.slot === code ? { layer: 'terrain', slot: replacement } : p,
      )
      setPaletteVersion((v) => v + 1)
      setTerrainVersion((v) => v + 1)
      if (dirtyRect) mapRef.current?.repaint(null, true)
      scheduleStats()
    },
    [base, world.materials, world.territories, reconcileAll, pushHistory, updateWorld, scheduleStats],
  )

  /* --------------------------------------------------------------- pontos */
  const placePoi = useCallback(
    (x: number, y: number) => {
      if (!placingPoi) return
      updateWorld((w) => {
        const label = POI_TYPES[placingPoi].label
        const poi: Poi = {
          id: newId(),
          name: label + ' ' + (w.pois.filter((p) => p.type === placingPoi).length + 1),
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

  const movePoi = useCallback((id: string, x: number, y: number) => {
    setDirty(true)
    setWorld((w) => ({
      ...w,
      pois: w.pois.map((p) => (p.id === id ? { ...p, x, y } : p)),
    }))
  }, [])

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
  const encodeAll = useCallback(
    () =>
      Promise.all([
        encodeLayer(base.terrain, base.width, base.height),
        encodeLayer(layers.territory, base.width, base.height),
        encodeLayer(layers.biome, base.width, base.height),
      ]),
    [base, layers],
  )

  const save = useCallback(
    async (overwrite = false) => {
      setBusy(true)
      try {
        const [terrain, territory, biome] = await encodeAll()
        const texture = mapRef.current?.texture()
        const thumbnail = texture ? await thumbnailOf(texture) : null
        // Sobrescrever de proposito: pergunta a revisao atual e manda ela.
        const expectedRevision = overwrite
          ? (await api.getBody(meta.id)).revision
          : meta.revision
        const saved = await api.saveDocument(
          meta.id,
          {
            expectedRevision,
            name: world.name.trim() || 'Sem nome',
            materials: world.materials,
            territories: world.territories,
            biomes: world.biomes,
            pois: world.pois,
          },
          { terrain, territory, biome, thumbnail },
        )
        setMeta(saved)
        setDirty(false)
        setConflict(false)
        await clearDraft(meta.id)
        setStatus('Salvo')
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setConflict(true)
          setStatus(null)
        } else {
          setStatus('Nao consegui salvar: ' + (err as Error).message)
        }
      } finally {
        setBusy(false)
      }
    },
    [encodeAll, meta.id, meta.revision, world],
  )

  const exportAll = useCallback(async () => {
    setBusy(true)
    try {
      const [terrain, territory, biome] = await encodeAll()
      const prefix = slug(world.name) + '-'
      downloadBlob(
        new Blob([JSON.stringify(world, null, 2)], { type: 'application/json' }),
        prefix + 'world.json',
      )
      downloadBlob(terrain, prefix + 'terrain.png')
      downloadBlob(territory, prefix + 'territory.png')
      downloadBlob(biome, prefix + 'biome.png')
      setStatus('Exportado: world.json + as tres camadas')
    } finally {
      setBusy(false)
    }
  }, [world, encodeAll])

  const importWorld = useCallback(
    async (file: File) => {
      try {
        const parsed = normalizeWorld(JSON.parse(await file.text()), world.materials)
        setWorld(parsed)
        touch(parsed)
        setSelection(null)
        setPaletteVersion((v) => v + 1)
        setStatus('Importado: ' + file.name + ' (as camadas pintadas nao mudaram)')
      } catch {
        setStatus('Arquivo invalido')
      }
    },
    [world.materials, touch],
  )

  /* ------------------------------------------------------------- teclado */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (settingsOpen) return
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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (dirty && !busy) void save()
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key === 'g') setTool('bucket')
      if (event.key === 'l') setTool('lasso')
      if (event.key === 'b') setTool('brush')
      if (event.key === 'v') setTool('select')
      if (event.key === 'm') setTool('move')
      if (event.key === '[') setBrushSize((s) => Math.max(BRUSH_MIN, Math.round(s / 1.25)))
      if (event.key === ']') setBrushSize((s) => Math.min(BRUSH_MAX, Math.round(s * 1.25) + 1))
      if (event.key === '1') setView((v) => ({ ...v, mode: 'politica' }))
      if (event.key === '2') setView((v) => ({ ...v, mode: 'biomas' }))
      if (event.key === '3') setView((v) => ({ ...v, mode: 'mista' }))
      if (event.key === 'e') setErasing((v) => !v)
      if (event.key === 'Delete' && selection?.kind === 'poi') deletePoi(selection.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [placingPoi, undo, selection, deletePoi, isolated, globe, settingsOpen, dirty, busy, save])

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
    return { ...materialPalette(world.materials), territory, biome }
  }, [world.territories, world.biomes, world.materials])

  /** Onde a tinta pode pegar, pelo que esta armado. */
  const stencil: Stencil = useMemo(() => {
    if (activePaint.layer === 'terrain') return null
    if (activePaint.layer === 'biome') return PHASE_BIT.solid
    const entity = world.territories.find((t) => t.slot === activePaint.slot)
    return entity ? PHASE_BIT[TERRITORY_PHASE[entity.kind]] : PHASE_BIT.solid
  }, [activePaint, world.territories])

  const activeEntity =
    activePaint.layer === 'territory'
      ? world.territories.find((t) => t.slot === activePaint.slot)
      : activePaint.layer === 'biome'
        ? world.biomes.find((b) => b.slot === activePaint.slot)
        : world.materials.find((m) => m.code === activePaint.slot)
  const activeLabel = activeEntity?.name ?? null
  const activeColor = activeEntity
    ? 'color' in activeEntity
      ? activeEntity.color
      : BIOMES[activeEntity.type].color
    : null

  // O recorte so existe se o territorio ja tem tinta no mapa: sem pixels nao
  // ha o que mostrar, e a bbox nem seria medida.
  const isolatedEntity =
    isolated === null ? null : (world.territories.find((t) => t.slot === isolated) ?? null)
  const isolatedStats = isolated === null ? null : (territoryStats.get(isolated) ?? null)
  const isolatedPois =
    isolated === null ? [] : world.pois.filter((p) => poiOwners.get(p.id) === isolated)

  if (loading) return <Splash title="Carregando" message="Montando as camadas..." />

  return (
    <div className="app">
      <Toolbar
        worldName={world.name}
        parent={parent}
        onOpenSettings={() => setSettingsOpen(true)}
        canErase={activePaint.layer !== 'terrain'}
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

      {conflict && (
        <div className="banner banner--warn">
          <span>
            Este mapa foi salvo em outro lugar depois que voce o abriu. Salvar daqui
            sobrescreve a outra versao.
          </span>
          <button className="chip" disabled={busy} onClick={() => void save(true)}>
            Sobrescrever com o meu
          </button>
          <button
            className="chip"
            disabled={busy}
            onClick={async () => {
              if (!confirm('Descartar as suas alteracoes e abrir a versao do servidor?')) return
              await clearDraft(meta.id)
              onReload()
            }}
          >
            Descartar o meu e recarregar
          </button>
        </div>
      )}

      <div className="workspace">
        <MapView
          ref={mapRef}
          base={base}
          territory={layers.territory}
          biome={layers.biome}
          world={world}
          materials={world.materials}
          palette={palette}
          paletteVersion={paletteVersion}
          layerVersion={layerVersion}
          terrainVersion={terrainVersion}
          view={view}
          tool={tool}
          paintLayer={activePaint.layer}
          activeSlot={activePaint.slot}
          allowed={stencil}
          brushSize={brushSize}
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

        <ToolDock tool={tool} onTool={setTool} brushSize={brushSize} onBrushSize={setBrushSize} />

        {globe && (
          <GlobeView
            base={base}
            world={world}
            source={globeTexture}
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
          materialStats={materialStats}
          poiOwners={poiOwners}
          phaseTotals={phaseTotals}
          onSelect={setSelection}
          onPaintWith={(layer, slot) => {
            setActivePaint({ layer, slot })
            if (layer === 'terrain') {
              setErasing(false)
              // Escolher um material ja entrega uma ferramenta de pintura.
              if (tool === 'move' || tool === 'select') setTool('brush')
            } else setErasing(false)
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
          onCreateMaterial={createMaterial}
          onUpdateMaterial={updateMaterial}
          onDeleteMaterial={deleteMaterial}
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

      {isolatedEntity && isolatedStats && (
        <IsolatedView
          base={base}
          territory={layers.territory}
          biome={layers.biome}
          view={view}
          materials={world.materials}
          ground={mapRef.current?.ground() ?? null}
          km2={isolatedStats.km2}
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

      {settingsOpen && (
        <BodySettingsDialog
          body={meta}
          phaseTotals={phaseTotals}
          onClose={() => setSettingsOpen(false)}
          onSaved={(next) => {
            setMeta((m) => ({ ...m, ...next, revision: m.revision }))
            setWorld((w) => ({ ...w, name: next.name }))
          }}
          onDeleted={async () => {
            await clearDraft(meta.id)
            setDirty(false)
            navigate('/atlas')
          }}
        />
      )}
    </div>
  )
}

export function Splash({
  title,
  message,
  back,
}: {
  title: string
  message: string
  back?: boolean
}) {
  return (
    <div className="splash">
      <div>
        <h1>{title}</h1>
        <p>{message}</p>
        {back && (
          <p>
            <a href="/atlas">Voltar ao atlas</a>
          </p>
        )}
      </div>
    </div>
  )
}
