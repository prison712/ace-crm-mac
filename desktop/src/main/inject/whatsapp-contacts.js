/**
 * OmniTranslate — WhatsApp 好友增量采集（对齐海王 supportFansCount）
 * 数据源：window.Store.Chat._models（个人会话，排除广播/群）
 * 增量：localStorage cache-contact-list-{wid}；首轮灌缓存不上报
 * 上报：POST /api/upload（字段复用 line_uid / line_name）
 */
(function () {
  'use strict'

  if (window.__OMNI_WHATSAPP_CONTACTS__) return
  window.__OMNI_WHATSAPP_CONTACTS__ = true

  var INTERVAL_MS = 30_000
  var START_DELAY_MS = 1_500

  function log(msg, extra) {
    try {
      if (window.__OMNI_BRIDGE__ && typeof window.__OMNI_BRIDGE__.invoke === 'function') {
        window.__OMNI_BRIDGE__.invoke('log', {
          level: 'info',
          message: '[whatsapp-contacts] ' + msg,
          extra: extra ?? null,
          href: location.href
        })
      }
    } catch (_) {
      /* ignore */
    }
    if (extra != null) console.log('[whatsapp-contacts]', msg, extra)
    else console.log('[whatsapp-contacts]', msg)
  }

  function invoke(action, payload) {
    if (window.__OMNI_BRIDGE__ && typeof window.__OMNI_BRIDGE__.invoke === 'function') {
      return window.__OMNI_BRIDGE__.invoke(action, payload)
    }
    return Promise.reject(new Error('OMNI_BRIDGE unavailable'))
  }

  /**
   * 对齐海王：优先 require("WAWebCollections")，否则从 webpack chunk 取 Chat 模块
   */
  function ensureStore() {
    if (window.Store && window.Store.Chat) return true
    try {
      if (typeof window.require === 'function') {
        var cols = window.require('WAWebCollections')
        if (cols && cols.Chat) {
          window.Store = cols
          return true
        }
      }
    } catch (_) {
      /* ignore */
    }
    try {
      var chunk = window.webpackChunkbuild || window.webpackChunkwhatsapp_web_client
      if (!chunk || !Array.isArray(chunk)) return false
      var mid = 'omni-wa-' + Math.random().toString(36).slice(2)
      var modules = {}
      chunk.push([
        [mid],
        {},
        function (req) {
          if (!req || !req.m) return
          Object.keys(req.m).forEach(function (id) {
            try {
              modules[id] = req(id)
            } catch (_) {
              /* ignore */
            }
          })
        }
      ])
      var found = null
      Object.keys(modules).some(function (id) {
        var mod = modules[id]
        var def = mod && (mod.default || mod)
        if (def && def.Chat && def.Contact) {
          found = def
          return true
        }
        return false
      })
      if (found) {
        window.Store = found
        return true
      }
    } catch (_) {
      /* ignore */
    }
    return !!(window.Store && window.Store.Chat)
  }

  /** 本机 wid：localStorage last-wid-md */
  function getSelfWid() {
    try {
      var raw = localStorage.getItem('last-wid-md')
      if (!raw) return ''
      return String(raw)
        .replace(/"/g, '')
        .split(':')[0]
        .trim()
    } catch (_) {
      return ''
    }
  }

  function contactUserId(contact) {
    if (!contact) return ''
    try {
      if (contact.phoneNumber && contact.phoneNumber.user) {
        return String(contact.phoneNumber.user)
      }
      if (contact.id && contact.id.user) return String(contact.id.user)
    } catch (_) {
      /* ignore */
    }
    return ''
  }

  function getSelfDisplayName() {
    try {
      var Store = window.Store
      if (!Store) return ''
      var me = getSelfWid()
      var models = (Store.Contact && Store.Contact._models) || []
      for (var i = 0; i < models.length; i++) {
        var c = models[i]
        if (contactUserId(c) === me) {
          return String(c.__x_name || c.pushname || c.name || me)
        }
      }
      if (Store.Conn && Store.Conn.pushname) return String(Store.Conn.pushname)
    } catch (_) {
      /* ignore */
    }
    return ''
  }

  /**
   * 海王 getRealContactList：Chat._models
   * 排除 status@broadcast(user=0)、群(user.length>15)、自己
   */
  function readFriendList() {
    if (!ensureStore()) return { error: 'store_not_ready' }
    var Store = window.Store
    if (!Store || !Store.Chat) return { error: 'store_not_ready' }
    var self = getSelfWid()
    if (!self) return { error: 'self_wid_empty' }

    var models = Store.Chat._models || []
    var list = []
    var seen = new Set()

    for (var i = 0; i < models.length; i++) {
      var chat = models[i]
      if (!chat || !chat.id) continue
      var user = String(chat.id.user || '')
      if (!user || user === '0') continue
      if (user.length > 15) continue
      if (!chat.t) continue
      var contact = chat.contact
      if (!contact) continue
      var uid = contactUserId(contact) || user
      if (!uid || uid === self) continue
      if (seen.has(uid)) continue
      seen.add(uid)
      var name = String(contact.__x_name || contact.pushname || contact.name || uid)
        .replace(/[\r\n\t]+/g, ' ')
        .trim()
      list.push({ uid: uid, name: name })
    }

    return {
      line_uid: self,
      line_name: getSelfDisplayName() || self,
      contacts: list
    }
  }

  function cacheKey(wid) {
    return 'cache-contact-list-' + wid
  }

  function loadCache(wid) {
    try {
      var raw = localStorage.getItem(cacheKey(wid))
      if (!raw) return null
      var parsed = JSON.parse(raw)
      if (!parsed || !Array.isArray(parsed.uids)) return null
      return parsed
    } catch (_) {
      return null
    }
  }

  function saveCache(wid, contacts) {
    var uids = contacts.map(function (c) {
      return c.uid
    })
    var byUid = {}
    for (var i = 0; i < contacts.length; i++) {
      byUid[contacts[i].uid] = contacts[i].name || ''
    }
    try {
      localStorage.setItem(
        cacheKey(wid),
        JSON.stringify({ uids: uids, byUid: byUid, updatedAt: Date.now() })
      )
    } catch (_) {
      /* quota */
    }
  }

  function diffNewContacts(all, cache) {
    if (!cache || !Array.isArray(cache.uids)) return all.slice()
    var known = new Set(cache.uids)
    return all.filter(function (c) {
      return c.uid && !known.has(c.uid)
    })
  }

  /** 当前活跃聊天对方 uid */
  var messagedSet = new Set()

  function trackActiveChat() {
    try {
      if (!ensureStore()) return
      var Store = window.Store
      if (!Store) return
      var active =
        (Store.Chat &&
          Store.Chat._models &&
          Store.Chat._models.find(function (c) {
            return c.active
          })) ||
        null
      if (!active && Store.Presence && Store.Presence._models) {
        var p = Store.Presence._models.find(function (x) {
          return x.chatActive
        })
        if (p && p.id && p.id.user && String(p.id.user).length <= 15) {
          messagedSet.add(String(p.id.user))
          return
        }
      }
      if (!active || !active.id) return
      var user = String(active.id.user || '')
      if (!user || user === '0' || user.length > 15) return
      var uid = active.contact ? contactUserId(active.contact) || user : user
      if (uid && uid !== getSelfWid()) messagedSet.add(uid)
    } catch (_) {
      /* ignore */
    }
  }

  var busy = false

  function tick() {
    if (busy) return
    busy = true
    try {
      // 侧栏未就绪则跳过（对齐海王 #pane-side 门闩）
      if (!document.querySelector('#pane-side')) {
        log('skip: pane-side missing')
        return
      }

      trackActiveChat()
      var snap = readFriendList()
      if (snap.error) {
        log('skip: ' + snap.error)
        return
      }
      if (!snap.line_uid) {
        log('skip: empty wid')
        return
      }
      window.__OMNI_WA_SELF__ = {
        uid: snap.line_uid,
        name: snap.line_name || snap.line_uid
      }

      var cache = loadCache(snap.line_uid)
      if (!cache) {
        saveCache(snap.line_uid, snap.contacts)
        log('first fill cache', {
          line_uid: snap.line_uid,
          count: snap.contacts.length
        })
        return
      }

      var newcomers = diffNewContacts(snap.contacts, cache)
      // 海王防洪：空缓存已在首轮处理；若缓存异常为空且一次涌入 >99 则跳过上报
      if (cache.uids.length === 0 && newcomers.length > 99) {
        saveCache(snap.line_uid, snap.contacts)
        log('flood guard: skip upload', { new: newcomers.length })
        return
      }

      saveCache(snap.line_uid, snap.contacts)

      var messaged_uids = Array.from(messagedSet).filter(function (uid) {
        return snap.contacts.some(function (c) {
          return c.uid === uid
        })
      })

      if (newcomers.length === 0 && messaged_uids.length === 0) {
        log('no delta', { total: snap.contacts.length })
        return
      }

      var payload = {
        line_uid: snap.line_uid,
        line_name: snap.line_name,
        contacts: newcomers,
        messaged_uids: messaged_uids,
        platform: 'whatsapp'
      }

      log('upload delta', {
        new: newcomers.length,
        messaged: messaged_uids.length,
        totalCached: snap.contacts.length
      })

      invoke('whatsapp_contacts', payload)
        .then(function (res) {
          log('upload result', res && res.data ? res.data : res)
          // 已上报的 messaged 可清（后端幂等，保留亦可）
          messaged_uids.forEach(function (u) {
            messagedSet.delete(u)
          })
        })
        .catch(function (err) {
          log('upload failed: ' + String(err))
        })
    } catch (e) {
      log('tick error: ' + String(e))
    } finally {
      busy = false
    }
  }

  setTimeout(function () {
    tick()
    setInterval(tick, INTERVAL_MS)
  }, START_DELAY_MS)

  log('started')
})()
