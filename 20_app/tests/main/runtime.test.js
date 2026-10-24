const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../../scripts/verify-runtime.js"), "utf8");

describe("security runtime minimum", () => {
  test.each(["24.22.1", "24.22.2", "24.23.0"])("accepts %s", (version) => {
    const exit = vi.fn();
    vm.runInNewContext(source, {
      process: { versions: { node: version }, version: `v${version}`, env: {}, exit },
      console: { log: vi.fn(), error: vi.fn() },
    });
    expect(exit).not.toHaveBeenCalled();
  });

  test.each(["24.15.0", "24.21.9", "24.22.0", "22.23.4", "20.23.4", "26.22.1"])("rejects %s", (version) => {
    const exit = vi.fn(() => { throw new Error("rejected"); });
    expect(() => vm.runInNewContext(source, {
      process: { versions: { node: version }, version: `v${version}`, env: {}, exit },
      console: { log: vi.fn(), error: vi.fn() },
    })).toThrow("rejected");
    expect(exit).toHaveBeenCalledWith(1);
  });
});
