/**
 * 无头浏览器自测：点开面板并选择日语，断言 set_chat_lang 被调用且角标更新。
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

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
      // 只断言函数体里的调用，忽略注释文案
      if (/function stopBubble\s*\([^)]*\)\s*\{[^}]*stopImmediatePropagation/.test(src)) {
        throw new Error('stopBubble still uses stopImmediatePropagation')
      }
      if (!/VERSION = 11/.test(src)) throw new Error('VERSION not bumped')
      if (!/metaThreadIdFromUrl/.test(src)) {
        throw new Error('metaThreadIdFromUrl missing')
      }
      if (!/useFloatOnlyMount/.test(src)) {
        throw new Error('Meta float-only mount missing')
      }
      if (!/positionMetaFloat/.test(src)) {
        throw new Error('Meta float positioning missing')
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
