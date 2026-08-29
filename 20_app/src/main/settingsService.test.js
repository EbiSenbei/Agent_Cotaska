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

describe("settingsService プロジェクト設定", () => {
  test("プロジェクト外の作業フォルダをsettings.yamlへ保存して再読込できる", () => {
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
    const savedSettings = yaml.load(fs.readFileSync(path.join(projectRoot, "settings.yaml"), "utf8"));

    expect(result.settings.aiChat.workdir).toBe(externalWorkdir);
    expect(savedSettings.aiChat.workdir).toBe(externalWorkdir);
    expect(settingsService.getSettings().settings.aiChat.workdir).toBe(externalWorkdir);
  });

  test("プロジェクト内の作業フォルダもsettings.yamlへ保存する", () => {
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
    const savedSettings = yaml.load(fs.readFileSync(path.join(projectRoot, "settings.yaml"), "utf8"));

    expect(savedSettings.aiChat.workdir).toBe(internalWorkdir);
  });

  test("プロジェクト未選択時は既定値を返し共通settings.yamlを作らない", () => {
    const settingsDir = tempRoot();
    settingsService.configureDataDir(settingsDir);

    const result = settingsService.getSettings();

    expect(result.ok).toBe(true);
    expect(result.path).toBeNull();
    expect(fs.existsSync(path.join(settingsDir, "settings.yaml"))).toBe(false);
    expect(() => settingsService.updateSettings({ displayName: "保存不可" })).toThrow(/プロジェクトを選択/);
  });

  test("旧共通設定とproject.yamlのworkdirを非破壊で統合する", () => {
    const settingsDir = tempRoot();
    const projectRoot = tempRoot();
    const workdir = path.join(projectRoot, "workspace");
    fs.mkdirSync(workdir);
    fs.writeFileSync(path.join(settingsDir, "settings.yaml"), "displayName: 旧設定\ndetailTextSize: 18\n", "utf8");
    const manifest = { schemaVersion: 1, projectId: "legacy", name: "旧", ai: { workdir: "workspace" } };
    fs.writeFileSync(path.join(projectRoot, "project.yaml"), yaml.dump(manifest), "utf8");
    settingsService.configureDataDir(settingsDir);
    projectContext.setCurrent(projectRoot, manifest);

    const migration = settingsService.initializeProjectSettings();
    const result = settingsService.getSettings();
    const savedManifest = yaml.load(fs.readFileSync(path.join(projectRoot, "project.yaml"), "utf8"));

    expect(migration.migrated).toBe(true);
    expect(result.settings.displayName).toBe("旧設定");
    expect(result.settings.detailTextSize).toBe(18);
    expect(result.settings.aiChat.workdir).toBe(workdir);
    expect(savedManifest.ai).toBeUndefined();
    expect(fs.existsSync(path.join(projectRoot, "project.yaml.pre-chg127.bak"))).toBe(true);
    expect(fs.existsSync(path.join(settingsDir, "settings.yaml"))).toBe(true);
  });
});
