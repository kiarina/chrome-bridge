/*! Includes code derived from Playwright v1.51.1 under Apache-2.0. See THIRD_PARTY_NOTICES.md. */
(() => {
  // src/vendor/playwright-v1.51.1/stringUtils.ts
  var normalizedWhitespaceCache;
  function normalizeWhiteSpace(text) {
    let result = normalizedWhitespaceCache?.get(text);
    if (result === void 0) {
      result = text.replace(/[\u200b\u00ad]/g, "").trim().replace(/\s+/g, " ");
      normalizedWhitespaceCache?.set(text, result);
    }
    return result;
  }
  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function longestCommonSubstring(s1, s2) {
    const n = s1.length;
    const m = s2.length;
    let maxLen = 0;
    let endingIndex = 0;
    const dp = Array(n + 1).fill(null).map(() => Array(m + 1).fill(0));
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        if (s1[i - 1] === s2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
          if (dp[i][j] > maxLen) {
            maxLen = dp[i][j];
            endingIndex = i;
          }
        }
      }
    }
    return s1.slice(endingIndex - maxLen, endingIndex);
  }

  // src/vendor/playwright-v1.51.1/domUtils.ts
  var browserNameForWorkarounds = "";
  function parentElementOrShadowHost(element) {
    if (element.parentElement)
      return element.parentElement;
    if (!element.parentNode)
      return;
    if (element.parentNode.nodeType === 11 && element.parentNode.host)
      return element.parentNode.host;
  }
  function enclosingShadowRootOrDocument(element) {
    let node = element;
    while (node.parentNode)
      node = node.parentNode;
    if (node.nodeType === 11 || node.nodeType === 9)
      return node;
  }
  function enclosingShadowHost(element) {
    while (element.parentElement)
      element = element.parentElement;
    return parentElementOrShadowHost(element);
  }
  function closestCrossShadow(element, css, scope) {
    while (element) {
      const closest = element.closest(css);
      if (scope && closest !== scope && closest?.contains(scope))
        return;
      if (closest)
        return closest;
      element = enclosingShadowHost(element);
    }
  }
  function getElementComputedStyle(element, pseudo) {
    return element.ownerDocument && element.ownerDocument.defaultView ? element.ownerDocument.defaultView.getComputedStyle(element, pseudo) : void 0;
  }
  function isElementStyleVisibilityVisible(element, style) {
    style = style ?? getElementComputedStyle(element);
    if (!style)
      return true;
    if (Element.prototype.checkVisibility && browserNameForWorkarounds !== "webkit") {
      if (!element.checkVisibility())
        return false;
    } else {
      const detailsOrSummary = element.closest("details,summary");
      if (detailsOrSummary !== element && detailsOrSummary?.nodeName === "DETAILS" && !detailsOrSummary.open)
        return false;
    }
    if (style.visibility !== "visible")
      return false;
    return true;
  }
  function isVisibleTextNode(node) {
    const range = node.ownerDocument.createRange();
    range.selectNode(node);
    const rect = range.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function elementSafeTagName(element) {
    if (element instanceof HTMLFormElement)
      return "FORM";
    return element.tagName.toUpperCase();
  }

  // src/vendor/playwright-v1.51.1/roleUtils.ts
  function hasExplicitAccessibleName(e) {
    return e.hasAttribute("aria-label") || e.hasAttribute("aria-labelledby");
  }
  var kAncestorPreventingLandmark = "article:not([role]), aside:not([role]), main:not([role]), nav:not([role]), section:not([role]), [role=article], [role=complementary], [role=main], [role=navigation], [role=region]";
  var kGlobalAriaAttributes = /* @__PURE__ */ new Map([
    ["aria-atomic", void 0],
    ["aria-busy", void 0],
    ["aria-controls", void 0],
    ["aria-current", void 0],
    ["aria-describedby", void 0],
    ["aria-details", void 0],
    // Global use deprecated in ARIA 1.2
    // ['aria-disabled', undefined],
    ["aria-dropeffect", void 0],
    // Global use deprecated in ARIA 1.2
    // ['aria-errormessage', undefined],
    ["aria-flowto", void 0],
    ["aria-grabbed", void 0],
    // Global use deprecated in ARIA 1.2
    // ['aria-haspopup', undefined],
    ["aria-hidden", void 0],
    // Global use deprecated in ARIA 1.2
    // ['aria-invalid', undefined],
    ["aria-keyshortcuts", void 0],
    ["aria-label", /* @__PURE__ */ new Set(["caption", "code", "deletion", "emphasis", "generic", "insertion", "paragraph", "presentation", "strong", "subscript", "superscript"])],
    ["aria-labelledby", /* @__PURE__ */ new Set(["caption", "code", "deletion", "emphasis", "generic", "insertion", "paragraph", "presentation", "strong", "subscript", "superscript"])],
    ["aria-live", void 0],
    ["aria-owns", void 0],
    ["aria-relevant", void 0],
    ["aria-roledescription", /* @__PURE__ */ new Set(["generic"])]
  ]);
  function hasGlobalAriaAttribute(element, forRole) {
    return [...kGlobalAriaAttributes].some(([attr, prohibited]) => {
      return !prohibited?.has(forRole || "") && element.hasAttribute(attr);
    });
  }
  function hasTabIndex(element) {
    return !Number.isNaN(Number(String(element.getAttribute("tabindex"))));
  }
  function isFocusable(element) {
    return !isNativelyDisabled(element) && (isNativelyFocusable(element) || hasTabIndex(element));
  }
  function isNativelyFocusable(element) {
    const tagName = elementSafeTagName(element);
    if (["BUTTON", "DETAILS", "SELECT", "TEXTAREA"].includes(tagName))
      return true;
    if (tagName === "A" || tagName === "AREA")
      return element.hasAttribute("href");
    if (tagName === "INPUT")
      return !element.hidden;
    return false;
  }
  var kImplicitRoleByTagName = {
    "A": (e) => {
      return e.hasAttribute("href") ? "link" : null;
    },
    "AREA": (e) => {
      return e.hasAttribute("href") ? "link" : null;
    },
    "ARTICLE": () => "article",
    "ASIDE": () => "complementary",
    "BLOCKQUOTE": () => "blockquote",
    "BUTTON": () => "button",
    "CAPTION": () => "caption",
    "CODE": () => "code",
    "DATALIST": () => "listbox",
    "DD": () => "definition",
    "DEL": () => "deletion",
    "DETAILS": () => "group",
    "DFN": () => "term",
    "DIALOG": () => "dialog",
    "DT": () => "term",
    "EM": () => "emphasis",
    "FIELDSET": () => "group",
    "FIGURE": () => "figure",
    "FOOTER": (e) => closestCrossShadow(e, kAncestorPreventingLandmark) ? null : "contentinfo",
    "FORM": (e) => hasExplicitAccessibleName(e) ? "form" : null,
    "H1": () => "heading",
    "H2": () => "heading",
    "H3": () => "heading",
    "H4": () => "heading",
    "H5": () => "heading",
    "H6": () => "heading",
    "HEADER": (e) => closestCrossShadow(e, kAncestorPreventingLandmark) ? null : "banner",
    "HR": () => "separator",
    "HTML": () => "document",
    "IMG": (e) => e.getAttribute("alt") === "" && !e.getAttribute("title") && !hasGlobalAriaAttribute(e) && !hasTabIndex(e) ? "presentation" : "img",
    "INPUT": (e) => {
      const type = e.type.toLowerCase();
      if (type === "search")
        return e.hasAttribute("list") ? "combobox" : "searchbox";
      if (["email", "tel", "text", "url", ""].includes(type)) {
        const list = getIdRefs(e, e.getAttribute("list"))[0];
        return list && elementSafeTagName(list) === "DATALIST" ? "combobox" : "textbox";
      }
      if (type === "hidden")
        return null;
      return inputTypeToRole[type] || "textbox";
    },
    "INS": () => "insertion",
    "LI": () => "listitem",
    "MAIN": () => "main",
    "MARK": () => "mark",
    "MATH": () => "math",
    "MENU": () => "list",
    "METER": () => "meter",
    "NAV": () => "navigation",
    "OL": () => "list",
    "OPTGROUP": () => "group",
    "OPTION": () => "option",
    "OUTPUT": () => "status",
    "P": () => "paragraph",
    "PROGRESS": () => "progressbar",
    "SECTION": (e) => hasExplicitAccessibleName(e) ? "region" : null,
    "SELECT": (e) => e.hasAttribute("multiple") || e.size > 1 ? "listbox" : "combobox",
    "STRONG": () => "strong",
    "SUB": () => "subscript",
    "SUP": () => "superscript",
    // For <svg> we default to Chrome behavior:
    // - Chrome reports 'img'.
    // - Firefox reports 'diagram' that is not in official ARIA spec yet.
    // - Safari reports 'no role', but still computes accessible name.
    "SVG": () => "img",
    "TABLE": () => "table",
    "TBODY": () => "rowgroup",
    "TD": (e) => {
      const table = closestCrossShadow(e, "table");
      const role = table ? getExplicitAriaRole(table) : "";
      return role === "grid" || role === "treegrid" ? "gridcell" : "cell";
    },
    "TEXTAREA": () => "textbox",
    "TFOOT": () => "rowgroup",
    "TH": (e) => {
      if (e.getAttribute("scope") === "col")
        return "columnheader";
      if (e.getAttribute("scope") === "row")
        return "rowheader";
      const table = closestCrossShadow(e, "table");
      const role = table ? getExplicitAriaRole(table) : "";
      return role === "grid" || role === "treegrid" ? "gridcell" : "cell";
    },
    "THEAD": () => "rowgroup",
    "TIME": () => "time",
    "TR": () => "row",
    "UL": () => "list"
  };
  var kPresentationInheritanceParents = {
    "DD": ["DL", "DIV"],
    "DIV": ["DL"],
    "DT": ["DL", "DIV"],
    "LI": ["OL", "UL"],
    "TBODY": ["TABLE"],
    "TD": ["TR"],
    "TFOOT": ["TABLE"],
    "TH": ["TR"],
    "THEAD": ["TABLE"],
    "TR": ["THEAD", "TBODY", "TFOOT", "TABLE"]
  };
  function getImplicitAriaRole(element) {
    const implicitRole = kImplicitRoleByTagName[elementSafeTagName(element)]?.(element) || "";
    if (!implicitRole)
      return null;
    let ancestor = element;
    while (ancestor) {
      const parent = parentElementOrShadowHost(ancestor);
      const parents = kPresentationInheritanceParents[elementSafeTagName(ancestor)];
      if (!parents || !parent || !parents.includes(elementSafeTagName(parent)))
        break;
      const parentExplicitRole = getExplicitAriaRole(parent);
      if ((parentExplicitRole === "none" || parentExplicitRole === "presentation") && !hasPresentationConflictResolution(parent, parentExplicitRole))
        return parentExplicitRole;
      ancestor = parent;
    }
    return implicitRole;
  }
  var validRoles = [
    "alert",
    "alertdialog",
    "application",
    "article",
    "banner",
    "blockquote",
    "button",
    "caption",
    "cell",
    "checkbox",
    "code",
    "columnheader",
    "combobox",
    "complementary",
    "contentinfo",
    "definition",
    "deletion",
    "dialog",
    "directory",
    "document",
    "emphasis",
    "feed",
    "figure",
    "form",
    "generic",
    "grid",
    "gridcell",
    "group",
    "heading",
    "img",
    "insertion",
    "link",
    "list",
    "listbox",
    "listitem",
    "log",
    "main",
    "mark",
    "marquee",
    "math",
    "meter",
    "menu",
    "menubar",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "navigation",
    "none",
    "note",
    "option",
    "paragraph",
    "presentation",
    "progressbar",
    "radio",
    "radiogroup",
    "region",
    "row",
    "rowgroup",
    "rowheader",
    "scrollbar",
    "search",
    "searchbox",
    "separator",
    "slider",
    "spinbutton",
    "status",
    "strong",
    "subscript",
    "superscript",
    "switch",
    "tab",
    "table",
    "tablist",
    "tabpanel",
    "term",
    "textbox",
    "time",
    "timer",
    "toolbar",
    "tooltip",
    "tree",
    "treegrid",
    "treeitem"
  ];
  function getExplicitAriaRole(element) {
    const roles = (element.getAttribute("role") || "").split(" ").map((role) => role.trim());
    return roles.find((role) => validRoles.includes(role)) || null;
  }
  function hasPresentationConflictResolution(element, role) {
    return hasGlobalAriaAttribute(element, role) || isFocusable(element);
  }
  function getAriaRole(element) {
    const explicitRole = getExplicitAriaRole(element);
    if (!explicitRole)
      return getImplicitAriaRole(element);
    if (explicitRole === "none" || explicitRole === "presentation") {
      const implicitRole = getImplicitAriaRole(element);
      if (hasPresentationConflictResolution(element, implicitRole))
        return implicitRole;
    }
    return explicitRole;
  }
  function getAriaBoolean(attr) {
    return attr === null ? void 0 : attr.toLowerCase() === "true";
  }
  function isElementIgnoredForAria(element) {
    return ["STYLE", "SCRIPT", "NOSCRIPT", "TEMPLATE"].includes(elementSafeTagName(element));
  }
  function isElementHiddenForAria(element) {
    if (isElementIgnoredForAria(element))
      return true;
    const style = getElementComputedStyle(element);
    const isSlot = element.nodeName === "SLOT";
    if (style?.display === "contents" && !isSlot) {
      for (let child = element.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 1 && !isElementHiddenForAria(child))
          return false;
        if (child.nodeType === 3 && isVisibleTextNode(child))
          return false;
      }
      return true;
    }
    const isOptionInsideSelect = element.nodeName === "OPTION" && !!element.closest("select");
    if (!isOptionInsideSelect && !isSlot && !isElementStyleVisibilityVisible(element, style))
      return true;
    return belongsToDisplayNoneOrAriaHiddenOrNonSlotted(element);
  }
  function belongsToDisplayNoneOrAriaHiddenOrNonSlotted(element) {
    let hidden = cacheIsHidden?.get(element);
    if (hidden === void 0) {
      hidden = false;
      if (element.parentElement && element.parentElement.shadowRoot && !element.assignedSlot)
        hidden = true;
      if (!hidden) {
        const style = getElementComputedStyle(element);
        hidden = !style || style.display === "none" || getAriaBoolean(element.getAttribute("aria-hidden")) === true;
      }
      if (!hidden) {
        const parent = parentElementOrShadowHost(element);
        if (parent)
          hidden = belongsToDisplayNoneOrAriaHiddenOrNonSlotted(parent);
      }
      cacheIsHidden?.set(element, hidden);
    }
    return hidden;
  }
  function getIdRefs(element, ref) {
    if (!ref)
      return [];
    const root = enclosingShadowRootOrDocument(element);
    if (!root)
      return [];
    try {
      const ids = ref.split(" ").filter((id) => !!id);
      const set = /* @__PURE__ */ new Set();
      for (const id of ids) {
        const firstElement = root.querySelector("#" + CSS.escape(id));
        if (firstElement)
          set.add(firstElement);
      }
      return [...set];
    } catch (e) {
      return [];
    }
  }
  function trimFlatString(s) {
    return s.trim();
  }
  function asFlatString(s) {
    return s.split("\xA0").map((chunk) => chunk.replace(/\r\n/g, "\n").replace(/[\u200b\u00ad]/g, "").replace(/\s\s*/g, " ")).join("\xA0").trim();
  }
  function queryInAriaOwned(element, selector) {
    const result = [...element.querySelectorAll(selector)];
    for (const owned of getIdRefs(element, element.getAttribute("aria-owns"))) {
      if (owned.matches(selector))
        result.push(owned);
      result.push(...owned.querySelectorAll(selector));
    }
    return result;
  }
  function getPseudoContent(element, pseudo) {
    const cache = pseudo === "::before" ? cachePseudoContentBefore : cachePseudoContentAfter;
    if (cache?.has(element))
      return cache?.get(element) || "";
    const pseudoStyle = getElementComputedStyle(element, pseudo);
    const content = getPseudoContentImpl(element, pseudoStyle);
    if (cache)
      cache.set(element, content);
    return content;
  }
  function getPseudoContentImpl(element, pseudoStyle) {
    if (!pseudoStyle || pseudoStyle.display === "none" || pseudoStyle.visibility === "hidden")
      return "";
    const content = pseudoStyle.content;
    let resolvedContent;
    if (content[0] === "'" && content[content.length - 1] === "'" || content[0] === '"' && content[content.length - 1] === '"') {
      resolvedContent = content.substring(1, content.length - 1);
    } else if (content.startsWith("attr(") && content.endsWith(")")) {
      const attrName = content.substring("attr(".length, content.length - 1).trim();
      resolvedContent = element.getAttribute(attrName) || "";
    }
    if (resolvedContent !== void 0) {
      const display = pseudoStyle.display || "inline";
      if (display !== "inline")
        return " " + resolvedContent + " ";
      return resolvedContent;
    }
    return "";
  }
  function getAriaLabelledByElements(element) {
    const ref = element.getAttribute("aria-labelledby");
    if (ref === null)
      return null;
    const refs = getIdRefs(element, ref);
    return refs.length ? refs : null;
  }
  function allowsNameFromContent(role, targetDescendant) {
    const alwaysAllowsNameFromContent = ["button", "cell", "checkbox", "columnheader", "gridcell", "heading", "link", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "radio", "row", "rowheader", "switch", "tab", "tooltip", "treeitem"].includes(role);
    const descendantAllowsNameFromContent = targetDescendant && ["", "caption", "code", "contentinfo", "definition", "deletion", "emphasis", "insertion", "list", "listitem", "mark", "none", "paragraph", "presentation", "region", "row", "rowgroup", "section", "strong", "subscript", "superscript", "table", "term", "time"].includes(role);
    return alwaysAllowsNameFromContent || descendantAllowsNameFromContent;
  }
  function getElementAccessibleName(element, includeHidden) {
    const cache = includeHidden ? cacheAccessibleNameHidden : cacheAccessibleName;
    let accessibleName = cache?.get(element);
    if (accessibleName === void 0) {
      accessibleName = "";
      const elementProhibitsNaming = ["caption", "code", "definition", "deletion", "emphasis", "generic", "insertion", "mark", "paragraph", "presentation", "strong", "subscript", "suggestion", "superscript", "term", "time"].includes(getAriaRole(element) || "");
      if (!elementProhibitsNaming) {
        accessibleName = asFlatString(getTextAlternativeInternal(element, {
          includeHidden,
          visitedElements: /* @__PURE__ */ new Set(),
          embeddedInTargetElement: "self"
        }));
      }
      cache?.set(element, accessibleName);
    }
    return accessibleName;
  }
  function getTextAlternativeInternal(element, options) {
    if (options.visitedElements.has(element))
      return "";
    const childOptions = {
      ...options,
      embeddedInTargetElement: options.embeddedInTargetElement === "self" ? "descendant" : options.embeddedInTargetElement
    };
    if (!options.includeHidden) {
      const isEmbeddedInHiddenReferenceTraversal = !!options.embeddedInLabelledBy?.hidden || !!options.embeddedInDescribedBy?.hidden || !!options.embeddedInNativeTextAlternative?.hidden || !!options.embeddedInLabel?.hidden;
      if (isElementIgnoredForAria(element) || !isEmbeddedInHiddenReferenceTraversal && isElementHiddenForAria(element)) {
        options.visitedElements.add(element);
        return "";
      }
    }
    const labelledBy = getAriaLabelledByElements(element);
    if (!options.embeddedInLabelledBy) {
      const accessibleName = (labelledBy || []).map((ref) => getTextAlternativeInternal(ref, {
        ...options,
        embeddedInLabelledBy: { element: ref, hidden: isElementHiddenForAria(ref) },
        embeddedInDescribedBy: void 0,
        embeddedInTargetElement: void 0,
        embeddedInLabel: void 0,
        embeddedInNativeTextAlternative: void 0
      })).join(" ");
      if (accessibleName)
        return accessibleName;
    }
    const role = getAriaRole(element) || "";
    const tagName = elementSafeTagName(element);
    if (!!options.embeddedInLabel || !!options.embeddedInLabelledBy || options.embeddedInTargetElement === "descendant") {
      const isOwnLabel = [...element.labels || []].includes(element);
      const isOwnLabelledBy = (labelledBy || []).includes(element);
      if (!isOwnLabel && !isOwnLabelledBy) {
        if (role === "textbox") {
          options.visitedElements.add(element);
          if (tagName === "INPUT" || tagName === "TEXTAREA")
            return element.value;
          return element.textContent || "";
        }
        if (["combobox", "listbox"].includes(role)) {
          options.visitedElements.add(element);
          let selectedOptions;
          if (tagName === "SELECT") {
            selectedOptions = [...element.selectedOptions];
            if (!selectedOptions.length && element.options.length)
              selectedOptions.push(element.options[0]);
          } else {
            const listbox = role === "combobox" ? queryInAriaOwned(element, "*").find((e) => getAriaRole(e) === "listbox") : element;
            selectedOptions = listbox ? queryInAriaOwned(listbox, '[aria-selected="true"]').filter((e) => getAriaRole(e) === "option") : [];
          }
          if (!selectedOptions.length && tagName === "INPUT") {
            return element.value;
          }
          return selectedOptions.map((option) => getTextAlternativeInternal(option, childOptions)).join(" ");
        }
        if (["progressbar", "scrollbar", "slider", "spinbutton", "meter"].includes(role)) {
          options.visitedElements.add(element);
          if (element.hasAttribute("aria-valuetext"))
            return element.getAttribute("aria-valuetext") || "";
          if (element.hasAttribute("aria-valuenow"))
            return element.getAttribute("aria-valuenow") || "";
          return element.getAttribute("value") || "";
        }
        if (["menu"].includes(role)) {
          options.visitedElements.add(element);
          return "";
        }
      }
    }
    const ariaLabel = element.getAttribute("aria-label") || "";
    if (trimFlatString(ariaLabel)) {
      options.visitedElements.add(element);
      return ariaLabel;
    }
    if (!["presentation", "none"].includes(role)) {
      if (tagName === "INPUT" && ["button", "submit", "reset"].includes(element.type)) {
        options.visitedElements.add(element);
        const value = element.value || "";
        if (trimFlatString(value))
          return value;
        if (element.type === "submit")
          return "Submit";
        if (element.type === "reset")
          return "Reset";
        const title = element.getAttribute("title") || "";
        return title;
      }
      if (tagName === "INPUT" && element.type === "image") {
        options.visitedElements.add(element);
        const labels = element.labels || [];
        if (labels.length && !options.embeddedInLabelledBy)
          return getAccessibleNameFromAssociatedLabels(labels, options);
        const alt = element.getAttribute("alt") || "";
        if (trimFlatString(alt))
          return alt;
        const title = element.getAttribute("title") || "";
        if (trimFlatString(title))
          return title;
        return "Submit";
      }
      if (!labelledBy && tagName === "BUTTON") {
        options.visitedElements.add(element);
        const labels = element.labels || [];
        if (labels.length)
          return getAccessibleNameFromAssociatedLabels(labels, options);
      }
      if (!labelledBy && tagName === "OUTPUT") {
        options.visitedElements.add(element);
        const labels = element.labels || [];
        if (labels.length)
          return getAccessibleNameFromAssociatedLabels(labels, options);
        return element.getAttribute("title") || "";
      }
      if (!labelledBy && (tagName === "TEXTAREA" || tagName === "SELECT" || tagName === "INPUT")) {
        options.visitedElements.add(element);
        const labels = element.labels || [];
        if (labels.length)
          return getAccessibleNameFromAssociatedLabels(labels, options);
        const usePlaceholder = tagName === "INPUT" && ["text", "password", "search", "tel", "email", "url"].includes(element.type) || tagName === "TEXTAREA";
        const placeholder = element.getAttribute("placeholder") || "";
        const title = element.getAttribute("title") || "";
        if (!usePlaceholder || title)
          return title;
        return placeholder;
      }
      if (!labelledBy && tagName === "FIELDSET") {
        options.visitedElements.add(element);
        for (let child = element.firstElementChild; child; child = child.nextElementSibling) {
          if (elementSafeTagName(child) === "LEGEND") {
            return getTextAlternativeInternal(child, {
              ...childOptions,
              embeddedInNativeTextAlternative: { element: child, hidden: isElementHiddenForAria(child) }
            });
          }
        }
        const title = element.getAttribute("title") || "";
        return title;
      }
      if (!labelledBy && tagName === "FIGURE") {
        options.visitedElements.add(element);
        for (let child = element.firstElementChild; child; child = child.nextElementSibling) {
          if (elementSafeTagName(child) === "FIGCAPTION") {
            return getTextAlternativeInternal(child, {
              ...childOptions,
              embeddedInNativeTextAlternative: { element: child, hidden: isElementHiddenForAria(child) }
            });
          }
        }
        const title = element.getAttribute("title") || "";
        return title;
      }
      if (tagName === "IMG") {
        options.visitedElements.add(element);
        const alt = element.getAttribute("alt") || "";
        if (trimFlatString(alt))
          return alt;
        const title = element.getAttribute("title") || "";
        return title;
      }
      if (tagName === "TABLE") {
        options.visitedElements.add(element);
        for (let child = element.firstElementChild; child; child = child.nextElementSibling) {
          if (elementSafeTagName(child) === "CAPTION") {
            return getTextAlternativeInternal(child, {
              ...childOptions,
              embeddedInNativeTextAlternative: { element: child, hidden: isElementHiddenForAria(child) }
            });
          }
        }
        const summary = element.getAttribute("summary") || "";
        if (summary)
          return summary;
      }
      if (tagName === "AREA") {
        options.visitedElements.add(element);
        const alt = element.getAttribute("alt") || "";
        if (trimFlatString(alt))
          return alt;
        const title = element.getAttribute("title") || "";
        return title;
      }
      if (tagName === "SVG" || element.ownerSVGElement) {
        options.visitedElements.add(element);
        for (let child = element.firstElementChild; child; child = child.nextElementSibling) {
          if (elementSafeTagName(child) === "TITLE" && child.ownerSVGElement) {
            return getTextAlternativeInternal(child, {
              ...childOptions,
              embeddedInLabelledBy: { element: child, hidden: isElementHiddenForAria(child) }
            });
          }
        }
      }
      if (element.ownerSVGElement && tagName === "A") {
        const title = element.getAttribute("xlink:title") || "";
        if (trimFlatString(title)) {
          options.visitedElements.add(element);
          return title;
        }
      }
    }
    const shouldNameFromContentForSummary = tagName === "SUMMARY" && !["presentation", "none"].includes(role);
    if (allowsNameFromContent(role, options.embeddedInTargetElement === "descendant") || shouldNameFromContentForSummary || !!options.embeddedInLabelledBy || !!options.embeddedInDescribedBy || !!options.embeddedInLabel || !!options.embeddedInNativeTextAlternative) {
      options.visitedElements.add(element);
      const accessibleName = innerAccumulatedElementText(element, childOptions);
      const maybeTrimmedAccessibleName = options.embeddedInTargetElement === "self" ? trimFlatString(accessibleName) : accessibleName;
      if (maybeTrimmedAccessibleName)
        return accessibleName;
    }
    if (!["presentation", "none"].includes(role) || tagName === "IFRAME") {
      options.visitedElements.add(element);
      const title = element.getAttribute("title") || "";
      if (trimFlatString(title))
        return title;
    }
    options.visitedElements.add(element);
    return "";
  }
  function innerAccumulatedElementText(element, options) {
    const tokens = [];
    const visit = (node, skipSlotted) => {
      if (skipSlotted && node.assignedSlot)
        return;
      if (node.nodeType === 1) {
        const display = getElementComputedStyle(node)?.display || "inline";
        let token = getTextAlternativeInternal(node, options);
        if (display !== "inline" || node.nodeName === "BR")
          token = " " + token + " ";
        tokens.push(token);
      } else if (node.nodeType === 3) {
        tokens.push(node.textContent || "");
      }
    };
    tokens.push(getPseudoContent(element, "::before"));
    const assignedNodes = element.nodeName === "SLOT" ? element.assignedNodes() : [];
    if (assignedNodes.length) {
      for (const child of assignedNodes)
        visit(child, false);
    } else {
      for (let child = element.firstChild; child; child = child.nextSibling)
        visit(child, true);
      if (element.shadowRoot) {
        for (let child = element.shadowRoot.firstChild; child; child = child.nextSibling)
          visit(child, true);
      }
      for (const owned of getIdRefs(element, element.getAttribute("aria-owns")))
        visit(owned, true);
    }
    tokens.push(getPseudoContent(element, "::after"));
    return tokens.join("");
  }
  var kAriaSelectedRoles = ["gridcell", "option", "row", "tab", "rowheader", "columnheader", "treeitem"];
  function getAriaSelected(element) {
    if (elementSafeTagName(element) === "OPTION")
      return element.selected;
    if (kAriaSelectedRoles.includes(getAriaRole(element) || ""))
      return getAriaBoolean(element.getAttribute("aria-selected")) === true;
    return false;
  }
  var kAriaCheckedRoles = ["checkbox", "menuitemcheckbox", "option", "radio", "switch", "menuitemradio", "treeitem"];
  function getAriaChecked(element) {
    const result = getChecked(element, true);
    return result === "error" ? false : result;
  }
  function getChecked(element, allowMixed) {
    const tagName = elementSafeTagName(element);
    if (allowMixed && tagName === "INPUT" && element.indeterminate)
      return "mixed";
    if (tagName === "INPUT" && ["checkbox", "radio"].includes(element.type))
      return element.checked;
    if (kAriaCheckedRoles.includes(getAriaRole(element) || "")) {
      const checked = element.getAttribute("aria-checked");
      if (checked === "true")
        return true;
      if (allowMixed && checked === "mixed")
        return "mixed";
      return false;
    }
    return "error";
  }
  var kAriaPressedRoles = ["button"];
  function getAriaPressed(element) {
    if (kAriaPressedRoles.includes(getAriaRole(element) || "")) {
      const pressed = element.getAttribute("aria-pressed");
      if (pressed === "true")
        return true;
      if (pressed === "mixed")
        return "mixed";
    }
    return false;
  }
  var kAriaExpandedRoles = ["application", "button", "checkbox", "combobox", "gridcell", "link", "listbox", "menuitem", "row", "rowheader", "tab", "treeitem", "columnheader", "menuitemcheckbox", "menuitemradio", "rowheader", "switch"];
  function getAriaExpanded(element) {
    if (elementSafeTagName(element) === "DETAILS")
      return element.open;
    if (kAriaExpandedRoles.includes(getAriaRole(element) || "")) {
      const expanded = element.getAttribute("aria-expanded");
      if (expanded === null)
        return void 0;
      if (expanded === "true")
        return true;
      return false;
    }
    return void 0;
  }
  var kAriaLevelRoles = ["heading", "listitem", "row", "treeitem"];
  function getAriaLevel(element) {
    const native = { "H1": 1, "H2": 2, "H3": 3, "H4": 4, "H5": 5, "H6": 6 }[elementSafeTagName(element)];
    if (native)
      return native;
    if (kAriaLevelRoles.includes(getAriaRole(element) || "")) {
      const attr = element.getAttribute("aria-level");
      const value = attr === null ? Number.NaN : Number(attr);
      if (Number.isInteger(value) && value >= 1)
        return value;
    }
    return 0;
  }
  var kAriaDisabledRoles = ["application", "button", "composite", "gridcell", "group", "input", "link", "menuitem", "scrollbar", "separator", "tab", "checkbox", "columnheader", "combobox", "grid", "listbox", "menu", "menubar", "menuitemcheckbox", "menuitemradio", "option", "radio", "radiogroup", "row", "rowheader", "searchbox", "select", "slider", "spinbutton", "switch", "tablist", "textbox", "toolbar", "tree", "treegrid", "treeitem"];
  function getAriaDisabled(element) {
    return isNativelyDisabled(element) || hasExplicitAriaDisabled(element);
  }
  function isNativelyDisabled(element) {
    const isNativeFormControl = ["BUTTON", "INPUT", "SELECT", "TEXTAREA", "OPTION", "OPTGROUP"].includes(element.tagName);
    return isNativeFormControl && (element.hasAttribute("disabled") || belongsToDisabledFieldSet(element));
  }
  function belongsToDisabledFieldSet(element) {
    if (!element)
      return false;
    if (elementSafeTagName(element) === "FIELDSET" && element.hasAttribute("disabled"))
      return true;
    return belongsToDisabledFieldSet(element.parentElement);
  }
  function hasExplicitAriaDisabled(element) {
    if (!element)
      return false;
    if (kAriaDisabledRoles.includes(getAriaRole(element) || "")) {
      const attribute = (element.getAttribute("aria-disabled") || "").toLowerCase();
      if (attribute === "true")
        return true;
      if (attribute === "false")
        return false;
    }
    return hasExplicitAriaDisabled(parentElementOrShadowHost(element));
  }
  function getAccessibleNameFromAssociatedLabels(labels, options) {
    return [...labels].map((label) => getTextAlternativeInternal(label, {
      ...options,
      embeddedInLabel: { element: label, hidden: isElementHiddenForAria(label) },
      embeddedInNativeTextAlternative: void 0,
      embeddedInLabelledBy: void 0,
      embeddedInDescribedBy: void 0,
      embeddedInTargetElement: void 0
    })).filter((accessibleName) => !!accessibleName).join(" ");
  }
  var cacheAccessibleName;
  var cacheAccessibleNameHidden;
  var cacheAccessibleDescription;
  var cacheAccessibleDescriptionHidden;
  var cacheAccessibleErrorMessage;
  var cacheIsHidden;
  var cachePseudoContentBefore;
  var cachePseudoContentAfter;
  var cachesCounter = 0;
  function beginAriaCaches() {
    ++cachesCounter;
    cacheAccessibleName ??= /* @__PURE__ */ new Map();
    cacheAccessibleNameHidden ??= /* @__PURE__ */ new Map();
    cacheAccessibleDescription ??= /* @__PURE__ */ new Map();
    cacheAccessibleDescriptionHidden ??= /* @__PURE__ */ new Map();
    cacheAccessibleErrorMessage ??= /* @__PURE__ */ new Map();
    cacheIsHidden ??= /* @__PURE__ */ new Map();
    cachePseudoContentBefore ??= /* @__PURE__ */ new Map();
    cachePseudoContentAfter ??= /* @__PURE__ */ new Map();
  }
  function endAriaCaches() {
    if (!--cachesCounter) {
      cacheAccessibleName = void 0;
      cacheAccessibleNameHidden = void 0;
      cacheAccessibleDescription = void 0;
      cacheAccessibleDescriptionHidden = void 0;
      cacheAccessibleErrorMessage = void 0;
      cacheIsHidden = void 0;
      cachePseudoContentBefore = void 0;
      cachePseudoContentAfter = void 0;
    }
  }
  var inputTypeToRole = {
    "button": "button",
    "checkbox": "checkbox",
    "image": "button",
    "number": "spinbutton",
    "radio": "radio",
    "range": "slider",
    "reset": "button",
    "submit": "button"
  };

  // src/vendor/playwright-v1.51.1/yaml.ts
  function yamlEscapeKeyIfNeeded(str) {
    if (!yamlStringNeedsQuotes(str))
      return str;
    return `'` + str.replace(/'/g, `''`) + `'`;
  }
  function yamlEscapeValueIfNeeded(str) {
    if (!yamlStringNeedsQuotes(str))
      return str;
    return '"' + str.replace(/[\\"\x00-\x1f\x7f-\x9f]/g, (c) => {
      switch (c) {
        case "\\":
          return "\\\\";
        case '"':
          return '\\"';
        case "\b":
          return "\\b";
        case "\f":
          return "\\f";
        case "\n":
          return "\\n";
        case "\r":
          return "\\r";
        case "	":
          return "\\t";
        default:
          const code = c.charCodeAt(0);
          return "\\x" + code.toString(16).padStart(2, "0");
      }
    }) + '"';
  }
  function yamlStringNeedsQuotes(str) {
    if (str.length === 0)
      return true;
    if (/^\s|\s$/.test(str))
      return true;
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(str))
      return true;
    if (/^-/.test(str))
      return true;
    if (/[\n:](\s|$)/.test(str))
      return true;
    if (/\s#/.test(str))
      return true;
    if (/[\n\r]/.test(str))
      return true;
    if (/^[&*\],?!>|@"'#%]/.test(str))
      return true;
    if (/[{}`]/.test(str))
      return true;
    if (/^\[/.test(str))
      return true;
    if (!isNaN(Number(str)) || ["y", "n", "yes", "no", "true", "false", "on", "off", "null"].includes(str.toLowerCase()))
      return true;
    return false;
  }

  // src/vendor/playwright-v1.51.1/ariaSnapshot.ts
  function generateAriaTree(rootElement) {
    const visited = /* @__PURE__ */ new Set();
    const snapshot = {
      root: { role: "fragment", name: "", children: [], element: rootElement },
      elements: /* @__PURE__ */ new Map(),
      ids: /* @__PURE__ */ new Map()
    };
    const addElement = (element) => {
      const id = snapshot.elements.size + 1;
      snapshot.elements.set(id, element);
      snapshot.ids.set(element, id);
    };
    addElement(rootElement);
    const visit = (ariaNode, node) => {
      if (visited.has(node))
        return;
      visited.add(node);
      if (node.nodeType === Node.TEXT_NODE && node.nodeValue) {
        const text = node.nodeValue;
        if (ariaNode.role !== "textbox" && text)
          ariaNode.children.push(node.nodeValue || "");
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE)
        return;
      const element = node;
      if (isElementHiddenForAria(element))
        return;
      const ariaChildren = [];
      if (element.hasAttribute("aria-owns")) {
        const ids = element.getAttribute("aria-owns").split(/\s+/);
        for (const id of ids) {
          const ownedElement = rootElement.ownerDocument.getElementById(id);
          if (ownedElement)
            ariaChildren.push(ownedElement);
        }
      }
      addElement(element);
      const childAriaNode = toAriaNode(element);
      if (childAriaNode)
        ariaNode.children.push(childAriaNode);
      processElement(childAriaNode || ariaNode, element, ariaChildren);
    };
    function processElement(ariaNode, element, ariaChildren = []) {
      const display = getElementComputedStyle(element)?.display || "inline";
      const treatAsBlock = display !== "inline" || element.nodeName === "BR" ? " " : "";
      if (treatAsBlock)
        ariaNode.children.push(treatAsBlock);
      ariaNode.children.push(getPseudoContent(element, "::before"));
      const assignedNodes = element.nodeName === "SLOT" ? element.assignedNodes() : [];
      if (assignedNodes.length) {
        for (const child of assignedNodes)
          visit(ariaNode, child);
      } else {
        for (let child = element.firstChild; child; child = child.nextSibling) {
          if (!child.assignedSlot)
            visit(ariaNode, child);
        }
        if (element.shadowRoot) {
          for (let child = element.shadowRoot.firstChild; child; child = child.nextSibling)
            visit(ariaNode, child);
        }
      }
      for (const child of ariaChildren)
        visit(ariaNode, child);
      ariaNode.children.push(getPseudoContent(element, "::after"));
      if (treatAsBlock)
        ariaNode.children.push(treatAsBlock);
      if (ariaNode.children.length === 1 && ariaNode.name === ariaNode.children[0])
        ariaNode.children = [];
    }
    beginAriaCaches();
    try {
      visit(snapshot.root, rootElement);
    } finally {
      endAriaCaches();
    }
    normalizeStringChildren(snapshot.root);
    return snapshot;
  }
  function toAriaNode(element) {
    const role = getAriaRole(element);
    if (!role || role === "presentation" || role === "none")
      return null;
    const name = normalizeWhiteSpace(getElementAccessibleName(element, false) || "");
    const result = { role, name, children: [], element };
    if (kAriaCheckedRoles.includes(role))
      result.checked = getAriaChecked(element);
    if (kAriaDisabledRoles.includes(role))
      result.disabled = getAriaDisabled(element);
    if (kAriaExpandedRoles.includes(role))
      result.expanded = getAriaExpanded(element);
    if (kAriaLevelRoles.includes(role))
      result.level = getAriaLevel(element);
    if (kAriaPressedRoles.includes(role))
      result.pressed = getAriaPressed(element);
    if (kAriaSelectedRoles.includes(role))
      result.selected = getAriaSelected(element);
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (element.type !== "checkbox" && element.type !== "radio")
        result.children = [element.value];
    }
    if (role === "link" && element.hasAttribute("href"))
      result.url = element.getAttribute("href") || "";
    return result;
  }
  function normalizeStringChildren(rootA11yNode) {
    const flushChildren = (buffer, normalizedChildren) => {
      if (!buffer.length)
        return;
      const text = normalizeWhiteSpace(buffer.join(""));
      if (text)
        normalizedChildren.push(text);
      buffer.length = 0;
    };
    const visit = (ariaNode) => {
      const normalizedChildren = [];
      const buffer = [];
      for (const child of ariaNode.children || []) {
        if (typeof child === "string") {
          buffer.push(child);
        } else {
          flushChildren(buffer, normalizedChildren);
          visit(child);
          normalizedChildren.push(child);
        }
      }
      flushChildren(buffer, normalizedChildren);
      ariaNode.children = normalizedChildren.length ? normalizedChildren : [];
      if (ariaNode.children.length === 1 && ariaNode.children[0] === ariaNode.name)
        ariaNode.children = [];
    };
    visit(rootA11yNode);
  }
  function renderAriaTree(ariaNode, options) {
    const lines = [];
    const includeText = options?.mode === "regex" ? textContributesInfo : () => true;
    const renderString = options?.mode === "regex" ? convertToBestGuessRegex : (str) => str;
    const visit = (ariaNode2, parentAriaNode, indent) => {
      if (typeof ariaNode2 === "string") {
        if (parentAriaNode && !includeText(parentAriaNode, ariaNode2))
          return;
        const text = yamlEscapeValueIfNeeded(renderString(ariaNode2));
        if (text)
          lines.push(indent + "- text: " + text);
        return;
      }
      let key = ariaNode2.role;
      if (ariaNode2.name && ariaNode2.name.length <= 900) {
        const name = renderString(ariaNode2.name);
        if (name) {
          const stringifiedName = name.startsWith("/") && name.endsWith("/") ? name : JSON.stringify(name);
          key += " " + stringifiedName;
        }
      }
      if (ariaNode2.checked === "mixed")
        key += ` [checked=mixed]`;
      if (ariaNode2.checked === true)
        key += ` [checked]`;
      if (ariaNode2.disabled)
        key += ` [disabled]`;
      if (ariaNode2.expanded)
        key += ` [expanded]`;
      if (ariaNode2.level)
        key += ` [level=${ariaNode2.level}]`;
      if (ariaNode2.pressed === "mixed")
        key += ` [pressed=mixed]`;
      if (ariaNode2.pressed === true)
        key += ` [pressed]`;
      if (ariaNode2.selected === true)
        key += ` [selected]`;
      if (options?.refs) {
        const ref = options.refs.get(ariaNode2.element);
        if (ref)
          key += ` [ref=${ref}]`;
      }
      if (options?.ids) {
        const id = options?.ids.get(ariaNode2.element);
        if (id)
          key += ` [id=${id}]`;
      }
      const escapedKey = indent + "- " + yamlEscapeKeyIfNeeded(key);
      if (!ariaNode2.children.length && ariaNode2.url === void 0) {
        lines.push(escapedKey);
      } else if (ariaNode2.url === void 0 && ariaNode2.children.length === 1 && typeof ariaNode2.children[0] === "string") {
        const text = includeText(ariaNode2, ariaNode2.children[0]) ? renderString(ariaNode2.children[0]) : null;
        if (text)
          lines.push(escapedKey + ": " + yamlEscapeValueIfNeeded(text));
        else
          lines.push(escapedKey);
      } else {
        lines.push(escapedKey + ":");
        if (ariaNode2.url !== void 0)
          lines.push(indent + "  - /url: " + yamlEscapeValueIfNeeded(ariaNode2.url));
        for (const child of ariaNode2.children || [])
          visit(child, ariaNode2, indent + "  ");
      }
    };
    if (ariaNode.role === "fragment") {
      for (const child of ariaNode.children || [])
        visit(child, ariaNode, "");
    } else {
      visit(ariaNode, null, "");
    }
    return lines.join("\n");
  }
  function convertToBestGuessRegex(text) {
    const dynamicContent = [
      // 2mb
      { regex: /\b[\d,.]+[bkmBKM]+\b/, replacement: "[\\d,.]+[bkmBKM]+" },
      // 2ms, 20s
      { regex: /\b\d+[hmsp]+\b/, replacement: "\\d+[hmsp]+" },
      { regex: /\b[\d,.]+[hmsp]+\b/, replacement: "[\\d,.]+[hmsp]+" },
      // Do not replace single digits with regex by default.
      // 2+ digits: [Issue 22, 22.3, 2.33, 2,333]
      { regex: /\b\d+,\d+\b/, replacement: "\\d+,\\d+" },
      { regex: /\b\d+\.\d{2,}\b/, replacement: "\\d+\\.\\d+" },
      { regex: /\b\d{2,}\.\d+\b/, replacement: "\\d+\\.\\d+" },
      { regex: /\b\d{2,}\b/, replacement: "\\d+" }
    ];
    let pattern = "";
    let lastIndex = 0;
    const combinedRegex = new RegExp(dynamicContent.map((r) => "(" + r.regex.source + ")").join("|"), "g");
    text.replace(combinedRegex, (match, ...args) => {
      const offset = args[args.length - 2];
      const groups = args.slice(0, -2);
      pattern += escapeRegExp(text.slice(lastIndex, offset));
      for (let i = 0; i < groups.length; i++) {
        if (groups[i]) {
          const { replacement } = dynamicContent[i];
          pattern += replacement;
          break;
        }
      }
      lastIndex = offset + match.length;
      return match;
    });
    if (!pattern)
      return text;
    pattern += escapeRegExp(text.slice(lastIndex));
    return String(new RegExp(pattern));
  }
  function textContributesInfo(node, text) {
    if (!text.length)
      return false;
    if (!node.name)
      return true;
    if (node.name.length > text.length)
      return false;
    const substr = text.length <= 200 && node.name.length <= 200 ? longestCommonSubstring(text, node.name) : "";
    let filtered = text;
    while (substr && filtered.includes(substr))
      filtered = filtered.replace(substr, "");
    return filtered.trim().length / text.length > 0.1;
  }

  // src/snapshot.ts
  var ARIA_REF_PATTERN = /^s(\d+)e(\d+)$/;
  var currentSnapshotState = null;
  function generateSnapshot(generation) {
    if (!Number.isSafeInteger(generation) || generation < 1)
      throw new Error("Snapshot generation must be a positive integer");
    const tree = generateAriaTree(document.documentElement);
    const refs = /* @__PURE__ */ new Map();
    for (const [element, id] of tree.ids)
      refs.set(element, `s${generation}e${id}`);
    currentSnapshotState = {
      generation,
      root: tree.root,
      elements: tree.elements,
      ids: tree.ids
    };
    return {
      generation,
      url: window.location.href,
      title: document.title,
      snapshot: renderAriaTree(tree.root, { refs })
    };
  }
  function resolveAriaRef(ref) {
    const match = ARIA_REF_PATTERN.exec(ref);
    if (!match) throw new Error(`Invalid aria-ref: ${ref}`);
    if (!currentSnapshotState)
      throw new Error("No accessibility snapshot is available");
    const generation = Number(match[1]);
    const elementId = Number(match[2]);
    if (generation !== currentSnapshotState.generation)
      throw new Error(`Stale aria-ref: ${ref}`);
    const element = currentSnapshotState.elements.get(elementId);
    if (!element || !element.isConnected)
      throw new Error(`Unknown aria-ref: ${ref}`);
    return element;
  }
  function clearSnapshotState() {
    currentSnapshotState = null;
  }

  // src/interaction.ts
  var CURSOR_ID = "chrome-bridge-virtual-cursor";
  var MIN_CURSOR_MOVE_MS = 100;
  var MAX_CURSOR_MOVE_MS = 320;
  var lastCursorPoint;
  function prepareClickTarget(ref) {
    const element = resolveAriaRef(ref);
    return preparePoint(element, ref);
  }
  function prepareTypeTarget(ref) {
    const element = resolveAriaRef(ref);
    if (!isEditable(element)) {
      throw new Error(`Element for aria-ref is not editable: ${ref}`);
    }
    return preparePoint(element, ref);
  }
  function prepareDragTargets(startRef, endRef) {
    const startElement = resolveAriaRef(startRef);
    const endElement = resolveAriaRef(endRef);
    startElement.scrollIntoView({
      block: "center",
      inline: "center",
      behavior: "auto"
    });
    const startPoint = clickablePoint(startElement);
    if (!startPoint) {
      throw new Error(`Start element for aria-ref is not clickable: ${startRef}`);
    }
    const end = visiblePoint(endElement);
    if (!end) {
      throw new Error(`End element for aria-ref is not visible: ${endRef}`);
    }
    const start = showVirtualCursor(startPoint);
    return { start, end };
  }
  function moveVirtualCursor(point, durationMs) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0) {
      throw new Error("Virtual cursor coordinates must be non-negative numbers");
    }
    return showVirtualCursor(point, durationMs);
  }
  function pressVirtualCursor() {
    const host = document.getElementById(CURSOR_ID);
    const cursor = host?.shadowRoot?.querySelector(".cursor");
    const ripple = host?.shadowRoot?.querySelector(".ripple");
    if (!cursor || !ripple) return;
    cursor.classList.remove("pressing");
    ripple.classList.remove("active");
    void cursor.offsetWidth;
    cursor.classList.add("pressing");
    ripple.classList.add("active");
    window.setTimeout(() => {
      cursor.classList.remove("pressing");
      ripple.classList.remove("active");
    }, 360);
  }
  function setVirtualCursorPressed(pressed) {
    const cursor = document.getElementById(CURSOR_ID)?.shadowRoot?.querySelector(".cursor");
    cursor?.classList.toggle("pressed", pressed);
  }
  function removeVirtualCursor() {
    document.getElementById(CURSOR_ID)?.remove();
    lastCursorPoint = void 0;
  }
  function prepareSelectOptions(ref, values) {
    const element = resolveAriaRef(ref);
    if (!(element instanceof HTMLSelectElement)) {
      throw new Error(`Element for aria-ref is not a <select>: ${ref}`);
    }
    if (element.disabled) {
      throw new Error(`Element for aria-ref is disabled: ${ref}`);
    }
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error("values must contain at least one option value");
    }
    if (values.some((value) => typeof value !== "string")) {
      throw new Error("values must contain only strings");
    }
    const requested = element.multiple ? values : [values[0]];
    const options = Array.from(element.options);
    for (const value of requested) {
      if (!options.some((option) => option.value === value)) {
        throw new Error(`Unable to find option for value: ${value}`);
      }
    }
    element.scrollIntoView({
      block: "center",
      inline: "center",
      behavior: "auto"
    });
    const point = clickablePoint(element);
    if (!point) throw new Error(`Element for aria-ref is not clickable: ${ref}`);
    return { ...showVirtualCursor(point), values: requested };
  }
  function performSelectOptions(ref, values) {
    const element = resolveAriaRef(ref);
    if (!(element instanceof HTMLSelectElement)) {
      throw new Error(`Element for aria-ref is not a <select>: ${ref}`);
    }
    if (element.disabled) {
      throw new Error(`Element for aria-ref is disabled: ${ref}`);
    }
    const options = Array.from(element.options);
    const selectedValues = new Set(values);
    for (const option of options)
      option.selected = selectedValues.has(option.value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return Array.from(element.selectedOptions, (option) => option.value);
  }
  function preparePoint(element, ref) {
    element.scrollIntoView({
      block: "center",
      inline: "center",
      behavior: "auto"
    });
    const point = clickablePoint(element);
    if (!point) throw new Error(`Element for aria-ref is not clickable: ${ref}`);
    return showVirtualCursor(point);
  }
  function isEditable(element) {
    if (element instanceof HTMLTextAreaElement) {
      return !element.disabled && !element.readOnly;
    }
    if (element instanceof HTMLInputElement) {
      const nonTextTypes = /* @__PURE__ */ new Set([
        "button",
        "checkbox",
        "color",
        "file",
        "hidden",
        "image",
        "radio",
        "range",
        "reset",
        "submit"
      ]);
      return !element.disabled && !element.readOnly && !nonTextTypes.has(element.type);
    }
    return element instanceof HTMLElement && element.isContentEditable;
  }
  function waitForStableDOM(idleMs = 1e3, timeoutMs = 3e3) {
    const startedAt = performance.now();
    return new Promise((resolve) => {
      let idleTimer;
      let timeoutTimer;
      let settled = false;
      const finish = (stable) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        if (idleTimer !== void 0) clearTimeout(idleTimer);
        if (timeoutTimer !== void 0) clearTimeout(timeoutTimer);
        resolve({ stable, elapsedMs: performance.now() - startedAt });
      };
      const scheduleIdle = () => {
        if (idleTimer !== void 0) clearTimeout(idleTimer);
        idleTimer = window.setTimeout(() => finish(true), idleMs);
      };
      const observer = new MutationObserver(scheduleIdle);
      observer.observe(document, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true
      });
      scheduleIdle();
      timeoutTimer = window.setTimeout(() => finish(false), timeoutMs);
    });
  }
  function clickablePoint(element) {
    for (const rect of element.getClientRects()) {
      const left = Math.max(0, rect.left);
      const right = Math.min(window.innerWidth, rect.right);
      const top = Math.max(0, rect.top);
      const bottom = Math.min(window.innerHeight, rect.bottom);
      if (right <= left || bottom <= top) continue;
      const point = { x: (left + right) / 2, y: (top + bottom) / 2 };
      const hit = deepElementFromPoint(point.x, point.y);
      if (hit === element || hit && element.contains(hit)) return point;
    }
    return null;
  }
  function visiblePoint(element) {
    for (const rect of element.getClientRects()) {
      const left = Math.max(0, rect.left);
      const right = Math.min(window.innerWidth, rect.right);
      const top = Math.max(0, rect.top);
      const bottom = Math.min(window.innerHeight, rect.bottom);
      if (right > left && bottom > top) {
        return { x: (left + right) / 2, y: (top + bottom) / 2 };
      }
    }
    return null;
  }
  function deepElementFromPoint(x, y) {
    let hit = document.elementFromPoint(x, y);
    while (hit?.shadowRoot) {
      const nested = hit.shadowRoot.elementFromPoint(x, y);
      if (!nested || nested === hit) break;
      hit = nested;
    }
    return hit;
  }
  function showVirtualCursor(point, requestedDurationMs) {
    let host = document.getElementById(CURSOR_ID);
    const isNew = !host;
    if (!host) {
      host = document.createElement("div");
      host.id = CURSOR_ID;
      host.setAttribute("aria-hidden", "true");
      Object.assign(host.style, {
        all: "initial",
        display: "block",
        height: "34px",
        left: "0",
        pointerEvents: "none",
        position: "fixed",
        top: "0",
        width: "30px",
        zIndex: "2147483647"
      });
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = `
      <style>
        :host { color-scheme: light; }
        .cursor {
          filter: drop-shadow(0 3px 4px rgba(114, 8, 61, 0.34));
          height: 30px;
          left: -2px;
          position: absolute;
          top: -2px;
          transform-origin: 3px 3px;
          width: 26px;
        }
        .cursor.pressing { animation: press 320ms cubic-bezier(.22, 1, .36, 1); }
        .cursor.pressed { transform: scale(.86); }
        .ripple {
          border: 2px solid rgba(242, 27, 134, .72);
          border-radius: 50%;
          height: 8px;
          left: -5px;
          opacity: 0;
          position: absolute;
          top: -5px;
          transform: scale(.25);
          width: 8px;
        }
        .ripple.active { animation: ripple 340ms ease-out; }
        @keyframes press {
          35% { transform: scale(.82); }
          100% { transform: scale(1); }
        }
        @keyframes ripple {
          0% { opacity: .95; transform: scale(.25); }
          100% { opacity: 0; transform: scale(2.8); }
        }
        @media (prefers-reduced-motion: reduce) {
          .cursor, .ripple { animation: none !important; transition: none !important; }
        }
      </style>
      <span class="ripple"></span>
      <svg class="cursor" viewBox="0 0 26 30" aria-hidden="true">
        <path d="M2 2 L2 23 L7.7 17.8 L12.4 28 L17.1 25.8 L12.4 16.2 L20.2 15.4 Z"
          fill="#f21b86" stroke="white" stroke-width="2.4" stroke-linejoin="round" />
      </svg>
    `;
      document.documentElement.append(host);
    }
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const durationMs = reducedMotion ? 0 : isNew ? 0 : normalizeMoveDuration(point, requestedDurationMs);
    host.style.transition = durationMs === 0 ? "none" : `left ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1), top ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    host.style.left = `${point.x}px`;
    host.style.top = `${point.y}px`;
    lastCursorPoint = { x: point.x, y: point.y };
    return { ...point, settleMs: durationMs };
  }
  function normalizeMoveDuration(point, requestedDurationMs) {
    if (requestedDurationMs !== void 0) {
      return Math.max(0, Math.min(MAX_CURSOR_MOVE_MS, requestedDurationMs));
    }
    if (!lastCursorPoint) return 0;
    const distance = Math.hypot(
      point.x - lastCursorPoint.x,
      point.y - lastCursorPoint.y
    );
    if (distance === 0) return 0;
    return Math.round(
      Math.max(MIN_CURSOR_MOVE_MS, Math.min(MAX_CURSOR_MOVE_MS, distance * 0.65))
    );
  }

  // src/image.ts
  async function resizePng(data, maxWidth, maxHeight) {
    if (!data) throw new Error("PNG data is required");
    if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
      throw new Error("maxWidth must be positive");
    }
    if (!Number.isFinite(maxHeight) || maxHeight <= 0) {
      throw new Error("maxHeight must be positive");
    }
    const response = await fetch(`data:image/png;base64,${data}`);
    const bitmap = await createImageBitmap(await response.blob());
    try {
      const scale = Math.min(
        1,
        maxWidth / bitmap.width,
        maxHeight / bitmap.height
      );
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not create a canvas context");
      context.drawImage(bitmap, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/png");
      const prefix = "data:image/png;base64,";
      if (!dataUrl.startsWith(prefix)) {
        throw new Error("Canvas returned an invalid PNG data URL");
      }
      return { data: dataUrl.slice(prefix.length), width, height };
    } finally {
      bitmap.close();
    }
  }

  // src/agent-ui.ts
  var INDICATOR_HOST_ID = "chrome-bridge-agent-indicator";
  var TITLE_PREFIXES = {
    target: "\u25C9 ",
    operating: "\u25CF "
  };
  var currentState = "off";
  var logicalTitle = document.title;
  var appliedTitle = null;
  var applyingTitle = false;
  var titleObserver;
  function setAgentUiState(state) {
    if (!isAgentUiState(state)) {
      throw new Error(`Invalid agent UI state: ${String(state)}`);
    }
    captureExternalTitleChange();
    currentState = state;
    applyTitle();
    renderIndicator();
  }
  function getLogicalDocumentTitle() {
    captureExternalTitleChange();
    return logicalTitle;
  }
  async function setIndicatorHiddenForCapture(hidden) {
    const host = document.getElementById(INDICATOR_HOST_ID);
    if (host) host.style.visibility = hidden ? "hidden" : "visible";
    await nextPaint();
  }
  function isAgentUiState(value) {
    return value === "off" || value === "target" || value === "operating";
  }
  function ensureTitleObserver() {
    if (titleObserver) return;
    titleObserver = new MutationObserver(() => {
      if (applyingTitle) return;
      captureExternalTitleChange();
      applyTitle();
    });
    titleObserver.observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }
  function captureExternalTitleChange() {
    const currentTitle = document.title;
    if (appliedTitle === null || currentTitle !== appliedTitle) {
      logicalTitle = currentTitle;
      appliedTitle = null;
    }
  }
  function applyTitle() {
    ensureTitleObserver();
    const nextTitle = currentState === "off" ? logicalTitle : `${TITLE_PREFIXES[currentState]}${logicalTitle}`;
    if (document.title === nextTitle) {
      appliedTitle = currentState === "off" ? null : nextTitle;
      return;
    }
    applyingTitle = true;
    document.title = nextTitle;
    appliedTitle = currentState === "off" ? null : nextTitle;
    queueMicrotask(() => {
      applyingTitle = false;
    });
  }
  function renderIndicator() {
    const existing = document.getElementById(INDICATOR_HOST_ID);
    if (currentState === "off") {
      existing?.remove();
      return;
    }
    const host = existing || document.createElement("div");
    if (!existing) {
      host.id = INDICATOR_HOST_ID;
      host.setAttribute("aria-hidden", "true");
      Object.assign(host.style, {
        all: "initial",
        display: "block",
        pointerEvents: "none",
        position: "fixed",
        right: "16px",
        top: "16px",
        visibility: "visible",
        zIndex: "2147483647"
      });
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = `
      <style>
        :host { color-scheme: light; }
        .indicator {
          align-items: center;
          backdrop-filter: blur(10px);
          background: rgba(255, 255, 255, 0.94);
          border: 1px solid rgba(242, 27, 134, 0.28);
          border-radius: 999px;
          box-shadow: 0 8px 24px rgba(114, 8, 61, 0.18);
          color: #72083d;
          display: flex;
          font: 600 12px/1 ui-sans-serif, system-ui, -apple-system, sans-serif;
          gap: 7px;
          letter-spacing: 0.01em;
          padding: 8px 11px;
          transition: border-color 140ms ease, box-shadow 140ms ease;
          white-space: nowrap;
        }
        .dot {
          background: #f21b86;
          border-radius: 50%;
          box-shadow: 0 0 0 3px rgba(242, 27, 134, 0.14);
          height: 7px;
          width: 7px;
        }
        .indicator[data-state="operating"] {
          border-color: rgba(242, 27, 134, 0.62);
          box-shadow: 0 8px 26px rgba(184, 15, 98, 0.26);
        }
        .indicator[data-state="operating"] .dot {
          animation: pulse 1s ease-in-out infinite;
          background: #b80f62;
        }
        @keyframes pulse {
          50% { box-shadow: 0 0 0 6px rgba(242, 27, 134, 0.08); transform: scale(1.15); }
        }
        @media (prefers-reduced-motion: reduce) {
          .indicator, .dot { animation: none !important; transition: none !important; }
        }
      </style>
      <div class="indicator"><span class="dot"></span><span class="label"></span></div>
    `;
      document.documentElement.append(host);
    }
    const indicator = host.shadowRoot.querySelector(".indicator");
    const label = host.shadowRoot.querySelector(".label");
    indicator.dataset.state = currentState;
    label.textContent = currentState === "operating" ? "Agent operating" : "Agent target";
  }
  function nextPaint() {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(fallback);
        resolve();
      };
      const fallback = window.setTimeout(finish, 100);
      requestAnimationFrame(() => requestAnimationFrame(finish));
    });
  }

  // src/content-runtime.ts
  var RUNTIME_MARKER = "__chromeBridgeContentRuntimeV1";
  if (!globalThis[RUNTIME_MARKER]) {
    globalThis[RUNTIME_MARKER] = true;
    chrome.runtime.onMessage.addListener(
      (message, _sender, sendResponse) => {
        if (message?.type === "chrome-bridge.content.ping") {
          sendResponse({ ok: true, version: 1 });
          return false;
        }
        if (message?.type === "chrome-bridge.snapshot.clear") {
          clearSnapshotState();
          sendResponse({ ok: true });
          return false;
        }
        if (message?.type === "chrome-bridge.snapshot.generate") {
          try {
            const result = generateSnapshot(message.generation);
            sendResponse({
              ok: true,
              result: { ...result, title: getLogicalDocumentTitle() }
            });
          } catch (error) {
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            });
          }
          return false;
        }
        if (message?.type === "chrome-bridge.click.prepare") {
          try {
            sendResponse({
              ok: true,
              result: prepareClickTarget(message.ref || "")
            });
          } catch (error) {
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            });
          }
          return false;
        }
        if (message?.type === "chrome-bridge.hover.prepare") {
          try {
            sendResponse({
              ok: true,
              result: prepareClickTarget(message.ref || "")
            });
          } catch (error) {
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            });
          }
          return false;
        }
        if (message?.type === "chrome-bridge.type.prepare") {
          try {
            sendResponse({
              ok: true,
              result: prepareTypeTarget(message.ref || "")
            });
          } catch (error) {
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            });
          }
          return false;
        }
        if (message?.type === "chrome-bridge.drag.prepare") {
          try {
            sendResponse({
              ok: true,
              result: prepareDragTargets(
                message.startRef || "",
                message.endRef || ""
              )
            });
          } catch (error) {
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            });
          }
          return false;
        }
        if (message?.type === "chrome-bridge.drag.cursor") {
          try {
            const result = moveVirtualCursor(
              { x: message.x ?? -1, y: message.y ?? -1 },
              message.durationMs
            );
            sendResponse({ ok: true, result });
          } catch (error) {
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            });
          }
          return false;
        }
        if (message?.type === "chrome-bridge.cursor.press") {
          pressVirtualCursor();
          sendResponse({ ok: true });
          return false;
        }
        if (message?.type === "chrome-bridge.cursor.pressed") {
          setVirtualCursorPressed(message.pressed === true);
          sendResponse({ ok: true });
          return false;
        }
        if (message?.type === "chrome-bridge.select.prepare") {
          try {
            sendResponse({
              ok: true,
              result: prepareSelectOptions(
                message.ref || "",
                message.values || []
              )
            });
          } catch (error) {
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            });
          }
          return false;
        }
        if (message?.type === "chrome-bridge.select.perform") {
          try {
            sendResponse({
              ok: true,
              result: {
                values: performSelectOptions(
                  message.ref || "",
                  message.values || []
                )
              }
            });
          } catch (error) {
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            });
          }
          return false;
        }
        if (message?.type === "chrome-bridge.ui.setState") {
          try {
            setAgentUiState(message.state || "off");
            if (message.state === "off") removeVirtualCursor();
            sendResponse({ ok: true });
          } catch (error) {
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            });
          }
          return false;
        }
        if (message?.type === "chrome-bridge.ui.capture") {
          void setIndicatorHiddenForCapture(message.hidden === true).then(
            () => sendResponse({ ok: true }),
            (error) => sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            })
          );
          return true;
        }
        if (message?.type === "chrome-bridge.dom.waitForStable") {
          void waitForStableDOM().then(
            (result) => sendResponse({ ok: true, result }),
            (error) => sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            })
          );
          return true;
        }
        if (message?.type === "chrome-bridge.image.resize") {
          void resizePng(
            message.data || "",
            message.maxWidth || 0,
            message.maxHeight || 0
          ).then(
            (result) => sendResponse({ ok: true, result }),
            (error) => sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            })
          );
          return true;
        }
        return false;
      }
    );
    void chrome.runtime.sendMessage({ type: "chrome-bridge.ui.getState" }).then((response) => {
      if (response?.ok && response.state) setAgentUiState(response.state);
    }).catch(() => {
    });
  }
})();
