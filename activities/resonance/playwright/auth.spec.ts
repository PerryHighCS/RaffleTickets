import { expect, test } from '@playwright/test'

test('Resonance binds student REST and WebSocket identity to an httpOnly capability', async ({ browser }) => {
  test.skip(test.info().project.name !== 'chromium', 'WebKit request contexts do not retain Set-Cookie responses in this harness.')
  const context = await browser.newContext()
  const page = await context.newPage()

  const created = await page.request.post('/api/resonance/create', { data: {} })
  expect(created.ok()).toBe(true)
  const { id: sessionId, instructorPasscode } = await created.json() as {
    id: string
    instructorPasscode: string
  }
  const instructorHeaders = { 'x-instructor-passcode': instructorPasscode }
  expect((await page.request.post(`/api/resonance/${encodeURIComponent(sessionId)}/add-question`, {
    headers: instructorHeaders,
    data: {
      id: 'q1',
      type: 'free-response',
      text: 'Explain your reasoning.',
      order: 0,
    },
  })).ok()).toBe(true)
  expect((await page.request.post(`/api/resonance/${encodeURIComponent(sessionId)}/activate-question`, {
    headers: instructorHeaders,
    data: { questionId: 'q1' },
  })).ok()).toBe(true)

  await page.goto(`/${encodeURIComponent(sessionId)}`)
  await page.getByLabel('Your name *').fill('Ada')
  await page.getByRole('button', { name: 'Join Session' }).click()
  await expect(page.getByText('Explain your reasoning.')).toBeVisible()
  await expect(page.getByLabel('Your answer')).toBeVisible()

  const capabilityCookie = (await context.cookies()).find((cookie) =>
    cookie.name.startsWith('activebits_cap_participant_'))
  expect(capabilityCookie?.httpOnly).toBe(true)
  const studentId = await page.evaluate((id) => {
    const stored = window.localStorage.getItem(`session-participant:${id}`)
    return stored ? (JSON.parse(stored) as { studentId?: string }).studentId : undefined
  }, sessionId)
  expect(studentId).toBeTruthy()
  if (!studentId) throw new Error('Expected Resonance registration to persist a student id.')

  const attackerContext = await browser.newContext()
  const attackerResponse = await attackerContext.request.get(
    `/api/resonance/${encodeURIComponent(sessionId)}/state?studentId=${encodeURIComponent(studentId)}`,
  )
  expect(attackerResponse.status()).toBe(403)

  await attackerContext.close()
  await context.close()
})
