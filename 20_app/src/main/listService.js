/**
 * listService.js
 * リスト（lists.yaml）の CRUD 操作
 */

const fs = require('fs');
const path = require('path');
const YAML = require('js-yaml');
const taskService = require('./taskService');
const projectContext = require('./projectContext');

const getListsPath = () => projectContext.getCurrent().listsFile;

let listsData = { lists: [], tags: [], last_updated: null };

function normalizeListsData(data) {
  const normalized = data || {};
  return {
    lists: Array.isArray(normalized.lists) ? normalized.lists : [],
    tags: Array.isArray(normalized.tags) ? Array.from(new Set(normalized.tags.filter(Boolean))) : [],
    last_updated: normalized.last_updated || null
  };
}

/**
 * 起動時に lists.yaml を読み込み
 */
async function openListService() {
  try {
    if (fs.existsSync(getListsPath())) {
      const content = fs.readFileSync(getListsPath(), 'utf-8');
      listsData = normalizeListsData(YAML.load(content));
    } else {
      listsData = { lists: [], tags: [], last_updated: new Date().toISOString() };
      writeListsFile();
    }

    console.log(`[ListService] Loaded ${listsData.lists.length} lists`);
    return { success: true, listCount: listsData.lists.length };
  } catch (error) {
    console.error('[ListService] Error opening service:', error);
    throw error;
  }
}

/**
 * 全リスト取得
 */
function getAllLists() {
  return listsData.lists || [];
}

/**
 * リスト名で取得
 */
function getListByName(name) {
  return listsData.lists.find(l => l.name === name);
}

/**
 * 新規リスト作成
 */
function addList(listData) {
  // 同名リストがあれば throw
  if (listsData.lists.some(l => l.name === listData.name)) {
    throw new Error(`List "${listData.name}" already exists`);
  }

  const newList = {
    name: listData.name,
    color: listData.color || '#e8f4f8',
    icon: listData.icon || 'icon-doc',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  listsData.lists.push(newList);
  listsData.last_updated = new Date().toISOString();
  writeListsFile();

  return newList;
}

/**
 * リスト更新
 */
function updateList(listName, updates) {
  const list = listsData.lists.find(l => l.name === listName);
  if (!list) {
    throw new Error(`List "${listName}" not found`);
  }

  // name 変更時は確認
  if (updates.name && updates.name !== listName) {
    if (listsData.lists.some(l => l.name === updates.name)) {
      throw new Error(`List "${updates.name}" already exists`);
    }
    // 関紐付けタスクの list フィールドも更新
    const tasksInList = taskService.getTasksByList(listName);
    tasksInList.forEach(task => {
      taskService.updateTask(task.id, { list: updates.name });
    });
  }

  Object.keys(updates).forEach(key => {
    list[key] = updates[key];
  });

  list.updated_at = new Date().toISOString();
  listsData.last_updated = new Date().toISOString();
  writeListsFile();

  return list;
}

/**
 * リスト削除
 */
function deleteList(listName) {
  const index = listsData.lists.findIndex(l => l.name === listName);
  if (index === -1) {
    throw new Error(`List "${listName}" not found`);
  }

  // このリストに属するタスクの list を null にする
  const tasksInList = taskService.getTasksByList(listName);
  tasksInList.forEach(task => {
    taskService.updateTask(task.id, { list: null });
  });

  listsData.lists.splice(index, 1);
  listsData.last_updated = new Date().toISOString();
  writeListsFile();

  return { success: true, deleted_at: new Date().toISOString() };
}

/**
 * グローバルタグ追加
 */
function addTag(name) {
  const tag = String(name || '').trim();
  if (!tag) {
    throw new Error('Tag name is required');
  }

  if (!listsData.tags) {
    listsData.tags = [];
  }

  if (!listsData.tags.includes(tag)) {
    listsData.tags.push(tag);
    listsData.tags = Array.from(new Set(listsData.tags));
    listsData.last_updated = new Date().toISOString();
    writeListsFile();
  }

  return { name: tag };
}

/**
 * グローバルタグ削除
 */
function removeTag(name) {
  const tag = String(name || '').trim();
  if (!tag) {
    throw new Error('Tag name is required');
  }

  if (!listsData.tags) {
    listsData.tags = [];
  }

  const before = listsData.tags.length;
  listsData.tags = listsData.tags.filter(t => t !== tag);
  if (listsData.tags.length !== before) {
    listsData.last_updated = new Date().toISOString();
    writeListsFile();
  }

  return { success: true, name: tag };
}

/**
 * 全タグ取得
 */
function getAllTags() {
  return Array.isArray(listsData.tags) ? [...listsData.tags] : [];
}

/**
 * ファイルに書き込み
 */
function writeListsFile() {
  const yaml = YAML.dump(listsData, { lineWidth: -1 });
  fs.writeFileSync(getListsPath(), yaml, 'utf-8');
}

module.exports = {
  openListService,
  getAllLists,
  getListByName,
  addList,
  updateList,
  deleteList,
  addTag,
  removeTag,
  getAllTags
};
