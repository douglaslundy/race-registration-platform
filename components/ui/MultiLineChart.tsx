"use client";

import { LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

// Paleta categórica validada (dataviz: banda de luminosidade, separação CVD e piso
// de visão normal OK; aviso de contraste coberto pela legenda + tooltip).
const SERIES_COLORS = ["#2a78d6", "#008300", "#e87ba4", "#eda100", "#1baf7a"];

export interface MultiSeriesPoint {
  label: string;
  [series: string]: string | number;
}

export default function MultiLineChart({
  data,
  series,
  height = 260,
}: {
  data: MultiSeriesPoint[];
  series: string[];
  height?: number;
}) {
  if (series.length === 0 || data.every((d) => series.every((s) => !d[s]))) {
    return <p className="text-sm text-gray-400 text-center py-8">Sem dados no período</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsLineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={30} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((name, i) => (
          <Line
            key={name}
            type="monotone"
            dataKey={name}
            name={name}
            stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}
