import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ICE,
  equirectHeight,
  iceCode,
  mercatorMaxLat,
  mercatorRowMap,
  remapRows,
  type BodyDocument,
  type BodyMeta,
  type Material,
  type ReprojectInput,
} from '@valenzia/shared'
import { api } from '../lib/api'
import { hexToRgb } from '../lib/layers'
import { renderGlobe, type Texture } from '../lib/globe'

/** Largura da textura das previas: os globos sao pequenos. */
const PREVIEW_WIDTH = 1024
const GLOBE_SIZE = 220

const VIEWS = [
  { id: 'norte', label: 'Polo norte', lat: 1.15 },
  { id: 'equador', label: 'Equador', lat: 0.15 },
  { id: 'sul', label: 'Polo sul', lat: -1.15 },
] as const

const fmtDeg = (rad: number) => ((rad * 180) / Math.PI).toFixed(1).replace('.', ',') + '°'

/**
 * Converte um corpo desenhado em Mercator para o equirretangular do app.
 * Mostra o antes e o depois em dois globos, vistos do polo ou do equador,
 * e deixa escolher o que preenche as calotas e se o resultado vira uma copia
 * (o padrao, que nao mexe no original) ou substitui este corpo.
 */
export function ReprojectDialog({
  body,
  materials,
  source,
  dirty,
  onClose,
  onDone,
}: {
  body: BodyMeta
  materials: Material[]
  /** O mapa composto do editor (cores de chao, paises, biomas). */
  source: HTMLCanvasElement | null
  /** Ha alteracoes nao salvas: converter agora as perderia. */
  dirty: boolean
  onClose: () => void
  onDone: (doc: BodyDocument, mode: ReprojectInput['mode']) => void
}) {
  // Com Gelo no corpo, as calotas sao dele; sem, um Gelo novo.
  const existingIce = iceCode(materials)
  const [capChoice, setCapChoice] = useState<string>(
    existingIce !== undefined ? String(existingIce) : 'new-ice',
  )
  const [mode, setMode] = useState<ReprojectInput['mode']>('copy')
  const [name, setName] = useState(body.name + ' (Mercator)')
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('norte')
  const [lon, setLon] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const reach = fmtDeg(mercatorMaxLat(body.width, body.height))
  const already = body.sourceProjection === 'mercator'
  const capColor =
    capChoice === 'new-ice'
      ? ICE.color
      : (materials.find((m) => String(m.code) === capChoice)?.color ?? '#808080')

  /** O mapa atual, reduzido, como textura do globo "antes". */
  const before: Texture | null = useMemo(() => {
    if (!source) return null
    const w = PREVIEW_WIDTH
    const h = Math.max(1, Math.round((w * body.height) / body.width))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, w, h)
    return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h }
  }, [source, body.width, body.height])

  /** O mesmo mapa convertido: linhas no lugar certo, calotas pintadas. */
  const after: Texture | null = useMemo(() => {
    if (!before) return null
    const h = equirectHeight(before.width)
    const rows = mercatorRowMap(before.width, before.height, h)
    const [r, g, b] = hexToRgb(capColor)
    const data = remapRows(before.data, before.width, rows, [r, g, b, 255], 4)
    return { data, width: before.width, height: h }
  }, [before, capColor])

  const lat = VIEWS.find((v) => v.id === view)?.lat ?? 0

  const apply = async () => {
    setBusy(true)
    setError(null)
    try {
      const cap: ReprojectInput['cap'] =
        capChoice === 'new-ice'
          ? { material: { name: ICE.name, phase: ICE.phase, color: ICE.color } }
          : { code: Number(capChoice) }
      const doc = await api.reproject(body.id, {
        expectedRevision: body.revision,
        mode,
        cap,
        ...(mode === 'copy' ? { name: name.trim() || undefined } : {}),
      })
      onDone(doc, mode)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="iso-backdrop" onPointerDown={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-label="Converter de Mercator"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="dialog-head">
          <strong>Converter de Mercator</strong>
          <div className="spacer" />
          <button type="button" className="icon-button" title="Fechar" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
        </header>

        {already ? (
          <p className="muted small">
            Este corpo ja foi convertido de Mercator. Converter de novo espremeria
            o desenho outra vez.
          </p>
        ) : (
          <>
            <p className="small">
              Se o mapa foi desenhado como um mapa-mundi plano, ele esta em Mercator:
              as formas valem como desenhadas, e a terra encostada no topo e no fundo
              vira cunha no globo. Convertido, o desenho cobre de {reach}S a {reach}N
              com as formas no lugar, e o que passa disso vira calota polar.
              O mapa fica com {body.width} x {equirectHeight(body.width)} px, e paises,
              biomas e pontos acompanham.
            </p>

            <div className="reproject-globes">
              <MiniGlobe label="Hoje" texture={before} lat={lat} lon={lon} />
              <MiniGlobe label="Convertido" texture={after} lat={lat} lon={lon} />
            </div>
            <div className="chips">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={'chip' + (view === v.id ? ' active' : '')}
                  onClick={() => setView(v.id)}
                >
                  {v.label}
                </button>
              ))}
              <button type="button" className="chip" onClick={() => setLon((l) => l + Math.PI / 4)}>
                ◀ Girar
              </button>
              <button type="button" className="chip" onClick={() => setLon((l) => l - Math.PI / 4)}>
                Girar ▶
              </button>
            </div>

            <div className="field-row">
              <label className="form-field">
                <span>Calotas polares</span>
                <select value={capChoice} onChange={(e) => setCapChoice(e.target.value)}>
                  {existingIce === undefined && <option value="new-ice">Gelo (material novo)</option>}
                  {materials.map((m) => (
                    <option key={m.code} value={String(m.code)}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-field">
                <span>Resultado</span>
                <div className="segmented">
                  <button
                    type="button"
                    className={mode === 'copy' ? 'active' : ''}
                    onClick={() => setMode('copy')}
                  >
                    Criar uma copia
                  </button>
                  <button
                    type="button"
                    className={mode === 'replace' ? 'active' : ''}
                    onClick={() => setMode('replace')}
                  >
                    Substituir este
                  </button>
                </div>
              </div>
            </div>
            {mode === 'copy' ? (
              <label className="form-field">
                <span>Nome da copia</span>
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
            ) : (
              <p className="muted small">
                O original deixa de existir: a conversao muda o tamanho do mapa e nao
                tem desfazer. Na duvida, crie uma copia e compare.
              </p>
            )}
            {dirty && (
              <p className="form-error">
                Ha alteracoes nao salvas. Salve antes de converter: a conversao parte
                do que esta gravado.
              </p>
            )}
          </>
        )}

        {error && <p className="form-error">{error}</p>}

        <footer className="dialog-foot">
          <div className="spacer" />
          <button type="button" className="button" onClick={onClose}>
            {already ? 'Fechar' : 'Cancelar'}
          </button>
          {!already && (
            <button
              type="button"
              className="button button--primary"
              disabled={busy || dirty}
              onClick={apply}
            >
              {busy ? 'Convertendo...' : mode === 'copy' ? 'Criar copia convertida' : 'Converter este corpo'}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

function MiniGlobe({
  label,
  texture,
  lat,
  lon,
}: {
  label: string
  texture: Texture | null
  lat: number
  lon: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !texture) return
    const dpr = window.devicePixelRatio || 1
    const size = Math.round(GLOBE_SIZE * dpr)
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const image = ctx.createImageData(size, size)
    renderGlobe(image, texture, { cx: size / 2, cy: size / 2, r: size / 2 - 2 }, { lon, lat })
    ctx.putImageData(image, 0, 0)
  }, [texture, lat, lon])
  return (
    <figure className="reproject-globe">
      <canvas ref={ref} style={{ width: GLOBE_SIZE, height: GLOBE_SIZE }} />
      <figcaption className="muted small">{label}</figcaption>
    </figure>
  )
}
