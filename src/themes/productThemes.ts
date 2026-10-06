import type { CSSProperties } from 'react'

export type ProductThemeId = 'react-dark' | 'react-light' | 'ancient'

export type LightPillarSettings = {
  topColor: string
  bottomColor: string
  intensity: number
  rotationSpeed: number
  glowAmount: number
  pillarWidth: number
  pillarHeight: number
  noiseIntensity: number
  pillarRotation: number
  lightMode: boolean
  quality: 'medium' | 'high'
  interactive: false
}

type ThemeTokens = CSSProperties & Record<`--${string}`, string>
type ProductTheme = {
  id: ProductThemeId
  colorScheme: 'dark' | 'light'
  inlineTranscription: boolean
  tokens: ThemeTokens
  background: { kind: 'ancient' } | { kind: 'light-pillar'; settings: LightPillarSettings }
}

const sharedSettings = {
  quality: 'medium', interactive: false, rotationSpeed: 0.09,
  noiseIntensity: 0.018, pillarWidth: 3.2, pillarHeight: 0.4,
  pillarRotation: 22,
} as const

export const productThemes: Record<ProductThemeId, ProductTheme> = {
  'react-dark': {
    id: 'react-dark', colorScheme: 'dark', inlineTranscription: true,
    background: { kind: 'light-pillar', settings: {
      ...sharedSettings, topColor: '#A6DEFF', bottomColor: '#4A9DFF',
      intensity: 0.88, glowAmount: 0.005, rotationSpeed: 0.28,
      pillarWidth: 3.6, pillarRotation: 25, lightMode: false, quality: 'high',
    } },
    tokens: {
      '--rt-base': '#000000', '--rt-center': '#000000b3', '--rt-edge': '#00000066',
      '--rt-pillar-opacity': '1.0', '--rt-pillar-blend': 'screen',
    },
  },
  'react-light': {
    id: 'react-light', colorScheme: 'light', inlineTranscription: true,
    background: { kind: 'light-pillar', settings: {
      ...sharedSettings, topColor: '#E9F9FF', bottomColor: '#79D8FF',
      intensity: 0.54, glowAmount: 0.0018, lightMode: true,
    } },
    tokens: {
      '--rt-base': '#f4f7fb', '--rt-center': '#f4f7fbe3', '--rt-edge': '#f4f7fb26',
      '--rt-pillar-opacity': '0.50', '--rt-pillar-blend': 'multiply',
    },
  },
  ancient: {
    id: 'ancient', colorScheme: 'dark', inlineTranscription: false,
    background: { kind: 'ancient' }, tokens: {},
  },
}

export function isProductThemeId(value: unknown): value is ProductThemeId {
  return typeof value === 'string' && Object.hasOwn(productThemes, value)
}

export type { ProductTheme }
