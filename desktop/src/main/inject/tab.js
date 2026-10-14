
/** 右侧手动翻译「一键发送」：各平台输入绑定后注册 fill/send */
function registerOmniCompose(api) {
  window.__OMNI_COMPOSE__ = {
    fill: function (text) {
      try {
        return !!api.fill(String(text == null ? '' : text));
      } catch (e) {
        console.warn('[ACE CRM] compose fill failed', e);
        return false;
      }
    },
    send: function (text) {
      try {
        return !!api.send(String(text == null ? '' : text));
      } catch (e) {
        console.warn('[ACE CRM] compose send failed', e);
        return false;
      }
    },
  };
}

/** 展开右侧手动翻译面板且开启「展开后取消自动翻译」时，回车直发；面板收起后照常拦截翻译 */
function shouldSkipComposeAutoTranslate() {
  if (!window.__OMNI_MANUAL_PANEL_OPEN__) return false;
  return window.__OMNI_SKIP_AUTO_ON_MANUAL_PANEL__ === true;
}

function applyManualPanelFlags(data) {
  if (!data || typeof data !== 'object') return;
  if (typeof data.expanded === 'boolean') {
    window.__OMNI_MANUAL_PANEL_OPEN__ = data.expanded;
  }
  if (typeof data.skipAutoTranslate === 'boolean') {
    window.__OMNI_SKIP_AUTO_ON_MANUAL_PANEL__ = data.skipAutoTranslate;
  }
  if (typeof data.skipAutoOnManualPanel === 'boolean') {
    window.__OMNI_SKIP_AUTO_ON_MANUAL_PANEL__ = data.skipAutoOnManualPanel;
  }
}

//分隔线
const SEPARATOR = '--------------';

/** 最近自己发出的原文（用于接收轮询去重，避免同一条又标成「收到」） */
var recentOutgoingTexts = Object.create(null);
var RECENT_OUTGOING_TTL_MS = 5 * 60 * 1000;

/**
 * 记住刚发出的原文，供接收轮询跳过。
 * @param {string} text 消息原文
 */
function rememberOutgoingText(text) {
  var t = String(text || "").trim();
  if (!t) return;
  recentOutgoingTexts[t] = Date.now();
  // 顺带清理过期项，避免无限增长
  var cutoff = Date.now() - RECENT_OUTGOING_TTL_MS;
  Object.keys(recentOutgoingTexts).forEach(function (k) {
    if (recentOutgoingTexts[k] < cutoff) delete recentOutgoingTexts[k];
  });
}

/**
 * 是否为最近刚发出的原文（应跳过 receive 上报）。
 * @param {string} text 消息原文
 * @returns {boolean}
 */
function isRecentlyOutgoingText(text) {
  var t = String(text || "").trim();
  if (!t) return false;
  var ts = recentOutgoingTexts[t];
  if (!ts) return false;
  if (Date.now() - ts > RECENT_OUTGOING_TTL_MS) {
    delete recentOutgoingTexts[t];
    return false;
  }
  return true;
}

/**
 * 非聊天气泡噪声（如 WhatsApp「最后上线」状态行），不应上报。
 * @param {string} text 文本
 * @returns {boolean}
 */
function isNonChatNoiseText(text) {
  var t = String(text || "").trim();
  if (!t) return true;
  if (t.length > 200) return false;
  return /^(最后上线|上次在线|Last seen|last seen|online|Online|typing|正在输入|今日|昨天|Yesterday|Today)\b/i.test(
    t,
  );
}

/**
 * OmniTranslate — 每个标签页 WebView 的注入脚本
 *
 * 路径: src-tauri/inject/tab.js
 * 修改后需重新运行 `yarn tauri dev` 或重新编译应用后才会生效。
 *
 * JS → Rust:  OmniTranslate.invoke(action, payload)
 *             OmniTranslate.log(message, extra?, level?)  → Rust 终端 (stderr)
 *             OmniTranslate.translate(text, sourceLang, targetLang) → 大模型翻译
 * Rust → JS:  OmniTranslate.onMessage(handler)  （由 tab_inject_push 触发）
 */
