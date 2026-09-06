export const CODEX_MODEL_OPTIONS = [
  { value: "", label: "自動（現在: GPT-5.6 Terra）" },
  { value: "gpt-6-astra", label: "GPT-6 Astra" },
  { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { value: "gpt-5.6-sol", label: "GPT-5.6 sol" },
];

export const CLAUDE_MODEL_OPTIONS = [
  { value: "", label: "自動（現在: Claude Opus）" },
  { value: "opus", label: "Claude Opus（最新）" },
  { value: "sonnet", label: "Claude Sonnet（最新）" },
];

export function withExistingModelOption(options, value) {
  const normalized = String(value || "");
  if (!normalized || options.some((option) => option.value === normalized)) return options;
  return [...options, { value: normalized, label: `${normalized}（既存設定）` }];
}
