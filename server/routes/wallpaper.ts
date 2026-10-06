import { Router } from 'express'

export const wallpaperRouter = Router()

type WallpaperTheme = 'dark' | 'light'

const UTM = 'utm_source=easytran_app&utm_medium=referral'

const categoryPools: Record<WallpaperTheme, string[]> = {
  dark: [
    'soft dusk mountain lake high resolution wallpaper',
    'calm forest evening cinematic landscape wallpaper',
    'blue hour lake landscape wide wallpaper',
    'coastal landscape sunset high resolution wallpaper',
    'misty mountains golden hour wallpaper',
    'calm ocean sunset landscape wallpaper',
    'alpine lake evening cinematic wallpaper',
    'quiet pine forest evening wallpaper',
    'minimal mountain silhouette dusk wallpaper',
    'polished nature evening landscape wallpaper',
  ],
  light: [
    'polished calm landscape high resolution wallpaper',
    'alpine lake cloudy cinematic wallpaper',
    'coastal cliff overcast landscape wallpaper',
    'misty forest mountains wide wallpaper',
    'soft mountain valley nature wallpaper',
    'minimal lake reflection landscape wallpaper',
    'forest river cinematic landscape wallpaper',
    'ocean coastline cloudy high resolution wallpaper',
    'green hills soft light landscape wallpaper',
    'quiet nature morning landscape wallpaper',
  ],
}

function getTheme(value: unknown): WallpaperTheme {
  return value === 'light' ? 'light' : 'dark'
}

function pickQuery(theme: WallpaperTheme) {
  const pool = categoryPools[theme]
  return pool[Math.floor(Math.random() * pool.length)] ?? pool[0]
}

function withUtm(url: string) {
  return url.includes('?') ? `${url}&${UTM}` : `${url}?${UTM}`
}

function rawImageUrl(raw: string) {
  const join = raw.includes('?') ? '&' : '?'
  return `${raw}${join}auto=format&fit=crop&w=2880&q=90`
}

wallpaperRouter.get('/', async (request, response) => {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY
  const theme = getTheme(request.query.theme)
  const query = pickQuery(theme)
  const requestedId = String(request.query.id || '').trim()

  if (!accessKey) {
    response.status(503).json({ error: 'unsplash_not_configured' })
    return
  }

  try {
    if (requestedId) {
      const upstream = await fetch(`https://api.unsplash.com/photos/${encodeURIComponent(requestedId)}`, {
        headers: {
          Authorization: `Client-ID ${accessKey}`,
          'Accept-Version': 'v1',
        },
        signal: AbortSignal.timeout(8000),
      })
      if (!upstream.ok) {
        response.status(502).json({ error: 'unsplash_unavailable' })
        return
      }
      const photo = await upstream.json() as {
        id?: string
        alt_description?: string | null
        description?: string | null
        urls?: { raw?: string; regular?: string }
        links?: { html?: string; download_location?: string }
        user?: { name?: string; links?: { html?: string } }
      }
      const imageUrl = photo.urls?.raw ? rawImageUrl(photo.urls.raw) : photo.urls?.regular
      if (!imageUrl) {
        response.status(502).json({ error: 'unsplash_missing_image' })
        return
      }
      if (photo.links?.download_location) {
        fetch(photo.links.download_location, {
          headers: { Authorization: `Client-ID ${accessKey}`, 'Accept-Version': 'v1' },
          signal: AbortSignal.timeout(4000),
        }).catch(() => undefined)
      }
      response.setHeader('Cache-Control', 'public, max-age=3600')
      response.json({
        id: photo.id,
        theme,
        query: requestedId,
        imageUrl,
        alt: photo.alt_description || photo.description || 'Unsplash landscape',
        photographer: photo.user?.name || 'Unsplash creator',
        photographerUrl: photo.user?.links?.html ? withUtm(photo.user.links.html) : withUtm('https://unsplash.com'),
        photoUrl: photo.links?.html ? withUtm(photo.links.html) : withUtm('https://unsplash.com'),
        sourceName: 'Unsplash',
        sourceUrl: withUtm('https://unsplash.com'),
      })
      return
    }

    const url = new URL('https://api.unsplash.com/search/photos')
    url.searchParams.set('query', query)
    url.searchParams.set('orientation', 'landscape')
    url.searchParams.set('content_filter', 'high')
    url.searchParams.set('order_by', 'relevant')
    url.searchParams.set('per_page', '30')

    const upstream = await fetch(url, {
      headers: {
        Authorization: `Client-ID ${accessKey}`,
        'Accept-Version': 'v1',
      },
      signal: AbortSignal.timeout(8000),
    })

    if (!upstream.ok) {
      response.status(502).json({ error: 'unsplash_unavailable' })
      return
    }

    const payload = await upstream.json() as {
      results?: Array<{
        id?: string
        alt_description?: string | null
        description?: string | null
        width?: number
        height?: number
        urls?: { raw?: string; regular?: string }
        links?: { html?: string; download_location?: string }
        user?: {
          name?: string
          links?: { html?: string }
        }
      }>
    }

    const candidates = (payload.results || [])
      .filter((item) => item.urls?.raw || item.urls?.regular)
      .filter((item) => (item.width || 0) >= 2400 && (item.height || 0) >= 1200)
      .filter((item) => {
        const width = item.width || 0
        const height = item.height || 1
        return width / height >= 1.45
      })
      .slice(0, 12)

    const pool = candidates.length ? candidates : (payload.results || []).filter((item) => item.urls?.raw || item.urls?.regular)
    const photo = pool[Math.floor(Math.random() * Math.min(pool.length, 10))]

    if (!photo) {
      response.status(502).json({ error: 'unsplash_missing_image' })
      return
    }

    const imageUrl = photo.urls?.raw ? rawImageUrl(photo.urls.raw) : photo.urls?.regular
    if (!imageUrl) {
      response.status(502).json({ error: 'unsplash_missing_image' })
      return
    }

    if (photo.links?.download_location) {
      fetch(photo.links.download_location, {
        headers: {
          Authorization: `Client-ID ${accessKey}`,
          'Accept-Version': 'v1',
        },
        signal: AbortSignal.timeout(4000),
      }).catch(() => undefined)
    }

    response.setHeader('Cache-Control', 'no-store')
    response.json({
      id: photo.id,
      theme,
      query,
      imageUrl,
      alt: photo.alt_description || photo.description || query,
      photographer: photo.user?.name || 'Unsplash creator',
      photographerUrl: photo.user?.links?.html ? withUtm(photo.user.links.html) : withUtm('https://unsplash.com'),
      photoUrl: photo.links?.html ? withUtm(photo.links.html) : withUtm('https://unsplash.com'),
      sourceName: 'Unsplash',
      sourceUrl: withUtm('https://unsplash.com'),
    })
  } catch {
    response.status(502).json({ error: 'unsplash_unavailable' })
  }
})
