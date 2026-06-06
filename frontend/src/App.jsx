import React, { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import LoginScreen from './components/LoginScreen';
import { api, setAuthToken } from './services/api';

export default function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [activeConvo, setActiveConvo] = useState(null);
  const [messages, setMessages] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 768);

  // Check for existing token on mount
  useEffect(() => {
    const token = sessionStorage.getItem('elena_token');
    const savedUser = sessionStorage.getItem('elena_user');
    if (token && savedUser) {
      setAuthToken(token);
      setUser(JSON.parse(savedUser));
    }
    setAuthChecked(true);
  }, []);

  const handleLogin = (token, userData) => {
    sessionStorage.setItem('elena_token', token);
    sessionStorage.setItem('elena_user', JSON.stringify(userData));
    setAuthToken(token);
    setUser(userData);
  };

  const handleLogout = () => {
    sessionStorage.removeItem('elena_token');
    sessionStorage.removeItem('elena_user');
    setAuthToken(null);
    setUser(null);
    setConversations([]);
    setMessages([]);
    setActiveConvo(null);
  };

  // Load conversation list
  const loadConversations = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.getConversations();
      setConversations(data);
    } catch (e) {
      console.error('Failed to load conversations:', e);
      if (e.message.includes('401')) handleLogout();
    }
  }, [user]);

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
    setMessages(prev => [
      ...prev,
      { role: 'user', content: userMsg, created_at: new Date().toISOString() },
      { role: 'assistant', content: assistantMsg, created_at: new Date().toISOString() }
    ]);
    if (!activeConvo) setActiveConvo(convoId);
    loadConversations();
  };

  if (!authChecked) return null;
  if (!user) return <LoginScreen onLogin={handleLogin} />;

  return (
    <div className="flex h-screen bg-elena-bg text-elena-text">
      <Sidebar
        conversations={conversations}
        activeConvo={activeConvo}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        onNewChat={handleNewChat}
        onSelect={handleSelectConvo}
        onDelete={handleDeleteConvo}
        user={user}
        onLogout={handleLogout}
      />
      <main className="flex-1 flex flex-col min-w-0">
        <ChatView
          conversationId={activeConvo}
          messages={messages}
          onMessageSent={handleMessageSent}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        />
      </main>
    </div>
  );
}
