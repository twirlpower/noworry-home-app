import CRMMaintenanceTab from '../../components/admin/CRMMaintenanceTab'

// Standalone page wrapping the existing maintenance-template manager.
// The component itself wasn't refactored — moving it out of the CRM tab
// strip just gives it room to breathe and decouples it from the
// member-focused tabs.
export default function AdminMaintenance() {
  return (
    <div className="page admin-page">
      <div className="admin-header">
        <h1>Maintenance Templates</h1>
        <p className="admin-subtitle">
          The catalog of seasonal tasks generated for every active home.
          Edits here flow to new home onboarding immediately; existing
          homes refresh on the next regenerate.
        </p>
      </div>
      <CRMMaintenanceTab />
    </div>
  )
}
