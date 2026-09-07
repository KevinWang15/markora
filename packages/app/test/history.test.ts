import { describe, expect, it } from "vitest";
import { DocumentHistory } from "../src/DocumentHistory";

describe("history across source and rich views", () => {
  it("retains edits and redo across repeated mode changes", () => {
    const history = new DocumentHistory("original\r\n");
    history.record({ source: "rich edit", mode: "rich" }, "rich", 1);
    history.breakGroup();
    history.record({ source: "source edit", mode: "source" }, "source", 2);
    history.breakGroup();
    history.record({ source: "another rich edit", mode: "rich" }, "rich", 3);
    expect(history.undo()?.source).toBe("source edit");
    expect(history.undo()?.source).toBe("rich edit");
    expect(history.undo()?.source).toBe("original\r\n");
    expect(history.redo()?.source).toBe("rich edit");
    expect(history.redo()?.source).toBe("source edit");
    expect(history.redo()?.source).toBe("another rich edit");
  });

  it("groups typing bursts but separates commands and edits after a pause", () => {
    const history = new DocumentHistory("");
    history.record({ source: "a", mode: "source" }, "source", 1);
    history.record({ source: "ab", mode: "source" }, "source", 100);
    history.record({ source: "abc", mode: "source" }, "source", 1000);
    expect(history.undo()?.source).toBe("ab");
    expect(history.undo()?.source).toBe("");
    history.record({ source: "new", mode: "rich" }, null, 1100);
    expect(history.canRedo).toBe(false);
  });

  it("starts a new history for a new document", () => {
    const history = new DocumentHistory("old");
    history.record({ source: "edited", mode: "rich" }, null);
    history.reset("new");
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });
});
