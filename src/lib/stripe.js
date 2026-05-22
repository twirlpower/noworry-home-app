import { loadStripe } from '@stripe/stripe-js'

// Client-side Stripe.js loader. `loadStripe` is async (script tag injection)
// and memoizes its result — calling it more than once is cheap.
//
// If the publishable key is missing we still call loadStripe with undefined
// so the `<Elements>` provider can mount; the actual Card element will
// surface a Stripe error to the user instead of crashing the page.
export const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? '')
