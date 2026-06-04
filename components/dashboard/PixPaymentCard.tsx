"use client";

interface PixPaymentCardProps {
  pixQrCodeText: string;
  expiresAt?: string | null;
}

export default function PixPaymentCard({ pixQrCodeText, expiresAt }: PixPaymentCardProps) {
  return (
    <div className="card space-y-3">
      <h3 className="font-semibold text-gray-900">Pague via Pix</h3>
      <p className="text-sm text-gray-600">Copie o código abaixo e cole no app do seu banco:</p>
      <div className="bg-gray-50 border rounded-lg p-3 font-mono text-xs break-all select-all">
        {pixQrCodeText}
      </div>
      <button
        type="button"
        onClick={() => navigator.clipboard.writeText(pixQrCodeText)}
        className="btn-secondary w-full text-sm"
      >
        Copiar código Pix
      </button>
      {expiresAt && (
        <p className="text-xs text-gray-500 text-center">
          Expira em: {new Date(expiresAt).toLocaleString("pt-BR")}
        </p>
      )}
    </div>
  );
}
