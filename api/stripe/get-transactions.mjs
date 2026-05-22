// GET /api/stripe/get-transactions
// Staff-only. Returns the 50 most recent Stripe charges with customer
// email resolution (prefers customer.email, falls back to
// billing_details.email). Includes a deep-link to the Stripe Dashboard
// per row so staff can drill into receipts / dispute history without
// leaving the admin UI for long.

import Stripe from 'stripe'
import { serviceClient, verifyStaff } from '../admin/_staff-auth.mjs'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const supabase = serviceClient()
  if (!supabase) return res.status(500).json({ error: 'supabase_env_missing' })
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'stripe_env_missing' })
  }

  const verify = await verifyStaff(req, supabase, ['owner', 'staff', 'readonly'])
  if (!verify.ok) return res.status(verify.status).json(verify.body)

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' })

  try {
    const charges = await stripe.charges.list({
      limit: 50,
      expand: ['data.customer'],
    })

    const formatted = charges.data.map((c) => {
      // Derived "refunded" status: Stripe reports status='succeeded' even
      // after refunds. The customer-facing concept of "refunded" comes
      // from c.refunded or amount_refunded > 0.
      let status = c.status
      if (c.status === 'succeeded' && (c.refunded || (c.amount_refunded ?? 0) > 0)) {
        status = (c.amount_refunded === c.amount) ? 'refunded' : 'partial_refund'
      }
      return {
        id: c.id,
        date: c.created,
        customerEmail: c.customer?.email || c.billing_details?.email || '—',
        amount: c.amount / 100,
        amountRefunded: (c.amount_refunded ?? 0) / 100,
        currency: c.currency,
        status,
        description: c.description ?? '',
        stripeUrl: `https://dashboard.stripe.com/charges/${c.id}`,
      }
    })

    return res.status(200).json({ charges: formatted })
  } catch (e) {
    console.error('[stripe/get-transactions] stripe error', e?.type, e?.message)
    return res.status(502).json({ error: 'stripe_error', detail: e?.message })
  }
}
