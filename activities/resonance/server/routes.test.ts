import { createSessionStore, type SessionRecord } from 'activebits-server/core/sessions.js'
import {
  generatePersistentHash,
  getOrCreateActivePersistentSession,
  initializePersistentStorage,
  startPersistentSession,
} from 'activebits-server/core/persistentSessions.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import type { WsRouter } from '../../../types/websocket.js'
import setupResonanceRoutes, {
  generateImportedQuestionId,
  resolveAnswerabilityErrorMessage,
  resolveSocketStudentId,
} from './routes.js'

interface RouteRequest {
  params: Record<string, string | undefined>
  cookies?: Record<string, unknown>
  headers?: Record<string, string | undefined>
  body?: unknown
  query?: Record<string, unknown>
}

interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: unknown): JsonResponse | void
}

type RouteHandler = (req: RouteRequest, res: JsonResponse) => Promise<void> | void

interface MockResponse {
  statusCode: number
  body: unknown
  status(code: number): MockResponse
  json(payload: unknown): MockResponse
}

function createResponse(): MockResponse {
  return {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
  }
}

function createMockApp() {
  const handlers: { get: Record<string, RouteHandler>; post: Record<string, RouteHandler> } = {
    get: {},
    post: {},
  }

  return {
    handlers,
    get(path: string, handler: RouteHandler) {
      handlers.get[path] = handler
    },
    post(path: string, handler: RouteHandler) {
      handlers.post[path] = handler
    },
  }
}

function createMockWs(): WsRouter {
  return {
    wss: {
      clients: new Set(),
      close() {},
    },
    register() {},
  }
}

void test('generateImportedQuestionId falls back when Math.random produces an empty suffix', () => {
  assert.equal(
    generateImportedQuestionId(
      new Set(['q1']),
      () => 0,
      () => 1_700_000_000_000,
    ),
    'q_imported_loyw3v28',
  )
})

void test('resolveSocketStudentId rejects student messages that claim another identity', () => {
  assert.equal(resolveSocketStudentId('student2', 'student1'), null)
  assert.equal(resolveSocketStudentId('student1', 'student1'), 'student1')
})

function createEmbeddedResonanceSession(): SessionRecord {
  const now = Date.now()
  return {
    id: 'CHILD:syncdeck-parent:abcde:resonance',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      embeddedParentSessionId: 'syncdeck-parent',
      embeddedInstanceKey: 'resonance:2:0',
      embeddedLaunch: {
        parentSessionId: 'syncdeck-parent',
        instanceKey: 'resonance:2:0',
        selectedOptions: {
          questions: [
            {
              id: 'q1',
              type: 'free-response',
              text: 'What is one thing you are still uncertain about?',
              order: 0,
            },
          ],
        },
      },
    },
  }
}

function createInstructorResonanceSession(): SessionRecord {
  const now = Date.now()
  return {
    id: 'resonance-session-1',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      instructorPasscode: 'TEACH123',
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'Explain your reasoning.',
          order: 0,
        },
      ],
      activeQuestionId: 'q1',
      students: {
        student1: { studentId: 'student1', name: 'Ada Lovelace', joinedAt: now - 2000 },
        student2: { studentId: 'student2', name: 'Grace Hopper', joinedAt: now - 1500 },
        student3: { studentId: 'student3', name: 'Katherine Johnson', joinedAt: now - 1000 },
      },
      responses: [
        {
          id: 'r1',
          questionId: 'q1',
          studentId: 'student1',
          submittedAt: now - 500,
          answer: {
            type: 'free-response',
            text: 'I think the loop exits when the counter reaches zero.',
          },
        },
      ],
      responseDrafts: {
        'q1:student2': {
          questionId: 'q1',
          studentId: 'student2',
          updatedAt: now - 100,
          answer: {
            type: 'free-response',
            text: 'Still working through the condition...',
          },
        },
      },
      annotations: {},
      reveals: [],
      sharedResponseReactions: {},
      responseOrderOverrides: {},
      persistentHash: null,
    },
  }
}

function createMultiQuestionSession(): SessionRecord {
  const now = Date.now()
  return {
    id: 'resonance-session-multi',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      instructorPasscode: 'TEACH123',
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'Explain your reasoning.',
          order: 0,
          responseTimeLimitMs: 30_000,
        },
        {
          id: 'q2',
          type: 'multiple-choice',
          text: 'Which option best fits?',
          order: 1,
          responseTimeLimitMs: 45_000,
          options: [
            { id: 'q2_a', text: 'Option A' },
            { id: 'q2_b', text: 'Option B' },
          ],
        },
      ],
      activeQuestionId: null,
      activeQuestionIds: [],
      activeQuestionDeadlineAt: null,
      students: {
        student1: { studentId: 'student1', name: 'Ada Lovelace', joinedAt: now - 2_000 },
      },
      responses: [],
      responseDrafts: {},
      annotations: {},
      reveals: [],
      sharedResponseReactions: {},
      responseOrderOverrides: {},
      persistentHash: null,
    },
  }
}

void test('embedded resonance sessions receive a stable instructor passcode during normalization', async () => {
  const sessions = createSessionStore(null)
  const session = createEmbeddedResonanceSession()

  await sessions.set(session.id, session)

  const stored = await sessions.get(session.id)
  const storedAgain = await sessions.get(session.id)
  const firstPasscode = (stored?.data as { instructorPasscode?: string } | undefined)?.instructorPasscode ?? null
  const secondPasscode = (storedAgain?.data as { instructorPasscode?: string } | undefined)?.instructorPasscode ?? null
  const questions = (stored?.data as { questions?: Array<{ id?: string; type?: string }> } | undefined)?.questions ?? []

  assert.ok(firstPasscode)
  assert.match(firstPasscode, /^[A-Z0-9]{8}$/)
  assert.equal(secondPasscode, firstPasscode)
  assert.equal(questions.length, 1)
  assert.equal(questions[0]?.id, 'q1')
  assert.equal(questions[0]?.type, 'free-response')

  await sessions.close()
})

void test('resolveAnswerabilityErrorMessage distinguishes staged submission failure reasons', () => {
  assert.equal(resolveAnswerabilityErrorMessage('expired'), 'time is up for this question')
  assert.equal(resolveAnswerabilityErrorMessage('inactive'), 'question is not active')
  assert.equal(resolveAnswerabilityErrorMessage('choices-hidden'), 'choices have not been revealed')
})

void test('timed live runs finalize persisted drafts for every active question', async () => {
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  const now = Date.now()
  session.data.activeQuestionId = 'q1'
  session.data.activeQuestionIds = ['q1', 'q2']
  session.data.activeQuestionRunStartedAt = now - 10_000
  session.data.activeQuestionDeadlineAt = now - 1_000
  session.data.responseDrafts = {
    'q1:student1': {
      questionId: 'q1',
      studentId: 'student1',
      updatedAt: now - 2_000,
      answer: { type: 'free-response', text: 'First persisted draft' },
    },
    'q2:student1': {
      questionId: 'q2',
      studentId: 'student1',
      updatedAt: now - 2_000,
      answer: { type: 'multiple-choice', selectedOptionIds: ['q2_b'] },
    },
  }
  await sessions.set(session.id, session)

  const app = createMockApp()
  const ws = createMockWs()
  const studentMessages: Array<{ type?: string }> = []
  const instructorMessages: Array<{ type?: string }> = []
  ;(ws.wss.clients as Set<unknown>).add({
    readyState: 1,
    sessionId: session.id,
    isInstructor: false,
    studentId: 'student1',
    send(message: string) {
      studentMessages.push(JSON.parse(message) as { type?: string })
    },
  })
  ;(ws.wss.clients as Set<unknown>).add({
    readyState: 1,
    sessionId: session.id,
    isInstructor: true,
    send(message: string) {
      instructorMessages.push(JSON.parse(message) as { type?: string })
    },
  })
  setupResonanceRoutes(app, sessions, ws)
  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  const stateRes = createResponse()
  await stateHandler?.({ params: { sessionId: session.id } }, stateRes)

  const stored = await sessions.get(session.id)
  const storedData = stored?.data as {
    activeQuestionIds: string[]
    responseDrafts: Record<string, unknown>
    responses: Array<{ questionId: string; answer: unknown }>
  } | undefined
  assert.equal(stateRes.statusCode, 200)
  assert.ok(studentMessages.some((message) => message.type === 'resonance:session-state'))
  assert.ok(instructorMessages.some((message) => message.type === 'resonance:instructor-state'))
  assert.deepEqual(storedData?.activeQuestionIds, [])
  assert.equal(Object.keys(storedData?.responseDrafts ?? {}).length, 0)
  assert.deepEqual(
    storedData?.responses.map((response) => ({ questionId: response.questionId, answer: response.answer })),
    [
      { questionId: 'q1', answer: { type: 'free-response', text: 'First persisted draft' } },
      { questionId: 'q2', answer: { type: 'multiple-choice', selectedOptionIds: ['q2_b'] } },
    ],
  )

  await sessions.close()
})

void test('embedded resonance sessions auto-activate all questions when embedded launch requests it', async () => {
  const sessions = createSessionStore(null)
  const session = createEmbeddedResonanceSession()
  session.data.embeddedLaunch = {
    parentSessionId: 'syncdeck-parent',
    instanceKey: 'resonance:2:0',
    selectedOptions: {
      autoActivateAllQuestions: true,
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'What is one thing you are still uncertain about?',
          order: 0,
        },
        {
          id: 'q2',
          type: 'multiple-choice',
          text: 'Which answer is correct?',
          order: 1,
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
        },
      ],
    },
  }

  await sessions.set(session.id, session)

  const stored = await sessions.get(session.id)
  const storedData = stored?.data as {
    activeQuestionIds?: string[]
    embeddedAutoActivatedAt?: number | null
    embeddedLaunch?: { selectedOptions?: Record<string, unknown> }
  } | undefined

  assert.deepEqual(storedData?.activeQuestionIds, ['q1', 'q2'])
  assert.equal(typeof storedData?.embeddedAutoActivatedAt, 'number')
  assert.deepEqual(storedData?.embeddedLaunch?.selectedOptions, {
    questions: [
      {
        id: 'q1',
        type: 'free-response',
        text: 'What is one thing you are still uncertain about?',
        order: 0,
      },
      {
        id: 'q2',
        type: 'multiple-choice',
        text: 'Which answer is correct?',
        order: 1,
        options: [
          { id: 'a', text: 'A' },
          { id: 'b', text: 'B' },
        ],
      },
    ],
  })

  await sessions.close()
})

