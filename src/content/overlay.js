(function () {
  const OVERLAY_ID = "cpd-overlay";

  const state = {
    root: null,
    files: [],
    debug: null,
    onDownload: null,
    searchTerm: ""
  };

  /* ── Helpers ──────────────────────────────────────────────────────── */

  function isOverlayVisible() {
    return !!document.getElementById(OVERLAY_ID);
  }

  function destroyOverlay() {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
    // Remove the Escape listener we added
    document.removeEventListener("keydown", handleEscape);
    state.root = null;
    state.files = [];
    state.debug = null;
    state.onDownload = null;
    state.searchTerm = "";
  }

  function handleEscape(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      destroyOverlay();
    }
  }

  /**
   * Derive a short file-type label (e.g. "PDF", "PPT") from the file
   * object's `type` or `filename` fields.
   */
  function chipLabel(file) {
    const t = (file.type || "").toLowerCase();
    if (t === "pdf") return "PDF";
    if (t === "ppt") return "PPT";
    if (t === "key") return "KEY";
    if (t === "odp") return "ODP";
    if (t === "doc") return "DOC";
    if (t === "xls") return "XLS";
    if (t === "zip") return "ZIP";
    // Try filename extension
    const ext = ((file.filename || "").match(/\.(\w+)$/i) || [])[1];
    if (ext) {
      const e = ext.toLowerCase();
      if (["pdf", "ppt", "pptx", "pps", "ppsx", "key", "odp", "doc", "docx", "xls", "xlsx", "zip"].includes(e)) {
        // Normalise pptx->PPT, ppsx->PPS, etc.
        if (e.startsWith("ppt")) return "PPT";
        if (e.startsWith("pps")) return "PPS";
        if (e.startsWith("doc")) return "DOC";
        if (e.startsWith("xls")) return "XLS";
        return e.toUpperCase();
      }
    }
    return "";
  }

  /* ── Focus trap ────────────────────────────────────────────────────── */

  function trapFocus(root) {
    root.addEventListener("keydown", function onTrapKey(e) {
      if (e.key !== "Tab") return;
      const focusable = root.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
  }

  /* ── Selection helpers ─────────────────────────────────────────────── */

  function getVisibleCheckboxes(root) {
    return Array.from(root.querySelectorAll(".cpd-item:not([data-hidden='true']) .cpd-item-checkbox"));
  }

  function getSelectedCount(root) {
    return getVisibleCheckboxes(root).filter(function (cb) {
      return cb instanceof HTMLInputElement && cb.checked;
    }).length;
  }

  function getTotalVisibleCount(root) {
    return getVisibleCheckboxes(root).length;
  }

  function syncSelectionUI(root, selectAllCheckbox, selCountEl, downloadButton) {
    var visible = getVisibleCheckboxes(root);
    var selectedCount = 0;
    var totalVisible = visible.length;

    visible.forEach(function (cb) {
      if (cb instanceof HTMLInputElement && cb.checked) selectedCount++;
    });

    // Update select-all checkbox
    if (totalVisible === 0) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
    } else if (selectedCount === totalVisible) {
      selectAllCheckbox.checked = true;
      selectAllCheckbox.indeterminate = false;
    } else if (selectedCount > 0) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = true;
    } else {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
    }

    // Update count label
    selCountEl.textContent = selectedCount + " / " + totalVisible;

    // Disable / enable download button
    downloadButton.disabled = selectedCount === 0;
  }

  /* ── Search / filter ───────────────────────────────────────────────── */

  function applySearch(root, term) {
    state.searchTerm = term;
    var lower = (term || "").toLowerCase();
    var items = root.querySelectorAll(".cpd-item");
    items.forEach(function (row) {
      if (!lower) {
        row.dataset.hidden = "false";
        return;
      }
      var title = (row.querySelector(".cpd-item-title") || {}).textContent || "";
      var meta = (row.querySelector(".cpd-item-meta") || {}).textContent || "";
      var match = title.toLowerCase().indexOf(lower) !== -1 || meta.toLowerCase().indexOf(lower) !== -1;
      row.dataset.hidden = match ? "false" : "true";
    });
  }

  /* ── Main builder ──────────────────────────────────────────────────── */

  /**
   * createOverlay(files, onDownload, debug?)
   *   files:      Array of { id, title, url, filename, type, source, needsTypeCheck }
   *   onDownload: callback(selectedFiles[])
   *   debug:      optional { pageUrl, totalAnchors, matchedAnchors, sampleHrefs }
   */
  function createOverlay(files, onDownload, debug) {
    destroyOverlay();
    state.files = Array.isArray(files) ? files : [];
    state.onDownload = typeof onDownload === "function" ? onDownload : null;
    state.debug = debug || null;

    var root = document.createElement("div");
    root.id = OVERLAY_ID;
    root.className = "cpd-overlay";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Canvas Presentation Downloader");

    // ── Header ──
    var header = document.createElement("div");
    header.className = "cpd-header";

    var title = document.createElement("div");
    title.className = "cpd-title";
    title.textContent = "Presentations";

    var closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "cpd-close-button";
    closeButton.setAttribute("aria-label", "Close");
    closeButton.textContent = "\u00d7";

    header.appendChild(title);
    header.appendChild(closeButton);

    // ── Footer (build early so we can reference downloadButton) ──
    var footer = document.createElement("div");
    footer.className = "cpd-footer";

    var statusArea = document.createElement("div");
    statusArea.className = "cpd-status-area";
    statusArea.setAttribute("aria-live", "polite");

    var downloadButton = document.createElement("button");
    downloadButton.type = "button";
    downloadButton.className = "cpd-download-button";
    downloadButton.textContent = "Download";

    footer.appendChild(statusArea);
    footer.appendChild(downloadButton);

    // ── Toolbar (search + select all + count) ──
    var toolbar = document.createElement("div");
    toolbar.className = "cpd-toolbar";

    var searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.className = "cpd-search-input";
    searchInput.placeholder = "Filter\u2026";
    searchInput.setAttribute("aria-label", "Filter presentations");

    var selectAllLabel = document.createElement("label");
    selectAllLabel.className = "cpd-select-all-label";

    var selectAllCheckbox = document.createElement("input");
    selectAllCheckbox.type = "checkbox";
    selectAllCheckbox.className = "cpd-select-all-checkbox";
    selectAllCheckbox.checked = true;

    var selectAllText = document.createElement("span");
    selectAllText.textContent = "All";

    selectAllLabel.appendChild(selectAllCheckbox);
    selectAllLabel.appendChild(selectAllText);

    var selCountEl = document.createElement("span");
    selCountEl.className = "cpd-selection-count";

    toolbar.appendChild(searchInput);
    toolbar.appendChild(selectAllLabel);
    toolbar.appendChild(selCountEl);

    // ── Body ──
    var body = document.createElement("div");
    body.className = "cpd-body";

    var list = document.createElement("div");
    list.className = "cpd-list";

    if (!state.files.length) {
      var empty = document.createElement("div");
      empty.className = "cpd-empty";
      empty.textContent = "No presentation files detected on this page.";
      list.appendChild(empty);

      // Debug info block when nothing was found
      if (state.debug) {
        var debugBlock = document.createElement("div");
        debugBlock.className = "cpd-debug-block";

        var debugText = document.createElement("div");
        debugText.className = "cpd-debug-text";
        debugText.textContent =
          "Scanned " + state.debug.totalAnchors + " links, matched " + state.debug.matchedAnchors + ".";
        debugBlock.appendChild(debugText);

        if (state.debug.sampleHrefs && state.debug.sampleHrefs.length) {
          var sampleTitle = document.createElement("div");
          sampleTitle.className = "cpd-debug-text";
          sampleTitle.textContent = "Sample hrefs found:";
          debugBlock.appendChild(sampleTitle);

          var sampleList = document.createElement("ul");
          sampleList.className = "cpd-debug-samples";
          state.debug.sampleHrefs.forEach(function (href) {
            var li = document.createElement("li");
            li.textContent = href;
            sampleList.appendChild(li);
          });
          debugBlock.appendChild(sampleList);
        }

        var copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.className = "cpd-debug-copy-button";
        copyButton.textContent = "Copy debug info";
        copyButton.addEventListener("click", function () {
          var info = JSON.stringify(state.debug, null, 2);
          navigator.clipboard.writeText(info).then(function () {
            copyButton.textContent = "Copied!";
            setTimeout(function () {
              copyButton.textContent = "Copy debug info";
            }, 2000);
          }).catch(function () {
            copyButton.textContent = "Copy failed";
          });
        });
        debugBlock.appendChild(copyButton);

        list.appendChild(debugBlock);
      }

      // Hide toolbar when there are no files
      toolbar.style.display = "none";
      downloadButton.disabled = true;
    } else {
      state.files.forEach(function (file) {
        var row = document.createElement("div");
        row.className = "cpd-item";
        row.dataset.id = file.id;

        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "cpd-item-checkbox";
        checkbox.checked = true;
        checkbox.dataset.id = file.id;

        var label = document.createElement("div");
        label.className = "cpd-item-label";

        // Title row: title text + optional file-type chip
        var titleRow = document.createElement("div");
        titleRow.className = "cpd-item-title-row";

        var titleEl = document.createElement("span");
        titleEl.className = "cpd-item-title";
        titleEl.textContent = file.title || file.filename || file.url;
        titleRow.appendChild(titleEl);

        var chip = chipLabel(file);
        if (chip) {
          var chipEl = document.createElement("span");
          chipEl.className = "cpd-item-chip";
          chipEl.textContent = chip;
          titleRow.appendChild(chipEl);
        }

        var metaEl = document.createElement("div");
        metaEl.className = "cpd-item-meta";
        var filenameText = file.filename || "";
        var typeText = file.type && file.type !== "file" ? " (" + file.type + ")" : "";
        var sourceText = file.source === "module_item" ? " [module item]" : "";
        metaEl.textContent = (filenameText ? filenameText + typeText : file.url) + sourceText;

        label.appendChild(titleRow);
        label.appendChild(metaEl);

        var statusContainer = document.createElement("div");
        statusContainer.className = "cpd-item-status";

        row.appendChild(checkbox);
        row.appendChild(label);
        row.appendChild(statusContainer);

        // Click anywhere on the row to toggle checkbox
        row.addEventListener("click", function (e) {
          if (e.target === checkbox) return; // already toggled by native click
          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event("change", { bubbles: true }));
        });

        list.appendChild(row);
      });

      // Initial footer summary
      var needsCheck = state.files.filter(function (f) { return f.needsTypeCheck; }).length;
      var confirmed = state.files.length - needsCheck;
      var summary = "Found " + state.files.length + " presentation(s)";
      if (needsCheck > 0) {
        summary += " (" + confirmed + " confirmed, " + needsCheck + " pending)";
      }
      statusArea.textContent = summary;
    }

    body.appendChild(list);

    // Assemble
    root.appendChild(header);
    root.appendChild(toolbar);
    root.appendChild(body);
    root.appendChild(footer);

    document.body.appendChild(root);
    state.root = root;

    // Initial selection sync
    syncSelectionUI(root, selectAllCheckbox, selCountEl, downloadButton);

    // ── Event wiring ──

    // Close
    closeButton.addEventListener("click", function () {
      destroyOverlay();
    });

    // Escape key (on document so it works even when overlay isn't focused)
    document.addEventListener("keydown", handleEscape);

    // Focus trap
    trapFocus(root);

    // Auto-focus the search input
    searchInput.focus();

    // Search
    searchInput.addEventListener("input", function () {
      applySearch(root, searchInput.value);
      syncSelectionUI(root, selectAllCheckbox, selCountEl, downloadButton);
    });

    // Select all (only toggles visible items)
    selectAllCheckbox.addEventListener("change", function () {
      var checked = selectAllCheckbox.checked;
      getVisibleCheckboxes(root).forEach(function (cb) {
        if (cb instanceof HTMLInputElement) cb.checked = checked;
      });
      syncSelectionUI(root, selectAllCheckbox, selCountEl, downloadButton);
    });

    // Per-item checkbox changes
    list.addEventListener("change", function (event) {
      var target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!target.classList.contains("cpd-item-checkbox")) return;
      syncSelectionUI(root, selectAllCheckbox, selCountEl, downloadButton);
    });

    // Download
    downloadButton.addEventListener("click", function () {
      if (!state.onDownload) return;
      if (downloadButton.disabled) return;

      var selectedIds = [];
      getVisibleCheckboxes(root).forEach(function (cb) {
        if (cb instanceof HTMLInputElement && cb.checked) {
          var id = cb.dataset.id;
          if (id) selectedIds.push(id);
        }
      });

      if (!selectedIds.length) {
        statusArea.textContent = "Select at least one file to download.";
        return;
      }

      var selectedFiles = state.files.filter(function (f) {
        return selectedIds.indexOf(f.id) !== -1;
      });

      if (!selectedFiles.length) {
        statusArea.textContent = "No matching files for selection.";
        return;
      }

      statusArea.textContent = "Queued " + selectedFiles.length + " file(s) for download\u2026";
      state.onDownload(selectedFiles);
    });
  }

  /* ── Status updates from background ──────────────────────────────── */

  function updateItemStatus(id, status, error) {
    var root = document.getElementById(OVERLAY_ID);
    if (!root) return;

    var row = root.querySelector('.cpd-item[data-id="' + id + '"]');
    if (!row) return;

    var statusEl = row.querySelector(".cpd-item-status");
    if (!statusEl) return;

    // Clear previous badge
    statusEl.innerHTML = "";

    var text = "";
    var badgeStatus = "";

    if (status === "queued") {
      text = "Queued";
      badgeStatus = "queued";
    } else if (status === "resolving") {
      text = "Resolving\u2026";
      badgeStatus = "resolving";
    } else if (status === "downloading") {
      text = "Downloading\u2026";
      badgeStatus = "downloading";
    } else if (status === "success") {
      text = "Done";
      badgeStatus = "success";
    } else if (status === "error") {
      text = error ? "Error: " + error : "Error";
      badgeStatus = "error";
    }

    if (text) {
      var badge = document.createElement("span");
      badge.className = "cpd-badge";
      badge.dataset.status = badgeStatus;
      badge.textContent = text;
      statusEl.appendChild(badge);
    }
  }

  /* ── Public API ─────────────────────────────────────────────────── */

  window.CanvasPresentationOverlay = {
    createOverlay: createOverlay,
    destroyOverlay: destroyOverlay,
    isOverlayVisible: isOverlayVisible,
    updateItemStatus: updateItemStatus
  };
})();
