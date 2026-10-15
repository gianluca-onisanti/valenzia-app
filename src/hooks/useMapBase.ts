import { useEffect, useState } from 'react'
import type { MapBase } from '../lib/layers'

export type BaseState =
  | { status: 'loading'; step: string }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; base: MapBase }

const BASE = import.meta.env.BASE_URL

interface Geo {
  width: number
  height: number
  land: string
  water: string
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Nao consegui carregar ' + src))
    img.src = src
  })
}

export function useMapBase(): BaseState {
  const [state, setState] = useState<BaseState>({
    status: 'loading',
    step: 'Procurando o mapa...',
  })

  useEffect(() => {
    let cancelled = false

    async function load() {
      let geo: Geo
      try {
        const res = await fetch(BASE + 'data/geo.json', { cache: 'no-store' })
        if (!res.ok) throw new Error('404')
        geo = (await res.json()) as Geo
      } catch {
        if (!cancelled) setState({ status: 'missing' })
        return
      }

      try {
        if (!cancelled) {
          setState({ status: 'loading', step: 'Lendo terra e mar...' })
        }
        const [maskImg, coast] = await Promise.all([
          loadImage(BASE + 'mask.png'),
          loadImage(BASE + 'coast.png'),
        ])
        if (cancelled) return

        const canvas = document.createElement('canvas')
        canvas.width = geo.width
        canvas.height = geo.height
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas 2D indisponivel neste navegador.')
        ctx.drawImage(maskImg, 0, 0)
        const { data } = ctx.getImageData(0, 0, geo.width, geo.height)
        // Uint16 para a costa poder ser pintada com as mesmas ferramentas.
        const land = new Uint16Array(geo.width * geo.height)
        for (let i = 0; i < land.length; i++) {
          land[i] = data[i * 4] > 127 ? 1 : 0
        }

        if (!cancelled) {
          setState({
            status: 'ready',
            base: {
              width: geo.width,
              height: geo.height,
              land,
              landColor: geo.land,
              waterColor: geo.water,
              coast,
            },
          })
        }
      } catch (err) {
        if (!cancelled) {
          setState({ status: 'error', message: (err as Error).message })
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
