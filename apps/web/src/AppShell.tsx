import { useState } from 'react'
import { NavLink, Outlet, useMatch } from 'react-router'
import { NAV } from './nav'

/**
 * A moldura do app: o menu lateral dos setores e, ao lado, a pagina da vez.
 * No editor de mapa o menu fica recolhido (so icones) para dar a tela ao mapa.
 */
export function AppShell() {
  const bodyRoute = useMatch('/atlas/:bodyId')
  const newRoute = useMatch('/atlas/novo')
  const inEditor = bodyRoute !== null && newRoute === null
  const [pinnedOpen, setPinnedOpen] = useState(true)
  const collapsed = inEditor || !pinnedOpen

  return (
    <div className={'shell' + (collapsed ? ' shell--collapsed' : '')}>
      <nav className="sidenav" aria-label="Setores">
        <div className="sidenav-brand">
          <span className="sidenav-logo" aria-hidden="true">
            V
          </span>
          {!collapsed && <strong>Valenzia</strong>}
        </div>

        <ul>
          {NAV.map((item) => (
            <li key={item.id}>
              {item.soon ? (
                <span className="sidenav-item is-soon" title={item.label + ' - em breve'}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    {item.icon}
                  </svg>
                  {!collapsed && (
                    <>
                      <span className="sidenav-label">{item.label}</span>
                      <span className="sidenav-soon">em breve</span>
                    </>
                  )}
                </span>
              ) : (
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => 'sidenav-item' + (isActive ? ' is-active' : '')}
                  title={collapsed ? item.label : item.hint}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    {item.icon}
                  </svg>
                  {!collapsed && <span className="sidenav-label">{item.label}</span>}
                </NavLink>
              )}
            </li>
          ))}
        </ul>

        {!inEditor && (
          <button
            className="sidenav-toggle"
            title={pinnedOpen ? 'Recolher o menu' : 'Abrir o menu'}
            onClick={() => setPinnedOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d={pinnedOpen ? 'M14 6l-6 6 6 6' : 'M10 6l6 6-6 6'}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </nav>

      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  )
}
