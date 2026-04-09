/* eslint-disable no-empty */
/* eslint-disable @typescript-eslint/no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { useEffect, useMemo, useRef, useState, startTransition } from 'react';
import { MessageCircle, X, Send, Search, ChevronLeft } from 'lucide-react';
import * as signalR from '@microsoft/signalr';
import { API_BASE, CHAT_HUB_URL } from '../apiOrigin.ts';

type MinimalUser = {
  id: string;
  userName: string;
  email?: string;
  displayName: string;
};

type ThreadSummary = {
  id: string;
  withUser: string;
  lastMessage?: string;
  unread: number;
  updatedAt?: string;
};

type ChatMessage = {
  id: string;
  from: string;        // username
  to: string;          // username
  text: string;        // decoded plaintext (client-side)
  sentAt: string;      // ISO
  pending?: boolean;
  error?: boolean;
};

type EnvelopeDto = {
  ToUserName: string;
  ThreadKeyId?: string | null;
  KeyId?: string | null;
  NonceB64?: string | null;
  MacB64?: string | null;
  CiphertextB64: string;
  BodyHashHex: string;
};

type Props = {
  token: string;
  user: MinimalUser;
  onLogout?: () => void;
};

const ENDPOINTS = {
  listThreads: () => `${API_BASE}/chat/threads`, // GET
  listWithUser: (withUser: string) => `${API_BASE}/chat/threads/${encodeURIComponent(withUser)}`, // GET
  startThread: () => `${API_BASE}/chat/start`, // POST { withUserName }
  markRead: (withUser: string) => `${API_BASE}/chat/mark-read/${encodeURIComponent(withUser)}`, // POST
  searchUsers: (q: string) => `${API_BASE}/users/search?q=${encodeURIComponent(q)}`,
};

function headers(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function clsx(...parts: Array<string | false | undefined | null>) {
  return parts.filter(Boolean).join(' ');
}
function isoShort(iso?: string) {
  if (!iso) return '';
  try { const d = new Date(iso); return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`; }
  catch { return ''; }
}

function encodePlainToCipherB64(plain: string) {
  return btoa(unescape(encodeURIComponent(plain)));
}
function decodeCipherB64ToPlain(b64: string) {
  try { return decodeURIComponent(escape(atob(b64))); } catch { return '[decode-failed]'; }
}
function sha1Hex(s: string) {
  let h = 0x12345678;
  for (let i = 0; i < s.length; i++) h = (h ^ s.charCodeAt(i)) + ((h << 5) - h);
  return (h >>> 0).toString(16).padStart(8, '0');
}

export default function ChatDock({ token, user, onLogout }: Props) {
  const [open, setOpen] = useState<boolean>(() => localStorage.getItem('chatDockOpen') === '1');
  const [view, setView] = useState<'threads' | 'chat'>('threads');
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeWith, setActiveWith] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [msgInput, setMsgInput] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [searchHits, setSearchHits] = useState<string[]>([]);
  const [searchedOnce, setSearchedOnce] = useState(false);
  const [banner, setBanner] = useState<{ type: 'error' | 'info'; text: string } | null>(null);

  const pollThreadsRef = useRef<number | null>(null);
  const listElRef = useRef<HTMLDivElement | null>(null);
  const justOpenedRef = useRef<boolean>(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const hubRef = useRef<signalR.HubConnection | null>(null);

  const activeWithRef = useRef<string | null>(null);
  const messagesRef = useRef<Record<string, ChatMessage[]>>({});
  const userRef = useRef(user);

  useEffect(() => { activeWithRef.current = activeWith; }, [activeWith]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { userRef.current = user; }, [user]);

  function upsertInboundMessage(peerUser: string, msg: ChatMessage) {
    startTransition(() => {
      setMessages(prev => {
        const base = prev[peerUser] ?? [];
        if (base.some(b => b.id === msg.id)) return prev; // dedupe
        const merged = [...base, msg].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
        return { ...prev, [peerUser]: merged };
      });
    });
  }

  function gentlyScrollToBottom() {
    const el = listElRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }

  async function markReadIfActive(peer: string) {
    if (activeWithRef.current === peer && document.visibilityState === 'visible') {
      try { await fetch(ENDPOINTS.markRead(peer), { method: 'POST', headers: headers(token) }); } catch { }
    }
  }

  useEffect(() => {
    localStorage.setItem('chatDockOpen', open ? '1' : '0');
    if (open) justOpenedRef.current = true;
  }, [open]);

  useEffect(() => {
    const conn = new signalR.HubConnectionBuilder()
      .withUrl(CHAT_HUB_URL, { accessTokenFactory: () => token })
      .withAutomaticReconnect()
      .build();

    const onUpdate = (payload: any) => {
      if (!payload) return;

      if (payload.type === 'chat:message') {
        const id: string = payload.id ?? payload.Id ?? crypto.randomUUID();
        const cipher: string = payload.ciphertextB64 ?? payload.CiphertextB64 ?? '';
        const sentAt: string = payload.sentAt ?? payload.SentAt ?? new Date().toISOString();

        const me = userRef.current;
        const fromUserName: string | undefined = payload.fromUserName ?? payload.FromUserName;
        const toUserName: string | undefined = payload.toUserName ?? payload.ToUserName;

        let peer = activeWithRef.current; // fallback
        let mine = false;

        if (fromUserName && toUserName) {
          if (fromUserName === me.userName) { mine = true; peer = toUserName; }
          else if (toUserName === me.userName) { mine = false; peer = fromUserName; }
        } else if (payload.senderId) {
          const senderId = String(payload.senderId).toLowerCase();
          mine = senderId === String(me.id).toLowerCase();
        }

        if (!peer) return; // nowhere to render yet

        const text = decodeCipherB64ToPlain(cipher);
        const msg: ChatMessage = {
          id, from: mine ? me.userName : peer, to: mine ? peer : me.userName, text, sentAt
        };

        upsertInboundMessage(peer, msg);
        gentlyScrollToBottom();

        startTransition(() => {
          setThreads(prev => {
            const copy = [...prev];
            const idx = copy.findIndex(t => t.withUser === peer);
            const updatedAt = sentAt;
            const lastMessage = text;
            if (idx >= 0) {
              const t = copy[idx];
              copy[idx] = {
                ...t,
                lastMessage,
                updatedAt,
                unread: activeWithRef.current === peer ? 0 : (t.unread ?? 0) + (mine ? 0 : 1),
              };
              // move to top
              copy.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
            } else {
              copy.unshift({
                id: crypto.randomUUID(),
                withUser: peer,
                lastMessage,
                unread: activeWithRef.current === peer ? 0 : (mine ? 0 : 1),
                updatedAt,
              });
            }
            return copy;
          });
        });

        markReadIfActive(peer);
      }
    };

    conn.on('chat:update', onUpdate);

    conn.onreconnected(async () => {
      await refreshThreads();
      const peer = activeWithRef.current;
      if (peer) await refreshMessages(peer, true);
    });

    conn.start().catch(() => { });
    hubRef.current = conn;

    return () => { conn.off('chat:update', onUpdate); conn.stop().catch(() => { }); hubRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const refreshThreads = async () => {
    try {
      const res = await fetch(ENDPOINTS.listThreads(), { headers: headers(token) });
      if (!res.ok) return;
      const data: ThreadSummary[] = await res.json();
      data.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      setThreads(data);
    } catch { }
  };

  useEffect(() => {
    if (!open) return;
    refreshThreads();
    pollThreadsRef.current && clearInterval(pollThreadsRef.current);
    pollThreadsRef.current = window.setInterval(refreshThreads, 5000);
    return () => { if (pollThreadsRef.current) clearInterval(pollThreadsRef.current); };
  }, [open, token]);

  useEffect(() => {
    const q = searchQ.trim();
    if (!open || view !== 'threads' || q.length < 2) {
      setSearchHits([]);
      setSearchedOnce(false);
      return;
    }
    let alive = true;
    const id = setTimeout(async () => {
      try {
        const r = await fetch(ENDPOINTS.searchUsers(q), { headers: headers(token) });
        setSearchedOnce(true);
        if (!r.ok) return;
        const arr: Array<{ userName: string }> = await r.json();
        if (!alive) return;
        setSearchHits(arr.map(x => x.userName).filter(u => u !== user.userName));
      } catch { setSearchedOnce(true); }
    }, 250);
    return () => { alive = false; clearTimeout(id); };
  }, [searchQ, open, view, token, user.userName]);

  const refreshMessages = async (withUser: string, incremental = false) => {
    try {
      const r = await fetch(ENDPOINTS.listWithUser(withUser), { headers: headers(token) });
      if (!r.ok) return;
      const data = await r.json(); // { threadId, items: [{ id, ciphertextB64, sentAt, senderId }] }
      const items: Array<{ Id: string; CiphertextB64: string; SentAt: string; SenderId?: string }> =
        (data.items ?? []).map((x: any) => ({
          Id: x.id,
          CiphertextB64: x.ciphertextB64,
          SentAt: x.sentAt,
          SenderId: x.senderId
        }));

      const decoded: ChatMessage[] = items.map(x => {
        const mine = x.SenderId && String(x.SenderId).toLowerCase() === String(user.id).toLowerCase();
        return {
          id: x.Id,
          from: mine ? user.userName : withUser,
          to: mine ? withUser : user.userName,
          text: decodeCipherB64ToPlain(x.CiphertextB64),
          sentAt: x.SentAt
        };
      });

      startTransition(() =>
        setMessages(prev => {
          const base = prev[withUser] || [];
          const seen = new Set(base.map(m => m.id));
          const merged = incremental ? [...base] : [];
          for (const m of decoded) if (!seen.has(m.id)) merged.push(m);
          return { ...prev, [withUser]: merged.sort((a, b) => a.sentAt.localeCompare(b.sentAt)) };
        })
      );
      await fetch(ENDPOINTS.markRead(withUser), { method: 'POST', headers: headers(token) }).catch(() => { });
    } catch { }
  };

  const openThread = async (withUser: string) => {
    setBanner(null);
    const target = withUser.trim();
    if (!target) return;

    try {
      const res = await fetch(ENDPOINTS.startThread(), {
        method: 'POST', headers: headers(token),
        body: JSON.stringify({ withUserName: target })
      });
      if (res.status === 404) { setView('threads'); setActiveWith(null); setBanner({ type: 'error', text: `User "@${target}" not found.` }); return; }
      if (!res.ok) { setView('threads'); setActiveWith(null); setBanner({ type: 'error', text: `Couldn’t start conversation with "@${target}".` }); return; }
    } catch {
      setView('threads'); setActiveWith(null); setBanner({ type: 'error', text: `Network error. Try again.` }); return;
    }

    setActiveWith(target); // triggers activeWithRef sync via effect
    setView('chat');
    await refreshMessages(target, false);
    gentlyScrollToBottom();
    await markReadIfActive(target);
  };

  const sendMessage = async () => {
    const text = msgInput.trim();
    const to = activeWith;
    if (!to || !text) return;

    const optimistic: ChatMessage = {
      id: `tmp_${Date.now()}`,
      from: user.userName,
      to,
      text,
      sentAt: new Date().toISOString(),
      pending: true
    };
    setMsgInput('');
    startTransition(() => {
      setMessages(prev => ({ ...prev, [to]: [...(prev[to] || []), optimistic] }));
    });
    setTimeout(() => { const el = listElRef.current; if (el) el.scrollTop = el.scrollHeight; }, 0);

    const cipher = encodePlainToCipherB64(text);
    const bodyHash = sha1Hex(cipher);
    const dto: EnvelopeDto = {
      ToUserName: to,
      ThreadKeyId: null,
      KeyId: null,
      NonceB64: null,
      MacB64: null,
      CiphertextB64: cipher,
      BodyHashHex: bodyHash,
    };

    try {
      if (!hubRef.current) throw new Error('hub not ready');
      await hubRef.current.invoke('SendEnvelope', dto);
      await refreshMessages(to, true);
      await refreshThreads();
    } catch {
      startTransition(() => {
        setMessages(prev => {
          const arr = prev[to] || [];
          if (!arr.length) return prev;
          const copy = [...arr];
          copy[copy.length - 1] = { ...copy[copy.length - 1], pending: false, error: true };
          return { ...prev, [to]: copy };
        });
      });
    }
  };

  useEffect(() => {
    if (open && view === 'threads' && justOpenedRef.current) {
      setTimeout(() => searchRef.current?.focus(), 0);
      justOpenedRef.current = false;
    }
  }, [open, view]);

  const totalUnread = useMemo(() => threads.reduce((a, t) => a + (t.unread || 0), 0), [threads]);

  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={() => setOpen(v => !v)}
        className={clsx(
          'fixed z-50 rounded-full shadow-lg',
          'bottom-[max(1rem,env(safe-area-inset-bottom,0px))] right-[max(1rem,env(safe-area-inset-right,0px))]',
          'bg-purple-600 hover:bg-purple-700 text-white',
          'w-14 h-14 min-w-[3.5rem] min-h-[3.5rem] flex items-center justify-center touch-manipulation'
        )}
        aria-label="Open chat"
        title="Chat"
      >
        <div className="relative">
          <MessageCircle size={24} />
          {totalUnread > 0 && (
            <span className="absolute -top-2 -right-3 bg-red-600 text-white text-xs px-2 py-0.5 rounded-full">
              {totalUnread > 99 ? '99+' : totalUnread}
            </span>
          )}
        </div>
      </button>

      {/* Dock Panel */}
      {open && (
        <div
          className={clsx(
            'fixed z-50 max-h-[min(85vh,100dvh)] min-h-0 bg-slate-800 text-slate-100 rounded-2xl shadow-2xl border border-slate-700 flex flex-col',
            'left-4 right-4 bottom-[max(5.5rem,env(safe-area-inset-bottom,0px)+4.5rem)] w-auto max-w-none',
            'sm:left-auto sm:right-[max(1rem,env(safe-area-inset-right,0px))] sm:bottom-[max(5rem,env(safe-area-inset-bottom,0px)+1rem)] sm:w-[400px] sm:max-w-[calc(100vw-2rem)]'
          )}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {view === 'chat' && (
                <button
                  type="button"
                  className="p-2 min-w-[40px] min-h-[40px] rounded hover:bg-slate-700 touch-manipulation flex items-center justify-center"
                  onClick={() => { setView('threads'); setActiveWith(null); }}
                  title="Back"
                >
                  <ChevronLeft size={18} />
                </button>
              )}
              <span className="font-semibold">Messages</span>
              <span className="text-xs opacity-60">({user.userName})</span>
            </div>
            <button type="button" className="p-2 min-w-[40px] min-h-[40px] rounded hover:bg-slate-700 touch-manipulation flex items-center justify-center" onClick={() => setOpen(false)} aria-label="Close">
              <X size={18} />
            </button>
          </div>

          {/* Banner */}
          {banner && (
            <div className={clsx(
              'px-4 py-2 text-sm border-b',
              banner.type === 'error' ? 'bg-red-900/30 border-red-800 text-red-200' : 'bg-slate-700 border-slate-600 text-slate-100'
            )}>
              {banner.text}
            </div>
          )}

          {/* Body */}
          {view === 'threads' ? (
            <div className="flex-1 flex flex-col">
              {/* Search / Start */}
              <div className="p-3 border-b border-slate-700">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 flex-1 bg-slate-700 rounded px-2">
                    <Search size={16} className="opacity-70" />
                    <input
                      ref={searchRef}
                      value={searchQ}
                      onChange={(e) => setSearchQ(e.target.value)}
                      placeholder="Search username…"
                      className="flex-1 min-w-0 bg-transparent outline-none text-base py-2"
                    />
                  </div>
                  <button
                    type="button"
                    className="shrink-0 min-h-[44px] px-3 py-2 bg-purple-600 hover:bg-purple-700 rounded text-sm disabled:opacity-50 touch-manipulation"
                    onClick={() => searchQ.trim().length >= 2 && openThread(searchQ.trim())}
                    disabled={searchQ.trim().length < 2}
                  >
                    Start
                  </button>
                </div>

                {/* Search results */}
                {searchQ.trim().length >= 2 && (
                  <div className="mt-2 max-h-32 overflow-auto text-sm">
                    {searchHits.length > 0 ? (
                      searchHits.map(u => (
                        <button key={u} className="w-full text-left px-2 py-1 rounded hover:bg-slate-700" onClick={() => openThread(u)}>
                          @{u}
                        </button>
                      ))
                    ) : searchedOnce ? (
                      <div className="px-2 py-1 text-slate-400">No users found.</div>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Threads */}
              <div className="flex-1 overflow-auto">
                {threads.length === 0 ? (
                  <div className="p-6 text-center text-slate-400 text-sm">No conversations. Start one.</div>
                ) : threads.map(t => (
                  <button
                    key={t.id}
                    onClick={() => openThread(t.withUser)}
                    className="w-full px-4 py-3 border-b border-slate-700 hover:bg-slate-700 text-left"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">@{t.withUser}</div>
                      <div className="text-xs opacity-60">{isoShort(t.updatedAt)}</div>
                    </div>
                    <div className="text-sm text-slate-300 truncate">{t.lastMessage || 'No messages yet'}</div>
                    {t.unread > 0 && (
                      <span className="inline-block mt-1 text-xs bg-red-600 text-white px-2 py-0.5 rounded-full">
                        {t.unread > 99 ? '99+' : t.unread} new
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col">
              {/* Chat Header */}
              <div className="px-4 py-2 border-b border-slate-700">
                <div className="text-sm text-slate-300">Chatting with</div>
                <div className="font-semibold">@{activeWith}</div>
              </div>

              {/* Messages */}
              <div ref={listElRef} className="flex-1 overflow-auto p-3 space-y-2">
                {(messages[activeWith || ''] || []).map(m => {
                  const mine = m.from === user.userName;
                  return (
                    <div key={`${m.id}-${m.sentAt}`} className={clsx('flex', mine ? 'justify-end' : 'justify-start')}>
                      <div
                        className={clsx(
                          'max-w-[80%] rounded-2xl px-3 py-2 text-sm',
                          mine ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-100',
                          m.error && 'ring-2 ring-red-500',
                          m.pending && 'opacity-70'
                        )}
                        title={isoShort(m.sentAt)}
                      >
                        {m.text}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Composer */}
              <div className="p-3 border-t border-slate-700">
                <div className="flex items-end gap-2">
                  <textarea
                    value={msgInput}
                    onChange={(e) => setMsgInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                    }}
                    placeholder="Type a message… (Enter to send, Shift+Enter newline)"
                    rows={2}
                    className="flex-1 min-w-0 min-h-[44px] bg-slate-700 text-white rounded p-2 text-base outline-none resize-none"
                  />
                  <button
                    type="button"
                    onClick={sendMessage}
                    className="shrink-0 min-w-[44px] min-h-[44px] p-2 rounded bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 disabled:cursor-not-allowed touch-manipulation flex items-center justify-center"
                    disabled={!msgInput.trim() || !activeWith}
                    title="Send"
                  >
                    <Send size={18} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
