import { useEffect } from 'react'
import { Link } from 'react-router'
import { NAV } from '../nav'

/** A porta de entrada: os setores do app, os prontos e os que estao a caminho. */
export function HomePage() {
  useEffect(() => {
    document.title = 'Valenzia'
  }, [])

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Valenzia</h1>
          <p className="muted">O caderno do seu mundo de RPG.</p>
        </div>
      </header>

      <div className="sectors">
        {NAV.filter((item) => item.to !== '/').map((item) =>
          item.soon ? (
            <div key={item.id} className="sector is-soon">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {item.icon}
              </svg>
              <strong>{item.label}</strong>
              <span className="muted small">{item.hint}</span>
              <span className="sidenav-soon">em breve</span>
            </div>
          ) : (
            <Link key={item.id} to={item.to} className="sector">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {item.icon}
              </svg>
              <strong>{item.label}</strong>
              <span className="muted small">{item.hint}</span>
            </Link>
          ),
        )}
      </div>
    </div>
  )
}

export function NotFoundPage() {
  return (
    <div className="page">
      <h1>Pagina nao encontrada</h1>
      <p>
        <Link to="/">Voltar ao inicio</Link>
      </p>
    </div>
  )
}
