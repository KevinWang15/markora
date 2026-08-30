import type { EditorView } from 'prosemirror-view';
import { describe, expect, it } from 'vitest';
import { schema } from './support/currentMarkdownCodec';
import { createTaskListItemViewClass } from '../src/taskListItemView';

function paragraph(text = '') {
  return schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined);
}

function task(checked: boolean, blocks = [paragraph('todo')]) {
  return schema.nodes.list_item.create({ checked }, blocks);
}

function ordinary(blocks = [paragraph('ordinary')]) {
  return schema.nodes.list_item.create({ checked: null }, blocks);
}

function fixture(editable = true) {
  const dom = document.createElement('div');
  document.body.append(dom);
  const view = { dom, editable } as EditorView;
  const TaskListItemView = createTaskListItemViewClass(schema.nodes.list_item);
  return { TaskListItemView, view };
}

describe('task list-item NodeView', () => {
  it('keeps one native control while checked state and accessible name update', () => {
    const { TaskListItemView, view } = fixture();
    const nodeView = new TaskListItemView(task(false, [paragraph('first'), paragraph('second')]), view);
    const control = nodeView.dom.querySelector<HTMLButtonElement>('[data-mdw-task-control="true"]');

    expect(nodeView.dom.tagName).toBe('LI');
    expect(nodeView.contentDOM).not.toBe(nodeView.dom);
    expect(control).toBeInstanceOf(HTMLButtonElement);
    expect(control?.type).toBe('button');
    expect(control?.getAttribute('role')).toBe('checkbox');
    expect(control?.getAttribute('aria-label')).toBe('first second');
    expect(control?.getAttribute('aria-checked')).toBe('false');
    expect(control?.getAttribute('aria-disabled')).toBe('false');
    expect(control?.disabled).toBe(false);

    expect(nodeView.update?.(task(true, [paragraph('renamed task')]), [], 0)).toBe(true);
    expect(nodeView.dom.querySelector('[data-mdw-task-control="true"]')).toBe(control);
    expect(control?.getAttribute('aria-label')).toBe('renamed task');
    expect(control?.getAttribute('aria-checked')).toBe('true');
    expect(nodeView.dom.dataset.checked).toBe('true');
  });

  it('uses a stable fallback name and native disabled state', () => {
    const { TaskListItemView, view } = fixture(false);
    const nodeView = new TaskListItemView(task(false, [paragraph()]), view);
    const control = nodeView.dom.querySelector<HTMLButtonElement>('[data-mdw-task-control="true"]')!;

    expect(control.getAttribute('aria-label')).toBe('Task');
    expect(control.getAttribute('aria-disabled')).toBe('true');
    expect(control.disabled).toBe(true);
    expect(control.tabIndex).toBe(-1);
  });

  it('requests replacement only when an item crosses the ordinary/task boundary', () => {
    const { TaskListItemView, view } = fixture();
    const taskView = new TaskListItemView(task(false), view);
    const ordinaryView = new TaskListItemView(ordinary(), view);

    expect(taskView.update?.(task(true), [], 0)).toBe(true);
    expect(taskView.update?.(ordinary(), [], 0)).toBe(false);
    expect(ordinaryView.contentDOM).toBe(ordinaryView.dom);
    expect(ordinaryView.dom.querySelector('[data-mdw-task-control="true"]')).toBeNull();
    expect(ordinaryView.update?.(ordinary([paragraph('changed')]), [], 0)).toBe(true);
    expect(ordinaryView.update?.(task(false), [], 0)).toBe(false);
  });
});
