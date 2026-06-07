import React, { useState, useRef, useEffect } from 'react';
import { Send, Menu } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { api } from '../services/api';

const SUGGESTIONS = [
  "How does the prior authorization process work?",
  "Who handles insurance verification?",
  "What's the patient onboarding pipeline?",
  "How do I check same-or-similar for a patient?"
];

function ElenaLogo({ size = 32, className = '' }) {
  return (
    <img
      src="/elena-icon.svg"
      alt="Elena"
      className={`object-contain ${className}`}
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
    />
  );
}

export default function ChatView({ conversationId, messages, onMessageSent, onToggleSidebar }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  const sendMessage = async (text) => {
    const msg = text || input.trim();
    if (!msg || loading) return;
    setInput('');
    setLoading(true);

    try {
      const data = await api.sendMessage(msg, conversationId);
      onMessageSent(data.conversationId, msg, data.message, data.title);
    } catch (err) {
      console.error('Send error:', err);
      onMessageSent(conversationId || 'error', msg, 'Sorry, I encountered an error. Please try again.', 'Error');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const isEmpty = messages.length === 0 && !loading;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-elena-border">
        <button onClick={onToggleSidebar} className="p-1.5 rounded-lg hover:bg-elena-hover text-elena-muted hover:text-elena-text transition-colors md:hidden">
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-elena-accent/20 flex items-center justify-center">
            <ElenaLogo size={20} />
          </div>
          <div>
            <div className="text-sm font-semibold text-white">Elena</div>
            <div className="text-xs text-elena-muted">Medically Modern AI Assistant</div>
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full px-4">
            <div className="w-16 h-16 rounded-2xl bg-elena-accent/20 flex items-center justify-center mb-6">
              <ElenaLogo size={40} />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Hi, I'm Elena</h1>
            <p className="text-elena-muted text-center max-w-md mb-8">
              Your Medically Modern AI assistant. Ask me about processes, insurance, products, team routing, or anything about how the business works.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg w-full">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(s)}
                  className="text-left px-4 py-3 rounded-xl border border-elena-border hover:bg-elena-hover/50 text-sm text-elena-text transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-full bg-elena-accent/20 flex items-center justify-center flex-shrink-0 mt-1">
                    <ElenaLogo size={20} />
                  </div>
                )}
                <div className={`max-w-[80%] ${
                  msg.role === 'user'
                    ? 'bg-elena-user rounded-2xl rounded-br-md px-4 py-2.5 text-white'
                    : 'text-elena-text'
                }`}>
                  {msg.role === 'assistant' ? (
                    <div className="message-content">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-elena-accent/20 flex items-center justify-center flex-shrink-0">
                  <ElenaLogo size={20} />
                </div>
                <div className="flex items-center gap-1 py-3">
                  <div className="typing-dot w-2 h-2 rounded-full bg-elena-muted" />
                  <div className="typing-dot w-2 h-2 rounded-full bg-elena-muted" />
                  <div className="typing-dot w-2 h-2 rounded-full bg-elena-muted" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-elena-border p-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end gap-2 bg-elena-surface border border-elena-border rounded-2xl px-4 py-2 focus-within:border-elena-accent/50 transition-colors">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Elena anything..."
              rows={1}
              className="flex-1 bg-transparent text-elena-text placeholder-elena-muted outline-none text-sm py-1.5 max-h-[200px]"
              disabled={loading}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading}
              className={`p-2 rounded-xl transition-colors ${
                input.trim() && !loading
                  ? 'bg-elena-accent hover:bg-elena-accentHover text-white'
                  : 'text-elena-muted cursor-not-allowed'
              }`}
            >
              <Send size={16} />
            </button>
          </div>
          <p className="text-xs text-elena-muted text-center mt-2">Elena can make mistakes. Verify important info with your team.</p>
        </div>
      </div>
    </div>
  );
}
