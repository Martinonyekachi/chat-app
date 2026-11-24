import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import './App.css'

const iconPaths = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  send: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
  back: <><path d="m15 18-6-6 6-6" /></>,
  close: <><path d="m18 6-12 12M6 6l12 12" /></>,
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '')

function apiUrl(path) {
  return `${API_BASE_URL}/${path.replace(/^\/+/, '')}`
}

async function readApiResponse(response) {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new Error(`The server returned an invalid response (HTTP ${response.status}).`)
  }

  let result
  try {
    result = await response.json()
  } catch {
    throw new Error('The server returned an invalid response.')
  }

  if (!response.ok) {
    throw new Error(result.error || 'Unable to complete the request.')
  }
  return result
}

function Icon({ name, size = 21 }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconPaths[name]}
    </svg>
  )
}

function Avatar({ name, size = 'medium', online = false }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase()

  return (
    <span className={`avatar-wrap avatar-wrap--${size}`}>
      <span className="avatar" aria-hidden="true">{initials}</span>
      {online && <span className="online-dot" aria-label="Online" />}
    </span>
  )
}

function Login({ onLogin, message }) {
  const [showPassword, setShowPassword] = useState(false)
  const [isRegistering, setIsRegistering] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)
    const formData = new FormData(event.currentTarget)
    const credentials = {
      email: formData.get('email'),
      password: formData.get('password'),
      rememberMe: formData.get('rememberMe') === 'on',
    }

    if (isRegistering) {
      credentials.username = formData.get('username')
    }

    try {
      await onLogin(credentials, isRegistering)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-intro">
          <a className="login-brand" href="#" aria-label="muse">muse<span>.</span></a>
          <div className="login-intro-copy">
            <span className="login-eyebrow">YOUR SPACE TO CONNECT</span>
            <h1>Good conversations<br />start here.</h1>
            <p>A private place to talk with people you know.</p>
          </div>
          <div className="login-message-preview" aria-hidden="true">
            <div className="preview-message preview-message--received">Your conversations belong to you.</div>
            <div className="preview-message preview-message--sent">Sign in to get started.</div>
          </div>
          <div className="login-intro-footer"><span /> Private conversations, just for you</div>
        </div>

        <div className="login-form-panel">
          <div className="login-form-heading">
            <span className="login-mobile-brand">muse<span>.</span></span>
            <h2>{isRegistering ? 'Create your account' : 'Welcome back'}</h2>
            <p>{isRegistering ? 'Create an account to start chatting.' : 'Log in to continue to your messages.'}</p>
          </div>
          <form className="login-form" onSubmit={handleSubmit}>
            {isRegistering && (
              <label>
                <span>Username</span>
                <input
                  type="text"
                  name="username"
                  placeholder="your_username"
                  autoComplete="username"
                  minLength="2"
                  maxLength="32"
                  pattern="[A-Za-z0-9_]{2,32}"
                  title="Use 2–32 letters, numbers, or underscores."
                  required
                />
              </label>
            )}
            <label>
              <span>Email address</span>
              <input type="email" name="email" placeholder="you@example.com" autoComplete="email" required />
            </label>
            <label>
              <span>Password</span>
              <span className="password-field">
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  placeholder="Enter your password"
                  autoComplete={isRegistering ? 'new-password' : 'current-password'}
                  minLength={isRegistering ? 8 : undefined}
                  required
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </span>
            </label>
            <div className="login-options">
              <label className="remember-option">
                <input type="checkbox" name="rememberMe" />
                <span>Remember me</span>
              </label>
            </div>
            {(error || message) && <p className="login-error" role="alert">{error || message}</p>}
            <button className="login-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Please wait…' : isRegistering ? 'Create account' : 'Log in'}
            </button>
          </form>
          <p className="login-demo-note">
            {isRegistering ? 'Already have an account?' : 'New to muse?'}{' '}
            <button
              className="login-mode-toggle"
              type="button"
              onClick={() => {
                setIsRegistering((registering) => !registering)
                setError('')
              }}
            >
              {isRegistering ? 'Log in' : 'Create an account'}
            </button>
          </p>
        </div>
      </section>
      <footer className="login-footer">© 2026 muse <span>·</span> Private messaging</footer>
    </main>
  )
}

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
}

function mergeMessages(current, incoming) {
  const byId = new Map(current.map((message) => [message.id, message]))
  incoming.forEach((message) => byId.set(message.id, message))
  return [...byId.values()].sort((first, second) => (
    new Date(first.createdAt) - new Date(second.createdAt)
  ))
}