void test('staged embedded auto-activation stamps stem-only MCQ run start without starting timer', async () => {
  const sessions = createSessionStore(null)
  const session = createEmbeddedResonanceSession()
  session.data.embeddedLaunch = {
    parentSessionId: 'syncdeck-parent',
    instanceKey: 'resonance:2:0',
    selectedOptions: {
      autoActivateAllQuestions: true,
      presentationMode: 'staged',
      questions: [
        {
          id: 'q1',
          type: 'multiple-choice',
          text: 'Which answer is correct?',
          order: 0,
          responseTimeLimitMs: 30_000,
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
        },
      ],
    },
  }

  await sessions.set(session.id, session)

  const stored = await sessions.get(session.id)
  const stagedRun = stored?.data.stagedRun as { currentQuestionId?: string | null; choicesRevealed?: boolean } | null | undefined
  assert.deepEqual(stored?.data.activeQuestionIds, ['q1'])
  assert.equal(typeof stored?.data.activeQuestionRunStartedAt, 'number')
  assert.equal(stored?.data.activeQuestionDeadlineAt, null)
  assert.equal(stagedRun?.currentQuestionId, 'q1')
  assert.equal(stagedRun?.choicesRevealed, false)

  await sessions.close()
})

void test('embedded resonance sessions do not re-auto-activate after instructors clear questions', async () => {
  const sessions = createSessionStore(null)
  const session = createEmbeddedResonanceSession()
  session.data.embeddedLaunch = {
    parentSessionId: 'syncdeck-parent',
    instanceKey: 'resonance:2:0',
    selectedOptions: {
      autoActivateAllQuestions: true,
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'What is one thing you are still uncertain about?',
          order: 0,
        },
        {
          id: 'q2',
          type: 'multiple-choice',
          text: 'Which answer is correct?',
          order: 1,
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
        },
      ],
    },
  }

  await sessions.set(session.id, session)

  const initiallyStored = await sessions.get(session.id)
  const initiallyStoredData = initiallyStored?.data as {
    embeddedAutoActivatedAt?: number | null
  } | undefined
  assert.equal(typeof initiallyStoredData?.embeddedAutoActivatedAt, 'number')

  const clearedSession = await sessions.get(session.id)
  assert.ok(clearedSession)
  const clearedSessionData = clearedSession.data as Record<string, unknown>
  clearedSessionData.activeQuestionId = null
  clearedSessionData.activeQuestionIds = []
  clearedSessionData.activeQuestionRunStartedAt = null
  clearedSessionData.activeQuestionDeadlineAt = null
  clearedSessionData.embeddedLaunch = {
    parentSessionId: 'syncdeck-parent',
    instanceKey: 'resonance:2:0',
    selectedOptions: {
      autoActivateAllQuestions: true,
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'What is one thing you are still uncertain about?',
          order: 0,
        },
        {
          id: 'q2',
          type: 'multiple-choice',
          text: 'Which answer is correct?',
          order: 1,
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
        },
      ],
    },
  }
  await sessions.set(clearedSession.id, clearedSession)

  const afterClearStored = await sessions.get(session.id)
  const afterClearStoredData = afterClearStored?.data as {
    activeQuestionIds?: string[]
    activeQuestionRunStartedAt?: number | null
    activeQuestionDeadlineAt?: number | null
    embeddedAutoActivatedAt?: number | null
    embeddedLaunch?: { selectedOptions?: Record<string, unknown> }
  } | undefined

  assert.deepEqual(afterClearStoredData?.activeQuestionIds, [])
  assert.equal(afterClearStoredData?.activeQuestionRunStartedAt, null)
  assert.equal(afterClearStoredData?.activeQuestionDeadlineAt, null)
  assert.equal(typeof afterClearStoredData?.embeddedAutoActivatedAt, 'number')
  assert.deepEqual(afterClearStoredData?.embeddedLaunch?.selectedOptions, {
    questions: [
      {
        id: 'q1',
        type: 'free-response',
        text: 'What is one thing you are still uncertain about?',
        order: 0,
      },
      {
        id: 'q2',
        type: 'multiple-choice',
        text: 'Which answer is correct?',
        order: 1,
        options: [
          { id: 'a', text: 'A' },
          { id: 'b', text: 'B' },
        ],
      },
    ],
  })

  await sessions.close()
})

void test('self-paced embedded resonance sessions expose all questions to students when the parent SyncDeck session is standalone', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()

  await sessions.set('syncdeck-parent', {
    id: 'syncdeck-parent',
    type: 'syncdeck',
    created: now,
    lastActivity: now,
    data: {
      standaloneMode: true,
    },
  })

  const childSession = createEmbeddedResonanceSession()
  childSession.data.embeddedLaunch = {
    parentSessionId: 'syncdeck-parent',
    instanceKey: 'resonance:2:0',
    selectedOptions: {
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'What is one thing you are still uncertain about?',
          order: 0,
        },
        {
          id: 'q2',
          type: 'multiple-choice',
          text: 'Which answer is correct?',
          order: 1,
          options: [
            { id: 'a', text: 'A', isCorrect: true },
            { id: 'b', text: 'B' },
          ],
        },
      ],
    },
  }
  await sessions.set(childSession.id, childSession)

  setupResonanceRoutes(app, sessions, ws)

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof stateHandler, 'function')

  const response = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: childSession.id },
      query: { studentId: 'student1' },
    },
    response,
  )

  assert.equal(response.statusCode, 200)
  const body = response.body as {
    selfPacedMode?: boolean
    activeQuestionIds?: string[]
    activeQuestions?: Array<{ id: string }>
  }
  assert.equal(body.selfPacedMode, true)
  assert.deepEqual(body.activeQuestionIds, ['q1', 'q2'])
  assert.deepEqual(body.activeQuestions?.map((question) => question.id), ['q1', 'q2'])

  const storedChild = await sessions.get(childSession.id)
  assert.equal(
    (storedChild?.data as { selfPacedMode?: boolean } | undefined)?.selfPacedMode,
    true,
  )

  await sessions.close()
})

void test('self-paced embedded resonance sessions reveal MCQ correctness after the student submits every question', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()

  await sessions.set('syncdeck-parent', {
    id: 'syncdeck-parent',
    type: 'syncdeck',
    created: now,
    lastActivity: now,
    data: {
      standaloneMode: true,
    },
  })

  const session = createMultiQuestionSession()
  session.id = 'CHILD:syncdeck-parent:solo:resonance'
  session.data.embeddedParentSessionId = 'syncdeck-parent'
  session.data.embeddedInstanceKey = 'resonance:3:0'
  session.data.questions = [
    {
      id: 'q1',
      type: 'free-response',
      text: 'Explain your reasoning.',
      order: 0,
    },
    {
      id: 'q2',
      type: 'multiple-choice',
      text: 'Which option best fits?',
      order: 1,
      options: [
        { id: 'q2_a', text: 'Option A', isCorrect: true },
        { id: 'q2_b', text: 'Option B' },
      ],
    },
  ]
  session.data.responses = [
    {
      id: 'r1',
      questionId: 'q1',
      studentId: 'student1',
      submittedAt: now - 100,
      answer: {
        type: 'free-response',
        text: 'Because the condition becomes false.',
      },
    },
    {
      id: 'r2',
      questionId: 'q2',
      studentId: 'student1',
      submittedAt: now - 50,
      answer: {
        type: 'multiple-choice',
        selectedOptionIds: ['q2_b'],
      },
    },
  ]
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof stateHandler, 'function')

  const response = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
      query: { studentId: 'student1' },
    },
    response,
  )

  assert.equal(response.statusCode, 200)
  const body = response.body as {
    reveals?: Array<{
      questionId?: string
      correctOptionIds?: string[] | null
      viewerResponse?: {
        answer?: { type?: string; selectedOptionIds?: string[] }
      } | null
    }>
  }
  assert.deepEqual(body.reveals?.map((reveal) => reveal.questionId), ['q2'])
  assert.deepEqual(body.reveals?.[0]?.correctOptionIds, ['q2_a'])
  assert.deepEqual(body.reveals?.[0]?.viewerResponse?.answer, {
    type: 'multiple-choice',
    selectedOptionIds: ['q2_b'],
  })

  await sessions.close()
})

void test('student state normalizes legacy reveal answers that still use selectedOptionId', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()
  const session = createInstructorResonanceSession()

  session.data.questions = [
    {
      id: 'q2',
      type: 'multiple-choice',
      text: 'Which option best fits?',
      order: 1,
      options: [
        { id: 'q2_a', text: 'Option A', isCorrect: true },
        { id: 'q2_b', text: 'Option B' },
      ],
    },
  ]
  session.data.responses = [
    {
      id: 'r2',
      questionId: 'q2',
      studentId: 'student1',
      submittedAt: now - 50,
      answer: {
        type: 'multiple-choice',
        selectedOptionIds: ['q2_b'],
      },
    },
  ]
  session.data.reveals = [
    {
      questionId: 'q2',
      sharedAt: now,
      correctOptionIds: ['q2_a'],
      sharedResponses: [
        {
          id: 'r2',
          questionId: 'q2',
          answer: {
            type: 'multiple-choice',
            selectedOptionId: 'q2_b',
          } as unknown as { type: 'multiple-choice'; selectedOptionIds: string[] },
          sharedAt: now,
          instructorEmoji: null,
          reactions: {},
        },
      ],
      viewerResponse: {
        answer: {
          type: 'multiple-choice',
          selectedOptionId: 'q2_b',
        } as unknown as { type: 'multiple-choice'; selectedOptionIds: string[] },
        submittedAt: now - 50,
        instructorEmoji: null,
        isShared: true,
      },
    },
  ]
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof stateHandler, 'function')

  const response = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
      query: { studentId: 'student1' },
    },
    response,
  )

  assert.equal(response.statusCode, 200)
  const body = response.body as {
    reveals?: Array<{
      sharedResponses?: Array<{ answer?: { type?: string; selectedOptionIds?: string[] } }>
      viewerResponse?: { answer?: { type?: string; selectedOptionIds?: string[] } } | null
    }>
  }
  assert.deepEqual(body.reveals?.[0]?.sharedResponses?.[0]?.answer, {
    type: 'multiple-choice',
    selectedOptionIds: ['q2_b'],
  })
  assert.deepEqual(body.reveals?.[0]?.viewerResponse?.answer, {
    type: 'multiple-choice',
    selectedOptionIds: ['q2_b'],
  })

  await sessions.close()
})

