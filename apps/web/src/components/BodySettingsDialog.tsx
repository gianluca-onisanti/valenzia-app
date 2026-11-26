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
}: {
  body: BodyMeta
  phaseTotals: PhaseTotals
  onClose: () => void
  onSaved: (next: BodyMeta) => void
  onDeleted: () => void
}) {
  const [value, setValue] = useState<BodyFieldValues>({
    name: body.name,
    description: body.description,
    radiusKm: body.radiusKm,
    parentId: body.parentId,
  })
  const [rings, setRings] = useState<RingSpec | null>(body.rings)
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

        <RingEditor value={rings} onChange={setRings} />

        {phases.length > 0 && (
          <p className="muted small">
            {phases.map((p) => PHASE_LABEL[p] + ': ' + formatKm2(phaseTotals.km2[p])).join(' · ')}
            {' · '}
            {body.width} x {body.height} px
          </p>
        )}

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

/** Liga, desliga e ajusta os aneis, com uma previa ao vivo. */
function RingEditor({
  value,
  onChange,
}: {
  value: RingSpec | null
  onChange: (next: RingSpec | null) => void
}) {
  const set = (patch: Partial<RingSpec>) => value && onChange({ ...value, ...patch })

  return (
    <section className="form-field form-field--wide">
      <label className="ring-toggle">
        <input
          type="checkbox"
          checked={value !== null}
          onChange={(e) => onChange(e.target.checked ? DEFAULT_RINGS : null)}
        />
        <span>Aneis</span>
      </label>
      {value && (
        <div className="ring-editor">
          <RingPreview spec={value} />
          <div className="ring-fields">
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
          </div>
        </div>
      )}
    </section>
  )
}

/** Um planeta neutro com o anel em volta, visto de cima e de leve. */
function RingPreview({ spec }: { spec: RingSpec }) {
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
    const r = Math.min(52, (w * 0.46) / spec.outer)
    const cx = w / 2
    const cy = h / 2
    const sinLat = Math.sin(0.38)
    const stops = ringStops(spec)
    drawRingHalf(ctx, cx, cy, r, spec, sinLat, 'back', stops)
    const body = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r)
    body.addColorStop(0, '#c9b48e')
    body.addColorStop(1, '#5d4b36')
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
    drawRingHalf(ctx, cx, cy, r, spec, sinLat, 'front', stops)
  }, [spec])
  return <canvas ref={ref} className="ring-preview" style={{ width: 260, height: 150 }} />
}
