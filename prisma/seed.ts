import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_LEGAL_PRIVACY, DEFAULT_LEGAL_TERMS, LEGAL_CONTENT_UPDATED_AT } from "../lib/legal-content";

const db = new PrismaClient();

async function ensurePlatformSetting(key: string, value: string) {
  const existing = await db.platformSetting.findUnique({ where: { key } });
  if (!existing || !existing.value.trim()) {
    await db.platformSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
}

async function main() {
  console.log("🌱 Iniciando seed...");

  const defaultHash = await bcrypt.hash("12345678", 12);

  // Admin
  const adminHash = defaultHash;
  const admin = await db.user.upsert({
    where: { email: "admin@corridasapp.com.br" },
    update: {},
    create: {
      name: "Administrador",
      email: "admin@corridasapp.com.br",
      passwordHash: adminHash,
      role: "ADMIN",
    },
  });
  console.log("✅ Admin criado:", admin.email);

  // Organizador
  const orgHash = defaultHash;
  const orgUser = await db.user.upsert({
    where: { email: "organizador@exemplo.com.br" },
    update: {},
    create: {
      name: "Organização Exemplo",
      email: "organizador@exemplo.com.br",
      passwordHash: orgHash,
      role: "ORGANIZER",
    },
  });

  await db.organizerProfile.upsert({
    where: { userId: orgUser.id },
    update: {},
    create: {
      userId: orgUser.id,
      companyName: "Organização Esportiva Exemplo Ltda",
      cnpj: "00.000.000/0001-00",
      phone: "(11) 99999-0000",
      website: "https://exemplo.com.br",
      bio: "Organizamos eventos esportivos em todo o Brasil.",
      verified: true,
    },
  });
  console.log("✅ Organizador criado:", orgUser.email);

  console.log("✅ Seeds iniciais de usuários e conteúdo legal criados.");

  // Atleta de exemplo
  const athleteHash = defaultHash;
  const athlete = await db.user.upsert({
    where: { email: "atleta@exemplo.com.br" },
    update: {},
    create: {
      name: "João Silva",
      email: "atleta@exemplo.com.br",
      passwordHash: athleteHash,
      role: "ATHLETE",
    },
  });
  await db.athleteProfile.upsert({
    where: { userId: athlete.id },
    update: {},
    create: {
      userId: athlete.id,
      phone: "(11) 98888-0001",
      gender: "M",
      city: "São Paulo",
      state: "SP",
      emergencyName: "Maria Silva",
      emergencyPhone: "(11) 97777-0001",
      preferredShirtSize: "M",
    },
  });
  console.log("✅ Atleta criado:", athlete.email);

  // Usuários adicionais
  await db.user.upsert({
    where: { email: "douglaslundy@gmail.com" },
    update: {},
    create: { name: "Douglas Lundy", email: "douglaslundy@gmail.com", passwordHash: defaultHash, role: "ATHLETE" },
  });
  await db.user.upsert({
    where: { email: "dlsistemas100@gmail.com" },
    update: {},
    create: { name: "Douglas Lundy", email: "dlsistemas100@gmail.com", passwordHash: defaultHash, role: "ORGANIZER" },
  });

  await Promise.all([
    ensurePlatformSetting("legal.terms_content", DEFAULT_LEGAL_TERMS),
    ensurePlatformSetting("legal.terms_updated", LEGAL_CONTENT_UPDATED_AT),
    ensurePlatformSetting("legal.privacy_content", DEFAULT_LEGAL_PRIVACY),
    ensurePlatformSetting("legal.privacy_updated", LEGAL_CONTENT_UPDATED_AT),
  ]);

  const { seedMessageTemplatesFromRegistry } = await import("../lib/templates/seed");
  const templateResult = await seedMessageTemplatesFromRegistry();
  console.log(`✅ Templates de mensagem: ${templateResult.created} criados, ${templateResult.skipped} já existiam`);

  console.log("\n🎉 Seed concluído!");
  console.log("\nTodos os usuários usam senha: 12345678");
  console.log("  Admin:       admin@corridasapp.com.br");
  console.log("  Organizador: organizador@exemplo.com.br");
  console.log("  Atleta:      atleta@exemplo.com.br");
  console.log("  Douglas:     douglaslundy@gmail.com");
  console.log("  Douglas:     dlsistemas100@gmail.com");
  console.log("\nCupom de desconto: BEMVINDO10 (10% off)");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
