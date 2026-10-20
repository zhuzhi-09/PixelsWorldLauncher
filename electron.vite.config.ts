import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    resolve: {
      // 项目位于网络驱动器时，避免 Vite 把路径解析成 UNC 路径
      preserveSymlinks: true,
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [
      vue({
        template: {
          compilerOptions: {
            // @material/web 组件是原生 Web Components
            isCustomElement: (tag) => tag.startsWith('md-')
          }
        }
      })
    ]
  }
})
