import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import DetailWindowApp from "./DetailWindowApp";

const root = createRoot(document.getElementById("root"));
const taskId = new URLSearchParams(window.location.search).get("detailTaskId");
root.render(taskId ? <DetailWindowApp taskId={taskId} /> : <App />);
