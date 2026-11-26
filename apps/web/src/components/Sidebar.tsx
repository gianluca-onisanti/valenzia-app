import { useState } from 'react'
import { formatKm2, TERRITORY_PHASE, type Phase, type TextureSpec } from '@valenzia/shared'
import type {
  BiomeArea,
  BiomeType,
  Material,
  PaintLayer,
  Poi,
  PoiType,
  Selection,
  Territory,
  TerritoryKind,
  World,
} from '../types'
import type { SlotStats } from './MapView'
import type { PhaseTotals } from '../lib/layers'
import { BIOMES, BIOME_TYPES } from '../lib/biomes'
import { POI_TYPES, POI_TYPE_LIST } from '../lib/poiTypes'
import { PATTERN_IDS, PATTERN_LABELS } from '../lib/texture'

type Tab = 'paises' | 'mares' | 'zonas' | 'biomas' | 'pontos' | 'terreno'

const TAB_LABEL: Record<Tab, string> = {
  paises: 'Paises',
  mares: 'Mares',
  zonas: 'Zonas',
  biomas: 'Biomas',
  pontos: 'Pontos',
  terreno: 'Terreno',
}

export const PHASE_LABEL: Record<Phase, string> = {
  solid: 'Solido',
  liquid: 'Liquido',
  gas: 'Gasoso',
}

const KIND_LABEL: Record<TerritoryKind, { one: string; many: string; new: string }> = {
  country: { one: 'Pais', many: 'Paises', new: 'Novo pais' },
  sea: { one: 'Mar', many: 'Mares', new: 'Novo mar' },
  zone: { one: 'Zona', many: 'Zonas', new: 'Nova zona' },
}

const KIND_HINT: Record<TerritoryKind, string> = {
  country:
    'Crie um pais e use o balde para preencher uma massa de terra inteira num clique, ou o laco e o pincel para recortar na mao.',
  sea: 'Crie um mar e marque a agua. A tinta nao sobe na terra.',
  zone: 'Zonas sao regioes da atmosfera de um planeta gasoso: faixas, tempestades, reinos flutuantes. A tinta so pega no gas.',
}

interface SidebarProps {
  world: World
  selection: Selection
  activePaint: { layer: PaintLayer; slot: number }
  territoryStats: Map<number, SlotStats>
  biomeStats: Map<number, SlotStats>
  /** Pixels e km2 de cada material do terreno. */
  materialStats: Map<number, { area: number; km2: number }>
  /** Id do ponto -> slot do territorio onde ele caiu (0 = nenhum). */
  poiOwners: Map<string, number>
  phaseTotals: PhaseTotals
  onSelect: (selection: Selection) => void
  onPaintWith: (layer: PaintLayer, slot: number) => void
  onFocus: (x: number, y: number, scale?: number) => void
  onCreateTerritory: (kind: TerritoryKind) => void
  onCreateBiome: (type: BiomeType) => void
  onUpdateTerritory: (slot: number, patch: Partial<Territory>) => void
  onUpdateBiome: (slot: number, patch: Partial<BiomeArea>) => void
  onDeleteTerritory: (slot: number) => void
  onDeleteBiome: (slot: number) => void
  onUpdatePoi: (id: string, patch: Partial<Poi>) => void
  onDeletePoi: (id: string) => void
  onIsolate: (slot: number) => void
  onCreateMaterial: (phase: Phase) => void
  onUpdateMaterial: (code: number, patch: Partial<Material>) => void
  onDeleteMaterial: (code: number, replacement: number) => void
  placingPoi: PoiType | null
  onPlacingPoi: (type: PoiType | null) => void
  visiblePoiTypes: Set<PoiType>
  onTogglePoiType: (type: PoiType) => void
}

function percent(part: number, whole: number) {
  if (!whole) return '0%'
  const p = (100 * part) / whole
  return p < 0.1 ? '<0,1%' : p.toFixed(1).replace('.', ',') + '%'
}

/**
 * O painel tem dois niveis: a lista, ou a ficha do item escolhido. Nunca os
 * dois ao mesmo tempo -- com a ficha aberta, a lista inteira so competiria por
 * atencao e espaco.
 */
