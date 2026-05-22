import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import CRMContactsTab from '../../components/admin/CRMContactsTab'
import CRMPartnersTab from '../../components/admin/CRMPartnersTab'
import CRMVendorsTab from '../../components/admin/CRMVendorsTab'

const TABS = [
  ['contacts', 'Contacts'],
  ['partners', 'Partners'],
  ['vendors', 'Vendors'],
]

export default function AdminCRM() {
  const [tab, setTab] = useState('contacts')
  const [stats, setStats] = useState({
    payingMembers: null,
    mrr: null,
    activePartners: null,
    activeVendors: null,
    pendingPayouts: null,
  })
  // Bump to retrigger stat reload after tab inserts.
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('crm_contacts').select('mrr, tier'),
      supabase.from('crm_partners').select('active').eq('active', true),
      supabase.from('vendors').select('status').eq('status', 'active'),
      // Pending payouts: sum of vendor_rate where payout_status='pending'.
      supabase.from('vendor_jobs').select('vendor_rate').eq('payout_status', 'pending'),
    ]).then(([contactsRes, partnersRes, vendorsRes, payoutsRes]) => {
      if (cancelled) return
      const contacts = contactsRes.data ?? []
      const paying = contacts.filter((c) => c.tier === 'covered' || c.tier === 'complete').length
      const mrr = contacts.reduce((sum, c) => sum + Number(c.mrr || 0), 0)
      const pending = (payoutsRes.data ?? []).reduce(
        (sum, j) => sum + Number(j.vendor_rate || 0),
        0
      )
      setStats({
        payingMembers: paying,
        mrr,
        activePartners: (partnersRes.data ?? []).length,
        activeVendors: (vendorsRes.data ?? []).length,
        pendingPayouts: pending,
      })
    })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  function bumpStats() {
    setRefreshKey((k) => k + 1)
  }

  return (
    <div className="page admin-page">
      <div className="admin-header">
        <h1>Admin — NoWorry Home CRM</h1>
        <p className="admin-subtitle">Founder view · Not visible to members</p>
      </div>

      <div className="admin-stat-strip">
        <Stat label="Paying members" value={stats.payingMembers} />
        <Stat label="Total MRR" value={stats.mrr != null ? `$${stats.mrr.toFixed(2)}` : null} />
        <Stat label="Active partners" value={stats.activePartners} />
        <Stat label="Active vendors" value={stats.activeVendors} />
        <Stat
          label="Pending payouts"
          value={stats.pendingPayouts != null ? `$${stats.pendingPayouts.toFixed(2)}` : null}
          tone={stats.pendingPayouts > 0 ? 'warn' : 'neutral'}
          onClick={stats.pendingPayouts > 0 ? () => setTab('vendors') : null}
        />
      </div>

      <div className="admin-tab-strip" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={`admin-tab-btn ${tab === key ? 'admin-tab-btn-active' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="admin-tab-body">
        {tab === 'contacts' && <CRMContactsTab onChange={bumpStats} />}
        {tab === 'partners' && <CRMPartnersTab onChange={bumpStats} />}
        {tab === 'vendors' && <CRMVendorsTab onChange={bumpStats} />}
      </div>
    </div>
  )
}

function Stat({ label, value, tone, onClick }) {
  const cls = [
    'admin-stat',
    tone === 'warn' ? 'admin-stat-warn' : '',
    onClick ? 'admin-stat-clickable' : '',
  ]
    .filter(Boolean)
    .join(' ')

  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick}>
        <span className="admin-stat-value">{value == null ? '…' : value}</span>
        <span className="admin-stat-label">{label}</span>
      </button>
    )
  }
  return (
    <div className={cls}>
      <span className="admin-stat-value">{value == null ? '…' : value}</span>
      <span className="admin-stat-label">{label}</span>
    </div>
  )
}
