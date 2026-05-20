const DEFAULT_USER_ID = 1;
const API_BASE = "/notes";
const TOKEN_STORAGE_KEY = "notes_oauth_token";
const PROVIDER_STORAGE_KEY = "notes_oauth_provider";
const OAUTH_USER_STORAGE_KEY = "notes_oauth_user_id";

const noteList         = document.querySelector("#note-list");
const authForm         = document.querySelector("#auth-form");
const oauthProviderSelect = document.querySelector("#oauth-provider");
const oauthUserIdInput = document.querySelector("#oauth-user-id");
const newNoteButton    = document.querySelector("#new-note-button");
const saveNoteButton   = document.querySelector("#save-note-button");
const deleteNoteButton = document.querySelector("#delete-note-button");
const titleInput       = document.querySelector("#note-title");
const contentInput     = document.querySelector("#note-content");
const editorStatus     = document.querySelector("#editor-status");
const noteMeta         = document.querySelector("#note-meta");
const pinButton        = document.querySelector("#pin-button");
const archiveButton    = document.querySelector("#archive-button");
const emotionSelect    = document.querySelector("#emotion-select");
const searchInput      = document.querySelector("#search-input");
const showArchivedCheckbox = document.querySelector("#show-archived");

let currentNoteId   = null;
let oauthProvider   = getInitialProvider();
let oauthUserId     = getInitialOAuthUserId();
let accessToken     = getInitialAccessToken();
const currentUserId = getInitialUserId();
let searchDebounceTimer = null;

function getInitialUserId() {
  const params = new URLSearchParams(window.location.search);
  const userId = Number(params.get("user_id") || params.get("usr_id"));
  return Number.isInteger(userId) && userId > 0 ? userId : DEFAULT_USER_ID;
}

function getInitialProvider() {
  return localStorage.getItem(PROVIDER_STORAGE_KEY) || "google";
}

function getInitialOAuthUserId() {
  const storedUserId = Number(localStorage.getItem(OAUTH_USER_STORAGE_KEY));
  return Number.isInteger(storedUserId) && storedUserId > 0
    ? storedUserId
    : getInitialUserId();
}

function buildDemoProviderToken(provider = oauthProvider) {
  return `${provider}:user:${oauthUserId}`;
}

function getInitialAccessToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY) || buildDemoProviderToken();
}

function getAuthUserLabel() {
  if (accessToken?.includes(":user:")) {
    return accessToken.split(":user:").at(-1);
  }
  if (accessToken?.startsWith("user:")) {
    return accessToken.slice(5);
  }
  return currentUserId;
}

function withUserId(path = "") {
  return `${API_BASE}${path}?user_id=${currentUserId}`;
}

