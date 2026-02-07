// Background script for Canvas Modules Presentation Downloader

const browserApi = typeof browser !== "undefined" ? browser : chrome;

// ── Keyboard command → toggle overlay on active tab ────────────────────

browserApi.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-overlay") return;

  try {
    const [activeTab] = await browserApi.tabs.query({
      active: true,
      currentWindow: true
    });
    if (!activeTab || !activeTab.id) return;

    await browserApi.tabs.sendMessage(activeTab.id, { type: "TOGGLE_OVERLAY" });
  } catch (error) {
    console.error("[CPD bg] Failed to send TOGGLE_OVERLAY:", error);
  }
});

// ── Download queue ─────────────────────────────────────────────────────

let isProcessingQueue = false;
const downloadQueue = [];
const MAX_CONCURRENT = 3;

function enqueueDownloads(items, tabId) {
  items.forEach((item) => {
    downloadQueue.push({ item, tabId });
  });
  if (!isProcessingQueue) {
    void processQueue();
  }
}

async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  // Process in small batches for some concurrency.
  while (downloadQueue.length > 0) {
    const batch = downloadQueue.splice(0, MAX_CONCURRENT);
    await Promise.allSettled(
      batch.map(({ item, tabId }) => handleSingleDownload(item, tabId))
    );
  }

  isProcessingQueue = false;
}

// ── URL resolution helpers ─────────────────────────────────────────────

/**
 * Extract the Canvas origin and course ID from a URL.
 */
function extractCanvasContext(url) {
  const match = url.match(/(https?:\/\/[^/]+)\/courses\/(\d+)/);
  if (!match) return null;
  return { origin: match[1], courseId: match[2] };
}

/**
 * Extract a file ID from a Canvas /files/<id> URL.
 */
