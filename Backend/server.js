import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import bcrypt from 'bcryptjs'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import { rateLimit } from 'express-rate-limit'
import jwt from 'jsonwebtoken'
import { Server as SocketServer } from 'socket.io'
import { initializeDatabase, pool } from './database.js'

const port = Number(process.env.PORT || 3001)
const jwtSecret = process.env.JWT_SECRET
const cookieName = 'muse_session'
const jwtIssuer = 'muse-api'
const jwtAudience = 'muse-web'
const isProduction = process.env.NODE_ENV === 'production'
const allowedOrigins = new Set(
  (process.env.WEB_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
)

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a valid TCP port.')
}
if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be set to at least 32 characters.')
}

const app = express()
const httpServer = createServer(app)
app.set('trust proxy', 1)

const io = new SocketServer(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true)
      return callback(new Error('Origin is not allowed.'))
    },
    credentials: true,
  },
})
const onlineUsers = new Set()
const messageRateWindows = new Map()

app.disable('x-powered-by')
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true)
    return callback(new Error('Origin is not allowed.'))
  },
  credentials: true,
}))
app.use(express.json({ limit: '12kb' }))
app.use(cookieParser())

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({ error: 'Too many attempts. Please try again later.' })
  },
})
const messagingRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({ error: 'Too many requests. Please try again later.' })
  },
})

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function isValidEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function readTokenFromCookieHeader(header = '') {
  const cookie = header.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
  return cookie ? cookie.slice(cookieName.length + 1) : null
}

function getRequestToken(request) {
  const authorization = request.get('authorization')
  if (authorization) {
    const bearer = /^Bearer\s+([^\s]+)$/i.exec(authorization)
    return bearer?.[1] || null
  }
  return request.cookies[cookieName] || null
}

function verifyToken(token) {
  if (!token) return null

  try {
    const payload = jwt.verify(token, jwtSecret, {
      algorithms: ['HS256'],
      issuer: jwtIssuer,
      audience: jwtAudience,
    })
    return typeof payload === 'object' && typeof payload.sub === 'string'
      ? payload
      : null
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return null
    }
    throw error
  }
}

function createSessionToken(userId, rememberMe) {
  const durationMs = rememberMe ? 7 * 24 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000
  const tokenId = randomUUID()
  const token = jwt.sign({ sub: String(userId) }, jwtSecret, {
    algorithm: 'HS256',
    expiresIn: Math.floor(durationMs / 1000),
    issuer: jwtIssuer,
    audience: jwtAudience,
    jwtid: tokenId,
  })

  return {
    token,
    tokenId,
    expiresAt: new Date(Date.now() + durationMs),
    durationMs,
  }
}

async function saveSession(connection, userId, session) {
  await connection.query(
    'INSERT INTO auth_sessions (token_id, user_id, expires_at) VALUES ($1, $2, $3)',
    [session.tokenId, userId, session.expiresAt],
  )
}

function setSessionCookie(response, session, rememberMe) {
  response.set('Cache-Control', 'no-store')
  response.cookie(cookieName, session.token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: rememberMe ? session.durationMs : undefined,
    path: '/',
  })
  return session.token
}

async function hasActiveSession(payload) {
  if (!payload || typeof payload.jti !== 'string') return false

  const result = await pool.query(
    `SELECT 1 FROM auth_sessions
     WHERE token_id = $1 AND user_id = $2 AND expires_at > NOW()`,
    [payload.jti, payload.sub],
  )
  return result.rowCount > 0
}

async function revokeSession(payload) {
  if (!(await hasActiveSession(payload))) return

  await pool.query('DELETE FROM auth_sessions WHERE token_id = $1', [payload.jti])
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.tokenId === payload.jti) socket.disconnect(true)
  }
}

async function authenticate(request, response, next) {
  let token = getRequestToken(request)
  let payload = verifyToken(token)
  let isActive = await hasActiveSession(payload)

  if (!isActive && request.get('authorization')) {
    const cookieToken = request.cookies[cookieName]
    const cookiePayload = verifyToken(cookieToken)
    if (await hasActiveSession(cookiePayload)) {
      token = cookieToken
      payload = cookiePayload
      isActive = true
    }
  }

  if (!isActive) {
    response.clearCookie(cookieName, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    })
    return response.status(401).json({ error: 'Your session has expired. Please sign in again.' })
  }

  const result = await pool.query(
    'SELECT id::text, username, email FROM users WHERE id = $1',
    [payload.sub],
  )
  if (!result.rows[0]) {
    response.clearCookie(cookieName, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    })
    return response.status(401).json({ error: 'Your account is no longer available.' })
  }

  request.user = result.rows[0]
  return next()
}

