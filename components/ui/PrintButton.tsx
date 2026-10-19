"use client";

// Tema escuro imprime texto claro sobre papel branco: tira a classe `dark` só durante a impressão.
function printLight() {
  const root = document.documentElement;
  const wasDark = root.classList.contains("dark");
  if (!wasDark) return window.print();
  root.classList.remove("dark");
  window.addEventListener("afterprint", () => root.classList.add("dark"), { once: true });
  window.print();
}

export default function PrintButton({ label = "Imprimir PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={printLight}
      className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 print:hidden"
    >
      {label}
    </button>
  );
}
