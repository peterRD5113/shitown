"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import QRCode from "qrcode";
import {
  Mic,
  Square,
  Play,
  Pause,
  Download,
  QrCode,
  Volume2,
  ExternalLink,
  ArrowRight,
  ChevronDown,
  Music,
  X,
  RefreshCw,
} from "lucide-react";
import { synthesizeOfflineBackingBuffer } from "@/lib/presets";
import { renderAutoDuckedMix, audioBufferToWavBlob } from "@/lib/audio-mixer";
import {
  downloadStandaloneQrPng,
  downloadVinylSleeveCardPng,
} from "@/lib/export-card-png";

interface RecommendedBgmTrack {
  id: string;
  presetId: string;
  title: string;
  description: string;
  prompt: string;
  mode: "music" | "ambience";
}

const TWO_AI_BGM_RECOMMENDATIONS: RecommendedBgmTrack[] = [
  {
    id: "bgm-a",
    presetId: "warm-guitar-piano",
    title: "老屋午後暖陽與木吉他",
    description: "溫潤指彈木吉他搭配老屋窗邊暖陽氛圍，適合真摯溫暖的口白故事。",
    prompt:
      "Warm fingerpicked acoustic guitar and soft upright piano, gentle afternoon sunlight in a heritage wooden house, instrumental only, no vocals",
    mode: "music",
  },
  {
    id: "bgm-b",
    presetId: "cafe-rain",
    title: "港町微風與溫柔鋼琴",
    description: "柔和立式鋼琴與港町微風環境音交織，讓話語像明信片般靜靜留存。",
    prompt:
      "Gentle coastal town breeze with warm upright piano notes and subtle vintage tape warmth, peaceful and nostalgic, no vocals",
    mode: "ambience",
  },
];

const SOUNDWAVE_HEIGHTS = [
  10, 18, 28, 16, 34, 24, 14, 32, 36, 22, 30, 18, 34, 26, 16, 28, 20, 12,
];

