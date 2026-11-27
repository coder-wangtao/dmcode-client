/**
 * 终端状态管理 — 管理本地终端/SSH 终端的活跃标签
 */
import { create } from 'zustand'
import type { TerminalTabId } from '../components/TerminalTabBar'

interface TerminalState {
  /** 当前活跃的终端标签 */
  activeTerminalTab: TerminalTabId
  /** 本地终端会话 ID */
  localPtySessionId: string | null
  /** SSH 终端会话 ID */
  sshTerminalSessionId: string | null
  /** 底部面板是否可见 */
  terminalVisible: boolean
  /** 本地终端目标工作目录（由「在终端中打开」等入口设置） */
  localTerminalCwd: string | null
  /** cwd 变更计数器：每次「在终端中打开」递增，用于驱动终端 cd */
  localTerminalNonce: number

  setActiveTerminalTab: (tab: TerminalTabId) => void
  setLocalPtySessionId: (id: string | null) => void
  setSshTerminalSessionId: (id: string | null) => void
  setTerminalVisible: (visible: boolean) => void
  /** 在本地终端中打开指定目录：切换标签 + 通知终端 cd */
  openLocalTerminalAt: (cwd: string) => void
}

export const useTerminalStore = create<TerminalState>((set) => ({
  activeTerminalTab: 'local',
  localPtySessionId: null,
  sshTerminalSessionId: null,
  terminalVisible: true,
  localTerminalCwd: null,
  localTerminalNonce: 0,

  setActiveTerminalTab: (tab) => set({ activeTerminalTab: tab }),
  setLocalPtySessionId: (id) => set({ localPtySessionId: id }),
  setSshTerminalSessionId: (id) => set({ sshTerminalSessionId: id }),
  setTerminalVisible: (visible) => set({ terminalVisible: visible }),
  openLocalTerminalAt: (cwd) =>
    set((state) => ({
      localTerminalCwd: cwd,
      localTerminalNonce: state.localTerminalNonce + 1,
      activeTerminalTab: 'local',
    })),
}))
