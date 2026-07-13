interface LineChartPoint {
  label: string;
  value: number;
}

export default function LineChart({
  data,
  color = "#0ea5e9",
  height = 160,
}: {
  data: LineChartPoint[];
  color?: string;
  height?: number;
}) {
  if (data.every((d) => d.value === 0)) {
    return <p className="text-sm text-gray-400 text-center py-8">Sem dados no período</p>;
  }

  const width = 600;
  const padding = 20;
  const max = Math.max(...data.map((d) => d.value), 1);
  const stepX = data.length > 1 ? (width - padding * 2) / (data.length - 1) : 0;
  const points = data
    .map((d, i) => `${padding + i * stepX},${height - padding - (d.value / max) * (height - padding * 2)}`)
    .join(" ");

  const firstLabel = data[0]?.label ?? "";
  const lastLabel = data[data.length - 1]?.label ?? "";
  const midLabel = data[Math.floor(data.length / 2)]?.label ?? "";

  return (
    <svg viewBox={`0 0 ${width} ${height + 20}`} className="w-full h-auto" role="img">
      <polyline points={points} fill="none" stroke={color} strokeWidth={2} />
      <text x={padding} y={height + 15} fontSize="10" fill="currentColor" className="text-gray-400">{firstLabel}</text>
      <text x={width / 2} y={height + 15} fontSize="10" textAnchor="middle" fill="currentColor" className="text-gray-400">{midLabel}</text>
      <text x={width - padding} y={height + 15} fontSize="10" textAnchor="end" fill="currentColor" className="text-gray-400">{lastLabel}</text>
    </svg>
  );
}
