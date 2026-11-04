import QRCode from "qrcode";

export interface ExportPostcardMeta {
  id: string;
  bgmTitle: string;
  durationSeconds: number;
  createdAt: string;
  listenUrl: string;
}

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Generates and downloads a clean standalone QR Code PNG (800x920) with the official Shi Town Logo.
 */
export async function downloadStandaloneQrPng(
  listenUrl: string,
  keepsakeId: string
): Promise<void> {
  const width = 800;
  const height = 920;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Warm Paper Background (#FBF8F3)
  ctx.fillStyle = "#FBF8F3";
  ctx.fillRect(0, 0, width, height);

  // Subtle Double Frame
  ctx.strokeStyle = "#523624";
  ctx.lineWidth = 3;
  ctx.strokeRect(32, 32, width - 64, height - 64);

  ctx.strokeStyle = "#D8C8B4";
  ctx.lineWidth = 1;
  ctx.strokeRect(44, 44, width - 88, height - 88);

  // Draw Official Shi Town Logo (constrained by height so it never overlaps text or QR below)
  const logoImg = await loadImage("/shitown-logo.png?v=3");
  const logoTopY = 64;
  const logoH = 156;
  if (logoImg) {
    const logoW = (logoImg.width / logoImg.height) * logoH;
    ctx.drawImage(logoImg, (width - logoW) / 2, logoTopY, logoW, logoH);
  }

  // Title sits cleanly 46px below the bottom of the logo (64 + 156 + 46 = 266)
  ctx.fillStyle = "#523624";
  ctx.textAlign = "center";
  ctx.font = '700 26px "Noto Serif TC", serif';
  ctx.fillText("港町留聲計畫・專屬聲音條碼", width / 2, 266);

  // QR Code Image sits cleanly at y = 300 (frame) / y = 310 (QR)
  const qrDataUrl = await QRCode.toDataURL(listenUrl, {
    width: 440,
    margin: 2,
    color: {
      dark: "#3A2314",
      light: "#FFFFFF",
    },
    errorCorrectionLevel: "H",
  });

  const qrImg = await loadImage(qrDataUrl);
  if (qrImg) {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(170, 298, 460, 460);
    ctx.strokeStyle = "#D8C8B4";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(170, 298, 460, 460);
    ctx.drawImage(qrImg, 180, 308, 440, 440);
  }

  ctx.fillStyle = "#3A2314";
  ctx.font = '600 20px "Noto Sans TC", sans-serif';
  ctx.fillText("請以手機相機掃描條碼，聆聽這段珍藏聲音", width / 2, 812);

  ctx.fillStyle = "#7D6249";
  ctx.font = '500 15px "JetBrains Mono", monospace';
  ctx.fillText(`SHI TOWN · #${keepsakeId.toUpperCase()}`, width / 2, 846);

  triggerDownload(canvas, `shitown-qrcode-${keepsakeId}.png`);
}

/**
 * Generates and downloads a 1200x760 Shi Town Voice Postcard PNG with the official logo & QR code.
 */
export async function downloadVinylSleeveCardPng(
  meta: ExportPostcardMeta
): Promise<void> {
  const width = 1200;
  const height = 760;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#FBF8F3";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#523624";
  ctx.lineWidth = 3;
  ctx.strokeRect(32, 32, width - 64, height - 64);

  ctx.strokeStyle = "#D8C8B4";
  ctx.lineWidth = 1;
  ctx.strokeRect(46, 46, width - 92, height - 92);

  // Left side content
  ctx.textAlign = "left";
  ctx.fillStyle = "#7D6249";
  ctx.font = '600 18px "Noto Sans TC", sans-serif';
  ctx.fillText("03  港町留聲計畫｜VOICE POSTCARD", 96, 118);

  ctx.fillStyle = "#3A2314";
  ctx.font = '700 40px "Noto Serif TC", serif';
  ctx.fillText("讓值得記住的聲音，", 96, 180);
  ctx.fillText("成為可以收藏的記憶。", 96, 234);

  // Soundwave line
  const waveCenterY = 390;
  const waveStartX = 96;
  const waveEndX = 720;
  ctx.strokeStyle = "#523624";
  ctx.lineWidth = 3;

  ctx.beginPath();
  ctx.moveTo(waveStartX, waveCenterY);
  ctx.lineTo(waveStartX + 100, waveCenterY);
  ctx.moveTo(waveEndX - 100, waveCenterY);
  ctx.lineTo(waveEndX, waveCenterY);
  ctx.stroke();

  const barHeights = [
    14, 28, 46, 22, 68, 104, 74, 38, 92, 132, 106, 56, 84, 118, 72, 42, 92, 60,
    34, 48, 22, 14,
  ];
  const barAreaWidth = waveEndX - waveStartX - 220;
  const stepX = barAreaWidth / (barHeights.length - 1);

  for (let i = 0; i < barHeights.length; i++) {
    const x = waveStartX + 110 + i * stepX;
    const h = barHeights[i];
    ctx.beginPath();
    ctx.moveTo(x, waveCenterY - h / 2);
    ctx.lineTo(x, waveCenterY + h / 2);
    ctx.stroke();
  }

  const mins = Math.floor(meta.durationSeconds / 60);
  const secs = Math.round(meta.durationSeconds % 60);
  const timeStr = `${String(mins).padStart(2, "0")}:${String(secs).padStart(
    2,
    "0"
  )}`;

  ctx.fillStyle = "#3A2314";
  ctx.font = '600 20px "Noto Serif TC", serif';
  ctx.fillText(`背景配樂：${meta.bgmTitle}`, 96, 565);

  ctx.fillStyle = "#7D6249";
  ctx.font = '500 16px "JetBrains Mono", monospace';
  ctx.fillText(
    `長度 ${timeStr}   ·   編號 #${meta.id.toUpperCase()}   ·   ${meta.createdAt}`,
    96,
    604
  );

  // Vertical divider
  ctx.strokeStyle = "#D8C8B4";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(780, 88);
  ctx.lineTo(780, 672);
  ctx.stroke();

  // Right side: Official Logo (top: 76, height: 148 -> bottom: 224) + QR Code (top: 252, size: 260 -> bottom: 512)
  const logoImg = await loadImage("/shitown-logo.png?v=3");
  const rightCenterX = 990;
  const logoTopY = 76;
  const logoH = 148;
  if (logoImg) {
    const logoW = (logoImg.width / logoImg.height) * logoH;
    ctx.drawImage(logoImg, rightCenterX - logoW / 2, logoTopY, logoW, logoH);
  }

  const qrSize = 260;
  const qrTopY = 252;
  const qrDataUrl = await QRCode.toDataURL(meta.listenUrl, {
    width: qrSize,
    margin: 2,
    color: {
      dark: "#3A2314",
      light: "#FFFFFF",
    },
    errorCorrectionLevel: "M",
  });

  const qrImg = await loadImage(qrDataUrl);
  if (qrImg) {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(rightCenterX - qrSize / 2 - 8, qrTopY - 8, qrSize + 16, qrSize + 16);
    ctx.strokeStyle = "#D8C8B4";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rightCenterX - qrSize / 2 - 8, qrTopY - 8, qrSize + 16, qrSize + 16);
    ctx.drawImage(qrImg, rightCenterX - qrSize / 2, qrTopY, qrSize, qrSize);
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "#3A2314";
  ctx.font = '700 20px "Noto Sans TC", sans-serif';
  ctx.fillText("手機掃碼・聆聽留聲", rightCenterX, 566);

  ctx.fillStyle = "#7D6249";
  ctx.font = '400 15px "Noto Sans TC", sans-serif';
  ctx.fillText("開啟手機相機對準上方 QR Code 即可播放", rightCenterX, 598);

  triggerDownload(canvas, `shitown-postcard-${meta.id}.png`);
}

function triggerDownload(canvas: HTMLCanvasElement, filename: string) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, "image/png");
}
