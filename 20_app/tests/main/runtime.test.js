const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../../scripts/verify-runtime.js"), "utf8");

describe("security runtime minimum", () => {
  test.each(["22.23.4", "22.23.5", "22.24.0"])("accepts %s", (version) => {
    const exit = vi.fn();
    vm.runInNewContext(source, {
      process: { versions: { node: version }, version: `v${version}`, env: {}, exit },
      console: { log: vi.fn(), error: vi.fn() },
    });
    expect(exit).not.toHaveBeenCalled();
  });

  test.each(["22.14.0", "22.22.9", "22.23.0", "22.23.3", "20.23.4", "24.23.4"])("rejects %s", (version) => {
    const exit = vi.fn(() => { throw new Error("rejected"); });
    expect(() => vm.runInNewContext(source, {
      process: { versions: { node: version }, version: `v${version}`, env: {}, exit },
      console: { log: vi.fn(), error: vi.fn() },
    })).toThrow("rejected");
    expect(exit).toHaveBeenCalledWith(1);
  });
});
