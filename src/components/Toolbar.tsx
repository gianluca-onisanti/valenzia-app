import { useEffect, useRef, useState } from 'react'
import type { ViewMode, ViewOptions } from '../lib/layers'

interface ToolbarProps {
  worldName: string
  /** O que a ferramenta vai aplicar, para ninguem pintar no escuro. */
  activeLabel: string | null
  activeColor: string | null
  view: ViewOptions
  onView: (view: ViewOptions) => void
  showLabels: boolean
  onToggleLabels: () => void
  showPois: boolean
  onTogglePois: () => void
  erasing: boolean
  onToggleErasing: () => void
  globe: boolean
  onToggleGlobe: () => void
  dirty: boolean
  status: string | null
  busy: boolean
  canUndo: boolean
  onUndo: () => void
  onSave: () => void
  onExport: () => void
  onImport: (file: File) => void
  onFit: () => void
}

const VIEWS: { id: ViewMode; label: string; hint: string }[] = [
  { id: 'politica', label: 'Politica', hint: 'So as cores dos paises e mares (1)' },
  {
    id: 'biomas',
    label: 'Biomas',
    hint: 'So as cores dos biomas, com as fronteiras por cima (2)',
  },
  { id: 'mista', label: 'Mista', hint: 'Bioma em hachura sobre a cor do pais (3)' },
]

export function Toolbar(props: ToolbarProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return (
    <header className="toolbar">
      <strong className="brand">{props.worldName}</strong>

      {props.dirty && (
        <span className="unsaved" title="Ha alteracoes nao salvas" aria-label="nao salvo" />
      )}

      {props.activeLabel && (
        <div className="active-paint" title="O que a ferramenta vai aplicar">
          <span className="dot" style={{ background: props.activeColor ?? '#888' }} />
          <span className="small">{props.activeLabel}</span>
        </div>
      )}

      <button
        className={'chip' + (props.erasing ? ' active' : '')}
        title="Apagar em vez de pintar (E). O laco e o balde e que marcam a area."
        onClick={props.onToggleErasing}
      >
        Apagar
      </button>

      <div className="spacer" />

      {props.status && <span className="status">{props.status}</span>}

      <div className="segmented">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={props.view.mode === v.id ? 'active' : ''}
            title={v.hint}
            onClick={() => props.onView({ ...props.view, mode: v.id })}
          >
            {v.label}
          </button>
        ))}
      </div>

      <button
        className={'icon-button' + (props.globe ? ' active' : '')}
        title="Ver como globo"
        aria-pressed={props.globe}
        onClick={props.onToggleGlobe}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <g fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="9" />
            <ellipse cx="12" cy="12" rx="4" ry="9" />
            <path d="M3 12h18M4.6 7h14.8M4.6 17h14.8" />
          </g>
        </svg>
      </button>

      <div className="menu-wrap" ref={menuRef}>
        <button
          className="icon-button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Mais opcoes"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="5" r="1.9" />
            <circle cx="12" cy="12" r="1.9" />
            <circle cx="12" cy="19" r="1.9" />
          </svg>
        </button>

        {menuOpen && (
          <div className="menu" role="menu">
            <button
              role="menuitem"
              disabled={!props.canUndo}
              onClick={() => {
                props.onUndo()
                setMenuOpen(false)
              }}
            >
              <span>Desfazer</span>
              <kbd>Ctrl+Z</kbd>
            </button>
            <button
              role="menuitem"
              disabled={!props.dirty || props.busy}
              onClick={() => {
                props.onSave()
                setMenuOpen(false)
              }}
            >
              <span>{props.busy ? 'Salvando...' : props.dirty ? 'Salvar' : 'Salvo'}</span>
            </button>
            <button
              role="menuitem"
              onClick={() => {
                props.onExport()
                setMenuOpen(false)
              }}
            >
              <span>Exportar</span>
            </button>
            <button role="menuitem" onClick={() => fileRef.current?.click()}>
              <span>Importar</span>
            </button>

            <hr />

            <button
              role="menuitem"
              onClick={() => {
                props.onFit()
                setMenuOpen(false)
              }}
            >
              <span>Enquadrar o mapa</span>
            </button>

            <hr />

            <label className="menu-toggle">
              <input
                type="checkbox"
                checked={props.view.showBorders}
                onChange={() =>
                  props.onView({ ...props.view, showBorders: !props.view.showBorders })
                }
              />
              Fronteiras
            </label>
            <label className="menu-toggle">
              <input
                type="checkbox"
                checked={props.showLabels}
                onChange={props.onToggleLabels}
              />
              Nomes
            </label>
            <label className="menu-toggle">
              <input type="checkbox" checked={props.showPois} onChange={props.onTogglePois} />
              Pontos
            </label>
            <label className="menu-toggle" title="Contorno tracado no lugar da imagem da costa">
              <input
                type="checkbox"
                checked={props.view.coastLine}
                onChange={() =>
                  props.onView({ ...props.view, coastLine: !props.view.coastLine })
                }
              />
              Costa vetorial
            </label>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) props.onImport(file)
            e.target.value = ''
            setMenuOpen(false)
          }}
        />
      </div>
    </header>
  )
}