(function () {
  "use strict";

  if (window.__OMNITRANSLATE_TAB__) return;
  window.__OMNITRANSLATE_TAB__ = true;
  // 默认不跳过回车翻译；仅当主进程显式推送 skipAutoTranslate=true 时才跳过
  window.__OMNI_SKIP_AUTO_ON_MANUAL_PANEL__ = false;
  window.__OMNI_MANUAL_PANEL_OPEN__ = false;

  var IPC_POLL_MS = 50;
  var IPC_MAX_ATTEMPTS = 120;

  /** @type {((msg: unknown) => void) | null} */
  window.__OMNITRANSLATE_ON_MESSAGE__ = null;

  function hasElectronBridge() {
    return (
      !!window.__OMNI_BRIDGE__ &&
      typeof window.__OMNI_BRIDGE__.invoke === "function"
    );
  }

  function hasTauriInvoke() {
    return (
      !!window.__TAURI_INTERNALS__ &&
      typeof window.__TAURI_INTERNALS__.invoke === "function"
    );
  }

  function whenInvokeReady() {
    if (hasElectronBridge() || hasTauriInvoke()) return Promise.resolve(true);
    return new Promise(function (resolve) {
      var attempts = 0;
      var timer = setInterval(function () {
        if (
          hasElectronBridge() ||
          hasTauriInvoke() ||
          ++attempts > IPC_MAX_ATTEMPTS
        ) {
          clearInterval(timer);
          resolve(hasElectronBridge() || hasTauriInvoke());
        }
      }, IPC_POLL_MS);
    });
  }

  /**
   * 统一转发到主进程（Electron __OMNI_BRIDGE__ 或 Tauri）。
   * @param {string} action
   * @param {unknown} [payload]
   */
  function ipcInvoke(action, payload) {
    if (hasElectronBridge()) {
      return window.__OMNI_BRIDGE__.invoke(action, payload ?? null);
    }
    return window.__TAURI_INTERNALS__.invoke("tab_inject_invoke", {
      action: action,
      payload: payload ?? null,
    });
  }

  whenInvokeReady().then(function (ready) {
    if (!ready) {
      console.warn(
        "[OmniTranslate] IPC 不可用（需 BrowserView preload 或 Tauri capability）",
      );
      return;
    }

  function cleanText(el) {
    if (!el) return ""
    return String(el.getAttribute("title") || el.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
  }

  function firstText(selectors, root) {
    var scope = root || document
    for (var i = 0; i < selectors.length; i++) {
      try {
        var nodes = scope.querySelectorAll(selectors[i])
        for (var j = 0; j < nodes.length; j++) {
          var t = cleanText(nodes[j])
          if (t) return t.slice(0, 200)
        }
      } catch (_) {}
    }
    return ""
  }

  function isPresenceText(t) {
    return /^(online|offline|typing|click here|inputting)/i.test(t) ||
      /last seen|最后上线|正在输入|輸入中|在线$|上線中|last seen/i.test(t)
  }

  /** LINE 官方扩展 3.7：chatroomHeader-module__name 里的 <pre> 才是当前会话名 */
  function lineCustomerName() {
    var nameEl =
      document.querySelector('[class*="chatroomHeader-module__name"] pre') ||
      document.querySelector('[class*="chatroomHeader-module__name"]')
    var t = cleanText(nameEl)
    if (t) return t.slice(0, 200)
    return firstText(["#_chat_room_msg_list ~ * .mdRGT07Ttl"]).slice(0, 200)
  }

  /** WhatsApp Web：只取主会话顶栏，不要用侧栏/状态文案 */
  function whatsappCustomerName() {
    var header =
      document.querySelector('#main header[data-testid="conversation-header"]') ||
      document.querySelector('#main header[data-testid="conversation-info-header"]') ||
      document.querySelector("#main header")
    if (!header) return ""
    var titled = header.querySelector(
      '[data-testid="conversation-info-header-chat-title"], span[dir="auto"][title], span[title]',
    )
    var t = cleanText(titled)
    if (t && !isPresenceText(t)) return t.slice(0, 200)
    var spans = header.querySelectorAll("span[dir='auto']")
    for (var i = 0; i < spans.length; i++) {
      var s = cleanText(spans[i])
      if (s && !isPresenceText(s) && s.length < 80) return s.slice(0, 200)
    }
    return ""
  }

  /** Telegram Web K：#column-center .topbar .chat-info .user-title .peer-title */
  function telegramCustomerName() {
    return firstText([
      "#column-center .topbar .chat-info .user-title .peer-title",
      "#column-center .topbar .peer-title",
      "#column-center .topbar .user-title",
      ".chat-info .user-title .peer-title",
    ])
  }

  function messengerCustomerName() {
    var heads = document.querySelectorAll(
      '[role="main"] h1, [role="main"] h2, [role="main"] [role="heading"], h1[dir="auto"], h2[dir="auto"]',
    )
    for (var i = 0; i < heads.length; i++) {
      var t = cleanText(heads[i])
      if (
        t &&
        !/^(conversation list|messages|聊天列表|訊息|消息|chats|messenger|facebook)$/i.test(t)
      ) {
        return t.slice(0, 200)
      }
    }
    var composer =
      document.querySelector('[contenteditable="true"][aria-label^="发消息给"]') ||
      document.querySelector('[contenteditable="true"][aria-label^="Message "]') ||
      document.querySelector('[aria-label^="发消息给"]') ||
      document.querySelector('[aria-label^="Message "]') ||
      document.querySelector('[aria-label^="Send a message to"]')
    if (composer) {
      var al = String(composer.getAttribute("aria-label") || "")
      var m = al.match(/^(?:发消息给|Message(?:\s+to)?|Send a message to)\s*(.+)$/i)
      if (m && m[1]) return String(m[1]).replace(/\s+/g, " ").trim().slice(0, 200)
    }
    // facebook.com/messages 标题常见形态："Name | Facebook" / "Messenger"
    try {
      var title = String(document.title || "").trim()
      var tm = title.match(/^(.+?)\s*[|\-–—]\s*(?:Facebook|Messenger)\s*$/i)
      if (tm && tm[1] && !/^(messages|messenger|facebook|chats)$/i.test(tm[1])) {
        return tm[1].replace(/\s+/g, " ").trim().slice(0, 200)
      }
    } catch (_) {}
    return ""
  }

  function instagramCustomerName() {
    var list = document.querySelector('[data-pagelet="IGDMessagesList"]')
    var pane = list
      ? list.closest("section") || list.parentElement
      : document.querySelector('[role="main"]')
    return firstText(
      [
        "header h2",
        'header a[role="link"] span',
        'header span[dir="auto"]',
      ],
      pane || document,
    )
  }

  function guessContactName() {
    var gid = String(window.__OMNI_TAB_GROUP_ID__ || "")
    var name = ""
    try {
      if (gid === "whatsapp") name = whatsappCustomerName()
      else if (gid === "line") name = lineCustomerName()
      else if (gid === "telegram" || gid === "telegram_w") name = telegramCustomerName()
      else if (gid === "messenger" || gid === "facebook") name = messengerCustomerName()
      else if (gid === "instagram") name = instagramCustomerName()
      else if (gid === "linkedin") {
        name = firstText([
          ".msg-entity-lockup__entity-title",
          ".msg-overlay-bubble-header__title",
          ".msg-overlay-conversation-bubble-header__title",
          ".scaffold-layout__detail h2",
        ])
      } else if (gid === "tiktok") {
        name = firstText([
          '[class="RightPanelHeadertitle"]',
          '[class*="RightPanelHeader"] [class*="title"]',
          '[data-mask="conversaton-detail-content"] span',
          '[data-e2e="chat-uniqueid"]',
        ])
      } else if (gid === "twitter") {
        name = firstText([
          "h2#detail-header",
          '[data-testid="DMInboxHeader"] [data-testid="User-Name"]',
          '[data-testid="conversationName"]',
          '[data-testid="DmActivityContainer"] h2',
        ])
      } else if (gid === "discord") {
        name = firstText([
          '[class*="subtitleContainer"] h1',
          'section[class*="title"] h1',
          'h1[class*="title"]',
        ])
      } else if (gid === "zalo") {
        name = firstText([
          "#chatView .header-title",
          ".chat-box-header .name",
          ".header-title",
          ".conv-item.rel.selected .truncate",
          '[class*="header-title"]',
        ])
      } else if (gid === "line_business") {
        name = firstText([
          ".chat-header .name",
          '[class*="ChatHeader"] [class*="name"]',
          ".profile-name",
          "header h1",
        ])
      } else if (gid === "line_works") {
        name = firstText([
          ".chat_header .name",
          ".msg_tit",
          "#content .header .name",
          ".snb_chat_tit",
        ])
      } else if (gid === "skype") {
        name = firstText([
          '[data-tid="message-pane-header"]',
          '[data-tid="threadHeader"] h1',
          '[data-tid="thread-header-title"]',
          "h1[data-tid]",
        ])
      } else if (gid === "google_chat") {
        name = firstText([
          '[role="main"] h2',
          '[jsname][data-hovercard-id]',
          'span[data-hovercard-id]',
        ])
      } else if (gid === "google_voice") {
        name = firstText([".gvPageRoot header h2", ".thread-header", ".header-title"])
      } else if (gid === "botim") {
        name = firstText([".chat-header .name", ".header .title", "header h1"])
      } else if (gid === "snapchat") {
        name = firstText(['[role="banner"] h1', "header h1", "header h2"])
      } else if (gid === "tinder") {
        name = firstText([".chat header", ".profileCard__header", "nav h1"])
      } else if (gid === "meta_business") {
        name = firstText([
          '[data-scope="messages_table"] h1',
          '[role="main"] h1',
        ])
      }
    } catch (_) {}
    return String(name || "").slice(0, 200)
  }

  function guessChatId() {
    try {
      var gid = String(window.__OMNI_TAB_GROUP_ID__ || "chat")
      var name = guessContactName()
      // Facebook / Messenger：优先用 URL 线程 id（不依赖顶栏人名，人名经常读不到）
      if (gid === "messenger" || gid === "facebook") {
        var thread = ""
        try {
          var m = String(location.pathname || "").match(
            /\/messages\/(?:e2ee\/)?t\/([^/?#]+)/i,
          )
          if (m && m[1]) thread = decodeURIComponent(m[1])
        } catch (_) {}
        if (thread) return (gid + ":t:" + thread).slice(0, 200)
        if (name) return (gid + ":" + name).slice(0, 200)
        return ""
      }
      if (name) return (gid + ":" + name).slice(0, 200)
      return (gid + ":" + location.pathname + location.hash).slice(0, 200)
    } catch (_) {
      return ""
    }
  }

  // 供独立 chat-lang-fab.js 复用同一套对话识别
  window.__OMNI_GUESS_CHAT_ID__ = guessChatId
  window.__OMNI_GUESS_CONTACT_NAME__ = guessContactName

  function waSelfAccount() {
    var id = ""
    var name = ""
    if (window.__OMNI_WA_SELF__) {
      id = String(window.__OMNI_WA_SELF__.uid || "")
      name = String(window.__OMNI_WA_SELF__.name || "")
    }
    try {
      var Store = window.Store
      if (Store && Store.Conn) {
        if (!name) name = String(Store.Conn.pushname || "")
        var wid = Store.Conn.wid || Store.Conn.me
        if (wid && !id) {
          id = String(wid.user || wid._serialized || wid)
            .split("@")[0]
            .split(":")[0]
        }
      }
      if (Store && Store.UserPrefs) {
        if (!name && typeof Store.UserPrefs.getMaybeMeDisplayName === "function") {
          name = String(Store.UserPrefs.getMaybeMeDisplayName() || "")
        }
        if (!id && typeof Store.UserPrefs.getMaybeMeUser === "function") {
          var u = Store.UserPrefs.getMaybeMeUser()
          id = String((u && (u.user || u._serialized)) || u || "")
            .split("@")[0]
            .split(":")[0]
        }
      }
    } catch (_) {}
    if (!id) {
      try {
        var raw = localStorage.getItem("last-wid-md") || ""
        id = String(raw).replace(/"/g, "").split(":")[0].trim()
      } catch (_) {}
    }
    return { id: id, name: name }
  }

  function lineSelfAccount() {
    if (window.__OMNI_LINE_SELF__ && window.__OMNI_LINE_SELF__.uid) {
      return {
        id: String(window.__OMNI_LINE_SELF__.uid || ""),
        name: String(window.__OMNI_LINE_SELF__.name || ""),
      }
    }
    try {
      var roots = document.querySelectorAll(
        '[class*="gnb-module"], [class*="chatroom-module"]',
      )
      for (var i = 0; i < roots.length && i < 8; i++) {
        var key = Object.keys(roots[i]).find(function (k) {
          return k.startsWith("__reactFiber$") || k.startsWith("__reactContainer$")
        })
        if (!key) continue
        var f = roots[i][key]
        var steps = 0
        while (f && steps++ < 400) {
          var props = f.memoizedProps
          var store =
            (props && props.store) ||
            (props && props.value && props.value.store) ||
            (f.memoizedState &&
              f.memoizedState.memoizedState &&
              f.memoizedState.memoizedState.store)
          if (store && typeof store.getState === "function") {
            var auth = (store.getState().auth && store.getState().auth.profile) || {}
            var mid = String(auth.mid || "")
            if (mid) {
              var nm = String(auth.displayNameOverridden || auth.displayName || "")
              window.__OMNI_LINE_SELF__ = { uid: mid, name: nm || mid }
              return { id: mid, name: nm || mid }
            }
          }
          f = f.return
        }
      }
    } catch (_) {}
    return { id: "", name: "" }
  }

  function guessAccount() {
    var gid = String(window.__OMNI_TAB_GROUP_ID__ || "")
    var id = ""
    var name = ""
    try {
      if (gid === "line") {
        var line = lineSelfAccount()
        id = line.id
        name = line.name
      } else if (gid === "whatsapp") {
        var wa = waSelfAccount()
        id = wa.id
        name = wa.name
      } else if (gid === "telegram" || gid === "telegram_w") {
        try {
          if (window.rootScope && window.rootScope.myId) {
            id = String(window.rootScope.myId)
          }
        } catch (_) {}
      } else if (gid === "discord") {
        name = firstText([
          'section[class*="panels"] [class*="nameTag"] [class*="title"]',
          '[class*="nameTag"] [class*="title"]',
        ])
      } else if (gid === "twitter") {
        var profile = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]')
        if (profile) {
          id = String(profile.getAttribute("href") || "")
            .replace(/^\//, "")
            .split("/")[0]
        }
        name = firstText([
          '[data-testid="SideNav_AccountSwitcher_Button"] [dir="ltr"]',
        ])
      } else if (gid === "linkedin") {
        var me = document.querySelector(
          ".global-nav__me-photo, img.global-nav__me-photo",
        )
        name = me ? String(me.getAttribute("alt") || "").trim() : ""
      } else if (gid === "zalo") {
        try {
          id = String(localStorage.getItem("z_uuid") || localStorage.getItem("sh_z_uuid") || "")
        } catch (_) {}
      }
    } catch (_) {}
    return { id: String(id || "").slice(0, 200), name: String(name || "").slice(0, 200) }
  }

    var ot = (window.OmniTranslate = {
      invoke: ipcInvoke,

      /**
       * 将日志发送到 Rust 主进程，在 `yarn tauri dev` 终端中打印。
       * @param {string} message
       * @param {unknown} [extra]
       * @param {"debug"|"info"|"warn"|"error"} [level]
       */
      log: function (message, extra, level) {
        return ipcInvoke("log", {
          level: level || "info",
          message: String(message),
          extra: extra ?? null,
          href: location.href,
        }).catch(function (err) {
          console.warn("[OmniTranslate] log to Rust failed:", err);
        });
      },

      onMessage: function (handler) {
        window.__OMNITRANSLATE_ON_MESSAGE__ =
          typeof handler === "function" ? handler : null;
      },

      /**
       * 调用翻译 API。源语言自动识别；目标语言优先用本对话/客户覆盖，否则用窗口默认。
       * @param {string} text 待翻译文本
       * @param {"send"|"receive"|"发送"|"接收"} messageType 发送消息 / 接收消息；决定上报方向
       * @param {{ targetSide?: "send"|"receive" }} [opts] targetSide 只决定译文语言，不改变上报方向
       * @returns {Promise<string>} 译文
       */
      translate: function (text, messageType, opts) {
        var account = guessAccount();
        var body = {
          text: String(text),
          message_type: String(messageType),
          platform: String(window.__OMNI_TAB_GROUP_ID__ || ""),
          contact_name: guessContactName(),
          chat_id: guessChatId(),
          account_id: account.id,
          account_name: account.name,
          href: location.href,
        };
        if (opts && opts.targetSide) body.target_side = opts.targetSide;
        console.log("[OmniTranslate] translate 请求", {
          messageType: body.message_type,
          textLength: body.text.length,
        });
        if (
          /^(send|out|sent|outgoing|发送)$/i.test(String(messageType || "").trim())
        ) {
          rememberOutgoingText(body.text);
        }
        return ipcInvoke("translate", body)
          .then(function (res) {
            var data = res && res.data ? res.data : {};
            if (data.license_expired) {
              console.error("[OmniTranslate] 授权已过期:", data.error);
              throw new Error(data.error || "授权已过期");
            }
            if (!res || !res.ok || data.error) {
              console.error("[OmniTranslate] 翻译失败:", data.error || res);
              throw new Error(
                (data && data.error) || "翻译失败",
              );
            }
            var out = data.translated_text || "";
            var fromCache = !!data.from_cache;
            window.__OMNI_TRANSLATE_LAST_FROM_CACHE__ = fromCache;
            console.log("[OmniTranslate] 翻译成功", {
              provider: data.provider,
              fromCache: fromCache,
              resultLength: out.length,
            });
            ot.log(
              fromCache ? "[翻译] 命中缓存" : "[翻译] 调用 API",
              {
                from_cache: fromCache,
                provider: data.provider,
                chars: out.length,
              },
              "info",
            );
            return out;
          })
          .catch(function (err) {
            console.error("[OmniTranslate] translate 异常:", err);
            ot.log("翻译失败: " + String(err), null, "warn");
            throw err;
          });
      },

      /**
       * 只上报聊天记录（不翻译）。用于自己发出的气泡，避免被接收轮询标成「收到」。
       * @param {string} text 消息原文
       * @param {"send"|"receive"} messageType 方向
       * @returns {Promise<unknown>}
       */
      reportMessage: function (text, messageType) {
        var account = guessAccount();
        var mt = String(messageType || "receive");
        if (/^(send|out|sent|outgoing|发送)$/i.test(mt.trim())) {
          rememberOutgoingText(text);
        }
        return ipcInvoke("report_message", {
          text: String(text || ""),
          message_type: mt,
          platform: String(window.__OMNI_TAB_GROUP_ID__ || ""),
          contact_name: guessContactName(),
          chat_id: guessChatId(),
          account_id: account.id,
          account_name: account.name,
        }).catch(function () {});
      },

      /** 启动 Telegram Web 自动翻译 */
      startTelegramTranslation: async function () {
        ot.log("[OmniTranslate] 启动 Telegram Web 自动翻译", null, "info");
        while (true) {
          await new Promise(function (resolve) {
            setTimeout(resolve, 100);
          });
          document.querySelectorAll(".translatable-message").forEach(function (message) {
            if (message.getAttribute("data-omni-translate-state") === "ok") return;
            var text = message.innerText;
            if (shouldSkipReceiveSync(message, text)) {
              message.setAttribute("data-omni-translate-state", "ok");
              if (isOutgoingChatBubble(message) || isRecentlyOutgoingText(text)) {
                handleOutgoingBubbleForSync(ot, message, text);
              }
              return;
            }
            ot.log("翻译消息: " + message.textContent, null, "debug");
            if (text) {
              ot.translate(text, "receive").then(function (res) {
                ot.log("翻译结果: " + res, null, "debug");
                cloneAndInsertAfter(message, '\n' + SEPARATOR + '\n' + res);
              }).catch(function (err) {
                ot.log("翻译失败: " + String(err), null, "warn");
                cloneAndInsertAfter(message, '\n' + SEPARATOR + '\n' + String(err));
              });
            }
            message.setAttribute("data-omni-translate-state", "ok");
          });
          document.querySelectorAll('[class="message spoilers-container"]').forEach(function (message) {
            if (message.getAttribute("data-omni-translate-state") === "ok") return;
            if (message.querySelector('.translatable-message')) return;
            message.setAttribute("data-omni-translate-state", "ok");
            var text = extractTelegramMessageText(message);
            if (shouldSkipReceiveSync(message, text)) {
              if (isOutgoingChatBubble(message) || isRecentlyOutgoingText(text)) {
                handleOutgoingBubbleForSync(ot, message, text, appendTranslationToTextNode);
              }
              return;
            }
            ot.log("翻译消息: " + message.textContent, null, "debug");
            if (text) {
              ot.translate(text, "receive").then(function (res) {
                ot.log("翻译结果: " + res, null, "debug");
                appendTranslationToTextNode(message, res);
              }).catch(function (err) {
                ot.log("翻译失败: " + String(err), null, "warn");
                appendTranslationToTextNode(message, String(err));
              });
            }
            message.setAttribute("data-omni-translate-state", "ok");
          });
        }
      },

      /** 启动 whatsapp Web 自动翻译（对齐 Omni：只扫 selectable-text，并跳过译文克隆） */
      startWhatsAppTranslation: async function () {
        ot.log("[OmniTranslate] 启动 WhatsApp Web 自动翻译", null, "info");
        while (true) {
          await new Promise(function (resolve) {
            setTimeout(resolve, 100);
          });
          try {
            document
              .querySelectorAll('[data-testid="selectable-text"]')
              .forEach(function (message) {
                if (message.getAttribute("data-omni-translate-state") === "ok") return;
                // 跳过我们插入的译文克隆（仍可能带 selectable-text）
                if (message.getAttribute("data-omni-translation") === "1") return;
                if (message.closest && message.closest('[data-omni-translation="1"]')) return;
                // 不要翻译输入框里的草稿
                if (message.closest && message.closest("footer")) return;
                if (
                  message.closest &&
                  message.closest('[data-testid="conversation-compose-box-input"]')
                ) {
                  return;
                }
                var text = (message.innerText || message.textContent || "").trim();
                if (!text) return;
                // 已带分隔线的发送译文，勿二次翻译
                if (String(text).indexOf(SEPARATOR) !== -1) {
                  message.setAttribute("data-omni-translate-state", "ok");
                  return;
                }
                // 己方气泡：按「发出」上报，勿标成 receive
                if (shouldSkipReceiveSync(message, text)) {
              message.setAttribute("data-omni-translate-state", "ok");
              if (isOutgoingChatBubble(message) || isRecentlyOutgoingText(text)) {
                handleOutgoingBubbleForSync(ot, message, text);
              }
              return;
            }
                ot.log("翻译消息: " + text, null, "debug");
                // 先标记，避免异步返回前被下一轮扫到
                message.setAttribute("data-omni-translate-state", "ok");
                ot.translate(text, "receive")
                  .then(function (res) {
                    ot.log("翻译结果: " + res, null, "debug");
                    cloneAndInsertAfter(message, "\n" + SEPARATOR + "\n" + res);
                  })
                  .catch(function (err) {
                    ot.log("翻译失败: " + String(err), null, "warn");
                    cloneAndInsertAfter(message, "\n" + SEPARATOR + "\n" + String(err));
                  });
              });
          } catch (e) {
            /* ignore DOM churn */
          }
        }
      },

      /** 启动 messenger Web 自动翻译 */
      startMessengerTranslation: async function () {
        ot.log("[OmniTranslate] 启动 Messenger Web 自动翻译", null, "info");
        while (true) {
          await new Promise(function (resolve) {
            setTimeout(resolve, 100);
          });
          document.querySelectorAll('[class="html-div xexx8yu xyri2b x18d9i69 x1c1uobl x1gslohp x14z9mp x12nagc x1lziwak x1yc453h x126k92a x18lvrbx"], [class="html-div xexx8yu xyri2b x18d9i69 x1c1uobl x1gslohp x14z9mp x12nagc x1lziwak x1yc453h x126k92a xyk4ms5"]').forEach(function (message) {
            if (message.getAttribute("data-omni-translate-state") === "ok") return;
            var text = message.innerText;
            if (shouldSkipReceiveSync(message, text)) {
              message.setAttribute("data-omni-translate-state", "ok");
              if (isOutgoingChatBubble(message) || isRecentlyOutgoingText(text)) {
                handleOutgoingBubbleForSync(ot, message, text);
              }
              return;
            }
            ot.log("翻译消息: " + message.textContent, null, "debug");
            if (text) {
              ot.translate(text, "receive").then(function (res) {
                ot.log("翻译结果: " + res, null, "debug");
                cloneAndInsertAfter(message, '\n' + SEPARATOR + '\n' + res);
              }).catch(function (err) {
                ot.log("翻译失败: " + String(err), null, "warn");
                cloneAndInsertAfter(message, '\n' + SEPARATOR + '\n' + String(err));
              });
            }
            message.setAttribute("data-omni-translate-state", "ok");
          });
        }
      },

      /** 启动 instagram Web 自动翻译 */
      startInstagramTranslation: async function () {
        ot.log("[OmniTranslate] 启动 Instagram Web 自动翻译", null, "info");
        while (true) {
          await new Promise(function (resolve) {
            setTimeout(resolve, 100);
          });
          document.querySelectorAll('.msg-s-event-listitem__body').forEach(function (message) {
            if (message.getAttribute("data-omni-translate-state") === "ok") return;
            var text = message.innerText;
            if (shouldSkipReceiveSync(message, text)) {
              message.setAttribute("data-omni-translate-state", "ok");
              if (isOutgoingChatBubble(message) || isRecentlyOutgoingText(text)) {
                handleOutgoingBubbleForSync(ot, message, text);
              }
              return;
            }
            ot.log("翻译消息: " + message.textContent, null, "debug");
            if (text) {
              ot.translate(text, "receive").then(function (res) {
                ot.log("翻译结果: " + res, null, "debug");
                cloneAndInsertAfter(message, '\n' + SEPARATOR + '\n' + res);
              }).catch(function (err) {
                ot.log("翻译失败: " + String(err), null, "warn");
                cloneAndInsertAfter(message, '\n' + SEPARATOR + '\n' + String(err));
              });
            }
            message.setAttribute("data-omni-translate-state", "ok");
          });
        }
      },

      /** 启动 LinkedIn 私信自动翻译 */
      startLinkedInTranslation: async function () {
        ot.log("[OmniTranslate] 启动 LinkedIn Web 自动翻译", null, "info");
        while (true) {
          await new Promise(function (resolve) {
            setTimeout(resolve, 100);
          });
          document
            .querySelectorAll(".msg-s-event-listitem__body")
            .forEach(function (message) {
              if (message.getAttribute("data-omni-translate-state") === "ok") return;
              var text = message.innerText;
              if (shouldSkipReceiveSync(message, text)) {
              message.setAttribute("data-omni-translate-state", "ok");
              if (isOutgoingChatBubble(message) || isRecentlyOutgoingText(text)) {
                handleOutgoingBubbleForSync(ot, message, text);
              }
              return;
            }
              ot.log("翻译消息: " + message.textContent, null, "debug");
              if (text) {
                ot.translate(text, "receive").then(function (res) {
                  ot.log("翻译结果: " + res, null, "debug");
                  cloneAndInsertAfter(message, '\n' + SEPARATOR + '\n' + res);
                }).catch(function (err) {
                  ot.log("翻译失败: " + String(err), null, "warn");
                  cloneAndInsertAfter(message, '\n' + SEPARATOR + '\n' + String(err));
                });
              }
              message.setAttribute("data-omni-translate-state", "ok");
            });
        }
      },

        /** 启动 twitter 私信自动翻译 */
      startTwitterTranslation: async function () {
        ot.log("[OmniTranslate] 启动 Twitter/X 私信自动翻译", null, "info");
        while (true) {
          await new Promise(function (resolve) {
            setTimeout(resolve, 100);
          });
          document
            .querySelectorAll('[class="font-chirp max-w-full whitespace-pre-wrap break-words text-inherit text-[length:inherit] font-normal"]')
            .forEach(function (message) {
              if (message.getAttribute("data-omni-translate-state") === "ok") return;
              var text = message.innerText;
              if (shouldSkipReceiveSync(message, text)) {
              message.setAttribute("data-omni-translate-state", "ok");
              if (isOutgoingChatBubble(message) || isRecentlyOutgoingText(text)) {
                handleOutgoingBubbleForSync(ot, message, text);
              }
              return;
            }
              ot.log("翻译消息: " + message.textContent, null, "debug");
              if (text) {
                ot.translate(text, "receive").then(function (res) {
                  ot.log("翻译结果: " + res, null, "debug");
                  cloneAndInsertAfter(message, '\n' + SEPARATOR + '\n' + res);
                }).catch(function (err) {
                  ot.log("翻译失败: " + String(err), null, "warn");
                  cloneAndInsertAfter(message, '\n' + SEPARATOR + '\n' + String(err));
                });
              }
              message.setAttribute("data-omni-translate-state", "ok");
            });
        }
      },

        /** 启动 tiktok 私信自动翻译 */
      startTikTokTranslation: async function () {
        ot.log("[OmniTranslate] 启动 TikTok 私信自动翻译", null, "info");
        while (true) {
          await new Promise(function (resolve) {
            setTimeout(resolve, 100);
          });
          document
            .querySelectorAll('.e16q2q3w15')
            .forEach(function (message) {
              if (message.getAttribute("data-omni-translate-state") === "ok") return;
              var text = message.innerText;
              if (shouldSkipReceiveSync(message, text)) {
              message.setAttribute("data-omni-translate-state", "ok");
              if (isOutgoingChatBubble(message) || isRecentlyOutgoingText(text)) {
                handleOutgoingBubbleForSync(ot, message, text);
              }
              return;
            }
              ot.log("翻译消息: " + message.textContent, null, "debug");
              if (text) {
                ot.translate(text, "receive").then(function (res) {
                  ot.log("翻译结果: " + res, null, "debug");
                  cloneAndInsertAfter(message, '\n' + SEPARATOR + '\n' + res);
                }).catch(function (err) {
                  ot.log("翻译失败: " + String(err), null, "warn");
                  cloneAndInsertAfter(message, '\n' + SEPARATOR + '\n' + String(err));
                });
              }
              message.setAttribute("data-omni-translate-state", "ok");
            });
        }
      },

      /** 启动 LINE Chrome 扩展自动翻译（3.7.x CSS modules） */
      startLineTranslation: async function () {
        ot.log("[OmniTranslate] 启动 LINE 自动翻译", null, "info");
        while (true) {
          await new Promise(function (resolve) {
            setTimeout(resolve, 150);
          });
          var roots = [
            document.querySelector('[class*="chatroom-module__chatroom"]'),
            document.querySelector('[class*="chatroom-module"]'),
            document.querySelector('[class*="messageList"]'),
            document.getElementById("_chat_room_msg_list"),
            document.querySelector('[class*="chatRoom"]'),
            document.body,
          ].filter(Boolean);
          var seen = new Set();
          roots.forEach(function (root) {
            root
              .querySelectorAll(
                [
                  '[class*="textMessageContent-module__text"]',
                  "pre[class*='textMessageContent-module__text']",
                  ".mdRGT07MsgText",
                  '[class*="MsgText"]',
                  '[class*="messageText"]',
                ].join(","),
              )
              .forEach(function (message) {
                if (seen.has(message)) return;
                seen.add(message);
                if (message.getAttribute("data-omni-translate-state") === "ok") return;
                if (message.getAttribute("data-omni-translation") === "1") return;
                if (
                  message.closest(
                    '[class*="Notice"], [class*="MdRGT10Notice"], [class*="systemMessage"], [data-omni-translation="1"]',
                  )
                ) {
                  return;
                }
                var text = extractLineMessageText(message);
                if (!text) {
                  message.setAttribute("data-omni-translate-state", "ok");
                  return;
                }
                if (shouldSkipReceiveSync(message, text)) {
              message.setAttribute("data-omni-translate-state", "ok");
              if (isOutgoingChatBubble(message) || isRecentlyOutgoingText(text)) {
                handleOutgoingBubbleForSync(ot, message, text);
              }
              return;
            }
                ot.log("翻译消息: " + text, null, "debug");
                ot.translate(text, "receive")
                  .then(function (res) {
                    ot.log("翻译结果: " + res, null, "debug");
                    var cloned = cloneAndInsertAfter(
                      message,
                      "\n" + SEPARATOR + "\n" + res,
                    );
                    if (cloned) {
                      cloned.setAttribute("data-omni-translate-state", "ok");
                      cloned.setAttribute("data-omni-translation", "1");
                    }
                  })
                  .catch(function (err) {
                    ot.log("翻译失败: " + String(err), null, "warn");
                    var cloned = cloneAndInsertAfter(
                      message,
                      "\n" + SEPARATOR + "\n" + String(err),
                    );
                    if (cloned) {
                      cloned.setAttribute("data-omni-translate-state", "ok");
                      cloned.setAttribute("data-omni-translation", "1");
                    }
                  });
                message.setAttribute("data-omni-translate-state", "ok");
              });
          });
        }
      },

      get metadata() {
        return window.__TAURI_INTERNALS__?.metadata ?? null;
      },
    });

    ot.onMessage(function (msg) {
      if (!msg || typeof msg !== 'object') return;
      var type = msg.type;
      if (type === 'manual_panel') {
        applyManualPanelFlags({
          expanded: !!msg.expanded,
          skipAutoTranslate: msg.skipAutoTranslate,
        });
        return;
      }
      if (type === 'tab_flags') {
        applyManualPanelFlags(msg);
        return;
      }
      var text = String(msg.text || '');
      var api = window.__OMNI_COMPOSE__;
      if (!api) {
        ot.log('compose API 未就绪，无法填入/发送', null, 'warn');
        return;
      }
      if (type === 'compose_fill') {
        if (!api.fill(text)) ot.log('compose fill 失败：未找到输入框', null, 'warn');
      } else if (type === 'compose_send') {
        if (!api.send(text)) ot.log('compose send 失败：未找到输入框', null, 'warn');
      } else {
        console.debug('[ACE CRM] message from host:', msg);
      }
    });

    ot.invoke('get_manual_panel')
      .then(function (res) {
        applyManualPanelFlags(res && res.data ? res.data : null);
      })
      .catch(function () {
        /* ignore */
      });

    ot.log("tab.js 注入成功，IPC 已就绪");

    // ot
    //   .invoke("ping", { href: location.href })
    //   .then(function (res) {
    //     ot.log("ping 成功", res, "debug");
    //   })
    //   .catch(function (err) {
    //     ot.log("ping 失败: " + String(err), null, "warn");
    //   });

    switch (window.__OMNI_TAB_GROUP_ID__) {
      case "telegram":
      case "telegram_w":
        ot.startTelegramTranslation();
        TelegramTranslationInput(ot);
        checkTelegramNewMessage(ot);
        break;
      case "whatsapp":
        ot.startWhatsAppTranslation();
        WhatsAppTranslationInput(ot);
        checkWhatsAppNewMessage(ot);
        break;
      case "messenger":
        ot.startMessengerTranslation();
        messengerTranslationInput(ot);
        checkMessengerNewMessage(ot);
        break;
      case "instagram":
        ot.startInstagramTranslation();
        instagramTranslationInput(ot);
        checkInstagramNewMessage(ot);
        break;
      case "facebook":
        // 与 Messenger 同系消息页，先复用 Messenger 翻译钩子
        ot.startMessengerTranslation();
        messengerTranslationInput(ot);
        checkMessengerNewMessage(ot);
        break;
      case "linkedin":
        ot.startLinkedInTranslation();
        linkedinTranslationInput(ot);
        checkLinkedInNewMessage(ot);
        checkLinkedInWindow();
        break;

      case "twitter":
        ot.startTwitterTranslation();
        twitterTranslationInput(ot);
        checkTwitterNewMessage(ot);
        break;

      case "tiktok":
        ot.startTikTokTranslation();
        tiktokTranslationInput(ot);
        checkTikTokNewMessage(ot);
        break;
      case "line":
        ot.startLineTranslation();
        lineTranslationInput(ot);
        checkLineNewMessage(ot);
        checkLineWindow();
        break;
      case "whoer":
      case "ip-test":
        // 检测工具页：受设置「测试模式」开关控制，未开启则不初始化任何逻辑
        if (!window.__OMNI_TEST_MODE__) {
          ot.log("whoer/ip-test skipped: test mode off", null, "info");
          break;
        }
        ot.log("whoer/ip-test ready (test mode on, no chat translation)", null, "info");
        break;
      case "zalo":
        try {
          ot.log(
            "Zalo DOM probe",
            {
              href: location.href,
              appPage: !!document.querySelector("#app-page"),
              convList: !!document.querySelector("#conversationListId"),
              richInput: !!document.querySelector("#richInput"),
              cards: document.querySelectorAll(
                "#messageView .card, .chat-message .card, .msg-list .card",
              ).length,
              unread: countZaloUnreadBadges(),
            },
            "info",
          );
        } catch (_) {
          /* ignore */
        }
        startZaloTranslation(ot);
        zaloTranslationInput(ot);
        checkZaloNewMessage(ot);
        break;
      case "discord":
        startDiscordTranslation(ot);
        discordTranslationInput(ot);
        checkGenericTitleUnread(ot, "Discord");
        break;
      case "skype":
        startSkypeTranslation(ot);
        skypeTranslationInput(ot);
        checkGenericTitleUnread(ot, "Skype");
        break;
      case "snapchat":
        startSnapchatTranslation(ot);
        snapchatTranslationInput(ot);
        checkGenericTitleUnread(ot, "Snapchat");
        break;
      case "google_chat":
        startGoogleChatTranslation(ot);
        googleChatTranslationInput(ot);
        checkGenericTitleUnread(ot, "GoogleChat");
        break;
      case "google_voice":
        startGoogleVoiceTranslation(ot);
        googleVoiceTranslationInput(ot);
        checkGenericTitleUnread(ot, "GoogleVoice");
        break;
      case "botim":
        startBotimTranslation(ot);
        botimTranslationInput(ot);
        checkGenericTitleUnread(ot, "Botim");
        break;
      case "line_business":
        startLineBusinessTranslation(ot);
        lineBusinessTranslationInput(ot);
        checkGenericTitleUnread(ot, "LineBusiness");
        break;
      case "line_works":
        startLineWorksTranslation(ot);
        lineWorksTranslationInput(ot);
        checkGenericTitleUnread(ot, "LineWorks");
        break;
      case "tinder":
        startTinderTranslation(ot);
        tinderTranslationInput(ot);
        checkGenericTitleUnread(ot, "Tinder");
        break;
      case "meta_business":
        startMetaBusinessTranslation(ot);
        metaBusinessTranslationInput(ot);
        checkGenericTitleUnread(ot, "MetaBusiness");
        break;
      default:
        ot.log("[OmniTranslate] 未找到对应的分组ID", null, "warn");
        break;
    }
    // setInterval(() => {
    //   ot.translate("你好，世界!", "send").then(function (res) {
    //     console.log("[OmniTranslate] 翻译结果:", res);
    //     ot.log("翻译结果: " + res, null, "debug");
    //   }).catch(function (err) {
    //     console.error("[OmniTranslate] 翻译失败:", err);
    //     ot.log("翻译失败: " + String(err), null, "warn");
    //   });
    // }, 3000);

    //在这里增加一个函数，功能是检测当前页面，如果是隐藏状态，就是当前标签页不是当前标签页，而且调用了翻译api，则认为有了新消息，就让当前窗口和所属分组闪烁，直到切换到这个标签页为止
    bindHiddenTabNewMessageOnTranslate(ot);
    // 对话语言按钮由独立脚本 chat-lang-fab.js 注入（主进程 installChatLangFab）

  });

})();


/**
 * linkedin检测到非linkdin聊天窗口和登录窗口时自动返回
 * 
 */

function checkLinkedInWindow() {
  setInterval(function () {
    if (!window.location.href.includes("https://www.linkedin.com/messaging") && !window.location.href.includes("https://www.linkedin.com/uas/login?session_redirect=https%3A%2F%2Fwww.linkedin.com%2Fmessaging%2F")) {
      window.location.href = "https://www.linkedin.com/messaging";
    }
  }, 1000);
}

/**
 * 从 document.title 解析未读数，如 "(3) WhatsApp" / "【2】…"；无法解析时返回 0。
 */
function parseUnreadCountFromTitle(title) {
  var m = String(title || "").match(/[(\[【]\s*(\d+)\s*[)\]】]/);
  if (!m) return 0;
  var n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function notifyUnreadState(ot, active, title) {
  var t = title != null ? String(title) : document.title || "";
  var count = 0;
  if (active) {
    count = parseUnreadCountFromTitle(t) || 1;
  }
  return ot
    .invoke("new_message", {
      active: !!active,
      title: t,
      count: count,
    })
    .catch(function () {});
}

/**
 * 后台标签页在调用翻译 API 成功后通知主界面闪烁（分组图标 + 窗口标签）。
 * 依赖 Rust 侧 sync_active_tab 记录的前台 webview label。
 * @param {{ translate: function, invoke: function, onMessage: function }} ot
 */
function bindHiddenTabNewMessageOnTranslate(ot) {
  function isTabActive() {
    return ot
      .invoke("is_tab_active", null)
      .then(function (res) {
        var data = res && res.data ? res.data : {};
        // 未同步：视为非前台，允许后台新消息弹窗（LINE 尤其依赖）
        if (data.synced === false) return false;
        return !!(data && data.active);
      })
      .catch(function () {
        return false;
      });
  }

  function notifyNewMessage(messageType) {
    var groupId = String(window.__OMNI_TAB_GROUP_ID__ || "");
    // LINE：不走扩展通知，翻译到新消息时也由客户端直接弹系统窗
    var source = groupId === "line" ? "line_unread" : "hidden_translate";
    return ot
      .invoke("new_message", {
        active: true,
        source: source,
        messageType: messageType ? String(messageType) : "",
        title: document.title || "",
        count: 1,
      })
      .catch(function () {});
  }

  // 角标数量由 startUnreadPoll 每 2 秒按页面角标回写，不要在这里用 is_tab_active 发 active:false。
  // 主进程 active 同步抖动会误清角标，导致「只有弹窗、没有数字」（WhatsApp 同联系人第二次消息尤其明显）。

  var translate = ot.translate.bind(ot);
  ot.translate = function (text, messageType, opts) {
    return translate(text, messageType, opts).then(function (res) {
      // 注意：即使命中翻译缓存，仍是一条新 DOM 消息；不能跳过未读通知，
      // 否则会出现「只有系统/网页弹窗、没有角标」。
      // 手动点「重新翻译」不弹未读提醒
      if (opts && (opts.skipCache || opts.skip_cache || opts.refreshCache || opts.refresh_cache)) {
        return res;
      }
      return isTabActive().then(function (active) {
        // 未同步前不要当成前台（否则 LINE 后台翻译永远不弹）
        if (!active) notifyNewMessage(messageType);
        return res;
      });
    });
  };
}

/** X 私信列表未读角标（存在即表示有未读） */
var TWITTER_UNREAD_BADGE_SEL =
  '[class="shrink-0 text-[8px] text-primary"]';

/**
 * 检测 Twitter/X 是否有未读：侧栏/列表中的未读角标元素
 * @returns {boolean}
 */
function hasTwitterUnreadBadge() {
  return !!document.querySelector(TWITTER_UNREAD_BADGE_SEL);
}

/**
 * 每 2 秒读一次页面未读角标，把当前数量同步到标签和社媒 logo。
 * 角标消失时 count 为 0，界面数字一并清掉，不必再切聊天窗口。
 * 从「正在查看」切到后台且仍有未读时，额外发一次 became_hidden，避免通知被查看状态吞掉。
 * @param {{ invoke: function }} ot
 * @param {function(): { active: boolean, title?: string, count?: number }} detect 返回当前角标状态
 * @returns {void}
 */
function startUnreadPoll(ot, detect) {
  var wasTabActive = null;
  setInterval(function () {
    try {
      var state = detect() || { active: false };
      var active = !!state.active;
      var title = state.title != null ? String(state.title) : document.title || "";
      var count = typeof state.count === "number" ? state.count : 0;
      if (!active || count < 0) count = 0;

      ot.invoke("is_tab_active", null)
        .then(function (res) {
          var data = res && res.data ? res.data : {};
          var tabActive =
            data.synced === false ? false : !!(data && data.active);
          var becameHidden = wasTabActive === true && tabActive === false;
          wasTabActive = tabActive;
          return ot.invoke("new_message", {
            active: active,
            title: title,
            count: count,
            source: becameHidden && active ? "became_hidden" : "poll",
          });
        })
        .catch(function () {
          ot.invoke("new_message", {
            active: active,
            title: title,
            count: count,
            source: "poll",
          }).catch(function () {});
        });
    } catch (_) {
      /* ignore */
    }
  }, 2000);
}

/**
 * 统计 Messenger / Facebook 消息页未读数。
 * 不能用「标题不含 Messenger」：facebook.com 与打开中的会话标题几乎永远不含该词，会假阳性闪烁。
 * 对齐 WA/TG：标题数字 + aria/testid 未读角标（不做宽松数字扫全页，避免误闪）。
 * @returns {number} 未读合计
 */
function countMessengerUnreadBadges() {
  var total = 0;
  var seen = new Set();

  function addCount(n) {
    if (Number.isFinite(n) && n > 0) total += n;
  }

  function considerLabel(el, label) {
    if (!el || seen.has(el)) return;
    var text = String(label || "").trim();
    if (!text) return;
    if (!/unread|未读|未讀|新消息|new message|未読/i.test(text)) return;
    seen.add(el);
    var m = text.match(/(\d{1,4})/);
    addCount(m ? parseInt(m[1], 10) || 1 : 1);
  }

  try {
    document.querySelectorAll("[aria-label]").forEach(function (el) {
      considerLabel(el, el.getAttribute("aria-label"));
    });
  } catch (_) {
    /* ignore */
  }

  try {
    document.querySelectorAll("[title]").forEach(function (el) {
      considerLabel(el, el.getAttribute("title"));
    });
  } catch (_) {
    /* ignore */
  }

  try {
    document.querySelectorAll("[data-testid]").forEach(function (el) {
      if (seen.has(el)) return;
      var tid = String(el.getAttribute("data-testid") || "");
      if (!/unread|badge|notif/i.test(tid)) return;
      var txt = String(el.textContent || "").trim();
      seen.add(el);
      if (/^\d{1,4}\+?$/.test(txt)) addCount(parseInt(txt.replace(/\D/g, ""), 10) || 1);
      else addCount(1);
    });
  } catch (_) {
    /* ignore */
  }

  return total;
}

/**
 * 检测 Messenger / Facebook 新消息：仅标题数字或真实未读角标。
 * @param {{ translate: function, log: function }} ot
 */
function checkMessengerNewMessage(ot) {
  startUnreadPoll(ot, function () {
    var title = document.title || "";
    var titleCount = parseUnreadCountFromTitle(title);
    var listCount = 0;
    try {
      listCount = countMessengerUnreadBadges();
    } catch (_) {
      listCount = 0;
    }
    var count = Math.max(titleCount, listCount);
    var active = count > 0;
    return {
      active: active,
      title: title,
      count: active ? count : 0,
    };
  });
}

/**
 * 检测TikTok是否有新消息：仅标题中的未读数字，避免普通括号误判
 * @param {{ translate: function, log: function }} ot
 */
function checkTikTokNewMessage(ot) {
  startUnreadPoll(ot, function () {
    var title = document.title || "";
    var count = parseUnreadCountFromTitle(title);
    return { active: count > 0, title: title, count: count };
  });
}

/**
 * 检测 Twitter/X 新消息并触发标签闪烁
 * @param {{ translate: function, log: function }} ot
 */
function checkTwitterNewMessage(ot) {
  startUnreadPoll(ot, function () {
    var active = hasTwitterUnreadBadge();
    var title = document.title || "";
    var titleCount = parseUnreadCountFromTitle(title);
    var count = active ? Math.max(titleCount, 1) : titleCount;
    return {
      active: count > 0,
      title: title,
      count: count,
    };
  });
}

/**
 * 检测 LinkedIn 新消息：仅标题未读数字
 * @param {{ translate: function, log: function }} ot
 */
function checkLinkedInNewMessage(ot) {
  startUnreadPoll(ot, function () {
    var title = document.title || "";
    var count = parseUnreadCountFromTitle(title);
    return { active: count > 0, title: title, count: count };
  });
}

/**
 * 检测 Instagram 新消息：标题未读数字（私信页常为 "(N) Instagram" / "(N) Direct"）
 * @param {{ translate: function, log: function }} ot
 */
function checkInstagramNewMessage(ot) {
  startUnreadPoll(ot, function () {
    var title = document.title || "";
    var count = parseUnreadCountFromTitle(title);
    return { active: count > 0, title: title, count: count };
  });
}

/**
 * 统计 Telegram Web（A/K）聊天列表未读角标。
 * 不能只靠 document.title：很多时候标题一直是 "Telegram"/"Telegram Web"，频道消息更是常不改标题。
 */
function countTelegramUnreadBadges() {
  var total = 0;
  var seen = new Set();

  function consider(el) {
    if (!el || seen.has(el)) return;
    // 不因虚拟列表离屏而丢弃角标（否则 title 不变时永远 0 未读）
    var cls = String(el.className || "");
    if (/reaction|pollvote|badge-fake|premium|verified|story/i.test(cls) && !/unread/i.test(cls)) {
      return;
    }
    if (/avatar|profile|emoji|mention-icon/i.test(cls) && !/badge|unread/i.test(cls)) {
      return;
    }
    if (/is-badge-empty/i.test(cls)) return;
    seen.add(el);
    var t = String(el.textContent || "").trim();
    if (!t) {
      if (/badge|unread/i.test(cls)) total += 1;
      return;
    }
    if (!/^\d{1,4}\+?$/.test(t)) return;
    var n = parseInt(t.replace(/\D/g, ""), 10);
    if (Number.isFinite(n) && n > 0) total += n;
  }

  var roots = [
    document.querySelector("#column-left"),
    document.querySelector("#chatlist-container"),
    document.querySelector("#folders-container"),
    document.querySelector("#LeftColumn"),
    document.querySelector(".chat-list"),
    document.querySelector(".chats-container"),
    document.querySelector(".tabs-tab.chats-container"),
    document.querySelector("#Main .left"),
    document.body,
  ].filter(Boolean);

  var sels = [
    ".dialog-subtitle-badge:not(.is-badge-empty)",
    ".badge.unread:not(.is-badge-empty)",
    ".badge.badge-primary:not(.is-badge-empty)",
    ".dialogs-row .badge:not(.is-badge-empty)",
    ".chatlist-chat .Badge",
    ".Badge:not(.is-badge-empty)",
    "span.badge:not(.is-badge-empty)",
    ".ChatBadge",
    ".rp-number",
    "[class*='unread-badge']",
    "[class*='UnreadBadge']",
    "[class*='dialog-badge']",
    ".badge-unread",
  ];

  roots.forEach(function (root) {
    for (var i = 0; i < sels.length; i++) {
      try {
        root.querySelectorAll(sels[i]).forEach(consider);
      } catch (e) {}
    }
    try {
      root.querySelectorAll("[aria-label]").forEach(function (el) {
        var label = String(el.getAttribute("aria-label") || "");
        if (!/unread|未读|непрочит|mention|条新消息|unread message/i.test(label)) return;
        if (seen.has(el)) return;
        seen.add(el);
        var m = label.match(/(\d+)/);
        total += m ? parseInt(m[1], 10) || 1 : 1;
      });
    } catch (e) {}
  });

  return total;
}

/**
 * 检测 Telegram 新消息：标题数字 + 会话列表未读角标（与 WhatsApp 对齐）。
 * @param {{ translate: function, log: function }} ot
 */
function checkTelegramNewMessage(ot) {
  startUnreadPoll(ot, function () {
    var title = document.title || "";
    var titleCount = parseUnreadCountFromTitle(title);
    var listCount = countTelegramUnreadBadges();
    var count = Math.max(titleCount, listCount);
    var active =
      count > 0 || /\(\s*\d+\s*\)/.test(title) || /\[\s*\d+\s*\]/.test(title);
    if (active && count <= 0) count = 1;
    return {
      active: !!active,
      title: title,
      count: active ? count : 0,
    };
  });
}

/**
 * 统计 WhatsApp 聊天列表未读数（标题经常不更新或会回到 "WhatsApp"）。
 */
function countWhatsAppUnreadBadges() {
  var total = 0;
  var seen = new Set();

  function addFromText(text) {
    var n = parseInt(String(text || "").replace(/[^\d]/g, ""), 10);
    if (Number.isFinite(n) && n > 0) total += n;
    else if (String(text || "").trim()) total += 1;
  }

  // 未读数字角标（多语言 aria-label / 宽松 testid）
  var sels = [
    '[data-testid="icon-unread-count"]',
    'span[data-testid="icon-unread-count"]',
    'div[data-testid="icon-unread-count"]',
    '[data-testid*="unread"]',
    '[data-icon="unread-count"]',
    '#pane-side span[aria-label]',
    '#side span[aria-label]',
  ];
  for (var i = 0; i < sels.length; i++) {
    try {
      document.querySelectorAll(sels[i]).forEach(function (el) {
        if (seen.has(el)) return;
        var tid = String(el.getAttribute("data-testid") || "");
        var txt = String(el.textContent || "").trim();
        // 宽松 testid 时仅收数字角标，避免扫到无关节点
        if (sels[i].indexOf("unread") >= 0 && sels[i].indexOf("icon-unread-count") < 0) {
          if (!/^\d{1,4}\+?$/.test(txt) && !/unread/i.test(tid)) return;
        }
        if (sels[i].indexOf("aria-label") >= 0) {
          var al = String(el.getAttribute("aria-label") || "");
          if (!/unread|未读|não lida|no leído|non lu|ungelesen|непрочит/i.test(al)) return;
        }
        seen.add(el);
        addFromText(txt || el.getAttribute("aria-label"));
      });
    } catch (_) {
      /* ignore */
    }
  }

  document.querySelectorAll("[aria-label]").forEach(function (el) {
    var label = String(el.getAttribute("aria-label") || "");
    if (!/unread|未读|não lida|no leído|non lu|ungelesen|непрочит/i.test(label)) return;
    if (seen.has(el)) return;
    seen.add(el);
    var m = label.match(/(\d+)/);
    if (m) total += parseInt(m[1], 10) || 1;
    else total += 1;
  });

  return total;
}

/**
 * 检测 WhatsApp 新消息：标题数字 + 聊天列表未读角标。
 * 不能只靠 title !== "WhatsApp"：有未读时标题也常回到 "WhatsApp"，会误清角标。
 */
function checkWhatsAppNewMessage(ot) {
  startUnreadPoll(ot, function () {
    var title = document.title || "";
    var titleCount = parseUnreadCountFromTitle(title);
    var listCount = countWhatsAppUnreadBadges();
    var count = Math.max(titleCount, listCount);
    var active =
      count > 0 || /\(\s*\d+\s*\)/.test(title) || /\[\s*\d+\s*\]/.test(title);
    if (active && count <= 0) count = 1;
    return {
      active: active,
      title: title,
      count: active ? count : 0,
    };
  });
}

/**
 * 拦截 Telegram 输入框回车：先翻译再发送。
 * 等待 .rows-wrapper-wrapper 内的输入框出现后再绑定。
 * @param {{ translate: function, log: function }} ot
 */
function TelegramTranslationInput(ot) {
  var INPUT_SEL =
    ".rows-wrapper-wrapper .input-message-container > .input-message-input[contenteditable='true']:not(.input-field-input-fake)";
  var bound = new WeakSet();
  var sending = false;

  function findInput() {
    return document.querySelector(INPUT_SEL);
  }

  function getText(el) {
    return (el.innerText || el.textContent || "").trim();
  }

  function setText(el, text) {
    el.textContent = text;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }

  function dispatchEnter(el) {
    var opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  function sendTranslated(input, text) {
    sending = true;
    setText(input, text);
    dispatchEnter(input);
    sending = false;
  }

  function onKeyDown(e) {
    if (shouldSkipComposeAutoTranslate()) return;
    if (sending) return;
    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;

    var input = e.currentTarget;
    var text = getText(input);
    if (!text) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    ot.log("翻译输入: " + text, null, "debug");
    ot.translate(text, "send")
      .then(function (res) {
        ot.log("输入翻译结果: " + res, null, "debug");
        sendTranslated(input, res);
      })
      .catch(function (err) {
        ot.log("输入翻译失败: " + String(err), null, "warn");
        sendTranslated(input, text);
      });
  }

  function bindInput(input) {
    if (!input || bound.has(input)) return;
    bound.add(input);
    input.addEventListener("keydown", onKeyDown, true);
  }

  function tryBind() {
    bindInput(findInput());
  }

  registerOmniCompose({
    fill: function (text) {
      var input = findInput();
      if (!input) return false;
      setText(input, text);
      return true;
    },
    send: function (text) {
      var input = findInput();
      if (!input) return false;
      sendTranslated(input, text);
      return true;
    },
  });

  (async function run() {
    ot.log("[OmniTranslate] 等待 Telegram 输入框...", null, "info");
    while (!findInput()) {
      await new Promise(function (r) {
        setTimeout(r, 200);
      });
    }
    ot.log("[OmniTranslate] Telegram 输入框已就绪，启用发送前翻译", null, "info");
    tryBind();
    new MutationObserver(tryBind).observe(document.body, { childList: true, subtree: true });
  })();
}

/**
 * Lexical contenteditable 输入框：拦截 Enter，翻译后写入并发送。
 * @param {{ translate: function, log: function }} ot
 * @param {{ tag: string, findInput: function(): Element|null, triggerSend?: function(Element, function): void }} cfg
 */
function createLexicalComposeTranslationInput(ot, cfg) {
  var tag = cfg.tag;
  var bound = new WeakSet();
  var sending = false;
  var cachedEditor = null;

  function findInput() {
    return cfg.findInput();
  }

  function getText(el) {
    return (el.innerText || el.textContent || "").trim();
  }

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  function getReactFiber(dom) {
    if (!dom) return null;
    var keys = Object.keys(dom);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k.indexOf("__reactFiber") === 0 || k.indexOf("__reactInternalInstance") === 0) {
        return dom[k];
      }
    }
    return null;
  }

  function searchFiberForEditor(fiber) {
    var queue = [fiber];
    var seen = new WeakSet();
    var n = 0;
    while (queue.length && n++ < 800) {
      var f = queue.shift();
      if (!f || seen.has(f)) continue;
      seen.add(f);
      var props = f.memoizedProps;
      if (props && props.editor && typeof props.editor.setEditorState === "function") {
        return props.editor;
      }
      var state = f.stateNode;
      if (
        state &&
        typeof state.setEditorState === "function" &&
        typeof state.parseEditorState === "function"
      ) {
        return state;
      }
      if (f.child) queue.push(f.child);
      if (f.sibling) queue.push(f.sibling);
      if (f.return) queue.push(f.return);
    }
    return null;
  }

  function findLexicalEditor(el) {
    if (cachedEditor) return cachedEditor;
    var node = el;
    for (var d = 0; node && d < 30; d++) {
      var fiber = getReactFiber(node);
      if (fiber) {
        var ed = searchFiberForEditor(fiber);
        if (ed) {
          cachedEditor = ed;
          return ed;
        }
      }
      node = node.parentElement;
    }
    return null;
  }

  function buildLexicalJson(text, editor) {
    try {
      var current = editor.getEditorState().toJSON();
      if (current && current.root && current.root.children && current.root.children.length) {
        var para = JSON.parse(JSON.stringify(current.root.children[0]));
        if (para.type === "paragraph" || para.type === "quote" || para.children) {
          if (!para.children || !para.children.length) {
            para.children = [
              {
                detail: 0,
                format: 0,
                mode: "normal",
                style: "",
                text: text,
                type: "text",
                version: 1,
              },
            ];
          } else {
            para.children = para.children.map(function (child, idx) {
              if (child.type === "text" || child.text !== undefined) {
                var c = JSON.parse(JSON.stringify(child));
                c.text = idx === 0 ? text : "";
                return c;
              }
              return child;
            });
            if (para.children[0].type !== "text" && para.children[0].text === undefined) {
              para.children.unshift({
                detail: 0,
                format: 0,
                mode: "normal",
                style: "",
                text: text,
                type: "text",
                version: 1,
              });
            }
          }
          current.root.children = [para];
          return JSON.stringify(current);
        }
      }
    } catch (e) { }
    return JSON.stringify({
      root: {
        children: [
          {
            children: [
              {
                detail: 0,
                format: 0,
                mode: "normal",
                style: "",
                text: text,
                type: "text",
                version: 1,
              },
            ],
            direction: "ltr",
            format: "",
            indent: 0,
            type: "paragraph",
            version: 1,
            textFormat: 0,
            textStyle: "",
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "root",
        version: 1,
      },
    });
  }

  async function setTextViaLexical(el, text) {
    var editor = findLexicalEditor(el);
    if (!editor) return false;
    try {
      var json = buildLexicalJson(text, editor);
      var state = editor.parseEditorState(json);
      editor.setEditorState(state);
      if (typeof editor.focus === "function") editor.focus();
      else el.focus();
      await sleep(50);
      return getText(el) === text;
    } catch (err) {
      ot.log("[" + tag + "] Lexical setEditorState 失败: " + err, null, "debug");
      return false;
    }
  }

  function selectAll(el) {
    el.focus();
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return range;
  }

  function dispatchBeforeInput(el, inputType, data, range) {
    var evt = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: inputType,
      data: data,
    });
    if (!evt.getTargetRanges) {
      evt.getTargetRanges = function () {
        return [range.cloneRange()];
      };
    }
    return el.dispatchEvent(evt);
  }

  async function simulateRealReplace(el, text) {
    el.focus();
    await sleep(40);

    var mod = /Mac/i.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
    el.dispatchEvent(
      new KeyboardEvent("keydown", Object.assign({ key: "a", code: "KeyA", bubbles: true, cancelable: true }, mod))
    );
    el.dispatchEvent(
      new KeyboardEvent("keyup", Object.assign({ key: "a", code: "KeyA", bubbles: true, cancelable: true }, mod))
    );
    await sleep(40);

    var range = selectAll(el);
    dispatchBeforeInput(el, "deleteByCut", null, range);
    document.execCommand("delete", false, null);
    el.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Backspace",
        code: "Backspace",
        keyCode: 8,
        which: 8,
        bubbles: true,
        cancelable: true,
      })
    );
    await sleep(40);

    if (getText(el)) {
      range = selectAll(el);
      document.execCommand("delete", false, null);
      await sleep(30);
    }

    range = selectAll(el);
    dispatchBeforeInput(el, "insertText", text, range);
    document.execCommand("insertText", false, text);
    await sleep(60);

    if (getText(el) === text) return true;

    range = selectAll(el);
    dispatchBeforeInput(el, "insertFromPaste", text, range);
    var dt = new DataTransfer();
    dt.setData("text/plain", text);
    el.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt })
    );
    await sleep(60);

    return getText(el) === text;
  }

  async function setText(el, text) {
    if (await setTextViaLexical(el, text)) return true;
    cachedEditor = null;
    if (await setTextViaLexical(el, text)) return true;
    return simulateRealReplace(el, text);
  }

  function dispatchEnter(el) {
    var opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  function triggerSend(input) {
    if (cfg.triggerSend) {
      cfg.triggerSend(input, dispatchEnter);
      return;
    }
    dispatchEnter(input);
  }

  function sendTranslated(input, text) {
    sending = true;
    setText(input, text).then(function (ok) {
      if (!ok) {
        ot.log("[" + tag + "] 输入框替换译文失败，取消发送", null, "warn");
        sending = false;
        return;
      }
      setTimeout(function () {
        triggerSend(input);
        setTimeout(function () {
          sending = false;
        }, 300);
      }, 80);
    });
  }

  function onKeyDown(e) {
    if (shouldSkipComposeAutoTranslate()) return;
    if (sending) return;
    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;

    var input = e.currentTarget;
    var text = getText(input);
    if (!text) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    ot.log("[" + tag + "] 翻译输入: " + text, null, "debug");
    ot.translate(text, "send")
      .then(function (res) {
        ot.log("[" + tag + "] 输入翻译结果: " + res, null, "debug");
        sendTranslated(input, res);
      })
      .catch(function (err) {
        ot.log("[" + tag + "] 输入翻译失败: " + String(err), null, "warn");
        sendTranslated(input, text);
      });
  }

  function bindInput(input) {
    if (!input || bound.has(input)) return;
    bound.add(input);
    input.addEventListener("keydown", onKeyDown, true);
  }

  function tryBind() {
    bindInput(findInput());
  }

  registerOmniCompose({
    fill: function (text) {
      var input = findInput();
      if (!input) return false;
      setText(input, text);
      return true;
    },
    send: function (text) {
      var input = findInput();
      if (!input) return false;
      sendTranslated(input, text);
      return true;
    },
  });

  (async function run() {
    ot.log("[OmniTranslate] 等待 " + tag + " 输入框...", null, "info");
    while (!findInput()) {
      await new Promise(function (r) {
        setTimeout(r, 200);
      });
    }
    ot.log("[OmniTranslate] " + tag + " 输入框已就绪，启用发送前翻译", null, "info");
    tryBind();
    new MutationObserver(tryBind).observe(document.body, { childList: true, subtree: true });
  })();
}

