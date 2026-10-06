import { useEffect, useRef } from 'react'
import './UndertoneBackdrop.css'

const vertexShaderSource = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`

const fragmentShaderSource = `
precision highp float;

varying vec2 v_uv;
uniform vec2 u_resolution;
uniform vec2 u_pointer;
uniform float u_time;

const vec3 GRAPHITE = vec3(0.0667, 0.0745, 0.0902);
const vec3 COBALT = vec3(0.0431, 0.2784, 0.7176);
const vec3 STEEL = vec3(0.5608, 0.5804, 0.6078);

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise21(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise21(p);
    p = mat2(1.62, 1.18, -1.18, 1.62) * p + 0.13;
    amplitude *= 0.5;
  }
  return value;
}

mat2 rotate2d(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat2(c, -s, s, c);
}

float colorField(vec2 p, float time) {
  vec2 drift = vec2(time * 0.028, -time * 0.019);
  float broad = fbm(p * 1.08 + drift + vec2(2.4, 1.7));
  float sweep = sin(p.x * 0.88 - p.y * 0.42 + time * 0.055) * 0.11;
  return broad + sweep;
}

void main() {
  vec2 uv = v_uv;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = uv - 0.5;
  p.x *= aspect;

  vec2 pointer = u_pointer - 0.5;
  pointer.x *= aspect;

  float angle = radians(28.0);
  vec2 fluteSpace = rotate2d(angle) * p;
  float phase = fract(fluteSpace.x * 8.0 - u_time * 0.006);
  float arch = sin(phase * 3.14159265);
  float refractOffset = (arch - 0.64) * 0.055;

  vec2 flowSpace = rotate2d(-0.18) * (p * 0.82);
  flowSpace += pointer * 0.095;
  flowSpace.y += refractOffset;

  float field = colorField(flowSpace, u_time * 0.2);
  float separation = smoothstep(0.47, 0.54, field);

  float pointerDistance = length((p - pointer) * vec2(0.78, 1.0));
  float pointerInfluence = exp(-pointerDistance * pointerDistance * 1.85) * 0.16;
  separation = clamp(separation + pointerInfluence, 0.0, 1.0);

  vec3 color = mix(GRAPHITE, COBALT, separation);

  float face = smoothstep(0.02, 0.22, arch);
  float leftEdge = exp(-pow((phase - 0.075) / 0.045, 2.0));
  float rightShade = exp(-pow((phase - 0.93) / 0.075, 2.0));
  float centerRoll = pow(max(arch, 0.0), 0.62);
  color *= 0.54 + face * 0.23 + centerRoll * 0.3;
  color += STEEL * leftEdge * 0.055;
  color *= 1.0 - rightShade * 0.48;

  float seam = 1.0 - smoothstep(0.0, 0.026, min(phase, 1.0 - phase));
  color *= 1.0 - seam * 0.72;

  float vignette = smoothstep(1.18, 0.2, length(p * vec2(0.62, 0.9)));
  color *= 0.62 + vignette * 0.42;

  float grain = hash21(gl_FragCoord.xy + floor(u_time * 30.0)) - 0.5;
  color += grain * 0.025;
  color = pow(max(color, 0.0), vec3(0.94));

  gl_FragColor = vec4(color, 1.0);
}`

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Shader allocation failed')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Shader compilation failed'
    gl.deleteShader(shader)
    throw new Error(message)
  }
  return shader
}

export function UndertoneBackdrop({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      powerPreference: 'high-performance',
    })
    if (!gl) {
      canvas.dataset.failed = 'true'
      return
    }

    let frame = 0
    let targetX = 0.5
    let targetY = 0.5
    let pointerX = 0.5
    let pointerY = 0.5
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    try {
      const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
      const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource)
      const program = gl.createProgram()
      if (!program) throw new Error('Program allocation failed')
      gl.attachShader(program, vertex)
      gl.attachShader(program, fragment)
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || 'Shader link failed')
      }
      gl.useProgram(program)

      const buffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
      const position = gl.getAttribLocation(program, 'a_position')
      gl.enableVertexAttribArray(position)
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

      const resolution = gl.getUniformLocation(program, 'u_resolution')
      const time = gl.getUniformLocation(program, 'u_time')
      const pointer = gl.getUniformLocation(program, 'u_pointer')
      const started = performance.now()

      const draw = (now: number) => {
        const bounds = canvas.getBoundingClientRect()
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
        const width = Math.max(1, Math.round(bounds.width * dpr))
        const height = Math.max(1, Math.round(bounds.height * dpr))
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width
          canvas.height = height
        }

        pointerX += (targetX - pointerX) * 0.055
        pointerY += (targetY - pointerY) * 0.055

        gl.viewport(0, 0, width, height)
        gl.uniform2f(resolution, width, height)
        gl.uniform2f(pointer, pointerX, pointerY)
        gl.uniform1f(time, reducedMotion ? 8.0 : (now - started) / 1000)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        if (!reducedMotion) frame = requestAnimationFrame(draw)
      }

      const move = (event: PointerEvent) => {
        targetX = event.clientX / Math.max(window.innerWidth, 1)
        targetY = 1 - event.clientY / Math.max(window.innerHeight, 1)
      }

      if (!reducedMotion) window.addEventListener('pointermove', move, { passive: true })
      frame = requestAnimationFrame(draw)

      return () => {
        cancelAnimationFrame(frame)
        window.removeEventListener('pointermove', move)
        gl.deleteBuffer(buffer)
        gl.deleteProgram(program)
        gl.deleteShader(vertex)
        gl.deleteShader(fragment)
      }
    } catch (error) {
      canvas.dataset.failed = 'true'
      console.error(error)
    }
  }, [])

  const classes = ['easytran-undertone-backdrop', className].filter(Boolean).join(' ')
  return <canvas ref={canvasRef} className={classes} aria-hidden="true" />
}
