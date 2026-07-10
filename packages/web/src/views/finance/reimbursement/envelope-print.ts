import QRCode from "qrcode";
import { jsPDF } from "jspdf";

const PAGE_W_MM = 230;
const PAGE_H_MM = 120;

const mmToPx = (mm: number) => (mm * 96) / 25.4;

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_load_failed"));
    img.src = src;
  });

const renderSingleEnvelopeCanvas = async (
  uuid: string,
  title: string
): Promise<HTMLCanvasElement> => {
  const scale = 2;
  const widthPx = Math.max(1, Math.round(mmToPx(PAGE_W_MM)));
  const heightPx = Math.max(1, Math.round(mmToPx(PAGE_H_MM)));

  const canvas = document.createElement("canvas");
  canvas.width = widthPx * scale;
  canvas.height = heightPx * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_context_failed");

  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, widthPx, heightPx);

  const margin = mmToPx(8);
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;

  ctx.fillStyle = "#685f54";
  ctx.font = `${Math.round(mmToPx(3.3))}px sans-serif`;
  ctx.fillText(`生成时间：${stamp}`, margin, margin + mmToPx(2));

  ctx.fillStyle = "#1f1f1f";
  ctx.textAlign = "center";
  ctx.font = `700 ${Math.round(mmToPx(4.4))}px sans-serif`;
  ctx.fillText(title, widthPx / 2, margin + mmToPx(12));

  const qrDataUrl = await QRCode.toDataURL(uuid, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 160
  });
  const qrSize = mmToPx(30);
  const qrX = margin;
  const qrY = margin + mmToPx(16);
  ctx.drawImage(await loadImage(qrDataUrl), qrX, qrY, qrSize, qrSize);

  const textX = qrX + qrSize + mmToPx(8);
  const textY = qrY + mmToPx(1);
  const bodyFont = Math.round(mmToPx(4.1));
  ctx.textAlign = "left";
  ctx.font = `${bodyFont}px sans-serif`;

  const uuidMaxWidth = widthPx - textX - margin;
  const chunks: string[] = [];
  let start = 0;
  while (start < uuid.length) {
    let end = start + 1;
    while (
      end <= uuid.length &&
      ctx.measureText(uuid.slice(start, end)).width <= uuidMaxWidth
    ) {
      end += 1;
    }
    chunks.push(uuid.slice(start, Math.max(start + 1, end - 1)));
    start = Math.max(start + 1, end - 1);
  }
  chunks.forEach((line, index) => {
    ctx.fillText(
      line,
      textX,
      textY + bodyFont + index * Math.round(bodyFont * 1.35)
    );
  });

  const lineStartY =
    textY + Math.round(bodyFont * 1.35) * Math.max(2, chunks.length + 1);
  ctx.fillText("封装日期：________年____月____日", textX, lineStartY);
  ctx.fillText(
    "签收日期：________年____月____日",
    textX,
    lineStartY + Math.round(bodyFont * 1.6)
  );
  ctx.fillText(
    "填 报 人：________________",
    textX,
    lineStartY + Math.round(bodyFont * 3.2)
  );

  return canvas;
};

/**
 * 单信封打印：渲染 QR + UUID 到 PDF 并调起浏览器打印。
 * @returns true=已打开打印窗口；false=弹窗被拦截（调用方提示用户允许弹窗）
 */
export const printSingleEnvelope = async (
  uuid: string,
  options?: { title?: string }
): Promise<boolean> => {
  const title = options?.title?.trim() || "恒越百川报销信封（拆单新签）";
  const canvas = await renderSingleEnvelopeCanvas(uuid, title);
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: [PAGE_W_MM, PAGE_H_MM]
  });
  pdf.addImage(
    canvas.toDataURL("image/png"),
    "PNG",
    0,
    0,
    PAGE_W_MM,
    PAGE_H_MM,
    undefined,
    "FAST"
  );

  const blobUrl = URL.createObjectURL(pdf.output("blob"));
  const win = window.open(blobUrl, "_blank");
  if (!win) {
    URL.revokeObjectURL(blobUrl);
    return false;
  }
  const tryPrint = () => {
    try {
      win.focus();
      win.print();
    } finally {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
    }
  };
  win.addEventListener("load", tryPrint, { once: true });
  setTimeout(tryPrint, 1200);
  return true;
};
