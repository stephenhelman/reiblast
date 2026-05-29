import Link from 'next/link'

const TOOLS = [
  {
    href: '/tools/analyzer',
    icon: '🧮',
    title: 'Deal Analyzer',
    description: 'Calculate MAO, deal score, and potential profit on any property in seconds.',
    available: true,
  },
  {
    href: '/tools/leads',
    icon: '📋',
    title: 'Lead Sourcing',
    description: 'Pull targeted lists from DealMachine and BatchLeads directly into your pipeline.',
    available: true,
  },
  {
    href: '/tools/jv',
    icon: '🤝',
    title: 'JV Submission',
    description: 'Submit JV opportunities to the REIblast network for a 50/50 split.',
    available: true,
  },
  {
    href: '#',
    icon: '🔄',
    title: 'CRM Sync',
    description: 'Sync your pipeline, contacts, and deals with your GHL sub-account.',
    available: false,
  },
]

export default function ToolsHomePage() {
  return (
    <div>
      <div className="mb-10">
        <h1 className="text-4xl font-bold text-white mb-2">Welcome to REIblast Tools</h1>
        <p className="text-white/50 text-lg">Your deal-closing toolkit, all in one place.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {TOOLS.map((tool) => (
          <div
            key={tool.title}
            className={`
              bg-surface border rounded-xl p-6 transition-all
              ${tool.available
                ? 'border-border-default hover:border-gold/40 cursor-pointer'
                : 'border-border-default opacity-50'
              }
            `}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="text-4xl">{tool.icon}</div>
              {!tool.available && (
                <span className="text-xs text-white/30 border border-white/10 px-2 py-1 rounded-full">
                  Coming Soon
                </span>
              )}
            </div>
            <h2 className="text-white font-semibold text-xl mb-2">{tool.title}</h2>
            <p className="text-white/50 text-sm mb-5 leading-relaxed">{tool.description}</p>
            {tool.available ? (
              <Link
                href={tool.href}
                className="inline-flex items-center gap-2 text-gold text-sm font-medium hover:gap-3 transition-all"
              >
                Open tool
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ) : (
              <span className="text-white/20 text-sm">Not yet available</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
