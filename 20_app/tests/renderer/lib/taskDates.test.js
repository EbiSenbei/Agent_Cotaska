import { it, expect } from 'vitest';
import { formatDue, dueDatePart, dueDateSortValue, mapFileTask } from '../../../src/renderer/lib/taskViewModel';

it('Date型の期限を短く表示し、編集・並び替えに文字列を渡す', () => {
  const date = new Date('2026-10-11T00:00:00.000Z');
  expect(formatDue(date)).toBe('10/11');
  expect(dueDatePart(date)).toBe('2026-10-11');
  expect(dueDateSortValue(date)).toBe('2026-10-11T00:00');
  const task = mapFileTask({ id: 'T-0711', title: '設計反映', status: 'todo', due_date: date, deadline_date: date });
  expect(task.title).toBe('設計反映');
  expect(task.due_date).toBe('2026-10-11');
  expect(task.deadline).toBe('10/11');
});
it('既存の文字列と時刻付き期限を維持し、不正Dateは表示しない', () => {
  expect(formatDue('2026-10-11')).toBe('10/11');
  expect(formatDue('2026-10-11T13:30')).toBe('10/11 13:30');
  expect(formatDue(new Date('invalid'))).toBe('');
  expect(dueDatePart(null)).toBeNull();
});