/**
 * TikTok 私信输入框（Draft.js）：拦截 Enter，翻译后同步 Draft 状态并发送。
 * @param {{ translate: function, log: function }} ot
 */
function tiktokTranslationInput(ot) {
  var bound = new WeakSet();
  var sending = false;

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  function findChatBottom() {
    return document.querySelector('[data-e2e="dm-new-chat-bottom"]');
  }

  function findInput() {
    var bottom = findChatBottom();
    var scope = bottom || document;
    return (
      scope.querySelector(
        '[data-e2e="dm-new-input-editor"] .public-DraftEditor-content[contenteditable="true"]',
      ) ||
      scope.querySelector(
        '[data-e2e="dm-new-input-editor"] [contenteditable="true"][role="textbox"]',
      ) ||
      scope.querySelector(
        '.DraftEditor-root .public-DraftEditor-content[contenteditable="true"]',
      ) ||
      scope.querySelector('[aria-label="发送消息..."][contenteditable="true"]') ||
      scope.querySelector('[aria-label^="发送消息"][contenteditable="true"]') ||
      scope.querySelector('[aria-label="Send message..."][contenteditable="true"]') ||
      scope.querySelector('[aria-label^="Send message"][contenteditable="true"]')
    );
  }

  function findSendButton() {
    var bottom = findChatBottom();
    var scope = bottom || document;
    return (
      scope.querySelector('[data-e2e="dm-new-send-btn"]') ||
      scope.querySelector('svg[data-e2e="dm-new-send-btn"][role="button"]') ||
      scope.querySelector('[aria-label="发送"][data-e2e="dm-new-send-btn"]') ||
      scope.querySelector('[aria-label="Send"][data-e2e="dm-new-send-btn"]')
    );
  }

  function getText(el) {
    return (el.innerText || el.textContent || "").trim();
  }

  function getReactFiber(dom) {
    if (!dom) return null;
    var keys = Object.keys(dom);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k.indexOf("__reactFiber") === 0 || k.indexOf("__reactInternalInstance") === 0) {
        return dom[k];
      }
    }
    return null;
  }

  function findDraftProps(fiber) {
    var queue = [fiber];
    var seen = new WeakSet();
    var n = 0;
    while (queue.length && n++ < 1500) {
      var f = queue.shift();
      if (!f || seen.has(f)) continue;
      seen.add(f);
      var props = f.memoizedProps;
      if (
        props &&
        props.editorState &&
        typeof props.onChange === "function" &&
        typeof props.editorState.getCurrentContent === "function"
      ) {
        return props;
      }
      if (f.child) queue.push(f.child);
      if (f.sibling) queue.push(f.sibling);
      if (f.return) queue.push(f.return);
    }
    return null;
  }

  function findReactOnClick(fiber) {
    var queue = [fiber];
    var seen = new WeakSet();
    var n = 0;
    while (queue.length && n++ < 400) {
      var f = queue.shift();
      if (!f || seen.has(f)) continue;
      seen.add(f);
      var props = f.memoizedProps;
      if (props && typeof props.onClick === "function") return props.onClick;
      if (f.return) queue.push(f.return);
      if (f.child) queue.push(f.child);
    }
    return null;
  }

  async function setTextViaDraft(el, text) {
    var anchor = el.closest(".DraftEditor-root") || el;
    var fiber = getReactFiber(anchor) || getReactFiber(el);
    if (!fiber) return false;
    var draft = findDraftProps(fiber);
    if (!draft) return false;
    try {
      var editorState = draft.editorState;
      var EditorState = editorState.constructor;
      var ContentState = editorState.getCurrentContent().constructor;
      var newContent = ContentState.createFromText(text);
      var newState = EditorState.createWithContent(newContent);
      draft.onChange(newState);
      el.focus();
      await sleep(80);
      return getText(el) === text;
    } catch (err) {
      ot.log("[TikTok] Draft onChange 失败: " + err, null, "debug");
      return false;
    }
  }

  function selectAll(el) {
    el.focus();
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return range;
  }

  async function setTextViaDom(el, text) {
    el.focus();
    await sleep(30);
    selectAll(el);
    document.execCommand("delete", false, null);
    await sleep(30);
    selectAll(el);
    document.execCommand("insertText", false, text);
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text,
      }),
    );
    await sleep(80);
    return getText(el) === text;
  }

  async function setText(el, text) {
    if (await setTextViaDraft(el, text)) return true;
    return setTextViaDom(el, text);
  }

  function syntheticClick(el) {
    if (!el) return;
    var opts = { bubbles: true, cancelable: true, view: window };
    try {
      el.dispatchEvent(new PointerEvent("pointerdown", opts));
    } catch (e) {}
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    try {
      el.dispatchEvent(new PointerEvent("pointerup", opts));
    } catch (e) {}
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
    if (typeof el.click === "function") el.click();
    var fiber = getReactFiber(el);
    if (fiber) {
      var onClick = findReactOnClick(fiber);
      if (onClick) {
        try {
          onClick({ preventDefault: function () {}, stopPropagation: function () {} });
        } catch (e2) {}
      }
    }
  }

  function dispatchEnter(el) {
    var opts = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keypress", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  function triggerSend(input) {
    var btn = findSendButton();
    if (btn) {
      syntheticClick(btn);
      return;
    }
    dispatchEnter(input);
  }

  function sendTranslated(input, text) {
    sending = true;
    setText(input, text).then(function (ok) {
      if (!ok) {
        ot.log("[TikTok] 输入框替换译文失败，取消发送", null, "warn");
        sending = false;
        return;
      }
      setTimeout(function () {
        triggerSend(input);
        setTimeout(function () {
          if (getText(input)) dispatchEnter(input);
          setTimeout(function () {
            sending = false;
          }, 300);
        }, 120);
      }, 150);
    });
  }

  function onKeyDown(e) {
    if (shouldSkipComposeAutoTranslate()) return;
    if (sending) return;
    if (
      e.key !== "Enter" ||
      e.shiftKey ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      e.isComposing
    )
      return;

    var input = e.currentTarget;
    var text = getText(input);
    if (!text) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    ot.log("[TikTok] 翻译输入: " + text, null, "debug");
    ot.translate(text, "send")
      .then(function (res) {
        ot.log("[TikTok] 输入翻译结果: " + res, null, "debug");
        sendTranslated(input, res);
      })
      .catch(function (err) {
        ot.log("[TikTok] 输入翻译失败: " + String(err), null, "warn");
        sendTranslated(input, text);
      });
  }

  function bindInput(input) {
    if (!input || bound.has(input)) return;
    bound.add(input);
    input.addEventListener("keydown", onKeyDown, true);
  }

  function tryBind() {
    bindInput(findInput());
  }

  registerOmniCompose({
    fill: function (text) {
      var input = findInput();
      if (!input) return false;
      setText(input, text);
      return true;
    },
    send: function (text) {
      var input = findInput();
      if (!input) return false;
      sendTranslated(input, text);
      return true;
    },
  });

  (async function run() {
    ot.log("[OmniTranslate] 等待 TikTok 私信输入框...", null, "info");
    while (!findInput()) {
      await sleep(200);
    }
    ot.log("[OmniTranslate] TikTok 输入框已就绪，启用发送前翻译", null, "info");
    tryBind();
    new MutationObserver(tryBind).observe(document.body, {
      childList: true,
      subtree: true,
    });
  })();
}

