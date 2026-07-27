import { getSetting } from "@/lib/settings";

export type AiProviderKey = "CLAUDE" | "OPENAI" | "GOOGLE";

export async function getAiProviderSetting(): Promise<AiProviderKey> {
  const value = await getSetting("ai_provider");
  if (value === "OPENAI" || value === "GOOGLE") return value;
  return "CLAUDE";
}
