"use client";

import { useEffect } from "react";

export default function AutoPrint() {
  useEffect(() => {
    window.print();
  }, []);

  return null;
}
