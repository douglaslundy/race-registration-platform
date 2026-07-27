import type { AiTextProvider } from "./types";
import { ClaudeProvider } from "./claude";
import { OpenAiProvider } from "./openai";
import { GoogleAiProvider } from "./google";
import { getAiProviderSetting } from "@/lib/ai-settings";

export async function getAiProvider(): Promise<AiTextProvider> {
  const provider = await getAiProviderSetting();
  if (provider === "OPENAI") return new OpenAiProvider();
  if (provider === "GOOGLE") return new GoogleAiProvider();
  return new ClaudeProvider();
}

export type { AiTextProvider } from "./types";
