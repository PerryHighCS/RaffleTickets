import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { JSDOM } from 'jsdom'
import FreeResponseInput from './FreeResponseInput.js'
import MCQInput from './MCQInput.js'
import QuestionView from './QuestionView.js'

;(globalThis as { React?: typeof React }).React = React

function installDomEnvironment() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://activebits.local/',
  })

  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

  ;(globalThis as { window: Window & typeof globalThis }).window = dom.window as unknown as Window & typeof globalThis
  ;(globalThis as { document: Document }).document = dom.window.document
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: dom.window.navigator,
  })

  return () => {
    const documentBody = globalThis.document?.body
    if (documentBody != null) {
      documentBody.innerHTML = ''
    }
    dom.window.close()
    ;(globalThis as { window?: Window & typeof globalThis }).window = previousWindow
    ;(globalThis as { document?: Document }).document = previousDocument
    if (previousNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', previousNavigatorDescriptor)
    } else {
      delete (globalThis as { navigator?: Navigator }).navigator
    }
  }
}

void test('FreeResponseInput syncs its text when the provided value changes', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { render, waitFor } = await import('@testing-library/react')

  try {
    const rendered = render(
      React.createElement(FreeResponseInput, {
        value: 'First answer',
        onSubmit: async () => undefined,
      }),
    )

    const textarea = rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement
    await waitFor(() => {
      assert.equal(textarea.value, 'First answer')
    })

    rendered.rerender(
      React.createElement(FreeResponseInput, {
        value: 'Updated answer',
        onSubmit: async () => undefined,
      }),
    )

    await waitFor(() => {
      assert.equal(textarea.value, 'Updated answer')
    })

    rendered.unmount()
  } finally {
    restoreDomEnvironment()
  }
})

void test('MCQInput syncs its selected options when the provided value changes', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { render, waitFor } = await import('@testing-library/react')

  try {
    const options = [
      { id: 'a', text: 'Option A' },
      { id: 'b', text: 'Option B' },
    ]

    const rendered = render(
      React.createElement(MCQInput, {
        options,
        selectionMode: 'single',
        value: ['a'],
        onSubmit: async () => undefined,
      }),
    )

    const optionA = rendered.getByRole('radio', { name: 'Option A' }) as HTMLInputElement
    const optionB = rendered.getByRole('radio', { name: 'Option B' }) as HTMLInputElement

    await waitFor(() => {
      assert.equal(optionA.checked, true)
      assert.equal(optionB.checked, false)
    })

    rendered.rerender(
      React.createElement(MCQInput, {
        options,
        selectionMode: 'single',
        value: ['b'],
        onSubmit: async () => undefined,
      }),
    )

    await waitFor(() => {
      assert.equal(optionA.checked, false)
      assert.equal(optionB.checked, true)
    })

    rendered.unmount()
  } finally {
    restoreDomEnvironment()
  }
})

void test('submitted inputs render the provided submitted message consistently', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { render } = await import('@testing-library/react')

  try {
    const freeResponse = render(
      React.createElement(FreeResponseInput, {
        value: 'Done',
        submitted: true,
        submittedMessage: 'Answer submitted. Moving to the next question.',
        onSubmit: async () => undefined,
      }),
    )
    assert.equal(
      freeResponse.getByText('Answer submitted. Moving to the next question.').textContent,
      'Answer submitted. Moving to the next question.',
    )
    freeResponse.unmount()

    const mcq = render(
      React.createElement(MCQInput, {
        options: [
          { id: 'a', text: 'Option A' },
          { id: 'b', text: 'Option B' },
        ],
        selectionMode: 'single',
        value: ['a'],
        submitted: true,
        submittedMessage: 'Answer submitted.',
        onSubmit: async () => undefined,
      }),
    )
    assert.equal(
      mcq.getByText('Answer submitted.').textContent,
      'Answer submitted.',
    )
    mcq.unmount()
  } finally {
    restoreDomEnvironment()
  }
})

void test('QuestionView submits over websocket first when sendMessage is available', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const previousFetch = globalThis.fetch
  const { fireEvent, render, waitFor } = await import('@testing-library/react')

  try {
    let fetchCalled = false
    ;(globalThis as { fetch?: typeof fetch }).fetch = (async () => {
      fetchCalled = true
      throw new Error('fetch should not be called when websocket submit succeeds')
    }) as typeof fetch

    const submitted: Array<{ questionId: string; answer: { type: string; text?: string } }> = []
    const wsMessages: Array<{ type: string; payload: unknown }> = []

    const rendered = render(
      React.createElement(QuestionView, {
        question: {
          id: 'q1',
          type: 'free-response',
          text: 'Explain your reasoning.',
          order: 0,
        },
        sessionId: 'session-1',
        studentId: 'student-1',
        sendMessage: (type: string, payload: unknown) => {
          wsMessages.push({ type, payload })
          return true
        },
        onSubmitted: (questionId, answer) => {
          submitted.push({ questionId, answer })
        },
      }),
    )

    const textarea = rendered.getByLabelText(/your answer/i)
    fireEvent.change(textarea, { target: { value: 'Fast path answer' } })
    fireEvent.click(rendered.getByRole('button', { name: /submit answer/i }))

    await waitFor(() => {
      assert.equal(wsMessages.length > 0, true)
    })

    assert.equal(fetchCalled, false)
    assert.deepEqual(wsMessages[0], {
      type: 'resonance:submit-answer',
      payload: {
        studentId: 'student-1',
        questionId: 'q1',
        answer: {
          type: 'free-response',
          text: 'Fast path answer',
        },
      },
    })
    assert.deepEqual(submitted, [
      {
        questionId: 'q1',
        answer: {
          type: 'free-response',
          text: 'Fast path answer',
        },
      },
    ])

    rendered.unmount()
  } finally {
    ;(globalThis as { fetch?: typeof fetch }).fetch = previousFetch
    restoreDomEnvironment()
  }
})

