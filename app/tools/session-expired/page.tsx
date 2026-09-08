import MinimalHeader from '@/components/tools/MinimalHeader'

export default function SessionExpiredPage() {
  return (
    <div className="min-h-screen bg-black">
      <MinimalHeader title="REIblast Tools" />
      <div className="flex items-center justify-center px-6 py-20">
        <div className="w-full max-w-sm rounded-2xl border border-border-default bg-surface p-8 text-center">
          <h1 className="mb-2 text-xl font-bold text-white">Session expired</h1>
          <p className="text-sm leading-relaxed text-white/50">
            Please reopen this tool from your CRM menu to continue.
          </p>
        </div>
      </div>
    </div>
  )
}
