import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/settings", () => ({ getSetting: vi.fn() }));

import { OpenAiProvider } from "@/lib/ai/openai";
import { getSetting } from "@/lib/settings";

describe("OpenAiProvider.generateText", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(global, "fetch" as any) as any;
  });

  it("lança erro quando a chave de API não está configurada", async () => {
    vi.mocked(getSetting).mockResolvedValueOnce(null);
    await expect(new OpenAiProvider().generateText("prompt")).rejects.toThrow(
      "Chave de API da OpenAI não configurada",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("chama a API da OpenAI e retorna o texto gerado", async () => {
    vi.mocked(getSetting).mockResolvedValueOnce("sk-test");
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: "  Título gerado  " } }] }), { status: 200 }),
    );

    const result = await new OpenAiProvider().generateText("prompt");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
      }),
    );
    expect(result).toBe("Título gerado");
  });

  it("lança erro quando a API retorna status de erro", async () => {
    vi.mocked(getSetting).mockResolvedValueOnce("sk-test");
    fetchSpy.mockResolvedValueOnce(new Response("erro", { status: 500 }));
    await expect(new OpenAiProvider().generateText("prompt")).rejects.toThrow(/Falha ao gerar texto com OpenAI/);
  });
});
