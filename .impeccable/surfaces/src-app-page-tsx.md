# Surface Brief: `src/app/page.tsx` & `src/app/listen/[id]/page.tsx`

## 1. Surface Role & Context
- **Surface**: `蒔町・拾光事務所 (SHI TOWN) — 03 蒔お 港町留聲計畫` 私人聲音明信片製作頁 (`/`) 與手機掃碼收聽頁 (`/listen/[id]`)，同時支援 **電腦版 (Desktop)** 與 **手機版 (Mobile 390px)**。
- **Core Job**: 以零學習門檻的「四步漸進式引導卡片（01 麥克風錄音送出 → 02 AI 兩款推薦配樂二選一 → 03 直接試聽合成聲音與下載 → 04 生成並下載 QR Code）」，呈現溫潤的老屋和紙、深焙咖啡棕、鼠尾草綠與牛皮紙聲波明信片質感。

## 2. Direction Contract

```
FORM: 蒔町・拾光事務所「03 蒔お・港町留聲計畫」老屋再生與溫潤和紙文化提案簡報美學 — 結合手作棉絮和紙底紋、深焙咖啡屋脊標誌、左側直排咖啡膠囊標語（「讓地方的故事，被更多人看見」）與牛皮紙聲波聲音明信片 (seed:0d91d555b3ac4c46)
```

```
PALETTE:
- Primary Background (Cotton Washi Paper / 手作棉絮和紙): #F6EFE6
- Elevated Card Surface (Warm Cream Card / 溫潤米白卡片): #FBF7F0
- Highlight / Postcard Kraft Surface (Warm Sand Kraft / 暖沙牛皮紙): #EFE4D4
- Deep Coffee Accent Surface (Roasted Coffee Bean / 深焙咖啡豆棕): #362216
- Text Primary (Deep Espresso Brown / 濃萃深褐): #2B1B12 (Contrast vs #F6EFE6: 14.1:1)
- Text Secondary (Roasted Caramel Brown / 焦糖暖褐): #654A33 (Contrast vs #FBF7F0: 6.8:1)
- Text on Dark Coffee Surface (Warm Ivory / 暖象牙白): #FBF7F0
- Primary Brand Accent (Shi Town Cinnamon Brown / 蒔町肉桂暖棕): #7A5233 (Contrast vs #FBF7F0: 5.8:1, passes WCAG AA)
- Secondary Heritage Accent (Botanical Olive Sage / 老屋鼠尾草綠): #546247 (Contrast vs #FBF7F0: 5.9:1, passes WCAG AA)
- Hairline & Card Border (Warm Tan Line / 暖棕細框): #D5C3AE (1px solid)
```

```
TYPE:
- Display / Brand & Section Headings: 'Noto Serif TC' / 'Shippori Mincho', weight 700, tracking 0.03em, line-height 1.3
- UI Body & Guided Labels: 'Noto Sans TC', weight 400/500/700, line-height 1.6
- Step Numbers & Timecodes: 'Noto Serif TC' & 'JetBrains Mono', tabular-nums (`01`, `02`, `03`, `04`, `00:12`)
```

```
LAYOUT:
- Desktop (`>= 1024px`):
  - Left Heritage Margin Pill (`讓地方的故事，被更多人看見`) + Brand Header (`蒔町 SHI TOWN | 03 港町留聲計畫`)
  - Balanced Two-Column Layout: Left column holds the ultra-clean 4-Step Progressive Cards (`01 錄下聲音` → `02 AI 推薦配樂二選一` → `03 試聽合成留聲` → `04 生成與下載 QR Code`); Right column holds the tactile **「港町留聲・私人聲音明信片」** (Arched Old-House Window & Kraft Soundwave Postcard + Live QR Code).
- Mobile (`< 720px` or `手機版視角 390px`):
  - Single-column guided flow with 44px+ touch targets, step progress pills, and sticky bottom thumb bar.
```

```
MOTION:
- Easing: cubic-bezier(0.16, 1, 0.3, 1)
- Step Progression: Clicking "確認送出" smoothly activates and scrolls to the next step card; soundwave bars gently pulse (`transform: scaleY(...)`) during voice or mixed playback.
```

```
ANTI:
- No file upload buttons, no Loop/Instrumental technical toggles, no prompt text inputs, no volume/ducking slider bars, and no recipient/sender/transcript metadata forms.
- No neon cyber colors, no cold SaaS blue/gray, and no text smaller than 12px.
```
