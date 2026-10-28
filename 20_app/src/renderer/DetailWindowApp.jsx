import React, { useCallback, useEffect, useState, useRef } from "react";
import "./App.css";
import "./styles/app-components.css";
import DetailPane from "./components/DetailPane";
import { mapFileTask, toFileTaskPayload } from "./lib/taskViewModel";
import { createLatestRequest } from './lib/latestRequest';

export default function DetailWindowApp({ taskId }) {
  const [selectedTaskId, setSelectedTaskId] = useState(taskId);
  const [projectId, setProjectId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [lists, setLists] = useState([]);
  const [tags, setTags] = useState([]);
  const gate = useRef(createLatestRequest());
  const load = useCallback(async (payload = {}) => {
    const isCurrent = gate.current.begin();
    const [rows, nextLists, nextTags, project] = await Promise.all([
      payload.tasks || window.cotaskaAPI.tasks.getAll(), window.cotaskaAPI.lists.getAll(), window.cotaskaAPI.tags.getAll(),
      window.cotaskaAPI.projects.getCurrent(),
    ]);
    if (!isCurrent()) return;
    setProjectId(project?.projectId);
    setTasks((rows || []).map(mapFileTask)); setLists(nextLists || []); setTags(nextTags || []);
  }, []);
  useEffect(() => { load(); const unsubscribe = window.cotaskaAPI.onTasksChanged(load); return () => { gate.current.invalidate(); unsubscribe?.(); }; }, [load]);
  const task = tasks.find((item) => item.id === selectedTaskId) || null;
  const save = async (updates) => { await window.cotaskaAPI.tasks.update(toFileTaskPayload(task, updates)); await load(); };
  return <div className="detail-window-app"><DetailPane key={selectedTaskId} task={task} projectId={projectId} tasks={tasks} lists={lists} tags={tags}
    onSaved={load} onSelectTask={(nextTask) => setSelectedTaskId(nextTask.id)} onClose={() => window.close()}
    onToggleComplete={async (current) => { await window.cotaskaAPI.tasks[current.status === "done" ? "reopenTask" : "completeTask"](current.id); await load(); }}
    onSetTaskDue={async (current, value) => { await save({ id: current.id, due_date: value }); }}
    onSetTaskTags={async (current, nextTags) => { await window.cotaskaAPI.taskTags.set(current.id, nextTags); await load(); }}
    onAddTag={async (name) => { await window.cotaskaAPI.tags.add(name); await load(); }}
    onStartAiChat={(current) => window.cotaskaAPI.detailWindow.openAiChat(current.id)} /> </div>;
}
