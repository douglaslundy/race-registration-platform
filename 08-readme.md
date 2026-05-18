# README — Sistema de Inscrições Esportivas

## Descrição
Plataforma para gestão de inscrições em corridas de rua, com suporte futuro para outras modalidades esportivas.

## Rodando localmente
```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run dev
```

## Variáveis de ambiente esperadas
```env
DATABASE_URL=
AUTH_SECRET=
PAYMENT_PROVIDER=
PAYMENT_WEBHOOK_SECRET=
STORAGE_BUCKET=
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=
EMAIL_PROVIDER_API_KEY=
```

## Fluxos principais
1. Admin aprova organizador.
2. Organizador cadastra evento.
3. Admin aprova publicação.
4. Atleta faz inscrição.
5. Pagamento é confirmado via webhook.
6. Inscrição muda para paga.
7. Organizador exporta inscritos.
8. Resultado é importado e publicado.

## Observações jurídicas e operacionais
- Ajustar Termos de Uso, Política de Privacidade, Política de Reembolso e contrato com organizadores com advogado.
- Implementar LGPD desde o início.
- Definir responsabilidade da plataforma: intermediadora de inscrição, organizadora do evento ou ambas, conforme contrato.
