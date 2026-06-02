const checkoutUrl = process.env.NEXT_PUBLIC_CHECKOUT_URL
if (!checkoutUrl) console.warn('NEXT_PUBLIC_CHECKOUT_URL is not set')
const paymentLink = checkoutUrl ?? '#'

const INCLUDED = [
  'Full CRM with pre-built wholesale pipeline',
  'Locked SMS follow-up sequences',
  'Universal wholesale purchase contract',
  'Built-in e-signature',
  'Deal analyzer with MAO calculator',
  'JV deal submission network',
  'A2P-compliant phone number',
  'Dedicated tools portal',
  'New templates and tools monthly',
]

export default function Pricing() {
  return (
    <section id="pricing" className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
            Simple, <span className="text-gold">transparent</span> pricing
          </h2>
          <p className="text-white/50 text-xl">One plan. Everything included.</p>
        </div>

        <div className="max-w-md mx-auto">
          <div className="bg-surface border-2 border-gold rounded-2xl p-8 relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-gold text-black text-xs font-bold px-4 py-1.5 rounded-bl-xl">
              MOST POPULAR
            </div>

            <div className="mb-6">
              <p className="text-gold font-semibold text-sm uppercase tracking-wider mb-2">REIblast Core</p>
              <div className="flex items-baseline gap-2">
                <span className="text-5xl font-bold text-white">$57</span>
                <span className="text-white/50 text-xl">/mo</span>
              </div>
              <p className="text-white/40 text-sm mt-1">Cancel anytime</p>
            </div>

            <ul className="space-y-3 mb-8">
              {INCLUDED.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-gold shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span className="text-white/80 text-sm">{item}</span>
                </li>
              ))}
            </ul>

            <a
              href={paymentLink}
              className="block w-full bg-gold text-black font-bold text-center py-4 rounded-xl hover:bg-gold-hover transition-colors"
            >
              Get Started — $57/mo
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
