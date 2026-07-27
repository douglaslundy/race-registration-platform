import { getSetting } from "@/lib/settings";
import type { AiTextProvider } from "./types";

const OPENAI_MODEL = "gpt-4o-mini";

export class OpenAiProvider implements AiTextProvider {
  async generateText(prompt: string): Promise<string> {
    const apiKey = await getSetting("ai_openai_api_key");
    if (!apiKey) throw new Error("Chave de API da OpenAI não configurada");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Falha ao gerar texto com OpenAI (${res.status}): ${body}`);
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new Error("Resposta inesperada da OpenAI");
    return text.trim();
  }
}
