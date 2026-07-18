const {
  getTaskDepth,
  validateParentUpdate,
  collectDescendantTasks,
  estimateParentState,
} = require('./taskHierarchy');

const task = (id, parent = null, extra = {}) => ({ id, parent, status: 'todo', progress_status: '未着', delete_flag: 0, ...extra });

describe('taskHierarchy', () => {
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
