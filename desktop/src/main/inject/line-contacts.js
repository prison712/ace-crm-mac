/**
 * OmniTranslate — LINE 好友 / 推荐联系人增量采集
 * 仅注入 groupId === "line" 的 BrowserView。
 * 数据源对齐海王线索统计 + 前端软件推荐人：
 *   - 好友：s.contact.entities.contacts（排除群/机器人/忽略状态）
 *   - 推荐：s.contact.recommendContactList（status 3/4 可能认识的人）
 * 增量：localStorage cache-contact-list-{myMid}；首轮灌缓存不上报。
 */
(function () {
  'use strict'

  if (window.__OMNI_LINE_CONTACTS__) return
  window.__OMNI_LINE_CONTACTS__ = true

  var INTERVAL_MS = 30_000
  var DEBOUNCE_MS = 3_000
  var START_DELAY_MS = 1_500

  function log(msg, extra) {
    try {
      if (window.__OMNI_BRIDGE__ && typeof window.__OMNI_BRIDGE__.invoke === 'function') {
        window.__OMNI_BRIDGE__.invoke('log', {
          level: 'info',
          message: '[line-contacts] ' + msg,
          extra: extra ?? null,
          href: location.href
        })
      }
    } catch (_) {
      /* ignore */
    }
    if (extra != null) console.log('[line-contacts]', msg, extra)
    else console.log('[line-contacts]', msg)
  }

  function invoke(action, payload) {
    if (window.__OMNI_BRIDGE__ && typeof window.__OMNI_BRIDGE__.invoke === 'function') {
      return window.__OMNI_BRIDGE__.invoke(action, payload)
    }
    return Promise.reject(new Error('OMNI_BRIDGE unavailable'))
  }

  function isStoreLike(obj) {
    return !!obj && typeof obj.getState === 'function' && typeof obj.dispatch === 'function'
  }

  function walkFibers(root) {
    if (!root) return null
    var stack = [root]
    var seen = new Set()
    var steps = 0
    while (stack.length && steps < 300000) {
      steps++
      var fiber = stack.pop()
      if (!fiber || seen.has(fiber)) continue
      seen.add(fiber)
      var props = fiber.memoizedProps
      if (props) {
        if (isStoreLike(props.store)) return props.store
        if (props.value && isStoreLike(props.value.store)) return props.value.store
      }
      var state = fiber.memoizedState
      if (state && state.memoizedState && isStoreLike(state.memoizedState.store)) {
        return state.memoizedState.store
      }
      if (fiber.child) stack.push(fiber.child)
      if (fiber.sibling) stack.push(fiber.sibling)
    }
    return null
  }

  function findReduxStore() {
    var nodes = document.querySelectorAll('*')
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i]
      var key = Object.keys(el).find(function (k) {
        return k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$')
      })
      if (!key) continue
      var f = el[key]
      while (f && f.return) f = f.return
      var store = walkFibers(f)
      if (store) return store
    }
    return null
  }

  function contactDisplayName(c) {
    return String(c.displayNameOverridden || c.displayName || '')
      .replace(/[\r\n\t]+/g, ' ')
      .trim()
  }

  /**
   * 海王好友过滤：跳过 type∈{5,8} 群/机器人、status∈{6}；
   * status∈{2,4} 记入忽略（不计入线索）；其余为有效好友。
   */
  function isCountableFriend(c) {
    if (!c) return false
    var type = Number(c.type)
    var status = Number(c.status)
    if (type === 5 || type === 8) return false
    if (status === 6) return false
    if (status === 2 || status === 4) return false
    return true
  }

  function readContactsFromStore() {
    var store = findReduxStore()
    if (!store) return { error: 'store_not_found' }
    var s = store.getState()
    if (!s) return { error: 'state_null' }

    var authProf = (s.auth && s.auth.profile) || {}
    var myMid = String(authProf.mid || '')
    var myName =
      authProf.displayNameOverridden || authProf.displayName || ''

    var contact = s.contact || {}
    var entities = (contact.entities && contact.entities.contacts) || {}
    var recommendIds =
      (contact.recommendContactList && contact.recommendContactList.data) || []

    var byUid = {}
    var friendCount = 0
    var recommendCount = 0

    // 1) 好友（海王 entities.contacts）
    var keys = Object.keys(entities)
    for (var i = 0; i < keys.length; i++) {
      var c = entities[keys[i]]
      if (!c || !isCountableFriend(c)) continue
      var uid = String(c.mid || keys[i] || '')
      if (!uid || uid === myMid) continue
      byUid[uid] = {
        uid: uid,
        name: contactDisplayName(c) || uid
      }
      friendCount++
    }

    // 2) 可能认识的人（status 3/4）
    for (var j = 0; j < recommendIds.length; j++) {
      var rc = entities[recommendIds[j]]
      if (!rc) continue
      if (!(rc.status === 3 || rc.status === 4)) continue
      var ruid = String(rc.mid || recommendIds[j] || '')
      if (!ruid || ruid === myMid) continue
      if (!byUid[ruid]) {
        byUid[ruid] = {
          uid: ruid,
          name: contactDisplayName(rc) || ruid
        }
        recommendCount++
      }
    }

    return {
      line_uid: myMid,
      line_name: String(myName),
      contacts: Object.keys(byUid).map(function (k) {
        return byUid[k]
      }),
      friendCount: friendCount,
      recommendCount: recommendCount
    }
  }

  function cacheKey(myMid) {
    return 'cache-contact-list-' + myMid
  }

  function loadCache(myMid) {
    try {
      var raw = localStorage.getItem(cacheKey(myMid))
      if (!raw) return null
      var parsed = JSON.parse(raw)
      if (!parsed || !Array.isArray(parsed.uids)) return null
      return parsed
    } catch (_) {
      return null
    }
  }

  function saveCache(myMid, contacts) {
    var uids = contacts.map(function (c) {
      return c.uid
    })
    var byUid = {}
    for (var i = 0; i < contacts.length; i++) {
      byUid[contacts[i].uid] = contacts[i].name || ''
    }
    try {
      localStorage.setItem(
        cacheKey(myMid),
        JSON.stringify({ uids: uids, byUid: byUid, updatedAt: Date.now() })
      )
    } catch (_) {
      /* quota */
    }
  }

  /** 已沟通 uid：hash #/chats/{id}，跳过群 c 开头 */
  var messagedSet = new Set()

  function trackMessagedFromHash() {
    try {
      var hash = location.hash || ''
      var m = hash.match(/#\/chats\/([^/?#]+)/)
      if (!m) return
      var id = decodeURIComponent(m[1])
      if (!id || id.charAt(0) === 'c') return
      messagedSet.add(id)
    } catch (_) {
      /* ignore */
    }
  }

  function diffNewContacts(all, cache) {
    if (!cache || !Array.isArray(cache.uids)) return all.slice()
    var known = new Set(cache.uids)
    return all.filter(function (c) {
      return c.uid && !known.has(c.uid)
    })
  }

  var busy = false
  var debounceTimer = null

  function tick() {
    if (busy) return
    busy = true
    try {
      trackMessagedFromHash()
      var snap = readContactsFromStore()
      if (snap.error) {
        log('skip: ' + snap.error)
        return
      }
      if (!snap.line_uid) {
        log('skip: empty line_uid (未登录?)')
        return
      }
      window.__OMNI_LINE_SELF__ = {
        uid: snap.line_uid,
        name: snap.line_name || snap.line_uid
      }

      var cache = loadCache(snap.line_uid)
      // 首轮：灌满缓存，不上报历史洪水
      if (!cache) {
        saveCache(snap.line_uid, snap.contacts)
        log('first fill cache', {
          line_uid: snap.line_uid,
          count: snap.contacts.length,
          friends: snap.friendCount,
          recommend: snap.recommendCount
        })
        return
      }

      var newcomers = diffNewContacts(snap.contacts, cache)
      if (cache.uids.length === 0 && newcomers.length > 99) {
        saveCache(snap.line_uid, snap.contacts)
        log('flood guard: skip upload', { new: newcomers.length })
        return
      }
      // 始终刷新缓存（含名称变更）
      saveCache(snap.line_uid, snap.contacts)

      var messaged_uids = Array.from(messagedSet).filter(function (uid) {
        return snap.contacts.some(function (c) {
          return c.uid === uid
        })
      })

      // 无新增且无已沟通待报：仍可上报空 contacts 以刷新 last_online；按计划只在有新增或 messaged 时上报
      if (newcomers.length === 0 && messaged_uids.length === 0) {
        log('no delta', { total: snap.contacts.length })
        return
      }

      var payload = {
        line_uid: snap.line_uid,
        line_name: snap.line_name,
        contacts: newcomers,
        messaged_uids: messaged_uids,
        platform: 'line'
      }

      log('upload delta', {
        new: newcomers.length,
        messaged: messaged_uids.length,
        totalCached: snap.contacts.length
      })

      invoke('line_contacts', payload)
        .then(function (res) {
          log('upload result', res && res.data ? res.data : res)
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

  function scheduleDebounced() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(function () {
      debounceTimer = null
      tick()
    }, DEBOUNCE_MS)
  }

  window.addEventListener('hashchange', function () {
    trackMessagedFromHash()
    scheduleDebounced()
  })

  setTimeout(function () {
    tick()
    setInterval(tick, INTERVAL_MS)
  }, START_DELAY_MS)

  log('started')
})()
