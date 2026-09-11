import { useEffect, useRef, useState } from 'react'
import type { AnswerPayload, StudentQuestion } from '../../shared/types.js'
import { areMcqSelectionsEqual } from '../../shared/mcq.js'
import FormattedMarkdown from '../components/FormattedMarkdown.js'
import FreeResponseInput from './FreeResponseInput.js'
import MCQInput from './MCQInput.js'

interface Props {
  question: StudentQuestion
  sessionId: string
  studentId: string
  initialAnswer?: AnswerPayload | null
  activeQuestionRunStartedAt?: number | null
  activeQuestionDeadlineAt?: number | null
  disabled?: boolean
  isSubmitted?: boolean
  submittedMessage?: string
  announceSubmittedMessage?: boolean
  onDraftChanged?(questionId: string, answer: AnswerPayload | null): void
  onSubmitted?(questionId: string, answer: AnswerPayload): void
  sendMessage?(type: string, payload: unknown): boolean
}

const DRAFT_PUSH_DELAY_MS = 1500
const DRAFT_DEADLINE_BUFFER_MS = 100

function isSameAnswer(left: AnswerPayload | null, right: AnswerPayload | null): boolean {
  if (left === right) return true
  if (left === null || right === null) return false
  if (left.type !== right.type) return false
  return left.type === 'free-response'
    ? right.type === 'free-response' && left.text === right.text
    : right.type === 'multiple-choice' &&
        areMcqSelectionsEqual(left.selectedOptionIds, right.selectedOptionIds)
}

