import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { formatKm2, type BodyMeta, type BodyTreeNode } from '@valenzia/shared'
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
