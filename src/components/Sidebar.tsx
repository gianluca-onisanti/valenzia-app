import { useState } from 'react'
import type {
  BiomeArea,
  BiomeType,
  EntityKind,
  PaintLayer,
  Poi,
  PoiType,
  Selection,
  Territory,
  World,
} from '../types'
import type { SlotStats } from './MapView'
import { BIOMES, BIOME_TYPES } from '../lib/biomes'
import { POI_TYPES, POI_TYPE_LIST } from '../lib/poiTypes'

type Tab = 'paises' | 'mares' | 'biomas' | 'pontos' | 'costa'

interface SidebarProps {
  world: World
  selection: Selection
  activePaint: { layer: PaintLayer; slot: number }
  territoryStats: Map<number, SlotStats>
  biomeStats: Map<number, SlotStats>
  /** Id do ponto -> slot do territorio onde ele caiu (0 = nenhum). */
  poiOwners: Map<string, number>
  landPixels: number
  waterPixels: number
  landColor: string
  waterColor: string
  onSelect: (selection: Selection) => void
  onPaintWith: (layer: PaintLayer, slot: number, onLand: boolean | null) => void
  onFocus: (x: number, y: number, scale?: number) => void
  onCreateTerritory: (kind: EntityKind) => void
  onCreateBiome: (type: BiomeType) => void
  onUpdateTerritory: (slot: number, patch: Partial<Territory>) => void
  onUpdateBiome: (slot: number, patch: Partial<BiomeArea>) => void
  onDeleteTerritory: (slot: number) => void
  onDeleteBiome: (slot: number) => void
  onUpdatePoi: (id: string, patch: Partial<Poi>) => void
  onDeletePoi: (id: string) => void
  onIsolate: (slot: number) => void
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

function ListPanel(props: SidebarProps) {
  const { world, activePaint } = props
  const [tab, setTab] = useState<Tab>('paises')

  // Qual lado da costa esta armado (1 terra, 0 mar), ou -1 se nenhum.
  const costaAtiva = activePaint.layer === 'land' ? activePaint.slot : -1
  const countries = world.territories.filter((t) => t.kind === 'country')
  const seas = world.territories.filter((t) => t.kind === 'sea')

  const territoryList = (list: Territory[], kind: EntityKind) => (
    <>
      <button className="primary" onClick={() => props.onCreateTerritory(kind)}>
        + Novo {kind === 'country' ? 'pais' : 'mar'}
      </button>
      {list.length === 0 && (
        <p className="muted small hint">
          {kind === 'country'
            ? 'Crie um pais e use o balde para preencher uma massa de terra inteira num clique, ou o laco para recortar a area na mao.'
            : 'Crie um mar e marque a agua. A tinta nao sobe na terra.'}
        </p>
      )}
      <ul className="list">
        {list.map((entity) => {
          const stats = props.territoryStats.get(entity.slot)
          const isPainting =
            activePaint.layer === 'territory' && activePaint.slot === entity.slot
          return (
            <li key={entity.slot}>
              <button
                className="row"
                onClick={() => {
                  props.onSelect({ kind: 'territory', slot: entity.slot })
                  props.onPaintWith('territory', entity.slot, kind === 'country')
                  if (stats) props.onFocus(stats.anchor[0], stats.anchor[1])
                }}
              >
                <span className="dot" style={{ background: entity.color }} />
                <span className="row-name">{entity.name}</span>
                {isPainting && <span className="badge badge--paint">ativo</span>}
                <span className="muted small">
                  {stats
                    ? percent(
                        stats.area,
                        kind === 'country' ? props.landPixels : props.waterPixels,
                      )
                    : '--'}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )

  return (
    <aside className="panel">
      <nav className="tabs">
        {(['paises', 'mares', 'biomas', 'pontos', 'costa'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'paises'
              ? 'Paises'
              : t === 'mares'
                ? 'Mares'
                : t === 'biomas'
                  ? 'Biomas'
                  : t === 'pontos'
                    ? 'Pontos'
                    : 'Costa'}
          </button>
        ))}
      </nav>

      <div className="panel-body">
        {tab === 'paises' && territoryList(countries, 'country')}
        {tab === 'mares' && territoryList(seas, 'sea')}

        {tab === 'biomas' && (
          <>
            <p className="muted small hint">
              Escolha um tipo para criar uma area nova, depois marque a area com
              o laco ou o balde.
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
                      onClick={() => {
                        props.onSelect({ kind: 'biome', slot: biome.slot })
                        props.onPaintWith('biome', biome.slot, true)
                        if (stats) props.onFocus(stats.anchor[0], stats.anchor[1])
                      }}
                    >
                      <span className="dot" style={{ background: BIOMES[biome.type].color }} />
                      <span className="row-name">{biome.name}</span>
                      {isPainting && <span className="badge badge--paint">ativo</span>}
                      <span className="muted small">
                        {stats ? percent(stats.area, props.landPixels) : '--'}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        {tab === 'costa' && (
          <>
            <p className="muted small hint">
              Conserta a linha da costa. Util quando o desenho original fechou
              um canal estreito: escolha <strong>Mar</strong> e contorne o canal
              com o laco, ou <strong>Terra</strong> para aterrar. O balde tambem
              vale aqui.
            </p>
            <div className="chips">
              <button
                className={'chip' + (costaAtiva === 1 ? ' active' : '')}
                onClick={() => props.onPaintWith('land', 1, null)}
              >
                <span className="dot" style={{ background: props.landColor }} />
                Terra
              </button>
              <button
                className={'chip' + (costaAtiva === 0 ? ' active' : '')}
                onClick={() => props.onPaintWith('land', 0, null)}
              >
                <span className="dot" style={{ background: props.waterColor }} />
                Mar
              </button>
            </div>
            <p className="muted small">
              A tinta dos paises e dos biomas que ficar do lado errado sai
              junto, no mesmo desfazer. {percent(props.landPixels, props.landPixels + props.waterPixels)} do mapa e terra.
            </p>
          </>
        )}

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

function TerritoryDetail(
  props: SidebarProps & { t: Territory; onBack: () => void },
) {
  const { t } = props
  const stats = props.territoryStats.get(t.slot)
  const whole = t.kind === 'country' ? props.landPixels : props.waterPixels

  return (
    <aside className="panel">
      <DetailHead
        onBack={props.onBack}
        backLabel={t.kind === 'country' ? 'Paises' : 'Mares'}
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
          <span className="muted small">
            {t.kind === 'country' ? 'Pais' : 'Mar'}
            {stats ? ' · ' + percent(stats.area, whole) + ' do ' + (t.kind === 'country' ? 'mundo' : 'mar') : ''}
          </span>
          <button
            className="chip"
            onClick={() => props.onPaintWith('territory', t.slot, t.kind === 'country')}
          >
            pintar com este
          </button>
        </div>
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
          <button className="chip" onClick={() => props.onPaintWith('biome', b.slot, true)}>
            pintar
          </button>
        </div>
        {stats && (
          <p className="muted small">{percent(stats.area, props.landPixels)} da terra</p>
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
            {poi.x}, {poi.y}
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
