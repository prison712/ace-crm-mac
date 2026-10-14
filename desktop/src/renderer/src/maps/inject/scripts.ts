/**
 * 注入到谷歌地图页：检测拦截、滚动列表、采集当前可见卡片，并 emit 事件。
 * Electron：依赖主进程注入的 window.__MAPS_HOST__.emit；亦兼容 Tauri。
 *
 * 详情字段选择器（Chrome 探测结论）：
 * - 电话：button[data-item-id^="phone:tel:"] 或 a[href^="tel:"]
 * - 网站：a[data-item-id="authority"]
 * - 类别：button[jsaction*="category"]（如「急救中心」「咖啡店」）
 */
export const MAPS_SCRAPER_BOOTSTRAP = `
(() => {
  if (window.__GMAPS_SCRAPER__) return true;
  window.__GMAPS_SCRAPER__ = true;

  const emit = async (event, payload) => {
    try {
      if (window.__MAPS_HOST__?.emit) {
        await window.__MAPS_HOST__.emit(event, payload);
        return;
      }
      if (window.__TAURI__?.event?.emit) {
        await window.__TAURI__.event.emit(event, payload);
      }
    } catch (err) {
      console.warn('emit failed', err);
    }
  };

  const text = (el) => (el?.textContent || '').trim();

  const cleanIconNoise = (s) =>
    (s || '')
      .replace(/[\\uE000-\\uF8FF]/g, '')
      .replace(/[·•]/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim();

  const normalizeName = (s) =>
    cleanIconNoise(s)
      .toLowerCase()
      .replace(/[\\s\\u3000]+/g, '')
      .replace(/[（(].*$/, '');

  /**
   * 名称是否对齐（防止详情面板未切换就采到上一家）。
   * @param {string} a
   * @param {string} b
   * @returns {boolean}
   */
  const namesMatch = (a, b) => {
    const na = normalizeName(a);
    const nb = normalizeName(b);
    if (!na || !nb) return false;
    return na === nb || na.includes(nb) || nb.includes(na);
  };

  /**
   * 从地图链接提取稳定地点键，去掉追踪参数差异。
   * @param {string} url
   * @returns {string}
   */
  const placeKeyFromUrl = (url) => {
    if (!url) return '';
    const id = url.match(/!1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/);
    if (id) return id[1].toLowerCase();
    const g = url.match(/[?&/]ftid=(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/i);
    if (g) return g[1].toLowerCase();
    const path = url.match(/\\/maps\\/place\\/([^/@?#]+)/);
    if (path) return decodeURIComponent(path[1]).toLowerCase();
    return url.split('&')[0];
  };

  const detectBlocker = () => {
    const body = document.body?.innerText || '';
    if (/unusual traffic|captcha|verify you.?re human|人机验证|验证码|Sign in|登录以继续/i.test(body)) {
      return 'challenge';
    }
    if (/this page isn.?t available in your country|地区.*不可用|不提供服务/i.test(body)) {
      return 'region';
    }
    return null;
  };

  const feed = () => document.querySelector('div[role="feed"]');

  const currentTitle = () =>
    [...document.querySelectorAll('h1')]
      .map((h) => text(h))
      .find((t) => t && t !== '结果') || '';

  const collectVisibleCards = () => {
    const items = [];
    const seen = new Set();
    const links = document.querySelectorAll(
      'a[href*="/maps/place/"], a[href*="!1s0x"], a[href*="place_id"], a.hfpxzc'
    );
    links.forEach((a) => {
      const href = a.href || '';
      if (!href) return;
      const key = placeKeyFromUrl(href) || href;
      if (seen.has(key)) return;
      let name = a.getAttribute('aria-label') || text(a.querySelector('.fontHeadlineSmall')) || text(a);
      name = cleanIconNoise(name.split('·')[0]);
      if (!name || name.length < 2) return;
      // 过滤明显非商家卡片
      if (/^Sponsored|广告|查看.*结果/i.test(name)) return;
      seen.add(key);
      const card = a.closest('[role="article"]') || a.parentElement;
      const cardText = card?.innerText || '';
      const categoryMatch = cardText.split('\\n').map((s) => cleanIconNoise(s)).filter(Boolean);
      const category = categoryMatch.find((line) =>
        line !== name && !/^\\d/.test(line) && !/star|review|营业|Open|Closed|评价/i.test(line) && line.length < 40
      );
      items.push({
        name,
        category: category || '',
        mapsUrl: href,
        placeKey: key,
        website: '',
        phone: ''
      });
    });
    return items;
  };

  const endReached = () => {
    const body = document.body?.innerText || '';
    return /you've reached the end of the list|已到达列表末尾|没有更多结果|End of list/i.test(body);
  };

  /**
   * 等待详情标题与期望商家名对齐，并出现联系信息节点。
   * @param {string} expectedName 列表中的商家名
   * @param {number} timeoutMs 超时
   * @returns {Promise<boolean>}
   */
  const waitDetailForPlace = async (expectedName, timeoutMs = 12000) => {
    const start = Date.now();
    let matchedOnce = false;
    while (Date.now() - start < timeoutMs) {
      const title = currentTitle();
      const nameOk = !expectedName || namesMatch(title, expectedName);
      const ready =
        document.querySelector('[data-item-id^="phone"]') ||
        document.querySelector('a[data-item-id="authority"]') ||
        document.querySelector('[data-item-id="address"]') ||
        document.querySelector('button[jsaction*="category"]');
      if (nameOk && title) {
        matchedOnce = true;
        // 标题已对齐后再稍等联系信息渲染
        if (ready || Date.now() - start > 2500) return true;
      }
      await new Promise((r) => setTimeout(r, 350));
    }
    return matchedOnce;
  };

  /**
   * 从当前已打开的地点详情面板提取字段。
   * @param {string} mapsUrl 地图链接
   * @returns {object}
   */
  const extractPlaceDetail = (mapsUrl) => {
    const title = currentTitle();

    let phone = '';
    const phoneEl =
      document.querySelector('[data-item-id^="phone:tel:"]') ||
      document.querySelector('a[href^="tel:"]');
    if (phoneEl) {
      const id = phoneEl.getAttribute('data-item-id') || '';
      const fromId = id.match(/phone:tel:(.+)/i);
      if (fromId) {
        phone = fromId[1].trim();
      } else {
        const href = phoneEl.getAttribute('href') || '';
        if (/^tel:/i.test(href)) phone = href.replace(/^tel:/i, '').trim();
      }
      if (!phone) {
        const aria = phoneEl.getAttribute('aria-label') || text(phoneEl);
        const m = aria.match(/[+\\d][\\d\\s().-]{6,}/);
        if (m) phone = m[0].trim();
      }
    }

    let website = '';
    const webEl = document.querySelector('a[data-item-id="authority"]');
    if (webEl) {
      website = webEl.href || '';
      if (/google\\./i.test(website) && /support|business\\.google/i.test(website)) {
        website = '';
      }
    }

    let category = '';
    const catBtn = document.querySelector('button[jsaction*="category"]');
    if (catBtn) category = cleanIconNoise(text(catBtn));
    if (!category && title) {
      const lines = (document.body?.innerText || '')
        .split('\\n')
        .map((s) => cleanIconNoise(s))
        .filter(Boolean);
      const titleIdx = lines.findIndex((l) => l === title);
      if (titleIdx >= 0) {
        for (let i = titleIdx + 1; i < Math.min(titleIdx + 10, lines.length); i++) {
          const line = lines[i];
          if (/^\\d+(\\.\\d+)?$/.test(line)) continue;
          if (/^\\(\\d+\\)$/.test(line)) continue;
          if (/概览|评价|简介|路线|保存|附近|分享|Directions|Overview|Reviews/i.test(line)) break;
          if (line.length >= 2 && line.length < 40) {
            category = line;
            break;
          }
        }
      }
    }

    return {
      name: title,
      category,
      phone,
      website,
      mapsUrl: mapsUrl || location.href,
      placeKey: placeKeyFromUrl(mapsUrl || location.href),
      matched: true,
    };
  };

  /**
   * 采集一轮可见卡片；默认不滚动，由宿主在详情处理完后再要求滚动。
   * @param {{ scroll?: boolean }} opts
   */
  window.__gmapsScrapeTick = async (opts = {}) => {
    if (window.__GMAPS_DETAIL_BUSY__) {
      return { blocker: null, items: [], end: false, busy: true };
    }
    const blocker = detectBlocker();
    if (blocker) {
      await emit('maps-blocker', { type: blocker });
      return { blocker, items: [], end: false };
    }
    const items = collectVisibleCards();
    const host = typeof window.__MAPS_HOST__?.emit === 'function';
    if (items.length) await emit('maps-batch', { items });
    if (opts.scroll) {
      const f = feed();
      if (f) {
        f.scrollBy(0, Math.max(400, Math.floor(f.clientHeight * 0.85)));
      }
    }
    const end = endReached();
    if (end) await emit('maps-end', {});
    return {
      blocker: null,
      items,
      end,
      count: items.length,
      host,
      placeLinks: document.querySelectorAll('a[href*="/maps/place/"], a.hfpxzc').length,
      feed: !!feed(),
    };
  };

  /**
   * 在搜索列表上展开卡片。阻止链接跳进地点页，否则结果列表会被换掉。
   * @param {HTMLAnchorElement} link 列表里的地点链接
   */
  const openCardInList = (link) => {
    link.scrollIntoView({ block: 'center', inline: 'nearest' });
    const stopNav = (event) => {
      if (event.target === link || (link.contains && link.contains(event.target))) {
        event.preventDefault();
      }
    };
    link.addEventListener('click', stopNav, true);
    link.click();
    setTimeout(() => link.removeEventListener('click', stopNav, true), 0);
  };

  /**
   * 窄窗口里卡片仍可能盖住列表。采完后点返回，把搜索列表找回来。
   * @returns {Promise<void>}
   */
  const restoreSearchList = async () => {
    if (feed()) return;
    const back = [...document.querySelectorAll('button')].find((button) =>
      /返回|Back to results|返回结果/i.test(button.getAttribute('aria-label') || '')
    );
    if (!back) return;
    back.click();
    const start = Date.now();
    while (!feed() && Date.now() - start < 4000) {
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  /**
   * 在搜索页展开地点卡片并提取，不进入会清掉列表的地点详情页。
   * @param {string} mapsUrl 地点链接
   * @param {string} expectedName 列表商家名
   */
  window.__gmapsOpenPlaceAndExtract = async (mapsUrl, expectedName) => {
    window.__GMAPS_DETAIL_BUSY__ = true;
    try {
      const beforeTitle = currentTitle();
      const links = [...document.querySelectorAll('a[href*="/maps/place/"], a.hfpxzc')];
      const wantKey = placeKeyFromUrl(mapsUrl);
      const link = links.find((a) => {
        if (a.href === mapsUrl) return true;
        if (wantKey && placeKeyFromUrl(a.href) === wantKey) return true;
        const label = a.getAttribute('aria-label') || '';
        return expectedName && namesMatch(label, expectedName);
      });
      if (!link) {
        const failed = {
          name: expectedName || '',
          category: '',
          phone: '',
          website: '',
          mapsUrl,
          placeKey: wantKey,
          matched: false,
          staleTitle: currentTitle(),
          beforeTitle,
        };
        window.__GMAPS_LAST_DETAIL__ = failed;
        await emit('maps-detail', failed);
        return failed;
      }
      await new Promise((r) => setTimeout(r, 200));
      openCardInList(link);

      // 若标题仍是上一家，多等一会再判定
      const ok = await waitDetailForPlace(expectedName || '', 14000);
      const title = currentTitle();
      if (!ok || (expectedName && !namesMatch(title, expectedName))) {
        const failed = {
          name: expectedName || title,
          category: '',
          phone: '',
          website: '',
          mapsUrl,
          placeKey: wantKey,
          matched: false,
          staleTitle: title,
          beforeTitle,
        };
        window.__GMAPS_LAST_DETAIL__ = failed;
        await emit('maps-detail', failed);
        return failed;
      }

      // 对齐后再给联系信息一点渲染时间
      await new Promise((r) => setTimeout(r, 600));
      const detail = extractPlaceDetail(mapsUrl);
      detail.matched = namesMatch(detail.name, expectedName || detail.name);
      if (!detail.matched) {
        detail.phone = '';
        detail.website = '';
        detail.category = '';
      }
      window.__GMAPS_LAST_DETAIL__ = detail;
      await emit('maps-detail', detail);
      return detail;
    } finally {
      await restoreSearchList();
      window.__GMAPS_DETAIL_BUSY__ = false;
    }
  };

  emit('maps-ready', {});
  return true;
})();
`;

