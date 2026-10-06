import { useEffect, useRef } from 'react'
import { courtyardFoliageUrl, courtyardMaskUrl } from './courtyardMask'
import './CourtyardBackdrop.css'

const vertexSource = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_position.x * .5 + .5, .5 - a_position.y * .5);
  gl_Position = vec4(a_position, 0., 1.);
}`

const fragmentSource = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_image;
uniform sampler2D u_masks;
uniform sampler2D u_foliage;
uniform vec2 u_texel;
uniform vec2 u_uvScale;
uniform vec2 u_uvOffset;
uniform float u_time;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(hash(cell), hash(cell + vec2(1., 0.)), f.x),
    mix(hash(cell + vec2(0., 1.)), hash(cell + vec2(1.)), f.x), f.y);
}

vec2 practicalPosition(int i) {
  if (i == 0) return vec2(236., 36.);
  if (i == 1) return vec2(340., 521.);
  if (i == 2) return vec2(542., 537.);
  if (i == 3) return vec2(1305., 584.);
  return vec2(1711., 505.);
}

float foliageChannel(vec3 mask, int i) {
  if (i == 0) return mask.r;
  if (i == 1) return mask.g;
  return mask.b;
}
float leafMatte(vec2 uv, int i) {
  float envelope = foliageChannel(texture2D(u_foliage, uv).rgb, i);
  if (envelope < .003) return 0.;
  vec3 leaf = texture2D(u_image, uv).rgb;
  // Warm gold/green leaves are distinct from the neutral/blue-grey stone.
  // The matte follows actual photo detail rather than warping a rectangle.
  float chroma = (leaf.g - leaf.b) / (max(leaf.r, leaf.g) + .008);
  return envelope * smoothstep(.13, .29, chroma);
}
vec4 vineBounds(int i) {
  if (i == 0) return vec4(250., 64., 364., 250.);
  if (i == 1) return vec4(340., 76., 414., 169.);
  return vec4(1550., 56., 1655., 241.);
}
vec3 animatedVines(vec2 uv, vec3 color) {
  vec2 pixel = uv / u_texel;
  for (int i = 0; i < 3; i++) {
    vec4 bounds = vineBounds(i);
    if (pixel.x < bounds.x || pixel.x > bounds.z || pixel.y < bounds.y || pixel.y > bounds.w) continue;
    float seed = float(i) * 19. + 3.;
    float tip = clamp((pixel.y - bounds.y) / (bounds.w - bounds.y - 9.), 0., 1.);
    tip = pow(tip, 1.45);
    float wind = (noise(vec2(u_time * .71, seed)) * 2. - 1.) * .65
      + (noise(vec2(u_time * .23, seed + 8.)) * 2. - 1.) * .35;
    float flutter = noise(vec2(u_time * 1.4, pixel.y * .075 + seed)) * 2. - 1.;
    float amplitude = i == 1 ? 22. : i == 0 ? 30. : 34.;
    vec2 bend = vec2(wind * amplitude + flutter * 2.2,
      (noise(vec2(u_time * .39, seed + 15.)) * 2. - 1.) * 2.5) * tip;
    vec2 leafUV = uv - bend * u_texel;
    float home = leafMatte(uv, i), moved = leafMatte(leafUV, i);
    if (home > .003) {
      // A fixed neighbouring patch fills only the former leaf footprint.
      // This underlay never animates: the column itself cannot bend or drift.
      float offset = i == 0 ? -30. : i == 1 ? 25. : 34.;
      vec3 underlay = texture2D(u_image, uv + vec2(offset, 0.) * u_texel).rgb;
      color = mix(color, underlay, home);
    }
    if (moved > .003) {
      vec3 leaf = texture2D(u_image, leafUV).rgb;
      color = mix(color, leaf * 1.12, moved);
    }
  }
  return color;
}

void main() {
  // Source-space UVs match picture.object-fit: cover at every viewport size.
  vec2 uv = v_uv * u_uvScale + u_uvOffset;
  vec3 mask = texture2D(u_masks, uv).rgb;
  float coverage = max(mask.r, max(mask.g, mask.b));
  vec2 displaced = uv;
  float surface = 0.;
  float waterDrift = 0.;
  if (mask.r > .003) {
    // Independently advected fields, never a wrapping time or sine-wave cycle.
    float a = noise(uv * vec2(21., 96.) + u_time * vec2(.31, .47)) * 2. - 1.;
    float b = noise(uv * vec2(37., 139.) + vec2(17., 9.) +
      u_time * vec2(-.217, .293)) * 2. - 1.;
    waterDrift = noise(uv * vec2(7., 17.) + u_time * vec2(.009, -.006)) * 2. - 1.;
    vec2 normal = vec2(.75 * a + .5 * b + .1 * waterDrift,
      .12 * a - .2 * b + .04 * waterDrift);
    // Perspective keeps distant water restrained. Foreground reflections bend
    // by a few pixels, enough to see a ripple without moving the stair edge.
    normal = normal / sqrt(normal * normal + vec2(.12, .03));
    float perspective = mix(.4, 1., smoothstep(.72, 1., uv.y));
    displaced += u_texel * normal * vec2(7.5, 2.1) * perspective * mask.r;
    surface = .6 * a + .4 * b;
  }
  // Constant optical softness in the one opaque GPU pass.
  float softness = .45 + smoothstep(.12, .46, abs(uv.x - .5)) * .35;
  vec3 color = texture2D(u_image, displaced).rgb * .72;
  color += texture2D(u_image, displaced + u_texel * softness).rgb * .14;
  color += texture2D(u_image, displaced - u_texel * softness).rgb * .14;
  color = animatedVines(uv, color);
  bool practicalArea = false;
  vec2 sourcePixel = uv / u_texel;
  for (int i = 0; i < 5; i++) {
    vec2 p = sourcePixel - practicalPosition(i);
    if (abs(p.x) < 28. && p.y > -60. && p.y < 10.) practicalArea = true;
  }
  // Unmasked architecture and the center stay constant at every shader time.
  if (coverage < .003 && !practicalArea) { gl_FragColor = vec4(color, 1.); return; }
  if (mask.r > .003) {
    float highlight = smoothstep(.12, .45, dot(color, vec3(.21, .72, .07)));
    // Let existing reflected highlights breathe; no new light or global tint.
    color *= 1. + mask.r * (.25 + highlight * .75) * surface * .28;
    float crest = pow(smoothstep(.6, .99, 1. - abs(surface)), 8.);
    color += vec3(.55, .64, .68) * mask.r * highlight * crest * .035;
    // A barely visible air-depth response remains confined to the water.
    color += vec3(.65, .66, .62) * mask.r * (waterDrift + 1.) * .0008;
  }
  if (mask.g > .003) {
    // Fixed sunlight direction, two independent slow fields, at most +/-6%.
    float air = min(mask.g * 1.6, 1.);
    float sunA = noise(uv * vec2(9., 12.) + u_time * vec2(.013, .009));
    float sunB = noise(uv * vec2(19., 8.) + vec2(12., 4.) + u_time * vec2(-.007, .016));
    float sun = (sunA * .65 + sunB * .35) * 2. - 1.;
    // The small left-hand mask is lit air below the existing warm source;
    // it carries dust, not a new sunbeam or changing architectural exposure.
    if (uv.x > .6) color *= 1. + air * sun * .06;
    float atmosphere = noise(uv * vec2(5., 9.) + vec2(3., 14.) + u_time * vec2(.003, -.004));
    color += vec3(.75, .74, .67) * air * atmosphere * .002;
    // Sparse, independently staggered lifetimes. Each invisible re-entry uses
    // a new trajectory/depth/opacity, so particles never share a master reset.
    if (mask.g > .015) {
      for (int i = 0; i < 12; i++) {
        bool leftAir = uv.x < .3;
        if ((leftAir && i < 8) || (!leftAir && i >= 8)) continue;
        float seed = float(i);
        float age = leftAir ? u_time * (.035 + (seed - 8.) * .0037) + (seed - 8.) * .317 + .32
          : u_time * (.019 + seed * .00073) + seed * .171;
        float cycle = floor(age), life = fract(age);
        float random = hash(vec2(seed + 1., cycle + 4.));
        float depth = .5 + hash(vec2(cycle + 7., seed + 3.)) * .5;
        float y = i < 4 ? 180. + (1. - life) * 250. : 250. + (1. - life) * 240.;
        float x = i < 4 ? 1440. - (y - 165.) * .36 : 1790. - (y - 205.) * .65;
        if (leftAir) { y = 45. + (1. - life) * 90.; x = 236. + (random - .5) * 35.; }
        x += (random - .5) * 30. + (life - .5) * (random - .5) * 12.;
        vec2 particle = vec2(x / 1916., y / 821.);
        vec2 pixels = (uv - particle) / u_texel;
        float dotLight = exp(-dot(pixels, pixels) / (2. + depth * 2.));
        float fade = smoothstep(0., .18, life) * (1. - smoothstep(.8, 1., life));
        color += vec3(.78, .75, .62) * dotLight * fade * air * depth * .48;
      }
    }
  }
  if (mask.b > .003 || practicalArea) {
    // Small fast flicker plus slow drift, local to existing warm practicals.
    float lightSeed = uv.x * 31. + uv.y * 17.;
    float flicker = noise(vec2(u_time * 2.7, lightSeed)) * .72 +
      noise(vec2(u_time * .16, lightSeed + 9.)) * .28;
    color *= 1. + mask.b * (flicker - .5) * .5;
    color += vec3(.92, .65, .32) * mask.b * (flicker - .5) * .055;
    // Visible tapered flames, rather than an almost imperceptible point glow.
    // All geometry remains local to the existing practical light sources.
    for (int i = 0; i < 5; i++) {
      vec2 p = uv / u_texel - practicalPosition(i);
      if (abs(p.x) > 28. || p.y < -60. || p.y > 10.) continue;
      float seed = float(i) * 13. + 4.;
      float fast = noise(vec2(u_time * 5.3, seed));
      float slow = noise(vec2(u_time * .41, seed + 7.));
      float lean = (noise(vec2(u_time * 4.1, seed + 17.)) - .5) * 9.;
      float height = (i == 0 ? 14. : 18.) + fast * 10. + slow * 4.;
      float up = clamp(-p.y / height, 0., 1.);
      float flutter = (noise(vec2(up * 5. - u_time * 7., seed + 23.)) - .5) * 2.4;
      float center = lean * up + flutter * up;
      float width = mix(4.4, .3, pow(up, .8)) * (.85 + fast * .3);
      float vertical = smoothstep(-3., 1., -p.y) * (1. - smoothstep(height * .84, height * 1.03, -p.y));
      float body = (1. - smoothstep(width * .35, width * 1.35, abs(p.x - center))) * vertical;
      float core = (1. - smoothstep(width * .08, width * .55, abs(p.x - center))) * vertical * (1. - up);
      color += mix(vec3(1., .61, .13), vec3(1., .25, .035), up) * body * (.65 + fast * .35);
      color += vec3(1., .86, .42) * core * .55;
      float glow = exp(-dot(p + vec2(0., height * .3), p + vec2(0., height * .3)) / 150.);
      color += vec3(1., .39, .08) * glow * (.025 + fast * .035);
      // Two tiny embers per source rise on separate staggered lifetimes.
      for (int j = 0; j < 2; j++) {
        float age = u_time * (.21 + float(j) * .071) + seed * .17 + float(j) * .43;
        float life = fract(age), cycle = floor(age);
        float drift = (hash(vec2(cycle, seed + float(j))) - .5) * 20.;
        vec2 ember = p - vec2(drift * life, -6. - life * 45.);
        float fade = smoothstep(0., .12, life) * (1. - smoothstep(.55, 1., life));
        color += vec3(1., .42, .1) * exp(-dot(ember, ember) / 1.3) * fade * .55;
      }
    }
  }
  gl_FragColor = vec4(max(color, 0.), 1.);
}`

