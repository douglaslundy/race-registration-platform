import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/settings", () => ({ getSetting: vi.fn() }));

import { ClaudeProvider } from "@/lib/ai/claude";
import { getSetting } from "@/lib/settings";

describe("ClaudeProvider.generateText", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(global, "fetch" as any) as any;
  });

  it("lança erro quando a chave de API não está configurada", async () => {
    vi.mocked(getSetting).mockResolvedValueOnce(null);
    await expect(new ClaudeProvider().generateText("prompt")).rejects.toThrow(
      "Chave de API do Claude não configurada",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("chama a API do Claude e retorna o texto gerado", async () => {
    vi.mocked(getSetting).mockResolvedValueOnce("sk-ant-test");
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ content: [{ text: "  Título gerado  " }] }), { status: 200 }),
    );

    const result = await new ClaudeProvider().generateText("prompt");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-key": "sk-ant-test" }),
      }),
    );
    expect(result).toBe("Título gerado");
  });

  it("lança erro quando a API retorna status de erro", async () => {
    vi.mocked(getSetting).mockResolvedValueOnce("sk-ant-test");
    fetchSpy.mockResolvedValueOnce(new Response("erro", { status: 500 }));
    await expect(new ClaudeProvider().generateText("prompt")).rejects.toThrow(/Falha ao gerar texto com Claude/);
  });
});
