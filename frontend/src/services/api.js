const API_URL = import.meta.env.VITE_API_URL || "/api";

async function request(path, options = {}) {
  const res = await fetch(\`\${API_URL}\${path}\`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!res.ok) throw new Error(\`API error: \${res.status}\`);
  return res.json();
}

export const api = {
  sendMessage: (message, conversationId) =>
    request("/chat", { method: "POST", body: JSON.stringify({ message, conversationId }) }),
  getConversations: () => request("/conversations"),
  getMessages: (id) => request(\`/conversations/\${id}/messages\`),
  deleteConversation: (id) => request(\`/conversations/\${id}\`, { method: "DELETE" }),
  renameConversation: (id, title) =>
    request(\`/conversations/\${id}\`, { method: "PATCH", body: JSON.stringify({ title }) }),
  getStats: () => request("/admin/stats"),
};

