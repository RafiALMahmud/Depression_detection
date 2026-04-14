import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { visionApi } from '../api/services';
import { useAuth } from '../auth/AuthContext';
import { AppShell } from '../components/dashboard/AppShell';
import { StatsCard } from '../components/dashboard/StatsCard';
import type { VisionModelStatus, VisionPredictionResult } from '../types/domain';
import { getDashboardPathByRole } from '../utils/roles';

type DashboardSectionId = 'overview' | 'facial-scan' | 'support';
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
  { id: 'support', label: 'Support' },
] as const;

const resolveStatusCode = (error: unknown): number | null => {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return null;
  }
  const response = (error as { response?: { status?: number } }).response;
  return response?.status ?? null;
};

const resolveApiDetail = (error: unknown): string | null => {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return null;
  }
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
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

const toTitleCase = (value: string): string =>
  value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const toPercent = (value: number): string => `${Math.round(value * 100)}%`;

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

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const captureIntervalRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<number | null>(null);
  const activeFramesRef = useRef<Blob[]>([]);
  const captureInProgressRef = useRef(false);
  const scanRunRef = useRef(0);
  const statusRunRef = useRef(0);

  const allowed = user?.role === 'employee';
  const selectedProfile = FACIAL_SCAN_PROFILE;
  const isScanBusy = scanPhase === 'capturing' || scanPhase === 'uploading';
  const cameraMessage = getCameraMessage(cameraState, cameraDetail);
  const startScanDisabled =
    isScanBusy || modelStatusLoading || Boolean(modelStatusError) || Boolean(modelStatus && !modelStatus.ready);

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
      if (runId === statusRunRef.current) {
        setModelStatusLoading(false);
      }
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
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
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
        if (video.srcObject !== stream) {
          video.srcObject = stream;
        }
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
    if (!video || !canvas) {
      throw new Error('Camera preview is not ready yet. Re-open the webcam and retry.');
    }
    if (video.videoWidth < 2 || video.videoHeight < 2) {
      throw new Error('MindWell is still warming up the camera preview. Please retry in a moment.');
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('MindWell could not prepare the webcam frame for upload.');
    }

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

        if (resolveStatusCode(error) === 503) {
          void loadModelStatus();
        }

        toast.error(message);
      } finally {
        if (runId === scanRunRef.current) {
          detachCamera('idle');
        }
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
      if (announce) {
        toast.info('Facial scan stopped.');
      }
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
        modelStatus?.message ??
        'The facial detection model is not ready yet. Please place the checkpoint and retry readiness.';
      setScanPhase('error');
      setScanError(message);
      toast.error(message);
      return;
    }

    const cameraStartResult = await startCamera();
    if (!cameraStartResult.ready) {
      const permissionMessage =
        cameraStartResult.message ?? 'MindWell could not access the webcam. Please retry the scan.';
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

        if (activeFramesRef.current.length >= profile.frameCount) {
          finalizeCapture();
        }
      } catch (error) {
        if (runId !== scanRunRef.current) return;
        const message = error instanceof Error ? error.message : 'MindWell could not capture the webcam frame.';
        if (isTransientCaptureError(message)) {
          return;
        }

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
      if (nextSeconds === 0) {
        finalizeCapture();
      }
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
    if (user && user.role !== 'employee') {
      navigate(getDashboardPathByRole(user.role), { replace: true });
    }
  }, [navigate, user]);

  useEffect(() => {
    if (!allowed) return;
    void loadModelStatus();
  }, [allowed, loadModelStatus]);

  useEffect(() => {
    if (activeSectionId === 'facial-scan') return;
    if (mediaStreamRef.current || isScanBusy) {
      stopScan(false);
    }
  }, [activeSectionId, isScanBusy, stopScan]);

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

  const renderOverview = () => {
    return (
      <section className="mw-entity-layout">
        <section className="mw-stat-grid">
          <StatsCard label="Scan Duration" value={30} />
          <StatsCard label="Frames Captured" value={FACIAL_SCAN_PROFILE.frameCount} />
          <StatsCard label="Capture Interval" value={5} />
          <StatsCard label="Top Scores Shown" value={3} />
          <StatsCard label="Backend Frame Limit" value={modelStatus?.max_frames_per_request ?? 60} />
        </section>

        <div className="mw-panel-grid">
          <article className="mw-card mw-info-panel">
            <p className="mw-entity-kicker">Employee Workspace</p>
            <h3>30-second facial check-in</h3>
            <p>
              Start a fixed 30-second webcam scan, let MindWell sample secure frames across that window, and receive
              the model result in a clean score summary.
            </p>
            <div className="mw-info-panel-actions">
              <button
                type="button"
                className="mw-btn-primary"
                onClick={() => setActiveSectionId('facial-scan')}
              >
                Open Facial Scan
              </button>
              <button
                type="button"
                className="mw-btn-ghost"
                onClick={() => {
                  void loadModelStatus();
                }}
              >
                Refresh Model Status
              </button>
            </div>
          </article>

          <article className="mw-card mw-info-panel">
            <p className="mw-entity-kicker">Model Readiness</p>
            <h3>{modelStatus?.ready ? 'Detection model ready' : 'Detection model needs attention'}</h3>
            <p>{modelStatusLoading ? 'Checking readiness now...' : modelStatus?.message ?? modelStatusError}</p>
            {modelStatus ? (
              <div className="mw-inline-summary">
                <span className={`mw-badge ${modelStatus.ready ? 'mw-badge-success' : 'mw-badge-warning'}`}>
                  {modelStatus.ready ? 'Ready' : 'Not Ready'}
                </span>
                <span className="mw-helper-text">Architecture: {modelStatus.architecture}</span>
              </div>
            ) : null}
          </article>

          <article className="mw-card mw-info-panel">
            <p className="mw-entity-kicker">Privacy</p>
            <h3>Preview stays local until scan completes</h3>
            <p>
              The camera remains off until you start. During a scan, MindWell captures a limited set of JPEG frames,
              sends them to the protected employee-only vision endpoint, and stops the camera when the flow finishes.
            </p>
          </article>
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
                onClick={() => {
                  void startScan();
                }}
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
                onClick={() => {
                  void loadModelStatus();
                }}
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
              {scanResult ? (
                <span className="mw-badge mw-badge-info">{scanResult.frame_count} frames analyzed</span>
              ) : null}
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
                    onClick={() => {
                      void startScan();
                    }}
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

  const renderSupportSection = () => {
    return (
      <section className="mw-entity-layout">
        <div className="mw-panel-grid">
          <article className="mw-card mw-info-panel">
            <p className="mw-entity-kicker">Support</p>
            <h3>What happens during a scan</h3>
            <p>
              MindWell captures a limited set of webcam frames, sends them to the employee-only backend vision route,
              and returns the model result as a clean mood score summary after the 30-second scan ends. The preview
              shuts off once the scan is done or stopped.
            </p>
          </article>

          <article className="mw-card mw-info-panel">
            <p className="mw-entity-kicker">If permission is denied</p>
            <h3>How to recover</h3>
            <p>
              Open your browser site settings, allow camera access for this MindWell URL, then return to the Facial
              Scan section and retry. The page will stay stable even if the browser refuses access.
            </p>
          </article>

          <article className="mw-card mw-info-panel">
            <p className="mw-entity-kicker">Model readiness</p>
            <h3>Exact backend message</h3>
            <p>{modelStatus?.message ?? modelStatusError ?? 'No readiness message available yet.'}</p>
          </article>
        </div>
      </section>
    );
  };

  const renderSection = () => {
    if (activeSectionId === 'overview') return renderOverview();
    if (activeSectionId === 'facial-scan') return renderScanSection();
    if (activeSectionId === 'support') return renderSupportSection();
    return renderOverview();
  };

  return (
    <AppShell
      title="Employee Wellness Dashboard"
      subtitle="Private facial scan check-ins with model-readiness checks, permission safety, and a calm guided flow."
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
