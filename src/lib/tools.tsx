import type { Tool } from '../types'

export interface ToolInfo {
  id: Tool
  label: string
  hint: string
  shortcut: string
  icon: React.ReactNode
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export const TOOLS: ToolInfo[] = [
  {
    id: 'move',
    label: 'Mover',
    hint: 'So arrasta o mapa. Nada no mundo e alterado',
    shortcut: 'M',
    icon: (
      <g {...stroke}>
        <path d="M12 3v18M3 12h18" />
        <path d="M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5" />
        <path d="M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l2.5 2.5" />
      </g>
    ),
  },
  {
    id: 'select',
    label: 'Selecionar',
    hint: 'Clique para abrir a ficha do que estiver embaixo',
    shortcut: 'V',
    icon: <path d="M6 3l12.5 6.8-5.3 1.7-1.8 5.4z" fill="currentColor" />,
  },
  {
    id: 'bucket',
    label: 'Balde',
    hint: 'Preenche a massa de terra inteira num clique',
    shortcut: 'G',
    icon: (
      <>
        <path
          d="M11 3l8 8-7.5 7.5a1.5 1.5 0 01-2.1 0L4 13.1a1.5 1.5 0 010-2.1z"
          fill="currentColor"
        />
        <path d="M8 6L6 4" {...stroke} />
        <path
          d="M20.5 15c.9 1.5 1.5 2.5 1.5 3.2a1.5 1.5 0 11-3 0c0-.7.6-1.7 1.5-3.2z"
          fill="currentColor"
        />
      </>
    ),
  },
  {
    id: 'lasso',
    label: 'Laco',
    hint: 'Desenhe uma volta fechada: o miolo vira territorio',
    shortcut: 'L',
    icon: (
      <g {...stroke}>
        <ellipse cx="12" cy="9.5" rx="8" ry="5.5" strokeDasharray="3.2 2.6" />
        <path d="M8.5 14.4c-.6 2.2.2 3.9 1.8 4.6" />
        <circle cx="11" cy="20" r="1.6" fill="currentColor" stroke="none" />
      </g>
    ),
  },
]

export const TOOL_BY_ID = new Map(TOOLS.map((t) => [t.id, t]))
