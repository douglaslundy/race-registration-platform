export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { db } = await import("./lib/db");
    await db.$executeRaw`
      CREATE TABLE IF NOT EXISTS "platform_settings" (
        "key" TEXT NOT NULL,
        "value" TEXT NOT NULL,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
        CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
      )
    `;
  }
}
