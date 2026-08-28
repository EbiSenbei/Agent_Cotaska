import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const RAW_URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_URL_PUNCTUATION = /[.,;:!?、。)）\]］}｝]+$/;

function trimRawUrlMatch(match) {
  return String(match || "").replace(TRAILING_URL_PUNCTUATION, "");
}

function findUrlAtIndex(value, index) {
  const source = String(value || "");
  const targetIndex = Number(index);
  if (!Number.isFinite(targetIndex) || targetIndex < 0) return null;

  RAW_URL_PATTERN.lastIndex = 0;
  let match;
  while ((match = RAW_URL_PATTERN.exec(source))) {
    const raw = match[0];
    const url = trimRawUrlMatch(raw);
    if (!url) continue;

    const start = match.index;
    const end = start + url.length;
    if (targetIndex >= start && targetIndex <= end) {
      return { url, start, end };
    }
  }

  return null;
}

function highlightInlineMarkdown(value) {
  const source = String(value || "");
  const tokenPattern = /(`[^`]+`|\*\*[^*\n]+?\*\*|\*[^*\s][^*\n]*?\*|\[[^\]\n]+\]\([^)]+\)|https?:\/\/[^\s<>"']+)/gi;
  let cursor = 0;
  let html = "";

  source.replace(tokenPattern, (match, _token, offset) => {
    html += escapeHtml(source.slice(cursor, offset));
    const url = /^https?:\/\//i.test(match) ? trimRawUrlMatch(match) : "";
    const trailingText = url ? match.slice(url.length) : "";
    const className = match.startsWith("`")
      ? "md-token-code"
      : match.startsWith("**")
        ? "md-token-strong"
        : match.startsWith("[") || url
          ? "md-token-link"
          : "md-token-em";
    if (url) {
      html += `<span class="${className} md-token-url">${escapeHtml(url)}</span>${escapeHtml(trailingText)}`;
    } else {
      html += `<span class="${className}">${escapeHtml(match)}</span>`;
    }
    cursor = offset + match.length;
    return match;
  });

  html += escapeHtml(source.slice(cursor));
  return html;
}

function renderMarkdownEditorLine(line) {
  if (!line) return "&nbsp;";

  const heading = line.match(/^(#{1,6})(\s+.*)?$/);
  if (heading) {
    const level = Math.min(heading[1].length, 6);
    return `<span class="md-heading md-heading-${level}"><span class="md-marker">${escapeHtml(heading[1])}</span>${highlightInlineMarkdown(heading[2] || "")}</span>`;
  }

  const quote = line.match(/^(\s*>+\s?)(.*)$/);
  if (quote) {
    return `<span class="md-quote"><span class="md-marker">${escapeHtml(quote[1])}</span>${highlightInlineMarkdown(quote[2])}</span>`;
  }

  const unordered = line.match(/^(\s*)([-+*]\s+)(.*)$/);
  if (unordered) {
    return `${escapeHtml(unordered[1])}<span class="md-list-marker">${escapeHtml(unordered[2])}</span>${highlightInlineMarkdown(unordered[3])}`;
  }

  const ordered = line.match(/^(\s*)(\d+\.\s+)(.*)$/);
  if (ordered) {
    return `${escapeHtml(ordered[1])}<span class="md-list-marker">${escapeHtml(ordered[2])}</span>${highlightInlineMarkdown(ordered[3])}`;
  }

  return highlightInlineMarkdown(line);
}

function renderMarkdownEditorHtml(value) {
  const lines = String(value || "").split("\n");
  // Keep the highlight layer in the same inline text flow as the textarea.
  // Per-line block elements calculate wrapping independently and shift the
  // visible text away from the native caret/selection coordinates.
  return lines.map(renderMarkdownEditorLine).join("\n");
}

function formatDatetime(value) {
  if (!value) return "";

  const raw = String(value);
  const parsed = new Date(raw);
  const fallbackParsed = Number.isNaN(parsed.getTime()) ? new Date(raw.replace(" ", "T")) : parsed;
  if (Number.isNaN(fallbackParsed.getTime())) {
    return raw.replace("T", " ").slice(0, 16);
  }

  const y = fallbackParsed.getFullYear();
  const m = String(fallbackParsed.getMonth() + 1).padStart(2, "0");
  const d = String(fallbackParsed.getDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

const formatCompletedAt = formatDatetime;

export {
  findUrlAtIndex,
  formatCompletedAt,
  formatDatetime,
  markdown,
  renderMarkdownEditorHtml,
};