/**
 * 拦截 WhatsApp 输入框回车：先翻译再发送。
 * @param {{ translate: function, log: function }} ot
 */
function WhatsAppTranslationInput(ot) {
  createLexicalComposeTranslationInput(ot, {
    tag: "WhatsApp",
    findInput: function () {
      return (
        document.querySelector(
          '[data-testid="conversation-compose-box-input"][contenteditable="true"]'
        ) ||
        document.querySelector('#main footer [contenteditable="true"][role="textbox"]') ||
        document.querySelector('#main footer [contenteditable="true"][data-tab="10"]') ||
        document.querySelector('footer [contenteditable="true"][data-tab="10"]') ||
        document.querySelector('[aria-label="Type a message"][contenteditable="true"]') ||
        document.querySelector('[aria-label="输入消息"][contenteditable="true"]')
      );
    },
    triggerSend: function (input, dispatchEnter) {
      var compose = document.querySelector('[data-testid="compose-box"]');
      var btn =
        (compose && compose.querySelector('button[data-tab="11"]')) ||
        (compose && compose.querySelector('button[aria-label="发送"]')) ||
        (compose && compose.querySelector('button[aria-label="Send"]'));
      if (btn && btn.getAttribute("aria-disabled") !== "true") {
        btn.click();
        return;
      }
      dispatchEnter(input);
    },
  });
}

