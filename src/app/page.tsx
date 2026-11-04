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
  KeyRound,
  Volume2,
  ExternalLink,
  Check,
  Monitor,
  Smartphone,
  ArrowRight,
} from "lucide-react";
import { synthesizeOfflineBackingBuffer } from "@/lib/presets";
import { renderAutoDuckedMix, audioBufferToWavBlob } from "@/lib/audio-mixer";
import {
  downloadStandaloneQrPng,
  downloadVinylSleeveCardPng,
} from "@/lib/export-card-png";

type EngineProvider = "offline" | "elevenlabs" | "fal";
type ViewportMode = "desktop" | "mobile";

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

export default function ShiTownVoicePostcardPage() {
  const [viewportMode, setViewportMode] = useState<ViewportMode>("desktop");

  // Strict Step-by-Step Progression (1 -> 2 -> 3 -> 4)
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);

  // Optional API Key Drawer
  const [showKeyDrawer, setShowKeyDrawer] = useState(false);
  const [provider, setProvider] = useState<EngineProvider>("offline");
  const [geminiKey, setGeminiKey] = useState("");
  const [elevenlabsKey, setElevenlabsKey] = useState("");
  const [falKey, setFalKey] = useState("");

  // Step 01: Microphone Recording & Dry Voice Preview
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceBuffer, setVoiceBuffer] = useState<AudioBuffer | null>(null);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [voiceDuration, setVoiceDuration] = useState<number>(10);
  const [hasRecordedCustomVoice, setHasRecordedCustomVoice] = useState(false);
  const [isPlayingVoice, setIsPlayingVoice] = useState(false);

  // Step 02: AI BGM Recommendations (Pick 1 of 2)
  const [bgmOptions, setBgmOptions] = useState<RecommendedBgmTrack[]>(
    TWO_AI_BGM_RECOMMENDATIONS
  );
  const [detectedTone, setDetectedTone] = useState<string>("");
  const [isGeneratingBgmOptions, setIsGeneratingBgmOptions] = useState(false);
  const [bgmBuffers, setBgmBuffers] = useState<Record<string, AudioBuffer>>({});
  const [bgmBlobs, setBgmBlobs] = useState<Record<string, Blob>>({});
  const [selectedBgmId, setSelectedBgmId] = useState<string>("bgm-a");
  const [playingBgmId, setPlayingBgmId] = useState<string | null>(null);

  // Step 03: Auto-Mixed Voice Postcard Audio
  const [isMixing, setIsMixing] = useState(false);
  const [mixedWavBlob, setMixedWavBlob] = useState<Blob | null>(null);
  const [mixedDuration, setMixedDuration] = useState<number>(14);
  const [isPlayingMix, setIsPlayingMix] = useState(false);

  // Step 04: QR Code Generation & Download
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [keepsakeId, setKeepsakeId] = useState<string>("kissa-042");
  const [createdAtDate, setCreatedAtDate] = useState<string>("2026.11.04");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [listenUrl, setListenUrl] = useState<string>("");

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const activeAudioElRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    try {
      const search = new URLSearchParams(window.location.search);
      if (search.get("viewport") === "mobile") {
        setViewportMode("mobile");
      }
      const stepParam = Number(search.get("step"));
      if (stepParam === 1 || stepParam === 2 || stepParam === 3 || stepParam === 4) {
        setCurrentStep(stepParam);
      }
      const savedGemini =
        localStorage.getItem("kissa_openrouter_key") ||
        localStorage.getItem("kissa_gemini_key") ||
        "";
      const savedEleven = localStorage.getItem("kissa_elevenlabs_key") || "";
      const savedFal = localStorage.getItem("kissa_fal_key") || "";
      if (savedGemini) setGeminiKey(savedGemini);
      if (savedEleven) setElevenlabsKey(savedEleven);
      if (savedFal) setFalKey(savedFal);
    } catch {
      // Ignore storage errors
    }

    let cancelled = false;
    (async () => {
      const demoVoice = await createDemoVoiceBuffer();
      const bufA = await synthesizeOfflineBackingBuffer(
        TWO_AI_BGM_RECOMMENDATIONS[0].presetId,
        14
      );
      const bufB = await synthesizeOfflineBackingBuffer(
        TWO_AI_BGM_RECOMMENDATIONS[1].presetId,
        14
      );
      if (cancelled) return;

      setVoiceBuffer(demoVoice);
      setVoiceBlob(audioBufferToWavBlob(demoVoice));
      setVoiceDuration(Math.round(demoVoice.duration));

      setBgmBuffers({
        "bgm-a": bufA,
        "bgm-b": bufB,
      });
      setBgmBlobs({
        "bgm-a": audioBufferToWavBlob(bufA),
        "bgm-b": audioBufferToWavBlob(bufB),
      });

      const initialMix = await renderAutoDuckedMix(demoVoice, bufA, {
        voiceGain: 1.0,
        bgmGain: 0.34,
        duckingDepthDb: 9,
        introSeconds: 1.5,
        outroSeconds: 2.5,
      });
      if (!cancelled) {
        setMixedWavBlob(initialMix.wavBlob);
        setMixedDuration(Math.round(initialMix.durationSeconds));
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
    setPlayingBgmId(null);
    setIsPlayingMix(false);
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
        "未偵測到麥克風權限。您可允許瀏覽器使用麥克風，或直接按「確認送出」使用範例語音體驗。"
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

  // STEP 01 -> STEP 02: Confirm Voice -> Stage 1 (Gemini Audio Analysis writes 2 Prompts) -> Stage 2 (Generate 2 BGM Tracks)
  const handleConfirmStep1 = async () => {
    if (!voiceBuffer || !voiceBlob) return;
    stopAnyPlayback();
    setErrorMessage(null);
    setIsGeneratingBgmOptions(true);

    try {
      // Stage 1: Call /api/analyze-voice so Gemini 2.5 Flash listens to the voice tone & writes 2 tailored prompts
      let activeRecommendations = TWO_AI_BGM_RECOMMENDATIONS;
      try {
        const analysisForm = new FormData();
        analysisForm.append("audio", voiceBlob, "voice.wav");
        if (geminiKey.trim()) {
          analysisForm.append("openrouterApiKey", geminiKey.trim());
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

      // Stage 2: Generate the 2 BGM tracks from the prompts
      const targetLen = Math.max(14, voiceDuration + 4);
      const newBuffers: Record<string, AudioBuffer> = {};
      const newBlobs: Record<string, Blob> = {};

      for (const rec of activeRecommendations) {
        if (provider !== "offline" && (elevenlabsKey.trim() || falKey.trim())) {
          const res = await fetch("/api/generate-bgm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider,
              prompt: rec.prompt,
              mode: rec.mode,
              durationSeconds: targetLen,
              elevenlabsApiKey: elevenlabsKey,
              falApiKey: falKey,
              falModel: "fal-ai/stable-audio",
            }),
          });
          if (res.ok) {
            const cloudBlob = await res.blob();
            const decoded = await decodeBlobToAudioBuffer(cloudBlob);
            newBuffers[rec.id] = decoded;
            newBlobs[rec.id] = audioBufferToWavBlob(decoded);
            continue;
          }
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
      setCurrentStep(2);
    } catch {
      setErrorMessage("準備背景音樂時發生錯誤，請再試一次。");
    } finally {
      setIsGeneratingBgmOptions(false);
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
        voiceGain: 1.0,
        bgmGain: 0.34,
        duckingDepthDb: 9,
        introSeconds: 1.5,
        outroSeconds: 2.5,
      });
      setMixedWavBlob(result.wavBlob);
      setMixedDuration(Math.round(result.durationSeconds));
      setCurrentStep(3);
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
      setCurrentStep(4);
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

  const handleSaveApiKeys = () => {
    try {
      localStorage.setItem("kissa_openrouter_key", geminiKey.trim());
      localStorage.setItem("kissa_gemini_key", geminiKey.trim());
      localStorage.setItem("kissa_elevenlabs_key", elevenlabsKey.trim());
      localStorage.setItem("kissa_fal_key", falKey.trim());
      setShowKeyDrawer(false);
    } catch {
      setShowKeyDrawer(false);
    }
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const activeBgmTrack =
    bgmOptions.find((t) => t.id === selectedBgmId) ||
    bgmOptions[0];

  const studioBody = (
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

      {/* 4-Step Progressive Stack (Only active step expands!) */}
      <div className="step-stack">
        {/* ================= STEP 01: RECORD VOICE ================= */}
        <section
          className={`step-panel ${currentStep === 1 ? "active" : ""}`}
          aria-label="第一步：錄下您的聲音"
        >
          <div className="step-summary-bar">
            <div className="step-title-left">
              <span className="step-index">01</span>
              <h2 className="step-name">錄下您的聲音</h2>
            </div>

            <div className="step-meta-right">
              <span className="tabular-nums">
                {isRecording
                  ? `錄音中 ${formatTime(recordingSeconds)}`
                  : hasRecordedCustomVoice
                  ? `已錄製 ${formatTime(voiceDuration)}`
                  : `長度 ${formatTime(voiceDuration)}`}
              </span>
              {currentStep > 1 && (
                <button
                  type="button"
                  className="btn-text-edit"
                  onClick={() => {
                    stopAnyPlayback();
                    setCurrentStep(1);
                  }}
                >
                  重新錄音
                </button>
              )}
            </div>
          </div>

          {currentStep === 1 && (
            <div className="step-body">
              <p className="step-instruction">
                請點擊「開始錄音」錄下您想說的話，錄完後可先試聽，確認無誤後點選「確認送出」。
              </p>

              <div className="step-action-row">
                <div className="step-action-left">
                  {!isRecording ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleStartRecording}
                    >
                      <Mic size={16} strokeWidth={1.75} />
                      <span>開始麥克風錄音</span>
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

                  {voiceBlob && (
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
                          <span>試聽乾音</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleConfirmStep1}
                  disabled={isRecording || isGeneratingBgmOptions}
                >
                  <span>
                    {isGeneratingBgmOptions
                      ? "AI 正在配樂中..."
                      : "確認送出，交給 AI 配樂"}
                  </span>
                  <ArrowRight size={16} strokeWidth={1.75} />
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ================= STEP 02: PICK 1 OF 2 AI BGM ================= */}
        <section
          className={`step-panel ${
            currentStep === 2 ? "active" : currentStep < 2 ? "locked" : ""
          }`}
          aria-label="第二步：挑選背景音樂"
        >
          <div className="step-summary-bar">
            <div className="step-title-left">
              <span className="step-index">02</span>
              <h2 className="step-name">挑選 AI 背景音樂</h2>
            </div>

            <div className="step-meta-right">
              {currentStep < 2 ? (
                <span>完成第一步後開啟</span>
              ) : (
                <>
                  <span>{activeBgmTrack.title}</span>
                  {currentStep > 2 && (
                    <button
                      type="button"
                      className="btn-text-edit"
                      onClick={() => {
                        stopAnyPlayback();
                        setCurrentStep(2);
                      }}
                    >
                      更換配樂
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {currentStep === 2 && (
            <div className="step-body">
              <p className="step-instruction">
                {detectedTone
                  ? `AI 聽取語音後偵測語調為「${detectedTone}」，為您量身挑選以下兩首背景音樂：`
                  : "AI 已為您的聲音挑選兩首適合的背景音樂，請點選其中一首並按「確認配樂，開始合成」。"}
              </p>

              <div className="bgm-option-list" role="radiogroup" aria-label="AI 推薦配樂選項">
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
                          <div className="bgm-option-title">{track.title}</div>
                          <div className="bgm-option-desc">
                            {track.description}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ padding: "7px 14px", fontSize: "0.82rem" }}
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

              <div className="step-action-row" style={{ justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleConfirmStep2}
                  disabled={isMixing}
                >
                  <span>
                    {isMixing ? "正在合成聲音..." : "確認配樂，開始合成"}
                  </span>
                  <ArrowRight size={16} strokeWidth={1.75} />
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ================= STEP 03: PREVIEW MIXED AUDIO ================= */}
        <section
          className={`step-panel ${
            currentStep === 3 ? "active" : currentStep < 3 ? "locked" : ""
          }`}
          aria-label="第三步：試聽合成聲音"
        >
          <div className="step-summary-bar">
            <div className="step-title-left">
              <span className="step-index">03</span>
              <h2 className="step-name">試聽合成聲音</h2>
            </div>

            <div className="step-meta-right">
              {currentStep < 3 ? (
                <span>完成第二步後開啟</span>
              ) : (
                <>
                  <span className="tabular-nums">
                    合成完成 ({formatTime(mixedDuration)})
                  </span>
                  {currentStep > 3 && (
                    <button
                      type="button"
                      className="btn-text-edit"
                      onClick={() => {
                        stopAnyPlayback();
                        setCurrentStep(3);
                      }}
                    >
                      返回試聽
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {currentStep === 3 && (
            <div className="step-body">
              <p className="step-instruction">
                已將您的聲音與「{activeBgmTrack.title}」完成合成。請點擊下方按鈕試聽，確認沒問題即可生成專屬 QR Code。
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
                      <span>試聽合成聲音</span>
                    </>
                  )}
                </button>

                <div
                  className={`soundwave-bars ${isPlayingMix ? "playing" : ""}`}
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
                      ? "正在生成 QR Code..."
                      : "試聽 OK，生成 QR Code"}
                  </span>
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ================= STEP 04: DOWNLOAD QR CODE ================= */}
        <section
          className={`step-panel ${
            currentStep === 4 ? "active" : currentStep < 4 ? "locked" : ""
          }`}
          aria-label="第四步：專屬留聲 QR Code"
        >
          <div className="step-summary-bar">
            <div className="step-title-left">
              <span className="step-index">04</span>
              <h2 className="step-name">專屬留聲 QR Code</h2>
            </div>

            <div className="step-meta-right">
              {currentStep < 4 ? (
                <span>確認合成後生成</span>
              ) : (
                <span className="tabular-nums">
                  編號 #{keepsakeId.toUpperCase()}
                </span>
              )}
            </div>
          </div>

          {currentStep === 4 && (
            <div className="step-body">
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

                <div>
                  <h3
                    className="display-serif"
                    style={{
                      fontSize: "1.2rem",
                      fontWeight: 700,
                      color: "#3A2314",
                      marginBottom: "6px",
                    }}
                  >
                    您的專屬留聲 QR Code 已完成
                  </h3>
                  <p
                    style={{
                      fontSize: "0.9rem",
                      color: "#684E3A",
                      marginBottom: "14px",
                    }}
                  >
                    未來任何人使用手機相機掃描這張 QR Code，就能直接聽到這段合成好的聲音記憶。
                  </p>

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "10px",
                    }}
                  >
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
                          bgmTitle: activeBgmTrack.title,
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
            </div>
          )}
        </section>
      </div>
    </main>
  );

  return (
    <div>
      {/* Discreet Top Utility Bar */}
      <div className="utility-topbar">
        <span className="utility-brand-note">
          蒔町・拾光事務所｜03 港町留聲計畫
        </span>

        <div className="utility-actions">
          <div
            className="viewport-toggle-group"
            role="group"
            aria-label="電腦版與手機版視角切換"
          >
            <button
              type="button"
              className={`viewport-toggle-btn ${
                viewportMode === "desktop" ? "active" : ""
              }`}
              onClick={() => setViewportMode("desktop")}
            >
              <Monitor size={14} strokeWidth={1.75} />
              <span>電腦版</span>
            </button>
            <button
              type="button"
              className={`viewport-toggle-btn ${
                viewportMode === "mobile" ? "active" : ""
              }`}
              onClick={() => setViewportMode("mobile")}
            >
              <Smartphone size={14} strokeWidth={1.75} />
              <span>手機版 (390px)</span>
            </button>
          </div>

          <button
            type="button"
            className="utility-key-btn"
            onClick={() => setShowKeyDrawer((v) => !v)}
            aria-expanded={showKeyDrawer}
          >
            <KeyRound size={14} strokeWidth={1.75} />
            <span>API 金鑰</span>
          </button>
        </div>
      </div>

      {/* Collapsible API Key Bar (Kept temporarily) */}
      {showKeyDrawer && (
        <section
          aria-label="API 金鑰暫存設定區"
          style={{
            maxWidth: "720px",
            margin: "12px auto 0",
            padding: "16px 20px",
            backgroundColor: "#EFE7DA",
            border: "1px solid #C4B097",
            borderRadius: "8px",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "12px",
              alignItems: "end",
            }}
          >
            <div>
              <label
                htmlFor="input-gemini"
                style={{
                  display: "block",
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  marginBottom: "4px",
                }}
              >
                1. OpenRouter Key (Gemini 2.5 聽語調)
              </label>
              <input
                id="input-gemini"
                type="password"
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                placeholder="sk-or-v1-..."
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: "1px solid #C4B097",
                  backgroundColor: "#FBF8F3",
                  color: "#3A2314",
                  fontSize: "0.84rem",
                }}
              />
            </div>

            <div>
              <label
                htmlFor="select-provider"
                style={{
                  display: "block",
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  marginBottom: "4px",
                }}
              >
                2. 配樂生成引擎
              </label>
              <select
                id="select-provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value as EngineProvider)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: "1px solid #C4B097",
                  backgroundColor: "#FBF8F3",
                  color: "#3A2314",
                  fontSize: "0.84rem",
                }}
              >
                <option value="offline">內建離線音源 (免金鑰)</option>
                <option value="elevenlabs">ElevenLabs API</option>
                <option value="fal">Fal.ai API</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="input-eleven"
                style={{
                  display: "block",
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  marginBottom: "4px",
                }}
              >
                ElevenLabs Key
              </label>
              <input
                id="input-eleven"
                type="password"
                value={elevenlabsKey}
                onChange={(e) => setElevenlabsKey(e.target.value)}
                placeholder="sk_..."
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: "1px solid #C4B097",
                  backgroundColor: "#FBF8F3",
                  color: "#3A2314",
                  fontSize: "0.84rem",
                }}
              />
            </div>

            <div>
              <label
                htmlFor="input-fal"
                style={{
                  display: "block",
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  marginBottom: "4px",
                }}
              >
                Fal.ai Key
              </label>
              <input
                id="input-fal"
                type="password"
                value={falKey}
                onChange={(e) => setFalKey(e.target.value)}
                placeholder="key_id:secret"
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: "1px solid #C4B097",
                  backgroundColor: "#FBF8F3",
                  color: "#3A2314",
                  fontSize: "0.84rem",
                }}
              />
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                className="btn-primary"
                style={{ padding: "8px 14px", fontSize: "0.82rem" }}
                onClick={handleSaveApiKeys}
              >
                <Check size={14} strokeWidth={1.75} />
                <span>儲存</span>
              </button>
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: "8px 14px", fontSize: "0.82rem" }}
                onClick={() => setShowKeyDrawer(false)}
              >
                <span>收起</span>
              </button>
            </div>
          </div>
        </section>
      )}

      {viewportMode === "mobile" ? (
        <div className="mobile-preview-backdrop">
          <div className="mobile-preview-frame">{studioBody}</div>
        </div>
      ) : (
        studioBody
      )}
    </div>
  );
}
