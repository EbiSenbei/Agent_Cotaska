export function createLatestRequest() {
  let generation = 0;
  return {
    begin() { const version = ++generation; return () => version === generation; },
    invalidate() { generation += 1; },
  };
}
