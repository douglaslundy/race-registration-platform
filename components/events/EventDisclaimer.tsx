export default function EventDisclaimer({ appName }: { appName: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 p-4 text-sm text-amber-800 dark:text-amber-300 space-y-2">
      <p>
        <strong>{appName}</strong> não é responsável pela organização e realização deste evento. Apenas gerenciamos o processo de inscrição online.
      </p>
      <p>
        Caso tenha dúvidas sobre o evento, pedido de reembolso, alteração cadastral ou outras informações, contate o organizador.
      </p>
    </div>
  );
}
