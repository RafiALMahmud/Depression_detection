import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { questionnaireApi } from '../../api/services';
import type {
  QuestionOut,
  SubmitAnswerResponse,
  ThresholdTier,
  VisionPredictionResult,
} from '../../types/domain';

type FlowPhase = 'starting' | 'answering' | 'submitting' | 'complete' | 'error';

interface QuestionnaireFlowProps {
  facialScanResult: VisionPredictionResult;
  facialScore: number;
  onComplete: (summary: CompletionSummary) => void;
  onCancel: () => void;
}

export interface CompletionSummary {
  sessionId: number;
  facialScore: number;
  questionnaireScore: number;
  compositeScore: number;
  thresholdTier: ThresholdTier;
}

const TIER_CONFIG: Record<ThresholdTier, { label: string; color: string; bg: string; message: string }> = {
  low: {
    label: 'Not Stressed',
    color: 'text-emerald-700',
    bg: 'bg-emerald-50 border-emerald-200',
    message: "You're doing well. Keep up your regular check-ins to stay balanced.",
  },
  moderate: {
    label: 'Moderately Stressed',
    color: 'text-amber-700',
    bg: 'bg-amber-50 border-amber-200',
    message: 'Some indicators suggest moderate stress. Consider using the wellness resources available to you.',
  },
  high: {
    label: 'Stressed',
    color: 'text-orange-700',
    bg: 'bg-orange-50 border-orange-200',
    message: 'Your scores indicate elevated stress. Please reach out to a support resource.',
  },
  severe: {
    label: 'Very Stressed',
    color: 'text-red-700',
    bg: 'bg-red-50 border-red-200',
    message: 'Your scores suggest very high stress. We strongly encourage you to talk to a counselor or trusted person.',
  },
};

