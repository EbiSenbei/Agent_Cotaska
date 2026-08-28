const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");
const projectContext = require("./projectContext");
const settingsService = require("./settingsService");

let roots = [];

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cotaska-settings-test-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  projectContext.clear();
  roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
  roots = [];
});

describe("settingsService AI作業フォルダ", () => {
  test("プロジェクト外の作業フォルダを絶対パスで保存して再読込できる", () => {
    const settingsDir = tempRoot();
    const projectRoot = tempRoot();
    const externalWorkdir = tempRoot();
    const manifest = {
      schemaVersion: 1,
      projectId: "settings-test-project",
      name: "設定テスト",
      ai: { workdir: "." },
    };
    fs.writeFileSync(path.join(projectRoot, "project.yaml"), yaml.dump(manifest), "utf8");
    settingsService.configureDataDir(settingsDir);
    projectContext.setCurrent(projectRoot, manifest);

    const result = settingsService.updateSettings({ aiChat: { workdir: externalWorkdir } });
    const savedManifest = yaml.load(fs.readFileSync(path.join(projectRoot, "project.yaml"), "utf8"));

    expect(result.settings.aiChat.workdir).toBe(externalWorkdir);
    expect(savedManifest.ai.workdir).toBe(externalWorkdir);
    expect(settingsService.getSettings().settings.aiChat.workdir).toBe(externalWorkdir);
  });

  test("プロジェクト内の作業フォルダは相対パスで保存する", () => {
    const settingsDir = tempRoot();
    const projectRoot = tempRoot();
    const internalWorkdir = path.join(projectRoot, "workspace");
    fs.mkdirSync(internalWorkdir);
    const manifest = {
      schemaVersion: 1,
      projectId: "settings-test-project",
      name: "設定テスト",
      ai: { workdir: "." },
    };
    fs.writeFileSync(path.join(projectRoot, "project.yaml"), yaml.dump(manifest), "utf8");
    settingsService.configureDataDir(settingsDir);
    projectContext.setCurrent(projectRoot, manifest);

    settingsService.updateSettings({ aiChat: { workdir: internalWorkdir } });
    const savedManifest = yaml.load(fs.readFileSync(path.join(projectRoot, "project.yaml"), "utf8"));

    expect(savedManifest.ai.workdir).toBe("workspace");
  });
});
