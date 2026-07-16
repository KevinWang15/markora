import { describe, expect, it } from "vitest";
import {
  REPRESENTATIVE_DOCUMENT_TARGETS,
  createRepresentativeDocument,
} from "../../../scripts/performance/representative-document.mjs";

describe("representative performance documents", () => {
  it.each(REPRESENTATIVE_DOCUMENT_TARGETS)(
    "generates an exact, deterministic %i-byte mixed workload",
    (targetBytes: number) => {
      const first = createRepresentativeDocument(targetBytes);
      const second = createRepresentativeDocument(targetBytes);

      expect(first).toEqual(second);
      expect(new TextEncoder().encode(first.markdown)).toHaveLength(targetBytes);
      expect(first.stats).toMatchObject({
        bytes: targetBytes,
        targetBytes,
      });
      expect(first.stats.sections).toBeGreaterThanOrEqual(10);
      expect(first.stats.codeBlocks).toBe(first.stats.sections);
      expect(first.stats.tables).toBe(first.stats.sections);
      expect(first.stats.nestedLists).toBe(first.stats.sections);
      expect(first.stats.images).toBe(first.stats.sections * 2);
      expect(first.markdown).toContain("```\nconst metric_");
      expect(first.markdown).toContain("| Check | Owner | State | Evidence |");
      expect(first.markdown).toContain("       - Preserve a fourth-level nested detail");
    },
  );

  it("rejects targets that cannot contain a representative section", () => {
    expect(() => createRepresentativeDocument(1024)).toThrow(/too small/u);
    expect(() => createRepresentativeDocument(1.5)).toThrow(/integer/u);
  });
});