export const QuestionnaireFlow = ({
  facialScanResult,
  facialScore,
  onComplete,
  onCancel,
}: QuestionnaireFlowProps) => {
  const [phase, setPhase] = useState<FlowPhase>('starting');
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<QuestionOut | null>(null);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [completionData, setCompletionData] = useState<SubmitAnswerResponse | null>(null);

  const startSession = useCallback(async () => {
    setPhase('starting');
    setErrorMessage(null);

    try {
      const result = await questionnaireApi.startSession({
        facial_score: facialScore,
        facial_emotions: {
          dominant_label: facialScanResult.dominant_label,
          dominant_confidence: facialScanResult.dominant_confidence,
          averaged_scores: facialScanResult.averaged_scores,
        },
      });

      setSessionId(result.session_id);
      setCurrentQuestion(result.first_question);
      setSelectedOption(null);
      setPhase('answering');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not start the questionnaire session.';
      setPhase('error');
      setErrorMessage(message);
      toast.error(message);
    }
  }, [facialScore, facialScanResult]);

  const submitAnswer = useCallback(async () => {
    if (sessionId === null || currentQuestion === null || selectedOption === null) return;

    setPhase('submitting');
    setErrorMessage(null);

    try {
      const result = await questionnaireApi.submitAnswer({
        session_id: sessionId,
        question_id: currentQuestion.id,
        answer_index: selectedOption,
      });

      if (result.is_complete) {
        setCompletionData(result);
        setPhase('complete');
        toast.success('Questionnaire completed successfully.');

        if (
          result.questionnaire_score !== null &&
          result.composite_score !== null &&
          result.threshold_tier !== null
        ) {
          onComplete({
            sessionId,
            facialScore,
            questionnaireScore: result.questionnaire_score,
            compositeScore: result.composite_score,
            thresholdTier: result.threshold_tier,
          });
        }
      } else if (result.next_question) {
        setCurrentQuestion(result.next_question);
        setSelectedOption(null);
        setPhase('answering');
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not submit the answer. Please retry.';
      setPhase('error');
      setErrorMessage(message);
      toast.error(message);
    }
  }, [sessionId, currentQuestion, selectedOption, facialScore, onComplete]);

  const hasStarted = useRef(false);

  useEffect(() => {
    if (!hasStarted.current) {
      hasStarted.current = true;
      void startSession();
    }
  }, [startSession]);

  if (phase === 'starting') {
    return (
      <div className="mw-card" style={{ padding: '2rem', textAlign: 'center' }}>
        <h3 style={{ marginBottom: '0.5rem' }}>Starting Questionnaire</h3>
        <p className="mw-helper-text">
          Preparing your adaptive PHQ-9 assessment based on your facial scan results...
        </p>
        <div style={{ marginTop: '1.5rem' }}>
          <div className="mw-scan-progress-track" role="presentation" style={{ maxWidth: '300px', margin: '0 auto' }}>
            <div className="mw-scan-progress-fill" style={{ width: '30%', transition: 'width 2s ease' }} />
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="mw-card" style={{ padding: '2rem' }}>
        <div className="mw-scan-message-card danger">
          <h4>Questionnaire Error</h4>
          <p>{errorMessage}</p>
        </div>
        <div className="mw-info-panel-actions" style={{ marginTop: '1rem' }}>
          <button type="button" className="mw-btn-primary" onClick={() => void startSession()}>
            Retry
          </button>
          <button type="button" className="mw-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'complete' && completionData) {
    const tier = completionData.threshold_tier ?? 'low';
    const tierConfig = TIER_CONFIG[tier];

    return (
      <div className="mw-card" style={{ padding: '2rem' }}>
        <p className="mw-entity-kicker">Check-In Complete</p>
        <h3 style={{ marginBottom: '1.5rem' }}>Your Stress Screening Results</h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
          <div className="mw-card" style={{ padding: '1rem', textAlign: 'center' }}>
            <span className="mw-helper-text">Facial Score</span>
            <p style={{ fontSize: '1.5rem', fontWeight: 700 }}>{Math.round(facialScore)}</p>
          </div>
          <div className="mw-card" style={{ padding: '1rem', textAlign: 'center' }}>
            <span className="mw-helper-text">Questionnaire Score</span>
            <p style={{ fontSize: '1.5rem', fontWeight: 700 }}>
              {completionData.questionnaire_score !== null ? Math.round(completionData.questionnaire_score) : '—'}
            </p>
          </div>
          <div className="mw-card" style={{ padding: '1rem', textAlign: 'center' }}>
            <span className="mw-helper-text">Composite Score</span>
            <p style={{ fontSize: '1.5rem', fontWeight: 700 }}>
              {completionData.composite_score !== null ? Math.round(completionData.composite_score) : '—'}
            </p>
          </div>
        </div>

        <div
          className={`${tierConfig.bg} border`}
          style={{ padding: '1rem', borderRadius: '0.5rem', marginBottom: '1.5rem' }}
        >
          <p style={{ fontWeight: 600, marginBottom: '0.25rem' }} className={tierConfig.color}>
            Stress Level: {tierConfig.label}
          </p>
          <p style={{ fontSize: '0.875rem' }}>{tierConfig.message}</p>
        </div>

        <div className="mw-info-panel-actions">
          <button type="button" className="mw-btn-primary" onClick={onCancel}>
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Answering / Submitting phase
  if (!currentQuestion) return null;

  const progressPercent =
    currentQuestion.total_estimated > 0
      ? Math.min(100, ((currentQuestion.sequence_order - 1) / currentQuestion.total_estimated) * 100)
      : 0;

  return (
    <div className="mw-card" style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <p className="mw-entity-kicker">Adaptive PHQ-9 Assessment</p>
        <span className="mw-badge mw-badge-muted">
          Question {currentQuestion.sequence_order} of ~{currentQuestion.total_estimated}
        </span>
      </div>

      <div className="mw-scan-progress-track" role="presentation" style={{ marginBottom: '1.5rem' }}>
        <div
          className="mw-scan-progress-fill"
          style={{ width: `${progressPercent}%`, transition: 'width 0.3s ease' }}
        />
      </div>

      <h3 style={{ marginBottom: '1.5rem', lineHeight: 1.5 }}>{currentQuestion.text}</h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', marginBottom: '1.5rem' }}>
        {currentQuestion.options.map((option, index) => {
          const isSelected = selectedOption === index;
          return (
            <button
              key={index}
              type="button"
              onClick={() => setSelectedOption(index)}
              disabled={phase === 'submitting'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.875rem 1rem',
                borderRadius: '0.5rem',
                border: isSelected ? '2px solid var(--mw-accent, #3b82f6)' : '1px solid var(--mw-border, #e2e8f0)',
                background: isSelected ? 'var(--mw-accent-bg, #eff6ff)' : 'var(--mw-card-bg, #fff)',
                cursor: phase === 'submitting' ? 'not-allowed' : 'pointer',
                textAlign: 'left',
                fontSize: '0.9375rem',
                transition: 'border-color 0.15s, background 0.15s',
                opacity: phase === 'submitting' ? 0.6 : 1,
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '1.5rem',
                  height: '1.5rem',
                  borderRadius: '50%',
                  border: isSelected ? '2px solid var(--mw-accent, #3b82f6)' : '2px solid var(--mw-border, #cbd5e1)',
                  background: isSelected ? 'var(--mw-accent, #3b82f6)' : 'transparent',
                  flexShrink: 0,
                }}
              >
                {isSelected && (
                  <span
                    style={{
                      display: 'block',
                      width: '0.5rem',
                      height: '0.5rem',
                      borderRadius: '50%',
                      background: '#fff',
                    }}
                  />
                )}
              </span>
              {option.label}
            </button>
          );
        })}
      </div>

      <div className="mw-info-panel-actions">
        <button
          type="button"
          className="mw-btn-primary"
          onClick={() => void submitAnswer()}
          disabled={selectedOption === null || phase === 'submitting'}
        >
          {phase === 'submitting' ? 'Submitting...' : 'Next'}
        </button>
        <button type="button" className="mw-btn-ghost" onClick={onCancel} disabled={phase === 'submitting'}>
          Cancel Check-In
        </button>
      </div>
    </div>
  );
};
