const pdfInput = document.getElementById("pdfInput");
const addFilesBtn = document.getElementById("addFilesBtn");
const layoutBtn = document.getElementById("layoutBtn");
const exportPdfBtn = document.getElementById("exportPdfBtn");
const restoreSortBtn = document.getElementById("restoreSortBtn");
const clearListBtn = document.getElementById("clearListBtn");
const autoClassifyCheckbox = document.getElementById("autoClassifyCheckbox");
const autoMonthPageBreakCheckbox = document.getElementById("autoMonthPageBreakCheckbox");
const exportQualitySelect = document.getElementById("exportQualitySelect");
const dropZone = document.getElementById("dropZone");
const statusEl = document.getElementById("status");
const printSheetsEl = document.getElementById("printSheets");
const fileListEl = document.getElementById("fileList");

const uploadedEntries = [];
const renderedItems = [];
let isAnalyzingFiles = false;

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

pdfInput.addEventListener("change", async () => {
  const picked = Array.from(pdfInput.files || []);
  pdfInput.value = "";
  await addFiles(picked);
});

addFilesBtn.addEventListener("click", () => {
  if (isAnalyzingFiles) return;
  pdfInput.click();
});

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropZone.classList.add("is-dragover");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropZone.classList.remove("is-dragover");
  });
});

dropZone.addEventListener("drop", async (event) => {
  const droppedFiles = Array.from(event.dataTransfer?.files || []);
  await addFiles(droppedFiles);
});

dropZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    pdfInput.click();
  }
});

dropZone.addEventListener("click", () => {
  if (isAnalyzingFiles) return;
  pdfInput.click();
});

document.addEventListener("dragover", (event) => {
  event.preventDefault();
});

document.addEventListener("drop", (event) => {
  if (!(event.target instanceof Node) || !dropZone.contains(event.target)) {
    event.preventDefault();
  }
});

fileListEl.addEventListener("click", (event) => {
  if (isAnalyzingFiles) return;

  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;

  const openIndex = Number(target.dataset.openIndex);
  if (Number.isInteger(openIndex) && openIndex >= 0 && openIndex < uploadedEntries.length) {
    openFileInNewTab(uploadedEntries[openIndex].file);
    return;
  }

  const action = target.dataset.action;
  const index = Number(target.dataset.index);
  if (!Number.isInteger(index) || index < 0 || index >= uploadedEntries.length) return;

  if (action === "up" && index > 0) {
    swapEntries(index, index - 1);
  }

  if (action === "down" && index < uploadedEntries.length - 1) {
    swapEntries(index, index + 1);
  }

  if (action === "remove") {
    uploadedEntries.splice(index, 1);
  }

  recomputeDuplicateMarkers();
  renderFileList();

  if (uploadedEntries.length === 0) {
    clearLayout();
    refreshActionButtons();
    statusEl.textContent = "清單已清空，請先上傳 PDF";
    return;
  }

  invalidateLayout("已更新清單，請重新按「產生多頁排版」。");
});

clearListBtn.addEventListener("click", () => {
  uploadedEntries.length = 0;
  renderFileList();
  clearLayout();
  refreshActionButtons();
  statusEl.textContent = "清單已清空，請先上傳 PDF";
});

restoreSortBtn.addEventListener("click", () => {
  if (uploadedEntries.length === 0 || isAnalyzingFiles) return;
  sortEntriesByDate(uploadedEntries);
  renderFileList();
  invalidateLayout("已恢復依日期排序（舊到新）。");
});

autoClassifyCheckbox.addEventListener("change", () => {
  if (uploadedEntries.length === 0) return;
  invalidateLayout(
    autoClassifyCheckbox.checked
      ? "已啟用自動日期分類，排版時會依日期排序（舊到新）。"
      : "已關閉自動日期分類，排版時將依清單順序。",
  );
});

autoMonthPageBreakCheckbox.addEventListener("change", () => {
  if (uploadedEntries.length === 0) return;
  invalidateLayout(
    autoMonthPageBreakCheckbox.checked
      ? "已啟用不同月份自動換頁。"
      : "已關閉不同月份自動換頁。",
  );
});

