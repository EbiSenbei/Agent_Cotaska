import { createLatestRequest } from '../../../src/renderer/lib/latestRequest';

test('読込みの逆順完了とproject切替後の古い結果を拒否する', () => {
  const gate = createLatestRequest();
  const old = gate.begin(); const latest = gate.begin();
  expect(latest()).toBe(true); expect(old()).toBe(false);
  gate.invalidate(); expect(latest()).toBe(false);
  expect(gate.begin()()).toBe(true);
});
