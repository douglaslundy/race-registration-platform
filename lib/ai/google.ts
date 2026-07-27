import { getSetting } from "@/lib/settings";
import type { AiTextProvider } from "./types";

const GOOGLE_MODEL = "gemini-1.5-flash";

export class GoogleAiProvider implements AiTextProvider {
  async generateText(prompt: string): Promise<string> {
    const apiKey = await getSetting("ai_google_api_key");
    if (!apiKey) throw new Error("Chave de API do Google não configurada");

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Falha ao gerar texto com Google (${res.status}): ${body}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") throw new Error("Resposta inesperada do Google");
    return text.trim();
  }
}
