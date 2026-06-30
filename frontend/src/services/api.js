const API_URL = import.meta.env.VITE_API_URL || "/api";

let authToken = null;

export function setAuthToken(token) {
  authToken = token;
}

async function request(path, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const res = await fetch(`${API_URL}${path}`, {
    headers,
    ...options
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const api = {
  sendMessage: (message, conversationId, qaMode = false) =>
    request("/chat", { method: "POST", body: JSON.stringify({ message, conversationId, qaMode }) }),
  getConversations: () => request("/conversations"),
  getMessages: (id) => request(`/conversations/${id}/messages`),
  deleteConversation: (id) => request(`/conversations/${id}`, { method: "DELETE" }),
  renameConversation: (id, title) =>
    request(`/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  getStats: () => request("/admin/stats"),
  reviewDocuments: (pdfs, message) =>
    request("/evaluate/document", { method: "POST", body: JSON.stringify({ pdfs, message }) }),
};
