import type { PoiType } from '../types'

interface PoiTypeInfo {
  label: string
  color: string
  /** Glifo dentro do pino, em viewBox 24x24 centrado em (12,12). */
  glyph: React.ReactNode
}

export const POI_TYPES: Record<PoiType, PoiTypeInfo> = {
  capital: {
    label: 'Capital',
    color: '#f2b705',
    glyph: (
      <path d="M12 4.5l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 9.8l5-.7z" />
    ),
  },
  cidade: {
    label: 'Cidade',
    color: '#e8e3d8',
    glyph: (
      <>
        <rect x="6" y="11" width="5" height="8" rx="0.5" />
        <rect x="13" y="7" width="5" height="12" rx="0.5" />
      </>
    ),
  },
  vila: {
    label: 'Vila',
    color: '#c9bfa8',
    glyph: <path d="M12 6l6 5.5h-2.5V18h-7v-6.5H6z" />,
  },
  porto: {
    label: 'Porto',
    color: '#6fc0d6',
    glyph: (
      <>
        <circle cx="12" cy="6" r="2" />
        <path d="M11 9h2v9h-2z" />
        <path
          d="M6 13a6 6 0 0012 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </>
    ),
  },
  fortaleza: {
    label: 'Fortaleza',
    color: '#b0b7c3',
    glyph: <path d="M5 8h3v2h2V8h4v2h2V8h3v11H5zm3 6h8v5H8z" />,
  },
  ruina: {
    label: 'Ruina',
    color: '#9a8f7d',
    glyph: (
      <>
        <path d="M6 19V9l3-2v12z" />
        <path d="M11 19v-7l3 2v5z" />
        <path d="M16 19V6l3 3v10z" />
      </>
    ),
  },
  masmorra: {
    label: 'Masmorra',
    color: '#8e6bb5',
    glyph: <path d="M12 5c4 0 7 3 7 7v7h-4v-6a3 3 0 00-6 0v6H5v-7c0-4 3-7 7-7z" />,
  },
  templo: {
    label: 'Templo',
    color: '#d9a0c0',
    glyph: (
      <>
        <path d="M12 4l8 5H4z" />
        <path d="M6 11h2v6H6zM11 11h2v6h-2zM16 11h2v6h-2z" />
        <path d="M4 18h16v2H4z" />
      </>
    ),
  },
  marco: {
    label: 'Marco',
    color: '#e0785c',
    glyph: <path d="M12 4l7 8-7 8-7-8z" />,
  },
}

export const POI_TYPE_LIST = Object.keys(POI_TYPES) as PoiType[]
