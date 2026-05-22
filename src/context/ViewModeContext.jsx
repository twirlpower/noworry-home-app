import { createContext, useContext, useState } from 'react'

// Persisted view mode for dual-role users (owner who is also a home tech,
// staff who works field visits). Drives which UI shell renders by default
// and which "switch to other view" link the AppShell shows.
//
// Values:
//   'admin' — show the member/admin shells
//   'tech'  — show the field-tech shell

const VIEW_MODE_KEY = 'nwh-view-mode'

const ViewModeContext = createContext({
  viewMode: 'admin',
  setViewMode: () => {},
  isFieldMode: false,
})

export function ViewModeProvider({ children }) {
  // Lazy init keeps localStorage out of an effect (avoids strict
  // react-hooks/set-state-in-effect).
  const [viewMode, setViewModeState] = useState(() => {
    try {
      const v = localStorage.getItem(VIEW_MODE_KEY)
      return v === 'tech' ? 'tech' : 'admin'
    } catch {
      return 'admin'
    }
  })

  function setViewMode(mode) {
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode)
    } catch {
      /* ignore */
    }
    setViewModeState(mode)
  }

  return (
    <ViewModeContext.Provider
      value={{
        viewMode,
        setViewMode,
        isFieldMode: viewMode === 'tech',
      }}
    >
      {children}
    </ViewModeContext.Provider>
  )
}

export function useViewMode() {
  return useContext(ViewModeContext)
}
