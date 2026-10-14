/**
 * ???????????????????? set_chat_lang ????????�?
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { unused } = require('url')

async function main() {
  const dir = __dirname
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent((req.url || '/').split('?')[0].replace(/^\//, '')) || '_chat-lang-fab.selftest.html'
    const file = path.join(dir, name)
    if (!file.startsWith(dir) || !fs.existsSync(file)) {
      res.writeHead(404)
      res.end('missing')
      return
    }
    res.writeHead(200, {
      'Content-Type': name.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8'
    })
    fs.createReadStream(file).pipe(res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}/_chat-lang-fab.selftest.html`

  let chromium
  try {
    ;({ chromium } = require('playwright'))
  } catch {
    try {
      ;({ chromium } = require('@playwright/test'))
    } catch {
      console.error('playwright not installed, fallback static checks only')
      const src = fs.readFileSync(path.join(dir, 'chat-lang-fab.js'), 'utf8')
      if (/function stopBubble\s*\([^)]*\)\s*\{[^}]*stopImmediatePropagation/.test(src)) {
        throw new Error('stopBubble still uses stopImmediatePropagation')
      }
      if (!/VERSION = 11/.test(src)) throw new Error('VERSION not bumped')
      if (!/function onPanelAction/.test(src)) {
        throw new Error('onPanelAction missing')
      }
      if (/addEventListener\("click", stopBubble, true\)/.test(src)) {
        throw new Error('empty capture click stopBubble would starve panel actions')
      }
      if (!/chatroomHeader-module__action_group/.test(src)) {
        throw new Error('LINE 3.7 header mount selector missing')
      }
      if (!/useFloatOnlyMount/.test(src)) {
        throw new Error('Meta float-only mount missing')
      }
      if (!/metaThreadIdFromUrl/.test(src)) {
        throw new Error('metaThreadIdFromUrl missing')
      }
      if (!/omni-chat-lang-float-host/.test(src)) {
        throw new Error('floating mount fallback missing')
      }
      console.log('STATIC_OK')
      server.close()
      return
    }
  }

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!document.getElementById('omni-chat-lang-btn'), null, {
    timeout: 5000
  })
  const result = await page.evaluate(async () => window.__SELFTEST__())
  console.log(result)
  await browser.close()
  server.close()
  if (result !== 'SELFTEST_OK') process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
