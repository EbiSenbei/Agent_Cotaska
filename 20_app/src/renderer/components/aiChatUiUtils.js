export const CONTEXT_PANEL_WIDTH_KEY = "cotaska.aiChat.contextPanelWidth";
export const CONTEXT_PANEL_MIN_WIDTH = 320;
export const CONTEXT_PANEL_MAX_WIDTH = 720;
export const CONTEXT_PANEL_DEFAULT_WIDTH = 410;

export function normalizeOption(value, allowedValues, fallback) {
  return allowedValues.has(value) ? value : fallback;
}

export function clampContextPanelWidth(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return CONTEXT_PANEL_DEFAULT_WIDTH;
  return Math.min(CONTEXT_PANEL_MAX_WIDTH, Math.max(CONTEXT_PANEL_MIN_WIDTH, Math.round(numeric)));
}

export function loadContextPanelWidth() {
  try {
    return clampContextPanelWidth(window.localStorage?.getItem(CONTEXT_PANEL_WIDTH_KEY));
  } catch (_error) {
    return CONTEXT_PANEL_DEFAULT_WIDTH;
  }
}

export async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}
