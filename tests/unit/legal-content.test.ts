import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLegalPrivacy, getLegalTerms } from "@/lib/settings";
import { db } from "@/lib/db";

const dbMock = db as any;

describe("legal content defaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.platformSetting.findUnique.mockResolvedValue(null);
  });

  it("returns a non-placeholder terms document", async () => {
    const terms = await getLegalTerms();
    expect(terms.content).toContain("Papel da plataforma");
    expect(terms.updatedAt).toContain("junho de 2026");
  });

  it("returns a non-placeholder privacy document", async () => {
    const privacy = await getLegalPrivacy();
    expect(privacy.content).toContain("Quem controla os dados");
    expect(privacy.updatedAt).toContain("junho de 2026");
  });
});
