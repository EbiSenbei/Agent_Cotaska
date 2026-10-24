import React from "react";
import { createRoot } from "react-dom/client";
import AiChatPane from "../../src/renderer/components/AiChatPane";
import SettingsPane from "../../src/renderer/components/SettingsPane";
import { captureExecutionSettings } from "../../src/renderer/components/aiReasoningUtils";
import "../../src/renderer/styles/ai-chat.css";

let aiChat = { provider: "codex", workdir: "C:/test", codex: { model: "", reasoningEffort: "auto", performanceMode: "speed" },
  claude: { model: "opus", reasoningEffort: "medium", authMode: "local", bedrock: {} } };
let failSave = false;
const calls = [], saves = [];
let listener;
window.cotaskaAPI = {
  settings: {
    get: async () => ({ ok: true, configured: { aiChatWorkdir: true }, settings: { aiChat } }),
    update: async (patch) => {
      saves.push(patch);
      await new Promise((resolve) => setTimeout(resolve, 60));
      if (failSave) return { ok: false, error: "保存失敗テスト" };
      aiChat = { ...aiChat, ...patch.aiChat, codex: { ...aiChat.codex, ...patch.aiChat?.codex },
        claude: { ...aiChat.claude, ...patch.aiChat?.claude } };
      for (const provider of ["codex", "claude"]) {
        aiChat[provider].reasoningEffort = captureExecutionSettings({ ...aiChat, provider }).reasoningEffort;
      }
      return { ok: true, settings: { aiChat } };
    },
  },
  aiChat: {
    getDbInfo: async () => ({ ok: true }), listThreads: async () => [{ thread_id: "a", title: "Test thread" }],
    listActiveRuns: async () => [], listMessages: async () => [], listReferences: async () => [],
    listWorkdirTree: async () => ({ rows: [] }), listRunEvents: async () => [], setActiveThread: async () => {},
    onRunEvent: (callback) => { listener = callback; return () => {}; }, onThreadUpdated: () => () => {},
    sendMessage: (input) => new Promise((resolve) => {
      const userMessage = { message_id: String(calls.length), role: "user", content: input.content };
      calls.push({ ...input, finish: () => resolve({ ok: true, userMessage }) });
      listener({ type: "message.accepted", request_id: input.request_id, thread_id: "a", userMessage });
    }),
  },
};
const delay = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, label) => { if (!value) throw new Error(label); };
async function wait(check, label) {
  for (let i = 0; i < 150; i++) { if (check()) return; await delay(); }
  throw new Error(`Timeout: ${label}`);
}
const trigger = () => document.querySelector(".ai-reasoning-trigger");
const popup = () => document.querySelector('.ai-reasoning-popup:not(.is-exiting)');
const button = (text) => [...popup().querySelectorAll("button")].find((node) => node.textContent === text);
async function open() { if (!popup()) trigger().click(); await wait(popup, "popup open"); await delay(); }
async function choose(text) { button(text).click(); await delay(); await wait(() => !popup()?.querySelector('[role="status"]'), "save"); await delay(); }
async function changeModel(model) {
  const select = popup().querySelector("select"); select.value = model; select.dispatchEvent(new Event("change", { bubbles: true }));
  await delay(100);
}
async function send(text) {
  const input = document.querySelector("textarea");
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true })); await delay();
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await delay();
}
async function native(events) {
  window.testNativeInput = { events, done: false };
  await wait(() => window.testNativeInput.done, "native input"); await delay();
}
async function publish(patch) {
  aiChat = { ...aiChat, ...patch };
  window.dispatchEvent(new CustomEvent("cotaska:aiChatSettingsChanged", { detail: aiChat })); await delay();
}
createRoot(document.getElementById("root")).render(<><AiChatPane /><div id="settings-test"><SettingsPane /></div></>);
async function run() {
  await wait(() => document.querySelector(".ai-thread-item"), "initial threads");
  document.querySelector(".ai-thread-item").click(); await delay();
  assert(trigger().textContent.includes("自動・速度優先"), "speed auto label");
  await open();
  assert(popup().contains(document.activeElement), "focus enters popup");
  await choose("高");
  assert(aiChat.codex.reasoningEffort === "high" && trigger().textContent.includes("高"), "tick saves explicit high");
  assert(popup(), "selection keeps popup open");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await delay();
  assert(!popup() && document.activeElement === trigger(), "Escape restores focus");
  await send("running high"); await wait(() => calls.length === 1, "first send");
  await open(); await choose("自動に戻す");
  await send("queued auto");
  await choose("高"); await changeModel("gpt-6.1-sol");
  assert(calls[0].executionSettings.reasoningEffort === "high" && calls[0].executionSettings.model === "", "running snapshot preserved");
  calls[0].finish(); await wait(() => calls.length === 2, "queue starts");
  assert(calls[1].executionSettings.reasoningEffort === "auto" && calls[1].executionSettings.model === "" && calls[1].executionSettings.performanceMode === "speed", "queued auto and empty model preserved");
  failSave = true; await choose("軽");
  assert(trigger().textContent.includes("高") && aiChat.codex.reasoningEffort === "high", "failed effort save rolls back");
  assert(document.body.textContent.includes("保存失敗テスト"), "save error visible");
  await changeModel("gpt-6-astra");
  assert(popup().querySelector("select").value === "gpt-6.1-sol", "failed model save rolls back");
  failSave = false;
  const slider = popup().querySelector('input[type="range"]'); slider.focus();
  await native([{ type: "keyDown", keyCode: "Left" }, { type: "keyUp", keyCode: "Left" }]);
  await delay(100);
  assert(aiChat.codex.reasoningEffort === "medium", `native left key saves middle step: actual=${aiChat.codex.reasoningEffort}, focus=${document.activeElement?.outerHTML.slice(0, 140)}`);
  const range = popup().querySelector('input[type="range"]');
  range.setPointerCapture = () => {};
  range.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 5, button: 0, bubbles: true }));
  const count = saves.length;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(range, "0");
  range.dispatchEvent(new Event("input", { bubbles: true })); await delay();
  assert(trigger().textContent.includes("軽") && saves.length === count, "drag updates immediately without saving");
  range.dispatchEvent(new PointerEvent("pointerup", { pointerId: 5, bubbles: true })); await delay(100);
  assert(aiChat.codex.reasoningEffort === "low" && saves.length === count + 1, "drag end saves once");
  const canceledSaves = saves.length;
  range.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 6, button: 0, bubbles: true }));
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(range, "2");
  range.dispatchEvent(new Event("input", { bubbles: true })); await delay();
  range.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 6, bubbles: true })); await delay();
  assert(trigger().textContent.includes("軽") && saves.length === canceledSaves, "canceled drag restores saved value");
  const rect = popup().getBoundingClientRect();
  assert(rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight, "popup inside viewport");
  document.querySelector("textarea").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); await delay();
  assert(!popup(), "outside click closes");
  await publish({ provider: "claude" }); await open();
  assert(trigger().textContent.includes("中"), "Claude has independent effort");
  assert(popup().querySelector("select").value === "opus", "Claude model synchronized");
  await publish({ claude: { ...aiChat.claude, authMode: "bedrock", bedrock: { modelId: "custom-model", awsProfile: "profile-test" }, reasoningEffort: "auto" } });
  assert(popup().querySelector("select").disabled && popup().textContent.includes("profile-test"), "Bedrock profile readonly");
  assert(popup().textContent.includes("custom-model") && !popup().querySelector('input[type="range"]'), "unknown Bedrock model auto only");
  await send("queued bedrock");
  await publish({ provider: "codex", codex: { ...aiChat.codex, model: "gpt-6-astra", reasoningEffort: "high" } });
  calls[1].finish(); await wait(() => calls.length === 3, "queued provider snapshot");
  assert(calls[2].executionSettings.provider === "claude" && calls[2].executionSettings.bedrock.awsProfile === "profile-test", "queued provider connection preserved");
  calls[2].finish();
  const settingsTab = [...document.querySelectorAll("#settings-test button")].find((node) => node.textContent === "設定");
  settingsTab.click(); await delay();
  const setting = document.querySelector('[aria-label="Codex思考量"]');
  assert(setting.value === "high", "settings screen follows chat changes");
  setting.value = "medium"; setting.dispatchEvent(new Event("change", { bubbles: true })); await delay();
  [...document.querySelectorAll("#settings-test button")].find((node) => node.textContent === "保存").click(); await delay(100);
  assert(trigger().textContent.includes("中"), "chat follows settings save");
  await changeModel("gpt-6.1-sol");
  assert(popup().querySelector("select").value === "gpt-6.1-sol", "popup remains usable after sync");
  window.reasoningVisualReady = true;
  return { ok: true, saves: saves.length, requests: calls.length, checks: "popup, ticks, native keyboard, drag commit, Escape/focus, outside close, save rollback, settings sync, provider/Bedrock switch, running and queued snapshots, viewport" };
}
run().then((result) => { window.parallelResult = result; }).catch((error) => { window.parallelResult = { ok: false, error: error.stack }; });
