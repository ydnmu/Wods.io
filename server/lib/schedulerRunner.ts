// Startup and interval ticks must share one guard until the complete worker
// pool has settled. A failed run releases the guard so later ticks can retry.
export function preventTaskOverlap(task: () => Promise<unknown>) {
  let running = false
  return async () => {
    if (running) return
    running = true
    try {
      await task()
    } finally {
      running = false
    }
  }
}
