"use client";

import React, { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Play,
  Pause,
  Download,
  ArrowLeft,
} from "lucide-react";
import { synthesizeOfflineBackingBuffer } from "@/lib/presets";
import { renderAutoDuckedMix } from "@/lib/audio-mixer";

interface KeepsakeRecord {
  id: string;
  recipientTitle: string;
  senderName: string;
  transcript: string;
  moodLabel: string;
  presetId: string;
  presetTitle: string;
  durationSeconds: number;
  createdAt: string;
  audioUrl: string | null;
  photoDataUrl?: string | null;
}

const SOUNDWAVE_HEIGHTS = [
  12, 20, 32, 16, 38, 26, 16, 36, 40, 24, 34, 20, 36, 28, 18, 30, 22, 12,
];

async function createFallbackVoiceBuffer(sampleRate = 44100): Promise<AudioBuffer> {
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
    if (!phrases.some(([s, e]) => t >= s && t <= e)) continue;
    const env = Math.max(
      0,
      Math.sin(2 * Math.PI * 3.2 * t) * 0.65 +
        Math.sin(2 * Math.PI * 1.6 * t) * 0.35
    );
    const f0 = 168 + 20 * Math.sin(2 * Math.PI * 0.8 * t);
    data[i] =
      (Math.sin(2 * Math.PI * f0 * t) * 0.55 +
        Math.sin(2 * Math.PI * f0 * 2 * t) * 0.28) *
      env *
      0.55;
  }
  return buffer;
}

