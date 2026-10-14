export interface GpuRenderer {
  gl_vendor: string
  gl_renderer: string
  gpu_vendor: string
  gpu_arch: string
}

export interface GpuVendorGroup {
  system: 'window' | 'mac'
  gl_vendor: string
  renderers: GpuRenderer[]
}

/** 精简自海王 Xle GPU 列表，保留足够随机多样性 */
export const GPU_PROFILES: GpuVendorGroup[] = [
  {
    system: 'window',
    gl_vendor: 'Google Inc. (NVIDIA)',
    renderers: [
      {
        gl_vendor: 'Google Inc. (NVIDIA)',
        gl_renderer:
          'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.3667)',
        gpu_vendor: 'NVIDIA',
        gpu_arch: 'ampere'
      },
      {
        gl_vendor: 'Google Inc. (NVIDIA)',
        gl_renderer:
          'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11-27.21.14.6647)',
        gpu_vendor: 'NVIDIA',
        gpu_arch: 'turing'
      },
      {
        gl_vendor: 'Google Inc. (NVIDIA)',
        gl_renderer:
          'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.3734)',
        gpu_vendor: 'NVIDIA',
        gpu_arch: 'ada'
      },
      {
        gl_vendor: 'Google Inc. (NVIDIA)',
        gl_renderer:
          'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
        gpu_vendor: 'NVIDIA',
        gpu_arch: 'pascal'
      },
      {
        gl_vendor: 'Google Inc. (NVIDIA)',
        gl_renderer:
          'ANGLE (NVIDIA, NVIDIA GeForce RTX 2080 Ti Direct3D11 vs_5_0 ps_5_0, D3D11-27.21.14.6259)',
        gpu_vendor: 'NVIDIA',
        gpu_arch: 'turing'
      }
    ]
  },
  {
    system: 'window',
    gl_vendor: 'Google Inc. (Intel)',
    renderers: [
      {
        gl_vendor: 'Google Inc. (Intel)',
        gl_renderer:
          'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, igd10iumd64.dll-26.20.100.7325)',
        gpu_vendor: 'Intel',
        gpu_arch: 'intel'
      },
      {
        gl_vendor: 'Google Inc. (Intel)',
        gl_renderer:
          'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, igd10iumd64.dll-27.20.100.8935)',
        gpu_vendor: 'Intel',
        gpu_arch: 'intel'
      },
      {
        gl_vendor: 'Google Inc. (Intel)',
        gl_renderer:
          'ANGLE (Intel, Intel(R) HD Graphics 630 Direct3D11 vs_5_0 ps_5_0, igd10iumd64.dll-25.20.100.6373)',
        gpu_vendor: 'Intel',
        gpu_arch: 'intel'
      },
      {
        gl_vendor: 'Google Inc. (Intel)',
        gl_renderer:
          'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11-27.20.100.9219)',
        gpu_vendor: 'Intel',
        gpu_arch: 'intel'
      }
    ]
  },
  {
    system: 'mac',
    gl_vendor: 'Apple Inc.',
    renderers: [
      {
        gl_vendor: 'Apple Inc.',
        gl_renderer: 'Apple M1',
        gpu_vendor: 'Apple',
        gpu_arch: 'apple_silicon'
      },
      {
        gl_vendor: 'Apple Inc.',
        gl_renderer: 'Apple M2',
        gpu_vendor: 'Apple',
        gpu_arch: 'apple_silicon'
      },
      {
        gl_vendor: 'Apple Inc.',
        gl_renderer: 'Apple GPU',
        gpu_vendor: 'Apple',
        gpu_arch: 'apple'
      }
    ]
  },
  {
    system: 'mac',
    gl_vendor: 'Google Inc. (Apple)',
    renderers: [
      {
        gl_vendor: 'Google Inc. (Apple)',
        gl_renderer: 'ANGLE (Apple, Apple M3 Pro, OpenGL 4.1)',
        gpu_vendor: 'Apple',
        gpu_arch: 'apple_silicon'
      },
      {
        gl_vendor: 'Google Inc. (Apple)',
        gl_renderer: 'ANGLE (Apple, Apple M2 Pro, OpenGL 4.1)',
        gpu_vendor: 'Apple',
        gpu_arch: 'apple_silicon'
      },
      {
        gl_vendor: 'Google Inc. (Apple)',
        gl_renderer: 'ANGLE (Apple, Apple M1, OpenGL 4.1)',
        gpu_vendor: 'Apple',
        gpu_arch: 'apple_silicon'
      }
    ]
  },
  {
    system: 'mac',
    gl_vendor: 'Intel Inc.',
    renderers: [
      {
        gl_vendor: 'Intel Inc.',
        gl_renderer: 'Intel(R) Iris(TM) Plus Graphics OpenGL Engine',
        gpu_vendor: 'Intel',
        gpu_arch: 'intel'
      },
      {
        gl_vendor: 'Intel Inc.',
        gl_renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 617, OpenGL 4.1)',
        gpu_vendor: 'Intel',
        gpu_arch: 'intel'
      }
    ]
  }
]

export const FONT_FAMILIES = [
  'Arial',
  'Arial Black',
  'Calibri',
  'Cambria',
  'Candara',
  'Comic Sans MS',
  'Consolas',
  'Courier',
  'Courier New',
  'Georgia',
  'Helvetica',
  'Impact',
  'Lucida Console',
  'Segoe UI',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
  'Microsoft Sans Serif',
  'MS Gothic',
  'Meiryo',
  'Noto Sans',
  'PingFang SC',
  'SimSun',
  'SimHei',
  'Roboto',
  'SF Pro Text',
  'Inter'
]
