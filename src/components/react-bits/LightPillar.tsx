// LightPillar's React Bits shader is retained in lightPillarShaders.ts.
// WODS adapts resolution, scheduling, visibility and resource ownership.
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { lightPillarShaders } from './lightPillarShaders'
import type { LightPillarSettings } from '../../themes/productThemes'

export default function LightPillar(props: LightPillarSettings) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { topColor, bottomColor, intensity, rotationSpeed, glowAmount, pillarWidth,
    pillarHeight, noiseIntensity, pillarRotation, lightMode, quality, interactive } = props

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const compact = window.matchMedia('(max-width: 700px), (pointer: coarse)')
    const device = navigator as Navigator & { deviceMemory?: number }
    const weak = (device.deviceMemory != null && device.deviceMemory <= 2)
      || (device.hardwareConcurrency > 0 && device.hardwareConcurrency <= 2)
    const highQuality = quality === 'high'
    const precision = highQuality ? 'highp' : 'mediump'
    const powerPreference = highQuality ? 'high-performance' : 'low-power'
    const shaderSettings: Parameters<typeof lightPillarShaders>[0] = highQuality
      ? { iterations: 80, waveIterations: 4, stepMultiplier: 1.0, precision }
      : { iterations: 40, waveIterations: 2, stepMultiplier: 1.2, precision }
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('webgl2', { antialias: false, alpha: false,
      powerPreference, stencil: false, depth: false })
    if (!context) {
      container.dataset.mode = 'fallback'
      return
    }
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, context, antialias: false, alpha: false,
        powerPreference, precision, stencil: false, depth: false })
    } catch {
      context.getExtension('WEBGL_lose_context')?.loseContext()
      container.dataset.mode = 'fallback'
      return
    }

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const geometry = new THREE.PlaneGeometry(2, 2)
    const shaders = lightPillarShaders(shaderSettings)
    const color = (hex: string) => {
      const c = new THREE.Color(hex)
      return new THREE.Vector3(c.r, c.g, c.b)
    }
    const angle = pillarRotation * Math.PI / 180
    const material = new THREE.ShaderMaterial({ ...shaders, depthWrite: false, depthTest: false,
      uniforms: {
        uTime: { value: 0 }, uResolution: { value: new THREE.Vector2() }, uMouse: { value: new THREE.Vector2() },
        uTopColor: { value: color(topColor) }, uBottomColor: { value: color(bottomColor) },
        uIntensity: { value: intensity }, uInteractive: { value: interactive },
        uGlowAmount: { value: glowAmount }, uPillarWidth: { value: pillarWidth },
        uPillarHeight: { value: pillarHeight }, uNoiseIntensity: { value: noiseIntensity },
        uLightMode: { value: lightMode ? 1 : 0 }, uRotCos: { value: 1 }, uRotSin: { value: 0 },
        uPillarRotCos: { value: Math.cos(angle) }, uPillarRotSin: { value: Math.sin(angle) },
        uWaveSin: { value: Math.sin(0.4) }, uWaveCos: { value: Math.cos(0.4) },
      },
    })
    scene.add(new THREE.Mesh(geometry, material))
    renderer.domElement.className = 'light-pillar-canvas'
    container.appendChild(renderer.domElement)
    container.dataset.quality = quality
    container.dataset.precision = precision
    container.dataset.iterations = String(shaderSettings.iterations)
    container.dataset.waveIterations = String(shaderSettings.waveIterations)
    container.dataset.interactive = String(interactive)
    let frame = 0
    let resizeTimer = 0
    let lastTick = 0
    let lastRender = 0
    let time = 0
    let renders = 0
    let lost = false
    let disposed = false
    let windowStartedAt = 0
    let windowRenders = 0
    let submissionMs = 0
    let slowWindows = 0
    let resolutionScale = 1
    const frameDuration = 1_000 / (highQuality ? 60 : 30)
    container.dataset.targetFps = highQuality ? '60' : '30'
    const isStatic = () => motion.matches || compact.matches || weak

    const size = () => {
      const w = Math.max(1, container.clientWidth)
      const h = Math.max(1, container.clientHeight)
      const pixelBudget = isStatic() ? 180_000 : 380_000
      // High is an explicit quality choice: native density up to 2x, without
      // the medium profile's pixel budget or automatic resolution downgrade.
      const ratio = highQuality
        ? Math.min(window.devicePixelRatio || 1, 2)
        : Math.min(0.5, Math.sqrt(pixelBudget / (w * h))) * resolutionScale
      renderer.setPixelRatio(ratio)
      renderer.setSize(w, h)
      material.uniforms.uResolution.value.set(w, h)
      container.dataset.renderScale = ratio.toFixed(3)
      container.dataset.buffer = `${canvas.width}x${canvas.height}`
    }
    const draw = () => {
      if (lost || disposed) return
      material.uniforms.uTime.value = time
      material.uniforms.uRotCos.value = Math.cos(time * 0.3)
      material.uniforms.uRotSin.value = Math.sin(time * 0.3)
      const start = performance.now()
      renderer.render(scene, camera)
      submissionMs += performance.now() - start
      renders++
      windowRenders++
      container.dataset.frames = String(renders)
    }
    const animate = (now: number) => {
      frame = 0
      if (document.hidden || isStatic() || lost || disposed) return
      const dt = Math.min((now - lastTick) / 1_000, 0.1)
      lastTick = now
      time += dt * rotationSpeed
      if (now - lastRender >= frameDuration - 0.5) {
        draw()
        lastRender += Math.max(1, Math.floor((now - lastRender + 0.5) / frameDuration)) * frameDuration
      }
      // Submission time is CPU-side, not a claim about GPU utilization.
      if (now - windowStartedAt >= 2_000) {
        const fps = windowRenders * 1_000 / (now - windowStartedAt)
        container.dataset.fps = fps.toFixed(1)
        container.dataset.submissionMs = (submissionMs / Math.max(1, windowRenders)).toFixed(2)
        slowWindows = fps < 22 ? slowWindows + 1 : 0
        if (!highQuality && slowWindows >= 2 && resolutionScale > 0.6) {
          resolutionScale *= 0.8
          slowWindows = 0
          size()
        }
        windowStartedAt = now
        windowRenders = 0
        submissionMs = 0
      }
      frame = window.requestAnimationFrame(animate)
    }
    const stop = () => {
      window.cancelAnimationFrame(frame)
      frame = 0
    }
    const sync = () => {
      stop()
      if (lost || disposed) return
      const still = isStatic()
      container.dataset.mode = document.hidden ? 'paused' : still ? 'static' : 'animated'
      size()
      if (document.hidden) return
      draw()
      if (still) return
      lastTick = lastRender = windowStartedAt = performance.now()
      windowRenders = 0
      submissionMs = 0
      frame = window.requestAnimationFrame(animate)
    }
    const resize = () => {
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(sync, 120)
    }
    const contextLost = (event: Event) => {
      event.preventDefault()
      lost = true
      stop()
      container.dataset.mode = 'fallback'
    }
    const contextRestored = () => { lost = false; sync() }
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('resize', resize, { passive: true })
    motion.addEventListener('change', sync)
    compact.addEventListener('change', sync)
    renderer.domElement.addEventListener('webglcontextlost', contextLost)
    renderer.domElement.addEventListener('webglcontextrestored', contextRestored)
    sync()

    return () => {
      disposed = true
      stop()
      window.clearTimeout(resizeTimer)
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('resize', resize)
      motion.removeEventListener('change', sync)
      compact.removeEventListener('change', sync)
      renderer.domElement.removeEventListener('webglcontextlost', contextLost)
      renderer.domElement.removeEventListener('webglcontextrestored', contextRestored)
      scene.clear()
      material.dispose()
      geometry.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }, [topColor, bottomColor, intensity, rotationSpeed, glowAmount, pillarWidth, pillarHeight,
    noiseIntensity, pillarRotation, lightMode, quality, interactive])

  return <div className="light-pillar-container" ref={containerRef} />
}
