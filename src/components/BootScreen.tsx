import { useEffect, useMemo, useRef, useState } from "react";
import { useRuntimeStore } from "../stores/runtimeStore";
import { useThemeStore } from "../stores/themeStore";

interface BootScreenProps {
  onRetry: () => void;
  onSkip: () => void;
}

/** 根据启动阶段 + 已耗时计算进度百分比（booting 阶段做缓动爬坡） */
function stageProgress(stage: string, elapsedMs: number): number {
  switch (stage) {
    case "init":
      return 5;
    case "resolve":
      return 18;
    case "prepare":
      return 32;
    case "spawn":
      return 45;
    case "booting": {
      const t = Math.min(elapsedMs / 18000, 1);
      return Math.round(45 + (92 - 45) * (1 - Math.pow(1 - t, 2)));
    }
    case "ready":
      return 100;
    default:
      return 5;
  }
}

export function BootScreen({ onRetry, onSkip }: BootScreenProps) {
  const { colors } = useThemeStore();
  const { status, starting, error } = useRuntimeStore();

  const mountedAt = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, []);

  const ready = status.running && status.port > 0 && !!status.token;
  const failed =
    !starting &&
    !ready &&
    (status.stage === "error" ||
      !!error ||
      (!status.running && !!status.lastError));

  const elapsed = now - mountedAt.current;
  const progress = useMemo(
    () => (ready ? 100 : stageProgress(status.stage, elapsed)),
    [ready, status.stage, elapsed],
  );
  const elapsedSec = Math.floor(elapsed / 1000);

  const failureText = error || status.lastError || "本地 Agent 启动失败";

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ backgroundColor: colors.bgPrimary }}
    >
      <style>{`
        @keyframes damaocode-boot-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
        }
        @keyframes damaocode-boot-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(250%); }
        }
      `}</style>

      <div className="flex w-[420px] max-w-[86vw] flex-col items-center">
        {/* Logo / 标题 */}
        <div
          className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl text-[26px] font-bold"
          style={{
            backgroundColor: colors.accentSoft,
            color: colors.accent,
            border: `1px solid ${colors.accent}40`,
            animation: failed
              ? undefined
              : "damaocode-boot-pulse 2.2s ease-in-out infinite",
          }}
        >
          W
        </div>
        <div
          className="text-[17px] font-semibold"
          style={{ color: colors.text }}
        >
          DaMaoCode-Study
        </div>
        <div className="mt-1 text-[12px]" style={{ color: colors.textDim }}>
          AI DevOps Assistant
        </div>

        {!failed ? (
          <>
            {/* 进度条 */}
            <div
              className="mt-8 h-[6px] w-full overflow-hidden rounded-full"
              style={{ backgroundColor: colors.bgTertiary }}
            >
              <div
                className="relative h-full rounded-full transition-[width] duration-300 ease-out"
                style={{
                  width: `${progress}%`,
                  backgroundColor: colors.accent,
                }}
              >
                <div
                  className="absolute inset-y-0 w-[40%] rounded-full"
                  style={{
                    background:
                      "linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)",
                    animation: "damaocode-boot-shimmer 1.4s linear infinite",
                  }}
                />
              </div>
            </div>

            {/* 阶段说明 */}
            <div
              className="mt-3 flex w-full items-center justify-between text-[12px]"
              style={{ color: colors.textSecondary }}
            >
              <span>{status.stageMessage || "正在启动本地 Agent 服务…"}</span>
              <span style={{ color: colors.textDim }}>{progress}%</span>
            </div>
            <div className="mt-1 text-[11px]" style={{ color: colors.textDim }}>
              已用时 {elapsedSec}s · 首次启动需要加载 Java 运行时，请稍候
            </div>
          </>
        ) : (
          <>
            {/* 失败说明 */}
            <div
              className="mt-8 w-full rounded-xl px-4 py-3"
              style={{
                backgroundColor: `${colors.red}12`,
                border: `1px solid ${colors.red}40`,
              }}
            >
              <div
                className="flex items-center gap-2 text-[13px] font-medium"
                style={{ color: colors.red }}
              >
                <span>启动失败</span>
              </div>
              <div
                className="mt-1.5 break-all text-[12px] leading-relaxed"
                style={{ color: colors.textSecondary }}
              >
                {failureText}
              </div>
              <div
                className="mt-2 text-[11px] leading-relaxed"
                style={{ color: colors.textDim }}
              >
                常见原因：Java 运行时缺失或版本低于 17、Agent
                服务包缺失、端口被占用。 详细日志见应用数据目录 logs/agent.log。
              </div>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <button
                onClick={onRetry}
                className="h-8 cursor-pointer rounded-lg px-4 text-[12px] font-medium text-white"
                style={{ backgroundColor: colors.accent }}
              >
                重试启动
              </button>
              <button
                onClick={onSkip}
                className="h-8 cursor-pointer rounded-lg px-4 text-[12px]"
                style={{
                  color: colors.textSecondary,
                  border: `1px solid ${colors.border}`,
                  backgroundColor: colors.bgTertiary,
                }}
              >
                暂不启动，进入应用
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
