(function () {
  // ── Helpers ──────────────────────────────────────────────────────────

  function isOnModulesPage() {
    try {
      const path = window.location.pathname || "";
      const looksLikeModules = /\/courses\/\d+\/modules/.test(path);
      // Canvas may use different containers depending on version / theme.
      const hasModulesContainer =
        document.querySelector("#context_modules") ||
        document.querySelector(".context_module") ||
        document.querySelector("[data-testid='context-modules']") ||
        document.querySelector(".context_module_item");
      return !!(looksLikeModules && hasModulesContainer);
    } catch {
      return false;
    }
  }

  function hashString(str) {
    let hash = 0;
    if (!str) return "0";
    for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i);
      hash = (hash << 5) - hash + chr;
      hash |= 0;
    }
    return hash.toString(16);
  }

  function normalizeFilenameFromUrl(url) {
    try {
      const u = new URL(url);
      const lastSegment = u.pathname.split("/").filter(Boolean).pop() || "";
      const withoutQuery = lastSegment.split("?")[0];
      if (!withoutQuery) return "";
      return decodeURIComponent(withoutQuery);
    } catch {
      return "";
    }
  }

  function detectFileTypeFromName(name) {
    const lower = (name || "").toLowerCase();
    if (/\.pdf$/i.test(lower)) return "pdf";
    if (/\.pptx?$/i.test(lower) || /\.ppsx?$/i.test(lower)) return "ppt";
    if (/\.key$/i.test(lower)) return "key";
    if (/\.odp$/i.test(lower)) return "odp";
    if (/\.docx?$/i.test(lower)) return "doc";
    if (/\.xlsx?$/i.test(lower)) return "xls";
    if (/\.zip$/i.test(lower)) return "zip";
    return "file";
  }

  function detectFileTypeFromUrl(url) {
    const lower = (url || "").toLowerCase();
    if (/\.(pdf)(\?|$)/.test(lower)) return "pdf";
    if (/\.(pptx?|ppsx?)(\?|$)/.test(lower)) return "ppt";
    if (/\.(key)(\?|$)/.test(lower)) return "key";
    if (/\.(odp)(\?|$)/.test(lower)) return "odp";
    return "file";
  }

  // ── URL pattern matchers ─────────────────────────────────────────────

  /** /courses/<id>/modules/items/<id> */
  function isModuleItemUrl(href) {
    return /\/courses\/\d+\/modules\/items\/\d+/.test(href);
  }

  /** /files/<id> */
  function isCanvasFileUrl(href) {
    return /\/files\/\d+/.test(href);
  }

  /** Known presentation / document file extension in the URL */
  function hasFileExtensionInUrl(href) {
    return /\.(pdf|ppt|pptx|pps|ppsx|key|odp|doc|docx|xls|xlsx|zip)(\?|$)/i.test(href);
  }

  // ── DOM heuristics to decide if a module item row is a "file" ────────

  /**
   * Walk up from anchor to find the nearest module-item row element.
   * Canvas usually wraps each item in an <li> with class context_module_item
   * or a div with class ig-row.
   */
  function findModuleItemRow(anchor) {
    let el = anchor;
    for (let i = 0; i < 10 && el; i++) {
      if (!el || el === document.body) return null;
      if (
        (el.classList && el.classList.contains("context_module_item")) ||
        (el.classList && el.classList.contains("ig-row")) ||
        (el.id && /context_module_item_/.test(el.id))
      ) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  /**
   * Given a module item row element, decide whether it represents a file
   * (as opposed to a quiz, page, assignment, discussion, etc.).
   *
   * Canvas marks file items in several ways depending on version:
   *   - class "attachment" or containing "Attachment" type
   *   - class containing "File" (e.g. "context_module_item" + data attrs)
   *   - an icon element with class icon-paperclip, icon-document, icon-download,
   *     or an <i> whose class contains "icon-" relating to files
   *   - data-module-item-type or data-type attributes
   *
   * We also look at the link text for file-extension patterns.
   */
  function isFileItemRow(row, anchor) {
    if (!row) return false;

    // 1) Check data attributes on the row
    const moduleType = (
      row.getAttribute("data-module-type") ||
      row.getAttribute("data-type") ||
      row.getAttribute("data-module-item-type") ||
      ""
    ).toLowerCase();
    if (moduleType === "file" || moduleType === "attachment") return true;

    // Non-file types we can exclude quickly
    const nonFileTypes = [
      "assignment", "quiz", "discussion", "page", "external_url",
      "externalurl", "external_tool", "externaltool", "sub_header",
      "subheader"
    ];
    if (nonFileTypes.includes(moduleType)) return false;

    // 2) Check CSS classes on the row or its ancestors
    const rowClasses = (row.className || "").toLowerCase();
    if (
      rowClasses.includes("attachment") ||
      rowClasses.includes("type_file") ||
      rowClasses.includes("item_type_file")
    ) {
      return true;
    }
    if (
      rowClasses.includes("quiz") ||
      rowClasses.includes("assignment") ||
      rowClasses.includes("discussion") ||
      rowClasses.includes("wiki_page") ||
      rowClasses.includes("external_url") ||
      rowClasses.includes("context_external_tool") ||
      rowClasses.includes("sub_header")
    ) {
      return false;
    }

    // 3) Look for file-related icons inside the row
    //    NOTE: icon-document is deliberately excluded — Canvas uses it for Pages too.
    const icons = row.querySelectorAll("i[class*='icon-'], span[class*='icon-']");
    for (const icon of icons) {
      const cls = (icon.className || "").toLowerCase();
      if (
        cls.includes("icon-paperclip") ||
        cls.includes("icon-download") ||
        cls.includes("icon-pdf") ||
        cls.includes("icon-ms-ppt") ||
        cls.includes("icon-ms-word") ||
        cls.includes("icon-ms-excel") ||
        cls.includes("icon-attachment")
      ) {
        return true;
      }
    }

    // 4) Check the link text — does it look like a filename with an extension?
    const text = (
      anchor.textContent ||
      anchor.getAttribute("title") ||
      anchor.getAttribute("aria-label") ||
      ""
    ).trim();
    if (/\.\w{2,5}$/.test(text)) {
      // Looks like "Lecture_1.pptx" or "notes.pdf"
      return true;
    }

    // 5) No positive file signals found — do NOT include this item.
    //    Previously this was a permissive fallback that included all
    //    module-item URLs, which caused quizzes/pages/assignments to appear.
    return false;
  }

  // ── Presentation-only filter ────────────────────────────────────────

  const PRESENTATION_EXTENSIONS = /\.(pptx?|ppsx?|key|pdf)$/i;

  /**
   * Returns true if the visible name or filename looks like a presentation.
   * If neither contains an extension at all, returns "unknown" (needs resolver).
   */
  function isPresentationByName(name) {
    if (!name) return "unknown";
    const trimmed = name.trim();
    // If the name ends with any file extension, check against presentation set
    if (/\.\w{2,5}$/.test(trimmed)) {
      return PRESENTATION_EXTENSIONS.test(trimmed);
    }
    // No extension visible — can't tell from name alone
    return "unknown";
  }

  // ── Main parser ──────────────────────────────────────────────────────

  /**
   * Parse the Canvas Modules DOM and return file candidates.
   *
   * Returns { files: [...], debug: { ... } }
   *   files[]: { id, title, url, filename, type, source }
   *   debug:   { totalAnchors, matchedAnchors, sampleHrefs }
   */
  function parseModuleFiles() {
    const results = [];
    const seenUrls = new Set();

    const root =
      document.querySelector("#context_modules") ||
      document.querySelector("[data-testid='context-modules']") ||
      document.body;

    // Broad selector: grab all anchors inside module items, plus any with
    // module-item or file URLs anywhere in the root.
    const anchors = root.querySelectorAll([
      ".context_module_item a",
      "a.ig-title",
      "a.item_link",
      ".ig-title a",
      "a[href*='/modules/items/']",
      "a[href*='/files/']"
    ].join(", "));

    const totalAnchors = anchors.length;
    let matchedAnchors = 0;
    const sampleHrefs = [];

    anchors.forEach((anchor) => {
      const href = anchor.href;
      if (!href || href.startsWith("javascript:")) return;

      // Collect sample hrefs for debug (first 15)
      if (sampleHrefs.length < 15) {
        const short = href.replace(/^https?:\/\/[^/]+/, "");
        if (!sampleHrefs.includes(short)) {
          sampleHrefs.push(short);
        }
      }

      // ── Decide if this anchor is a candidate ──
      const moduleItemLink = isModuleItemUrl(href);
      const directFileLink = isCanvasFileUrl(href);
      const extensionLink = hasFileExtensionInUrl(href);

      if (!moduleItemLink && !directFileLink && !extensionLink) {
        return; // Not a file-like URL at all
      }

      // For module item links, apply DOM heuristics to filter out quizzes etc.
      if (moduleItemLink && !directFileLink && !extensionLink) {
        const row = findModuleItemRow(anchor);
        if (row && !isFileItemRow(row, anchor)) {
          return; // Identified as non-file item
        }
      }

      // ── Deduplicate by URL ──
      if (seenUrls.has(href)) return;
      seenUrls.add(href);

      matchedAnchors++;

      // ── Extract title / filename ──
      const rawTitle =
        anchor.getAttribute("data-title") ||
        anchor.getAttribute("title") ||
        anchor.getAttribute("aria-label") ||
        anchor.textContent ||
        "";
      const title = rawTitle.trim().replace(/\s+/g, " ");

      const filenameFromUrl = normalizeFilenameFromUrl(href);
      const filename =
        filenameFromUrl ||
        (title && !/^\d+$/.test(title) ? title : "") ||
        "";

      const type = extensionLink || directFileLink
        ? detectFileTypeFromUrl(href)
        : detectFileTypeFromName(title || filename);

      const source = directFileLink
        ? "direct"
        : moduleItemLink
          ? "module_item"
          : "extension";

      const id = hashString(`${title}|${href}`);

      // ── Presentation-only filter ──
      // Check the visible title/filename for a presentation extension.
      const presCheck = isPresentationByName(title) === true
        ? true
        : isPresentationByName(filename);

      // If we can positively determine it is NOT a presentation, skip it.
      if (presCheck === false) {
        return;
      }
      // presCheck === true  → known presentation, include it
      // presCheck === "unknown" → no extension visible; include and let the
      //   background resolver verify the type before downloading.

      const needsTypeCheck = presCheck === "unknown";

      results.push({
        id,
        title: title || filename || href,
        url: href,
        filename,
        type,
        source,
        needsTypeCheck
      });
    });

    return {
      files: results,
      debug: {
        pageUrl: window.location.href,
        totalAnchors,
        matchedAnchors,
        sampleHrefs
      }
    };
  }

  window.CanvasModulesParser = {
    isOnModulesPage,
    parseModuleFiles
  };
})();