void test('QuestionView auto-submits a non-empty draft when time expires', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { fireEvent, render, waitFor } = await import('@testing-library/react')

  try {
    const messages: Array<{ type: string; payload: unknown }> = []
    const question = {
      id: 'q1',
      type: 'free-response' as const,
      text: 'Explain your reasoning.',
      order: 0,
    }
    const renderQuestion = (disabled: boolean) => React.createElement(QuestionView, {
      question,
      sessionId: 'session-1',
      studentId: 'student-1',
      activeQuestionRunStartedAt: 1_000,
      disabled,
      sendMessage: (type: string, payload: unknown) => {
        messages.push({ type, payload })
        return true
      },
    })
    const rendered = render(renderQuestion(false))

    fireEvent.change(rendered.getByLabelText(/your answer/i), {
      target: { value: 'Work preserved at timeout' },
    })
    rendered.rerender(renderQuestion(true))

    await waitFor(() => {
      assert.deepEqual(messages.find((message) => message.type === 'resonance:submit-answer'), {
        type: 'resonance:submit-answer',
        payload: {
          studentId: 'student-1',
          questionId: 'q1',
          answer: { type: 'free-response', text: 'Work preserved at timeout' },
          autoSubmit: true,
        },
      })
    })

    rendered.unmount()
  } finally {
    restoreDomEnvironment()
  }
})

void test('QuestionView does not auto-submit while a manual submission is pending', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const previousFetch = globalThis.fetch
  const { fireEvent, render, waitFor } = await import('@testing-library/react')

  try {
    const deferredFetch: { resolve: ((response: Response) => void) | null } = { resolve: null }
    let fetchCount = 0
    const submitted: unknown[] = []
    ;(globalThis as { fetch?: typeof fetch }).fetch = (() => {
      fetchCount += 1
      return new Promise<Response>((resolve) => {
        deferredFetch.resolve = resolve
      })
    }) as typeof fetch

    const question = { id: 'q1', type: 'free-response' as const, text: 'Explain.', order: 0 }
    const renderQuestion = (disabled: boolean) => React.createElement(QuestionView, {
      question,
      sessionId: 'session-1',
      studentId: 'student-1',
      activeQuestionRunStartedAt: 1_000,
      disabled,
      sendMessage: () => false,
      onSubmitted: (_questionId, answer) => submitted.push(answer),
    })
    const rendered = render(renderQuestion(false))
    fireEvent.change(rendered.getByLabelText(/your answer/i), { target: { value: 'Manual answer' } })
    fireEvent.click(rendered.getByRole('button', { name: /submit answer/i }))

    await waitFor(() => assert.equal(fetchCount, 1))
    await waitFor(() => assert.equal(rendered.getByRole('button').getAttribute('aria-busy'), 'true'))
    rendered.rerender(renderQuestion(true))
    assert.equal(fetchCount, 1)

    assert.ok(deferredFetch.resolve)
    deferredFetch.resolve({ ok: true, json: async () => ({ ok: true }) } as Response)
    await waitFor(() => assert.equal(submitted.length, 1))
    assert.equal(fetchCount, 1)
    rendered.unmount()
  } finally {
    ;(globalThis as { fetch?: typeof fetch }).fetch = previousFetch
    restoreDomEnvironment()
  }
})

void test('QuestionView preserves a student draft when a same-run session update contains an older answer', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { fireEvent, render, waitFor } = await import('@testing-library/react')

  try {
    const question = {
      id: 'q1',
      type: 'free-response' as const,
      text: 'Explain your reasoning.',
      order: 0,
    }
    const rendered = render(
      React.createElement(QuestionView, {
        question,
        sessionId: 'session-1',
        studentId: 'student-1',
        activeQuestionRunStartedAt: 2_000,
        initialAnswer: null,
        sendMessage: () => true,
      }),
    )

    const textarea = rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'New work that must remain' } })

    rendered.rerender(
      React.createElement(QuestionView, {
        question,
        sessionId: 'session-1',
        studentId: 'student-1',
        activeQuestionRunStartedAt: 2_000,
        initialAnswer: { type: 'free-response', text: 'Earlier run answer' },
        sendMessage: () => true,
      }),
    )

    await waitFor(() => {
      assert.equal(textarea.value, 'New work that must remain')
    })

    rendered.unmount()
  } finally {
    restoreDomEnvironment()
  }
})

