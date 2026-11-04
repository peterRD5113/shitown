# 🎙️ AI 語音配樂與有聲 QR Code 產生器 (`voice-bgm-qrcode`)

讓用戶在網頁上錄製一段話，透過 AI 自動分析語氣（或自選氛圍標籤）生成專屬的**純背景音樂 (BGM)** 或 **環境背景聲 (Ambience)**，自動完成**人聲閃避混音 (Auto-Ducking)**，並一鍵打包成 **QR Code 有聲卡片**，讓任何人用手機掃碼即可收聽。

---

## 📌 核心流程架構

```text
[1. 網頁錄音] 用戶在瀏覽器錄下一段口白 (MediaRecorder API)
       │
       ├──► 模式 A：【AI 自動感知配樂】
       │      └──► 音檔傳給 Gemini API ──► 辨識字幕 + 語氣情緒 + 自動撰寫英文配樂 Prompt
       │
       ├──► 模式 B：【用戶自選氛圍標籤 / 自訂輸入】
       │      └──► 點選「☕ 咖啡廳雨聲」「🎹 溫馨鋼琴」「🌙 深夜電台」「🔍 懸疑故事」或自訂文字
       ▼
[2. 雲端背景音生成 API] (支援雙引擎切換)
       ├──► ElevenLabs API (`/v1/music` 純背景樂 或 `/v1/sound-generation` 無縫循環環境音)
       └──► Fal.ai API (`cassetteai/music-generator`、`fal-ai/stable-audio`、`fal-ai/ace-step`)
       ▼
[3. 前端混音台 (Web Audio API)]
       ├──► 自動套用「人聲閃避 (Auto-Ducking)」：講話時背景音自動壓低，停頓時背景音自然浮現
       ├──► 即時滑桿調整：人聲音量、背景音音量、淡入淡出 (Fade In/Out)
       └──► 輸出合成後的最終音訊檔 (`.wav` / `.mp3`)
       ▼
[4. 儲存與產出 QR Code]
       ├──► 將最終音檔 + 字幕 + 氛圍主題上傳至儲存空間 (本地儲存 / Supabase Storage / Cloudflare R2)
       ├──► 取得專屬播放頁網址 `/listen/{id}` 並自動轉為 QR Code 圖片 (支援下載有聲小卡 PNG)
       └──► 手機掃描 QR Code ──► 開啟行動版專屬播放頁面 (含音波動畫 + 字幕) ──► 直接點擊收聽
```

---

## 🔌 已驗證可調用的 API 規格備忘

### 1. ElevenLabs 官方 API
* **Header**: `xi-api-key: <YOUR_ELEVENLABS_API_KEY>`, `Content-Type: application/json`
* **純背景音樂端點**: `POST https://api.elevenlabs.io/v1/music`
  * `prompt`: 音樂風格描述
  * `music_length_ms`: 生成長度（`3000` ~ `600000` ms，對應錄音長度）
  * `force_instrumental`: `true`（強制純音樂、無唱歌人聲干擾）
  * `model_id`: `"music_v2.5"` / `"music_v1"`
* **環境背景聲端點**: `POST https://api.elevenlabs.io/v1/sound-generation`
  * `text`: 環境音描述（例：`"Cozy coffee shop ambience with soft rain on window"`）
  * `duration_seconds`: `0.5` ~ `30` 秒
  * `loop`: `true`（自動生成頭尾無縫循環 Loop 環境音）

### 2. Fal.ai 聚合 API (`@fal-ai/client`)
* **環境變數**: `FAL_KEY=<YOUR_FAL_KEY>`
* **常用模型端點**:
  * `cassetteai/music-generator`：極速 44.1kHz 立體聲純音樂（30 秒配樂 < 2 秒生成）
  * `fal-ai/stable-audio`：Stable Audio 電影感背景音樂與環境音
  * `fal-ai/ace-step/prompt-to-audio`：高 CP 值開源音樂模型（約 `$0.0002` / 秒）

### 3. AI 語音情緒辨識與自動配樂 Prompt (Gemini API)
* **模型**: `gemini-2.5-flash`
* **輸入**: 用戶錄製的音訊檔 (`audio/webm` 或 `audio/wav`)
* **輸出 JSON**:
  * `transcript`: 語音辨識逐字稿（用於掃碼播放頁顯示字幕）
  * `mood`: 偵測到的語氣與情緒標籤（例：`溫馨感性`）
  * `audioType`: `"music"` 或 `"ambience"`
  * `bgmPrompt`: 自動生成的英文配樂 Prompt