void test('report route tolerates legacy reveal answers that still use selectedOptionId', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()
  const session = createInstructorResonanceSession()

  session.data.questions = [
    {
      id: 'q2',
      type: 'multiple-choice',
      text: 'Which option best fits?',
      order: 1,
      options: [
        { id: 'q2_a', text: 'Option A', isCorrect: true },
        { id: 'q2_b', text: 'Option B' },
      ],
    },
  ]
  session.data.responses = [
    {
      id: 'r2',
      questionId: 'q2',
      studentId: 'student1',
      submittedAt: now - 50,
      answer: {
        type: 'multiple-choice',
        selectedOptionIds: ['q2_b'],
      },
    },
  ]
  session.data.reveals = [
    {
      questionId: 'q2',
      sharedAt: now,
      correctOptionIds: ['q2_a'],
      sharedResponses: [
        {
          id: 'r2',
          questionId: 'q2',
          answer: {
            type: 'multiple-choice',
            selectedOptionId: 'q2_b',
          } as unknown as { type: 'multiple-choice'; selectedOptionIds: string[] },
          sharedAt: now,
          instructorEmoji: null,
          reactions: {},
        },
      ],
    },
  ]
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const reportHandler = app.handlers.get['/api/resonance/:sessionId/report']
  assert.equal(typeof reportHandler, 'function')

  const response = createResponse()
  await reportHandler?.(
    {
      params: { sessionId: session.id },
      headers: { 'x-instructor-passcode': 'TEACH123' },
      query: { format: 'json' },
    },
    response,
  )

  assert.equal(response.statusCode, 200)
  const body = response.body as {
    questions?: Array<{
      reveal?: {
        sharedResponses?: Array<{ answer?: { type?: string; selectedOptionIds?: string[] } }>
      } | null
    }>
  }
  assert.deepEqual(body.questions?.[0]?.reveal?.sharedResponses?.[0]?.answer, {
    type: 'multiple-choice',
    selectedOptionIds: ['q2_b'],
  })

  await sessions.close()
})

void test('self-paced embedded resonance sessions still surface annotated reviewed responses when no live run is active', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()

  await sessions.set('syncdeck-parent', {
    id: 'syncdeck-parent',
    type: 'syncdeck',
    created: now,
    lastActivity: now,
    data: {
      standaloneMode: true,
    },
  })

  const session = createEmbeddedResonanceSession()
  session.data.questions = [
    {
      id: 'q1',
      type: 'free-response',
      text: 'Explain your reasoning.',
      order: 0,
    },
  ]
  session.data.responses = [
    {
      id: 'r1',
      questionId: 'q1',
      studentId: 'student1',
      submittedAt: now - 200,
      answer: {
        type: 'free-response',
        text: 'My answer',
      },
    },
  ]
  session.data.students = {
    student1: { studentId: 'student1', name: 'Ada Lovelace', joinedAt: now - 1_000 },
  }
  session.data.annotations = {
    r1: {
      starred: false,
      flagged: false,
      emoji: '💡',
    },
  }
  session.data.reveals = []
  session.data.activeQuestionId = null
  session.data.activeQuestionIds = []
  session.data.activeQuestionDeadlineAt = null
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof stateHandler, 'function')

  const response = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
      query: {
        studentId: 'student1',
      },
    },
    response,
  )

  assert.equal(response.statusCode, 200)
  const body = response.body as {
    selfPacedMode?: boolean
    activeQuestionIds?: string[]
    reviewedResponses?: Array<{
      instructorEmoji?: string
      answer?: { text?: string }
      question?: { text?: string }
    }>
  }
  assert.equal(body.selfPacedMode, true)
  assert.deepEqual(body.activeQuestionIds, ['q1'])
  assert.equal(body.reviewedResponses?.[0]?.instructorEmoji, '💡')
  assert.equal(body.reviewedResponses?.[0]?.answer?.text, 'My answer')
  assert.equal(body.reviewedResponses?.[0]?.question?.text, 'Explain your reasoning.')

  await sessions.close()
})

void test('self-paced embedded resonance sessions switch back to live-run snapshot semantics once questions are activated', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()

  await sessions.set('syncdeck-parent', {
    id: 'syncdeck-parent',
    type: 'syncdeck',
    created: now,
    lastActivity: now,
    data: {
      standaloneMode: true,
    },
  })

  const session = createEmbeddedResonanceSession()
  session.data.questions = [
    {
      id: 'q1',
      type: 'free-response',
      text: 'Explain your reasoning.',
      order: 0,
    },
    {
      id: 'q2',
      type: 'multiple-choice',
      text: 'Which option best fits?',
      order: 1,
      options: [
        { id: 'a', text: 'A', isCorrect: true },
        { id: 'b', text: 'B' },
      ],
    },
  ]
  session.data.activeQuestionId = 'q2'
  session.data.activeQuestionIds = ['q2']
  session.data.activeQuestionRunStartedAt = now - 500
  session.data.activeQuestionDeadlineAt = now + 30_000
  session.data.students = {
    student1: { studentId: 'student1', name: 'Ada Lovelace', joinedAt: now - 1_000 },
  }
  session.data.responses = [
    {
      id: 'r1',
      questionId: 'q1',
      studentId: 'student1',
      submittedAt: now - 200,
      answer: {
        type: 'free-response',
        text: 'Earlier answer',
      },
    },
  ]
  session.data.annotations = {
    r1: {
      starred: false,
      flagged: false,
      emoji: '💡',
    },
  }
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof stateHandler, 'function')

  const response = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
      query: {
        studentId: 'student1',
      },
    },
    response,
  )

  assert.equal(response.statusCode, 200)
  const body = response.body as {
    selfPacedMode?: boolean
    activeQuestionIds?: string[]
    activeQuestions?: Array<{ id?: string }>
    reviewedResponses?: Array<{
      instructorEmoji?: string
      answer?: { text?: string }
      question?: { id?: string }
    }>
  }
  assert.equal(body.selfPacedMode, false)
  assert.deepEqual(body.activeQuestionIds, ['q2'])
  assert.deepEqual(body.activeQuestions?.map((question) => question.id), ['q2'])
  assert.equal(body.reviewedResponses?.[0]?.instructorEmoji, '💡')
  assert.equal(body.reviewedResponses?.[0]?.answer?.text, 'Earlier answer')
  assert.equal(body.reviewedResponses?.[0]?.question?.id, 'q1')

  await sessions.close()
})

void test('instructor-passcode route returns passcode for embedded child sessions when parent syncdeck teacher cookie matches', async () => {
  initializePersistentStorage(null)

  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const embeddedSession = createEmbeddedResonanceSession()
  await sessions.set(embeddedSession.id, embeddedSession)
  await sessions.set('syncdeck-parent', {
    id: 'syncdeck-parent',
    type: 'syncdeck',
    created: Date.now(),
    lastActivity: Date.now(),
    data: {},
  })

  const teacherCode = 'persistent-teacher-code'
  const { hash, hashedTeacherCode } = generatePersistentHash('syncdeck', teacherCode)
  await getOrCreateActivePersistentSession('syncdeck', hash, hashedTeacherCode)
  await startPersistentSession(hash, 'syncdeck-parent', {
    id: 'teacher-ws',
    readyState: 1,
    send() {},
  })

  setupResonanceRoutes(app, sessions, ws)

  const handler = app.handlers.get['/api/resonance/:sessionId/instructor-passcode']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: embeddedSession.id },
      cookies: {
        persistent_sessions: JSON.stringify([
          {
            key: `syncdeck:${hash}`,
            teacherCode,
          },
        ]),
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, {
    instructorPasscode: (await sessions.get(embeddedSession.id))?.data.instructorPasscode,
  })

  await sessions.close()
})

void test('prepare-link-options returns encrypted resonance selectedOptions without creating a persistent session', async () => {
  initializePersistentStorage(null)

  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)

  setupResonanceRoutes(app, sessions, ws)

  const handler = app.handlers.post['/api/resonance/prepare-link-options']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: {},
      body: {
        teacherCode: 'teacher-code',
        presentationMode: 'staged',
        questions: [
          {
            id: 'q1',
            type: 'free-response',
            text: 'What stood out?',
            order: 0,
          },
        ],
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as { selectedOptions?: { q?: string; h?: string; presentationMode?: string } }
  assert.equal(typeof body.selectedOptions?.q, 'string')
  assert.equal(typeof body.selectedOptions?.h, 'string')
  assert.equal(body.selectedOptions?.presentationMode, 'staged')
  assert.ok((body.selectedOptions?.q ?? '').length > 0)
  assert.equal((body.selectedOptions?.h ?? '').length, 20)

  await sessions.close()
})