export default function QuestionView({
  question,
  sessionId,
  studentId,
  initialAnswer = null,
  activeQuestionRunStartedAt = null,
  activeQuestionDeadlineAt = null,
  disabled = false,
  isSubmitted = false,
  submittedMessage = 'Answer submitted.',
  announceSubmittedMessage = true,
  onDraftChanged,
  onSubmitted,
  sendMessage,
}: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draftAnswer, setDraftAnswer] = useState<AnswerPayload | null>(initialAnswer)
  const lastSentDraftRef = useRef<AnswerPayload | null>(null)
  const initialAnswerRef = useRef(initialAnswer)
  const synchronizedInitialAnswerRef = useRef(initialAnswer)
  const submissionAttemptRef = useRef(0)
  const disabledRef = useRef(disabled)
  const activeQuestionRunStartedAtRef = useRef(activeQuestionRunStartedAt)
  const draftAnswerRunStartedAtRef = useRef<number | null>(null)
  initialAnswerRef.current = initialAnswer
  disabledRef.current = disabled
  activeQuestionRunStartedAtRef.current = activeQuestionRunStartedAt
  const isWaitingForChoices =
    question.type === 'multiple-choice' && question.choicesRevealed === false

  useEffect(() => {
    setDraftAnswer(initialAnswerRef.current)
    lastSentDraftRef.current = initialAnswerRef.current
    synchronizedInitialAnswerRef.current = initialAnswerRef.current
    draftAnswerRunStartedAtRef.current = null
  }, [question.id, activeQuestionRunStartedAt, isSubmitted])

  useEffect(() => {
    submissionAttemptRef.current += 1
    setSubmitting(false)
    setError(null)
    return () => {
      submissionAttemptRef.current += 1
    }
  }, [question.id, activeQuestionRunStartedAt, sessionId, studentId])

  useEffect(() => {
    if (isSameAnswer(draftAnswer, synchronizedInitialAnswerRef.current)) {
      setDraftAnswer(initialAnswer)
      lastSentDraftRef.current = initialAnswer
      synchronizedInitialAnswerRef.current = initialAnswer
    }
  }, [draftAnswer, initialAnswer])

  useEffect(() => {
    const draftAnswerRunStartedAt = draftAnswerRunStartedAtRef.current
    if (
      draftAnswerRunStartedAt !== activeQuestionRunStartedAt ||
      disabled ||
      isWaitingForChoices ||
      isSubmitted ||
      !sendMessage ||
      isSameAnswer(draftAnswer, lastSentDraftRef.current)
    ) {
      return
    }

    const pendingDraft = draftAnswer
    const sendDraft = () => {
      const sent = sendMessage('resonance:update-draft', {
        studentId,
        questionId: question.id,
        activeQuestionRunStartedAt,
        answer: pendingDraft,
      })
      if (sent) {
        lastSentDraftRef.current = pendingDraft
      }
    }

    const remainingBeforeDeadline = activeQuestionDeadlineAt === null
      ? null
      : activeQuestionDeadlineAt - Date.now()
    if (remainingBeforeDeadline !== null && remainingBeforeDeadline <= 0) {
      return
    }
    const pushDelayMs = remainingBeforeDeadline === null
      ? DRAFT_PUSH_DELAY_MS
      : Math.max(0, Math.min(DRAFT_PUSH_DELAY_MS, remainingBeforeDeadline - DRAFT_DEADLINE_BUFFER_MS))
    const timeoutId = window.setTimeout(() => {
      sendDraft()
    }, pushDelayMs)

    return () => {
      window.clearTimeout(timeoutId)
      if (
        activeQuestionRunStartedAtRef.current === activeQuestionRunStartedAt &&
        draftAnswerRunStartedAt === activeQuestionRunStartedAt &&
        !disabledRef.current &&
        !isSameAnswer(pendingDraft, lastSentDraftRef.current)
      ) {
        sendDraft()
      }
    }
  }, [activeQuestionDeadlineAt, activeQuestionRunStartedAt, disabled, draftAnswer, isSubmitted, isWaitingForChoices, question.id, sendMessage, studentId])

  async function submitAnswer(
    answer: { type: 'free-response'; text: string } | { type: 'multiple-choice'; selectedOptionIds: string[] },
  ) {
    if (disabled || isSubmitted || isWaitingForChoices) {
      return
    }

    setSubmitting(true)
    setError(null)
    const submissionAttempt = ++submissionAttemptRef.current
    const submissionRunStartedAt = activeQuestionRunStartedAtRef.current

    try {
      const resp = await fetch(`/api/resonance/${sessionId}/submit-answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          questionId: question.id,
          activeQuestionRunStartedAt: submissionRunStartedAt,
          answer,
        }),
      })

      const data = (await resp.json()) as { ok?: boolean; error?: string }

      if (
        submissionAttempt !== submissionAttemptRef.current ||
        submissionRunStartedAt !== activeQuestionRunStartedAtRef.current
      ) {
        return
      }

      if (!resp.ok) {
        setError(data.error ?? 'Submission failed — please try again')
        setSubmitting(false)
        return
      }

      onSubmitted?.(question.id, answer)
      setDraftAnswer(answer)
      lastSentDraftRef.current = answer
      draftAnswerRunStartedAtRef.current = activeQuestionRunStartedAt
    } catch {
      if (
        submissionAttempt === submissionAttemptRef.current &&
        submissionRunStartedAt === activeQuestionRunStartedAtRef.current
      ) {
        setError('Network error — please try again')
      }
    } finally {
      if (
        submissionAttempt === submissionAttemptRef.current &&
        submissionRunStartedAt === activeQuestionRunStartedAtRef.current
      ) {
        setSubmitting(false)
      }
    }
  }

  return (
    <div className="space-y-5">
      {/* Question text */}
      <FormattedMarkdown
        markdown={question.text}
        className="text-xl font-bold text-slate-900 dark:text-slate-100 leading-snug"
      />

      {/* Answer input */}
      {question.type === 'free-response' ? (
        <FreeResponseInput
          value={draftAnswer?.type === 'free-response' ? draftAnswer.text : ''}
          onDraftChange={(text) => {
            const trimmed = text.trim()
            const answer = trimmed.length > 0 ? { type: 'free-response' as const, text: trimmed } : null
            draftAnswerRunStartedAtRef.current = activeQuestionRunStartedAt
            setDraftAnswer(answer)
            onDraftChanged?.(question.id, answer)
          }}
          onSubmit={(text) => submitAnswer({ type: 'free-response', text })}
          submitting={submitting || disabled}
          submitted={isSubmitted}
          submittedMessage={submittedMessage}
          announceSubmittedMessage={announceSubmittedMessage}
        />
      ) : isWaitingForChoices ? null : (
        <MCQInput
          options={question.options}
          selectionMode={question.selectionMode}
          value={draftAnswer?.type === 'multiple-choice' ? draftAnswer.selectedOptionIds : []}
          onDraftChange={(selectedOptionIds) => {
            const answer = selectedOptionIds.length > 0
              ? { type: 'multiple-choice' as const, selectedOptionIds }
              : null
            draftAnswerRunStartedAtRef.current = activeQuestionRunStartedAt
            setDraftAnswer(answer)
            onDraftChanged?.(question.id, answer)
          }}
          onSubmit={(selectedOptionIds) => submitAnswer({ type: 'multiple-choice', selectedOptionIds })}
          submitting={submitting || disabled}
          submitted={isSubmitted}
          submittedMessage={submittedMessage}
          announceSubmittedMessage={announceSubmittedMessage}
        />
      )}

      {error !== null && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      {disabled && (
        <p className="text-sm text-amber-700 dark:text-amber-400" role="status">
          Time is up for this activity.
        </p>
      )}
    </div>
  )
}
