import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from 'recharts';

import { consultationsApi, peerSupportApi, questionnaireApi, visionApi } from '../api/services';
import { useAuth } from '../auth/AuthContext';
import { AppShell } from '../components/dashboard/AppShell';
import { StatsCard } from '../components/dashboard/StatsCard';
import { QuestionnaireFlow } from '../components/questionnaire/QuestionnaireFlow';
import type { CompletionSummary } from '../components/questionnaire/QuestionnaireFlow';
import type {
  DepressionLogEntry,
  ConsultationRequest,
  ConsultationTeamConfig,
  LiveEmotionResult,
  PeerSupportReactionType,
  PeerSupportThread,
  SessionListItem,
  StreakInfo,
  SymptomFrequency,
  VisionModelStatus,
  VisionPredictionResult,
} from '../types/domain';
import { getDashboardPathByRole } from '../utils/roles';

type DashboardSectionId = 'overview' | 'facial-scan' | 'community' | 'analytics' | 'depression-log';
type CheckInPhase = 'scan' | 'questionnaire' | 'results';
type CameraState = 'idle' | 'requesting' | 'ready' | 'denied' | 'unsupported' | 'error';
type ScanPhase = 'idle' | 'capturing' | 'uploading' | 'success' | 'error';

interface ScanProfile {
  label: string;
  durationMs: number;
  frameCount: number;
  intervalMs: number;
  description: string;
}

const FACIAL_SCAN_PROFILE: ScanProfile = {
  label: 'Guided 30s Scan',
  durationMs: 30_000,
  frameCount: 7,
  intervalMs: 5_000,
  description: 'MindWell captures seven secure frames across a fixed thirty-second facial scan.',
};

const DASHBOARD_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'facial-scan', label: 'Facial Scan' },
  { id: 'community', label: 'Community Board' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'depression-log', label: 'Depression Log' },
] as const;

const PEER_REACTION_OPTIONS: Array<{ type: PeerSupportReactionType; label: string }> = [
  { type: 'you_are_not_alone', label: 'You are not alone' },
  { type: 'sending_support', label: 'Sending support' },
  { type: 'take_a_breath', label: 'Take a breath' },
  { type: 'stay_strong', label: 'Stay strong' },
];

const TIER_CONFIG: Record<string, { label: string; badge: string; color: string }> = {
  low: { label: 'Not Stressed', badge: 'mw-badge-success', color: '#3a8f55' },
  moderate: { label: 'Moderately Stressed', badge: 'mw-badge-warning', color: '#d97706' },
  high: { label: 'Stressed', badge: 'mw-badge-warning', color: '#ef6c00' },
  severe: { label: 'Very Stressed', badge: 'mw-badge-danger', color: '#dc2626' },
};

const WELLNESS_RESOURCES: Record<
  string,
  { breathing: string; cbt: string; hotlines: string[] }
> = {
  low: {
    breathing:
      'Try the 4-7-8 technique: inhale for 4 counts, hold for 7, exhale slowly for 8. Repeat 4 times before sleep.',
    cbt: 'Gratitude journaling: write 3 specific things you appreciated today. Focus on why they mattered.',
    hotlines: [],
  },
  moderate: {
    breathing:
      'Box breathing: inhale 4s → hold 4s → exhale 4s → hold 4s. Repeat 4–6 cycles. Activates the parasympathetic nervous system.',
    cbt: 'Thought challenging: write the stressful thought, identify the cognitive distortion, then write a balanced reframe.',
    hotlines: [],
  },
  high: {
    breathing:
      'Progressive muscle relaxation: starting from your feet, tense each muscle group for 5 seconds then release. Move slowly up to your face.',
    cbt: 'Use the ABC model — identify the Activating event, the Belief that triggered distress, and the Consequence. Then dispute the belief with evidence.',
    hotlines: ['Employee Assistance Program (EAP) — speak confidentially with your HR team for a referral to a counsellor.'],
  },
  severe: {
    breathing:
      'Grounding breath: place one hand on your chest, one on your belly. Breathe in through your nose for 4s (belly rises), out through your mouth for 6s. Repeat until calmer.',
    cbt: '5-4-3-2-1 grounding: name 5 things you see, 4 you can touch, 3 you hear, 2 you smell, 1 you taste. Brings attention back to the present.',
    hotlines: [
      'Crisis Text Line — text HOME to 741741 (24/7, free, confidential).',
      'Suicide & Crisis Lifeline — call or text 988 (24/7, available in the US).',
      'Employee Assistance Program (EAP) — contact HR for a confidential referral.',
    ],
  },
};

const BADGE_CONFIG: Record<string, { emoji: string; label: string; description: string }> = {
  bronze: { emoji: '🥉', label: 'Bronze Streak', description: '4+ consecutive weeks of check-ins' },
  silver: { emoji: '🥈', label: 'Silver Streak', description: '8+ consecutive weeks of check-ins' },
  gold: { emoji: '🥇', label: 'Gold Streak', description: '12+ consecutive weeks of check-ins' },
};

const resolveStatusCode = (error: unknown): number | null => {
  if (typeof error !== 'object' || error === null || !('response' in error)) return null;
  const response = (error as { response?: { status?: number } }).response;
  return response?.status ?? null;
};

const resolveApiDetail = (error: unknown): string | null => {
  if (typeof error !== 'object' || error === null || !('response' in error)) return null;
  const response = (error as { response?: { data?: { detail?: string } } }).response;
  return response?.data?.detail ?? null;
};

const resolveVisionErrorMessage = (error: unknown, fallback: string): string => {
  const detail = resolveApiDetail(error);
  if (detail) return detail;
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ERR_NETWORK'
  ) {
    return 'Cannot reach the MindWell detection service right now. Check the backend connection and retry.';
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
};

const resolveApiErrorMessage = (error: unknown, fallback: string): string => {
  const detail = resolveApiDetail(error);
  if (detail) return detail;
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ERR_NETWORK'
  ) {
    return 'Cannot reach the API server right now. Check backend connection and retry.';
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
};

const computeFacialMoodScore = (result: VisionPredictionResult): number => {
  const weights: Record<string, number> = {
    sad: 1.0,
    fear: 0.7,
    angry: 0.5,
    disgust: 0.4,
    neutral: 0.3,
    surprise: 0.2,
    happy: 0.0,
  };
  let weightedSum = 0;
  for (const score of result.averaged_scores) {
    const w = weights[score.label.toLowerCase()] ?? 0.3;
    weightedSum += score.confidence * w;
  }
  return Math.min(100, Math.max(0, Math.round(weightedSum * 100)));
};

const toTitleCase = (value: string): string =>
  value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const toPercent = (value: number): string => `${Math.round(value * 100)}%`;

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
};

const formatScore = (value: number | null | undefined): string => {
  if (value == null) return '-';
  return value.toFixed(2);
};

const DAY_MS = 24 * 60 * 60 * 1000;

const daysSinceIsoDate = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - parsed.getTime()) / DAY_MS));
};

const getCameraMessage = (state: CameraState, detail: string | null): string => {
  if (detail) return detail;
  switch (state) {
    case 'requesting':
      return 'MindWell is requesting webcam permission so your scan can start securely.';
    case 'ready':
      return 'Camera preview is active and ready for your next facial scan.';
    case 'denied':
      return 'Camera permission was denied. Update your browser site permissions, then retry.';
    case 'unsupported':
      return 'This browser does not support secure webcam access for facial scanning.';
    case 'error':
      return 'MindWell could not open your webcam just now. Retry when your camera is available.';
    default:
      return 'Your camera stays off until you choose to begin a secure facial scan.';
  }
};

interface CameraStartResult {
  ready: boolean;
  message: string | null;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

const isTransientCaptureError = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return normalized.includes('preview is not ready') || normalized.includes('warming up');
};