void test('create supports explicit self-paced solo sessions from prepared question payloads', async () => {
  initializePersistentStorage(null)

  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)

  setupResonanceRoutes(app, sessions, ws)

  const prepareHandler = app.handlers.post['/api/resonance/prepare-link-options']
  const createHandler = app.handlers.post['/api/resonance/create']
  assert.equal(typeof prepareHandler, 'function')
  assert.equal(typeof createHandler, 'function')

  const prepareRes = createResponse()
  await prepareHandler?.(
    {
      params: {},
      body: {
        teacherCode: 'teacher-code',
        questions: [
          {
            id: 'q1',
            type: 'multiple-choice',
            text: 'Pick one',
            order: 0,
            options: [
              { id: 'a', text: 'A' },
              { id: 'b', text: 'B' },
            ],
            correctOptionIds: ['a'],
          },
        ],
      },
    },
    prepareRes,
  )

  const selectedOptions = (prepareRes.body as { selectedOptions?: { q?: string; h?: string } }).selectedOptions
  assert.equal(typeof selectedOptions?.q, 'string')
  assert.equal(typeof selectedOptions?.h, 'string')

  const createRes = createResponse()
  await createHandler?.(
    {
      params: {},
      body: {
        encodedQuestions: selectedOptions?.q,
        persistentHash: selectedOptions?.h,
        selfPacedMode: true,
      },
    },
    createRes,
  )

  assert.equal(createRes.statusCode, 200)
  const createdBody = createRes.body as { id?: string; instructorPasscode?: string }
  assert.equal(typeof createdBody.id, 'string')
  assert.equal(createdBody.instructorPasscode, undefined)

  const stored = createdBody.id ? await sessions.get(createdBody.id) : null
  const storedData = stored?.data as {
    selfPacedMode?: boolean
    questions?: Array<{ id?: string }>
    persistentHash?: string | null
  } | undefined
  assert.equal(stored?.type, 'resonance')
  assert.equal(storedData?.selfPacedMode, true)
  assert.equal(storedData?.persistentHash, selectedOptions?.h)
  assert.deepEqual(
    storedData?.questions?.map((question) => question.id),
    ['q1'],
  )

  await sessions.close()
})

void test('create rejects self-paced solo sessions when the prepared question payload is invalid', async () => {
  initializePersistentStorage(null)

  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)

  setupResonanceRoutes(app, sessions, ws)

  const createHandler = app.handlers.post['/api/resonance/create']
  assert.equal(typeof createHandler, 'function')

  const res = createResponse()
  await createHandler?.(
    {
      params: {},
      body: {
        encodedQuestions: 'tampered-payload',
        persistentHash: 'bad-hash',
        selfPacedMode: true,
      },
    },
    res,
  )

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.body, {
    error: 'self-paced Resonance launch requires a valid question payload',
  })

  await sessions.close()
})

void test('create supports explicit self-paced solo sessions from raw question payloads', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)

  setupResonanceRoutes(app, sessions, ws)

  const createHandler = app.handlers.post['/api/resonance/create']
  assert.equal(typeof createHandler, 'function')

  const res = createResponse()
  await createHandler?.(
    {
      params: {},
      body: {
        questions: [
          {
            id: 'q1',
            type: 'free-response',
            text: 'What is still unclear?',
            order: 0,
          },
        ],
        selfPacedMode: true,
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const createdBody = res.body as { id?: string; instructorPasscode?: string }
  assert.equal(typeof createdBody.id, 'string')
  assert.equal(createdBody.instructorPasscode, undefined)

  const stored = createdBody.id ? await sessions.get(createdBody.id) : null
  const storedData = stored?.data as {
    selfPacedMode?: boolean
    questions?: Array<{ id?: string }>
    persistentHash?: string | null
  } | undefined
  assert.equal(stored?.type, 'resonance')
  assert.equal(storedData?.selfPacedMode, true)
  assert.equal(storedData?.persistentHash, null)
  assert.deepEqual(
    storedData?.questions?.map((question) => question.id),
    ['q1'],
  )

  await sessions.close()
})

void test('create ignores raw question payloads when self-paced mode is not requested', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)

  setupResonanceRoutes(app, sessions, ws)

  const createHandler = app.handlers.post['/api/resonance/create']
  assert.equal(typeof createHandler, 'function')

  const res = createResponse()
  await createHandler?.(
    {
      params: {},
      body: {
        questions: [
          {
            id: 'q1',
            type: 'free-response',
            text: 'Should be ignored without self-paced mode',
            order: 0,
          },
        ],
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const createdBody = res.body as { id?: string; instructorPasscode?: string }
  assert.equal(typeof createdBody.id, 'string')
  assert.equal(typeof createdBody.instructorPasscode, 'string')

  const stored = createdBody.id ? await sessions.get(createdBody.id) : null
  const storedData = stored?.data as {
    selfPacedMode?: boolean
    questions?: Array<{ id?: string }>
  } | undefined
  assert.equal(stored?.type, 'resonance')
  assert.equal(storedData?.selfPacedMode, undefined)
  assert.deepEqual(storedData?.questions ?? [], [])

  await sessions.close()
})

void test('self-paced sessions created from raw multi-question payloads expose the full question set to students', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)

  setupResonanceRoutes(app, sessions, ws)

  const createHandler = app.handlers.post['/api/resonance/create']
  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof createHandler, 'function')
  assert.equal(typeof stateHandler, 'function')

  const createRes = createResponse()
  await createHandler?.(
    {
      params: {},
      body: {
        questions: [
          {
            id: 'q1',
            type: 'free-response',
            text: 'Question one',
            order: 0,
          },
          {
            id: 'q2',
            type: 'multiple-choice',
            text: 'Question two',
            order: 1,
            options: [
              { id: 'a', text: 'A' },
              { id: 'b', text: 'B' },
            ],
          },
          {
            id: 'q3',
            type: 'free-response',
            text: 'Question three',
            order: 2,
          },
        ],
        selfPacedMode: true,
      },
    },
    createRes,
  )

  assert.equal(createRes.statusCode, 200)
  const createdBody = createRes.body as { id?: string }
  assert.equal(typeof createdBody.id, 'string')

  const stateRes = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: createdBody.id },
      query: { studentId: 'student1' },
    },
    stateRes,
  )

  assert.equal(stateRes.statusCode, 200)
  const stateBody = stateRes.body as {
    selfPacedMode?: boolean
    activeQuestionIds?: string[]
    activeQuestions?: Array<{ id: string }>
  }
  assert.equal(stateBody.selfPacedMode, true)
  assert.deepEqual(stateBody.activeQuestionIds, ['q1', 'q2', 'q3'])
  assert.deepEqual(stateBody.activeQuestions?.map((question) => question.id), ['q1', 'q2', 'q3'])

  await sessions.close()
})

void test('student state exposes multiple-choice selectionMode based on the authored correct options', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  session.data.questions = [
    {
      id: 'q1',
      type: 'multiple-choice',
      text: 'Pick one',
      order: 0,
      options: [
        { id: 'a', text: 'A', isCorrect: true },
        { id: 'b', text: 'B' },
      ],
    },
    {
      id: 'q2',
      type: 'multiple-choice',
      text: 'Pick all that apply',
      order: 1,
      options: [
        { id: 'c', text: 'C', isCorrect: true },
        { id: 'd', text: 'D', isCorrect: true },
        { id: 'e', text: 'E' },
      ],
    },
  ]
  session.data.activeQuestionIds = ['q1', 'q2']
  session.data.activeQuestionId = 'q1'
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof stateHandler, 'function')

  const response = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
    },
    response,
  )

  assert.equal(response.statusCode, 200)
  const body = response.body as {
    activeQuestions?: Array<{ id: string; selectionMode?: string }>
  }
  assert.deepEqual(body.activeQuestions?.map((question) => ({
    id: question.id,
    selectionMode: question.selectionMode,
  })), [
    { id: 'q1', selectionMode: 'single' },
    { id: 'q2', selectionMode: 'multiple' },
  ])

  await sessions.close()
})

void test('responses route includes submitted, working, and idle progress entries for the instructor', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createInstructorResonanceSession()
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const handler = app.handlers.get['/api/resonance/:sessionId/responses']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as {
    responses?: Array<{ id: string; studentName: string }>
    progress?: Array<{ studentId: string; status: string; responseId: string | null }>
  }
  assert.equal(body.responses?.length, 1)
  assert.deepEqual(
    body.progress?.map((entry) => ({
      studentId: entry.studentId,
      status: entry.status,
      responseId: entry.responseId,
    })).sort((left, right) => left.studentId.localeCompare(right.studentId)),
    [
      { studentId: 'student1', status: 'submitted', responseId: 'r1' },
      { studentId: 'student2', status: 'working', responseId: null },
      { studentId: 'student3', status: 'idle', responseId: null },
    ],
  )

  await sessions.close()
})

void test('import-questions route appends a saved question set to an instructor session', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createInstructorResonanceSession()
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const handler = app.handlers.post['/api/resonance/:sessionId/import-questions']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
      body: {
        questions: [
          {
            id: 'q_imported_frq',
            type: 'free-response',
            text: 'What changed in your thinking?',
            order: 50,
          },
          {
            id: 'q_imported_mcq',
            type: 'multiple-choice',
            text: 'Which answers are valid?',
            order: 51,
            options: [
              { id: 'a', text: 'A', isCorrect: true },
              { id: 'b', text: 'B' },
            ],
          },
        ],
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as { questions?: Array<{ id: string; order: number }> }
  assert.deepEqual(body.questions?.map((question) => ({ id: question.id, order: question.order })), [
    { id: 'q_imported_frq', order: 1 },
    { id: 'q_imported_mcq', order: 2 },
  ])

  const stored = await sessions.get(session.id)
  const storedQuestions = (stored?.data as { questions?: Array<{ id: string; order: number }> } | undefined)?.questions ?? []
  assert.deepEqual(storedQuestions.map((question) => ({ id: question.id, order: question.order })), [
    { id: 'q1', order: 0 },
    { id: 'q_imported_frq', order: 1 },
    { id: 'q_imported_mcq', order: 2 },
  ])

  await sessions.close()
})

