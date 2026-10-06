import { useCallback, useEffect, useRef, useState } from 'react'

export type TranscriptionStatus =
  | { status: 'idle' }
  | { status: 'working'; startedAt: number }
  | { status: 'done' | 'error'; startedAt: number; elapsed: number }

type Operation = { id: number; startedAt: number; signal: AbortSignal }

export function useTranscriptionStatus() {
  const generation = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const [operationStatus, setOperationStatus] = useState<TranscriptionStatus>({ status: 'idle' })
  useEffect(() => () => { generation.current++; controller.current?.abort() }, [])

  const begin = useCallback((): Operation => {
    controller.current?.abort()
    controller.current = new AbortController()
    const operation = { id: ++generation.current, startedAt: performance.now(), signal: controller.current.signal }
    setOperationStatus({ status: 'working', startedAt: operation.startedAt })
    return operation
  }, [])

  const isCurrent = useCallback((operation: Operation) => operation.id === generation.current, [])

  const finish = useCallback((operation: Operation, status: 'done' | 'error') => {
    if (operation.id !== generation.current) return false
    controller.current = null
    setOperationStatus({ status, startedAt: operation.startedAt, elapsed: (performance.now() - operation.startedAt) / 1_000 })
    return true
  }, [])

  const clear = useCallback(() => {
    generation.current++
    controller.current?.abort()
    controller.current = null
    setOperationStatus({ status: 'idle' })
  }, [])

  return { operationStatus, begin, finish, isCurrent, clear }
}
