// Dependency-free inline-SVG sparkline — the ~45-day usage curve doesn't
// need a charting library, and every other admin surface stays framework-free.
export default function Sparkline({ points, width = 320, height = 48 }: { points: number[]; width?: number; height?: number }) {
  if (points.length === 0) {
    return <div className="flex items-center text-xs text-white/30" style={{ height }}>No data in window</div>
  }
  const max = Math.max(...points, 1)
  const step = points.length > 1 ? width / (points.length - 1) : width
  const coords = points.map((p, i) => `${i * step},${height - (p / max) * height}`).join(' ')

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none">
      <polyline points={coords} fill="none" stroke="#F5C842" strokeWidth={2} />
    </svg>
  )
}
