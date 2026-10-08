// The blue "Tier:" lines are faint. Leaving the tooltip colors intact keeps them readable.
export async function readTooltipImage(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = scaleTooltip(bitmap);
    const worker = await tooltipWorker();
    const result = await worker.recognize(canvas);
    return result.data.text ?? "";
  } finally {
    bitmap.close();
  }
}

type OcrWorker = {
  recognize(image: HTMLCanvasElement): Promise<{ data: { text: string } }>;
};

let workerPromise: Promise<OcrWorker> | null = null;

async function tooltipWorker(): Promise<OcrWorker> {
  if (workerPromise) return workerPromise;
  const created = import("tesseract.js")
    .then(async (tesseract) => {
      const worker = await tesseract.createWorker("eng");
      await worker.setParameters({
        tessedit_pageseg_mode: tesseract.PSM.SINGLE_BLOCK,
        user_defined_dpi: "300",
      });
      return {
        recognize: (image: HTMLCanvasElement) => worker.recognize(image),
      };
    })
    .catch((error: unknown) => {
      workerPromise = null;
      throw error;
    });
  workerPromise = created;
  return created;
}

function scaleTooltip(bitmap: ImageBitmap): HTMLCanvasElement {
  const scale = bitmap.width < 1100 ? 2 : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(bitmap.width * scale);
  canvas.height = Math.floor(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}
