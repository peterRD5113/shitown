import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      provider = "fal",
      prompt,
      mode = "music",
      durationSeconds = 20,
      elevenlabsApiKey,
      falApiKey,
      falModel = "fal-ai/stable-audio",
      referenceAudioDataUrl,
      referenceStrength = 0.75,
    } = body as {
      provider?: "elevenlabs" | "fal";
      prompt: string;
      mode?: "music" | "ambience";
      durationSeconds?: number;
      elevenlabsApiKey?: string;
      falApiKey?: string;
      falModel?: string;
      referenceAudioDataUrl?: string;
      referenceStrength?: number;
    };

    if (!prompt || !prompt.trim()) {
      return NextResponse.json(
        { error: "請輸入或選擇背景音樂描述 (Prompt)。" },
        { status: 400 }
      );
    }

    if (provider === "elevenlabs") {
      const apiKey =
        elevenlabsApiKey?.trim() || process.env.ELEVENLABS_API_KEY || "";
      if (!apiKey) {
        return NextResponse.json(
          { error: "尚未設定 ElevenLabs API Key。" },
          { status: 401 }
        );
      }

      if (mode === "ambience") {
        const safeSeconds = Math.max(
          5,
          Math.min(30, Math.round(durationSeconds))
        );
        const res = await fetch(
          "https://api.elevenlabs.io/v1/sound-generation",
          {
            method: "POST",
            headers: {
              "xi-api-key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              text: prompt,
              duration_seconds: safeSeconds,
              prompt_influence: 0.4,
              loop: true,
            }),
          }
        );

        if (!res.ok) {
          const errText = await res.text();
          return NextResponse.json(
            {
              error: `ElevenLabs 環境音 API 回傳錯誤 (${res.status})：${errText}`,
            },
            { status: res.status }
          );
        }

        const audioArrayBuffer = await res.arrayBuffer();
        return new NextResponse(audioArrayBuffer, {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "X-Generator-Provider": "elevenlabs-sfx-loop",
          },
        });
      } else {
        const lengthMs = Math.max(
          10000,
          Math.min(180000, Math.round((durationSeconds + 4) * 1000))
        );
        const res = await fetch("https://api.elevenlabs.io/v1/music", {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt,
            music_length_ms: lengthMs,
            force_instrumental: true,
            model_id: "music_v1",
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          return NextResponse.json(
            {
              error: `ElevenLabs Music API 回傳錯誤 (${res.status})：${errText}`,
            },
            { status: res.status }
          );
        }

        const audioArrayBuffer = await res.arrayBuffer();
        return new NextResponse(audioArrayBuffer, {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "X-Generator-Provider": "elevenlabs-music-instrumental",
          },
        });
      }
    }

    if (provider === "fal") {
      const apiKey = falApiKey?.trim() || process.env.FAL_KEY || "";
      if (!apiKey) {
        return NextResponse.json(
          { error: "尚未設定 Fal.ai API Key (FAL_KEY)。" },
          { status: 401 }
        );
      }

      const safeSeconds = Math.max(
        10,
        Math.min(45, Math.round(durationSeconds + 4))
      );

      // Approach B: If user uploaded a reference audio clip, run Stable Audio 2.5 Audio-to-Audio first!
      if (referenceAudioDataUrl && referenceAudioDataUrl.startsWith("data:audio/")) {
        try {
          const a2aRes = await fetch(
            "https://fal.run/fal-ai/stable-audio-25/audio-to-audio",
            {
              method: "POST",
              headers: {
                Authorization: `Key ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                prompt,
                audio_url: referenceAudioDataUrl,
                strength: referenceStrength,
                total_seconds: safeSeconds,
              }),
            }
          );

          if (a2aRes.ok) {
            const a2aData = await a2aRes.json();
            const a2aUrl =
              a2aData?.audio?.url ||
              a2aData?.audio_file?.url ||
              a2aData?.audio_url ||
              null;
            if (a2aUrl) {
              const audioFetch = await fetch(a2aUrl);
              if (audioFetch.ok) {
                const audioBuffer = await audioFetch.arrayBuffer();
                return new NextResponse(audioBuffer, {
                  status: 200,
                  headers: {
                    "Content-Type":
                      audioFetch.headers.get("content-type") || "audio/wav",
                    "X-Generator-Provider":
                      "fal:fal-ai/stable-audio-25/audio-to-audio",
                  },
                });
              }
            }
          }
        } catch {
          // If audio-to-audio endpoint times out or fails, gracefully fall through to text-to-audio below
        }
      }

      // Standard Text-to-Audio generation (using Gemini's detailed prompt)
      const endpoint = falModel || "fal-ai/stable-audio";
      const falRes = await fetch(`https://fal.run/${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Key ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          seconds_total: safeSeconds,
          duration: safeSeconds,
        }),
      });

      if (!falRes.ok) {
        const errText = await falRes.text();
        return NextResponse.json(
          { error: `Fal.ai API 回傳錯誤 (${falRes.status})：${errText}` },
          { status: falRes.status }
        );
      }

      const falData = await falRes.json();
      const audioUrl =
        falData?.audio_file?.url ||
        falData?.audio?.url ||
        falData?.audio_url ||
        null;

      if (!audioUrl) {
        return NextResponse.json(
          { error: "Fal.ai 未回傳有效的音訊 URL。" },
          { status: 502 }
        );
      }

      const audioFetch = await fetch(audioUrl);
      const audioBuffer = await audioFetch.arrayBuffer();
      return new NextResponse(audioBuffer, {
        status: 200,
        headers: {
          "Content-Type":
            audioFetch.headers.get("content-type") || "audio/wav",
          "X-Generator-Provider": `fal:${endpoint}`,
        },
      });
    }

    return NextResponse.json(
      { error: "不支援的音訊生成引擎。" },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "生成背景音時發生伺服器錯誤",
      },
      { status: 500 }
    );
  }
}