void test('import-questions route remaps duplicate question ids from separate sets', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createInstructorResonanceSession()
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const handler = app.handlers.post['/api/resonance/:sessionId/import-questions']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
      body: {
        questions: [
          {
            id: 'q1',
            type: 'free-response',
            text: 'Replacement text',
            order: 99,
          },
          {
            id: 'q_new',
            type: 'free-response',
            text: 'New question',
            order: 100,
          },
        ],
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as {
    ok?: boolean
    questions?: Array<{ id: string; type: string; text: string; order: number }>
    remappedQuestionIds?: Record<string, string>
  }
  const remappedQ1 = body.remappedQuestionIds?.q1
  assert.equal(body.ok, true)
  assert.equal(typeof remappedQ1, 'string')
  assert.notEqual(remappedQ1, 'q1')
  assert.match(remappedQ1 ?? '', /^q_imported_[\w-]+$/)
  assert.deepEqual(body.questions, [
    {
      id: remappedQ1,
      type: 'free-response',
      text: 'Replacement text',
      order: 1,
    },
    {
      id: 'q_new',
      type: 'free-response',
      text: 'New question',
      order: 2,
    },
  ])

  const stored = await sessions.get(session.id)
  const storedQuestions = (stored?.data as { questions?: Array<{ id: string; text: string; order: number }> } | undefined)?.questions ?? []
  assert.deepEqual(storedQuestions.map((question) => ({
    id: question.id,
    text: question.text,
    order: question.order,
  })), [
    { id: 'q1', text: 'Explain your reasoning.', order: 0 },
    { id: remappedQ1 ?? '', text: 'Replacement text', order: 1 },
    { id: 'q_new', text: 'New question', order: 2 },
  ])

  await sessions.close()
})

void test('activate-question route can activate all questions with a shared countdown and students can submit by questionId', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const activateHandler = app.handlers.post['/api/resonance/:sessionId/activate-question']
  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  const submitHandler = app.handlers.post['/api/resonance/:sessionId/submit-answer']
  assert.equal(typeof activateHandler, 'function')
  assert.equal(typeof stateHandler, 'function')
  assert.equal(typeof submitHandler, 'function')

  const activateRes = createResponse()
  await activateHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
      body: {
        questionIds: ['q1', 'q2'],
      },
    },
    activateRes,
  )

  assert.equal(activateRes.statusCode, 200)
  const activateBody = activateRes.body as {
    activeQuestionIds?: string[]
    activeQuestionRunStartedAt?: number | null
    activeQuestionDeadlineAt?: number | null
  }
  assert.deepEqual(activateBody.activeQuestionIds, ['q1', 'q2'])
  assert.ok(typeof activateBody.activeQuestionDeadlineAt === 'number')

  const stateRes = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
    },
    stateRes,
  )

  assert.equal(stateRes.statusCode, 200)
  const stateBody = stateRes.body as {
    activeQuestionIds?: string[]
    activeQuestions?: Array<{ id: string }>
    activeQuestionRunStartedAt?: number | null
    activeQuestionDeadlineAt?: number | null
  }
  assert.deepEqual(stateBody.activeQuestionIds, ['q1', 'q2'])
  assert.deepEqual(stateBody.activeQuestions?.map((question) => question.id), ['q1', 'q2'])
  assert.ok(typeof stateBody.activeQuestionDeadlineAt === 'number')

  const submitRes = createResponse()
  await submitHandler?.(
    {
      params: { sessionId: session.id },
      body: {
        studentId: 'student1',
        questionId: 'q2',
        activeQuestionRunStartedAt: stateBody.activeQuestionRunStartedAt,
        answer: {
          type: 'multiple-choice',
          selectedOptionIds: ['q2_b'],
        },
      },
    },
    submitRes,
  )

  assert.equal(submitRes.statusCode, 200)

  const stored = await sessions.get(session.id)
  const responses = (stored?.data as { responses?: Array<{ questionId: string; studentId: string }> } | undefined)?.responses ?? []
  assert.deepEqual(
    responses.map((response) => ({ questionId: response.questionId, studentId: response.studentId })),
    [{ questionId: 'q2', studentId: 'student1' }],
  )

  await sessions.close()
})

void test('staged activate-question hides MCQ choices until reveal and then accepts submissions', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const activateHandler = app.handlers.post['/api/resonance/:sessionId/activate-question']
  const revealHandler = app.handlers.post['/api/resonance/:sessionId/reveal-choices']
  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  const submitHandler = app.handlers.post['/api/resonance/:sessionId/submit-answer']
  assert.equal(typeof activateHandler, 'function')
  assert.equal(typeof revealHandler, 'function')
  assert.equal(typeof stateHandler, 'function')
  assert.equal(typeof submitHandler, 'function')

  const activateRes = createResponse()
  await activateHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
      body: {
        questionIds: ['q2'],
        presentationMode: 'staged',
      },
    },
    activateRes,
  )

  assert.equal(activateRes.statusCode, 200)
  const activateBody = activateRes.body as {
    presentationMode?: string
    stagedRun?: { currentQuestionId?: string; choicesRevealed?: boolean } | null
    activeQuestionDeadlineAt?: number | null
  }
  assert.equal(activateBody.presentationMode, 'staged')
  assert.equal(activateBody.stagedRun?.currentQuestionId, 'q2')
  assert.equal(activateBody.stagedRun?.choicesRevealed, false)
  assert.equal(activateBody.activeQuestionDeadlineAt, null)
  const storedAfterStagedActivate = await sessions.get(session.id)
  const stagedRunStartedAt = storedAfterStagedActivate?.data.activeQuestionRunStartedAt ?? null
  assert.equal(typeof stagedRunStartedAt, 'number')

  const hiddenStateRes = createResponse()
  await stateHandler?.({ params: { sessionId: session.id } }, hiddenStateRes)

  assert.equal(hiddenStateRes.statusCode, 200)
  const hiddenState = hiddenStateRes.body as {
    activeQuestions?: Array<{ id: string; type: string; options?: unknown[]; choicesRevealed?: boolean }>
  }
  assert.deepEqual(hiddenState.activeQuestions?.[0], {
    id: 'q2',
    type: 'multiple-choice',
    text: 'Which option best fits?',
    order: 1,
    responseTimeLimitMs: 45000,
    options: [],
    selectionMode: 'single',
    choicesRevealed: false,
  })

  const blockedSubmitRes = createResponse()
  await submitHandler?.(
    {
      params: { sessionId: session.id },
      body: {
        studentId: 'student1',
        questionId: 'q2',
        activeQuestionRunStartedAt: stagedRunStartedAt,
        answer: {
          type: 'multiple-choice',
          selectedOptionIds: ['q2_b'],
        },
      },
    },
    blockedSubmitRes,
  )

  assert.equal(blockedSubmitRes.statusCode, 409)
  assert.deepEqual(blockedSubmitRes.body, { error: 'choices have not been revealed' })

  const revealRes = createResponse()
  await revealHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
      body: {},
    },
    revealRes,
  )

  assert.equal(revealRes.statusCode, 200)
  const revealBody = revealRes.body as {
    stagedRun?: { choicesRevealed?: boolean } | null
    activeQuestionDeadlineAt?: number | null
  }
  assert.equal(revealBody.stagedRun?.choicesRevealed, true)
  assert.ok(typeof revealBody.activeQuestionDeadlineAt === 'number')
  const storedAfterReveal = await sessions.get(session.id)
  assert.equal(storedAfterReveal?.data.activeQuestionRunStartedAt, stagedRunStartedAt)

  const firstDeadlineAt = revealBody.activeQuestionDeadlineAt
  const repeatedRevealRes = createResponse()
  await revealHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
      body: {},
    },
    repeatedRevealRes,
  )

  assert.equal(repeatedRevealRes.statusCode, 200)
  assert.equal(
    (repeatedRevealRes.body as { activeQuestionDeadlineAt?: number | null }).activeQuestionDeadlineAt,
    firstDeadlineAt,
  )

  const visibleStateRes = createResponse()
  await stateHandler?.({ params: { sessionId: session.id } }, visibleStateRes)
  const visibleState = visibleStateRes.body as {
    activeQuestions?: Array<{ id: string; options?: unknown[]; choicesRevealed?: boolean }>
  }
  assert.equal(visibleState.activeQuestions?.[0]?.choicesRevealed, true)
  assert.equal(visibleState.activeQuestions?.[0]?.options?.length, 2)

  const expiredRunStartedAt = Date.now() - 3_000
  const expiredSession = await sessions.get(session.id)
  if (expiredSession) {
    expiredSession.data.activeQuestionRunStartedAt = expiredRunStartedAt
    const responseDrafts = expiredSession.data.responseDrafts as Record<string, unknown>
    responseDrafts['q2:student1'] = {
      questionId: 'q2',
      studentId: 'student1',
      updatedAt: Date.now() - 2_000,
      answer: {
        type: 'multiple-choice',
        selectedOptionIds: ['q2_b'],
      },
    }
    expiredSession.data.activeQuestionDeadlineAt = Date.now() - 1_000
    await sessions.set(session.id, expiredSession)
  }

  const expiredSubmitRes = createResponse()
  console.info('[TEST] submitting after expiry should return 409 after finalizing the persisted draft')
  await submitHandler?.(
    {
      params: { sessionId: session.id },
      body: {
        studentId: 'student1',
        questionId: 'q2',
        activeQuestionRunStartedAt: expiredRunStartedAt,
        answer: {
          type: 'multiple-choice',
          selectedOptionIds: ['q2_b'],
        },
        autoSubmit: true,
      },
    },
    expiredSubmitRes,
  )

  assert.equal(expiredSubmitRes.statusCode, 409)
  assert.deepEqual(expiredSubmitRes.body, { error: 'time is up for this question' })
  const finalizedSession = await sessions.get(session.id)
  const finalizedData = finalizedSession?.data as {
    responses: Array<{ questionId: string; studentId: string; answer: unknown }>
    responseDrafts: Record<string, unknown>
  } | undefined
  assert.deepEqual(
    finalizedData?.responses.find((response) =>
      response.questionId === 'q2' && response.studentId === 'student1')?.answer,
    { type: 'multiple-choice', selectedOptionIds: ['q2_b'] },
  )
  assert.equal(finalizedData?.responseDrafts['q2:student1'], undefined)

  const resetDeadlineSession = await sessions.get(session.id)
  if (resetDeadlineSession) {
    resetDeadlineSession.data.activeQuestionDeadlineAt = Date.now() + 45_000
    await sessions.set(session.id, resetDeadlineSession)
  }

  const submitRes = createResponse()
  await submitHandler?.(
    {
      params: { sessionId: session.id },
      body: {
        studentId: 'student1',
        questionId: 'q2',
        activeQuestionRunStartedAt: expiredRunStartedAt,
        answer: {
          type: 'multiple-choice',
          selectedOptionIds: ['q2_b'],
        },
      },
    },
    submitRes,
  )

  assert.equal(submitRes.statusCode, 200)

  await sessions.close()
})

