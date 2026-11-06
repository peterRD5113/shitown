import QRCode from "qrcode";

/**
 * Generates and downloads a pure standalone QR Code PNG (600x600) without extra frames or text.
 */
export async function downloadStandaloneQrPng(
  listenUrl: string,
  keepsakeId: string
): Promise<void> {
  const qrDataUrl = await QRCode.toDataURL(listenUrl, {
    width: 600,
    margin: 2,
    color: {
      dark: "#3A2314",
      light: "#FFFFFF",
    },
    errorCorrectionLevel: "H",
  });

  const res = await fetch(qrDataUrl);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `shitown-qrcode-${keepsakeId}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

