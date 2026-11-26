import type {
  BodyDocument,
  BodyTreeNode,
  CreateBlankInput,
  LayerKind,
  PatchBodyInput,
  SaveDocumentInput,
} from '@valenzia/shared'

/**
 * Cliente da API. Em dev o Vite faz proxy de /api para o servidor Node; no
 * container, quem faz e o nginx -- o front nunca precisa saber o endereco.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch('/api' + path, { cache: 'no-store', ...init })
  } catch {
    throw new ApiError(0, 'Sem conexao com o servidor. Ele esta rodando?')
  }
  if (!res.ok) {
    let message = res.statusText || 'Erro ' + res.status
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // corpo sem JSON: fica o texto do status
    }
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  listBodies: () => request<BodyTreeNode[]>('/bodies'),

  getBody: (id: string) => request<BodyDocument>('/bodies/' + id),

  async getLayer(id: string, kind: LayerKind): Promise<Blob> {
    const res = await fetch('/api/bodies/' + id + '/layers/' + kind, { cache: 'no-store' })
    if (!res.ok) throw new ApiError(res.status, 'Nao consegui baixar a camada ' + kind)
    return res.blob()
  },

  thumbnailUrl: (id: string, version: number | string) =>
    '/api/bodies/' + id + '/thumbnail?v=' + version,

  createBlank: (input: CreateBlankInput) => request<BodyDocument>('/bodies', json('POST', input)),

  previewImage(image: File) {
    const form = new FormData()
    form.append('image', image)
    return request<{
      width: number
      height: number
      landColor: string
      waterColor: string
      landRatio: number
      resized: boolean
      preview: string
    }>('/terrain/preview', { method: 'POST', body: form })
  },

  createFromImage(
    image: File,
    fields: {
      name: string
      description?: string
      radiusKm: number
      parentId?: string | null
      landColor?: string
      waterColor?: string
    },
  ) {
    const form = new FormData()
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null && value !== '') form.append(key, String(value))
    }
    form.append('image', image)
    return request<BodyDocument>('/bodies/from-image', { method: 'POST', body: form })
  },

  patchBody: (id: string, patch: PatchBodyInput) =>
    request<BodyDocument>('/bodies/' + id, json('PATCH', patch)),

  deleteBody: (id: string) => request<void>('/bodies/' + id, { method: 'DELETE' }),

  saveDocument(
    id: string,
    document: SaveDocumentInput,
    files: { terrain: Blob; territory: Blob; biome: Blob; thumbnail?: Blob | null },
  ) {
    const form = new FormData()
    // O JSON vai primeiro: o servidor le os campos na ordem em que chegam.
    form.append('document', JSON.stringify(document))
    form.append('terrain', files.terrain, 'terrain.png')
    form.append('territory', files.territory, 'territory.png')
    form.append('biome', files.biome, 'biome.png')
    if (files.thumbnail) form.append('thumbnail', files.thumbnail, 'thumbnail.png')
    return request<BodyDocument>('/bodies/' + id + '/document', { method: 'PUT', body: form })
  },
}
