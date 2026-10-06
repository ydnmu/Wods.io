import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import './RubberSegmentNav.css'

type RubberSegmentNavItem = {
  href: string
  label: ReactNode
  active?: boolean
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void
}

type Segment = { left: number; right: number }

const EASE_OUT = [0.23, 1, 0.32, 1] as const

/** A small, navigation-safe adaptation of RubberSegment's shared elastic thumb. */
export default function RubberSegmentNav({ items, ariaLabel }: { items: RubberSegmentNavItem[]; ariaLabel: string }) {
  const trackRef = useRef<HTMLElement>(null)
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([])
  const segmentsRef = useRef<Segment[]>([])
  const activeIndex = Math.max(0, items.findIndex(item => item.active))
  const selectedIndexRef = useRef(activeIndex)
  const hoveredIndexRef = useRef<number | null>(null)
  const [highlightedIndex, setHighlightedIndex] = useState(activeIndex)
  const animationRef = useRef<{ stop: () => void }[]>([])
  const handoffRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const left = useMotionValue(0)
  const right = useMotionValue(0)
  const width = useTransform([left, right], latest => Math.max(0, Number(latest[1]) - Number(latest[0])))
  const reducedMotion = useReducedMotion()

  const stopAnimation = useCallback(() => {
    animationRef.current.forEach(control => control.stop())
    animationRef.current = []
    if (handoffRef.current) window.clearTimeout(handoffRef.current)
    handoffRef.current = null
  }, [])

  const jumpTo = useCallback((index: number) => {
    const segment = segmentsRef.current[index]
    if (!segment) return
    stopAnimation()
    left.set(segment.left)
    right.set(segment.right)
  }, [left, right, stopAnimation])

  const settleTo = useCallback((index: number) => {
    const segment = segmentsRef.current[index]
    if (!segment) return
    stopAnimation()
    if (reducedMotion) {
      left.set(segment.left)
      right.set(segment.right)
      return
    }
    animationRef.current = [
      animate(left, segment.left, { type: 'spring', duration: 0.3, bounce: 0 }),
      animate(right, segment.right, { type: 'spring', duration: 0.3, bounce: 0 }),
    ]
  }, [left, reducedMotion, right, stopAnimation])

  const travelTo = useCallback((index: number) => {
    const segment = segmentsRef.current[index]
    if (!segment) return
    if (reducedMotion) {
      jumpTo(index)
      return
    }
    stopAnimation()
    const currentLeft = left.get()
    const currentRight = right.get()
    const expandedLeft = Math.min(currentLeft, segment.left)
    const expandedRight = Math.max(currentRight, segment.right)
    animationRef.current = [
      animate(left, expandedLeft, { duration: 0.19, ease: EASE_OUT }),
      animate(right, expandedRight, { duration: 0.19, ease: EASE_OUT }),
    ]
    handoffRef.current = window.setTimeout(() => {
      animationRef.current = [
        animate(left, segment.left, { type: 'spring', duration: 0.3, bounce: 0.18 }),
        animate(right, segment.right, { type: 'spring', duration: 0.3, bounce: 0.18 }),
      ]
      handoffRef.current = null
    }, 115)
  }, [jumpTo, left, reducedMotion, right, stopAnimation])

  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return

    const measure = () => {
      const trackRect = track.getBoundingClientRect()
      segmentsRef.current = itemRefs.current.map(item => {
        if (!item) return { left: 0, right: 0 }
        const rect = item.getBoundingClientRect()
        return { left: rect.left - trackRect.left - 3, right: rect.right - trackRect.left + 3 }
      })
      const selected = hoveredIndexRef.current ?? activeIndex
      if (segmentsRef.current[selected]) {
        if (!segmentsRef.current.some(segment => segment.right > segment.left)) return
        jumpTo(selected)
      }
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(track)
    itemRefs.current.forEach(item => item && observer.observe(item))
    document.fonts?.ready.then(measure).catch(() => {})
    return () => {
      observer.disconnect()
      stopAnimation()
    }
  }, [activeIndex, items.length, jumpTo, reducedMotion, stopAnimation])

  useLayoutEffect(() => {
    if (selectedIndexRef.current !== activeIndex) {
      selectedIndexRef.current = activeIndex
      if (hoveredIndexRef.current === null) {
        setHighlightedIndex(activeIndex)
        settleTo(activeIndex)
      }
    }
  }, [activeIndex, settleTo])

  return (
    <nav ref={trackRef} className="rubber-segment-nav topbar-nav" aria-label={ariaLabel} onMouseLeave={() => {
      hoveredIndexRef.current = null
      setHighlightedIndex(activeIndex)
      settleTo(activeIndex)
    }}>
      <motion.span className="rubber-segment-thumb" aria-hidden="true" style={{ left, width }} />
      {items.map((item, index) => (
        <a
          key={item.href}
          ref={element => { itemRefs.current[index] = element }}
          className="rubber-segment-link nav-link"
          href={item.href}
          data-highlighted={highlightedIndex === index ? 'true' : undefined}
          aria-current={item.active ? 'page' : undefined}
          onMouseEnter={() => {
            hoveredIndexRef.current = index
            setHighlightedIndex(index)
            travelTo(index)
          }}
          onFocus={() => {
            hoveredIndexRef.current = index
            setHighlightedIndex(index)
            travelTo(index)
          }}
          onBlur={() => {
            if (!trackRef.current?.matches(':hover')) {
              hoveredIndexRef.current = null
              setHighlightedIndex(activeIndex)
              settleTo(activeIndex)
            }
          }}
          onClick={item.onClick}
        >
          <span>{item.label}</span>
        </a>
      ))}
    </nav>
  )
}
