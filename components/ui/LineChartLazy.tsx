"use client";

import dynamic from "next/dynamic";

const LineChartLazy = dynamic(() => import("./LineChart"), {
  ssr: false,
  loading: () => <div style={{ height: 260 }} />,
});

export default LineChartLazy;
