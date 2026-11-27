import { useRuntimeStore } from '../stores/runtimeStore'
import { useThemeStore } from '../stores/themeStore'

export function RuntimeStatusIndicator() {
  const { colors } = useThemeStore()
  const { status, starting, error } = useRuntimeStore()

  const state = starting || status.running && status.port === 0
    ? 'starting'
    : status.running
      ? 'ready'
      : 'stopped'

  const color = state === 'ready'
    ? colors.green
    : state === 'starting'
      ? colors.yellow
      : colors.textSecondary

  const label = state === 'ready'
    ? `Agent ${status.port}`
    : state === 'starting'
      ? 'Agent 启动中'
      : 'Agent 未连接'

  return (
    <div
      className="flex items-center gap-2 h-7 px-2.5 rounded-full"
      style={{
        backgroundColor: `${color}14`,
        border: `1px solid ${color}30`,
      }}
      title={error || (status.running ? `本地 Agent 已连接：http://127.0.0.1:${status.port}` : '正在启动本地 Agent')}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${state === 'starting' ? 'animate-pulse' : ''}`}
        style={{ backgroundColor: color }}
      />
      <span className="text-[11px] leading-none font-medium" style={{ color }}>
        {label}
      </span>
    </div>
  )
}