layoutBtn.addEventListener("click", async () => {
  const entries = getEntriesForLayout();
  if (entries.length === 0) return;

  layoutBtn.disabled = true;
  exportPdfBtn.disabled = true;
  clearLayout();

  try {
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      statusEl.textContent = `處理中：${entry.file.name} (${i + 1}/${entries.length})`;

      const canvas = await renderFirstPage(entry.file);
      renderedItems.push({
        fileName: entry.file.name,
        canvas,
        monthKey: monthKeyFromDate(entry.detectedDate),
      });
    }

    const pageChunks = getPageChunks(renderedItems, autoMonthPageBreakCheckbox.checked);
    buildPagedLayout(pageChunks);

    const pageCount = pageChunks.length;
    statusEl.textContent = `完成：${renderedItems.length} 份明細，已排成 ${pageCount} 頁（每頁橫向並排 3 份）。`;
    exportPdfBtn.disabled = false;
  } catch (error) {
    statusEl.textContent = `處理失敗：${error instanceof Error ? error.message : "未知錯誤"}`;
  } finally {
    refreshActionButtons();
  }
});

exportPdfBtn.addEventListener("click", async () => {
  if (renderedItems.length === 0) return;

  exportPdfBtn.disabled = true;
  statusEl.textContent = "輸出排版 PDF 中...";

  try {
    const pageChunks = getPageChunks(renderedItems, autoMonthPageBreakCheckbox.checked);
    await downloadCombinedPdf(pageChunks);
    statusEl.textContent = `PDF 已輸出，共 ${pageChunks.length} 頁。`;
  } catch (error) {
    statusEl.textContent = `PDF 輸出失敗：${error instanceof Error ? error.message : "未知錯誤"}`;
  } finally {
    exportPdfBtn.disabled = false;
  }
});

refreshActionButtons();
renderFileList();

async function addFiles(files) {
  if (isAnalyzingFiles) {
    statusEl.textContent = "正在辨識檔案中，請稍候...";
    return;
  }

  const picked = files.filter(isPdfFile);
  if (picked.length === 0) {
    if (uploadedEntries.length === 0) {
      statusEl.textContent = "請先上傳 PDF";
    }
    return;
  }

  isAnalyzingFiles = true;
  refreshActionButtons();
  statusEl.textContent = `分析檔案重複度中... (${picked.length} 份)`;

  try {
    const prepared = await Promise.all(
      picked.map(async (file) => ({
        file,
        signature: fileSignature(file),
        contentSignature: await fileContentSignature(file),
      })),
    );

    statusEl.textContent = `辨識日期中... (${prepared.length} 份)`;

    const analyzed = await Promise.all(
      prepared.map(async (item) => {
        const dateInfo = await detectDateFromFirstPage(item.file);
        return {
          file: item.file,
          signature: item.signature,
          contentSignature: item.contentSignature,
          detectedDate: dateInfo.date,
          detectedLabel: dateInfo.label,
          confidenceLevel: dateInfo.confidenceLevel,
          confidenceLabel: dateInfo.confidenceLabel,
          needsReview: dateInfo.needsReview,
        };
      }),
    );

    uploadedEntries.push(...analyzed);
    const duplicateCount = recomputeDuplicateMarkers();
    renderFileList();
    invalidateLayout(
      `已加入 ${analyzed.length} 份，清單共 ${uploadedEntries.length} 份。${duplicateCount > 0 ? ` 已標記可能重複 ${duplicateCount} 份。` : ""}${autoClassifyCheckbox.checked ? " 排版時會自動依日期分類。" : ""}`,
    );
  } finally {
    isAnalyzingFiles = false;
    refreshActionButtons();
  }
}

function renderFileList() {
  fileListEl.innerHTML = "";

  if (uploadedEntries.length === 0) {
    const empty = document.createElement("li");
    empty.className = "file-item empty";
    empty.textContent = "目前沒有檔案";
    fileListEl.appendChild(empty);
    return;
  }

  for (let i = 0; i < uploadedEntries.length; i += 1) {
    const entry = uploadedEntries[i];

    const li = document.createElement("li");
    li.className = "file-item";

    const nameWrap = document.createElement("div");

    const name = document.createElement("button");
    name.type = "button";
    name.className = "file-name file-open-btn";
    name.dataset.openIndex = String(i);
    name.textContent = `${i + 1}. ${entry.file.name}`;

    const meta = document.createElement("small");
    meta.className = `file-meta ${entry.needsReview ? "warn" : ""}`.trim();
    meta.textContent = `辨識日期：${entry.detectedLabel}｜${entry.confidenceLabel}`;

    nameWrap.append(name, meta);

    if (entry.needsReview) {
      const review = document.createElement("small");
      review.className = "file-review";
      review.textContent = "建議人工確認日期";
      nameWrap.append(review);
    }

    if (entry.isPossibleDuplicate) {
      const duplicateFlag = document.createElement("small");
      duplicateFlag.className = "file-duplicate";
      duplicateFlag.textContent = "可能與其他檔案重複（依內容比對）";
      nameWrap.append(duplicateFlag);
    }

    const row = document.createElement("div");
    row.className = "file-actions";

    row.append(
      makeListActionButton("上移", "up", i, i === 0),
      makeListActionButton("下移", "down", i, i === uploadedEntries.length - 1),
      makeListActionButton("刪除", "remove", i, false, "danger"),
    );

    li.append(nameWrap, row);
    fileListEl.appendChild(li);
  }
}

