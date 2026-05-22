// GET /api/stripe/get-finance-summary
// Staff-only. Returns:
//   mrr               — sum of unit_amount across active subscription items
//                        (list price, ignores per-sub discounts — see note)
//   activeSubscribers — count of active subscriptions
//   revenueThisMonth  — sum of succeeded charges since the 1st of this month
//   revenueLastMonth  — same, for the prior calendar month
//   momChange         — percent delta vs last month, null if last month was $0
//
// Note on MRR: Stripe's subscription list includes the LIST price, not the
// post-discount monthly take. For an exact post-discount MRR, you'd need
// stripe.invoiceItems or sub.upcoming_invoice per row — meaningfully more
// work and rate-limit-heavier. List MRR is what most finance dashboards
// surface; the actual cash collected is reflected in the monthly revenue
// figures, which DO include discounts.

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
    const subscriptions = await stripe.subscriptions.list({
      status: 'active',
      limit: 100,
      expand: ['data.items.data.price'],
    })

    const mrr = subscriptions.data.reduce((sum, sub) => {
      const subAmount = sub.items.data.reduce(
        (s, item) => s + ((item.price?.unit_amount ?? 0) * (item.quantity ?? 1)) / 100,
        0
      )
      return sum + subAmount
    }, 0)

    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)

    const [thisMonth, lastMonth] = await Promise.all([
      stripe.charges.list({
        created: { gte: Math.floor(startOfMonth.getTime() / 1000) },
        limit: 100,
      }),
      stripe.charges.list({
        created: {
          gte: Math.floor(startOfLastMonth.getTime() / 1000),
          lt:  Math.floor(startOfMonth.getTime() / 1000),
        },
        limit: 100,
      }),
    ])

    const revenueThisMonth = thisMonth.data
      .filter((c) => c.status === 'succeeded')
      .reduce((s, c) => s + c.amount / 100, 0)

    const revenueLastMonth = lastMonth.data
      .filter((c) => c.status === 'succeeded')
      .reduce((s, c) => s + c.amount / 100, 0)

    const momChange = revenueLastMonth > 0
      ? parseFloat(
          (((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100).toFixed(1)
        )
      : null

    return res.status(200).json({
      mrr,
      activeSubscribers: subscriptions.data.length,
      revenueThisMonth,
      revenueLastMonth,
      momChange,
    })
  } catch (e) {
    console.error('[stripe/get-finance-summary] stripe error', e?.type, e?.message)
    return res.status(502).json({ error: 'stripe_error', detail: e?.message })
  }
}
