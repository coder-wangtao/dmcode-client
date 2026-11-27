import './index.css'
import { MainView } from './views/MainView'
import { useEffect, useState } from 'react'
import { useConnectionStore } from './stores/connectionStore'
import { useLocalFileStore } from './stores/localFileStore'
import { bootstrapLocalRuntime, useRuntimeStore } from './stores/runtimeStore'
import { ConnectionStatus } from './types'
import { ErrorBoundary } from './components/ErrorBoundary'
import { BootScreen } from './components/BootScreen'

function App() {
  const { startHeartbeat, stopHeartbeat, connections, disconnect } = useConnectionStore()

  // 恢复上次打开的本地文件夹
  const restoreLocalFolder = useLocalFileStore((s) => s.restoreFolder)
  const rootPath = useLocalFileStore((s) => s.rootPath)

  // 本地 Agent 启动引导页：未就绪时全屏展示进度 / 失败说明
  const runtimeStatus = useRuntimeStore((s) => s.status)
  const runtimeReady = runtimeStatus.running && runtimeStatus.port > 0 && !!runtimeStatus.token
  const [bootDismissed, setBootDismissed] = useState(false)

  useEffect(() => {
    // 应用启动时：重置所有连接状态为断开（防止后端状态不同步）
    useConnectionStore.setState((state) => ({
      connections: state.connections.map((c) => ({ ...c, status: ConnectionStatus.DISCONNECTED })),
    }))
    // 开启心跳检测
    startHeartbeat()
    let cancelled = false
    const bootstrap = async () => {
      // 恢复本地文件夹（静默恢复，不弹对话框），再把它作为 Agent workspace 传入
      await restoreLocalFolder()
      if (!cancelled) {
        void bootstrapLocalRuntime(useLocalFileStore.getState().rootPath ?? undefined)
      }
    }
    void bootstrap()
    return () => {
      cancelled = true
      stopHeartbeat()
    }
  }, [startHeartbeat, stopHeartbeat, restoreLocalFolder])

  // 本地工作区变化后同步 Agent 工具的工作区边界
  useEffect(() => {
    void bootstrapLocalRuntime(rootPath ?? undefined)
  }, [rootPath])

  // 应用关闭时断开所有连接
  useEffect(() => {
    const handleBeforeUnload = () => {
      connections
        .filter((c) => c.status === ConnectionStatus.CONNECTED)
        .forEach((c) => disconnect(c.id))
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [connections, disconnect])

  const handleBootRetry = () => {
    setBootDismissed(false)
    void bootstrapLocalRuntime(useLocalFileStore.getState().rootPath ?? undefined)
  }

  return (
    <ErrorBoundary>
      <MainView />
      {!runtimeReady && !bootDismissed && (
        <BootScreen onRetry={handleBootRetry} onSkip={() => setBootDismissed(true)} />
      )}
    </ErrorBoundary>
  )
}

export default App
