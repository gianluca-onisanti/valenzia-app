import {
  EARTH_RADIUS_KM,
  earthRatio,
  formatKm,
  formatKm2,
  sphereAreaKm2,
  type BodyTreeNode,
} from '@valenzia/shared'

export interface BodyFieldValues {
  name: string
  description: string
  radiusKm: number
  parentId: string | null
}

/**
 * Os campos de um corpo celeste, iguais na criacao e na edicao: nome,
 * descricao, tamanho e o planeta que ele orbita. Escolher um planeta para
 * orbitar e o que faz do corpo uma lua.
 */
export function BodyFields({
  value,
  onChange,
  planets,
  selfId,
  hasMoons,
}: {
  value: BodyFieldValues
  onChange: (next: BodyFieldValues) => void
  /** Os candidatos a pai: so planetas (lua nao tem lua). */
  planets: BodyTreeNode[]
  /** O proprio corpo, que nao pode orbitar a si mesmo. */
  selfId?: string
  /** Um planeta com luas nao pode virar lua. */
  hasMoons?: boolean
}) {
  const set = (patch: Partial<BodyFieldValues>) => onChange({ ...value, ...patch })
  const candidates = planets.filter((p) => p.id !== selfId)
  const ratio = earthRatio(value.radiusKm || 0)

  return (
    <div className="form-grid">
      <label className="form-field">
        <span>Nome</span>
        <input
          value={value.name}
          maxLength={120}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Valenzia"
          required
        />
      </label>

      <label className="form-field">
        <span>Raio (km)</span>
        <input
          type="number"
          min={1}
          step={1}
          value={value.radiusKm || ''}
          onChange={(e) => set({ radiusKm: Number(e.target.value) })}
          required
        />
        <small className="muted">
          {value.radiusKm > 0
            ? 'Diametro ' + formatKm(value.radiusKm * 2) + ' · superficie ' +
              formatKm2(sphereAreaKm2(value.radiusKm)) + ' · ' +
              ratio.toFixed(2).replace('.', ',') + 'x a Terra'
            : 'A Terra tem ' + formatKm(EARTH_RADIUS_KM)}
        </small>
        <div className="chips">
          {[
            { label: 'Lua (1.737)', km: 1737 },
            { label: 'Marte (3.390)', km: 3390 },
            { label: 'Terra (6.371)', km: EARTH_RADIUS_KM },
            { label: 'Jupiter (69.911)', km: 69911 },
          ].map((p) => (
            <button key={p.km} type="button" className="chip" onClick={() => set({ radiusKm: p.km })}>
              {p.label}
            </button>
          ))}
        </div>
      </label>

      <label className="form-field">
        <span>Orbita</span>
        <select
          value={value.parentId ?? ''}
          disabled={hasMoons}
          onChange={(e) => set({ parentId: e.target.value || null })}
        >
          <option value="">Nada: e um planeta</option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} (vira lua dele)
            </option>
          ))}
        </select>
        {hasMoons && (
          <small className="muted">
            Este planeta tem luas. Para que ele orbite outro, desvincule as luas
            primeiro.
          </small>
        )}
      </label>

      <label className="form-field form-field--wide">
        <span>Descricao</span>
        <textarea
          rows={3}
          value={value.description}
          onChange={(e) => set({ description: e.target.value })}
          placeholder="Clima, historia, quem vive la..."
        />
      </label>
    </div>
  )
}
