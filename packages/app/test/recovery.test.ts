import { describe, expect, it } from "vitest";
import { RecoveryJournal } from "../src/RecoveryJournal";
import { DocumentSession } from "../src/documentSession";

describe("recovery checkpoints", () => {
  it("serializes older writes before the latest clean checkpoint", async () => {
    const session = new DocumentSession("original");
    const writes: string[] = [];
    let finish!: () => void;
    const journal = new RecoveryJournal(async snapshot => {
      writes.push(snapshot.markdown);
      if (writes.length === 1) await new Promise<void>(resolve => { finish = resolve; });
    }, () => {});
    journal.schedule(session.edit("first edit"));
    const first = journal.flush();
    await Promise.resolve(); await Promise.resolve();
    journal.schedule(session.edit("latest edit"));
    const second = journal.flush();
    expect(writes).toEqual(["first edit"]);
    finish();
    await Promise.all([first, second]);
    expect(writes).toEqual(["first edit", "latest edit"]);
  });

  it("can persist a later checkpoint after a failed write", async () => {
    const session = new DocumentSession("original");
    let attempts = 0;
    const journal = new RecoveryJournal(async () => { if (++attempts === 1) throw new Error("disk full"); }, () => {});
    journal.schedule(session.edit("first"));
    await expect(journal.flush()).rejects.toThrow("disk full");
    journal.schedule(session.edit("second"));
    await journal.flush();
    expect(attempts).toBe(2);
  });
});
