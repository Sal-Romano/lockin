import { useEffect, useState } from 'react'
import Create from './pages/Create'
import EventPage from './pages/Event'

/** soft client-side navigation (no reload, keeps composer state alive) */
export function navigate(path: string, replace = false) {
  if (replace) window.history.replaceState(null, '', path)
  else window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname)

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const m = path.match(/^\/e\/([a-z0-9-]+)/i)
  if (m) return <EventPage refId={m[1]} key={m[1]} />
  return <Create />
}