export function Sidebar(props: SidebarProps) {
  const { world, selection } = props

  const selected = (() => {
    if (!selection) return null
    if (selection.kind === 'territory') {
      return world.territories.find((t) => t.slot === selection.slot) ?? null
    }
    if (selection.kind === 'biome') {
      return world.biomes.find((b) => b.slot === selection.slot) ?? null
    }
    return world.pois.find((p) => p.id === selection.id) ?? null
  })()

  if (selected) return <DetailPanel {...props} selected={selected} />
  return <ListPanel {...props} />
}

/* --------------------------------------------------------------- a lista */

/** As abas que fazem sentido neste corpo: sem gas, nao ha zona; sem mar, nao ha mares. */
function tabsFor(world: World): Tab[] {
  const has = (phase: Phase) => world.materials.some((m) => m.phase === phase)
  const kinds = new Set(world.territories.map((t) => t.kind))
  const tabs: Tab[] = []
  if (has('solid') || kinds.has('country')) tabs.push('paises')
  if (has('liquid') || kinds.has('sea')) tabs.push('mares')
  if (has('gas') || kinds.has('zone')) tabs.push('zonas')
  if (has('solid') || world.biomes.length) tabs.push('biomas')
  tabs.push('pontos', 'terreno')
  return tabs
}

