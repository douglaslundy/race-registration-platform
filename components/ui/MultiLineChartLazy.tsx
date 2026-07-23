"use client";

import dynamic from "next/dynamic";

const MultiLineChartLazy = dynamic(() => import("./MultiLineChart"), {
  ssr: false,
  loading: () => <div style={{ height: 260 }} />,
});

export default MultiLineChartLazy;
