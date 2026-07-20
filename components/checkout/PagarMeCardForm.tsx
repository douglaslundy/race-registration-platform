"use client";

import { useRef, useImperativeHandle, forwardRef } from "react";

export interface PagarMeCardFormHandle {
  getToken(): Promise<{ token: string; installments: number }>;
}

interface Props {
  publicKey: string;
  amount: number;
}

const PagarMeCardForm = forwardRef<PagarMeCardFormHandle, Props>(({ publicKey, amount }, ref) => {
  const cardNumberRef = useRef<HTMLInputElement>(null);
  const holderNameRef = useRef<HTMLInputElement>(null);
  const expiryRef = useRef<HTMLInputElement>(null);
  const cvvRef = useRef<HTMLInputElement>(null);
  const installmentsRef = useRef<HTMLSelectElement>(null);

  useImperativeHandle(ref, () => ({
    async getToken() {
      const cardNumber = cardNumberRef.current?.value?.replace(/\s/g, "").trim() ?? "";
      const holderName = holderNameRef.current?.value?.trim() ?? "";
      const expiry = expiryRef.current?.value?.trim() ?? "";
      const cvv = cvvRef.current?.value?.trim() ?? "";
      const installments = parseInt(installmentsRef.current?.value ?? "1");

      if (!cardNumber) throw new Error("Informe o número do cartão");
      if (!holderName) throw new Error("Informe o nome no cartão");
      if (!expiry || !/^\d{2}\/\d{2}$/.test(expiry)) throw new Error("Informe a validade no formato MM/AA");
      if (!cvv) throw new Error("Informe o CVV");

      const [expMonth, expYearShort] = expiry.split("/");
      const expYear = `20${expYearShort}`;

      const res = await fetch(`https://api.pagar.me/core/v5/tokens?appId=${encodeURIComponent(publicKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "card",
          card: {
            number: cardNumber,
            holder_name: holderName,
            exp_month: parseInt(expMonth),
            exp_year: parseInt(expYear),
            cvv,
          },
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message ?? `Erro ao tokenizar cartão (${res.status})`);
      }

      const data = await res.json();
      if (!data.id) throw new Error("Resposta inválida do tokenizador");

      return { token: String(data.id), installments };
    },
  }));

  function formatCardNumber(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, "").slice(0, 16);
    e.target.value = raw.replace(/(.{4})/g, "$1 ").trim();
  }

  function formatExpiry(e: React.ChangeEvent<HTMLInputElement>) {
    let raw = e.target.value.replace(/\D/g, "").slice(0, 4);
    if (raw.length > 2) raw = `${raw.slice(0, 2)}/${raw.slice(2)}`;
    e.target.value = raw;
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Número do cartão</label>
        <input
          ref={cardNumberRef}
          type="text"
          inputMode="numeric"
          className="input-field w-full"
          placeholder="0000 0000 0000 0000"
          maxLength={19}
          onChange={formatCardNumber}
          autoComplete="off"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome no cartão</label>
        <input
          ref={holderNameRef}
          type="text"
          className="input-field w-full"
          placeholder="Como aparece no cartão"
          autoComplete="off"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Validade</label>
          <input
            ref={expiryRef}
            type="text"
            inputMode="numeric"
            className="input-field w-full"
            placeholder="MM/AA"
            maxLength={5}
            onChange={formatExpiry}
            autoComplete="off"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CVV</label>
          <input
            ref={cvvRef}
            type="text"
            inputMode="numeric"
            className="input-field w-full"
            placeholder="123"
            maxLength={4}
            autoComplete="off"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Parcelas</label>
        <select ref={installmentsRef} className="input-field w-full" defaultValue="1">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}x de {((amount / 100) / n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              {n === 1 ? " (sem juros)" : ""}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
});

PagarMeCardForm.displayName = "PagarMeCardForm";
export default PagarMeCardForm;