function ListPanel(props: SidebarProps) {
  const { world, activePaint } = props
  const tabs = tabsFor(world)
  const [chosen, setTab] = useState<Tab>(tabs[0])
  const tab = tabs.includes(chosen) ? chosen : tabs[0]

  const territoryList = (kind: TerritoryKind) => {
    const list = world.territories.filter((t) => t.kind === kind)
    const whole = props.phaseTotals.km2[TERRITORY_PHASE[kind]]
    return (
      <>
        <button className="primary" onClick={() => props.onCreateTerritory(kind)}>
          + {KIND_LABEL[kind].new}
        </button>
        {list.length === 0 && <p className="muted small hint">{KIND_HINT[kind]}</p>}
        <ul className="list">
          {list.map((entity) => {
            const stats = props.territoryStats.get(entity.slot)
            const isPainting =
              activePaint.layer === 'territory' && activePaint.slot === entity.slot
            return (
              <li key={entity.slot}>
                <button
                  className="row"
                  title={stats ? formatKm2(stats.km2) : 'Ainda sem pintura'}
                  onClick={() => {
                    props.onSelect({ kind: 'territory', slot: entity.slot })
                    props.onPaintWith('territory', entity.slot)
                    if (stats) props.onFocus(stats.anchor[0], stats.anchor[1])
                  }}
                >
                  <span className="dot" style={{ background: entity.color }} />
                  <span className="row-name">{entity.name}</span>
                  {isPainting && <span className="badge badge--paint">ativo</span>}
                  <span className="muted small">
                    {stats ? percent(stats.km2, whole) : '--'}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </>
    )
  }

  return (
    <aside className="panel">
      <nav className="tabs">
        {tabs.map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </nav>

      <div className="panel-body">
        {tab === 'paises' && territoryList('country')}
        {tab === 'mares' && territoryList('sea')}
        {tab === 'zonas' && territoryList('zone')}

        {tab === 'biomas' && (
          <>
            <p className="muted small hint">
              Escolha um tipo para criar uma area nova, depois marque a area com
              o laco, o pincel ou o balde. Bioma so pega em terreno solido.
            </p>
            <div className="chips">
              {BIOME_TYPES.map((type) => (
                <button key={type} className="chip" onClick={() => props.onCreateBiome(type)}>
                  <span className="dot" style={{ background: BIOMES[type].color }} />
                  {BIOMES[type].label}
                </button>
              ))}
            </div>
            <ul className="list">
              {world.biomes.map((biome) => {
                const stats = props.biomeStats.get(biome.slot)
                const isPainting =
                  activePaint.layer === 'biome' && activePaint.slot === biome.slot
                return (
                  <li key={biome.slot}>
                    <button
                      className="row"
                      title={stats ? formatKm2(stats.km2) : 'Ainda sem pintura'}
                      onClick={() => {
                        props.onSelect({ kind: 'biome', slot: biome.slot })
                        props.onPaintWith('biome', biome.slot)
                        if (stats) props.onFocus(stats.anchor[0], stats.anchor[1])
                      }}
                    >
                      <span className="dot" style={{ background: BIOMES[biome.type].color }} />
                      <span className="row-name">{biome.name}</span>
                      {isPainting && <span className="badge badge--paint">ativo</span>}
                      <span className="muted small">
                        {stats ? percent(stats.km2, props.phaseTotals.km2.solid) : '--'}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        {tab === 'terreno' && <TerrainTab {...props} />}

        {tab === 'pontos' && (
          <>
            <p className="muted small hint">
              Clique num tipo e depois no mapa. Esc sai do modo.
            </p>
            <div className="chips">
              {POI_TYPE_LIST.map((type) => (
                <button
                  key={type}
                  className={'chip' + (props.placingPoi === type ? ' active' : '')}
                  onClick={() => props.onPlacingPoi(props.placingPoi === type ? null : type)}
                >
                  <span className="dot" style={{ background: POI_TYPES[type].color }} />
                  {POI_TYPES[type].label}
                </button>
              ))}
            </div>

            <h3 className="section-title">Mostrar no mapa</h3>
            <div className="chips">
              {POI_TYPE_LIST.map((type) => (
                <button
                  key={type}
                  className={'chip filter' + (props.visiblePoiTypes.has(type) ? ' active' : '')}
                  onClick={() => props.onTogglePoiType(type)}
                >
                  {POI_TYPES[type].label}
                </button>
              ))}
            </div>

            <ul className="list">
              {world.pois.map((poi) => {
                const owner = world.territories.find(
                  (t) => t.slot === props.poiOwners.get(poi.id),
                )
                return (
                  <li key={poi.id}>
                    <button
                      className="row"
                      onClick={() => {
                        props.onSelect({ kind: 'poi', id: poi.id })
                        props.onFocus(poi.x, poi.y)
                      }}
                    >
                      <span className="dot" style={{ background: POI_TYPES[poi.type].color }} />
                      <span className="row-name">{poi.name}</span>
                      <span className="muted small">
                        {owner ? owner.name : POI_TYPES[poi.type].label}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </aside>
  )
}

/* ------------------------------------------------------------- terreno */

/**
 * Os materiais do chao. Escolher um ja arma a ferramenta com ele; o que
 * estiver armado abre o editor de cor, fase e textura logo abaixo.
 */
function TerrainTab(props: SidebarProps) {
  const { world, activePaint } = props
  const armed = activePaint.layer === 'terrain' ? activePaint.slot : -1
  const total =
    props.phaseTotals.km2.solid + props.phaseTotals.km2.liquid + props.phaseTotals.km2.gas

  return (
    <>
      <p className="muted small hint">
        O chao do mapa. Escolha um material e desenhe com o pincel, o laco ou o
        balde: e assim que se cria um continente do zero ou se abre um canal.
        Pais pega so no solido, mar no liquido e zona no gas -- a tinta que
        ficar do lado errado sai junto, no mesmo desfazer.
      </p>

      <ul className="list">
        {world.materials.map((m) => {
          const stats = props.materialStats.get(m.code)
          const isArmed = armed === m.code
          return (
            <li key={m.code}>
              <button
                className={'row' + (isArmed ? ' row--open' : '')}
                onClick={() => props.onPaintWith('terrain', m.code)}
              >
                <span className="dot" style={{ background: m.color }} />
                <span className="row-name">{m.name}</span>
                {isArmed && <span className="badge badge--paint">ativo</span>}
                <span className="muted small">
                  {PHASE_LABEL[m.phase]} · {stats ? percent(stats.km2, total) : '0%'}
                </span>
              </button>
              {isArmed && <MaterialEditor {...props} material={m} />}
            </li>
          )
        })}
      </ul>

      <h3 className="section-title">Novo material</h3>
      <div className="chips">
        {(['solid', 'liquid', 'gas'] as Phase[]).map((phase) => (
          <button key={phase} className="chip" onClick={() => props.onCreateMaterial(phase)}>
            + {PHASE_LABEL[phase]}
          </button>
        ))}
      </div>
    </>
  )
}

function MaterialEditor(props: SidebarProps & { material: Material }) {
  const { material: m, world } = props
  const others = world.materials.filter((x) => x.code !== m.code)
  const [replacement, setReplacement] = useState<number>(others[0]?.code ?? -1)
  const texture: TextureSpec = m.texture ?? { pattern: 'liso' }
  const setTexture = (patch: Partial<TextureSpec>) =>
    props.onUpdateMaterial(m.code, { texture: { ...texture, ...patch } })

  return (
    <div className="material-editor">
      <div className="field">
        <label>Nome</label>
        <input
          value={m.name}
          onChange={(e) => props.onUpdateMaterial(m.code, { name: e.target.value })}
        />
      </div>
      <div className="field-row">
        <div className="field">
          <label>Cor</label>
          <input
            type="color"
            value={m.color}
            onChange={(e) => props.onUpdateMaterial(m.code, { color: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Fase</label>
          <select
            value={m.phase}
            onChange={(e) => props.onUpdateMaterial(m.code, { phase: e.target.value as Phase })}
          >
            {(['solid', 'liquid', 'gas'] as Phase[]).map((p) => (
              <option key={p} value={p}>
                {PHASE_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label>Textura</label>
          <select
            value={texture.pattern}
            onChange={(e) => setTexture({ pattern: e.target.value as TextureSpec['pattern'] })}
          >
            {PATTERN_IDS.map((p) => (
              <option key={p} value={p}>
                {PATTERN_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        {texture.pattern !== 'liso' && (
          <div className="field">
            <label title="Sem segunda cor, o padrao so clareia e escurece">2a cor</label>
            <div className="inline-controls">
              <input
                type="color"
                value={texture.color2 ?? m.color}
                onChange={(e) => setTexture({ color2: e.target.value })}
              />
              {texture.color2 && (
                <button
                  className="chip"
                  title="Tirar a segunda cor"
                  onClick={() => setTexture({ color2: undefined })}
                >
                  x
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {texture.pattern !== 'liso' && (
        <div className="field-row">
          <div className="field">
            <label>Intensidade</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={texture.intensity ?? 0.5}
              onChange={(e) => setTexture({ intensity: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>Escala</label>
            <input
              type="range"
              min={4}
              max={512}
              step={4}
              value={texture.scale ?? 64}
              onChange={(e) => setTexture({ scale: Number(e.target.value) })}
            />
          </div>
        </div>
      )}

      {others.length > 0 && (
        <div className="field">
          <label>Excluir, trocando os pixels por</label>
          <div className="inline-controls">
            <select value={replacement} onChange={(e) => setReplacement(Number(e.target.value))}>
              {others.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.name}
                </option>
              ))}
            </select>
            <button
              className="danger"
              onClick={() => {
                if (confirm('Excluir o material ' + m.name + '?')) {
                  props.onDeleteMaterial(m.code, replacement)
                }
              }}
            >
              Excluir
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- a ficha */

function DetailPanel(props: SidebarProps & { selected: Territory | BiomeArea | Poi }) {
  const { selected } = props
  const back = () => props.onSelect(null)

  if ('kind' in selected) return <TerritoryDetail {...props} t={selected} onBack={back} />
  if ('type' in selected && selected.type in BIOMES) {
    return <BiomeDetail {...props} b={selected as BiomeArea} onBack={back} />
  }
  return <PoiDetail {...props} poi={selected as Poi} onBack={back} />
}

function DetailHead({
  onBack,
  backLabel,
  action,
  children,
}: {
  onBack: () => void
  backLabel: string
  /** Botao opcional na ponta direita, na mesma linha do voltar. */
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <header className="detail-head">
      <div className="detail-top">
        <button className="back" onClick={onBack}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M14 5l-7 7 7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {backLabel}
        </button>
        {action}
      </div>
      {children}
    </header>
  )
}

function TerritoryDetail(props: SidebarProps & { t: Territory; onBack: () => void }) {
  const { t } = props
  const stats = props.territoryStats.get(t.slot)
  const whole = props.phaseTotals.km2[TERRITORY_PHASE[t.kind]]
  const label = KIND_LABEL[t.kind]

  return (
    <aside className="panel">
      <DetailHead
        onBack={props.onBack}
        backLabel={label.many}
        action={
          <button
            className="icon-button"
            disabled={!stats}
            aria-label={'Ver ' + t.name + ' isoladamente'}
            title={
              stats ? 'Ver isoladamente, sem vizinhos nem mar' : 'Pinte o territorio primeiro'
            }
            onClick={() => props.onIsolate(t.slot)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M2 12s3.8-6 10-6 10 6 10 6-3.8 6-10 6-10-6-10-6z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="12" r="3.1" fill="currentColor" />
            </svg>
          </button>
        }
      >
        <input
          className="title-input"
          value={t.name}
          onChange={(e) => props.onUpdateTerritory(t.slot, { name: e.target.value })}
        />
        <div className="swatch-row">
          <input
            type="color"
            value={t.color}
            onChange={(e) => props.onUpdateTerritory(t.slot, { color: e.target.value })}
          />
          <span className="muted small">{label.one}</span>
          <button className="chip" onClick={() => props.onPaintWith('territory', t.slot)}>
            pintar com este
          </button>
        </div>
        {stats && (
          <p className="muted small">
            {formatKm2(stats.km2)} · {percent(stats.km2, whole)} do{' '}
            {t.kind === 'country' ? 'solo' : t.kind === 'sea' ? 'mar' : 'gas'}
          </p>
        )}
      </DetailHead>

      <div className="panel-body">
        {t.kind === 'country' && (
          <>
            <Field
              label="Governo"
              value={t.governo}
              onChange={(v) => props.onUpdateTerritory(t.slot, { governo: v })}
            />
            <Field
              label="Populacao"
              value={t.populacao}
              onChange={(v) => props.onUpdateTerritory(t.slot, { populacao: v })}
            />
          </>
        )}
        <Field
          label="Descricao"
          value={t.descricao}
          multiline
          onChange={(v) => props.onUpdateTerritory(t.slot, { descricao: v })}
        />

        <TerritoryPois {...props} slot={t.slot} />

        <button
          className="danger"
          onClick={() => {
            if (confirm('Excluir ' + t.name + ' e apagar a pintura dele?')) {
              props.onDeleteTerritory(t.slot)
            }
          }}
        >
          Excluir
        </button>
      </div>
    </aside>
  )
}

function BiomeDetail(props: SidebarProps & { b: BiomeArea; onBack: () => void }) {
  const { b } = props
  const stats = props.biomeStats.get(b.slot)

  return (
    <aside className="panel">
      <DetailHead onBack={props.onBack} backLabel="Biomas">
        <input
          className="title-input"
          value={b.name}
          onChange={(e) => props.onUpdateBiome(b.slot, { name: e.target.value })}
        />
        <div className="swatch-row">
          <span className="swatch" style={{ background: BIOMES[b.type].color }} />
          <select
            value={b.type}
            onChange={(e) => props.onUpdateBiome(b.slot, { type: e.target.value as BiomeType })}
          >
            {BIOME_TYPES.map((t) => (
              <option key={t} value={t}>
                {BIOMES[t].label}
              </option>
            ))}
          </select>
          <button className="chip" onClick={() => props.onPaintWith('biome', b.slot)}>
            pintar
          </button>
        </div>
        {stats && (
          <p className="muted small">
            {formatKm2(stats.km2)} · {percent(stats.km2, props.phaseTotals.km2.solid)} do solo
          </p>
        )}
      </DetailHead>

      <div className="panel-body">
        <Field
          label="Descricao"
          value={b.descricao}
          multiline
          onChange={(v) => props.onUpdateBiome(b.slot, { descricao: v })}
        />
        <button
          className="danger"
          onClick={() => {
            if (confirm('Excluir ' + b.name + ' e apagar a pintura dela?')) {
              props.onDeleteBiome(b.slot)
            }
          }}
        >
          Excluir
        </button>
      </div>
    </aside>
  )
}

function PoiDetail(props: SidebarProps & { poi: Poi; onBack: () => void }) {
  const { poi } = props
  const ownerSlot = props.poiOwners.get(poi.id) ?? 0
  const owner = props.world.territories.find((t) => t.slot === ownerSlot)

  return (
    <aside className="panel">
      <DetailHead onBack={props.onBack} backLabel="Pontos">
        <input
          className="title-input"
          value={poi.name}
          onChange={(e) => props.onUpdatePoi(poi.id, { name: e.target.value })}
        />
        <div className="swatch-row">
          <span className="dot" style={{ background: POI_TYPES[poi.type].color }} />
          <select
            value={poi.type}
            onChange={(e) => props.onUpdatePoi(poi.id, { type: e.target.value as PoiType })}
          >
            {POI_TYPE_LIST.map((t) => (
              <option key={t} value={t}>
                {POI_TYPES[t].label}
              </option>
            ))}
          </select>
          <span className="muted small">
            {Math.round(poi.x)}, {Math.round(poi.y)}
          </span>
        </div>
      </DetailHead>

      <div className="panel-body">
        <div className="field">
          <label>Fica em</label>
          {owner ? (
            <button
              className="row row--inline"
              onClick={() => props.onSelect({ kind: 'territory', slot: owner.slot })}
            >
              <span className="dot" style={{ background: owner.color }} />
              <span className="row-name">{owner.name}</span>
            </button>
          ) : (
            <p className="muted small">
              Territorio sem dono. Pinte um pais por baixo e o ponto passa a ser
              dele sozinho.
            </p>
          )}
        </div>

        <Field
          label="Descricao"
          value={poi.descricao}
          multiline
          onChange={(v) => props.onUpdatePoi(poi.id, { descricao: v })}
        />
        <button className="danger" onClick={() => props.onDeletePoi(poi.id)}>
          Excluir ponto
        </button>
      </div>
    </aside>
  )
}

/**
 * Pontos que caem dentro do territorio, lidos da pintura. A capital nao e um
 * campo de texto: e o ponto do tipo capital que estiver dentro das fronteiras,
 * e por isso o pais pode ter varias sem nenhum arranjo especial.
 */
function TerritoryPois(props: SidebarProps & { slot: number }) {
  const inside = props.world.pois.filter((poi) => props.poiOwners.get(poi.id) === props.slot)
  const capitais = inside.filter((poi) => poi.type === 'capital')

  return (
    <section>
      <h3 className="section-title">
        Pontos <span className="badge">{inside.length}</span>
      </h3>

      {capitais.length > 0 && (
        <p className="small capitais">
          {capitais.length > 1 ? 'Capitais: ' : 'Capital: '}
          <strong>{capitais.map((c) => c.name).join(', ')}</strong>
        </p>
      )}

      {inside.length === 0 && (
        <p className="muted small">
          Nenhum ainda. Escolha um tipo abaixo e clique dentro das fronteiras.
        </p>
      )}

      <ul className="list">
        {inside.map((poi) => (
          <li key={poi.id}>
            <button
              className="row"
              onClick={() => {
                props.onSelect({ kind: 'poi', id: poi.id })
                props.onFocus(poi.x, poi.y)
              }}
            >
              <span className="dot" style={{ background: POI_TYPES[poi.type].color }} />
              <span className="row-name">{poi.name}</span>
              <span className="muted small">{POI_TYPES[poi.type].label}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="chips chips--add">
        {POI_TYPE_LIST.map((type) => (
          <button
            key={type}
            className={'chip' + (props.placingPoi === type ? ' active' : '')}
            title={'Adicionar ' + POI_TYPES[type].label.toLowerCase()}
            onClick={() => props.onPlacingPoi(props.placingPoi === type ? null : type)}
          >
            <span className="dot" style={{ background: POI_TYPES[type].color }} />+{' '}
            {POI_TYPES[type].label}
          </button>
        ))}
      </div>
    </section>
  )
}

function Field({
  label,
  value,
  multiline,
  onChange,
}: {
  label: string
  value?: string
  multiline?: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {multiline ? (
        <textarea rows={4} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  )
}
