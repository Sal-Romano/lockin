import { useEffect, useRef, useState } from 'react'
import type { EventPayload, ServerMsg, Viewer } from '../../shared/types'
import { deviceId } from './device'

declare global {
  interface Window {
    __SNAPSHOT__?: EventPayload
  }
}

export type ConnState = 'live' | 'connecting'

const STALE_MS = 45_000 // server heartbeats every 20s; past this the pipe is dead

export function useEventStream(ref: string, name: string | null) {
  // boot from the server-inlined snapshot so the first frame shows real state
  const [payload, setPayload] = useState<EventPayload | null>(() => {
    const snap = window.__SNAPSHOT__
    return snap && (snap.event.slug === ref || snap.event.id === ref) ? snap : null
  })
  const [viewers, setViewers] = useState<Viewer[]>(payload?.viewers ?? [])
  const [anon, setAnon] = useState(payload?.anon ?? 0)
  const [conn, setConn] = useState<ConnState>('connecting')
  const [gone, setGone] = useState(false)
  const esRef = useRef<EventSource | null>(null)
  const goneRef = useRef(false)
  const lastBeat = useRef(Date.now())

  useEffect(() => {
    let disposed = false
    let retryTimer: number | undefined

    const markGone = () => {
      goneRef.current = true
      setGone(true)
      esRef.current?.close()
    }

    const connect = () => {
      if (disposed || goneRef.current) return
      esRef.current?.close()
      const params = new URLSearchParams({ device: deviceId() })
      if (name) params.set('name', name)
      const es = new EventSource(`/api/events/${ref}/stream?${params}`)
      esRef.current = es
      lastBeat.current = Date.now()

      es.onopen = () => {
        lastBeat.current = Date.now()
        setConn('live')
      }

      es.addEventListener('ping', () => {
        lastBeat.current = Date.now()
      })

      es.onmessage = (e) => {
        lastBeat.current = Date.now()
        const msg = JSON.parse(e.data) as ServerMsg
        if (msg.type === 'state') {
          setPayload(msg.payload)
          setViewers(msg.payload.viewers)
          setAnon(msg.payload.anon)
        } else if (msg.type === 'participant') {
          setPayload((prev) => {
            if (!prev) return prev
            const rest = prev.participants.filter((p) => p.id !== msg.participant.id)
            return { ...prev, participants: [...rest, msg.participant] }
          })
        } else if (msg.type === 'presence') {
          setViewers(msg.viewers)
          setAnon(msg.anon)
        } else if (msg.type === 'event') {
          setPayload((prev) => (prev ? { ...prev, event: msg.event } : prev))
        } else if (msg.type === 'gone') {
          markGone()
        }
      }

      es.onerror = () => {
        setConn('connecting')
        if (es.readyState !== EventSource.CLOSED) return // browser is auto-retrying
        // fatal close: a 404 means the event is really gone; anything else
        // (server restart, tunnel blip) deserves a retry, not a ghost page
        es.close()
        fetch(`/api/events/${encodeURIComponent(ref)}`, { headers: { 'x-device': deviceId() } })
          .then((r) => {
            if (r.status === 404) markGone()
            else if (!disposed) retryTimer = window.setTimeout(connect, 2500)
          })
          .catch(() => {
            if (!disposed) retryTimer = window.setTimeout(connect, 4000)
          })
      }
    }

    connect()

    // iOS Safari silently kills the pipe on background/lock without ever
    // reporting CLOSED; on return, reconnect if the stream has gone stale
    const revive = () => {
      if (disposed || goneRef.current || document.visibilityState !== 'visible') return
      const es = esRef.current
      const stale = Date.now() - lastBeat.current > STALE_MS
      if (!es || es.readyState === EventSource.CLOSED || stale) {
        setConn('connecting')
        connect()
      }
    }
    document.addEventListener('visibilitychange', revive)
    window.addEventListener('online', revive)
    const watchdog = window.setInterval(revive, STALE_MS)

    return () => {
      disposed = true
      window.clearTimeout(retryTimer)
      window.clearInterval(watchdog)
      document.removeEventListener('visibilitychange', revive)
      window.removeEventListener('online', revive)
      esRef.current?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, name])

  return { payload, setPayload, viewers, anon, conn, gone }
}