/**
 * Messenger 串文编辑框：拦截 Enter，翻译后点击发送。
 * @param {{ translate: function, log: function }} ot
 */
function messengerTranslationInput(ot) {
  createLexicalComposeTranslationInput(ot, {
    tag: "Messenger",
    findInput: function () {
      var region =
        document.querySelector('[role="region"][aria-label="串文编辑框"]') ||
        document.querySelector('[aria-label="串文编辑框"]') ||
        document.querySelector('[role="region"][aria-label="Message composer"]');
      if (region) {
        var inRegion = region.querySelector(
          '[contenteditable="true"][role="textbox"][data-lexical-editor="true"]'
        );
        if (inRegion) return inRegion;
      }
      var byAria =
        document.querySelector(
          '[contenteditable="true"][role="textbox"][data-lexical-editor="true"][aria-label^="发消息给"]'
        ) ||
        document.querySelector(
          '[contenteditable="true"][role="textbox"][data-lexical-editor="true"][aria-label^="Message"]'
        );
      if (byAria) return byAria;
      return document.querySelector(
        '[contenteditable="true"][role="textbox"][data-lexical-editor="true"]'
      );
    },
    triggerSend: function (input, dispatchEnter) {
      var btn =
        document.querySelector('[aria-label="按 Enter 键发送"][role="button"]') ||
        document.querySelector('[aria-label="Press Enter to send"][role="button"]') ||
        document.querySelector('[aria-label="Send"][role="button"]');
      if (btn) {
        btn.click();
        return;
      }
      dispatchEnter(input);
    },
  });
}

