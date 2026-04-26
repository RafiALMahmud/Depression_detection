import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { consultantApi, consultationChatApi } from '../api/services';
import { useAuth } from '../auth/AuthContext';
import { AppShell } from '../components/dashboard/AppShell';
import { StatsCard } from '../components/dashboard/StatsCard';
import type {
  ChatMessage,
  ChatThread,
  ChatThreadDetail,
  ConsultantDashboardSummary,
  ConsultantProfile,
} from '../types/domain';
import { getDashboardPathByRole } from '../utils/roles';

type SectionId = 'overview' | 'chats' | 'profile';

const SECTIONS = [
  { id: 'overview' as SectionId, label: 'Overview' },
  { id: 'chats' as SectionId, label: 'Anonymous Chats' },
  { id: 'profile' as SectionId, label: 'Profile' },
];

const STATUS_BADGE: Record<string, string> = {
  open: 'mw-badge-warning',
  assigned: 'mw-badge-info',
  active: 'mw-badge-success',
  resolved: 'mw-badge-muted',
  closed: 'mw-badge-muted',
};

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  assigned: 'Assigned',
  active: 'Active',
  resolved: 'Resolved',
  closed: 'Closed',
};

const getApiErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const r = (error as { response?: { data?: { detail?: string } } }).response;
    if (r?.data?.detail) return r.data.detail;
  }
  return fallback;
};

