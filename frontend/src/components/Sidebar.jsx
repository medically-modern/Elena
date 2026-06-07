import React, { useState } from 'react';
import { Plus, MessageSquare, Trash2, PanelLeftClose, PanelLeft, LogOut } from 'lucide-react';

export default function Sidebar({ conversations, activeConvo, isOpen, onToggle, onNewChat, onSelect, onDelete, user, onLogout }) {
  const [hoveredId, setHoveredId] = useState(null);

  const grouped = groupByDate(conversations);

  return (
    <>
      {!isOpen && (
        <button
          onClick={onToggle}
          className="fixed top-3 left-3 z-50 p-2 rounded-lg bg-elena-surface hover:bg-elena-hover text-elena-muted hover:text-elena-text transition-colors"
        >
          <PanelLeft size={20} />
        </button>
      )}

      <div className={`${isOpen ? 'w-64' : 'w-0'} flex-shrink-0 bg-elena-surface border-r border-elena-border flex flex-col transition-all duration-200 overflow-hidden fixed md:relative h-full z-40`}>
        <div className="flex items-center justify-between p-3 border-b border-elena-border">
          <button onClick={onToggle} className="p-1.5 rounded-lg hover:bg-elena-hover text-elena-muted hover:text-elena-text transition-colors">
            <PanelLeftClose size={20} />
          </button>
          <div className="flex items-center gap-1.5">
            <img src="/elena-icon.svg" alt="Elena" className="w-5 h-5 object-contain" />
            <span className="text-sm font-semibold text-white">Elena</span>
          </div>
          <button
            onClick={onNewChat}
            className="p-1.5 rounded-lg hover:bg-elena-hover text-elena-muted hover:text-elena-text transition-colors"
            title="New Chat"
          >
            <Plus size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {Object.entries(grouped).map(([label, convos]) => (
            <div key={label}>
              <div className="px-3 py-1.5 text-xs font-medium text-elena-muted uppercase tracking-wider">{label}</div>
              {convos.map(c => (
                <div
                  key={c.id}
                  onClick={() => onSelect(c.id)}
                  onMouseEnter={() => setHoveredId(c.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className={`group flex items-center gap-2 px-3 py-2 mx-1 rounded-lg cursor-pointer transition-colors ${
                    activeConvo === c.id ? 'bg-elena-hover text-white' : 'text-elena-text hover:bg-elena-hover/50'
                  }`}
                >
                  <MessageSquare size={14} className="flex-shrink-0 text-elena-muted" />
                  <span className="truncate text-sm flex-1">{c.title || 'New Chat'}</span>
                  {hoveredId === c.id && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                      className="p-1 rounded hover:bg-red-500/20 text-elena-muted hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}

          {conversations.length === 0 && (
            <div className="px-4 py-8 text-center text-elena-muted text-sm">
              No conversations yet.<br />Start chatting with Elena!
            </div>
          )}
        </div>

        {/* User footer */}
        <div className="p-3 border-t border-elena-border">
          <div className="flex items-center gap-2 px-2">
            {user?.picture ? (
              <img src={user.picture} alt="" className="w-7 h-7 rounded-full" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-elena-accent flex items-center justify-center text-white text-xs font-bold">
                {(user?.name || 'U')[0].toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-elena-text truncate">{user?.name || 'User'}</div>
              <div className="text-xs text-elena-muted truncate">{user?.email || ''}</div>
            </div>
            <button
              onClick={onLogout}
              className="p-1.5 rounded-lg hover:bg-elena-hover text-elena-muted hover:text-red-400 transition-colors"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function groupByDate(conversations) {
  const groups = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(today); monthAgo.setDate(monthAgo.getDate() - 30);

  for (const c of conversations) {
    const d = new Date(c.updated_at || c.created_at);
    let label;
    if (d >= today) label = 'Today';
    else if (d >= yesterday) label = 'Yesterday';
    else if (d >= weekAgo) label = 'This Week';
    else if (d >= monthAgo) label = 'This Month';
    else label = 'Older';
    if (!groups[label]) groups[label] = [];
    groups[label].push(c);
  }
  return groups;
}