/**
 * Instagram 私信输入框（Lexical）：拦截 Enter，翻译后点击发送。
 * @param {{ translate: function, log: function }} ot
 */
function instagramTranslationInput(ot) {
  createLexicalComposeTranslationInput(ot, {
    tag: "Instagram",
    findInput: function () {
      var byPlaceholder =
        document.querySelector(
          '[contenteditable="true"][role="textbox"][data-lexical-editor="true"][aria-placeholder="发消息..."]'
        ) ||
        document.querySelector(
          '[contenteditable="true"][role="textbox"][data-lexical-editor="true"][aria-placeholder^="发消息"]'
        ) ||
        document.querySelector(
          '[contenteditable="true"][role="textbox"][data-lexical-editor="true"][aria-placeholder="Message..."]'
        ) ||
        document.querySelector(
          '[contenteditable="true"][role="textbox"][data-lexical-editor="true"][aria-placeholder^="Message"]'
        );
      if (byPlaceholder) return byPlaceholder;
      return (
        document.querySelector(
          'div.notranslate[contenteditable="true"][role="textbox"][data-lexical-editor="true"]'
        ) ||
        document.querySelector(
          '[contenteditable="true"][role="textbox"][data-lexical-editor="true"]'
        )
      );
    },
    triggerSend: function (input, dispatchEnter) {
      var btn =
        document.querySelector('[aria-label="发送"][role="button"]') ||
        document.querySelector('[aria-label="Send"][role="button"]');
      if (btn) {
        btn.click();
        return;
      }
      var sendSvg = document.querySelector('svg[aria-label="Send"][role="img"]');
      if (sendSvg) {
        var parentBtn = sendSvg.closest('[role="button"]');
        if (parentBtn) {
          parentBtn.click();
          return;
        }
      }
      dispatchEnter(input);
    },
  });
}

/**
 * X (Twitter) 私信输入框（textarea）：拦截 Enter，翻译后写入并点击发送。
 * @param {{ translate: function, log: function }} ot
 */
function twitterTranslationInput(ot) {
  var bound = new WeakSet();
  var sending = false;

  function findInput() {
    return (
      document.querySelector('textarea[data-testid="dm-composer-textarea"]') ||
      document.querySelector('textarea[placeholder="Message"]') ||
      document.querySelector('textarea[placeholder^="Message"]')
    );
  }

  function getText(el) {
    return (el.value || "").trim();
  }

  function setText(el, text) {
    el.focus();
    var descriptor = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    );
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, text);
    } else {
      el.value = text;
    }
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text,
      }),
    );
  }

  function dispatchEnter(el) {
    var opts = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  function triggerSend() {
    var btn = document.querySelector(
      'button[data-testid="dm-composer-send-button"]',
    );
    if (btn && !btn.disabled) {
      btn.click();
      return true;
    }
    return false;
  }

  function sendTranslated(input, text) {
    sending = true;
    setText(input, text);
    setTimeout(function () {
      if (!triggerSend()) dispatchEnter(input);
      setTimeout(function () {
        sending = false;
      }, 300);
    }, 80);
  }

  function onKeyDown(e) {
    if (shouldSkipComposeAutoTranslate()) return;
    if (sending) return;
    if (
      e.key !== "Enter" ||
      e.shiftKey ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      e.isComposing
    )
      return;

    var input = e.currentTarget;
    var text = getText(input);
    if (!text) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    ot.log("[Twitter] 翻译输入: " + text, null, "debug");
    ot.translate(text, "send")
      .then(function (res) {
        ot.log("[Twitter] 输入翻译结果: " + res, null, "debug");
        sendTranslated(input, res);
      })
      .catch(function (err) {
        ot.log("[Twitter] 输入翻译失败: " + String(err), null, "warn");
        sendTranslated(input, text);
      });
  }

  function bindInput(input) {
    if (!input || bound.has(input)) return;
    bound.add(input);
    input.addEventListener("keydown", onKeyDown, true);
  }

  function tryBind() {
    bindInput(findInput());
  }

  registerOmniCompose({
    fill: function (text) {
      var input = findInput();
      if (!input) return false;
      setText(input, text);
      return true;
    },
    send: function (text) {
      var input = findInput();
      if (!input) return false;
      sendTranslated(input, text);
      return true;
    },
  });

  (async function run() {
    ot.log("[OmniTranslate] 等待 Twitter/X 私信输入框...", null, "info");
    while (!findInput()) {
      await new Promise(function (r) {
        setTimeout(r, 200);
      });
    }
    ot.log("[OmniTranslate] Twitter/X 输入框已就绪，启用发送前翻译", null, "info");
    tryBind();
    new MutationObserver(tryBind).observe(document.body, {
      childList: true,
      subtree: true,
    });
  })();
}

/**
 * LinkedIn 私信输入框：拦截 Enter，翻译后替换文本并点击发送。
 * @param {{ translate: function, log: function }} ot
 */
function linkedinTranslationInput(ot) {
  var bound = new WeakSet();
  var sending = false;

  function findInput() {
    return (
      document.querySelector(
        ".msg-form__contenteditable[contenteditable='true'][role='textbox']"
      ) ||
      document.querySelector('[aria-label="写消息…"][contenteditable="true"]') ||
      document.querySelector('[aria-label^="写消息"][contenteditable="true"]') ||
      document.querySelector('[aria-label="Write a message…"][contenteditable="true"]') ||
      document.querySelector('[aria-label^="Write a message"][contenteditable="true"]') ||
      document.querySelector(".msg-form__contenteditable[contenteditable='true']")
    );
  }

  function getText(el) {
    return (el.innerText || el.textContent || "").trim();
  }

  function setText(el, text) {
    el.focus();
    while (el.firstChild) el.removeChild(el.firstChild);
    var p = document.createElement("p");
    p.textContent = text;
    el.appendChild(p);
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text,
      })
    );
  }

  function dispatchEnter(el) {
    var opts = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  function triggerSend() {
    var btn =
      document.querySelector("button.msg-form__send-button") ||
      document.querySelector('button.msg-form__send-button[type="submit"]');
    if (btn && !btn.disabled) {
      btn.click();
      return true;
    }
    return false;
  }

  function sendTranslated(input, text) {
    sending = true;
    setText(input, text);
    setTimeout(function () {
      if (!triggerSend()) dispatchEnter(input);
      setTimeout(function () {
        sending = false;
      }, 300);
    }, 80);
  }

  function onKeyDown(e) {
    if (shouldSkipComposeAutoTranslate()) return;
    if (sending) return;
    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;

    var input = e.currentTarget;
    var text = getText(input);
    if (!text) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    ot.translate(text, "send")
      .then(function (res) {
        sendTranslated(input, res);
      })
      .catch(function () {
        sendTranslated(input, text);
      });
  }

  function bindInput(input) {
    if (!input || bound.has(input)) return;
    bound.add(input);
    input.addEventListener("keydown", onKeyDown, true);
  }

  function tryBind() {
    bindInput(findInput());
  }

  registerOmniCompose({
    fill: function (text) {
      var input = findInput();
      if (!input) return false;
      setText(input, text);
      return true;
    },
    send: function (text) {
      var input = findInput();
      if (!input) return false;
      sendTranslated(input, text);
      return true;
    },
  });

  (async function run() {
    while (!findInput()) {
      await new Promise(function (r) {
        setTimeout(r, 200);
      });
    }
    tryBind();
    new MutationObserver(tryBind).observe(document.body, { childList: true, subtree: true });
  })();
}

/**
 * 从 Telegram 消息泡提取正文（排除 .time 区域与 tgico 私用区字符）
 */
function extractTelegramMessageText(messageElement) {
  var TIME = /^\d{1,2}:\d{2}$/;
  var PUA = /[\uE000-\uF8FF]/g;

  function plain(s) {
    return (s || "").replace(PUA, "").replace(/\s+/g, " ").trim();
  }

  function inTimeArea(node) {
    var el = node.parentElement;
    return el && el.closest(".time, .time-inner, .message-time, .clearfix");
  }

  var walk = document.createTreeWalker(messageElement, NodeFilter.SHOW_TEXT, null);
  var n;
  while ((n = walk.nextNode())) {
    if (inTimeArea(n)) continue;
    var t = plain(n.nodeValue);
    if (!t || TIME.test(t)) continue;
    if (t.indexOf(SEPARATOR) !== -1) t = plain(t.split(SEPARATOR)[0]);
    return t;
  }
  return "";
}

/** 去掉译文中误入的时间（如 innerText 曾带上 20:24） */
function stripTimeFromTranslation(text) {
  var TIME = /^\d{1,2}:\d{2}$/;
  var PUA = /[\uE000-\uF8FF]/g;
  return (text || "")
    .replace(PUA, "")
    .split("\n")
    .map(function (line) {
      return line.replace(/\s+\d{1,2}:\d{2}\s*$/g, "").trim();
    })
    .filter(function (line) {
      return line && !TIME.test(line);
    })
    .join("\n")
    .trim();
}

/**
 * 精确替换 Telegram 消息中的文本内容，保留时间戳等子元素
 * @param {HTMLElement} messageElement - 传入的根元素 (div.message)
 * @param {string} translationText - 翻译后的文本，例如 '你好'
 */
function appendTranslationToTextNode(messageElement, translationText) {
  if (!messageElement || !translationText) return false;

  var original = extractTelegramMessageText(messageElement);
  translationText = stripTimeFromTranslation(translationText);
  if (!original || !translationText || original.indexOf(translationText) !== -1) return false;

  var timeEl = messageElement.querySelector(".time");
  var clearfix = messageElement.querySelector(".clearfix");
  var timeClone = timeEl ? timeEl.cloneNode(true) : null;
  var clearfixClone = clearfix ? clearfix.cloneNode(true) : null;

  while (messageElement.firstChild) {
    messageElement.removeChild(messageElement.firstChild);
  }

  messageElement.style.whiteSpace = "pre-wrap";
  messageElement.appendChild(
    document.createTextNode(original + "\n" + SEPARATOR + "\n" + translationText)
  );
  if (timeClone) messageElement.appendChild(timeClone);
  if (clearfixClone) messageElement.appendChild(clearfixClone);

  return true;
}

/**
 * 判断气泡是否为自己发出（用于接收翻译轮询：己方消息不能标成 receive）。
 * @param {Element|null} el 消息节点
 * @returns {boolean}
 */
function isOutgoingChatBubble(el) {
  if (!el || !el.closest) return false;
  try {
    if (
      el.closest(
        [
          ".message-out",
          ".is-out",
          ".Bubble.is-out",
          ".bubble-out",
          ".message.is-out",
          ".message.own",
          ".own",
          "[class*='messageOwn']",
          "[class*='MessageOwn']",
          "[class*='ownMessage']",
          "[class*='isMine']",
          "[class*='Outgoing']",
          "[class*='outgoing']",
          "[class*='mdRGT07Own']",
          "[class*='message-module__message--right']",
          "[class*='Message__right']",
          "[class*='chatBubbleOwn']",
          "[class*='--own']",
          "[class*='--right']",
          "[data-testid='message-own']",
          "[data-qa='message-out']",
        ].join(", "),
      )
    ) {
      return true;
    }
    // WhatsApp 等：向上找 data-id（true_ 开头=己方）与已读勾
    var walk = el;
    for (var depth = 0; depth < 16 && walk; depth++, walk = walk.parentElement) {
      var dataId = walk.getAttribute && walk.getAttribute("data-id");
      if (dataId && /^true[_-]/.test(String(dataId))) return true;
      var cls = String(walk.className || "");
      if (
        /\bmessage-out\b|\bis-out\b|\boutgoing\b|\bown\b|mdRGT07Own|--right|--own/i.test(
          cls,
        )
      ) {
        return true;
      }
      if (
        walk.querySelector &&
        walk.querySelector(
          '[data-icon="msg-check"], [data-icon="msg-dblcheck"], [data-icon="msg-dblcheck-ack"], [data-icon="status-check"], [data-icon="status-dblcheck"], span[data-icon="msg-check"], span[data-icon="msg-dblcheck"]',
        )
      ) {
        // 勾选图标只在消息行容器内才可信
        if (
          walk.getAttribute("data-testid") === "msg-container" ||
          (dataId && String(dataId).length > 5) ||
          /\bmessage\b/i.test(cls)
        ) {
          return true;
        }
      }
    }
    var row =
      el.closest('[data-testid="msg-container"]') ||
      el.closest("[data-id]") ||
      el.closest('[role="row"]') ||
      el.closest(".message") ||
      el.closest("[class*='message-module__message']") ||
      el.parentElement;
    if (row) {
      var rowId =
        row.getAttribute("data-id") ||
        (row.querySelector && row.querySelector("[data-id]")
          ? row.querySelector("[data-id]").getAttribute("data-id")
          : "");
      if (rowId && /^true[_-]/.test(String(rowId))) return true;
    }
    // 各平台：靠右对齐 / aria 文案
    var p = el;
    for (var i = 0; i < 12 && p; i++, p = p.parentElement) {
      var al = String((p.getAttribute && p.getAttribute("aria-label")) || "");
      if (
        /你发送了|You sent|已傳送|已发送|Sent by you|You:|我傳送|自分が送信/i.test(
          al,
        )
      ) {
        return true;
      }
      try {
        var st = window.getComputedStyle(p);
        if (
          st &&
          (st.justifyContent === "flex-end" ||
            st.alignSelf === "flex-end" ||
            st.alignItems === "flex-end")
        ) {
          if (p.clientWidth > 40 && p.clientWidth < window.innerWidth * 0.9) {
            return true;
          }
        }
      } catch (_) {}
    }
  } catch (_) {}
  return false;
}

/**
 * 接收轮询是否应跳过（己方气泡 / 刚发出原文 / 非聊天噪声）。
 * @param {Element|null} message
 * @param {string} text
 * @returns {boolean}
 */
function shouldSkipReceiveSync(message, text) {
  if (isNonChatNoiseText(text)) return true;
  if (isRecentlyOutgoingText(text)) return true;
  if (isOutgoingChatBubble(message)) return true;
  return false;
}

/**
 * 己方气泡补双语：译文用接收侧语言（默认中文），上报方向仍是「发出」。
 * 翻译请求本身会把原文和译文写入后台，不再另走 reportMessage，避免把方向改成收到。
 * @param {{ translate?: function }} ot
 * @param {Element} message 气泡节点
 * @param {string} text 气泡原文
 * @param {(el: Element, translated: string) => void} [writeTranslation] 把译文画到页面上；默认插在气泡后面
 * @returns {void}
 */
