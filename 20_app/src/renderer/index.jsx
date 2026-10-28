import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import DetailWindowApp from "./DetailWindowApp";
import { flushTaskDrafts, hasTaskDrafts } from "./lib/taskDraftSaver";

window.cotaskaAPI?.tasks?.onFlushDrafts?.(flushTaskDrafts);
let closingAfterSave = false;
window.addEventListener('beforeunload', (event) => {
  if (closingAfterSave || !hasTaskDrafts()) return;
  event.preventDefault();
  event.returnValue = false;
  flushTaskDrafts().then(() => { closingAfterSave = true; window.close(); }).catch(error => window.alert(error.message));
});

const root = createRoot(document.getElementById("root"));
const taskId = new URLSearchParams(window.location.search).get("detailTaskId");
root.render(taskId ? <DetailWindowApp taskId={taskId} /> : <App />);
