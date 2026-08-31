export const CODEX_MODEL_OPTIONS = [
  { value: "", label: "自動（現在: GPT-5.6 Terra）" },
  { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { value: "gpt-5.6-sol", label: "GPT-5.6 sol" },
];

export const CLAUDE_MODEL_OPTIONS = [
  { value: "", label: "自動（Claude Code既定）" },
  { value: "claude-opus-4", label: "Claude Opus 4" },
];

export function withExistingModelOption(options, value) {
  const normalized = String(value || "");
  if (!normalized || options.some((option) => option.value === normalized)) return options;
  return [...options, { value: normalized, label: `${normalized}（既存設定）` }];
}