void test('staged session normalization deduplicates persisted question ids while preserving order', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  session.data.presentationMode = 'staged'
  session.data.stagedRun = {
    questionIds: ['q1', 'q2', 'q1', 'q2'],
    currentQuestionId: 'q2',
    currentIndex: 3,
    choicesRevealed: false,
    completedQuestionIds: ['q1', 'q1'],
  }
  session.data.activeQuestionId = 'q2'
  session.data.activeQuestionIds = ['q2']
  session.data.activeQuestionRunStartedAt = Date.now() - 500
  const originalRunStartedAt = session.data.activeQuestionRunStartedAt
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const responsesHandler = app.handlers.get['/api/resonance/:sessionId/responses']
  assert.equal(typeof responsesHandler, 'function')

  const res = createResponse()
  await responsesHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as {
    activeQuestionRunStartedAt?: number | null
    stagedRun?: {
      questionIds?: string[]
      currentQuestionId?: string | null
      currentIndex?: number
      completedQuestionIds?: string[]
    } | null
  }
  assert.deepEqual(body.stagedRun?.questionIds, ['q1', 'q2'])
  assert.equal(body.stagedRun?.currentQuestionId, 'q2')
  assert.equal(body.stagedRun?.currentIndex, 1)
  assert.deepEqual(body.stagedRun?.completedQuestionIds, ['q1'])
  assert.equal(body.activeQuestionRunStartedAt, originalRunStartedAt)

  await sessions.close()
})

void test('activate-question pushes student state without student question-activated event', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  await sessions.set(session.id, session)

  const studentMessages: Array<{ type?: string; payload?: unknown }> = []
  const instructorMessages: Array<{ type?: string; payload?: unknown }> = []
  ;(ws.wss.clients as Set<unknown>).add({
    readyState: 1,
    sessionId: session.id,
    isInstructor: false,
    studentId: 'student1',
    send(message: string) {
      studentMessages.push(JSON.parse(message) as { type?: string; payload?: unknown })
    },
  })
  ;(ws.wss.clients as Set<unknown>).add({
    readyState: 1,
    sessionId: session.id,
    isInstructor: true,
    send(message: string) {
      instructorMessages.push(JSON.parse(message) as { type?: string; payload?: unknown })
    },
  })

  setupResonanceRoutes(app, sessions, ws)

  const activateHandler = app.handlers.post['/api/resonance/:sessionId/activate-question']
  assert.equal(typeof activateHandler, 'function')

  const activateRes = createResponse()
  await activateHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
      body: {
        questionIds: ['q1'],
      },
    },
    activateRes,
  )

  assert.equal(activateRes.statusCode, 200)
  assert.equal(studentMessages.some((message) => message.type === 'resonance:session-state'), true)
  assert.equal(studentMessages.some((message) => message.type === 'resonance:question-activated'), false)
  assert.equal(instructorMessages.some((message) => message.type === 'resonance:question-activated'), true)
  assert.equal(instructorMessages.some((message) => message.type === 'resonance:instructor-state'), true)

  await sessions.close()
})

void test('advance-staged-question moves through the staged sequence and ends after the last question', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const activateHandler = app.handlers.post['/api/resonance/:sessionId/activate-question']
  const advanceHandler = app.handlers.post['/api/resonance/:sessionId/advance-staged-question']
  assert.equal(typeof activateHandler, 'function')
  assert.equal(typeof advanceHandler, 'function')

  const authHeaders = { 'x-instructor-passcode': 'TEACH123' }
  const activateRes = createResponse()
  await activateHandler?.(
    {
      params: { sessionId: session.id },
      headers: authHeaders,
      body: {
        questionIds: ['q1', 'q2'],
        presentationMode: 'staged',
      },
    },
    activateRes,
  )

  assert.equal(activateRes.statusCode, 200)
  assert.deepEqual((activateRes.body as { activeQuestionIds?: string[] }).activeQuestionIds, ['q1'])
  const firstStoredRun = await sessions.get(session.id)
  const firstRunStartedAt = firstStoredRun?.data.activeQuestionRunStartedAt ?? null
  assert.equal(typeof firstRunStartedAt, 'number')

  const storedAfterActivate = await sessions.get(session.id)
  if (storedAfterActivate) {
    storedAfterActivate.data.activeQuestionRunStartedAt = 1_000
    storedAfterActivate.data.activeQuestionDeadlineAt = Date.now() - 1_000
    await sessions.set(session.id, storedAfterActivate)
  }

  const advanceToSecondRes = createResponse()
  await advanceHandler?.(
    {
      params: { sessionId: session.id },
      headers: authHeaders,
      body: {},
    },
    advanceToSecondRes,
  )

  assert.equal(advanceToSecondRes.statusCode, 200)
  const secondBody = advanceToSecondRes.body as {
    activeQuestionIds?: string[]
    activeQuestionDeadlineAt?: number | null
    stagedRun?: { currentQuestionId?: string; choicesRevealed?: boolean; completedQuestionIds?: string[] } | null
  }
  assert.deepEqual(secondBody.activeQuestionIds, ['q2'])
  assert.equal(secondBody.activeQuestionDeadlineAt, null)
  assert.equal(secondBody.stagedRun?.currentQuestionId, 'q2')
  assert.equal(secondBody.stagedRun?.choicesRevealed, false)
  assert.deepEqual(secondBody.stagedRun?.completedQuestionIds, ['q1'])
  const secondStoredRun = await sessions.get(session.id)
  const secondRunStartedAt = secondStoredRun?.data.activeQuestionRunStartedAt ?? null
  assert.equal(typeof secondRunStartedAt, 'number')
  assert.notEqual(secondRunStartedAt, 1_000)

  const endRes = createResponse()
  await advanceHandler?.(
    {
      params: { sessionId: session.id },
      headers: authHeaders,
      body: {},
    },
    endRes,
  )

  assert.equal(endRes.statusCode, 200)
  assert.deepEqual((endRes.body as { activeQuestionIds?: string[] }).activeQuestionIds, [])
  assert.equal((endRes.body as { stagedRun?: unknown }).stagedRun, null)

  await sessions.close()
})

void test('advance-staged-question can intentionally skip a stem-only MCQ', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  session.data.questions = [
    {
      id: 'q1',
      type: 'multiple-choice',
      text: 'Which option should be skipped?',
      order: 0,
      responseTimeLimitMs: 30_000,
      options: [
        { id: 'q1_a', text: 'Option A' },
        { id: 'q1_b', text: 'Option B' },
      ],
    },
    {
      id: 'q2',
      type: 'free-response',
      text: 'Explain your reasoning.',
      order: 1,
      responseTimeLimitMs: 30_000,
    },
  ]
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const activateHandler = app.handlers.post['/api/resonance/:sessionId/activate-question']
  const advanceHandler = app.handlers.post['/api/resonance/:sessionId/advance-staged-question']
  assert.equal(typeof activateHandler, 'function')
  assert.equal(typeof advanceHandler, 'function')

  const authHeaders = { 'x-instructor-passcode': 'TEACH123' }
  const activateRes = createResponse()
  await activateHandler?.(
    {
      params: { sessionId: session.id },
      headers: authHeaders,
      body: {
        questionIds: ['q1', 'q2'],
        presentationMode: 'staged',
      },
    },
    activateRes,
  )

  assert.equal(activateRes.statusCode, 200)
  const activateBody = activateRes.body as {
    activeQuestionIds?: string[]
    activeQuestionDeadlineAt?: number | null
    stagedRun?: { currentQuestionId?: string; choicesRevealed?: boolean } | null
  }
  assert.deepEqual(activateBody.activeQuestionIds, ['q1'])
  assert.equal(activateBody.activeQuestionDeadlineAt, null)
  assert.equal(activateBody.stagedRun?.currentQuestionId, 'q1')
  assert.equal(activateBody.stagedRun?.choicesRevealed, false)

  const skipRes = createResponse()
  await advanceHandler?.(
    {
      params: { sessionId: session.id },
      headers: authHeaders,
      body: {},
    },
    skipRes,
  )

  assert.equal(skipRes.statusCode, 200)
  const skipBody = skipRes.body as {
    activeQuestionIds?: string[]
    activeQuestionDeadlineAt?: number | null
    stagedRun?: {
      currentQuestionId?: string
      choicesRevealed?: boolean
      completedQuestionIds?: string[]
    } | null
  }
  assert.deepEqual(skipBody.activeQuestionIds, ['q2'])
  assert.ok(typeof skipBody.activeQuestionDeadlineAt === 'number')
  assert.equal(skipBody.stagedRun?.currentQuestionId, 'q2')
  assert.equal(skipBody.stagedRun?.choicesRevealed, true)
  assert.deepEqual(skipBody.stagedRun?.completedQuestionIds, ['q1'])

  await sessions.close()
})

