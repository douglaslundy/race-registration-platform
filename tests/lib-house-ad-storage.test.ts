import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteHouseAdImage } from "@/lib/ads/house-ad-storage";

describe("deleteHouseAdImage", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = "https://supabase.example.com";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_BUCKET = "uploads";
    fetchSpy = vi.spyOn(global, "fetch" as any).mockResolvedValue(new Response(null, { status: 200 })) as any;
  });

  it("extrai a key da URL pública e chama DELETE no endpoint do storage", async () => {
    await deleteHouseAdImage("https://supabase.example.com/storage/v1/object/public/uploads/house-ads/abc.png");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://supabase.example.com/storage/v1/object/uploads/house-ads/abc.png",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("não faz nada quando o storage não está configurado", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    await deleteHouseAdImage("https://supabase.example.com/storage/v1/object/public/uploads/house-ads/abc.png");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("não faz nada quando a URL não bate com o formato esperado", async () => {
    await deleteHouseAdImage("https://outro-dominio.com/arquivo.png");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("nunca lança erro quando o delete falha (best-effort)", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network down"));
    await expect(
      deleteHouseAdImage("https://supabase.example.com/storage/v1/object/public/uploads/house-ads/abc.png"),
    ).resolves.toBeUndefined();
  });
});