function handleOutgoingBubbleForSync(ot, message, text, writeTranslation) {
  try {
    if (!message || !text) return;
    if (message.getAttribute("data-omni-out-bilingual") === "1") return;
    message.setAttribute("data-omni-out-bilingual", "1");
    if (!ot || typeof ot.translate !== "function") return;
    var write =
      writeTranslation ||
      function (el, translated) {
        cloneAndInsertAfter(el, "\n" + SEPARATOR + "\n" + translated);
      };
    ot.translate(text, "send", { targetSide: "receive" })
      .then(function (res) {
        write(message, res);
      })
      .catch(function (err) {
        write(message, String(err));
      });
  } catch (_) {}
}

/**
 * 通用接收翻译轮询（对齐海王各 preload 的 forEach + translate 流程）
 * cfg: { tag, interval?, findMessages(): NodeList|Array, getText?(el), insertTarget?(el) }
 */
function startPollReceiveTranslation(ot, cfg) {
  var tag = cfg.tag || "App";
  var interval = cfg.interval || 120;
  ot.log("[OmniTranslate] 启动 " + tag + " 自动翻译", null, "info");
  (async function loop() {
    while (true) {
      await new Promise(function (r) {
        setTimeout(r, interval);
      });
      try {
        var nodes = cfg.findMessages();
        if (!nodes || !nodes.length) continue;
        Array.prototype.forEach.call(nodes, function (message) {
          if (!message || message.getAttribute("data-omni-translate-state") === "ok") return;
          if (message.getAttribute("data-omni-translation") === "1") return;
          var text = cfg.getText
            ? cfg.getText(message)
            : (message.innerText || message.textContent || "").trim();
          if (!text) {
            message.setAttribute("data-omni-translate-state", "ok");
            return;
          }
          if (shouldSkipReceiveSync(message, text)) {
            message.setAttribute("data-omni-translate-state", "ok");
            if (isOutgoingChatBubble(message) || isRecentlyOutgoingText(text)) {
              handleOutgoingBubbleForSync(ot, message, text);
            }
            return;
          }
          ot.log("[" + tag + "] 翻译消息: " + text, null, "debug");
          ot.translate(text, "receive")
            .then(function (res) {
              var target = cfg.insertTarget ? cfg.insertTarget(message) : message;
              var cloned = cloneAndInsertAfter(
                target,
                "\n" + SEPARATOR + "\n" + res,
              );
              if (cloned) {
                cloned.setAttribute("data-omni-translate-state", "ok");
                cloned.setAttribute("data-omni-translation", "1");
              }
            })
            .catch(function (err) {
              ot.log("[" + tag + "] 翻译失败: " + String(err), null, "warn");
              var target = cfg.insertTarget ? cfg.insertTarget(message) : message;
              var cloned = cloneAndInsertAfter(
                target,
                "\n" + SEPARATOR + "\n" + String(err),
              );
              if (cloned) cloned.setAttribute("data-omni-translation", "1");
            });
          message.setAttribute("data-omni-translate-state", "ok");
        });
      } catch (e) {
        /* ignore DOM churn */
      }
    }
  })();
}

/**
 * 通用发送前翻译：textarea / input / contenteditable
 * cfg: { tag, findInput, getText?, setText?, findSendButton?, mode?: 'value'|'contenteditable' }
 */
function createSimpleComposeTranslationInput(ot, cfg) {
  var tag = cfg.tag || "App";
  var bound = new WeakSet();
  var sending = false;
  var mode = cfg.mode || "value";

  function findInput() {
    return cfg.findInput();
  }

  function getText(el) {
    if (cfg.getText) return cfg.getText(el);
    if (mode === "contenteditable") {
      return (el.innerText || el.textContent || "").trim();
    }
    return (el.value || "").trim();
  }

  function setText(el, text) {
    if (cfg.setText) {
      cfg.setText(el, text);
      return;
    }
    el.focus();
    if (mode === "contenteditable") {
      el.textContent = "";
      el.focus();
      try {
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, text);
      } catch (_) {
        el.textContent = text;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
      }
      return;
    }
    var proto =
      el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    var descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && descriptor.set) descriptor.set.call(el, text);
    else el.value = text;
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text,
      }),
    );
  }

  function dispatchEnter(el) {
    var opts = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keypress", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  function triggerSend(input) {
    if (cfg.findSendButton) {
      var btn = cfg.findSendButton(input);
      if (btn) {
        btn.click();
        return true;
      }
    }
    dispatchEnter(input);
    return false;
  }

  function sendTranslated(input, text) {
    sending = true;
    setText(input, text);
    setTimeout(function () {
      triggerSend(input);
      setTimeout(function () {
        sending = false;
      }, 350);
    }, 80);
  }

  function onKeyDown(e) {
    if (shouldSkipComposeAutoTranslate()) return;
    if (sending) return;
    if (
      e.key !== "Enter" ||
      e.shiftKey ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      e.isComposing
    ) {
      return;
    }
    var input = e.currentTarget;
    var text = getText(input);
    if (!text) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    ot.log("[" + tag + "] 翻译输入: " + text, null, "debug");
    ot.translate(text, "send")
      .then(function (res) {
        ot.log("[" + tag + "] 输入翻译结果: " + res, null, "debug");
        sendTranslated(input, res);
      })
      .catch(function (err) {
        ot.log("[" + tag + "] 输入翻译失败: " + String(err), null, "warn");
        sendTranslated(input, text);
      });
  }

  function tryBind() {
    var input = findInput();
    if (!input || bound.has(input)) return;
    bound.add(input);
    input.addEventListener("keydown", onKeyDown, true);
    ot.log("[OmniTranslate] " + tag + " 输入框已绑定发送前翻译", null, "info");
  }

  registerOmniCompose({
    fill: function (text) {
      var input = findInput();
      if (!input) return false;
      setText(input, text);
      return true;
    },
    send: function (text) {
      var input = findInput();
      if (!input) return false;
      sendTranslated(input, text);
      return true;
    },
  });

  (async function waitBind() {
    while (!findInput()) {
      await new Promise(function (r) {
        setTimeout(r, 250);
      });
    }
    tryBind();
    new MutationObserver(tryBind).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  })();
}

function checkGenericTitleUnread(ot, tag) {
  startUnreadPoll(ot, function () {
    var title = document.title || "";
    // 仅认标题里的未读数字，避免普通括号/文案误闪
    var count = parseUnreadCountFromTitle(title);
    return {
      active: count > 0,
      title: title,
      count: count,
      tag: tag,
    };
  });
}

/* ─── 海王渠道：Zalo / Discord / Skype / … ─── */

/** Zalo Web（chat.zalo.me）未读：会话列表角标 + 消息 Tab 红点（标题通常不变） */
function countZaloUnreadBadges() {
  var total = 0;
  var seen = typeof WeakSet !== "undefined" ? new WeakSet() : null;

  function addFromText(t) {
    t = String(t || "").trim();
    if (!t) return;
    if (/^\d{1,4}\+?$/.test(t)) {
      var n = parseInt(t.replace(/\D/g, ""), 10);
      if (Number.isFinite(n) && n > 0) total += n;
      else total += 1;
      return;
    }
    if (/^N$|^9\+$|^99\+$/i.test(t)) total += 9;
  }

  function consider(el) {
    if (!el || (seen && seen.has(el))) return;
    if (seen) seen.add(el);
    try {
      if (el.offsetParent === null && el.getClientRects().length === 0) return;
    } catch (_) {
      /* ignore */
    }
    addFromText(el.textContent);
  }

  // 会话行未读（ZaDark / 现行 Web）
  document
    .querySelectorAll(
      ".conv-unread, .conv-action__unread, .conv-action__unread-v2, .conv--unreadMark, #conversationListId .msg-item [class*='unread'], #conversationListId .msg-item .truncate-number",
    )
    .forEach(consider);

  // 底部/侧栏消息 Tab 红点图：message_notification_3.png / _more.png
  try {
    var tab = document.getElementById("message-tab");
    var img =
      (tab && tab.querySelector(".tab-red-dot, img[src*='message_notification']")) ||
      document.querySelector("#message-tab img[src*='message_notification'], .tab-red-dot img, img.tab-red-dot");
    if (img) {
      var src = String(img.getAttribute("src") || "");
      var m = src.match(/message_notification_([^./]+)/i);
      if (m) {
        if (/more/i.test(m[1])) total = Math.max(total, 5);
        else {
          var tn = parseInt(m[1], 10);
          if (Number.isFinite(tn) && tn > 0) total = Math.max(total, tn);
          else total = Math.max(total, 1);
        }
      } else {
        total = Math.max(total, 1);
      }
    }
  } catch (_) {
    /* ignore */
  }

  // 标题兜底
  var fromTitle = parseUnreadCountFromTitle(document.title || "");
  if (fromTitle > 0) total = Math.max(total, fromTitle);

  return total;
}

function checkZaloNewMessage(ot) {
  startUnreadPoll(ot, function () {
    var count = 0;
    try {
      count = countZaloUnreadBadges();
    } catch (_) {
      count = 0;
    }
    var title = document.title || "";
    var active = count > 0;
    return { active: active, title: title, count: active ? count : 0 };
  });
}

function startZaloTranslation(ot) {
  startPollReceiveTranslation(ot, {
    tag: "Zalo",
    findMessages: function () {
      var out = [];
      document.querySelectorAll(".chat-message").forEach(function (msg) {
        var t = msg.querySelector('div[data-component="message-text-content"]');
        if (t) out.push(t);
      });
      return out;
    },
  });
}

function zaloTranslationInput(ot) {
  createSimpleComposeTranslationInput(ot, {
    tag: "Zalo",
    mode: "contenteditable",
    findInput: function () {
      return (
        document.querySelector("#richInput") ||
        document.querySelector("#chatInput") ||
        document.querySelector('[contenteditable="true"]#richInput')
      );
    },
    findSendButton: function () {
      return (
        document.querySelector(".send-btn-chatbar") ||
        document.querySelector('div[icon="Sent-msg_24_Line"]')
      );
    },
  });
}

function startDiscordTranslation(ot) {
  startPollReceiveTranslation(ot, {
    tag: "Discord",
    findMessages: function () {
      return document.querySelectorAll("div[id^=message-content]");
    },
  });
}

function discordTranslationInput(ot) {
  createSimpleComposeTranslationInput(ot, {
    tag: "Discord",
    mode: "contenteditable",
    findInput: function () {
      return document.querySelector('[role="textbox"]');
    },
    setText: function (el, text) {
      el.focus();
      try {
        var sel = window.getSelection();
        var range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
        var dt = new DataTransfer();
        dt.setData("text/plain", text);
        el.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: dt,
            bubbles: true,
            cancelable: true,
          }),
        );
      } catch (_) {
        el.textContent = text;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
      }
    },
    findSendButton: function () {
      var svg = document.querySelector("svg[class^=sendIcon]");
      return svg ? svg.closest("button") || svg.parentElement : null;
    },
  });
}

function startSkypeTranslation(ot) {
  startPollReceiveTranslation(ot, {
    tag: "Skype",
    findMessages: function () {
      return document.querySelectorAll(
        "[data-testid=message-wrapper] [data-mid] [id]",
      );
    },
  });
}

function skypeTranslationInput(ot) {
  createSimpleComposeTranslationInput(ot, {
    tag: "Skype",
    mode: "contenteditable",
    findInput: function () {
      return document.querySelector("[id^=new-message]");
    },
    setText: function (el, text) {
      el.focus();
      try {
        var fiberKey = Object.keys(el).find(function (k) {
          return k.indexOf("__reactFiber") === 0 || k.indexOf("__reactInternalInstance") === 0;
        });
        var fiber = fiberKey ? el[fiberKey] : null;
        var node = fiber;
        for (var i = 0; node && i < 40; i++) {
          if (node.stateNode && node.stateNode.ckeditorInstance) {
            node.stateNode.ckeditorInstance.setData(text);
            return;
          }
          node = node.return;
        }
      } catch (_) {
        /* fall through */
      }
      el.innerText = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
    },
    findSendButton: function () {
      return (
        document.querySelector('[data-tid="newMessageCommands-send"]') ||
        document.querySelector('[data-tid="sendMessageCommands-send"]')
      );
    },
  });
}

function startSnapchatTranslation(ot) {
  startPollReceiveTranslation(ot, {
    tag: "Snapchat",
    findMessages: function () {
      return document.querySelectorAll(
        '[role="presentation"] ul ul li div div span',
      );
    },
  });
}

function snapchatTranslationInput(ot) {
  createSimpleComposeTranslationInput(ot, {
    tag: "Snapchat",
    mode: "contenteditable",
    findInput: function () {
      var hosts = document.querySelectorAll('[role="presentation"] > div > div');
      for (var i = 0; i < hosts.length; i++) {
        var tb = hosts[i].querySelector('[role="textbox"]');
        if (tb) return tb;
      }
      return document.querySelector('[role="textbox"]');
    },
    findSendButton: function (input) {
      return input && input.nextElementSibling
        ? input.nextElementSibling
        : null;
    },
  });
}

function startGoogleChatTranslation(ot) {
  startPollReceiveTranslation(ot, {
    tag: "GoogleChat",
    findMessages: function () {
      return document.querySelectorAll('[jscontroller="LKRZMd"]');
    },
    getText: function (el) {
      var t = "";
      el.childNodes.forEach(function (n) {
        if (n.nodeType === Node.TEXT_NODE) t += n.textContent || "";
      });
      t = t.trim();
      if (!t) t = (el.innerText || el.textContent || "").trim();
      return t;
    },
  });
}

function googleChatTranslationInput(ot) {
  createSimpleComposeTranslationInput(ot, {
    tag: "GoogleChat",
    mode: "contenteditable",
    findInput: function () {
      return document.querySelector('[role="textbox"]');
    },
    findSendButton: function () {
      return document.querySelector('[jsname="GBTyxb"]');
    },
  });
}

function startGoogleVoiceTranslation(ot) {
  startPollReceiveTranslation(ot, {
    tag: "GoogleVoice",
    findMessages: function () {
      var out = [];
      document
        .querySelectorAll(".messages-container .message-row")
        .forEach(function (row) {
          var ann = row.querySelector(
            ".subject-content-container > gv-annotation",
          );
          if (ann) out.push(ann);
          else out.push(row);
        });
      return out;
    },
  });
}

function googleVoiceTranslationInput(ot) {
  createSimpleComposeTranslationInput(ot, {
    tag: "GoogleVoice",
    mode: "value",
    findInput: function () {
      return document.querySelector(".message-input");
    },
    findSendButton: function () {
      return document.querySelector(
        "gv-message-entry-ng2 .dense-icon-button-container:last-child button",
      );
    },
  });
}

function startBotimTranslation(ot) {
  startPollReceiveTranslation(ot, {
    tag: "Botim",
    findMessages: function () {
      var out = [];
      document.querySelectorAll(".msg-list > .bot-message").forEach(function (msg) {
        var t = msg.querySelector(".chat-text-label");
        if (t) out.push(t);
      });
      return out;
    },
  });
}

function botimTranslationInput(ot) {
  createSimpleComposeTranslationInput(ot, {
    tag: "Botim",
    mode: "value",
    findInput: function () {
      return document.querySelector(".message-input");
    },
    findSendButton: function () {
      return document.querySelector(".footer > .container button:not(.btn--flat)");
    },
  });
}

function startLineBusinessTranslation(ot) {
  startPollReceiveTranslation(ot, {
    tag: "LineBusiness",
    findMessages: function () {
      return document.querySelectorAll(".chat-item-text");
    },
  });
}

