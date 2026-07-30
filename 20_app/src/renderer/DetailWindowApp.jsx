import React, { useCallback, useEffect, useState } from "react";
import "./App.css";
import "./styles/app-components.css";
import DetailPane from "./components/DetailPane";
import { mapFileTask, toFileTaskPayload } from "./lib/taskViewModel";

export default function DetailWindowApp({ taskId }) {
  const [tasks, setTasks] = useState([]);
  const [lists, setLists] = useState([]);
  const [tags, setTags] = useState([]);
  const load = useCallback(async () => {
    const [rows, nextLists, nextTags] = await Promise.all([
      window.cotaskaAPI.tasks.getAll(), window.cotaskaAPI.lists.getAll(), window.cotaskaAPI.tags.getAll(),
    ]);
    setTasks((rows || []).map(mapFileTask)); setLists(nextLists || []); setTags(nextTags || []);
  }, []);
  useEffect(() => { load(); return window.cotaskaAPI.onTasksChanged(() => load()); }, [load]);
  const task = tasks.find((item) => item.id === taskId) || null;
  const save = async (updates) => { await window.cotaskaAPI.tasks.update(toFileTaskPayload(task, updates)); await load(); };
  return <div className="detail-window-app"><DetailPane task={task} tasks={tasks} lists={lists} tags={tags}
    onSaved={load} onSelectTask={() => {}} onClose={() => window.close()}
    onToggleComplete={async (current) => { await window.cotaskaAPI.tasks[current.status === "done" ? "reopenTask" : "completeTask"](current.id); await load(); }}
    onSetTaskDue={async (id, value, field) => { await save({ id, [field]: value }); }}
    onSetTaskTags={async (id, nextTags) => { await window.cotaskaAPI.taskTags.set(id, nextTags); await load(); }}
    onAddTag={async (name) => { await window.cotaskaAPI.tags.add(name); await load(); }}
    onStartAiChat={(current) => window.cotaskaAPI.detailWindow.openAiChat(current.id)} /> </div>;
}
