import { UndertoneBackdrop } from './UndertoneBackdrop'

type WallpaperTheme = 'dark' | 'light'

type Wallpaper = {
  id?: string
  imageUrl: string
  alt: string
  photographer: string
  photographerUrl: string
  sourceName: string
  sourceUrl: string
  objectPosition?: string
}

const forestWallpaper: Wallpaper = {
  id: 'evgeni-evgeniev-LPKk3wtkC-g',
  imageUrl: '/wallpapers/evgeni-evgeniev-LPKk3wtkC-g-unsplash.jpg',
  alt: 'Dark green forest canopy',
  photographer: 'Evgeni Evgeniev',
  photographerUrl: 'https://unsplash.com/photos/LPKk3wtkC-g',
  sourceName: 'Unsplash',
  sourceUrl: 'https://unsplash.com',
  objectPosition: 'center 34%',
}

const mountainWallpaper: Wallpaper = {
  id: 'willian-justen-0HGKG23yMew',
  imageUrl: '/wallpapers/willian-justen-0HGKG23yMew-unsplash.jpg',
  alt: 'Misty grey mountain peaks in Tre Cime di Lavaredo',
  photographer: 'Willian Justen de Vasconcellos',
  photographerUrl: 'https://unsplash.com/@willianjusten',
  sourceName: 'Unsplash',
  sourceUrl: 'https://unsplash.com/photos/0HGKG23yMew',
  objectPosition: 'center 46%',
}

export function ThemeBackdrop({
  active,
  theme,
  variant = 'home',
}: {
  active: boolean
  theme: WallpaperTheme
  variant?: 'home' | 'page'
}) {
  const wallpaper = theme === 'light' ? mountainWallpaper : forestWallpaper
  const activeTheme = theme

  if (!active) return null

  return (
    <div className={`theme-backdrop theme-backdrop-${activeTheme} theme-backdrop-${variant}`}>
      {theme === 'dark' ? (
        <UndertoneBackdrop className="theme-backdrop-undertone" />
      ) : (
        <img
          key={`${activeTheme}-${wallpaper.id || wallpaper.imageUrl}`}
          className="theme-backdrop-image"
          src={wallpaper.imageUrl}
          alt=""
          decoding="async"
          style={{ objectPosition: wallpaper.objectPosition }}
        />
      )}
      <div className="theme-backdrop-shade" />
      <div className="theme-backdrop-vignette" />
      {theme === 'light' && (
        <div className="theme-backdrop-credit">
          <span>Photo:</span>
          <a href={wallpaper.photographerUrl} target="_blank" rel="noreferrer" data-no-translate>{wallpaper.photographer}</a>
          <span>/</span>
          <a href={wallpaper.sourceUrl} target="_blank" rel="noreferrer" data-no-translate>{wallpaper.sourceName}</a>
        </div>
      )}
    </div>
  )
}