void test('QuestionView syncs a same-run session answer when the local draft is unchanged', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { render, waitFor } = await import('@testing-library/react')

  try {
    const question = {
      id: 'q1',
      type: 'free-response' as const,
      text: 'Explain your reasoning.',
      order: 0,
    }
    const rendered = render(
      React.createElement(QuestionView, {
        question,
        sessionId: 'session-1',
        studentId: 'student-1',
        activeQuestionRunStartedAt: 2_000,
        initialAnswer: null,
        sendMessage: () => true,
      }),
    )

    rendered.rerender(
      React.createElement(QuestionView, {
        question,
        sessionId: 'session-1',
        studentId: 'student-1',
        activeQuestionRunStartedAt: 2_000,
        initialAnswer: { type: 'free-response', text: 'Submitted from another device' },
        sendMessage: () => true,
      }),
    )

    await waitFor(() => {
      assert.equal(
        (rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement).value,
        'Submitted from another device',
      )
    })

    rendered.unmount()
  } finally {
    restoreDomEnvironment()
  }
})

void test('QuestionView does not flush an unsent draft after the question run changes', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { fireEvent, render, waitFor } = await import('@testing-library/react')

  try {
    const sentDrafts: unknown[] = []
    const question = {
      id: 'q1',
      type: 'free-response' as const,
      text: 'Explain your reasoning.',
      order: 0,
    }
    const sendMessage = (type: string, payload: unknown) => {
      if (type === 'resonance:update-draft') {
        sentDrafts.push(payload)
      }
      return true
    }
    const rendered = render(
      React.createElement(QuestionView, {
        question,
        sessionId: 'session-1',
        studentId: 'student-1',
        activeQuestionRunStartedAt: 1_000,
        sendMessage,
      }),
    )

    fireEvent.change(rendered.getByLabelText(/your answer/i), {
      target: { value: 'Draft from the earlier run' },
    })
    rendered.rerender(
      React.createElement(QuestionView, {
        question,
        sessionId: 'session-1',
        studentId: 'student-1',
        activeQuestionRunStartedAt: 2_000,
        sendMessage,
      }),
    )

    await waitFor(() => {
      assert.deepEqual(sentDrafts, [])
    })

    rendered.unmount()
  } finally {
    restoreDomEnvironment()
  }
})

void test('QuestionView keeps an unsent draft associated with its original question when switching questions', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { fireEvent, render, waitFor } = await import('@testing-library/react')

  try {
    const sentDrafts: Array<{ questionId: string; answer: unknown }> = []
    const firstQuestion = {
      id: 'q1',
      type: 'free-response' as const,
      text: 'First question',
      order: 0,
    }
    const secondQuestion = {
      id: 'q2',
      type: 'free-response' as const,
      text: 'Second question',
      order: 1,
    }
    const sendMessage = (type: string, payload: unknown) => {
      if (type === 'resonance:update-draft') {
        sentDrafts.push(payload as { questionId: string; answer: unknown })
      }
      return true
    }
    const renderQuestion = (question: typeof firstQuestion) => React.createElement(QuestionView, {
      key: question.id,
      question,
      sessionId: 'session-1',
      studentId: 'student-1',
      activeQuestionRunStartedAt: 1_000,
      sendMessage,
    })
    const rendered = render(renderQuestion(firstQuestion))

    fireEvent.change(rendered.getByLabelText(/your answer/i), {
      target: { value: 'Draft for the first question' },
    })
    rendered.rerender(renderQuestion(secondQuestion))

    await waitFor(() => {
      assert.deepEqual(sentDrafts, [{
        studentId: 'student-1',
        questionId: 'q1',
        answer: { type: 'free-response', text: 'Draft for the first question' },
      }])
    })

    rendered.unmount()
  } finally {
    restoreDomEnvironment()
  }
})

void test('QuestionView shows only the stem for staged MCQs before choices are revealed', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { render } = await import('@testing-library/react')

  try {
    const rendered = render(
      React.createElement(QuestionView, {
        question: {
          id: 'q1',
          type: 'multiple-choice',
          text: 'This function creates a sequence of numbers.',
          order: 0,
          options: [],
          selectionMode: 'single',
          choicesRevealed: false,
        },
        sessionId: 'session-1',
        studentId: 'student-1',
        sendMessage: () => {
          throw new Error('stem-only staged questions should not send drafts or submissions')
        },
      }),
    )

    assert.equal(rendered.getByText('This function creates a sequence of numbers.').textContent, 'This function creates a sequence of numbers.')
    assert.equal(rendered.queryByRole('radio'), null)
    assert.equal(rendered.queryByRole('button', { name: /submit/i }), null)

    rendered.unmount()
  } finally {
    restoreDomEnvironment()
  }
})
