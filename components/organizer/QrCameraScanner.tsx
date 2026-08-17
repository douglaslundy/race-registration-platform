"use client";

import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";

export default function QrCameraScanner({
  onScan,
  onClose,
}: {
  onScan: (value: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    const scanner = new QrScanner(
      videoRef.current,
      (result) => {
        onScan(result.data);
        onClose();
      },
      { highlightScanRegion: true, highlightCodeOutline: true },
    );
    scanner.start().catch(() => setError("Não foi possível acessar a câmera. Verifique a permissão do navegador."));
    return () => scanner.destroy();
  }, [onScan, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-xl p-4 max-w-sm w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Escanear QR code</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Fechar">
            ✕
          </button>
        </div>
        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
        <video ref={videoRef} className="w-full rounded-lg" />
      </div>
    </div>
  );
}
