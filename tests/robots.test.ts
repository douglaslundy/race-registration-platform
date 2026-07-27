import { beforeEach, describe, expect, it } from "vitest";
import robots from "@/app/robots";

describe("robots", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://circuitodascorridas.com.br";
  });

  it("libera geral e bloqueia as áreas autenticadas/internas", () => {
    const result = robots();
    expect(result.rules).toEqual({
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/organizador", "/anunciante", "/dashboard", "/api", "/auth", "/completar-cadastro"],
    });
    expect(result.sitemap).toBe("https://circuitodascorridas.com.br/sitemap.xml");
  });
});
