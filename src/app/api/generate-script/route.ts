import { NextRequest, NextResponse } from "next/server";

const SYSTEM_PROMPT = `你是「蒔町・拾光事務所 — 港町留聲計畫」的文字主理人。
你的任務是協助錄製「聲音明信片」的客人，擬定一段要親口對著麥克風朗讀的溫暖短句。

【嚴格規則】
1. 字數限制：嚴格控制在 35 到 55 個繁體中文字之間（約 2 到 3 句話，朗讀時間約 10～13 秒）。絕對不可超過 60 字，也不可少於 28 字。
2. 口語朗讀感：必須是「真人在耳邊或電話裡自然說話」的溫和口吻，句子要短、好開口、有自然的逗號與句號呼吸停頓。
3. 禁止事項：
   - 嚴禁使用生硬的書面語、文言文或成語堆砌（如「時光荏苒」、「歲月如梭」、「謹以此片」、「展信愉快」）。
   - 嚴禁加入任何括號動作提示（如「（輕聲笑）」、「（停頓）」）、前後引號或標題。
   - 只輸出要朗讀的那段純文字本身，不要任何解釋。`;

const RANDOM_THEMES = [
  "在基隆港邊聞著手沖咖啡香，突然想起一位好久不見的朋友，問候對方近況",
  "留給未來三個月後的自己一段溫柔打氣的話，提醒自己偶爾慢下來",
  "對身邊一直默默陪伴、照顧自己的人，說一句平時害羞說出口的謝謝",
  "午後坐在老屋窗邊聽著微風與海浪聲，把這份安靜放鬆的心情分享給收件人",
  "祝一位重要朋友生日快樂，希望他今年也能自在做自己喜歡的事",
  "記錄今天旅途中的一個小確幸，希望聽見這段聲音的人也能嘴角上揚",
  "在微雨的午後喝著熱咖啡，想跟對方約定下次有空一起出來走走聊聊",
  "跟一直很努力生活的對方說聲辛苦了，祝他今晚有個好夢",
];

const FALLBACK_SCRIPTS = [
  "今天在港邊聞著咖啡香，突然想起好久不見的你。希望收到這張聲音明信片的時候，你剛好也有一個安靜、放鬆的午後。",
  "平常好像很少親口跟你說謝謝，但心裡一直很珍惜有你在身邊。希望你最近一切都好，有空我們再約出來喝杯咖啡吧。",
  "留一段聲音給未來的自己。不管收到這張明信片的時候有多忙，都要記得深呼吸，替自己泡一杯喜歡的咖啡，慢慢走就好。",
  "吹著港町的微風，時間好像慢了下來。想把此刻這份安靜的好心情寄給你，願你今天也能遇見讓自己微笑的小事。",
  "嘿，最近過得好嗎？突然很想念我們一起聊天笑鬧的日子。記得照顧好自己，等找個好天氣，我們再一起去看看海。",
];

function cleanGeneratedScript(raw: string): string {
  return raw
    .replace(/^[\s「『"“”']+/, "")
    .replace(/[\s」』"“”']+$/, "")
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\r?\n+/g, "")
    .trim();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const userThought =
      typeof body.thought === "string" ? body.thought.trim() : "";
    const previousScript =
      typeof body.previousScript === "string" ? body.previousScript.trim() : "";

    const rawKey =
      process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || "";

    const randomTheme =
      RANDOM_THEMES[Math.floor(Math.random() * RANDOM_THEMES.length)];

    const userPrompt = userThought
      ? `客人寫下的大致想法是：「${userThought}」。
請保留客人的心意、對象與情境，將這段想法化為一段自然、真摯、不矯情，且適合親口朗讀（嚴格控制在 35～55 個繁體中文字）的留聲短句。${
          previousScript
            ? `\n（注意：請換一種與「${previousScript}」不同的表達方式與用詞。）`
            : ""
        }`
      : `客人目前不知道要錄什麼，請以「${randomTheme}」為情境靈感，為客人撰寫一段自然、真摯、適合親口朗讀（嚴格控制在 35～55 個繁體中文字）的留聲短句。${
          previousScript
            ? `\n（注意：絕對不要與上一句「${previousScript}」重複。）`
            : ""
        }`;

    if (rawKey) {
      const isDirectGoogleKey = rawKey.startsWith("AIza");

      if (!isDirectGoogleKey) {
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
              model: "google/gemini-2.5-flash",
              temperature: 0.85,
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userPrompt },
              ],
            }),
          }
        );

        if (orRes.ok) {
          const orData = await orRes.json();
          const rawText = orData?.choices?.[0]?.message?.content || "";
          const cleaned = cleanGeneratedScript(rawText);
          if (cleaned.length >= 15) {
            return NextResponse.json({
              script: cleaned,
              mode: userThought ? "custom" : "random",
            });
          }
        }
      } else {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
          rawKey
        )}`;

        const res = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: SYSTEM_PROMPT }],
            },
            contents: [{ parts: [{ text: userPrompt }] }],
            generationConfig: {
              temperature: 0.85,
            },
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const rawText =
            data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
          const cleaned = cleanGeneratedScript(rawText);
          if (cleaned.length >= 15) {
            return NextResponse.json({
              script: cleaned,
              mode: userThought ? "custom" : "random",
            });
          }
        }
      }
    }

    // Fallback if API key is missing or call fails
    if (userThought) {
      return NextResponse.json({
        script: `${userThought}。想把這份心意放進這張聲音明信片裡，希望聽見這段聲音的你，今天也能過得溫暖順心。`,
        mode: "custom",
      });
    }

    const candidates = FALLBACK_SCRIPTS.filter((s) => s !== previousScript);
    const picked =
      candidates[Math.floor(Math.random() * candidates.length)] ||
      FALLBACK_SCRIPTS[0];

    return NextResponse.json({
      script: picked,
      mode: "random",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "生成留聲短句時發生錯誤",
      },
      { status: 500 }
    );
  }
}
