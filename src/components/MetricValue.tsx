export function MetricValue({ value, previous, refreshId, kind, onComplete }: {
  value: string; previous?: string; refreshId?: number; kind: 'average' | 'total'; onComplete?: (id: number) => void
}) {
  const swapping = refreshId !== undefined && previous !== undefined && previous !== value
  return <span className="product-metric" data-metric={kind} data-swap={swapping ? refreshId : undefined}
    role="status" aria-label={value} aria-live="polite" aria-atomic="true">
    <span className="product-metric-slot" aria-hidden="true">
      <span className="product-metric-value product-metric-new" key={swapping ? refreshId : 'stable'}
        onAnimationEnd={() => { if (swapping) onComplete?.(refreshId) }}>{value}</span>
      {swapping && <span className="product-metric-value product-metric-old">{previous}</span>}
    </span>
  </span>
}
