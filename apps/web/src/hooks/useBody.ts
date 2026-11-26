import { useEffect, useState } from 'react'
import type { BodyDocument, LayerKind } from '@valenzia/shared'
import { api, ApiError } from '../lib/api'
import { createMapBase, syncPhases, type MapBase } from '../lib/layers'
import { decodeLayer } from '../lib/store'

export interface LoadedBody {
  doc: BodyDocument
  base: MapBase
  territory: Uint16Array
  biome: Uint16Array
}

export type BodyState =
  | { status: 'loading'; step: string }
  | { status: 'error'; message: string; notFound: boolean }
  | { status: 'ready'; body: LoadedBody }

/**
 * Carrega um corpo inteiro do servidor: a ficha e as tres camadas, ja
 * decodificadas em arrays. Um corpo recem-criado so tem terreno; territorio
 * e bioma nascem vazios.
 */
export function useBody(bodyId: string, reloadKey = 0): BodyState {
  const [state, setState] = useState<BodyState>({ status: 'loading', step: 'Abrindo o mapa...' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading', step: 'Abrindo o mapa...' })

    async function layer(kind: LayerKind, width: number, height: number) {
      try {
        const blob = await api.getLayer(bodyId, kind)
        return await decodeLayer(blob, width, height)
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      }
    }

    async function load() {
      const doc = await api.getBody(bodyId)
      if (cancelled) return
      setState({ status: 'loading', step: 'Lendo as camadas...' })
      const [terrain, territory, biome] = await Promise.all([
        layer('terrain', doc.width, doc.height),
        layer('territory', doc.width, doc.height),
        layer('biome', doc.width, doc.height),
      ])
      if (cancelled) return
      const base = createMapBase(doc.width, doc.height)
      if (terrain) base.terrain.set(terrain)
      syncPhases(base, doc.materials)
      setState({
        status: 'ready',
        body: {
          doc,
          base,
          territory: territory ?? new Uint16Array(doc.width * doc.height),
          biome: biome ?? new Uint16Array(doc.width * doc.height),
        },
      })
    }

    load().catch((err: unknown) => {
      if (cancelled) return
      setState({
        status: 'error',
        message: (err as Error).message,
        notFound: err instanceof ApiError && err.status === 404,
      })
    })
    return () => {
      cancelled = true
    }
  }, [bodyId, reloadKey])

  return state
}
