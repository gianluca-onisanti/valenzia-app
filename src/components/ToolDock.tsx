import { useEffect, useRef, useState } from 'react'
import type { Tool } from '../types'
import { TOOLS, TOOL_BY_ID } from '../lib/tools'

interface ToolDockProps {
  tool: Tool
  onTool: (tool: Tool) => void
}

/**
 * Seletor de ferramenta flutuante, no canto inferior esquerdo. O botao mostra
 * sempre a ferramenta em uso; clicar abre a lista para cima.
 */
export function ToolDock({ tool, onTool }: ToolDockProps) {
  const [open, setOpen] = useState(false)
  const dockRef = useRef<HTMLDivElement>(null)
  const current = TOOL_BY_ID.get(tool) ?? TOOLS[0]

  // Fecha ao clicar fora ou com Esc, como qualquer menu flutuante.
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!dockRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="dock" ref={dockRef}>
      {open && (
        <div className="dock-menu" role="menu">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              role="menuitemradio"
              aria-checked={t.id === tool}
              className={t.id === tool ? 'active' : ''}
              title={t.hint}
              onClick={() => {
                onTool(t.id)
                setOpen(false)
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {t.icon}
              </svg>
              <span className="dock-label">{t.label}</span>
              <kbd>{t.shortcut}</kbd>
            </button>
          ))}
        </div>
      )}

      <button
        className={'dock-fab' + (open ? ' is-open' : '')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={'Ferramenta: ' + current.label}
        title={current.label + ' (' + current.shortcut + ') — clique para trocar'}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {current.icon}
        </svg>
      </button>
    </div>
  )
}
