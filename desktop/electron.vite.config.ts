import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { copyFileSync, mkdirSync, existsSync } from 'fs'

/** 将 inject/*.js 复制到 out/main/inject/，供运行时 readFileSync */
function copyInjectPlugin() {
  const copy = (): void => {
    const destDir = resolve('out/main/inject')
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
    for (const name of [
      'tab.js',
      'line-contacts.js',
      'whatsapp-contacts.js',
      'chat-lang-fab.js'
    ]) {
      copyFileSync(resolve('src/main/inject', name), resolve(destDir, name))
    }
  }
  return {
    name: 'copy-inject-scripts',
    buildStart() {
      copy()
    },
    closeBundle() {
      copy()
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyInjectPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          view: resolve('src/preload/view.ts'),
          'line-view': resolve('src/preload/line-view.ts'),
          workbench: resolve('src/preload/workbench.ts'),
          'maps-host': resolve('src/preload/maps-host.ts'),
          'chatgpt-guide': resolve('src/preload/chatgpt-guide.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@renderer': resolve('src/renderer/src')
      }
    },
    // 打包后 loadFile 使用 file://；绝对路径 /xxx 会解析到磁盘根，导致 logo 丢失
    base: './',
    plugins: [react(), tailwindcss()],
    server: {
      port: 5175,
      strictPort: true
    }
  }
})
