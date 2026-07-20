import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "crypto";
import sharp from "sharp";
import { POST } from "@/app/api/upload/route";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const authMock = vi.mocked(auth);

function makeUploadRequest(file: File, purpose = "banner") {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("purpose", purpose);
  return new Request("http://localhost/api/upload", { method: "POST", body: formData }) as any;
}

async function makeLargeJpeg(): Promise<Buffer> {
  // Ruído aleatório é quase incompressível — garante que o arquivo "original" seja grande de
  // verdade (não um PNG trivial de cor sólida), pra validar que o redimensionamento é o que
  // reduz o tamanho, não só a recompressão.
  const width = 2400;
  const height = 1600;
  const raw = randomBytes(width * height * 3);
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
}

describe("POST /api/upload", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ORGANIZER" } } as any);
    process.env.SUPABASE_URL = "https://storage.example.com";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_BUCKET = "uploads";
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("rejeita quando não há sessão", async () => {
    authMock.mockResolvedValueOnce(null as any);
    const file = new File([Buffer.from("x")], "banner.jpg", { type: "image/jpeg" });
    const res = await POST(makeUploadRequest(file));
    expect(res.status).toBe(401);
  });

  it(
    "comprime uma imagem grande antes de enviar ao storage, reduzindo o tamanho do arquivo",
    async () => {
      const original = await makeLargeJpeg();
      let uploadedBody: Buffer | undefined;
      global.fetch = vi.fn(async (_url: any, init: any) => {
        uploadedBody = Buffer.from(init.body as ArrayBuffer);
        return new Response(null, { status: 200 });
      }) as any;

      const file = new File([Buffer.from(original)], "banner.jpg", { type: "image/jpeg" });
      const res = await POST(makeUploadRequest(file));

      expect(res.status).toBe(200);
      expect(uploadedBody).toBeDefined();
      expect(uploadedBody!.length).toBeLessThan(original.length);

      const metadata = await sharp(uploadedBody!).metadata();
      expect(metadata.width).toBeLessThanOrEqual(1920);
      expect(metadata.height).toBeLessThanOrEqual(1920);
    },
    20000,
  );

  it("não reprocessa GIF (preserva animação)", async () => {
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#ff0000" } })
      .gif()
      .toBuffer();
    let uploadedBody: Buffer | undefined;
    global.fetch = vi.fn(async (_url: any, init: any) => {
      uploadedBody = Buffer.from(init.body as ArrayBuffer);
      return new Response(null, { status: 200 });
    }) as any;

    const file = new File([Buffer.from(gif)], "banner.gif", { type: "image/gif" });
    const res = await POST(makeUploadRequest(file));

    expect(res.status).toBe(200);
    expect(uploadedBody).toEqual(gif);
  });

  it("faz fallback pro arquivo original quando a compressão falha (buffer corrompido)", async () => {
    const corrupted = Buffer.from("isso não é uma imagem de verdade");
    let uploadedBody: Buffer | undefined;
    global.fetch = vi.fn(async (_url: any, init: any) => {
      uploadedBody = Buffer.from(init.body as ArrayBuffer);
      return new Response(null, { status: 200 });
    }) as any;

    const file = new File([corrupted], "banner.jpg", { type: "image/jpeg" });
    const res = await POST(makeUploadRequest(file));

    expect(res.status).toBe(200);
    expect(uploadedBody).toEqual(corrupted);
  });
});
