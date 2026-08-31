import { describe, it, expect } from "vitest";
import { eventHasResults } from "@/lib/events/has-results";

describe("eventHasResults", () => {
  it("false quando não há PDF nem import publicado", () => {
    expect(eventHasResults({ resultFilesCount: 0, publishedImportCount: 0 })).toBe(false);
  });
  it("true com ao menos um PDF", () => {
    expect(eventHasResults({ resultFilesCount: 1, publishedImportCount: 0 })).toBe(true);
  });
  it("true com ao menos um import publicado", () => {
    expect(eventHasResults({ resultFilesCount: 0, publishedImportCount: 1 })).toBe(true);
  });
});
