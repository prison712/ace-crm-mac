/**
 * 注入到网页聊天头部的「发送语言」设置。
 * 使用自定义语言列表（不用原生 select，避免被站点事件/裁切拦死）。
 */
(function () {
  "use strict";

  var ROOT_ID = "omni-chat-lang-fab-root";
  var PANEL_ID = "omni-chat-lang-panel-root";
  var VERSION = 11;
  var LANGS = [
    ["zh", "中文"],
    ["en", "英语"],
    ["es", "西班牙语"],
    ["hi", "印地语"],
    ["ar", "阿拉伯语"],
    ["pt", "葡萄牙语"],
    ["ru", "俄语"],
    ["ja", "日语"],
    ["de", "德语"],
    ["fr", "法语"],
    ["ko", "韩语"],
    ["tr", "土耳其语"],
    ["vi", "越南语"],
    ["it", "意大利语"],
    ["th", "泰语"],
    ["id", "印尼语"],
    ["ms", "马来语"],
    ["pl", "波兰语"],
    ["uk", "乌克兰语"],
    ["nl", "荷兰语"],
  ];

  function firstText(selectors, root) {
    var scope = root || document;
    for (var i = 0; i < selectors.length; i++) {
      try {
        var el = scope.querySelector(selectors[i]);
        var t = el ? String(el.textContent || "").trim() : "";
        if (t) return t.slice(0, 200);
      } catch (_) {}
    }
    return "";
  }

  function firstEl(selectors, root) {
    var scope = root || document;
    for (var i = 0; i < selectors.length; i++) {
      try {
        var el = scope.querySelector(selectors[i]);
        if (el) return el;
      } catch (_) {}
    }
    return null;
  }

  function guessContactName() {
    try {
      if (typeof window.__OMNI_GUESS_CONTACT_NAME__ === "function") {
        var n = window.__OMNI_GUESS_CONTACT_NAME__();
        if (n) return String(n).trim().slice(0, 200);
      }
    } catch (_) {}
    var gid = String(window.__OMNI_TAB_GROUP_ID__ || "");
    if (gid === "whatsapp") {
      return firstText(
        [
          '#main header [data-testid="conversation-info-header-chat-title"]',
          '#main header span[dir="auto"]',
          "#main header h1",
        ],
        document,
      );
    }
    if (gid === "telegram" || gid === "telegram_w") {
      return firstText(
        [".chat-info .person-title", ".ChatInfo .title", ".chat .person-name", ".chat-info-name"],
        document,
      );
    }
    if (gid === "messenger" || gid === "facebook") {
      var heads = document.querySelectorAll(
        '[role="main"] h1, [role="main"] h2, [role="main"] [role="heading"], h1[dir="auto"], h2[dir="auto"]',
      );
      for (var hi = 0; hi < heads.length; hi++) {
        var ht = String(heads[hi].textContent || "").trim();
        if (
          ht &&
          !/^(conversation list|messages|聊天列表|訊息|消息|chats|messenger|facebook)$/i.test(ht)
        ) {
          return ht.slice(0, 200);
        }
      }
      var composer =
        firstEl(
          [
            '[contenteditable="true"][aria-label^="发消息给"]',
            '[contenteditable="true"][aria-label^="Message "]',
            '[contenteditable="true"][aria-label^="Send a message to"]',
            '[aria-label^="发消息给"]',
            '[aria-label^="Message "]',
            '[aria-label^="Send a message to"]',
          ],
          document,
        ) || null;
      if (composer) {
        var al = String(composer.getAttribute("aria-label") || "");
        var m = al.match(/^(?:发消息给|Message(?:\s+to)?|Send a message to)\s*(.+)$/i);
        if (m && m[1]) return m[1].trim().slice(0, 200);
      }
      try {
        var title = String(document.title || "").trim();
        var tm = title.match(/^(.+?)\s*[|\-–—]\s*(?:Facebook|Messenger)\s*$/i);
        if (tm && tm[1] && !/^(messages|messenger|facebook|chats)$/i.test(tm[1])) {
          return tm[1].replace(/\s+/g, " ").trim().slice(0, 200);
        }
      } catch (_) {}
      return "";
    }
    if (gid === "instagram") {
      return firstText(["header h2", 'header a[role="link"] span', 'header span[dir="auto"]'], document);
    }
    if (gid === "line") {
      return firstText(
        [
          '[class*="chatroomHeader-module__name"] pre',
          '[class*="chatroomHeader-module__name"]',
          ".mdRGT04Ttl",
          ".chatroom-header .name",
          '[class*="ChatHeader"] [class*="name"]',
        ],
        document,
      );
    }
    return firstText(
      ['#main header span[dir="auto"]', "header h1", "header h2", '[role="main"] h1'],
      document,
    );
  }

  /**
   * 从 Facebook / Messenger URL 解析线程 id。
   * @returns {string}
   */
  function metaThreadIdFromUrl() {
    try {
      var m = String(location.pathname || "").match(/\/messages\/(?:e2ee\/)?t\/([^/?#]+)/i);
      if (m && m[1]) return decodeURIComponent(m[1]);
    } catch (_) {}
    return "";
  }

  /**
   * 生成当前对话稳定 id（优先复用 tab.js）。
   * @returns {string}
   */
  function guessChatId() {
    try {
      if (typeof window.__OMNI_GUESS_CHAT_ID__ === "function") {
        var id = window.__OMNI_GUESS_CHAT_ID__();
        if (id) return String(id).trim().slice(0, 200);
      }
    } catch (_) {}
    var gid = String(window.__OMNI_TAB_GROUP_ID__ || "chat");
    if (gid === "messenger" || gid === "facebook") {
      var thread = metaThreadIdFromUrl();
      if (thread) return (gid + ":t:" + thread).slice(0, 200);
    }
    var name = guessContactName();
    if (name) return (gid + ":" + name).slice(0, 200);
    return "";
  }

  /**
   * 对话是否已打开（有联系人名或可识别的输入区）。
   * @returns {boolean}
   */
  function hasOpenChatSignal() {
    if (guessContactName()) return true;
    var gid = String(window.__OMNI_TAB_GROUP_ID__ || "");
    if (gid === "messenger" || gid === "facebook") {
      return !!firstEl(
        [
          '[role="region"][aria-label="串文编辑框"]',
          '[aria-label="串文编辑框"]',
          '[role="region"][aria-label="Message composer"]',
          '[contenteditable="true"][data-lexical-editor="true"][aria-label^="发消息给"]',
          '[contenteditable="true"][data-lexical-editor="true"][aria-label^="Message"]',
        ],
        document,
      );
    }
    if (gid === "line") {
      return !!firstEl(
        [
          '[class*="chatroomHeader-module__header"]',
          '[class*="chatroomEditor"]',
          "textarea-ex",
          ".mdRGT02Head",
        ],
        document,
      );
    }
    return false;
  }

  /**
   * 独立浮动挂载点（挂在 body，不插入站点顶栏，避免打乱原网页布局）。
   * @returns {HTMLElement}
   */
  function ensureFloatingMount() {
    var id = "omni-chat-lang-float-host";
    var host = document.getElementById(id);
    if (host) return host;
    host = document.createElement("div");
    host.id = id;
    host.setAttribute("data-omni-ui", "chat-lang-float");
    host.style.cssText = [
      "position:fixed",
      "top:12px",
      "left:12px",
      "right:auto",
      "z-index:2147483646",
      "pointer-events:auto",
      "display:inline-flex",
      "align-items:center",
      "margin:0",
      "padding:0",
      "border:none",
      "background:transparent",
      "box-shadow:none",
    ].join(";");
    (document.body || document.documentElement).appendChild(host);
    return host;
  }

  /**
   * 当前标签是否禁止插入站点 DOM（只用浮动层）。
   * Meta（FB/Messenger）顶栏对子节点/样式极敏感，插入会挤乱通话等按钮。
   * @returns {boolean}
   */
  function useFloatOnlyMount() {
    var gid = String(window.__OMNI_TAB_GROUP_ID__ || "");
    return gid === "messenger" || gid === "facebook";
  }

  /**
   * Facebook / Messenger：固定到窗口左上角，避免挡输入框或顶栏控件。
   * @param {HTMLElement} host 浮动宿主
   */
  function positionMetaFloat(host) {
    if (!host) return;
    host.style.top = "12px";
    host.style.left = "12px";
    host.style.right = "auto";
    host.style.bottom = "auto";
  }

  function findHeaderMount() {
    var gid = String(window.__OMNI_TAB_GROUP_ID__ || "");
    var header = null;
    var mount = null;

    // Facebook / Messenger：绝不插入站点 DOM
    if (gid === "messenger" || gid === "facebook") {
      return null;
    }

    if (gid === "whatsapp") {
      header =
        firstEl(
          [
            '#main header[data-testid="conversation-header"]',
            '#main header[data-testid="conversation-info-header"]',
            "#main header",
          ],
          document,
        ) || null;
      if (!header) return null;
      mount =
        firstEl(
          [
            '[data-testid="conversation-header-right"]',
            '[data-testid="chat-header-actions"]',
            "header > div:last-child",
          ],
          header,
        ) || header;
      return mount;
    }

    if (gid === "telegram" || gid === "telegram_w") {
      return (
        firstEl(
          [".chat-info", ".ChatInfo", ".chat-header", ".MiddleHeader", ".chat .chat-info"],
          document,
        ) || null
      );
    }

    if (gid === "instagram") {
      return firstEl(['[role="main"] header', "section header", "header"], document);
    }

    if (gid === "line") {
      // LINE 3.7 扩展：chatroomHeader-module__*；旧版 mdRGT02Head
      mount =
        firstEl(
          [
            '[class*="chatroomHeader-module__action_group"]',
            '[class*="chatroomHeader-module__inner"]',
            '[class*="chatroomHeader-module__header"]',
            '[class*="chatroomHeader-module__"]',
            ".mdRGT02Head",
            ".chatroom-header",
            '[class*="ChatHeader"]',
            ".chat-header",
          ],
          document,
        ) || null;
      return mount;
    }

    if (gid === "linkedin") {
      return firstEl(
        [
          ".msg-overlay-bubble-header",
          ".msg-thread",
          ".msg-title-bar",
          ".scaffold-layout__detail header",
        ],
        document,
      );
    }

    if (gid === "twitter") {
      header =
        firstEl(
          [
            '[data-testid="DM_conversation_header"]',
            '[data-testid="DmActivityContainer"]',
            "h2#detail-header",
          ],
          document,
        ) || null;
      if (header && header.tagName === "H2") header = header.parentElement;
      return header;
    }

    if (gid === "tiktok") {
      header =
        firstEl(['[class*="RightPanelHeader"]', '[class="RightPanelHeadertitle"]'], document) ||
        null;
      if (header && /title/i.test(header.className || "")) header = header.parentElement;
      return header;
    }

    if (gid === "discord") {
      return firstEl(
        [
          '[class*="subtitleContainer"]',
          'section[class*="title"]',
          '[class*="chatContent"] [class*="container"]',
        ],
        document,
      );
    }

    if (gid === "zalo") {
      header = firstEl(["#chatView .header", ".chat-box-header", ".header-title"], document);
      if (header && header.classList && header.classList.contains("header-title")) {
        header = header.parentElement;
      }
      return header;
    }

    return firstEl(["#main header", '[role="main"] header', "header"], document);
  }

  function ipcInvoke(action, payload) {
    if (window.__OMNI_BRIDGE__ && typeof window.__OMNI_BRIDGE__.invoke === "function") {
      return window.__OMNI_BRIDGE__.invoke(action, payload || null);
    }
    if (window.OmniTranslate && typeof window.OmniTranslate.invoke === "function") {
      return window.OmniTranslate.invoke(action, payload || null);
    }
    return Promise.reject(new Error("no ipc"));
  }

  /**
   * 阻断事件继续传播到宿主页（WhatsApp 等）。
   * 禁止使用 stopImmediatePropagation：会掐死同元素上其它监听。
   * 禁止在「空」捕获监听里对子节点提前 stopPropagation：
   * 捕获阶段一旦 stop，事件到不了目标，面板冒泡委托也永远不会触发。
   * @param {Event} e DOM 事件
   */
  function stopBubble(e) {
    try {
      e.stopPropagation();
    } catch (_) {}
  }

  /**
   * 阻止默认行为并阻断冒泡到宿主页。
   * @param {Event} e DOM 事件
   */
  function stopAll(e) {
    try {
      e.preventDefault();
    } catch (_) {}
    stopBubble(e);
  }

  function isOurUi(node) {
    if (!node || !node.closest) return false;
    return !!(
      node.closest("#" + ROOT_ID) ||
      node.closest("#" + PANEL_ID) ||
      node.closest("#omni-chat-lang-float-host") ||
      node.closest('[data-omni-ui="chat-lang"]') ||
      node.closest('[data-omni-ui="chat-lang-panel"]') ||
      node.closest('[data-omni-ui="chat-lang-float"]')
    );
  }

  if (window.__OMNI_CHAT_LANG_FAB_API__ && window.__OMNI_CHAT_LANG_FAB_API__.version === VERSION) {
    try {
      window.__OMNI_CHAT_LANG_FAB_API__.sync();
    } catch (_) {}
    return;
  }

  try {
    var oldRoot = document.getElementById(ROOT_ID);
    if (oldRoot) oldRoot.remove();
    var oldPanel = document.getElementById(PANEL_ID);
    if (oldPanel) oldPanel.remove();
  } catch (_) {}

  var state = {
    chatId: "",
    contactName: "",
    send: "en",
    receive: "zh",
    tabSend: "en",
    tabReceive: "zh",
    overridden: false,
    open: false,
    loading: false,
    picking: "", // "" | "send" | "receive"
    status: "",
    mountedOn: null,
    suppressOutsideUntil: 0,
  };

  /**
   * 把语言按钮挂到会话顶栏；Meta 等敏感站点只用 body 浮动层，不改宿主布局。
   * @returns {HTMLElement|null}
   */
  function ensureRootInPage() {
    var host = null;
    if (useFloatOnlyMount()) {
      if (state.chatId || hasOpenChatSignal()) {
        host = ensureFloatingMount();
        positionMetaFloat(host);
      }
    } else {
      host = findHeaderMount();
      if (!host && (state.chatId || hasOpenChatSignal())) {
        host = ensureFloatingMount();
      }
    }
    if (!host) {
      var orphan = document.getElementById(ROOT_ID);
      if (orphan) orphan.remove();
      var floatHost = document.getElementById("omni-chat-lang-float-host");
      if (floatHost) floatHost.remove();
      state.mountedOn = null;
      return null;
    }

    var el = document.getElementById(ROOT_ID);
    if (el && state.mountedOn === host && host.contains(el)) {
      if (useFloatOnlyMount()) positionMetaFloat(host);
      return el;
    }
    if (el) el.remove();

    el = document.createElement("div");
    el.id = ROOT_ID;
    el.setAttribute("data-omni-ui", "chat-lang");
    el.style.cssText = [
      "display:inline-flex",
      "align-items:center",
      "position:relative",
      "margin:0 6px",
      "z-index:1000",
      "pointer-events:auto",
      "font-family:system-ui,-apple-system,'Segoe UI',sans-serif",
      "vertical-align:middle",
      "flex-shrink:0",
    ].join(";");

    try {
      host.appendChild(el);
    } catch (_) {
      return null;
    }

    // 仅对「我们自己的浮动宿主」设 flex；绝不改站点顶栏的 display/gap
    if (host.id === "omni-chat-lang-float-host") {
      host.style.display = "inline-flex";
      host.style.alignItems = "center";
    }

    state.mountedOn = host;
    if (useFloatOnlyMount()) positionMetaFloat(host);
    return el;
  }

  function langLabel(code) {
    var c = String(code || "").toLowerCase();
    for (var i = 0; i < LANGS.length; i++) {
      if (LANGS[i][0] === c) return LANGS[i][1] + " (" + c + ")";
    }
    return c || "—";
  }

  function langListHtml(selected, field) {
    var html =
      '<div data-omni-lang-list="' +
      field +
      '" style="max-height:180px;overflow:auto;border:1px solid #334155;border-radius:8px;background:#111827;">';
    for (var i = 0; i < LANGS.length; i++) {
      var code = LANGS[i][0];
      var name = LANGS[i][1];
      var active = code === selected;
      html +=
        '<button type="button" data-omni-lang="' +
        code +
        '" data-omni-field="' +
        field +
        '" style="' +
        "display:block;width:100%;text-align:left;padding:8px 10px;border:none;cursor:pointer;" +
        "font-size:12px;font-weight:" +
        (active ? "700" : "500") +
        ";" +
        "background:" +
        (active ? "#0f766e" : "transparent") +
        ";" +
        "color:" +
        (active ? "#fff" : "#e2e8f0") +
        ";" +
        '">' +
        name +
        " (" +
        code +
        ")" +
        (active ? " ✓" : "") +
        "</button>";
    }
    html += "</div>";
    return html;
  }

  function bindButton(btn) {
    if (!btn || btn.__omniBound) return;
    btn.__omniBound = true;
    var lastToggleAt = 0;
    var toggle = function (e) {
      stopAll(e);
      var now = Date.now();
      if (now - lastToggleAt < 350) return;
      lastToggleAt = now;
      state.open = !state.open;
      state.picking = state.open ? "send" : "";
      state.suppressOutsideUntil = now + 450;
      render();
    };
    btn.addEventListener("pointerdown", toggle, true);
    btn.addEventListener("mousedown", toggle, true);
  }

  function removePanel() {
    var panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();
  }

  /**
   * 绑定面板交互：在捕获阶段直接处理并 stop，避免宿主页抢走事件，
   * 也避免「空捕获 stopPropagation」把委托监听饿死。
   * @param {HTMLElement} panel 语言面板根节点
   */
  function bindPanel(panel) {
    if (!panel || panel.__omniBound) return;
    panel.__omniBound = true;

    var lastActionAt = 0;

    /**
     * 面板捕获阶段统一入口：选语言 / 切发送·接收 / 恢复 / 关闭。
     * @param {Event} e pointerdown | mousedown | click
     */
    function onPanelAction(e) {
      var t = e.target;
      if (!t || !t.closest) {
        stopBubble(e);
        return;
      }

      var langBtn = t.closest("[data-omni-lang]");
      var tab = t.closest("[data-omni-pick-tab]");
      var resetBtn = t.closest("#omni-chat-lang-reset");
      var closeBtn = t.closest("#omni-chat-lang-close");

      // 点在面板空白处：只挡宿主页，不重复触发业务
      if (!langBtn && !tab && !resetBtn && !closeBtn) {
        stopBubble(e);
        return;
      }

      stopAll(e);

      var now = Date.now();
      if (now - lastActionAt < 320) return;
      lastActionAt = now;

      if (langBtn) {
        var code = langBtn.getAttribute("data-omni-lang") || "";
        var field = langBtn.getAttribute("data-omni-field") || "send";
        if (!code || state.loading) return;
        state.suppressOutsideUntil = now + 800;
        state.status = "保存中…";
        if (field === "receive") saveChatLang(state.send, code);
        else saveChatLang(code, state.receive);
        return;
      }

      if (tab) {
        state.picking = tab.getAttribute("data-omni-pick-tab") || "send";
        state.suppressOutsideUntil = now + 400;
        renderPanel();
        return;
      }

      if (resetBtn) {
        state.suppressOutsideUntil = now + 800;
        state.status = "恢复中…";
        clearChatLang();
        return;
      }

      if (closeBtn) {
        state.open = false;
        state.picking = "";
        render();
      }
    }

    panel.addEventListener("pointerdown", onPanelAction, true);
    panel.addEventListener("mousedown", onPanelAction, true);
    // 吞掉后续 click，避免宿主页或重复逻辑再处理一次
    panel.addEventListener("click", stopAll, true);
  }

  function renderPanel() {
    removePanel();
    if (!state.open || !state.chatId) return;

    var btn = document.getElementById("omni-chat-lang-btn");
    var rect = btn
      ? btn.getBoundingClientRect()
      : { top: 72, bottom: 100, left: 120, right: 220 };
    var width = 280;
    var left = Math.min(
      Math.max(8, rect.right - width),
      Math.max(8, window.innerWidth - width - 8),
    );
    var top = Math.min(rect.bottom + 8, window.innerHeight - 360);

    var panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.setAttribute("data-omni-ui", "chat-lang-panel");
    panel.style.cssText = [
      "position:fixed",
      "top:" + top + "px",
      "left:" + left + "px",
      "width:" + width + "px",
      "padding:12px",
      "border-radius:12px",
      "background:#0b1220",
      "color:#f8fafc",
      "box-shadow:0 12px 28px rgba(0,0,0,.45)",
      "z-index:2147483647",
      "pointer-events:auto",
      "font-family:system-ui,-apple-system,'Segoe UI',sans-serif",
    ].join(";");

    var title = state.contactName || "当前对话";
    var picking = state.picking === "receive" ? "receive" : "send";
    var selected = picking === "receive" ? state.receive : state.send;

    panel.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">' +
      '<div style="min-width:0;">' +
      '<div style="font-size:11px;opacity:.75;">本对话语言</div>' +
      '<div style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
      title +
      "</div>" +
      "</div>" +
      '<button type="button" id="omni-chat-lang-close" style="border:none;background:transparent;color:#94a3b8;cursor:pointer;font-size:16px;line-height:1;">×</button>' +
      "</div>" +
      '<div style="display:flex;gap:6px;margin-bottom:8px;">' +
      '<button type="button" data-omni-pick-tab="send" style="flex:1;height:30px;border-radius:8px;border:1px solid ' +
      (picking === "send" ? "#2dd4bf" : "#334155") +
      ";background:" +
      (picking === "send" ? "#115e59" : "#111827") +
      ';color:#fff;font-size:12px;font-weight:700;cursor:pointer;">发送 ' +
      String(state.send || "en").toUpperCase() +
      "</button>" +
      '<button type="button" data-omni-pick-tab="receive" style="flex:1;height:30px;border-radius:8px;border:1px solid ' +
      (picking === "receive" ? "#2dd4bf" : "#334155") +
      ";background:" +
      (picking === "receive" ? "#115e59" : "#111827") +
      ';color:#fff;font-size:12px;font-weight:700;cursor:pointer;">接收 ' +
      String(state.receive || "zh").toUpperCase() +
      "</button>" +
      "</div>" +
      '<div style="font-size:11px;opacity:.8;margin-bottom:6px;">点击下方语言即可保存到本客户</div>' +
      langListHtml(selected, picking) +
      '<div style="display:flex;gap:8px;margin-top:10px;">' +
      '<button type="button" id="omni-chat-lang-reset" style="flex:1;height:32px;border:1px solid #475569;border-radius:8px;background:transparent;color:#e2e8f0;cursor:pointer;font-size:12px;">恢复窗口默认</button>' +
      "</div>" +
      '<div style="margin-top:8px;font-size:10px;opacity:.7;">窗口默认：发 ' +
      langLabel(state.tabSend) +
      " / 收 " +
      langLabel(state.tabReceive) +
      "</div>" +
      (state.status
        ? '<div style="margin-top:6px;font-size:12px;font-weight:700;color:#5eead4;">' +
          state.status +
          "</div>"
        : "");

    (document.body || document.documentElement).appendChild(panel);
    bindPanel(panel);
  }

  function render() {
    if (!state.chatId) {
      var gone = document.getElementById(ROOT_ID);
      if (gone) gone.remove();
      state.mountedOn = null;
      state.open = false;
      state.picking = "";
      removePanel();
      return;
    }

    var root = ensureRootInPage();
    if (!root) {
      removePanel();
      return;
    }

    var badge = String(state.send || "en").toUpperCase();
    var tip = state.overridden ? "已单独设置" : "窗口默认";

    root.innerHTML =
      '<button type="button" id="omni-chat-lang-btn" title="设置本对话发送目标语言" style="' +
      "display:inline-flex;align-items:center;gap:6px;padding:6px 10px;" +
      "border:1px solid rgba(20,184,166,.85);border-radius:999px;cursor:pointer;" +
      "background:#0f766e;color:#fff;font-size:12px;font-weight:700;line-height:1;" +
      "white-space:nowrap;pointer-events:auto;position:relative;z-index:1001;" +
      '">' +
      "<span>⚙</span>" +
      "<span>发送 " +
      badge +
      "</span>" +
      '<span style="opacity:.9;font-size:10px;">' +
      tip +
      "</span>" +
      "</button>";

    bindButton(root.querySelector("#omni-chat-lang-btn"));
    renderPanel();
  }

  function applyResolved(data) {
    if (!data) return;
    state.send = String(data.sendTargetLang || data.send_target_lang || state.tabSend || "en");
    state.receive = String(
      data.receiveTargetLang || data.receive_target_lang || state.tabReceive || "zh",
    );
    state.tabSend = String(data.tabSendTargetLang || data.tab_send_target_lang || state.tabSend || "en");
    state.tabReceive = String(
      data.tabReceiveTargetLang || data.tab_receive_target_lang || state.tabReceive || "zh",
    );
    state.overridden = Boolean(data.overridden);
    if (data.contactName) state.contactName = String(data.contactName);
  }

  function refreshFromHost() {
    if (!state.chatId) {
      render();
      return;
    }
    ipcInvoke("get_chat_lang", { chat_id: state.chatId })
      .then(function (res) {
        applyResolved(res && res.data ? res.data : null);
        render();
      })
      .catch(function () {
        render();
      });
  }

  function saveChatLang(send, receive) {
    if (!state.chatId || state.loading) return;
    state.loading = true;
    state.send = send;
    state.receive = receive;
    state.overridden = true;
    state.status = "保存中…";
    render();
    ipcInvoke("set_chat_lang", {
      chat_id: state.chatId,
      contact_name: state.contactName,
      send_target_lang: send,
      receive_target_lang: receive,
    })
      .then(function (res) {
        state.loading = false;
        if (res && res.ok) {
          applyResolved(res.data);
          state.open = true;
          state.status = "已保存：发送 " + String(state.send).toUpperCase() + " / 接收 " + String(state.receive).toUpperCase();
        } else {
          state.status =
            "保存失败：" +
            String((res && res.data && res.data.error) || "未知错误");
        }
        render();
      })
      .catch(function (err) {
        state.loading = false;
        state.status = "保存失败：" + String((err && err.message) || err || "网络错误");
        render();
      });
  }

  function clearChatLang() {
    if (!state.chatId || state.loading) return;
    state.loading = true;
    state.status = "恢复中…";
    render();
    ipcInvoke("clear_chat_lang", {
      chat_id: state.chatId,
      contact_name: state.contactName,
    })
      .then(function (res) {
        state.loading = false;
        if (res && res.ok) {
          applyResolved(res.data);
          state.open = true;
          state.status = "已恢复窗口默认";
        } else {
          state.status =
            "恢复失败：" +
            String((res && res.data && res.data.error) || "未知错误");
        }
        render();
      })
      .catch(function (err) {
        state.loading = false;
        state.status = "恢复失败：" + String((err && err.message) || err || "网络错误");
        render();
      });
  }

  function syncChat() {
    // 不再要求「先有联系人名」才生成 chatId：FB 经常读不到人名，但 URL 有线程 id
    var contactName = String(guessContactName() || "").trim();
    var chatId = String(guessChatId() || "").trim();
    if (!chatId && (useFloatOnlyMount() || hasOpenChatSignal())) {
      var tid = metaThreadIdFromUrl();
      var gid = String(window.__OMNI_TAB_GROUP_ID__ || "chat");
      if (tid) chatId = (gid + ":t:" + tid).slice(0, 200);
    }
    if (!contactName && chatId) contactName = "当前对话";

    var host = useFloatOnlyMount()
      ? chatId || hasOpenChatSignal() || metaThreadIdFromUrl()
        ? ensureFloatingMount()
        : null
      : findHeaderMount() ||
        (chatId || hasOpenChatSignal() ? ensureFloatingMount() : null);
    if (host && useFloatOnlyMount()) positionMetaFloat(host);
    var rootEl = document.getElementById(ROOT_ID);
    var needRemount =
      !!chatId &&
      (!rootEl || !host || state.mountedOn !== host || (host && rootEl && !host.contains(rootEl)));

    if (chatId === state.chatId && contactName === state.contactName && !needRemount) {
      if (host && useFloatOnlyMount()) positionMetaFloat(host);
      return;
    }

    var switched = chatId !== state.chatId;
    if (state.open && !switched && needRemount) {
      state.chatId = chatId;
      state.contactName = contactName;
      render();
      return;
    }

    state.chatId = chatId;
    state.contactName = contactName;
    if (switched) {
      state.open = false;
      state.picking = "";
    }

    if (!chatId) {
      render();
      return;
    }

    if (switched) {
      state.send = state.tabSend || "en";
      state.receive = state.tabReceive || "zh";
      state.overridden = false;
      refreshFromHost();
      try {
        ipcInvoke("chat_context", {
          chat_id: chatId,
          contact_name: contactName,
        }).catch(function () {});
      } catch (_) {}
    } else {
      render();
    }
  }

  if (window.__OMNI_CHAT_LANG_FAB_TIMER__) {
    try {
      clearInterval(window.__OMNI_CHAT_LANG_FAB_TIMER__);
    } catch (_) {}
  }
  window.__OMNI_CHAT_LANG_FAB_TIMER__ = setInterval(function () {
    try {
      syncChat();
    } catch (_) {}
  }, 700);

  try {
    if (window.__OMNI_CHAT_LANG_FAB_MO__) {
      window.__OMNI_CHAT_LANG_FAB_MO__.disconnect();
    }
    var mo = new MutationObserver(function (mutations) {
      try {
        for (var i = 0; i < mutations.length; i++) {
          if (isOurUi(mutations[i].target)) return;
        }
        syncChat();
      } catch (_) {}
    });
    mo.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
    });
    window.__OMNI_CHAT_LANG_FAB_MO__ = mo;
  } catch (_) {}

  try {
    if (window.__OMNI_CHAT_LANG_OUTSIDE__) {
      document.removeEventListener("pointerdown", window.__OMNI_CHAT_LANG_OUTSIDE__, true);
    }
    window.__OMNI_CHAT_LANG_OUTSIDE__ = function (e) {
      if (!state.open) return;
      if (Date.now() < state.suppressOutsideUntil) return;
      if (isOurUi(e.target)) return;
      state.open = false;
      state.picking = "";
      render();
    };
    document.addEventListener("pointerdown", window.__OMNI_CHAT_LANG_OUTSIDE__, true);
  } catch (_) {}

  window.__OMNI_CHAT_LANG_FAB_API__ = {
    version: VERSION,
    sync: syncChat,
  };

  syncChat();
})();
