import React, { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import { api } from './services/api';

export default function App() {
  const [conversations, setConversations] = useState([]);
  const [activeConvo, setActiveConvo] = useState(null);
  const [messages, setMessages] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 768);

  // Load conversation list
  const loadConversations = useCallback(async () => {
    try {
      const data = await api.getConversations();
      setConversations(data);
    } catch (e) {
      console.error('Failed to load conversations:', e);
    }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Load messages when conversation changes
  useEffect(() => {
    if (!activeConvo) { setMessages([]); return; }
    api.getMessages(activeConvo).then(setMessages).catch(console.error);
  }, [activeConvo]);

  const handleNewChat = () => {
    setActiveConvo(null);
    setMessages([]);
    if (window.innerWidth <= 768) setSidebarOpen(false);
  };

  const handleSelectConvo = (id) => {
    setActiveConvo(id);
    if (window.innerWidth <= 768) setSidebarOpen(false);
  };

  const handleDeleteConvo = async (id) => {
    await api.deleteConversation(id);
    if (activeConvo === id) { setActiveConvo(null); setMessages([]); }
    loadConversations();
  };

  const handleMessageSent = (convoId, userMsg, assistantMsg, title) => {
    // Update messages locally
    setMessages(prev => [
      ...prev,
      { role: 'user', content: userMsg, created_at: new Date().toISOString() },
      { role: 'assistant', content: assistantMsg, created_at: new Date().toISOString() }
    ]);

    // If this was a new conversation, set it active
    if (!activeConvo) setActiveConvo(convoId);

    // Refresh sidebar
    loadConversations();
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        conversations={conversations}
        activeConvo={activeConvo}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        onNewChat={handleNewChat}
        onSelect={handleSelectConvo}
        onDelete={handleDeleteConvo}
      />

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <ChatView
          conversationId={activeConvo}
          messages={messages}
          onMessageSent={handleMessageSent}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        />
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && window.innerWidth <= 768 && (
        <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}
    </div>
  );
}
