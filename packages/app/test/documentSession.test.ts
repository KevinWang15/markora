import { describe, expect, it } from "vitest";
import { DocumentSession } from "../src/documentSession";

describe("document save ownership", () => {
  it("keeps edits made during a save dirty and visible", () => {
    const session = new DocumentSession("original");
    session.replace("/notes/a.md", "original");
    session.edit("saved edit");
    const writing = session.snapshot;
    session.edit("saved edit plus new text");
    expect(session.saved(writing, "/notes/a.md")).toBe(false);
    expect(session.markdown).toBe("saved edit plus new text");
    expect(session.snapshot.savedMarkdown).toBe("saved edit");
    expect(session.dirty).toBe(true);
  });

  it("does not let completion from a previous document change the new document", () => {
    const session = new DocumentSession("old");
    const writing = session.snapshot;
    session.replace("/notes/b.md", "new");
    const current = session.snapshot;
    expect(session.saved(writing, "/notes/a.md")).toBe(false);
    expect(session.snapshot).toBe(current);
  });

  it("compares current content to what was written, including undo during save", () => {
    const session = new DocumentSession("original");
    session.edit("changed");
    const writing = session.snapshot;
    session.edit("original");
    expect(session.saved(writing, "/notes/a.md")).toBe(false);
    session.edit("changed");
    expect(session.dirty).toBe(false);
  });

  it("preserves original Markdown until an edit actually occurs", () => {
    const original = "Title\r\n=====\r\n\r\nA[^1] &copy;\r\n";
    const session = new DocumentSession(original);
    expect(session.saved(session.snapshot, "/notes/a.md")).toBe(true);
    expect(session.markdown).toBe(original);
  });
});
