// GET /api/stripe/get-coupons
// Staff-only. Returns the list of Stripe Promotion Codes with their
// underlying coupon details + redemption count + active state.
//
// DEVIATION FROM SPEC: the original spec used stripe.coupons.list. Because
// we now use Stripe Promotion Codes (customer-facing) on top of coupons
// (internal), we list promotion codes instead — the "Code" column on the
// Finance page should show the human-typed strings (FOUNDER, FAMILY, …),
// not the internal coupon ids. Promotion code objects carry `.code`,
// `.coupon` (nested), `.times_redeemed`, `.active`.

import Stripe from 'stripe'
import { serviceClient, verifyStaff } from '../admin/_staff-auth.mjs'

function formatDiscount(coupon) {
  if (!coupon) return 'Discount applied'
  if (coupon.percent_off) {
    const suffix =
      coupon.duration === 'repeating'
        ? ` for ${coupon.duration_in_months} months`
        : coupon.duration === 'forever'
          ? ' forever'
          : ' first payment'
    return `${coupon.percent_off}% off${suffix}`
  }
  if (coupon.amount_off) {
    return `$${(coupon.amount_off / 100).toFixed(2)} off`
  }
  return 'Discount applied'
}

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
    const list = await stripe.promotionCodes.list({ limit: 100 })

    const formatted = list.data.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.coupon?.name || p.code,
      discount: formatDiscount(p.coupon),
      duration: p.coupon?.duration ?? null,
      durationMonths: p.coupon?.duration_in_months ?? null,
      timesRedeemed: p.times_redeemed,
      maxRedemptions: p.max_redemptions ?? null,
      active: p.active,
      created: p.created,
      couponDescription: p.coupon?.metadata?.description ?? null,
    }))

    return res.status(200).json({ promotionCodes: formatted })
  } catch (e) {
    console.error('[stripe/get-coupons] stripe error', e?.type, e?.message)
    return res.status(502).json({ error: 'stripe_error', detail: e?.message })
  }
}
