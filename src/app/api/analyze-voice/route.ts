import { NextRequest, NextResponse } from "next/server";

const SYSTEM_PROMPT = `You are the music director for "蒔町・拾光事務所 (SHI TOWN) — 港町留聲計畫".
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

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio") as File | null;
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
      const audioFormat = mimeType.includes("mp3")
        ? "mp3"
        : mimeType.includes("ogg")
        ? "ogg"
        : "wav";

      // Check whether the key is a direct Google AI Studio key (starts with "AIza") or an OpenRouter key ("sk-or-...")
      const isDirectGoogleKey = rawKey.startsWith("AIza");

      if (!isDirectGoogleKey) {
        // Call OpenRouter (/api/v1/chat/completions) with google/gemini-2.5-flash
        const orRes = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${rawKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "http://localhost:3000",
              "X-Title": "SHI TOWN Voice Postcard",
            },
            body: JSON.stringify({
              model: openrouterModel,
              response_format: { type: "json_object" },
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: SYSTEM_PROMPT,
                    },
                    {
                      type: "input_audio",
                      input_audio: {
                        data: base64Audio,
                        format: audioFormat,
                      },
                    },
                  ],
                },
              ],
            }),
          }
        );

        if (!orRes.ok) {
          const errText = await orRes.text();
          return NextResponse.json(
            {
              error: `OpenRouter API 呼叫失敗 (${orRes.status})：請確認您的 OpenRouter Key 與額度是否正常。`,
              details: errText,
            },
            { status: orRes.status }
          );
        }

        const orData = await orRes.json();
        const rawText = orData?.choices?.[0]?.message?.content || "{}";
        const parsed = extractJsonObject(rawText);

        if (
          Array.isArray(parsed.recommendations) &&
          parsed.recommendations.length >= 2
        ) {
          return NextResponse.json({
            source: `openrouter (${openrouterModel})`,
            detectedTone:
              (parsed.detectedTone as string) || "溫潤真摯",
            recommendations: parsed.recommendations.slice(0, 2),
          });
        }
      } else {
        // Direct Google AI Studio Gemini API fallback if user enters an "AIza..." key
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
          rawKey
        )}`;

        const res = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: SYSTEM_PROMPT },
                  {
                    inlineData: {
                      mimeType,
                      data: base64Audio,
                    },
                  },
                ],
              },
            ],
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
              detectedTone:
                (parsed.detectedTone as string) || "溫潤真摯",
              recommendations: parsed.recommendations.slice(0, 2),
            });
          }
        }
      }
    }

    // Default fallback when no API key is provided yet
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
