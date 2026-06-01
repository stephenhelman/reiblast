const PAIN_POINTS = [
  {
    text: 'Tired of juggling 3-5 different resources just to get one deal done?',
  },
  {
    text: 'Spending weeks waiting for A2P approval?',
  },
  {
    text: 'No system to go from list to first text in one session?',
  },
]

const FEATURES = [
  {
    icon: '⚡',
    title: 'Pre-Built Pipeline',
    description: 'A full CRM pipeline configured for wholesaling out of the box. No setup required.',
  },
  {
    icon: '📱',
    title: 'Locked SMS Sequences',
    description: 'Battle-tested follow-up sequences pre-loaded. Start texting your list same day.',
  },
  {
    icon: '📄',
    title: 'Universal Wholesale Contract',
    description: 'Jurisdiction-ready purchase and sale agreement. Just fill and send.',
  },
  {
    icon: '✍️',
    title: 'E-Sign Built In',
    description: 'Send contracts for signature without leaving your dashboard. Close faster.',
  },
  {
    icon: '🧮',
    title: 'Deal Analyzer',
    description: 'Instant MAO calculation and deal scoring so you never overpay for a deal.',
  },
  {
    icon: '🤝',
    title: 'JV Deal Submission',
    description: 'Got a deal but need a buyer? Submit JV opportunities directly to the network.',
  },
]

const STEPS = [
  { number: '01', label: 'Get Your List' },
  { number: '02', label: 'Blast Your Market' },
  { number: '03', label: 'Work Your Leads' },
  { number: '04', label: 'Close and Assign' },
]

export default function Features() {
  return (
    <>
      {/* Pain points strip */}
      <section className="py-16 px-6 border-y border-border-default bg-surface">
        <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-6">
          {PAIN_POINTS.map((p) => (
            <div
              key={p.text}
              className="bg-surface border-l-4 border-gold rounded-r-xl px-6 py-5"
            >
              <p className="text-white/80 text-base">{p.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features grid */}
      <section id="features" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
              Everything in <span className="text-gold">one system</span>
            </h2>
            <p className="text-white/50 text-xl max-w-2xl mx-auto">
              Built specifically for wholesalers who are serious about volume.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="bg-surface border border-border-default rounded-xl p-6 hover:border-gold/40 transition-colors"
              >
                <div className="text-3xl mb-4">{f.icon}</div>
                <h3 className="text-white font-semibold text-lg mb-2">{f.title}</h3>
                <p className="text-white/50 text-sm leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 px-6 bg-surface border-y border-border-default">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
              How it <span className="text-gold">works</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-4 gap-0">
            {STEPS.map((step, i) => (
              <div key={step.number} className="flex flex-col items-center text-center relative">
                {i < STEPS.length - 1 && (
                  <div className="hidden md:block absolute top-6 left-1/2 w-full h-px bg-gold/30" />
                )}
                <div className="relative z-10 w-12 h-12 rounded-full bg-gold text-black font-bold text-lg flex items-center justify-center mb-4">
                  {step.number}
                </div>
                <p className="text-white font-semibold text-base">{step.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
