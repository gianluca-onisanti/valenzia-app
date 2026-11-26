import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { formatKm2, type BodyMeta, type BodyTreeNode, type RingSpec } from '@valenzia/shared'
import { drawRingHalf, ringStops } from '../lib/rings'
import { api } from '../lib/api'
import type { PhaseTotals } from '../lib/layers'
import { BodyFields, type BodyFieldValues } from './BodyFields'
import { PHASE_LABEL } from './Sidebar'

/**
 * Os dados do corpo que nao sao pintura: nome, tamanho, orbita. Grava na hora
 * (nao espera o Salvar do mapa), porque nao mexe em nenhuma camada.
 */
export function BodySettingsDialog({
  body,
  phaseTotals,
  onClose,
  onSaved,
  onDeleted,
  onReproject,
}: {
  body: BodyMeta
  phaseTotals: PhaseTotals
  onClose: () => void
  onSaved: (next: BodyMeta) => void
  onDeleted: () => void
  /** Abre a conversao de Mercator. */
  onReproject: () => void
}) {
  const [value, setValue] = useState<BodyFieldValues>({
    name: body.name,
    description: body.description,
    radiusKm: body.radiusKm,
    parentId: body.parentId,
  })
  const [rings, setRings] = useState<RingSpec | null>(body.rings)
  const [axialTilt, setAxialTilt] = useState(body.axialTilt ?? 0)
  const [retrograde, setRetrograde] = useState(body.retrograde ?? false)
  const [tree, setTree] = useState<BodyTreeNode[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .listBodies()
      .then(setTree)
      .catch((err: Error) => setError(err.message))
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const self = tree.find((p) => p.id === body.id)
  const moons = self?.moons ?? []

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const saved = await api.patchBody(body.id, {
        name: value.name.trim(),
        description: value.description,
        radiusKm: value.radiusKm,
        parentId: value.parentId,
        rings,
        axialTilt,
        retrograde,
      })
      onSaved(saved)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    const aviso = moons.length
      ? '\n\nAs ' + moons.length + ' lua(s) dele viram planetas soltos.'
      : ''
    if (!confirm('Excluir ' + body.name + ' para sempre? Isto nao tem desfazer.' + aviso)) return
    setBusy(true)
    try {
      await api.deleteBody(body.id)
      onDeleted()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const phases = (['solid', 'liquid', 'gas'] as const).filter((p) => phaseTotals.km2[p] > 0)

  return (
    <div className="iso-backdrop" onPointerDown={onClose}>
      <form
        className="dialog"
        role="dialog"
        aria-label={'Dados de ' + body.name}
        onPointerDown={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <header className="dialog-head">
          <strong>{body.parentId ? 'Lua' : 'Planeta'}</strong>
          <div className="spacer" />
          <button type="button" className="icon-button" title="Fechar" onClick={onClose}>
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

        <BodyFields
          value={value}
          onChange={setValue}
          planets={tree.filter((p) => !p.parentId)}
          selfId={body.id}
          hasMoons={moons.length > 0}
        />

        <GlobeLook
          tilt={axialTilt}
          onTilt={setAxialTilt}
          retrograde={retrograde}
          onRetrograde={setRetrograde}
          rings={rings}
          onRings={setRings}
        />

        {phases.length > 0 && (
          <p className="muted small">
            {phases.map((p) => PHASE_LABEL[p] + ': ' + formatKm2(phaseTotals.km2[p])).join(' · ')}
            {' · '}
            {body.width} x {body.height} px
          </p>
        )}

        <div className="form-field">
          <span>Projecao</span>
          <p className="muted small">
            {body.sourceProjection === 'mercator'
              ? 'Desenhado em Mercator e ja convertido: as calotas polares sao area nova.'
              : 'Equirretangular: cada linha do mapa e uma latitude, de polo a polo. ' +
                'Se o desenho foi feito como um mapa-mundi plano (Mercator), a terra ' +
                'perto do topo e do fundo vira cunha no globo.'}
          </p>
          {body.sourceProjection !== 'mercator' && (
            <div>
              <button type="button" className="button" onClick={onReproject}>
                Converter de Mercator...
              </button>
            </div>
          )}
        </div>

        {moons.length > 0 && (
          <div className="form-field">
            <span>Luas</span>
            <div className="chips">
              {moons.map((m) => (
                <Link key={m.id} className="chip" to={'/atlas/' + m.id} onClick={onClose}>
                  {m.name}
                </Link>
              ))}
            </div>
          </div>
        )}

        {error && <p className="form-error">{error}</p>}

        <footer className="dialog-foot">
          <button type="button" className="button button--danger" disabled={busy} onClick={remove}>
            Excluir corpo
          </button>
          <div className="spacer" />
          <button type="button" className="button" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            className="button button--primary"
            disabled={busy || !value.name.trim() || !(value.radiusKm > 0)}
          >
            {busy ? 'Gravando...' : 'Gravar'}
          </button>
        </footer>
      </form>
    </div>
  )
}

const DEFAULT_RINGS: RingSpec = {
  inner: 1.3,
  outer: 2.2,
  color: '#d8c49a',
  color2: '#8f7a5e',
  opacity: 0.8,
  seed: 1,
}

const TILT_PRESETS = [
  { label: 'Reto', deg: 0 },
  { label: 'Terra', deg: 23 },
  { label: 'Saturno', deg: 27 },
  { label: 'Urano', deg: 98 },
]

/**
 * Como o corpo aparece no globo: a inclinacao do eixo e os aneis, com uma
 * previa ao vivo dos dois.
 */
function GlobeLook({
  tilt,
  onTilt,
  retrograde,
  onRetrograde,
  rings: value,
  onRings: onChange,
}: {
  tilt: number
  onTilt: (deg: number) => void
  retrograde: boolean
  onRetrograde: (next: boolean) => void
  rings: RingSpec | null
  onRings: (next: RingSpec | null) => void
}) {
  const set = (patch: Partial<RingSpec>) => value && onChange({ ...value, ...patch })

  return (
    <section className="form-field form-field--wide">
      <span>No globo</span>
      <div className="ring-editor">
        <RingPreview spec={value} tilt={tilt} retrograde={retrograde} />
        <div className="ring-fields">
          <label className="form-field">
            <span>Inclinacao do eixo: {Math.round(tilt)}°</span>
            <input
              type="range"
              min={0}
              max={180}
              step={1}
              value={tilt}
              onChange={(e) => onTilt(Number(e.target.value))}
            />
          </label>
          <div className="chips">
            {TILT_PRESETS.map((p) => (
              <button key={p.deg} type="button" className="chip" onClick={() => onTilt(p.deg)}>
                {p.label} ({p.deg}°)
              </button>
            ))}
          </div>
          <div className="form-field">
            <span>Rotacao</span>
            <div className="segmented">
              <button
                type="button"
                className={retrograde ? '' : 'active'}
                onClick={() => onRetrograde(false)}
                title="Anti-horaria vista do polo norte, como a Terra"
              >
                Normal
              </button>
              <button
                type="button"
                className={retrograde ? 'active' : ''}
                onClick={() => onRetrograde(true)}
                title="Gira ao contrario, como Venus"
              >
                Retrograda
              </button>
            </div>
          </div>
          <label className="ring-toggle">
            <input
              type="checkbox"
              checked={value !== null}
              onChange={(e) => onChange(e.target.checked ? DEFAULT_RINGS : null)}
            />
            <span>Aneis</span>
          </label>
          {value && (
            <>
            <label className="form-field">
              <span>Comeca em {value.inner.toFixed(2).replace('.', ',')}x o raio</span>
              <input
                type="range"
                min={1.05}
                max={6}
                step={0.05}
                value={value.inner}
                onChange={(e) => {
                  const inner = Number(e.target.value)
                  set({ inner, outer: Math.max(value.outer, inner + 0.1) })
                }}
              />
            </label>
            <label className="form-field">
              <span>Termina em {value.outer.toFixed(2).replace('.', ',')}x o raio</span>
              <input
                type="range"
                min={1.15}
                max={8}
                step={0.05}
                value={value.outer}
                onChange={(e) => {
                  const outer = Number(e.target.value)
                  set({ outer, inner: Math.min(value.inner, outer - 0.1) })
                }}
              />
            </label>
            <label className="form-field">
              <span>Opacidade</span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={value.opacity}
                onChange={(e) => set({ opacity: Number(e.target.value) })}
              />
            </label>
            <div className="field-row">
              <label className="form-field">
                <span>Cor de dentro</span>
                <input
                  type="color"
                  value={value.color}
                  onChange={(e) => set({ color: e.target.value })}
                />
              </label>
              <label className="form-field">
                <span>Cor de fora</span>
                <input
                  type="color"
                  value={value.color2 ?? value.color}
                  onChange={(e) => set({ color2: e.target.value })}
                />
              </label>
            </div>
            <button
              type="button"
              className="button"
              title="Outras faixas e falhas, com as mesmas cores"
              onClick={() => set({ seed: Math.floor(Math.random() * 1_000_000) })}
            >
              Sortear faixas
            </button>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

/** Um planeta neutro, com o eixo inclinado e o anel (se houver) em volta. */
function RingPreview({
  spec,
  tilt,
  retrograde,
}: {
  spec: RingSpec | null
  tilt: number
  retrograde: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = 260
    const h = 150
    canvas.width = w * dpr
    canvas.height = h * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const reach = Math.max(1.25, spec?.outer ?? 0)
    const r = Math.min(52, (Math.min(w, h * 1.6) * 0.46) / reach)
    const cx = w / 2
    const cy = h / 2
    const sinLat = Math.sin(0.38)
    const roll = (tilt * Math.PI) / 180
    const stops = spec ? ringStops(spec) : null
    // O eixo: um fio que atravessa o planeta de polo a polo.
    const axis = (length: number) => {
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(roll)
      ctx.strokeStyle = 'rgba(232, 185, 100, 0.85)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(0, -length)
      ctx.lineTo(0, length)
      ctx.stroke()
      ctx.restore()
    }
    axis(r * 1.3)
    if (spec && stops) drawRingHalf(ctx, cx, cy, r, spec, sinLat, 'back', stops, roll)
    const body = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r)
    body.addColorStop(0, '#c9b48e')
    body.addColorStop(1, '#5d4b36')
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
    if (spec && stops) drawRingHalf(ctx, cx, cy, r, spec, sinLat, 'front', stops, roll)
    // As pontas do eixo, por cima, para ler a inclinacao.
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(roll)
    ctx.fillStyle = '#e8b964'
    for (const y of [-r * 1.3, r * 1.3]) {
      ctx.beginPath()
      ctx.arc(0, y, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
    // O sentido do giro: uma seta na frente de um circulo em volta do polo
    // norte. Na normal a frente anda para a direita; na retrograda, ao
    // contrario.
    const rx = r * 0.42
    const ry = rx * 0.32
    const py = -r * 1.08
    const t0 = Math.PI * 0.12
    const t1 = Math.PI * 0.88
    ctx.strokeStyle = '#e8b964'
    ctx.fillStyle = '#e8b964'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.ellipse(0, py, rx, ry, 0, t0, t1)
    ctx.stroke()
    const t = retrograde ? t1 : t0
    const sign = retrograde ? 1 : -1
    const tipX = rx * Math.cos(t)
    const tipY = py + ry * Math.sin(t)
    const angle = Math.atan2(sign * ry * Math.cos(t), -sign * rx * Math.sin(t))
    ctx.translate(tipX, tipY)
    ctx.rotate(angle)
    ctx.beginPath()
    ctx.moveTo(4, 0)
    ctx.lineTo(-3, -3.5)
    ctx.lineTo(-3, 3.5)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }, [spec, tilt, retrograde])
  return <canvas ref={ref} className="ring-preview" style={{ width: 260, height: 150 }} />
}
