import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, Button } from '../ui'

/*
 * Router — a plain module, not a ported dependency.
 *
 * Written by hand because the one thing this app needs that a generic router
 * does not provide is the unsaved-work gate: a card with an edited log must
 * not be navigable away from silently. That guard belongs in the router, not
 * scattered across screens.
 */

const RouterCtx = createContext(null)

const TABS = ['cards', 'people', 'map', 'setup', 'scan']

export function RouterProvider({ children }) {
  const [stack, setStack] = useState([{ screen: 'cards', params: {} }])
  const stackRef = useRef(stack)
  stackRef.current = stack

  const dirtyRef = useRef(false)
  const [pending, setPending] = useState(null)

  useEffect(() => {
    window.history.replaceState({ idx: 0 }, '')
  }, [])

  const perform = useCallback((fn) => {
    fn()
    setStack((prev) => [...prev])
  }, [])

  useEffect(() => {
    const onPopState = () => {
      const s = stackRef.current
      if (s.length > 1) {
        if (dirtyRef.current) {
          window.history.pushState({}, '')
          setPending({ type: 'back' })
          return
        }
        setStack((prev) => prev.slice(0, -1))
      } else {
        window.history.pushState({ idx: 0 }, '')
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (!dirtyRef.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const navigate = useCallback((screen, params = {}) => {
    if (dirtyRef.current) {
      setPending({ type: 'push', screen, params })
      return
    }
    window.history.pushState({ screen, params }, '')
    setStack((prev) => [...prev, { screen, params }])
  }, [])

  const goBack = useCallback(() => {
    if (stackRef.current.length <= 1) return
    if (dirtyRef.current) {
      setPending({ type: 'back' })
      return
    }
    window.history.back()
  }, [])

  const goTab = useCallback((tab) => {
    if (dirtyRef.current) {
      setPending({ type: 'tab', tab })
      return
    }
    window.history.replaceState({ idx: 0 }, '')
    setStack([{ screen: tab, params: {} }])
  }, [])

  const setDirty = useCallback((val) => {
    dirtyRef.current = Boolean(val)
  }, [])

  const discard = () => {
    dirtyRef.current = false
    const action = pending
    setPending(null)
    if (!action) return
    if (action.type === 'push') {
      window.history.pushState({ screen: action.screen, params: action.params }, '')
      setStack((prev) => [...prev, { screen: action.screen, params: action.params }])
    } else if (action.type === 'back') {
      window.history.back()
    } else if (action.type === 'tab') {
      window.history.replaceState({ idx: 0 }, '')
      setStack([{ screen: action.tab, params: {} }])
    }
  }

  const keep = () => setPending(null)

  const value = useMemo(
    () => ({ stack, current: stack[stack.length - 1], navigate, goBack, goTab, setDirty }),
    [stack, navigate, goBack, goTab, setDirty],
  )

  return (
    <RouterCtx.Provider value={value}>
      {children}
      <Dialog
        open={Boolean(pending)}
        title="Discard unsaved work?"
        body="Your changes on this card have not been synced yet. Leaving now will lose them."
        onDismiss={keep}
        actions={
          <>
            <Button variant="text" onClick={keep}>
              Keep editing
            </Button>
            <Button variant="destructive" onClick={discard} data-testid="discard">
              Discard
            </Button>
          </>
        }
      />
    </RouterCtx.Provider>
  )
}

export function useRouter() {
  const ctx = useContext(RouterCtx)
  if (!ctx) throw new Error('useRouter must be used inside RouterProvider')
  return ctx
}

export { TABS }