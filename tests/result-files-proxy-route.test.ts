import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

import { GET } from "@/app/api/result-files/[fileId]/route";

const findUniqueMock = (db as any).eventResultFile.findUnique as ReturnType<typeof vi.fn>;

function ctx(fileId: string) {
  return { params: Promise.resolve({ fileId }) };
}
const req = new Request("http://localhost/api/result-files/f1") as any;

describe("GET /api/result-files/[fileId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = "https://supabase.circuitodascorridas.com.br";
    findUniqueMock.mockResolvedValue({
      fileUrl: "https://supabase.circuitodascorridas.com.br/storage/v1/object/public/uploads/result_pdf/abc.pdf",
      label: "5KM - Geral Masculino",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("404 quando o PDF não existe", async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    const res = await GET(req, ctx("nope"));
    expect(res.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("404 quando a fileUrl não é do storage público configurado (guarda anti-SSRF)", async () => {
    findUniqueMock.mockResolvedValueOnce({ fileUrl: "http://169.254.169.254/latest/meta-data", label: "x" });
    const res = await GET(req, ctx("f1"));
    expect(res.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("faz proxy do PDF inline pelo domínio da plataforma", async () => {
    const res = await GET(req, ctx("f1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("inline");
    expect(res.headers.get("Content-Disposition")).toContain("5KM");
    expect(fetch).toHaveBeenCalledWith(
      "https://supabase.circuitodascorridas.com.br/storage/v1/object/public/uploads/result_pdf/abc.pdf",
    );
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("502 quando o storage responde erro", async () => {
    (fetch as any).mockResolvedValueOnce(new Response("nope", { status: 404 }));
    const res = await GET(req, ctx("f1"));
    expect(res.status).toBe(502);
  });
});