function makeListActionButton(text, action, index, disabled, variant = "") {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `small-btn ${variant}`.trim();
  btn.textContent = text;
  btn.dataset.action = action;
  btn.dataset.index = String(index);
  btn.disabled = disabled;
  return btn;
}

function invalidateLayout(message) {
  clearLayout();
  refreshActionButtons();
  statusEl.textContent = message;
}

function refreshActionButtons() {
  const hasFiles = uploadedEntries.length > 0;
  const hasLayout = renderedItems.length > 0;
  layoutBtn.disabled = !hasFiles || isAnalyzingFiles;
  restoreSortBtn.disabled = !hasFiles || isAnalyzingFiles;
  clearListBtn.disabled = !hasFiles || isAnalyzingFiles;
  exportPdfBtn.disabled = !hasLayout;
  pdfInput.disabled = isAnalyzingFiles;
  addFilesBtn.disabled = isAnalyzingFiles;
  dropZone.setAttribute("aria-disabled", String(isAnalyzingFiles));
}

function clearLayout() {
  renderedItems.length = 0;
  printSheetsEl.innerHTML = "";
}

function swapEntries(a, b) {
  const temp = uploadedEntries[a];
  uploadedEntries[a] = uploadedEntries[b];
  uploadedEntries[b] = temp;
}

function recomputeDuplicateMarkers() {
  const countByContent = new Map();
  const countByWeak = new Map();

  for (const entry of uploadedEntries) {
    if (entry.contentSignature) {
      countByContent.set(entry.contentSignature, (countByContent.get(entry.contentSignature) || 0) + 1);
    }
    if (entry.signature) {
      countByWeak.set(entry.signature, (countByWeak.get(entry.signature) || 0) + 1);
    }
  }

  let duplicateCount = 0;
  for (const entry of uploadedEntries) {
    const byContent = entry.contentSignature ? (countByContent.get(entry.contentSignature) || 0) > 1 : false;
    const byWeak = entry.signature ? (countByWeak.get(entry.signature) || 0) > 1 : false;
    entry.isPossibleDuplicate = byContent || byWeak;
    if (entry.isPossibleDuplicate) duplicateCount += 1;
  }

  return duplicateCount;
}

function openFileInNewTab(file) {
  const fileUrl = URL.createObjectURL(file);
  window.open(fileUrl, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(fileUrl), 60_000);
}

function fileSignature(file) {
  return `${file.name}__${file.size}__${file.lastModified}`;
}

async function fileContentSignature(file) {
  try {
    if (!window.crypto?.subtle) {
      return `fallback_${file.size}_${file.lastModified}`;
    }

    const buffer = await file.arrayBuffer();
    const digest = await window.crypto.subtle.digest("SHA-256", buffer);
    return `${file.size}__${bufferToHex(digest)}`;
  } catch {
    return `fallback_${file.size}_${file.lastModified}`;
  }
}

function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function sortEntriesByDate(entries) {
  const indexed = entries.map((entry, index) => ({ entry, index }));
  indexed.sort((a, b) => {
    const aTime = a.entry.detectedDate ? a.entry.detectedDate.getTime() : Number.POSITIVE_INFINITY;
    const bTime = b.entry.detectedDate ? b.entry.detectedDate.getTime() : Number.POSITIVE_INFINITY;
    if (aTime === bTime) return a.index - b.index;
    return aTime - bTime;
  });

  for (let i = 0; i < indexed.length; i += 1) {
    entries[i] = indexed[i].entry;
  }
}

function isPdfFile(file) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function getEntriesForLayout() {
  const entries = [...uploadedEntries];
  if (!autoClassifyCheckbox.checked) {
    return entries;
  }

  sortEntriesByDate(entries);
  return entries;
}

