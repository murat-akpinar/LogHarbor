import { useCallback, useEffect, useRef, useState } from 'react'
import { HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr'
import type { HubConnection } from '@microsoft/signalr'
import type { Event } from '../types'

const BUFFER_CAP = 500

export type TailStatus = 'disconnected' | 'connecting' | 'connected'

interface UseLiveTailParams {
  filter: string | undefined
  enabled: boolean
  /** While paused, arriving events are held back so the list doesn't jump under the user's cursor. */
  paused: boolean
}

interface UseLiveTailResult {
  events: Event[]
  pendingCount: number
  status: TailStatus
  error: string | null
  /** Moves held-back events into the visible list. */
  flush: () => void
}

function capped(events: Event[]): Event[] {
  return events.length > BUFFER_CAP ? events.slice(0, BUFFER_CAP) : events
}

// newest first, matching the search list's ordering
function newestFirst(events: Event[]): Event[] {
  return [...events].sort((a, b) => b.id - a.id)
}

function prepend(incoming: Event[]) {
  return (current: Event[]) => capped([...incoming, ...current])
}

export function useLiveTail({ filter, enabled, paused }: UseLiveTailParams): UseLiveTailResult {
  const [events, setEvents] = useState<Event[]>([])
  const [pending, setPending] = useState<Event[]>([])
  const [status, setStatus] = useState<TailStatus>('disconnected')
  const [error, setError] = useState<string | null>(null)

  // read inside the SignalR callback, which is registered once per connection
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  useEffect(() => {
    if (!enabled) {
      setStatus('disconnected')
      setEvents([])
      setPending([])
      setError(null)
      return
    }

    let connection: HubConnection | null = null
    let disposed = false

    async function connect() {
      const built = new HubConnectionBuilder()
        .withUrl('/hubs/tail')
        .withAutomaticReconnect()
        .configureLogging(LogLevel.Warning)
        .build()

      built.on('EventsArrived', (arrived: Event[]) => {
        const incoming = newestFirst(arrived)
        if (pausedRef.current) setPending(prepend(incoming))
        else setEvents(prepend(incoming))
      })

      // a reconnect gives a fresh connection id on the server, so the subscription must be re-sent
      built.onreconnecting(() => setStatus('connecting'))
      built.onreconnected(async () => {
        await built.invoke('Subscribe', filter ?? null)
        setStatus('connected')
      })
      built.onclose(() => {
        if (!disposed) setStatus('disconnected')
      })

      setStatus('connecting')
      try {
        await built.start()
        await built.invoke('Subscribe', filter ?? null)
        if (disposed) {
          await built.stop()
          return
        }
        connection = built
        setStatus('connected')
        setError(null)
      } catch (startError) {
        if (!disposed) {
          setStatus('disconnected')
          setError(startError instanceof Error ? startError.message : 'Live tail connection failed.')
        }
      }
    }

    // a filter change means a different subscription: drop what the old one collected
    setEvents([])
    setPending([])
    connect().catch(() => setStatus('disconnected'))

    return () => {
      disposed = true
      if (connection && connection.state !== HubConnectionState.Disconnected) {
        connection.stop().catch(() => {
          // the hook is going away; a failed stop has nothing left to report to
        })
      }
    }
  }, [enabled, filter])

  const flush = useCallback(() => {
    setPending((currentPending) => {
      if (currentPending.length > 0) {
        setEvents((current) => capped([...currentPending, ...current]))
      }
      return []
    })
  }, [])

  return { events, pendingCount: pending.length, status, error, flush }
}
