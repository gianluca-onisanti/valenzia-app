import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import {
  EARTH_RADIUS_KM,
  TEMPLATE_LIST,
  type BodyTreeNode,
  type TemplateId,
} from '@valenzia/shared'
import { api } from '../lib/api'
import { BodyFields, type BodyFieldValues } from '../components/BodyFields'

type Origin = 'image' | 'blank'

const RESOLUTIONS = [
  { label: 'Media (2048 x 1024)', width: 2048, height: 1024 },
  { label: 'Grande (4096 x 2048)', width: 4096, height: 2048 },
  { label: 'Pequena (1024 x 512)', width: 1024, height: 512 },
]

interface Preview {
  width: number
  height: number
  landColor: string
  waterColor: string
  landRatio: number
  resized: boolean
  preview: string
}

/**
 * Criar um corpo celeste: a partir de uma imagem (terra de uma cor, mar de
 * outra) ou em branco, a partir de um modelo. A imagem e lida no servidor,
 * vira a camada de terreno e e descartada -- nada vai para o repositorio.
 */
export function NewBodyPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [origin, setOrigin] = useState<Origin>('image')
  const [fields, setFields] = useState<BodyFieldValues>({
    name: '',
    description: '',
    radiusKm: params.get('parent') ? 1737 : EARTH_RADIUS_KM,
    parentId: params.get('parent'),
  })
  const [tree, setTree] = useState<BodyTreeNode[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [colors, setColors] = useState<{ land: string; water: string } | null>(null)
  const [template, setTemplate] = useState<TemplateId>(params.get('parent') ? 'lua' : 'oceanico')
  const [resolution, setResolution] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Novo corpo celeste - Valenzia'
    api.listBodies().then(setTree).catch(() => setTree([]))
  }, [])

  const analyze = async (chosen: File) => {
    setFile(chosen)
    setPreview(null)
    setColors(null)
    setError(null)
    if (!fields.name) setFields((f) => ({ ...f, name: chosen.name.replace(/\.[^.]+$/, '') }))
    setBusy('Lendo a imagem...')
    try {
      const result = await api.previewImage(chosen)
      setPreview(result)
      setColors({ land: result.landColor, water: result.waterColor })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const ready =
    fields.name.trim() !== '' &&
    fields.radiusKm > 0 &&
    (origin === 'blank' || (file !== null && preview !== null))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!ready) return
    setError(null)
    setBusy('Criando...')
    try {
      const common = {
        name: fields.name.trim(),
        description: fields.description || undefined,
        radiusKm: fields.radiusKm,
        parentId: fields.parentId,
      }
      const body =
        origin === 'image' && file
          ? await api.createFromImage(file, {
              ...common,
              landColor: colors?.land,
              waterColor: colors?.water,
            })
          : await api.createBlank({
              ...common,
              width: RESOLUTIONS[resolution].width,
              height: RESOLUTIONS[resolution].height,
              template,
            })
      navigate('/atlas/' + body.id)
    } catch (err) {
      setError((err as Error).message)
      setBusy(null)
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <Link to="/atlas" className="muted small">
            ← Atlas
          </Link>
          <h1>Novo corpo celeste</h1>
        </div>
      </header>

      <form className="new-body" onSubmit={submit}>
        <section className="card">
          <h2>Como comecar</h2>
          <div className="origin-choice">
            <button
              type="button"
              className={'origin' + (origin === 'image' ? ' is-active' : '')}
              onClick={() => setOrigin('image')}
            >
              <strong>A partir de uma imagem</strong>
              <span className="muted small">
                Um mapa com terra de uma cor e mar de outra (a costa pode estar
                riscada em preto). Vira o gabarito de terra e mar.
              </span>
            </button>
            <button
              type="button"
              className={'origin' + (origin === 'blank' ? ' is-active' : '')}
              onClick={() => setOrigin('blank')}
            >
              <strong>Em branco</strong>
              <span className="muted small">
                Comece de um modelo (oceano, rocha, gas...) e desenhe os
                continentes com o pincel e o laco.
              </span>
            </button>
          </div>

          {origin === 'image' && (
            <div className="image-step">
              <label className="dropzone">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const chosen = e.target.files?.[0]
                    if (chosen) void analyze(chosen)
                  }}
                />
                {file ? (
                  <span>
                    <strong>{file.name}</strong>{' '}
                    <span className="muted small">({(file.size / 1e6).toFixed(1)} MB) — trocar</span>
                  </span>
                ) : (
                  <span>
                    <strong>Escolher imagem</strong>
                    <span className="muted small"> PNG, JPG ou WebP, ate 30 MB</span>
                  </span>
                )}
              </label>

              {preview && colors && (
                <div className="preview">
                  <img src={preview.preview} alt="Terra em branco, mar em preto" />
                  <div className="preview-info">
                    <p className="small">
                      {preview.width} x {preview.height} px ·{' '}
                      {(preview.landRatio * 100).toFixed(1).replace('.', ',')}% terra
                      {preview.resized && ' · reduzida para caber no limite do editor'}
                    </p>
                    <p className="muted small">
                      Terra em branco, mar em preto. Se estiver invertido, o canto
                      superior esquerdo da imagem nao e mar -- ele e a referencia.
                    </p>
                    <div className="field-row">
                      <label className="form-field">
                        <span>Cor da terra</span>
                        <input
                          type="color"
                          value={colors.land}
                          onChange={(e) => setColors({ ...colors, land: e.target.value })}
                        />
                      </label>
                      <label className="form-field">
                        <span>Cor do mar</span>
                        <input
                          type="color"
                          value={colors.water}
                          onChange={(e) => setColors({ ...colors, water: e.target.value })}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {origin === 'blank' && (
            <div className="blank-step">
              <div className="templates">
                {TEMPLATE_LIST.map((t) => {
                  const fill = t.materials.find((m) => m.code === t.fill)
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={'template' + (template === t.id ? ' is-active' : '')}
                      onClick={() => setTemplate(t.id)}
                    >
                      <span
                        className="template-swatch"
                        style={{
                          background:
                            'linear-gradient(135deg, ' +
                            (fill?.color ?? '#888') +
                            ' 55%, ' +
                            (t.materials.find((m) => m.code !== t.fill)?.color ?? '#888') +
                            ' 55%)',
                        }}
                      />
                      <strong>{t.label}</strong>
                      <span className="muted small">{t.hint}</span>
                    </button>
                  )
                })}
              </div>
              <label className="form-field">
                <span>Resolucao do mapa</span>
                <select value={resolution} onChange={(e) => setResolution(Number(e.target.value))}>
                  {RESOLUTIONS.map((r, i) => (
                    <option key={r.label} value={i}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <small className="muted">
                  E o nivel de detalhe do desenho, nao o tamanho do planeta.
                </small>
              </label>
            </div>
          )}
        </section>

        <section className="card">
          <h2>O corpo</h2>
          <BodyFields
            value={fields}
            onChange={setFields}
            planets={tree.filter((p) => !p.parentId)}
          />
        </section>

        {error && <p className="form-error">{error}</p>}

        <footer className="form-foot">
          {busy && <span className="muted small">{busy}</span>}
          <div className="spacer" />
          <Link className="button" to="/atlas">
            Cancelar
          </Link>
          <button type="submit" className="button button--primary" disabled={!ready || busy !== null}>
            Criar {fields.parentId ? 'lua' : 'planeta'}
          </button>
        </footer>
      </form>
    </div>
  )
}