export const ConsultantDashboardPage = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const [activeSectionId, setActiveSectionId] = useState<SectionId>('overview');
  const [summary, setSummary] = useState<ConsultantDashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [profile, setProfile] = useState<ConsultantProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [activeThread, setActiveThread] = useState<ChatThreadDetail | null>(null);
  const [activeThreadLoading, setActiveThreadLoading] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [sending, setSending] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({
    professional_title: '',
    specialization: '',
    bio: '',
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const allowed = user?.role === 'consultant';

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const data = await consultantApi.myDashboardSummary();
      setSummary(data);
    } catch {
      // silently fail
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    try {
      const data = await consultantApi.myProfile();
      setProfile(data);
      setProfileForm({
        professional_title: data.professional_title ?? '',
        specialization: data.specialization ?? '',
        bio: data.bio ?? '',
      });
    } catch {
      // silently fail
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const loadThreads = useCallback(async () => {
    setThreadsLoading(true);
    try {
      const data = await consultationChatApi.listThreads();
      setThreads(data);
    } catch {
      // silently fail
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  const loadThread = useCallback(async (threadId: number) => {
    setActiveThreadLoading(true);
    try {
      const data = await consultationChatApi.getThread(threadId);
      setActiveThread(data);
    } catch {
      toast.error('Could not load conversation');
    } finally {
      setActiveThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void loadSummary();
    void loadProfile();
  }, [allowed, loadSummary, loadProfile]);

  useEffect(() => {
    if (activeSectionId === 'chats') void loadThreads();
  }, [activeSectionId, loadThreads]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeThread?.messages]);

  const handleSendMessage = useCallback(async () => {
    if (!activeThread || !messageInput.trim() || sending) return;
    setSending(true);
    try {
      const msg = await consultationChatApi.consultantSendMessage(activeThread.id, messageInput.trim());
      setActiveThread(prev =>
        prev ? { ...prev, messages: [...prev.messages, msg as ChatMessage] } : prev
      );
      setMessageInput('');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to send message'));
    } finally {
      setSending(false);
    }
  }, [activeThread, messageInput, sending]);

  const handleUpdateStatus = useCallback(async (threadId: number, status: string) => {
    try {
      await consultationChatApi.updateThreadStatus(threadId, status);
      toast.success(`Conversation marked as ${STATUS_LABEL[status] ?? status}`);
      void loadThreads();
      if (activeThread?.id === threadId) {
        setActiveThread(prev => prev ? { ...prev, status } : prev);
      }
    } catch {
      toast.error('Failed to update status');
    }
  }, [activeThread, loadThreads]);

  const handleSaveProfile = useCallback(async () => {
    setProfileSaving(true);
    try {
      const updated = await consultantApi.updateMyProfile(profileForm);
      setProfile(updated);
      setEditingProfile(false);
      toast.success('Profile updated');
    } catch {
      toast.error('Failed to save profile');
    } finally {
      setProfileSaving(false);
    }
  }, [profileForm]);

  const handleLogout = useCallback(async () => {
    await signOut();
    navigate('/sign-in', { replace: true });
  }, [signOut, navigate]);

  if (!allowed) return <Navigate to={getDashboardPathByRole(user?.role ?? 'employee')} replace />;

  const renderOverview = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="mw-card" style={{ padding: '2rem', background: 'linear-gradient(135deg, #0f2235 0%, #1a3a52 100%)' }}>
        <p className="mw-entity-kicker" style={{ color: 'rgba(255,255,255,0.6)', marginBottom: '0.25rem' }}>
          {summary?.company_name ?? 'MindWell'}
        </p>
        <h2 style={{ color: '#fff', fontSize: '1.6rem', fontFamily: 'DM Serif Display, serif', marginBottom: '0.25rem' }}>
          Welcome back, {user?.full_name?.split(' ')[0] ?? 'Consultant'}
        </h2>
        <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.9375rem' }}>
          {summary?.professional_title ?? 'Wellness Consultant'}{summary?.specialization ? ` · ${summary.specialization}` : ''}
        </p>
        <div className="mw-subtle-banner" style={{ marginTop: '1.25rem', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.85)' }}>
          All employee conversations are anonymous. You will only see an anonymised alias — never the employee's real name or identity.
        </div>
      </div>

      {summaryLoading ? (
        <div className="mw-card mw-loading-card">Loading overview…</div>
      ) : summary ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
          <StatsCard label="Active Chats" value={summary.active_threads} />
          <StatsCard label="Pending Chats" value={summary.pending_threads} />
          <StatsCard label="Resolved" value={summary.resolved_threads} />
          <StatsCard label="Employees Advised" value={summary.advised_employees_count} />
        </div>
      ) : null}

      <div className="mw-card" style={{ padding: '1.75rem' }}>
        <p className="mw-section-label">How Anonymous Support Works</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
          {[
            ['Employee initiates', 'An employee clicks "Talk to a Consultant" in their dashboard and is assigned to you anonymously.'],
            ['You receive a chat', 'The conversation appears in your Anonymous Chats section with a generated alias.'],
            ['Respond & support', 'Reply to the employee through the chat panel. Their identity remains private throughout.'],
            ['Close when done', 'Mark the conversation resolved when the session is complete.'],
          ].map(([title, desc]) => (
            <div key={title} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--mw-accent, #3a8f55)', marginTop: '6px', flexShrink: 0 }} />
              <div>
                <p style={{ fontWeight: 600, fontSize: '0.9375rem', marginBottom: '0.2rem' }}>{title}</p>
                <p className="mw-helper-text">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mw-card" style={{ padding: '1.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <p className="mw-section-label">Quick Actions</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button type="button" className="mw-btn-primary" onClick={() => setActiveSectionId('chats')}>
            View Anonymous Chats
          </button>
          <button type="button" className="mw-btn-ghost" onClick={() => setActiveSectionId('profile')}>
            Update Profile
          </button>
        </div>
      </div>
    </div>
  );

  const renderChats = () => (
    <div style={{ display: 'flex', gap: '1.5rem', height: 'calc(100vh - 180px)', minHeight: '500px' }}>
      {/* Thread list */}
      <div style={{ width: '300px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <p className="mw-section-label">Conversations</p>
          <button type="button" className="mw-btn-chip" onClick={() => void loadThreads()} style={{ fontSize: '0.8125rem' }}>
            Refresh
          </button>
        </div>
        {threadsLoading ? (
          <div className="mw-card mw-loading-card" style={{ fontSize: '0.875rem' }}>Loading…</div>
        ) : threads.length === 0 ? (
          <div className="mw-card" style={{ padding: '1.5rem', textAlign: 'center' }}>
            <p className="mw-helper-text">No conversations yet.</p>
            <p className="mw-helper-text" style={{ marginTop: '0.5rem' }}>Employees from your company will appear here when they seek support.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto' }}>
            {threads.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => { void loadThread(t.id); }}
                style={{
                  textAlign: 'left',
                  padding: '1rem',
                  borderRadius: '0.625rem',
                  border: activeThread?.id === t.id ? '2px solid var(--mw-accent, #3a8f55)' : '1px solid var(--mw-border, #e2e8f0)',
                  background: activeThread?.id === t.id ? 'var(--mw-accent-bg, #f0faf3)' : 'var(--mw-card-bg, #fff)',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{t.anonymous_alias}</span>
                  <span className={`mw-badge ${STATUS_BADGE[t.status] ?? 'mw-badge-muted'}`} style={{ fontSize: '0.7rem' }}>
                    {STATUS_LABEL[t.status] ?? t.status}
                  </span>
                </div>
                <p style={{ fontSize: '0.8125rem', color: 'var(--mw-text-muted, #64748b)' }}>
                  {t.message_count} message{t.message_count !== 1 ? 's' : ''}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Chat pane */}
      <div className="mw-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '1.5rem', overflow: 'hidden' }}>
        {!activeThread && !activeThreadLoading ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'var(--mw-accent-bg, #f0faf3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.75rem' }}>
              💬
            </div>
            <p style={{ fontWeight: 600, color: 'var(--mw-heading, #0f2235)' }}>Select a conversation</p>
            <p className="mw-helper-text">Choose a chat from the list to view and respond.</p>
          </div>
        ) : activeThreadLoading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p className="mw-helper-text">Loading conversation…</p>
          </div>
        ) : activeThread ? (
          <>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '1rem', borderBottom: '1px solid var(--mw-border, #e2e8f0)', marginBottom: '1rem' }}>
              <div>
                <p style={{ fontWeight: 700, fontSize: '1rem' }}>{activeThread.anonymous_alias}</p>
                <span className={`mw-badge ${STATUS_BADGE[activeThread.status] ?? 'mw-badge-muted'}`}>
                  {STATUS_LABEL[activeThread.status] ?? activeThread.status}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {activeThread.status !== 'resolved' && activeThread.status !== 'closed' && (
                  <button
                    type="button"
                    className="mw-btn-ghost"
                    style={{ fontSize: '0.8125rem', padding: '0.4rem 0.875rem' }}
                    onClick={() => void handleUpdateStatus(activeThread.id, 'resolved')}
                  >
                    Mark Resolved
                  </button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingRight: '0.25rem' }}>
              {activeThread.messages.length === 0 ? (
                <div style={{ textAlign: 'center', marginTop: '2rem' }}>
                  <p className="mw-helper-text">No messages yet. The employee will see your replies.</p>
                </div>
              ) : (
                activeThread.messages.map(msg => {
                  const isConsultant = msg.sender_role === 'consultant';
                  return (
                    <div
                      key={msg.id}
                      style={{
                        display: 'flex',
                        justifyContent: isConsultant ? 'flex-end' : 'flex-start',
                      }}
                    >
                      <div
                        style={{
                          maxWidth: '70%',
                          padding: '0.75rem 1rem',
                          borderRadius: isConsultant ? '1rem 1rem 0.25rem 1rem' : '1rem 1rem 1rem 0.25rem',
                          background: isConsultant ? 'var(--mw-navy, #0f2235)' : 'var(--mw-surface, #f1f5f9)',
                          color: isConsultant ? '#fff' : 'var(--mw-text, #1e293b)',
                          fontSize: '0.9375rem',
                          lineHeight: 1.5,
                        }}
                      >
                        <p style={{ marginBottom: '0.2rem' }}>{msg.message_body}</p>
                        <p style={{ fontSize: '0.7rem', opacity: 0.6, marginTop: '0.25rem' }}>
                          {isConsultant ? 'You' : activeThread.anonymous_alias} · {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            {activeThread.status !== 'resolved' && activeThread.status !== 'closed' ? (
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--mw-border, #e2e8f0)' }}>
                <input
                  className="mw-input"
                  style={{ flex: 1 }}
                  placeholder="Type a message…"
                  value={messageInput}
                  onChange={e => setMessageInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSendMessage(); } }}
                  disabled={sending}
                />
                <button
                  type="button"
                  className="mw-btn-primary"
                  onClick={() => void handleSendMessage()}
                  disabled={sending || !messageInput.trim()}
                >
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            ) : (
              <div className="mw-subtle-banner" style={{ marginTop: '1rem' }}>
                This conversation is {activeThread.status}. No further messages can be sent.
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );

  const renderProfile = () => (
    <div style={{ maxWidth: '640px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {profileLoading ? (
        <div className="mw-card mw-loading-card">Loading profile…</div>
      ) : profile ? (
        <>
          <div className="mw-card" style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
              <div>
                <p className="mw-section-label">Your Profile</p>
                <h3 style={{ marginTop: '0.25rem' }}>{profile.user.full_name}</h3>
                <p className="mw-helper-text">{profile.user.email}</p>
              </div>
              {!editingProfile && (
                <button
                  type="button"
                  className="mw-btn-ghost"
                  style={{ fontSize: '0.875rem' }}
                  onClick={() => setEditingProfile(true)}
                >
                  Edit
                </button>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {[
                { label: 'Company', value: profile.company_name ?? '—' },
                { label: 'Role', value: 'Consultant' },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0', borderBottom: '1px solid var(--mw-border, #e2e8f0)' }}>
                  <span className="mw-helper-text" style={{ fontWeight: 600 }}>{label}</span>
                  <span style={{ fontSize: '0.9375rem' }}>{value}</span>
                </div>
              ))}

              {editingProfile ? (
                <>
                  <div className="mw-field">
                    <label className="mw-field-label">Professional Title</label>
                    <input
                      className="mw-input"
                      value={profileForm.professional_title}
                      onChange={e => setProfileForm(p => ({ ...p, professional_title: e.target.value }))}
                      placeholder="e.g. Licensed Therapist"
                    />
                  </div>
                  <div className="mw-field">
                    <label className="mw-field-label">Specialization</label>
                    <input
                      className="mw-input"
                      value={profileForm.specialization}
                      onChange={e => setProfileForm(p => ({ ...p, specialization: e.target.value }))}
                      placeholder="e.g. Employee Mental Health"
                    />
                  </div>
                  <div className="mw-field">
                    <label className="mw-field-label">Bio</label>
                    <textarea
                      className="mw-input mw-textarea"
                      rows={4}
                      value={profileForm.bio}
                      onChange={e => setProfileForm(p => ({ ...p, bio: e.target.value }))}
                      placeholder="Brief description for employees…"
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button type="button" className="mw-btn-primary" onClick={() => void handleSaveProfile()} disabled={profileSaving}>
                      {profileSaving ? 'Saving…' : 'Save Changes'}
                    </button>
                    <button type="button" className="mw-btn-ghost" onClick={() => setEditingProfile(false)}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {[
                    { label: 'Professional Title', value: profile.professional_title ?? '—' },
                    { label: 'Specialization', value: profile.specialization ?? '—' },
                    { label: 'Bio', value: profile.bio ?? '—' },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ padding: '0.75rem 0', borderBottom: '1px solid var(--mw-border, #e2e8f0)' }}>
                      <span className="mw-helper-text" style={{ fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>{label}</span>
                      <span style={{ fontSize: '0.9375rem' }}>{value}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          <div className="mw-card" style={{ padding: '1.5rem' }}>
            <p className="mw-section-label" style={{ marginBottom: '0.75rem' }}>Privacy Commitment</p>
            <p className="mw-helper-text">
              MindWell ensures that all consultation conversations are anonymous. Employee identities are never exposed in the consultation interface. You will only see system-generated aliases.
            </p>
          </div>
        </>
      ) : (
        <div className="mw-card" style={{ padding: '1.5rem' }}>
          <p className="mw-helper-text">Could not load profile. Please try again.</p>
          <button type="button" className="mw-btn-ghost" style={{ marginTop: '1rem' }} onClick={() => void loadProfile()}>
            Retry
          </button>
        </div>
      )}
    </div>
  );

  const sectionMap: Record<SectionId, () => JSX.Element> = {
    overview: renderOverview,
    chats: renderChats,
    profile: renderProfile,
  };

  return (
    <AppShell
      title="MindWell"
      subtitle="Consultant Workspace"
      roleLabel="Consultant"
      user={user!}
      sections={SECTIONS}
      activeSectionId={activeSectionId}
      onSelectSection={id => setActiveSectionId(id as SectionId)}
      onLogout={() => void handleLogout()}
    >
      {sectionMap[activeSectionId]?.()}
    </AppShell>
  );
};