function extractFileId(url) {
  const match = url.match(/\/files\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Use the Canvas REST API to get file metadata (real filename, content-type,
 * and a direct download URL).
 *
 * Returns { filename, displayName, contentType, downloadUrl } or null.
 */
async function getCanvasFileInfo(origin, courseId, fileId) {
  try {
    const apiUrl = `${origin}/api/v1/courses/${courseId}/files/${fileId}`;
    const resp = await fetch(apiUrl, {
      credentials: "include",
      headers: { "Accept": "application/json" }
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      filename: data.display_name || data.filename || null,
      contentType: data["content-type"] || null,
      downloadUrl: data.url || null
    };
  } catch {
    return null;
  }
}

/**
 * Given a Canvas module-item URL (e.g. /courses/123/modules/items/456),
 * resolve it to a file ID by following the redirect, then use the Canvas API
 * to get the real filename and download URL.
 *
 * Returns { downloadUrl, filename } or null.
 */
async function resolveModuleItemUrl(url) {
  const ctx = extractCanvasContext(url);
  if (!ctx) return null;

  try {
    // Follow redirect to find the file ID
    const resp = await fetch(url, {
      credentials: "include",
      redirect: "follow"
    });

    const finalUrl = resp.url || url;
    let fileId = extractFileId(finalUrl);

    if (!fileId) {
      // Parse HTML as fallback to find a /files/<id> link
      const html = await resp.text();
      const match = html.match(/\/files\/(\d+)/);
      if (match) fileId = match[1];
    }

    if (!fileId) {
      console.warn("[CPD bg] Could not find file ID from module item URL:", url);
      return null;
    }

    // Use Canvas API to get real file info
    const fileInfo = await getCanvasFileInfo(ctx.origin, ctx.courseId, fileId);
    if (fileInfo && fileInfo.downloadUrl) {
      return {
        downloadUrl: fileInfo.downloadUrl,
        filename: fileInfo.filename || null,
        contentType: fileInfo.contentType || null
      };
    }

    // Fallback: construct download URL manually
    return {
      downloadUrl: ensureDownloadParam(`${ctx.origin}/courses/${ctx.courseId}/files/${fileId}`),
      filename: null,
      contentType: null
    };
  } catch (error) {
    console.error("[CPD bg] Error resolving module item URL:", url, error);
    return null;
  }
}

/**
 * For a direct /files/<id> URL, use the Canvas API to get the real filename
 * and download URL.
 *
 * Returns { downloadUrl, filename } or null.
 */
async function resolveDirectFileUrl(url) {
  const ctx = extractCanvasContext(url);
  const fileId = extractFileId(url);
  if (!ctx || !fileId) return null;

  const fileInfo = await getCanvasFileInfo(ctx.origin, ctx.courseId, fileId);
  if (fileInfo && fileInfo.downloadUrl) {
    return {
      downloadUrl: fileInfo.downloadUrl,
      filename: fileInfo.filename || null,
      contentType: fileInfo.contentType || null
    };
  }

  return {
    downloadUrl: ensureDownloadParam(url),
    filename: null,
    contentType: null
  };
}

/**
 * Ensure a /files/<id> URL is turned into a proper binary download URL.
 *
 * Canvas serves files differently depending on the URL form:
 *   - /files/123                        → inline HTML preview (BAD)
 *   - /files/123?download=1             → may still return HTML wrapper
 *   - /files/123/download               → sometimes still inline
 *   - /files/123/download?download_frd=1 → forces real binary download (GOOD)
 *
 * We rewrite every /files/<id> URL to the last form.
 */
function ensureDownloadParam(fileUrl) {
  try {
    const u = new URL(fileUrl);

    // Make sure the path ends with /download
    // e.g. /courses/60682/files/12345  →  /courses/60682/files/12345/download
    // but  /courses/60682/files/12345/download  stays unchanged
    if (/\/files\/\d+(\/[^/]*)?$/.test(u.pathname)) {
      if (!u.pathname.endsWith("/download")) {
        // Strip any trailing segment that isn't "download" (e.g. /preview)
        u.pathname = u.pathname.replace(/(\/files\/\d+)(\/.*)?$/, "$1/download");
      }
    }

    // download_frd=1 forces Canvas to serve the raw file bytes
    u.searchParams.set("download_frd", "1");

    return u.toString();
  } catch {
    return fileUrl;
  }
}

function makeAbsolute(relUrl, baseUrl) {
  try {
    return new URL(relUrl, baseUrl).toString();
  } catch {
    return relUrl;
  }
}

// ── Presentation type check ───────────────────────────────────────────

const PRESENTATION_RE = /\.(pptx?|ppsx?|key|pdf)(\?|$)/i;

/**
 * Check whether a resolved URL points to a presentation file.
 * We look at the URL path and, as a fallback, try a HEAD request to read
 * the Content-Disposition header.
 */
async function isPresentationUrl(resolvedUrl) {
  // 1) Check the URL itself
  if (PRESENTATION_RE.test(resolvedUrl)) return true;

  // 2) Try a HEAD request to inspect Content-Disposition (best-effort)
  try {
    const head = await fetch(resolvedUrl, {
      method: "HEAD",
      credentials: "include",
      redirect: "follow"
    });
    const disp = head.headers.get("content-disposition") || "";
    if (PRESENTATION_RE.test(disp)) return true;

    // Also check the final URL after redirects
    if (head.url && PRESENTATION_RE.test(head.url)) return true;

    // Check Content-Type for PDF / presentation MIME types
    const ct = (head.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("pdf") || ct.includes("presentation") || ct.includes("powerpoint")) {
      return true;
    }
  } catch {
    // Network error — can't determine, allow it through to avoid false negatives
    return true;
  }

  return false;
}

// ── Filename helpers ───────────────────────────────────────────────────

const MIME_TO_EXT = {
  "application/pdf": ".pdf",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.openxmlformats-officedocument.presentationml.slideshow": ".ppsx",
  "application/vnd.ms-powerpoint.presentation.macroEnabled.12": ".pptm",
  "application/vnd.apple.keynote": ".key",
  "application/vnd.oasis.opendocument.presentation": ".odp",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/zip": ".zip",
  "application/x-zip-compressed": ".zip"
};

function parseFilenameFromContentDisposition(header) {
  if (!header) return null;
  const utf8Match = header.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''(.+?)(?:;|$)/i);
  if (utf8Match) {
    try { return decodeURIComponent(utf8Match[1].trim()); } catch {}
  }
  const quotedMatch = header.match(/filename\s*=\s*"([^"]+)"/i);
  if (quotedMatch) return quotedMatch[1].trim();
  const plainMatch = header.match(/filename\s*=\s*([^\s;]+)/i);
  if (plainMatch) return plainMatch[1].trim();
  return null;
}

function hasKnownExtension(name) {
  return /\.\w{2,5}$/.test(name || "");
}

function sanitizeFilename(name) {
  return (name || "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
}

async function resolveRealFilename(downloadUrl, fallbackFilename) {
  try {
    const head = await fetch(downloadUrl, {
      method: "HEAD",
      credentials: "include",
      redirect: "follow"
    });

    const disp = head.headers.get("content-disposition") || "";
    const contentType = (head.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const finalUrl = head.url || downloadUrl;

    let realName = parseFilenameFromContentDisposition(disp);

    if (!realName) {
      try {
        const u = new URL(finalUrl);
        const lastSeg = u.pathname.split("/").filter(Boolean).pop() || "";
        if (lastSeg && lastSeg !== "download" && hasKnownExtension(decodeURIComponent(lastSeg))) {
          realName = decodeURIComponent(lastSeg);
        }
      } catch {}
    }

    if (realName && hasKnownExtension(realName)) {
      return sanitizeFilename(realName);
    }

    let baseName = realName || fallbackFilename || "";
    baseName = sanitizeFilename(baseName);
    if (!baseName) baseName = "download";

    if (baseName && !hasKnownExtension(baseName) && contentType && MIME_TO_EXT[contentType]) {
      return baseName + MIME_TO_EXT[contentType];
    }

    if (realName) return sanitizeFilename(realName);
    return null;
  } catch {
    return null;
  }
}

// ── Single download handler ────────────────────────────────────────────

async function handleSingleDownload(item, tabId) {
  const { id, url, filename, source, needsTypeCheck } = item;

  function sendStatus(status, error) {
    if (!tabId) return;
    try {
      browserApi.tabs.sendMessage(tabId, {
        type: "DOWNLOAD_STATUS",
        itemId: id,
        status,
        error: error ? String(error) : undefined
      }).catch?.(() => {});
    } catch {
      // Ignore messaging errors.
    }
  }

  sendStatus("queued");

  // ── Resolve the download URL and real filename via Canvas API ──

  let downloadUrl = url;
  let resolvedFilename = null;

  const isModuleItem = /\/courses\/\d+\/modules\/items\/\d+/.test(url);
  const isDirectFile = /\/files\/\d+/.test(url);

  if (isModuleItem && !isDirectFile) {
    sendStatus("resolving");
    const resolved = await resolveModuleItemUrl(url);
    if (resolved) {
      downloadUrl = resolved.downloadUrl;
      resolvedFilename = resolved.filename;
    } else {
      sendStatus("error", "Could not find download link for this module item");
      return;
    }
  } else if (isDirectFile) {
    sendStatus("resolving");
    const resolved = await resolveDirectFileUrl(url);
    if (resolved) {
      downloadUrl = resolved.downloadUrl;
      resolvedFilename = resolved.filename;
    } else {
      downloadUrl = ensureDownloadParam(url);
    }
  }

  // ── Post-resolution presentation check ──
  if (needsTypeCheck) {
    const isPresentation = await isPresentationUrl(downloadUrl);
    if (!isPresentation) {
      sendStatus("error", "Skipped (not a presentation)");
      return;
    }
  }

  // ── Determine final filename ──
  // Priority: API-resolved name > fallback with extension > header-based resolution
  let finalFilename = null;
  if (resolvedFilename && hasKnownExtension(resolvedFilename)) {
    finalFilename = sanitizeFilename(resolvedFilename);
  } else if (hasKnownExtension(filename)) {
    finalFilename = sanitizeFilename(filename);
  } else {
    finalFilename = await resolveRealFilename(downloadUrl, resolvedFilename || filename);
  }

  // ── Download ──

  sendStatus("downloading");

  try {
    await browserApi.downloads.download({
      url: downloadUrl,
      filename: finalFilename || undefined,
      saveAs: false
    });
    sendStatus("success");
  } catch (error) {
    if (downloadUrl !== url) {
      try {
        await browserApi.downloads.download({
          url: ensureDownloadParam(url),
          filename: finalFilename || undefined,
          saveAs: false
        });
        sendStatus("success");
        return;
      } catch (fallbackError) {
        sendStatus("error", fallbackError);
        return;
      }
    }
    sendStatus("error", error);
  }
}

// ── Message listener ───────────────────────────────────────────────────

browserApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "DOWNLOAD_REQUEST" && Array.isArray(message.items)) {
    const tabId = sender && sender.tab && sender.tab.id ? sender.tab.id : undefined;
    enqueueDownloads(message.items, tabId);
    sendResponse?.({ ok: true });
    return false;
  }
  return false;
});
