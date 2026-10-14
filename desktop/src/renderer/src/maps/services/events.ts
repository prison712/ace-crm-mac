/** 取消订阅函数（对齐原 Tauri UnlistenFn） */
export type UnlistenFn = () => void

/**
 * 订阅地图采集事件（替代 @tauri-apps/api/event listen）。
 * @param channel 事件名，如 maps-batch / email-found
 * @param handler 回调；payload 包在 event.payload 中，兼容原 engine 写法
 * @returns 取消订阅函数
 */
export async function listen<T>(
  channel: string,
  handler: (event: { payload: T }) => void | Promise<void>
): Promise<UnlistenFn> {
  return window.api.maps.onEvent(channel, (payload: T) => {
    void handler({ payload })
  })
}
