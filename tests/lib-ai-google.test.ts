import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/settings", () => ({ getSetting: vi.fn() }));

import { GoogleAiProvider } from "@/lib/ai/google";
import { getSetting } from "@/lib/settings";

describe("GoogleAiProvider.generateText", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(global, "fetch" as any) as any;
  });

  it("lança erro quando a chave de API não está configurada", async () => {
    vi.mocked(getSetting).mockResolvedValueOnce(null);
    await expect(new GoogleAiProvider().generateText("prompt")).rejects.toThrow(
      "Chave de API do Google não configurada",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("chama a API do Gemini e retorna o texto gerado", async () => {
    vi.mocked(getSetting).mockResolvedValueOnce("google-key");
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "  Título gerado  " }] } }] }),
        { status: 200 },
      ),
    );

    const result = await new GoogleAiProvider().generateText("prompt");

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("generativelanguage.googleapis.com"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toBe("Título gerado");
  });

  it("lança erro quando a API retorna status de erro", async () => {
    vi.mocked(getSetting).mockResolvedValueOnce("google-key");
    fetchSpy.mockResolvedValueOnce(new Response("erro", { status: 500 }));
    await expect(new GoogleAiProvider().generateText("prompt")).rejects.toThrow(/Falha ao gerar texto com Google/);
  });
});