function withAuth(path = "", extraParams = {}) {
  const base = accessToken ? `${API_BASE}${path}` : withUserId(path);
  const params = new URLSearchParams(extraParams);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function setStatus(message) {
  editorStatus.textContent = message;
}

function getProviderLabel() {
  return oauthProvider === "github" ? "GitHub" : "Google";
}

function setDeleteEnabled(enabled) {
  deleteNoteButton.disabled = !enabled;
}

function setMetaVisible(visible) {
  noteMeta.hidden = !visible;
}

function setMetaState({ is_pinned = false, is_archived = false, emotion = "" } = {}) {
  pinButton.textContent    = is_pinned   ? "📌 Pinned"   : "📌 Pin";
  archiveButton.textContent = is_archived ? "🗂 Archived" : "🗂 Archive";
  pinButton.classList.toggle("active", is_pinned);
  archiveButton.classList.toggle("active", is_archived);
  emotionSelect.value = emotion || "";
}

function clearEditor(status = "New note") {
  currentNoteId = null;
  titleInput.value = "";
  contentInput.value = "";
  setDeleteEnabled(false);
  setMetaVisible(false);
  setMetaState();
  setStatus(status);
  document
    .querySelectorAll(".note-item.active")
    .forEach((item) => item.classList.remove("active"));
  titleInput.focus();
}

async function requestJson(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  options.headers = headers;
  const response = await fetch(url, options);

  if (!response.ok) {
    let detail = `Request failed with status ${response.status}`;
    try {
      const errorBody = await response.json();
      detail = errorBody.detail || detail;
    } catch {
      detail = response.statusText || detail;
    }
    throw new Error(detail);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function buildListParams() {
  const params = {};
  const q = searchInput.value.trim();
  if (q) params.q = q;
  if (showArchivedCheckbox.checked) params.include_archived = "true";
  return params;
}

async function renderSidebar(selectedId = currentNoteId) {
  noteList.textContent = "";
  const loadingState = document.createElement("div");
  loadingState.className = "empty-state";
  loadingState.textContent = "Loading...";
  noteList.appendChild(loadingState);

  try {
    const data = await requestJson(withAuth("", buildListParams()));
    const notes = data.items || [];
    noteList.textContent = "";

    if (notes.length === 0) {
      const emptyState = document.createElement("div");
      emptyState.className = "empty-state";
      emptyState.textContent = searchInput.value.trim()
        ? "No matching notes."
        : "No notes for this user.";
      noteList.appendChild(emptyState);
      return;
    }

    notes.forEach((note) => {
      const item = document.createElement("button");
      item.className = "note-item";
      item.type = "button";
      item.dataset.id = note.note_id;

      if (note.is_pinned)   item.classList.add("is-pinned");
      if (note.is_archived) item.classList.add("is-archived");

      if (Number(selectedId) === Number(note.note_id)) {
        item.classList.add("active");
      }

      const title = document.createElement("span");
      title.className = "note-title";
      title.textContent = note.title;

      const date = document.createElement("span");
      date.className = "note-date";
      date.textContent = note.note_date;

      item.append(title, date);
      noteList.appendChild(item);
    });
  } catch (error) {
    noteList.textContent = "";
    const errorState = document.createElement("div");
    errorState.className = "error-state";
    errorState.textContent = error.message;
    noteList.appendChild(errorState);
  }
}

async function loadNote(noteId) {
  setStatus("Loading...");

  try {
    const note = await requestJson(withAuth(`/${noteId}`));
    currentNoteId    = note.note_id;
    titleInput.value = note.title;
    contentInput.value = note.content;
    setDeleteEnabled(true);
    setMetaVisible(true);
    setMetaState({
      is_pinned:   note.is_pinned,
      is_archived: note.is_archived,
      emotion:     note.emotion,
    });
    setStatus(`Loaded note ${note.note_id} for user ${getAuthUserLabel()}`);
    await renderSidebar(currentNoteId);
  } catch (error) {
    setStatus(error.message);
  }
}

function getEditorPayload() {
  const payload = {
    title:   titleInput.value.trim() || "Untitled",
    content: contentInput.value || " ",
  };
  const emotion = emotionSelect.value;
  if (emotion) payload.emotion = emotion;
  return payload;
}

async function saveNote() {
  const payload = getEditorPayload();
  const isNewNote = currentNoteId === null;
  const url    = isNewNote ? withAuth() : withAuth(`/${currentNoteId}`);
  const method = isNewNote ? "POST" : "PATCH";

  saveNoteButton.disabled = true;
  setStatus("Saving...");

  try {
    const savedNote = await requestJson(url, {
      method,
      body: JSON.stringify(payload),
    });
    currentNoteId = savedNote.note_id;
    titleInput.value   = savedNote.title;
    contentInput.value = savedNote.content;
    setDeleteEnabled(true);
    setMetaVisible(true);
    setMetaState({
      is_pinned:   savedNote.is_pinned,
      is_archived: savedNote.is_archived,
      emotion:     savedNote.emotion,
    });
    setStatus(`Saved for user ${getAuthUserLabel()}`);
    await renderSidebar(currentNoteId);
  } catch (error) {
    setStatus(error.message);
  } finally {
    saveNoteButton.disabled = false;
  }
}

async function deleteCurrentNote() {
  if (currentNoteId === null) return;

  const shouldDelete = window.confirm("Delete this note?");
  if (!shouldDelete) return;

  deleteNoteButton.disabled = true;
  setStatus("Deleting...");

  try {
    await requestJson(withAuth(`/${currentNoteId}`), { method: "DELETE" });
    clearEditor("Deleted. Select or create a note.");
    await renderSidebar(null);
  } catch (error) {
    setStatus(error.message);
    setDeleteEnabled(true);
  }
}

async function patchCurrentNote(fields) {
  if (currentNoteId === null) return;

  try {
    const updated = await requestJson(withAuth(`/${currentNoteId}`), {
      method: "PATCH",
      body: JSON.stringify(fields),
    });
    setMetaState({
      is_pinned:   updated.is_pinned,
      is_archived: updated.is_archived,
      emotion:     updated.emotion,
    });
    await renderSidebar(updated.is_archived ? null : currentNoteId);
    if (updated.is_archived) {
      clearEditor("Note archived. Select or create a note.");
    }
  } catch (error) {
    setStatus(error.message);
  }
}

// — Event listeners —

noteList.addEventListener("click", async (event) => {
  const item = event.target.closest(".note-item");
  if (!item) return;
  await loadNote(item.dataset.id);
});

newNoteButton.addEventListener("click", () => clearEditor("New note"));
saveNoteButton.addEventListener("click", saveNote);
deleteNoteButton.addEventListener("click", deleteCurrentNote);

pinButton.addEventListener("click", () => {
  const nowPinned = !pinButton.classList.contains("active");
  patchCurrentNote({ is_pinned: nowPinned });
});

archiveButton.addEventListener("click", () => {
  const nowArchived = !archiveButton.classList.contains("active");
  patchCurrentNote({ is_archived: nowArchived });
});

searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => renderSidebar(), 300);
});

showArchivedCheckbox.addEventListener("change", () => renderSidebar());

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  oauthProvider = oauthProviderSelect.value;
  const requestedUserId = Number(oauthUserIdInput.value);
  oauthUserId = Number.isInteger(requestedUserId) && requestedUserId > 0
    ? requestedUserId
    : DEFAULT_USER_ID;
  accessToken = buildDemoProviderToken(oauthProvider);
  localStorage.setItem(PROVIDER_STORAGE_KEY, oauthProvider);
  localStorage.setItem(OAUTH_USER_STORAGE_KEY, String(oauthUserId));
  localStorage.setItem(TOKEN_STORAGE_KEY, accessToken);

  clearEditor(`Signed in with ${getProviderLabel()} as user ${getAuthUserLabel()}`);
  await renderSidebar();
});

document.addEventListener("DOMContentLoaded", async () => {
  oauthProviderSelect.value = oauthProvider;
  oauthUserIdInput.value    = String(oauthUserId);
  setDeleteEnabled(false);
  setMetaVisible(false);
  setStatus(`Signed in with ${getProviderLabel()} as user ${getAuthUserLabel()}`);
  await renderSidebar();
});
