"use client";

import { useEffect, useRef, useImperativeHandle, forwardRef, useState } from "react";

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    MercadoPago: new (publicKey: string, options?: Record<string, unknown>) => any;
  }
}

export interface MPCardFormHandle {
  getToken(cpf: string): Promise<{ token: string; paymentMethodId: string; installments: number }>;
}

interface Props {
  publicKey: string;
  amount: number;
}

const MPCardForm = forwardRef<MPCardFormHandle, Props>(({ publicKey, amount }, ref) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mpRef = useRef<any>(null);
  const holderNameRef = useRef<HTMLInputElement>(null);
  const installmentsRef = useRef<HTMLSelectElement>(null);
  const paymentMethodIdRef = useRef<string>("");
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    async getToken(cpf: string) {
      if (!mpRef.current) throw new Error("SDK do Mercado Pago não carregado");
      const holderName = holderNameRef.current?.value?.trim();
      if (!holderName) throw new Error("Informe o nome do titular do cartão");
      const installments = parseInt(installmentsRef.current?.value ?? "1");

      const cleanCpf = cpf.replace(/\D/g, "");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await mpRef.current.fields.createCardToken({
        cardholderName: holderName,
        ...(cleanCpf ? { identificationType: "CPF", identificationNumber: cleanCpf } : {}),
      });

      return {
        token: result.id as string,
        // payment_method_id may not be in the token result with individual fields;
        // use what was captured from binChange event instead
        paymentMethodId: (result.payment_method_id || paymentMethodIdRef.current) as string,
        installments,
      };
    },
  }));

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fields: any[] = [];

    const script = document.createElement("script");
    script.src = "https://sdk.mercadopago.com/js/v2";
    script.onload = () => {
      if (cancelled) return;
      try {
        const mp = new window.MercadoPago(publicKey, { locale: "pt-BR" });
        mpRef.current = mp;

        const cardNumber = mp.fields.create("cardNumber", { placeholder: "0000 0000 0000 0000" });
        cardNumber.mount("mp-card-number");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cardNumber.on("binChange", (data: any) => {
          paymentMethodIdRef.current = data?.paymentMethodId ?? "";
        });
        fields.push(cardNumber);

        const expirationDate = mp.fields.create("expirationDate", { placeholder: "MM/AA" });
        expirationDate.mount("mp-expiration-date");
        fields.push(expirationDate);

        const securityCode = mp.fields.create("securityCode", { placeholder: "CVV" });
        securityCode.mount("mp-security-code");
        fields.push(securityCode);

        if (!cancelled) setSdkReady(true);
      } catch (e) {
        if (!cancelled) setSdkError(e instanceof Error ? e.message : "Erro ao inicializar SDK");
      }
    };
    script.onerror = () => {
      if (!cancelled) setSdkError("Falha ao carregar SDK do Mercado Pago");
    };
    document.head.appendChild(script);

    return () => {
      cancelled = true;
      fields.forEach((f) => { try { f.unmount(); } catch { /* ignore */ } });
      if (document.head.contains(script)) document.head.removeChild(script);
      mpRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey]);

  return (
    <div className="space-y-3">
      {sdkError && (
        <p className="text-xs text-red-600">{sdkError}</p>
      )}
      {!sdkReady && !sdkError && (
        <p className="text-xs text-gray-500 dark:text-gray-400">Carregando formulário seguro...</p>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Número do cartão</label>
        <div
          id="mp-card-number"
          className="input-field h-10 flex items-center"
          style={{ minHeight: "40px" }}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome no cartão</label>
        <input
          ref={holderNameRef}
          type="text"
          className="input-field w-full"
          placeholder="Como aparece no cartão"
          autoComplete="cc-name"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Validade</label>
          <div
            id="mp-expiration-date"
            className="input-field h-10 flex items-center"
            style={{ minHeight: "40px" }}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CVV</label>
          <div
            id="mp-security-code"
            className="input-field h-10 flex items-center"
            style={{ minHeight: "40px" }}
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
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Juros conforme política do Mercado Pago.</p>
      </div>
    </div>
  );
});

MPCardForm.displayName = "MPCardForm";
export default MPCardForm;