// The opaque plate is drawn once; subsequent frames redraw only local effect
// rectangles. Preserving the small buffer avoids shading the static center.
function createMotion(canvas: HTMLCanvasElement, image: HTMLImageElement) {
  const gl = canvas.getContext('webgl', {
    alpha: false, antialias: false, depth: false, stencil: false,
    premultipliedAlpha: false, powerPreference: 'low-power', preserveDrawingBuffer: true,
  })
  if (!gl) return null
  const shaders: WebGLShader[] = []
  const textures: WebGLTexture[] = []
  let program: WebGLProgram | null = null
  let buffer: WebGLBuffer | null = null
  let fullFrame = true
  let regions: Array<[number, number, number, number]> = []
  const dispose = () => {
    textures.forEach(texture => gl.deleteTexture(texture))
    shaders.forEach(shader => gl.deleteShader(shader))
    if (buffer) gl.deleteBuffer(buffer)
    if (program) gl.deleteProgram(program)
  }
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]] as const) {
      const shader = gl.createShader(type)
      if (!shader) throw new Error('shader allocation')
      shaders.push(shader)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('shader compile')
    }
    program = gl.createProgram()
    if (!program) throw new Error('program allocation')
    shaders.forEach(shader => gl.attachShader(program!, shader))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('program link')
    gl.useProgram(program)
    buffer = gl.createBuffer()
    if (!buffer) throw new Error('buffer allocation')
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const attribute = gl.getAttribLocation(program, 'a_position')
    gl.enableVertexAttribArray(attribute)
    gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0)
    for (let i = 0; i < 3; i++) {
      const texture = gl.createTexture()
      if (!texture) throw new Error('texture allocation')
      textures.push(texture)
      gl.activeTexture(gl.TEXTURE0 + i)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.uniform1i(gl.getUniformLocation(program, ['u_image', 'u_masks', 'u_foliage'][i]), i)
    }
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, textures[0])
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
    const time = gl.getUniformLocation(program, 'u_time')
    gl.uniform2f(gl.getUniformLocation(program, 'u_texel'), 1 / image.naturalWidth, 1 / image.naturalHeight)
    return {
      setMask(mask: HTMLImageElement, foliage: HTMLImageElement) {
        for (const [i, asset] of [mask, foliage].entries()) {
          gl.activeTexture(gl.TEXTURE1 + i)
          gl.bindTexture(gl.TEXTURE_2D, textures[i + 1])
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, asset)
        }
      },
      resize() {
        const bounds = canvas.getBoundingClientRect()
        const ratio = Math.min(window.devicePixelRatio || 1, 1,
          Math.sqrt(1_000_000 / Math.max(1, bounds.width * bounds.height)))
        canvas.width = Math.max(1, Math.round(bounds.width * ratio))
        canvas.height = Math.max(1, Math.round(bounds.height * ratio))
        gl.viewport(0, 0, canvas.width, canvas.height)
        fullFrame = true
        const fit = Math.max(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight)
        const style = getComputedStyle(image)
        const zoom = parseFloat(style.getPropertyValue('--courtyard-zoom')) || 1
        const x = bounds.width / (image.naturalWidth * fit * zoom)
        const y = bounds.height / (image.naturalHeight * fit * zoom)
        const position = style.objectPosition.split(' ').map(value => parseFloat(value) / 100)
        gl.uniform2f(gl.getUniformLocation(program!, 'u_uvScale'), x, y)
        const offsetX = (1 - x) * position[0], offsetY = (1 - y) * position[1]
        gl.uniform2f(gl.getUniformLocation(program!, 'u_uvOffset'), offsetX, offsetY)
        // These padded source-space rectangles contain every possible leaf,
        // ember, beam and ripple position; clipping never follows an object.
        regions = [
          [170, 0, 470, 265], [165, 455, 580, 821],
          [1210, 0, 1880, 620], [1415, 645, 1860, 780],
        ].flatMap(([left, top, right, bottom]) => {
          const l = Math.max(0, Math.floor((left / image.naturalWidth - offsetX) / x * canvas.width))
          const r = Math.min(canvas.width, Math.ceil((right / image.naturalWidth - offsetX) / x * canvas.width))
          const t = Math.max(0, Math.floor((top / image.naturalHeight - offsetY) / y * canvas.height))
          const b = Math.min(canvas.height, Math.ceil((bottom / image.naturalHeight - offsetY) / y * canvas.height))
          return r > l && b > t ? [[l, canvas.height - b, r - l, b - t] as [number, number, number, number]] : []
        })
      },
      draw(seconds: number) {
        gl.uniform1f(time, seconds)
        if (fullFrame) {
          gl.disable(gl.SCISSOR_TEST)
          gl.drawArrays(gl.TRIANGLES, 0, 3)
          fullFrame = false
        } else {
          gl.enable(gl.SCISSOR_TEST)
          for (const region of regions) {
            gl.scissor(...region)
            gl.drawArrays(gl.TRIANGLES, 0, 3)
          }
          gl.disable(gl.SCISSOR_TEST)
        }
      },
      dispose,
    }
  } catch {
    dispose()
    return null
  }
}

