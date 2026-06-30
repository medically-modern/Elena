import React, { useState, useRef, useEffect } from 'react';
import { Send, Menu, Paperclip } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { api } from '../services/api';
import MNEvaluationTable from './MNEvaluationTable';

// Read a File into base64 (no data: prefix) for the evaluate-mn endpoint.
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

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

export default function ChatView({ conversationId, messages, onMessageSent, onLocalMessages, onToggleSidebar }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [qaMode, setQaMode] = useState(false);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

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
    if (!msg || loading || capReached) return;
    setInput('');
    setLoading(true);

    try {
      const data = await api.sendMessage(msg, conversationId, qaMode);
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

  const handlePdf = async (file) => {
    if (!file) return;
    if (file.type !== 'application/pdf') {
      onLocalMessages?.([{ role: 'assistant', content: 'Please attach a PDF — that\'s what I can read for a Medical Necessity review.' }]);
      return;
    }
    setEvaluating(true);
    onLocalMessages?.([{ role: 'user', content: `📎 ${file.name} — Evaluate Medical Necessity` }]);
    try {
      const base64 = await fileToBase64(file);
      const data = await api.evaluateMN(base64, file.name);
      onLocalMessages?.([{ role: 'assistant', type: 'mn-evaluation', data }]);
    } catch (err) {
      console.error('MN eval error:', err);
      onLocalMessages?.([{ role: 'assistant', content: `Sorry — I couldn't evaluate that PDF. ${err.message || ''}`.trim() }]);
    } finally {
      setEvaluating(false);
    }
  };

  const onPickFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    handlePdf(file);
  };

  const MAX_USER_MESSAGES = 8;
  const userMessageCount = messages.filter((m) => m.role === 'user').length;
  const capReached = userMessageCount >= MAX_USER_MESSAGES;

  const isEmpty = messages.length === 0 && !loading && !evaluating;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center px-4 py-3 border-b border-elena-border md:hidden">
        <button onClick={onToggleSidebar} className="p-1.5 rounded-lg hover:bg-elena-hover text-elena-muted hover:text-elena-text transition-colors">
          <Menu size={20} />
        </button>
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
                <div className={`${msg.type === 'mn-evaluation' ? 'w-full' : 'max-w-[80%]'} ${
                  msg.role === 'user'
                    ? 'bg-elena-user rounded-2xl rounded-br-md px-4 py-2.5 text-white'
                    : 'text-elena-text'
                }`}>
                  {msg.role === 'assistant' ? (
                    msg.type === 'mn-evaluation' ? (
                      <MNEvaluationTable data={msg.data} />
                    ) : (
                      <div className="message-content">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    )
                  ) : (
                    <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                  )}
                </div>
              </div>
            ))}

            {(loading || evaluating) && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-elena-accent/20 flex items-center justify-center flex-shrink-0">
                  <ElenaLogo size={20} />
                </div>
                {evaluating ? (
                  <div className="flex items-center gap-2 py-3 text-sm text-elena-muted">
                    <div className="typing-dot w-2 h-2 rounded-full bg-elena-muted" />
                    Reading the document and checking it against the Medical Necessity SOP…
                  </div>
                ) : (
                  <div className="flex items-center gap-1 py-3">
                    <div className="typing-dot w-2 h-2 rounded-full bg-elena-muted" />
                    <div className="typing-dot w-2 h-2 rounded-full bg-elena-muted" />
                    <div className="typing-dot w-2 h-2 rounded-full bg-elena-muted" />
                  </div>
                )}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-elena-border p-4">
        <div className="max-w-3xl mx-auto">
          {/* Q&A mode toggle + per-chat message counter */}
          <div className="flex items-center justify-between mb-2 px-1">
            <label className="flex items-center gap-2 text-xs text-elena-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={qaMode}
                onChange={(e) => setQaMode(e.target.checked)}
                className="accent-elena-accent"
              />
              Q&amp;A mode — faster, skips Monday.com lookups
            </label>
            <span className="text-xs text-elena-muted">{userMessageCount}/{MAX_USER_MESSAGES}</span>
          </div>
          <div className={`flex items-end gap-2 bg-elena-surface border rounded-2xl px-4 py-2 transition-colors ${capReached ? 'border-elena-border opacity-60' : 'border-elena-border focus-within:border-elena-accent/50'}`}>
            <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={onPickFile} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={evaluating || loading}
              title="Attach a PDF for a Medical Necessity review"
              className="p-2 rounded-xl text-elena-muted hover:text-elena-text hover:bg-elena-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Paperclip size={16} />
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={capReached ? 'Maximum responses reached — start a new chat' : 'Ask Elena anything...'}
              rows={1}
              className="flex-1 bg-transparent text-elena-text placeholder-elena-muted outline-none text-sm py-1.5 max-h-[200px] disabled:cursor-not-allowed"
              disabled={loading || capReached}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading || capReached}
              className={`p-2 rounded-xl transition-colors ${
                input.trim() && !loading && !capReached
                  ? 'bg-elena-accent hover:bg-elena-accentHover text-white'
                  : 'text-elena-muted cursor-not-allowed'
              }`}
            >
              <Send size={16} />
            </button>
          </div>
          {capReached ? (
            <p className="text-xs text-amber-400 text-center mt-2">Maximum responses per chat is capped at 8. Start a new chat to continue.</p>
          ) : (
            <p className="text-xs text-elena-muted text-center mt-2">Elena can make mistakes. Verify important info with your team.</p>
          )}
        </div>
      </div>
    </div>
  );
}
