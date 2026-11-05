import { NextRequest, NextResponse } from "next/server";

const VOICE_ONLY_PROMPT = `You are the music director for "蒔町・拾光事務所 (SHI TOWN) — 港町留聲計畫".
Listen carefully to the user's spoken voice recording (pay attention to both their spoken words AND their vocal tone, pacing, warmth, and emotion).
Return ONLY a valid JSON object (no markdown fences, no extra text) with the following structure:
{
  "detectedTone": "A short Traditional Chinese description of their vocal tone and emotion (e.g. 語調溫和真摯、語速從容)",
  "recommendations": [
    {
      "id": "bgm-a",
      "title": "A poetic 6-10 character Traditional Chinese BGM title for Option A",
      "description": "1 sentence in Traditional Chinese explaining why this music fits their voice tone",
      "presetId": "One of: warm-guitar-piano | cafe-rain | midnight-lofi | ocean-breeze | cinematic-strings | campfire-night",
      "mode": "music",
      "prompt": "Detailed English prompt for an AI music generator (under 35 words, specifying instruments, tempo, and mood, ending with 'instrumental only, no vocals, gentle background for spoken voiceover')"
    },
    {
      "id": "bgm-b",
      "title": "A contrasting poetic 6-10 character Traditional Chinese BGM title for Option B",
      "description": "1 sentence in Traditional Chinese explaining why this second option fits their voice tone",
      "presetId": "A different presetId from Option A",
      "mode": "ambience",
      "prompt": "Detailed English prompt for Option B (under 35 words, ending with 'instrumental only, no vocals, gentle background for spoken voiceover')"
    }
  ]
}`;

const VOICE_AND_REFERENCE_PROMPT = `You are the music director for "蒔町・拾光事務所 (SHI TOWN) — 港町留聲計畫".
You are given TWO audio recordings:
- Audio #1 is the user's spoken voice recording.
- Audio #2 is a reference music track uploaded by the user that they love.

Listen carefully to BOTH recordings:
1. Analyze Audio #2 (the reference music) for its exact musical style, key instruments, tempo (BPM), rhythm groove, harmonic warmth, and acoustic texture (ignore any singing vocals if present in Audio #2 — we only want pure instrumental background music).
2. Listen to Audio #1 (the user's voice tone and pacing) so the generated music sits warmly behind their voice.

Return ONLY a valid JSON object (no markdown fences, no extra text) with the following structure:
{
  "detectedTone": "A short Traditional Chinese summary of their voice tone + the reference music style (e.g. 語調溫暖從容・參考曲風：指彈木吉他與柔和鋼琴慢板)",
  "recommendations": [
    {
      "id": "bgm-a",
      "title": "A poetic 6-10 character Traditional Chinese BGM title inspired by the reference music (Option A: Closest to reference)",
      "description": "1 sentence in Traditional Chinese explaining how this track recreates the uploaded reference music's instruments and vibe to back their voice",
      "presetId": "One of: warm-guitar-piano | cafe-rain | midnight-lofi | ocean-breeze | cinematic-strings | campfire-night",
      "mode": "music",
      "prompt": "Detailed English prompt (under 40 words) closely describing the reference music's exact instruments, tempo/BPM, chord mood, and texture, ending with 'instrumental only, no vocals, warm background for spoken voiceover'"
    },
    {
      "id": "bgm-b",
      "title": "A poetic 6-10 character Traditional Chinese BGM title (Option B: Softer acoustic variation of the reference)",
      "description": "1 sentence in Traditional Chinese explaining how this softer variation of the reference music complements their spoken words",
      "presetId": "A different presetId from Option A",
      "mode": "ambience",
      "prompt": "Detailed English prompt (under 40 words) for a gentler, more atmospheric variation of the reference music's style and instruments, ending with 'instrumental only, no vocals, gentle background for spoken voiceover'"
    }
  ]
}`;

function extractJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
  }
  return JSON.parse(cleaned);
}

