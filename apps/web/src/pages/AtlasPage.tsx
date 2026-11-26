import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { earthRatio, formatKm, type BodySummary, type BodyTreeNode } from '@valenzia/shared'
import { api } from '../lib/api'

/**
 * O atlas: todos os corpos celestes, cada planeta com as luas que o orbitam
 * logo abaixo. E daqui que se abre um mapa ou se cria um novo.
 */
export function AtlasPage() {
  const [tree, setTree] = useState<BodyTreeNode[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Atlas - Valenzia'
    api
      .listBodies()
      .then(setTree)
      .catch((err: Error) => setError(err.message))
  }, [])

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Atlas</h1>
          <p className="muted">Planetas e luas do seu mundo. Cada um tem o proprio mapa.</p>
        </div>
        <div className="spacer" />
        <Link className="button button--primary" to="/atlas/novo">
          + Novo corpo celeste
        </Link>
      </header>

      {error && <p className="form-error">Nao consegui carregar o atlas: {error}</p>}
      {!tree && !error && <p className="muted">Carregando...</p>}

      {tree && tree.length === 0 && (
        <div className="empty">
          <h2>Nenhum mapa ainda</h2>
          <p className="muted">
            Comece por um planeta: envie a imagem de um mapa (terra de uma cor,
            mar de outra) ou desenhe um do zero.
          </p>
          <Link className="button button--primary" to="/atlas/novo">
            Criar o primeiro planeta
          </Link>
        </div>
      )}

      {tree && tree.length > 0 && (
        <div className="atlas">
          {tree.map((planet) => (
            <section key={planet.id} className="system">
              <BodyCard body={planet} />
              <div className="moons">
                {planet.moons.map((moon) => (
                  <BodyCard key={moon.id} body={moon} small />
                ))}
                {!planet.parentId && (
                  <Link className="moon-add" to={'/atlas/novo?parent=' + planet.id}>
                    + Lua
                  </Link>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function BodyCard({ body, small }: { body: BodySummary; small?: boolean }) {
  const ratio = earthRatio(body.radiusKm)
  return (
    <Link to={'/atlas/' + body.id} className={'body-card' + (small ? ' body-card--small' : '')}>
      <div className="body-thumb">
        {body.hasThumbnail ? (
          <img src={api.thumbnailUrl(body.id, body.revision)} alt="" loading="lazy" />
        ) : (
          <span className="body-thumb-empty">sem previa: abra e salve uma vez</span>
        )}
      </div>
      <div className="body-info">
        <div className="body-title">
          <strong>{body.name}</strong>
          <span className="badge">{body.parentId ? 'Lua' : 'Planeta'}</span>
        </div>
        <span className="muted small">
          raio {formatKm(body.radiusKm)} · {ratio.toFixed(2).replace('.', ',')}x a Terra
        </span>
        {!small && (
          <span className="muted small">
            {body.territoryCount} territorio(s) · {body.poiCount} ponto(s)
          </span>
        )}
      </div>
    </Link>
  )
}