async function createDemoVoiceBuffer(sampleRate = 44100): Promise<AudioBuffer> {
  const duration = 10;
  const ctx = new OfflineAudioContext(1, duration * sampleRate, sampleRate);
  const buffer = ctx.createBuffer(1, duration * sampleRate, sampleRate);
  const data = buffer.getChannelData(0);

  const phrases = [
    [0.4, 2.8],
    [3.8, 6.6],
    [7.4, 9.5],
  ];

  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    const inPhrase = phrases.some(([s, e]) => t >= s && t <= e);
    if (!inPhrase) continue;
    const syllableEnv = Math.max(
      0,
      Math.sin(2 * Math.PI * 3.2 * t) * 0.65 +
        Math.sin(2 * Math.PI * 1.6 * t) * 0.35
    );
    const f0 = 168 + 20 * Math.sin(2 * Math.PI * 0.8 * t);
    data[i] =
      (Math.sin(2 * Math.PI * f0 * t) * 0.55 +
        Math.sin(2 * Math.PI * f0 * 2 * t) * 0.28 +
        Math.sin(2 * Math.PI * f0 * 3 * t) * 0.14) *
      syllableEnv *
      0.55;
  }
  return buffer;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export default function ShiTownVoicePostcardPage() {
  // Currently open accordion panel (any step 1..4 can be freely opened at any time!)
  const [openStep, setOpenStep] = useState<1 | 2 | 3 | 4 | null>(1);

  // Non-destructive completion flags (opening an earlier step never wipes out completed later steps)
  const [hasSubmittedVoice, setHasSubmittedVoice] = useState(false);
  const [hasMixedAudio, setHasMixedAudio] = useState(false);
  const [hasGeneratedQr, setHasGeneratedQr] = useState(false);

  // Step 01: Microphone Recording & Voice Preview
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceBuffer, setVoiceBuffer] = useState<AudioBuffer | null>(null);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [voiceDuration, setVoiceDuration] = useState<number>(0);
  const [hasRecordedCustomVoice, setHasRecordedCustomVoice] = useState(false);
  const [isPlayingVoice, setIsPlayingVoice] = useState(false);

  // Step 01: Teleprompter Script & Inspiration Helper
  const [scriptText, setScriptText] = useState<string>(
    "今天在港邊聞著咖啡香，突然想起好久不見的你。希望收到這張聲音明信片的時候，你剛好也有一個安靜、放鬆的午後。"
  );
  const [userThought, setUserThought] = useState<string>("");
  const [isGeneratingScript, setIsGeneratingScript] = useState<boolean>(false);

  // Step 01 (Optional): Uploaded Reference Music for Approach A + B
  const [referenceFileName, setReferenceFileName] = useState<string>("");
  const [referenceClipBlob, setReferenceClipBlob] = useState<Blob | null>(null);
  const [referenceDataUrl, setReferenceDataUrl] = useState<string>("");
  const [isPlayingReference, setIsPlayingReference] = useState(false);

  // Step 02: AI BGM Recommendations (Pick 1 of 2)
  const [bgmOptions, setBgmOptions] = useState<RecommendedBgmTrack[]>(
    TWO_AI_BGM_RECOMMENDATIONS
  );
  const [detectedTone, setDetectedTone] = useState<string>("");
  const [isGeneratingBgmOptions, setIsGeneratingBgmOptions] = useState(false);
  const [aiStageMessage, setAiStageMessage] = useState<string>("");
  const [bgmBuffers, setBgmBuffers] = useState<Record<string, AudioBuffer>>({});
  const [bgmBlobs, setBgmBlobs] = useState<Record<string, Blob>>({});
  const [selectedBgmId, setSelectedBgmId] = useState<string>("bgm-a");
  const [mixedBgmId, setMixedBgmId] = useState<string>("bgm-a");
  const [playingBgmId, setPlayingBgmId] = useState<string | null>(null);

  // Step 03: Auto-Mixed Voice Postcard Audio
  const [isMixing, setIsMixing] = useState(false);
  const [mixedWavBlob, setMixedWavBlob] = useState<Blob | null>(null);
  const [mixedDuration, setMixedDuration] = useState<number>(14);
  const [isPlayingMix, setIsPlayingMix] = useState(false);

  // Step 04: QR Code Generation & Download
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [keepsakeId, setKeepsakeId] = useState<string>("shitown-001");
  const [createdAtDate, setCreatedAtDate] = useState<string>("2026.11.05");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [listenUrl, setListenUrl] = useState<string>("");

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const activeAudioElRef = useRef<HTMLAudioElement | null>(null);
  const refAudioInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let stepParam = 1;
    try {
      const search = new URLSearchParams(window.location.search);
      const parsedStep = Number(search.get("step"));
      if (
        parsedStep === 1 ||
        parsedStep === 2 ||
        parsedStep === 3 ||
        parsedStep === 4
      ) {
        stepParam = parsedStep;
        setOpenStep(parsedStep);
        if (parsedStep >= 2) {
          setHasRecordedCustomVoice(true);
          setHasSubmittedVoice(true);
        }
        if (parsedStep >= 3) setHasMixedAudio(true);
        if (parsedStep >= 4) setHasGeneratedQr(true);
      }
    } catch {
      // Ignore URL search param errors
    }

    let cancelled = false;
    (async () => {
      const bufA = await synthesizeOfflineBackingBuffer(
        TWO_AI_BGM_RECOMMENDATIONS[0].presetId,
        14
      );
      const bufB = await synthesizeOfflineBackingBuffer(
        TWO_AI_BGM_RECOMMENDATIONS[1].presetId,
        14
      );
      if (cancelled) return;

      setBgmBuffers({
        "bgm-a": bufA,
        "bgm-b": bufB,
      });
      setBgmBlobs({
        "bgm-a": audioBufferToWavBlob(bufA),
        "bgm-b": audioBufferToWavBlob(bufB),
      });

      // Only pre-populate demo voice when explicitly previewing step >= 2 via URL param
      if (stepParam >= 2) {
        const demoVoice = await createDemoVoiceBuffer();
        if (cancelled) return;
        setVoiceBuffer(demoVoice);
        setVoiceBlob(audioBufferToWavBlob(demoVoice));
        setVoiceDuration(Math.round(demoVoice.duration));

        const initialMix = await renderAutoDuckedMix(demoVoice, bufA, {
          introSeconds: 1.5,
          outroSeconds: 2.5,
        });
        if (!cancelled) {
          setMixedWavBlob(initialMix.wavBlob);
          setMixedDuration(Math.round(initialMix.durationSeconds));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Generate QR Code image whenever keepsakeId updates
  useEffect(() => {
    const origin =
      typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost:3000";
    const url = `${origin}/listen/${keepsakeId}`;
    setListenUrl(url);

    QRCode.toDataURL(url, {
      width: 240,
      margin: 1,
      color: {
        dark: "#3A2314",
        light: "#FFFFFF",
      },
      errorCorrectionLevel: "M",
    })
      .then((dataUrl) => setQrDataUrl(dataUrl))
      .catch(() => {});
  }, [keepsakeId]);

  const stopAnyPlayback = () => {
    if (activeAudioElRef.current) {
      activeAudioElRef.current.pause();
      activeAudioElRef.current.currentTime = 0;
      activeAudioElRef.current = null;
    }
    setIsPlayingVoice(false);
    setIsPlayingReference(false);
    setPlayingBgmId(null);
    setIsPlayingMix(false);
  };

  const toggleStep = (step: 1 | 2 | 3 | 4) => {
    stopAnyPlayback();
    setOpenStep((prev) => (prev === step ? null : step));
  };

  const playBlob = (
    blob: Blob,
    onStart: () => void,
    onStop: () => void
  ) => {
    stopAnyPlayback();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    activeAudioElRef.current = audio;
    onStart();
    audio.onended = () => {
      onStop();
      URL.revokeObjectURL(url);
    };
    audio.play().catch(() => {
      onStop();
    });
  };

  const decodeBlobToAudioBuffer = async (blob: Blob): Promise<AudioBuffer> => {
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new AudioContext();
    try {
      return await audioCtx.decodeAudioData(arrayBuffer);
    } finally {
      await audioCtx.close();
    }
  };

  // Extract a compact 15-second 22.05kHz mono WAV clip from an uploaded reference audio file
  const handleReferenceFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stopAnyPlayback();
    setErrorMessage(null);

    try {
      const decoded = await decodeBlobToAudioBuffer(file);
      const targetSr = 22050;
      const maxClipSec = Math.min(15, decoded.duration);
      // If the song is longer than 20s, skip the first 10% (up to 8s) so we capture the main musical groove rather than silent intro
      const startOffsetSec =
        decoded.duration > 20 ? Math.min(8, decoded.duration * 0.1) : 0;
      const frameCount = Math.max(1, Math.ceil(maxClipSec * targetSr));

      const offlineCtx = new OfflineAudioContext(1, frameCount, targetSr);
      const src = offlineCtx.createBufferSource();
      src.buffer = decoded;
      src.connect(offlineCtx.destination);
      src.start(0, startOffsetSec, maxClipSec);

      const renderedClip = await offlineCtx.startRendering();
      const clipWavBlob = audioBufferToWavBlob(renderedClip);
      const clipDataUrl = await blobToDataUrl(clipWavBlob);

      setReferenceFileName(file.name);
      setReferenceClipBlob(clipWavBlob);
      setReferenceDataUrl(clipDataUrl);
    } catch {
      setErrorMessage("無法讀取這份參考音檔，請確認檔案為 MP3、WAV 或 M4A 格式。");
    } finally {
      e.target.value = "";
    }
  };

  const handleClearReferenceAudio = () => {
    if (isPlayingReference) stopAnyPlayback();
    setReferenceFileName("");
    setReferenceClipBlob(null);
    setReferenceDataUrl("");
  };

  // STEP 01: Start / Stop Microphone Recording
  const handleStartRecording = async () => {
    stopAnyPlayback();
    setErrorMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const recordedBlob = new Blob(recordedChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        try {
          const decoded = await decodeBlobToAudioBuffer(recordedBlob);
          const wavBlob = audioBufferToWavBlob(decoded);
          setVoiceBuffer(decoded);
          setVoiceBlob(wavBlob);
          setVoiceDuration(Math.max(1, Math.round(decoded.duration)));
          setHasRecordedCustomVoice(true);
        } catch {
          setErrorMessage("無法解析錄音內容，請重新錄製一次。");
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSeconds(0);
      timerIntervalRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch {
      setErrorMessage(
        "未偵測到麥克風權限。請允許瀏覽器使用麥克風後再開始錄音。"
      );
    }
  };

  const handleStopRecording = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const handleGenerateScript = async (mode: "random" | "custom") => {
    setIsGeneratingScript(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/generate-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thought: mode === "custom" ? userThought.trim() : "",
          previousScript: scriptText,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (typeof data.script === "string" && data.script.trim()) {
          setScriptText(data.script.trim());
        }
      }
    } catch {
      // Keep current script if network error occurs
    } finally {
      setIsGeneratingScript(false);
    }
  };

  // STEP 01 -> STEP 02: Confirm Voice -> Stage 1 (Approach A: Gemini analyzes voice + optional reference audio) -> Stage 2 (Approach B: Fal.ai generates 2 BGM Tracks)
  const handleConfirmStep1 = async () => {
    if (!voiceBuffer || !voiceBlob) return;
    stopAnyPlayback();
    setErrorMessage(null);
    setIsGeneratingBgmOptions(true);
    setAiStageMessage(
      referenceClipBlob
        ? "1/2 正在分析您的聲音與參考音樂曲風..."
        : "1/2 正在聆聽語氣與構思配樂..."
    );

    try {
      // Stage 1 (Approach A): Call /api/analyze-voice so Gemini 2.5 Flash listens to voice + optional reference music
      let activeRecommendations = TWO_AI_BGM_RECOMMENDATIONS;
      try {
        const analysisForm = new FormData();
        analysisForm.append("audio", voiceBlob, "voice.wav");
        if (referenceClipBlob) {
          analysisForm.append(
            "referenceAudio",
            referenceClipBlob,
            "reference.wav"
          );
        }
        const analysisRes = await fetch("/api/analyze-voice", {
          method: "POST",
          body: analysisForm,
        });
        if (analysisRes.ok) {
          const analysisData = await analysisRes.json();
          if (
            Array.isArray(analysisData.recommendations) &&
            analysisData.recommendations.length >= 2
          ) {
            activeRecommendations = analysisData.recommendations.slice(0, 2);
            setBgmOptions(activeRecommendations);
          }
          if (analysisData.detectedTone) {
            setDetectedTone(analysisData.detectedTone);
          }
        }
      } catch {
        // Fallback to default 2 recommendations if analysis fails
      }

      // Stage 2 (Approach B): Generate the 2 BGM tracks via Fal.ai (with Audio-to-Audio reference conditioning when referenceDataUrl is present)
      setAiStageMessage(
        referenceDataUrl
          ? "2/2 正在依參考音樂與語調生成兩首配樂..."
          : "2/2 正在為您譜寫兩首專屬背景音樂..."
      );
      const targetLen = Math.max(14, voiceDuration + 4);
      const newBuffers: Record<string, AudioBuffer> = {};
      const newBlobs: Record<string, Blob> = {};

      for (let idx = 0; idx < activeRecommendations.length; idx++) {
        const rec = activeRecommendations[idx];
        try {
          const res = await fetch("/api/generate-bgm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider: "fal",
              prompt: rec.prompt,
              mode: rec.mode,
              durationSeconds: targetLen,
              falModel: "fal-ai/stable-audio",
              referenceAudioDataUrl: referenceDataUrl || undefined,
              referenceStrength: idx === 0 ? 0.72 : 0.82,
            }),
          });
          if (res.ok) {
            const cloudBlob = await res.blob();
            const decoded = await decodeBlobToAudioBuffer(cloudBlob);
            newBuffers[rec.id] = decoded;
            newBlobs[rec.id] = audioBufferToWavBlob(decoded);
            continue;
          }
        } catch {
          // Fallback to synthesizer below if cloud BGM call fails
        }
        const synthBuf = await synthesizeOfflineBackingBuffer(
          rec.presetId || "warm-guitar-piano",
          targetLen
        );
        newBuffers[rec.id] = synthBuf;
        newBlobs[rec.id] = audioBufferToWavBlob(synthBuf);
      }

      setBgmBuffers(newBuffers);
      setBgmBlobs(newBlobs);
      setSelectedBgmId(activeRecommendations[0].id);
      setHasSubmittedVoice(true);
      setOpenStep(2);
    } catch {
      setErrorMessage("準備背景音樂時發生錯誤，請再試一次。");
    } finally {
      setIsGeneratingBgmOptions(false);
      setAiStageMessage("");
    }
  };

  // STEP 02 -> STEP 03: Confirm Chosen BGM & Auto-Mix
  const handleConfirmStep2 = useCallback(async () => {
    if (!voiceBuffer) return;
    const chosenBuffer = bgmBuffers[selectedBgmId];
    if (!chosenBuffer) return;

    stopAnyPlayback();
    setIsMixing(true);

    try {
      const result = await renderAutoDuckedMix(voiceBuffer, chosenBuffer, {
        introSeconds: 1.5,
        outroSeconds: 2.5,
      });
      setMixedWavBlob(result.wavBlob);
      setMixedDuration(Math.round(result.durationSeconds));
      setMixedBgmId(selectedBgmId);
      setHasMixedAudio(true);
      setOpenStep(3);
    } finally {
      setIsMixing(false);
    }
  }, [voiceBuffer, bgmBuffers, selectedBgmId]);

  // STEP 03 -> STEP 04: Confirm Mix & Generate QR Code
  const handleConfirmStep3 = async () => {
    if (!mixedWavBlob) return;
    stopAnyPlayback();
    setIsGeneratingQr(true);
    setErrorMessage(null);

    try {
      const chosenTrack =
        bgmOptions.find((t) => t.id === mixedBgmId) ||
        bgmOptions.find((t) => t.id === selectedBgmId) ||
        bgmOptions[0];

      const formData = new FormData();
      formData.append("audio", mixedWavBlob, "final_mix.wav");
      formData.append("recipientTitle", "港町留聲・私人聲音明信片");
      formData.append("senderName", "蒔町・拾光事務所");
      formData.append(
        "transcript",
        "讓值得記住的聲音，成為可以收藏的記憶。"
      );
      formData.append("moodLabel", chosenTrack.title);
      formData.append("presetId", chosenTrack.presetId);
      formData.append("presetTitle", chosenTrack.title);
      formData.append("durationSeconds", String(mixedDuration));

      const res = await fetch("/api/keepsakes", {
        method: "POST",
        body: formData,
      });
      const record = await res.json();
      if (!res.ok) {
        throw new Error(record.error || "生成 QR Code 失敗");
      }

      setKeepsakeId(record.id);
      setCreatedAtDate(record.createdAt);
      setHasGeneratedQr(true);
      setOpenStep(4);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "生成 QR Code 時發生錯誤"
      );
    } finally {
      setIsGeneratingQr(false);
    }
  };

  const handleDownloadMixedWav = () => {
    if (!mixedWavBlob) return;
    const url = URL.createObjectURL(mixedWavBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shitown-voice-${keepsakeId}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const activeBgmTrack =
    bgmOptions.find((t) => t.id === selectedBgmId) || bgmOptions[0];
  const mixedBgmTrack =
    bgmOptions.find((t) => t.id === mixedBgmId) || activeBgmTrack;

  return (
    <main className="atelier-wrapper">
      {/* Official Logo & Title */}
      <header className="brand-hero">
        <img
          src="/shitown-logo.png?v=3"
          alt="蒔町 SHI TOWN"
          className="brand-logo-img"
        />
        <h1>港町留聲計畫・聲音明信片</h1>
        <p>讓值得記住的聲音，成為可以收藏的記憶</p>
      </header>

      {errorMessage && (
        <div
          role="alert"
          style={{
            backgroundColor: "#7F1D1D",
            color: "#FBF8F3",
            padding: "10px 16px",
            borderRadius: "6px",
            fontSize: "0.86rem",
            marginBottom: "16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            style={{
              border: "1px solid #FBF8F3",
              background: "transparent",
              color: "#FBF8F3",
              padding: "3px 8px",
              borderRadius: "4px",
              fontSize: "0.76rem",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            關閉
          </button>
        </div>
      )}

      {/* 4-Step Free Accordion Stack (Any step can be clicked & opened at any time!) */}
      <div className="step-stack">
        {/* ================= STEP 01: RECORD VOICE & OPTIONAL REFERENCE AUDIO ================= */}
        <section
          className={`step-panel ${openStep === 1 ? "active" : ""}`}
          aria-label="第一步：錄下聲音"
        >
          <button
            type="button"
            className="step-summary-bar"
            onClick={() => toggleStep(1)}
            aria-expanded={openStep === 1}
          >
            <div className="step-title-left">
              <span className="step-index">01</span>
              <h2 className="step-name">錄下聲音</h2>
            </div>

            <div className="step-meta-right">
              <span className="step-status-text tabular-nums">
                {isRecording
                  ? `錄音中 ${formatTime(recordingSeconds)}`
                  : hasRecordedCustomVoice
                  ? `已錄製 ${formatTime(voiceDuration)}`
                  : "尚未錄音"}
              </span>
              <ChevronDown size={18} className="step-chevron" />
            </div>
          </button>

          {openStep === 1 && (
            <div className="step-body">
              <p className="step-instruction">
                請點擊「開始錄音」錄下您想說的話，錄完後可先試聽，確認無誤後點選「確認送出」。
              </p>

              {/* Step 01: Teleprompter & Script Inspiration Section */}
              <div className="script-helper-section">
                <div className="script-helper-header">
                  <div>
                    <span className="script-helper-title">留聲讀稿參考</span>
                    <span className="script-helper-sub">
                      （可照著唸，也可直接點擊修改文字）
                    </span>
                  </div>
                  <button
                    type="button"
                    className="script-refresh-btn"
                    onClick={() => handleGenerateScript("random")}
                    disabled={isGeneratingScript}
                  >
                    <RefreshCw size={13} strokeWidth={1.8} />
                    <span>
                      {isGeneratingScript && !userThought.trim()
                        ? "構思中..."
                        : "換一段靈感"}
                    </span>
                  </button>
                </div>

                <textarea
                  className="script-teleprompter-box"
                  rows={2}
                  value={scriptText}
                  onChange={(e) => setScriptText(e.target.value)}
                  aria-label="留聲讀稿參考文字"
                />

                <div className="script-thought-row">
                  <input
                    type="text"
                    className="script-thought-input"
                    placeholder="不知道怎麼開口？寫下大致想法（例：祝阿哲生日快樂、謝謝媽媽的照顧）..."
                    value={userThought}
                    onChange={(e) => setUserThought(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && userThought.trim()) {
                        e.preventDefault();
                        handleGenerateScript("custom");
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() =>
                      handleGenerateScript(
                        userThought.trim() ? "custom" : "random"
                      )
                    }
                    disabled={isGeneratingScript}
                  >
                    <span>
                      {isGeneratingScript
                        ? "正在撰寫..."
                        : userThought.trim()
                        ? "撰寫留聲短句"
                        : "隨機生成短句"}
                    </span>
                  </button>
                </div>
              </div>

              {/* Optional Reference Music Upload Row (Approach A + B) */}
              <div className="reference-upload-row">
                <div className="reference-upload-info">
                  <div className="reference-upload-title">
                    參考音樂（選填）
                  </div>
                  <div className="reference-upload-desc">
                    {referenceFileName
                      ? `已載入：${referenceFileName}（將依此曲風與音色生成配樂）`
                      : "若有喜歡的音樂可上傳，系統將依該曲風與音色為您生成相似配樂"}
                  </div>
                </div>

                <div className="reference-upload-actions">
                  <input
                    ref={refAudioInputRef}
                    type="file"
                    accept="audio/*"
                    onChange={handleReferenceFileChange}
                    style={{ display: "none" }}
                  />

                  {!referenceClipBlob ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => refAudioInputRef.current?.click()}
                    >
                      <Music size={15} strokeWidth={1.75} />
                      <span>上傳參考音檔</span>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() =>
                          isPlayingReference
                            ? stopAnyPlayback()
                            : playBlob(
                                referenceClipBlob,
                                () => setIsPlayingReference(true),
                                () => setIsPlayingReference(false)
                              )
                        }
                      >
                        {isPlayingReference ? (
                          <>
                            <Pause size={14} strokeWidth={1.75} />
                            <span>停止</span>
                          </>
                        ) : (
                          <>
                            <Play size={14} strokeWidth={1.75} />
                            <span>試聽參考</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => refAudioInputRef.current?.click()}
                      >
                        <Music size={14} strokeWidth={1.75} />
                        <span>更換</span>
                      </button>

                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={handleClearReferenceAudio}
                        aria-label="移除參考音檔"
                      >
                        <X size={14} strokeWidth={1.75} />
                        <span>移除</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="step-action-row">
                <div className="step-action-left">
                  {!isRecording ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleStartRecording}
                    >
                      <Mic size={16} strokeWidth={1.75} />
                      <span>
                        {hasRecordedCustomVoice ? "重新錄音" : "開始錄音"}
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleStopRecording}
                    >
                      <Square size={16} strokeWidth={1.75} />
                      <span>停止錄音 ({formatTime(recordingSeconds)})</span>
                    </button>
                  )}

                  {hasRecordedCustomVoice && voiceBlob && !isRecording && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() =>
                        isPlayingVoice
                          ? stopAnyPlayback()
                          : playBlob(
                              voiceBlob,
                              () => setIsPlayingVoice(true),
                              () => setIsPlayingVoice(false)
                            )
                      }
                    >
                      {isPlayingVoice ? (
                        <>
                          <Pause size={16} strokeWidth={1.75} />
                          <span>停止試聽</span>
                        </>
                      ) : (
                        <>
                          <Play size={16} strokeWidth={1.75} />
                          <span>試聽錄音</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleConfirmStep1}
                  disabled={
                    !hasRecordedCustomVoice ||
                    isRecording ||
                    isGeneratingBgmOptions
                  }
                >
                  <span>
                    {isGeneratingBgmOptions
                      ? aiStageMessage || "專屬配樂生成中..."
                      : "確認送出，生成專屬配樂"}
                  </span>
                  <ArrowRight size={16} strokeWidth={1.75} />
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ================= STEP 02: PICK 1 OF 2 AI BGM ================= */}
        <section
          className={`step-panel ${openStep === 2 ? "active" : ""}`}
          aria-label="第二步：挑選配樂"
        >
          <button
            type="button"
            className="step-summary-bar"
            onClick={() => toggleStep(2)}
            aria-expanded={openStep === 2}
          >
            <div className="step-title-left">
              <span className="step-index">02</span>
              <h2 className="step-name">挑選配樂</h2>
            </div>

            <div className="step-meta-right">
              <span className="step-status-text">
                {!hasSubmittedVoice ? "請先完成第 01 步" : activeBgmTrack.title}
              </span>
              <ChevronDown size={18} className="step-chevron" />
            </div>
          </button>

          {openStep === 2 && (
            <div className="step-body">
              {!hasSubmittedVoice ? (
                <div className="step-empty-notice">
                  <span>
                    請先在「01 錄下聲音」完成錄音並按下確認送出，系統就會根據您的語調生成兩首專屬背景音樂。
                  </span>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setOpenStep(1)}
                  >
                    <span>前往 01 錄下聲音</span>
                  </button>
                </div>
              ) : (
                <>
                  <p className="step-instruction">
                    {detectedTone
                      ? `根據您的聲音特質「${detectedTone}」，為您量身生成以下兩首配樂（您可隨時回來試聽，不會洗掉已完成的合成）：`
                      : "已為您的聲音譜寫兩首背景音樂，可先點擊右側「試聽」，選好後點選下方按鈕合成。"}
                  </p>

                  <div
                    className="bgm-option-list"
                    role="radiogroup"
                    aria-label="推薦配樂選項"
                  >
                    {bgmOptions.map((track) => {
                      const isSelected = selectedBgmId === track.id;
                      const isPreviewing = playingBgmId === track.id;
                      const trackBlob = bgmBlobs[track.id];

                      return (
                        <div
                          key={track.id}
                          className={`bgm-option-row ${
                            isSelected ? "selected" : ""
                          }`}
                          onClick={() => setSelectedBgmId(track.id)}
                          role="radio"
                          aria-checked={isSelected}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedBgmId(track.id);
                            }
                          }}
                        >
                          <div className="bgm-option-left">
                            <span className="radio-dot" aria-hidden="true">
                              {isSelected && <span className="radio-dot-inner" />}
                            </span>
                            <div>
                              <div className="bgm-option-title">
                                {track.title}
                              </div>
                              <div className="bgm-option-desc">
                                {track.description}
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            className="btn-secondary bgm-preview-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!trackBlob) return;
                              if (isPreviewing) {
                                stopAnyPlayback();
                              } else {
                                playBlob(
                                  trackBlob,
                                  () => setPlayingBgmId(track.id),
                                  () => setPlayingBgmId(null)
                                );
                              }
                            }}
                          >
                            {isPreviewing ? (
                              <>
                                <Pause size={14} strokeWidth={1.75} />
                                <span>停止</span>
                              </>
                            ) : (
                              <>
                                <Play size={14} strokeWidth={1.75} />
                                <span>試聽</span>
                              </>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div
                    className="step-action-row"
                    style={{ justifyContent: "flex-end" }}
                  >
                    {hasMixedAudio && selectedBgmId === mixedBgmId ? (
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => {
                          stopAnyPlayback();
                          setOpenStep(3);
                        }}
                      >
                        <span>前往 03 試聽合成結果</span>
                        <ArrowRight size={16} strokeWidth={1.75} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={handleConfirmStep2}
                        disabled={isMixing}
                      >
                        <span>
                          {isMixing
                            ? "正在合成聲音..."
                            : hasMixedAudio
                            ? "改用這首配樂重新合成"
                            : "確認配樂，開始合成"}
                        </span>
                        <ArrowRight size={16} strokeWidth={1.75} />
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        {/* ================= STEP 03: PREVIEW MIXED AUDIO ================= */}
        <section
          className={`step-panel ${openStep === 3 ? "active" : ""}`}
          aria-label="第三步：試聽合成"
        >
          <button
            type="button"
            className="step-summary-bar"
            onClick={() => toggleStep(3)}
            aria-expanded={openStep === 3}
          >
            <div className="step-title-left">
              <span className="step-index">03</span>
              <h2 className="step-name">試聽合成</h2>
            </div>

            <div className="step-meta-right">
              <span className="step-status-text tabular-nums">
                {!hasMixedAudio
                  ? "請先挑選配樂並合成"
                  : `已合成 (${formatTime(mixedDuration)})`}
              </span>
              <ChevronDown size={18} className="step-chevron" />
            </div>
          </button>

          {openStep === 3 && (
            <div className="step-body">
              {!hasMixedAudio ? (
                <div className="step-empty-notice">
                  <span>
                    請先在「02 挑選配樂」選擇一首背景音樂並按下「確認配樂，開始合成」。
                  </span>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setOpenStep(hasSubmittedVoice ? 2 : 1)}
                  >
                    <span>
                      {hasSubmittedVoice ? "前往 02 挑選配樂" : "前往 01 錄下聲音"}
                    </span>
                  </button>
                </div>
              ) : (
                <>
                  <p className="step-instruction">
                    已將您的聲音與「{mixedBgmTrack.title}」完成合成。請點擊下方按鈕試聽，確認沒問題即可生成專屬條碼。
                  </p>

                  {/* Single-Line Player Row (Fixed button width, never wraps onto 2 lines!) */}
                  <div className="player-single-line">
                    <button
                      type="button"
                      className="btn-secondary player-toggle-btn"
                      onClick={() => {
                        if (isPlayingMix) {
                          stopAnyPlayback();
                        } else if (mixedWavBlob) {
                          playBlob(
                            mixedWavBlob,
                            () => setIsPlayingMix(true),
                            () => setIsPlayingMix(false)
                          );
                        }
                      }}
                      disabled={!mixedWavBlob || isMixing}
                    >
                      {isPlayingMix ? (
                        <>
                          <Pause size={16} strokeWidth={1.75} />
                          <span>停止試聽</span>
                        </>
                      ) : (
                        <>
                          <Volume2 size={16} strokeWidth={1.75} />
                          <span>試聽合成</span>
                        </>
                      )}
                    </button>

                    <div
                      className={`soundwave-bars ${
                        isPlayingMix ? "playing" : ""
                      }`}
                      aria-hidden="true"
                    >
                      {SOUNDWAVE_HEIGHTS.map((h, idx) => (
                        <span
                          key={idx}
                          className="soundwave-bar"
                          style={{ height: `${h}px` }}
                        />
                      ))}
                    </div>

                    <span
                      className="tabular-nums"
                      style={{
                        fontSize: "0.84rem",
                        fontWeight: 600,
                        color: "#684E3A",
                        flexShrink: 0,
                      }}
                    >
                      {formatTime(mixedDuration)}
                    </span>
                  </div>

                  <div className="step-action-row">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleDownloadMixedWav}
                      disabled={!mixedWavBlob}
                    >
                      <Download size={16} strokeWidth={1.75} />
                      <span>下載合成音檔 (.WAV)</span>
                    </button>

                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleConfirmStep3}
                      disabled={!mixedWavBlob || isGeneratingQr}
                    >
                      <QrCode size={16} strokeWidth={1.75} />
                      <span>
                        {isGeneratingQr
                          ? "正在生成條碼..."
                          : hasGeneratedQr
                          ? "更新專屬 QR Code"
                          : "試聽 OK，生成 QR Code"}
                      </span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        {/* ================= STEP 04: DOWNLOAD QR CODE ================= */}
        <section
          className={`step-panel ${openStep === 4 ? "active" : ""}`}
          aria-label="第四步：專屬條碼"
        >
          <button
            type="button"
            className="step-summary-bar"
            onClick={() => toggleStep(4)}
            aria-expanded={openStep === 4}
          >
            <div className="step-title-left">
              <span className="step-index">04</span>
              <h2 className="step-name">專屬條碼</h2>
            </div>

            <div className="step-meta-right">
              <span className="step-status-text tabular-nums">
                {!hasGeneratedQr
                  ? "請先確認合成聲音"
                  : `#${keepsakeId.toUpperCase()}`}
              </span>
              <ChevronDown size={18} className="step-chevron" />
            </div>
          </button>

          {openStep === 4 && (
            <div className="step-body">
              {!hasGeneratedQr ? (
                <div className="step-empty-notice">
                  <span>
                    請先在「03 試聽合成」試聽您的作品，並點選「試聽 OK，生成 QR Code」。
                  </span>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() =>
                      setOpenStep(
                        hasMixedAudio ? 3 : hasSubmittedVoice ? 2 : 1
                      )
                    }
                  >
                    <span>
                      {hasMixedAudio
                        ? "前往 03 試聽合成"
                        : hasSubmittedVoice
                        ? "前往 02 挑選配樂"
                        : "前往 01 錄下聲音"}
                    </span>
                  </button>
                </div>
              ) : (
                <div className="qr-result-layout">
                  <div className="qr-image-frame">
                    {qrDataUrl ? (
                      <img
                        src={qrDataUrl}
                        alt="港町留聲專屬 QR Code"
                        width={148}
                        height={148}
                        style={{ display: "block" }}
                      />
                    ) : (
                      <QrCode size={96} color="#3A2314" />
                    )}
                  </div>

                  <div style={{ flex: 1 }}>
                    <h3
                      className="display-serif"
                      style={{
                        fontSize: "1.18rem",
                        fontWeight: 700,
                        color: "#3A2314",
                        marginBottom: "6px",
                      }}
                    >
                      您的專屬留聲條碼已完成
                    </h3>
                    <p
                      style={{
                        fontSize: "0.88rem",
                        color: "#684E3A",
                        marginBottom: "14px",
                      }}
                    >
                      未來任何人使用手機相機掃描這張 QR Code，就能直接聽到這段合成好的聲音記憶。
                    </p>

                    <div className="qr-actions-group">
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() =>
                          downloadStandaloneQrPng(listenUrl, keepsakeId)
                        }
                      >
                        <Download size={16} strokeWidth={1.75} />
                        <span>下載 QR Code (.PNG)</span>
                      </button>

                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() =>
                          downloadVinylSleeveCardPng({
                            id: keepsakeId,
                            bgmTitle: mixedBgmTrack.title,
                            durationSeconds: mixedDuration,
                            createdAt: createdAtDate,
                            listenUrl,
                          })
                        }
                      >
                        <Download size={16} strokeWidth={1.75} />
                        <span>下載聲音明信片 (.PNG)</span>
                      </button>

                      <a
                        href={`/listen/${keepsakeId}`}
                        className="btn-secondary"
                      >
                        <ExternalLink size={16} strokeWidth={1.75} />
                        <span>預覽掃碼收聽頁</span>
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
