import { createContext, useContext, useState } from 'react'

// Persisted staff-mode toggle for users who hold dual roles (owner who
// is also a home tech, staff who works field visits). Drives which UI
// shell renders by default and which "switch to other view" link the
// AppShell shows.
//
// Values:
//   'admin' — show the member/admin shells (default)
//   'tech'  — show the field-tech shell
//
// Renamed from ViewModeContext to StaffModeContext to disambiguate
// from the new perspective-level ViewContext (homeowner/family/admin)
// added in Phase 3a. The two are independent dimensions: a staff user
// in tech mode is on the /tech shell entirely; the new ViewContext
// only matters inside the main /<route> shell.

const STAFF_MODE_KEY = 'nwh-view-mode'

const StaffModeContext = createContext({
  staffMode: 'admin',
  setStaffMode: () => {},
  isFieldMode: false,
})

export function StaffModeProvider({ children }) {
  // Lazy init keeps localStorage out of an effect (avoids strict
  // react-hooks/set-state-in-effect).
  const [staffMode, setStaffModeState] = useState(() => {
    try {
      const v = localStorage.getItem(STAFF_MODE_KEY)
      return v === 'tech' ? 'tech' : 'admin'
    } catch {
      return 'admin'
    }
  })

  function setStaffMode(mode) {
    try {
      localStorage.setItem(STAFF_MODE_KEY, mode)
    } catch {
      /* ignore */
    }
    setStaffModeState(mode)
  }

  return (
    <StaffModeContext.Provider
      value={{
        staffMode,
        setStaffMode,
        isFieldMode: staffMode === 'tech',
      }}
    >
      {children}
    </StaffModeContext.Provider>
  )
}

export function useStaffMode() {
  return useContext(StaffModeContext)
}
