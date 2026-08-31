const APP_NAME = "Cotaska";

function formatWindowTitle(projectName) {
  const normalizedProjectName = String(projectName || "").trim();
  return normalizedProjectName ? `${APP_NAME} ${normalizedProjectName}` : APP_NAME;
}

module.exports = { APP_NAME, formatWindowTitle };
