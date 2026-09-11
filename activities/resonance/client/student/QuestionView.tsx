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
  disabled?: boolean
  isSubmitted?: boolean
  submittedMessage?: string
  announceSubmittedMessage?: boolean
  onSubmitted?(questionId: string, answer: AnswerPayload): void
  sendMessage?(type: string, payload: unknown): boolean
}

const DRAFT_PUSH_DELAY_MS = 1500

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
  disabled = false,
  isSubmitted = false,
  submittedMessage = 'Answer submitted.',
  announceSubmittedMessage = true,
  onSubmitted,
  sendMessage,
}: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draftAnswer, setDraftAnswer] = useState<AnswerPayload | null>(initialAnswer)
  const lastSentDraftRef = useRef<AnswerPayload | null>(null)
  const initialAnswerRef = useRef(initialAnswer)
  const synchronizedInitialAnswerRef = useRef(initialAnswer)
  const autoSubmittedRunRef = useRef<number | null>(null)
  const activeQuestionRunStartedAtRef = useRef(activeQuestionRunStartedAt)
  const draftAnswerRunStartedAtRef = useRef(activeQuestionRunStartedAt)
  initialAnswerRef.current = initialAnswer
  activeQuestionRunStartedAtRef.current = activeQuestionRunStartedAt
  const isWaitingForChoices =
    question.type === 'multiple-choice' && question.choicesRevealed === false

  useEffect(() => {
    setDraftAnswer(initialAnswerRef.current)
    lastSentDraftRef.current = initialAnswerRef.current
    synchronizedInitialAnswerRef.current = initialAnswerRef.current
  }, [question.id, activeQuestionRunStartedAt, isSubmitted])

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
        answer: pendingDraft,
      })
      if (sent) {
        lastSentDraftRef.current = pendingDraft
      }
    }

    const timeoutId = window.setTimeout(() => {
      sendDraft()
    }, DRAFT_PUSH_DELAY_MS)

    return () => {
      window.clearTimeout(timeoutId)
      if (
        activeQuestionRunStartedAtRef.current === activeQuestionRunStartedAt &&
        draftAnswerRunStartedAt === activeQuestionRunStartedAt &&
        !isSameAnswer(pendingDraft, lastSentDraftRef.current)
      ) {
        sendDraft()
      }
    }
  }, [activeQuestionRunStartedAt, draftAnswer, isSubmitted, isWaitingForChoices, question.id, sendMessage, studentId])

  useEffect(() => {
    if (!disabled) {
      autoSubmittedRunRef.current = null
      return
    }
    if (
      autoSubmittedRunRef.current === activeQuestionRunStartedAt ||
      isSubmitted ||
      isWaitingForChoices ||
      draftAnswer === null
    ) {
      return
    }

    autoSubmittedRunRef.current = activeQuestionRunStartedAt
    void submitAnswer(draftAnswer, true)
  }, [activeQuestionRunStartedAt, disabled, draftAnswer, isSubmitted, isWaitingForChoices])

  async function submitAnswer(
    answer: { type: 'free-response'; text: string } | { type: 'multiple-choice'; selectedOptionIds: string[] },
    autoSubmit = false,
  ) {
    if ((disabled && !autoSubmit) || isSubmitted || isWaitingForChoices) {
      return
    }

    setSubmitting(true)
    setError(null)

    const sentViaWs = sendMessage?.('resonance:submit-answer', {
      studentId,
      questionId: question.id,
      answer,
      ...(autoSubmit ? { autoSubmit: true } : {}),
    }) ?? false

    if (sentViaWs) {
      onSubmitted?.(question.id, answer)
      setDraftAnswer(answer)
      lastSentDraftRef.current = answer
      draftAnswerRunStartedAtRef.current = activeQuestionRunStartedAt
      setSubmitting(false)
      return
    }

    try {
      const resp = await fetch(`/api/resonance/${sessionId}/submit-answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, questionId: question.id, answer, ...(autoSubmit ? { autoSubmit: true } : {}) }),
      })

      const data = (await resp.json()) as { ok?: boolean; error?: string }

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
      setError('Network error — please try again')
    } finally {
      setSubmitting(false)
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
            draftAnswerRunStartedAtRef.current = activeQuestionRunStartedAt
            setDraftAnswer(trimmed.length > 0 ? { type: 'free-response', text: trimmed } : null)
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
            draftAnswerRunStartedAtRef.current = activeQuestionRunStartedAt
            setDraftAnswer(selectedOptionIds.length > 0 ? { type: 'multiple-choice', selectedOptionIds } : null)
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
