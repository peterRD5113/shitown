import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      provider,
      prompt,
      mode = "music",
      durationSeconds = 20,
      elevenlabsApiKey,
      falApiKey,
      falModel = "fal-ai/stable-audio",
    } = body as {
      provider: "elevenlabs" | "fal";
      prompt: string;
      mode?: "music" | "ambience";
      durationSeconds?: number;
      elevenlabsApiKey?: string;
      falApiKey?: string;
      falModel?: string;
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
          {
            error:
              "尚未設定 ElevenLabs API Key。請點擊右上角「API 金鑰設定」填入，或切換至「內建離線範例音」直接體驗。",
          },
          { status: 401 }
        );
      }

      if (mode === "ambience") {
        // ElevenLabs Sound Generation API with seamless loop
        const safeSeconds = Math.max(5, Math.min(30, Math.round(durationSeconds)));
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
        // ElevenLabs Music API with force_instrumental: true
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
          {
            error:
              "尚未設定 Fal.ai API Key (FAL_KEY)。請點擊右上角「API 金鑰設定」填入，或切換至「內建離線範例音」直接體驗。",
          },
          { status: 401 }
        );
      }

      const endpoint = falModel || "fal-ai/stable-audio";
      const safeSeconds = Math.max(10, Math.min(45, Math.round(durationSeconds + 4)));

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
