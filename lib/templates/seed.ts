import { db } from "@/lib/db";
import { ALERT_REGISTRY } from "./registry";

export async function seedMessageTemplatesFromRegistry(): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  for (const def of Object.values(ALERT_REGISTRY)) {
    for (const channel of def.channels) {
      for (const recipientRole of def.recipientRoles) {
        const existing = await db.messageTemplate.findFirst({
          where: { alertKey: def.alertKey, channel, recipientRole, scope: "GLOBAL", eventId: null },
          select: { id: true },
        });
        if (existing) {
          skipped++;
          continue;
        }
        const { subject, body } = def.factoryDefault(channel, recipientRole);
        await db.messageTemplate.create({
          data: { alertKey: def.alertKey, channel, recipientRole, scope: "GLOBAL", subject, body, active: true },
        });
        created++;
      }
    }
  }

  return { created, skipped };
}

/**
 * Re-sincroniza com o registry qualquer linha GLOBAL que nunca foi customizada pelo admin.
 *
 * `seedMessageTemplatesFromRegistry` cria linhas na primeira vez e pula todo o resto pra sempre —
 * então quando o texto de `factoryDefault` de um alerta muda numa release (correção de bug, texto
 * melhor), as linhas já seedadas em produção continuam servindo o texto ANTIGO indefinidamente
 * (getEffectiveTemplate dá precedência à linha do banco). Esta função resolve isso, mas só onde é
 * seguro: uma linha só é atualizada se ela tiver ZERO registros em MessageTemplateVersion. Todo
 * save via PUT /api/admin/message-templates/[id] e todo revert sempre cria uma versão da PRIOR
 * content antes de sobrescrever — logo, zero versões significa, por construção, que a linha nunca
 * foi editada por um admin desde que foi criada (seja pelo seed original ou por uma chamada
 * anterior desta mesma função). Isso torna a função idempotente e segura de rodar em todo deploy
 * futuro que mude um texto de fábrica, não só neste.
 */
export async function refreshUnmodifiedTemplatesFromRegistry(): Promise<{ refreshed: number; skipped: number }> {
  let refreshed = 0;
  let skipped = 0;

  for (const def of Object.values(ALERT_REGISTRY)) {
    for (const channel of def.channels) {
      for (const recipientRole of def.recipientRoles) {
        const existing = await db.messageTemplate.findFirst({
          where: { alertKey: def.alertKey, channel, recipientRole, scope: "GLOBAL", eventId: null },
          select: { id: true, subject: true, body: true },
        });
        if (!existing) {
          skipped++;
          continue;
        }
        const versionCount = await db.messageTemplateVersion.count({ where: { templateId: existing.id } });
        if (versionCount > 0) {
          // Alguém já editou este template pelo admin — nunca sobrescrever uma customização real.
          skipped++;
          continue;
        }
        const { subject, body } = def.factoryDefault(channel, recipientRole);
        if ((existing.subject ?? null) === (subject ?? null) && existing.body === body) {
          skipped++;
          continue;
        }
        await db.messageTemplate.update({ where: { id: existing.id }, data: { subject: subject ?? null, body } });
        refreshed++;
      }
    }
  }

  return { refreshed, skipped };
}
