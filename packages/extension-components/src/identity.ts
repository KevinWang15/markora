import { PluginKey, type Node, type Transaction } from "markora/extension-api";

export type ComponentIdentityIndex = ReadonlyMap<number, Readonly<{ node: Node; identity: object }>>;

export const componentIdentityKey = new PluginKey<ComponentIdentityIndex>("markoraComponents");

const changedComponents = new WeakMap<Transaction, { doc: Node; nodes: ReadonlyMap<number, Node> }>();

export function collectChangedComponents(transaction: Transaction): ReadonlyMap<number, Node> {
  const cached = changedComponents.get(transaction);
  if (cached?.doc === transaction.doc) return cached.nodes;
  const ranges: { from: number; to: number }[] = [];
  transaction.steps.forEach((step, index) => {
    const remaining = transaction.mapping.slice(index + 1);
    const addRange = (from: number, to: number) => ranges.push({
      from: remaining.map(from, -1), to: remaining.map(to, 1),
    });
    let mapped = false;
    step.getMap().forEach((_oldFrom, _oldTo, from, to) => {
      mapped = true;
      addRange(from, to);
    });
    if (!mapped) {
      const before = transaction.docs[index];
      const after = transaction.docs[index + 1] ?? transaction.doc;
      const from = before.content.findDiffStart(after.content);
      const end = before.content.findDiffEnd(after.content);
      if (from !== null && end) addRange(from, Math.max(from, end.b));
    }
  });
  ranges.sort((left, right) => left.from - right.from);
  const merged: typeof ranges = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && previous.to >= range.from) previous.to = Math.max(previous.to, range.to);
    else merged.push({ ...range });
  }
  const nodes = new Map<number, Node>();
  for (const { from, to } of merged) {
    transaction.doc.nodesBetween(from, to, (node, position) => {
      if (node.type.name === "custom_component") nodes.set(position, node);
    });
  }
  changedComponents.set(transaction, { doc: transaction.doc, nodes });
  return nodes;
}

export function buildComponentIdentities(doc: Node, preserved: ComponentIdentityIndex = new Map()): ComponentIdentityIndex {
  const index = new Map<number, { node: Node; identity: object }>();
  doc.descendants((node, position) => {
    if (node.type.name !== "custom_component") return;
    const previous = preserved.get(position);
    index.set(position, { node, identity: previous?.node === node ? previous.identity : {} });
  });
  return index;
}

export function mapComponentIdentities(transaction: Transaction, previous: ComponentIdentityIndex): ComponentIdentityIndex {
  if (!transaction.docChanged) return previous;
  const preserved = new Map<number, { node: Node; identity: object }>();
  for (const [position, occurrence] of previous) {
    const mapped = transaction.mapping.mapResult(position, 1);
    if (!mapped.deleted) preserved.set(mapped.pos, occurrence);
  }
  for (const [position, node] of collectChangedComponents(transaction)) {
    const occurrence = preserved.get(position);
    preserved.set(position, { node, identity: occurrence?.node === node ? occurrence.identity : {} });
  }
  return new Map([...preserved].sort(([left], [right]) => left - right));
}