function validId(value) {
  return typeof value === 'string'
    && /^[1-9]\d{0,18}$/.test(value)
    && (value.length < 19 || value <= '9223372036854775807')
}

function mapMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderUsername: row.sender_username,
    content: row.content,
    createdAt: row.created_at,
  }
}

app.get('/api/health', async (_request, response) => {
  await pool.query('SELECT 1')
  response.json({ status: 'ok' })
})

app.post('/api/auth/register', authRateLimit, async (request, response) => {
  const body = request.body
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const email = normalizeEmail(body?.email)
  const password = body?.password

  if (!/^[A-Za-z0-9_]{2,32}$/.test(username) || !isValidEmail(email)) {
    return response.status(400).json({
      error: 'Use a 2–32 character username (letters, numbers, underscores) and a valid email address.',
    })
  }
  if (
    typeof password !== 'string'
    || password.length < 8
    || Buffer.byteLength(password, 'utf8') > 72
  ) {
    return response.status(400).json({ error: 'Password must be between 8 and 72 bytes.' })
  }

  const existing = await pool.query(
    'SELECT email, username FROM users WHERE LOWER(email) = $1 OR LOWER(username) = LOWER($2)',
    [email, username],
  )
  if (existing.rows.some((user) => user.email.toLowerCase() === email)) {
    return response.status(409).json({ error: 'An account with that email already exists.' })
  }
  if (existing.rows.length) {
    return response.status(409).json({ error: 'That username is already taken.' })
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id::text, username, email`,
      [username, email, passwordHash],
    )
    const user = result.rows[0]
    const rememberMe = body.rememberMe === true
    const session = createSessionToken(user.id, rememberMe)
    await saveSession(client, user.id, session)
    await client.query('COMMIT')
    const accessToken = setSessionCookie(response, session, rememberMe)
    return response.status(201).json({ user, accessToken })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error.code === '23505' && error.constraint === 'users_email_lower_unique') {
      return response.status(409).json({ error: 'An account with that email already exists.' })
    }
    if (error.code === '23505' && error.constraint === 'users_username_lower_unique') {
      return response.status(409).json({ error: 'That username is already taken.' })
    }
    throw error
  } finally {
    client.release()
  }
})

app.post('/api/auth/login', authRateLimit, async (request, response) => {
  const email = normalizeEmail(request.body?.email)
  const password = request.body?.password
  if (
    !isValidEmail(email)
    || typeof password !== 'string'
    || Buffer.byteLength(password, 'utf8') > 72
  ) {
    return response.status(401).json({ error: 'Invalid email or password.' })
  }

  const result = await pool.query(
    'SELECT id::text, username, email, password_hash FROM users WHERE LOWER(email) = $1',
    [email],
  )
  const user = result.rows[0]
  const passwordHash = user?.password_hash
    || '$2b$12$C6UzMDM.H6dfI/f/IKcEe.5LBY6nBVI8w4bVj5x1GS3p8jHZbXb9K'
  const passwordMatches = await bcrypt.compare(password, passwordHash)
  if (!user || !passwordMatches) {
    return response.status(401).json({ error: 'Invalid email or password.' })
  }

  const rememberMe = request.body.rememberMe === true
  const session = createSessionToken(user.id, rememberMe)
  await saveSession(pool, user.id, session)
  const accessToken = setSessionCookie(response, session, rememberMe)
  return response.json({
    user: { id: user.id, username: user.username, email: user.email },
    accessToken,
  })
})

app.get('/api/auth/me', authenticate, (request, response) => {
  response.json({ user: request.user })
})

app.post('/api/auth/logout', async (request, response) => {
  let token = getRequestToken(request)
  let payload = verifyToken(token)
  if (!(await hasActiveSession(payload)) && request.get('authorization')) {
    token = request.cookies[cookieName]
    payload = verifyToken(token)
  }
  await revokeSession(payload)

  response.clearCookie(cookieName, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
  })
  response.status(204).end()
})

app.get('/api/users', authenticate, async (request, response) => {
  const result = await pool.query(
    `SELECT u.id::text, u.username, c.id::text AS conversation_id
     FROM users u
     LEFT JOIN conversations c
       ON (c.user_one_id = LEAST(u.id, $1::bigint)
           AND c.user_two_id = GREATEST(u.id, $1::bigint))
     WHERE u.id <> $1::bigint
     ORDER BY LOWER(u.username)`,
    [request.user.id],
  )
  response.json({
    users: result.rows.map((user) => ({
      id: user.id,
      username: user.username,
      online: onlineUsers.has(user.id),
      conversationId: user.conversation_id,
    })),
  })
})

app.get('/api/conversations', authenticate, async (request, response) => {
  const result = await pool.query(
    `SELECT c.id::text,
            other.id::text AS participant_id,
            other.username AS participant_username,
            latest.content AS last_message,
            latest.created_at AS last_message_at
     FROM conversations c
     JOIN users other
       ON other.id = CASE
         WHEN c.user_one_id = $1::bigint THEN c.user_two_id
         ELSE c.user_one_id
       END
     LEFT JOIN LATERAL (
       SELECT content, created_at
       FROM messages
       WHERE conversation_id = c.id
       ORDER BY id DESC
       LIMIT 1
     ) latest ON TRUE
     WHERE c.user_one_id = $1::bigint OR c.user_two_id = $1::bigint
     ORDER BY COALESCE(latest.created_at, c.created_at) DESC`,
    [request.user.id],
  )
  response.json({
    conversations: result.rows.map((conversation) => ({
      id: conversation.id,
      participantId: conversation.participant_id,
      participantUsername: conversation.participant_username,
      online: onlineUsers.has(conversation.participant_id),
      lastMessage: conversation.last_message,
      lastMessageAt: conversation.last_message_at,
    })),
  })
})

app.post('/api/conversations', authenticate, messagingRateLimit, async (request, response) => {
  const participantId = request.body?.participantId
  if (!validId(participantId) || participantId === request.user.id) {
    return response.status(400).json({ error: 'Choose a valid registered user.' })
  }

  const participant = await pool.query(
    'SELECT id FROM users WHERE id = $1::bigint',
    [participantId],
  )
  if (!participant.rowCount) {
    return response.status(404).json({ error: 'That user does not exist.' })
  }

  const inserted = await pool.query(
    `INSERT INTO conversations (user_one_id, user_two_id)
     VALUES (LEAST($1::bigint, $2::bigint), GREATEST($1::bigint, $2::bigint))
     ON CONFLICT (user_one_id, user_two_id) DO NOTHING
     RETURNING id::text`,
    [request.user.id, participantId],
  )
  const conversation = inserted.rows[0] || (await pool.query(
    `SELECT id::text FROM conversations
     WHERE user_one_id = LEAST($1::bigint, $2::bigint)
       AND user_two_id = GREATEST($1::bigint, $2::bigint)`,
    [request.user.id, participantId],
  )).rows[0]

  response.status(inserted.rowCount ? 201 : 200).json({ conversationId: conversation.id })
})

app.get(
  '/api/conversations/:conversationId/messages',
  authenticate,
  messagingRateLimit,
  async (request, response) => {
    const { conversationId } = request.params
    if (!validId(conversationId)) {
      return response.status(400).json({ error: 'Invalid conversation.' })
    }

    const membership = await pool.query(
      `SELECT 1 FROM conversations
       WHERE id = $1::bigint
         AND (user_one_id = $2::bigint OR user_two_id = $2::bigint)`,
      [conversationId, request.user.id],
    )
    if (!membership.rowCount) {
      return response.status(404).json({ error: 'Conversation not found.' })
    }

    const result = await pool.query(
      `SELECT m.id::text, m.conversation_id::text, m.sender_id::text,
              u.username AS sender_username, m.content, m.created_at
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1::bigint
       ORDER BY m.id DESC
       LIMIT 100`,
      [conversationId],
    )
    response.json({ messages: result.rows.reverse().map(mapMessage) })
  },
)

app.use((error, _request, response, next) => {
  if (response.headersSent) return next(error)
  if (error.type === 'entity.parse.failed') {
    return response.status(400).json({ error: 'Request body must be valid JSON.' })
  }
  if (error.message === 'Origin is not allowed.') {
    return response.status(403).json({ error: 'Origin is not allowed.' })
  }
  console.error('API request failed:', error.message)
  return response.status(500).json({ error: 'Internal server error.' })
})

io.use(async (socket, next) => {
  try {
    const authToken = socket.handshake.auth?.token
    let token = typeof authToken === 'string' && authToken
      ? authToken
      : readTokenFromCookieHeader(socket.handshake.headers.cookie)
    let payload = verifyToken(token)
    let isActive = await hasActiveSession(payload)

    if (!isActive && typeof authToken === 'string' && authToken) {
      const cookieToken = readTokenFromCookieHeader(socket.handshake.headers.cookie)
      const cookiePayload = verifyToken(cookieToken)
      if (await hasActiveSession(cookiePayload)) {
        token = cookieToken
        payload = cookiePayload
        isActive = true
      }
    }

    if (!isActive) {
      return next(new Error(token ? 'Session expired or invalid.' : 'Authentication required.'))
    }

    const result = await pool.query(
      'SELECT id::text, username FROM users WHERE id = $1',
      [payload.sub],
    )
    if (!result.rows[0]) return next(new Error('Account not found.'))

    socket.data.user = result.rows[0]
    socket.data.tokenId = payload.jti
    socket.data.tokenExpiresAt = payload.exp * 1000
    return next()
  } catch (error) {
    console.error('Socket authentication failed:', error.message)
    return next(new Error('Unable to authenticate this connection.'))
  }
})

io.on('connection', (socket) => {
  const userId = socket.data.user.id
  const userRoom = `user:${userId}`
  socket.join(userRoom)

  if (!onlineUsers.has(userId)) {
    onlineUsers.add(userId)
    io.emit('presence:update', { userId, online: true })
  }

  const expiryTimer = setTimeout(
    () => {
      socket.emit('session:expired')
      socket.disconnect(true)
    },
    Math.max(1, socket.data.tokenExpiresAt - Date.now()),
  )
  expiryTimer.unref()

  socket.on('conversation:join', async (payload, acknowledge) => {
    const reply = typeof acknowledge === 'function' ? acknowledge : () => {}
    if (!validId(payload?.conversationId)) {
      return reply({ error: 'Invalid conversation.' })
    }
    try {
      const membership = await pool.query(
        `SELECT 1 FROM conversations
         WHERE id = $1::bigint
           AND (user_one_id = $2::bigint OR user_two_id = $2::bigint)`,
        [payload.conversationId, userId],
      )
      if (!membership.rowCount) return reply({ error: 'Conversation not found.' })

      await socket.join(`conversation:${payload.conversationId}`)
      return reply({ ok: true })
    } catch (error) {
      console.error('Unable to join conversation:', error.message)
      return reply({ error: 'Unable to join this conversation.' })
    }
  })

  socket.on('message:send', async (payload, acknowledge) => {
    const reply = typeof acknowledge === 'function' ? acknowledge : () => {}
    const conversationId = payload?.conversationId
    const content = typeof payload?.content === 'string' ? payload.content.trim() : ''
    if (!validId(conversationId) || !content || content.length > 4000) {
      return reply({ error: 'Messages must contain 1–4000 characters.' })
    }
    if (!socket.rooms.has(`conversation:${conversationId}`)) {
      return reply({ error: 'Join this conversation before sending a message.' })
    }

    const now = Date.now()
    const rateWindow = messageRateWindows.get(userId)
    if (rateWindow && now - rateWindow.startedAt < 60_000 && rateWindow.count >= 30) {
      return reply({ error: 'You are sending messages too quickly. Try again shortly.' })
    }
    if (!rateWindow || now - rateWindow.startedAt >= 60_000) {
      messageRateWindows.set(userId, { startedAt: now, count: 1 })
    } else {
      rateWindow.count += 1
    }

    let client
    let message
    let recipientId
    try {
      client = await pool.connect()
      await client.query('BEGIN')
      const membership = await client.query(
        `SELECT user_one_id::text, user_two_id::text
         FROM conversations
         WHERE id = $1::bigint
           AND (user_one_id = $2::bigint OR user_two_id = $2::bigint)
         FOR SHARE`,
        [conversationId, userId],
      )
      if (!membership.rowCount) {
        await client.query('ROLLBACK')
        return reply({ error: 'Conversation not found.' })
      }

      const conversation = membership.rows[0]
      recipientId = conversation.user_one_id === userId
        ? conversation.user_two_id
        : conversation.user_one_id
      const result = await client.query(
        `INSERT INTO messages (conversation_id, sender_id, content)
         VALUES ($1::bigint, $2::bigint, $3)
         RETURNING id::text, conversation_id::text, sender_id::text, content, created_at`,
        [conversationId, userId, content],
      )
      message = {
        ...mapMessage({ ...result.rows[0], sender_username: socket.data.user.username }),
        conversationId,
      }
      await client.query('COMMIT')
    } catch (error) {
      if (client) await client.query('ROLLBACK')
      console.error('Unable to save message:', error.message)
      return reply({ error: 'Message could not be saved.' })
    } finally {
      client?.release()
    }

    io.to(`user:${recipientId}`).emit('message:new', message)
    io.to(userRoom).except(socket.id).emit('message:new', message)
    return reply({ message })
  })

  socket.on('disconnect', () => {
    clearTimeout(expiryTimer)
    const otherConnections = io.sockets.adapter.rooms.get(userRoom)
    if (!otherConnections?.size) {
      onlineUsers.delete(userId)
      io.emit('presence:update', { userId, online: false })
    }
  })
})

async function start() {
  await initializeDatabase()
  httpServer.listen(port, () => {
    console.log(`Muse chat API listening on port ${port}`)
  })
}

async function stop() {
  io.close()
  await pool.end()
}

process.once('SIGINT', () => {
  stop().finally(() => process.exit(0))
})
process.once('SIGTERM', () => {
  stop().finally(() => process.exit(0))
})

start().catch((error) => {
  console.error('Unable to start the chat API:', error.message)
  process.exitCode = 1
})