export default function ListenShiTownPostcardPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id || "shitown-001";

  const [record, setRecord] = useState<KeepsakeRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [playableUrl, setPlayableUrl] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioBytesRef = useRef<ArrayBuffer | null>(null);
  const webAudioCtxRef = useRef<AudioContext | null>(null);
  const webAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const webAudioRafRef = useRef<number | null>(null);

  const stopWebAudioFallback = () => {
    if (webAudioRafRef.current !== null) {
      cancelAnimationFrame(webAudioRafRef.current);
      webAudioRafRef.current = null;
    }
    if (webAudioSourceRef.current) {
      try {
        webAudioSourceRef.current.onended = null;
        webAudioSourceRef.current.stop();
        webAudioSourceRef.current.disconnect();
      } catch {
        // Ignore if already stopped
      }
      webAudioSourceRef.current = null;
    }
  };

  useEffect(() => {
    let cancelled = false;
    let createdObjectUrl: string | null = null;

    (async () => {
      try {
        const res = await fetch(`/api/keepsakes?id=${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        if (res.ok) {
          const data: KeepsakeRecord = await res.json();
          if (cancelled) return;
          if (!data.photoDataUrl) {
            data.photoDataUrl = "/sample-postcard-photo.svg";
          }
          setRecord(data);

          let loadedBlob: Blob | null = null;

          if (data.audioUrl) {
            // Preload audio into local in-memory Blob (same reliable playback mechanism as Step 03)
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                const audioRes = await fetch(data.audioUrl);
                if (audioRes.ok) {
                  const ab = await audioRes.arrayBuffer();
                  if (ab.byteLength > 44) {
                    audioBytesRef.current = ab;
                    loadedBlob = new Blob([ab], { type: "audio/wav" });
                    break;
                  }
                }
              } catch {
                // Retry once or twice in case KV edge replication is still settling
              }
              if (attempt < 2) {
                await new Promise((r) => setTimeout(r, 450));
              }
            }
          }

          if (!loadedBlob) {
            const vBuf = await createFallbackVoiceBuffer();
            const bBuf = await synthesizeOfflineBackingBuffer(
              data.presetId || "warm-guitar-piano",
              14
            );
            const mixed = await renderAutoDuckedMix(vBuf, bBuf, {
              voiceGain: 1.0,
              bgmGain: 0.34,
              duckingDepthDb: 9,
            });
            loadedBlob = mixed.wavBlob;
            audioBytesRef.current = await mixed.wavBlob.arrayBuffer();
          }

          if (!cancelled && loadedBlob) {
            createdObjectUrl = URL.createObjectURL(loadedBlob);
            setPlayableUrl(createdObjectUrl);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      stopWebAudioFallback();
      if (createdObjectUrl) {
        URL.revokeObjectURL(createdObjectUrl);
      }
    };
  }, [id]);

  const startWebAudioFallback = async (): Promise<boolean> => {
    const rawBytes = audioBytesRef.current;
    if (!rawBytes) return false;
    try {
      stopWebAudioFallback();
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!webAudioCtxRef.current || webAudioCtxRef.current.state === "closed") {
        webAudioCtxRef.current = new Ctx();
      }
      const ctx = webAudioCtxRef.current;
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      const decoded = await ctx.decodeAudioData(rawBytes.slice(0));
      const source = ctx.createBufferSource();
      source.buffer = decoded;
      source.connect(ctx.destination);

      const startTime = ctx.currentTime;
      const totalDur = decoded.duration || record?.durationSeconds || 14;

      const tick = () => {
        const elapsed = Math.min(totalDur, ctx.currentTime - startTime);
        setCurrentTimeSec(elapsed);
        setProgressPct(totalDur > 0 ? Math.min(100, (elapsed / totalDur) * 100) : 0);
        if (elapsed < totalDur) {
          webAudioRafRef.current = requestAnimationFrame(tick);
        }
      };

      source.onended = () => {
        stopWebAudioFallback();
        setIsPlaying(false);
        setProgressPct(0);
        setCurrentTimeSec(0);
      };

      webAudioSourceRef.current = source;
      source.start(0);
      setIsPlaying(true);
      webAudioRafRef.current = requestAnimationFrame(tick);
      return true;
    } catch {
      return false;
    }
  };

  const togglePlay = async () => {
    if (!playableUrl) return;

    // Configure iOS 17+ audioSession to "playback" so sound plays even if hardware mute switch is on
    try {
      const nav = navigator as Navigator & {
        audioSession?: { type: string };
      };
      if (nav.audioSession) {
        nav.audioSession.type = "playback";
      }
    } catch {
      // Ignore on browsers without audioSession API
    }

    if (isPlaying) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      stopWebAudioFallback();
      setIsPlaying(false);
      return;
    }

    const audio = audioRef.current;
    if (audio) {
      try {
        audio.muted = false;
        audio.volume = 1.0;
        if (audio.src !== playableUrl) {
          audio.src = playableUrl;
          audio.load();
        }
        await audio.play();
        setIsPlaying(true);
        return;
      } catch {
        // Fallback to Web Audio API below if HTMLAudioElement playback is blocked or unsupported
      }
    }

    await startWebAudioFallback();
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const listenerBody = (
    <main className="atelier-wrapper" style={{ maxWidth: "560px" }}>
      <header className="brand-hero">
        <img
          src="/shitown-logo.png?v=3"
          alt="蒔町 SHI TOWN"
          className="brand-logo-img"
        />
        <h1>港町留聲計畫・聲音明信片</h1>
        <p>讓值得記住的聲音，成為可以收藏的記憶</p>
      </header>

      {loading ? (
        <section className="step-panel" style={{ padding: "36px 24px", textAlign: "center" }}>
          <p className="display-serif" style={{ fontSize: "1.15rem" }}>
            正在載入聲音明信片...
          </p>
        </section>
      ) : !record ? (
        <section className="step-panel" style={{ padding: "36px 24px", textAlign: "center" }}>
          <h2 className="display-serif" style={{ fontSize: "1.35rem", marginBottom: "8px" }}>
            找不到這張聲音明信片
          </h2>
          <p style={{ fontSize: "0.9rem", color: "#684E3A" }}>
            請返回製作頁重新錄製並生成專屬 QR Code。
          </p>
        </section>
      ) : (
        <section className="step-panel active" style={{ padding: "28px 24px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              fontSize: "0.84rem",
              color: "#684E3A",
              marginBottom: "18px",
            }}
          >
            <span>配樂：{record.presetTitle}</span>
            <span className="tabular-nums">#{record.id.toUpperCase()}</span>
          </div>

          {record.photoDataUrl && (
            <figure className="listen-photo-frame">
              <div className="listen-photo-stage">
                <img
                  src={record.photoDataUrl}
                  alt="聲音明信片紀念照片"
                  className="listen-photo-img"
                />
              </div>
            </figure>
          )}

          {/* Soundwave Line */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "16px 0",
            }}
          >
            <div style={{ height: "1px", flex: 1, backgroundColor: "#C4B097" }} />
            <div
              className={`soundwave-bars ${isPlaying ? "playing" : ""}`}
              style={{ flex: "0 0 auto", height: "42px" }}
            >
              {SOUNDWAVE_HEIGHTS.map((h, i) => (
                <span
                  key={i}
                  className="soundwave-bar"
                  style={{ height: `${h}px` }}
                />
              ))}
            </div>
            <div style={{ height: "1px", flex: 1, backgroundColor: "#C4B097" }} />
          </div>

          {/* Progress Bar */}
          <div
            style={{
              height: "5px",
              backgroundColor: "#DFD2C0",
              borderRadius: "3px",
              overflow: "hidden",
              marginBottom: "8px",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progressPct}%`,
                backgroundColor: "#4A2B18",
                transition: "width 150ms linear",
              }}
            />
          </div>

          <div
            className="tabular-nums"
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "0.78rem",
              color: "#684E3A",
              marginBottom: "22px",
            }}
          >
            <span>{formatTime(currentTimeSec)}</span>
            <span>{formatTime(record.durationSeconds)}</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <audio
              ref={audioRef}
              src={playableUrl || undefined}
              preload="auto"
              playsInline
              style={{ display: "none" }}
              onTimeUpdate={(e) => {
                const el = e.currentTarget;
                setCurrentTimeSec(el.currentTime);
                const totalDur =
                  Number.isFinite(el.duration) && el.duration > 0
                    ? el.duration
                    : record.durationSeconds || 14;
                if (totalDur > 0) {
                  setProgressPct(
                    Math.min(100, (el.currentTime / totalDur) * 100)
                  );
                }
              }}
              onEnded={() => {
                setIsPlaying(false);
                setProgressPct(0);
                setCurrentTimeSec(0);
              }}
            />

            <button
              type="button"
              className="btn-primary"
              onClick={togglePlay}
              disabled={!playableUrl}
              style={{ width: "100%", padding: "13px 20px" }}
            >
              {isPlaying ? (
                <>
                  <Pause size={17} strokeWidth={1.75} />
                  <span>暫停播放</span>
                </>
              ) : (
                <>
                  <Play size={17} strokeWidth={1.75} />
                  <span>點擊播放這段聲音記憶</span>
                </>
              )}
            </button>

            {playableUrl && (
              <a
                href={playableUrl}
                download={`shitown-voice-${record.id}.wav`}
                className="btn-secondary"
                style={{ width: "100%" }}
              >
                <Download size={16} strokeWidth={1.75} />
                <span>下載保存聲音檔案 (.WAV)</span>
              </a>
            )}
          </div>
        </section>
      )}
    </main>
  );

  return (
    <div>
      <div className="utility-topbar">
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "0.84rem",
            fontWeight: 600,
            color: "#3A2314",
            textDecoration: "none",
          }}
        >
          <ArrowLeft size={15} strokeWidth={1.75} />
          <span>返回製作頁</span>
        </Link>
      </div>

      {listenerBody}
    </div>
  );
}
