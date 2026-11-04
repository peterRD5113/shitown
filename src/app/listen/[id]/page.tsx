"use client";

import React, { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Play,
  Pause,
  Download,
  ArrowLeft,
  Monitor,
  Smartphone,
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
  const id = params?.id || "kissa-042";

  const [viewportMode, setViewportMode] = useState<"desktop" | "mobile">("desktop");
  const [record, setRecord] = useState<KeepsakeRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [playableUrl, setPlayableUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    try {
      const search = new URLSearchParams(window.location.search);
      if (search.get("viewport") === "mobile") {
        setViewportMode("mobile");
      }
    } catch {
      // Ignore
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/keepsakes?id=${encodeURIComponent(id)}`);
        if (res.ok) {
          const data: KeepsakeRecord = await res.json();
          if (cancelled) return;
          setRecord(data);

          if (data.audioUrl) {
            setPlayableUrl(data.audioUrl);
          } else {
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
            if (!cancelled) {
              setPlayableUrl(URL.createObjectURL(mixed.wavBlob));
            }
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const togglePlay = () => {
    if (!playableUrl) return;
    if (!audioRef.current) {
      const audio = new Audio(playableUrl);
      audioRef.current = audio;
      audio.ontimeupdate = () => {
        setCurrentTimeSec(audio.currentTime);
        if (audio.duration > 0) {
          setProgressPct((audio.currentTime / audio.duration) * 100);
        }
      };
      audio.onended = () => {
        setIsPlaying(false);
        setProgressPct(0);
        setCurrentTimeSec(0);
      };
    }

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
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
            <button
              type="button"
              className="btn-primary"
              onClick={togglePlay}
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
      </div>

      {viewportMode === "mobile" ? (
        <div className="mobile-preview-backdrop">
          <div className="mobile-preview-frame">{listenerBody}</div>
        </div>
      ) : (
        listenerBody
      )}
    </div>
  );
}