function getAudioFormat(mimeType: string): "mp3" | "ogg" | "wav" {
  if (mimeType.includes("mp3") || mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("ogg")) return "ogg";
  return "wav";
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio") as File | null;
    const referenceFile = formData.get("referenceAudio") as File | null;

    const rawKey =
      (formData.get("openrouterApiKey") as string | null)?.trim() ||
      (formData.get("geminiApiKey") as string | null)?.trim() ||
      process.env.OPENROUTER_API_KEY ||
      process.env.GEMINI_API_KEY ||
      "";
    const openrouterModel =
      (formData.get("openrouterModel") as string | null)?.trim() ||
      "google/gemini-2.5-flash";

    if (!audioFile) {
      return NextResponse.json(
        { error: "未收到語音檔案，請先錄下您的聲音。" },
        { status: 400 }
      );
    }

    if (rawKey) {
      const arrayBuffer = await audioFile.arrayBuffer();
      const base64Audio = Buffer.from(arrayBuffer).toString("base64");
      const mimeType = audioFile.type || "audio/wav";
      const audioFormat = getAudioFormat(mimeType);

      let refBase64: string | null = null;
      let refMimeType = "audio/wav";
      let refFormat: "mp3" | "ogg" | "wav" = "wav";

      if (referenceFile && referenceFile.size > 0) {
        const refBuf = await referenceFile.arrayBuffer();
        refBase64 = Buffer.from(refBuf).toString("base64");
        refMimeType = referenceFile.type || "audio/wav";
        refFormat = getAudioFormat(refMimeType);
      }

      const activePromptText = refBase64
        ? VOICE_AND_REFERENCE_PROMPT
        : VOICE_ONLY_PROMPT;

      const isDirectGoogleKey = rawKey.startsWith("AIza");

      if (!isDirectGoogleKey) {
        const contentParts: Array<Record<string, unknown>> = [
          {
            type: "text",
            text: activePromptText,
          },
          {
            type: "input_audio",
            input_audio: {
              data: base64Audio,
              format: audioFormat,
            },
          },
        ];

        if (refBase64) {
          contentParts.push({
            type: "input_audio",
            input_audio: {
              data: refBase64,
              format: refFormat,
            },
          });
        }

        const orRes = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${rawKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://voice.shitown.workers.dev",
              "X-Title": "SHI TOWN Voice Postcard",
            },
            body: JSON.stringify({
              model: openrouterModel,
              response_format: { type: "json_object" },
              messages: [
                {
                  role: "user",
                  content: contentParts,
                },
              ],
            }),
          }
        );

        if (orRes.ok) {
          const orData = await orRes.json();
          const rawText = orData?.choices?.[0]?.message?.content || "{}";
          const parsed = extractJsonObject(rawText);

          if (
            Array.isArray(parsed.recommendations) &&
            parsed.recommendations.length >= 2
          ) {
            return NextResponse.json({
              source: `openrouter (${openrouterModel})`,
              usedReferenceAudio: Boolean(refBase64),
              detectedTone:
                (parsed.detectedTone as string) || "溫潤真摯",
              recommendations: parsed.recommendations.slice(0, 2),
            });
          }
        }
      } else {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
          rawKey
        )}`;

        const geminiParts: Array<Record<string, unknown>> = [
          { text: activePromptText },
          {
            inlineData: {
              mimeType,
              data: base64Audio,
            },
          },
        ];

        if (refBase64) {
          geminiParts.push({
            inlineData: {
              mimeType: refMimeType,
              data: refBase64,
            },
          });
        }

        const res = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: geminiParts }],
            generationConfig: {
              responseMimeType: "application/json",
            },
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const rawText =
            data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
          const parsed = extractJsonObject(rawText);

          if (
            Array.isArray(parsed.recommendations) &&
            parsed.recommendations.length >= 2
          ) {
            return NextResponse.json({
              source: "gemini-2.5-flash",
              usedReferenceAudio: Boolean(refBase64),
              detectedTone:
                (parsed.detectedTone as string) || "溫潤真摯",
              recommendations: parsed.recommendations.slice(0, 2),
            });
          }
        }
      }
    }

    return NextResponse.json({
      source: "default-presets",
      detectedTone: "溫暖從容",
      recommendations: [
        {
          id: "bgm-a",
          presetId: "warm-guitar-piano",
          title: "老屋午後暖陽與木吉他",
          description:
            "溫潤指彈木吉他搭配老屋窗邊暖陽氛圍，適合真摯溫暖的口白故事。",
          prompt:
            "Warm fingerpicked acoustic guitar and soft upright piano, gentle afternoon sunlight in a heritage wooden house, instrumental only, no vocals",
          mode: "music",
        },
        {
          id: "bgm-b",
          presetId: "cafe-rain",
          title: "港町微風與溫柔鋼琴",
          description:
            "柔和立式鋼琴與港町微風環境音交織，讓話語像明信片般靜靜留存。",
          prompt:
            "Gentle coastal town breeze with warm upright piano notes and subtle vintage tape warmth, peaceful and nostalgic, instrumental only, no vocals",
          mode: "ambience",
        },
      ],
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "語音分析時發生未預期的錯誤",
      },
      { status: 500 }
    );
  }
}
