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

  const organizer = await db.organizerProfile.upsert({
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

  // Evento de exemplo
  const startAt = new Date();
  startAt.setDate(startAt.getDate() + 30);

  const event = await db.event.upsert({
    where: { slug: "corrida-das-pedras-2025" },
    update: {},
    create: {
      organizerId: organizer.id,
      title: "Corrida das Pedras 2025",
      slug: "corrida-das-pedras-2025",
      description:
        "A maior corrida de rua da região! Percursos de 5km, 10km e 21km para todos os níveis. Venha fazer parte deste evento incrível com largada no Parque Central.",
      modality: "ROAD_RACE",
      status: "REGISTRATIONS_OPEN",
      startAt,
      venueName: "Parque Central",
      addressLine: "Av. das Palmeiras, 1000",
      city: "São Paulo",
      state: "SP",
      publishedAt: new Date(),
    },
  });

  // Percursos
  const route5k = await db.eventRoute.upsert({
    where: { id: "route-5k-pedras-2025" },
    update: {},
    create: {
      id: "route-5k-pedras-2025",
      eventId: event.id,
      name: "5km",
      distanceKm: 5,
      description: "Percurso plano, ideal para iniciantes.",
    },
  });
  const route10k = await db.eventRoute.upsert({
    where: { id: "route-10k-pedras-2025" },
    update: {},
    create: {
      id: "route-10k-pedras-2025",
      eventId: event.id,
      name: "10km",
      distanceKm: 10,
      description: "Percurso moderado com uma subida no km 7.",
    },
  });

  // Categorias
  await db.eventCategory.upsert({
    where: { id: "cat-geral-pedras" },
    update: {},
    create: { id: "cat-geral-pedras", eventId: event.id, name: "Geral" },
  });
  await db.eventCategory.upsert({
    where: { id: "cat-master-pedras" },
    update: {},
    create: { id: "cat-master-pedras", eventId: event.id, name: "Master 40+", minAge: 40 },
  });

  // Lotes
  const batchStart = new Date();
  const batchEnd = new Date();
  batchEnd.setDate(batchEnd.getDate() + 20);

  await db.ticketBatch.upsert({
    where: { id: "batch-early-5k" },
    update: {},
    create: {
      id: "batch-early-5k",
      eventId: event.id,
      name: "1º Lote — 5km",
      priceAmount: 8000,
      capacity: 200,
      startAt: batchStart,
      endAt: batchEnd,
    },
  });
  await db.ticketBatch.upsert({
    where: { id: "batch-early-10k" },
    update: {},
    create: {
      id: "batch-early-10k",
      eventId: event.id,
      name: "1º Lote — 10km",
      priceAmount: 12000,
      capacity: 300,
      startAt: batchStart,
      endAt: batchEnd,
    },
  });

  // Cupom de exemplo
  await db.coupon.upsert({
    where: { id: "coupon-boas-vindas" },
    update: {},
    create: {
      id: "coupon-boas-vindas",
      eventId: event.id,
      code: "BEMVINDO10",
      discountType: "PERCENT",
      discountValue: 10,
      maxUses: 50,
      expiresAt: batchEnd,
    },
  });

  console.log("✅ Evento criado:", event.title);

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
