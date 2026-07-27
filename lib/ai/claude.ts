import { getSetting } from "@/lib/settings";
import type { AiTextProvider } from "./types";

const CLAUDE_MODEL = "claude-haiku-4-5-20251001";

export class ClaudeProvider implements AiTextProvider {
  async generateText(prompt: string): Promise<string> {
    const apiKey = await getSetting("ai_claude_api_key");
    if (!apiKey) throw new Error("Chave de API do Claude não configurada");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Falha ao gerar texto com Claude (${res.status}): ${body}`);
    }

    const data = await res.json();
    const text = data?.content?.[0]?.text;
    if (typeof text !== "string") throw new Error("Resposta inesperada do Claude");
    return text.trim();
  }
}
