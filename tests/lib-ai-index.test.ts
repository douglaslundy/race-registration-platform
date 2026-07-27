import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai-settings", () => ({ getAiProviderSetting: vi.fn() }));
vi.mock("@/lib/ai/claude", () => ({ ClaudeProvider: vi.fn().mockImplementation(() => ({ kind: "claude" })) }));
vi.mock("@/lib/ai/openai", () => ({ OpenAiProvider: vi.fn().mockImplementation(() => ({ kind: "openai" })) }));
vi.mock("@/lib/ai/google", () => ({ GoogleAiProvider: vi.fn().mockImplementation(() => ({ kind: "google" })) }));

import { getAiProvider } from "@/lib/ai";
import { getAiProviderSetting } from "@/lib/ai-settings";

describe("getAiProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("instancia ClaudeProvider por padrão", async () => {
    vi.mocked(getAiProviderSetting).mockResolvedValueOnce("CLAUDE");
    const provider = await getAiProvider();
    expect((provider as any).kind).toBe("claude");
  });

  it("instancia OpenAiProvider quando configurado", async () => {
    vi.mocked(getAiProviderSetting).mockResolvedValueOnce("OPENAI");
    const provider = await getAiProvider();
    expect((provider as any).kind).toBe("openai");
  });

  it("instancia GoogleAiProvider quando configurado", async () => {
    vi.mocked(getAiProviderSetting).mockResolvedValueOnce("GOOGLE");
    const provider = await getAiProvider();
    expect((provider as any).kind).toBe("google");
  });
});
