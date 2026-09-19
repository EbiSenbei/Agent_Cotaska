export const AI_COMPOSER_MIN_HEIGHT = 58;
export const AI_COMPOSER_MAX_VIEWPORT_RATIO = 0.4;
export const AI_COMPOSER_KEYBOARD_STEP = 24;

export const getAiComposerMaxHeight = (viewportHeight) => {
  const normalizedViewportHeight = Number(viewportHeight);
  if (!Number.isFinite(normalizedViewportHeight) || normalizedViewportHeight <= 0) {
    return AI_COMPOSER_MIN_HEIGHT;
  }
  return Math.max(
    AI_COMPOSER_MIN_HEIGHT,
    Math.round(normalizedViewportHeight * AI_COMPOSER_MAX_VIEWPORT_RATIO),
  );
};

export const clampAiComposerHeight = (height, viewportHeight) => {
  const normalizedHeight = Number(height);
  const nextHeight = Number.isFinite(normalizedHeight) ? normalizedHeight : AI_COMPOSER_MIN_HEIGHT;
  return Math.round(Math.min(
    getAiComposerMaxHeight(viewportHeight),
    Math.max(AI_COMPOSER_MIN_HEIGHT, nextHeight),
  ));
};