void test('submit-answer route broadcasts an updated instructor snapshot to instructor displays', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  await sessions.set(session.id, session)

  const instructorMessages: Array<{ type?: string; payload?: unknown }> = []
  ;(ws.wss.clients as Set<unknown>).add({
    readyState: 1,
    sessionId: session.id,
    isInstructor: true,
    send(message: string) {
      instructorMessages.push(JSON.parse(message) as { type?: string; payload?: unknown })
    },
  })

  setupResonanceRoutes(app, sessions, ws)

  const activateHandler = app.handlers.post['/api/resonance/:sessionId/activate-question']
  const submitHandler = app.handlers.post['/api/resonance/:sessionId/submit-answer']
  assert.equal(typeof activateHandler, 'function')
  assert.equal(typeof submitHandler, 'function')

  const activateRes = createResponse()
  await activateHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
      body: {
        questionId: 'q1',
      },
    },
    activateRes,
  )

  assert.equal(activateRes.statusCode, 200)
  const activatedSession = await sessions.get(session.id)
  const activeQuestionRunStartedAt = activatedSession?.data.activeQuestionRunStartedAt

  const submitRes = createResponse()
  await submitHandler?.(
    {
      params: { sessionId: session.id },
      body: {
        studentId: 'student1',
        questionId: 'q1',
        activeQuestionRunStartedAt,
        answer: {
          type: 'free-response',
          text: 'Updated live answer',
        },
      },
    },
    submitRes,
  )

  assert.equal(submitRes.statusCode, 200)
  let instructorStateMessage: { type?: string; payload?: unknown } | undefined
  for (let index = instructorMessages.length - 1; index >= 0; index -= 1) {
    const message = instructorMessages[index]
    if (message?.type === 'resonance:instructor-state') {
      instructorStateMessage = message
      break
    }
  }
  assert.notEqual(instructorStateMessage, undefined)
  const payload = instructorStateMessage?.payload as {
    responses?: Array<{ questionId?: string; studentId?: string; answer?: { text?: string } }>
  }
  assert.equal(payload.responses?.some((response) =>
    response.questionId === 'q1' &&
    response.studentId === 'student1' &&
    response.answer?.text === 'Updated live answer'
  ), true)

  await sessions.close()
})

void test('submit-answer route updates an existing response when a question is reactivated', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()
  const session: SessionRecord = {
    id: 'resonance-session-reactivate',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      instructorPasscode: 'TEACH123',
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'Explain your reasoning.',
          order: 0,
        },
      ],
      activeQuestionId: 'q1',
      activeQuestionIds: ['q1'],
      activeQuestionDeadlineAt: null,
      students: {
        student1: { studentId: 'student1', name: 'Ada Lovelace', joinedAt: now - 1_000 },
      },
      responses: [
        {
          id: 'r1',
          questionId: 'q1',
          studentId: 'student1',
          submittedAt: now - 500,
          answer: {
            type: 'free-response',
            text: 'Initial answer',
          },
        },
      ],
      responseDrafts: {},
      annotations: {},
      reveals: [],
      sharedResponseReactions: {},
      responseOrderOverrides: {},
      persistentHash: null,
    },
  }
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const submitHandler = app.handlers.post['/api/resonance/:sessionId/submit-answer']
  assert.equal(typeof submitHandler, 'function')

  const submitRes = createResponse()
  await submitHandler?.(
    {
      params: { sessionId: session.id },
      body: {
        studentId: 'student1',
        questionId: 'q1',
        activeQuestionRunStartedAt: null,
        answer: {
          type: 'free-response',
          text: 'Revised answer',
        },
      },
    },
    submitRes,
  )

  assert.equal(submitRes.statusCode, 200)

  const stored = await sessions.get(session.id)
  const responses = (stored?.data as { responses?: Array<{ id: string; answer: { type: string; text?: string } }> } | undefined)?.responses ?? []
  assert.equal(responses.length, 1)
  assert.equal(responses[0]?.id, 'r1')
  assert.deepEqual(responses[0]?.answer, {
    type: 'free-response',
    text: 'Revised answer',
  })

  await sessions.close()
})

void test('reactivating a question keeps prior answers editable for students and marks them working for instructors', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const session = createMultiQuestionSession()
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const activateHandler = app.handlers.post['/api/resonance/:sessionId/activate-question']
  const submitHandler = app.handlers.post['/api/resonance/:sessionId/submit-answer']
  const responsesHandler = app.handlers.get['/api/resonance/:sessionId/responses']
  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof activateHandler, 'function')
  assert.equal(typeof submitHandler, 'function')
  assert.equal(typeof responsesHandler, 'function')
  assert.equal(typeof stateHandler, 'function')

  const firstActivateRes = createResponse()
  await activateHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
      body: {
        questionId: 'q1',
      },
    },
    firstActivateRes,
  )
  assert.equal(firstActivateRes.statusCode, 200)
  const firstActivatedSession = await sessions.get(session.id)
  const firstRunStartedAt = firstActivatedSession?.data.activeQuestionRunStartedAt

  const submitRes = createResponse()
  await submitHandler?.(
    {
      params: { sessionId: session.id },
      body: {
        studentId: 'student1',
        questionId: 'q1',
        activeQuestionRunStartedAt: firstRunStartedAt,
        answer: {
          type: 'free-response',
          text: 'First run answer',
        },
      },
    },
    submitRes,
  )
  assert.equal(submitRes.statusCode, 200)
  await new Promise((resolve) => setTimeout(resolve, 2))

  const secondActivateRes = createResponse()
  await activateHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
      body: {
        questionId: 'q1',
      },
    },
    secondActivateRes,
  )
  assert.equal(secondActivateRes.statusCode, 200)

  const staleSubmitRes = createResponse()
  console.info('[TEST] a submission from the previous run should return 409')
  await submitHandler?.(
    {
      params: { sessionId: session.id },
      body: {
        studentId: 'student1',
        questionId: 'q1',
        activeQuestionRunStartedAt: firstRunStartedAt,
        answer: {
          type: 'free-response',
          text: 'Delayed first run answer',
        },
      },
    },
    staleSubmitRes,
  )
  assert.equal(staleSubmitRes.statusCode, 409)
  assert.deepEqual(staleSubmitRes.body, { error: 'question run changed' })

  const studentStateRes = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
      query: { studentId: 'student1' },
    },
    studentStateRes,
  )
  assert.equal(studentStateRes.statusCode, 200)
  assert.deepEqual(
    (studentStateRes.body as { submittedAnswers?: Record<string, unknown> }).submittedAnswers,
    {
      q1: {
        type: 'free-response',
        text: 'First run answer',
      },
    },
  )

  const responsesRes = createResponse()
  await responsesHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
    },
    responsesRes,
  )

  assert.equal(responsesRes.statusCode, 200)
  const body = responsesRes.body as {
    progress?: Array<{ questionId?: string; studentId?: string; status?: string; answer?: { text?: string } }>
  }
  assert.equal(body.progress?.some((entry) =>
    entry.questionId === 'q1' &&
    entry.studentId === 'student1' &&
    entry.status === 'working' &&
    entry.answer?.text === 'First run answer'
  ), true)

  await sessions.close()
})

void test('share-results replaces any previously shared reveal so only one reveal remains active', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()
  const session: SessionRecord = {
    id: 'resonance-session-share-replace',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      instructorPasscode: 'TEACH123',
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'Explain your reasoning.',
          order: 0,
        },
        {
          id: 'q2',
          type: 'free-response',
          text: 'Revise your answer.',
          order: 1,
        },
      ],
      activeQuestionId: null,
      activeQuestionIds: [],
      activeQuestionDeadlineAt: null,
      students: {
        student1: { studentId: 'student1', name: 'Ada Lovelace', joinedAt: now - 1_000 },
      },
      responses: [
        {
          id: 'r1',
          questionId: 'q1',
          studentId: 'student1',
          submittedAt: now - 500,
          answer: {
            type: 'free-response',
            text: 'Initial answer',
          },
        },
        {
          id: 'r2',
          questionId: 'q2',
          studentId: 'student1',
          submittedAt: now - 250,
          answer: {
            type: 'free-response',
            text: 'Revised answer',
          },
        },
      ],
      responseDrafts: {},
      annotations: {},
      reveals: [
        {
          questionId: 'q1',
          sharedAt: now - 100,
          correctOptionIds: null,
          sharedResponses: [],
        },
      ],
      sharedResponseReactions: {},
      responseOrderOverrides: {},
      persistentHash: null,
    },
  }
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const shareHandler = app.handlers.post['/api/resonance/:sessionId/share-results']
  assert.equal(typeof shareHandler, 'function')

  const res = createResponse()
  await shareHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
      body: {
        questionId: 'q2',
        selectedResponseIds: ['r2'],
        correctOptionIds: null,
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const stored = await sessions.get(session.id)
  const reveals = (stored?.data as { reveals?: Array<{ questionId: string }> } | undefined)?.reveals ?? []
  assert.deepEqual(reveals.map((reveal) => reveal.questionId), ['q2'])

  await sessions.close()
})

void test('stop-sharing route clears the current shared reveal without requiring a question id', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()
  const session: SessionRecord = {
    id: 'resonance-session-stop-sharing',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      instructorPasscode: 'TEACH123',
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'Explain your reasoning.',
          order: 0,
        },
      ],
      activeQuestionId: null,
      activeQuestionIds: [],
      activeQuestionDeadlineAt: null,
      students: {},
      responses: [],
      responseDrafts: {},
      annotations: {},
      reveals: [
        {
          questionId: 'q1',
          sharedAt: now - 100,
          correctOptionIds: null,
          sharedResponses: [],
        },
      ],
      responseOrderOverrides: {},
      persistentHash: null,
    },
  }
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const stopSharingHandler = app.handlers.post['/api/resonance/:sessionId/stop-sharing']
  assert.equal(typeof stopSharingHandler, 'function')

  const res = createResponse()
  await stopSharingHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const stored = await sessions.get(session.id)
  const reveals = (stored?.data as { reveals?: Array<{ questionId: string }> } | undefined)?.reveals ?? []
  assert.deepEqual(reveals, [])

  await sessions.close()
})

