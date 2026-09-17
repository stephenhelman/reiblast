export default function StatTile({
  label,
  value,
  sublabel,
  tone = 'default',
}: {
  label: string
  value: string
  sublabel?: string
  tone?: 'default' | 'good' | 'bad'
}) {
  const valueColor = tone === 'good' ? 'text-green' : tone === 'bad' ? 'text-red' : 'text-white'
  return (
    <div className="rounded-xl border border-border-default bg-surface p-5">
      <p className="text-xs uppercase tracking-wide text-white/40">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${valueColor}`}>{value}</p>
      {sublabel && <p className="mt-1 text-xs text-white/40">{sublabel}</p>}
    </div>
  )
}
