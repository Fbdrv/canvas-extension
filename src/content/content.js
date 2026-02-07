(function () {
  const browserApi = typeof browser !== "undefined" ? browser : chrome;

  function ensureEnvironment() {
    if (!window.CanvasModulesParser || !window.CanvasPresentationOverlay) {
      console.warn(
        "[CPD] CanvasModulesParser or CanvasPresentationOverlay not available."
      );
      return false;
    }
    return true;
  }

  function toggleOverlay() {
    if (!ensureEnvironment()) return;

    const { isOnModulesPage, parseModuleFiles } = window.CanvasModulesParser;
    const overlayApi = window.CanvasPresentationOverlay;

    if (!isOnModulesPage()) {
      alert("This page does not look like a Canvas Modules page.");
      return;
    }

    if (overlayApi.isOverlayVisible()) {
      overlayApi.destroyOverlay();
      return;
    }

    const result = parseModuleFiles();
    console.log("[CPD] parseModuleFiles result:", result);
    overlayApi.createOverlay(result.files, handleDownloadRequest, result.debug);
  }

  function handleDownloadRequest(files) {
    if (!files || !files.length) return;

    try {
      browserApi.runtime.sendMessage(
        {
          type: "DOWNLOAD_REQUEST",
          items: files.map((f) => ({
            id: f.id,
            url: f.url,
            filename: f.filename || f.title || "",
            source: f.source || "unknown",
            needsTypeCheck: !!f.needsTypeCheck
          }))
        },
        (response) => {
          if (browserApi.runtime.lastError) {
            console.error(
              "[CPD] Failed to send DOWNLOAD_REQUEST:",
              browserApi.runtime.lastError
            );
          } else if (!response || !response.ok) {
            console.warn("[CPD] Background did not acknowledge DOWNLOAD_REQUEST.");
          }
        }
      );
    } catch (error) {
      console.error("[CPD] Error while sending DOWNLOAD_REQUEST:", error);
    }
  }

  // Listen for messages from the background script (toggle + download status).
  browserApi.runtime.onMessage.addListener((message) => {
    if (!message || !ensureEnvironment()) return;

    const overlayApi = window.CanvasPresentationOverlay;

    if (message.type === "TOGGLE_OVERLAY") {
      toggleOverlay();
      return;
    }

    if (message.type === "DOWNLOAD_STATUS") {
      overlayApi.updateItemStatus(
        message.itemId,
        message.status,
        message.error
      );
      return;
    }
  });

  // Fallback keyboard shortcut (Alt+Shift+P) in case commands are unavailable.
  document.addEventListener("keydown", (event) => {
    if (!(event.altKey && event.shiftKey && event.code === "KeyP")) return;

    // Allow the shortcut even when focused on an editable element inside our
    // overlay (e.g. the search input), but NOT on other page inputs.
    const target = event.target;
    const insideOverlay =
      target && target.closest && target.closest("#cpd-overlay");
    const isEditable =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target && target.isContentEditable);
    if (isEditable && !insideOverlay) return;

    event.preventDefault();
    toggleOverlay();
  });
})();
