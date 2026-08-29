const fs = require("fs");
const os = require("os");
const path = require("path");
const projectService = require("./projectService");
const projectContext = require("./projectContext");

let roots = [];
function tempRoot() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "cotaska-project-test-")); roots.push(root); return root; }
afterEach(() => { projectContext.clear(); roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })); roots = []; });

describe("projectService", () => {
  test("任意フォルダ直下に新規プロジェクトを作成して履歴へ登録する", () => {
    const appData = tempRoot(); const projectRoot = path.join(tempRoot(), "任意プロジェクト");
    projectService.configure(appData);
    const project = projectService.createProject(projectRoot, "テスト");
    expect(project.name).toBe("テスト");
    expect(fs.existsSync(path.join(projectRoot, "project.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, "settings.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, "tasks", "_index.yaml"))).toBe(true);
    expect(projectService.listRecent()[0].projectId).toBe(project.projectId);
  });

  test("管理ファイルが衝突する既存フォルダを上書きしない", () => {
    const appData = tempRoot(); const projectRoot = tempRoot();
    projectService.configure(appData); fs.writeFileSync(path.join(projectRoot, "lists.yaml"), "existing", "utf8");
    expect(() => projectService.createProject(projectRoot, "test")).toThrow(/既に存在/);
    expect(fs.readFileSync(path.join(projectRoot, "lists.yaml"), "utf8")).toBe("existing");
  });

  test("旧Portable dataを新しいプロジェクトへコピーし移行元を保持する", () => {
    const appData = tempRoot(); const portable = tempRoot(); const target = path.join(tempRoot(), "migrated");
    projectService.configure(appData); fs.mkdirSync(path.join(portable, "data", "tasks"), { recursive: true });
    fs.writeFileSync(path.join(portable, "data", "tasks", "T-0001.md"), "---\nid: T-0001\n---\n本文", "utf8");
    const project = projectService.migrateLegacy(portable, target, "移行先");
    expect(project.name).toBe("移行先");
    expect(fs.existsSync(path.join(target, "tasks", "T-0001.md"))).toBe(true);
    expect(fs.existsSync(path.join(portable, "data", "tasks", "T-0001.md"))).toBe(true);
  });
});
