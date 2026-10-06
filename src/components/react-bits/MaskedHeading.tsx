// User-supplied React Bits component, with fixed-size and existing-canvas fills.
'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef } from 'react'
import type { CSSProperties, ElementType, HTMLAttributes } from 'react'
import { gsap } from 'gsap'
import './MaskedHeading.css'

type MaskedHeadingProps = Omit<HTMLAttributes<HTMLElement>, 'children'> & {
  text?: string
  tag?: ElementType
  mediaType?: 'image' | 'video' | 'canvas'
  src?: string
  poster?: string
  fillScale?: number
  parallax?: number
  drift?: number
  brightness?: number
  saturation?: number
  grayscale?: boolean
  reveal?: 'rise' | 'wipe' | 'fade' | 'none'
  trigger?: 'view' | 'mount' | 'hover'
  duration?: number
  stagger?: number
  align?: 'left' | 'center' | 'right'
  weight?: number
  tracking?: number
  lineHeight?: number
  textScale?: number
  /** Omit to retain the original responsive 20–200px heading sizing. */
  fontSize?: number | 'inherit'
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export default function MaskedHeading({
  text = 'Designed in the details', tag: Tag = 'h2', mediaType = 'image', src = '', poster = '',
  fillScale = 1.25, parallax = 26, drift = 18, brightness = 1, saturation = 1,
  grayscale = false, reveal = 'rise', duration = 1.1, stagger = 0.09, trigger = 'view',
  align = 'center', weight = 700, tracking = -0.03, lineHeight = 1.06, textScale = 0.115,
  fontSize, className = '', style, ...rest
}: MaskedHeadingProps) {
  const rootRef = useRef<HTMLElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const revealRef = useRef<HTMLSpanElement>(null)
  const mediaRef = useRef<HTMLSpanElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([])
  const baseRefs = useRef<(HTMLElement | null)[]>([])
  const glyphRefs = useRef<(SVGTextElement | null)[]>([])
  const tweenRef = useRef<gsap.core.Tween | null>(null)
  const offsetRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 })
  const clipId = `mh-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const words = useMemo(() => String(text).split(/\s+/).filter(Boolean), [text])
  const settingsRef = useRef({ fillScale, parallax, drift, brightness, saturation, grayscale, textScale, fontSize })

  const place = useCallback(() => {
    const root = rootRef.current, media = mediaRef.current
    if (!root || !media) return
    const settings = settingsRef.current, offset = offsetRef.current
    const maxX = Math.max(0, ((settings.fillScale - 1) / 2) * root.clientWidth)
    const maxY = Math.max(0, ((settings.fillScale - 1) / 2) * root.clientHeight)
    media.style.transform = `translate3d(${clamp(offset.x, -maxX, maxX).toFixed(2)}px, ${clamp(offset.y, -maxY, maxY).toFixed(2)}px, 0) scale(${settings.fillScale})`
    media.style.filter = `brightness(${settings.brightness}) saturate(${settings.saturation})${settings.grayscale ? ' grayscale(1)' : ''}`
  }, [])

  const sync = useCallback(() => {
    const root = rootRef.current, measure = measureRef.current
    if (!root || !measure) return
    const settings = settingsRef.current
    root.style.fontSize = settings.fontSize === 'inherit' ? 'inherit'
      : `${settings.fontSize ?? clamp(root.clientWidth * settings.textScale, 20, 200)}px`
    const computed = window.getComputedStyle(measure)
    for (let i = 0; i < words.length; i++) {
      const box = wordRefs.current[i], base = baseRefs.current[i], glyph = glyphRefs.current[i]
      if (!box || !base || !glyph) continue
      glyph.setAttribute('x', `${box.offsetLeft}`)
      glyph.setAttribute('y', `${base.offsetTop}`)
      for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing'] as const) {
        glyph.style[property] = computed[property]
      }
    }
    place()
  }, [place, words])

  useLayoutEffect(() => {
    settingsRef.current = { fillScale, parallax, drift, brightness, saturation, grayscale, textScale, fontSize }
    sync()
  }, [fillScale, parallax, drift, brightness, saturation, grayscale, textScale, fontSize,
    sync, Tag, align, weight, tracking, lineHeight])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new ResizeObserver(sync)
    observer.observe(root)
    let disposed = false
    void document.fonts?.ready.then(() => { if (!disposed) sync() }).catch(() => {})
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frameId = 0, last = performance.now(), clock = 0
    let source: HTMLCanvasElement | null = null
    let stream: MediaStream | null = null

    const stopStream = () => {
      stream?.getTracks().forEach(track => track.stop())
      stream = null
      if (mediaType === 'canvas' && videoRef.current) videoRef.current.srcObject = null
      if (mediaType === 'canvas') delete root.dataset.mediaReady
    }

    // Reuse the existing hero renderer; this creates no asset or second WebGL effect.
    // A live stream captures WebGL before its non-preserved drawing buffer clears.
    const connectCanvas = () => {
      if (mediaType !== 'canvas' || motion.matches || !src) return
      if (!source?.isConnected) {
        stopStream()
        source = document.querySelector<HTMLCanvasElement>(src)
      }
      if (!source?.width || !source.height || source.parentElement?.dataset.mode === 'fallback') {
        stopStream()
        return
      }
      if (stream || !videoRef.current || typeof source.captureStream !== 'function') return
      try {
        stream = source.captureStream(12)
        videoRef.current.srcObject = stream
        void videoRef.current.play().catch(() => { stopStream() })
      } catch {
        stopStream()
      }
    }

    const frame = (now: number) => {
      frameId = 0
      if (disposed || document.hidden) return
      connectCanvas()
      if (motion.matches) {
        offsetRef.current = { x: 0, y: 0, tx: 0, ty: 0 }
        place()
        return
      }
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      clock += dt
      const settings = settingsRef.current, offset = offsetRef.current
      const ease = 1 - Math.exp(-dt / 0.18)
      offset.x += (offset.tx + Math.sin(clock * 0.21) * settings.drift - offset.x) * ease
      offset.y += (offset.ty + Math.cos(clock * 0.17) * settings.drift * 0.6 - offset.y) * ease
      place()
      frameId = requestAnimationFrame(frame)
    }
    const restart = () => {
      cancelAnimationFrame(frameId)
      last = performance.now()
      if (motion.matches || document.hidden) {
        videoRef.current?.pause()
        stopStream()
      }
      else void videoRef.current?.play().catch(() => {})
      if (!document.hidden) frameId = requestAnimationFrame(frame)
    }
    const onMove = (event: PointerEvent) => {
      if (motion.matches || settingsRef.current.parallax <= 0) return
      const rect = root.getBoundingClientRect()
      offsetRef.current.tx = clamp(((event.clientX - rect.left) / (rect.width || 1)) * 2 - 1, -1, 1) * -settingsRef.current.parallax
      offsetRef.current.ty = clamp(((event.clientY - rect.top) / (rect.height || 1)) * 2 - 1, -1, 1) * -settingsRef.current.parallax
    }
    const onLeave = () => { offsetRef.current.tx = 0; offsetRef.current.ty = 0 }
    root.addEventListener('pointermove', onMove)
    root.addEventListener('pointerleave', onLeave)
    motion.addEventListener('change', restart)
    document.addEventListener('visibilitychange', restart)
    restart()
    return () => {
      disposed = true
      cancelAnimationFrame(frameId)
      stopStream()
      observer.disconnect()
      root.removeEventListener('pointermove', onMove)
      root.removeEventListener('pointerleave', onLeave)
      motion.removeEventListener('change', restart)
      document.removeEventListener('visibilitychange', restart)
    }
  }, [place, sync, mediaType, src])

  useEffect(() => {
    const root = rootRef.current, layer = revealRef.current
    if (!root || !layer) return
    const glyphs = glyphRefs.current.filter(Boolean)
    if (!glyphs.length) return
    const riseDistance = () => (parseFloat(window.getComputedStyle(root).fontSize) || 48) * 1.15
    const settle = () => {
      gsap.set(glyphs, { y: 0 })
      gsap.set(layer, { opacity: 1, scale: 1, clipPath: 'inset(0% 0% 0% 0%)' })
    }
    if (reveal === 'none' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      settle()
      return
    }
    const play = () => {
      tweenRef.current?.kill()
      if (reveal === 'rise') {
        gsap.set(layer, { opacity: 1, scale: 1, clipPath: 'inset(0% 0% 0% 0%)' })
        tweenRef.current = gsap.fromTo(glyphs, { y: riseDistance() },
          { y: 0, duration, stagger, ease: 'power4.out', overwrite: 'auto' })
      } else if (reveal === 'wipe') {
        gsap.set(glyphs, { y: 0 })
        const state = { p: 100 }
        tweenRef.current = gsap.to(state, { p: 0, duration, ease: 'power3.inOut', overwrite: 'auto',
          onUpdate: () => { layer.style.clipPath = `inset(0% ${state.p}% 0% 0%)` } })
      } else {
        gsap.set(glyphs, { y: 0 })
        tweenRef.current = gsap.fromTo(layer, { opacity: 0, scale: 1.08 },
          { opacity: 1, scale: 1, duration, ease: 'power3.out', overwrite: 'auto' })
      }
    }
    if (trigger === 'hover') {
      settle()
      root.addEventListener('pointerenter', play)
      return () => { root.removeEventListener('pointerenter', play); tweenRef.current?.kill() }
    }
    if (trigger === 'view') {
      settle()
      if (reveal === 'rise') gsap.set(glyphs, { y: riseDistance() })
      else if (reveal === 'wipe') gsap.set(layer, { clipPath: 'inset(0% 100% 0% 0%)' })
      else gsap.set(layer, { opacity: 0, scale: 1.08 })
      const observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { play(); observer.disconnect() }
      }, { threshold: 0.25 })
      observer.observe(root)
      return () => { observer.disconnect(); tweenRef.current?.kill() }
    }
    play()
    return () => { tweenRef.current?.kill() }
  }, [reveal, trigger, duration, stagger, words])

  const mediaReady = () => { if (rootRef.current) rootRef.current.dataset.mediaReady = 'true' }

  return (
    <Tag ref={rootRef} className={`masked-heading ${className}`.trim()}
      style={{ textAlign: align, fontWeight: weight, letterSpacing: `${tracking}em`, lineHeight,
        ...style } as CSSProperties} {...rest}>
      <span ref={measureRef} className="masked-heading__measure">
        {words.map((word, i) => <span key={`${word}-${i}`} className="masked-heading__word"
          ref={element => { wordRefs.current[i] = element }}>
          {word}<i className="masked-heading__baseline" ref={element => { baseRefs.current[i] = element }} />
        </span>)}
      </span>
      <svg className="masked-heading__defs" aria-hidden="true" focusable="false">
        <defs><clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          {words.map((word, i) => <text key={`${word}-${i}`} ref={element => { glyphRefs.current[i] = element }}>{word}</text>)}
        </clipPath></defs>
      </svg>
      <span ref={revealRef} className="masked-heading__reveal" aria-hidden="true">
        <span className="masked-heading__clip" style={{ clipPath: `url(#${clipId})` }}>
          <span ref={mediaRef} className="masked-heading__media">
            {mediaType === 'canvas' ? <video ref={videoRef} className="masked-heading__source"
                autoPlay muted playsInline onLoadedData={mediaReady} />
              : mediaType === 'video' ? <video ref={videoRef} className="masked-heading__source" src={src}
                poster={poster} autoPlay muted loop playsInline onLoadedData={mediaReady} />
                : <img className="masked-heading__source" src={src} alt="" draggable={false} onLoad={mediaReady} />}
          </span>
        </span>
      </span>
    </Tag>
  )
}
