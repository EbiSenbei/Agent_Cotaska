const { formatWindowTitle } = require("./windowTitle");

describe("formatWindowTitle", () => {
  it("Cotaskaとプロジェクト名を半角スペースで連結する", () => {
    expect(formatWindowTitle("開発プロジェクト")).toBe("Cotaska 開発プロジェクト");
  });

  it("前後の空白を除去する", () => {
    expect(formatWindowTitle("  営業管理  ")).toBe("Cotaska 営業管理");
  });

  it("プロジェクト名が空の場合はCotaskaだけを返す", () => {
    expect(formatWindowTitle("   ")).toBe("Cotaska");
  });
});
