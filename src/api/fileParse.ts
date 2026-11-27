import { post } from './request'
import type { SshFileContentResponseDTO } from './sshFile'

/**
 * 通用文件解析接口（非 SSH 链路）
 * 供本地文件预览使用：前端读取字节后上传，服务端解析为结构化文本视图。
 */

/** class 文件解析允许的最大字节数（与服务端一致） */
export const MAX_CLASS_PARSE_BYTES = 16 * 1024 * 1024

/** Uint8Array → base64（分块避免栈溢出） */
export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** 解析 .class 字节码文件为 javap 风格结构视图 */
export function parseClassFile(name: string, bytes: Uint8Array) {
  return post<SshFileContentResponseDTO>('/api/v1/file/parse-class', {
    name,
    contentBase64: uint8ToBase64(bytes),
  })
}