void test('student state includes the viewer response and marks when their shared response is their own', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()
  const submittedAt = now - 500
  const session: SessionRecord = {
    id: 'resonance-session-student-reveal',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      instructorPasscode: 'TEACH123',
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'Explain your reasoning.',
          order: 0,
        },
      ],
      activeQuestionId: null,
      activeQuestionIds: [],
      activeQuestionDeadlineAt: null,
      students: {
        student1: { studentId: 'student1', name: 'Ada Lovelace', joinedAt: now - 1_000 },
      },
      responses: [
        {
          id: 'r1',
          questionId: 'q1',
          studentId: 'student1',
          submittedAt,
          answer: {
            type: 'free-response',
            text: 'My answer',
          },
        },
      ],
      responseDrafts: {},
      annotations: {
        r1: {
          starred: false,
          flagged: false,
          emoji: '👏',
        },
      },
      reveals: [
        {
          questionId: 'q1',
          sharedAt: now - 100,
          correctOptionIds: null,
          sharedResponses: [
            {
              id: 'r1',
              questionId: 'q1',
              answer: {
                type: 'free-response',
                text: 'My answer',
              },
              sharedAt: now - 100,
              instructorEmoji: '👏',
              reactions: {},
            },
          ],
        },
      ],
      sharedResponseReactions: {
        r1: {
          student1: '🔥',
        },
      },
      responseOrderOverrides: {},
      persistentHash: null,
    },
  }
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof stateHandler, 'function')

  const res = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
      query: {
        studentId: 'student1',
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as {
    reveals?: Array<{
      sharedResponses?: Array<{ isOwnResponse?: boolean; viewerReaction?: string | null }>
      viewerResponse?: { instructorEmoji?: string | null; isShared?: boolean; answer?: { text?: string } }
    }>
  }
  assert.equal(body.reveals?.[0]?.sharedResponses?.[0]?.isOwnResponse, true)
  assert.equal(body.reveals?.[0]?.sharedResponses?.[0]?.viewerReaction, '🔥')
  assert.deepEqual(body.reveals?.[0]?.viewerResponse, {
    answer: {
      type: 'free-response',
      text: 'My answer',
    },
    submittedAt,
    instructorEmoji: '👏',
    isShared: true,
  })

  await sessions.close()
})

void test('annotate-response route updates the student viewer response emoji for shared results', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()
  const submittedAt = now - 500
  const session: SessionRecord = {
    id: 'resonance-session-annotation-student-view',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      instructorPasscode: 'TEACH123',
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'Explain your reasoning.',
          order: 0,
        },
      ],
      activeQuestionId: null,
      activeQuestionIds: [],
      activeQuestionDeadlineAt: null,
      students: {
        student1: { studentId: 'student1', name: 'Ada Lovelace', joinedAt: now - 1_000 },
      },
      responses: [
        {
          id: 'r1',
          questionId: 'q1',
          studentId: 'student1',
          submittedAt,
          answer: {
            type: 'free-response',
            text: 'My answer',
          },
        },
      ],
      responseDrafts: {},
      annotations: {
        r1: {
          starred: false,
          flagged: false,
          emoji: null,
        },
      },
      reveals: [
        {
          questionId: 'q1',
          sharedAt: now - 100,
          correctOptionIds: null,
          sharedResponses: [
            {
              id: 'r1',
              questionId: 'q1',
              answer: {
                type: 'free-response',
                text: 'My answer',
              },
              sharedAt: now - 100,
              instructorEmoji: null,
              reactions: {},
            },
          ],
        },
      ],
      sharedResponseReactions: {},
      responseOrderOverrides: {},
      persistentHash: null,
    },
  }
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const annotateHandler = app.handlers.post['/api/resonance/:sessionId/annotate-response']
  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof annotateHandler, 'function')
  assert.equal(typeof stateHandler, 'function')

  const annotateRes = createResponse()
  await annotateHandler?.(
    {
      params: { sessionId: session.id },
      headers: {
        'x-instructor-passcode': 'TEACH123',
      },
      body: {
        responseId: 'r1',
        annotation: {
          emoji: '💡',
        },
      },
    },
    annotateRes,
  )

  assert.equal(annotateRes.statusCode, 200)

  const stateRes = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
      query: {
        studentId: 'student1',
      },
    },
    stateRes,
  )

  assert.equal(stateRes.statusCode, 200)
  const body = stateRes.body as {
    reveals?: Array<{
      viewerResponse?: { instructorEmoji?: string | null; answer?: { text?: string } }
    }>
  }
  assert.equal(body.reveals?.[0]?.viewerResponse?.instructorEmoji, '💡')
  assert.equal(body.reveals?.[0]?.viewerResponse?.answer?.text, 'My answer')

  await sessions.close()
})

void test('student state sanitizes malformed stored reveal reactions', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()
  const session: SessionRecord = {
    id: 'resonance-session-sanitize-reactions',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      instructorPasscode: 'TEACH123',
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'Explain your reasoning.',
          order: 0,
        },
      ],
      activeQuestionId: null,
      activeQuestionIds: [],
      activeQuestionDeadlineAt: null,
      students: {
        student1: { studentId: 'student1', name: 'Ada Lovelace', joinedAt: now - 1_000 },
      },
      responses: [
        {
          id: 'r1',
          questionId: 'q1',
          studentId: 'student1',
          submittedAt: now - 500,
          answer: {
            type: 'free-response',
            text: 'My answer',
          },
        },
      ],
      responseDrafts: {},
      annotations: {},
      reveals: [
        {
          questionId: 'q1',
          sharedAt: now - 100,
          correctOptionIds: null,
          sharedResponses: [
            {
              id: 'r1',
              questionId: 'q1',
              answer: {
                type: 'free-response',
                text: 'My answer',
              },
              sharedAt: now - 100,
              instructorEmoji: null,
              reactions: {
                '🔥': 2,
                '👏': -1,
                bad: 3,
                '💡': Number.NaN,
              },
            },
          ],
        },
      ],
      sharedResponseReactions: {},
      responseOrderOverrides: {},
      persistentHash: null,
    },
  }
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof stateHandler, 'function')

  const res = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
      query: {
        studentId: 'student1',
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as {
    reveals?: Array<{
      sharedResponses?: Array<{ reactions?: Record<string, number> }>
    }>
  }
  assert.deepEqual(body.reveals?.[0]?.sharedResponses?.[0]?.reactions, {
    '🔥': 2,
  })

  await sessions.close()
})

void test('student state includes reviewed responses for annotated answers that were not shared publicly', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()
  const session: SessionRecord = {
    id: 'resonance-session-private-feedback',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      instructorPasscode: 'TEACH123',
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'Explain your reasoning.',
          order: 0,
        },
      ],
      activeQuestionId: null,
      activeQuestionIds: [],
      activeQuestionDeadlineAt: null,
      students: {
        student1: { studentId: 'student1', name: 'Ada Lovelace', joinedAt: now - 1_000 },
      },
      responses: [
        {
          id: 'r1',
          questionId: 'q1',
          studentId: 'student1',
          submittedAt: now - 500,
          answer: {
            type: 'free-response',
            text: 'My answer',
          },
        },
      ],
      responseDrafts: {},
      annotations: {
        r1: {
          starred: false,
          flagged: false,
          emoji: '💡',
        },
      },
      reveals: [],
      sharedResponseReactions: {},
      responseOrderOverrides: {},
      persistentHash: null,
    },
  }
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof stateHandler, 'function')

  const res = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
      query: {
        studentId: 'student1',
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as {
    reveals?: unknown[]
    reviewedResponses?: Array<{
      instructorEmoji?: string
      answer?: { text?: string }
      question?: { text?: string }
    }>
  }
  assert.deepEqual(body.reveals, [])
  assert.equal(body.reviewedResponses?.[0]?.instructorEmoji, '💡')
  assert.equal(body.reviewedResponses?.[0]?.answer?.text, 'My answer')
  assert.equal(body.reviewedResponses?.[0]?.question?.text, 'Explain your reasoning.')

  await sessions.close()
})

void test('student state hides reviewed responses for annotated answers when the question is active again', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const sessions = createSessionStore(null)
  const now = Date.now()
  const session: SessionRecord = {
    id: 'resonance-session-private-feedback-reactivated',
    type: 'resonance',
    created: now,
    lastActivity: now,
    data: {
      instructorPasscode: 'TEACH123',
      questions: [
        {
          id: 'q1',
          type: 'free-response',
          text: 'Explain your reasoning.',
          order: 0,
        },
      ],
      activeQuestionId: 'q1',
      activeQuestionIds: ['q1'],
      activeQuestionDeadlineAt: null,
      students: {
        student1: { studentId: 'student1', name: 'Ada Lovelace', joinedAt: now - 1_000 },
      },
      responses: [
        {
          id: 'r1',
          questionId: 'q1',
          studentId: 'student1',
          submittedAt: now - 500,
          answer: {
            type: 'free-response',
            text: 'My answer',
          },
        },
      ],
      responseDrafts: {},
      annotations: {
        r1: {
          starred: false,
          flagged: false,
          emoji: '💡',
        },
      },
      reveals: [],
      sharedResponseReactions: {},
      responseOrderOverrides: {},
      persistentHash: null,
    },
  }
  await sessions.set(session.id, session)

  setupResonanceRoutes(app, sessions, ws)

  const stateHandler = app.handlers.get['/api/resonance/:sessionId/state']
  assert.equal(typeof stateHandler, 'function')

  const res = createResponse()
  await stateHandler?.(
    {
      params: { sessionId: session.id },
      query: {
        studentId: 'student1',
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as {
    reviewedResponses?: unknown[]
    submittedAnswers?: Record<string, { text?: string }>
  }
  assert.deepEqual(body.reviewedResponses, [])
  assert.equal(body.submittedAnswers?.q1?.text, 'My answer')

  await sessions.close()
})