export function CourtyardBackdrop({ active }: { active: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const activeRef = useRef(active)

  useEffect(() => {
    activeRef.current = active
    rootRef.current?.dispatchEvent(new Event('courtyard-activity'))
  }, [active])

  useEffect(() => {
    const root = rootRef.current, image = imageRef.current, canvas = canvasRef.current
    if (!root || !image || !canvas) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    // A narrow desktop preview is still a desktop. Window width alone must
    // never turn its living background into the mobile static fallback.
    const mobile = window.matchMedia('(pointer: coarse)')
    let reduced = reduce.matches, compact = mobile.matches
    const device = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
    const weak = device.connection?.saveData || (device.deviceMemory !== undefined && device.deviceMemory <= 2)
      || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 2)
    let motion: ReturnType<typeof createMotion> = null
    let frame = 0, last = 0, seconds = 0, lastDraw = 0
    let rendered = 0, lastDiagnostic = -Infinity
    let disposed = false, lost = false, failed = false, maskRequested = false
    const mask = new Image()
    const foliage = new Image()
    const stop = () => { cancelAnimationFrame(frame); frame = 0; last = 0 }
    const staticMode = () => reduced ? 'static-reduced' : compact ? 'static-mobile' : weak ? 'static-low-power' : null
    const paint = (now: number) => {
      motion?.draw(seconds)
      if (import.meta.env.DEV) {
        rendered++
        if (now - lastDiagnostic >= 1000) {
          root.dataset.motionTime = seconds.toFixed(2)
          root.dataset.motionFrames = String(rendered)
          lastDiagnostic = now
        }
      }
    }
    const draw = (now: number) => {
      frame = 0
      if (disposed || !motion || lost || document.hidden || !activeRef.current || staticMode()) return
      if (now - lastDraw >= 1000 / 30) {
        if (last) seconds += Math.min((now - last) / 1000, .25)
        last = now
        lastDraw = now
        paint(now)
      }
      frame = requestAnimationFrame(draw)
    }
    const sync = () => {
      stop()
      const mode = staticMode()
      if (mode) { root.dataset.mode = mode; canvas.style.visibility = 'hidden'; return }
      if (lost) { root.dataset.mode = 'context-lost'; canvas.style.visibility = 'hidden'; return }
      if (failed) { root.dataset.mode = 'static-fallback'; canvas.style.visibility = 'hidden'; return }
      if (!motion) { initialize(); return }
      if (document.hidden || !activeRef.current) { root.dataset.mode = 'paused'; return }
      root.dataset.mode = 'animated'
      // A valid frame is ready before an opaque canvas can become visible.
      paint(performance.now())
      canvas.style.visibility = 'visible'
      frame = requestAnimationFrame(draw)
    }
    function initialize() {
      if (disposed || motion || staticMode() || lost || failed) return
      if (!image!.complete || !image!.naturalWidth) return
      root!.dataset.mode = 'loading'
      if (!maskRequested) {
        maskRequested = true
        mask.onload = sync
        mask.onerror = () => { failed = true; sync() }
        mask.src = courtyardMaskUrl
        foliage.onload = sync
        foliage.onerror = () => { failed = true; sync() }
        foliage.src = courtyardFoliageUrl
      }
      if (!mask.complete || !mask.naturalWidth || !foliage.complete || !foliage.naturalWidth) return
      // The GPU samples precisely the already displayed picture asset. There is
      // no base exposure/grade hand-off when the effect texture becomes ready.
      motion = createMotion(canvas!, image!)
      if (!motion) { failed = true; sync(); return }
      motion.setMask(mask, foliage)
      motion.resize()
      sync()
    }
    const resize = () => { motion?.resize(); sync() }
    const loaded = () => {
      // A breakpoint can change picture.currentSrc; recreate only on that real
      // asset change, never on a transcript result or client route transition.
      stop(); motion?.dispose(); motion = null; failed = false
      sync()
    }
    const contextLost = (event: Event) => { event.preventDefault(); lost = true; stop(); sync() }
    const contextRestored = () => { lost = false; failed = false; motion?.dispose(); motion = null; sync() }
    // The event carries the new value even when the browser's media-query
    // object has not exposed its updated .matches value to other listeners yet.
    const reducedChanged = (event: MediaQueryListEvent) => { reduced = event.matches; sync() }
    const mobileChanged = (event: MediaQueryListEvent) => { compact = event.matches; sync() }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    image.addEventListener('load', loaded)
    document.addEventListener('visibilitychange', sync)
    root.addEventListener('courtyard-activity', sync)
    reduce.addEventListener('change', reducedChanged)
    mobile.addEventListener('change', mobileChanged)
    canvas.addEventListener('webglcontextlost', contextLost)
    canvas.addEventListener('webglcontextrestored', contextRestored)
    sync()
    return () => {
      disposed = true; stop(); observer.disconnect()
      image.removeEventListener('load', loaded)
      document.removeEventListener('visibilitychange', sync)
      root.removeEventListener('courtyard-activity', sync)
      reduce.removeEventListener('change', reducedChanged)
      mobile.removeEventListener('change', mobileChanged)
      canvas.removeEventListener('webglcontextlost', contextLost)
      canvas.removeEventListener('webglcontextrestored', contextRestored)
      mask.onload = null; mask.onerror = null
      foliage.onload = null; foliage.onerror = null
      motion?.dispose()
    }
  }, [])

  return (
    <div ref={rootRef} className="courtyard-backdrop" data-active={active} data-mode="loading" aria-hidden="true">
      <div className="courtyard-scene">
        <picture>
          <source media="(max-width: 760px) and (pointer: coarse)" type="image/avif" srcSet="/wallpapers/courtyard/courtyard-mobile.avif" />
          <source media="(max-width: 760px) and (pointer: coarse)" type="image/webp" srcSet="/wallpapers/courtyard/courtyard-mobile.webp" />
          <source type="image/avif" srcSet="/wallpapers/courtyard/courtyard-desktop.avif" />
          <img ref={imageRef} className="courtyard-image" src="/wallpapers/courtyard/courtyard-desktop.webp" alt="" width="1916" height="821" decoding="async" fetchPriority="high" />
        </picture>
        <canvas ref={canvasRef} className="courtyard-motion" />
      </div>
    </div>
  )
}