function App() {
  const [user, setUser] = useState(null)
  const [authStatus, setAuthStatus] = useState('checking')
  const [authMessage, setAuthMessage] = useState('')
  const [conversations, setConversations] = useState([])
  const [contacts, setContacts] = useState([])
  const [activeId, setActiveId] = useState('')
  const [messagesByConversation, setMessagesByConversation] = useState({})
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState('')
  const [mobileChatOpen, setMobileChatOpen] = useState(false)
  const [isLoadingChats, setIsLoadingChats] = useState(true)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [isContactPickerOpen, setIsContactPickerOpen] = useState(false)
  const [contactError, setContactError] = useState('')
  const [error, setError] = useState('')
  const socketRef = useRef(null)
  const activeIdRef = useRef(activeId)
  const threadRef = useRef(null)

  activeIdRef.current = activeId

  useEffect(() => {
    const controller = new AbortController()

    async function restoreSession() {
      try {
        const response = await fetch(apiUrl('auth/me'), { signal: controller.signal })
        if (response.status === 401) {
          setAuthStatus('signedOut')
          return
        }
        const result = await readApiResponse(response)
        setUser(result.user)
        setAuthStatus('signedIn')
      } catch (requestError) {
        if (requestError.name === 'AbortError') return
        setAuthMessage(requestError.message)
        setAuthStatus('signedOut')
      }
    }

    restoreSession()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!user) return undefined
    const controller = new AbortController()
    setIsLoadingChats(true)

    async function loadChats() {
      try {
        const [conversationResponse, userResponse] = await Promise.all([
          fetch(apiUrl('conversations'), { signal: controller.signal }),
          fetch(apiUrl('users'), { signal: controller.signal }),
        ])
        const [conversationResult, userResult] = await Promise.all([
          readApiResponse(conversationResponse),
          readApiResponse(userResponse),
        ])
        setConversations(conversationResult.conversations)
        setContacts(userResult.users)
        setActiveId((current) => (
          current || conversationResult.conversations[0]?.id || ''
        ))
      } catch (requestError) {
        if (requestError.name !== 'AbortError') setError(requestError.message)
      } finally {
        if (!controller.signal.aborted) setIsLoadingChats(false)
      }
    }

    loadChats()
    return () => controller.abort()
  }, [user])

  useEffect(() => {
    if (!user) return undefined
    const socket = io({ withCredentials: true })
    socketRef.current = socket

    function joinActiveConversation() {
      const conversationId = activeIdRef.current
      if (!conversationId) return
      socket.emit('conversation:join', { conversationId }, (result) => {
        if (result?.error) setError(result.error)
      })
    }

    function handleMessage(message) {
      setMessagesByConversation((current) => ({
        ...current,
        [message.conversationId]: mergeMessages(
          current[message.conversationId] || [],
          [message],
        ),
      }))
      setConversations((current) => current.map((conversation) => (
        conversation.id === message.conversationId
          ? {
              ...conversation,
              lastMessage: message.content,
              lastMessageAt: message.createdAt,
            }
          : conversation
      )))
    }

    socket.on('connect', joinActiveConversation)
    socket.on('message:new', handleMessage)
    socket.on('session:expired', () => {
      setAuthMessage('Your session expired. Please sign in again.')
      setUser(null)
      setAuthStatus('signedOut')
    })
    socket.on('presence:update', ({ userId, online }) => {
      setContacts((current) => current.map((contact) => (
        contact.id === userId ? { ...contact, online } : contact
      )))
      setConversations((current) => current.map((conversation) => (
        conversation.participantId === userId ? { ...conversation, online } : conversation
      )))
    })
    socket.on('connect_error', (socketError) => {
      if (socketError.message === 'Authentication required.') {
        setAuthMessage('Your session expired. Please sign in again.')
        setUser(null)
        setAuthStatus('signedOut')
      } else {
        setError('Real-time connection unavailable. Check that the chat server is running.')
      }
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [user])

  useEffect(() => {
    if (!user || !activeId) return undefined
    const controller = new AbortController()
    setIsLoadingMessages(true)
    const socket = socketRef.current
    if (socket?.connected) {
      socket.emit('conversation:join', { conversationId: activeId }, (result) => {
        if (result?.error) setError(result.error)
      })
    }

    async function loadMessages() {
      try {
        const response = await fetch(
          apiUrl(`conversations/${encodeURIComponent(activeId)}/messages`),
          { signal: controller.signal },
        )
        const result = await readApiResponse(response)
        setMessagesByConversation((current) => ({
          ...current,
          [activeId]: mergeMessages(current[activeId] || [], result.messages),
        }))
      } catch (requestError) {
        if (requestError.name !== 'AbortError') setError(requestError.message)
      } finally {
        if (!controller.signal.aborted) setIsLoadingMessages(false)
      }
    }

    loadMessages()
    return () => controller.abort()
  }, [activeId, user])

  useEffect(() => {
    const thread = threadRef.current
    if (thread) thread.scrollTop = thread.scrollHeight
  }, [activeId, messagesByConversation])

  async function authenticate(credentials, isRegistering) {
    let response
    try {
      response = await fetch(apiUrl(`auth/${isRegistering ? 'register' : 'login'}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      })
    } catch {
      throw new Error('Unable to reach the server. Please try again.')
    }

    const result = await readApiResponse(response)
    setAuthMessage('')
    setError('')
    setUser(result.user)
    setAuthStatus('signedIn')
  }

  async function logout() {
    try {
      const response = await fetch(apiUrl('auth/logout'), { method: 'POST' })
      if (!response.ok) throw new Error('Unable to sign out. Please try again.')
      socketRef.current?.disconnect()
      setUser(null)
      setAuthStatus('signedOut')
      setConversations([])
      setContacts([])
      setMessagesByConversation({})
      setActiveId('')
      setError('')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function openContactPicker() {
    setIsContactPickerOpen(true)
    setContactError('')
    try {
      const response = await fetch(apiUrl('users'))
      const result = await readApiResponse(response)
      setContacts(result.users)
    } catch (requestError) {
      setContactError(requestError.message)
    }
  }

  async function openConversation(participantId) {
    setError('')
    try {
      const response = await fetch(apiUrl('conversations'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId }),
      })
      const result = await readApiResponse(response)
      setActiveId(result.conversationId)
      setIsContactPickerOpen(false)
      setMobileChatOpen(true)

      const [conversationResponse, userResponse] = await Promise.all([
        fetch(apiUrl('conversations')),
        fetch(apiUrl('users')),
      ])
      const [conversationResult, userResult] = await Promise.all([
        readApiResponse(conversationResponse),
        readApiResponse(userResponse),
      ])
      setConversations(conversationResult.conversations)
      setContacts(userResult.users)
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  function sendMessage(event) {
    event.preventDefault()
    const content = draft.trim()
    const socket = socketRef.current
    if (!content || !activeId || isSending) return
    if (content.length > 4000) {
      setError('Messages can be up to 4000 characters.')
      return
    }
    if (!socket?.connected) {
      setError('The real-time connection is not available. Please try again.')
      return
    }

    setError('')
    setIsSending(true)
    socket.emit('message:send', { conversationId: activeId, content }, (result) => {
      setIsSending(false)
      if (result?.error) {
        setError(result.error)
        return
      }
      if (result?.message) {
        setMessagesByConversation((current) => ({
          ...current,
          [activeId]: mergeMessages(current[activeId] || [], [result.message]),
        }))
        setConversations((current) => current.map((conversation) => (
          conversation.id === activeId
            ? {
                ...conversation,
                lastMessage: result.message.content,
                lastMessageAt: result.message.createdAt,
              }
            : conversation
        )))
        setDraft('')
      }
    })
  }

  if (authStatus === 'checking') {
    return <main className="login-page"><p className="login-loading">Checking your session…</p></main>
  }

  if (authStatus !== 'signedIn' || !user) {
    return <Login onLogin={authenticate} message={authMessage} />
  }

  const activeConversation = conversations.find((conversation) => conversation.id === activeId)
  const activeMessages = messagesByConversation[activeId] || []
  const visibleConversations = conversations.filter((conversation) =>
    conversation.participantUsername.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <main className="app-shell">
      <section className={`inbox-panel${mobileChatOpen ? ' inbox-panel--hidden' : ''}`} aria-label="Messages">
        <header className="inbox-heading">
          <div>
            <h1>Messages</h1>
            <p className="current-user-label">Signed in as @{user.username}</p>
          </div>
          <div className="inbox-actions">
            <button
              className="icon-button"
              type="button"
              aria-label="Start a conversation"
              title="Start a conversation"
              onClick={openContactPicker}
            >
              <Icon name="plus" size={23} />
            </button>
            <button className="logout-button" type="button" onClick={logout}>Sign out</button>
          </div>
        </header>
        <label className="search-box">
          <Icon name="search" size={18} />
          <input
            type="search"
            placeholder="Search conversations"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button type="button" aria-label="Clear search" onClick={() => setSearch('')}>
              <Icon name="close" size={16} />
            </button>
          )}
        </label>

        <div className="conversation-list">
          {visibleConversations.map((conversation) => (
            <button
              className={`conversation-row${conversation.id === activeId ? ' conversation-row--active' : ''}`}
              type="button"
              key={conversation.id}
              onClick={() => {
                setActiveId(conversation.id)
                setMobileChatOpen(true)
                setDraft('')
                setError('')
              }}
            >
              <Avatar
                name={conversation.participantUsername}
                size="large"
                online={conversation.online}
              />
              <span className="conversation-copy">
                <span className="conversation-name">@{conversation.participantUsername}</span>
                <span className="conversation-preview">
                  {conversation.lastMessage || 'Start a conversation'}
                  {conversation.lastMessageAt && (
                    <span className="preview-separator"> · {formatTime(conversation.lastMessageAt)}</span>
                  )}
                </span>
              </span>
            </button>
          ))}
          {!isLoadingChats && visibleConversations.length === 0 && (
            <div className="empty-search">
              {conversations.length
                ? 'No conversations match your search.'
                : 'No conversations yet. Start one with another registered user.'}
            </div>
          )}
        </div>
      </section>

      {activeConversation ? (
        <section
          className={`chat-panel${mobileChatOpen ? ' chat-panel--visible' : ''}`}
          aria-label={`Chat with ${activeConversation.participantUsername}`}
        >
          <header className="chat-header">
            <button
              className="icon-button mobile-back"
              type="button"
              aria-label="Back to conversations"
              onClick={() => setMobileChatOpen(false)}
            >
              <Icon name="back" />
            </button>
            <Avatar
              name={activeConversation.participantUsername}
              online={activeConversation.online}
            />
            <div className="chat-contact">
              <strong>@{activeConversation.participantUsername}</strong>
              <span>{activeConversation.online ? 'Online' : 'Offline'}</span>
            </div>
          </header>

          <div className="chat-body" ref={threadRef}>
            <div className="chat-date"><span>Conversation</span></div>
            <div className="message-thread">
              {activeMessages.map((message) => {
                const isMine = message.senderId === user.id
                return (
                  <div className={`message-line message-line--${isMine ? 'me' : 'them'}`} key={message.id}>
                    {!isMine && (
                      <Avatar name={message.senderUsername} size="tiny" />
                    )}
                    <div className="message-content">
                      <p className="message-bubble">{message.content}</p>
                      <span className="message-time">
                        {isMine ? 'You · ' : `@${message.senderUsername} · `}
                        {formatTime(message.createdAt)}
                      </span>
                    </div>
                  </div>
                )
              })}
              {!isLoadingMessages && activeMessages.length === 0 && (
                <p className="empty-thread">This conversation is ready. Send the first message.</p>
              )}
            </div>
          </div>

          {error && <p className="chat-error" role="alert">{error}</p>}
          <form className="message-composer" onSubmit={sendMessage}>
            <input
              aria-label="Message"
              placeholder="Message..."
              value={draft}
              maxLength={4000}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button className="send-button" type="submit" disabled={!draft.trim() || isSending}>
              {isSending ? 'Sending…' : 'Send'}
            </button>
          </form>
        </section>
      ) : (
        <section className="chat-panel chat-empty">
          <Icon name="send" size={42} />
          <h2>{isLoadingChats ? 'Loading your conversations' : 'Start a conversation'}</h2>
          <p>
            {isLoadingChats
              ? 'Loading records from your database.'
              : 'Choose another registered user to start a private chat.'}
          </p>
          {!isLoadingChats && (
            <button className="send-button empty-start-button" type="button" onClick={openContactPicker}>
              Find a user
            </button>
          )}
          {error && <p className="chat-error" role="alert">{error}</p>}
        </section>
      )}

      {isContactPickerOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setIsContactPickerOpen(false)
        }}>
          <section className="contact-picker" role="dialog" aria-modal="true" aria-labelledby="contact-picker-title">
            <header>
              <div>
                <h2 id="contact-picker-title">Start a conversation</h2>
                <p>Choose an account registered in this app.</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close"
                onClick={() => setIsContactPickerOpen(false)}
              >
                <Icon name="close" />
              </button>
            </header>
            <div className="contact-picker-list">
              {contactError && <p className="chat-error" role="alert">{contactError}</p>}
              {contacts.map((contact) => (
                <button
                  className="contact-picker-row"
                  key={contact.id}
                  type="button"
                  onClick={() => openConversation(contact.id)}
                >
                  <Avatar name={contact.username} online={contact.online} />
                  <span>@{contact.username}</span>
                  <small>{contact.online ? 'Online' : 'Offline'}</small>
                  <span className="contact-picker-action">
                    {contact.conversationId ? 'Open' : 'Message'}
                  </span>
                </button>
              ))}
              {contacts.length === 0 && (
                <p className="empty-search">
                  No other accounts are registered yet. Create another account in a separate browser session.
                </p>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

export default App
