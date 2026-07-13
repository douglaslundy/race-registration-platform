"use client";

import { LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface LineChartPoint {
  label: string;
  value: number;
}

export default function LineChart({
  data,
  color = "#0ea5e9",
  height = 260,
  name,
}: {
  data: LineChartPoint[];
  color?: string;
  height?: number;
  name?: string;
}) {
  if (data.every((d) => d.value === 0)) {
    return <p className="text-sm text-gray-400 text-center py-8">Sem dados no período</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsLineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={30} />
        <Tooltip />
        <Line type="monotone" dataKey="value" name={name} stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}
