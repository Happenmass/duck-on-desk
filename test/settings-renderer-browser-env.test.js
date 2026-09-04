"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC_DIR = path.join(__dirname, "..", "src");
const SETTINGS_HTML = path.join(SRC_DIR, "settings.html");
const SETTINGS_CSS = path.join(SRC_DIR, "settings.css");
const LANGUAGE_PICKER_JS = path.join(SRC_DIR, "language-picker.js");
const LANGUAGE_PICKER_CSS = path.join(SRC_DIR, "language-picker.css");
const SETTINGS_TAB_GENERAL = path.join(SRC_DIR, "settings-tab-general.js");
const SETTINGS_RENDERER = path.join(SRC_DIR, "settings-renderer.js");
const SETTINGS_UI_CORE = path.join(SRC_DIR, "settings-ui-core.js");
const SETTINGS_ANIM_OVERRIDES_MERGE = path.join(SRC_DIR, "settings-anim-overrides-merge.js");
const SETTINGS_I18N = path.join(SRC_DIR, "settings-i18n.js");
const SETTINGS_DOCTOR_MODAL = path.join(SRC_DIR, "settings-doctor-modal.js");
const SETTINGS_ANIMATION_PREVIEW = path.join(SRC_DIR, "settings-animation-preview.html");
const PRELOAD_SETTINGS = path.join(SRC_DIR, "preload-settings.js");
const MAIN_PROCESS = path.join(SRC_DIR, "main.js");
const SETTINGS_IPC = path.join(SRC_DIR, "settings-ipc.js");
const DOCTOR_IPC = path.join(SRC_DIR, "doctor-ipc.js");
const { SUPPORTED_LANGS } = require("../src/i18n");
const TAB_MODULES = [
  path.join(SRC_DIR, "settings-tab-general.js"),
  path.join(SRC_DIR, "settings-tab-agents.js"),
  path.join(SRC_DIR, "settings-tab-theme.js"),
  path.join(SRC_DIR, "settings-tab-anim-map.js"),
  path.join(SRC_DIR, "settings-tab-anim-overrides.js"),
  path.join(SRC_DIR, "settings-tab-shortcuts.js"),
  path.join(SRC_DIR, "settings-tab-about.js"),
];
const VERIFIED_GITHUB_CONTRIBUTORS = [
  "Bynlk",
  "zxypro1",
  "NeroAyase",
  "divergentD",
  "Ne9roni",
  "jiaxuan1101",
  "kkirito16",
  "200780381",
  "Dxy2326",
  "lurui1997",
  "JesmonX",
  "chen86860",
  "LinYsssss",
  "He-wei-gui",
  "liugou27",
  "YOOGOMJA",
  "anupamme",
  "anthonyonazure",
  "weed33834",
  "arismarioneves",
  "Zamaniego",
  "CheeseAgent",
  "RS-Nocsi",
  "Cobb04",
];

function createDeferred() {
  const deferred = {};
  deferred.promise = new Promise((resolve, reject) => {
    deferred.resolve = resolve;
    deferred.reject = reject;
  });
  return deferred;
}

function loadSettingsI18nBundleForTest() {
  const context = { globalThis: null };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(SETTINGS_I18N, "utf8"), context);
  return context.DuckSettingsI18n;
}

function loadSettingsI18nForTest() {
  return loadSettingsI18nBundleForTest().STRINGS;
}

function loadSettingsCoreForTest(settingsAPI, {
  document: documentOverride = null,
  localStorage: localStorageOverride = null,
  matchMedia = null,
  requestAnimationFrame = (cb) => {
    cb();
    return 1;
  },
} = {}) {
  const document = documentOverride || {
    body: { contains: () => false },
    getElementById: () => null,
  };
  const context = {
    console,
    navigator: { platform: "Win32" },
    localStorage: localStorageOverride || {
      getItem: () => null,
      setItem: () => {},
    },
    document,
    matchMedia,
    requestAnimationFrame,
    window: null,
    globalThis: null,
    settingsAPI,
    DuckSettingsSizeSlider: {
      SIZE_UI_MIN: 1,
      SIZE_UI_MAX: 100,
      SIZE_TICK_VALUES: [25, 50, 75, 100],
      SIZE_SLIDER_THUMB_DIAMETER: 18,
      prefsSizeToUi: (value) => value,
      clampSizeUi: (value) => value,
      sizeUiToPct: (value) => value,
      getSizeSliderAnchorPx: () => 0,
      createSizeSliderController: () => ({}),
    },
    DuckSettingsI18n: {
      STRINGS: { en: {} },
      CONTRIBUTORS: [],
      MAINTAINERS: [],
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(SETTINGS_ANIM_OVERRIDES_MERGE, "utf8"), context);
  vm.runInContext(fs.readFileSync(SETTINGS_UI_CORE, "utf8"), context);
  return context.DuckSettingsCore;
}

function createQueuedRaf() {
  const queue = [];
  return {
    requestAnimationFrame(cb) {
      queue.push(cb);
      return queue.length;
    },
    flush() {
      while (queue.length) {
        const cb = queue.shift();
        cb();
      }
    },
    flushFrame() {
      const callbacks = queue.splice(0);
      for (const cb of callbacks) cb();
    },
  };
}

function attachDisclosureForHarness({
  root,
  trigger,
  body,
  expanded = false,
  onExpandedChange = null,
}) {
  let isExpanded = !!expanded;
  const sync = () => {
    root.classList.toggle("expanded", isExpanded);
    root.classList.toggle("collapsed", !isExpanded);
    trigger.setAttribute("aria-expanded", isExpanded ? "true" : "false");
    body.setAttribute("aria-hidden", isExpanded ? "false" : "true");
    body.inert = !isExpanded;
  };
  const onClick = () => {
    isExpanded = !isExpanded;
    sync();
    if (typeof onExpandedChange === "function") onExpandedChange(isExpanded, { persist: true });
  };
  trigger.addEventListener("click", onClick);
  sync();
  return {
    get expanded() { return isExpanded; },
    dispose() { trigger.removeEventListener("click", onClick); },
  };
}

function createMountedDisposableHarness() {
  const scopes = new Map();
  const getScope = (scope = "content") => {
    if (!scopes.has(scope)) scopes.set(scope, new Set());
    return scopes.get(scope);
  };
  return {
    scopes,
    register(disposable, { scope = "content" } = {}) {
      if (disposable && typeof disposable.dispose === "function") getScope(scope).add(disposable);
      return disposable;
    },
    dispose(disposable) {
      if (!disposable || typeof disposable.dispose !== "function") return;
      for (const [scope, controls] of scopes) {
        controls.delete(disposable);
        if (controls.size === 0) scopes.delete(scope);
      }
      disposable.dispose();
    },
    disposeScope(scope = null) {
      const scopeNames = scope === null ? Array.from(scopes.keys()) : [scope];
      for (const scopeName of scopeNames) {
        const controls = scopes.get(scopeName);
        if (!controls) continue;
        scopes.delete(scopeName);
        for (const disposable of Array.from(controls)) disposable.dispose();
      }
    },
  };
}

class FakeClassList {
  constructor(el) {
    this.el = el;
  }

  _set(values) {
    this.el.className = [...values].join(" ");
  }

  _values() {
    return new Set(String(this.el.className || "").split(/\s+/).filter(Boolean));
  }

  add(...names) {
    const values = this._values();
    for (const name of names) values.add(name);
    this._set(values);
  }

  remove(...names) {
    const values = this._values();
    for (const name of names) values.delete(name);
    this._set(values);
  }

  contains(name) {
    return this._values().has(name);
  }

  toggle(name, force) {
    const values = this._values();
    const shouldAdd = force === undefined ? !values.has(name) : !!force;
    if (shouldAdd) values.add(name);
    else values.delete(name);
    this._set(values);
    return shouldAdd;
  }
}

// FakeElement.textContent is a plain field, not an aggregating DOM getter, so
// reading it on a container yields "" and any "does this text appear?" check
// against it passes vacuously. Walk the tree instead, and include innerHTML —
// the guide rows render through it.
function collectText(el) {
  if (!el) return "";
  const parts = [];
  if (el.textContent) parts.push(String(el.textContent));
  if (el.innerHTML) parts.push(String(el.innerHTML));
  for (const child of el.children || []) parts.push(collectText(child));
  return parts.join(" ");
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || "").toUpperCase();
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.eventListeners = {};
    this.className = "";
    this.textContent = "";
    this.title = "";
    this.type = "";
    this.disabled = false;
    this.focused = false;
    this.open = false;
    this.inert = false;
    this._innerHTML = "";
    this.parentNode = null;
    this.scrollTop = 0;
    this.style = {
      _values: {},
      setProperty(name, value) {
        this._values[name] = String(value);
      },
      removeProperty(name) {
        delete this._values[name];
      },
      getPropertyValue(name) {
        return this._values[name] || "";
      },
    };
    this.classList = new FakeClassList(this);
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...children) {
    for (const child of children) this.appendChild(child);
  }

  insertBefore(child, reference) {
    child.parentNode = this;
    const index = this.children.indexOf(reference);
    if (index === -1) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }

  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index !== -1) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "class") this.className = String(value);
    if (name === "href") this.href = String(value);
    if (name === "id") this.id = String(value);
    if (name === "type") this.type = String(value);
    if (name === "tabindex") this.tabIndex = Number(value);
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_m, ch) => ch.toUpperCase());
      this.dataset[key] = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  removeAttribute(name) {
    delete this.attributes[name];
    if (name === "class") this.className = "";
    if (name === "id") delete this.id;
  }

  addEventListener(type, cb) {
    if (!this.eventListeners[type]) this.eventListeners[type] = [];
    this.eventListeners[type].push(cb);
  }

  removeEventListener(type, cb) {
    const listeners = this.eventListeners[type];
    if (!listeners) return;
    const index = listeners.indexOf(cb);
    if (index !== -1) listeners.splice(index, 1);
  }

  focus() {
    this.focused = true;
  }

  dispatchEvent(event) {
    const ev = event || {};
    if (!ev.type) throw new Error("FakeElement.dispatchEvent requires an event type");
    if (!ev.target) ev.target = this;
    ev.currentTarget = this;
    if (typeof ev.preventDefault !== "function") {
      ev.preventDefault = function preventDefault() {
        this.defaultPrevented = true;
      };
    }
    if (typeof ev.stopPropagation !== "function") {
      ev.stopPropagation = function stopPropagation() {
        this.cancelBubble = true;
      };
    }
    const listeners = this.eventListeners[ev.type] || [];
    for (const listener of [...listeners]) listener(ev);
    if (ev.bubbles !== false && !ev.cancelBubble && this.parentNode) {
      return this.parentNode.dispatchEvent(ev);
    }
    return !ev.defaultPrevented;
  }

  click() {
    return this.dispatchEvent({ type: "click", bubbles: false });
  }

  set innerHTML(_value) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    const html = String(_value || "");
    this._innerHTML = html;
    const stack = [this];
    const tagRe = /<\/?([a-zA-Z][\w-]*)([^>]*)>/g;
    let match;
    while ((match = tagRe.exec(html)) !== null) {
      const full = match[0];
      const tagName = match[1];
      const attrSource = match[2] || "";
      if (full.startsWith("</")) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const child = new FakeElement(tagName);
      const attrRe = /([:\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
      let attrMatch;
      while ((attrMatch = attrRe.exec(attrSource)) !== null) {
        const attrName = attrMatch[1];
        if (attrName === "/") continue;
        const attrValue = (attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "")
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">");
        child.setAttribute(attrName, attrValue);
      }
      stack[stack.length - 1].appendChild(child);
      const voidTag = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(tagName);
      if (!full.endsWith("/>") && !voidTag) stack.push(child);
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  _matches(selector) {
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    const tagAttribute = /^([a-zA-Z][\w-]*)\[([:\w-]+)\]$/.exec(selector);
    if (tagAttribute) {
      return this.tagName.toLowerCase() === tagAttribute[1].toLowerCase()
        && Object.prototype.hasOwnProperty.call(this.attributes, tagAttribute[2]);
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelectorAll(selector) {
    const parts = String(selector || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return [];
    const matches = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child._matchesSelectorParts(parts)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  contains(target) {
    if (target === this) return true;
    return this.children.some((child) => child.contains(target));
  }

  getBoundingClientRect() {
    return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 };
  }

  _matchesSelectorParts(parts) {
    if (!this._matches(parts[parts.length - 1])) return false;
    let current = this.parentNode;
    for (let i = parts.length - 2; i >= 0; i--) {
      while (current && !current._matches(parts[i])) current = current.parentNode;
      if (!current) return false;
      current = current.parentNode;
    }
    return true;
  }

  get isConnected() {
    let current = this;
    while (current) {
      if (current.tagName === "BODY") return true;
      current = current.parentNode;
    }
    return false;
  }

  get scrollHeight() {
    if (!this.isConnected) return 0;
    return Math.max(40, this.children.length * 40);
  }
}

function loadSharedLanguagePickerForTest({
  value = "en",
  options = ["en", "zh", "ja"],
  onChange = () => Promise.resolve(true),
  innerHeight = 600,
  transitionDuration = "0.14s",
  transitionDelay = "0s",
  lockWhilePending = false,
} = {}) {
  const body = new FakeElement("body");
  const boundary = new FakeElement("div");
  boundary.setAttribute("data-language-picker-boundary", "");
  body.appendChild(boundary);
  const documentListeners = new Map();
  const windowListeners = new Map();
  const animationFrames = new Map();
  const timers = new Map();
  const timerDelays = new Map();
  let nextAnimationFrameId = 1;
  let nextTimerId = 1;
  const document = {
    body,
    activeElement: body,
    documentElement: { clientHeight: innerHeight },
    createElement(tagName) {
      const element = new FakeElement(tagName);
      element.focus = () => {
        element.focused = true;
        document.activeElement = element;
      };
      return element;
    },
    addEventListener(type, cb) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(cb);
    },
    removeEventListener(type, cb) {
      const listeners = documentListeners.get(type);
      if (!listeners) return;
      const index = listeners.indexOf(cb);
      if (index !== -1) listeners.splice(index, 1);
    },
  };
  const context = {
    console,
    document,
    innerHeight,
    addEventListener(type, cb) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(cb);
    },
    removeEventListener(type, cb) {
      const listeners = windowListeners.get(type);
      if (!listeners) return;
      const index = listeners.indexOf(cb);
      if (index !== -1) listeners.splice(index, 1);
    },
    requestAnimationFrame(cb) {
      const id = nextAnimationFrameId++;
      animationFrames.set(id, cb);
      return id;
    },
    cancelAnimationFrame(id) {
      animationFrames.delete(id);
    },
    setTimeout(cb, delay) {
      const id = nextTimerId++;
      timers.set(id, cb);
      timerDelays.set(id, delay);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
      timerDelays.delete(id);
    },
    getComputedStyle() {
      return { transitionDuration, transitionDelay };
    },
    matchMedia() {
      return { matches: false };
    },
    window: null,
    globalThis: null,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(LANGUAGE_PICKER_JS, "utf8"), context);

  const control = context.DuckLanguagePicker.createLanguagePicker({
    value,
    options: options.map((option) => ({ value: option, label: option.toUpperCase() })),
    ariaLabel: "Language",
    onChange,
    lockWhilePending,
  });
  boundary.appendChild(control.element);

  return {
    boundary,
    control,
    picker: control.element,
    trigger: control.element.querySelector(".language-picker-trigger"),
    menu: control.element.querySelector(".language-picker-menu"),
    optionElements: control.element.querySelectorAll(".language-picker-option"),
    valueElement: control.element.querySelector(".language-picker-value"),
    dispatchWindowEvent(type, event = {}) {
      for (const listener of [...(windowListeners.get(type) || [])]) {
        listener({ ...event, type });
      }
    },
    flushAnimationFrames() {
      while (animationFrames.size > 0) {
        const pending = [...animationFrames.values()];
        animationFrames.clear();
        for (const callback of pending) callback();
      }
    },
    flushTimers() {
      while (timers.size > 0) {
        const pending = [...timers.values()];
        timers.clear();
        timerDelays.clear();
        for (const callback of pending) callback();
      }
    },
    getPendingAnimationFrameCount: () => animationFrames.size,
    getPendingTimerCount: () => timers.size,
    getPendingTimerDelays: () => [...timerDelays.values()],
    getActiveElement: () => document.activeElement,
    setActiveElement: (element) => { document.activeElement = element; },
    body,
    getDocumentListenerCount: (type) => (documentListeners.get(type) || []).length,
    getWindowListenerCount: (type) => (windowListeners.get(type) || []).length,
  };
}

function loadGeneralLanguageRowForTest({
  snapshot,
  update = () => Promise.resolve({ status: "ok" }),
} = {}) {
  const raf = createQueuedRaf();
  const body = new FakeElement("body");
  const content = new FakeElement("main");
  content.id = "content";
  body.appendChild(content);
  const toastStack = new FakeElement("div");
  toastStack.id = "toastStack";
  body.appendChild(toastStack);

  const documentListeners = new Map();
  const document = {
    body,
    createElement: (tagName) => new FakeElement(tagName),
    getElementById(id) {
      if (id === "content") return content;
      if (id === "toastStack") return toastStack;
      return null;
    },
    addEventListener(type, cb) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(cb);
    },
    removeEventListener(type, cb) {
      const listeners = documentListeners.get(type);
      if (!listeners) return;
      const index = listeners.indexOf(cb);
      if (index !== -1) listeners.splice(index, 1);
    },
  };

  const updateCalls = [];
  const settingsAPI = {
    update: (key, value) => {
      updateCalls.push({ key, value });
      return update(key, value);
    },
  };
  const context = {
    console,
    navigator: { platform: "Win32" },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
    document,
    requestAnimationFrame: (cb) => raf.requestAnimationFrame(cb),
    setTimeout: () => 1,
    window: null,
    globalThis: null,
    settingsAPI,
    DuckSettingsSizeSlider: {
      SIZE_UI_MIN: 1,
      SIZE_UI_MAX: 100,
      SIZE_TICK_VALUES: [25, 50, 75, 100],
      SIZE_SLIDER_THUMB_DIAMETER: 18,
      prefsSizeToUi: (value) => value,
      clampSizeUi: (value) => value,
      sizeUiToPct: (value) => value,
      getSizeSliderAnchorPx: () => 0,
      createSizeSliderController: () => ({}),
    },
    DuckSettingsI18n: {
      STRINGS: {
        en: {
          rowLanguage: "Language",
          rowLanguageDesc: "Language desc",
          langEnglish: "English",
          langChinese: "Chinese",
          toastSaveFailed: "Failed: ",
        },
        zh: {
          rowLanguage: "Language",
          rowLanguageDesc: "Language desc",
          langEnglish: "English",
          langChinese: "Chinese",
          toastSaveFailed: "Failed: ",
        },
      },
      CONTRIBUTORS: [],
      MAINTAINERS: [],
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(LANGUAGE_PICKER_JS, "utf8"), context);
  vm.runInContext(fs.readFileSync(SETTINGS_ANIM_OVERRIDES_MERGE, "utf8"), context);
  vm.runInContext(fs.readFileSync(SETTINGS_UI_CORE, "utf8"), context);
  const generalSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-general.js"), "utf8")
    .replace(
      "root.DuckSettingsTabGeneral = { init };",
      "root.DuckSettingsTabGeneral = { init, __test: { buildLanguageRow } };"
    );
  vm.runInContext(generalSource, context);

  const core = context.DuckSettingsCore;
  core.state.snapshot = snapshot || { lang: "en" };
  core.state.activeTab = "general";
  context.DuckSettingsTabGeneral.init(core);

  let contentRenderCount = 0;
  function renderLanguageOnly() {
    contentRenderCount++;
    core.ops.clearMountedControls();
    content.innerHTML = "";
    content.appendChild(context.DuckSettingsTabGeneral.__test.buildLanguageRow());
  }
  core.ops.installRenderHooks({ content: renderLanguageOnly });

  return {
    core,
    content,
    raf,
    settingsAPI,
    updateCalls,
    getContentRenderCount: () => contentRenderCount,
    getLangPicker: () => content.querySelector(".language-picker"),
    getLangTrigger: () => content.querySelector(".language-picker-trigger"),
    getLangMenu: () => content.querySelector(".language-picker-menu"),
    getLangValue: () => content.querySelector(".language-picker-value"),
    getLangOptions: () => content.querySelectorAll(".language-picker-option"),
    getDocumentListenerCount: (type) => {
      const listeners = documentListeners.get(type);
      return listeners ? listeners.length : 0;
    },
    dispatchDocumentEvent: (type, event = {}) => {
      const listeners = documentListeners.get(type) || [];
      const payload = { ...event, type };
      for (const listener of [...listeners]) listener(payload);
    },
    getToastText: () => {
      const toast = toastStack.querySelector(".toast");
      return toast ? toast.textContent : "";
    },
  };
}

function loadGeneralTabForTest({
  snapshot,
  settingsAPI = {},
  platform = "Win32",
  requestAnimationFrame = (cb) => {
    cb();
    return 1;
  },
} = {}) {
  const body = new FakeElement("body");
  const content = new FakeElement("main");
  content.id = "content";
  body.appendChild(content);

  const document = {
    body,
    createElement: (tagName) => new FakeElement(tagName),
    getElementById(id) {
      if (id === "content") return content;
      return null;
    },
  };

  const context = {
    console,
    navigator: { platform },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
    document,
    requestAnimationFrame,
    getComputedStyle: () => ({
      getPropertyValue: () => "",
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
    window: null,
    globalThis: null,
    settingsAPI: {
      update: () => Promise.resolve({ status: "ok" }),
      command: () => Promise.resolve({ status: "ok" }),
      getPreviewSoundUrl: () => Promise.resolve(null),
      openDashboard: () => {},
      ...settingsAPI,
    },
    DuckSettingsSizeSlider: {
      SIZE_UI_MIN: 1,
      SIZE_UI_MAX: 100,
      SIZE_TICK_VALUES: [25, 50, 75, 100],
      SIZE_SLIDER_THUMB_DIAMETER: 18,
      prefsSizeToUi: (value) => value,
      clampSizeUi: (value) => value,
      sizeUiToPct: (value) => value,
      getSizeSliderAnchorPx: () => 0,
      createSizeSliderController: () => ({
        syncFromSnapshot: () => {},
        dispose: () => {},
        pointerDown: () => {},
        pointerUp: () => {},
        pointerCancel: () => {},
        blur: () => {},
        input: () => {},
        change: () => {},
      }),
    },
    DuckSettingsI18n: {
      STRINGS: loadSettingsI18nForTest(),
      CONTRIBUTORS: [],
      MAINTAINERS: [],
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(LANGUAGE_PICKER_JS, "utf8"), context);
  vm.runInContext(fs.readFileSync(SETTINGS_ANIM_OVERRIDES_MERGE, "utf8"), context);
  vm.runInContext(fs.readFileSync(SETTINGS_UI_CORE, "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, "settings-tab-general.js"), "utf8"), context);

  const core = context.DuckSettingsCore;
  core.state.snapshot = snapshot || {};
  core.state.activeTab = "general";
  context.DuckSettingsTabGeneral.init(core);

  let contentRenderCount = 0;
  function renderContent() {
    contentRenderCount++;
    core.ops.clearMountedControls();
    content.innerHTML = "";
    core.tabs.general.render(content, core);
  }
  core.ops.installRenderHooks({ content: renderContent });

  return {
    core,
    content,
    renderContent,
    getContentRenderCount: () => contentRenderCount,
    getSwitchMeta: (key) => core.state.mountedControls.generalSwitches.get(key) || null,
    getSwitch: (key) => {
      const meta = core.state.mountedControls.generalSwitches.get(key);
      return meta ? meta.element : null;
    },
  };
}

function makeGeneralSnapshot(overrides = {}) {
  return {
    lang: "en",
    theme: "duck",
    petTint: {},
    petAccessory: {},
    holidayAccessoryEnabled: {},
    size: 50,
    sessionHudEnabled: true,
    sessionHudShowStateLabels: true,
    sessionHudShowElapsed: true,
    sessionHudShowContextUsage: true,
    sessionHudCleanupDetached: true,
    soundMuted: false,
    soundVolume: 0.5,
    testReactionsEnabled: false,
    lowPowerIdleMode: false,
    allowEdgePinning: true,
    disableMiniMode: false,
    keepSizeAcrossDisplays: true,
    manageClaudeHooksAutomatically: true,
    openAtLogin: false,
    autoStartWithClaude: false,
    hideBubbles: false,
    bubbleFollowPet: true,
    bubbleFollowPreference: "auto",
    bubbleFixedCorner: "bottom-right",
    permissionBubblesEnabled: true,
    notificationBubbleAutoCloseSeconds: 8,
    updateBubbleAutoCloseSeconds: 12,
    ...overrides,
  };
}

function createKeyboardEventForTest(key) {
  return {
    type: "keydown",
    key,
    bubbles: true,
    cancelBubble: false,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.cancelBubble = true;
    },
  };
}

function findAncestorByClass(el, className) {
  let current = el;
  while (current) {
    if (current.classList && current.classList.contains(className)) return current;
    current = current.parentNode;
  }
  return null;
}

function choosePickerOption(picker, value) {
  picker.querySelector(".language-picker-trigger").dispatchEvent({ type: "click" });
  const option = picker.querySelectorAll(".language-picker-option")
    .find((candidate) => candidate.dataset.lang === String(value));
  assert.ok(option, `picker option ${value} should exist`);
  option.dispatchEvent({ type: "click" });
}

function getSelectedPickerValue(picker) {
  const selected = picker.querySelectorAll(".language-picker-option")
    .find((option) => option.classList.contains("selected"));
  return selected ? selected.dataset.lang : null;
}

function chooseSegmentedOption(group, value) {
  const option = group.querySelectorAll("button")
    .find((candidate) => candidate.dataset.value === String(value));
  assert.ok(option, `segmented option ${value} should exist`);
  option.dispatchEvent({ type: "click" });
  return option;
}

function loadThemeTabForTest({
  themes,
  snapshot,
  petTintOptions,
  petAccessoryOptions,
  petMouthAccessoryOptions,
  settingsAPI = {},
} = {}) {
  const documentListeners = new Map();
  const body = new FakeElement("body");
  const content = new FakeElement("main");
  content.id = "content";
  body.appendChild(content);

  const commands = [];
  const updates = [];
  let themeListState = Array.isArray(themes) ? themes : [];
  const document = {
    body,
    createElement: (tagName) => new FakeElement(tagName),
    getElementById(id) {
      if (id === "content") return content;
      return null;
    },
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, new Set());
      documentListeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      const listeners = documentListeners.get(type);
      if (listeners) listeners.delete(handler);
    },
  };

  const api = {
    command: (name, payload) => {
      commands.push({ name, payload });
      if (name === "setThemeSelection" && payload && typeof payload.themeId === "string") {
        const target = themeListState.find((theme) => theme && theme.id === payload.themeId);
        themeListState = themeListState.map((theme) => ({
          ...theme,
          active: theme.id === payload.themeId,
        }));
        return Promise.resolve({
          status: "ok",
          customizationCapabilities: target
            ? {
                petTint: target.capabilities && target.capabilities.petTint === true,
                accessories: target.capabilities && target.capabilities.accessories === true,
                mouthAccessories: target.capabilities && target.capabilities.mouthAccessories === true,
              }
            : null,
        });
      }
      return Promise.resolve({ status: "ok" });
    },
    listThemes: () => Promise.resolve(themeListState),
    update: (key, value) => {
      updates.push({ key, value });
      return Promise.resolve({ status: "ok" });
    },
    ...settingsAPI,
  };
  const context = {
    console,
    navigator: { platform: "Win32" },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
    document,
    requestAnimationFrame: (cb) => {
      cb();
      return 1;
    },
    setTimeout: () => 1,
    clearTimeout: () => {},
    window: null,
    globalThis: null,
    settingsAPI: api,
    DuckSettingsSizeSlider: {
      SIZE_UI_MIN: 1,
      SIZE_UI_MAX: 100,
      SIZE_TICK_VALUES: [25, 50, 75, 100],
      SIZE_SLIDER_THUMB_DIAMETER: 18,
      prefsSizeToUi: (value) => value,
      clampSizeUi: (value) => value,
      sizeUiToPct: (value) => value,
      getSizeSliderAnchorPx: () => 0,
      createSizeSliderController: () => ({}),
    },
    DuckSettingsI18n: {
      STRINGS: loadSettingsI18nForTest(),
      CONTRIBUTORS: [],
      MAINTAINERS: [],
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(LANGUAGE_PICKER_JS, "utf8"), context);
  vm.runInContext(fs.readFileSync(SETTINGS_ANIM_OVERRIDES_MERGE, "utf8"), context);
  vm.runInContext(fs.readFileSync(SETTINGS_UI_CORE, "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, "settings-tab-theme.js"), "utf8"), context);

  const core = context.DuckSettingsCore;
  core.state.snapshot = {
    lang: "en",
    petTint: {},
    petAccessory: {},
    petMouthAccessory: {},
    holidayAccessoryEnabled: {},
    ...(snapshot || {}),
  };
  core.state.activeTab = "theme";
  core.runtime.themeList = themeListState;
  core.runtime.petTintOptions = Array.isArray(petTintOptions) ? petTintOptions : [];
  core.runtime.petAccessoryOptions = Array.isArray(petAccessoryOptions)
    ? petAccessoryOptions
    : [];
  core.runtime.petMouthAccessoryOptions = Array.isArray(petMouthAccessoryOptions)
    ? petMouthAccessoryOptions
    : [];
  context.DuckSettingsTabTheme.init(core);
  const renderContent = () => {
    content.innerHTML = "";
    core.tabs.theme.render(content, core);
  };
  core.ops.installRenderHooks({ content: renderContent });
  renderContent();

  return { content, commands, updates, core, renderContent };
}

function loadAgentsTabForTest({
  snapshot,
  agentMetadata,
  collapsedGroups = {},
  settingsAPI = {},
  doctor = null,
} = {}) {
  const raf = createQueuedRaf();
  const body = new FakeElement("body");
  const content = new FakeElement("main");
  content.id = "content";
  body.appendChild(content);

  const localStorageData = {
    "duck.settings.collapsedGroups.v1": JSON.stringify(collapsedGroups),
  };

  const document = {
    body,
    createElement: (tagName) => new FakeElement(tagName),
    getElementById(id) {
      if (id === "content") return content;
      return null;
    },
  };

  const context = {
    console,
    navigator: { platform: "Win32" },
    localStorage: {
      getItem: (key) => (Object.prototype.hasOwnProperty.call(localStorageData, key) ? localStorageData[key] : null),
      setItem: (key, value) => {
        localStorageData[key] = String(value);
      },
    },
    document,
    requestAnimationFrame: (cb) => raf.requestAnimationFrame(cb),
    setTimeout,
    window: null,
    globalThis: null,
    settingsAPI: {
      command: () => Promise.resolve({ status: "ok" }),
      ...settingsAPI,
    },
    doctor,
    DuckSettingsSizeSlider: {
      SIZE_UI_MIN: 1,
      SIZE_UI_MAX: 100,
      SIZE_TICK_VALUES: [25, 50, 75, 100],
      SIZE_SLIDER_THUMB_DIAMETER: 18,
      prefsSizeToUi: (value) => value,
      clampSizeUi: (value) => value,
      sizeUiToPct: (value) => value,
      getSizeSliderAnchorPx: () => 0,
      createSizeSliderController: () => ({}),
    },
    DuckSettingsI18n: {
      STRINGS: {
        en: {
          agentsTitle: "Agents",
          agentsSubtitle: "subtitle",
          agentsEmpty: "empty",
          agentSectionConnected: "Connected",
          agentSectionRecommended: "Detected locally",
          agentSectionUnavailable: "More supported tools",
          agentSearchPlaceholder: "Search",
          agentsSubtabConnected: "Connected",
          agentsSubtabDiscover: "Discover and add",
          rowCustomToolsDiscoveryPathsDesc: "Choose an AI installation folder.",
          customToolManualAdd: "Choose AI installation folder",
          customToolNotRecognized: "No launchable application found",
          customToolDetectionMissing: "Path missing",
          agentInstanceScanWsl: "Scan WSL",
          agentInstanceScanWslDesc: "Rescan WSL distros",
          customToolRescan: "Rescan",
          customToolScanStatusIdle: "Not scanned",
          customToolScanStatusScanning: "Scanning...",
          customToolScanStatusComplete: "Last scanned at {time}",
          customToolScanStatusFailed: "Scan failed",
          customAgentWaiting: "Waiting for first state event this run",
          customAgentLastState: "Last state: {event} at {time}",
          rowAgentIdleAlerts: "Idle alerts",
          rowAgentIdleAlertsDesc: "Idle alert desc",
          rowAgentPermissions: "Permissions",
          rowAgentPermissionsDesc: "Permissions desc",
          rowStartWithCodex: "Start with Codex",
          rowStartWithCodexDesc: "Start with Codex desc",
          rowCodexPermissionMode: "Permission mode",
          rowCodexPermissionModeDesc: "Permission mode desc",
          codexPermissionModeNative: "Native",
          codexPermissionModeIntercept: "Intercept",
          rowCodexNativeNotificationSound: "Native sound",
          rowCodexNativeNotificationSoundDesc: "Native sound desc",
          badgePermissionBubble: "Permission bubble",
          eventSourceHook: "Hook",
          eventSourceLogPoll: "Log poll",
          eventSourcePlugin: "Plugin",
          eventSourceExtension: "Extension",
          agentIntegrationInstalled: "Installed",
          agentIntegrationNotInstalled: "Not installed",
          agentIntegrationInstall: "Install",
          agentCodexHookNeedsAttention: "Needs attention",
          codexHookHealthReasonInactive: "Hook inactive",
          codexHookHealthReasonDisabled: "Hooks disabled",
          codexHookHealthReasonNeedsReview: "Needs review",
          agentIntegrationUninstall: "Uninstall",
          agentIntegrationWorking: "Working",
          agentIntegrationUninstallConfirm: "Confirm uninstall",
          agentIntegrationInstallSkipped: "No local installation was found for {agents}.",
          agentListSeparator: ", ",
          agentInstallHintTitle: "Connect detected agents",
          agentInstallHintDesc: "Detected local signals for {agents}.",
          agentInstallHintInstallRecommended: "Install recommended",
          agentInstallHintDismiss: "Not now",
          agentCleanupHintTitle: "Review missing local agents",
          agentCleanupHintDesc: "Missing local installs for {agents}.",
          agentCleanupHintRemove: "Remove integrations",
          agentCleanupHintDismiss: "Keep for now",
          collapsibleExpand: "Expand",
          collapsibleCollapse: "Collapse",
          toastAgentIntegrationInstalled: "Integration installed.",
          toastAgentIntegrationUninstalled: "Integration uninstalled.",
          toastAgentInstallHintInstalled: "Recommended integrations installed.",
          toastAgentInstallHintSkipped: "No local installation was found for {agents}.",
          toastAgentInstallHintPartialSkipped: "{success} installed. Skipped {agents}.",
          toastAgentInstallHintPartial: "{success} installed, {failed} failed: {message}",
          toastAgentCleanupHintRemoved: "Missing integrations removed.",
          toastAgentCleanupHintPartial: "{success} removed, {failed} failed: {message}",
          toastSaveFailed: "Failed: ",
        },
      },
      CONTRIBUTORS: [],
      MAINTAINERS: [],
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(LANGUAGE_PICKER_JS, "utf8"), context);
  vm.runInContext(fs.readFileSync(SETTINGS_ANIM_OVERRIDES_MERGE, "utf8"), context);
  vm.runInContext(fs.readFileSync(SETTINGS_UI_CORE, "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, "settings-agent-order.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, "settings-tab-agents.js"), "utf8"), context);

  const core = context.DuckSettingsCore;
  core.state.snapshot = snapshot || { agents: {} };
  core.state.activeTab = "agents";
  core.runtime.agentMetadata = Array.isArray(agentMetadata) ? agentMetadata : [];
  context.DuckSettingsTabAgents.init(core);

  let contentRenderCount = 0;
  function renderContent() {
    contentRenderCount++;
    core.ops.clearMountedControls();
    content.innerHTML = "";
    core.tabs.agents.render(content, core);
  }
  core.ops.installRenderHooks({ content: renderContent });

  return {
    core,
    content,
    raf,
    getContentRenderCount: () => contentRenderCount,
  };
}

function loadAnimMapTabForTest({
  snapshot,
  settingsAPI = {},
} = {}) {
  const body = new FakeElement("body");
  const content = new FakeElement("main");
  body.appendChild(content);

  const document = {
    body,
    createElement: (tagName) => new FakeElement(tagName),
    getElementById(id) {
      if (id === "content") return content;
      return null;
    },
  };

  const context = {
    console,
    navigator: { platform: "Win32" },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
    document,
    requestAnimationFrame: (cb) => {
      cb();
      return 1;
    },
    window: null,
    globalThis: null,
    settingsAPI: {
      command: () => Promise.resolve({ status: "ok" }),
      ...settingsAPI,
    },
    DuckSettingsSizeSlider: {
      SIZE_UI_MIN: 1,
      SIZE_UI_MAX: 100,
      SIZE_TICK_VALUES: [25, 50, 75, 100],
      SIZE_SLIDER_THUMB_DIAMETER: 18,
      prefsSizeToUi: (value) => value,
      clampSizeUi: (value) => value,
      sizeUiToPct: (value) => value,
      getSizeSliderAnchorPx: () => 0,
      createSizeSliderController: () => ({}),
    },
    DuckSettingsI18n: {
      STRINGS: { en: {} },
      CONTRIBUTORS: [],
      MAINTAINERS: [],
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(SETTINGS_ANIM_OVERRIDES_MERGE, "utf8"), context);
  vm.runInContext(fs.readFileSync(SETTINGS_UI_CORE, "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, "settings-tab-anim-map.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, "settings-tab-anim-overrides.js"), "utf8"), context);

  const core = context.DuckSettingsCore;
  core.state.snapshot = snapshot || { theme: "duck", themeOverrides: {} };
  // The Animation Map now lives as the default "on / off" subtab of the
  // Animation & Sound Overrides tab, so patching flows through that tab.
  core.state.activeTab = "animOverrides";
  context.DuckSettingsTabAnimMap.init(core);
  context.DuckSettingsTabAnimOverrides.init(core);

  let contentRenderCount = 0;
  core.ops.installRenderHooks({
    content: () => {
      contentRenderCount++;
    },
  });

  return {
    core,
    content,
    getContentRenderCount: () => contentRenderCount,
  };
}

function loadAboutTabForTest({
  snapshot = {},
  update,
  aboutInfo = {},
  checkForUpdates = () => Promise.resolve({ state: "up-to-date", version: "1.0.0" }),
  clearUpdateError = () => Promise.resolve({ state: "idle" }),
  writeClipboard = () => Promise.resolve(),
} = {}) {
  const body = new FakeElement("body");
  const content = new FakeElement("main");
  content.id = "content";
  body.appendChild(content);
  const updateCalls = [];
  const toasts = [];
  const disposableHarness = createMountedDisposableHarness();
  const document = {
    body,
    createElement: (tagName) => new FakeElement(tagName),
    getElementById: (id) => (id === "content" ? content : null),
  };
  const context = {
    console,
    document,
    navigator: {},
    window: null,
    globalThis: null,
    settingsAPI: {
      getAboutInfo: () => Promise.resolve({
        version: "1.0.0",
        autoUpdateCheck: snapshot.autoUpdateCheck !== false,
        updateCheckSnapshot: { state: "idle" },
        ...aboutInfo,
      }),
      update: (key, value) => {
        updateCalls.push({ key, value });
        return update ? update(key, value) : Promise.resolve({ status: "ok" });
      },
      command: () => Promise.resolve({ status: "ok" }),
      checkForUpdates,
      clearUpdateError,
      copyUpdateError: async (text) => {
        await writeClipboard(text);
        return { status: "ok" };
      },
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, "settings-tab-about.js"), "utf8"), context);

  const core = {
    state: {
      snapshot: { autoUpdateCheck: true, ...snapshot },
      activeTab: "about",
      mountedControls: { aboutAutoUpdate: null, aboutUpdateStatus: null },
    },
    runtime: { about: { infoCache: null, clickCount: 0, updateCheckSnapshot: { state: "idle" } } },
    helpers: {
      t: (key) => key,
      attachSettingsDisclosure: attachDisclosureForHarness,
      registerMountedDisposable: disposableHarness.register,
      disposeMountedDisposable: disposableHarness.dispose,
      createDisclosureChevron: (className) => {
        const chevron = document.createElement("span");
        chevron.className = className;
        chevron.setAttribute("aria-hidden", "true");
        return chevron;
      },
      setSwitchVisual: (element, checked, options = {}) => {
        element.classList.toggle("on", !!checked);
        element.classList.toggle("pending", !!options.pending);
        element.setAttribute("aria-checked", checked ? "true" : "false");
      },
      openExternalSafe: () => {},
      showSettingsConfirmModal: () => Promise.resolve("cancel"),
    },
    ops: {
      showToast: (message, options) => toasts.push({ message, options }),
    },
    i18n: { CONTRIBUTORS: [], MAINTAINERS: [] },
    tabs: {},
  };
  context.DuckSettingsTabAbout.init(core);
  core.tabs.about.render(content, core);
  return { core, content, updateCalls, toasts, disposableHarness };
}

function loadAnimOverridesTabForTest({
  runtime,
  modalRoot,
  settingsAPI = {},
  opsOverrides = {},
  readersOverrides = {},
  helpersOverrides = {},
}) {
  const disposableHarness = createMountedDisposableHarness();
  const documentListeners = new Map();
  const content = new FakeElement("main");
  content.id = "content";
  const document = {
    body: new FakeElement("body"),
    createElement: (tagName) => new FakeElement(tagName),
    getElementById: (id) => (id === "modalRoot" ? modalRoot : id === "content" ? content : null),
    querySelector: () => null,
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, new Set());
      documentListeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      const listeners = documentListeners.get(type);
      if (listeners) listeners.delete(handler);
    },
  };
  document.body.appendChild(content);
  const context = {
    console,
    document,
    requestAnimationFrame: (cb) => {
      cb();
      return 1;
    },
    setInterval: () => 1,
    clearInterval: () => {},
    URL,
    window: {
      settingsAPI: {
        openThemeAssetsDir: () => Promise.resolve({ status: "ok" }),
        command: () => Promise.resolve({ status: "ok" }),
        exportAnimationOverrides: () => Promise.resolve({ status: "empty" }),
        importAnimationOverrides: () => Promise.resolve({ status: "cancel" }),
        previewAnimationOverride: () => Promise.resolve({ status: "ok" }),
        previewReaction: () => Promise.resolve({ status: "ok" }),
        ...settingsAPI,
      },
    },
    globalThis: null,
    DuckSettingsAnimOverridesMerge: require(SETTINGS_ANIM_OVERRIDES_MERGE),
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, "language-picker.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(SRC_DIR, "settings-tab-anim-overrides.js"), "utf8"), context);
  const core = {
    state: { activeTab: "animOverrides", mountedControls: {} },
    runtime,
    helpers: {
      t: (key) => key,
      createDisclosureChevron: (className) => {
        const chevron = document.createElement("span");
        chevron.className = className;
        chevron.setAttribute("aria-hidden", "true");
        return chevron;
      },
      attachSettingsDisclosure: attachDisclosureForHarness,
      registerMountedDisposable: disposableHarness.register,
      disposeMountedDisposable: disposableHarness.dispose,
      attachActivation: (el, invoke) => {
        if (typeof invoke === "function") el.addEventListener("click", () => invoke());
        return el;
      },
      buildSettingsSelect: (config) => context.DuckLanguagePicker.createSettingsSelect(config),
      ...helpersOverrides,
    },
    ops: {
      selectTab: () => {},
      requestRender: ({ modal = false } = {}) => {
        if (modal && typeof core.renderHooks.modal === "function") core.renderHooks.modal();
      },
      fetchAnimationOverridesData: () => Promise.resolve(runtime.animationOverridesData),
      stopAssetPickerPolling: () => {},
      closeAssetPicker: () => {},
      normalizeAssetPickerSelection: () => {},
      showToast: () => {},
      clearMountedControls: () => disposableHarness.disposeScope(),
      ...opsOverrides,
    },
    i18n: {
      STRINGS: { en: {} },
    },
    readers: {
      hasAnyThemeOverride: () => false,
      readThemeOverrideMap: () => null,
      getLang: () => "en",
      ...readersOverrides,
    },
    renderHooks: {},
    tabs: {},
  };
  context.DuckSettingsTabAnimOverrides.init(core);
  return {
    core,
    content,
    document,
    documentListenerCount: (type) => (documentListeners.get(type) || new Set()).size,
    disposableHarness,
  };
}

function createIdleVisualRuntime(selectedFile = null) {
  const card = createAnimOverrideCard({ id: "state:idle", stateKey: "idle", triggerKind: "idle" });
  return createAnimOverridesRuntime(card, {
    animationOverridesData: {
      theme: { id: "duck", name: "Duck" },
      assets: [],
      sections: [{ id: "idle", cards: [card] }],
      cards: [card],
      sounds: [],
      idleDefaultVisual: {
        themeId: "duck",
        selectedFile,
        options: [
          { file: "duck-idle-follow.svg", isThemeDefault: true, label: "Idle Follow" },
          { file: "duck-idle-reading.svg", isThemeDefault: false, label: "Idle Reading" },
        ],
      },
    },
  });
}

function createAnimOverrideCard(overrides = {}) {
  return {
    id: "state:thinking",
    slotType: "state",
    stateKey: "thinking",
    triggerKind: "thinking",
    currentFile: "cloudling-thinking.svg",
    currentFileUrl: "file:///themes/cloudling/assets/cloudling-thinking.svg",
    currentFilePreviewUrl: "file:///themes/cloudling/assets/cloudling-thinking.svg",
    bindingLabel: "states.thinking[0]",
    transition: { in: 120, out: 180 },
    supportsAutoReturn: false,
    supportsDuration: false,
    assetCycleMs: 1000,
    assetCycleStatus: "ok",
    suggestedDurationMs: null,
    suggestedDurationStatus: "unavailable",
    previewDurationMs: 1000,
    displayHintWarning: false,
    displayHintTarget: null,
    fallbackTargetState: null,
    wideHitboxEnabled: false,
    wideHitboxOverridden: false,
    wideHitboxThemeDefault: false,
    aspectRatioWarning: null,
    ...overrides,
  };
}

function createAnimOverridesRuntime(card, overrides = {}) {
  return {
    animationOverridesData: {
      theme: { id: "cloudling", name: "Cloudling" },
      assets: [],
      sections: [{ id: "work", cards: [card] }],
      cards: [card],
      sounds: [],
    },
    animOverridesSubtab: "animations",
    expandedOverrideRowIds: new Set([card.id]),
    assetPicker: {
      state: null,
      pollTimer: null,
    },
    ...overrides,
  };
}

describe("settings renderer browser environment", () => {
  it("uses browser globals instead of CommonJS in settings renderer modules", () => {
    const rendererSource = fs.readFileSync(SETTINGS_RENDERER, "utf8");
    const coreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    const i18nSource = fs.readFileSync(SETTINGS_I18N, "utf8");
    const doctorModalSource = fs.readFileSync(SETTINGS_DOCTOR_MODAL, "utf8");
    const agentOrderSource = fs.readFileSync(path.join(SRC_DIR, "settings-agent-order.js"), "utf8");

    assert.ok(rendererSource.includes("globalThis.DuckSettingsCore"));
    assert.ok(rendererSource.includes("settingsAPI.getPetTintOptions"));
    assert.ok(rendererSource.includes("settingsAPI.getPetAccessoryOptions"));
    assert.ok(rendererSource.includes("settingsAPI.getPetMouthAccessoryOptions"));
    assert.ok(fs.readFileSync(PRELOAD_SETTINGS, "utf8").includes(
      'getPetTintOptions: () => ipcRenderer.invoke("settings:get-pet-tint-options")'
    ));
    assert.ok(fs.readFileSync(PRELOAD_SETTINGS, "utf8").includes(
      'getPetAccessoryOptions: () => ipcRenderer.invoke("settings:get-pet-accessory-options")'
    ));
    assert.ok(fs.readFileSync(PRELOAD_SETTINGS, "utf8").includes(
      'getPetMouthAccessoryOptions: () => ipcRenderer.invoke("settings:get-pet-mouth-accessory-options")'
    ));
    assert.ok(coreSource.includes("DuckSettingsSizeSlider"));
    assert.ok(i18nSource.includes("globalThis"));
    assert.ok(doctorModalSource.includes("globalThis"));
    assert.ok(doctorModalSource.includes("DuckSettingsDoctorModal"));
    assert.ok(agentOrderSource.includes("globalThis"));
    assert.ok(agentOrderSource.includes("module.exports"));

    for (const source of [rendererSource, coreSource, i18nSource, doctorModalSource]) {
      assert.ok(!source.includes("require("));
      assert.ok(!source.includes("module.exports"));
    }
    assert.ok(!agentOrderSource.includes("require("));

    for (const file of TAB_MODULES) {
      const source = fs.readFileSync(file, "utf8");
      assert.ok(!source.includes("require("), `${path.basename(file)} must stay browser-script friendly`);
      assert.ok(!source.includes("module.exports"), `${path.basename(file)} must not use CommonJS exports`);
      assert.ok(!source.includes("settingsAPI.onChanged"), `${path.basename(file)} must not subscribe to settingsAPI.onChanged`);
      assert.ok(!source.includes("settingsAPI.onShortcutRecordKey"), `${path.basename(file)} must not subscribe to settingsAPI.onShortcutRecordKey`);
      assert.ok(!source.includes("settingsAPI.onShortcutFailuresChanged"), `${path.basename(file)} must not subscribe to settingsAPI.onShortcutFailuresChanged`);
      assert.ok(!source.includes("settingsAPI.onRemoteApprovalStatusChanged"), `${path.basename(file)} must not subscribe to remote approval status directly`);
    }
  });

  it("keeps sidebar page scroll positions isolated when a shorter page clamps scrollTop", () => {
    let rawScrollTop = 1480;
    let maxScrollTop = 2000;
    const raf = createQueuedRaf();
    const content = {
      get scrollTop() {
        return Math.min(rawScrollTop, maxScrollTop);
      },
      set scrollTop(value) {
        rawScrollTop = Math.max(0, Math.min(Number(value) || 0, maxScrollTop));
      },
    };
    const document = {
      body: { contains: () => false },
      getElementById: (id) => (id === "content" ? content : null),
    };
    const core = loadSettingsCoreForTest({}, {
      document,
      requestAnimationFrame: raf.requestAnimationFrame,
    });
    core.state.activeTab = "agents";
    core.tabs.agents = {};
    core.tabs.theme = {};
    core.ops.installRenderHooks({
      sidebar: () => {},
      modal: () => {},
      content: () => {
        maxScrollTop = core.state.activeTab === "theme" ? 398 : 2000;
        content.scrollTop = content.scrollTop;
      },
    });

    core.ops.selectTab("theme");
    assert.equal(content.scrollTop, 0, "a sidebar page starts at the top on first entry");
    raf.flush();

    content.scrollTop = 240;
    core.ops.selectTab("agents");
    assert.equal(content.scrollTop, 1480, "the long source page restores its saved position");

    // Switch again before the long page's deferred restore runs. Its stale
    // callback must not overwrite the newly active Theme page.
    core.ops.selectTab("theme");
    raf.flush();
    assert.equal(content.scrollTop, 240, "the short target page keeps its own position");
  });

  it("restores the last Settings page and its scroll position after reopening", () => {
    const storageData = {};
    const localStorage = {
      getItem: (key) => Object.prototype.hasOwnProperty.call(storageData, key)
        ? storageData[key]
        : null,
      setItem: (key, value) => {
        storageData[key] = String(value);
      },
    };
    const firstContent = { scrollTop: 0 };
    const first = loadSettingsCoreForTest({}, {
      document: {
        body: { contains: () => false },
        getElementById: (id) => (id === "content" ? firstContent : null),
      },
      localStorage,
    });
    first.tabs.general = {};
    first.tabs.theme = {};
    first.ops.installRenderHooks({ sidebar: () => {}, content: () => {}, modal: () => {} });
    firstContent.scrollTop = 180;
    first.ops.selectTab("theme");
    firstContent.scrollTop = 720;
    first.ops.persistNavigationState();

    const secondContent = { scrollTop: 0 };
    const second = loadSettingsCoreForTest({}, {
      document: {
        body: { contains: () => false },
        getElementById: (id) => (id === "content" ? secondContent : null),
      },
      localStorage,
    });
    second.tabs.general = {};
    second.tabs.theme = {};
    second.ops.installRenderHooks({ sidebar: () => {}, content: () => {}, modal: () => {} });

    assert.strictEqual(second.ops.restoreNavigationState(), true);
    assert.strictEqual(second.state.activeTab, "theme");
    second.ops.applyBootstrap({ language: "zh" });
    assert.strictEqual(secondContent.scrollTop, 720);
    assert.strictEqual(second.runtime.settingsTabScrollPositions.get("general"), 180);
  });

  it("does not let a one-shot deep-link replace the user's last ordinary Settings tab", () => {
    const storageData = {};
    const localStorage = {
      getItem: (key) => Object.prototype.hasOwnProperty.call(storageData, key) ? storageData[key] : null,
      setItem: (key, value) => { storageData[key] = String(value); },
    };
    const content = { scrollTop: 0 };
    const first = loadSettingsCoreForTest({}, {
      document: {
        body: { contains: () => false },
        getElementById: (id) => (id === "content" ? content : null),
      },
      localStorage,
    });
    first.tabs.general = {};
    first.tabs.theme = {};
    first.tabs.agents = {};
    first.ops.installRenderHooks({ sidebar: () => {}, content: () => {}, modal: () => {} });
    first.ops.selectTab("theme");
    first.ops.selectTab("agents", { persist: false });
    first.ops.persistNavigationState();

    const second = loadSettingsCoreForTest({}, {
      document: {
        body: { contains: () => false },
        getElementById: (id) => (id === "content" ? { scrollTop: 0 } : null),
      },
      localStorage,
    });
    second.tabs.general = {};
    second.tabs.theme = {};
    second.tabs.agents = {};
    assert.equal(second.ops.restoreNavigationState(), true);
    assert.equal(second.state.activeTab, "theme");
  });

  it("keeps About contributors visible and includes verified GitHub contributors", () => {
    const aboutSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-about.js"), "utf8");
    const coreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    const i18nBundle = loadSettingsI18nBundleForTest();

    assert.ok(!aboutSource.includes("about-contributors-toggle"));
    assert.ok(!aboutSource.includes("contributorsExpanded"));
    assert.ok(!coreSource.includes("contributorsExpanded"));
    assert.ok(!css.includes(".about-contributors-list.collapsed"));

    for (const login of VERIFIED_GITHUB_CONTRIBUTORS) {
      assert.ok(i18nBundle.CONTRIBUTORS.includes(login), `About contributors should include ${login}`);
    }
  });

  it("updates the About auto-update switch in place and blocks rapid duplicate saves", async () => {
    const save = createDeferred();
    const harness = loadAboutTabForTest({
      snapshot: { autoUpdateCheck: true },
      update: () => save.promise,
    });
    await new Promise((resolve) => setImmediate(resolve));

    const autoUpdateSwitch = harness.content.querySelector(".about-auto-update-switch");
    assert.ok(autoUpdateSwitch);
    autoUpdateSwitch.dispatchEvent({ type: "click" });
    autoUpdateSwitch.dispatchEvent({ type: "click" });
    assert.deepStrictEqual(harness.updateCalls, [{ key: "autoUpdateCheck", value: false }]);
    assert.equal(autoUpdateSwitch.classList.contains("pending"), true);
    assert.equal(autoUpdateSwitch.getAttribute("aria-disabled"), "true");

    save.resolve({ status: "ok" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(autoUpdateSwitch.classList.contains("pending"), false);
    assert.equal(autoUpdateSwitch.getAttribute("aria-checked"), "false");

    harness.core.state.snapshot.autoUpdateCheck = true;
    assert.equal(harness.core.tabs.about.patchInPlace({ autoUpdateCheck: true }), true);
    assert.strictEqual(harness.content.querySelector(".about-auto-update-switch"), autoUpdateSwitch);
    assert.equal(autoUpdateSwitch.getAttribute("aria-checked"), "true");
  });

  it("rolls the About auto-update switch back when persistence fails", async () => {
    const harness = loadAboutTabForTest({
      snapshot: { autoUpdateCheck: true },
      update: () => Promise.resolve({ status: "error", message: "disk full" }),
    });
    await new Promise((resolve) => setImmediate(resolve));
    const autoUpdateSwitch = harness.content.querySelector(".about-auto-update-switch");
    autoUpdateSwitch.dispatchEvent({ type: "click" });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(autoUpdateSwitch.getAttribute("aria-checked"), "true");
    assert.equal(autoUpdateSwitch.classList.contains("pending"), false);
    assert.equal(harness.toasts.length, 1);
    assert.equal(harness.toasts[0].options.error, true);
  });

  it("shows, copies, patches, and dismisses structured update errors in About", async () => {
    const copied = [];
    let clearCalls = 0;
    const report = {
      code: "DNS_FAILED",
      phase: "release-lookup",
      title: "Update Error",
      message: "The update service address could not be resolved.",
      nextStep: "Check DNS and proxy settings.",
      detail: "getaddrinfo ENOTFOUND api.github.com",
      copyText: "DNS_FAILED\ngetaddrinfo ENOTFOUND api.github.com",
    };
    const harness = loadAboutTabForTest({
      aboutInfo: { updateCheckSnapshot: { state: "error", error: report } },
      writeClipboard: async (value) => copied.push(value),
      clearUpdateError: async () => {
        clearCalls++;
        return { state: "idle" };
      },
    });
    await new Promise((resolve) => setImmediate(resolve));

    const card = harness.content.querySelector(".about-update-error-card");
    assert.ok(card);
    assert.equal(card.getAttribute("role"), "alert");
    assert.match(collectText(card), /DNS_FAILED/);
    assert.match(collectText(card), /Check DNS and proxy settings/);
    const detailsTrigger = card.querySelector(".about-update-error-details-trigger");
    const detailsBody = card.querySelector(".about-update-error-details-body");
    assert.equal(detailsTrigger.tagName, "BUTTON");
    assert.equal(detailsTrigger.getAttribute("aria-expanded"), "false");
    assert.equal(detailsBody.getAttribute("aria-hidden"), "true");
    detailsTrigger.click();
    assert.equal(detailsTrigger.getAttribute("aria-expanded"), "true");
    assert.equal(detailsBody.getAttribute("aria-hidden"), "false");

    const copyButton = card.querySelector(".about-update-error-copy");
    copyButton.dispatchEvent({ type: "click" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepStrictEqual(copied, [report.copyText]);
    assert.equal(copyButton.textContent, "aboutUpdateErrorCopied");

    assert.equal(harness.core.tabs.about.applyUpdateCheckStatus({ state: "checking" }), true);
    detailsTrigger.click();
    assert.equal(
      detailsTrigger.getAttribute("aria-expanded"),
      "true",
      "replacing the error card must dispose the detached disclosure trigger",
    );
    assert.equal(harness.content.querySelector(".about-check-update-btn").disabled, true);
    harness.core.tabs.about.applyUpdateCheckStatus({ state: "error", error: report });
    harness.content.querySelector(".about-update-error-close").dispatchEvent({ type: "click" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(clearCalls, 1);
    assert.strictEqual(harness.content.querySelector(".about-update-error-card"), null);
  });

  it("wires Duck Doctor through Settings with Step 2 connection actions", () => {
    const html = fs.readFileSync(SETTINGS_HTML, "utf8");
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    const rendererSource = fs.readFileSync(SETTINGS_RENDERER, "utf8");
    const doctorModalSource = fs.readFileSync(SETTINGS_DOCTOR_MODAL, "utf8");
    const preloadSource = fs.readFileSync(PRELOAD_SETTINGS, "utf8");
    const mainSource = fs.readFileSync(MAIN_PROCESS, "utf8");
    const doctorIpcSource = fs.readFileSync(DOCTOR_IPC, "utf8");
    const i18nSource = fs.readFileSync(SETTINGS_I18N, "utf8");

    assert.ok(html.includes('<script src="settings-doctor-modal.js"></script>'));
    assert.ok(css.includes(".doctor-indicator"));
    assert.ok(css.includes(".doctor-modal"));
    assert.ok(rendererSource.includes("DuckSettingsDoctorModal.renderSidebarIndicator"));
    assert.ok(doctorModalSource.includes("initialRunStarted"));
    assert.ok(doctorModalSource.includes("runningPromise"));
    assert.ok(doctorModalSource.includes("root.doctor.runChecks"));
    assert.ok(doctorModalSource.includes("root.doctor.getReport"));
    assert.ok(doctorModalSource.includes("root.doctor.testConnection"));
    assert.ok(doctorModalSource.includes("root.doctor.openDuckLog"));
    assert.ok(doctorModalSource.includes('root.settingsAPI.command("repairDoctorIssue"'));
    assert.ok(doctorModalSource.includes("requiresFixConfirmation"));
    assert.ok(doctorModalSource.includes("renderFixConfirm"));
    assert.ok(doctorModalSource.includes("doctorFixConfirmCodexDetail"));
    assert.ok(doctorModalSource.includes("doctorRestartConfirmDetail"));
    assert.ok(doctorModalSource.includes("doctorRestartButton"));
    assert.ok(doctorModalSource.includes('commandAction.type !== "restart-duck"'));
    assert.ok(doctorModalSource.includes("repairFeedback"));
    assert.ok(doctorModalSource.includes("lastRepairFeedback"));
    assert.ok(doctorModalSource.includes("actionNotice"));
    assert.ok(doctorModalSource.includes("actionNoticeTimer"));
    assert.ok(doctorModalSource.includes("checkExpansionOverrides"));
    assert.ok(doctorModalSource.includes("checksLoading"));
    assert.ok(doctorModalSource.includes("connectionRunId"));
    assert.ok(doctorModalSource.includes("repairRunId"));
    assert.ok(doctorModalSource.includes("modalEntering"));
    assert.ok(doctorModalSource.includes("clearModalEnteringTimer"));
    assert.ok(doctorModalSource.includes("startModalEntering"));
    assert.ok(doctorModalSource.includes("showActionNotice"));
    assert.ok(doctorModalSource.includes("if (state.modalOpen)"));
    assert.ok(doctorModalSource.includes("core.ops.showToast"));
    assert.ok(!doctorModalSource.includes("core.helpers.showToast"));
    assert.ok(doctorModalSource.includes("agentDetailText"));
    assert.ok(doctorModalSource.includes("startConnectionTest"));
    assert.ok(doctorModalSource.includes("stopConnectionCountdown();"));
    assert.ok(doctorModalSource.includes('class="doctor-title-row"'));
    assert.ok(doctorModalSource.includes("renderLocalServerCheck"));
    assert.ok(doctorModalSource.includes("doctor-local-server-main"));
    assert.ok(doctorModalSource.includes('class="doctor-check-summary" title='));
    assert.ok(doctorModalSource.includes('const fullDetail = detail && cls !== "pass"'));
    assert.ok(doctorModalSource.includes("renderAgentIntegrationCheck"));
    assert.ok(doctorModalSource.includes("doctor-agent-collapsible"));
    assert.ok(doctorModalSource.includes("doctor-agent-chevron"));
    assert.ok(/doctor-agent-chevron[\s\S]*doctor-check-label[\s\S]*doctor-check-summary[\s\S]*doctor-check-status/.test(doctorModalSource));
    assert.ok(doctorModalSource.includes("doctor-agent-body"));
    assert.ok(doctorModalSource.includes("doctor-agent-body-inner"));
    assert.ok(doctorModalSource.includes('data-action="toggle-check"'));
    assert.ok(doctorModalSource.includes("core.helpers.attachSettingsDisclosure({"));
    assert.ok(doctorModalSource.includes("disposeDoctorDisclosures"));
    assert.ok(doctorModalSource.includes("state.disclosureControllers.push(controller)"));
    assert.ok(!doctorModalSource.includes('button.setAttribute("aria-expanded"'));
    assert.ok(!doctorModalSource.includes('row.classList.toggle("expanded"'));
    assert.ok(doctorModalSource.includes('" inert"'));
    assert.ok(doctorModalSource.includes("checkNeedsAttention"));
    assert.ok(doctorModalSource.includes("formatAgentIntegrationSummary"));
    assert.ok(doctorModalSource.includes("formatAgentAttentionNames"));
    assert.ok(doctorModalSource.includes("AGENT_ATTENTION_NAME_LIMIT"));
    assert.ok(doctorModalSource.includes("doctorAgentSummaryNeedsAttention"));
    assert.ok(doctorModalSource.includes("+${hidden}"));
    assert.ok(doctorModalSource.includes("doctorAgentSummaryOk"));
    assert.ok(doctorModalSource.includes("doctorAgentSummaryAttention"));
    assert.ok(doctorModalSource.includes("doctorAgentSummarySkipped"));
    assert.ok(doctorModalSource.includes("AGENT_WARNING_STATUSES"));
    assert.ok(doctorModalSource.includes("AGENT_INFO_STATUSES"));
    assert.ok(doctorModalSource.includes("renderCheckSkeleton"));
    assert.ok(doctorModalSource.includes("doctor-check-skeleton"));
    assert.ok(doctorModalSource.includes("doctor-skeleton-line"));
    assert.ok(doctorModalSource.includes("doctor-connection-progress"));
    assert.ok(doctorModalSource.includes("const runId = ++state.connectionRunId"));
    assert.ok(doctorModalSource.includes("if (runId !== state.connectionRunId) return;"));
    assert.ok(doctorModalSource.includes("state.connectionTesting = false"));
    assert.ok(doctorModalSource.includes("state.connectionTest = null"));
    assert.ok(doctorModalSource.includes('state.checksLoading = true'));
    assert.ok(doctorModalSource.includes('state.checksLoading = false'));
    assert.ok(doctorModalSource.includes("formatCheckedDateTime"));
    assert.ok(doctorModalSource.includes('year: "numeric"'));
    assert.ok(doctorModalSource.includes('month: "2-digit"'));
    assert.ok(doctorModalSource.includes('day: "2-digit"'));
    assert.ok(doctorModalSource.includes("renderLastChecked"));
    assert.ok(doctorModalSource.includes("doctorLastCheckedAt"));
    assert.ok(doctorModalSource.includes("result.generatedAt"));
    assert.ok(doctorModalSource.includes("doctor-last-checked"));
    assert.ok(doctorModalSource.includes("const opening = !state.modalOpen"));
    assert.ok(doctorModalSource.includes("const entering = state.modalEntering"));
    assert.ok(doctorModalSource.includes("doctor-modal-entering"));
    assert.ok(doctorModalSource.includes("renderModalBody(core, result, { entering })"));
    assert.ok(doctorModalSource.includes("renderActionNotice"));
    assert.ok(doctorModalSource.includes("doctor-action-notice-icon"));
    assert.ok(doctorModalSource.includes("doctor-action-notice-text"));
    assert.ok(doctorModalSource.includes("doctor-action-bar"));
    assert.ok(doctorModalSource.includes("clearActionNoticeTimer();"));
    assert.ok(doctorModalSource.includes("state.repairFeedback = {};"));
    assert.ok(doctorModalSource.includes("state.repairingKey = null;"));
    assert.ok(doctorModalSource.includes("const runId = ++state.repairRunId"));
    assert.ok(doctorModalSource.includes("if (runId !== state.repairRunId) return;"));
    assert.ok(doctorModalSource.includes("doctor-privacy"));
    assert.ok(!doctorModalSource.includes("doctorPrivacyShort"));
    assert.ok(!i18nSource.includes("doctorPrivacyShort"));
    assert.ok(!doctorModalSource.includes("doctor-privacy-inline"));
    assert.ok(css.includes(".doctor-agent-detail"));
    assert.ok(css.includes(".doctor-connection-panel"));
    assert.ok(css.includes(".doctor-fix-button"));
    assert.ok(css.includes(".doctor-fix-confirm"));
    assert.ok(!css.includes(".doctor-privacy-inline"));
    assert.ok(css.includes(".doctor-repair-feedback"));
    assert.ok(css.includes(".doctor-repair-summary"));
    assert.ok(css.includes(".doctor-title-row"));
    assert.ok(css.includes(".doctor-check-row-compact"));
    assert.ok(css.includes(".doctor-local-server-main"));
    assert.ok(css.includes(".doctor-agent-toggle"));
    assert.ok(css.includes(".doctor-agent-chevron"));
    assert.ok(css.includes(".doctor-agent-collapsible.expanded"));
    assert.ok(css.includes(".doctor-agent-body"));
    assert.ok(css.includes(".doctor-agent-body-inner"));
    assert.ok(css.includes(".doctor-action-bar"));
    assert.ok(css.includes(".doctor-action-notice"));
    assert.ok(!css.includes(".doctor-action-notice::after"));
    assert.ok(css.includes(".doctor-action-notice-icon"));
    assert.ok(/@media \(prefers-color-scheme:\s*dark\)\s*\{[\s\S]*\.doctor-action-notice\.ok[\s\S]*color:\s*#8ce99a;[\s\S]*\.doctor-action-notice\.error[\s\S]*color:\s*#fca5a5;/.test(css));
    assert.ok(css.includes("@keyframes doctor-notice-in"));
    assert.ok(/\.doctor-modal\s*\{[\s\S]*width:\s*min\(728px,\s*100%\);[\s\S]*max-height:\s*calc\(100vh \/ var\(--duck-text-zoom, 1\) - 32px\);/.test(css));
    assert.ok(/\.doctor-modal\s*\{[\s\S]*gap:\s*8px;[\s\S]*padding:\s*14px;/.test(css));
    assert.ok(css.includes(".doctor-modal-entering"));
    assert.ok(css.includes("@keyframes doctor-modal-in"));
    assert.ok(css.includes(".doctor-last-checked"));
    assert.ok(/\.doctor-overall\s*\{[\s\S]*flex-wrap:\s*wrap;/.test(css));
    assert.ok(/\.doctor-check-list\s*\{[\s\S]*gap:\s*6px;/.test(css));
    assert.ok(/\.doctor-check-row\s*\{[\s\S]*padding:\s*8px 10px;/.test(css));
    assert.ok(/\.doctor-check-detail\s*\{[\s\S]*margin:\s*5px 0 0 17px;/.test(css));
    assert.ok(css.includes("--doctor-pass"));
    assert.ok(css.includes("--doctor-warning"));
    assert.ok(css.includes("--doctor-critical"));
    assert.ok(css.includes("--doctor-critical-rgb: 220, 38, 38;"));
    assert.ok(css.includes(".doctor-check-skeleton"));
    assert.ok(css.includes("@keyframes doctor-skeleton-sheen"));
    assert.ok(css.includes(".doctor-connection-panel.testing"));
    assert.ok(css.includes(".doctor-connection-progress"));
    assert.ok(/\.doctor-action-bar\s*\{[\s\S]*align-items:\s*center;/.test(css));
    assert.ok(/\.doctor-action-notice-slot\s*\{[\s\S]*min-height:\s*24px;/.test(css));
    assert.ok(/\.doctor-check-row\.pass\s*\{[\s\S]*border-left-color:\s*rgba\(var\(--doctor-pass-rgb\),\s*0\.72\);/.test(css));
    assert.ok(/\.doctor-check-row\.warning\s*\{[\s\S]*border-left-color:\s*rgba\(var\(--doctor-warning-rgb\),\s*0\.78\);/.test(css));
    assert.ok(/\.doctor-check-row\.critical\s*\{[\s\S]*border-left-color:\s*rgba\(var\(--doctor-critical-rgb\),\s*0\.78\);/.test(css));
    assert.ok(/\.doctor-agent-toggle\s*\{[\s\S]*grid-template-columns:\s*auto auto auto minmax\(0,\s*1fr\) auto;/.test(css));
    assert.ok(/\.settings-disclosure-body\s*\{[\s\S]*grid-template-rows:\s*1fr;[\s\S]*var\(--settings-disclosure-duration\)/.test(css));
    assert.ok(/\.settings-disclosure\.collapsed\s*>\s*\.settings-disclosure-body\s*\{[\s\S]*grid-template-rows:\s*0fr;/.test(css));
    assert.ok(/\.doctor-agent-body\s*\{[\s\S]*transition-duration:\s*var\(--settings-disclosure-duration\),\s*var\(--settings-disclosure-shift-duration\);/.test(css));
    assert.ok(!css.includes("grid-template-rows 0.24s"));
    assert.ok(/\.doctor-check-row\s*\{[\s\S]*border-left-width:\s*3px;/.test(css));
    assert.ok(/\.doctor-check-status\s*\{[\s\S]*border-radius:\s*999px;/.test(css));
    assert.ok(/\.doctor-close:hover\s*\{[\s\S]*background:\s*rgba\(217,\s*119,\s*87,\s*0\.1\);[\s\S]*transform:\s*scale\(1\.04\);/.test(css));
    assert.ok(/\.doctor-close:focus-visible\s*\{[\s\S]*outline:\s*2px solid var\(--accent\);/.test(css));
    assert.ok(/\.doctor-agent-toggle:focus-visible\s*\{[\s\S]*outline:\s*2px solid var\(--accent\);/.test(css));
    assert.ok(/@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.doctor-modal-entering[\s\S]*animation:\s*none;/.test(css));
    assert.ok(/@media \(max-width:\s*720px\)\s*\{[\s\S]*\.doctor-action-bar\s*\{[\s\S]*flex-direction:\s*column;/.test(css));
    // Regression guard: agent list must not introduce its own scroll viewport.
    // The outer .doctor-check-list owns scrolling so users get a single scrollbar.
    // [^}]*? keeps the match scoped to this rule body so unrelated max-height
    // declarations elsewhere in settings.css don't trip the assertion.
    assert.ok(!/\.doctor-agent-list\s*\{[^}]*?max-height:/.test(css));
    assert.ok(!/\.doctor-agent-list\s*\{[^}]*?overflow-y:\s*auto/.test(css));
    assert.ok(/\.doctor-agent-item \+ \.doctor-agent-item\s*\{[\s\S]*border-top:\s*1px solid var\(--row-border\);/.test(css));
    assert.ok(preloadSource.includes('contextBridge.exposeInMainWorld("doctor"'));
    assert.ok(preloadSource.includes('ipcRenderer.invoke("doctor:run-checks")'));
    assert.ok(preloadSource.includes('ipcRenderer.invoke("doctor:get-report")'));
    assert.ok(preloadSource.includes('ipcRenderer.invoke("doctor:test-connection"'));
    assert.ok(preloadSource.includes('ipcRenderer.invoke("doctor:open-duck-log"'));
    assert.ok(mainSource.includes("registerDoctorIpc"));
    assert.ok(doctorIpcSource.includes('ipcMain.handle("doctor:run-checks"'));
    assert.ok(doctorIpcSource.includes('ipcMain.handle("doctor:get-report"'));
    assert.ok(doctorIpcSource.includes('ipcMain.handle("doctor:test-connection"'));
    assert.ok(doctorIpcSource.includes('ipcMain.handle("doctor:open-duck-log"'));
    assert.ok(doctorIpcSource.includes("createConnectionTestDeduper"));
    assert.ok(doctorIpcSource.includes("createDoctorRunChecksDeduper"));
    assert.ok(doctorIpcSource.includes("runDedupedDoctorChecks"));
    assert.ok(doctorIpcSource.includes("runDedupedDoctorConnectionTest"));
    assert.ok(doctorIpcSource.includes("normalizeDoctorConnectionTestPayload"));
    assert.ok(doctorIpcSource.includes("normalizeDoctorOpenLogPayload"));
    assert.ok(doctorIpcSource.includes("runConnectionTest"));
    assert.ok(doctorIpcSource.includes("openDuckLog"));
    assert.ok(doctorIpcSource.includes("formatDiagnosticReport"));
    assert.ok(doctorIpcSource.includes("getDoctorRedactionOptions"));
    assert.ok(doctorIpcSource.includes("redactDoctorResult(await runDedupedDoctorChecks(), getDoctorRedactionOptions(app))"));
    assert.ok(i18nSource.includes("doctorRunFailed"));
    assert.ok(i18nSource.includes("doctorFixApplied"));
    assert.ok(i18nSource.includes("doctorFixConfirmCodexDetail"));
    assert.ok(i18nSource.includes("doctorRestartConfirmDetail"));
    assert.ok(i18nSource.includes("doctorPrivacy"));
    assert.ok(i18nSource.includes("doctorLastCheckedAt"));
    assert.ok(i18nSource.includes("doctorAgentSummaryOk"));
    assert.ok(i18nSource.includes("doctorAgentSummaryAttention"));
    assert.ok(i18nSource.includes("doctorAgentSummaryNeedsAttention"));
    assert.ok(i18nSource.includes("doctorAgentSummarySkipped"));
    assert.ok(i18nSource.includes("doctorConnectionHttpVerified"));
    assert.ok(i18nSource.includes("doctorOpenLog"));
    assert.ok(i18nSource.includes('doctorOpenLogOpened: "Debug log opened"'));
    assert.ok(i18nSource.includes('doctorOpenLogOpened: "已打开调试日志"'));
    assert.ok(!i18nSource.includes('doctorOpenLogOpened: "Debug log opened."'));
    assert.ok(!i18nSource.includes('doctorOpenLogOpened: "已打开调试日志。"'));
  });

  it("keeps collapsible focus outlines aligned with the card's rounded corners", () => {
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    assert.match(
      css,
      /\.collapsible-group-header\s*\{[^}]*border-radius:\s*inherit;/,
      "the full-card disclosure trigger must inherit the card radius so its inset focus outline is not clipped into white corners",
    );
    assert.match(
      css,
      /\.collapsible-group-disclosure\s*\{[^}]*border-radius:\s*inherit;/,
      "a disclosure beside a header action must inherit the header radius for the same reason",
    );
    assert.match(
      css,
      /\.collapsible-group:not\(\.collapsed\)\s*>\s*\.collapsible-group-header\s*\{[^}]*border-bottom-left-radius:\s*0;[^}]*border-bottom-right-radius:\s*0;/,
      "an expanded trigger must keep square bottom corners where its body continues",
    );
  });

  it("unifies the size slider on the simple volume-style control (no floating bubble, no ticks)", () => {
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    const tabSource = fs.readFileSync(SETTINGS_TAB_GENERAL, "utf8");
    // Old floating-bubble/tick design must be fully gone.
    assert.ok(!/\.size-bubble/.test(css));
    assert.ok(!/\.size-ticks/.test(css));
    assert.ok(!/\.size-slider-wrap/.test(css));
    assert.ok(!/size-bubble/.test(tabSource));
    assert.ok(!/size-ticks/.test(tabSource));
    // The size row reuses the volume-style classes plus its preview-session
    // drag affordances.
    assert.ok(/volume-control size-control/.test(tabSource));
    assert.ok(/volume-slider size-slider/.test(tabSource));
    assert.ok(/\.size-control\.dragging \.volume-slider::-webkit-slider-thumb/.test(css));
    assert.ok(/\.size-control\.pending \.volume-slider\s*\{[\s\S]*cursor:\s*ew-resize;/.test(css));
  });

  it("compensates every viewport unit for the injected text zoom", () => {
    // vh/vw resolve against the UNZOOMED window (verified by probe: a 100vh
    // box renders S× the window height under the injected root zoom), so any
    // bare viewport unit overflows the window at scale > 1 — symptom:
    // settings pages that cannot scroll to the bottom. Every occurrence must
    // divide by --duck-text-zoom or use the zoom-aware 100% chain instead.
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    const dashboardHtml = fs.readFileSync(path.join(SRC_DIR, "dashboard.html"), "utf8");
    const mainSource = fs.readFileSync(MAIN_PROCESS, "utf8");
    const bare = css.match(/\d+(?:\.\d+)?v[hw]\b(?!\s*\/\s*var\(--duck-text-zoom)/g) || [];
    assert.deepStrictEqual(bare, [], "settings.css has uncompensated viewport units");
    assert.doesNotMatch(dashboardHtml, /\d+(?:\.\d+)?v[hw]\b/, "dashboard.html must not use viewport units");
    assert.match(mainSource, /height:calc\(100vh \/ \$\{resumeScale\}\)/);
  });

  it("keeps the text-scale slider in sync across display moves without fighting a live drag", () => {
    const tabSource = fs.readFileSync(SETTINGS_TAB_GENERAL, "utf8");
    const uiCoreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    // The committed percent is per-display and lives main-side; a window move
    // never produces a settings-changed broadcast, so the row must subscribe
    // to the context-changed poke from the settings-window runtime…
    assert.ok(/onTextScaleContextChanged\(\(\) => \{\s*if \(!previewLive\) syncFromContext\(\);/.test(tabSource),
      "text-scale row must re-pull context on display change, gated on previewLive");
    // …and must not repaint to the committed value mid-drag (the preview
    // itself triggers pokes via applyTextScaleNow).
    assert.ok(/previewLive = true;/.test(tabSource));
    // Preview exits clear the flag: manual pointer release, commit (change),
    // and rollback (blur).
    // (Lookbehind excludes the `let previewLive = false;` declaration.)
    assert.strictEqual((tabSource.match(/(?<!let )previewLive = false;/g) || []).length, 3);
    // Full re-renders must dispose the row (unsubscribe + roll back a
    // stranded transient preview) — see clearMountedControls.
    assert.ok(/unsubscribeContextChanged\(\);/.test(tabSource));
    assert.ok(/mountedControls\.textScale && typeof state\.mountedControls\.textScale\.dispose === "function"/.test(uiCoreSource),
      "clearMountedControls must dispose the text-scale control");
    assert.ok(/state\.mountedControls\.textScale = null;/.test(uiCoreSource));
    // Renderer-side rollback rides IPC and can't be trusted during window
    // teardown — main must clear the transient preview when settings closes,
    // or a mid-drag ⌘W pins the preview scale to the display until restart.
    const mainSource = fs.readFileSync(MAIN_PROCESS, "utf8");
    assert.ok(/onBeforeClosed: \(\) => \{[^}]*endTextScalePreview\(\);/.test(mainSource),
      "settings onBeforeClosed must end a live text-scale preview");
  });

  it("keeps text-scale pointer drags stable while the Settings page live-zooms", async () => {
    const previewCalls = [];
    const commandCalls = [];
    const harness = loadGeneralTabForTest({
      snapshot: makeGeneralSnapshot(),
      settingsAPI: {
        getTextScaleContext: () => Promise.resolve({ percent: 100 }),
        previewTextScale: (value) => {
          previewCalls.push(value);
          return Promise.resolve({ status: "ok" });
        },
        endTextScalePreview: () => Promise.resolve({ status: "ok" }),
        command: (action, payload) => {
          commandCalls.push({ action, payload });
          return Promise.resolve({ status: "ok" });
        },
      },
    });
    harness.renderContent();
    await Promise.resolve();

    const slider = harness.content.querySelector(".text-scale-slider");
    assert.ok(slider);
    let rect = { left: 100, width: 240, top: 0, height: 28, right: 340, bottom: 28 };
    slider.getBoundingClientRect = () => rect;

    slider.dispatchEvent({
      type: "pointerdown",
      pointerId: 1,
      button: 0,
      isPrimary: true,
      screenX: 160,
      clientX: 160,
      bubbles: false,
    });

    // Simulate the Settings page live-zooming wider after the first preview.
    // The manual pointer math must keep using the pointerdown geometry above:
    // screenX 145 is 95% on the original 240px track, but would be ~90% if the
    // now-wider track were used mid-drag.
    rect = { left: 100, width: 384, top: 0, height: 45, right: 484, bottom: 45 };
    slider.dispatchEvent({
      type: "pointermove",
      pointerId: 1,
      screenX: 145,
      clientX: 145,
      bubbles: false,
    });
    assert.strictEqual(slider.value, "95");
    assert.strictEqual(previewCalls.at(-1), 0.95);

    slider.dispatchEvent({
      type: "pointerup",
      pointerId: 1,
      screenX: 145,
      clientX: 145,
      bubbles: false,
    });
    await Promise.resolve();

    assert.strictEqual(commandCalls.at(-1).action, "setTextScaleForDisplay");
    assert.strictEqual(commandCalls.at(-1).payload.value, 0.95);
  });

  it("makes both percent readouts clickable reset buttons", () => {
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    const tabSource = fs.readFileSync(SETTINGS_TAB_GENERAL, "utf8");
    assert.ok(/\.text-scale-readout\s*\{[\s\S]*cursor:\s*pointer;/.test(css));
    // Size readout resets the pet to the prefs default (P:9 → 30 on the UI scale).
    assert.ok(/SIZE_UI_DEFAULT = 30/.test(tabSource));
    assert.ok(/controller\.change\(SIZE_UI_DEFAULT\)/.test(tabSource));
    assert.ok(/rowSizeResetTitle/.test(tabSource));
    // Text-size readout resets to 100% via the per-display command.
    assert.ok(/setTextScaleForDisplay/.test(tabSource));
    assert.ok(/textScaleResetTitle/.test(tabSource));
  });

  it("uses transform-based Settings switch motion with a calmer shared timing", () => {
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    const switchRule = css.match(/\.switch\s*\{([\s\S]*?)\n\}/);
    const knobRule = css.match(/\.switch::after\s*\{([\s\S]*?)\n\}/);
    const onKnobRule = css.match(/\.switch\.on::after\s*\{([\s\S]*?)\n\}/);
    assert.ok(switchRule, "settings.css should define the switch track");
    assert.ok(knobRule, "settings.css should define the switch knob");
    assert.ok(onKnobRule, "settings.css should define the on-state knob transform");
    assert.ok(/transition:\s*background 0\.26s ease,\s*box-shadow 0\.26s ease,\s*transform 0\.16s ease;/.test(switchRule[1]));
    assert.ok(/transform:\s*translateX\(0\)\s+scale\(1\);/.test(knobRule[1]));
    assert.ok(!/transition:\s*left\b/.test(knobRule[1]));
    assert.ok(/transition:\s*transform 0\.28s cubic-bezier\(0\.2,\s*0\.8,\s*0\.2,\s*1\),\s*box-shadow 0\.2s ease;/.test(knobRule[1]));
    assert.ok(/transform:\s*translateX\(16px\)\s+scale\(1\);/.test(onKnobRule[1]));
    assert.ok(!css.includes(".switch.on::after { left: 18px; }"));
    assert.ok(/\.switch:not\(\.disabled\):active::after\s*\{[\s\S]*transform:\s*translateX\(var\(--switch-knob-x,\s*0\)\)\s+scale\(0\.94\);/.test(css));
    assert.ok(/@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.switch,[\s\S]*\.switch::after\s*\{[\s\S]*transition:\s*none;/.test(css));
  });

  it("renders the Settings language picker as a dropdown over all supported langs", () => {
    const generalSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-general.js"), "utf8");
    const coreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    const pickerSource = fs.readFileSync(LANGUAGE_PICKER_JS, "utf8");
    const pickerCss = fs.readFileSync(LANGUAGE_PICKER_CSS, "utf8");
    const settingsHtml = fs.readFileSync(SETTINGS_HTML, "utf8");
    const settingsCss = fs.readFileSync(SETTINGS_CSS, "utf8");

    assert.ok(new RegExp(
      String.raw`const LANGUAGE_OPTIONS = \[` +
      SUPPORTED_LANGS.map((lang) => String.raw`"${lang}"`).join(String.raw`,\s*`) +
      String.raw`\];`
    ).test(generalSource));
    assert.ok(generalSource.includes("helpers.buildSettingsSelect"));
    assert.ok(generalSource.includes('className: "settings-language-select"'));
    assert.ok(!generalSource.includes("createLanguagePicker"));
    assert.ok(pickerSource.includes("picker.className = `language-picker"));
    assert.ok(pickerSource.includes(`role", "combobox"`));
    assert.ok(pickerSource.includes(`aria-haspopup", "listbox"`));
    assert.ok(pickerSource.includes(`aria-controls", menu.id`));
    assert.ok(pickerSource.includes(`role", "listbox"`));
    assert.ok(pickerSource.includes(`aria-hidden", "true"`));
    assert.ok(pickerSource.includes(`role", "option"`));
    assert.ok(settingsHtml.includes(`href="language-picker.css"`));
    assert.ok(settingsHtml.includes(`src="language-picker.js"`));
    assert.match(settingsHtml, /<main class="content" id="content" data-language-picker-boundary><\/main>/);
    assert.match(settingsCss, /\.content\s*\{[^}]*overflow-y:\s*auto;[^}]*scrollbar-gutter:\s*stable;/);
    assert.match(settingsCss, /\.settings-language-select\s*\{[^}]*min-width:\s*128px;[^}]*width:\s*128px;/);
    assert.ok(!generalSource.includes("language-segmented"));
    assert.ok(!generalSource.includes("runtime.languageTransition"));
    assert.ok(!generalSource.includes("--language-active-index"));
    assert.ok(!coreSource.includes("languageTransition"));
    assert.ok(/\.language-picker-menu\s*\{[\s\S]*box-shadow:/.test(pickerCss));
    assert.ok(/\.language-picker-menu\s*\{[\s\S]*display:\s*none;/.test(pickerCss));
    assert.ok(/\.language-picker\.menu-mounted \.language-picker-menu\s*\{[\s\S]*display:\s*block;/.test(pickerCss));
    assert.ok(/\.language-picker-option:hover\s*\{[\s\S]*background:/.test(pickerCss));
    assert.ok(/\.language-picker-option:focus-visible\s*\{[\s\S]*outline:\s*2px solid var\(--text-primary,\s*var\(--text\)\);[\s\S]*outline-offset:\s*-2px;[\s\S]*background:/.test(pickerCss));
    assert.ok(/\.language-picker-option\.selected\s*\{[\s\S]*color:\s*var\(--accent\);/.test(pickerCss));
    assert.ok(/@media \(prefers-color-scheme:\s*dark\)\s*\{[\s\S]*\.language-picker-menu/.test(pickerCss));
    assert.ok(/@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.language-picker-trigger,[\s\S]*\.language-picker-chevron,[\s\S]*\.language-picker-menu[\s\S]*transition:\s*none;/.test(pickerCss));
    assert.ok(/@media \(forced-colors:\s*active\)\s*\{[\s\S]*\.language-picker-trigger:focus-visible,[\s\S]*\.language-picker-option:focus-visible\s*\{[\s\S]*outline-color:\s*Highlight;/.test(pickerCss));
    assert.ok(!pickerCss.includes(".language-segmented"));
  });

  it("lets a mounted language picker finish closing outside clipped settings cards", () => {
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    const sectionRowsRule = css.match(/\.section-rows\s*\{([^}]*)\}/);
    const mountedSectionRule = css.match(/\.section:has\(\.language-picker\.menu-mounted\)\s*\{([^}]*)\}/);
    const mountedRowsRule = css.match(/\.section-rows:has\(\.language-picker\.menu-mounted\)\s*\{([^}]*)\}/);
    const mountedCollapsibleRule = css.match(/\.collapsible-group:not\(\.collapsed\):has\(\.language-picker\.menu-mounted\)\s*>\s*\.collapsible-group-body,\s*\.collapsible-group:not\(\.collapsed\):has\(\.language-picker\.menu-mounted\)\s*>\s*\.collapsible-group-body\s*>\s*\.collapsible-group-body-inner\s*\{([^}]*)\}/);

    assert.ok(sectionRowsRule, "settings cards should retain their base clipping rule");
    assert.match(sectionRowsRule[1], /overflow:\s*hidden;/);
    assert.ok(mountedSectionRule, "the section should stay raised through the close animation");
    assert.match(mountedSectionRule[1], /position:\s*relative;/);
    assert.match(mountedSectionRule[1], /z-index:\s*1;/);
    assert.ok(mountedRowsRule, "a mounted picker should escape the settings card");
    assert.match(mountedRowsRule[1], /overflow:\s*visible;/);
    assert.ok(mountedCollapsibleRule, "collapsible content should not clip a mounted picker");
    assert.match(mountedCollapsibleRule[1], /overflow:\s*visible;/);
  });

  it("populates the language picker with current selection and propagates click changes", () => {
    const harness = loadGeneralLanguageRowForTest({
      snapshot: { lang: "en" },
    });

    harness.core.ops.requestRender({ content: true });
    assert.strictEqual(harness.getContentRenderCount(), 1);
    const picker = harness.getLangPicker();
    const trigger = harness.getLangTrigger();
    assert.ok(picker, "language picker should be rendered");
    assert.ok(trigger, "language picker trigger should be rendered");
    assert.strictEqual(picker.classList.contains("settings-select"), true);
    assert.strictEqual(picker.classList.contains("settings-language-select"), true);
    assert.strictEqual(harness.core.state.mountedControls.settingsSelects.size, 1);
    assert.strictEqual(harness.getLangValue().textContent, "English");
    assert.strictEqual(trigger.attributes["aria-label"], "Language: English");
    assert.strictEqual(harness.getLangMenu().attributes["aria-hidden"], "true");
    const options = harness.getLangOptions();
    assert.strictEqual(options.length, SUPPORTED_LANGS.length);
    for (let i = 0; i < SUPPORTED_LANGS.length; i++) {
      assert.strictEqual(options[i].dataset.lang, SUPPORTED_LANGS[i]);
      assert.strictEqual(options[i].tabIndex, -1);
    }
    assert.strictEqual(options[0].attributes["aria-selected"], "true");

    trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(picker.classList.contains("open"), true);
    assert.strictEqual(harness.getLangMenu().attributes["aria-hidden"], "false");
    assert.strictEqual(options[0].tabIndex, 0);
    options[1].dispatchEvent({ type: "click" });

    assert.deepStrictEqual(
      harness.updateCalls,
      [{ key: "lang", value: "zh" }],
      "clicking a language option should call settingsAPI.update with the new lang"
    );
    assert.strictEqual(picker.classList.contains("open"), false);
    assert.strictEqual(trigger.focused, true);
    assert.strictEqual(harness.getLangMenu().attributes["aria-hidden"], "true");
    for (const option of options) assert.strictEqual(option.tabIndex, -1);
    assert.strictEqual(harness.getLangValue().textContent, "Chinese");
    assert.strictEqual(trigger.attributes["aria-label"], "Language: Chinese");
    assert.strictEqual(trigger.getAttribute("aria-disabled"), "true");
    trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(picker.classList.contains("open"), false);
    options[0].dispatchEvent({ type: "click" });
    assert.deepStrictEqual(
      harness.updateCalls,
      [{ key: "lang", value: "zh" }],
      "the shared Settings picker should block further changes while saving"
    );
    assert.strictEqual(harness.getLangValue().textContent, "Chinese");
    assert.strictEqual(trigger.attributes["aria-label"], "Language: Chinese");
    assert.strictEqual(options[1].attributes["aria-selected"], "true");

    harness.core.ops.applyChanges({
      changes: { lang: "zh" },
      snapshot: { lang: "zh" },
    });
    assert.strictEqual(harness.getContentRenderCount(), 2);
    assert.strictEqual(harness.getLangValue().textContent, "Chinese");
    assert.strictEqual(harness.getLangTrigger().attributes["aria-label"], "Language: Chinese");
    assert.strictEqual(harness.getLangOptions()[1].attributes["aria-selected"], "true");
  });

  it("supports keyboard language selection and reverts when saving fails", async () => {
    const harness = loadGeneralLanguageRowForTest({
      snapshot: { lang: "en" },
      update: () => Promise.resolve({ status: "error", message: "synthetic failure" }),
    });

    harness.core.ops.requestRender({ content: true });
    const trigger = harness.getLangTrigger();
    trigger.dispatchEvent(createKeyboardEventForTest("ArrowDown"));
    assert.strictEqual(harness.getLangPicker().classList.contains("open"), true);
    const options = harness.getLangOptions();
    options[1].dispatchEvent(createKeyboardEventForTest("Enter"));
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepStrictEqual(harness.updateCalls, [{ key: "lang", value: "zh" }]);
    assert.strictEqual(harness.getLangValue().textContent, "English");
    assert.strictEqual(trigger.focused, true);
    assert.strictEqual(harness.getToastText(), "Failed: synthetic failure");
  });

  it("supports Home/End navigation and locks disabled or pending Settings pickers", () => {
    const harness = loadGeneralLanguageRowForTest({ snapshot: { lang: "en" } });
    harness.core.ops.requestRender({ content: true });
    const trigger = harness.getLangTrigger();
    const options = harness.getLangOptions();
    trigger.dispatchEvent(createKeyboardEventForTest("ArrowDown"));
    for (const option of options) option.focused = false;
    trigger.dispatchEvent(createKeyboardEventForTest("End"));
    assert.equal(options[options.length - 1].focused, true);
    for (const option of options) option.focused = false;
    trigger.dispatchEvent(createKeyboardEventForTest("Home"));
    assert.equal(options[0].focused, true);
    assert.equal(trigger.getAttribute("role"), "combobox");
    assert.equal(trigger.getAttribute("aria-controls"), harness.getLangMenu().id);

    const locked = harness.core.helpers.buildSettingsSelect({
      value: "a",
      options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
      lockWhilePending: true,
    });
    harness.content.appendChild(locked.element);
    const lockedTrigger = locked.element.querySelector(".language-picker-trigger");
    locked.setDisabled(true);
    lockedTrigger.dispatchEvent({ type: "click" });
    assert.equal(locked.element.classList.contains("open"), false);
    assert.equal(lockedTrigger.disabled, true);
    locked.setDisabled(false);
    locked.setPending(true);
    lockedTrigger.dispatchEvent({ type: "click" });
    assert.equal(locked.element.classList.contains("open"), false);
    assert.equal(lockedTrigger.disabled, false);
    assert.equal(lockedTrigger.getAttribute("aria-disabled"), "true");
    assert.equal(lockedTrigger.getAttribute("aria-busy"), "true");
  });

  it("restores a Settings picker trigger only when async saving leaves focus on the page", async () => {
    const save = createDeferred();
    const harness = loadSharedLanguagePickerForTest({
      onChange: () => save.promise,
      lockWhilePending: true,
    });
    harness.trigger.dispatchEvent({ type: "click" });
    harness.optionElements[1].dispatchEvent({ type: "click" });
    assert.equal(harness.trigger.disabled, false);
    assert.equal(harness.trigger.getAttribute("aria-disabled"), "true");
    assert.equal(harness.picker.classList.contains("pending"), true);

    // Native Chromium moves focus to BODY when a focused button becomes
    // disabled. The fake DOM has no native focus manager, so model that step.
    harness.trigger.focused = false;
    harness.setActiveElement(harness.body);
    save.resolve(true);
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(harness.getActiveElement(), harness.trigger);
    assert.equal(harness.trigger.focused, true);
    assert.equal(harness.picker.classList.contains("pending"), false);
  });

  it("builds accessible segmented radios with keyboard navigation and rollback", async () => {
    const body = new FakeElement("body");
    const document = {
      body,
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: () => null,
    };
    let acceptChanges = true;
    const changes = [];
    const core = loadSettingsCoreForTest({}, { document });
    const control = core.helpers.buildSegmentedRadio({
      value: "off",
      ariaLabel: "Completion output",
      options: [
        { value: "off", label: "Without answer", description: "Keep the base notification." },
        { value: "full", label: "Full answer", description: "May contain sensitive data." },
      ],
      onChange: (value) => {
        changes.push(value);
        return Promise.resolve(acceptChanges);
      },
    });
    body.appendChild(control.element);

    const buttons = control.element.querySelectorAll("button");
    assert.equal(control.element.getAttribute("role"), "radiogroup");
    assert.equal(control.element.getAttribute("aria-label"), "Completion output");
    assert.equal(buttons[0].getAttribute("role"), "radio");
    assert.equal(buttons[0].getAttribute("aria-checked"), "true");
    assert.equal(buttons[0].tabIndex, 0);
    assert.equal(buttons[1].tabIndex, -1);
    assert.equal(control.element.querySelectorAll(".settings-segmented-radio-description").length, 2);

    buttons[0].dispatchEvent(createKeyboardEventForTest("ArrowRight"));
    await Promise.resolve();
    await Promise.resolve();
    assert.deepStrictEqual(changes, ["full"]);
    assert.equal(buttons[1].focused, true);
    assert.equal(buttons[1].getAttribute("aria-checked"), "true");

    control.setValue("off");
    acceptChanges = false;
    buttons[0].dispatchEvent(createKeyboardEventForTest("End"));
    assert.equal(control.element.getAttribute("aria-busy"), "true");
    assert.equal(buttons[0].disabled, true);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(buttons[0].getAttribute("aria-checked"), "true");
    assert.equal(buttons[1].getAttribute("aria-checked"), "false");

    core.ops.clearMountedControls();
    assert.equal(buttons[0].eventListeners.click.length, 0);
    assert.equal(buttons[0].eventListeners.keydown.length, 0);
  });

  it("restores segmented-control focus after a warning dialog closes", async () => {
    const body = new FakeElement("body");
    const modalRoot = new FakeElement("div");
    modalRoot.id = "modalRoot";
    body.appendChild(modalRoot);
    const listeners = new Map();
    const document = {
      body,
      activeElement: body,
      createElement(tagName) {
        const element = new FakeElement(tagName);
        element.focus = () => {
          if (element.disabled) return;
          element.focused = true;
          document.activeElement = element;
        };
        return element;
      },
      createElementNS(_namespace, tagName) {
        return this.createElement(tagName);
      },
      getElementById: (id) => (id === "modalRoot" ? modalRoot : null),
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type) { listeners.delete(type); },
    };
    const core = loadSettingsCoreForTest({}, { document });
    const control = core.helpers.buildSegmentedRadio({
      value: "off",
      options: [{ value: "off", label: "Off" }, { value: "auto", label: "Auto" }],
      onChange: () => core.helpers.showSettingsConfirmModal({
        title: "Enable automation?",
        detail: "Review the risk first.",
        actions: [
          { id: "cancel", label: "Cancel", defaultFocus: true },
          { id: "confirm", label: "Enable", tone: "danger" },
        ],
      }).then((actionId) => actionId === "confirm"),
    });
    body.appendChild(control.element);
    const source = control.element.querySelectorAll("button")[1];
    source.focus();
    source.dispatchEvent({ type: "click" });

    assert.equal(source.disabled, true);
    assert.notStrictEqual(document.activeElement, source);
    listeners.get("keydown")({ key: "Escape", preventDefault() {} });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(source.disabled, false);
    assert.strictEqual(document.activeElement, source);
    assert.equal(source.getAttribute("aria-checked"), "false");
  });

  it("prefers an exact Settings focus key and falls back when that control disappears", () => {
    const body = new FakeElement("body");
    const content = new FakeElement("main");
    content.id = "content";
    body.appendChild(content);
    const document = {
      body,
      activeElement: body,
      createElement(tagName) {
        const element = new FakeElement(tagName);
        element.focus = () => {
          element.focused = true;
          document.activeElement = element;
        };
        return element;
      },
      getElementById: (id) => (id === "content" ? content : null),
    };
    const core = loadSettingsCoreForTest({}, { document });
    let showRetry = true;
    let period = null;
    let retry = null;
    const render = () => {
      content.innerHTML = "";
      period = document.createElement("button");
      period.setAttribute("data-settings-focus-key", "agents-codex-row");
      content.appendChild(period);
      retry = null;
      if (showRetry) {
        retry = document.createElement("button");
        retry.setAttribute("data-settings-focus-key", "agents-codex-retry");
        retry.setAttribute("data-settings-focus-fallback-key", "agents-codex-row");
        content.appendChild(retry);
      }
    };
    core.ops.installRenderHooks({ content: render });
    render();
    retry.focus();

    core.ops.requestRender({ content: true });
    assert.strictEqual(document.activeElement, retry);

    showRetry = false;
    core.ops.requestRender({ content: true });
    assert.strictEqual(document.activeElement, period);
    assert.equal(period.focused, true);
  });

  it("falls back when the exact Settings focus target becomes disabled", () => {
    const body = new FakeElement("body");
    const content = new FakeElement("main");
    content.id = "content";
    body.appendChild(content);
    const document = {
      body,
      activeElement: body,
      createElement(tagName) {
        const element = new FakeElement(tagName);
        element.focus = () => {
          element.focused = true;
          document.activeElement = element;
        };
        return element;
      },
      getElementById: (id) => (id === "content" ? content : null),
    };
    const core = loadSettingsCoreForTest({}, { document });
    let disableExact = false;
    let fallback = null;
    let exact = null;
    const render = () => {
      content.innerHTML = "";
      fallback = document.createElement("button");
      fallback.setAttribute("data-settings-focus-key", "agents-codex-toggle");
      content.appendChild(fallback);
      exact = document.createElement("button");
      exact.setAttribute("data-settings-focus-key", "agents-codex-clear");
      exact.setAttribute("data-settings-focus-fallback-key", "agents-codex-toggle");
      exact.disabled = disableExact;
      content.appendChild(exact);
    };
    core.ops.installRenderHooks({ content: render });
    render();
    exact.focus();

    disableExact = true;
    core.ops.requestRender({ content: true });

    assert.equal(exact.disabled, true);
    assert.strictEqual(document.activeElement, fallback);
    assert.equal(fallback.focused, true);
  });

  it("does not steal focus acquired by another live control during a Settings render", () => {
    const body = new FakeElement("body");
    const content = new FakeElement("main");
    content.id = "content";
    body.appendChild(content);
    const document = {
      body,
      activeElement: body,
      createElement(tagName) {
        const element = new FakeElement(tagName);
        element.focus = () => {
          element.focused = true;
          document.activeElement = element;
        };
        return element;
      },
      getElementById: (id) => (id === "content" ? content : null),
    };
    const core = loadSettingsCoreForTest({}, { document });
    const original = document.createElement("button");
    original.setAttribute("data-settings-focus-key", "agents-codex-clear");
    content.appendChild(original);
    original.focus();

    let replacement = null;
    let newlyFocused = null;
    core.ops.installRenderHooks({
      content() {
        content.innerHTML = "";
        replacement = document.createElement("button");
        replacement.setAttribute("data-settings-focus-key", "agents-codex-clear");
        content.appendChild(replacement);
        newlyFocused = document.createElement("button");
        content.appendChild(newlyFocused);
        newlyFocused.focus();
      },
    });

    core.ops.requestRender({ content: true });

    assert.strictEqual(document.activeElement, newlyFocused);
    assert.equal(newlyFocused.focused, true);
    assert.equal(replacement.focused, false);
  });

  it("restores content scroll after a live full render temporarily clamps it", () => {
    let rawScrollTop = 740;
    let maxScrollTop = 2000;
    const raf = createQueuedRaf();
    const body = new FakeElement("body");
    const content = new FakeElement("main");
    content.id = "content";
    Object.defineProperty(content, "scrollTop", {
      configurable: true,
      get: () => Math.min(rawScrollTop, maxScrollTop),
      set: (value) => {
        rawScrollTop = Math.max(0, Math.min(Number(value) || 0, maxScrollTop));
      },
    });
    body.appendChild(content);
    const document = {
      body,
      activeElement: body,
      getElementById: (id) => (id === "content" ? content : null),
    };
    const core = loadSettingsCoreForTest({}, {
      document,
      requestAnimationFrame: raf.requestAnimationFrame,
    });
    core.state.activeTab = "agents";
    core.tabs.agents = {};
    core.ops.installRenderHooks({
      content() {
        maxScrollTop = 0;
        content.scrollTop = content.scrollTop;
        maxScrollTop = 2000;
      },
    });

    core.ops.requestRender({ content: true, preserveScroll: true });
    assert.equal(content.scrollTop, 740);

    content.scrollTop = 0;
    raf.flush();
    assert.equal(content.scrollTop, 740);
  });

  it("builds Settings buttons from one tone, size, and pending-state contract", () => {
    const document = {
      body: new FakeElement("body"),
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: () => null,
    };
    const core = loadSettingsCoreForTest({}, { document });
    const button = core.helpers.buildButton({
      label: "Delete",
      tone: "danger",
      size: "compact",
      pending: true,
      ariaLabel: "Delete profile",
    });

    assert.equal(button.textContent, "Delete");
    assert.equal(button.type, "button");
    assert.equal(button.classList.contains("settings-button"), true);
    assert.equal(button.classList.contains("settings-button-compact"), true);
    assert.equal(button.classList.contains("danger"), true);
    assert.equal(button.classList.contains("pending"), true);
    assert.equal(button.disabled, true);
    assert.equal(button.getAttribute("aria-busy"), "true");
    assert.equal(button.getAttribute("aria-label"), "Delete profile");
  });

  it("uses the shared Settings dialog shell with ARIA links and focus restoration", async () => {
    const body = new FakeElement("body");
    const modalRoot = new FakeElement("div");
    const launchButton = new FakeElement("button");
    body.append(launchButton, modalRoot);
    const listeners = new Map();
    const document = {
      body,
      activeElement: launchButton,
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: (id) => (id === "modalRoot" ? modalRoot : null),
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type) { listeners.delete(type); },
    };
    const core = loadSettingsCoreForTest({}, { document });
    const resultPromise = core.helpers.showSettingsConfirmModal({
      title: "Remove profile?",
      detail: "This cannot be undone.",
      iconText: "this override must be ignored",
      actions: [
        { id: "cancel", label: "Cancel", tone: "neutral", defaultFocus: true },
        { id: "remove", label: "Remove", tone: "danger" },
      ],
    });

    const dialog = modalRoot.querySelector(".settings-dialog");
    assert.ok(dialog);
    assert.equal(dialog.getAttribute("role"), "dialog");
    assert.equal(dialog.getAttribute("aria-modal"), "true");
    assert.match(dialog.getAttribute("aria-labelledby"), /^settings-dialog-\d+-title$/);
    assert.match(dialog.getAttribute("aria-describedby"), /^settings-dialog-\d+-detail$/);
    const icon = dialog.querySelector(".settings-confirm-icon");
    assert.ok(icon);
    assert.equal(icon.textContent, "");
    assert.equal(icon.children[0].tagName, "SVG");
    assert.equal(icon.children[0].getAttribute("viewBox"), "0 0 20 20");
    assert.equal(icon.children[0].children[0].getAttribute("d"), "M10 4.2v7.4m0 3.1v.1");
    assert.equal(listeners.has("keydown"), true);
    dialog.querySelectorAll("button")[1].dispatchEvent({ type: "click" });

    assert.equal(await resultPromise, "remove");
    assert.equal(modalRoot.children.length, 0);
    assert.equal(launchButton.focused, true);
    assert.equal(listeners.has("keydown"), false);
  });

  it("does not restore dialog focus to a launch element removed during a Settings rerender", async () => {
    const body = new FakeElement("body");
    const modalRoot = new FakeElement("div");
    const launchButton = new FakeElement("button");
    body.append(launchButton, modalRoot);
    const document = {
      body,
      activeElement: launchButton,
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: (id) => (id === "modalRoot" ? modalRoot : null),
      addEventListener() {},
      removeEventListener() {},
    };
    const core = loadSettingsCoreForTest({}, { document });
    const resultPromise = core.helpers.showSettingsConfirmModal({
      title: "Remove profile?",
      detail: "This cannot be undone.",
      actions: [{ id: "cancel", label: "Cancel", tone: "neutral" }],
    });

    launchButton.remove();
    modalRoot.querySelector("button").dispatchEvent({ type: "click" });

    assert.equal(await resultPromise, "cancel");
    assert.equal(launchButton.isConnected, false);
    assert.equal(launchButton.focused, false);
  });

  it("keeps warning acknowledgements in a wide-hitbox row with the safe action first", async () => {
    const body = new FakeElement("body");
    const modalRoot = new FakeElement("div");
    const launchButton = new FakeElement("button");
    body.append(launchButton, modalRoot);
    const document = {
      body,
      activeElement: launchButton,
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: (id) => (id === "modalRoot" ? modalRoot : null),
      addEventListener() {},
      removeEventListener() {},
    };
    const core = loadSettingsCoreForTest({}, { document });
    const resultPromise = core.helpers.showSettingsDialog({
      title: "Auto-approve tools?",
      detail: "Supported tool requests will be approved automatically.",
      checkboxLabel: "I understand the risks. Don’t remind me when enabling this again.",
      returnDetails: true,
      actions: [
        { id: "cancel", label: "Cancel", tone: "neutral", defaultFocus: true },
        { id: "enable", label: "Auto-approve tools", tone: "danger" },
      ],
    });

    const dialog = modalRoot.querySelector(".settings-dialog");
    const checkboxRow = dialog.querySelector(".settings-confirm-checkbox");
    const checkbox = checkboxRow.querySelector("input");
    const buttons = dialog.querySelectorAll("button");
    assert.ok(checkboxRow, "the full acknowledgement row should be a label hit target");
    assert.equal(checkbox.type, "checkbox");
    assert.equal(checkbox.checked, false);
    assert.equal(buttons[0].textContent, "Cancel");
    assert.equal(buttons[0].focused, true, "the safe action keeps default focus");
    assert.equal(buttons[1].textContent, "Auto-approve tools");
    assert.equal(buttons[1].classList.contains("settings-confirm-danger"), true);

    checkbox.checked = true;
    buttons[1].dispatchEvent({ type: "click" });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await resultPromise)), {
      actionId: "enable",
      checkboxChecked: true,
    });
  });

  it("rolls concurrent failed language saves back to the last committed value", async () => {
    const saves = [];
    const changes = [];
    const harness = loadSharedLanguagePickerForTest({
      onChange: (next, previous) => {
        const deferred = createDeferred();
        saves.push(deferred);
        changes.push({ next, previous });
        return deferred.promise;
      },
    });

    harness.trigger.dispatchEvent({ type: "click" });
    harness.optionElements[1].dispatchEvent({ type: "click" });
    harness.trigger.dispatchEvent({ type: "click" });
    harness.optionElements[2].dispatchEvent({ type: "click" });
    assert.strictEqual(harness.valueElement.textContent, "JA");
    assert.deepStrictEqual(changes, [
      { next: "zh", previous: "en" },
      { next: "ja", previous: "en" },
    ]);

    saves[0].resolve(false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(harness.valueElement.textContent, "JA", "stale failure keeps the latest optimistic value");

    saves[1].resolve(false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(harness.valueElement.textContent, "EN", "latest failure restores the committed value");
  });

  it("advances the rollback baseline after a concurrent language save succeeds", async () => {
    const saves = [];
    const harness = loadSharedLanguagePickerForTest({
      onChange: () => {
        const deferred = createDeferred();
        saves.push(deferred);
        return deferred.promise;
      },
    });

    harness.trigger.dispatchEvent({ type: "click" });
    harness.optionElements[1].dispatchEvent({ type: "click" });
    harness.trigger.dispatchEvent({ type: "click" });
    harness.optionElements[2].dispatchEvent({ type: "click" });

    saves[0].resolve(true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(harness.valueElement.textContent, "JA", "newer optimistic choice remains visible");

    saves[1].resolve(false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(harness.valueElement.textContent, "ZH", "failed latest choice restores the successful save");
  });

  it("flips and bounds the language picker at minimum-size enlarged-text geometry", () => {
    const harness = loadSharedLanguagePickerForTest({
      options: ["en", "zh", "zh-TW", "ko", "ja"],
      innerHeight: 450,
    });
    harness.boundary.getBoundingClientRect = () => ({ top: 52, bottom: 400 });
    harness.trigger.getBoundingClientRect = () => ({ top: 220, bottom: 274 });
    Object.defineProperty(harness.menu, "scrollHeight", { value: 240 });
    Object.defineProperty(harness.menu, "offsetHeight", { value: 242 });
    Object.defineProperty(harness.menu, "clientHeight", { value: 240 });

    harness.trigger.dispatchEvent({ type: "click" });

    assert.strictEqual(harness.picker.classList.contains("open-up"), true);
    assert.strictEqual(harness.picker.classList.contains("menu-scrollable"), true);
    assert.strictEqual(harness.menu.style.maxHeight, "162px");
    assert.ok(parseInt(harness.menu.style.maxHeight, 10) < harness.menu.scrollHeight);
    const css = fs.readFileSync(LANGUAGE_PICKER_CSS, "utf8");
    assert.match(css, /\.language-picker\.menu-scrollable \.language-picker-menu\s*\{[\s\S]*overflow-y:\s*auto;/);
    assert.match(css, /\.language-picker\.open-up \.language-picker-menu\s*\{[\s\S]*bottom:\s*calc\(100% \+ 6px\);/);
  });

  it("opens downward for the captured three-line default-window geometry", () => {
    const harness = loadSharedLanguagePickerForTest({
      options: SUPPORTED_LANGS,
      innerHeight: 668,
    });
    // Captured from real macOS Electron layout; this guards picker placement, not CSS layout.
    harness.boundary.getBoundingClientRect = () => ({ top: 47, bottom: 603 });
    harness.trigger.getBoundingClientRect = () => ({ top: 325, bottom: 361 });
    Object.defineProperty(harness.menu, "scrollHeight", { value: 220 });
    Object.defineProperty(harness.menu, "offsetHeight", { value: 222 });
    Object.defineProperty(harness.menu, "clientHeight", { value: 220 });

    harness.trigger.dispatchEvent({ type: "click" });

    assert.strictEqual(harness.picker.classList.contains("open-up"), false);
    assert.strictEqual(harness.picker.classList.contains("menu-scrollable"), false);
    assert.strictEqual(harness.menu.style.maxHeight, "222px");
  });

  it("keeps the shared picker downward branch covered when six options fit below", () => {
    const harness = loadSharedLanguagePickerForTest({
      options: SUPPORTED_LANGS.slice(0, 6),
      innerHeight: 700,
    });
    harness.boundary.getBoundingClientRect = () => ({ top: 78, bottom: 635 });
    harness.trigger.getBoundingClientRect = () => ({ top: 390, bottom: 426 });
    Object.defineProperty(harness.menu, "scrollHeight", { value: 190 });
    Object.defineProperty(harness.menu, "offsetHeight", { value: 192 });
    Object.defineProperty(harness.menu, "clientHeight", { value: 190 });

    harness.trigger.dispatchEvent({ type: "click" });

    assert.strictEqual(harness.picker.classList.contains("open-up"), false);
    assert.strictEqual(harness.picker.classList.contains("menu-scrollable"), false);
    assert.strictEqual(harness.menu.style.maxHeight, "192px");
  });

  it("initially reveals and bounds the language picker at 150% and 160% text scale", () => {
    const layouts = [
      { scale: "150%", boundaryBottom: 313.7, triggerTop: 317.1, triggerBottom: 353.1 },
      { scale: "160%", boundaryBottom: 290.3, triggerTop: 316.6, triggerBottom: 352.6 },
    ];

    for (const layout of layouts) {
      const harness = loadSharedLanguagePickerForTest({
        options: ["en", "zh", "zh-TW", "ko", "ja"],
        innerHeight: 400,
      });
      harness.boundary.getBoundingClientRect = () => ({ top: 52, bottom: layout.boundaryBottom });
      harness.trigger.getBoundingClientRect = () => ({
        top: layout.triggerTop - harness.boundary.scrollTop,
        bottom: layout.triggerBottom - harness.boundary.scrollTop,
      });
      Object.defineProperty(harness.menu, "scrollHeight", { value: 160 });
      Object.defineProperty(harness.menu, "offsetHeight", { value: 162 });
      Object.defineProperty(harness.menu, "clientHeight", { value: 160 });

      assert.ok(
        harness.trigger.getBoundingClientRect().top > layout.boundaryBottom,
        `${layout.scale}: regression setup must start with the trigger behind the footer`,
      );

      harness.control.ensureVisible();
      const visibleTrigger = harness.trigger.getBoundingClientRect();
      assert.ok(visibleTrigger.top >= 52, `${layout.scale}: trigger top stays inside the body`);
      assert.ok(
        visibleTrigger.bottom <= layout.boundaryBottom,
        `${layout.scale}: trigger bottom stays inside the body`,
      );

      harness.trigger.dispatchEvent({ type: "click" });
      assert.strictEqual(
        harness.picker.classList.contains("open-up"),
        true,
        `${layout.scale}: menu flips upward`,
      );
      const menuBottom = visibleTrigger.top - 6;
      const menuTop = menuBottom - parseInt(harness.menu.style.maxHeight, 10);
      const firstOption = { top: menuTop + 6, bottom: menuTop + 36 };
      const lastOption = { top: menuBottom - 36, bottom: menuBottom - 6 };
      assert.ok(firstOption.top >= 52, `${layout.scale}: first option stays inside the body`);
      assert.ok(
        lastOption.bottom <= layout.boundaryBottom,
        `${layout.scale}: last option stays inside the body`,
      );
    }
  });

  it("reflows an open language picker after the window is resized", () => {
    const harness = loadSharedLanguagePickerForTest({
      options: ["en", "zh", "zh-TW", "ko", "ja"],
      innerHeight: 450,
    });
    const layout = {
      boundaryTop: 52,
      boundaryBottom: 352.8,
      triggerTop: 295.7,
      triggerBottom: 331.7,
    };
    harness.boundary.getBoundingClientRect = () => ({
      top: layout.boundaryTop,
      bottom: layout.boundaryBottom,
    });
    harness.trigger.getBoundingClientRect = () => ({
      top: layout.triggerTop - harness.boundary.scrollTop,
      bottom: layout.triggerBottom - harness.boundary.scrollTop,
    });
    Object.defineProperty(harness.menu, "scrollHeight", { value: 160 });
    Object.defineProperty(harness.menu, "offsetHeight", { value: 162 });
    Object.defineProperty(harness.menu, "clientHeight", { value: 160 });

    harness.trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(harness.picker.classList.contains("open"), true);
    assert.strictEqual(harness.getWindowListenerCount("resize"), 1);

    layout.boundaryBottom = 290.3;
    layout.triggerTop = 316.6;
    layout.triggerBottom = 352.6;
    assert.ok(
      harness.trigger.getBoundingClientRect().top > layout.boundaryBottom,
      "regression setup must put the trigger behind the fixed footer",
    );

    harness.dispatchWindowEvent("resize");
    harness.dispatchWindowEvent("resize");
    assert.strictEqual(
      harness.getPendingAnimationFrameCount(),
      1,
      "resize work is coalesced into one animation frame",
    );
    harness.flushAnimationFrames();

    const visibleTrigger = harness.trigger.getBoundingClientRect();
    assert.ok(visibleTrigger.top >= layout.boundaryTop);
    assert.ok(visibleTrigger.bottom <= layout.boundaryBottom);
    assert.strictEqual(harness.picker.classList.contains("open-up"), true);
    assert.strictEqual(harness.menu.style.maxHeight, "162px");

    harness.control.dispose();
    assert.strictEqual(harness.getWindowListenerCount("resize"), 0);
  });

  it("does not show a scrollbar when an upward menu fits all language options", () => {
    const harness = loadSharedLanguagePickerForTest({
      options: ["en", "zh", "zh-TW", "ko", "ja"],
      innerHeight: 600,
    });
    harness.boundary.getBoundingClientRect = () => ({ top: 72, bottom: 502 });
    harness.trigger.getBoundingClientRect = () => ({ top: 445, bottom: 499 });
    Object.defineProperty(harness.menu, "scrollHeight", { value: 160 });
    Object.defineProperty(harness.menu, "offsetHeight", { value: 162 });
    Object.defineProperty(harness.menu, "clientHeight", { value: 160 });

    harness.trigger.dispatchEvent({ type: "click" });

    assert.strictEqual(harness.picker.classList.contains("open-up"), true);
    assert.strictEqual(harness.picker.classList.contains("menu-scrollable"), false);
    assert.strictEqual(harness.menu.style.maxHeight, "162px");
  });

  it("unmounts a closed upward accessory-style menu and clears its overflow geometry", () => {
    const harness = loadSharedLanguagePickerForTest({
      options: ["none", "cowboy", "party", "wizard", "top", "santa", "pumpkin", "halo"],
      innerHeight: 680,
    });
    harness.boundary.getBoundingClientRect = () => ({ top: 0, bottom: 680 });
    harness.trigger.getBoundingClientRect = () => ({ top: 450, bottom: 498 });
    Object.defineProperty(harness.menu, "scrollHeight", { value: 280 });
    Object.defineProperty(harness.menu, "offsetHeight", { value: 282 });
    Object.defineProperty(harness.menu, "clientHeight", { value: 280 });

    assert.strictEqual(harness.picker.classList.contains("menu-mounted"), false);
    harness.trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(harness.picker.classList.contains("menu-mounted"), true);
    assert.strictEqual(harness.picker.classList.contains("open-up"), true);
    assert.strictEqual(harness.picker.classList.contains("menu-scrollable"), true);
    assert.strictEqual(harness.menu.style.maxHeight, "240px");

    harness.optionElements[1].dispatchEvent({ type: "click" });
    assert.strictEqual(harness.picker.classList.contains("open"), false);
    assert.strictEqual(harness.picker.classList.contains("menu-mounted"), true);
    assert.strictEqual(harness.getPendingTimerCount(), 1);
    harness.menu.dispatchEvent({ type: "transitionend", propertyName: "opacity" });

    assert.strictEqual(harness.getPendingTimerCount(), 0);
    assert.strictEqual(harness.picker.classList.contains("menu-mounted"), false);
    assert.strictEqual(harness.picker.classList.contains("open-up"), false);
    assert.strictEqual(harness.picker.classList.contains("menu-scrollable"), false);
    assert.strictEqual(harness.menu.style.maxHeight, "");
    assert.strictEqual(harness.menu.scrollTop, 0);
  });

  it("reveals selected and keyboard-focused options in a scrollable picker", () => {
    const harness = loadSharedLanguagePickerForTest({
      value: "halo",
      options: ["none", "cowboy", "party", "wizard", "top", "santa", "pumpkin", "halo"],
      innerHeight: 260,
    });
    harness.boundary.getBoundingClientRect = () => ({ top: 0, bottom: 260 });
    harness.trigger.getBoundingClientRect = () => ({ top: 126, bottom: 162 });
    Object.defineProperty(harness.menu, "scrollHeight", { value: 250 });
    Object.defineProperty(harness.menu, "offsetHeight", {
      get() {
        const maxHeight = parseInt(harness.menu.style.maxHeight, 10);
        return Number.isFinite(maxHeight) ? Math.min(252, maxHeight + 2) : 252;
      },
    });
    Object.defineProperty(harness.menu, "clientHeight", {
      get() {
        const maxHeight = parseInt(harness.menu.style.maxHeight, 10);
        return Number.isFinite(maxHeight) ? Math.min(250, maxHeight) : 250;
      },
    });
    for (const [index, option] of harness.optionElements.entries()) {
      Object.defineProperty(option, "offsetTop", { value: 5 + index * 30 });
      Object.defineProperty(option, "offsetHeight", { value: 30 });
    }
    const first = harness.optionElements[0];
    const selected = harness.optionElements.at(-1);

    harness.trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(harness.picker.classList.contains("menu-scrollable"), true);
    assert.strictEqual(harness.menu.style.maxHeight, "120px");
    assert.strictEqual(harness.menu.scrollTop, 125);

    harness.trigger.dispatchEvent({ type: "click" });
    harness.menu.dispatchEvent({ type: "transitionend", propertyName: "opacity" });
    assert.strictEqual(harness.menu.scrollTop, 0, "closed menu clears stale overflow geometry");

    harness.trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(harness.menu.scrollTop, 125, "reopening scrolls the current choice back into view");
    assert.strictEqual(selected.focused, true);

    harness.trigger.dispatchEvent({ type: "keydown", key: "Home" });
    assert.strictEqual(harness.menu.scrollTop, 5, "trigger Home reveals the first option");
    harness.trigger.dispatchEvent({ type: "keydown", key: "End" });
    assert.strictEqual(harness.menu.scrollTop, 125, "trigger End reveals the last option");

    selected.dispatchEvent({ type: "keydown", key: "ArrowDown" });
    assert.strictEqual(harness.menu.scrollTop, 5, "wrapped ArrowDown reveals the first option");
    first.dispatchEvent({ type: "keydown", key: "End" });
    assert.strictEqual(harness.menu.scrollTop, 125, "option End reveals the last option");
  });

  it("cancels a stale menu unmount when the picker is reopened quickly", () => {
    const harness = loadSharedLanguagePickerForTest();
    harness.boundary.getBoundingClientRect = () => ({ top: 0, bottom: 600 });
    harness.trigger.getBoundingClientRect = () => ({ top: 200, bottom: 240 });
    Object.defineProperty(harness.menu, "scrollHeight", { value: 120 });
    Object.defineProperty(harness.menu, "offsetHeight", { value: 122 });
    Object.defineProperty(harness.menu, "clientHeight", { value: 120 });

    harness.trigger.dispatchEvent({ type: "click" });
    harness.trigger.dispatchEvent({ type: "click" });
    harness.menu.scrollTop = 78;
    assert.strictEqual(harness.getPendingTimerCount(), 1);
    assert.strictEqual(harness.menu.eventListeners.transitionend.length, 1);
    harness.trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(harness.getPendingTimerCount(), 0);
    assert.strictEqual(harness.menu.eventListeners.transitionend.length, 0);
    assert.strictEqual(harness.menu.scrollTop, 0);

    harness.flushTimers();
    harness.menu.dispatchEvent({ type: "transitionend", propertyName: "opacity" });
    assert.strictEqual(harness.picker.classList.contains("open"), true);
    assert.strictEqual(harness.picker.classList.contains("menu-mounted"), true);

    harness.trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(harness.menu.eventListeners.transitionend.length, 1);
    harness.menu.dispatchEvent({ type: "transitionend", propertyName: "opacity" });
    assert.strictEqual(harness.menu.eventListeners.transitionend.length, 0);
    assert.strictEqual(harness.picker.classList.contains("menu-mounted"), false);
  });

  it("derives the close fallback from the longest CSS transition", () => {
    const harness = loadSharedLanguagePickerForTest({
      transitionDuration: "0.14s, 320ms",
      transitionDelay: "0s, 30ms",
    });
    harness.trigger.dispatchEvent({ type: "click" });
    harness.trigger.dispatchEvent({ type: "click" });

    assert.deepStrictEqual(harness.getPendingTimerDelays(), [390]);
  });

  it("disposes an animating picker without leaving menu or listener state behind", () => {
    const harness = loadSharedLanguagePickerForTest();
    harness.trigger.dispatchEvent({ type: "click" });
    harness.trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(harness.getPendingTimerCount(), 1);

    harness.control.dispose();

    assert.strictEqual(harness.getPendingTimerCount(), 0);
    assert.strictEqual(harness.picker.classList.contains("open"), false);
    assert.strictEqual(harness.picker.classList.contains("menu-mounted"), false);
    assert.strictEqual(harness.picker.classList.contains("open-up"), false);
    assert.strictEqual(harness.picker.classList.contains("menu-scrollable"), false);
    assert.strictEqual(harness.getDocumentListenerCount("click"), 0);
    assert.strictEqual(harness.getDocumentListenerCount("keydown"), 0);
    assert.strictEqual(harness.getWindowListenerCount("resize"), 0);
  });

  it("cleans up language picker document listeners across re-renders", () => {
    const harness = loadGeneralLanguageRowForTest({
      snapshot: { lang: "en" },
    });

    harness.core.ops.requestRender({ content: true });
    const staleOption = harness.getLangOptions()[1];
    assert.strictEqual(harness.getDocumentListenerCount("click"), 1);
    assert.strictEqual(harness.getDocumentListenerCount("keydown"), 1);

    harness.core.ops.requestRender({ content: true });
    assert.strictEqual(harness.getDocumentListenerCount("click"), 1);
    assert.strictEqual(harness.getDocumentListenerCount("keydown"), 1);
    assert.strictEqual(harness.core.state.mountedControls.settingsSelects.size, 1);

    staleOption.dispatchEvent({ type: "click" });
    assert.deepStrictEqual(harness.updateCalls, []);
  });

  it("closes the language picker from outside clicks and Escape", () => {
    const harness = loadGeneralLanguageRowForTest({
      snapshot: { lang: "en" },
    });

    harness.core.ops.requestRender({ content: true });
    harness.getLangTrigger().dispatchEvent({ type: "click" });
    assert.strictEqual(harness.getLangPicker().classList.contains("open"), true);

    harness.dispatchDocumentEvent("click", { target: new FakeElement("body") });
    assert.strictEqual(harness.getLangPicker().classList.contains("open"), false);
    assert.strictEqual(harness.getLangPicker().classList.contains("menu-mounted"), false);

    harness.getLangTrigger().dispatchEvent({ type: "click" });
    harness.dispatchDocumentEvent("keydown", {
      key: "Escape",
      preventDefault() { this.defaultPrevented = true; },
    });
    assert.strictEqual(harness.getLangPicker().classList.contains("open"), false);
    assert.strictEqual(harness.getLangPicker().classList.contains("menu-mounted"), false);
  });

  it("fully unmounts a shared picker when it becomes disabled", () => {
    const harness = loadSharedLanguagePickerForTest();
    harness.trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(harness.picker.classList.contains("menu-mounted"), true);

    harness.control.setDisabled(true);
    harness.menu.dispatchEvent({ type: "transitionend", propertyName: "opacity" });

    assert.strictEqual(harness.picker.classList.contains("open"), false);
    assert.strictEqual(harness.picker.classList.contains("menu-mounted"), false);
    assert.strictEqual(harness.picker.classList.contains("open-up"), false);
    assert.strictEqual(harness.picker.classList.contains("menu-scrollable"), false);
    assert.strictEqual(harness.menu.style.maxHeight, "");
  });

  it("exposes aggregate and split bubble controls in the General tab", () => {
    const generalSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-general.js"), "utf8");
    const i18nSource = fs.readFileSync(SETTINGS_I18N, "utf8");
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    assert.ok(generalSource.includes('key: "hideBubbles"'));
    assert.ok(generalSource.includes("rowHideBubbles"));
    assert.ok(generalSource.includes("setAllBubblesHidden"));
    assert.ok(generalSource.includes('{ hidden: nextRaw }'));
    assert.ok(generalSource.includes('keys.includes("hideBubbles")'));
    assert.ok(generalSource.includes("buildBubblePolicyRow()"));
    assert.ok(generalSource.includes("setBubbleCategoryEnabled"));
    assert.ok(generalSource.includes("state.mountedControls.bubblePolicyControls"));
    assert.ok(generalSource.includes("state.mountedControls.bubblePolicySummary"));
    assert.ok(generalSource.includes("confirmDisableUpdateBubbles"));
    assert.ok(generalSource.indexOf("buildBubblePolicyRow(),") < generalSource.indexOf("buildBubblePlacementGroup(),"));
    assert.ok(generalSource.includes("category === \"update\" && next === 0"));
    assert.ok(generalSource.includes("notificationBubbleAutoCloseSeconds"));
    assert.ok(generalSource.includes("updateBubbleAutoCloseSeconds"));
    assert.ok(generalSource.includes("bubble-policy-prefix"));
    assert.ok(generalSource.includes('input.type = "text"'));
    assert.ok(generalSource.includes("input.maxLength = 4"));
    assert.ok(generalSource.includes('input.pattern = "[0-9]*"'));
    assert.ok(generalSource.includes('input.value.replace(/\\D+/g, "").slice(0, 4)'));
    assert.ok(generalSource.includes("showSettingsConfirmModal"));
    assert.ok(generalSource.includes("updateBubbleDisableConfirmTitle"));
    assert.ok(/\.bubble-policy-seconds\s*\{[\s\S]*width:\s*42px;/.test(css));
    assert.ok(/\.bubble-policy-seconds\s*\{[\s\S]*box-sizing:\s*border-box;[\s\S]*text-align:\s*center;[\s\S]*padding:\s*0 3px;/.test(css));
    assert.ok(i18nSource.includes("rowHideBubbles"));
    assert.ok(i18nSource.includes("rowBubblePolicy"));
    assert.ok(i18nSource.includes("bubbleUpdateWarning"));
    assert.ok(i18nSource.includes("bubbleSecondsPrefix"));
  });

  it("renders bubble placement as independent conditional controls and patches it in place", async () => {
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    assert.match(css, /\.bubble-placement-group \.row\[hidden\]\s*\{\s*display:\s*none;/);
    assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.bubble-fixed-corner-segmented\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,/);
    assert.match(css, /\.bubble-placement-group \.settings-segmented-radio button\s*\{[\s\S]*white-space:\s*normal;/);
    const updateCalls = [];
    const initialSnapshot = makeGeneralSnapshot({
      bubbleFollowPet: true,
      bubbleFollowPreference: "left",
      bubbleFixedCorner: "top-right",
    });
    const harness = loadGeneralTabForTest({
      snapshot: initialSnapshot,
      settingsAPI: {
        update: (key, value) => {
          updateCalls.push({ key, value });
          return Promise.resolve({ status: "ok" });
        },
      },
    });
    harness.renderContent();

    const placement = harness.core.state.mountedControls.bubblePlacement;
    assert.ok(placement);
    assert.strictEqual(placement.followRow.hidden, false);
    assert.strictEqual(placement.cornerRow.hidden, true);
    assert.strictEqual(placement.followControl.getValue(), "left");
    assert.strictEqual(placement.cornerControl.getValue(), "top-right");
    assert.ok(placement.cornerControl.element.querySelectorAll("button").every((button) => button.disabled));

    const fixedButton = placement.modeControl.element.querySelectorAll("button")
      .find((button) => button.dataset.value === "fixed");
    fixedButton.dispatchEvent({ type: "click" });
    for (let i = 0; i < 6; i++) await Promise.resolve();
    assert.deepStrictEqual(updateCalls, [{ key: "bubbleFollowPet", value: false }]);
    assert.strictEqual(placement.followRow.hidden, true);
    assert.strictEqual(placement.cornerRow.hidden, false);

    const originalElement = placement.element;
    harness.core.ops.applyChanges({
      changes: {
        bubbleFollowPet: false,
        bubbleFollowPreference: "right",
        bubbleFixedCorner: "bottom-left",
      },
      snapshot: {
        ...initialSnapshot,
        bubbleFollowPet: false,
        bubbleFollowPreference: "right",
        bubbleFixedCorner: "bottom-left",
      },
    });
    assert.strictEqual(harness.core.state.mountedControls.bubblePlacement.element, originalElement);
    assert.strictEqual(placement.followControl.getValue(), "right");
    assert.strictEqual(placement.cornerControl.getValue(), "bottom-left");
    assert.strictEqual(placement.followRow.hidden, true);
    assert.strictEqual(placement.cornerRow.hidden, false);

    harness.core.ops.applyChanges({
      changes: { hideBubbles: true },
      snapshot: {
        ...initialSnapshot,
        bubbleFollowPet: false,
        bubbleFollowPreference: "right",
        bubbleFixedCorner: "bottom-left",
        hideBubbles: true,
      },
    });
    for (const control of [placement.modeControl, placement.followControl, placement.cornerControl]) {
      assert.ok(control.element.querySelectorAll("button").every((button) => button.disabled));
    }

    const i18nSource = fs.readFileSync(SETTINGS_I18N, "utf8");
    for (const key of [
      "rowBubblePlacement",
      "rowBubblePlacementDesc",
      "bubblePlacementFollow",
      "bubblePlacementFixed",
      "rowBubbleFollowPreference",
      "rowBubbleFollowPreferenceDesc",
      "bubbleFollowAuto",
      "bubbleFollowLeft",
      "bubbleFollowRight",
      "rowBubbleFixedCorner",
      "rowBubbleFixedCornerDesc",
      "bubbleCornerTopLeft",
      "bubbleCornerTopRight",
      "bubbleCornerBottomLeft",
      "bubbleCornerBottomRight",
    ]) {
      const matches = i18nSource.match(new RegExp(`\\b${key}:`, "g"));
      assert.strictEqual(matches ? matches.length : 0, SUPPORTED_LANGS.length);
    }
  });

  it("renders the opt-in test-result reaction switch with all supported translations", () => {
    const harness = loadGeneralTabForTest({
      snapshot: makeGeneralSnapshot({ testReactionsEnabled: false }),
    });
    harness.renderContent();

    const meta = harness.getSwitchMeta("testReactionsEnabled");
    assert.ok(meta);
    assert.strictEqual(meta.element.classList.contains("on"), false);
    assert.strictEqual(meta.row.querySelector(".row-label").textContent, "Test result reactions");

    const i18nSource = fs.readFileSync(SETTINGS_I18N, "utf8");
    for (const key of ["rowTestReactions", "rowTestReactionsDesc"]) {
      const matches = i18nSource.match(new RegExp(`\\b${key}:`, "g"));
      const matchCount = matches ? matches.length : 0;
      assert.strictEqual(matchCount, SUPPORTED_LANGS.length,
        `${key} should appear in all ${SUPPORTED_LANGS.length} supported languages`);
    }
  });

  it("renders Free roam movement style as a dependent segmented choice", async () => {
    const generalSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-general.js"), "utf8");
    const i18nSource = fs.readFileSync(SETTINGS_I18N, "utf8");
    assert.ok(generalSource.includes("function buildFreeRoamGroup()"));
    assert.ok(generalSource.includes('id: "general:free-roam"'));
    assert.ok(generalSource.includes('className: "free-roam-collapsible"'));
    assert.ok(generalSource.includes("defaultCollapsed: true"));
    assert.ok(generalSource.includes("function buildRoamMovementStyleRow()"));
    assert.ok(generalSource.includes('"row roam-movement-style-row"'));
    assert.ok(generalSource.includes('"roamConstrainAxis"'));
    for (const key of [
      "rowRoamMovementStyle",
      "rowRoamMovementStyleDesc",
      "roamMovementNatural",
      "roamMovementAxis",
      "rowRoamArea",
      "roamAreaLoading",
      "roamAreaEntire",
      "roamAreaCustom",
      "roamAreaUnavailable",
      "roamAreaPetTooLarge",
      "roamAreaChoose",
      "roamAreaReset",
      "roamAreaSaved",
      "roamAreaResetDone",
    ]) {
      const matches = i18nSource.match(new RegExp(`\\b${key}:`, "g"));
      const matchCount = matches ? matches.length : 0;
      assert.strictEqual(matchCount, SUPPORTED_LANGS.length,
        `${key} should appear in all ${SUPPORTED_LANGS.length} supported languages`);
    }

    const updateCalls = [];
    const initialSnapshot = makeGeneralSnapshot({ roamConstrainAxis: true, freeRoam: false });
    const harness = loadGeneralTabForTest({
      snapshot: initialSnapshot,
      settingsAPI: {
        update: (key, value) => {
          updateCalls.push({ key, value });
          return Promise.resolve({ status: "ok" });
        },
      },
    });
    harness.renderContent();

    const control = harness.core.state.mountedControls.roamMovementStyle;
    const row = harness.content.querySelector(".roam-movement-style-row");
    const group = harness.content.querySelector(".free-roam-collapsible");
    const header = group.querySelector(".collapsible-group-header");
    const disclosure = group.querySelector(".collapsible-group-disclosure");
    const freeRoamSwitch = harness.getSwitch("freeRoam");
    assert.ok(control && row, "the dependent movement-style row must mount");
    assert.ok(group, "Free roam must render as a collapsible group");
    assert.strictEqual(group.dataset.groupId, "general:free-roam");
    assert.strictEqual(group.classList.contains("collapsed"), true, "Free roam details default closed");
    assert.strictEqual(header.getAttribute("role"), undefined, "the shared header must not wrap both interactive controls");
    assert.strictEqual(disclosure.getAttribute("role"), "button");
    assert.strictEqual(disclosure.getAttribute("aria-expanded"), "false");
    assert.strictEqual(disclosure.getAttribute("aria-label"), "Expand section: Free roam");
    assert.strictEqual(disclosure.contains(freeRoamSwitch), false, "the switch must be a sibling of the disclosure button");
    assert.strictEqual(header.contains(disclosure), true);
    assert.strictEqual(header.contains(freeRoamSwitch), true);
    assert.strictEqual(freeRoamSwitch.getAttribute("role"), "switch");
    assert.strictEqual(freeRoamSwitch.getAttribute("aria-label"), "Free roam");
    assert.ok(
      group.querySelector(".collapsible-group-body").contains(row),
      "movement style must live inside the collapsible body",
    );
    assert.ok(row.classList.contains("settings-option-item"), "movement style must use the nested-card style");
    assert.strictEqual(control.element.getAttribute("role"), "radiogroup");
    const buttons = control.element.querySelectorAll("button");
    const natural = buttons.find((button) => button.dataset.value === "natural");
    const axis = buttons.find((button) => button.dataset.value === "axis");
    assert.ok(natural && axis, "both movement styles must be available");
    assert.strictEqual(axis.classList.contains("active"), true, "stored axis choice remains visible");
    assert.strictEqual(natural.classList.contains("active"), false);
    assert.strictEqual(axis.disabled, true, "style is disabled while Free roam is off");
    assert.strictEqual(natural.disabled, true);

    // The header master switch updates Free roam without also opening the
    // sibling disclosure. No propagation workaround is needed.
    freeRoamSwitch.dispatchEvent({
      type: "click",
      bubbles: true,
      cancelBubble: false,
      stopPropagation() { this.cancelBubble = true; },
    });
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(
      updateCalls.some((call) => call.key === "freeRoam" && call.value === true),
      "the header switch must persist freeRoam=true",
    );
    assert.strictEqual(group.classList.contains("collapsed"), true);

    disclosure.dispatchEvent({ type: "click", bubbles: true });
    assert.strictEqual(group.classList.contains("collapsed"), false);
    assert.strictEqual(disclosure.getAttribute("aria-expanded"), "true");
    assert.strictEqual(disclosure.getAttribute("aria-label"), "Collapse section: Free roam");

    // Enabling the parent patches the mounted child in place and preserves its
    // stored axis selection instead of resetting the preference.
    const beforeRenderCount = harness.getContentRenderCount();
    const enabledSnapshot = { ...initialSnapshot, freeRoam: true };
    harness.core.ops.applyChanges({
      changes: { freeRoam: true },
      snapshot: enabledSnapshot,
    });
    assert.strictEqual(harness.core.state.mountedControls.roamMovementStyle, control);
    assert.strictEqual(harness.getContentRenderCount(), beforeRenderCount);
    assert.strictEqual(axis.disabled, false);
    assert.strictEqual(natural.disabled, false);
    assert.strictEqual(axis.classList.contains("active"), true);

    // Natural maps back to the existing boolean false; no prefs migration or
    // new runtime setting is introduced by the presentation change.
    natural.dispatchEvent({ type: "click", bubbles: false });
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(
      updateCalls.some((call) => call.key === "roamConstrainAxis" && call.value === false),
      "Natural must persist roamConstrainAxis=false",
    );
    assert.strictEqual(natural.classList.contains("active"), true);
    assert.strictEqual(axis.classList.contains("active"), false);

    // Axis maps to the existing boolean true through the same user-click path.
    axis.dispatchEvent({ type: "click", bubbles: false });
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(
      updateCalls.some((call) => call.key === "roamConstrainAxis" && call.value === true),
      "Axis must persist roamConstrainAxis=true",
    );
    assert.strictEqual(axis.classList.contains("active"), true);
    assert.strictEqual(natural.classList.contains("active"), false);

    // Authoritative broadcasts keep the same control mounted and can replace
    // the optimistic value without rebuilding General.
    const naturalSnapshot = { ...enabledSnapshot, roamConstrainAxis: false };
    harness.core.ops.applyChanges({
      changes: { roamConstrainAxis: false },
      snapshot: naturalSnapshot,
    });
    const axisSnapshot = { ...naturalSnapshot, roamConstrainAxis: true };
    harness.core.ops.applyChanges({
      changes: { roamConstrainAxis: true },
      snapshot: axisSnapshot,
    });
    assert.strictEqual(axis.classList.contains("active"), true);
    assert.strictEqual(natural.classList.contains("active"), false);

    // Turning the parent off disables the child but preserves the stored style.
    harness.core.ops.applyChanges({
      changes: { freeRoam: false },
      snapshot: { ...axisSnapshot, freeRoam: false },
    });
    assert.strictEqual(harness.core.state.mountedControls.roamMovementStyle, control);
    assert.strictEqual(harness.getContentRenderCount(), beforeRenderCount);
    assert.strictEqual(axis.classList.contains("active"), true);
    assert.strictEqual(natural.disabled, true);
    assert.strictEqual(axis.disabled, true);
  });

  it("shows, selects, and resets the Free roam activity area", async () => {
    const calls = [];
    const harness = loadGeneralTabForTest({
      snapshot: makeGeneralSnapshot({ freeRoam: true }),
      settingsAPI: {
        getRoamFence: async () => ({
          status: "ok",
          active: true,
          fence: { left: 0.1, top: 0.2, right: 0.7, bottom: 0.8 },
        }),
        selectRoamFence: async () => {
          calls.push("select");
          return {
            status: "ok",
            active: true,
            fence: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 },
          };
        },
        clearRoamFence: async () => {
          calls.push("clear");
          return { status: "ok", active: false, fence: null };
        },
      },
    });
    harness.renderContent();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const control = harness.core.state.mountedControls.roamArea;
    assert.ok(control && harness.content.querySelector(".roam-area-row"));
    assert.strictEqual(control.description.textContent, "Custom area · 60% × 60% of each display");
    assert.strictEqual(control.resetButton.style.display, "");
    assert.ok(harness.content.querySelector(".free-roam-option-list").contains(control.row));

    control.chooseButton.dispatchEvent({ type: "click", bubbles: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepStrictEqual(calls, ["select"]);
    assert.strictEqual(control.description.textContent, "Custom area · 50% × 50% of each display");
    assert.strictEqual(control.chooseButton.disabled, false);

    control.resetButton.dispatchEvent({ type: "click", bubbles: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepStrictEqual(calls, ["select", "clear"]);
    assert.strictEqual(control.description.textContent, "Default roam area");
    assert.strictEqual(control.resetButton.style.display, "none");
  });

  it("shows the Free roam activity area as unavailable for a non-ok status", async () => {
    const harness = loadGeneralTabForTest({
      snapshot: makeGeneralSnapshot({ freeRoam: true }),
      settingsAPI: {
        getRoamFence: async () => ({
          status: "error",
          active: false,
          fence: null,
          message: "failed to read the activity-area file",
        }),
      },
    });
    harness.renderContent();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const control = harness.core.state.mountedControls.roamArea;
    assert.strictEqual(
      control.description.textContent,
      "The area file is invalid or still loading; roaming stays paused.",
    );
    assert.strictEqual(control.resetButton.style.display, "none");
  });

  it("explains when the pet is too large to choose an activity area", async () => {
    const harness = loadGeneralTabForTest({
      snapshot: makeGeneralSnapshot({ freeRoam: true }),
      settingsAPI: {
        getRoamFence: async () => ({ status: "ok", active: false, fence: null }),
        selectRoamFence: async () => ({
          status: "error",
          code: "pet-too-large",
          message: "the pet is larger than this display's work area",
        }),
      },
    });
    const toasts = [];
    harness.core.ops.showToast = (message, options) => toasts.push({ message, options });
    harness.renderContent();
    await new Promise((resolve) => setTimeout(resolve, 0));

    harness.core.state.mountedControls.roamArea.chooseButton.dispatchEvent({ type: "click", bubbles: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(toasts.length, 1);
    assert.strictEqual(
      toasts[0].message,
      "Duck is larger than this display's work area. Reduce the pet size before choosing an activity area.",
    );
    assert.strictEqual(toasts[0].options.error, true);
  });

  it("registers the Session cleanup group with four number rows, atomic reset, and i18n keys", () => {
    const generalSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-general.js"), "utf8");
    const i18nSource = fs.readFileSync(SETTINGS_I18N, "utf8");
    const uiCoreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    const actionsSource = fs.readFileSync(path.join(SRC_DIR, "settings-actions.js"), "utf8");

    // Group is mounted top-level in the General tab (not nested under HUD).
    assert.ok(generalSource.includes("buildSessionCleanupGroup()"));
    assert.ok(generalSource.includes('id: "general:session-cleanup"'));

    // All four numeric prefs map to their own number input row.
    assert.ok(generalSource.includes('key: "sessionStaleMs"'));
    assert.ok(generalSource.includes('key: "workingStaleMs"'));
    assert.ok(generalSource.includes('key: "codexWorkingStaleMs"'));
    assert.ok(generalSource.includes('key: "detachedIdleStaleMs"'));
    assert.ok(generalSource.includes("buildNumberInputRow"));
    assert.ok(generalSource.includes("SESSION_CLEANUP_NUMBER_KEYS"));

    // Reset button goes through the atomic command path.
    assert.ok(generalSource.includes('"sessionCleanup.setTriple"'));
    assert.ok(generalSource.includes("SESSION_CLEANUP_DEFAULTS"));
    assert.ok(generalSource.includes('"actionResetSessionCleanup"'));

    // patchInPlace covers the new keys in BOTH the existence guard and the sync loop.
    assert.ok(generalSource.match(/SESSION_CLEANUP_NUMBER_KEYS\.has\(key\)[\s\S]+sessionCleanupControls\.get\(key\)\.syncFromSnapshot\(\)/));

    // ui-core registers the helper and the mountedControls bag.
    assert.ok(uiCoreSource.includes("buildNumberInputRow"));
    assert.ok(uiCoreSource.includes("sessionCleanupControls: new Map()"));
    assert.ok(uiCoreSource.includes("state.mountedControls.sessionCleanupControls.clear()"));

    // The command is registered in settings-actions.
    assert.ok(actionsSource.includes('"sessionCleanup.setTriple": setSessionCleanupTriple'));

    // i18n keys present in all supported languages.
    for (const key of [
      "rowSessionCleanupGroup",
      "rowSessionCleanupGroupDesc",
      "rowStaleSession",
      "rowStaleSessionDesc",
      "rowStaleWorking",
      "rowStaleWorkingDesc",
      "rowCodexStaleWorking",
      "rowCodexStaleWorkingDesc",
      "rowStaleDetached",
      "rowStaleDetachedDesc",
      "unitMinutes",
      "unitSeconds",
      "valueDisabled",
      "actionResetSessionCleanup",
    ]) {
      const matches = i18nSource.match(new RegExp(`\\b${key}:`, "g"));
      const matchCount = matches ? matches.length : 0;
      assert.strictEqual(matchCount, SUPPORTED_LANGS.length,
        `${key} should appear in all ${SUPPORTED_LANGS.length} supported language tables (saw ${matchCount})`);
    }
  });

  it("uses collapsible option lists for Session HUD and sound controls", () => {
    const generalSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-general.js"), "utf8");
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    const i18nSource = fs.readFileSync(SETTINGS_I18N, "utf8");
    assert.ok(generalSource.includes("function buildSessionHudOptionsList("));
    assert.ok(generalSource.includes("session-hud-option-list"));
    assert.ok(generalSource.includes("function buildSoundGroup("));
    assert.ok(generalSource.includes("function buildSoundEnabledRow("));
    assert.ok(generalSource.includes('id: "general:sound"'));
    assert.ok(generalSource.includes("sound-option-list"));
    assert.ok(generalSource.includes("state.mountedControls.soundSummary"));
    assert.ok(generalSource.includes('sw.setAttribute("aria-label", t("rowSoundEnabled"));'));
    assert.ok(generalSource.includes("toggleSound"));
    assert.ok(generalSource.includes("syncVolumePreview"));
    assert.ok(!/key:\s*"soundMuted",[\s\S]{0,120}descKey:\s*"rowSoundDesc"/.test(generalSource));
    assert.ok(generalSource.includes('state.transientUiState.generalSwitches.set("soundMuted"'));
    assert.ok(generalSource.includes("if (!result || result.status !== \"ok\" || result.noop)"));
    assert.ok(generalSource.includes("sessionHudSummaryLabels"));
    assert.ok(generalSource.includes('key: "sessionHudShowStateLabels"'));
    assert.ok(generalSource.includes("session-hud-summary-control"));
    assert.ok(/\.settings-option-list\s*\{[\s\S]*display:\s*grid;[\s\S]*gap:\s*8px;/.test(css));
    assert.ok(/\.settings-option-list \.settings-option-item\s*\{[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--panel-bg\) 78%,\s*transparent\);/.test(css));
    assert.ok(/\.session-hud-collapsible \.collapsible-summary-chip,[\s\S]*\.sound-collapsible \.collapsible-summary-chip\s*\{[\s\S]*max-width:\s*min\(280px,\s*100%\);/.test(css));
    assert.ok(/\.session-hud-collapsible \.collapsible-group-summary\s*\{[\s\S]*flex:\s*0 0 auto;[\s\S]*max-width:\s*none;/.test(css));
    assert.ok(/\.sound-collapsible \.collapsible-group-summary\s*\{[\s\S]*flex:\s*0 0 auto;[\s\S]*max-width:\s*none;/.test(css));
    assert.ok(/\.bubble-policy-collapsible \.collapsible-group-summary\s*\{[^}]*flex:\s*0 0 auto;[^}]*flex-wrap:\s*nowrap;[^}]*max-width:\s*none;[^}]*\}/.test(css));
    assert.ok(!/\.session-hud-collapsible \.collapsible-group-summary\s*\{[^}]*flex-wrap:\s*nowrap;/.test(css));
    assert.ok(!/\.sound-collapsible \.collapsible-group-summary\s*\{[^}]*flex-wrap:\s*nowrap;/.test(css));
    assert.ok(/\.session-hud-summary-control\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*max-content\);/.test(css));
    assert.ok(/\.session-hud-summary-control \.collapsible-summary-chip\s*\{[^}]*justify-self:\s*end;[^}]*width:\s*max-content;/.test(css));
    assert.ok(/\.session-hud-summary-control\.compact\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*width:\s*auto;/.test(css));
    assert.ok(/@media \(max-width:\s*720px\)\s*\{[\s\S]*\.session-hud-collapsible \.collapsible-group-header\s*\{[\s\S]*flex-wrap:\s*wrap;/.test(css));
    assert.ok(/@media \(max-width:\s*720px\)\s*\{[\s\S]*\.session-hud-collapsible \.collapsible-group-summary\s*\{[\s\S]*flex:\s*0 0 calc\(100% - 22px\);[\s\S]*margin-left:\s*22px;/.test(css));
    assert.ok(/@media \(max-width:\s*720px\)\s*\{[\s\S]*\.session-hud-summary-control\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[\s\S]*width:\s*min\(238px,\s*100%\);/.test(css));
    assert.ok(/@media \(max-width:\s*720px\)\s*\{[\s\S]*\.session-hud-summary-control\s*\{[\s\S]*justify-self:\s*start;/.test(css));
    assert.ok(!generalSource.includes("animateExpansion: false"));
    assert.ok(/\.collapsible-group-text \.row-label\s*\{[\s\S]*text-overflow:\s*ellipsis;[\s\S]*white-space:\s*nowrap;/.test(css));
    assert.ok(/\.collapsible-group-text \.row-desc\s*\{[\s\S]*white-space:\s*normal;[\s\S]*-webkit-line-clamp:\s*2;/.test(css));
    assert.ok(/\.sound-summary-control\s*\{[\s\S]*display:\s*inline-flex;/.test(css));
    assert.ok(/\.sound-summary-control\s*\{[\s\S]*min-width:\s*max-content;/.test(css));
    assert.ok(/\.sound-summary-control \.collapsible-summary-chip\s*\{[\s\S]*max-width:\s*none;/.test(css));
    assert.ok(/\.sound-summary-control \.collapsible-summary-chip\s*\{[\s\S]*flex:\s*0 0 auto;/.test(css));
    assert.ok(/\.sound-collapsible \.collapsible-group-text \.row-desc\s*\{[\s\S]*white-space:\s*normal;[\s\S]*-webkit-line-clamp:\s*2;/.test(css));
    assert.ok(i18nSource.includes("rowSoundEnabled"));
  });

  it("adds hover affordance to General sliders via the shared volume-style classes", () => {
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    assert.ok(/\.volume-slider:hover::-webkit-slider-thumb\s*\{[\s\S]*transform:\s*scale\(1\.08\);/.test(css));
    assert.ok(/@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.volume-slider:hover::-webkit-slider-thumb,[\s\S]*\.size-control\.dragging \.volume-slider::-webkit-slider-thumb\s*\{[\s\S]*transform:\s*none;/.test(css));
  });

  it("stacks wide General controls from their zoom-corrected card width", () => {
    const generalSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-general.js"), "utf8");
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    assert.ok(generalSource.includes('row.className = "row volume-slider-row"'));
    assert.match(css, /\.sound-collapsible \.settings-option-list\s*\{\s*container-type:\s*inline-size;/s);
    assert.match(css, /@container \(max-width:\s*400px\)\s*\{[\s\S]*\.volume-slider-row\s*\{[\s\S]*flex-direction:\s*column;/);
    assert.match(css, /@container \(max-width:\s*400px\)\s*\{[\s\S]*\.volume-slider-row \.volume-control\s*\{[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0;/);
  });

  it("describes notification bubble seconds as an auto-close upper bound instead of a guaranteed visible duration", () => {
    const i18nSource = fs.readFileSync(SETTINGS_I18N, "utf8");

    assert.ok(i18nSource.includes("auto-close upper bound"));
    assert.ok(i18nSource.includes("later session states may dismiss it earlier"));
    assert.ok(i18nSource.includes("自动关闭上限"));
    assert.ok(i18nSource.includes("后续状态可能提前关闭"));
    assert.ok(i18nSource.includes("自動關閉的上限"));
    assert.ok(i18nSource.includes("後面有狀態變化可能提前關掉"));
  });

  it("auto-commits bubble seconds shortly after valid input instead of waiting only for change", () => {
    const generalSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-general.js"), "utf8");
    assert.ok(generalSource.includes("BUBBLE_SECONDS_AUTO_COMMIT_DELAY_MS"));
    assert.ok(generalSource.includes('input.addEventListener("input", () => {'));
    assert.ok(generalSource.includes("scheduleSecondsCommit(next);"));
    assert.ok(generalSource.includes('input.addEventListener("blur", () => {'));
    assert.ok(generalSource.includes("flushSecondsCommit();"));
    assert.ok(generalSource.includes('input.addEventListener("change", () => {'));
    assert.ok(generalSource.includes("const next = parseBubbleSecondsInputValue(raw);"));
    assert.ok(generalSource.includes('if (category === "update" && next === 0) return;'));
    assert.ok(generalSource.includes("commitSecondsValue(secondsInput, secondsKey, next, category)"));
    assert.ok(!generalSource.includes("commitSecondsValue(input, secondsKey, next, category).then("));
  });

  it("keeps update bubble disable confirmation inside the Settings renderer", () => {
    const preloadSource = fs.readFileSync(PRELOAD_SETTINGS, "utf8");
    const mainSource = fs.readFileSync(MAIN_PROCESS, "utf8");
    const generalSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-general.js"), "utf8");
    const i18nSource = fs.readFileSync(SETTINGS_I18N, "utf8");
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    const uiCoreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    assert.ok(uiCoreSource.includes("settings-confirm-modal"));
    assert.ok(generalSource.includes("updateBubbleDisableConfirmAction"));
    assert.ok(css.includes(".settings-confirm-modal"));
    assert.ok(css.includes(".settings-confirm-backdrop"));
    assert.ok(!preloadSource.includes("confirmDisableUpdateBubbles"));
    assert.ok(!preloadSource.includes("settings:confirm-disable-update-bubbles"));
    assert.ok(!mainSource.includes("UPDATE_BUBBLE_DIALOG_STRINGS"));
    assert.ok(!mainSource.includes('ipcMain.handle("settings:confirm-disable-update-bubbles"'));
    assert.ok(i18nSource.includes("Hide update bubbles"));
    assert.ok(i18nSource.includes("隐藏更新气泡"));
    assert.ok(generalSource.includes('{ id: "confirm", label: t("updateBubbleDisableConfirmAction"), tone: "danger" }'));
    assert.ok(generalSource.includes('{ id: "cancel", label: t("updateBubbleDisableConfirmCancel"), tone: "neutral", defaultFocus: true }'));
    assert.ok(generalSource.includes('if (actionId === "confirm") runToggleCommit(nextEnabled);'));
    assert.ok(uiCoreSource.includes("function buildButton(config = {})"));
    assert.ok(uiCoreSource.includes('tone === "danger"'));
  });

  it("keeps Claude hooks confirmations inside the Settings renderer", () => {
    const preloadSource = fs.readFileSync(PRELOAD_SETTINGS, "utf8");
    const mainSource = fs.readFileSync(MAIN_PROCESS, "utf8");
    const generalSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-general.js"), "utf8");
    const i18nSource = fs.readFileSync(SETTINGS_I18N, "utf8");
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    const agentsSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-agents.js"), "utf8");
    const uiCoreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    assert.ok(agentsSource.includes("confirmDisableClaudeHookManagement"));
    assert.ok(agentsSource.includes("runDisconnectClaudeHooks"));
    assert.ok(agentsSource.includes("showSettingsConfirmModal({"));
    assert.ok(agentsSource.includes("claudeHooksDisableConfirmTitle"));
    assert.ok(agentsSource.includes("claudeHooksDisconnectConfirmTitle"));
    assert.ok(uiCoreSource.includes("buttons.find((action) => action.action && action.action.defaultFocus)"));
    assert.ok(uiCoreSource.includes("const button = buildButton({"));
    assert.ok(uiCoreSource.includes('["neutral", "accent", "danger", "quiet"]'));
    assert.ok(uiCoreSource.includes('tone === "danger"'));
    assert.ok(css.includes(".settings-confirm-danger"));
    assert.ok(!preloadSource.includes("confirmDisableClaudeHooks"));
    assert.ok(!preloadSource.includes("confirmDisconnectClaudeHooks"));
    assert.ok(!mainSource.includes('ipcMain.handle("settings:confirm-disable-claude-hooks"'));
    assert.ok(!mainSource.includes('ipcMain.handle("settings:confirm-disconnect-claude-hooks"'));
    assert.ok(!mainSource.includes("CLAUDE_HOOKS_DIALOG_STRINGS"));
    assert.ok(i18nSource.includes("claudeHooksDisableConfirmTitle"));
    assert.ok(i18nSource.includes("claudeHooksDisableConfirmKeep"));
    assert.ok(i18nSource.includes("claudeHooksDisconnectConfirmKeep"));
  });

  it("renders three permission automation modes with two confirmation-gated automatic choices", () => {
    const generalSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-general.js"), "utf8");
    const coreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    const i18nSource = fs.readFileSync(SETTINGS_I18N, "utf8");
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    assert.ok(generalSource.includes("PERMISSION_AUTOMATION_OPTIONS"));
    assert.ok(generalSource.includes('{ id: "off", labelKey: "permissionAutomationOff" }'));
    assert.ok(generalSource.includes('{ id: "auto-tools", labelKey: "permissionAutomationAutoTools" }'));
    assert.ok(generalSource.includes('{ id: "unattended", labelKey: "permissionAutomationUnattended" }'));
    assert.ok(generalSource.includes('window.settingsAPI.command("setPermissionAutomationMode"'));
    assert.ok(generalSource.includes("confirmed: true"));
    assert.ok(generalSource.includes("showPermissionAutomationConfirmModal"));
    assert.ok(generalSource.includes("permissionAutomationUnattendedConfirmTitle"));
    assert.ok(generalSource.includes("permissionAutomationAutoToolsWarningDismissed"));
    assert.ok(generalSource.includes("permissionAutomationUnattendedWarningDismissed"));
    assert.ok(generalSource.includes("permissionAutomationAutoToolsDontShowAgain"));
    assert.ok(generalSource.includes("permissionAutomationUnattendedDontShowAgain"));
    assert.ok(generalSource.includes("suppressFutureConfirmation: result.checkboxChecked === true"));
    assert.ok(generalSource.includes("isPermissionAutomationWarningDismissed(mode)"));
    assert.ok(i18nSource.includes("permissionAutomationAutoToolsDontShowAgain"));
    assert.ok(i18nSource.includes("permissionAutomationUnattendedDontShowAgain"));
    assert.ok(css.includes(".settings-confirm-checkbox"));
    assert.ok(coreSource.includes("checkboxLabel = \"\""));
    assert.ok(coreSource.includes('checkboxInput.type = "checkbox"'));
    assert.ok(coreSource.includes("checkboxChecked: !!(checkboxInput && checkboxInput.checked)"));
    assert.ok(css.includes("grid-template-columns: repeat(3, minmax(0, 1fr))"));
    assert.match(
      css,
      /\.permission-automation-segmented button\s*\{[^}]*min-height:\s*34px;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;[^}]*text-align:\s*center;/s
    );
    assert.match(
      css,
      /\.permission-automation-segmented button\.active\s*\{[^}]*font-weight:\s*600;/s
    );
    assert.ok(css.includes(".permission-automation-segmented button:not(.active):not(:disabled):hover"));
    assert.match(
      css,
      /\.permission-automation-segmented button:focus-visible\s*\{[^}]*outline-offset:\s*1px;/s
    );
    assert.ok(generalSource.includes("helpers.buildSegmentedRadio({"));
    assert.ok(generalSource.includes('ariaLabel: t("rowPermissionAutomation")'));
    assert.ok(generalSource.includes('className: "permission-automation-segmented"'));
    assert.ok(generalSource.includes("state.mountedControls.permissionAutomationMode"));
    assert.ok(i18nSource.includes('rowPermissionAutomation: "Permission request handling"'));
    assert.ok(i18nSource.includes('rowPermissionAutomation: "权限请求处理"'));
    assert.ok(i18nSource.includes("permissionAutomationAutoToolsConfirmTitle"));
    assert.ok(!generalSource.includes("autoApproveAllPermissions"));
    // Lives in its own Permissions section, not under Bubbles.
    assert.ok(generalSource.includes('t("sectionPermissions")'));
    assert.ok(i18nSource.includes('sectionPermissions: "Permissions"'));
  });

  it("patches confirmed permission automation changes without replacing the focused control", () => {
    const initialSnapshot = makeGeneralSnapshot({
      permissionAutomationMode: "off",
      permissionAutomationAutoToolsWarningDismissed: false,
    });
    const harness = loadGeneralTabForTest({ snapshot: initialSnapshot });
    harness.renderContent();
    const control = harness.content.querySelector(".permission-automation-segmented");
    const beforeRenderCount = harness.getContentRenderCount();
    const nextSnapshot = {
      ...initialSnapshot,
      permissionAutomationMode: "auto-tools",
      permissionAutomationAutoToolsWarningDismissed: true,
    };

    harness.core.ops.applyChanges({
      changes: {
        permissionAutomationMode: "auto-tools",
        permissionAutomationAutoToolsWarningDismissed: true,
      },
      snapshot: nextSnapshot,
    });

    assert.equal(harness.getContentRenderCount(), beforeRenderCount);
    assert.strictEqual(harness.content.querySelector(".permission-automation-segmented"), control);
    const selected = control.querySelectorAll("button")
      .find((button) => button.dataset.value === "auto-tools");
    assert.equal(selected.getAttribute("role"), "radio");
    assert.equal(selected.getAttribute("aria-checked"), "true");
    assert.equal(
      findAncestorByClass(control, "permission-automation-row").querySelector(".row-desc").textContent,
      harness.core.helpers.t("permissionAutomationAutoToolsDesc")
    );
  });

  it("clears successful switch transient state so rerenders do not keep wait cursors", () => {
    const coreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    assert.ok(
      /clearTransientState\(seq\);\s*setSwitchVisual\(sw,\s*nextVisual,\s*\{\s*pending:\s*false\s*\}\);/.test(coreSource),
      "successful switch actions must delete transient pending state before any later rerender"
    );
    assert.ok(
      !coreSource.includes("setTransientState({ visualOn: nextVisual, pending: false, seq });"),
      "leaving a non-pending transient row lets rerendered controls inherit stale pending state"
    );
  });

  it("clears settings-broadcast transient state before patching or rerendering", () => {
    const coreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    assert.ok(coreSource.includes("function clearTransientStateForChanges(changes)"));
    assert.ok(coreSource.includes("state.transientUiState.generalSwitches.delete(key);"));
    assert.ok(coreSource.includes('Object.prototype.hasOwnProperty.call(changes, "agents")'));
    assert.ok(coreSource.includes("state.transientUiState.agentSwitches.clear();"));
    const clearIndex = coreSource.indexOf("clearTransientStateForChanges(changes);");
    const patchIndex = coreSource.indexOf("activeTab.patchInPlace(changes");
    const renderIndex = coreSource.indexOf("requestRender({", patchIndex);
    assert.notStrictEqual(clearIndex, -1);
    assert.notStrictEqual(patchIndex, -1);
    assert.notStrictEqual(renderIndex, -1);
    assert.ok(clearIndex < patchIndex, "broadcast cleanup must happen before in-place patching");
    assert.ok(clearIndex < renderIndex, "broadcast cleanup must happen before full rerender");
  });

  it("renders the macOS menu bar and Dock recovery switches with the four-state safety matrix", () => {
    const cases = [
      { showTray: true, showDock: false, trayDisabled: true, dockDisabled: false },
      { showTray: true, showDock: true, trayDisabled: false, dockDisabled: false },
      { showTray: false, showDock: true, trayDisabled: false, dockDisabled: true },
      { showTray: false, showDock: false, trayDisabled: false, dockDisabled: false },
    ];

    for (const entry of cases) {
      const harness = loadGeneralTabForTest({
        platform: "MacIntel",
        snapshot: makeGeneralSnapshot({
          showTray: entry.showTray,
          showDock: entry.showDock,
        }),
      });
      harness.renderContent();

      const tray = harness.getSwitch("showTray");
      const dock = harness.getSwitch("showDock");
      assert.ok(tray, `showTray should render for ${JSON.stringify(entry)}`);
      assert.ok(dock, `showDock should render for ${JSON.stringify(entry)}`);
      assert.strictEqual(tray.getAttribute("role"), "switch");
      assert.strictEqual(dock.getAttribute("role"), "switch");
      assert.strictEqual(tray.getAttribute("aria-label"), "Show in menu bar");
      assert.strictEqual(dock.getAttribute("aria-label"), "Show in Dock");
      assert.strictEqual(tray.getAttribute("aria-checked"), String(entry.showTray));
      assert.strictEqual(dock.getAttribute("aria-checked"), String(entry.showDock));
      assert.strictEqual(tray.getAttribute("aria-disabled"), entry.trayDisabled ? "true" : undefined);
      assert.strictEqual(dock.getAttribute("aria-disabled"), entry.dockDisabled ? "true" : undefined);
      assert.strictEqual(tray.tabIndex, entry.trayDisabled ? -1 : 0);
      assert.strictEqual(dock.tabIndex, entry.dockDisabled ? -1 : 0);
    }

    const nonMac = loadGeneralTabForTest({
      platform: "Win32",
      snapshot: makeGeneralSnapshot({ showTray: true, showDock: false }),
    });
    nonMac.renderContent();
    assert.strictEqual(nonMac.getSwitch("showTray"), null);
    assert.strictEqual(nonMac.getSwitch("showDock"), null);
    const beforeNonMacRenderCount = nonMac.getContentRenderCount();
    nonMac.core.ops.applyChanges({
      changes: { showDock: true },
      snapshot: makeGeneralSnapshot({ showTray: true, showDock: true }),
    });
    assert.strictEqual(nonMac.getContentRenderCount(), beforeNonMacRenderCount + 1);
    assert.strictEqual(nonMac.getSwitch("showTray"), null);
    assert.strictEqual(nonMac.getSwitch("showDock"), null);
  });

  it("falls back to a full General render when a macOS recovery control is missing", () => {
    const initialSnapshot = makeGeneralSnapshot({ showTray: true, showDock: false });
    const harness = loadGeneralTabForTest({
      platform: "MacIntel",
      snapshot: initialSnapshot,
    });
    harness.renderContent();
    const originalTray = harness.getSwitch("showTray");
    const beforeRenderCount = harness.getContentRenderCount();
    harness.core.state.mountedControls.generalSwitches.delete("showDock");

    harness.core.ops.applyChanges({
      changes: { showDock: true },
      snapshot: { ...initialSnapshot, showDock: true },
    });

    assert.strictEqual(harness.getContentRenderCount(), beforeRenderCount + 1);
    assert.notStrictEqual(harness.getSwitch("showTray"), originalTray);
    assert.ok(harness.getSwitch("showDock"));
  });

  it("writes each macOS recovery switch through the exact Settings update key", async () => {
    for (const entry of [
      { snapshot: { showTray: false, showDock: true }, clickKey: "showTray" },
      { snapshot: { showTray: true, showDock: false }, clickKey: "showDock" },
    ]) {
      const updateCalls = [];
      const commandCalls = [];
      const harness = loadGeneralTabForTest({
        platform: "MacIntel",
        snapshot: makeGeneralSnapshot(entry.snapshot),
        settingsAPI: {
          update: (key, value) => {
            updateCalls.push({ key, value });
            return Promise.resolve({ status: "ok" });
          },
          command: (...args) => {
            commandCalls.push(args);
            return Promise.resolve({ status: "ok" });
          },
        },
      });
      harness.renderContent();
      harness.getSwitch(entry.clickKey).dispatchEvent({ type: "click" });
      await Promise.resolve();
      await Promise.resolve();

      assert.deepStrictEqual(updateCalls, [{ key: entry.clickKey, value: true }]);
      assert.deepStrictEqual(commandCalls, []);
    }
  });

  it("patches committed macOS entry-point changes in place and re-gates both switches", async () => {
    const updateCalls = [];
    const initialSnapshot = makeGeneralSnapshot({ showTray: true, showDock: false });
    const harness = loadGeneralTabForTest({
      platform: "MacIntel",
      snapshot: initialSnapshot,
      settingsAPI: {
        update: (key, value) => {
          updateCalls.push({ key, value });
          return Promise.resolve({ status: "ok" });
        },
      },
    });
    harness.renderContent();

    const tray = harness.getSwitch("showTray");
    const dock = harness.getSwitch("showDock");
    const beforeRenderCount = harness.getContentRenderCount();
    harness.content.scrollTop = 247;
    dock.focus();
    dock.dispatchEvent({ type: "click" });
    await Promise.resolve();
    await Promise.resolve();
    assert.deepStrictEqual(updateCalls, [{ key: "showDock", value: true }]);

    harness.core.ops.applyChanges({
      changes: { showDock: true },
      snapshot: { ...initialSnapshot, showDock: true },
    });

    assert.strictEqual(harness.getContentRenderCount(), beforeRenderCount);
    assert.strictEqual(harness.getSwitch("showTray"), tray);
    assert.strictEqual(harness.getSwitch("showDock"), dock);
    assert.strictEqual(dock.focused, true);
    assert.strictEqual(harness.content.scrollTop, 247);
    assert.strictEqual(tray.getAttribute("aria-disabled"), undefined);
    assert.strictEqual(tray.tabIndex, 0);
    assert.strictEqual(dock.getAttribute("aria-disabled"), undefined);

    harness.core.ops.applyChanges({
      changes: { showTray: false },
      snapshot: { ...initialSnapshot, showTray: false, showDock: true },
    });
    assert.strictEqual(harness.getContentRenderCount(), beforeRenderCount);
    assert.strictEqual(tray.getAttribute("aria-checked"), "false");
    assert.strictEqual(dock.getAttribute("aria-disabled"), "true");
    assert.strictEqual(dock.tabIndex, -1);
  });

  it("blocks mouse and keyboard activation for the last macOS entry point", async () => {
    const updateCalls = [];
    const harness = loadGeneralTabForTest({
      platform: "MacIntel",
      snapshot: makeGeneralSnapshot({ showTray: false, showDock: true }),
      settingsAPI: {
        update: (key, value) => {
          updateCalls.push({ key, value });
          return Promise.resolve({ status: "ok" });
        },
      },
    });
    harness.renderContent();
    const dock = harness.getSwitch("showDock");

    dock.dispatchEvent({ type: "click" });
    dock.dispatchEvent(createKeyboardEventForTest(" "));
    dock.dispatchEvent(createKeyboardEventForTest("Enter"));
    await Promise.resolve();
    await Promise.resolve();
    assert.deepStrictEqual(updateCalls, []);
  });

  it("restores a macOS recovery switch after a rejected Settings update", async () => {
    const harness = loadGeneralTabForTest({
      platform: "MacIntel",
      snapshot: makeGeneralSnapshot({ showTray: false, showDock: true }),
      settingsAPI: {
        update: () => Promise.reject(new Error("rejected")),
      },
    });
    harness.renderContent();
    const tray = harness.getSwitch("showTray");
    tray.dispatchEvent({ type: "click" });
    assert.strictEqual(tray.getAttribute("aria-checked"), "true");
    assert.strictEqual(tray.classList.contains("pending"), true);

    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(tray.getAttribute("aria-checked"), "false");
    assert.strictEqual(tray.classList.contains("pending"), false);
  });

  it("keeps macOS entry-point switches behind the Settings controller boundary", () => {
    const generalSource = fs.readFileSync(SETTINGS_TAB_GENERAL, "utf8");
    for (const forbidden of [
      /require\(["']electron["']\)/,
      /\bapp\.dock\b/,
      /\bcreateTray\s*\(/,
      /\bdestroyTray\s*\(/,
      /duck-prefs\.json/,
      /\bfs\.(?:writeFile|writeFileSync|promises\.writeFile)\b/,
    ]) {
      assert.doesNotMatch(generalSource, forbidden);
    }
  });

  it("updates runtime-only Settings bounds without rebuilding the active tab", () => {
    const initialSnapshot = makeGeneralSnapshot({ settingsWindowBounds: null });
    const harness = loadGeneralTabForTest({ snapshot: initialSnapshot });
    harness.renderContent();
    const mountedControl = harness.getSwitch("sessionHudEnabled");
    harness.content.scrollTop = 317;
    const bounds = { x: -1200, y: 80, width: 900, height: 640 };

    harness.core.ops.applyChanges({
      changes: { settingsWindowBounds: bounds },
      snapshot: { ...initialSnapshot, settingsWindowBounds: bounds },
    });

    assert.deepStrictEqual(harness.core.state.snapshot.settingsWindowBounds, bounds);
    assert.strictEqual(harness.getContentRenderCount(), 1);
    assert.strictEqual(harness.getSwitch("sessionHudEnabled"), mountedControl);
    assert.strictEqual(harness.content.scrollTop, 317);

    const dashboardBounds = { x: 220, y: 140, width: 640, height: 720 };
    harness.core.ops.applyChanges({
      changes: { dashboardWindowBounds: dashboardBounds },
      snapshot: { ...initialSnapshot, settingsWindowBounds: bounds, dashboardWindowBounds: dashboardBounds },
    });

    assert.deepStrictEqual(harness.core.state.snapshot.dashboardWindowBounds, dashboardBounds);
    assert.strictEqual(harness.getContentRenderCount(), 1);
    assert.strictEqual(harness.getSwitch("sessionHudEnabled"), mountedControl);
    assert.strictEqual(harness.content.scrollTop, 317);
  });

  it("patches the Session HUD master switch without rebuilding General content", async () => {
    const updateCalls = [];
    const initialSnapshot = {
      lang: "en",
      size: 50,
      sessionHudEnabled: false,
      sessionHudShowStateLabels: true,
      sessionHudShowElapsed: true,
      sessionHudShowContextUsage: true,
      sessionHudCleanupDetached: true,
      soundMuted: false,
      soundVolume: 0.5,
      lowPowerIdleMode: false,
      allowEdgePinning: true,
      keepSizeAcrossDisplays: true,
      manageClaudeHooksAutomatically: false,
      openAtLogin: false,
      autoStartWithClaude: false,
      hideBubbles: false,
      bubbleFollowPet: true,
      permissionBubblesEnabled: true,
      notificationBubbleAutoCloseSeconds: 8,
      updateBubbleAutoCloseSeconds: 12,
    };
    const harness = loadGeneralTabForTest({
      snapshot: initialSnapshot,
      settingsAPI: {
        update: (key, value) => {
          updateCalls.push({ key, value });
          return Promise.resolve({ status: "ok" });
        },
      },
    });
    harness.renderContent();

    const master = harness.getSwitch("sessionHudEnabled");
    const labels = harness.getSwitch("sessionHudShowStateLabels");
    const elapsed = harness.getSwitch("sessionHudShowElapsed");
    const contextUsage = harness.getSwitch("sessionHudShowContextUsage");
    const cleanup = harness.getSwitch("sessionHudCleanupDetached");
    const summary = harness.core.state.mountedControls.sessionHudSummary.element;
    const optionList = harness.content.querySelector(".session-hud-option-list");
    assert.ok(master);
    assert.ok(labels);
    assert.ok(elapsed);
    assert.ok(contextUsage);
    assert.ok(cleanup);
    assert.ok(optionList);
    assert.ok(optionList.children.every((child) => child.classList.contains("settings-option-item")));
    assert.strictEqual(harness.getSwitchMeta("sessionHudEnabled").row.querySelector(".row-desc"), null);
    assert.strictEqual(summary.children.length, 1);
    assert.strictEqual(summary.children[0].textContent, "HUD: off");
    assert.strictEqual(summary.classList.contains("compact"), true);
    assert.strictEqual(labels.classList.contains("disabled"), true);
    assert.strictEqual(labels.attributes["aria-disabled"], "true");
    assert.strictEqual(labels.tabIndex, -1);
    assert.strictEqual(elapsed.classList.contains("disabled"), true);
    assert.strictEqual(elapsed.attributes["aria-disabled"], "true");
    assert.strictEqual(elapsed.tabIndex, -1);
    assert.strictEqual(contextUsage.classList.contains("disabled"), true);
    assert.strictEqual(contextUsage.attributes["aria-disabled"], "true");
    assert.strictEqual(contextUsage.tabIndex, -1);

    const beforeRenderCount = harness.getContentRenderCount();
    harness.core.ops.applyChanges({
      changes: { sessionHudEnabled: true },
      snapshot: { ...initialSnapshot, sessionHudEnabled: true },
    });

    assert.strictEqual(
      harness.getContentRenderCount(),
      beforeRenderCount,
      "Session HUD master broadcasts should patch mounted controls instead of rebuilding General"
    );
    assert.strictEqual(harness.getSwitch("sessionHudEnabled"), master);
    assert.strictEqual(harness.getSwitch("sessionHudShowStateLabels"), labels);
    assert.strictEqual(harness.getSwitch("sessionHudShowElapsed"), elapsed);
    assert.strictEqual(harness.getSwitch("sessionHudShowContextUsage"), contextUsage);
    assert.strictEqual(harness.getSwitch("sessionHudCleanupDetached"), cleanup);
    assert.strictEqual(master.classList.contains("on"), true);
    assert.strictEqual(master.classList.contains("pending"), false);
    assert.strictEqual(labels.classList.contains("disabled"), false);
    assert.strictEqual(labels.attributes["aria-disabled"], undefined);
    assert.strictEqual(labels.tabIndex, 0);
    assert.strictEqual(elapsed.classList.contains("disabled"), false);
    assert.strictEqual(elapsed.attributes["aria-disabled"], undefined);
    assert.strictEqual(elapsed.tabIndex, 0);
    assert.strictEqual(contextUsage.classList.contains("disabled"), false);
    assert.strictEqual(contextUsage.attributes["aria-disabled"], undefined);
    assert.strictEqual(contextUsage.tabIndex, 0);
    assert.strictEqual(cleanup.classList.contains("disabled"), false);
    assert.strictEqual(cleanup.tabIndex, 0);
    assert.strictEqual(summary.children.length, 4);
    assert.strictEqual(summary.classList.contains("compact"), false);
    assert.strictEqual(summary.children[0].textContent, "Labels: on");
    assert.strictEqual(summary.children[1].textContent, "Time: on");
    assert.strictEqual(summary.children[2].textContent, "Context: on");
    assert.strictEqual(summary.children[3].textContent, "Auto-clear: on");

    assert.ok(
      elapsed.eventListeners.click && elapsed.eventListeners.click.length > 0,
      "Session HUD child switches must remain wired after being enabled in place"
    );
    elapsed.eventListeners.click[0]();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepStrictEqual(updateCalls, [{ key: "sessionHudShowElapsed", value: false }]);
  });

  it("keeps sound controls inert until the shared grid animation finishes", () => {
    const animationFrames = [];
    const harness = loadGeneralTabForTest({
      snapshot: makeGeneralSnapshot({ soundMuted: false, soundVolume: 0.5 }),
      requestAnimationFrame: (callback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      },
    });
    harness.renderContent();

    const group = harness.content.querySelector(".sound-collapsible");
    const header = group.querySelector(".collapsible-group-header");
    const body = group.querySelector(".collapsible-group-body");
    assert.equal(group.classList.contains("collapsed"), true);

    header.dispatchEvent({ type: "click" });

    assert.equal(group.classList.contains("expanding"), true);
    assert.equal(group.classList.contains("collapsed"), false);
    assert.equal(body.style.getPropertyValue("--collapsible-body-height"), "");
    assert.equal(body.attributes["aria-hidden"], "false");
    assert.equal(body.inert, true);

    body.dispatchEvent({
      type: "transitionend",
      propertyName: "grid-template-rows",
      bubbles: false,
    });
    assert.equal(group.classList.contains("expanding"), false);
    assert.equal(body.inert, false);
  });

  it("groups sound and volume into one collapsible control with in-place summary updates", () => {
    const initialSnapshot = makeGeneralSnapshot({
      soundMuted: false,
      soundVolume: 0.5,
    });
    const harness = loadGeneralTabForTest({ snapshot: initialSnapshot });
    harness.renderContent();

    const soundSwitch = harness.getSwitch("soundMuted");
    const summary = harness.core.state.mountedControls.soundSummary.element;
    const volumeControl = harness.core.state.mountedControls.soundVolume;
    const volumeSlider = volumeControl.row.querySelector(".volume-slider");
    const optionList = harness.content.querySelector(".sound-option-list");
    assert.ok(soundSwitch);
    assert.ok(summary);
    assert.ok(volumeControl);
    assert.ok(volumeSlider);
    assert.ok(optionList);
    assert.ok(optionList.children.every((child) => child.classList.contains("settings-option-item")));
    assert.strictEqual(harness.getSwitchMeta("soundMuted").row.querySelector(".row-desc"), null);
    assert.strictEqual(summary.children.length, 2);
    assert.strictEqual(summary.children[0].textContent, "on · 50%");
    assert.ok(summary.children[1].classList.contains("sound-header-switch"));
    assert.strictEqual(summary.children[1].attributes["aria-label"], "Enable sound effects");

    volumeSlider.value = "75";
    for (const listener of volumeSlider.eventListeners.input || []) listener();
    assert.strictEqual(summary.children[0].textContent, "on · 75%");

    const beforeRenderCount = harness.getContentRenderCount();
    harness.core.ops.applyChanges({
      changes: { soundVolume: 0.25 },
      snapshot: { ...initialSnapshot, soundVolume: 0.25 },
    });

    assert.strictEqual(harness.getContentRenderCount(), beforeRenderCount);
    assert.strictEqual(harness.core.state.mountedControls.soundSummary.element, summary);
    assert.strictEqual(volumeSlider.value, "25");
    assert.strictEqual(volumeSlider.style.getPropertyValue("--volume-fill"), "25%");
    assert.strictEqual(summary.children[0].textContent, "on · 25%");

    harness.core.ops.applyChanges({
      changes: { soundMuted: true },
      snapshot: { ...initialSnapshot, soundMuted: true, soundVolume: 0.25 },
    });

    assert.strictEqual(harness.getContentRenderCount(), beforeRenderCount);
    assert.strictEqual(harness.getSwitch("soundMuted"), soundSwitch);
    assert.strictEqual(soundSwitch.classList.contains("on"), false);
    assert.strictEqual(summary.children[1].classList.contains("on"), false);
    assert.strictEqual(volumeSlider.disabled, true);
    assert.strictEqual(summary.children[0].textContent, "off · 25%");
  });

  it("lets the sound summary switch toggle sound without opening the collapsible group", async () => {
    const updateCalls = [];
    const initialSnapshot = makeGeneralSnapshot({
      soundMuted: false,
      soundVolume: 1,
    });
    const harness = loadGeneralTabForTest({
      snapshot: initialSnapshot,
      settingsAPI: {
        update: (key, value) => {
          updateCalls.push({ key, value });
          return Promise.resolve({ status: "ok" });
        },
      },
    });
    harness.renderContent();

    const summary = harness.core.state.mountedControls.soundSummary;
    const headerSwitch = summary.headerSwitch;
    const soundGroup = harness.content.querySelector(".sound-collapsible");
    assert.ok(headerSwitch);
    assert.ok(soundGroup.classList.contains("collapsed"));

    let stopped = false;
    let prevented = false;
    headerSwitch.eventListeners.click[0]({
      stopPropagation: () => { stopped = true; },
      preventDefault: () => { prevented = true; },
    });
    assert.strictEqual(headerSwitch.classList.contains("pending"), true);
    assert.strictEqual(harness.getSwitch("soundMuted").classList.contains("pending"), true);
    assert.strictEqual(summary.element.children[0].textContent, "off · 100%");
    headerSwitch.eventListeners.click[0]({
      stopPropagation: () => {},
      preventDefault: () => {},
    });
    await Promise.resolve();
    await Promise.resolve();

    assert.deepStrictEqual(updateCalls, [{ key: "soundMuted", value: true }]);
    assert.strictEqual(stopped, true);
    assert.strictEqual(prevented, true);
    assert.ok(soundGroup.classList.contains("collapsed"));
    assert.strictEqual(headerSwitch.classList.contains("on"), false);
    assert.strictEqual(headerSwitch.classList.contains("pending"), false);
    assert.strictEqual(summary.element.children[0].textContent, "off · 100%");
  });

  it("keeps the sound child switch and summary in sync while the update is pending", async () => {
    const updateCalls = [];
    let resolveUpdate = null;
    const initialSnapshot = makeGeneralSnapshot({
      soundMuted: false,
      soundVolume: 1,
    });
    const harness = loadGeneralTabForTest({
      snapshot: initialSnapshot,
      settingsAPI: {
        update: (key, value) => {
          updateCalls.push({ key, value });
          return new Promise((resolve) => {
            resolveUpdate = resolve;
          });
        },
      },
    });
    harness.renderContent();

    const summary = harness.core.state.mountedControls.soundSummary;
    const headerSwitch = summary.headerSwitch;
    const childSwitch = harness.getSwitch("soundMuted");
    let stopped = false;
    let prevented = false;
    childSwitch.eventListeners.click[0]({
      stopPropagation: () => { stopped = true; },
      preventDefault: () => { prevented = true; },
    });

    assert.deepStrictEqual(updateCalls, [{ key: "soundMuted", value: true }]);
    assert.strictEqual(stopped, true);
    assert.strictEqual(prevented, true);
    assert.strictEqual(childSwitch.classList.contains("on"), false);
    assert.strictEqual(childSwitch.classList.contains("pending"), true);
    assert.strictEqual(headerSwitch.classList.contains("on"), false);
    assert.strictEqual(headerSwitch.classList.contains("pending"), true);
    assert.strictEqual(summary.element.children[0].textContent, "off · 100%");

    resolveUpdate({ status: "ok" });
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(childSwitch.classList.contains("on"), false);
    assert.strictEqual(childSwitch.classList.contains("pending"), false);
    assert.strictEqual(headerSwitch.classList.contains("on"), false);
    assert.strictEqual(headerSwitch.classList.contains("pending"), false);
    assert.strictEqual(summary.element.children[0].textContent, "off · 100%");
    assert.strictEqual(harness.core.state.transientUiState.generalSwitches.has("soundMuted"), false);
  });

  it("restores the sound summary switch when a toggle is a noop", async () => {
    const updateCalls = [];
    const initialSnapshot = makeGeneralSnapshot({
      soundMuted: false,
      soundVolume: 1,
    });
    const harness = loadGeneralTabForTest({
      snapshot: initialSnapshot,
      settingsAPI: {
        update: (key, value) => {
          updateCalls.push({ key, value });
          return Promise.resolve({ status: "ok", noop: true });
        },
      },
    });
    harness.renderContent();

    const summary = harness.core.state.mountedControls.soundSummary;
    const headerSwitch = summary.headerSwitch;
    const childSwitch = harness.getSwitch("soundMuted");
    headerSwitch.eventListeners.click[0]({
      stopPropagation: () => {},
      preventDefault: () => {},
    });
    await Promise.resolve();
    await Promise.resolve();

    assert.deepStrictEqual(updateCalls, [{ key: "soundMuted", value: true }]);
    assert.strictEqual(headerSwitch.classList.contains("on"), true);
    assert.strictEqual(headerSwitch.classList.contains("pending"), false);
    assert.strictEqual(childSwitch.classList.contains("on"), true);
    assert.strictEqual(childSwitch.classList.contains("pending"), false);
    assert.strictEqual(summary.element.children[0].textContent, "on · 100%");
    assert.strictEqual(harness.core.state.transientUiState.generalSwitches.has("soundMuted"), false);
  });

  it("renders Claude hook management in the Agents claude-code group with autoStart gated", () => {
    const harness = loadAgentsTabForTest({
      snapshot: {
        manageClaudeHooksAutomatically: false,
        autoStartWithClaude: true,
        agents: { "claude-code": { integrationInstalled: true, enabled: true } },
      },
      agentMetadata: [
        { id: "claude-code", name: "Claude Code", eventSource: "hook", capabilities: {} },
      ],
    });

    harness.core.ops.requestRender({ content: true });

    const manage = harness.core.state.mountedControls.generalSwitches.get("manageClaudeHooksAutomatically");
    const autoStart = harness.core.state.mountedControls.generalSwitches.get("autoStartWithClaude");
    assert.ok(manage, "manage-hooks switch should mount inside the Agents claude-code group");
    assert.ok(autoStart, "autoStart switch should mount inside the Agents claude-code group");
    // Master is off, so the child autoStart is disabled at render time (D2: Agents
    // does a full rebuild on these keys instead of an in-place patch).
    assert.strictEqual(autoStart.element.classList.contains("disabled"), true);
    assert.ok(autoStart.extraElement, "autoStart shows the disabled note when management is off");
  });

  it("re-gates autoStart when Claude hook management toggles via applyChanges (D2 full rebuild)", () => {
    const baseSnapshot = {
      manageClaudeHooksAutomatically: true,
      autoStartWithClaude: true,
      agents: { "claude-code": { integrationInstalled: true, enabled: true } },
    };
    const harness = loadAgentsTabForTest({
      snapshot: { ...baseSnapshot },
      agentMetadata: [
        { id: "claude-code", name: "Claude Code", eventSource: "hook", capabilities: {} },
      ],
    });

    harness.core.ops.requestRender({ content: true });

    // Master is on, so the child autoStart starts enabled with no disabled note.
    let autoStart = harness.core.state.mountedControls.generalSwitches.get("autoStartWithClaude");
    assert.ok(autoStart, "autoStart switch should mount inside the Agents claude-code group");
    assert.strictEqual(autoStart.element.classList.contains("disabled"), false);
    assert.strictEqual(autoStart.extraElement, null);

    // Turning management off is not an `agents` patch, so Agents falls through to a
    // full rebuild (D2) — the rebuilt child must come back disabled with the note.
    harness.core.ops.applyChanges({
      changes: { manageClaudeHooksAutomatically: false },
      snapshot: { ...baseSnapshot, manageClaudeHooksAutomatically: false },
    });

    autoStart = harness.core.state.mountedControls.generalSwitches.get("autoStartWithClaude");
    assert.ok(autoStart, "autoStart switch should remount after the rebuild");
    assert.strictEqual(autoStart.element.classList.contains("disabled"), true);
    assert.ok(autoStart.extraElement, "autoStart shows the disabled note after management is turned off");

    // Turning management back on re-enables the child and drops the note.
    harness.core.ops.applyChanges({
      changes: { manageClaudeHooksAutomatically: true },
      snapshot: { ...baseSnapshot, manageClaudeHooksAutomatically: true },
    });

    autoStart = harness.core.state.mountedControls.generalSwitches.get("autoStartWithClaude");
    assert.strictEqual(autoStart.element.classList.contains("disabled"), false);
    assert.strictEqual(autoStart.extraElement, null);
  });

  it("keeps Start with Codex independent and commits through the preference API", async () => {
    const updates = [];
    const harness = loadAgentsTabForTest({
      snapshot: {
        autoStartWithCodex: false,
        agents: { codex: { integrationInstalled: true, enabled: false, permissionMode: "intercept" } },
      },
      agentMetadata: [
        { id: "codex", name: "Codex", eventSource: "hook", capabilities: {} },
      ],
      settingsAPI: {
        update(key, value) {
          updates.push({ key, value });
          return Promise.resolve({ status: "ok" });
        },
      },
    });

    harness.core.ops.requestRender({ content: true });

    const autoStart = harness.core.state.mountedControls.generalSwitches.get("autoStartWithCodex");
    assert.ok(autoStart, "Start with Codex should mount inside the Codex group");
    assert.strictEqual(autoStart.element.classList.contains("on"), false);
    assert.strictEqual(autoStart.element.classList.contains("disabled"), false);
    assert.strictEqual(autoStart.row.querySelector(".row-label").textContent, "Start with Codex");

    autoStart.element.dispatchEvent({ type: "click" });
    await Promise.resolve();
    assert.deepStrictEqual(updates, [{ key: "autoStartWithCodex", value: true }]);
  });

  it("patches hide-bubbles aggregate changes without rebuilding General content", () => {
    const initialSnapshot = {
      lang: "en",
      size: 50,
      sessionHudEnabled: true,
      sessionHudShowStateLabels: true,
      sessionHudShowElapsed: true,
      sessionHudCleanupDetached: true,
      soundMuted: false,
      soundVolume: 0.5,
      lowPowerIdleMode: false,
      allowEdgePinning: true,
      keepSizeAcrossDisplays: true,
      manageClaudeHooksAutomatically: true,
      openAtLogin: false,
      autoStartWithClaude: false,
      hideBubbles: false,
      bubbleFollowPet: true,
      permissionBubblesEnabled: true,
      notificationBubbleAutoCloseSeconds: 8,
      updateBubbleAutoCloseSeconds: 12,
    };
    const harness = loadGeneralTabForTest({ snapshot: initialSnapshot });
    harness.renderContent();

    const aggregate = harness.getSwitch("hideBubbles");
    const notificationPolicy = harness.core.state.mountedControls.bubblePolicyControls.get("notificationBubbleAutoCloseSeconds");
    const notificationSwitch = notificationPolicy.row.querySelector(".switch");
    const notificationSeconds = notificationPolicy.row.querySelector("input");
    assert.ok(aggregate);
    assert.ok(notificationSwitch);
    assert.ok(notificationSeconds);
    assert.strictEqual(notificationSwitch.classList.contains("on"), true);
    assert.strictEqual(notificationSeconds.disabled, false);

    const beforeRenderCount = harness.getContentRenderCount();
    harness.core.ops.applyChanges({
      changes: { hideBubbles: true },
      snapshot: { ...initialSnapshot, hideBubbles: true },
    });

    assert.strictEqual(
      harness.getContentRenderCount(),
      beforeRenderCount,
      "hide-bubbles broadcasts should patch summary and category controls in place"
    );
    assert.strictEqual(harness.getSwitch("hideBubbles"), aggregate);
    assert.strictEqual(aggregate.classList.contains("on"), true);
    assert.strictEqual(notificationSwitch.classList.contains("on"), false);
    assert.strictEqual(notificationSeconds.disabled, true);
  });

  it("patches the Session HUD master switch off without rebuilding General content", async () => {
    const updateCalls = [];
    const initialSnapshot = makeGeneralSnapshot({ sessionHudEnabled: true });
    const harness = loadGeneralTabForTest({
      snapshot: initialSnapshot,
      settingsAPI: {
        update: (key, value) => {
          updateCalls.push({ key, value });
          return Promise.resolve({ status: "ok" });
        },
      },
    });
    harness.renderContent();

    const master = harness.getSwitch("sessionHudEnabled");
    const labels = harness.getSwitch("sessionHudShowStateLabels");
    const elapsed = harness.getSwitch("sessionHudShowElapsed");
    const cleanup = harness.getSwitch("sessionHudCleanupDetached");
    assert.ok(master);
    assert.ok(labels);
    assert.ok(elapsed);
    assert.ok(cleanup);
    assert.strictEqual(labels.classList.contains("disabled"), false);
    assert.strictEqual(elapsed.classList.contains("disabled"), false);
    assert.strictEqual(cleanup.classList.contains("disabled"), false);

    const beforeRenderCount = harness.getContentRenderCount();
    harness.core.ops.applyChanges({
      changes: { sessionHudEnabled: false },
      snapshot: { ...initialSnapshot, sessionHudEnabled: false },
    });

    assert.strictEqual(harness.getContentRenderCount(), beforeRenderCount);
    assert.strictEqual(harness.getSwitch("sessionHudEnabled"), master);
    assert.strictEqual(harness.getSwitch("sessionHudShowStateLabels"), labels);
    assert.strictEqual(harness.getSwitch("sessionHudShowElapsed"), elapsed);
    assert.strictEqual(harness.getSwitch("sessionHudCleanupDetached"), cleanup);
    assert.strictEqual(master.classList.contains("on"), false);
    assert.strictEqual(labels.classList.contains("disabled"), true);
    assert.strictEqual(labels.attributes["aria-disabled"], "true");
    assert.strictEqual(labels.tabIndex, -1);
    assert.strictEqual(elapsed.classList.contains("disabled"), true);
    assert.strictEqual(elapsed.attributes["aria-disabled"], "true");
    assert.strictEqual(elapsed.tabIndex, -1);
    assert.strictEqual(cleanup.classList.contains("disabled"), true);
    assert.strictEqual(cleanup.attributes["aria-disabled"], "true");
    assert.strictEqual(cleanup.tabIndex, -1);

    elapsed.eventListeners.click[0]();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepStrictEqual(updateCalls, []);
  });

  it("moves Claude hook management out of General into the Agents claude-code group", () => {
    const generalSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-general.js"), "utf8");
    const agentsSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-agents.js"), "utf8");
    // No longer rendered or patched by the General tab.
    assert.ok(!generalSource.includes('key: "manageClaudeHooksAutomatically"'));
    assert.ok(!generalSource.includes('key: "autoStartWithClaude"'));
    assert.ok(!generalSource.includes("CLAUDE_HOOK_MANAGEMENT_CHILD_SWITCH_KEYS"));
    assert.ok(!generalSource.includes("manageClaudeHooksAutomatically"));
    // Built in the Agents claude-code group as top-level pref rows.
    assert.ok(agentsSource.includes("buildClaudeHookManagementRows"));
    assert.ok(agentsSource.includes('agent.id === "claude-code"'));
    assert.ok(agentsSource.includes('key: "manageClaudeHooksAutomatically"'));
    assert.ok(agentsSource.includes('key: "autoStartWithClaude"'));
    assert.ok(agentsSource.includes("rowManageClaudeHooks"));
    assert.ok(agentsSource.includes("rowStartWithClaude"));
    // autoStart stays gated on the master (disabled + extra note computed at render).
    assert.ok(agentsSource.includes("disabled: !manageHooksEnabled"));
    assert.ok(agentsSource.includes('descExtraKey: manageHooksEnabled ? null : "rowStartWithClaudeDisabledDesc"'));
    // Confirm/disconnect flows moved with the switches.
    assert.ok(agentsSource.includes("confirmDisableClaudeHookManagement"));
    assert.ok(agentsSource.includes("runDisconnectClaudeHooks"));
  });

  it("keeps every provider's quota collection opt-in on its own Agents card", () => {
    const generalSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-general.js"), "utf8");
    const agentsSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-agents.js"), "utf8");
    // Collection is per-provider and lives on that provider's own agent card,
    // so one page answers "which providers am I reading from".
    assert.ok(!generalSource.includes('key: "claudeQuotaCollectionEnabled"'));
    assert.ok(agentsSource.includes('key: "claudeQuotaCollectionEnabled"'));
    assert.ok(agentsSource.includes("rowClaudeQuotaCollection"));
    // A stale entry here would make General try to patch a control it no
    // longer renders instead of falling through to a full re-render.
    const inPlaceKeys = generalSource.slice(0, generalSource.indexOf("]);"));
    assert.ok(!inPlaceKeys.includes('"claudeQuotaCollectionEnabled"'));
  });

  it("patches hide-bubbles aggregate off without rebuilding General content", () => {
    const initialSnapshot = makeGeneralSnapshot({ hideBubbles: true });
    const harness = loadGeneralTabForTest({ snapshot: initialSnapshot });
    harness.renderContent();

    const aggregate = harness.getSwitch("hideBubbles");
    const notificationPolicy = harness.core.state.mountedControls.bubblePolicyControls.get("notificationBubbleAutoCloseSeconds");
    const notificationSwitch = notificationPolicy.row.querySelector(".switch");
    const notificationSeconds = notificationPolicy.row.querySelector("input");
    const summary = harness.core.state.mountedControls.bubblePolicySummary.element;
    assert.ok(aggregate);
    assert.strictEqual(aggregate.classList.contains("on"), true);
    assert.strictEqual(notificationSwitch.classList.contains("on"), false);
    assert.strictEqual(notificationSeconds.disabled, true);
    assert.ok(summary.children.every((chip) => !chip.classList.contains("accent")));

    const beforeRenderCount = harness.getContentRenderCount();
    harness.core.ops.applyChanges({
      changes: { hideBubbles: false },
      snapshot: { ...initialSnapshot, hideBubbles: false },
    });

    assert.strictEqual(harness.getContentRenderCount(), beforeRenderCount);
    assert.strictEqual(harness.getSwitch("hideBubbles"), aggregate);
    assert.strictEqual(aggregate.classList.contains("on"), false);
    assert.strictEqual(notificationSwitch.classList.contains("on"), true);
    assert.strictEqual(notificationSeconds.disabled, false);
    assert.strictEqual(notificationSeconds.value, "8");
    assert.strictEqual(summary.children.length, 3);
    assert.ok(summary.children.every((chip) => chip.classList.contains("accent")));
  });

  it("rerenders General content for mixed non-patchable broadcasts", () => {
    const initialSnapshot = makeGeneralSnapshot({
      lang: "en",
      sessionHudEnabled: false,
    });
    const harness = loadGeneralTabForTest({ snapshot: initialSnapshot });
    harness.renderContent();

    const master = harness.getSwitch("sessionHudEnabled");
    const beforeRenderCount = harness.getContentRenderCount();
    harness.core.ops.applyChanges({
      changes: { sessionHudEnabled: true, lang: "zh" },
      snapshot: { ...initialSnapshot, sessionHudEnabled: true, lang: "zh" },
    });

    assert.strictEqual(harness.getContentRenderCount(), beforeRenderCount + 1);
    assert.notStrictEqual(harness.getSwitch("sessionHudEnabled"), master);
    assert.strictEqual(harness.getSwitch("sessionHudEnabled").classList.contains("on"), true);
  });

  it("patches combined bubble aggregate and seconds broadcasts in place", () => {
    const initialSnapshot = makeGeneralSnapshot({
      hideBubbles: false,
      notificationBubbleAutoCloseSeconds: 8,
    });
    const harness = loadGeneralTabForTest({ snapshot: initialSnapshot });
    harness.renderContent();

    const aggregate = harness.getSwitch("hideBubbles");
    const notificationPolicy = harness.core.state.mountedControls.bubblePolicyControls.get("notificationBubbleAutoCloseSeconds");
    const notificationSwitch = notificationPolicy.row.querySelector(".switch");
    const notificationSeconds = notificationPolicy.row.querySelector("input");

    const beforeRenderCount = harness.getContentRenderCount();
    harness.core.ops.applyChanges({
      changes: { hideBubbles: true, notificationBubbleAutoCloseSeconds: 0 },
      snapshot: {
        ...initialSnapshot,
        hideBubbles: true,
        notificationBubbleAutoCloseSeconds: 0,
      },
    });

    assert.strictEqual(harness.getContentRenderCount(), beforeRenderCount);
    assert.strictEqual(harness.getSwitch("hideBubbles"), aggregate);
    assert.strictEqual(aggregate.classList.contains("on"), true);
    assert.strictEqual(notificationSwitch.classList.contains("on"), false);
    assert.strictEqual(notificationSeconds.disabled, true);
    assert.strictEqual(notificationSeconds.value, "0");
  });

  it("patches pure bubble policy seconds broadcasts in place", () => {
    const initialSnapshot = makeGeneralSnapshot({
      hideBubbles: false,
      notificationBubbleAutoCloseSeconds: 0,
    });
    const harness = loadGeneralTabForTest({ snapshot: initialSnapshot });
    harness.renderContent();

    const notificationPolicy = harness.core.state.mountedControls.bubblePolicyControls.get("notificationBubbleAutoCloseSeconds");
    const notificationSwitch = notificationPolicy.row.querySelector(".switch");
    const notificationSeconds = notificationPolicy.row.querySelector("input");
    const summary = harness.core.state.mountedControls.bubblePolicySummary.element;
    assert.strictEqual(notificationSwitch.classList.contains("on"), false);
    assert.strictEqual(notificationSeconds.disabled, true);

    const beforeRenderCount = harness.getContentRenderCount();
    harness.core.ops.applyChanges({
      changes: { notificationBubbleAutoCloseSeconds: 5 },
      snapshot: { ...initialSnapshot, notificationBubbleAutoCloseSeconds: 5 },
    });

    assert.strictEqual(harness.getContentRenderCount(), beforeRenderCount);
    assert.strictEqual(notificationSwitch.classList.contains("on"), true);
    assert.strictEqual(notificationSeconds.disabled, false);
    assert.strictEqual(notificationSeconds.value, "5");
    assert.strictEqual(summary.children[1].classList.contains("accent"), true);
  });

  it("uses a roomier grid layout for Settings confirmation buttons", () => {
    const coreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    assert.ok(/\.settings-confirm-modal\s*\{[\s\S]*width:\s*min\(480px,\s*100%\);/.test(css));
    assert.ok(/\.settings-confirm-actions\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(136px,\s*1fr\)\);[\s\S]*gap:\s*9px;/.test(css));
    assert.ok(/\.settings-confirm-actions\s+\.soft-btn\s*\{[\s\S]*min-height:\s*42px;[\s\S]*padding:\s*6px 10px;[\s\S]*white-space:\s*normal;[\s\S]*text-align:\s*center;/.test(css));
    assert.ok(coreSource.includes('createElementNS("http://www.w3.org/2000/svg", tagName)'));
    assert.ok(coreSource.includes('path.setAttribute("d", "M10 4.2v7.4m0 3.1v.1")'));
    assert.ok(coreSource.includes('String(iconText) === "!"'));
    assert.ok(/\.settings-confirm-icon\s*\{[\s\S]*background:\s*var\(--warning-action\);/.test(css));
    assert.ok(/\.settings-confirm-icon path\s*\{[\s\S]*stroke:\s*currentColor;[\s\S]*stroke-linecap:\s*round;/.test(css));
    assert.ok(/\.settings-confirm-actions\s+\.soft-btn\.settings-confirm-danger\s*\{[\s\S]*color:\s*#ffffff;[\s\S]*background:\s*var\(--danger-action\);[\s\S]*border-color:\s*var\(--danger-action\);/.test(css));
    assert.ok(/\.settings-confirm-checkbox\s*\{[\s\S]*padding:\s*10px 11px;[\s\S]*border-radius:\s*9px;[\s\S]*cursor:\s*pointer;/.test(css));
    assert.ok(/\.settings-confirm-checkbox input:checked\s*\{[\s\S]*background:\s*var\(--accent\);/.test(css));
    assert.ok(css.includes(".settings-confirm-checkbox:has(input:checked)"));
    assert.ok(css.includes(".settings-confirm-checkbox:focus-within"));
  });

  it("uses one disclosure controller for specialized Settings surfaces", () => {
    const documentBody = new FakeElement("body");
    const document = {
      body: documentBody,
      createElement: (tagName) => new FakeElement(tagName),
      getElementById: () => null,
    };
    const raf = createQueuedRaf();
    const core = loadSettingsCoreForTest({}, {
      document,
      requestAnimationFrame: raf.requestAnimationFrame,
    });
    const root = document.createElement("div");
    const trigger = document.createElement("div");
    const body = document.createElement("div");
    const inner = document.createElement("div");
    inner.className = "settings-disclosure-body-inner";
    body.appendChild(inner);
    root.appendChild(trigger);
    root.appendChild(body);
    documentBody.appendChild(root);
    const changes = [];
    const controller = core.helpers.attachSettingsDisclosure({
      root,
      trigger,
      body,
      expanded: false,
      onExpandedChange(nextExpanded, options) {
        changes.push({ nextExpanded, persist: options.persist });
      },
    });

    assert.equal(trigger.getAttribute("role"), "button");
    assert.equal(trigger.getAttribute("tabindex"), "0");
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(trigger.getAttribute("aria-controls"), body.getAttribute("id"));
    assert.equal(body.getAttribute("aria-hidden"), "true");
    assert.equal(body.inert, true);

    trigger.dispatchEvent({ type: "keydown", key: "Enter" });
    assert.equal(controller.expanded, true);
    assert.equal(root.classList.contains("expanding"), true);
    assert.equal(body.getAttribute("aria-hidden"), "false");
    assert.equal(body.inert, true);
    trigger.click();
    trigger.click();
    trigger.click();
    trigger.click();
    assert.equal(controller.expanded, true, "five total toggles must end expanded");
    body.dispatchEvent({ type: "transitioncancel", propertyName: "grid-template-rows", bubbles: false });
    assert.equal(root.classList.contains("expanding"), true);
    assert.equal(root.classList.contains("collapsing"), false);
    assert.equal(body.inert, true);
    body.dispatchEvent({ type: "transitionend", propertyName: "grid-template-rows", bubbles: false });
    assert.equal(root.classList.contains("expanding"), false);
    assert.equal(root.classList.contains("collapsing"), false);
    assert.equal(body.inert, false);

    controller.collapse({ animate: false, persist: false });
    assert.equal(root.classList.contains("settings-disclosure-no-motion"), true);
    assert.deepStrictEqual(changes.at(-1), { nextExpanded: false, persist: false });
    raf.flush();
    assert.equal(root.classList.contains("settings-disclosure-no-motion"), false);
    controller.dispose();
    trigger.click();
    assert.equal(controller.expanded, false, "disposed triggers must not keep toggling");

    const reducedCore = loadSettingsCoreForTest({}, {
      document,
      matchMedia: () => ({ matches: true }),
      requestAnimationFrame: raf.requestAnimationFrame,
    });
    const reducedRoot = document.createElement("div");
    const reducedTrigger = document.createElement("div");
    const reducedBody = document.createElement("div");
    const reducedInner = document.createElement("div");
    reducedInner.className = "settings-disclosure-body-inner";
    reducedBody.appendChild(reducedInner);
    reducedRoot.appendChild(reducedTrigger);
    reducedRoot.appendChild(reducedBody);
    const reducedController = reducedCore.helpers.attachSettingsDisclosure({
      root: reducedRoot,
      trigger: reducedTrigger,
      body: reducedBody,
      expanded: false,
    });
    reducedTrigger.click();
    assert.equal(reducedController.expanded, true);
    assert.equal(reducedRoot.classList.contains("expanding"), false);
    assert.equal(reducedRoot.classList.contains("settings-disclosure-no-motion"), false);
    reducedController.dispose();
  });

  it("routes every Settings disclosure implementation through the shared controller", () => {
    const coreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    const doctorSource = fs.readFileSync(SETTINGS_DOCTOR_MODAL, "utf8");
    const animSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-anim-overrides.js"), "utf8");
    const aboutSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-about.js"), "utf8");
    assert.ok(coreSource.includes("const controller = attachSettingsDisclosure({"));
    assert.ok(doctorSource.includes("core.helpers.attachSettingsDisclosure({"));
    assert.ok(animSource.includes("helpers.attachSettingsDisclosure({"));
    assert.ok(aboutSource.includes("helpers.attachSettingsDisclosure({"));
    const rendererSources = fs.readdirSync(SRC_DIR)
      .filter((name) => /^settings(?:-.+)?\.js$/.test(name) || name === "settings.html")
      .map((name) => ({ name, source: fs.readFileSync(path.join(SRC_DIR, name), "utf8") }));
    for (const { name, source } of rendererSources) {
      assert.ok(!/createElement\(\s*["']details["']\s*\)/.test(source), `${name} must not create native details`);
      assert.ok(!/<details(?:\s|>)/i.test(source), `${name} must not render native details markup`);
      assert.ok(!/addEventListener\(\s*["']toggle["']/.test(source), `${name} must not own a disclosure toggle state machine`);
    }
    assert.ok(doctorSource.indexOf("disposeDoctorDisclosures();") < doctorSource.indexOf("rootEl.innerHTML = ("));
    assert.ok(/function closeModal\(\) \{\s*disposeDoctorDisclosures\(\);/.test(doctorSource));
  });

  it("groups Theme cards and exposes theme import actions in Settings", () => {
    const tabSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-theme.js"), "utf8");
    const generalSource = fs.readFileSync(SETTINGS_TAB_GENERAL, "utf8");
    const preloadSource = fs.readFileSync(PRELOAD_SETTINGS, "utf8");
    const settingsIpcSource = fs.readFileSync(SETTINGS_IPC, "utf8");
    const coreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    const i18nSource = fs.readFileSync(SETTINGS_I18N, "utf8");

    assert.ok(tabSource.includes("function getThemeSections(themes)"));
    assert.ok(tabSource.includes("themeGroupBuiltIn"));
    assert.ok(tabSource.includes("themeGroupImportedCodexPets"));
    assert.ok(tabSource.includes("themeGroupUserThemes"));
    assert.ok(tabSource.includes("handleImportCodexPetZip"));
    assert.ok(tabSource.includes("handleImportUserThemeZip"));
    assert.ok(!tabSource.includes("themeOpenCodexPetsFolder"));
    assert.ok(!tabSource.includes("handleOpenCodexPetsFolder"));
    assert.ok(tabSource.includes("handleOpenUserThemesFolder"));
    assert.ok(tabSource.includes("handleRefreshThemes"));
    assert.ok(tabSource.includes("handleRemoveCodexPet"));
    assert.ok(tabSource.includes("themeUninstallPetLabel"));
    assert.ok(tabSource.includes('footer.className = "theme-card-footer";'));
    assert.ok(tabSource.includes('btn.className = "theme-customize-btn";'));
    assert.ok(tabSource.includes("function renderThemeDetail(parent, theme)"));
    assert.ok(tabSource.includes("function supportsThemeCustomization(theme)"));
    assert.ok(!generalSource.includes("rowPetColor"));
    assert.ok(!generalSource.includes("petTint"));
    assert.ok(tabSource.includes('caps.powerProfile === "scripted"'));
    assert.ok(tabSource.includes("themeCapabilityFineMotion"));
    assert.ok(tabSource.includes('if (!theme.active) indicator.setAttribute("aria-hidden", "true");'));
    assert.ok(!tabSource.includes("if (theme.active || canDelete || canRemoveCodexPet)"));
    assert.ok(coreSource.includes("codexPetZipImportPending"));
    assert.ok(coreSource.includes("userThemeZipImportPending"));
    assert.ok(coreSource.includes("codexPetRemovalPendingThemeId"));
    assert.ok(preloadSource.includes("openUserThemesDir"));
    assert.ok(preloadSource.includes("importUserThemeZip"));
    assert.ok(preloadSource.includes("openCodexPetsDir"));
    assert.ok(preloadSource.includes("importCodexPetZip"));
    assert.ok(preloadSource.includes("removeCodexPet"));
    assert.ok(settingsIpcSource.includes('handle("settings:open-user-themes-dir"'));
    assert.ok(settingsIpcSource.includes('handle("settings:import-user-theme-zip"'));
    assert.ok(settingsIpcSource.includes('handle("settings:open-codex-pets-dir"'));
    assert.ok(settingsIpcSource.includes('handle("settings:import-codex-pet-zip"'));
    assert.ok(settingsIpcSource.includes('handle("settings:remove-codex-pet"'));
    assert.ok(css.includes(".theme-section-title"));
    assert.ok(css.includes(".theme-action-group"));
    assert.ok(css.includes(".theme-action-buttons"));
    assert.ok(css.includes(".theme-uninstall-btn"));
    assert.ok(css.includes(".theme-customize-btn"));
    assert.ok(css.includes(".theme-detail-hero"));
    assert.ok(css.includes(".theme-customization-row"));
    assert.ok(/\.theme-card-footer\s*\{[^}]*min-height:\s*26px;[^}]*margin-top:\s*auto;[^}]*\}/.test(css));
    assert.ok(/\.theme-card-check\s*\{[^}]*white-space:\s*nowrap;[^}]*\}/.test(css));
    assert.ok(i18nSource.includes("themeImportPetZip"));
    assert.ok(i18nSource.includes("themeImportUserThemeZip"));
    assert.ok(i18nSource.includes("themeImportUserThemeZipHint"));
    assert.ok(i18nSource.includes("themeOpenUserThemesFolder"));
    assert.ok(i18nSource.includes("toastUserThemeZipImportOk"));
    assert.ok(i18nSource.includes("toastCodexPetZipImportOk"));
    assert.ok(i18nSource.includes("toastCodexPetRemoveOk"));
    assert.ok(i18nSource.includes("themeCustomize"));
    assert.ok(i18nSource.includes("themeBackToPets"));
    assert.ok(i18nSource.includes("themeAppearanceTitle"));
    assert.ok(i18nSource.includes("rowPetAccessory"));
    assert.ok(i18nSource.includes("rowPetMouthAccessory"));
    assert.ok(i18nSource.includes("rowHolidayAccessory"));
    assert.ok(i18nSource.includes("accessoryCowboyHat"));

    const strings = loadSettingsI18nForTest();
    assert.strictEqual(strings.en.themeActionGroupCodexPets, "Codex Pets");
    assert.strictEqual(strings.en.themeActionGroupUserThemes, "User themes");
    assert.strictEqual(strings.en.themeImportPetZip, "Import Codex Pet package (.zip)");
    assert.strictEqual(strings.en.themeImportUserThemeZip, "Import Duck theme package (.zip)");
    assert.ok(strings.en.themeImportUserThemeZipHint.includes("theme.json"));
    assert.strictEqual(strings.en.themeOpenUserThemesFolder, "Open themes folder");
    assert.strictEqual(strings.en.themeRefreshThemes, "Refresh themes");
    assert.strictEqual(strings.en.themeCapabilityFineMotion, "Fine motion");
    assert.strictEqual(strings.en.themeCustomize, "Customize");
    assert.strictEqual(strings.en.rowPetAccessory, "Head accessory");
    assert.strictEqual(strings.en.rowPetMouthAccessory, "Mouth accessory");
    assert.strictEqual(strings.en.rowHolidayAccessory, "Holiday auto outfit");
    assert.strictEqual(strings.en.accessoryWizardHat, "Wizard hat");
    assert.strictEqual(strings.zh.themeCustomize, "装扮");
    assert.strictEqual(strings.zh.rowPetAccessory, "头部配饰");
    assert.strictEqual(strings.zh.rowPetMouthAccessory, "嘴部配饰");
    assert.strictEqual(strings.zh.rowHolidayAccessory, "节日自动换装");
    assert.strictEqual(strings.zh.accessoryWizardHat, "巫师帽");
    assert.strictEqual(strings.zh.themeImportPetZip, "导入 Codex Pet 包（.zip）");
    assert.strictEqual(strings.zh.themeCapabilityFineMotion, "精细动效");
    assert.strictEqual(strings.zh.themeActionGroupCodexPets, "Codex Pets");
    assert.strictEqual(strings.zh.themeImportUserThemeZip, "导入 Duck 主题包（.zip）");
    assert.ok(strings.zh.themeImportUserThemeZipHint.includes("theme.json"));
    assert.strictEqual(strings.zh.themeOpenUserThemesFolder, "打开主题文件夹");
  });

  it("keeps Theme card footers reserved without leaking button keyboard events to card activation", async () => {
    const { content, commands } = loadThemeTabForTest({
      themes: [
        { id: "duck", name: "Duck", builtin: true, active: true },
        { id: "calico", name: "Calico", builtin: true, active: false },
        { id: "pet-active", name: "Pet Active", managedCodexPet: true, active: true },
        { id: "pet-inactive", name: "Pet Inactive", managedCodexPet: true, active: false },
        { id: "user-theme", name: "User Theme", active: false },
      ],
    });

    const cards = content.querySelectorAll(".theme-card");
    assert.strictEqual(cards.length, 5);
    for (const card of cards) {
      assert.ok(card.querySelector(".theme-card-footer"));
    }

    const activeChecks = cards
      .filter((card) => card.getAttribute("aria-checked") === "true")
      .map((card) => card.querySelector(".theme-card-check"));
    const inactiveChecks = cards
      .filter((card) => card.getAttribute("aria-checked") === "false")
      .map((card) => card.querySelector(".theme-card-check"));
    assert.ok(activeChecks.length > 0);
    assert.ok(inactiveChecks.length > 0);
    for (const indicator of activeChecks) {
      assert.strictEqual(indicator.getAttribute("aria-hidden"), undefined);
      assert.ok(indicator.textContent);
    }
    for (const indicator of inactiveChecks) {
      assert.strictEqual(indicator.getAttribute("aria-hidden"), "true");
      assert.strictEqual(indicator.textContent, "");
    }

    const deleteButton = content.querySelector(".theme-delete-btn");
    const inactiveUninstallButton = content.querySelectorAll(".theme-uninstall-btn")
      .find((button) => {
        const card = findAncestorByClass(button, "theme-card");
        return card && card.getAttribute("aria-checked") === "false";
      });
    assert.ok(deleteButton);
    assert.ok(inactiveUninstallButton);

    const deleteKeydown = createKeyboardEventForTest("Enter");
    deleteButton.dispatchEvent(deleteKeydown);
    const uninstallKeydown = createKeyboardEventForTest(" ");
    inactiveUninstallButton.dispatchEvent(uninstallKeydown);
    await Promise.resolve();

    assert.strictEqual(deleteKeydown.cancelBubble, true);
    assert.strictEqual(uninstallKeydown.cancelBubble, true);
    assert.strictEqual(deleteKeydown.defaultPrevented, false);
    assert.strictEqual(uninstallKeydown.defaultPrevented, false);
    assert.deepStrictEqual(commands, []);
  });

  it("renders Codex Pet atlas previews with V1, V2, and legacy grid ratios", () => {
    const { content } = loadThemeTabForTest({
      themes: [
        {
          id: "pet-v1",
          name: "Pet V1",
          managedCodexPet: true,
          active: true,
          codexPet: {
            previewAtlasUrl: "file:///pets/v1/spritesheet.webp",
            atlasColumns: 8,
            atlasRows: 9,
          },
        },
        {
          id: "pet-v2",
          name: "Pet V2",
          managedCodexPet: true,
          active: false,
          codexPet: {
            previewAtlasUrl: "file:///pets/v2/spritesheet.webp",
            atlasColumns: 8,
            atlasRows: 11,
          },
        },
        {
          id: "pet-legacy",
          name: "Pet Legacy",
          managedCodexPet: true,
          active: false,
          codexPet: {
            previewAtlasUrl: "file:///pets/legacy/spritesheet.webp",
          },
        },
      ],
    });

    const previews = content.querySelectorAll(".theme-thumb-atlas-frame");
    assert.strictEqual(previews.length, 3);
    const images = previews.map((preview) => preview.querySelector("img"));
    assert.deepStrictEqual(
      images.map((img) => [img.style.width, img.style.height]),
      [
        ["800%", "900%"],
        ["800%", "1100%"],
        ["800%", "900%"],
      ]
    );
  });

  it("keeps customization visible on every capable pet while omitting Calico", () => {
    const supported = loadThemeTabForTest({
      themes: [
        {
          id: "duck",
          name: "Duck",
          builtin: true,
          active: true,
          capabilities: { petTint: true },
        },
        {
          id: "calico",
          name: "Calico",
          builtin: true,
          active: false,
          capabilities: { petTint: false, accessories: false },
        },
        {
          id: "cloudling",
          name: "Cloudling",
          builtin: true,
          active: false,
          capabilities: { petTint: false, accessories: true },
        },
      ],
    });
    const buttons = supported.content.querySelectorAll(".theme-customize-btn");
    assert.strictEqual(buttons.length, 2);
    assert.deepStrictEqual(
      buttons.map((button) => collectText(findAncestorByClass(button, "theme-card")))
        .map((text) => (text.includes("Cloudling") ? "Cloudling" : "Duck"))
        .sort(),
      ["Cloudling", "Duck"]
    );

    const calicoActive = loadThemeTabForTest({
      themes: [
        {
          id: "calico",
          name: "Calico",
          builtin: true,
          active: true,
          capabilities: { petTint: false, accessories: false },
        },
      ],
    });
    assert.strictEqual(calicoActive.content.querySelectorAll(".theme-customize-btn").length, 0);
    assert.strictEqual(calicoActive.content.querySelector(".theme-detail-hero"), null);
  });

  it("selects an inactive capable pet and opens its customization in one click", async () => {
    let listThemesCalls = 0;
    const harness = loadThemeTabForTest({
      themes: [
        {
          id: "duck",
          name: "Duck",
          builtin: true,
          active: true,
          capabilities: { petTint: true },
        },
        {
          id: "cloudling",
          name: "Cloudling",
          builtin: true,
          active: false,
          capabilities: { petTint: false, accessories: true },
        },
      ],
      settingsAPI: {
        listThemes: () => {
          listThemesCalls += 1;
          return Promise.reject(new Error("theme enumeration unavailable"));
        },
      },
    });
    const cloudlingButton = harness.content.querySelectorAll(".theme-customize-btn")
      .find((button) => collectText(findAncestorByClass(button, "theme-card")).includes("Cloudling"));
    assert.ok(cloudlingButton);

    cloudlingButton.dispatchEvent({ type: "click" });
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(harness.commands)),
      [{
        name: "setThemeSelection",
        payload: { themeId: "cloudling" },
      }]
    );
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.ok(harness.content.querySelector(".theme-detail-hero"));
    assert.ok(collectText(harness.content.querySelector(".theme-detail-heading")).includes("Cloudling"));
    assert.ok(harness.content.querySelector(".pet-accessory-select"));
    assert.strictEqual(harness.content.querySelector(".pet-tint-select"), null);
    assert.strictEqual(harness.content.querySelector(".theme-grid"), null);
    assert.strictEqual(listThemesCalls, 0, "opening details should not depend on a second theme fetch");
  });

  it("does not open stale customization when the activated runtime disables it", async () => {
    const harness = loadThemeTabForTest({
      themes: [
        {
          id: "duck",
          name: "Duck",
          builtin: true,
          active: true,
          capabilities: { petTint: true, accessories: true, mouthAccessories: true },
        },
        {
          id: "custom",
          name: "Custom",
          builtin: false,
          active: false,
          capabilities: { petTint: false, accessories: true },
        },
      ],
      settingsAPI: {
        command: () => Promise.resolve({
          status: "ok",
          customizationCapabilities: { petTint: false, accessories: false },
        }),
      },
    });
    const customButton = harness.content.querySelectorAll(".theme-customize-btn")[1];
    assert.ok(customButton);

    customButton.dispatchEvent({ type: "click" });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(harness.content.querySelector(".theme-detail-hero"), null);
    assert.strictEqual(harness.content.querySelector(".pet-accessory-select"), null);
    const runtimeCustom = harness.core.runtime.themeList
      .find((theme) => theme && theme.id === "custom");
    assert.strictEqual(runtimeCustom.active, true);
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(runtimeCustom.capabilities)),
      { petTint: false, accessories: false }
    );
    const activeCustomCard = harness.content.querySelectorAll(".theme-card")
      .find((card) => {
        const name = card.querySelector(".theme-card-name");
        return name && collectText(name).includes("Custom");
      });
    assert.strictEqual(activeCustomCard.getAttribute("aria-checked"), "true");
  });

  it("updates customization capability after normal theme-card activation", async () => {
    const harness = loadThemeTabForTest({
      themes: [
        {
          id: "duck",
          name: "Duck",
          builtin: true,
          active: true,
          capabilities: { petTint: true, accessories: true, mouthAccessories: true },
        },
        {
          id: "custom",
          name: "Custom",
          builtin: false,
          active: false,
          capabilities: { petTint: false, accessories: false },
        },
      ],
      settingsAPI: {
        command: () => Promise.resolve({
          status: "ok",
          customizationCapabilities: { petTint: false, accessories: true },
        }),
      },
    });
    const customCard = harness.content.querySelectorAll(".theme-card")
      .find((card) => {
        const name = card.querySelector(".theme-card-name");
        return name && collectText(name).includes("Custom");
      });
    assert.ok(customCard);
    assert.strictEqual(customCard.querySelector(".theme-customize-btn"), null);

    customCard.dispatchEvent({ type: "click" });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    const activeCustom = harness.core.runtime.themeList
      .find((theme) => theme && theme.id === "custom");
    assert.strictEqual(activeCustom.active, true);
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(activeCustom.capabilities)),
      { petTint: false, accessories: true }
    );
    const rerenderedCard = harness.content.querySelectorAll(".theme-card")
      .find((card) => {
        const name = card.querySelector(".theme-card-name");
        return name && collectText(name).includes("Custom");
      });
    assert.ok(rerenderedCard.querySelector(".theme-customize-btn"));
  });

  it("keeps existing theme cards when a refresh returns an impossible empty list", async () => {
    const harness = loadThemeTabForTest({
      themes: [
        {
          id: "duck",
          name: "Duck",
          builtin: true,
          active: true,
          capabilities: { petTint: true },
        },
      ],
      settingsAPI: {
        // settings:list-themes reports [] when main catches an enumeration
        // failure, even though a healthy install always has built-in themes.
        listThemes: () => Promise.resolve([]),
      },
    });
    const previousThemeList = harness.core.runtime.themeList;

    const result = await harness.core.ops.fetchThemes();
    harness.renderContent();

    assert.strictEqual(result, previousThemeList);
    assert.strictEqual(harness.core.runtime.themeList, previousThemeList);
    assert.strictEqual(harness.content.querySelectorAll(".theme-card").length, 1);
  });

  it("opens the active pet detail and saves color independently for that theme", async () => {
    const harness = loadThemeTabForTest({
      themes: [
        {
          id: "duck",
          name: "Duck",
          builtin: true,
          active: true,
          previewFileUrl: "file:///duck.svg",
          capabilities: { petTint: true, accessories: true, mouthAccessories: true },
        },
      ],
      snapshot: {
        petTint: { duck: "matcha", cloudling: "vaporwave" },
        petAccessory: { duck: "wizard-hat", cloudling: "halo" },
        petMouthAccessory: { duck: "cigarette" },
        holidayAccessoryEnabled: {},
      },
      petTintOptions: [
        { id: "none", labelKey: "tintNone" },
        { id: "midnight", labelKey: "tintMidnight" },
        { id: "gold", labelKey: "tintGold" },
        { id: "vaporwave", labelKey: "tintVaporwave" },
        { id: "matcha", labelKey: "tintMatcha" },
        { id: "mono", labelKey: "tintMono" },
      ],
      petAccessoryOptions: [
        { id: "none", labelKey: "accessoryNone" },
        { id: "cowboy-hat", labelKey: "accessoryCowboyHat" },
        { id: "wizard-hat", labelKey: "accessoryWizardHat" },
        { id: "halo", labelKey: "accessoryHalo" },
      ],
      petMouthAccessoryOptions: [
        { id: "none", labelKey: "accessoryNone" },
        { id: "cigarette", labelKey: "accessoryCigarette" },
      ],
    });

    harness.content.querySelector(".theme-customize-btn").dispatchEvent({ type: "click" });
    assert.ok(harness.content.querySelector(".theme-detail-back"));
    assert.ok(harness.content.querySelector(".theme-detail-hero"));
    assert.strictEqual(harness.content.querySelectorAll(".theme-customization-row").length, 4);
    assert.strictEqual(harness.content.querySelector(".theme-grid"), null);

    const select = harness.content.querySelector(".pet-tint-select");
    assert.strictEqual(getSelectedPickerValue(select), "matcha");
    assert.deepStrictEqual(
      select.querySelectorAll(".language-picker-option").map((option) => option.textContent),
      ["Default", "🌙 Midnight", "🥇 Gold", "🌸 Vaporwave", "🍵 Matcha", "⬜ Monochrome"]
    );

    choosePickerOption(select, "gold");
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(harness.updates)),
      [{
        key: "petTint",
        value: { duck: "gold", cloudling: "vaporwave" },
      }]
    );
    assert.strictEqual(select.querySelector(".language-picker-trigger").disabled, false);
    assert.strictEqual(select.querySelector(".language-picker-trigger").getAttribute("aria-disabled"), "true");
    assert.strictEqual(select.classList.contains("pending"), true);
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(select.querySelector(".language-picker-trigger").disabled, false);
    assert.strictEqual(select.querySelector(".language-picker-trigger").getAttribute("aria-disabled"), "false");
    assert.strictEqual(select.classList.contains("pending"), false);

    const accessorySelect = harness.content.querySelector(".pet-accessory-select");
    assert.strictEqual(getSelectedPickerValue(accessorySelect), "wizard-hat");
    assert.deepStrictEqual(
      accessorySelect.querySelectorAll(".language-picker-option").map((option) => option.textContent),
      ["None", "Cowboy hat", "Wizard hat", "Halo"]
    );
    choosePickerOption(accessorySelect, "halo");
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(harness.updates[1])),
      {
        key: "petAccessory",
        value: { duck: "halo", cloudling: "halo" },
      }
    );
    assert.strictEqual(accessorySelect.querySelector(".language-picker-trigger").disabled, false);
    assert.strictEqual(accessorySelect.querySelector(".language-picker-trigger").getAttribute("aria-disabled"), "true");
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(accessorySelect.querySelector(".language-picker-trigger").disabled, false);
    assert.strictEqual(accessorySelect.querySelector(".language-picker-trigger").getAttribute("aria-disabled"), "false");

    const mouthAccessorySelect = harness.content.querySelector(".pet-mouth-accessory-select");
    assert.strictEqual(getSelectedPickerValue(mouthAccessorySelect), "cigarette");
    assert.deepStrictEqual(
      mouthAccessorySelect.querySelectorAll(".language-picker-option").map((option) => option.textContent),
      ["None", "Cigarette"]
    );
    choosePickerOption(mouthAccessorySelect, "none");
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(harness.updates[2])),
      { key: "petMouthAccessory", value: {} }
    );
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    const holidaySwitch = harness.content.querySelector(".holiday-accessory-switch");
    assert.ok(holidaySwitch);
    assert.strictEqual(holidaySwitch.getAttribute("role"), "switch");
    assert.strictEqual(holidaySwitch.getAttribute("aria-checked"), "false");
    holidaySwitch.dispatchEvent({ type: "click" });
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(harness.updates[3])),
      {
        key: "holidayAccessoryEnabled",
        value: { duck: true },
      }
    );
    assert.strictEqual(holidaySwitch.getAttribute("aria-checked"), "true");
    assert.strictEqual(holidaySwitch.classList.contains("pending"), true);
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(holidaySwitch.classList.contains("pending"), false);

    holidaySwitch.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(harness.updates[4])),
      {
        key: "holidayAccessoryEnabled",
        value: {},
      }
    );
    assert.strictEqual(holidaySwitch.getAttribute("aria-checked"), "false");

    harness.content.querySelector(".theme-detail-back").dispatchEvent({ type: "click" });
    assert.ok(harness.content.querySelector(".theme-grid"));
    assert.strictEqual(harness.content.querySelector(".theme-detail-hero"), null);
  });

  it("patches theme customization broadcasts in place without replacing the detail view", () => {
    const harness = loadThemeTabForTest({
      themes: [
        {
          id: "duck",
          name: "Duck",
          builtin: true,
          active: true,
          previewFileUrl: "file:///duck.svg",
          capabilities: { petTint: true, accessories: true, mouthAccessories: true },
        },
      ],
      snapshot: {
        petTint: { duck: "matcha" },
        petAccessory: { duck: "wizard-hat" },
        petMouthAccessory: { duck: "cigarette" },
        holidayAccessoryEnabled: {},
      },
      petTintOptions: [
        { id: "none", labelKey: "tintNone" },
        { id: "matcha", labelKey: "tintMatcha" },
        { id: "gold", labelKey: "tintGold" },
      ],
      petAccessoryOptions: [
        { id: "none", labelKey: "accessoryNone" },
        { id: "wizard-hat", labelKey: "accessoryWizardHat" },
        { id: "halo", labelKey: "accessoryHalo" },
      ],
      petMouthAccessoryOptions: [
        { id: "none", labelKey: "accessoryNone" },
        { id: "cigarette", labelKey: "accessoryCigarette" },
      ],
    });

    harness.content.querySelector(".theme-customize-btn").dispatchEvent({ type: "click" });
    const originalHero = harness.content.querySelector(".theme-detail-hero");
    const originalTint = harness.content.querySelector(".pet-tint-select");
    const originalAccessory = harness.content.querySelector(".pet-accessory-select");
    const originalMouthAccessory = harness.content.querySelector(".pet-mouth-accessory-select");
    const originalHolidaySwitch = harness.content.querySelector(".holiday-accessory-switch");
    harness.content.scrollTop = 137;

    const nextSnapshot = {
      ...harness.core.state.snapshot,
      petTint: { duck: "gold" },
      petAccessory: { duck: "halo" },
      petMouthAccessory: {},
      holidayAccessoryEnabled: { duck: true },
    };
    harness.core.ops.applyChanges({
      changes: {
        petTint: nextSnapshot.petTint,
        petAccessory: nextSnapshot.petAccessory,
        petMouthAccessory: nextSnapshot.petMouthAccessory,
        holidayAccessoryEnabled: nextSnapshot.holidayAccessoryEnabled,
      },
      snapshot: nextSnapshot,
    });

    assert.strictEqual(harness.content.querySelector(".theme-detail-hero"), originalHero);
    assert.strictEqual(harness.content.querySelector(".pet-tint-select"), originalTint);
    assert.strictEqual(harness.content.querySelector(".pet-accessory-select"), originalAccessory);
    assert.strictEqual(harness.content.querySelector(".pet-mouth-accessory-select"), originalMouthAccessory);
    assert.strictEqual(harness.content.querySelector(".holiday-accessory-switch"), originalHolidaySwitch);
    assert.strictEqual(harness.content.scrollTop, 137);
    assert.strictEqual(getSelectedPickerValue(originalTint), "gold");
    assert.strictEqual(getSelectedPickerValue(originalAccessory), "halo");
    assert.strictEqual(getSelectedPickerValue(originalMouthAccessory), "none");
    assert.strictEqual(originalHolidaySwitch.getAttribute("aria-checked"), "true");
  });

  it("animates collapsible Settings groups with natural-height grid rows", () => {
    const coreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    assert.ok(coreSource.includes('bodyInner.className = "collapsible-group-body-inner"'));
    assert.ok(coreSource.includes("body.appendChild(bodyInner)"));
    assert.ok(coreSource.includes("function preserveScrollAnchor("));
    assert.ok(!coreSource.includes("measureCollapsibleBodyHeight"));
    assert.ok(!coreSource.includes("body.scrollHeight"));
    assert.ok(!coreSource.includes("--collapsible-body-height"));
    assert.ok(coreSource.includes("collapsing"));
    assert.ok(coreSource.includes("expanding"));
    assert.ok(coreSource.includes('ev.propertyName !== "grid-template-rows"'));
    assert.ok(!coreSource.includes('body.addEventListener("transitioncancel"'));
    assert.ok(coreSource.includes("function setBodyInteractivity(nextExpanded, isTransitioning = false)"));
    assert.ok(coreSource.includes('body.setAttribute("aria-hidden"'));
    assert.ok(coreSource.includes("const bodyInert = !nextExpanded || isTransitioning"));
    assert.ok(!coreSource.includes("body.hidden = collapsed;"));
    assert.ok(/\.settings-disclosure-body\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-rows:\s*1fr;[\s\S]*var\(--settings-disclosure-duration\)/.test(css));
    assert.ok(/\.settings-disclosure-body-inner\s*\{[\s\S]*min-height:\s*0;[\s\S]*overflow:\s*hidden;/.test(css));
    assert.ok(/\.settings-disclosure\.collapsed\s*>\s*\.settings-disclosure-body\s*\{[\s\S]*grid-template-rows:\s*0fr;/.test(css));
    assert.ok(/\.settings-disclosure\.collapsed\s*>\s*\.settings-disclosure-body\s*>\s*\.settings-disclosure-body-inner\s*\{[\s\S]*opacity:\s*0;[\s\S]*transform:\s*translateY\(var\(--settings-disclosure-shift\)\);/.test(css));
    assert.ok(/\.collapsible-group-body\s+\.collapsible-content-entering\s*\{[\s\S]*animation:\s*collapsibleContentEnter/.test(css));
    assert.ok(!css.includes(".collapsible-group.collapsible-content-entering"));
    assert.ok(!css.includes("max-height: var(--collapsible-body-height"));
    assert.ok(/@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.settings-disclosure-body/.test(css));
  });

  it("collapses only the detailed bubble policy controls while keeping primary bubble rows visible", () => {
    const generalSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-general.js"), "utf8");
    const i18nSource = fs.readFileSync(SETTINGS_I18N, "utf8");
    assert.ok(generalSource.includes("buildBubblePolicySummary"));
    assert.ok(generalSource.includes("helpers.buildCollapsibleGroup({"));
    assert.ok(generalSource.includes('id: "general:bubble-policy"'));
    assert.ok(generalSource.includes("defaultCollapsed: true"));
    assert.ok(generalSource.includes('title: t("rowBubblePolicy")'));
    assert.ok(generalSource.includes("const summaryControl = buildBubblePolicySummary();"));
    assert.ok(generalSource.includes("summary: summaryControl.element"));
    assert.ok(generalSource.includes("children: [buildBubblePolicyList()]"));
    assert.ok(generalSource.includes("buildBubblePlacementGroup"));
    assert.ok(!generalSource.includes('key: "showSessionId"'));
    assert.ok(generalSource.includes('key: "hideBubbles"'));
    assert.ok(i18nSource.includes("bubblePolicySummaryPermission"));
    assert.ok(i18nSource.includes("bubblePolicySummaryNotification"));
    assert.ok(i18nSource.includes("bubblePolicySummaryUpdate"));
  });

  it("renders Agent management as collapsed per-agent groups with master switches always visible", () => {
    const agentsSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-agents.js"), "utf8");
    assert.ok(agentsSource.includes("function buildAgentGroup(agent)"));
    assert.ok(agentsSource.includes("const masterRow = buildAgentMasterRow(agent);"));
    assert.ok(agentsSource.includes("const detailRows = buildAgentDetailRows(agent);"));
    assert.ok(agentsSource.includes('id: `agents:${agent.id}`'));
    assert.ok(agentsSource.includes("defaultCollapsed: true"));
    assert.ok(agentsSource.includes("headerContent: masterRow"));
    assert.ok(agentsSource.includes("children: detailRows"));
    assert.ok(agentsSource.includes("ev.stopPropagation();"));
    assert.ok(agentsSource.includes("agent-subgroup"));
    assert.ok(agentsSource.includes("function syncAgentSwitchDisabledState("));
    assert.ok(!agentsSource.includes("full re-render"));
  });

  it("uses a dedicated Settings agent ordering helper before rendering Agent management groups", () => {
    const agentsSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-agents.js"), "utf8");
    const agentOrderSource = fs.readFileSync(path.join(SRC_DIR, "settings-agent-order.js"), "utf8");
    assert.ok(agentOrderSource.includes("function isAgentCollapsible("));
    assert.ok(agentOrderSource.includes("function sortAgentMetadataForSettings("));
    assert.ok(agentOrderSource.includes("COLLAPSIBLE_AGENT_PRIORITY"));
    assert.ok(agentOrderSource.includes("NON_COLLAPSIBLE_AGENT_PRIORITY"));
    assert.ok(agentsSource.includes("DuckSettingsAgentOrder"));
    assert.ok(agentsSource.includes("sortAgentMetadataForSettings(metadata)"));
    assert.ok(agentsSource.includes("function categorizeAgentsForSections("));
    assert.ok(agentsSource.includes("function renderConnectedSubtab("));
    assert.ok(agentsSource.includes("function renderDiscoverSubtab("));
  });

  it("lists agents flat, with no Coding AI / Office AI grouping layer", () => {
    const agentsSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-agents.js"), "utf8");
    const orderSource = fs.readFileSync(path.join(SRC_DIR, "settings-agent-order.js"), "utf8");
    const i18nSource = fs.readFileSync(path.join(SRC_DIR, "settings-i18n.js"), "utf8");
    const css = fs.readFileSync(path.join(SRC_DIR, "settings.css"), "utf8");
    assert.ok(agentsSource.includes("function buildAgentRows("));
    assert.ok(!agentsSource.includes("buildAgentCategoryGroup("));
    assert.ok(!agentsSource.includes("categorizeAgentsByType("));
    assert.ok(!agentsSource.includes("getAgentCategory"));
    assert.ok(!orderSource.includes("getAgentCategory"));
    assert.ok(!i18nSource.includes("agentCategoryCoding"));
    assert.ok(!i18nSource.includes("agentCategoryWork"));
    assert.ok(!css.includes(".agent-category-group"));
    assert.ok(!css.includes(".agent-category-count"));
  });

  it("counts a registered custom AI as connected, listed beside built-ins", () => {
    const id = "custom-nova-ai-0123456789ab";
    const harness = loadAgentsTabForTest({
      snapshot: {
        agents: {
          [id]: { integrationInstalled: false, enabled: true },
          "agent-g": { integrationInstalled: true, enabled: true },
        },
        customApplications: [],
        customToolDiscoveryPaths: [],
      },
      agentMetadata: [
        {
          id,
          name: "Nova AI",
          category: "code",
          eventSource: "custom-http",
          custom: true,
          capabilities: {},
        },
        {
          id: "agent-g",
          name: "Zeta Agent",
          category: "work",
          eventSource: "hook",
          capabilities: {},
        },
      ],
    });
    harness.core.runtime.agentInstallationHints = {
      checkedAt: 1,
      agents: [],
      customAgents: [{ agentId: id, detectedInstalled: true, confidence: "high" }],
      customTools: [],
      skippedAgentIds: [],
    };
    harness.core.runtime.agentInstallationHintsFetched = true;
    harness.core.ops.requestRender({ content: true });

    // Registering is what connects a custom AI, so it belongs in Connected
    // rather than being demoted into the discover subtab. Both agents list
    // flat: a custom "code" agent and a built-in "work" one, no category boxes.
    const connected = harness.content.querySelector(".agent-section-connected");
    assert.ok(connected);
    assert.strictEqual(connected.querySelector(".agent-category-group"), null);
    assert.deepStrictEqual(
      connected.querySelectorAll(".agent-summary-row .row-label").map((node) => node.textContent),
      ["Nova AI", "Zeta Agent"]
    );
    assert.strictEqual(harness.content.querySelector(".agent-section-recommended"), null);
    // Its executable resolves, so no missing-binary badge yet.
    assert.strictEqual(connected.querySelector(".custom-missing"), null);

    // Losing the executable no longer moves the agent out of Connected, so the
    // row itself has to report it.
    harness.core.runtime.agentInstallationHints = {
      checkedAt: 2,
      agents: [],
      customAgents: [{ agentId: id, detectedInstalled: false, confidence: "high" }],
      customTools: [],
      skippedAgentIds: [],
    };
    harness.core.ops.requestRender({ content: true });
    harness.raf.flush();

    const stillConnected = harness.content.querySelector(".agent-section-connected");
    assert.deepStrictEqual(
      stillConnected.querySelectorAll(".agent-summary-row .row-label").map((node) => node.textContent),
      ["Nova AI", "Zeta Agent"],
      "a vanished executable must not evict the agent from Connected"
    );
    const missing = stillConnected.querySelector(".custom-missing");
    assert.ok(missing, "the row reports the missing executable");
    assert.strictEqual(missing.textContent, "Path missing");
  });

  it("renders Custom AI detection under one manual folder picker", () => {
    const agentsSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-agents.js"), "utf8");
    const coreSource = fs.readFileSync(path.join(SRC_DIR, "settings-ui-core.js"), "utf8");
    const preloadSource = fs.readFileSync(PRELOAD_SETTINGS, "utf8");
    const css = fs.readFileSync(path.join(SRC_DIR, "settings.css"), "utf8");

    assert.ok(coreSource.includes("function readCustomToolDetectionResults("));
    assert.ok(coreSource.includes("function readCustomAgentDetectionResults("));
    assert.ok(coreSource.includes("hints.customTools"));
    assert.ok(agentsSource.includes("function buildCustomToolResultRows("));
    assert.ok(agentsSource.includes("readCustomToolDetectionResults"));
    assert.ok(agentsSource.includes('className = "row row-sub custom-tool-result-row"'));
    assert.ok(agentsSource.includes("pickAgentDiscoveryPath"));
    assert.ok(preloadSource.includes('ipcRenderer.invoke("settings:pick-agent-discovery-path"'));
    assert.ok(agentsSource.includes('pickAgentDiscoveryPath("directory")'));
    assert.ok(!agentsSource.includes('labelKey: "rowAgentDiscoveryPaths"'));
    assert.ok(agentsSource.includes('await ops.fetchAgentInstallationHints({ force: true })'));
    assert.ok(agentsSource.includes("function buildWslScanControl("));
    assert.ok(agentsSource.includes('control.className = "custom-tool-wsl-scan"'));
    assert.ok(!agentsSource.includes('toolbar.className = "agent-scan-toolbar"'));
    assert.ok(css.includes(".custom-tool-result-status"));
    assert.match(css, /\.agent-custom-tools-section \.custom-tool-discovery-row\s*\{[^}]*flex-direction:\s*row;/s);
    assert.match(css, /\.agent-custom-tools-section \.row-text\s*\{[^}]*flex:\s*1 1 360px;[^}]*min-width:\s*0;/s);
    assert.match(css, /\.agent-custom-tools-section \.custom-tool-discovery-control\s*\{[^}]*justify-content:\s*flex-end;[^}]*margin-left:\s*auto;/s);
    assert.match(css, /\.agent-unavailable-group > \.collapsible-group-header\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*18px minmax\(0,\s*1fr\) minmax\(180px,\s*260px\);/s);
    assert.match(css, /\.agent-unavailable-group > \.collapsible-group-header > \.collapsible-group-summary\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*min-width:\s*0;/s);
    assert.match(css, /\.agent-section-summary\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto;/s);
    assert.match(css, /@media \(max-width:\s*980px\)\s*\{\s*\.agent-unavailable-group > \.collapsible-group-header\s*\{[^}]*grid-template-columns:\s*18px minmax\(0,\s*1fr\);[^}]*\}\s*\.agent-unavailable-group > \.collapsible-group-header > \.collapsible-group-summary\s*\{[^}]*grid-column:\s*2;/s);
    assert.match(css, /@media \(max-width:\s*760px\)\s*\{[\s\S]*?\.agent-custom-tools-section \.custom-tool-discovery-row\s*\{[^}]*flex-direction:\s*column;/);
    // The primary picker must keep a higher-specificity selector than the
    // generic `.soft-btn.accent` tinted rule that follows it, or the cascade
    // falls back to source order and drops the solid accent fill.
    assert.match(css, /\.agent-custom-tools-section \.soft-btn\.custom-tool-path-picker\s*\{[^}]*background:\s*var\(--accent\);/s);
    assert.ok(!/\.custom-tool-path-picker\s*\{[^}]*width:\s*100%;/s.test(css));
    assert.ok(!/\.custom-tool-scan\s*\{[^}]*width:\s*100%;/s.test(css));
    assert.match(css, /@media \(max-width:\s*760px\)\s*\{[\s\S]*?\.custom-tool-discovery-actions,[\s\S]*?\{[^}]*width:\s*100%;/s);
  });

  it("filters the undetected catalog from its header search box", () => {
    const harness = loadAgentsTabForTest({
      snapshot: {
        lang: "en",
        agents: {
          "agent-b": { integrationInstalled: false, enabled: false },
          "agent-d": { integrationInstalled: false, enabled: false },
          "agent-a": { integrationInstalled: false, enabled: false },
        },
        customToolDiscoveryPaths: [],
      },
      agentMetadata: [
        { id: "agent-b", name: "Agent B", eventSource: "hook", capabilities: {} },
        { id: "agent-d", name: "Agent D", eventSource: "hook", capabilities: {} },
        { id: "agent-a", name: "Agent A", eventSource: "hook", capabilities: {} },
      ],
    });
    harness.core.runtime.agentInstallationHints = {
      checkedAt: 1,
      agents: [],
      customTools: [],
      skippedAgentIds: [],
    };
    harness.core.runtime.agentInstallationHintsFetched = true;
    harness.core.ops.requestRender({ content: true });
    harness.raf.flush();

    const group = harness.content.querySelector(".agent-unavailable-group");
    assert.ok(group, "undetected agents render as a collapsible catalog");
    assert.ok(group.classList.contains("collapsed"), "catalog starts collapsed");
    const search = group.querySelector(".agent-section-search");
    assert.ok(search, "the catalog header carries a search box");
    assert.strictEqual(search.placeholder, "Search");
    assert.strictEqual(group.querySelector(".agent-section-count").textContent, "3");

    const visibleNames = () => group
      .querySelectorAll(".agent-summary-row .row-label")
      .filter((label) => {
        let node = label;
        while (node) {
          if (node.classList && node.classList.contains("agent-row-filtered-out")) return false;
          node = node.parentNode;
        }
        return true;
      })
      .map((label) => label.textContent);
    assert.deepStrictEqual(visibleNames(), ["Agent A", "Agent B", "Agent D"]);

    search.value = "nt d";
    search.dispatchEvent({ type: "input", target: search, bubbles: false });
    harness.raf.flush();

    assert.deepStrictEqual(visibleNames(), ["Agent D"]);
    assert.strictEqual(group.querySelector(".agent-section-count").textContent, "1");
    // Typing has to open the catalog, or it would filter rows nobody can see.
    assert.strictEqual(group.classList.contains("collapsed"), false);

    // Clicks and keystrokes inside the box must not toggle the group.
    const wasCollapsed = group.classList.contains("collapsed");
    search.dispatchEvent({ type: "click", target: search, bubbles: true });
    search.dispatchEvent({ type: "keydown", key: "Enter", target: search, bubbles: true });
    assert.strictEqual(group.classList.contains("collapsed"), wasCollapsed);

    // An IME composition is pinyin keystrokes, not a query: filtering on it
    // would empty the list under the candidate window mid-word.
    search.value = "agent d";
    search.dispatchEvent({ type: "input", target: search, bubbles: false });
    search.dispatchEvent({ type: "compositionstart", target: search, bubbles: false });
    search.value = "age nt d";
    search.dispatchEvent({ type: "input", target: search, bubbles: false });
    assert.deepStrictEqual(visibleNames(), ["Agent D"], "composition keystrokes must not filter");
    assert.strictEqual(group.querySelector(".agent-section-count").textContent, "1");
    search.value = "秘密";
    search.dispatchEvent({ type: "compositionend", target: search, bubbles: false });
    assert.deepStrictEqual(visibleNames(), [], "the committed characters do filter");
    assert.strictEqual(group.querySelector(".agent-section-count").textContent, "0");

    // The query survives a re-render, and matching is case-insensitive.
    search.value = "AGENT A";
    search.dispatchEvent({ type: "input", target: search, bubbles: false });
    harness.core.ops.requestRender({ content: true });
    harness.raf.flush();
    const rebuilt = harness.content.querySelector(".agent-unavailable-group");
    assert.strictEqual(rebuilt.querySelector(".agent-section-search").value, "AGENT A");
    assert.strictEqual(rebuilt.querySelector(".agent-section-count").textContent, "1");
  });

  it("splits the Agents tab into connected and discover subtabs", () => {
    const customPath = "C:\\Tools\\Unknown";
    const harness = loadAgentsTabForTest({
      snapshot: {
        lang: "en",
        agents: {
          "agent-a": { integrationInstalled: true, enabled: true },
          "agent-b": { integrationInstalled: false, enabled: false },
        },
        customToolDiscoveryPaths: [customPath],
        dismissedAgentCleanupHints: {},
        dismissedAgentInstallHints: {},
      },
      agentMetadata: [
        { id: "agent-a", name: "Agent A", eventSource: "hook", capabilities: {}, cleanupSuggestionExempt: false },
        { id: "agent-b", name: "Agent B", eventSource: "hook", capabilities: {} },
      ],
    });
    harness.core.runtime.agentInstallationHints = {
      checkedAt: 1700000000000,
      agents: [
        // Connected but gone from disk -> cleanup hint on the connected subtab.
        { agentId: "agent-a", detectedInstalled: false, confidence: "high" },
        // On disk but not connected -> install hint + badge on the discover pill.
        { agentId: "agent-b", detectedInstalled: true, confidence: "high" },
      ],
      customTools: [{
        path: customPath,
        detectedInstalled: true,
        confidence: "medium",
        reason: "custom-path",
        detail: "No launchable application was recognized",
        kind: "directory",
      }],
      skippedAgentIds: [],
      wslSupported: true,
      wslDistros: [],
    };
    harness.core.runtime.agentInstallationHintsFetched = true;
    harness.core.ops.requestRender({ content: true });
    harness.raf.flush();

    const subtabs = harness.content.querySelector(".agents-subtabs");
    assert.ok(subtabs, "the Agents tab should render a subtab switcher");
    const pills = subtabs.querySelectorAll(".segmented button");
    assert.deepStrictEqual(pills.map((pill) => pill.textContent), ["Connected", "Discover and add"]);
    assert.strictEqual(pills[0].classList.contains("active"), true);
    assert.strictEqual(pills[0].getAttribute("aria-selected"), "true");
    // The badge counts what can be acted on now, not the whole catalog.
    assert.strictEqual(pills[0].querySelector(".agents-subtab-count"), null);
    assert.strictEqual(pills[1].querySelector(".agents-subtab-count").textContent, "1");

    // Connected is the default half, and the WSL rescan rides with it: its
    // results land as instance rows inside agent cards, not as discovery hits.
    const connectedSection = harness.content.querySelector(".agent-section-connected");
    assert.ok(connectedSection);
    // Only one category here, so the grouping layer is dropped entirely
    // instead of wrapping the rows in a lone "Coding AI" header.
    assert.strictEqual(connectedSection.querySelector(".agent-category-group"), null);
    assert.deepStrictEqual(
      connectedSection.querySelectorAll(".agent-summary-row .row-label").map((node) => node.textContent),
      ["Agent A"]
    );
    assert.ok(subtabs.querySelector(".custom-tool-wsl-scan"));
    assert.strictEqual(harness.content.querySelector(".custom-tool-path-picker"), null);
    assert.strictEqual(harness.content.querySelector(".agent-custom-tools-section"), null);

    // Each banner belongs to the subtab it acts on.
    const cleanupIndex = harness.content.children
      .findIndex((node) => node.classList.contains("agent-cleanup-hint-banner"));
    assert.ok(cleanupIndex >= 0, "a cleanup hint should render for the missing local agent");
    assert.ok(cleanupIndex > harness.content.children.indexOf(subtabs));
    assert.strictEqual(harness.content.querySelector(".agent-install-hint-banner"), null);

    pills[1].dispatchEvent({ type: "click", bubbles: false });
    harness.raf.flush();

    const discoverSubtabs = harness.content.querySelector(".agents-subtabs");
    const discoverPills = discoverSubtabs.querySelectorAll(".segmented button");
    assert.strictEqual(discoverPills[1].classList.contains("active"), true);
    assert.ok(harness.content.querySelector(".custom-tool-path-picker"));
    assert.strictEqual(harness.content.querySelector(".agent-section-connected"), null);
    assert.strictEqual(discoverSubtabs.querySelector(".custom-tool-wsl-scan"), null);
    assert.strictEqual(harness.content.querySelector(".agent-cleanup-hint-banner"), null);
    assert.ok(harness.content.querySelector(".agent-install-hint-banner"));

    // The pill is the only heading for this half, and an unrecognized path
    // states its status once, localized, with no badge repeating it.
    assert.strictEqual(harness.content.querySelector(".agent-custom-tools-section .section-title"), null);
    const resultRow = harness.content.querySelector(".custom-tool-result-row");
    assert.strictEqual(resultRow.querySelector(".custom-tool-result-path").textContent, customPath);
    assert.strictEqual(resultRow.querySelector(".custom-tool-result-path").title, customPath);
    assert.strictEqual(resultRow.querySelector(".row-desc").textContent, "No launchable application found");
    assert.strictEqual(resultRow.querySelector(".custom-tool-result-status"), null);
  });

  it("shows custom AI scan state and forces a rescan", async () => {
    let resolveScan;
    let scanCalls = 0;
    const harness = loadAgentsTabForTest({
      snapshot: { lang: "en", agents: {}, customToolDiscoveryPaths: [] },
      agentMetadata: [],
      settingsAPI: {
        detectAgentInstallations: () => {
          scanCalls += 1;
          return new Promise((resolve) => { resolveScan = resolve; });
        },
      },
    });
    harness.core.runtime.agentsSubtab = "discover";
    harness.core.runtime.agentInstallationHints = {
      checkedAt: 1700000000000,
      agents: [],
      customTools: [],
      skippedAgentIds: [],
    };
    harness.core.runtime.agentInstallationHintsFetched = true;
    harness.core.ops.requestRender({ content: true });
    harness.raf.flush();

    const button = harness.content.querySelector(".custom-tool-scan");
    const status = harness.content.querySelector(".custom-tool-scan-status");
    assert.strictEqual(button.textContent, "Rescan");
    assert.match(status.textContent, /^Last scanned at /);

    button.dispatchEvent({ type: "click", bubbles: false });
    assert.strictEqual(status.textContent, "Scanning...");
    assert.strictEqual(button.disabled, true);
    assert.strictEqual(scanCalls, 1);

    resolveScan({
      checkedAt: 1700000005000,
      agents: [],
      customTools: [],
      skippedAgentIds: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 1250));
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.match(status.textContent, /^Last scanned at /);
    assert.strictEqual(button.disabled, false);
  });

  it("adds a picked installation folder, persists it, and waits for a fresh path scan", async () => {
    const calls = [];
    const pickedPath = "C:\\Tools\\CustomAI";
    const harness = loadAgentsTabForTest({
      snapshot: { agents: {}, customToolDiscoveryPaths: [] },
      agentMetadata: [],
      settingsAPI: {
        pickAgentDiscoveryPath: async (kind) => {
          calls.push(["pick", kind]);
          return { status: "ok", path: pickedPath };
        },
        command: async (command, payload) => {
          calls.push(["command", command, payload]);
          return { status: "ok" };
        },
        detectAgentInstallations: async () => {
          calls.push(["scan"]);
          return {
            checkedAt: 123,
            agents: [],
            customTools: [{
              path: pickedPath,
              detectedInstalled: true,
              confidence: "medium",
              reason: "custom-path",
              detail: "Path exists (directory)",
              kind: "directory",
            }],
          };
        },
      },
    });
    harness.core.runtime.agentsSubtab = "discover";
    harness.core.runtime.agentInstallationHints = {
      checkedAt: 1,
      agents: [],
      customTools: [],
      skippedAgentIds: [],
    };
    harness.core.runtime.agentInstallationHintsFetched = true;
    harness.core.ops.requestRender({ content: true });
    harness.raf.flush();

    const picker = harness.content.querySelector(".custom-tool-path-picker");
    assert.strictEqual(picker.textContent, "Choose AI installation folder");
    assert.strictEqual(harness.content.querySelector(".agent-custom-tools-section input"), null);
    picker.dispatchEvent({ type: "click", bubbles: false });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    harness.raf.flush();

    assert.deepStrictEqual(calls[0], ["pick", "directory"]);
    assert.strictEqual(calls[1][0], "command");
    assert.strictEqual(calls[1][1], "setAgentCustomDiscoveryPaths");
    assert.strictEqual(calls[1][2].agentId, "custom");
    assert.deepStrictEqual(calls[1][2].value, [pickedPath]);
    assert.deepStrictEqual(calls[2], ["scan"]);
    assert.strictEqual(harness.core.runtime.agentInstallationHints.customTools[0].path, pickedPath);
    harness.core.ops.requestRender({ content: true });
    harness.raf.flush();
    assert.ok(harness.content.querySelector(".custom-tool-result-found"));
    const removePath = harness.content.querySelector(".custom-tool-remove-path");
    assert.ok(removePath);
    removePath.dispatchEvent({ type: "click", bubbles: false });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.strictEqual(calls[3][0], "command");
    assert.strictEqual(calls[3][1], "setAgentCustomDiscoveryPaths");
    assert.deepStrictEqual(calls[3][2].value, []);
  });

  it("registers a recognized custom AI with state-only connection details", async () => {
    const id = "custom-nova-ai-0123456789ab";
    const pickedPath = "C:\\Tools\\NovaAI.exe";
    const calls = [];
    let added = false;
    const customMetadata = {
      id,
      name: "Nova AI",
      category: "code",
      eventSource: "custom-http",
      custom: true,
      sourcePath: pickedPath,
      executablePath: pickedPath,
      processName: "NovaAI.exe",
      stateEndpoint: "http://127.0.0.1:24333/state",
      lastStateEvent: null,
      capabilities: { httpHook: true, permissionApproval: false, interactiveBubble: false, notificationHook: true },
    };
    const detection = () => ({
      checkedAt: 1,
      agents: [],
      customTools: [{
        path: pickedPath,
        detectedInstalled: true,
        confidence: "high",
        reason: "application-recognized",
        detail: "Recognized Nova AI",
        kind: "file",
        application: { ...customMetadata, added },
      }],
      skippedAgentIds: [],
    });
    const harness = loadAgentsTabForTest({
      snapshot: { agents: {}, customToolDiscoveryPaths: [pickedPath], customApplications: [] },
      agentMetadata: [],
      settingsAPI: {
        command: async (command, payload) => {
          calls.push([command, payload]);
          if (command === "addCustomApplication") added = true;
          return { status: "ok" };
        },
        listAgents: async () => added ? [customMetadata] : [],
        detectAgentInstallations: async () => detection(),
      },
    });
    harness.core.runtime.agentsSubtab = "discover";
    harness.core.runtime.agentInstallationHints = detection();
    harness.core.runtime.agentInstallationHintsFetched = true;
    harness.core.ops.requestRender({ content: true });
    harness.raf.flush();

    const addButton = harness.content.querySelector(".custom-tool-add");
    assert.ok(addButton);
    addButton.dispatchEvent({ type: "click", bubbles: false });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    harness.raf.flush();

    assert.strictEqual(calls[0][0], "addCustomApplication");
    assert.strictEqual(calls[0][1].path, pickedPath);
    assert.ok(harness.core.runtime.agentMetadata.some((agent) => agent.id === id));
    assert.ok(harness.content.querySelector(".custom-agent-remove"));
    assert.ok(harness.content.querySelector(".custom-registration"));
    assert.ok(harness.content.querySelector(".custom-agent-copy"));
    assert.strictEqual(
      harness.content
        .querySelectorAll(".agent-badge")
        .some((badge) => badge.classList.contains("accent")),
      false
    );

    const activity = harness.content.querySelector(".custom-agent-activity");
    assert.ok(!activity.textContent.includes("PreToolUse"));
    const renderCountBeforeActivity = harness.getContentRenderCount();
    assert.strictEqual(harness.core.tabs.agents.applyAgentActivity({
      agentId: id,
      timestamp: Date.UTC(2026, 6, 21, 8, 30, 0),
      eventType: "PreToolUse",
    }), true);
    assert.ok(activity.textContent.includes("PreToolUse"));
    assert.strictEqual(harness.core.runtime.agentMetadata[0].lastStateEvent.eventType, "PreToolUse");
    assert.strictEqual(harness.getContentRenderCount(), renderCountBeforeActivity);
  });

  it("confirms before uninstalling an agent integration", () => {
    const agentsSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-agents.js"), "utf8");
    const i18nSource = fs.readFileSync(path.join(SRC_DIR, "settings-i18n.js"), "utf8");
    assert.ok(agentsSource.includes('window.confirm(t("agentIntegrationUninstallConfirm"))'));
    assert.ok(i18nSource.includes("agentIntegrationUninstallConfirm"));
  });

  it("fetches agent installation hints lazily when Agents renders and then uses the cache", async () => {
    let calls = 0;
    const detectionResult = {
      checkedAt: 123,
      agents: [{ agentId: "agent-a", detectedInstalled: true }],
      skippedAgentIds: ["claude-code"],
    };
    const harness = loadAgentsTabForTest({
      agentMetadata: [{
        id: "agent-a",
        name: "Agent A",
        eventSource: "hook",
        capabilities: {},
      }],
      settingsAPI: {
        detectAgentInstallations: () => {
          calls++;
          return Promise.resolve(detectionResult);
        },
      },
    });

    assert.strictEqual(calls, 0);
    harness.core.ops.requestRender({ content: true });
    assert.strictEqual(calls, 1);
    assert.strictEqual(harness.core.runtime.agentInstallationHintsPending, true);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(harness.core.runtime.agentInstallationHints.checkedAt, detectionResult.checkedAt);
    assert.deepStrictEqual(
      harness.core.runtime.agentInstallationHints.agents.map((agent) => agent.agentId),
      ["agent-a"]
    );
    assert.deepStrictEqual(
      harness.core.runtime.agentInstallationHints.skippedAgentIds,
      detectionResult.skippedAgentIds
    );
    assert.strictEqual(harness.core.runtime.agentInstallationHintsFetched, true);
    assert.strictEqual(harness.core.runtime.agentInstallationHintsPending, false);

    harness.core.ops.requestRender({ content: true });
    await Promise.resolve();
    await Promise.resolve();
    assert.strictEqual(calls, 1);
  });

  it("preserves fetched null verdicts and keeps them out of every Settings action surface", async () => {
    const commandCalls = [];
    const detectionResult = {
      checkedAt: 895,
      agents: [
        { agentId: "agent-f", detectedInstalled: null, confidence: "low", reason: "insufficient-evidence" },
        { agentId: "agent-e", detectedInstalled: null, confidence: "low", reason: "insufficient-evidence" },
      ],
      skippedAgentIds: [],
    };
    const harness = loadAgentsTabForTest({
      snapshot: {
        agents: {
          "agent-f": { integrationInstalled: false, enabled: false },
          "agent-e": { integrationInstalled: true, enabled: true },
        },
        dismissedAgentInstallHints: { "agent-f": true },
        dismissedAgentCleanupHints: { "agent-e": true },
      },
      agentMetadata: [
        { id: "agent-f", name: "Agent F", eventSource: "hook", capabilities: {}, cleanupSuggestionExempt: false },
        { id: "agent-e", name: "Agent E", eventSource: "hook", capabilities: {}, cleanupSuggestionExempt: false },
      ],
      settingsAPI: {
        detectAgentInstallations: () => Promise.resolve(detectionResult),
        command: (action, payload) => {
          commandCalls.push([action, payload]);
          return Promise.resolve({ status: "ok" });
        },
      },
    });

    await harness.core.ops.fetchAgentInstallationHints();
    harness.raf.flush();

    assert.deepStrictEqual(
      harness.core.runtime.agentInstallationHints.agents.map((entry) => entry.detectedInstalled),
      [null, null],
      "normalization must preserve tri-state null"
    );
    assert.strictEqual(harness.content.querySelector(".agent-install-hint-banner"), null);
    assert.strictEqual(harness.content.querySelector(".agent-cleanup-hint-banner"), null);
    const connectedPills = harness.content.querySelectorAll(".agents-subtabs .segmented button");
    assert.strictEqual(connectedPills[1].querySelector(".agents-subtab-count"), null);

    harness.core.runtime.agentsSubtab = "discover";
    harness.core.ops.requestRender({ content: true });
    harness.raf.flush();
    assert.strictEqual(harness.content.querySelector(".agent-section-recommended"), null);
    assert.strictEqual(harness.content.querySelector(".agent-install-hint-banner"), null);
    assert.strictEqual(harness.content.querySelector(".agent-cleanup-hint-banner"), null);
    assert.deepStrictEqual(commandCalls, [], "null must not clear either dismissal bucket");
  });

  it("splits connected agents from detected and undetected ones across the subtabs", () => {
    const harness = loadAgentsTabForTest({
      snapshot: {
        agents: {
          "agent-c": { integrationInstalled: true, enabled: true },
          "agent-a": { integrationInstalled: false, enabled: false },
          pi: { integrationInstalled: false, enabled: false },
        },
        dismissedAgentInstallHints: { "agent-a": true },
      },
      agentMetadata: [
        { id: "pi", name: "Pi", eventSource: "extension", capabilities: {} },
        { id: "agent-a", name: "Agent A", eventSource: "hook", capabilities: {} },
        { id: "agent-c", name: "Agent C", eventSource: "plugin-event", capabilities: {} },
      ],
    });
    harness.core.runtime.agentInstallationHints = {
      checkedAt: 1,
      agents: [
        { agentId: "agent-a", detectedInstalled: true, confidence: "high" },
        { agentId: "agent-c", detectedInstalled: false, confidence: "low" },
        { agentId: "pi", detectedInstalled: false, confidence: "low" },
      ],
      skippedAgentIds: [],
    };
    harness.core.runtime.agentInstallationHintsFetched = true;

    harness.core.ops.requestRender({ content: true });

    const labelsFor = (section) => section.querySelectorAll(".agent-summary-row .row-label").map((el) => el.textContent);

    // Connected subtab: only the connected agents, and no section title —
    // the pill already says "Connected".
    const connected = harness.content.querySelector(".agent-section-connected");
    assert.ok(connected);
    assert.strictEqual(connected.querySelector(".section-title"), null);
    assert.deepStrictEqual(labelsFor(connected), ["Agent C"]);
    assert.strictEqual(harness.content.querySelector(".agent-section-recommended"), null);
    assert.strictEqual(harness.content.querySelector(".agent-section-unavailable"), null);

    harness.core.runtime.agentsSubtab = "discover";
    harness.core.ops.requestRender({ content: true });

    const recommended = harness.content.querySelector(".agent-section-recommended");
    const unavailable = harness.content.querySelector(".agent-section-unavailable");
    assert.ok(recommended);
    assert.ok(unavailable);
    assert.strictEqual(recommended.querySelector(".section-title").textContent, "Detected locally");
    assert.deepStrictEqual(labelsFor(recommended), ["Agent A"]);
    assert.strictEqual(harness.content.querySelector(".agent-section-connected"), null);

    // The undetected catalog is a collapsed group with a neutral count, and
    // the manual-add block sits above it.
    const group = unavailable.querySelector(".agent-unavailable-group");
    assert.ok(group);
    // #895: the catalog can hold agents with no explicit verdict alongside
    // genuinely undetected ones, so its title must not assert a detection result.
    assert.strictEqual(group.querySelector(".collapsible-group-text .row-label").textContent, "More supported tools");
    assert.strictEqual(group.querySelector(".agent-section-count").textContent, "1");
    assert.ok(group.classList.contains("collapsed"));
    assert.deepStrictEqual(labelsFor(unavailable), ["Pi"]);
    assert.ok(
      harness.content.children.indexOf(harness.content.querySelector(".agent-custom-tools-section"))
      < harness.content.children.indexOf(unavailable)
    );
  });

  // #895 T10: medium is half of INSTALL_HINT_CONFIDENCES but every existing
  // test used "high", so dropping medium from the set was invisible. One agent
  // squatting in another's parent dir produces exactly a medium parent-dir hit,
  // which is the confidence that half of #895 travels on.
  it("offers medium-confidence detections in the install hint banner", () => {
    const harness = loadAgentsTabForTest({
      snapshot: {
        agents: { "agent-b": { integrationInstalled: false, enabled: false } },
        dismissedAgentInstallHints: {},
      },
      agentMetadata: [
        { id: "agent-b", name: "Agent B", eventSource: "hook", capabilities: {}, cleanupSuggestionExempt: false },
      ],
    });
    harness.core.runtime.agentInstallationHints = {
      checkedAt: 1,
      agents: [{ agentId: "agent-b", detectedInstalled: true, confidence: "medium", reason: "parent-dir" }],
      skippedAgentIds: [],
    };
    harness.core.runtime.agentInstallationHintsFetched = true;
    harness.core.runtime.agentsSubtab = "discover";

    harness.core.ops.requestRender({ content: true });

    assert.ok(harness.content.querySelector(".agent-install-hint-banner"));
    assert.match(harness.content.querySelector(".agent-install-hint-desc").textContent, /Agent B/);
    const recommended = harness.content.querySelector(".agent-section-recommended");
    assert.ok(recommended);
    assert.deepStrictEqual(
      recommended.querySelectorAll(".agent-summary-row .row-label").map((el) => el.textContent),
      ["Agent B"]
    );
  });

  // #895 T9: before the first detection resolves there is no evidence at all, so
  // the catalog must not be phrased as a detection result. It carries agents
  // Duck never examines even after the scan lands.
  it("keeps the catalog title free of detection claims before hints arrive", () => {
    const harness = loadAgentsTabForTest({
      snapshot: { agents: { codex: { integrationInstalled: false, enabled: false } } },
      agentMetadata: [
        { id: "codex", name: "Codex", eventSource: "hook", capabilities: {}, cleanupSuggestionExempt: true },
      ],
    });
    harness.core.runtime.agentInstallationHintsFetched = false;
    harness.core.runtime.agentsSubtab = "discover";

    harness.core.ops.requestRender({ content: true });

    const group = harness.content.querySelector(".agent-unavailable-group");
    assert.ok(group);
    assert.strictEqual(
      group.querySelector(".collapsible-group-text .row-label").textContent,
      "More supported tools"
    );
  });

  // #895 T12/T12b/T12c/T12d: cleanup suggestions are gated on metadata that must
  // say, explicitly, that the agent is eligible. Default integrations are not,
  // and a fixture or an IPC failure that omits the field must not be read as
  // permission to propose tearing an integration out.
  it("gates fetched cleanup hints on explicit metadata eligibility", async () => {
    const cases = [
      { label: "default agent is exempt", id: "codex", name: "Codex", exempt: true, expectBanner: false },
      { label: "Claude shares the exemption", id: "claude-code", name: "Claude Code", exempt: true, expectBanner: false },
      { label: "non-default agent is eligible", id: "agent-a", name: "Agent A", exempt: false, expectBanner: true },
      { label: "missing field fails closed", id: "agent-a", name: "Agent A", exempt: undefined, expectBanner: false },
    ];
    for (const { label, id, name, exempt, expectBanner } of cases) {
      const metadata = { id, name, eventSource: "hook", capabilities: {} };
      if (exempt !== undefined) metadata.cleanupSuggestionExempt = exempt;
      const harness = loadAgentsTabForTest({
        snapshot: {
          agents: { [id]: { integrationInstalled: true, enabled: true } },
          dismissedAgentCleanupHints: {},
        },
        agentMetadata: [metadata],
        settingsAPI: {
          detectAgentInstallations: () => Promise.resolve({
            checkedAt: 1,
            agents: [{ agentId: id, detectedInstalled: false, confidence: "low" }],
            skippedAgentIds: ["claude-code"],
          }),
        },
      });
      await harness.core.ops.fetchAgentInstallationHints();

      assert.strictEqual(harness.core.runtime.agentInstallationHints.agents[0].agentId, id, label);

      const banner = harness.content.querySelector(".agent-cleanup-hint-banner");
      assert.strictEqual(!!banner, expectBanner, label);
    }
  });

  // #895: an entry with no verdict is "not checked", and must not propose a
  // deletion any more than a missing entry does.
  it("requires a strict false verdict before offering a cleanup hint", () => {
    for (const detectedInstalled of [undefined, null]) {
      const harness = loadAgentsTabForTest({
        snapshot: {
          agents: { "agent-a": { integrationInstalled: true, enabled: true } },
          dismissedAgentCleanupHints: {},
        },
        agentMetadata: [
          { id: "agent-a", name: "Agent A", eventSource: "hook", capabilities: {}, cleanupSuggestionExempt: false },
        ],
      });
      harness.core.runtime.agentInstallationHints = {
        checkedAt: 1,
        agents: [{ agentId: "agent-a", detectedInstalled, confidence: "low" }],
        skippedAgentIds: [],
      };
      harness.core.runtime.agentInstallationHintsFetched = true;

      harness.core.ops.requestRender({ content: true });

      assert.strictEqual(
        harness.content.querySelector(".agent-cleanup-hint-banner"),
        null,
        `detectedInstalled=${detectedInstalled} must not propose cleanup`
      );
    }
  });

  it("renders an install hint banner for detected local agents that are not integrated", () => {
    const harness = loadAgentsTabForTest({
      snapshot: {
        agents: {
          "agent-a": { integrationInstalled: false, enabled: false },
          "agent-c": { integrationInstalled: true, enabled: true },
        },
        dismissedAgentInstallHints: {},
      },
      agentMetadata: [
        { id: "agent-a", name: "Agent A", eventSource: "hook", capabilities: {} },
        { id: "agent-c", name: "Agent C", eventSource: "plugin-event", capabilities: {} },
      ],
    });
    harness.core.runtime.agentInstallationHints = {
      checkedAt: 1,
      agents: [
        { agentId: "agent-a", detectedInstalled: true, confidence: "high" },
        { agentId: "agent-c", detectedInstalled: true, confidence: "high" },
        { agentId: "pi", detectedInstalled: true, confidence: "low" },
      ],
      skippedAgentIds: ["claude-code"],
    };
    harness.core.runtime.agentInstallationHintsFetched = true;
    harness.core.runtime.agentsSubtab = "discover";

    harness.core.ops.requestRender({ content: true });

    const banner = harness.content.querySelector(".agent-install-hint-banner");
    assert.ok(banner, "detected unintegrated agents should render a banner");
    assert.ok(harness.content.querySelector(".agent-install-hint-install"));
    assert.ok(harness.content.querySelector(".agent-install-hint-dismiss"));
    const desc = harness.content.querySelector(".agent-install-hint-desc").textContent;
    assert.match(desc, /Agent A/);
    assert.doesNotMatch(desc, /Agent C/);
  });

  it("hides install hint banners after the agent is dismissed", () => {
    const harness = loadAgentsTabForTest({
      snapshot: {
        agents: {
          "agent-a": { integrationInstalled: false, enabled: false },
        },
        dismissedAgentInstallHints: { "agent-a": true },
      },
      agentMetadata: [
        { id: "agent-a", name: "Agent A", eventSource: "hook", capabilities: {} },
      ],
    });
    harness.core.runtime.agentInstallationHints = {
      checkedAt: 1,
      agents: [{ agentId: "agent-a", detectedInstalled: true, confidence: "high" }],
      skippedAgentIds: [],
    };
    harness.core.runtime.agentInstallationHintsFetched = true;

    harness.core.ops.requestRender({ content: true });

    assert.strictEqual(harness.content.querySelector(".agent-install-hint-banner"), null);
  });

  it("clears install dismissals when the detector no longer sees the agent", async () => {
    const calls = [];
    const harness = loadAgentsTabForTest({
      snapshot: {
        agents: {
          "claude-code": { integrationInstalled: false, enabled: false },
          "agent-a": { integrationInstalled: false, enabled: false },
        },
        dismissedAgentInstallHints: {
          "claude-code": true,
          "agent-a": true,
        },
      },
      agentMetadata: [
        { id: "claude-code", name: "Claude Code", eventSource: "hook", capabilities: {} },
        { id: "agent-a", name: "Agent A", eventSource: "hook", capabilities: {} },
      ],
      settingsAPI: {
        command: (action, payload) => {
          calls.push([action, payload]);
          return Promise.resolve({ status: "ok" });
        },
      },
    });
    harness.core.runtime.agentInstallationHints = {
      checkedAt: 1,
      agents: [{ agentId: "agent-a", detectedInstalled: false, confidence: "low" }],
      skippedAgentIds: ["claude-code"],
    };
    harness.core.runtime.agentInstallationHintsFetched = true;

    harness.core.ops.requestRender({ content: true });
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(harness.content.querySelector(".agent-install-hint-banner"), null);
    assert.strictEqual(calls[0][0], "clearAgentInstallHints");
    assert.deepStrictEqual([...calls[0][1].agentIds], ["agent-a"]);
  });

  it("wires install hint banner buttons to bulk install and dismiss commands", async () => {
    const calls = [];
    const detectionResult = {
      checkedAt: 2,
      agents: [{ agentId: "agent-a", detectedInstalled: true, confidence: "high" }],
      skippedAgentIds: [],
    };
    const harness = loadAgentsTabForTest({
      snapshot: {
        agents: {
          "agent-a": { integrationInstalled: false, enabled: false },
        },
        dismissedAgentInstallHints: {},
      },
      agentMetadata: [
        { id: "agent-a", name: "Agent A", eventSource: "hook", capabilities: {} },
      ],
      settingsAPI: {
        command: (action, payload) => {
          calls.push([action, payload]);
          return Promise.resolve({ status: "ok" });
        },
        detectAgentInstallations: () => Promise.resolve(detectionResult),
      },
    });
    harness.core.runtime.agentInstallationHints = detectionResult;
    harness.core.runtime.agentInstallationHintsFetched = true;

    harness.core.ops.requestRender({ content: true });
    harness.content.querySelector(".agent-install-hint-install").dispatchEvent({ type: "click", bubbles: false });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(calls[0][0], "installAgentIntegration");
    assert.strictEqual(calls[0][1].agentId, "agent-a");

    calls.length = 0;
    harness.core.runtime.agentInstallationHintsFetched = true;
    harness.core.ops.requestRender({ content: true });
    harness.content.querySelector(".agent-install-hint-dismiss").dispatchEvent({ type: "click", bubbles: false });
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(calls[0][0], "dismissAgentInstallHints");
    assert.deepStrictEqual([...calls[0][1].agentIds], ["agent-a"]);
  });

  it("shows a non-error toast when a recommended install is skipped", async () => {
    const toasts = [];
    const detectionResult = {
      checkedAt: 2,
      agents: [{ agentId: "agent-a", detectedInstalled: true, confidence: "high" }],
      skippedAgentIds: [],
    };
    const harness = loadAgentsTabForTest({
      snapshot: {
        agents: {
          "agent-a": { integrationInstalled: false, enabled: false },
        },
        dismissedAgentInstallHints: {},
      },
      agentMetadata: [
        { id: "agent-a", name: "Agent A", eventSource: "hook", capabilities: {} },
      ],
      settingsAPI: {
        command: () => Promise.resolve({ status: "skipped", message: "agent missing" }),
        detectAgentInstallations: () => Promise.resolve(detectionResult),
      },
    });
    harness.core.ops.showToast = (message, options = {}) => {
      toasts.push({ message, options });
    };
    harness.core.runtime.agentInstallationHints = detectionResult;
    harness.core.runtime.agentInstallationHintsFetched = true;

    harness.core.ops.requestRender({ content: true });
    harness.content.querySelector(".agent-install-hint-install").dispatchEvent({ type: "click", bubbles: false });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(toasts.length, 1);
    assert.match(toasts[0].message, /Agent A/);
    assert.notStrictEqual(toasts[0].options.error, true);
  });

  it("shows a non-error toast when a manual agent install is skipped", async () => {
    const toasts = [];
    const harness = loadAgentsTabForTest({
      snapshot: {
        agents: {
          pi: { integrationInstalled: false, enabled: false },
        },
      },
      agentMetadata: [
        { id: "pi", name: "Pi", eventSource: "extension", capabilities: {} },
      ],
      settingsAPI: {
        command: () => Promise.resolve({ status: "skipped", message: "Pi missing" }),
      },
    });
    harness.core.ops.showToast = (message, options = {}) => {
      toasts.push({ message, options });
    };

    harness.core.ops.requestRender({ content: true });
    harness.content.querySelector(".agent-integration-action").dispatchEvent({ type: "click", bubbles: false });
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(toasts.length, 1);
    assert.match(toasts[0].message, /Pi/);
    assert.notStrictEqual(toasts[0].options.error, true);
  });

  it("renders cleanup hint banners only from explicit negative entries, not absent default agents", () => {
    const harness = loadAgentsTabForTest({
      snapshot: {
        agents: {
          "claude-code": { integrationInstalled: true, enabled: true },
          codex: { integrationInstalled: true, enabled: true },
          "agent-a": { integrationInstalled: true, enabled: true },
        },
        dismissedAgentCleanupHints: {},
      },
      agentMetadata: [
        { id: "claude-code", name: "Claude Code", eventSource: "hook", capabilities: {}, cleanupSuggestionExempt: true },
        { id: "codex", name: "Codex", eventSource: "hook", capabilities: {}, cleanupSuggestionExempt: true },
        { id: "agent-a", name: "Agent A", eventSource: "hook", capabilities: {}, cleanupSuggestionExempt: false },
      ],
    });
    harness.core.runtime.agentInstallationHints = {
      checkedAt: 1,
      agents: [{ agentId: "agent-a", detectedInstalled: false, confidence: "low" }],
      skippedAgentIds: ["claude-code"],
    };
    harness.core.runtime.agentInstallationHintsFetched = true;

    harness.core.ops.requestRender({ content: true });

    const banner = harness.content.querySelector(".agent-cleanup-hint-banner");
    assert.ok(banner, "installed agents missing from detector entries should render cleanup banner");
    assert.ok(harness.content.querySelector(".agent-cleanup-hint-remove"));
    assert.ok(harness.content.querySelector(".agent-cleanup-hint-dismiss"));
    const desc = harness.content.querySelector(".agent-cleanup-hint-desc").textContent;
    assert.match(desc, /Agent A/);
    assert.doesNotMatch(desc, /Claude Code/);
    assert.doesNotMatch(desc, /Codex/);
  });

  it("hides cleanup hint banners after the agent is dismissed", () => {
    const harness = loadAgentsTabForTest({
      snapshot: {
        agents: {
          "agent-a": { integrationInstalled: true, enabled: true },
        },
        dismissedAgentCleanupHints: { "agent-a": true },
      },
      agentMetadata: [
        { id: "agent-a", name: "Agent A", eventSource: "hook", capabilities: {}, cleanupSuggestionExempt: false },
      ],
    });
    harness.core.runtime.agentInstallationHints = {
      checkedAt: 1,
      agents: [{ agentId: "agent-a", detectedInstalled: false, confidence: "low" }],
      skippedAgentIds: [],
    };
    harness.core.runtime.agentInstallationHintsFetched = true;

    harness.core.ops.requestRender({ content: true });

    assert.strictEqual(harness.content.querySelector(".agent-cleanup-hint-banner"), null);
  });

  it("clears cleanup dismissals when the detector sees the agent restored", async () => {
    const calls = [];
    const harness = loadAgentsTabForTest({
      snapshot: {
        agents: {
          "agent-a": { integrationInstalled: true, enabled: true },
        },
        dismissedAgentCleanupHints: { "agent-a": true },
      },
      agentMetadata: [
        { id: "agent-a", name: "Agent A", eventSource: "hook", capabilities: {}, cleanupSuggestionExempt: false },
      ],
      settingsAPI: {
        command: (action, payload) => {
          calls.push([action, payload]);
          return Promise.resolve({ status: "ok" });
        },
      },
    });
    harness.core.runtime.agentInstallationHints = {
      checkedAt: 1,
      agents: [{ agentId: "agent-a", detectedInstalled: true, confidence: "high" }],
      skippedAgentIds: [],
    };
    harness.core.runtime.agentInstallationHintsFetched = true;

    harness.core.ops.requestRender({ content: true });
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(harness.content.querySelector(".agent-cleanup-hint-banner"), null);
    assert.strictEqual(calls[0][0], "clearAgentCleanupHints");
    assert.deepStrictEqual([...calls[0][1].agentIds], ["agent-a"]);
  });

  it("wires cleanup hint banner buttons to bulk uninstall and dismiss commands", async () => {
    const calls = [];
    const detectionResult = {
      checkedAt: 2,
      agents: [{ agentId: "agent-a", detectedInstalled: false, confidence: "low" }],
      skippedAgentIds: [],
    };
    const harness = loadAgentsTabForTest({
      snapshot: {
        agents: {
          "agent-a": { integrationInstalled: true, enabled: true },
        },
        dismissedAgentCleanupHints: {},
      },
      agentMetadata: [
        { id: "agent-a", name: "Agent A", eventSource: "hook", capabilities: {}, cleanupSuggestionExempt: false },
      ],
      settingsAPI: {
        command: (action, payload) => {
          calls.push([action, payload]);
          return Promise.resolve({ status: "ok" });
        },
        detectAgentInstallations: () => Promise.resolve(detectionResult),
      },
    });
    harness.core.runtime.agentInstallationHints = detectionResult;
    harness.core.runtime.agentInstallationHintsFetched = true;

    harness.core.ops.requestRender({ content: true });
    harness.content.querySelector(".agent-cleanup-hint-remove").dispatchEvent({ type: "click", bubbles: false });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(calls[0][0], "uninstallAgentIntegration");
    assert.strictEqual(calls[0][1].agentId, "agent-a");
    assert.strictEqual(calls[0][1].dismissInstallHint, false);

    calls.length = 0;
    harness.core.runtime.agentInstallationHintsFetched = true;
    harness.core.ops.requestRender({ content: true });
    harness.content.querySelector(".agent-cleanup-hint-dismiss").dispatchEvent({ type: "click", bubbles: false });
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(calls[0][0], "dismissAgentCleanupHints");
    assert.deepStrictEqual([...calls[0][1].agentIds], ["agent-a"]);
  });

  it("keeps Agent management switch broadcasts in place even when Codex permission rows are mounted", () => {
    const harness = loadAgentsTabForTest({
      snapshot: {
        agents: {
          codex: {
            enabled: true,
            permissionsEnabled: true,
            permissionMode: "intercept",
          },
        },
      },
      agentMetadata: [{
        id: "codex",
        name: "Codex",
        eventSource: "hook",
        capabilities: {
          permissionApproval: true,
        },
      }],
      collapsedGroups: {
        "agents:codex": false,
      },
    });

    harness.core.ops.requestRender({ content: true });
    harness.raf.flush();
    const before = harness.getContentRenderCount();

    harness.core.ops.applyChanges({
      changes: {
        agents: {
          codex: {
            enabled: false,
            permissionsEnabled: true,
            permissionMode: "intercept",
          },
        },
      },
      snapshot: {
        agents: {
          codex: {
            enabled: false,
            permissionsEnabled: true,
            permissionMode: "intercept",
          },
        },
      },
    });

    assert.strictEqual(
      harness.getContentRenderCount(),
      before,
      "Codex agent broadcasts should patch mounted switches instead of rebuilding and truncating switch motion"
    );
  });

  it("disables the Codex Permissions switch in place when Permission mode changes to Native", () => {
    const harness = loadAgentsTabForTest({
      snapshot: {
        agents: {
          codex: {
            enabled: true,
            permissionsEnabled: true,
            permissionMode: "intercept",
          },
        },
      },
      agentMetadata: [{
        id: "codex",
        name: "Codex",
        eventSource: "hook",
        capabilities: {
          permissionApproval: true,
        },
      }],
      collapsedGroups: {
        "agents:codex": false,
      },
    });

    harness.core.ops.requestRender({ content: true });
    harness.raf.flush();
    const before = harness.getContentRenderCount();

    harness.core.ops.applyChanges({
      changes: {
        agents: {
          codex: {
            enabled: true,
            permissionsEnabled: true,
            permissionMode: "native",
          },
        },
      },
      snapshot: {
        agents: {
          codex: {
            enabled: true,
            permissionsEnabled: true,
            permissionMode: "native",
          },
        },
      },
    });

    const permissionsSwitch = [...harness.core.state.mountedControls.agentSwitches.values()]
      .find((meta) => meta.agentId === "codex" && meta.flag === "permissionsEnabled");
    assert.ok(permissionsSwitch, "Codex Permissions switch should stay mounted");
    assert.strictEqual(harness.getContentRenderCount(), before);
    assert.strictEqual(permissionsSwitch.element.classList.contains("disabled"), true);
    assert.strictEqual(permissionsSwitch.element.attributes["aria-disabled"], "true");
    assert.strictEqual(permissionsSwitch.element.attributes.tabindex, "-1");
  });

  it("enables the Codex native sound switch only in Native permission mode", () => {
    const harness = loadAgentsTabForTest({
      snapshot: {
        agents: {
          codex: {
            enabled: true,
            permissionsEnabled: true,
            permissionMode: "intercept",
            nativeNotificationSoundEnabled: true,
          },
        },
      },
      agentMetadata: [{
        id: "codex",
        name: "Codex",
        eventSource: "hook",
        capabilities: {
          permissionApproval: true,
        },
      }],
      collapsedGroups: {
        "agents:codex": false,
      },
    });

    harness.core.ops.requestRender({ content: true });
    harness.raf.flush();

    const soundSwitch = [...harness.core.state.mountedControls.agentSwitches.values()]
      .find((meta) => meta.agentId === "codex" && meta.flag === "nativeNotificationSoundEnabled");
    assert.ok(soundSwitch, "Codex native sound switch should be mounted");
    assert.strictEqual(soundSwitch.element.classList.contains("disabled"), true);

    harness.core.ops.applyChanges({
      changes: {
        agents: {
          codex: {
            enabled: true,
            permissionsEnabled: true,
            permissionMode: "native",
            nativeNotificationSoundEnabled: true,
          },
        },
      },
      snapshot: {
        agents: {
          codex: {
            enabled: true,
            permissionsEnabled: true,
            permissionMode: "native",
            nativeNotificationSoundEnabled: true,
          },
        },
      },
    });

    assert.strictEqual(soundSwitch.element.classList.contains("disabled"), false);
    assert.strictEqual(soundSwitch.element.attributes["aria-disabled"], "false");
    assert.strictEqual(soundSwitch.element.attributes.tabindex, "0");
  });

  it("mounts the Claude subagent permission switch and greys it with the permission gate (#451)", () => {
    const harness = loadAgentsTabForTest({
      snapshot: {
        agents: {
          "claude-code": {
            enabled: true,
            permissionsEnabled: true,
            subagentPermissionsEnabled: true,
          },
        },
      },
      agentMetadata: [{
        id: "claude-code",
        name: "Claude Code",
        eventSource: "hook",
        capabilities: {
          permissionApproval: true,
        },
      }],
      collapsedGroups: {
        "agents:claude-code": false,
      },
    });

    harness.core.ops.requestRender({ content: true });
    harness.raf.flush();

    const subagentSwitch = [...harness.core.state.mountedControls.agentSwitches.values()]
      .find((meta) => meta.agentId === "claude-code" && meta.flag === "subagentPermissionsEnabled");
    assert.ok(subagentSwitch, "Claude subagent permission switch should be mounted");
    assert.strictEqual(subagentSwitch.element.classList.contains("disabled"), false);

    harness.core.ops.applyChanges({
      changes: {
        agents: {
          "claude-code": {
            enabled: true,
            permissionsEnabled: false,
            subagentPermissionsEnabled: true,
          },
        },
      },
      snapshot: {
        agents: {
          "claude-code": {
            enabled: true,
            permissionsEnabled: false,
            subagentPermissionsEnabled: true,
          },
        },
      },
    });

    assert.strictEqual(subagentSwitch.element.classList.contains("disabled"), true);
    assert.strictEqual(subagentSwitch.element.attributes["aria-disabled"], "true");
    assert.strictEqual(subagentSwitch.element.attributes.tabindex, "-1");
  });

  it("does not render the subagent permission switch for non-Claude agents (#451)", () => {
    const harness = loadAgentsTabForTest({
      snapshot: {
        agents: {
          "agent-h": {
            enabled: true,
            permissionsEnabled: true,
          },
        },
      },
      agentMetadata: [{
        id: "agent-h",
        name: "Agent H",
        eventSource: "hook",
        capabilities: {
          permissionApproval: true,
        },
      }],
      collapsedGroups: {
        "agents:agent-h": false,
      },
    });

    harness.core.ops.requestRender({ content: true });
    harness.raf.flush();

    const subagentSwitch = [...harness.core.state.mountedControls.agentSwitches.values()]
      .find((meta) => meta.flag === "subagentPermissionsEnabled");
    assert.strictEqual(subagentSwitch, undefined);
    const permissionsSwitch = [...harness.core.state.mountedControls.agentSwitches.values()]
      .find((meta) => meta.agentId === "agent-h" && meta.flag === "permissionsEnabled");
    assert.ok(permissionsSwitch, "Agent H permission switch should still be mounted");
  });

  it("does not render a permission toggle on a state-only agent row", () => {
    // The desktop app owns the permission loop in its native sandbox + GUI, so
    // capabilities.permissionApproval is false and the row must offer no
    // permission switch — only the notification (waiting) toggle.
    const harness = loadAgentsTabForTest({
      snapshot: {
        agents: {
          "state-only": {
            enabled: true,
            notificationHookEnabled: true,
          },
        },
      },
      agentMetadata: [{
        id: "state-only",
        name: "State Only",
        eventSource: "hook",
        capabilities: {
          notificationHook: true,
        },
      }],
      collapsedGroups: {
        "agents:state-only": false,
      },
    });

    harness.core.ops.requestRender({ content: true });
    harness.raf.flush();

    const permissionsSwitch = [...harness.core.state.mountedControls.agentSwitches.values()]
      .find((meta) => meta.agentId === "state-only" && meta.flag === "permissionsEnabled");
    assert.strictEqual(
      permissionsSwitch,
      undefined,
      "a state-only agent must not mount a permission toggle"
    );
    const notificationSwitch = [...harness.core.state.mountedControls.agentSwitches.values()]
      .find((meta) => meta.agentId === "state-only" && meta.flag === "notificationHookEnabled");
    assert.ok(notificationSwitch, "the waiting-notification switch should still be mounted");
  });

  it("slides the Codex permission mode pill when mode broadcasts patch in place", () => {
    const harness = loadAgentsTabForTest({
      snapshot: {
        agents: {
          codex: {
            enabled: true,
            permissionsEnabled: true,
            permissionMode: "intercept",
          },
        },
      },
      agentMetadata: [{
        id: "codex",
        name: "Codex",
        eventSource: "hook",
        capabilities: {
          permissionApproval: true,
        },
      }],
      collapsedGroups: {
        "agents:codex": false,
      },
    });

    harness.core.ops.requestRender({ content: true });
    harness.raf.flush();
    const segmented = harness.content.querySelector(".codex-permission-mode-segmented");
    assert.ok(segmented, "Codex permission mode should use the sliding segmented control");
    assert.strictEqual(segmented.style.getPropertyValue("--codex-permission-mode-active-index"), "1");

    harness.core.ops.applyChanges({
      changes: {
        agents: {
          codex: {
            enabled: true,
            permissionsEnabled: true,
            permissionMode: "native",
          },
        },
      },
      snapshot: {
        agents: {
          codex: {
            enabled: true,
            permissionsEnabled: true,
            permissionMode: "native",
          },
        },
      },
    });

    assert.strictEqual(segmented.style.getPropertyValue("--codex-permission-mode-active-index"), "1");
    harness.raf.flush();
    assert.strictEqual(segmented.style.getPropertyValue("--codex-permission-mode-active-index"), "0");
  });

  it("patches agent-only broadcasts in place without requiring Codex-specific rows", () => {
    const harness = loadAgentsTabForTest({
      snapshot: {
        agents: {
          "agent-b": {
            enabled: true,
            notificationHookEnabled: true,
          },
        },
      },
      agentMetadata: [{
        id: "agent-b",
        name: "Agent B",
        eventSource: "hook",
        capabilities: {
          notificationHook: true,
        },
      }],
      collapsedGroups: {
        "agents:agent-b": false,
      },
    });

    harness.core.ops.requestRender({ content: true });
    harness.raf.flush();
    const before = harness.getContentRenderCount();

    harness.core.ops.applyChanges({
      changes: {
        agents: {
          "agent-b": {
            enabled: true,
            notificationHookEnabled: false,
          },
        },
      },
      snapshot: {
        agents: {
          "agent-b": {
            enabled: true,
            notificationHookEnabled: false,
          },
        },
      },
    });

    assert.strictEqual(
      harness.getContentRenderCount(),
      before,
      "agent-only broadcasts should update mounted controls in place instead of rebuilding the expanded group"
    );
  });

  it("ignores stale Codex hook health results after the badge becomes not installed", async () => {
    let resolveHealth;
    const healthPromise = new Promise((resolve) => { resolveHealth = resolve; });
    const harness = loadAgentsTabForTest({
      snapshot: {
        agents: {
          codex: { integrationInstalled: true, enabled: true },
        },
      },
      agentMetadata: [{
        id: "codex",
        name: "Codex",
        eventSource: "hook",
        capabilities: { permissionApproval: true },
      }],
      doctor: { codexHookHealth: () => healthPromise },
    });

    harness.core.ops.requestRender({ content: true });
    const findIntegrationBadge = () => harness.content.querySelectorAll(".agent-badge")
      .find((candidate) => candidate.classList.contains("integration"));
    let badge = findIntegrationBadge();
    assert.ok(badge);
    assert.strictEqual(badge.textContent, "Installed");

    harness.core.ops.applyChanges({
      changes: {
        agents: {
          codex: { integrationInstalled: false, enabled: false },
        },
      },
      snapshot: {
        agents: {
          codex: { integrationInstalled: false, enabled: false },
        },
      },
    });
    badge = findIntegrationBadge();
    assert.ok(badge);
    assert.strictEqual(badge.textContent, "Not installed");

    resolveHealth({ healthy: false, signature: "not-registered", reasonKey: "codexHookHealthReasonInactive" });
    await Promise.resolve();
    await Promise.resolve();

    badge = findIntegrationBadge();
    assert.strictEqual(badge.textContent, "Not installed");
    assert.strictEqual(badge.classList.contains("hook-warning"), false);
    assert.strictEqual(badge.title, "");
  });
  it("does not initialize an expanded agent group at 0px height during rerender", () => {
    const harness = loadAgentsTabForTest({
      snapshot: {
        agents: {
          "agent-b": {
            integrationInstalled: true,
            enabled: true,
            notificationHookEnabled: true,
          },
        },
      },
      agentMetadata: [{
        id: "agent-b",
        name: "Agent B",
        eventSource: "hook",
        capabilities: {
          notificationHook: true,
        },
      }],
      collapsedGroups: {
        "agents:agent-b": false,
      },
    });

    harness.core.ops.requestRender({ content: true });
    const expandedBody = harness.content.querySelector(".collapsible-group-body");
    assert.ok(expandedBody, "agent group body should render");
    assert.notStrictEqual(
      expandedBody.style.getPropertyValue("--collapsible-body-height"),
      "0px",
      "expanded groups should not paint one frame at 0px height before the next animation frame runs"
    );
  });

  it("uses animated switches and local theme override patching in the Animation Map subtab", () => {
    const animMapSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-anim-map.js"), "utf8");
    const overridesSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-anim-overrides.js"), "utf8");
    const coreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    assert.ok(animMapSource.includes("state.transientUiState.animMapSwitches"));
    assert.ok(animMapSource.includes("state.mountedControls.animMapSwitches"));
    assert.ok(animMapSource.includes("helpers.attachAnimatedSwitch(sw, {"));
    assert.ok(animMapSource.includes('command("setThemeOverrideDisabled"'));
    assert.ok(!animMapSource.includes("helpers.attachActivation(sw"));
    assert.ok(animMapSource.includes("function renderMapSubtab(parent)"));
    assert.ok(animMapSource.includes("function patchMapInPlace(changes)"));
    assert.ok(animMapSource.includes('Object.prototype.hasOwnProperty.call(changes, "themeOverrides")'));
    assert.ok(animMapSource.includes("helpers.setSwitchVisual(meta.element, readAnimMapVisualOn(meta.themeId, meta.stateKey), { pending: false });"));
    // Folded in: the Animation & Sound Overrides tab renders + patches the map subtab.
    assert.ok(overridesSource.includes("DuckSettingsTabAnimMap.renderMapSubtab"));
    assert.ok(overridesSource.includes("DuckSettingsTabAnimMap.patchMapInPlace"));
    assert.ok(coreSource.includes("activeTab.patchInPlace(changes"));
  });

  it("renders the Animation Map switches inside the Animation Overrides 'on / off' subtab", () => {
    const harness = loadAnimMapTabForTest({
      snapshot: { theme: "duck", themeOverrides: {} },
    });
    // Map is the default subtab; rendering the overrides tab should mount the
    // five interrupt on/off switches under it (folded in, not a standalone tab).
    harness.core.tabs.animOverrides.render(harness.content);
    assert.strictEqual(harness.core.state.mountedControls.animMapSwitches.size, 5);
    assert.ok(
      harness.core.state.mountedControls.animMapReset,
      "the reset-all control should mount under the subtab"
    );
  });

  it("keeps the Animation shell mounted and restores scroll per subtab", () => {
    const harness = loadAnimMapTabForTest({
      snapshot: { theme: "duck", themeOverrides: {} },
    });
    harness.core.runtime.animationOverridesData = {
      theme: { id: "duck", name: "Duck" },
      assets: [],
      sections: [],
      cards: [],
      sounds: [],
    };
    harness.core.runtime.animOverridesSubtab = "map";
    const render = () => {
      harness.content.innerHTML = "";
      harness.core.tabs.animOverrides.render(harness.content, harness.core);
    };
    harness.core.ops.installRenderHooks({ content: render, modal: () => {} });
    render();

    const [heading, subtitle, tablist, body] = harness.content.children;
    assert.equal(heading.tagName, "H1");
    assert.equal(subtitle.className, "subtitle");
    assert.equal(tablist.className, "anim-override-subtabs");
    assert.equal(body.className, "anim-override-subtab-body");

    function switchTo(subtab) {
      const button = harness.content.querySelectorAll("button")
        .find((candidate) => candidate.dataset.animOverridesSubtab === subtab);
      assert.ok(button, `${subtab} tab should render`);
      button.dispatchEvent({ type: "click" });
      assert.strictEqual(harness.content.children[0], heading);
      assert.strictEqual(harness.content.children[1], subtitle);
      assert.strictEqual(harness.content.children[2], tablist);
      assert.strictEqual(harness.content.children[3], body);
      const active = harness.content.querySelectorAll("button")
        .find((candidate) => candidate.classList.contains("active"));
      assert.equal(active.dataset.animOverridesSubtab, subtab);
      assert.equal(active.focused, true);
    }

    switchTo("animations");
    harness.content.scrollTop = 240;
    switchTo("sounds");
    assert.equal(harness.content.scrollTop, 0, "the short target subtab starts at its own scroll position");

    // Chromium clamps a short page to zero. Returning to Animations must use
    // its saved position rather than this clamped value from Sounds.
    harness.content.scrollTop = 0;
    switchTo("animations");
    assert.equal(harness.content.scrollTop, 240);
  });

  it("keeps Animation Map theme override broadcasts in place and syncs the mounted switch", () => {
    const harness = loadAnimMapTabForTest({
      snapshot: {
        theme: "duck",
        themeOverrides: {
          duck: {
            states: {
              error: { disabled: false },
            },
          },
        },
      },
    });
    const sw = new FakeElement("div");
    sw.className = "switch on";
    harness.content.appendChild(sw);
    harness.core.state.mountedControls.animMapSwitches.set("duck:error", {
      element: sw,
      themeId: "duck",
      stateKey: "error",
    });
    const before = harness.getContentRenderCount();

    harness.core.ops.applyChanges({
      changes: {
        themeOverrides: {
          duck: {
            states: {
              error: { disabled: true },
            },
          },
        },
      },
      snapshot: {
        theme: "duck",
        themeOverrides: {
          duck: {
            states: {
              error: { disabled: true },
            },
          },
        },
      },
    });

    assert.strictEqual(harness.getContentRenderCount(), before);
    assert.strictEqual(sw.classList.contains("on"), false);
    assert.strictEqual(sw.attributes["aria-checked"], "false");
  });

  it("rebuilds Animation Map instead of patching with stale theme ids when the theme changes", () => {
    const harness = loadAnimMapTabForTest({
      snapshot: {
        theme: "duck",
        themeOverrides: {},
      },
    });
    const sw = new FakeElement("div");
    sw.className = "switch on";
    harness.content.appendChild(sw);
    harness.core.state.mountedControls.animMapSwitches.set("duck:error", {
      element: sw,
      themeId: "duck",
      stateKey: "error",
    });
    const before = harness.getContentRenderCount();

    harness.core.ops.applyChanges({
      changes: {
        theme: "calico",
        themeOverrides: {
          calico: {
            states: {
              error: { disabled: true },
            },
          },
        },
      },
      snapshot: {
        theme: "calico",
        themeOverrides: {
          calico: {
            states: {
              error: { disabled: true },
            },
          },
        },
      },
    });

    assert.strictEqual(
      harness.getContentRenderCount(),
      before + 1,
      "theme changes should force a rebuild so Animation Map switches use the new theme id"
    );
  });

  it("invalidates animation cards and refreshes theme capabilities after a map override patch", async () => {
    let listThemesCalls = 0;
    const harness = loadAnimMapTabForTest({
      snapshot: {
        theme: "duck",
        themeOverrides: { duck: { states: { error: { disabled: false } } } },
      },
      settingsAPI: {
        listThemes: () => {
          listThemesCalls++;
          return Promise.resolve([{
            id: "duck",
            active: true,
            capabilities: { petTint: true, accessories: false },
          }]);
        },
      },
    });
    // Simulate having opened the Animations subtab earlier: its card data is cached.
    harness.core.runtime.animationOverridesData = { theme: { id: "duck" }, cards: [], sounds: [] };
    harness.core.runtime.themeList = [{
      id: "duck",
      active: true,
      capabilities: { petTint: true, accessories: true },
    }];
    // A mounted map switch so patchMapInPlace takes the in-place themeOverrides branch.
    const sw = new FakeElement("div");
    sw.className = "switch on";
    harness.content.appendChild(sw);
    harness.core.state.mountedControls.animMapSwitches.set("duck:error", {
      element: sw,
      themeId: "duck",
      stateKey: "error",
    });

    harness.core.ops.applyChanges({
      changes: { themeOverrides: { duck: { states: { error: { disabled: true } } } } },
      snapshot: { theme: "duck", themeOverrides: { duck: { states: { error: { disabled: true } } } } },
    });

    assert.strictEqual(
      harness.core.runtime.animationOverridesData,
      null,
      "a map-subtab theme-override patch must invalidate the cached cards so Animations/Sounds refetch"
    );
    assert.strictEqual(listThemesCalls, 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(
      harness.core.runtime.themeList[0].capabilities.accessories,
      false,
      "the registered map-tab fast path must not leave Theme capability metadata stale"
    );
  });

  it("keeps stale sound override prefs resettable from the settings UI", () => {
    const overridesSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-anim-overrides.js"), "utf8");
    assert.ok(
      overridesSource.includes("resetBtn.disabled = !slot.hasStoredOverride;"),
      "sound override row reset must stay enabled when prefs still contain a stale sound override entry"
    );
  });

  it("uses the shared SVG chevron treatment for Animation Overrides rows", () => {
    const overridesSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-anim-overrides.js"), "utf8");
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");

    assert.ok(!overridesSource.includes('chevron.textContent = "\\u25B8";'));
    assert.ok(!overridesSource.includes("chevron.innerHTML"));
    assert.ok(overridesSource.includes('helpers.createDisclosureChevron("anim-override-chevron")'));
    assert.ok(overridesSource.includes("helpers.attachSettingsDisclosure({"));
    assert.ok(!overridesSource.includes('document.createElement("details")'));
    assert.ok(/\.collapsible-group-chevron,\s*\.anim-override-chevron\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*align-items:\s*center;[\s\S]*justify-content:\s*center;[\s\S]*width:\s*18px;[\s\S]*height:\s*18px;[\s\S]*opacity:\s*0\.72;/.test(css));
    assert.ok(/\.collapsible-group-chevron,\s*\.anim-override-chevron\s*\{[\s\S]*transform:\s*translateX\(-6px\) rotate\(0deg\);[\s\S]*transform var\(--settings-disclosure-duration\) var\(--settings-disclosure-easing\)/.test(css));
    assert.ok(/\.collapsible-group-chevron svg,\s*\.anim-override-chevron svg\s*\{[\s\S]*width:\s*16px;[\s\S]*height:\s*16px;[\s\S]*overflow:\s*visible;/.test(css));
    assert.ok(/\.collapsible-group-chevron path,\s*\.anim-override-chevron path\s*\{[\s\S]*fill:\s*none;[\s\S]*stroke:\s*currentColor;[\s\S]*stroke-width:\s*2\.2;[\s\S]*stroke-linecap:\s*round;[\s\S]*stroke-linejoin:\s*round;/.test(css));
    assert.ok(/\.anim-override-row > \.anim-override-summary:hover \.anim-override-chevron\s*\{[\s\S]*color:\s*var\(--text-secondary\);[\s\S]*opacity:\s*0\.95;/.test(css));
    assert.ok(/\.anim-override-row\.expanded\s*>\s*\.anim-override-summary\s+\.anim-override-chevron\s*\{[\s\S]*transform:\s*translateX\(-6px\) rotate\(90deg\);[\s\S]*color:\s*var\(--accent\);[\s\S]*opacity:\s*1;/.test(css));
    assert.ok(/@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.anim-override-chevron,[\s\S]*transition:\s*none;/.test(css));
    assert.ok(/\.anim-override-thumb\s*\{[\s\S]*transform:\s*translateX\(-3px\);/.test(css));
    assert.ok(/\.anim-override-summary-text\s*\{[\s\S]*transform:\s*translateX\(-3px\);/.test(css));
    assert.ok(!/\.anim-override-summary-change\s*\{[\s\S]*translateX\(-3px\)/.test(css));
  });

  it("keeps Animation Override expansion state on the shared disclosure controller", () => {
    const card = createAnimOverrideCard();
    const runtime = createAnimOverridesRuntime(card, { expandedOverrideRowIds: new Set() });
    const modalRoot = new FakeElement("div");
    const { core } = loadAnimOverridesTabForTest({ runtime, modalRoot });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);
    const row = parent.querySelector(".anim-override-row");
    const summary = row.querySelector(".anim-override-summary");
    const body = row.querySelector(".anim-override-body");
    const thumb = row.querySelector(".anim-override-thumb");

    assert.equal(row.tagName, "DIV");
    assert.equal(summary.getAttribute("aria-expanded"), "false");
    assert.equal(body.getAttribute("aria-hidden"), "true");
    summary.click();
    assert.equal(summary.getAttribute("aria-expanded"), "true");
    assert.equal(body.getAttribute("aria-hidden"), "false");
    assert.equal(runtime.expandedOverrideRowIds.has(card.id), true);
    thumb.click();
    assert.equal(runtime.expandedOverrideRowIds.has(card.id), true, "preview clicks must not toggle the row");
    summary.click();
    assert.equal(runtime.expandedOverrideRowIds.has(card.id), false);
  });

  it("uses captured poster previews for trusted scripted animation override SVGs", () => {
    const html = fs.readFileSync(SETTINGS_HTML, "utf8");
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    const previewHtml = fs.readFileSync(SETTINGS_ANIMATION_PREVIEW, "utf8");
    const overridesSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-anim-overrides.js"), "utf8");
    const animationOverridesSource = fs.readFileSync(path.join(SRC_DIR, "settings-animation-overrides-main.js"), "utf8");
    const preloadSource = fs.readFileSync(PRELOAD_SETTINGS, "utf8");
    const rendererSource = fs.readFileSync(SETTINGS_RENDERER, "utf8");

    assert.ok(html.includes("img-src 'self' data: file:"));
    assert.ok(!html.includes("frame-src"));
    assert.ok(html.includes("settings-anim-overrides-merge.js"));
    const themeTabSource = fs.readFileSync(path.join(SRC_DIR, "settings-tab-theme.js"), "utf8");
    assert.ok(!html.includes("object-src"));
    assert.ok(css.includes(".theme-thumb-atlas-frame"));
    assert.ok(css.includes("width: 800%;"));
    assert.ok(themeTabSource.includes("getCodexPetPreviewAtlasUrl"));
    assert.ok(themeTabSource.includes("theme-thumb-atlas-frame"));
    assert.ok(themeTabSource.includes("theme.codexPet.previewAtlasUrl"));
    assert.ok(!themeTabSource.includes('document.createElement("object")'));
    assert.ok(previewHtml.includes("default-src 'self' file:"));
    assert.ok(previewHtml.includes("object-src 'self' file:"));
    assert.ok(previewHtml.includes("script-src 'unsafe-inline'"));
    assert.ok(previewHtml.includes("window.renderAnimationPreviewPoster"));
    assert.ok(previewHtml.includes("width: 285%;"));
    assert.ok(animationOverridesSource.includes("ANIMATION_OVERRIDE_PREVIEW_POSTER_VERSION"));
    assert.ok(!overridesSource.includes('document.createElement("iframe")'));
    assert.ok(overridesSource.includes('if (url.protocol === "data:" || url.protocol === "blob:") return fileUrl;'));
    assert.ok(overridesSource.includes("getCardPreviewUrl(card)"));
    assert.ok(overridesSource.includes("getAssetPreviewUrl(selected)"));
    assert.ok(animationOverridesSource.includes("function needsScriptedAnimationPreviewPoster"));
    assert.ok(animationOverridesSource.includes("function isObjectChannelSvgAnimationFile"));
    assert.ok(animationOverridesSource.includes('theme.rendering.svgChannel === "object"'));
    assert.ok(animationOverridesSource.includes("function captureAnimationPreviewPosterDataUrl"));
    assert.ok(animationOverridesSource.includes("function scheduleAnimationPreviewPosters"));
    assert.ok(animationOverridesSource.includes("capturePage"));
    assert.ok(animationOverridesSource.includes("settings:animation-preview-poster-ready"));
    assert.ok(preloadSource.includes("onAnimationPreviewPosterReady"));
    assert.ok(rendererSource.includes("onAnimationPreviewPosterReady"));
    assert.ok(animationOverridesSource.includes("theme._builtin"));
    assert.ok(animationOverridesSource.includes("trustedRuntime.scriptedSvgFiles"));
    assert.ok(animationOverridesSource.includes("currentFilePreviewUrl: preview.previewImageUrl"));
    assert.ok(animationOverridesSource.includes("previewPosterPending: preview.previewPosterPending"));
    assert.ok(!animationOverridesSource.includes("function hydrateAnimationPreviewPosters"));
  });

  it("merges pushed animation preview posters without accepting stale cache keys", () => {
    const merge = require(SETTINGS_ANIM_OVERRIDES_MERGE);
    const cache = new Map();
    merge.rememberAnimationPreviewPoster(cache, {
      themeId: "cloudling",
      filename: "cloudling-thinking.svg",
      previewImageUrl: "data:image/png;base64,poster-k1",
      previewPosterCacheKey: "K1",
    });

    const data = {
      theme: { id: "cloudling" },
      assets: [{
        name: "cloudling-thinking.svg",
        previewImageUrl: null,
        previewPosterCacheKey: "K1",
        previewPosterPending: true,
      }],
      sections: [{
        cards: [{
          currentFile: "cloudling-thinking.svg",
          currentFilePreviewUrl: null,
          currentFilePreviewPosterCacheKey: "K1",
          previewPosterPending: true,
        }],
      }],
      cards: [{
        currentFile: "cloudling-thinking.svg",
        currentFilePreviewUrl: null,
        currentFilePreviewPosterCacheKey: "K1",
        previewPosterPending: true,
      }],
    };
    merge.mergePosterCacheIntoAnimationData(data, cache);
    assert.strictEqual(data.assets[0].previewImageUrl, "data:image/png;base64,poster-k1");
    assert.strictEqual(data.assets[0].previewPosterPending, false);
    assert.strictEqual(data.sections[0].cards[0].currentFilePreviewUrl, "data:image/png;base64,poster-k1");
    assert.strictEqual(data.cards[0].currentFilePreviewUrl, "data:image/png;base64,poster-k1");

    const mismatch = {
      theme: { id: "cloudling" },
      assets: [{
        name: "cloudling-thinking.svg",
        previewImageUrl: null,
        previewPosterCacheKey: "K2",
        previewPosterPending: true,
      }],
      sections: [{
        cards: [{
          currentFile: "cloudling-thinking.svg",
          currentFilePreviewUrl: null,
          currentFilePreviewPosterCacheKey: "K2",
          previewPosterPending: true,
        }],
      }],
      cards: [{
        currentFile: "cloudling-thinking.svg",
        currentFilePreviewUrl: null,
        currentFilePreviewPosterCacheKey: "K2",
        previewPosterPending: true,
      }],
    };
    merge.mergePosterCacheIntoAnimationData(mismatch, cache);
    assert.strictEqual(mismatch.assets[0].previewImageUrl, null);
    assert.strictEqual(mismatch.sections[0].cards[0].currentFilePreviewUrl, null);
    assert.strictEqual(mismatch.cards[0].currentFilePreviewUrl, null);
  });

  it("keeps poster-ready pushes across an overlapping animation overrides fetch", async () => {
    const deferred = createDeferred();
    const core = loadSettingsCoreForTest({
      getAnimationOverridesData: () => deferred.promise,
    });
    const fetchPromise = core.ops.fetchAnimationOverridesData();
    core.ops.applyAnimationPreviewPoster({
      themeId: "cloudling",
      filename: "cloudling-thinking.svg",
      previewImageUrl: "data:image/png;base64,pushed",
      previewPosterCacheKey: "K1",
    });
    deferred.resolve({
      theme: { id: "cloudling" },
      assets: [{
        name: "cloudling-thinking.svg",
        previewImageUrl: null,
        previewPosterCacheKey: "K1",
        previewPosterPending: true,
      }],
      sections: [{
        cards: [{
          currentFile: "cloudling-thinking.svg",
          currentFilePreviewUrl: null,
          currentFilePreviewPosterCacheKey: "K1",
          previewPosterPending: true,
        }],
      }],
      cards: [{
        currentFile: "cloudling-thinking.svg",
        currentFilePreviewUrl: null,
        currentFilePreviewPosterCacheKey: "K1",
        previewPosterPending: true,
      }],
    });
    await fetchPromise;

    assert.strictEqual(core.runtime.animationOverridesData.assets[0].previewImageUrl, "data:image/png;base64,pushed");
    assert.strictEqual(core.runtime.animationOverridesData.sections[0].cards[0].currentFilePreviewUrl, "data:image/png;base64,pushed");
    assert.strictEqual(core.runtime.animationOverridesData.cards[0].currentFilePreviewUrl, "data:image/png;base64,pushed");
  });

  it("patches pending animation override data when a poster push arrives after fetch", async () => {
    const core = loadSettingsCoreForTest({
      getAnimationOverridesData: () => Promise.resolve({
        theme: { id: "cloudling" },
        assets: [{
          name: "cloudling-thinking.svg",
          previewImageUrl: null,
          previewPosterCacheKey: "K1",
          previewPosterPending: true,
        }],
        sections: [{
          cards: [{
            currentFile: "cloudling-thinking.svg",
            currentFilePreviewUrl: null,
            currentFilePreviewPosterCacheKey: "K1",
            previewPosterPending: true,
          }],
        }],
        cards: [{
          currentFile: "cloudling-thinking.svg",
          currentFilePreviewUrl: null,
          currentFilePreviewPosterCacheKey: "K1",
          previewPosterPending: true,
        }],
      }),
    });

    await core.ops.fetchAnimationOverridesData();
    core.ops.applyAnimationPreviewPoster({
      themeId: "cloudling",
      filename: "cloudling-thinking.svg",
      previewImageUrl: "data:image/png;base64,late-push",
      previewPosterCacheKey: "K1",
    });

    assert.strictEqual(core.runtime.animationOverridesData.assets[0].previewImageUrl, "data:image/png;base64,late-push");
    assert.strictEqual(core.runtime.animationOverridesData.assets[0].previewPosterPending, false);
    assert.strictEqual(core.runtime.animationOverridesData.sections[0].cards[0].currentFilePreviewUrl, "data:image/png;base64,late-push");
    assert.strictEqual(core.runtime.animationOverridesData.cards[0].currentFilePreviewUrl, "data:image/png;base64,late-push");
  });

  it("does not let a stale rejected animation overrides fetch clear newer data", async () => {
    const oldFetch = createDeferred();
    const newFetch = createDeferred();
    const fetches = [oldFetch, newFetch];
    const core = loadSettingsCoreForTest({
      getAnimationOverridesData: () => fetches.shift().promise,
    });

    const oldPromise = core.ops.fetchAnimationOverridesData();
    const newPromise = core.ops.fetchAnimationOverridesData();
    newFetch.resolve({ theme: { id: "calico" }, assets: [{ name: "calico-idle.png" }], sections: [], cards: [] });
    await newPromise;
    oldFetch.reject(new Error("old failed"));
    await oldPromise;

    assert.strictEqual(core.runtime.animationOverridesData.theme.id, "calico");
    assert.strictEqual(core.runtime.animationOverridesData.assets[0].name, "calico-idle.png");
  });

  it("renders pending scripted animation previews as placeholders instead of SVG images", () => {
    const merge = require(SETTINGS_ANIM_OVERRIDES_MERGE);
    const asset = {
      name: "cloudling-thinking.svg",
      fileUrl: "file:///themes/cloudling/assets/cloudling-thinking.svg",
      previewImageUrl: null,
      needsScriptedPreviewPoster: true,
      previewPosterCacheKey: "K1",
      previewPosterPending: true,
      cycleMs: null,
      cycleStatus: "unavailable",
    };
    const card = {
      id: "state:thinking",
      slotType: "state",
      sectionId: "work",
      stateKey: "thinking",
      triggerKind: "thinking",
      currentFile: asset.name,
      currentFileUrl: asset.fileUrl,
      currentFilePreviewUrl: null,
      currentFilePreviewPosterCacheKey: "K1",
      needsScriptedPreviewPoster: true,
      previewPosterPending: true,
      bindingLabel: "states.thinking[0]",
      transition: { in: 150, out: 150 },
      supportsAutoReturn: false,
      supportsDuration: false,
      autoReturnMs: null,
      durationMs: null,
      assetCycleMs: null,
      assetCycleStatus: "unavailable",
      suggestedDurationMs: null,
      suggestedDurationStatus: "unavailable",
      previewDurationMs: null,
      displayHintWarning: false,
      displayHintTarget: null,
      fallbackTargetState: null,
      wideHitboxEnabled: false,
      wideHitboxOverridden: false,
      aspectRatioWarning: null,
    };
    assert.strictEqual(merge.getAssetPreviewUrl(asset), null);
    assert.strictEqual(merge.getCardPreviewUrl(card), null);

    const runtime = {
      animationOverridesData: {
        theme: { id: "cloudling", name: "Cloudling" },
        assets: [asset],
        sections: [{ id: "work", cards: [card] }],
        cards: [card],
        sounds: [],
      },
      animOverridesSubtab: "animations",
      expandedOverrideRowIds: new Set(["state:thinking"]),
      assetPicker: {
        state: null,
        pollTimer: null,
      },
    };
    const modalRoot = new FakeElement("div");
    const { core } = loadAnimOverridesTabForTest({ runtime, modalRoot });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    runtime.assetPicker.state = { cardId: card.id, selectedFile: asset.name };
    core.renderHooks.modal();

    const svgImages = [
      ...parent.querySelectorAll("img"),
      ...modalRoot.querySelectorAll("img"),
    ].filter((img) => String(img.src || "").includes(".svg"));
    assert.strictEqual(svgImages.length, 0);
    assert.ok(parent.querySelectorAll(".anim-override-preview-pending").length >= 2);
    assert.ok(modalRoot.querySelectorAll(".anim-override-preview-pending").length >= 1);
  });

  it("keeps localized shortcut labels from collapsing into vertical CJK text", () => {
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    assert.match(css, /\.shortcut-row-control\s*\{[\s\S]*?flex:\s*1 1 0;[\s\S]*?min-width:\s*0;[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?justify-content:\s*flex-start;[\s\S]*?\}/);
    assert.match(css, /\.shortcut-row \.row-text\s*\{[\s\S]*?flex:\s*0 0 190px;[\s\S]*?\}/);
    assert.match(css, /\.shortcut-row \.row-label\s*\{[\s\S]*?word-break:\s*keep-all;[\s\S]*?overflow-wrap:\s*normal;[\s\S]*?\}/);
    assert.match(css, /\.shortcut-value\s*\{[\s\S]*?flex:\s*1 1 190px;[\s\S]*?min-width:\s*160px;[\s\S]*?max-width:\s*286px;[\s\S]*?\}/);
  });

  it("counts sound overrides in the theme-overrides reset gate", () => {
    const coreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    assert.ok(
      coreSource.includes("function hasAnyThemeOverride(themeId)"),
      "settings-ui-core.js should expose a helper for any stored theme override"
    );
    assert.ok(
      coreSource.includes("...(map.sounds ? Object.keys(map.sounds) : []),"),
      "sound overrides must participate in the global reset-all gate"
    );
  });

  it("does not treat an empty hitbox override group as a reset-all override", () => {
    const core = loadSettingsCoreForTest({});
    core.state.snapshot = {
      themeOverrides: {
        cloudling: {
          hitbox: {
            wide: {},
          },
        },
      },
    };

    assert.strictEqual(core.readers.hasAnyThemeOverride("cloudling"), false);

    core.state.snapshot.themeOverrides.cloudling.hitbox.wide["cloudling-thinking.svg"] = true;
    assert.strictEqual(core.readers.hasAnyThemeOverride("cloudling"), true);
  });

  it("keeps current Animation Overrides data visible while theme override refresh is pending", () => {
    const deferred = createDeferred();
    const core = loadSettingsCoreForTest({
      getAnimationOverridesData: () => deferred.promise,
    });
    const previousData = {
      theme: { id: "cloudling", name: "Cloudling" },
      assets: [],
      sections: [{ id: "work", cards: [] }],
      cards: [],
      sounds: [],
    };
    core.state.activeTab = "animOverrides";
    core.state.snapshot = {
      theme: "cloudling",
      themeOverrides: {
        cloudling: {
          states: {
            thinking: {
              transition: { in: 120, out: 180 },
            },
          },
        },
      },
    };
    core.runtime.animationOverridesData = previousData;

    let renderCount = 0;
    core.ops.installRenderHooks({
      sidebar: () => {},
      content: () => {
        renderCount++;
      },
      modal: () => {},
    });
    core.ops.applyChanges({
      changes: {
        themeOverrides: {
          cloudling: {
            states: {
              thinking: {
                transition: { in: 220, out: 180 },
              },
            },
          },
        },
      },
      snapshot: core.state.snapshot,
    });

    assert.strictEqual(
      core.runtime.animationOverridesData,
      previousData,
      "Animation Overrides should keep the last rendered data while the async refresh is pending"
    );
    assert.strictEqual(renderCount, 0, "pending refresh should not immediately rerender into an empty loading page");
  });

  it("lets Animation Overrides patch theme override broadcasts before a full content render", () => {
    const core = loadSettingsCoreForTest({
      getAnimationOverridesData: () => Promise.resolve({ cards: [], sections: [], sounds: [] }),
    });
    core.state.activeTab = "animOverrides";
    core.state.snapshot = {
      theme: "cloudling",
      themeOverrides: {},
    };
    core.runtime.animationOverridesData = {
      theme: { id: "cloudling", name: "Cloudling" },
      assets: [],
      sections: [],
      cards: [],
      sounds: [],
    };

    let patchCount = 0;
    let contentRenderCount = 0;
    core.tabs.animOverrides = {
      patchInPlace(changes) {
        patchCount++;
        assert.ok(changes && Object.prototype.hasOwnProperty.call(changes, "themeOverrides"));
        return true;
      },
    };
    core.ops.installRenderHooks({
      sidebar: () => {},
      content: () => {
        contentRenderCount++;
      },
      modal: () => {},
    });

    core.ops.applyChanges({
      changes: { themeOverrides: { cloudling: { states: {} } } },
      snapshot: core.state.snapshot,
    });

    assert.strictEqual(patchCount, 1);
    assert.strictEqual(contentRenderCount, 0);
  });

  it("renders the idle visual picker and submits setIdleVisual for the chosen option", async () => {
    const commandCalls = [];
    const runtime = createIdleVisualRuntime();
    const modalRoot = new FakeElement("div");
    const { core, document } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: (name, payload) => {
          commandCalls.push({ name, payload });
          return Promise.resolve({ status: "ok" });
        },
      },
    });
    const parent = new FakeElement("main");
    document.body.appendChild(parent);
    core.tabs.animOverrides.render(parent, core);

    assert.strictEqual(parent.querySelectorAll(".anim-idle-visual-row").length, 1);
    const valueEl = parent.querySelector(".anim-idle-visual-row .language-picker-value");
    assert.strictEqual(valueEl.textContent, "animIdleVisualThemeDefault");
    const options = parent.querySelectorAll(".anim-idle-visual-row .language-picker-option");
    assert.strictEqual(options.length, 2);

    options[1].dispatchEvent({ type: "click" });
    await Promise.resolve();
    assert.strictEqual(commandCalls.length, 1);
    assert.strictEqual(commandCalls[0].name, "setIdleVisual");
    // spread: the payload object comes from the VM realm, whose Object
    // prototype fails deepStrictEqual against test-realm literals.
    assert.deepStrictEqual(
      { ...commandCalls[0].payload },
      { themeId: "duck", file: "duck-idle-reading.svg" }
    );
    assert.strictEqual(valueEl.textContent, "Idle Reading", "optimistic display should show the pick immediately");
  });

  it("mounts the idle visual menu while open and removes it from layout after close", () => {
    const runtime = createIdleVisualRuntime();
    const modalRoot = new FakeElement("div");
    const { core, document } = loadAnimOverridesTabForTest({ runtime, modalRoot });
    const parent = new FakeElement("main");
    document.body.appendChild(parent);
    core.tabs.animOverrides.render(parent, core);

    const picker = parent.querySelector(".anim-idle-visual-row .language-picker");
    const trigger = picker.querySelector(".language-picker-trigger");
    const menu = picker.querySelector(".language-picker-menu");

    trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(trigger.getAttribute("aria-expanded"), "true");
    assert.strictEqual(menu.getAttribute("aria-hidden"), "false");
    assert.strictEqual(
      picker.classList.contains("menu-mounted"),
      true,
      "the shared CSS only displays mounted picker menus",
    );

    trigger.dispatchEvent({ type: "click" });
    assert.strictEqual(trigger.getAttribute("aria-expanded"), "false");
    assert.strictEqual(menu.getAttribute("aria-hidden"), "true");
    assert.strictEqual(picker.classList.contains("menu-mounted"), false);
  });

  it("patches idleVisual-only broadcasts in place and re-syncs the mounted picker", () => {
    const runtime = createIdleVisualRuntime();
    const modalRoot = new FakeElement("div");
    const { core, document } = loadAnimOverridesTabForTest({ runtime, modalRoot });
    const parent = new FakeElement("main");
    document.body.appendChild(parent);
    core.tabs.animOverrides.render(parent, core);
    const valueEl = parent.querySelector(".anim-idle-visual-row .language-picker-value");
    assert.strictEqual(valueEl.textContent, "animIdleVisualThemeDefault");

    const handled = core.tabs.animOverrides.patchInPlace({ idleVisual: { duck: "duck-idle-reading.svg" } });
    assert.strictEqual(handled, true, "idleVisual-only broadcast must not trigger a full re-render");
    assert.strictEqual(runtime.animationOverridesData.idleDefaultVisual.selectedFile, "duck-idle-reading.svg");
    assert.strictEqual(valueEl.textContent, "Idle Reading");

    const handledReset = core.tabs.animOverrides.patchInPlace({ idleVisual: {} });
    assert.strictEqual(handledReset, true);
    assert.strictEqual(runtime.animationOverridesData.idleDefaultVisual.selectedFile, null);
    assert.strictEqual(valueEl.textContent, "animIdleVisualThemeDefault");
  });

  it("cleans up idle visual picker document listeners through the mounted-control dispose contract", () => {
    const runtime = createIdleVisualRuntime();
    const modalRoot = new FakeElement("div");
    const { core, document, documentListenerCount } = loadAnimOverridesTabForTest({ runtime, modalRoot });
    const parent = new FakeElement("main");
    document.body.appendChild(parent);
    core.tabs.animOverrides.render(parent, core);

    assert.strictEqual(documentListenerCount("click"), 1);
    assert.strictEqual(documentListenerCount("keydown"), 1);
    const picker = core.state.mountedControls.idleVisualPicker;
    assert.strictEqual(typeof picker.dispose, "function");
    picker.dispose();
    assert.strictEqual(documentListenerCount("click"), 0);
    assert.strictEqual(documentListenerCount("keydown"), 0);

    // settings-ui-core owns calling dispose between renders — pin that wiring.
    const uiCoreSource = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    assert.ok(uiCoreSource.includes("state.mountedControls.idleVisualPicker.dispose()"));
    assert.ok(uiCoreSource.includes("state.mountedControls.idleVisualPicker = null;"));
    assert.ok(uiCoreSource.includes("idleVisualPicker: null,"));
  });

  it("disposes Animation Override disclosures before rerendering their rows", () => {
    const runtime = createAnimOverridesRuntime(createAnimOverrideCard(), { expandedOverrideRowIds: new Set() });
    const modalRoot = new FakeElement("div");
    const { core, document } = loadAnimOverridesTabForTest({ runtime, modalRoot });
    const parent = new FakeElement("main");
    document.body.appendChild(parent);

    core.tabs.animOverrides.render(parent, core);
    const oldTrigger = parent.querySelector(".anim-override-row").querySelector(".anim-override-summary");
    oldTrigger.click();
    assert.equal(oldTrigger.getAttribute("aria-expanded"), "true");

    core.ops.clearMountedControls();
    core.tabs.animOverrides.render(parent, core);
    oldTrigger.click();
    assert.equal(
      oldTrigger.getAttribute("aria-expanded"),
      "true",
      "the detached row must not retain its disclosure listener",
    );
  });

  it("renders visible loading text for the initial Animation Overrides fetch", () => {
    const runtime = {
      animationOverridesData: null,
      animOverridesSubtab: "animations",
      expandedOverrideRowIds: new Set(),
      assetPicker: {
        state: null,
        pollTimer: null,
      },
    };
    const modalRoot = new FakeElement("div");
    const { core } = loadAnimOverridesTabForTest({ runtime, modalRoot });
    const parent = new FakeElement("main");

    core.tabs.animOverrides.render(parent, core);

    const placeholders = parent.querySelectorAll(".placeholder-desc");
    assert.ok(placeholders.length > 0);
    assert.strictEqual(placeholders[0].textContent, "animOverridesLoading");
  });

  it("renders Animation Overrides theme actions in two intentional rows", () => {
    const runtime = createAnimOverridesRuntime(createAnimOverrideCard());
    const modalRoot = new FakeElement("div");
    const { core } = loadAnimOverridesTabForTest({ runtime, modalRoot });
    const parent = new FakeElement("main");

    core.tabs.animOverrides.render(parent, core);

    const meta = parent.querySelector(".anim-override-meta");
    assert.ok(meta);
    assert.deepStrictEqual(
      meta.querySelectorAll(".anim-override-meta-label").map((label) => label.textContent),
      ["animOverridesCurrentTheme: Cloudling", "animOverridesReplacementConfig"]
    );

    const primary = meta.querySelector(".anim-override-meta-primary-actions");
    const secondary = meta.querySelector(".anim-override-meta-secondary-actions");
    assert.deepStrictEqual(
      primary.querySelectorAll("button").map((button) => button.textContent),
      ["animOverridesOpenThemeTab", "animOverridesOpenAssets"]
    );
    assert.deepStrictEqual(
      secondary.querySelectorAll("button").map((button) => button.textContent),
      ["animOverridesImport", "animOverridesExport", "animOverridesResetAll"]
    );
    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    assert.match(
      css,
      /\.anim-override-meta\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto;/
    );
    assert.match(
      css,
      /\.anim-override-meta-actions\s*\{[\s\S]*align-items:\s*center;[\s\S]*justify-content:\s*flex-end;/
    );
    assert.match(
      css,
      /@media \(max-width:\s*640px\)\s*\{[\s\S]*\.anim-override-meta-actions\s*\{[\s\S]*justify-content:\s*flex-start;/
    );

    const strings = loadSettingsI18nForTest();
    assert.strictEqual(strings.en.animOverridesReplacementConfig, "Animation override settings");
    assert.strictEqual(strings.zh.animOverridesReplacementConfig, "动画覆盖设置");
    assert.strictEqual(strings["zh-TW"].animOverridesReplacementConfig, "動畫自訂設定");
    assert.strictEqual(strings.en.animOverridesImport, "Import config…");
    assert.strictEqual(strings.zh.animOverridesImport, "导入配置…");
    assert.strictEqual(strings["zh-TW"].animOverridesImport, "匯入設定…");
    assert.strictEqual(strings.en.animOverridesExport, "Export config…");
    assert.strictEqual(strings.zh.animOverridesExport, "导出配置…");
    assert.strictEqual(strings["zh-TW"].animOverridesExport, "匯出設定…");
    assert.strictEqual(strings.en.animOverridesResetAll, "Restore theme defaults");
    assert.strictEqual(strings.zh.animOverridesResetAll, "恢复主题默认");
    assert.strictEqual(strings["zh-TW"].animOverridesResetAll, "還原主題預設值");
    assert.match(
      css,
      /@media \(max-width:\s*640px\)\s*\{[\s\S]*\.anim-override-meta\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);/
    );
  });

  it("does not build Animation Overrides theme actions on the Sounds subtab", () => {
    const runtime = createAnimOverridesRuntime(createAnimOverrideCard(), { animOverridesSubtab: "sounds" });
    const modalRoot = new FakeElement("div");
    let activationCount = 0;
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      helpersOverrides: {
        attachActivation: (el, invoke) => {
          activationCount += 1;
          if (typeof invoke === "function") el.addEventListener("click", () => invoke());
          return el;
        },
      },
    });
    const parent = new FakeElement("main");

    core.tabs.animOverrides.render(parent, core);

    assert.strictEqual(parent.querySelector(".anim-override-meta"), null);
    assert.strictEqual(activationCount, 1, "only the Sounds directory button should be wired");
  });

  it("uses specific fade timing labels and gives the slider label enough room", () => {
    const strings = loadSettingsI18nForTest();
    assert.strictEqual(strings.en.animOverridesFadeIn, "Fade in on enter");
    assert.strictEqual(strings.en.animOverridesFadeOut, "Fade out on exit");
    assert.strictEqual(strings.zh.animOverridesFadeIn, "进入时淡入");
    assert.strictEqual(strings.zh.animOverridesFadeOut, "退出时淡出");
    assert.strictEqual(strings["zh-TW"].animOverridesFadeIn, "進入時淡化顯示");
    assert.strictEqual(strings["zh-TW"].animOverridesFadeOut, "退出時淡化隱藏");

    const css = fs.readFileSync(SETTINGS_CSS, "utf8");
    assert.match(
      css,
      /\.anim-override-slider-row\s*\{[\s\S]*grid-template-columns:\s*96px minmax\(0,\s*1fr\) 100px;/
    );
    assert.match(
      css,
      /\.anim-override-number-field\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*white-space:\s*nowrap;/
    );
    assert.match(
      css,
      /\.anim-override-slider-row input\[type="number"\]\s*\{[\s\S]*width:\s*76px;[\s\S]*text-align:\s*center;/
    );
    assert.match(
      css,
      /\.anim-override-slider-row input\[type="range"\]\s*\{[\s\S]*--anim-override-fill:\s*0%;/
    );
    assert.match(
      css,
      /\.anim-override-slider-row input\[type="range"\]::-webkit-slider-runnable-track\s*\{[\s\S]*var\(--accent\) var\(--anim-override-fill\)/
    );
    assert.match(
      css,
      /\.anim-override-slider-row input\[type="range"\]::-webkit-slider-runnable-track\s*\{[\s\S]*var\(--row-border\) var\(--anim-override-fill\)/
    );
    assert.match(
      css,
      /\.anim-override-slider-row input\[type="range"\]::-webkit-slider-thumb\s*\{[\s\S]*-webkit-appearance:\s*none;[\s\S]*box-shadow:/
    );
    assert.match(
      css,
      /\.anim-override-slider-row input\[type="range"\]::-webkit-slider-thumb\s*\{[\s\S]*color-mix\(in srgb,\s*var\(--accent\)/
    );
    assert.match(
      css,
      /\.anim-override-slider-row input\[type="range"\]:hover::-webkit-slider-thumb\s*\{[\s\S]*transform:\s*scale\(1\.08\);/
    );
    assert.match(
      css,
      /@media \(forced-colors:\s*active\)\s*\{[\s\S]*accent-color:\s*Highlight;/
    );
  });

  it("keeps committed slider timing visible across a stale animation override refresh", async () => {
    const card = {
      id: "state:thinking",
      slotType: "state",
      stateKey: "thinking",
      triggerKind: "thinking",
      currentFile: "cloudling-thinking.svg",
      currentFileUrl: "file:///themes/cloudling/assets/cloudling-thinking.svg",
      currentFilePreviewUrl: "file:///themes/cloudling/assets/cloudling-thinking.svg",
      bindingLabel: "states.thinking[0]",
      transition: { in: 120, out: 180 },
      supportsAutoReturn: false,
      supportsDuration: false,
      assetCycleMs: 1000,
      assetCycleStatus: "ok",
      suggestedDurationMs: null,
      suggestedDurationStatus: "unavailable",
      previewDurationMs: 1000,
      displayHintWarning: false,
      displayHintTarget: null,
      fallbackTargetState: null,
      wideHitboxEnabled: false,
      wideHitboxOverridden: false,
      aspectRatioWarning: null,
    };
    const runtime = {
      animationOverridesData: {
        theme: { id: "cloudling", name: "Cloudling" },
        assets: [],
        sections: [{ id: "work", cards: [card] }],
        cards: [card],
        sounds: [],
      },
      animOverridesSubtab: "animations",
      expandedOverrideRowIds: new Set(["state:thinking"]),
      assetPicker: {
        state: null,
        pollTimer: null,
      },
    };
    const modalRoot = new FakeElement("div");
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: () => Promise.resolve({ status: "ok" }),
      },
      opsOverrides: {
        fetchAnimationOverridesData: () => Promise.resolve(runtime.animationOverridesData),
      },
    });
    const parent = new FakeElement("main");
    let contentRenderCount = 0;
    const renderContent = () => {
      contentRenderCount++;
      parent.innerHTML = "";
      core.tabs.animOverrides.render(parent, core);
    };
    core.ops.requestRender = ({ content = false, modal = false } = {}) => {
      if (content) renderContent();
      if (modal && typeof core.renderHooks.modal === "function") core.renderHooks.modal();
    };
    renderContent();

    const range = parent.querySelectorAll("input").find((input) => input.type === "range");
    assert.ok(range, "expanded animation override row should render a fade-in range input");
    assert.strictEqual(range.style.getPropertyValue("--anim-override-fill"), "12%");
    range.value = "260";
    for (const listener of range.eventListeners.input || []) listener();
    assert.strictEqual(range.style.getPropertyValue("--anim-override-fill"), "26%");
    for (const listener of range.eventListeners.change || []) listener();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const nextRange = parent.querySelectorAll("input").find((input) => input.type === "range");
    assert.strictEqual(contentRenderCount, 1, "timing slider commits should not rebuild the content pane");
    assert.strictEqual(nextRange, range, "timing slider commits should keep the mounted range control in place");
    assert.strictEqual(
      nextRange.value,
      "260",
      "stale refreshes should not flash the slider back to the old committed timing"
    );
  });

  it("updates Animation Overrides reset affordances after the first timing commit", async () => {
    const card = createAnimOverrideCard({
      transition: { in: 150, out: 150 },
      transitionThemeDefault: { in: 150, out: 150 },
      hasTransitionOverride: false,
    });
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const payloads = [];
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: (_name, payload) => {
          payloads.push(payload);
          return Promise.resolve({ status: "ok" });
        },
      },
      opsOverrides: {
        fetchAnimationOverridesData: () => {
          Object.assign(runtime.animationOverridesData.cards[0], {
            transition: { in: 160, out: 150 },
            transitionThemeDefault: { in: 150, out: 150 },
            hasTransitionOverride: true,
          });
          return Promise.resolve(runtime.animationOverridesData);
        },
      },
    });
    const parent = new FakeElement("main");
    let contentRenderCount = 0;
    const renderContent = () => {
      contentRenderCount++;
      parent.innerHTML = "";
      core.tabs.animOverrides.render(parent, core);
    };
    core.ops.requestRender = ({ content = false, modal = false } = {}) => {
      if (content) renderContent();
      if (modal && typeof core.renderHooks.modal === "function") core.renderHooks.modal();
    };
    renderContent();

    const range = parent.querySelectorAll("input").find((input) => input.type === "range");
    const resetButton = parent.querySelectorAll("button").find((button) => button.textContent === "animOverridesReset");
    assert.ok(range);
    assert.ok(resetButton);
    assert.strictEqual(resetButton.disabled, true);
    assert.strictEqual(parent.querySelector(".anim-override-badge-dot"), null);

    range.value = "160";
    for (const listener of range.eventListeners.input || []) listener();
    for (const listener of range.eventListeners.change || []) listener();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(payloads.length, 1);
    assert.strictEqual(payloads[0].transitionThemeDefault.in, 150);
    assert.strictEqual(payloads[0].transitionThemeDefault.out, 150);
    assert.strictEqual(contentRenderCount, 1, "timing-only commits should keep the content DOM mounted");
    assert.strictEqual(resetButton.disabled, false, "first timing commit should enable the slot reset button");
    assert.ok(parent.querySelector(".anim-override-badge-dot"), "first timing commit should show the changed badge");
  });

  it("clears Animation Overrides reset affordances when timing returns to the theme default", async () => {
    const card = createAnimOverrideCard({
      transition: { in: 160, out: 150 },
      transitionThemeDefault: { in: 150, out: 150 },
      hasTransitionOverride: true,
    });
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const payloads = [];
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: (_name, payload) => {
          payloads.push(payload);
          return Promise.resolve({ status: "ok" });
        },
      },
      opsOverrides: {
        fetchAnimationOverridesData: () => {
          Object.assign(runtime.animationOverridesData.cards[0], {
            transition: { in: 150, out: 150 },
            transitionThemeDefault: { in: 150, out: 150 },
            hasTransitionOverride: false,
          });
          return Promise.resolve(runtime.animationOverridesData);
        },
      },
      readersOverrides: {
        readThemeOverrideMap: () => ({
          states: {
            thinking: {
              transition: { in: 160, out: 150 },
            },
          },
        }),
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const range = parent.querySelectorAll("input").find((input) => input.type === "range");
    const resetButton = parent.querySelectorAll("button").find((button) => button.textContent === "animOverridesReset");
    assert.ok(range);
    assert.ok(resetButton);
    assert.strictEqual(resetButton.disabled, false);
    assert.ok(parent.querySelector(".anim-override-badge-dot"));

    range.value = "150";
    for (const listener of range.eventListeners.input || []) listener();
    for (const listener of range.eventListeners.change || []) listener();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(payloads.length, 1);
    assert.strictEqual(payloads[0].transition.in, 150);
    assert.strictEqual(payloads[0].transition.out, 150);
    assert.strictEqual(payloads[0].transitionThemeDefault.in, 150);
    assert.strictEqual(payloads[0].transitionThemeDefault.out, 150);
    assert.strictEqual(resetButton.disabled, true, "returning to default timing should disable slot reset");
    assert.strictEqual(parent.querySelector(".anim-override-badge-dot"), null);
  });

  it("keeps sequential fade timing commits from reverting the previous side", async () => {
    const card = createAnimOverrideCard();
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const payloads = [];
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: (_name, payload) => {
          payloads.push(payload);
          return Promise.resolve({ status: "ok" });
        },
      },
      opsOverrides: {
        fetchAnimationOverridesData: () => Promise.resolve(runtime.animationOverridesData),
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const ranges = parent.querySelectorAll("input").filter((input) => input.type === "range");
    assert.ok(ranges.length >= 2, "expanded row should render fade in and fade out sliders");

    ranges[0].value = "260";
    for (const listener of ranges[0].eventListeners.input || []) listener();
    for (const listener of ranges[0].eventListeners.change || []) listener();
    await Promise.resolve();
    await Promise.resolve();

    ranges[1].value = "300";
    for (const listener of ranges[1].eventListeners.input || []) listener();
    for (const listener of ranges[1].eventListeners.change || []) listener();
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(payloads.length, 2);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(payloads[0].transition)), { in: 260, out: 180 });
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(payloads[1].transition)),
      { in: 260, out: 300 },
      "second fade commit should use the pending/latest fade-in value, not the stale rendered card"
    );
  });

  it("does not submit duplicate animation timing commands on number change followed by blur", async () => {
    const card = {
      id: "state:thinking",
      slotType: "state",
      stateKey: "thinking",
      triggerKind: "thinking",
      currentFile: "cloudling-thinking.svg",
      currentFileUrl: "file:///themes/cloudling/assets/cloudling-thinking.svg",
      currentFilePreviewUrl: "file:///themes/cloudling/assets/cloudling-thinking.svg",
      bindingLabel: "states.thinking[0]",
      transition: { in: 120, out: 180 },
      supportsAutoReturn: false,
      supportsDuration: false,
      assetCycleMs: 1000,
      assetCycleStatus: "ok",
      suggestedDurationMs: null,
      suggestedDurationStatus: "unavailable",
      previewDurationMs: 1000,
      displayHintWarning: false,
      displayHintTarget: null,
      fallbackTargetState: null,
      wideHitboxEnabled: false,
      wideHitboxOverridden: false,
      aspectRatioWarning: null,
    };
    const runtime = {
      animationOverridesData: {
        theme: { id: "cloudling", name: "Cloudling" },
        assets: [],
        sections: [{ id: "work", cards: [card] }],
        cards: [card],
        sounds: [],
      },
      animOverridesSubtab: "animations",
      expandedOverrideRowIds: new Set(["state:thinking"]),
      assetPicker: {
        state: null,
        pollTimer: null,
      },
    };
    const modalRoot = new FakeElement("div");
    let commandCount = 0;
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: () => {
          commandCount++;
          return Promise.resolve({ status: "ok" });
        },
      },
      opsOverrides: {
        fetchAnimationOverridesData: () => Promise.resolve(runtime.animationOverridesData),
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const inputs = parent.querySelectorAll("input");
    const range = inputs.find((input) => input.type === "range");
    const number = inputs.find((input) => input.type === "number");
    assert.ok(range, "expanded animation override row should render a fade-in range input");
    assert.ok(number, "expanded animation override row should render a fade-in number input");
    assert.ok(number.parentNode.classList.contains("anim-override-number-field"));
    const unit = number.parentNode.querySelector(".anim-override-slider-unit");
    assert.ok(unit, "timing number input should render an inline unit label");
    assert.strictEqual(unit.textContent, "ms");
    number.value = "260";
    for (const listener of number.eventListeners.input || []) listener();
    assert.strictEqual(range.style.getPropertyValue("--anim-override-fill"), "26%");
    for (const listener of number.eventListeners.change || []) listener();
    for (const listener of number.eventListeners.blur || []) listener();
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(commandCount, 1);
  });

  it("renders the wide hitbox control as a scoped toggle instead of a full-row label", () => {
    const card = createAnimOverrideCard();
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const { core } = loadAnimOverridesTabForTest({ runtime, modalRoot });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const row = parent.querySelector(".anim-override-toggle-row");
    const input = parent.querySelectorAll("input").find((candidate) => candidate.type === "checkbox");
    const title = parent.querySelector(".anim-override-toggle-title");

    assert.ok(row, "expanded animation override row should render a wide-hitbox toggle row");
    assert.strictEqual(row.tagName, "DIV");
    assert.strictEqual(input.getAttribute("aria-label"), "animOverridesWideHitboxToggle");
    assert.ok(title);
    assert.strictEqual((title.eventListeners.click || []).length, 0);
  });

  it("uses null to clear wide hitbox overrides that match the theme default and avoids rebuilding content", async () => {
    const card = createAnimOverrideCard({
      wideHitboxEnabled: false,
      wideHitboxOverridden: false,
      wideHitboxThemeDefault: false,
    });
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const payloads = [];
    let fetchCount = 0;
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: (_name, payload) => {
          payloads.push(payload);
          return Promise.resolve({ status: "ok" });
        },
      },
      opsOverrides: {
        fetchAnimationOverridesData: () => {
          fetchCount++;
          Object.assign(runtime.animationOverridesData.cards[0], fetchCount === 1
            ? {
                wideHitboxEnabled: true,
                wideHitboxOverridden: true,
                wideHitboxThemeDefault: false,
              }
            : {
                wideHitboxEnabled: false,
                wideHitboxOverridden: false,
                wideHitboxThemeDefault: false,
              });
          return Promise.resolve(runtime.animationOverridesData);
        },
      },
    });
    const parent = new FakeElement("main");
    let contentRenderCount = 0;
    const renderContent = () => {
      contentRenderCount++;
      parent.innerHTML = "";
      core.tabs.animOverrides.render(parent, core);
    };
    core.ops.requestRender = ({ content = false, modal = false } = {}) => {
      if (content) renderContent();
      if (modal && typeof core.renderHooks.modal === "function") core.renderHooks.modal();
    };
    renderContent();

    const toggle = parent.querySelectorAll("input").find((input) => input.type === "checkbox");
    assert.ok(toggle, "expanded animation override row should render a wide-hitbox checkbox");

    toggle.checked = true;
    for (const listener of toggle.eventListeners.change || []) listener();
    await Promise.resolve();
    await Promise.resolve();
    let resetButton = parent.querySelectorAll("button").find((button) => button.textContent === "animOverridesReset");
    assert.ok(parent.querySelector(".anim-override-badge-dot"), "wide-hitbox commit should update the summary changed badge in place");
    assert.strictEqual(resetButton.disabled, false, "wide-hitbox commit should enable reset affordance in place");

    toggle.checked = false;
    for (const listener of toggle.eventListeners.change || []) listener();
    await Promise.resolve();
    await Promise.resolve();
    resetButton = parent.querySelectorAll("button").find((button) => button.textContent === "animOverridesReset");
    assert.strictEqual(parent.querySelector(".anim-override-badge-dot"), null, "theme-default hitbox commit should clear the changed badge in place");
    assert.strictEqual(resetButton.disabled, true, "theme-default hitbox commit should disable reset affordance in place");

    assert.strictEqual(payloads.length, 2);
    assert.strictEqual(payloads[0].enabled, true);
    assert.strictEqual(payloads[1].enabled, null);
    assert.strictEqual(contentRenderCount, 1, "wide-hitbox toggle commits should not rebuild the content pane");
  });

  it("shows the wide hitbox reset chip for stale overrides that already match the theme default", () => {
    const card = createAnimOverrideCard({
      wideHitboxEnabled: false,
      wideHitboxOverridden: true,
      wideHitboxThemeDefault: false,
    });
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const { core } = loadAnimOverridesTabForTest({ runtime, modalRoot });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const resetChip = parent.querySelectorAll("button")
      .find((button) => button.textContent === "animOverridesWideHitboxResetToTheme");
    assert.ok(resetChip, "wide-hitbox reset chip should render for stale no-op overrides");
    assert.strictEqual(resetChip.hidden, false);
    assert.strictEqual(resetChip.disabled, false);
  });

  it("shows a fallback error detail when wide hitbox saves fail without a message", async () => {
    const card = createAnimOverrideCard();
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const toasts = [];
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: () => Promise.resolve({ status: "error" }),
      },
      opsOverrides: {
        showToast: (message) => toasts.push(message),
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const toggle = parent.querySelectorAll("input").find((input) => input.type === "checkbox");
    toggle.checked = true;
    for (const listener of toggle.eventListeners.change || []) listener();
    await Promise.resolve();
    await Promise.resolve();

    assert.ok(toasts.some((message) => String(message).includes("unknown error")));
  });

  it("preserves pending wide hitbox state across full Animation Overrides rerenders", async () => {
    const card = createAnimOverrideCard({
      wideHitboxEnabled: false,
      wideHitboxOverridden: false,
      wideHitboxThemeDefault: false,
    });
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    let resolveCommand;
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: () => new Promise((resolve) => {
          resolveCommand = resolve;
        }),
      },
      opsOverrides: {
        fetchAnimationOverridesData: () => {
          Object.assign(runtime.animationOverridesData.cards[0], {
            wideHitboxEnabled: true,
            wideHitboxOverridden: true,
            wideHitboxThemeDefault: false,
          });
          return Promise.resolve(runtime.animationOverridesData);
        },
      },
    });
    const parent = new FakeElement("main");
    const renderContent = () => {
      parent.innerHTML = "";
      core.tabs.animOverrides.render(parent, core);
    };
    core.ops.requestRender = ({ content = false, modal = false } = {}) => {
      if (content) renderContent();
      if (modal && typeof core.renderHooks.modal === "function") core.renderHooks.modal();
    };
    renderContent();

    let toggle = parent.querySelectorAll("input").find((input) => input.type === "checkbox");
    assert.ok(toggle, "expanded animation override row should render a wide-hitbox checkbox");

    toggle.checked = true;
    for (const listener of toggle.eventListeners.change || []) listener();

    renderContent();

    toggle = parent.querySelectorAll("input").find((input) => input.type === "checkbox");
    const resetChip = parent.querySelectorAll("button")
      .find((button) => button.textContent === "animOverridesWideHitboxResetToTheme");
    let resetButton = parent.querySelectorAll("button")
      .find((button) => button.textContent === "animOverridesReset");
    assert.ok(toggle, "wide-hitbox checkbox should still exist after rerender");
    assert.strictEqual(toggle.checked, true, "pending wide-hitbox toggles should stay on across rerenders");
    assert.strictEqual(toggle.disabled, true, "pending wide-hitbox toggles should stay disabled across rerenders");
    assert.ok(resetChip, "wide-hitbox reset chip should still exist after rerender");
    assert.strictEqual(resetChip.hidden, false, "pending wide-hitbox rerenders should keep the reset chip visible");
    assert.strictEqual(resetChip.disabled, true, "pending wide-hitbox rerenders should keep the reset chip disabled");
    assert.ok(resetButton, "pending wide-hitbox rerenders should keep the slot reset button mounted");
    assert.strictEqual(resetButton.disabled, true, "slot reset should stay disabled while a wide-hitbox edit is pending");

    resolveCommand({ status: "ok" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    toggle = parent.querySelectorAll("input").find((input) => input.type === "checkbox");
    resetButton = parent.querySelectorAll("button")
      .find((button) => button.textContent === "animOverridesReset");
    assert.strictEqual(toggle.checked, true);
    assert.strictEqual(toggle.disabled, false);
    assert.strictEqual(resetButton.disabled, false);
  });

  it("blocks wide hitbox edits while a same-card timing edit is pending", async () => {
    const card = createAnimOverrideCard();
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const calls = [];
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: (name, payload) => {
          calls.push({ name, payload });
          return new Promise(() => {});
        },
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const range = parent.querySelectorAll("input").find((input) => input.type === "range");
    const toggle = parent.querySelectorAll("input").find((input) => input.type === "checkbox");
    range.value = "260";
    for (const listener of range.eventListeners.change || []) listener();

    assert.strictEqual(toggle.disabled, true, "wide-hitbox toggle should be blocked while timing is pending");
    toggle.checked = true;
    for (const listener of toggle.eventListeners.change || []) listener();
    await Promise.resolve();

    assert.deepStrictEqual(
      calls.map((call) => call.name),
      ["setAnimationOverride"],
      "blocked wide-hitbox changes should not enqueue a second override command"
    );
  });

  it("blocks slot reset while a same-card timing edit is pending", async () => {
    const card = createAnimOverrideCard({
      hasTransitionOverride: true,
    });
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const calls = [];
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: (name, payload) => {
          calls.push({ name, payload });
          return new Promise(() => {});
        },
      },
      readersOverrides: {
        readThemeOverrideMap: () => ({
          states: {
            thinking: {
              transition: { in: 120, out: 180 },
            },
          },
        }),
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const range = parent.querySelectorAll("input").find((input) => input.type === "range");
    const resetButton = parent.querySelectorAll("button").find((button) => button.textContent === "animOverridesReset");
    range.value = "260";
    for (const listener of range.eventListeners.change || []) listener();

    assert.strictEqual(resetButton.disabled, true, "slot reset should be blocked while timing is pending");
    for (const listener of resetButton.eventListeners.click || []) listener();
    await Promise.resolve();

    assert.deepStrictEqual(
      calls.map((call) => call.name),
      ["setAnimationOverride"],
      "blocked slot reset should not enqueue a reset command"
    );
  });

  it("blocks timing edits while a same-card wide hitbox edit is pending", async () => {
    const card = createAnimOverrideCard();
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const calls = [];
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: (name, payload) => {
          calls.push({ name, payload });
          return new Promise(() => {});
        },
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const toggle = parent.querySelectorAll("input").find((input) => input.type === "checkbox");
    const range = parent.querySelectorAll("input").find((input) => input.type === "range");
    toggle.checked = true;
    for (const listener of toggle.eventListeners.change || []) listener();

    assert.strictEqual(range.disabled, true, "timing slider should be blocked while wide-hitbox is pending");
    range.value = "260";
    for (const listener of range.eventListeners.change || []) listener();
    await Promise.resolve();

    assert.deepStrictEqual(
      calls.map((call) => call.name),
      ["setWideHitboxOverride"],
      "blocked timing changes should not enqueue a second override command"
    );
  });

  it("reconciles acknowledged pending wide hitbox edits during Animation Overrides render", () => {
    const card = createAnimOverrideCard({
      wideHitboxEnabled: true,
      wideHitboxOverridden: true,
      wideHitboxThemeDefault: false,
    });
    const runtime = createAnimOverridesRuntime(card);
    runtime.pendingWideHitboxOverrideEdits = new Map([[
      card.id,
      {
        seq: 1,
        currentFile: card.currentFile,
        themeDefault: false,
        effectiveEnabled: true,
        commandEnabled: true,
      },
    ]]);
    const modalRoot = new FakeElement("div");
    const { core } = loadAnimOverridesTabForTest({ runtime, modalRoot });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const toggle = parent.querySelectorAll("input").find((input) => input.type === "checkbox");
    const resetButton = parent.querySelectorAll("button")
      .find((button) => button.textContent === "animOverridesReset");
    assert.strictEqual(runtime.pendingWideHitboxOverrideEdits.size, 0);
    assert.strictEqual(toggle.disabled, false);
    assert.strictEqual(resetButton.disabled, false);
  });

  it("treats hitbox-only overrides as overridden for summary badges and reset actions", () => {
    const card = createAnimOverrideCard({
      wideHitboxEnabled: true,
      wideHitboxOverridden: true,
      wideHitboxThemeDefault: false,
    });
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      readersOverrides: {
        hasAnyThemeOverride: () => true,
        readThemeOverrideMap: () => ({
          hitbox: {
            wide: {
              "cloudling-thinking.svg": true,
            },
          },
        }),
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const summaryDot = parent.querySelector(".anim-override-badge-dot");
    const resetButton = parent.querySelectorAll("button").find((button) => button.textContent === "animOverridesReset");

    assert.ok(summaryDot, "hitbox-only overrides should still show the overridden summary badge");
    assert.ok(resetButton, "expanded row should render a reset button");
    assert.strictEqual(resetButton.disabled, false, "hitbox-only overrides should enable the reset button");
  });

  it("clears hitbox-only overrides when resetting an animation override slot", async () => {
    const card = createAnimOverrideCard({
      wideHitboxEnabled: true,
      wideHitboxOverridden: true,
      wideHitboxThemeDefault: false,
    });
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const calls = [];
    let resolveAnimationReset;
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: (name, payload) => {
          calls.push({ name, payload });
          if (name === "setAnimationOverride") {
            return new Promise((resolve) => {
              resolveAnimationReset = resolve;
            });
          }
          return Promise.resolve({ status: "ok" });
        },
      },
      opsOverrides: {
        fetchAnimationOverridesData: () => Promise.resolve(runtime.animationOverridesData),
      },
      readersOverrides: {
        readThemeOverrideMap: () => ({
          hitbox: {
            wide: {
              "cloudling-thinking.svg": true,
            },
          },
        }),
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const resetButton = parent.querySelectorAll("button").find((button) => button.textContent === "animOverridesReset");
    assert.ok(resetButton, "expanded row should render a reset button");
    const resetPromises = (resetButton.eventListeners.click || []).map((listener) => listener());
    await Promise.resolve();
    await Promise.resolve();

    const toggleWhileResetPending = parent.querySelectorAll("input").find((input) => input.type === "checkbox");
    const resetChipWhileResetPending = parent.querySelectorAll("button")
      .find((button) => button.textContent === "animOverridesWideHitboxResetToTheme");
    assert.strictEqual(toggleWhileResetPending.disabled, true, "slot reset should block wide-hitbox toggles while pending");
    assert.strictEqual(resetChipWhileResetPending.disabled, true, "slot reset should block wide-hitbox reset chips while pending");

    resolveAnimationReset({ status: "ok" });
    await Promise.all(resetPromises);

    assert.deepStrictEqual(
      calls.map((call) => call.name),
      ["setAnimationOverride", "setWideHitboxOverride"]
    );
    assert.strictEqual(calls[1].payload.enabled, null);
    assert.strictEqual(runtime.pendingWideHitboxOverrideEdits.size, 0);
    assert.strictEqual(runtime.pendingAnimationOverrideResets.size, 0);
  });

  it("clears hitbox overrides for the pre-reset replacement file when resetting a slot", async () => {
    const replacementFile = "replacement-thinking.svg";
    const baseFile = "cloudling-thinking.svg";
    const card = createAnimOverrideCard({
      currentFile: replacementFile,
      wideHitboxEnabled: true,
      wideHitboxOverridden: true,
      wideHitboxThemeDefault: false,
    });
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const calls = [];
    let resolveAnimationReset;
    let fetchCount = 0;
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: (name, payload) => {
          calls.push({ name, payload });
          if (name === "setAnimationOverride") {
            return new Promise((resolve) => {
              resolveAnimationReset = resolve;
            });
          }
          return Promise.resolve({ status: "ok" });
        },
      },
      opsOverrides: {
        fetchAnimationOverridesData: () => {
          fetchCount++;
          if (fetchCount === 1) {
            Object.assign(runtime.animationOverridesData.cards[0], {
              currentFile: baseFile,
              wideHitboxEnabled: true,
              wideHitboxOverridden: false,
              wideHitboxThemeDefault: true,
            });
          }
          return Promise.resolve(runtime.animationOverridesData);
        },
      },
      readersOverrides: {
        readThemeOverrideMap: () => ({
          states: {
            thinking: {
              file: replacementFile,
            },
          },
          hitbox: {
            wide: {
              [replacementFile]: true,
            },
          },
        }),
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const resetButton = parent.querySelectorAll("button").find((button) => button.textContent === "animOverridesReset");
    assert.ok(resetButton, "expanded row should render a reset button");
    const resetPromises = (resetButton.eventListeners.click || []).map((listener) => listener());
    await Promise.resolve();
    await Promise.resolve();

    resolveAnimationReset({ status: "ok" });
    await Promise.all(resetPromises);

    assert.deepStrictEqual(
      calls.map((call) => call.name),
      ["setAnimationOverride", "setWideHitboxOverride"]
    );
    assert.strictEqual(calls[1].payload.file, replacementFile);
    assert.strictEqual(calls[1].payload.enabled, null);
    assert.strictEqual(runtime.pendingWideHitboxOverrideEdits.size, 0);
    assert.strictEqual(runtime.pendingAnimationOverrideResets.size, 0);
    const toggle = parent.querySelectorAll("input").find((input) => input.type === "checkbox");
    assert.strictEqual(toggle.checked, true, "base file wide-hitbox default should be restored after reset");
    assert.strictEqual(toggle.disabled, false);
  });

  it("clears pending timing edits when animation override commands reject", async () => {
    const card = createAnimOverrideCard();
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const toasts = [];
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: () => Promise.reject(new Error("ipc failed")),
      },
      opsOverrides: {
        showToast: (message) => toasts.push(message),
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const range = parent.querySelectorAll("input").find((input) => input.type === "range");
    const toggle = parent.querySelectorAll("input").find((input) => input.type === "checkbox");
    range.value = "260";
    for (const listener of range.eventListeners.change || []) listener();
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(runtime.pendingAnimationOverrideEdits.size, 0);
    assert.strictEqual(toggle.disabled, false, "wide-hitbox toggle should unlock after a rejected timing command");
    assert.ok(toasts.some((message) => String(message).includes("ipc failed")));
  });

  it("treats reaction-only overrides as overridden for summary badges and reset actions", () => {
    const card = createAnimOverrideCard({
      id: "reaction:clickLeft",
      slotType: "reaction",
      reactionKey: "clickLeft",
      stateKey: undefined,
      supportsDuration: true,
      durationMs: 1600,
      hasDurationOverride: true,
    });
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      readersOverrides: {
        hasAnyThemeOverride: () => true,
        readThemeOverrideMap: () => ({
          reactions: {
            clickLeft: {
              durationMs: 1600,
            },
          },
        }),
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const summaryDot = parent.querySelector(".anim-override-badge-dot");
    const resetButton = parent.querySelectorAll("button").find((button) => button.textContent === "animOverridesReset");

    assert.ok(summaryDot, "reaction-only overrides should show the overridden summary badge");
    assert.ok(resetButton, "expanded row should render a reset button");
    assert.strictEqual(resetButton.disabled, false, "reaction-only overrides should enable the reset button");
  });

  it("does not keep reset-slot null timing values as pending slider edits", async () => {
    const card = createAnimOverrideCard({
      supportsAutoReturn: true,
      autoReturnMs: 2600,
    });
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    const payloads = [];
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: (_name, payload) => {
          payloads.push(payload);
          return Promise.resolve({ status: "ok" });
        },
      },
      opsOverrides: {
        fetchAnimationOverridesData: () => Promise.resolve(runtime.animationOverridesData),
      },
      readersOverrides: {
        readThemeOverrideMap: () => ({
          states: {
            thinking: {
              transition: { in: 120, out: 180 },
            },
          },
          timings: {
            autoReturn: {
              thinking: 2600,
            },
          },
        }),
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const resetButton = parent.querySelectorAll("button").find((button) => button.textContent === "animOverridesReset");
    assert.ok(resetButton, "expanded row should render a reset button");
    for (const listener of resetButton.eventListeners.click || []) listener();
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(payloads.length, 1);
    assert.strictEqual(payloads[0].autoReturnMs, null);
    assert.ok(
      !core.runtime.pendingAnimationOverrideEdits || core.runtime.pendingAnimationOverrideEdits.size === 0,
      "reset-slot null timing values should not leak into the pending timing edit map"
    );
  });

  it("only patches Animation Overrides broadcasts that exactly acknowledge pending timing edits", () => {
    const card = createAnimOverrideCard();
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    let fetchCount = 0;
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: () => new Promise(() => {}),
      },
      opsOverrides: {
        fetchAnimationOverridesData: () => {
          fetchCount++;
          return Promise.resolve(runtime.animationOverridesData);
        },
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const fadeInRange = parent.querySelectorAll("input").find((input) => input.type === "range");
    fadeInRange.value = "260";
    for (const listener of fadeInRange.eventListeners.input || []) listener();
    for (const listener of fadeInRange.eventListeners.change || []) listener();

    const previousSnapshot = { themeOverrides: {} };
    const acknowledgedSnapshot = {
      themeOverrides: {
        cloudling: {
          states: {
            thinking: {
              transition: { in: 260, out: 180 },
            },
          },
        },
      },
    };
    assert.strictEqual(
      core.tabs.animOverrides.patchInPlace(
        { themeOverrides: acknowledgedSnapshot.themeOverrides },
        { previousSnapshot, snapshot: acknowledgedSnapshot }
      ),
      true,
      "the in-flight timing edit broadcast should be safe to reconcile in place"
    );

    const unrelatedSnapshot = {
      themeOverrides: {
        cloudling: {
          states: {
            working: {
              file: "other.svg",
            },
          },
        },
      },
    };
    assert.strictEqual(
      core.tabs.animOverrides.patchInPlace(
        { themeOverrides: unrelatedSnapshot.themeOverrides },
        { previousSnapshot, snapshot: unrelatedSnapshot }
      ),
      false,
      "unrelated themeOverrides broadcasts should fall through to a full content refresh"
    );
    assert.strictEqual(fetchCount, 1);
  });

  it("refreshes cached theme capabilities after Animation Overrides changes", async () => {
    let themeFetches = 0;
    const core = loadSettingsCoreForTest({
      listThemes: () => {
        themeFetches++;
        return Promise.resolve([{
          id: "custom",
          name: "Custom",
          active: true,
          capabilities: { petTint: false, accessories: false },
        }]);
      },
      getAnimationOverridesData: () => Promise.resolve({
        theme: { id: "custom", name: "Custom" },
        assets: [],
        sections: [],
        cards: [],
        sounds: [],
      }),
    });
    core.state.activeTab = "animOverrides";
    core.state.snapshot = { theme: "custom", themeOverrides: {} };
    core.runtime.themeList = [{
      id: "custom",
      name: "Custom",
      active: true,
      capabilities: { petTint: false, accessories: true },
    }];
    core.ops.installRenderHooks({
      sidebar: () => {},
      content: () => {},
      modal: () => {},
    });

    const nextSnapshot = {
      theme: "custom",
      themeOverrides: {
        custom: {
          states: {
            idle: { sourceThemeId: "custom", file: "replacement.svg" },
          },
        },
      },
    };
    core.ops.applyChanges({
      changes: { themeOverrides: nextSnapshot.themeOverrides },
      snapshot: nextSnapshot,
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(themeFetches, 1);
    assert.strictEqual(
      core.runtime.themeList[0].capabilities.accessories,
      false,
      "returning to Theme must not reuse capability metadata from before the override"
    );
  });

  it("routes matching Animation Overrides timing broadcasts through applyChanges in place", () => {
    const core = loadSettingsCoreForTest({
      getAnimationOverridesData: () => Promise.resolve({
        theme: { id: "cloudling", name: "Cloudling" },
        assets: [],
        sections: [],
        cards: [{
          id: "state:thinking",
          slotType: "state",
          stateKey: "thinking",
          transition: { in: 260, out: 180 },
        }],
        sounds: [],
      }),
    });
    core.state.activeTab = "animOverrides";
    core.state.snapshot = {
      theme: "cloudling",
      themeOverrides: {},
    };
    core.runtime.animationOverridesData = {
      theme: { id: "cloudling", name: "Cloudling" },
      assets: [],
      sections: [],
      cards: [{
        id: "state:thinking",
        slotType: "state",
        stateKey: "thinking",
        transition: { in: 120, out: 180 },
      }],
      sounds: [],
    };
    core.runtime.animOverridesSubtab = "animations";
    core.runtime.assetPicker.state = null;
    core.runtime.pendingAnimationOverrideEdits.set("state:thinking", {
      seq: 1,
      slotType: "state",
      stateKey: "thinking",
      transition: { in: 260, out: 180 },
    });

    let contentRenderCount = 0;
    let modalRenderCount = 0;
    core.ops.installRenderHooks({
      sidebar: () => {},
      content: () => {
        contentRenderCount++;
      },
      modal: () => {
        modalRenderCount++;
      },
    });

    const nextSnapshot = {
      theme: "cloudling",
      themeOverrides: {
        cloudling: {
          states: {
            thinking: {
              transition: { in: 260, out: 180 },
            },
          },
        },
      },
    };
    core.ops.applyChanges({
      changes: { themeOverrides: nextSnapshot.themeOverrides },
      snapshot: nextSnapshot,
    });

    assert.strictEqual(contentRenderCount, 0, "matching timing ack should avoid rebuilding content");
    assert.strictEqual(modalRenderCount, 0, "modal render happens after the async fetch settles");
  });

  it("routes default-matching timing broadcasts through applyChanges in place", () => {
    const core = loadSettingsCoreForTest({
      getAnimationOverridesData: () => Promise.resolve({
        theme: { id: "cloudling", name: "Cloudling" },
        assets: [],
        sections: [],
        cards: [{
          id: "state:thinking",
          slotType: "state",
          stateKey: "thinking",
          transition: { in: 150, out: 150 },
          transitionThemeDefault: { in: 150, out: 150 },
          hasTransitionOverride: false,
        }],
        sounds: [],
      }),
    });
    core.state.activeTab = "animOverrides";
    core.state.snapshot = {
      theme: "cloudling",
      themeOverrides: {
        cloudling: {
          states: {
            thinking: {
              transition: { in: 160, out: 150 },
            },
          },
        },
      },
    };
    core.runtime.animationOverridesData = {
      theme: { id: "cloudling", name: "Cloudling" },
      assets: [],
      sections: [],
      cards: [{
        id: "state:thinking",
        slotType: "state",
        stateKey: "thinking",
        transition: { in: 160, out: 150 },
        transitionThemeDefault: { in: 150, out: 150 },
        hasTransitionOverride: true,
      }],
      sounds: [],
    };
    core.runtime.animOverridesSubtab = "animations";
    core.runtime.assetPicker.state = null;
    core.runtime.pendingAnimationOverrideEdits.set("state:thinking", {
      seq: 1,
      slotType: "state",
      stateKey: "thinking",
      transition: { in: 150, out: 150 },
      transitionThemeDefault: { in: 150, out: 150 },
    });

    let contentRenderCount = 0;
    core.ops.installRenderHooks({
      sidebar: () => {},
      content: () => {
        contentRenderCount++;
      },
      modal: () => {},
    });

    const nextSnapshot = {
      theme: "cloudling",
      themeOverrides: {},
    };
    core.ops.applyChanges({
      changes: { themeOverrides: nextSnapshot.themeOverrides },
      snapshot: nextSnapshot,
    });

    assert.strictEqual(contentRenderCount, 0, "default timing ack should avoid rebuilding content");
  });

  it("does not patch mixed-key Animation Overrides broadcasts in place", () => {
    const card = createAnimOverrideCard();
    const runtime = createAnimOverridesRuntime(card);
    const modalRoot = new FakeElement("div");
    let fetchCount = 0;
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      settingsAPI: {
        command: () => new Promise(() => {}),
      },
      opsOverrides: {
        fetchAnimationOverridesData: () => {
          fetchCount++;
          return Promise.resolve(runtime.animationOverridesData);
        },
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    const fadeInRange = parent.querySelectorAll("input").find((input) => input.type === "range");
    fadeInRange.value = "260";
    for (const listener of fadeInRange.eventListeners.input || []) listener();
    for (const listener of fadeInRange.eventListeners.change || []) listener();

    const previousSnapshot = { lang: "en", themeOverrides: {} };
    const snapshot = {
      lang: "ja",
      themeOverrides: {
        cloudling: {
          states: {
            thinking: {
              transition: { in: 260, out: 180 },
            },
          },
        },
      },
    };

    assert.strictEqual(
      core.tabs.animOverrides.patchInPlace(
        { lang: "ja", themeOverrides: snapshot.themeOverrides },
        { previousSnapshot, snapshot }
      ),
      false,
      "mixed-key broadcasts should fall through so non-timing UI side effects can render"
    );
    assert.strictEqual(fetchCount, 0);
  });

  it("clears pending Animation Overrides timing edits on theme changes", () => {
    const core = loadSettingsCoreForTest({});
    core.state.snapshot = {
      theme: "cloudling",
      themeVariant: "default",
      themeOverrides: {},
    };
    core.runtime.pendingAnimationOverrideEdits.set("state:thinking", {
      slotType: "state",
      stateKey: "thinking",
      transition: { in: 260, out: 180 },
      seq: 1,
    });
    core.state.mountedControls.animOverrideTimingSliders.set("state:thinking:transition.in", { row: {} });
    core.runtime.pendingAnimationOverrideResets = new Set(["state:thinking"]);

    core.ops.applyChanges({
      changes: { theme: "calico" },
      snapshot: {
        theme: "calico",
        themeVariant: "default",
        themeOverrides: {},
      },
    });

    assert.strictEqual(core.runtime.pendingAnimationOverrideEdits.size, 0);
    assert.strictEqual(core.runtime.pendingAnimationOverrideResets.size, 0);
    assert.strictEqual(core.state.mountedControls.animOverrideTimingSliders.size, 0);
  });

  it("does not patch Animation Overrides broadcasts without a pending timing edit", () => {
    const card = {
      id: "state:thinking",
      slotType: "state",
      stateKey: "thinking",
      triggerKind: "thinking",
      currentFile: "cloudling-thinking.svg",
      currentFileUrl: "file:///themes/cloudling/assets/cloudling-thinking.svg",
      currentFilePreviewUrl: "file:///themes/cloudling/assets/cloudling-thinking.svg",
      bindingLabel: "states.thinking[0]",
      transition: { in: 120, out: 180 },
      supportsAutoReturn: false,
      supportsDuration: false,
      assetCycleMs: 1000,
      assetCycleStatus: "ok",
      suggestedDurationMs: null,
      suggestedDurationStatus: "unavailable",
      previewDurationMs: 1000,
      displayHintWarning: false,
      displayHintTarget: null,
      fallbackTargetState: null,
      wideHitboxEnabled: false,
      wideHitboxOverridden: false,
      aspectRatioWarning: null,
    };
    const runtime = {
      animationOverridesData: {
        theme: { id: "cloudling", name: "Cloudling" },
        assets: [],
        sections: [{ id: "work", cards: [card] }],
        cards: [card],
        sounds: [],
      },
      animOverridesSubtab: "animations",
      expandedOverrideRowIds: new Set(["state:thinking"]),
      assetPicker: {
        state: null,
        pollTimer: null,
      },
    };
    const modalRoot = new FakeElement("div");
    let fetchCount = 0;
    const { core } = loadAnimOverridesTabForTest({
      runtime,
      modalRoot,
      opsOverrides: {
        fetchAnimationOverridesData: () => {
          fetchCount++;
          return Promise.resolve(runtime.animationOverridesData);
        },
      },
    });
    const parent = new FakeElement("main");
    core.tabs.animOverrides.render(parent, core);

    assert.strictEqual(core.tabs.animOverrides.patchInPlace({ themeOverrides: { cloudling: { states: {} } } }), false);
    assert.strictEqual(fetchCount, 0);
  });

  it("re-arms the WSL auto scan when the user leaves the Agents tab before the fetch resolves", async () => {
    const detectCalls = [];
    let resolveFirstFetch;
    const firstFetch = new Promise((resolve) => { resolveFirstFetch = resolve; });
    const pendingHints = {
      checkedAt: 1,
      agents: [],
      skippedAgentIds: [],
      wslAgents: [],
      wslDistros: [],
      wslPending: true,
      wslSupported: true,
    };
    const scannedHints = { ...pendingHints, wslPending: false, wslDistros: [{ name: "Ubuntu", default: true }] };
    const harness = loadAgentsTabForTest({
      snapshot: { agents: {} },
      settingsAPI: {
        detectAgentInstallations: (opts) => {
          detectCalls.push(opts || null);
          if (detectCalls.length === 1) return firstFetch;
          if (opts && opts.refreshWsl) return Promise.resolve(scannedHints);
          return Promise.resolve(pendingHints);
        },
      },
    });

    // Mount fetch fires while the Agents tab is active…
    const mountFetch = harness.core.ops.fetchAgentInstallationHints();
    // …but the user switches away before it resolves.
    harness.core.state.activeTab = "general";
    resolveFirstFetch(pendingHints);
    await mountFetch;
    await Promise.resolve();

    // The auto scan was (correctly) not fired for an absent user, but the
    // fetched flag must be re-armed or the auto scan is lost for the session.
    assert.strictEqual(detectCalls.length, 1, "no scan while the tab is not visible");
    assert.strictEqual(harness.core.runtime.agentInstallationHintsFetched, false,
      "fetched flag re-armed after the trigger was skipped");

    // Returning to the tab re-fetches and kicks the real WSL scan.
    harness.core.state.activeTab = "agents";
    await harness.core.ops.fetchAgentInstallationHints();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const refreshCalls = detectCalls.filter((c) => c && c.refreshWsl === true);
    assert.strictEqual(refreshCalls.length, 1, "returning to the tab fires the real WSL scan");
    assert.strictEqual(harness.core.runtime.agentInstallationHints.wslPending, false);
  });

  it("first Agents-tab fetch that reports wslPending triggers exactly one WSL scan", async () => {
    const detectCalls = [];
    const pendingHints = {
      checkedAt: 1,
      agents: [],
      skippedAgentIds: [],
      wslAgents: [],
      wslDistros: [],
      wslPending: true,
      wslSupported: true,
    };
    const scannedHints = { ...pendingHints, wslPending: false };
    const harness = loadAgentsTabForTest({
      snapshot: { agents: {} },
      settingsAPI: {
        detectAgentInstallations: (opts) => {
          detectCalls.push(opts || null);
          if (opts && opts.refreshWsl) return Promise.resolve(scannedHints);
          return Promise.resolve(pendingHints);
        },
      },
    });

    await harness.core.ops.fetchAgentInstallationHints();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const refreshCalls = detectCalls.filter((c) => c && c.refreshWsl === true);
    assert.strictEqual(refreshCalls.length, 1, "wslPending fetch on the active tab auto-triggers the scan once");
    assert.strictEqual(harness.core.runtime.agentInstallationHints.wslPending, false);
    assert.strictEqual(detectCalls.length, 2, "no further fetch after the scan settles");
  });

  it("WSL row offers Unpair on hooksFilesPresent even when the deployed badge is dark", () => {
    function buildHarness(wslEntryOverrides) {
      const detectionResult = {
        checkedAt: 2,
        agents: [{ agentId: "agent-a", detectedInstalled: true, confidence: "high" }],
        skippedAgentIds: [],
        wslAgents: [{
          agentId: "agent-a",
          agentName: "Agent A",
          distro: "Ubuntu",
          detectedInstalled: true,
          confidence: "high",
          reason: "parent-dir",
          detail: "",
          wslHome: "/home/u",
          wslParentDir: "/home/u/.agent-a",
          hooksDeployed: false,
          hooksFilesPresent: false,
          ...wslEntryOverrides,
        }],
        wslDistros: [{ name: "Ubuntu", default: true }],
        wslPending: false,
        wslSupported: true,
      };
      const harness = loadAgentsTabForTest({
        snapshot: {
          agents: { "agent-a": { integrationInstalled: false, enabled: false } },
          dismissedAgentInstallHints: {},
        },
        agentMetadata: [
          { id: "agent-a", name: "Agent A", eventSource: "hook", capabilities: {} },
        ],
        settingsAPI: {
          detectAgentInstallations: () => Promise.resolve(detectionResult),
        },
      });
      harness.core.runtime.agentInstallationHints = detectionResult;
      harness.core.runtime.agentInstallationHintsFetched = true;
      harness.core.ops.requestRender({ content: true });
      return harness;
    }

    // Paired + registered: badge on, Pair + Unpair buttons.
    let harness = buildHarness({ hooksDeployed: true, hooksFilesPresent: true });
    assert.strictEqual(harness.content.querySelectorAll(".agent-instance-deployed").length, 1);
    assert.strictEqual(harness.content.querySelectorAll(".agent-instance-action").length, 2);

    // Files on disk but registration gone (post-Unpair, or the distro was
    // paired with a non-claude agent that registers in its own config):
    // the badge goes dark but the Unpair entry point must survive.
    harness = buildHarness({ hooksDeployed: false, hooksFilesPresent: true });
    assert.strictEqual(harness.content.querySelectorAll(".agent-instance-deployed").length, 0,
      "badge dark without claude-settings registration");
    assert.strictEqual(harness.content.querySelectorAll(".agent-instance-action").length, 2,
      "Unpair stays available while hook files exist");

    // Clean distro: no badge, Pair only.
    harness = buildHarness({ hooksDeployed: false, hooksFilesPresent: false });
    assert.strictEqual(harness.content.querySelectorAll(".agent-instance-deployed").length, 0);
    assert.strictEqual(harness.content.querySelectorAll(".agent-instance-action").length, 1,
      "only Pair when nothing is deployed");
  });

  it("Codex WSL rows use per-agent evidence instead of Claude staging markers", () => {
    function renderCodex(integrationFilesPresent) {
      const detectionResult = {
        checkedAt: 3,
        agents: [{ agentId: "codex", detectedInstalled: false, confidence: "low" }],
        skippedAgentIds: [],
        wslAgents: [{
          agentId: "codex",
          agentName: "Codex",
          distro: "Ubuntu",
          detectedInstalled: true,
          confidence: "high",
          reason: "parent-dir",
          detail: "",
          wslHome: "/home/u",
          wslParentDir: "/home/u/.codex",
          hooksDeployed: true,
          hooksFilesPresent: true,
          integrationFilesPresent,
        }],
        wslDistros: [{ name: "Ubuntu", default: true }],
        wslPending: false,
        wslSupported: true,
      };
      const harness = loadAgentsTabForTest({
        snapshot: {
          agents: { codex: { integrationInstalled: false, enabled: false } },
          dismissedAgentInstallHints: {},
        },
        agentMetadata: [
          { id: "codex", name: "Codex", eventSource: "hook", capabilities: {} },
        ],
        settingsAPI: { detectAgentInstallations: () => Promise.resolve(detectionResult) },
      });
      harness.core.runtime.agentInstallationHints = detectionResult;
      harness.core.runtime.agentInstallationHintsFetched = true;
      harness.core.ops.requestRender({ content: true });
      return harness;
    }

    let harness = renderCodex(true);
    assert.strictEqual(harness.content.querySelectorAll(".agent-instance-deployed").length, 0,
      "Claude registration must never render a Codex deployed badge");
    assert.strictEqual(harness.content.querySelectorAll(".agent-instance-action").length, 2,
      "Codex managed files expose Pair and Unpair without shared staging");

    harness = renderCodex(false);
    assert.strictEqual(harness.content.querySelectorAll(".agent-instance-action").length, 1,
      "explicit false must not inherit Claude hooksFilesPresent");

    harness = renderCodex(null);
    assert.strictEqual(harness.content.querySelectorAll(".agent-instance-action").length, 1,
      "unknown evidence conservatively keeps Pair but hides Unpair");
  });
});

describe("macOS platform detection (Settings shortcut labels)", () => {
  const isMac = (platform) => (platform || "").startsWith("Mac");

  it("keeps the unified (navigator.platform startsWith 'Mac') check in settings-ui-core.js", () => {
    const source = fs.readFileSync(SETTINGS_UI_CORE, "utf8");
    assert.ok(
      source.includes('(navigator.platform || "").startsWith("Mac")'),
      "settings-ui-core.js must use startsWith('Mac'); word-boundary regex caused #135"
    );
  });

  it("detects every known macOS navigator.platform value", () => {
    assert.strictEqual(isMac("MacIntel"), true);
    assert.strictEqual(isMac("MacPPC"), true);
    assert.strictEqual(isMac("Mac68K"), true);
    assert.strictEqual(isMac("MacARM64"), true);
  });

  it("returns false for non-macOS platforms and degenerate values", () => {
    assert.strictEqual(isMac("Win32"), false);
    assert.strictEqual(isMac("Linux x86_64"), false);
    assert.strictEqual(isMac("iPhone"), false);
    assert.strictEqual(isMac(""), false);
    assert.strictEqual(isMac(undefined), false);
    assert.strictEqual(isMac(null), false);
  });
});