export const EmployeeDashboardPage = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const [activeSectionId, setActiveSectionId] = useState<DashboardSectionId>('overview');
  const [modelStatus, setModelStatus] = useState<VisionModelStatus | null>(null);
  const [modelStatusLoading, setModelStatusLoading] = useState(true);
  const [modelStatusError, setModelStatusError] = useState<string | null>(null);

  const [cameraState, setCameraState] = useState<CameraState>('idle');
  const [cameraDetail, setCameraDetail] = useState<string | null>(null);

  const [scanPhase, setScanPhase] = useState<ScanPhase>('idle');
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<VisionPredictionResult | null>(null);
  const [capturedFrameCount, setCapturedFrameCount] = useState(0);
  const [countdownSeconds, setCountdownSeconds] = useState(0);

  const [liveEmotion, setLiveEmotion] = useState<LiveEmotionResult | null>(null);

  const [checkInPhase, setCheckInPhase] = useState<CheckInPhase>('scan');
  const [completionSummary, setCompletionSummary] = useState<CompletionSummary | null>(null);

  // Analytics state
  const [sessionHistory, setSessionHistory] = useState<SessionListItem[]>([]);
  const [sessionHistoryLoading, setSessionHistoryLoading] = useState(false);
  const [symptomData, setSymptomData] = useState<SymptomFrequency[]>([]);
  const [streakInfo, setStreakInfo] = useState<StreakInfo | null>(null);

  // Depression log state
  const [depressionLog, setDepressionLog] = useState<DepressionLogEntry[]>([]);
  const [depressionLogLoading, setDepressionLogLoading] = useState(false);
  const [depressionLogError, setDepressionLogError] = useState<string | null>(null);
  const [logDateFrom, setLogDateFrom] = useState('');
  const [logDateTo, setLogDateTo] = useState('');
  const [logExporting, setLogExporting] = useState(false);
  const [expandedLogSessionId, setExpandedLogSessionId] = useState<number | null>(null);

  // Anonymous community board state
  const [communityThreads, setCommunityThreads] = useState<PeerSupportThread[]>([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityError, setCommunityError] = useState<string | null>(null);
  const [communityPage, setCommunityPage] = useState(1);
  const [communityTotalPages, setCommunityTotalPages] = useState(1);
  const [communityShowAll, setCommunityShowAll] = useState(false);
  const [newThreadContent, setNewThreadContent] = useState('');
  const [createThreadPending, setCreateThreadPending] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const [replySubmittingThreadId, setReplySubmittingThreadId] = useState<number | null>(null);
  const [reactionPendingThreadId, setReactionPendingThreadId] = useState<number | null>(null);
  const [deletingThreadId, setDeletingThreadId] = useState<number | null>(null);

  // Counselor consultation state
  const [consultationConfig, setConsultationConfig] = useState<ConsultationTeamConfig | null>(null);
  const [consultationRequests, setConsultationRequests] = useState<ConsultationRequest[]>([]);
  const [consultationLoading, setConsultationLoading] = useState(false);
  const [consultationError, setConsultationError] = useState<string | null>(null);
  const [consultationSubmitting, setConsultationSubmitting] = useState(false);
  const [consultationNote, setConsultationNote] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const captureIntervalRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<number | null>(null);
  const activeFramesRef = useRef<Blob[]>([]);
  const captureInProgressRef = useRef(false);
  const scanRunRef = useRef(0);
  const statusRunRef = useRef(0);
  const logRunRef = useRef(0);
  const communityRunRef = useRef(0);
  const consultationRunRef = useRef(0);

  const allowed = user?.role === 'employee';
  const selectedProfile = FACIAL_SCAN_PROFILE;
  const isScanBusy = scanPhase === 'capturing' || scanPhase === 'uploading';
  const cameraMessage = getCameraMessage(cameraState, cameraDetail);
  const startScanDisabled =
    isScanBusy || modelStatusLoading || Boolean(modelStatusError) || Boolean(modelStatus && !modelStatus.ready);

  // Previous session score for decline detection
  const prevSessionScore = sessionHistory.length > 0 ? sessionHistory[0].composite_score : null;
  const declineDelta =
    completionSummary && prevSessionScore != null
      ? completionSummary.compositeScore - prevSessionScore
      : null;
  const showDeclineAlert = declineDelta !== null && declineDelta > 15;
  const latestConsultationRequest = consultationRequests.length > 0 ? consultationRequests[0] : null;

  const loadAnalyticsData = useCallback(async () => {
    setSessionHistoryLoading(true);
    try {
      const [sessionsRes, symptomsRes, streakRes] = await Promise.all([
        questionnaireApi.listSessions(1, 50),
        questionnaireApi.symptomFrequency(),
        questionnaireApi.streak(),
      ]);
      setSessionHistory(sessionsRes.items);
      setSymptomData(symptomsRes);
      setStreakInfo(streakRes);
    } catch {
      // silently fail — analytics are supplementary
    } finally {
      setSessionHistoryLoading(false);
    }
  }, []);

  const loadDepressionLog = useCallback(
    async (dateFromArg?: string, dateToArg?: string) => {
      const dateFrom = dateFromArg ?? logDateFrom;
      const dateTo = dateToArg ?? logDateTo;

      if (dateFrom && dateTo && dateFrom > dateTo) {
        setDepressionLogError('Start date cannot be later than end date.');
        setDepressionLog([]);
        return;
      }

      const runId = ++logRunRef.current;
      setDepressionLogLoading(true);
      setDepressionLogError(null);

      try {
        const entries = await questionnaireApi.getLog(dateFrom || undefined, dateTo || undefined);
        if (runId !== logRunRef.current) return;
        setDepressionLog(entries);
      } catch (error) {
        if (runId !== logRunRef.current) return;
        setDepressionLog([]);
        setDepressionLogError(
          resolveApiErrorMessage(error, 'Could not load your depression score log right now.'),
        );
      } finally {
        if (runId === logRunRef.current) {
          setDepressionLogLoading(false);
        }
      }
    },
    [logDateFrom, logDateTo],
  );

  const loadCommunityThreads = useCallback(
    async (requestedPage?: number, showAllOverride?: boolean) => {
      const page = requestedPage ?? communityPage;
      const includeAll = showAllOverride ?? communityShowAll;
      const runId = ++communityRunRef.current;
      setCommunityLoading(true);
      setCommunityError(null);

      try {
        const response = await peerSupportApi.listThreads(page, 20, includeAll);
        if (runId !== communityRunRef.current) return;
        setCommunityThreads(response.items);
        setCommunityPage(response.meta.page);
        setCommunityTotalPages(Math.max(1, response.meta.total_pages));
      } catch (error) {
        if (runId !== communityRunRef.current) return;
        setCommunityThreads([]);
        setCommunityTotalPages(1);
        setCommunityError(
          resolveApiErrorMessage(error, 'Could not load community posts right now. Please retry.'),
        );
      } finally {
        if (runId === communityRunRef.current) {
          setCommunityLoading(false);
        }
      }
    },
    [communityPage, communityShowAll],
  );

  const loadConsultationData = useCallback(async () => {
    const runId = ++consultationRunRef.current;
    setConsultationLoading(true);
    setConsultationError(null);

    try {
      const [config, requests] = await Promise.all([
        consultationsApi.getEmployeeConfig(),
        consultationsApi.listMyRequests(),
      ]);
      if (runId !== consultationRunRef.current) return;
      setConsultationConfig(config);
      setConsultationRequests(requests);
    } catch (error) {
      if (runId !== consultationRunRef.current) return;
      setConsultationConfig(null);
      setConsultationRequests([]);
      setConsultationError(
        resolveApiErrorMessage(error, 'Could not load counselor consultation settings right now.'),
      );
    } finally {
      if (runId === consultationRunRef.current) {
        setConsultationLoading(false);
      }
    }
  }, []);

  const handleCreateThread = useCallback(async () => {
    const trimmed = newThreadContent.trim();
    if (!trimmed) {
      toast.error('Write a short anonymous message before posting.');
      return;
    }
    setCreateThreadPending(true);
    try {
      const created = await peerSupportApi.createThread({ content: trimmed });
      setNewThreadContent('');
      if (created.moderation_status !== 'approved') {
        toast.warning(created.moderation_reason ?? 'Your post was removed by moderation.');
      } else {
        toast.success('Your anonymous post was submitted.');
      }
      void loadCommunityThreads(1);
    } catch (error) {
      const message = resolveApiErrorMessage(error, 'Could not publish your post right now.');
      toast.error(message);
    } finally {
      setCreateThreadPending(false);
    }
  }, [loadCommunityThreads, newThreadContent]);

  const handleReplyToThread = useCallback(
    async (threadId: number) => {
      const draft = (replyDrafts[threadId] ?? '').trim();
      if (!draft) {
        toast.error('Write a reply before posting.');
        return;
      }
      setReplySubmittingThreadId(threadId);
      try {
        const createdReply = await peerSupportApi.replyToThread(threadId, { content: draft });
        setReplyDrafts((current) => ({ ...current, [threadId]: '' }));
        if (createdReply.moderation_status !== 'approved') {
          toast.warning(createdReply.moderation_reason ?? 'Your reply was removed by moderation.');
        } else {
          toast.success('Your anonymous reply was posted.');
        }
        const updatedThread = await peerSupportApi.getThread(threadId);
        setCommunityThreads((current) =>
          current.map((thread) => (thread.id === threadId ? updatedThread : thread)),
        );
      } catch (error) {
        const message = resolveApiErrorMessage(error, 'Could not post your reply right now.');
        toast.error(message);
      } finally {
        setReplySubmittingThreadId((current) => (current === threadId ? null : current));
      }
    },
    [replyDrafts],
  );

  const handleToggleReaction = useCallback(
    async (threadId: number, reactionType: PeerSupportReactionType) => {
      setReactionPendingThreadId(threadId);
      try {
        const thread = communityThreads.find((item) => item.id === threadId);
        const nextReaction = thread?.my_reaction === reactionType ? null : reactionType;
        const updated = await peerSupportApi.updateReaction(threadId, { reaction_type: nextReaction });
        setCommunityThreads((current) =>
          current.map((item) => (item.id === threadId ? updated : item)),
        );
      } catch (error) {
        const message = resolveApiErrorMessage(error, 'Could not update your reaction right now.');
        toast.error(message);
      } finally {
        setReactionPendingThreadId((current) => (current === threadId ? null : current));
      }
    },
    [communityThreads],
  );

  const handleDeleteThread = useCallback(
    async (threadId: number) => {
      setDeletingThreadId(threadId);
      try {
        await peerSupportApi.deleteThread(threadId);
        toast.success('Thread deleted successfully.');
        const nextPage =
          !communityShowAll && communityThreads.length === 1 && communityPage > 1
            ? communityPage - 1
            : communityPage;
        await loadCommunityThreads(nextPage, communityShowAll);
      } catch (error) {
        const message = resolveApiErrorMessage(error, 'Could not delete this thread right now.');
        toast.error(message);
      } finally {
        setDeletingThreadId((current) => (current === threadId ? null : current));
      }
    },
    [communityPage, communityShowAll, communityThreads.length, loadCommunityThreads],
  );

  const handleCreateConsultationRequest = useCallback(async () => {
    if (!completionSummary) return;
    setConsultationSubmitting(true);
    try {
      await consultationsApi.createRequest({
        session_id: completionSummary.sessionId,
        note: consultationNote.trim() || undefined,
      });
      setConsultationNote('');
      toast.success('Counselor request submitted. You will see schedule updates here.');
      await loadConsultationData();
    } catch (error) {
      const message = resolveApiErrorMessage(error, 'Could not submit your consultation request right now.');
      toast.error(message);
    } finally {
      setConsultationSubmitting(false);
    }
  }, [completionSummary, consultationNote, loadConsultationData]);

  const clearTimers = useCallback(() => {
    if (captureIntervalRef.current !== null) {
      window.clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }
    if (countdownIntervalRef.current !== null) {
      window.clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  const detachCamera = useCallback(
    (nextState: CameraState = 'idle') => {
      clearTimers();
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      }
      setCameraState(nextState);
    },
    [clearTimers],
  );

  const loadModelStatus = useCallback(async () => {
    const runId = ++statusRunRef.current;
    setModelStatusLoading(true);
    setModelStatusError(null);
    try {
      const response = await visionApi.status();
      if (runId !== statusRunRef.current) return;
      setModelStatus(response);
    } catch (error) {
      if (runId !== statusRunRef.current) return;
      const message = resolveVisionErrorMessage(
        error,
        'MindWell could not confirm if the detection model is ready. Retry before scanning.',
      );
      setModelStatusError(message);
      setModelStatus(null);
    } finally {
      if (runId === statusRunRef.current) setModelStatusLoading(false);
    }
  }, []);

  const startCamera = useCallback(async (): Promise<CameraStartResult> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      const message = 'This browser does not support webcam access for secure facial scanning.';
      setCameraDetail(message);
      setCameraState('unsupported');
      return { ready: false, message };
    }

    if (mediaStreamRef.current && videoRef.current?.srcObject) {
      setCameraState('ready');
      return { ready: true, message: null };
    }

    setCameraState('requesting');
    setCameraDetail(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }

      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }

      setCameraState('ready');
      setCameraDetail(null);
      return { ready: true, message: null };
    } catch (error) {
      const errorName =
        typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : 'Error';

      if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
        const message = 'Camera permission was denied. Allow camera access for this site, then retry.';
        setCameraState('denied');
        setCameraDetail(message);
        return { ready: false, message };
      }

      if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
        const message = 'No webcam was found on this device. Connect a camera and retry.';
        setCameraState('error');
        setCameraDetail(message);
        return { ready: false, message };
      }

      const message = error instanceof Error ? error.message : 'MindWell could not access the webcam.';
      setCameraState('error');
      setCameraDetail(message);
      return { ready: false, message };
    }
  }, []);

  const ensurePreviewReady = useCallback(async (): Promise<boolean> => {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const video = videoRef.current;
      const stream = mediaStreamRef.current;
      if (video && stream) {
        if (video.srcObject !== stream) video.srcObject = stream;
        await video.play().catch(() => undefined);
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 1 && video.videoHeight > 1) {
          return true;
        }
      }
      await sleep(120);
    }
    return false;
  }, []);

  const captureFrame = useCallback(async (): Promise<Blob> => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) throw new Error('Camera preview is not ready yet. Re-open the webcam and retry.');
    if (video.videoWidth < 2 || video.videoHeight < 2)
      throw new Error('MindWell is still warming up the camera preview. Please retry in a moment.');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('MindWell could not prepare the webcam frame for upload.');

    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('MindWell could not capture a webcam frame. Please retry the scan.'));
            return;
          }
          resolve(blob);
        },
        'image/jpeg',
        0.92,
      );
    });
  }, []);

  const uploadFrames = useCallback(
    async (runId: number, frames: Blob[]) => {
      setScanPhase('uploading');
      setCountdownSeconds(0);

      try {
        const response = await visionApi.predict(frames, 3);
        if (runId !== scanRunRef.current) return;
        setScanResult(response);
        setScanError(null);
        setScanPhase('success');
        toast.success('Facial scan completed successfully.');
      } catch (error) {
        if (runId !== scanRunRef.current) return;
        const message = resolveVisionErrorMessage(
          error,
          'MindWell could not finish the facial scan. Please retry after checking camera and model readiness.',
        );
        setScanPhase('error');
        setScanError(message);
        if (resolveStatusCode(error) === 503) void loadModelStatus();
        toast.error(message);
      } finally {
        if (runId === scanRunRef.current) detachCamera('idle');
      }
    },
    [detachCamera, loadModelStatus],
  );

  const stopScan = useCallback(
    (announce = true) => {
      ++scanRunRef.current;
      activeFramesRef.current = [];
      captureInProgressRef.current = false;
      clearTimers();
      detachCamera('idle');
      setScanPhase('idle');
      setCapturedFrameCount(0);
      setCountdownSeconds(0);
      setLiveEmotion(null);
      if (announce) toast.info('Facial scan stopped.');
    },
    [clearTimers, detachCamera],
  );

  const startScan = useCallback(async () => {
    if (modelStatusLoading) {
      toast.info('MindWell is still checking model readiness. Please wait a moment.');
      return;
    }
    if (modelStatusError) {
      setScanPhase('error');
      setScanError(modelStatusError);
      toast.error(modelStatusError);
      return;
    }
    if (!modelStatus?.ready) {
      const message =
        modelStatus?.message ?? 'The facial detection model is not ready yet. Please place the checkpoint and retry readiness.';
      setScanPhase('error');
      setScanError(message);
      toast.error(message);
      return;
    }

    const cameraStartResult = await startCamera();
    if (!cameraStartResult.ready) {
      const permissionMessage = cameraStartResult.message ?? 'MindWell could not access the webcam. Please retry the scan.';
      setScanPhase('error');
      setScanError(permissionMessage);
      toast.error(permissionMessage);
      return;
    }

    const profile = FACIAL_SCAN_PROFILE;
    const runId = ++scanRunRef.current;
    activeFramesRef.current = [];
    captureInProgressRef.current = false;
    setActiveSectionId('facial-scan');
    setScanResult(null);
    setScanError(null);
    setCapturedFrameCount(0);
    setScanPhase('capturing');

    const previewReady = await ensurePreviewReady();
    if (runId !== scanRunRef.current) return;
    if (!previewReady) {
      const message = 'MindWell could not initialize the webcam preview. Please retry the scan.';
      setScanPhase('error');
      setScanError(message);
      toast.error(message);
      detachCamera('idle');
      return;
    }

    const endAt = Date.now() + profile.durationMs;
    setCountdownSeconds(Math.ceil(profile.durationMs / 1000));

    const finalizeCapture = () => {
      if (runId !== scanRunRef.current) return;
      clearTimers();
      setCountdownSeconds(0);
      const frames = activeFramesRef.current.slice();
      if (!frames.length) {
        setScanPhase('error');
        setScanError('No webcam frames were captured. Please reopen the camera and retry.');
        detachCamera('idle');
        return;
      }
      void uploadFrames(runId, frames);
    };

    const captureOnce = async () => {
      if (runId !== scanRunRef.current || captureInProgressRef.current) return;
      captureInProgressRef.current = true;
      try {
        const frame = await captureFrame();
        if (runId !== scanRunRef.current) return;
        activeFramesRef.current = [...activeFramesRef.current, frame];
        setCapturedFrameCount(activeFramesRef.current.length);
        visionApi.predictFrame(frame).then((result) => {
          if (runId === scanRunRef.current) setLiveEmotion(result);
        }).catch(() => undefined);
        if (activeFramesRef.current.length >= profile.frameCount) finalizeCapture();
      } catch (error) {
        if (runId !== scanRunRef.current) return;
        const message = error instanceof Error ? error.message : 'MindWell could not capture the webcam frame.';
        if (isTransientCaptureError(message)) return;
        const normalizedMessage = `${message} Please retry the scan.`;
        setScanPhase('error');
        setScanError(normalizedMessage);
        toast.error(normalizedMessage);
        ++scanRunRef.current;
        clearTimers();
        detachCamera('idle');
      } finally {
        captureInProgressRef.current = false;
      }
    };

    void captureOnce();
    captureIntervalRef.current = window.setInterval(() => {
      if (activeFramesRef.current.length >= profile.frameCount) return;
      void captureOnce();
    }, profile.intervalMs);

    countdownIntervalRef.current = window.setInterval(() => {
      const nextSeconds = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      setCountdownSeconds(nextSeconds);
      if (nextSeconds === 0) finalizeCapture();
    }, 250);
  }, [
    captureFrame,
    clearTimers,
    detachCamera,
    ensurePreviewReady,
    loadModelStatus,
    modelStatus,
    modelStatusError,
    modelStatusLoading,
    startCamera,
    uploadFrames,
  ]);

  useEffect(() => {
    if (user && user.role !== 'employee') navigate(getDashboardPathByRole(user.role), { replace: true });
  }, [navigate, user]);

  useEffect(() => {
    if (!allowed) return;
    void loadModelStatus();
    void loadAnalyticsData();
    void loadDepressionLog();
    void loadConsultationData();
  }, [allowed, loadModelStatus, loadAnalyticsData, loadDepressionLog, loadConsultationData]);

  useEffect(() => {
    if (activeSectionId === 'facial-scan') return;
    if (mediaStreamRef.current || isScanBusy) stopScan(false);
  }, [activeSectionId, isScanBusy, stopScan]);

  useEffect(() => {
    if (activeSectionId === 'analytics' && sessionHistory.length === 0 && !sessionHistoryLoading) {
      void loadAnalyticsData();
    }
  }, [activeSectionId, sessionHistory.length, sessionHistoryLoading, loadAnalyticsData]);

  useEffect(() => {
    if (activeSectionId === 'community' && !communityLoading && communityThreads.length === 0 && !communityError) {
      void loadCommunityThreads(1);
    }
  }, [activeSectionId, communityLoading, communityThreads.length, communityError, loadCommunityThreads]);

  useEffect(() => {
    if (
      activeSectionId === 'depression-log' &&
      !depressionLogLoading &&
      depressionLog.length === 0 &&
      !depressionLogError
    ) {
      void loadDepressionLog();
    }
  }, [activeSectionId, depressionLog.length, depressionLogError, depressionLogLoading, loadDepressionLog]);

  useEffect(() => {
    return () => {
      ++scanRunRef.current;
      clearTimers();
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      }
    };
  }, [clearTimers]);

  if (!user) return <Navigate to="/sign-in" replace />;
  if (!allowed) return <Navigate to={getDashboardPathByRole(user.role)} replace />;

  // ---------- helpers ----------

  const tierConfig = (tier: string | null | undefined) =>
    TIER_CONFIG[tier ?? 'low'] ?? TIER_CONFIG.low;

  const renderStreakBadges = (streak: StreakInfo) => {
    if (streak.badges_earned.length === 0) return null;
    return (
      <div className="mw-streak-badges">
        {streak.badges_earned.map((badge) => {
          const cfg = BADGE_CONFIG[badge];
          if (!cfg) return null;
          return (
            <div key={badge} className="mw-streak-badge" title={cfg.description}>
              <span className="mw-streak-badge-emoji">{cfg.emoji}</span>
              <div>
                <p className="mw-streak-badge-label">{cfg.label}</p>
                <p className="mw-streak-badge-desc">{cfg.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ---------- section renderers ----------

  const renderOverview = () => {
    const completedSessions = sessionHistory.filter((s) => s.status === 'completed');
    const latestSession = completedSessions[0] ?? null;
    const latestSessionAt = latestSession?.completed_at ?? latestSession?.created_at ?? null;
    const daysSinceLastCheckIn = daysSinceIsoDate(latestSessionAt);

    return (
      <section className="mw-entity-layout">
        {/* Streak badges */}
        {streakInfo && streakInfo.badges_earned.length > 0 && (
          <div className="mw-card" style={{ padding: '16px 20px' }}>
            <p className="mw-entity-kicker">Wellness Achievement</p>
            <h3 style={{ marginBottom: '12px' }}>Check-In Streak Badges</h3>
            {renderStreakBadges(streakInfo)}
          </div>
        )}

        <section className="mw-stat-grid">
          <StatsCard label="Sessions Completed" value={completedSessions.length} />
          <StatsCard label="Days Since Last Check-In" value={daysSinceLastCheckIn ?? 0} />
          <StatsCard label="Current Streak (weeks)" value={streakInfo?.current_streak_weeks ?? 0} />
          <StatsCard label="Longest Streak (weeks)" value={streakInfo?.longest_streak_weeks ?? 0} />
          <StatsCard label="Scan Duration (s)" value={30} />
          <StatsCard label="Model Frame Limit" value={modelStatus?.max_frames_per_request ?? 60} />
        </section>

        <div className="mw-panel-grid">
          <article className="mw-card mw-info-panel">
            <p className="mw-entity-kicker">Employee Workspace</p>
            <h3>30-second facial check-in</h3>
            <p>
              Start a fixed 30-second webcam scan, let MindWell sample secure frames across that window, and receive
              your composite stress score immediately after the adaptive questionnaire.
            </p>
            <div className="mw-info-panel-actions">
              <button type="button" className="mw-btn-primary" onClick={() => setActiveSectionId('facial-scan')}>
                Start Check-In
              </button>
              <button type="button" className="mw-btn-ghost" onClick={() => setActiveSectionId('analytics')}>
                View Analytics
              </button>
              <button type="button" className="mw-btn-ghost" onClick={() => setActiveSectionId('community')}>
                Community Threads
              </button>
              <button type="button" className="mw-btn-ghost" onClick={() => setActiveSectionId('depression-log')}>
                Depression Log
              </button>
            </div>
          </article>

          <article className="mw-card mw-info-panel">
            <p className="mw-entity-kicker">Model Readiness</p>
            <h3>{modelStatus?.ready ? 'Detection model ready' : 'Detection model needs attention'}</h3>
            <p>{modelStatusLoading ? 'Checking readiness now...' : (modelStatus?.message ?? modelStatusError)}</p>
            {modelStatus && (
              <div className="mw-inline-summary">
                <span className={`mw-badge ${modelStatus.ready ? 'mw-badge-success' : 'mw-badge-warning'}`}>
                  {modelStatus.ready ? 'Ready' : 'Not Ready'}
                </span>
                <span className="mw-helper-text">Architecture: {modelStatus.architecture}</span>
              </div>
            )}
          </article>

          {latestSession && (
            <article className="mw-card mw-info-panel">
              <p className="mw-entity-kicker">Most Recent Session</p>
              <h3>Last Check-In</h3>
              <p>{latestSessionAt ? new Date(latestSessionAt).toLocaleDateString() : '-'}</p>
              {daysSinceLastCheckIn !== null && (
                <p className="mw-helper-text">Days since last check-in: {daysSinceLastCheckIn}</p>
              )}
              <div className="mw-inline-summary" style={{ marginTop: '8px' }}>
                <span className={`mw-badge ${tierConfig(latestSession.threshold_tier).badge}`}>
                  {tierConfig(latestSession.threshold_tier).label}
                </span>
                {latestSession.composite_score != null && (
                  <span className="mw-helper-text">Score: {Math.round(latestSession.composite_score)}</span>
                )}
              </div>
            </article>
          )}

          <article className="mw-card mw-info-panel">
            <p className="mw-entity-kicker">Privacy</p>
            <h3>Preview stays local until scan completes</h3>
            <p>
              The camera stays off until you start. MindWell captures a limited set of JPEG frames, sends them to the
              protected employee-only vision endpoint, and stops the camera when the flow finishes.
            </p>
          </article>
        </div>
      </section>
    );
  };

  const handleQuestionnaireComplete = useCallback(
    (summary: CompletionSummary) => {
      setCompletionSummary(summary);
      setCheckInPhase('results');
      void loadAnalyticsData();
      void loadDepressionLog();
      void loadConsultationData();
    },
    [loadAnalyticsData, loadConsultationData, loadDepressionLog],
  );

  const handleQuestionnaireCancel = useCallback(() => {
    setCheckInPhase('scan');
  }, []);

  const handleStartNewCheckIn = useCallback(() => {
    setScanResult(null);
    setScanError(null);
    setScanPhase('idle');
    setCheckInPhase('scan');
    setCompletionSummary(null);
    setActiveSectionId('overview');
  }, []);

  const handleApplyLogFilters = useCallback(() => {
    setExpandedLogSessionId(null);
    void loadDepressionLog();
  }, [loadDepressionLog]);

  const handleClearLogFilters = useCallback(() => {
    setLogDateFrom('');
    setLogDateTo('');
    setExpandedLogSessionId(null);
    void loadDepressionLog('', '');
  }, [loadDepressionLog]);

  const handleExportLogPdf = useCallback(async () => {
    if (logDateFrom && logDateTo && logDateFrom > logDateTo) {
      const message = 'Start date cannot be later than end date.';
      setDepressionLogError(message);
      toast.error(message);
      return;
    }

    setLogExporting(true);
    try {
      const blob = await questionnaireApi.exportLogPdf(logDateFrom || undefined, logDateTo || undefined);
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `mindwell-depression-log-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Depression log PDF downloaded.');
    } catch (error) {
      const message = resolveApiErrorMessage(error, 'Could not export your depression score log PDF right now.');
      setDepressionLogError(message);
      toast.error(message);
    } finally {
      setLogExporting(false);
    }
  }, [logDateFrom, logDateTo]);

  const renderQuestionnaireSection = () => {
    if (!scanResult) return null;
    return (
      <section className="mw-entity-layout">
        <div className="mw-card mw-entity-header">
          <div className="mw-entity-header-row">
            <div>
              <p className="mw-entity-kicker">Step 2 of 2</p>
              <h2 className="mw-entity-title">Adaptive Questionnaire</h2>
              <p className="mw-entity-description">
                Answer 5–10 questions adapted to your responses. This combines with your facial scan to compute your
                Composite Stress Score.
              </p>
            </div>
            <span className="mw-badge mw-badge-info">PHQ-9 Inspired</span>
          </div>
        </div>
        <QuestionnaireFlow
          facialScanResult={scanResult}
          facialScore={computeFacialMoodScore(scanResult)}
          onComplete={handleQuestionnaireComplete}
          onCancel={handleQuestionnaireCancel}
        />
      </section>
    );
  };

  const renderResultsSection = () => {
    if (!completionSummary) return null;

    const tier = completionSummary.thresholdTier;
    const cfg = tierConfig(tier);
    const resources = WELLNESS_RESOURCES[tier] ?? WELLNESS_RESOURCES.low;
    const consultationEnabled = Boolean(consultationConfig?.is_enabled);
    const showConsultationCard = tier === 'high' || tier === 'severe';
    const consultationBadgeClass =
      latestConsultationRequest?.status === 'scheduled'
        ? 'mw-badge-success'
        : latestConsultationRequest?.status === 'pending'
          ? 'mw-badge-warning'
          : 'mw-badge-info';
    const consultationBadgeLabel =
      latestConsultationRequest?.status === 'scheduled'
        ? 'Scheduled'
        : latestConsultationRequest?.status === 'pending'
          ? 'Pending Review'
          : 'No Request Yet';

    const trendDelta = declineDelta;
    const trendLabel =
      trendDelta == null
        ? null
        : trendDelta > 0
          ? `↑ ${trendDelta.toFixed(1)} pts vs last session`
          : trendDelta < 0
            ? `↓ ${Math.abs(trendDelta).toFixed(1)} pts vs last session`
            : 'No change vs last session';

    return (
      <section className="mw-entity-layout">
        {/* Decline alert */}
        {showDeclineAlert && (
          <div className="mw-decline-alert">
            <div className="mw-decline-alert-icon">⚠</div>
            <div>
              <strong>Significant stress increase detected</strong>
              <p>
                Your composite score increased by {declineDelta?.toFixed(1)} points compared to your previous session.
                Please review the wellness resources below and consider reaching out for support.
              </p>
            </div>
          </div>
        )}

        <div className="mw-card mw-entity-header">
          <div className="mw-entity-header-row">
            <div>
              <p className="mw-entity-kicker">Check-In Complete</p>
              <h2 className="mw-entity-title">Session Feedback</h2>
              <p className="mw-entity-description">
                Your check-in has been saved privately. Here is your personal feedback summary.
              </p>
            </div>
            <span className={`mw-badge ${cfg.badge}`}>{cfg.label}</span>
          </div>
        </div>

        <section className="mw-stat-grid">
          <StatsCard label="Facial Mood Score" value={Math.round(completionSummary.facialScore)} />
          <StatsCard label="Questionnaire Score" value={Math.round(completionSummary.questionnaireScore)} />
          <StatsCard label="Composite Score" value={Math.round(completionSummary.compositeScore)} />
        </section>

        <div className="mw-panel-grid">
          {/* Trend delta */}
          <article className="mw-card mw-info-panel">
            <p className="mw-entity-kicker">Score Trend</p>
            <h3>Compared to last session</h3>
            {trendLabel ? (
              <p
                style={{
                  fontSize: '20px',
                  fontWeight: 700,
                  color: trendDelta != null && trendDelta > 0 ? 'var(--danger)' : 'var(--green-500)',
                  marginTop: '8px',
                }}
              >
                {trendLabel}
              </p>
            ) : (
              <p style={{ marginTop: '8px', color: 'var(--text-muted)' }}>This is your first session — no comparison available yet.</p>
            )}
            <div className="mw-info-panel-actions">
              <button type="button" className="mw-btn-ghost" onClick={() => setActiveSectionId('analytics')}>
                View All Sessions
              </button>
            </div>
          </article>

          {/* Wellness resources */}
          <article className="mw-card mw-info-panel">
            <p className="mw-entity-kicker">Breathing Exercise · {cfg.label}</p>
            <h3>Recommended Technique</h3>
            <p>{resources.breathing}</p>
          </article>

          <article className="mw-card mw-info-panel">
            <p className="mw-entity-kicker">CBT Technique · {cfg.label}</p>
            <h3>Cognitive Exercise</h3>
            <p>{resources.cbt}</p>
          </article>

          {resources.hotlines.length > 0 && (
            <article className="mw-card mw-info-panel" style={{ borderLeft: '4px solid var(--danger)' }}>
              <p className="mw-entity-kicker">Support Lines</p>
              <h3>Crisis & Support Resources</h3>
              <ul style={{ marginTop: '8px', paddingLeft: '16px', lineHeight: '1.8' }}>
                {resources.hotlines.map((line) => (
                  <li key={line} style={{ color: 'var(--text)' }}>{line}</li>
                ))}
              </ul>
            </article>
          )}

          {showConsultationCard && (
            <article className="mw-card mw-info-panel">
              <p className="mw-entity-kicker">Counselor Consultation</p>
              <h3>Request a private session</h3>
              <p>
                {consultationEnabled
                  ? 'Because your latest tier is High/Severe, you can request a confidential counselor session.'
                  : consultationLoading
                    ? 'Checking whether your company has enabled a consultation team...'
                    : 'Your company has not enabled counselor consultation yet. You can still use support resources above.'}
              </p>

              <div className="mw-inline-summary" style={{ marginTop: '10px' }}>
                <span className={`mw-badge ${consultationBadgeClass}`}>{consultationBadgeLabel}</span>
                {latestConsultationRequest?.scheduled_for ? (
                  <span className="mw-helper-text">
                    Scheduled: {formatDateTime(latestConsultationRequest.scheduled_for)}
                  </span>
                ) : null}
              </div>

              {consultationEnabled && (
                <div className="mw-community-thread-editor" style={{ marginTop: '12px' }}>
                  <label className="mw-field">
                    <span className="mw-field-label">Private note for counselor (optional)</span>
                    <textarea
                      className="mw-input mw-textarea"
                      value={consultationNote}
                      onChange={(event) => setConsultationNote(event.target.value)}
                      placeholder="Share context you want the counselor to know before scheduling."
                      maxLength={500}
                    />
                  </label>
                  <div className="mw-info-panel-actions">
                    <button
                      type="button"
                      className="mw-btn-primary"
                      onClick={() => {
                        void handleCreateConsultationRequest();
                      }}
                      disabled={consultationSubmitting || consultationLoading}
                    >
                      {consultationSubmitting ? 'Submitting...' : 'Request Session'}
                    </button>
                    <button
                      type="button"
                      className="mw-btn-ghost"
                      onClick={() => {
                        void loadConsultationData();
                      }}
                      disabled={consultationLoading || consultationSubmitting}
                    >
                      {consultationLoading ? 'Refreshing...' : 'Refresh Status'}
                    </button>
                  </div>
                </div>
              )}

              {consultationError ? (
                <p className="mw-helper-text" style={{ marginTop: '10px', color: '#b91c1c' }}>
                  {consultationError}
                </p>
              ) : null}
            </article>
          )}
        </div>

        <div className="mw-card mw-info-panel">
          <p className="mw-entity-kicker">What&apos;s Next</p>
          <h3>Your session is saved</h3>
          <p>
            This session has been stored privately in your check-in log. You can view your score trend and symptom
            history in Analytics.
          </p>
          <div className="mw-info-panel-actions">
            <button type="button" className="mw-btn-primary" onClick={handleStartNewCheckIn}>
              Back to Dashboard
            </button>
            <button type="button" className="mw-btn-ghost" onClick={() => setActiveSectionId('analytics')}>
              Open Analytics
            </button>
            <button type="button" className="mw-btn-ghost" onClick={() => setActiveSectionId('depression-log')}>
              Open Log
            </button>
            <button type="button" className="mw-btn-ghost" onClick={() => setActiveSectionId('community')}>
              Open Community Board
            </button>
          </div>
        </div>
      </section>
    );
  };

  const renderScanSection = () => {
    const progressPercent =
      selectedProfile.frameCount > 0 ? Math.min(100, (capturedFrameCount / selectedProfile.frameCount) * 100) : 0;
    const readinessTone = modelStatus?.ready ? 'mw-badge-success' : 'mw-badge-warning';
    const readinessLabel = modelStatus?.ready ? 'Model Ready' : 'Model Not Ready';

    return (
      <section className="mw-entity-layout">
        <div className="mw-card mw-entity-header">
          <div className="mw-entity-header-row">
            <div>
              <p className="mw-entity-kicker">Employee Scan</p>
              <h2 className="mw-entity-title">Facial Scan</h2>
              <p className="mw-entity-description">
                MindWell checks model readiness first, then opens your webcam only while the fixed 30-second scan is active.
              </p>
            </div>
            <span className={`mw-badge ${readinessTone}`}>{readinessLabel}</span>
          </div>
        </div>

        <div className="mw-scan-grid">
          <article className="mw-card mw-scan-preview-card">
            <div className="mw-scan-card-header">
              <div>
                <p className="mw-entity-kicker">Webcam Preview</p>
                <h3>Start Facial Scan</h3>
              </div>
              <span className={`mw-badge ${cameraState === 'ready' ? 'mw-badge-success' : 'mw-badge-muted'}`}>
                {cameraState === 'ready' ? 'Camera Ready' : toTitleCase(cameraState)}
              </span>
            </div>

            <div className="mw-scan-video-shell">
              {cameraState === 'ready' || isScanBusy ? (
                <>
                  <video ref={videoRef} className="mw-scan-video" muted playsInline autoPlay />
                  <div className="mw-scan-video-overlay">
                    <span className={`mw-scan-live-pill ${scanPhase === 'capturing' ? 'active' : ''}`}>
                      {scanPhase === 'capturing' ? 'Scanning live' : 'Preview active'}
                    </span>
                    {scanPhase === 'capturing' && liveEmotion && (
                      <div className="mw-live-emotion-overlay">
                        <span className="mw-live-emotion-label">{toTitleCase(liveEmotion.dominant_label)}</span>
                        <div className="mw-live-emotion-meter-track">
                          <div
                            className="mw-live-emotion-meter-fill"
                            style={{ width: `${Math.round(liveEmotion.dominant_confidence * 100)}%` }}
                          />
                        </div>
                        <span className="mw-live-emotion-confidence">{toPercent(liveEmotion.dominant_confidence)}</span>
                      </div>
                    )}
                    <div className="mw-scan-video-meta">
                      <strong>30-second guided scan</strong>
                      <span>{capturedFrameCount} frames captured</span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="mw-scan-empty-preview">
                  <span className="mw-scan-camera-mark">Cam</span>
                  <h4>Camera opens only when you choose to scan</h4>
                  <p>{cameraMessage}</p>
                </div>
              )}
            </div>

            <canvas ref={canvasRef} className="mw-hidden" />

            <div className="mw-scan-progress-block">
              <div className="mw-scan-progress-copy">
                <strong>
                  {isScanBusy
                    ? scanPhase === 'uploading'
                      ? 'Uploading captured frames'
                      : `Capturing frame ${Math.min(capturedFrameCount + 1, selectedProfile.frameCount)} of ${selectedProfile.frameCount}`
                    : 'Ready when you are'}
                </strong>
                <span>
                  {scanPhase === 'capturing'
                    ? `${countdownSeconds}s remaining`
                    : scanPhase === 'uploading'
                      ? 'Sending frames to the protected CNN endpoint and waiting for the model result'
                      : selectedProfile.description}
                </span>
              </div>
              <div className="mw-scan-progress-track" role="presentation">
                <div className="mw-scan-progress-fill" style={{ width: `${progressPercent}%` }} />
              </div>
            </div>

            <div className="mw-scan-action-row">
              <button
                type="button"
                className="mw-btn-primary mw-scan-start-button"
                onClick={() => { void startScan(); }}
                disabled={startScanDisabled}
              >
                {isScanBusy
                  ? 'Scan In Progress'
                  : modelStatusLoading
                    ? 'Checking Readiness'
                    : modelStatus?.ready
                      ? 'Start Facial Scan'
                      : 'Model Not Ready'}
              </button>
              <button
                type="button"
                className="mw-btn-ghost"
                onClick={() => stopScan()}
                disabled={!isScanBusy && cameraState !== 'ready'}
              >
                Stop Scan
              </button>
              <button
                type="button"
                className="mw-btn-ghost"
                onClick={() => { void loadModelStatus(); }}
                disabled={modelStatusLoading || isScanBusy}
              >
                Recheck Model
              </button>
            </div>
          </article>

          <article className="mw-card mw-scan-result-card">
            <div className="mw-scan-card-header">
              <div>
                <p className="mw-entity-kicker">Returned Score</p>
                <h3>Facial score summary</h3>
              </div>
              {scanResult && <span className="mw-badge mw-badge-info">{scanResult.frame_count} frames analyzed</span>}
            </div>

            {modelStatusLoading ? (
              <div className="mw-scan-message-card">
                <h4>Checking readiness</h4>
                <p>MindWell is confirming that the backend CNN is available before you begin.</p>
              </div>
            ) : modelStatusError ? (
              <div className="mw-scan-message-card danger">
                <h4>Readiness check failed</h4>
                <p>{modelStatusError}</p>
              </div>
            ) : modelStatus && !modelStatus.ready ? (
              <div className="mw-scan-message-card warning">
                <h4>Model not ready</h4>
                <p>{modelStatus.message}</p>
                <div className="mw-scan-meta-list">
                  <span>Architecture assumption: {modelStatus.architecture}</span>
                  <span>Weights path: {modelStatus.weights_path}</span>
                </div>
              </div>
            ) : scanError ? (
              <div className="mw-scan-message-card danger">
                <h4>Scan could not be completed</h4>
                <p>{scanError}</p>
              </div>
            ) : scanResult ? (
              <>
                <div className="mw-score-hero">
                  <div className="mw-score-emphasis">
                    <span className="mw-score-caption">Dominant mood</span>
                    <h4>{toTitleCase(scanResult.dominant_label)}</h4>
                    <p>{toPercent(scanResult.dominant_confidence)} confidence from the averaged scan result.</p>
                  </div>
                  <div className="mw-score-orb">
                    <strong>{toPercent(scanResult.dominant_confidence)}</strong>
                    <span>Composite facial score</span>
                  </div>
                </div>

                <div className="mw-score-stack">
                  {scanResult.averaged_scores.map((score) => (
                    <div key={score.label} className="mw-score-row">
                      <div className="mw-score-label-row">
                        <span>{toTitleCase(score.label)}</span>
                        <strong>{toPercent(score.confidence)}</strong>
                      </div>
                      <div className="mw-score-track" role="presentation">
                        <div className="mw-score-fill" style={{ width: `${score.confidence * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mw-scan-meta-list">
                  <span>Model: {scanResult.model_name}</span>
                  <span>Frames analyzed: {scanResult.frame_count}</span>
                  <span>Architecture assumption: {modelStatus?.architecture ?? 'Unknown'}</span>
                </div>

                <div className="mw-info-panel-actions">
                  <button
                    type="button"
                    className="mw-btn-primary"
                    onClick={() => { setCheckInPhase('questionnaire'); }}
                  >
                    Continue to Questionnaire
                  </button>
                  <button
                    type="button"
                    className="mw-btn-ghost"
                    onClick={() => { void startScan(); }}
                  >
                    Retry Scan
                  </button>
                </div>
              </>
            ) : (
              <div className="mw-scan-message-card">
                <h4>Result card ready</h4>
                <p>
                  Once a scan completes, MindWell will show the dominant mood label, confidence score, and the top
                  averaged probabilities returned by the protected backend endpoint.
                </p>
              </div>
            )}
          </article>
        </div>
      </section>
    );
  };

  const renderAnalyticsSection = () => {
    const completedSessions = sessionHistory
      .filter((s) => s.status === 'completed' && s.composite_score != null)
      .slice()
      .reverse();

    const chartData = completedSessions.map((s, i) => ({
      index: i + 1,
      date: s.created_at ? new Date(s.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : `#${i + 1}`,
      composite: Math.round(s.composite_score ?? 0),
      tier: s.threshold_tier ?? 'low',
    }));

    // Bar chart: gradient fill from most → least triggered
    const barColors = ['#dc2626', '#ef6c00', '#d97706', '#3a8f55', '#2d7a47', '#256040', '#1d4d34', '#163b27'];

    // Calendar heatmap — last 16 weeks
    const heatmapMap = new Map<string, string>();
    for (const s of sessionHistory.filter((s) => s.status === 'completed' && s.created_at)) {
      const key = new Date(s.created_at!).toISOString().slice(0, 10);
      heatmapMap.set(key, s.threshold_tier ?? 'low');
    }

    const tierColor = (tier: string) => TIER_CONFIG[tier]?.color ?? '#ccc';

    const dayMs = 86_400_000;
    const today = new Date();
    const startDow = today.getDay();
    const alignedEnd = new Date(today.getTime() + ((7 - startDow) % 7) * dayMs); // next Sunday
    const alignedStart = new Date(alignedEnd.getTime() - 16 * 7 * dayMs);

    const weeks: Array<{ monthLabel: string | null; days: Array<{ date: string; tier: string | null }> }> = [];
    for (let w = 0; w < 16; w++) {
      const days: Array<{ date: string; tier: string | null }> = [];
      let monthLabel: string | null = null;
      for (let d = 0; d < 7; d++) {
        const day = new Date(alignedStart.getTime() + (w * 7 + d) * dayMs);
        const key = day.toISOString().slice(0, 10);
        if (d === 0) {
          monthLabel = day.toLocaleDateString('en-GB', { month: 'short' });
        }
        days.push({ date: key, tier: heatmapMap.get(key) ?? null });
      }
      weeks.push({ monthLabel, days });
    }

    return (
      <section className="mw-entity-layout">
        <div className="mw-card mw-entity-header">
          <div className="mw-entity-header-row">
            <div>
              <p className="mw-entity-kicker">Personal Analytics</p>
              <h2 className="mw-entity-title">Your Wellness Trends</h2>
              <p className="mw-entity-description">
                All data is private to your account. Charts update after every completed check-in session.
              </p>
            </div>
            <button
              type="button"
              className="mw-btn-ghost"
              onClick={() => { void loadAnalyticsData(); }}
              disabled={sessionHistoryLoading}
            >
              {sessionHistoryLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>

        {sessionHistoryLoading && <div className="mw-card mw-loading-card">Loading analytics…</div>}

        {!sessionHistoryLoading && completedSessions.length === 0 && (
          <div className="mw-card mw-empty-state">
            <h3>No sessions yet</h3>
            <p>Complete your first check-in to see your trends here.</p>
            <button
              type="button"
              className="mw-btn-primary"
              style={{ marginTop: '16px' }}
              onClick={() => setActiveSectionId('facial-scan')}
            >
              Start Check-In
            </button>
          </div>
        )}

        {!sessionHistoryLoading && completedSessions.length > 0 && (
          <>
            {/* Summary stats row */}
            <section className="mw-stat-grid">
              <StatsCard label="Sessions Completed" value={completedSessions.length} />
              <StatsCard label="Current Streak (wks)" value={streakInfo?.current_streak_weeks ?? 0} />
              <StatsCard label="Longest Streak (wks)" value={streakInfo?.longest_streak_weeks ?? 0} />
              <StatsCard
                label="Latest Score"
                value={completedSessions[completedSessions.length - 1]?.composite_score != null ? Math.round(completedSessions[completedSessions.length - 1].composite_score!) : 0}
              />
              <StatsCard label="Badges Earned" value={streakInfo?.badges_earned.length ?? 0} />
            </section>

            {/* Line chart — full width */}
            <article className="mw-card">
              <p className="mw-entity-kicker">Score History</p>
              <h3>Composite Score Over Time</h3>
              <p className="mw-entity-description" style={{ marginBottom: '16px' }}>
                Lower = less stress. Each point is one completed check-in session.
              </p>
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 20, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,43,60,0.07)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={36} tickFormatter={(v) => `${v}`} />
                    <Tooltip
                      formatter={(value: number) => [`${value}`, 'Composite Score']}
                      contentStyle={{ fontSize: 13, borderRadius: 10, border: '1px solid rgba(26,43,60,0.1)' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="composite"
                      stroke="#3a8f55"
                      strokeWidth={2.5}
                      dot={(props) => {
                        const { cx, cy, payload } = props as { cx: number; cy: number; payload: { tier: string } };
                        return (
                          <circle
                            key={`dot-${cx}-${cy}`}
                            cx={cx}
                            cy={cy}
                            r={5}
                            fill={tierColor(payload.tier)}
                            stroke="#fff"
                            strokeWidth={2}
                          />
                        );
                      }}
                      activeDot={{ r: 7, stroke: '#fff', strokeWidth: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mw-heatmap-legend" style={{ marginTop: '10px' }}>
                {Object.entries(TIER_CONFIG).map(([key, cfg]) => (
                  <span key={key} className="mw-heatmap-legend-item">
                    <span className="mw-heatmap-legend-dot" style={{ backgroundColor: cfg.color }} />
                    {cfg.label}
                  </span>
                ))}
              </div>
            </article>

            {/* Two-column: heatmap + bar chart */}
            <div className="mw-analytics-grid">
              {/* Calendar heatmap */}
              <article className="mw-card">
                <p className="mw-entity-kicker">Check-In Calendar</p>
                <h3>16-Week Heatmap</h3>
                <p className="mw-entity-description" style={{ marginBottom: '14px' }}>
                  Each cell is one day. Color shows the stress tier of that session.
                </p>
                <div className="mw-heatmap">
                  <div className="mw-heatmap-months">
                    {weeks.map((week, wi) => (
                      <div key={wi} className="mw-heatmap-month-label">
                        {week.monthLabel !== weeks[wi - 1]?.monthLabel ? week.monthLabel : ''}
                      </div>
                    ))}
                  </div>
                  <div className="mw-heatmap-grid">
                    {weeks.map((week, wi) => (
                      <div key={wi} className="mw-heatmap-week">
                        {week.days.map((day) => (
                          <div
                            key={day.date}
                            className="mw-heatmap-cell"
                            title={day.tier ? `${day.date} — ${tierConfig(day.tier).label}` : day.date}
                            style={{ backgroundColor: day.tier ? tierColor(day.tier) : 'rgba(26,43,60,0.08)' }}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="mw-heatmap-legend" style={{ marginTop: '10px' }}>
                    <span className="mw-heatmap-legend-item">
                      <span className="mw-heatmap-legend-dot" style={{ backgroundColor: 'rgba(26,43,60,0.08)' }} />
                      No check-in
                    </span>
                    {Object.entries(TIER_CONFIG).map(([key, cfg]) => (
                      <span key={key} className="mw-heatmap-legend-item">
                        <span className="mw-heatmap-legend-dot" style={{ backgroundColor: cfg.color }} />
                        {cfg.label}
                      </span>
                    ))}
                  </div>
                </div>
              </article>

              {/* Symptom bar chart */}
              <article className="mw-card">
                <p className="mw-entity-kicker">Questionnaire Insights</p>
                <h3>Top Symptom Domains</h3>
                <p className="mw-entity-description" style={{ marginBottom: '16px' }}>
                  Domains triggered most often across all sessions.
                </p>
                {symptomData.length === 0 ? (
                  <div className="mw-scan-message-card">
                    <h4>No data yet</h4>
                    <p>Complete at least one questionnaire to see your symptom breakdown.</p>
                  </div>
                ) : (
                  <div style={{ height: 240 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={symptomData} margin={{ top: 8, right: 8, left: 0, bottom: 44 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,43,60,0.07)" />
                        <XAxis
                          dataKey="domain"
                          tick={{ fontSize: 11 }}
                          angle={-35}
                          textAnchor="end"
                          interval={0}
                        />
                        <YAxis tick={{ fontSize: 11 }} width={28} allowDecimals={false} />
                        <Tooltip
                          formatter={(value: number) => [value, 'Times triggered']}
                          contentStyle={{ fontSize: 13, borderRadius: 10, border: '1px solid rgba(26,43,60,0.1)' }}
                        />
                        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                          {symptomData.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={barColors[index] ?? '#3a8f55'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </article>
            </div>

            {/* Streak badges */}
            {streakInfo && streakInfo.badges_earned.length > 0 && (
              <article className="mw-card mw-info-panel">
                <p className="mw-entity-kicker">Wellness Achievement</p>
                <h3>Earned Badges</h3>
                <div style={{ marginTop: '12px' }}>
                  {renderStreakBadges(streakInfo)}
                </div>
              </article>
            )}
            {streakInfo && streakInfo.badges_earned.length === 0 && (
              <article className="mw-card mw-info-panel">
                <p className="mw-entity-kicker">Consistency Goal</p>
                <h3>Earn Your First Badge</h3>
                <p>Check in every week for 4 consecutive weeks to earn your Bronze Streak badge.</p>
                <div className="mw-streak-badges" style={{ marginTop: '12px', opacity: 0.35 }}>
                  {Object.values(BADGE_CONFIG).map((cfg) => (
                    <div key={cfg.label} className="mw-streak-badge">
                      <span className="mw-streak-badge-emoji">{cfg.emoji}</span>
                      <div>
                        <p className="mw-streak-badge-label">{cfg.label}</p>
                        <p className="mw-streak-badge-desc">{cfg.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            )}
          </>
        )}
      </section>
    );
  };

  const renderDepressionLogSection = () => (
    <section className="mw-entity-layout">
      <div className="mw-card mw-entity-header">
        <div className="mw-entity-header-row">
          <div>
            <p className="mw-entity-kicker">Private Score Log</p>
            <h2 className="mw-entity-title">Depression Score Log</h2>
            <p className="mw-entity-description">
              Every completed session is saved with timestamp, facial score, questionnaire score, composite score,
              threshold tier, and individual questionnaire answers.
            </p>
          </div>
          <button
            type="button"
            className="mw-btn-primary"
            onClick={() => {
              void handleExportLogPdf();
            }}
            disabled={logExporting || depressionLogLoading}
          >
            {logExporting ? 'Exporting...' : 'Export PDF'}
          </button>
        </div>
      </div>

      <article className="mw-card">
        <div className="mw-entity-controls">
          <label className="mw-field mw-filter-item">
            <span className="mw-field-label">Date From</span>
            <input
              type="date"
              className="mw-input"
              value={logDateFrom}
              max={logDateTo || undefined}
              onChange={(event) => setLogDateFrom(event.target.value)}
            />
          </label>
          <label className="mw-field mw-filter-item">
            <span className="mw-field-label">Date To</span>
            <input
              type="date"
              className="mw-input"
              value={logDateTo}
              min={logDateFrom || undefined}
              onChange={(event) => setLogDateTo(event.target.value)}
            />
          </label>
          <div className="mw-entity-control-actions">
            <button type="button" className="mw-btn-primary" onClick={handleApplyLogFilters} disabled={depressionLogLoading}>
              {depressionLogLoading ? 'Loading...' : 'Apply'}
            </button>
            <button type="button" className="mw-btn-ghost" onClick={handleClearLogFilters} disabled={depressionLogLoading}>
              Clear
            </button>
          </div>
        </div>

        {depressionLogError ? (
          <div className="mw-scan-message-card danger" style={{ marginTop: '12px' }}>
            <h4>Log unavailable</h4>
            <p>{depressionLogError}</p>
          </div>
        ) : null}

        {depressionLogLoading ? (
          <div className="mw-loading-card" style={{ marginTop: '12px' }}>Loading score log...</div>
        ) : null}

        {!depressionLogLoading && !depressionLogError && depressionLog.length === 0 ? (
          <div className="mw-empty-state" style={{ marginTop: '14px' }}>
            <h3>No completed sessions</h3>
            <p>Complete a facial scan and questionnaire check-in to create your first timestamped score log entry.</p>
          </div>
        ) : null}

        {!depressionLogLoading && !depressionLogError && depressionLog.length > 0 ? (
          <>
            <div className="mw-data-table-shell" style={{ marginTop: '12px' }}>
              <div className="mw-data-table-scroll">
                <table className="mw-data-table">
                  <thead>
                    <tr>
                      <th>S/N</th>
                      <th>Date &amp; Time</th>
                      <th>Facial</th>
                      <th>Questionnaire</th>
                      <th>Composite</th>
                      <th>Tier</th>
                      <th>Weights</th>
                      <th>Answers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {depressionLog.map((entry, index) => {
                      const tier = tierConfig(entry.threshold_tier);
                      const isExpanded = expandedLogSessionId === entry.session_id;
                      return (
                        <Fragment key={entry.session_id}>
                          <tr className="mw-data-row">
                            <td>{index + 1}</td>
                            <td>{formatDateTime(entry.session_datetime)}</td>
                            <td>{formatScore(entry.facial_score)}</td>
                            <td>{formatScore(entry.questionnaire_score)}</td>
                            <td>{formatScore(entry.composite_score)}</td>
                            <td>
                              <span className={`mw-badge ${tier.badge}`}>{tier.label}</span>
                            </td>
                            <td>
                              {Math.round((entry.score_weight_facial ?? 0.5) * 100)}% /
                              {Math.round((entry.score_weight_questionnaire ?? 0.5) * 100)}%
                            </td>
                            <td>
                              <button
                                type="button"
                                className="mw-btn-chip"
                                onClick={() =>
                                  setExpandedLogSessionId((current) => (current === entry.session_id ? null : entry.session_id))
                                }
                              >
                                {isExpanded ? 'Hide Answers' : `View Answers (${entry.questions_and_answers.length})`}
                              </button>
                            </td>
                          </tr>
                          {isExpanded ? (
                            <tr className="mw-data-row">
                              <td colSpan={8}>
                                {entry.questions_and_answers.length === 0 ? (
                                  <p className="mw-helper-text">No questionnaire answers were stored for this session.</p>
                                ) : (
                                  <div className="mw-log-answer-list">
                                    {entry.questions_and_answers.map((answer) => (
                                      <div key={`${entry.session_id}-${answer.sequence_order}`} className="mw-log-answer-item">
                                        <p className="mw-log-answer-meta">
                                          Q{answer.sequence_order} | {answer.domain}
                                        </p>
                                        <p className="mw-log-answer-text">{answer.question_text}</p>
                                        <p className="mw-log-answer-value">
                                          {answer.answer_label} (Score {answer.score})
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="mw-helper-text" style={{ marginTop: '10px' }}>
              Total entries: {depressionLog.length}
            </p>
          </>
        ) : null}
      </article>
    </section>
  );

  const renderCommunitySection = () => (
    <section className="mw-entity-layout">
      <div className="mw-card mw-entity-header">
        <div className="mw-entity-header-row">
          <div>
            <p className="mw-entity-kicker">Anonymous Peer Support</p>
            <h2 className="mw-entity-title">Community Board</h2>
            <p className="mw-entity-description">
              Share short anonymous posts with your company peers, react with supportive responses, and keep
              conversation content encrypted at rest.
            </p>
          </div>
          <button
            type="button"
            className="mw-btn-ghost"
            onClick={() => {
              void loadCommunityThreads(communityPage, communityShowAll);
            }}
            disabled={communityLoading}
          >
            {communityLoading ? 'Refreshing...' : 'Refresh Threads'}
          </button>
          <button
            type="button"
            className="mw-btn-ghost"
            onClick={() => {
              const nextShowAll = !communityShowAll;
              setCommunityShowAll(nextShowAll);
              void loadCommunityThreads(1, nextShowAll);
            }}
            disabled={communityLoading}
          >
            {communityShowAll ? 'Paginated View' : 'See All Threads'}
          </button>
        </div>
      </div>

      <article className="mw-card mw-community-thread-editor">
        <label className="mw-field">
          <span className="mw-field-label">Create anonymous post</span>
          <textarea
            className="mw-input mw-textarea"
            value={newThreadContent}
            onChange={(event) => setNewThreadContent(event.target.value)}
            placeholder="Share how you feel. Only your random colleague alias is shown."
            maxLength={600}
          />
        </label>
        <div className="mw-info-panel-actions">
          <button
            type="button"
            className="mw-btn-primary"
            onClick={() => {
              void handleCreateThread();
            }}
            disabled={createThreadPending}
          >
            {createThreadPending ? 'Posting...' : 'Post Anonymously'}
          </button>
          <span className="mw-helper-text">{newThreadContent.trim().length}/600</span>
        </div>
      </article>

      {communityError ? (
        <div className="mw-scan-message-card danger">
          <h4>Community feed unavailable</h4>
          <p>{communityError}</p>
        </div>
      ) : null}

      {communityLoading ? <div className="mw-loading-card mw-card">Loading community threads...</div> : null}

      {!communityLoading && !communityError && communityThreads.length === 0 ? (
        <div className="mw-empty-state mw-card">
          <h3>No posts yet</h3>
          <p>Be the first colleague to share an anonymous support message.</p>
        </div>
      ) : null}

      {!communityLoading &&
        communityThreads.map((thread) => (
          <article key={thread.id} className="mw-card mw-community-thread-card">
            <div className="mw-community-thread-head">
              <div>
                <span className="mw-badge mw-badge-muted">{thread.alias}</span>
                <p className="mw-helper-text" style={{ marginTop: '6px' }}>
                  Posted {formatDateTime(thread.created_at)}
                </p>
              </div>
              <div className="mw-inline-summary">
                <span className="mw-badge mw-badge-info">{thread.reply_count} replies</span>
                {thread.can_delete ? (
                  <button
                    type="button"
                    className="mw-btn-chip mw-chip-danger"
                    onClick={() => {
                      void handleDeleteThread(thread.id);
                    }}
                    disabled={deletingThreadId === thread.id}
                  >
                    {deletingThreadId === thread.id ? 'Deleting...' : 'Delete'}
                  </button>
                ) : null}
              </div>
            </div>

            <p className="mw-community-thread-content">{thread.content}</p>

            <div className="mw-community-reaction-row">
              {PEER_REACTION_OPTIONS.map((reactionOption) => {
                const reactionCount =
                  thread.reactions.find((reaction) => reaction.reaction_type === reactionOption.type)?.count ?? 0;
                const active = thread.my_reaction === reactionOption.type;
                return (
                  <button
                    key={`${thread.id}-${reactionOption.type}`}
                    type="button"
                    className={`mw-btn-chip ${active ? 'mw-chip-success' : ''}`}
                    onClick={() => {
                      void handleToggleReaction(thread.id, reactionOption.type);
                    }}
                    disabled={reactionPendingThreadId === thread.id}
                  >
                    {reactionOption.label} ({reactionCount})
                  </button>
                );
              })}
            </div>

            <div className="mw-community-replies">
              {thread.replies.length === 0 ? (
                <p className="mw-helper-text">No replies yet. Share a supportive response.</p>
              ) : (
                thread.replies.map((reply) => (
                  <div key={reply.id} className="mw-community-reply-item">
                    <div className="mw-community-reply-head">
                      <span className="mw-badge mw-badge-muted">{reply.alias}</span>
                      <span className="mw-helper-text">{formatDateTime(reply.created_at)}</span>
                    </div>
                    <p>{reply.content}</p>
                  </div>
                ))
              )}
            </div>

            <div className="mw-community-reply-form">
              <textarea
                className="mw-input"
                value={replyDrafts[thread.id] ?? ''}
                onChange={(event) =>
                  setReplyDrafts((current) => ({ ...current, [thread.id]: event.target.value }))
                }
                placeholder="Write an anonymous supportive reply..."
                maxLength={400}
              />
              <button
                type="button"
                className="mw-btn-ghost"
                onClick={() => {
                  void handleReplyToThread(thread.id);
                }}
                disabled={replySubmittingThreadId === thread.id}
              >
                {replySubmittingThreadId === thread.id ? 'Replying...' : 'Reply'}
              </button>
            </div>
          </article>
        ))}

      {!communityShowAll && communityTotalPages > 1 ? (
        <div className="mw-entity-pagination">
          <span className="mw-pagination-meta">
            Page {communityPage} of {communityTotalPages}
          </span>
          <div className="mw-pagination-actions">
            <button
              type="button"
              className="mw-btn-ghost"
              onClick={() => {
                void loadCommunityThreads(Math.max(1, communityPage - 1));
              }}
              disabled={communityPage <= 1 || communityLoading}
            >
              Previous
            </button>
            <button
              type="button"
              className="mw-btn-ghost"
              onClick={() => {
                void loadCommunityThreads(Math.min(communityTotalPages, communityPage + 1));
              }}
              disabled={communityPage >= communityTotalPages || communityLoading}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      <div className="mw-panel-grid">
        <article className="mw-card mw-info-panel">
          <p className="mw-entity-kicker">Moderation</p>
          <h3>Safety-first support board</h3>
          <p>
            Harmful and crisis-level text is automatically filtered. Approved content remains anonymous and scoped to
            your company only.
          </p>
        </article>

        <article className="mw-card mw-info-panel">
          <p className="mw-entity-kicker">Consultation Team</p>
          <h3>Private counselor queue</h3>
          <p>
            {consultationConfig?.is_enabled
              ? `Consultation is enabled${consultationConfig.provider_name ? ` by ${consultationConfig.provider_name}` : ''}.`
              : 'Consultation is currently disabled for your company.'}
          </p>
          <div className="mw-inline-summary">
            <span className={`mw-badge ${consultationConfig?.is_enabled ? 'mw-badge-success' : 'mw-badge-warning'}`}>
              {consultationConfig?.is_enabled ? 'Enabled' : 'Disabled'}
            </span>
            <span className="mw-helper-text">
              {consultationRequests.length} request{consultationRequests.length === 1 ? '' : 's'} in your history
            </span>
          </div>
          {consultationRequests.length > 0 ? (
            <ul className="mw-simple-list" style={{ marginTop: '12px' }}>
              {consultationRequests.slice(0, 3).map((request) => (
                <li key={request.id}>
                  <div>
                    <strong>{toTitleCase(request.status)}</strong>
                    <span>
                      Requested {formatDateTime(request.created_at)}
                      {request.scheduled_for ? ` • Scheduled ${formatDateTime(request.scheduled_for)}` : ''}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mw-helper-text" style={{ marginTop: '10px' }}>
              No counselor requests yet.
            </p>
          )}
        </article>

        <article className="mw-card mw-info-panel">
          <p className="mw-entity-kicker">Privacy</p>
          <h3>Encrypted records</h3>
          <p>
            Community posts/replies and counselor notes are stored encrypted. Consultation records are private and are
            not visible to department managers or company heads.
          </p>
        </article>
      </div>
    </section>
  );

  const renderSection = () => {
    if (activeSectionId === 'overview') return renderOverview();
    if (activeSectionId === 'analytics') return renderAnalyticsSection();
    if (activeSectionId === 'depression-log') return renderDepressionLogSection();
    if (activeSectionId === 'community') return renderCommunitySection();
    if (activeSectionId === 'facial-scan') {
      if (checkInPhase === 'questionnaire') return renderQuestionnaireSection();
      if (checkInPhase === 'results') return renderResultsSection();
      return renderScanSection();
    }
    return renderOverview();
  };

  return (
    <AppShell
      title="Employee Wellness Dashboard"
      subtitle="Private facial scan check-ins with adaptive questionnaire, trend analytics, and personal wellness feedback."
      roleLabel="Employee"
      user={user}
      sections={[...DASHBOARD_SECTIONS]}
      activeSectionId={activeSectionId}
      onSelectSection={(sectionId) => setActiveSectionId(sectionId as DashboardSectionId)}
      onLogout={() => {
        void (async () => {
          await signOut();
          navigate('/sign-in', { replace: true });
        })();
      }}
    >
      {renderSection()}
    </AppShell>
  );
};