function monthKeyFromDate(date) {
  if (!(date instanceof Date)) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getPageChunks(items, breakOnMonthChange) {
  const pages = [];
  let currentPage = [];
  let previousMonthKey = null;

  for (const item of items) {
    const shouldBreakByMonth =
      breakOnMonthChange &&
      currentPage.length > 0 &&
      previousMonthKey &&
      item.monthKey &&
      item.monthKey !== previousMonthKey;

    if (currentPage.length === 3 || shouldBreakByMonth) {
      pages.push(padPageItems(currentPage));
      currentPage = [];
    }

    currentPage.push(item);
    previousMonthKey = item.monthKey;
  }

  if (currentPage.length > 0) {
    pages.push(padPageItems(currentPage));
  }

  return pages;
}

function padPageItems(items) {
  const padded = [...items];
  while (padded.length < 3) {
    padded.push(null);
  }
  return padded;
}

function buildPagedLayout(pageChunks) {
  printSheetsEl.innerHTML = "";

  for (let pageIdx = 0; pageIdx < pageChunks.length; pageIdx += 1) {
    const page = document.createElement("section");
    page.className = "print-page";
    const pageItems = pageChunks[pageIdx];

    for (let slot = 0; slot < 3; slot += 1) {
      const item = pageItems[slot];
      const slotEl = createSlot(item);
      page.appendChild(slotEl);
    }

    printSheetsEl.appendChild(page);
  }
}

function createSlot(item) {
  const slotEl = document.createElement("article");
  slotEl.className = "slot";

  const body = document.createElement("div");
  body.className = "slot-body";

  if (item) {
    body.appendChild(copyCanvas(item.canvas));
  } else {
    body.classList.add("empty");
    body.textContent = "";
  }

  slotEl.append(body);
  return slotEl;
}

async function detectDateFromFirstPage(file) {
  try {
    const text = await extractFirstPageText(file);
    const result = parseDateFromText(text);
    if (!result) {
      return {
        date: null,
        label: "未辨識日期",
        confidenceLevel: "none",
        confidenceLabel: "無信心",
        needsReview: true,
      };
    }

    return {
      date: result.date,
      label: formatDateHuman(result.date),
      confidenceLevel: result.confidenceLevel,
      confidenceLabel: confidenceLabel(result.confidenceLevel),
      needsReview: result.confidenceLevel === "low",
    };
  } catch {
    return {
      date: null,
      label: "未辨識日期",
      confidenceLevel: "none",
      confidenceLabel: "無信心",
      needsReview: true,
    };
  }
}

async function extractFirstPageText(file) {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  try {
    const page = await pdf.getPage(1);
    const textContent = await page.getTextContent();
    return textContent.items.map((item) => item.str || "").join(" ");
  } finally {
    pdf.destroy();
  }
}

function parseDateFromText(rawText) {
  if (!rawText) return null;

  const text = rawText.replace(/\s+/g, " ");

  const ymdPattern = /(\d{4})[\/.\-]\s*(\d{1,2})[\/.\-]\s*(\d{1,2})/g;
  const ymdZhPattern = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/g;
  const mdyPattern = /(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/g;
  const monthFirstPattern = /\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/g;
  const dayFirstPattern = /\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/g;

  const directYmd = firstValidByRegex(text, ymdPattern, (m) => {
    const date = toValidDate(Number(m[1]), Number(m[2]), Number(m[3]));
    return date ? { date, confidenceLevel: "high" } : null;
  });
  if (directYmd) return directYmd;

  const zhYmd = firstValidByRegex(text, ymdZhPattern, (m) => {
    const date = toValidDate(Number(m[1]), Number(m[2]), Number(m[3]));
    return date ? { date, confidenceLevel: "high" } : null;
  });
  if (zhYmd) return zhYmd;

  const monthFirst = firstValidByRegex(text, monthFirstPattern, (m) => {
    const month = monthNameToNumber(m[1]);
    if (!month) return null;
    const date = toValidDate(Number(m[3]), month, Number(m[2]));
    return date ? { date, confidenceLevel: "medium" } : null;
  });
  if (monthFirst) return monthFirst;

  const dayFirst = firstValidByRegex(text, dayFirstPattern, (m) => {
    const month = monthNameToNumber(m[2]);
    if (!month) return null;
    const date = toValidDate(Number(m[3]), month, Number(m[1]));
    return date ? { date, confidenceLevel: "medium" } : null;
  });
  if (dayFirst) return dayFirst;

  const mdy = firstValidByRegex(text, mdyPattern, (m) => {
    const month = Number(m[1]);
    const day = Number(m[2]);
    const year = Number(m[3]);
    const date = toValidDate(year, month, day);
    if (!date) return null;

    const ambiguous = month <= 12 && day <= 12;
    return { date, confidenceLevel: ambiguous ? "low" : "medium" };
  });
  if (mdy) return mdy;

  return null;
}

function firstValidByRegex(text, regex, mapper) {
  regex.lastIndex = 0;
  for (let match = regex.exec(text); match; match = regex.exec(text)) {
    const mapped = mapper(match);
    if (mapped) return mapped;
  }
  return null;
}

function confidenceLabel(level) {
  if (level === "high") return "高信心";
  if (level === "medium") return "中信心";
  if (level === "low") return "低信心";
  return "無信心";
}

function monthNameToNumber(name) {
  const months = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };

  return months[name.toLowerCase()] || null;
}

function toValidDate(year, month, day) {
  if (year < 2000 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

function formatDateHuman(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function renderFirstPage(file) {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  try {
    const page = await pdf.getPage(1);

    const baseViewport = page.getViewport({ scale: 1 });
    const targetWidth = 1200;
    const scale = targetWidth / baseViewport.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("無法建立 Canvas");

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.className = "receipt-page";

    await page.render({ canvasContext: ctx, viewport }).promise;
    return cropWhiteMargins(canvas);
  } finally {
    pdf.destroy();
  }
}

function cropWhiteMargins(sourceCanvas) {
  const ctx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return sourceCanvas;

  const { width, height } = sourceCanvas;
  const { data } = ctx.getImageData(0, 0, width, height);

  const threshold = 245;
  const alphaThreshold = 10;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      const isContent = a > alphaThreshold && (r < threshold || g < threshold || b < threshold);

      if (!isContent) continue;

      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) {
    return sourceCanvas;
  }

  const padding = 6;
  const cropX = Math.max(0, minX - padding);
  const cropY = Math.max(0, minY - padding);
  const cropW = Math.min(width - cropX, maxX - minX + 1 + padding * 2);
  const cropH = Math.min(height - cropY, maxY - minY + 1 + padding * 2);

  const cropped = document.createElement("canvas");
  cropped.width = cropW;
  cropped.height = cropH;
  cropped.className = sourceCanvas.className;

  const croppedCtx = cropped.getContext("2d", { alpha: false });
  if (!croppedCtx) return sourceCanvas;
  croppedCtx.drawImage(sourceCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  return cropped;
}

async function downloadCombinedPdf(pageChunks) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  const pageWidth = 297;
  const pageHeight = 210;
  const pagePadding = 8;
  const slotGap = 4;
  const slotWidth = (pageWidth - pagePadding * 2 - slotGap * 2) / 3;
  const imageBoxHeight = pageHeight - pagePadding * 2;
  const usePng = exportQualitySelect.value === "png";
  const imageType = usePng ? "PNG" : "JPEG";
  const imageCompression = usePng ? "NONE" : "FAST";

  for (let pageIdx = 0; pageIdx < pageChunks.length; pageIdx += 1) {
    if (pageIdx > 0) {
      doc.addPage();
    }

    const pageItems = pageChunks[pageIdx];
    for (let slot = 0; slot < 3; slot += 1) {
      const item = pageItems[slot];
      if (!item) continue;

      const xLeft = pagePadding + slot * (slotWidth + slotGap);
      const imageData = usePng ? item.canvas.toDataURL("image/png") : item.canvas.toDataURL("image/jpeg", 0.88);

      const fit = getContainSize(item.canvas.width, item.canvas.height, slotWidth, imageBoxHeight);
      const x = xLeft + (slotWidth - fit.width) / 2;
      const y = pagePadding + (imageBoxHeight - fit.height) / 2;

      doc.addImage(imageData, imageType, x, y, fit.width, fit.height, undefined, imageCompression);
    }
  }

  const suffix = usePng ? "clear" : "fast";
  doc.save(`uber-receipts-3up-${suffix}-${formatDateStamp(new Date())}.pdf`);
}

function getContainSize(srcWidth, srcHeight, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / srcWidth, maxHeight / srcHeight);
  return {
    width: srcWidth * scale,
    height: srcHeight * scale,
  };
}

function copyCanvas(source) {
  const copy = document.createElement("canvas");
  copy.width = source.width;
  copy.height = source.height;
  copy.className = source.className;

  const ctx = copy.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("無法複製預覽畫面");
  ctx.drawImage(source, 0, 0);

  return copy;
}

function formatDateStamp(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}${m}${d}-${hh}${mm}`;
}
