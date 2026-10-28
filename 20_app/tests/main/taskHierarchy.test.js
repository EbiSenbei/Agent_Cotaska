const {
  getTaskDepth,
  validateParentUpdate,
  collectDescendantTasks,
  estimateParentState,
} = require('../../src/main/taskHierarchy');

const task = (id, parent = null, extra = {}) => ({ id, parent, status: 'todo', progress_status: '未着', delete_flag: 0, ...extra });

describe('taskHierarchy', () => {
  // 索引導入前の走査を比較用に残し、不正データを含む列挙順も保護する。
  function legacyDescendants(cache, parentId, maxDepth = 5) {
    const result = [];
    const walk = (id, depth, seen = new Set()) => {
      if (depth >= maxDepth || seen.has(id)) return;
      const nextSeen = new Set(seen).add(id);
      Object.values(cache).filter(t => t.parent === id && t.delete_flag !== 1 && !t.is_invalid)
        .forEach(child => { result.push(child); walk(child.id, depth + 1, nextSeen); });
    };
    walk(parentId, 1);
    return result;
  }

  test.each([100, 1000, 5000])('%i件で旧探索の深さ優先順を保ち、全件集約は1回', n => {
    const cache = Object.fromEntries(Array.from({ length: n }, (_, i) => {
      const id = `T-${i}`;
      return [id, task(id, i ? 'T-0' : null)];
    }));
    // 全要素が同じ親を持つため、旧探索の結果は挿入順の子一覧になる。
    const expected = Object.values(cache).slice(1);
    const values = vi.spyOn(Object, 'values');
    let actual;
    try {
      actual = collectDescendantTasks(cache, 'T-0');
      expect(values).toHaveBeenCalledTimes(1);
    } finally { values.mockRestore(); }
    expect(actual).toEqual(expected);
  });

  test('5階層・欠損親・循環・削除・破損でも旧探索と順序が一致する', () => {
    const rows = [task('a'), task('b', 'a'), task('sibling', 'a'), task('c', 'b'),
      task('d', 'c'), task('e', 'd'), task('too-deep', 'e'), task('orphan', 'missing'),
      task('deleted', 'a', { delete_flag: 1 }), task('under-deleted', 'deleted'),
      task('broken', 'a', { is_invalid: true }), task('under-broken', 'broken'),
      task('cycle-1', 'cycle-2'), task('cycle-2', 'cycle-1'), task('self', 'self')];
    const cache = Object.fromEntries(rows.map(t => [t.id, t]));
    for (const id of ['a', 'missing', 'cycle-1', 'self', 'absent']) {
      expect(collectDescendantTasks(cache, id)).toEqual(legacyDescendants(cache, id));
    }
    expect(collectDescendantTasks(cache, 'a').map(t => t.id)).toEqual(['b', 'c', 'd', 'e', 'sibling']);
    expect(() => validateParentUpdate(cache, 'a', 'missing')).toThrow('見つかりません');
    expect(() => validateParentUpdate(cache, 'a', 'cycle-1')).toThrow('循環参照');
    expect(() => validateParentUpdate(cache, 'a', 'deleted')).toThrow('見つかりません');
    expect(() => validateParentUpdate(cache, 'a', 'broken')).toThrow('見つかりません');
  });

  test('階層の深さと子孫をキャッシュから算出する', () => {
    const cache = { a: task('a'), b: task('b', 'a'), c: task('c', 'b') };
    expect(getTaskDepth(cache, 'c')).toBe(3);
    expect(collectDescendantTasks(cache, 'a').map((item) => item.id)).toEqual(['b', 'c']);
  });

  test('循環参照と最大5階層超過を拒否する', () => {
    const cache = { a: task('a'), b: task('b', 'a'), c: task('c', 'b'), d: task('d', 'c'), e: task('e'), f: task('f', 'e') };
    expect(() => validateParentUpdate(cache, 'a', 'b')).toThrow('循環参照');
    expect(() => validateParentUpdate(cache, 'e', 'd')).toThrow('最大5階層');
  });

  test('子が着手済みなら未着の親を仕掛と推定する', () => {
    expect(estimateParentState(task('a'), [task('b', 'a', { progress_status: '完了', status: 'done' })]))
      .toEqual({ progress_status: '仕掛', status: 'todo' });
    expect(estimateParentState(task('a', null, { progress_status: '保留' }), [task('b', 'a')])).toBeNull();
  });
});