function lineBusinessTranslationInput(ot) {
  createSimpleComposeTranslationInput(ot, {
    tag: "LineBusiness",
    mode: "value",
    findInput: function () {
      return document.querySelector("#editor");
    },
    setText: function (el, text) {
      el.focus();
      try {
        if (el._host && "value" in el._host) {
          el._host.value = text;
        }
      } catch (_) {
        /* ignore */
      }
      el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    findSendButton: function () {
      return document.querySelector(
        "#editable-unit input[type=submit].btn",
      );
    },
  });
}

function startLineWorksTranslation(ot) {
  startPollReceiveTranslation(ot, {
    tag: "LineWorks",
    findMessages: function () {
      var out = [];
      document.querySelectorAll(".msg_box").forEach(function (box) {
        var msg = box.querySelector(".msg");
        if (msg) out.push(msg);
      });
      return out;
    },
  });
}

function lineWorksTranslationInput(ot) {
  createSimpleComposeTranslationInput(ot, {
    tag: "LineWorks",
    mode: "contenteditable",
    findInput: function () {
      return document.querySelector("#message-input");
    },
  });
}

function startTinderTranslation(ot) {
  startPollReceiveTranslation(ot, {
    tag: "Tinder",
    findMessages: function () {
      var out = [];
      document.querySelectorAll(".chat .msg").forEach(function (msg) {
        var t = msg.querySelector("span[id] .text") || msg.querySelector(".text");
        if (t) out.push(t);
      });
      return out;
    },
  });
}

function tinderTranslationInput(ot) {
  createSimpleComposeTranslationInput(ot, {
    tag: "Tinder",
    mode: "value",
    findInput: function () {
      return document.querySelector(".chat textarea");
    },
    setText: function (el, text) {
      el.focus();
      var descriptor = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      );
      if (descriptor && descriptor.set) descriptor.set.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      try {
        var fiberKey = Object.keys(el).find(function (k) {
          return k.indexOf("__reactProps") === 0 || k.indexOf("__reactEventHandlers") === 0;
        });
        var props = fiberKey ? el[fiberKey] : null;
        if (props && typeof props.onChange === "function") {
          props.onChange({ target: el, currentTarget: el });
        }
      } catch (_) {
        /* ignore */
      }
    },
    findSendButton: function () {
      return document.querySelector('.chat form button[type="submit"]');
    },
  });
}

function startMetaBusinessTranslation(ot) {
  startPollReceiveTranslation(ot, {
    tag: "MetaBusiness",
    findMessages: function () {
      var out = [];
      document
        .querySelectorAll('[data-scope="messages_table"] div[dir="auto"]')
        .forEach(function (el) {
          out.push(el);
        });
      if (!out.length) {
        document
          .querySelectorAll(
            'div[data-pagelet="BizInboxDetailSectionWrapper"] div[dir="auto"]',
          )
          .forEach(function (el) {
            out.push(el);
          });
      }
      return out;
    },
  });
}

function metaBusinessTranslationInput(ot) {
  createLexicalComposeTranslationInput(ot, {
    tag: "MetaBusiness",
    findInput: function () {
      return document.querySelector(
        'div[data-pagelet="BizInboxDetailSectionWrapper"] div[role="textbox"]',
      );
    },
    triggerSend: function (input, dispatchEnter) {
      var root = document.querySelector(
        'div[data-pagelet="BizInboxDetailSectionWrapper"]',
      );
      var buttons = root
        ? root.querySelectorAll('div[role="button"]')
        : [];
      if (buttons.length) {
        buttons[buttons.length - 1].click();
        return;
      }
      dispatchEnter(input);
    },
  });
}

/**
 * 复制目标元素，替换其文本内容，并插入到其后方作为兄弟元素
 * @param element 目标网页元素
 * @param newText 要替换的新文本
 * @returns 返回新创建的克隆元素，若失败则返回 null
 */
function cloneAndInsertAfter(element, newText) {
  if (!element || !element.parentNode) {
    console.warn("元素无效或没有父级节点，无法插入兄弟元素");
    return null;
  }

  var clonedElement = element.cloneNode(true);
  if (clonedElement.id) {
    clonedElement.removeAttribute("id");
  }

  // WhatsApp 等平台：克隆若仍带 data-testid="selectable-text" 会被翻译轮询再次扫到，
  // 形成无限克隆风暴，导致会话 DOM 崩坏（收不到消息气泡 / 发不出消息）。
  try {
    clonedElement.removeAttribute("data-testid");
    if (clonedElement.querySelectorAll) {
      clonedElement.querySelectorAll("[data-testid]").forEach(function (n) {
        n.removeAttribute("data-testid");
      });
    }
  } catch (_) {
    /* ignore */
  }
  clonedElement.setAttribute("data-omni-translation", "1");
  clonedElement.setAttribute("data-omni-translate-state", "ok");

  clonedElement.textContent = "";
  var lines = String(newText).split("\n");
  for (var i = 0; i < lines.length; i++) {
    if (i > 0) clonedElement.appendChild(document.createElement("br"));
    clonedElement.appendChild(document.createTextNode(lines[i]));
  }
  clonedElement.style.opacity = "0.85";
  clonedElement.style.marginTop = "4px";
  element.parentNode.insertBefore(clonedElement, element.nextSibling);

  return clonedElement;
}

/**
 * 往 Telegram 消息元素中优雅地插入翻译文本（纯 JS 版）
 * @param {HTMLElement} messageElement 
 * @param {string} translatedText 
 * @param {Object} options 
 */
function injectTranslation(messageElement, translatedText, options = {}) {
  // 1. 防御性检查：确保找到了核心的文本容器
  const textContentZone = messageElement.querySelector('.text-content');
  const contentInner = messageElement.querySelector('.content-inner');

  if (!textContentZone || !contentInner) {
    console.warn('未找到有效的文本容器，无法注入翻译');
    return false;
  }

  // 2. 幂等性检查：防止重复注入翻译
  const className = options.className || 'custom-translation-text';
  if (contentInner.querySelector(`.${className}`)) {
    return false;
  }

  // 3. 创建翻译文本的容器
  const translationDiv = document.createElement('div');
  translationDiv.classList.add(className);
  translationDiv.textContent = translatedText;

  // 4. 核心样式
  const defaultStyles = {
    marginTop: '6px',
    paddingTop: '6px',
    borderTop: `1px dashed ${options.borderColor || 'rgba(255, 255, 255, 0.15)'}`,
    fontSize: '0.9em',
    opacity: '0.85',
    color: options.textColor || 'inherit',
    wordBreak: 'break-word',
    clear: 'both'
  };

  Object.assign(translationDiv.style, defaultStyles);

  // 5. 注入到内容尾部
  contentInner.appendChild(translationDiv);

  return true;
}

/**
 * LINE 扩展消息正文提取（3.7.x：textMessageContent-module__text；旧版 mdRGT07MsgText）
 */
function extractLineMessageText(messageElement) {
  var text = (messageElement.innerText || messageElement.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (text.indexOf(SEPARATOR) !== -1) {
    text = text.split(SEPARATOR)[0].trim();
  }
  return text;
}

function checkLineWindow() {
  // Electron 里 LINE 登录会跳到 https://access.line.me / Google OAuth；
  // 不能像旧逻辑那样非扩展页一律拉回，否则永远进不了登录。
  var LINE_HOME =
    window.__OMNI_LINE_HOME__ ||
    (location.protocol === "chrome-extension:"
      ? location.origin + "/index.html"
      : "about:blank");
  setInterval(function () {
    if (location.protocol === "chrome-extension:") return;
    var href = String(location.href || "");
    if (/^https?:\/\//i.test(href)) {
      if (
        /line\.me|line-scdn\.net|naver\.|google\.|gstatic\.|accounts\.google|facebook\.|apple\.com/i.test(
          href
        )
      ) {
        return;
      }
    }
    if (!href || href === "about:blank") {
      window.location.href = LINE_HOME;
    }
  }, 2000);
}

/**
 * 统计 LINE 3.7 扩展未读角标（CSS modules 实名）。
 * gnb-module__badge = 侧栏总未读；friendlistItem-module__badge = 会话行未读。
 */
function countLineUnreadBadges() {
  var total = 0;
  var seen = new Set();

  function consider(el) {
    if (!el || seen.has(el)) return;
    seen.add(el);
    try {
      if (el.offsetParent === null && el.getClientRects().length === 0) return;
    } catch (_) {
      /* ignore */
    }
    var cls = String(el.className || "");
    if (/badge_voom|voom|profileImage|icon_badge|editButton|settingPopup|chatroomHeader/i.test(cls)) {
      return;
    }
    var t = String(el.textContent || "").trim();
    if (!t) {
      total += 1;
      return;
    }
    if (!/^\d{1,4}\+?$/.test(t)) return;
    var n = parseInt(t.replace(/\D/g, ""), 10);
    if (Number.isFinite(n) && n > 0) total += n;
  }

  var precise = [
    '[class*="friendlistItem-module__badge"]',
    '[class*="gnb-module__badge__"]',
    '[class*="badge-module__badge"]',
  ];
  for (var i = 0; i < precise.length; i++) {
    try {
      document.querySelectorAll(precise[i]).forEach(consider);
    } catch (_) {
      /* ignore */
    }
  }
  return total;
}

/**
 * LINE 未读 → 由客户端直接调系统弹窗（不依赖扩展 chrome.notifications）。
 * 角标增加 / 0→有未读 / 从查看切走时上报 source=line_unread。
 */
function checkLineNewMessage(ot) {
  var lastCount = 0;
  var wasTabActive = null;
  var timer = null;
  var scheduled = false;

  function readCount() {
    var title = document.title || "";
    var titleCount = parseUnreadCountFromTitle(title);
    var listCount = countLineUnreadBadges();
    var count = Math.max(titleCount, listCount);
    if (count <= 0 && /\(\s*\d+\s*\)/.test(title)) count = titleCount || 1;
    return count;
  }

  function pushUnread(count, reason) {
    ot.invoke("new_message", {
      active: true,
      title: document.title || "LINE",
      count: Math.max(1, count),
      source: "line_unread",
      reason: reason || "",
    }).catch(function () {});
  }

  function tick() {
    scheduled = false;
    var count = 0;
    try {
      count = readCount();
    } catch (_) {
      count = 0;
    }
    ot.invoke("is_tab_active", null)
      .then(function (res) {
        var data = res && res.data ? res.data : {};
        // 未同步时不要当成「正在看 LINE」，否则后台永远不弹
        var tabActive = data.synced === false ? false : !!(data && data.active);
        var becameHidden = wasTabActive === true && tabActive === false;
        var rose = count > lastCount;
        var appeared = lastCount <= 0 && count > 0;
        wasTabActive = tabActive;

        if (!tabActive && count > 0 && (rose || appeared || becameHidden)) {
          pushUnread(count, rose ? "rose" : appeared ? "appeared" : "hidden");
        }
        // 正在查看时同步清零意图交给主界面；这里只更新基线
        if (tabActive) {
          lastCount = count;
          return;
        }
        lastCount = count;
      })
      .catch(function () {
        if (count > lastCount || (lastCount <= 0 && count > 0)) {
          pushUnread(count, "fallback");
        }
        lastCount = count;
      });
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(tick, 80);
  }

  timer = setInterval(tick, 1000);
  try {
    new MutationObserver(schedule).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  } catch (_) {
    /* ignore */
  }
  tick();
  return function stop() {
    if (timer) clearInterval(timer);
  };
}

/**
 * 找到 LINE 输入宿主（CSS modules）及其内部 textarea（可能在 shadowRoot）
 * @returns {{ host: Element, input: Element }|null}
 */
function findLineCompose() {
  var host =
    document.querySelector(".chatroomEditor-module__textarea__yKTlH") ||
    document.querySelector('[class*="chatroomEditor-module__textarea"]') ||
    document.querySelector(
      '[class*="chatroomEditor-module__editor_area"] [class*="textarea"]',
    );
  if (host) {
    var inner =
      host.querySelector("textarea") ||
      (host.shadowRoot && host.shadowRoot.querySelector("textarea"));
    if (inner) return { host: host, input: inner };
    if (
      host.tagName === "TEXTAREA" ||
      host.getAttribute("contenteditable") === "true"
    ) {
      return { host: host, input: host };
    }
  }
  var fallback =
    document.querySelector('textarea[placeholder*="message" i]') ||
    document.querySelector('textarea[placeholder*="消息" i]') ||
    document.querySelector('textarea[placeholder*="訊息" i]') ||
    document.querySelector("#editor [contenteditable='true']") ||
    document.querySelector("[contenteditable='true'][role='textbox']");
  if (fallback) return { host: fallback, input: fallback };
  return null;
}

/**
 * LINE Chrome 扩展发送前翻译（对齐 WhatsApp：拦截 Enter → 翻译 → 写回 → 发送）
 * 输入框为 chatroomEditor textarea-ex，需穿透 shadow DOM。
 * @param {{ translate: function, log: function }} ot
 */
function lineTranslationInput(ot) {
  var bound = new WeakSet();
  var sending = false;

  function findSendButton() {
    return (
      document.querySelector('[aria-label="Send"]') ||
      document.querySelector('[aria-label="发送"]') ||
      document.querySelector('[aria-label="傳送"]') ||
      document.querySelector('[aria-label="送出"]') ||
      document.querySelector('button[class*="send" i]:not([class*="sendFile"])')
    );
  }

  function readText(input) {
    if (!input) return "";
    if (input.tagName === "TEXTAREA" || input.tagName === "INPUT") {
      return String(input.value || "").trim();
    }
    return String(input.innerText || input.textContent || "").trim();
  }

  function writeText(input, text) {
    if (!input) return;
    input.focus();
    if (input.tagName === "TEXTAREA" || input.tagName === "INPUT") {
      try {
        var proto =
          input.tagName === "TEXTAREA"
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        var desc = Object.getOwnPropertyDescriptor(proto, "value");
        if (desc && desc.set) desc.set.call(input, text);
        else input.value = text;
      } catch (_) {
        input.value = text;
      }
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      input.dispatchEvent(
        new InputEvent("input", { bubbles: true, composed: true, data: text }),
      );
      return;
    }
    input.textContent = text;
    input.dispatchEvent(
      new InputEvent("input", { bubbles: true, composed: true, data: text }),
    );
  }

  function dispatchEnter(input) {
    var opts = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    input.dispatchEvent(new KeyboardEvent("keydown", opts));
    input.dispatchEvent(new KeyboardEvent("keypress", opts));
    input.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  function sendTranslated(input, text) {
    writeText(input, text);
    sending = true;
    setTimeout(function () {
      var btn = findSendButton();
      if (btn && btn.getAttribute("aria-disabled") !== "true" && !btn.disabled) {
        btn.click();
      } else {
        dispatchEnter(input);
      }
      setTimeout(function () {
        sending = false;
      }, 400);
    }, 40);
  }

  function onKeyDown(e) {
    if (shouldSkipComposeAutoTranslate()) return;
    if (sending || e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    var input = e.target;
    if (!input || !bound.has(input)) return;
    var text = readText(input);
    if (!text) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    ot.translate(text, "send")
      .then(function (res) {
        sendTranslated(input, res);
      })
      .catch(function () {
        sendTranslated(input, text);
      });
  }

  function bindInput(input) {
    if (!input || bound.has(input)) return;
    bound.add(input);
    input.addEventListener("keydown", onKeyDown, true);
  }

  function tryBind() {
    var compose = findLineCompose();
    if (!compose) return false;
    bindInput(compose.input);
    return true;
  }

  registerOmniCompose({
    fill: function (text) {
      var compose = findLineCompose();
      if (!compose) return false;
      writeText(compose.input, text);
      return true;
    },
    send: function (text) {
      var compose = findLineCompose();
      if (!compose) return false;
      sendTranslated(compose.input, text);
      return true;
    },
  });

  (async function run() {
    ot.log("[OmniTranslate] 等待 LINE 输入框...", null, "info");
    while (!tryBind()) {
      await new Promise(function (r) {
        setTimeout(r, 300);
      });
    }
    ot.log("[OmniTranslate] LINE 输入框已就绪，启用发送前翻译", null, "info");
    new MutationObserver(function () {
      tryBind();
    }).observe(document.body, {
      childList: true,
      subtree: true,
    });
  })();
}