/**
 * 在当前商家网页里找一个可用邮箱。宿主轮询这个表达式的返回值。
 * @returns 找到的邮箱；没有则返回空字符串
 */
export const EMAIL_PAGE_PROBE = `
(() => {
  const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/g;
  const pool = (document.documentElement?.innerHTML || '') + '\\n' + (document.body?.innerText || '');
  const matches = pool.match(emailRe) || [];
  const filtered = matches
    .map((item) => item.toLowerCase())
    .filter((item) => !/(png|jpg|jpeg|gif|webp|svg)$/i.test(item))
    .filter((item) => !item.includes('example.com') && !item.includes('sentry.io') && !item.includes('wixpress.com'));
  return filtered[0] || '';
})()
`;

/**
 * 注入到商家官网：正则找邮箱，找到或超时由宿主关闭。
 */
export const EMAIL_SCRAPER_BOOTSTRAP = (businessId: number, timeoutSec: number) => `
(() => {
  const businessId = ${businessId};
  const timeoutMs = ${timeoutSec * 1000};
  const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/g;
  const emit = async (event, payload) => {
    try {
      if (window.__MAPS_HOST__?.emit) {
        await window.__MAPS_HOST__.emit(event, payload);
        return;
      }
      if (window.__TAURI__?.event?.emit) {
        await window.__TAURI__.event.emit(event, payload);
      }
    } catch (_) {}
  };

  const findEmail = () => {
    const html = document.documentElement?.innerHTML || '';
    const text = document.body?.innerText || '';
    const pool = html + '\\n' + text;
    const matches = pool.match(emailRe) || [];
    const filtered = matches
      .map((e) => e.toLowerCase())
      .filter((e) => !/(png|jpg|jpeg|gif|webp|svg)$/i.test(e))
      .filter((e) => !e.includes('example.com') && !e.includes('sentry.io'));
    return filtered[0] || null;
  };

  const started = Date.now();
  const timer = setInterval(async () => {
    const email = findEmail();
    if (email) {
      clearInterval(timer);
      await emit('email-found', { businessId, email });
      return;
    }
    if (Date.now() - started >= timeoutMs) {
      clearInterval(timer);
      await emit('email-timeout', { businessId });
    }
  }, 800);
})();
`;
