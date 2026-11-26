/**
 * Os setores do app, na ordem do menu lateral. Cada feature nova entra aqui:
 * rotulo, rota, icone. Enquanto nao existe, fica marcada como `soon` -- o menu
 * mostra o lugar dela, mas nao navega.
 */
export interface NavItem {
  id: string
  label: string
  to: string
  hint: string
  icon: React.ReactNode
  soon?: boolean
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export const NAV: NavItem[] = [
  {
    id: 'inicio',
    label: 'Inicio',
    to: '/',
    hint: 'Visao geral',
    icon: (
      <g {...stroke}>
        <path d="M4 11l8-6.5 8 6.5" />
        <path d="M6 9.5V19h12V9.5" />
      </g>
    ),
  },
  {
    id: 'atlas',
    label: 'Atlas',
    to: '/atlas',
    hint: 'Planetas, luas e os mapas de cada um',
    icon: (
      <g {...stroke}>
        <circle cx="12" cy="12" r="8" />
        <ellipse cx="12" cy="12" rx="3.4" ry="8" />
        <path d="M4 12h16" />
      </g>
    ),
  },
  {
    id: 'campanhas',
    label: 'Campanhas',
    to: '/campanhas',
    hint: 'Sessoes, arcos e anotacoes de mesa',
    soon: true,
    icon: (
      <g {...stroke}>
        <path d="M5 4.5h11a3 3 0 013 3V20H8a3 3 0 01-3-3z" />
        <path d="M5 17a3 3 0 013-3h11" />
      </g>
    ),
  },
  {
    id: 'personagens',
    label: 'Personagens',
    to: '/personagens',
    hint: 'Herois, vilões e coadjuvantes',
    soon: true,
    icon: (
      <g {...stroke}>
        <circle cx="12" cy="8.5" r="3.5" />
        <path d="M5 20c.8-3.8 3.5-6 7-6s6.2 2.2 7 6" />
      </g>
    ),
  },
  {
    id: 'bestiario',
    label: 'Bestiario',
    to: '/bestiario',
    hint: 'Criaturas e monstros',
    soon: true,
    icon: (
      <g {...stroke}>
        <path d="M4 13c0-4.4 3.6-8 8-8s8 3.6 8 8c0 3-2 6-8 6s-8-3-8-6z" />
        <path d="M8.5 11.5l1.5 1M15.5 11.5l-1.5 1M10 16h4" />
        <path d="M6 7L4 3.5M18 7l2-3.5" />
      </g>
    ),
  },
]
