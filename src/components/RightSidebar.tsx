import React, { useRef, useEffect, useState, useMemo } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { stat } from "@tauri-apps/plugin-fs";
import { useThemeStore } from "../stores/themeStore";
import { useAgentStore } from "../stores/agentStore";
import { useConnectionStore } from "../stores/connectionStore";
import { useSshAgentStore, type InputTag } from "../stores/sshAgentStore";
import { useFileExplorerStore, isDiffTab } from "../stores/fileExplorerStore";
import {
  useLocalFileStore,
  isLocalDiffTab,
  type LocalOpenTab,
} from "../stores/localFileStore";
import { useAiPatchStore } from "../stores/aiPatchStore";
import { useOutputStore } from "../stores/outputStore";
import { usePermissionStore } from "../stores/permissionStore";
import { useStreamStore, type StreamStatus } from "../stores/streamStore";
import { useModelStore } from "../stores/modelStore";
import { useRuntimeStore } from "../stores/runtimeStore";
import * as agentApi from "../api/agent";
import type { ReActStep, TaskBreakdownDTO } from "../api/agent";
import { ConnectionStatus } from "../types";
import type { AgentMessage } from "../types";
import { MessageBubble } from "./MessageBubble";
import { PermissionConfirmModal } from "./PermissionConfirmModal";
import { StreamStatusBar } from "./StreamStatusBar";
import { ErrorRecoveryCard, type ErrorRecovery } from "./ErrorRecoveryCard";
import { TopicDivider, shouldInsertTopicDivider } from "./TopicDivider";
import { SessionSummaryCard } from "./SessionSummaryCard";
import { ArtifactSummaryPanel } from "./ArtifactSummaryPanel";
import { CommandMenu, useCommandMenu, type MenuItem } from "./CommandMenu";
import { toolProgressStore } from "./ToolProgressBar";
import { ShortcutHelp } from "./ShortcutHelp";
import {
  MarkdownContent,
  splitThinkTags,
  getToolIconInfo,
  ContextTagChip,
} from "./MessageBubbleShared";
import { ChatExport } from "./ChatExport";
import { EmptyState } from "./EmptyState";

// 工具时间轴行摘要
function extractToolSummaryGlobal(
  toolName: string,
  toolParams?: string,
): string {
  if (!toolParams) return "";
  const lower = toolName.toLowerCase();
  if (
    lower.includes("exec") ||
    lower.includes("command") ||
    lower.includes("ssh")
  ) {
    const cmd = toolParams.trim().split("\n")[0];
    return cmd.length > 50 ? cmd.substring(0, 50) + "..." : cmd;
  }
  const pathMatch = toolParams.match(/(\/?[\w./-]+\.[\w]+)/);
  if (pathMatch) return pathMatch[1];
  return toolParams.length > 40
    ? toolParams.substring(0, 40) + "..."
    : toolParams;
}

function ProcessRow({ content, active }: { content: string; active: boolean }) {
  const { colors } = useThemeStore();
  const display =
    content || (active ? "正在分析请求、项目上下文和可用工具..." : "已完成");
  return (
    <div
      className="py-0.5 text-[12px] leading-relaxed"
      style={{ color: colors.textSecondary }}
    >
      <MarkdownContent content={display} colors={colors} />
    </div>
  );
}

function ToolActivityRow({ message }: { message: AgentMessage }) {
  const { colors } = useThemeStore();
  const active = message.status === "in_progress";
  const failed = message.status === "failure";
  const [open, setOpen] = useState(active);
  const info = getToolIconInfo(message.toolName || "");
  const summary = extractToolSummaryGlobal(
    message.toolName || "",
    message.toolParams,
  );

  useEffect(() => {
    setOpen(message.status === "in_progress");
  }, [message.status]);

  const formatDetail = (value?: string) => {
    if (!value?.trim()) return "";
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  };
  const params = formatDetail(message.toolParams);
  const result = formatDetail(message.toolResult || message.content);

  return (
    <div className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-black/[0.03]"
      >
        <span className="shrink-0" style={{ color: colors.textDim }}>
          <svg
            className="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="4" y="4" width="16" height="16" rx="4" />
            <path d="M8.5 9.5 11 12l-2.5 2.5" />
            <path d="M13 15h3" />
          </svg>
        </span>
        <span
          className="shrink-0 text-[12px] font-medium"
          style={{ color: colors.textDim }}
        >
          {info.label}
        </span>
        {summary && (
          <span
            className="min-w-0 flex-1 truncate text-[11px]"
            style={{ color: colors.textSecondary }}
          >
            {summary}
          </span>
        )}
        {failed && (
          <span
            className="ml-auto shrink-0 text-[10px]"
            style={{ color: colors.red }}
          >
            失败
          </span>
        )}
        <svg
          className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          style={{ color: colors.textDim }}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (params || result) && (
        <div className="space-y-2 px-2 pb-2">
          {params && (
            <div>
              <div
                className="mb-1 text-[10px] font-medium"
                style={{ color: colors.textDim }}
              >
                输入
              </div>
              <pre
                className="max-h-36 overflow-auto rounded-lg px-2 py-1.5 text-[10px] leading-relaxed"
                style={{
                  backgroundColor: "transparent",
                  color: colors.textSecondary,
                }}
              >
                {params}
              </pre>
            </div>
          )}
          {result && (
            <div>
              <div
                className="mb-1 text-[10px] font-medium"
                style={{ color: colors.textDim }}
              >
                输出
              </div>
              <pre
                className="max-h-44 overflow-auto rounded-lg px-2 py-1.5 text-[10px] leading-relaxed"
                style={{
                  backgroundColor: "transparent",
                  color: colors.textSecondary,
                }}
              >
                {result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type TurnTimelineItem =
  | { kind: "message"; message: AgentMessage }
  | { kind: "activity"; key: string; messages: AgentMessage[] };

function normalizeProcessContent(content: string) {
  return content
    .replace(/([\s\S]*?<\/think>|<think[^>]*>[\s\S]*?)(<\/think>|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ToolActivityGroup({ messages }: { messages: AgentMessage[] }) {
  const { colors } = useThemeStore();
  const running = messages.some((message) => message.status === "in_progress");
  const failedCount = messages.filter(
    (message) => message.status === "failure",
  ).length;
  const [open, setOpen] = useState(false);

  const counts = messages.reduce((map, message) => {
    const key = message.toolName || "tool";
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map<string, number>());
  const primaryInfo = getToolIconInfo(messages[0]?.toolName || "");
  const summary = [...counts.entries()]
    .map(
      ([name, count]) =>
        `${getToolIconInfo(name).label}${count > 1 ? ` ×${count}` : ""}`,
    )
    .join(" · ");
  const title = running
    ? `正在执行 ${messages.length} 步`
    : messages.length > 1
      ? `已运行 ${messages.length} 步`
      : primaryInfo.label;

  return (
    <div className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full min-w-0 items-center gap-2 px-0 py-1 text-left transition-colors hover:bg-black/[0.02]"
      >
        <span
          className="shrink-0"
          style={{ color: failedCount > 0 ? colors.red : primaryInfo.color }}
        >
          {primaryInfo.icon}
        </span>
        <span
          className="shrink-0 text-[12px]"
          style={{ color: colors.textSecondary }}
        >
          {title}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[11px]"
          style={{ color: colors.textDim }}
        >
          {summary}
        </span>
        <svg
          className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          style={{ color: `${colors.textDim}80` }}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div
          className="ml-[13px] space-y-0.5 border-l pl-2.5 pb-1.5"
          style={{ borderColor: `${colors.border}60` }}
        >
          {messages.map((message) => (
            <ToolActivityRow key={message.id} message={message} />
          ))}
        </div>
      )}
    </div>
  );
}

function FinalAnswer({
  content,
  active,
}: {
  content: string;
  active: boolean;
}) {
  const { colors } = useThemeStore();
  const parts = content ? splitThinkTags(content) : [];
  return content ? (
    <div className="py-0.5">
      <div
        className={`text-[13px] leading-relaxed ${active ? "opacity-90" : "opacity-100"}`}
      >
        {parts.map((part, index) => {
          if (part.type === "think")
            return (
              <ProcessRow
                key={index}
                content={part.content}
                active={part.isStreaming || false}
              />
            );
          if (!part.content.trim()) return null;
          return (
            <MarkdownContent
              key={index}
              content={part.content}
              colors={colors}
            />
          );
        })}
      </div>
    </div>
  ) : (
    <div className="text-[12px]" style={{ color: colors.textSecondary }}>
      正在整理结果...
    </div>
  );
}

function formatTurnDuration(totalSeconds: number) {
  const seconds = Math.max(1, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) return `${hours} 时 ${minutes} 分 ${remainingSeconds} 秒`;
  if (minutes > 0) return `${minutes} 分 ${remainingSeconds} 秒`;
  return `${remainingSeconds} 秒`;
}

function AiTurnBlock({
  msgs,
  colors,
  isLoading,
  streamStatus,
  onRetry,
}: {
  msgs: AgentMessage[];
  colors: ReturnType<typeof useThemeStore.getState>["colors"];
  isLoading: boolean;
  streamStatus: StreamStatus;
  onRetry?: () => void;
}) {
  const thinkingMsgs = msgs.filter(
    (message) => message.messageType === "thinking",
  );
  const textMessages = msgs.filter((message) => message.messageType === "text");
  const errorMessages = msgs.filter(
    (message) => message.messageType === "error",
  );
  const orderedMessages = [...msgs].sort(
    (left, right) => left.timestamp - right.timestamp,
  );
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!isLoading) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isLoading]);

  const finalTextMessage = [...textMessages]
    .reverse()
    .find((message) => message.content.trim());
  const normalizedFinalAnswer =
    finalTextMessage?.content
      ?.replace(/<think>[\s\S]*?<\/think>/g, "")
      ?.trim() || "";
  const finalAnswerSignature = normalizeProcessContent(normalizedFinalAnswer);
  // ── 根治重复展示（状态机方案）──
  // 流式文本现在以「临时最终答案」身份直接进 text 消息，身份由状态机决定：
  // - 后续出现工具调用 → 消息被 demote 为 thinking（过程说明），内容只有一份
  // - 无工具调用 → done 就地转正同一条 text 消息
  // 因此时间线里不存在"过程文本 + 最终答案"两份相同内容，不再需要内容相似度去重。
  // 仅保留一个兜底：thinking 内容与最终答案完全一致时隐藏（防御旧会话数据/异常流）。
  const isDuplicateProcess = (content: string) => {
    const normalized = normalizeProcessContent(content);
    if (!normalized) return true;
    return normalized === finalAnswerSignature;
  };
  const finalDisplayContent = normalizedFinalAnswer;
  const latestThinkingMessage = [...thinkingMsgs].reverse().find((message) => {
    const content = message.content.trim();
    return content && content !== "思考中..." && !content.startsWith("步骤");
  });
  const placeholderThinking =
    isLoading &&
    thinkingMsgs.length > 0 &&
    thinkingMsgs.every((message) => message.content === "思考中...");
  const reconnecting = placeholderThinking && streamStatus === "reconnecting";
  const disconnected =
    placeholderThinking &&
    (streamStatus === "disconnected" || streamStatus === "error");
  const timelineItems: TurnTimelineItem[] = [];
  for (const message of orderedMessages) {
    if (message.messageType === "tool_call") {
      const previous = timelineItems[timelineItems.length - 1];
      if (previous?.kind === "activity") {
        previous.messages.push(message);
      } else {
        timelineItems.push({
          kind: "activity",
          key: `activity-${message.id}`,
          messages: [message],
        });
      }
      continue;
    }
    if (
      message.messageType === "thinking" &&
      isDuplicateProcess(message.content)
    )
      continue;
    if (message.messageType === "text" && message.role === "assistant") {
      if (message.id === finalTextMessage?.id) continue;
      const normalized = normalizeProcessContent(message.content);
      if (!normalized || normalized === finalAnswerSignature) continue;
      timelineItems.push({ kind: "message", message });
      continue;
    }
    timelineItems.push({ kind: "message", message });
  }

  const timestamp = msgs[0]?.timestamp || Date.now();
  const turnTime = new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const hasProcess = timelineItems.length > 0;
  const elapsedEndTime = isLoading
    ? now
    : Math.max(
        timestamp,
        finalTextMessage?.timestamp || 0,
        ...msgs.map((message) => message.timestamp),
      );
  const elapsedSeconds = Math.max(0, (elapsedEndTime - timestamp) / 1000);

  return (
    <div className="space-y-0">
      <div className="flex gap-2 px-3 py-1.5">
        <div
          className="mt-[3px] flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: `${colors.accent}14` }}
        >
          <svg
            className="h-3.5 w-3.5"
            style={{ color: colors.accent }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3v4M8 5h8M6 10h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z" />
            <path d="M9.5 14h.01M14.5 14h.01" />
          </svg>
        </div>
        <div
          className="flex min-w-0 flex-1 flex-col gap-1"
          style={{ maxWidth: "calc(100% - 32px)" }}
        >
          <div className="flex items-center gap-1.5">
            <span
              className="text-[11px] font-medium"
              style={{ color: colors.textSecondary }}
            >
              DaMaoCode
            </span>
            <span
              className="text-[10px] opacity-70"
              style={{ color: colors.textDim }}
            >
              {turnTime}
            </span>
          </div>
          {(reconnecting || disconnected) && (
            <ProcessRow
              content={
                disconnected
                  ? "连接已中断，等待恢复。"
                  : "正在重新连接 Agent 服务..."
              }
              active={reconnecting}
            />
          )}
          {timelineItems.map((item) => {
            if (item.kind === "activity")
              return (
                <ToolActivityGroup key={item.key} messages={item.messages} />
              );
            const message = item.message;
            if (message.messageType === "thinking") {
              if (
                message.content === "思考中..." ||
                message.content.startsWith("步骤")
              )
                return null;
              return (
                <ProcessRow
                  key={message.id}
                  content={message.content}
                  active={
                    isLoading &&
                    !finalTextMessage &&
                    message.id === latestThinkingMessage?.id
                  }
                />
              );
            }
            if (
              message.messageType === "text" &&
              message.role === "assistant"
            ) {
              return (
                <ProcessRow
                  key={message.id}
                  content={message.content}
                  active={isLoading && message.id === finalTextMessage?.id}
                />
              );
            }
            if (message.messageType === "summary") {
              return message.changeSummary ? (
                <SessionSummaryCard
                  key={message.id}
                  summary={message.changeSummary}
                />
              ) : null;
            }
            if (message.messageType === "error") {
              return (
                <div
                  key={message.id}
                  className="rounded-lg px-3 py-2 text-[12px] leading-relaxed"
                  style={{
                    backgroundColor: `${colors.red}10`,
                    border: `1px solid ${colors.red}25`,
                    color: colors.red,
                  }}
                >
                  {message.content}
                </div>
              );
            }
            return null;
          })}
          {isLoading &&
            !finalTextMessage &&
            !timelineItems.some(
              (item) =>
                item.kind === "activity" &&
                item.messages.some(
                  (message) => message.status === "in_progress",
                ),
            ) && <WaitingIndicator />}
          {(hasProcess || finalTextMessage) && finalTextMessage && (
            <div className="pt-1.5">
              <div
                className="text-[10px] tabular-nums"
                style={{ color: colors.textDim }}
              >
                用时 {formatTurnDuration(elapsedSeconds)}
              </div>
              <div
                className="mt-2 h-px w-full"
                style={{ backgroundColor: `${colors.border}70` }}
              />
            </div>
          )}
          {finalTextMessage && (
            <FinalAnswer content={finalDisplayContent} active={isLoading} />
          )}
        </div>
      </div>

      {!isLoading && errorMessages.length > 0 && (
        <div className="flex gap-2 px-3 py-1.5">
          <div className="h-6 w-6 shrink-0" />
          <div
            className="flex items-center gap-2 rounded-lg px-3 py-2"
            style={{
              backgroundColor: "rgba(239, 68, 68, 0.08)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
            }}
          >
            <span className="text-[13px]">⚠️</span>
            <span className="text-[11px]" style={{ color: "#f87171" }}>
              {errorMessages[errorMessages.length - 1]?.content || "对话已中断"}
            </span>
            {onRetry && (
              <button
                className="rounded px-2.5 py-0.5 text-[10px] font-medium transition-all hover:opacity-80"
                style={{ backgroundColor: colors.accent, color: "#fff" }}
                onClick={onRetry}
              >
                继续对话
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function WaitingIndicator() {
  const { colors } = useThemeStore();
  return (
    <div className="flex min-w-0 items-center py-1">
      <span className="flex items-center gap-1">
        {[0, 160, 320].map((delay, index) => (
          <span
            key={index}
            className="h-1.5 w-1.5 rounded-full animate-bounce"
            style={{
              backgroundColor: colors.textDim,
              animationDelay: `${delay}ms`,
            }}
          />
        ))}
      </span>
    </div>
  );
}

function AgentActionCapsule({
  messages,
  streamStatus,
}: {
  messages: AgentMessage[];
  streamStatus: StreamStatus;
}) {
  const { colors } = useThemeStore();
  const [elapsed, setElapsed] = useState(0);
  const groupId = messages[messages.length - 1]?.groupId;
  const turnMessages = groupId
    ? messages.filter((message) => message.groupId === groupId)
    : messages;
  const toolMessages = turnMessages.filter(
    (message) => message.messageType === "tool_call",
  );
  const activeTool = [...toolMessages]
    .reverse()
    .find((message) => message.status === "in_progress");
  const finalText = [...turnMessages]
    .reverse()
    .find(
      (message) =>
        message.messageType === "text" &&
        message.role === "assistant" &&
        message.content.trim(),
    );
  const startedAt = turnMessages[0]?.timestamp || Date.now();

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsed(Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const failedCount = toolMessages.filter(
    (message) => message.status === "failure",
  ).length;
  const action = activeTool
    ? {
        label: getToolIconInfo(activeTool.toolName || "").label,
        detail: extractToolSummaryGlobal(
          activeTool.toolName || "",
          activeTool.toolParams,
        ),
      }
    : finalText
      ? { label: "正在整理结果", detail: "" }
      : streamStatus === "reconnecting"
        ? { label: "正在重连", detail: "" }
        : streamStatus === "disconnected" || streamStatus === "error"
          ? { label: "连接异常", detail: "" }
          : toolMessages.length > 0
            ? {
                label: "正在规划下一步",
                detail: `已完成 ${toolMessages.length - failedCount}/${toolMessages.length} 步`,
              }
            : { label: "正在分析", detail: "" };
  const actionColor =
    streamStatus === "disconnected" || streamStatus === "error"
      ? colors.red
      : colors.accent;

  return (
    <div
      className="flex min-w-0 max-w-[420px] items-center gap-2 rounded-full px-2.5 py-1 shadow-sm"
      style={{
        backgroundColor: `${actionColor}10`,
        border: `1px solid ${actionColor}22`,
        color: actionColor,
      }}
    >
      <svg
        className="h-3 w-3 shrink-0 animate-spin"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      >
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
      <span className="shrink-0 text-[11px] font-medium">{action.label}</span>
      {action.detail && (
        <span
          className="min-w-0 flex-1 truncate text-[10px]"
          style={{ color: colors.textSecondary }}
        >
          {action.detail}
        </span>
      )}
      <span
        className="shrink-0 text-[10px] tabular-nums"
        style={{ color: colors.textDim }}
      >
        {elapsed}s
      </span>
    </div>
  );
}
function parseToolResultPayload(raw?: string): Record<string, any> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/"path"\s*:\s*"([^"]+)"/);
    return match ? { path: match[1] } : null;
  }
}

/**
 * 从原始错误信息中提取用户友好的摘要。
 * Java 异常堆栈、Caused by 等信息会被过滤，只保留核心错误描述。
 */
function extractErrorMessage(raw: string): string {
  if (!raw) return "未知错误";
  const s = raw.trim();

  // 1. 提取 Caused by 中的核心消息（如 "Server error: 500 Internal Server Error from POST ..."）
  const causedByMatch = s.match(
    /Caused by:\s*(.+?)(?:\s+at\s|\s*\.{3}\s+\d+)/s,
  );
  if (causedByMatch) {
    let msg = causedByMatch[1].trim();
    // 截断过长的 URL
    msg = msg.replace(
      /(POST|GET|PUT|DELETE)\s+(https?:\/\/[^\s]+)(\s|$)/,
      "$1 <URL> ",
    );
    if (msg.length > 200) msg = msg.substring(0, 200) + "...";
    return msg;
  }

  // 2. 提取第一行有意义的内容（跳过纯堆栈行）
  const lines = s.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("at ") || trimmed.startsWith("..."))
      continue;
    // 跳过纯异常类名行（如 "java.lang.RuntimeException: ..." 但保留冒号后的内容）
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx > 0 && colonIdx < 60) {
      const afterColon = trimmed.substring(colonIdx + 1).trim();
      if (afterColon) {
        let msg = afterColon.replace(
          /(POST|GET|PUT|DELETE)\s+(https?:\/\/[^\s]+)/,
          "$1 <URL>",
        );
        if (msg.length > 200) msg = msg.substring(0, 200) + "...";
        return msg;
      }
    }
    // 非堆栈行，直接返回
    if (trimmed.length < 300) return trimmed;
  }

  // 3. 兜底：截断到合理长度
  return s.length > 200 ? s.substring(0, 200) + "..." : s;
}

interface RightSidebarProps {
  width?: number;
  activeTerminalSessionId?: string | null;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}

/**
 * 清理粘贴文本中的 Markdown 格式符号，转为纯文本
 */
function stripMarkdownForPaste(text: string): string {
  if (!text) return text;
  return (
    text
      // 标题: ## 标题 → 标题
      .replace(/^#{1,6}\s+/gm, "")
      // 加粗: **text** 或 __text__ → text
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      // 斜体: *text* 或 _text_ → text（避免误匹配列表标记）
      .replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, "$1")
      .replace(/(?<!\w)_([^_]+?)_(?!\w)/g, "$1")
      // 行内代码: `text` → text
      .replace(/`([^`]+?)`/g, "$1")
      // 链接: [text](url) → text
      .replace(/\[([^\]]+?)\]\([^)]+?\)/g, "$1")
      // 图片: ![alt](url) → alt
      .replace(/!\[([^\]]*?)\]\([^)]+?\)/g, "$1")
      // 无序列表: - item / * item / + item → item
      .replace(/^\s*[-*+]\s+/gm, "")
      // 有序列表: 1. item → item
      .replace(/^\s*\d+\.\s+/gm, "")
      // 引用: > text → text
      .replace(/^>\s*/gm, "")
      // 分割线: --- 或 *** → 空行
      .replace(/^[-*_]{3,}\s*$/gm, "")
      // 代码块标记: ``` → 移除
      .replace(/^```\w*$/gm, "")
  );
}

const streamAbortHandlers = new Map<string, () => void>();
const streamActivityAt = new Map<string, number>();

export function RightSidebar({
  width = 400,
  activeTerminalSessionId,
  expanded,
  onToggleExpanded,
}: RightSidebarProps) {
  const { colors } = useThemeStore();
  const models = useModelStore((s) => s.models);
  const selectedModelId = useModelStore((s) => s.selectedModelId);
  const selectModel = useModelStore((s) => s.selectModel);
  const runtimeStatus = useRuntimeStore((s) => s.status);
  const runtimeStarting = useRuntimeStore((s) => s.starting);
  const runtimeError = useRuntimeStore((s) => s.error);
  const runtimeReady =
    runtimeStatus.running && runtimeStatus.port > 0 && !!runtimeStatus.token;
  const {
    sessions,
    currentSessionId,
    setCurrentSession,
    inputText,
    setInputText,
    addMessage,
    addToolCallMessage,
    updateToolMessageStatus,
    upsertTextMessage,
    addSummaryMessage,
    addThinkingMessage,
    replaceThinkingMessageById,
    demoteTextMessageToThinking,
    removePlaceholderThinkingMessages,
    addErrorMessage,
    markGroupInProgressAsFailure,
    editAndRetry,
    clearMessages,
    loadingSessionIds,
    setSessionLoading,
    newConversation,
    currentAgentId,
    fetchAgents,
    // setCurrentAgentId 不再使用（统一 Agent 后无需切换）
    createServerSession,
  } = useAgentStore();
  const isLoading =
    !!currentSessionId && loadingSessionIds.includes(currentSessionId);
  const runningSessions = useMemo(
    () =>
      loadingSessionIds
        .map((id) => sessions.get(id))
        .filter(
          (session): session is NonNullable<ReturnType<typeof sessions.get>> =>
            !!session,
        ),
    [loadingSessionIds, sessions],
  );
  const allConversationProjects = useAgentStore((s) => s.conversationProjects);
  const activeConversationProjectId = useAgentStore(
    (s) => s.activeConversationProjectId,
  );
  const setActiveConversationProject = useAgentStore(
    (s) => s.setActiveConversationProject,
  );

  const { connections, currentConnectionId } = useConnectionStore();
  const streamStatus = useStreamStore((s) => s.status);
  const localProjects = useLocalFileStore((s) => s.projects);
  const conversationProjects = allConversationProjects;
  const {
    activeBinding,
    bindTerminal,
    inputTags,
    addInputTag,
    removeInputTag,
    getInputTagsContent,
    clearInputTags,
    getTerminalSessionByConnection,
  } = useSshAgentStore();

  // 统一 Agent 后：初始化时自动设置 currentAgentId 为 200000
  useEffect(() => {
    fetchAgents();
    // 如果 currentAgentId 为空或不是 200000，自动切换
    if (!currentAgentId) {
      useAgentStore.getState().setCurrentAgentId("200000");
    }
  }, [fetchAgents]);

  useEffect(() => {
    if (runtimeReady) {
      void useModelStore.getState().fetchModels({ silent: true });
    }
  }, [runtimeReady]);

  useEffect(() => {
    if (!runtimeReady && !runtimeStarting && !runtimeError) {
      void useRuntimeStore
        .getState()
        .start(useLocalFileStore.getState().rootPath ?? undefined);
    }
  }, [runtimeReady, runtimeStarting, runtimeError]);

  const currentSession = currentSessionId
    ? sessions.get(currentSessionId)
    : null;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const [isManualScroll, setIsManualScroll] = useState(false);
  const inputHtmlRef = useRef<string>("");
  const lastRangeRef = useRef<Range | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isDragOverInput, setIsDragOverInput] = useState(false);

  // 拖文件/终端选中/代码片段等加入上下文后，自动恢复输入框焦点（光标置于末尾）
  const prevTagCountRef = useRef(0);
  useEffect(() => {
    const added = inputTags.length > prevTagCountRef.current;
    prevTagCountRef.current = inputTags.length;
    if (!added) return;
    // 等 React 渲染完新 tag 后再回焦，避免焦点停留在刚点击的按钮或拖拽源上
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    });
  }, [inputTags]);
  const [sendOnEnter, setSendOnEnter] = useState(() => {
    return localStorage.getItem("sendOnEnter") !== "false";
  });
  const [showSendModeDropdown, setShowSendModeDropdown] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [showBranchSelector, setShowBranchSelector] = useState(false);
  const [projectBranches, setProjectBranches] = useState<string[]>([]);
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchSwitching, setBranchSwitching] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [errorRecovery, setErrorRecovery] = useState<ErrorRecovery | null>(
    null,
  );

  // --- P2: 快捷键面板 & 导出面板 ---
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [showChatExport, setShowChatExport] = useState(false);
  // --- 历史记录面板 ---
  const { showHistoryPanel, toggleHistoryPanel } = useAgentStore();

  // --- CommandMenu 状态 ---
  const [cmdMenuTrigger, setCmdMenuTrigger] = useState<"/" | "@" | null>(null);
  const [cmdMenuIndex, setCmdMenuIndex] = useState(-1);
  const [cmdMenuQuery, setCmdMenuQuery] = useState("");
  const activeConversationProject = conversationProjects.find(
    (project) => project.id === activeConversationProjectId,
  );
  const linkedProject = localProjects.find(
    (project) => project.id === activeConversationProject?.localProjectId,
  );

  // 可用的 @ 提及列表（动态生成：工程（当前关联 + 其他本地 + 对话项目）+ 已连接的 SSH 服务器 + 固定项）
  const mentionItems: MenuItem[] = useMemo(() => {
    const projectDesc = (p: { path: string; branch?: string | null }) =>
      p.branch ? `${p.branch} · ${p.path}` : p.path;

    // 当前工程：会话已关联的本地工程；若未关联本地工程但会话本身有路径，则关联会话项目
    const currentProjectItems: MenuItem[] = linkedProject
      ? [
          {
            id: `project-${linkedProject.id}`,
            label: linkedProject.name,
            description: projectDesc(linkedProject),
            icon: "🗂️",
            insertText: `@${linkedProject.name}`,
            category: "当前工程",
          },
        ]
      : activeConversationProject && activeConversationProject.path
        ? [
            {
              id: `conv-project-${activeConversationProject.id}`,
              label: activeConversationProject.name,
              description: projectDesc({
                path: activeConversationProject.path,
              }),
              icon: "🗂️",
              insertText: `@${activeConversationProject.name}`,
              category: "当前工程",
            },
          ]
        : [];

    // 其他本地工程：已打开的本地文件夹中排除当前关联工程
    const otherLocalItems: MenuItem[] = localProjects
      .filter((p) => p.id !== linkedProject?.id)
      .map((p) => ({
        id: `project-${p.id}`,
        label: p.name,
        description: projectDesc(p),
        icon: "📦",
        insertText: `@${p.name}`,
        category: "其他工程",
      }));

    // 对话项目：未关联任何本地工程的会话项目（排除当前会话，避免与上面重复）
    const conversationOnlyItems: MenuItem[] = conversationProjects
      .filter(
        (cp) =>
          !cp.localProjectId &&
          cp.id !== activeConversationProjectId &&
          cp.path,
      )
      .map((cp) => ({
        id: `conv-project-${cp.id}`,
        label: cp.name,
        description: projectDesc({ path: cp.path! }),
        icon: "💬",
        insertText: `@${cp.name}`,
        category: "对话项目",
      }));

    const serverItems: MenuItem[] = connections
      .filter((c) => c.status === ConnectionStatus.CONNECTED)
      .map((c) => ({
        id: `server-${c.id}`,
        label: c.name,
        description: `${c.username}@${c.host}:${c.port}`,
        icon: "🖥️",
        insertText: `@${c.name}`,
        category: "服务器",
      }));
    const fixedItems: MenuItem[] = [
      {
        id: "current-file",
        label: "当前文件",
        description: "插入当前打开的文件",
        icon: "📄",
        insertText: "@当前文件",
        category: "上下文",
      },
      {
        id: "current-folder",
        label: "当前目录",
        description: "插入当前工作目录",
        icon: "📁",
        insertText: "@当前目录",
        category: "上下文",
      },
      {
        id: "terminal",
        label: "终端",
        description: "插入终端选中文本",
        icon: "💻",
        insertText: "@终端",
        category: "上下文",
      },
    ];
    // 工程分组排最前，其次服务器，最后固定上下文项
    return [
      ...currentProjectItems,
      ...otherLocalItems,
      ...conversationOnlyItems,
      ...serverItems,
      ...fixedItems,
    ];
  }, [
    connections,
    linkedProject,
    localProjects,
    conversationProjects,
    activeConversationProject,
    activeConversationProjectId,
  ]);

  // --- SSE 心跳超时检测 ---
  useEffect(() => {
    const interval = setInterval(() => {
      const store = useStreamStore.getState();
      // 仅在 streaming/reconnecting 状态下检测心跳超时
      if (
        (store.status === "streaming" || store.status === "reconnecting") &&
        store.isHeartbeatStale()
      ) {
        console.warn("[SSE] heartbeat stale, stream may be dead");
        // 中断当前 fetch，让 agent.ts 的 catch 处理重连
        if (currentSessionId && streamAbortHandlers.has(currentSessionId)) {
          streamAbortHandlers.get(currentSessionId)?.();
          streamAbortHandlers.delete(currentSessionId);
          // 设置重连状态，让 agent.ts 的重试逻辑接管
          store.setRetrying(store.retryCount + 1);
          setSessionLoading(currentSessionId, true);
        }
        // 如果已经在 reconnecting 且超过最大重试，显示错误
        if (
          store.status === "reconnecting" &&
          store.retryCount >= store.maxRetries
        ) {
          store.setError("SSE 连接超时，心跳无响应");
          store.reset();
          if (currentSessionId) setSessionLoading(currentSessionId, false);
        }
      }
    }, 10_000); // 每 10s 检查一次
    return () => clearInterval(interval);
  }, [currentSessionId, setSessionLoading]);

  // --- 输入历史导航（支持文本 + 标签恢复） ---
  interface HistoryEntry {
    text: string;
    tags: Array<
      Pick<InputTag, "label" | "fullContent" | "type" | "connectionInfo">
    >;
  }
  const historyRef = useRef<HistoryEntry[]>([]);
  const historyIndexRef = useRef<number>(-1); // -1 = 当前输入
  const savedInputRef = useRef<string>(""); // 导航前的当前输入
  const savedInputTagsRef = useRef<
    Array<Pick<InputTag, "label" | "fullContent" | "type" | "connectionInfo">>
  >([]); // 导航前的当前标签

  // 从 localStorage 加载历史
  useEffect(() => {
    try {
      const stored = localStorage.getItem("chatInputHistory");
      if (stored) historyRef.current = JSON.parse(stored);
    } catch {}
  }, []);

  // 保存历史到 localStorage
  const saveHistory = (history: HistoryEntry[]) => {
    try {
      // 最多保留 200 条
      const trimmed = history.slice(-200);
      localStorage.setItem("chatInputHistory", JSON.stringify(trimmed));
      historyRef.current = trimmed;
    } catch {}
  };

  // 添加一条历史记录（发送时调用）
  const pushHistory = (
    text: string,
    tags: Array<
      Pick<InputTag, "label" | "fullContent" | "type" | "connectionInfo">
    >,
  ) => {
    if (!text.trim() && tags.length === 0) return;
    const history = [...historyRef.current];
    // 避免连续重复（比较文本+标签数量）
    const last = history[history.length - 1];
    if (last?.text !== text || last?.tags.length !== tags.length) {
      history.push({ text, tags });
      saveHistory(history);
    }
    historyIndexRef.current = -1;
  };

  // 向上导航（更旧的历史）
  const navigateHistoryUp = () => {
    const history = historyRef.current;
    if (history.length === 0) return;
    if (historyIndexRef.current === -1) {
      // 从当前输入开始导航
      savedInputRef.current = inputRef.current?.innerText || "";
      savedInputTagsRef.current = inputTags.map((t) => ({
        label: t.label,
        fullContent: t.fullContent,
        type: t.type,
      }));
      historyIndexRef.current = history.length - 1;
    } else if (historyIndexRef.current > 0) {
      historyIndexRef.current--;
    }
    const entry = history[historyIndexRef.current];
    if (inputRef.current) {
      inputRef.current.innerText = entry.text;
      // 恢复标签
      clearInputTags();
      for (const tag of entry.tags) {
        addInputTag(tag);
      }
      // 光标移到最后
      const range = document.createRange();
      range.selectNodeContents(inputRef.current);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  };

  // 向下导航（更新的历史）
  const navigateHistoryDown = () => {
    const history = historyRef.current;
    if (historyIndexRef.current === -1) return; // 已经在当前输入
    if (historyIndexRef.current < history.length - 1) {
      historyIndexRef.current++;
      const entry = history[historyIndexRef.current];
      if (inputRef.current) inputRef.current.innerText = entry.text;
      // 恢复标签
      clearInputTags();
      for (const tag of entry.tags) {
        addInputTag(tag);
      }
    } else {
      // 回到当前输入
      historyIndexRef.current = -1;
      if (inputRef.current) inputRef.current.innerText = savedInputRef.current;
      // 恢复之前保存的标签
      clearInputTags();
      for (const tag of savedInputTagsRef.current) {
        addInputTag(tag);
      }
    }
    // 光标移到最后
    if (inputRef.current) {
      const range = document.createRange();
      range.selectNodeContents(inputRef.current);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  };

  const {
    openTabs,
    activeTabKey,
    activeConnectionId,
    currentPathByConnection,
  } = useFileExplorerStore();
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const currentKeyLabel = isMac ? "Command + Enter" : "Ctrl + Enter";

  const inputPlaceholder = () => {
    if (
      runtimeStarting ||
      (runtimeStatus.running && runtimeStatus.port === 0)
    ) {
      return "本地 Agent 启动中，请稍候...";
    }
    if (!runtimeReady) {
      return runtimeError || "本地 Agent 未连接，暂不能发送";
    }
    if (sendOnEnter) {
      return isMac
        ? "向 DaMaoSSH 提问...（Enter 发送 · Command + Enter 换行）"
        : "向 DaMaoSSH 提问...（Enter 发送 · Ctrl + Enter 换行）";
    }
    return `向 DaMaoSSH 提问...（${currentKeyLabel} 发送 · Enter 换行）`;
  };

  // 自动滚动到底部（仅在非手动滚动模式）
  useEffect(() => {
    if (!isManualScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [currentSession?.messages, isLoading, isManualScroll]);

  const syncInputTextFromDom = () => {
    if (!inputRef.current) return;
    const text = inputRef.current.innerText.replace(/\u00a0/g, " ");
    setInputText(text);
    inputHtmlRef.current = inputRef.current.innerHTML;
  };

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (
        selection &&
        selection.rangeCount > 0 &&
        inputRef.current &&
        inputRef.current.contains(selection.anchorNode)
      ) {
        lastRangeRef.current = selection.getRangeAt(0).cloneRange();
      }
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);

  useEffect(() => {
    const handleInsertPhrase = (e: Event) => {
      const phrase = (e as CustomEvent<string>).detail;
      if (!phrase || !inputRef.current) return;
      const textNode = document.createTextNode(phrase);
      const selection = window.getSelection();
      const range =
        lastRangeRef.current &&
        inputRef.current.contains(lastRangeRef.current.commonAncestorContainer)
          ? lastRangeRef.current
          : selection &&
              selection.rangeCount > 0 &&
              inputRef.current.contains(selection.anchorNode)
            ? selection.getRangeAt(0)
            : null;

      if (range) {
        range.deleteContents();
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        selection?.removeAllRanges();
        selection?.addRange(range);
      } else {
        inputRef.current.appendChild(textNode);
      }
      inputRef.current.focus();
      syncInputTextFromDom();
    };

    window.addEventListener(
      "damaocode-insert-phrase",
      handleInsertPhrase as EventListener,
    );
    return () =>
      window.removeEventListener(
        "damaocode-insert-phrase",
        handleInsertPhrase as EventListener,
      );
  }, []);

  useEffect(() => {
    const closeDropdown = () => setShowAttachmentMenu(false);
    if (showAttachmentMenu) {
      document.addEventListener("click", closeDropdown);
      return () => document.removeEventListener("click", closeDropdown);
    }
  }, [showAttachmentMenu]);

  useEffect(() => {
    if (!showProjectSelector && !showBranchSelector) return;
    const close = () => {
      setShowProjectSelector(false);
      setShowBranchSelector(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [showProjectSelector, showBranchSelector]);

  useEffect(() => {
    if (!inputRef.current) return;
    if (inputHtmlRef.current === inputRef.current.innerHTML) return;
    if (inputText) return;
    inputRef.current.innerHTML = "";
    inputHtmlRef.current = "";
  }, [inputText]);

  useEffect(() => {
    if (!inputRef.current) return;
    const html = inputRef.current.innerHTML;
    if (html.trim()) {
      inputHtmlRef.current = html;
      return;
    }
    setInputText("");
    inputHtmlRef.current = "";
  }, [inputKey]);

  // --- 全局快捷键：? 打开帮助面板 ---
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // 输入框内不触发，避免干扰正常输入
      const tag = (e.target as HTMLElement)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (e.target as HTMLElement)?.isContentEditable
      )
        return;
      if (e.key === "?") {
        e.preventDefault();
        setShowShortcutHelp((prev) => !prev);
      }
      if (e.key === "Escape") {
        setShowShortcutHelp(false);
        setShowChatExport(false);
        if (useAgentStore.getState().showHistoryPanel)
          useAgentStore.getState().toggleHistoryPanel();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    const autoBindCurrentConnection = async () => {
      if (!activeTerminalSessionId) return;
      if (activeBinding?.terminalSessionId === activeTerminalSessionId) return;
      const connection = currentConnectionId
        ? connections.find((c) => c.id === currentConnectionId)
        : connections.find((c) => c.status === ConnectionStatus.CONNECTED);
      if (!connection || connection.status !== ConnectionStatus.CONNECTED)
        return;
      if (!currentSessionId && currentAgentId) {
        await createServerSession(currentAgentId);
      }
      const sessionId = useAgentStore.getState().currentSessionId;
      if (!sessionId) return;
      const success = await bindTerminal(sessionId, activeTerminalSessionId, {
        connectionId: connection.id,
        connectionName: connection.name,
        host: connection.host,
        port: connection.port,
        username: connection.username,
      });
      if (success) {
      }
    };

    autoBindCurrentConnection();
  }, [
    activeTerminalSessionId,
    activeBinding,
    currentConnectionId,
    connections,
    currentAgentId,
    bindTerminal,
    createServerSession,
  ]);

  const insertTagAtCursor = (tag: {
    id: string;
    label: string;
    type: "terminal-selection" | "file" | "directory" | "custom" | "connection";
    fullContent: string;
  }) => {
    if (!inputRef.current) return;
    // 仅写入 Zustand store（store 渲染层负责显示标签，避免 DOM 插入导致重复）
    addInputTag(tag);
    inputRef.current.focus();
  };

  const handleAddSentContextTag = (
    tag: NonNullable<AgentMessage["contextTags"]>[number],
  ) => {
    if (!tag.fullContent?.trim()) return;
    insertTagAtCursor({
      id: `sent_${Date.now()}`,
      label: tag.label,
      fullContent: tag.fullContent,
      type:
        tag.kind === "terminal"
          ? "terminal-selection"
          : tag.kind === "file" ||
              tag.kind === "directory" ||
              tag.kind === "connection"
            ? tag.kind
            : "custom",
    });
  };

  const handleAddCurrentFile = () => {
    // 先检查本地文件
    const localTab = useLocalFileStore
      .getState()
      .openTabs.find(
        (t) =>
          !isLocalDiffTab(t) &&
          t.key === useLocalFileStore.getState().activeTabKey,
      ) as LocalOpenTab | undefined;
    if (localTab && localTab.content) {
      insertTagAtCursor({
        id: `file_${Date.now()}`,
        label: `文件: ${localTab.name}`,
        fullContent: `本地文件: ${localTab.path}\n\n\`\`\`\n${localTab.content}\n\`\`\``,
        type: "file",
      });
      setShowAttachmentMenu(false);
      return;
    }
    // 远程文件
    if (!activeTabKey) return;
    const tab = openTabs.find((t) => t.key === activeTabKey);
    if (!tab || isDiffTab(tab) || !tab.content) return;
    insertTagAtCursor({
      id: `file_${Date.now()}`,
      label: `文件: ${tab.name}`,
      fullContent: `文件路径: ${tab.path}\n\n${tab.content}`,
      type: "file",
    });
    setShowAttachmentMenu(false);
  };

  const handleAddCurrentFolder = () => {
    if (!activeConnectionId) return;
    const cwd = currentPathByConnection[activeConnectionId] || "/";
    const children =
      useFileExplorerStore.getState().childrenByConnection[
        activeConnectionId
      ]?.[cwd];
    let filesList = "";
    if (children && children.length > 0) {
      filesList =
        `\n目录内容预览:\n` +
        children
          .map((c) => `  ${c.directory ? "📁" : "📄"} ${c.name}`)
          .join("\n");
    }
    insertTagAtCursor({
      id: `folder_${Date.now()}`,
      label: `目录: ${cwd}`,
      fullContent: `当前操作目录: ${cwd}${filesList}`,
      type: "directory",
    });
    setShowAttachmentMenu(false);
  };

  const handleAddSelectedText = () => {
    // @ts-ignore
    const editor = window.__activeMonacoEditor;
    if (editor) {
      const selection = editor.getSelection();
      const text = editor.getModel()?.getValueInRange(selection);
      if (text) {
        // 检查是本地文件还是远程文件
        const localTab = useLocalFileStore
          .getState()
          .openTabs.find(
            (t) => t.key === useLocalFileStore.getState().activeTabKey,
          );
        const remoteTab = useFileExplorerStore
          .getState()
          .openTabs.find(
            (t) => t.key === useFileExplorerStore.getState().activeTabKey,
          );

        const filePath = localTab?.path || remoteTab?.path || "unknown";
        const fileName = localTab?.name || remoteTab?.name || "unknown";
        const prefix = localTab ? "本地文件" : "远程文件";

        const startLine = selection.startLineNumber;
        const endLine = selection.endLineNumber;
        const lineRange =
          startLine === endLine
            ? `第 ${startLine} 行`
            : `第 ${startLine}-${endLine} 行`;

        insertTagAtCursor({
          id: `sel_${Date.now()}`,
          label: `选中: ${fileName} (${lineRange})`,
          fullContent: `${prefix}: ${filePath} (${lineRange})\n选中的代码/文本:\n\`\`\`\n${text}\n\`\`\``,
          type: "terminal-selection",
        });
      }
    }
    setShowAttachmentMenu(false);
  };

  const addDroppedPath = async (path: string) => {
    try {
      const fileInfo = await stat(path);
      const name =
        path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || path;

      if (fileInfo.isDirectory) {
        const children = await useLocalFileStore
          .getState()
          .readDirectory(path, 1);
        const preview = children
          .slice(0, 30)
          .map((child) => `${child.directory ? "📁" : "📄"} ${child.name}`)
          .join("\n");
        addInputTag({
          label: `目录: ${name}`,
          fullContent: `本地目录: ${path}\n\n目录内容:\n${preview || "（空目录）"}${children.length > 30 ? "\n..." : ""}`,
          type: "directory",
        });
        return;
      }

      const content = await useLocalFileStore.getState().readFileContent(path);
      const safeContent =
        content == null
          ? "（无法读取文件内容）"
          : content.length > 200_000
            ? `${content.slice(0, 200_000)}\n\n[文件内容过长，已截断]`
            : content;
      addInputTag({
        label: `文件: ${name}`,
        fullContent: `本地文件: ${path}\n\n\`\`\`\n${safeContent}\n\`\`\``,
        type: "file",
      });
    } catch (error) {
      console.error("[RightSidebar] dropped file read failed:", path, error);
      addInputTag({
        label: `文件: ${path.split("/").pop() || path}`,
        fullContent: `本地文件: ${path}\n\n（无法读取文件内容）`,
        type: "file",
      });
    }
  };

  const readNativeEntry = async (
    entry: any,
    depth = 0,
  ): Promise<{ label: string; isDirectory: boolean }[]> => {
    if (!entry) return [];
    if (entry.isFile) {
      return [{ label: `📄 ${entry.name || "文件"}`, isDirectory: false }];
    }
    if (entry.isDirectory && depth < 1) {
      const reader = entry.createReader();
      const entries = await new Promise<any[]>((resolve, reject) => {
        const all: any[] = [];
        const readBatch = () =>
          reader.readEntries((batch: any[]) => {
            if (!batch.length) return resolve(all);
            all.push(...batch);
            readBatch();
          }, reject);
        readBatch();
      });
      const result = await Promise.all(
        entries.map((child) => readNativeEntry(child, depth + 1)),
      );
      return result.flat();
    }
    if (entry.isDirectory)
      return [{ label: `📁 ${entry.name || "目录"}`, isDirectory: true }];
    return [];
  };

  const handleNativeDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOverInput(false);
    const localPaths =
      event.dataTransfer.getData("application/x-damaocode-local-path") ||
      event.dataTransfer.getData("text/plain");
    if (localPaths) {
      const paths = localPaths
        .split(/\r?\n/)
        .map((path) => path.trim())
        .filter(Boolean);
      if (paths.length) {
        await Promise.all(paths.map((path) => addDroppedPath(path)));
        return;
      }
    }
    const items = Array.from(event.dataTransfer.items);
    if (!items.some((item) => item.kind === "file")) {
      const text = event.dataTransfer.getData("text/plain");
      if (text) {
        addInputTag({
          label: `文本: ${text.slice(0, 40)}`,
          fullContent: text,
          type: "custom",
        });
      }
      return;
    }
    const entries = items
      .map((item) => (item as any).webkitGetAsEntry?.())
      .filter(Boolean);
    if (!entries.length) return;
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.isFile) {
          const file: File = await new Promise((resolve, reject) =>
            entry.file(resolve, reject),
          );
          const text = await file.text();
          addInputTag({
            label: `文件: ${entry.name || file.name}`,
            fullContent: `本地文件: ${entry.fullPath || file.name}\n\n\`\`\`\n${text.slice(0, 200_000)}${text.length > 200_000 ? "\n\n[文件内容过长，已截断]" : ""}\n\`\`\``,
            type: "file",
          });
          return;
        }
        const children = await readNativeEntry(entry);
        const preview = children
          .slice(0, 30)
          .map((child) => child.label)
          .join("\n");
        addInputTag({
          label: `目录: ${entry.name}`,
          fullContent: `本地目录: ${entry.fullPath || entry.name}\n\n目录内容:\n${preview || "（空目录）"}${children.length > 30 ? "\n..." : ""}`,
          type: "directory",
        });
      }),
    );
  };

  const switchConversationProject = async (projectId: string) => {
    const project = conversationProjects.find((item) => item.id === projectId);
    if (!project) return;

    setActiveConversationProject(projectId);
    const linkedProject = localProjects.find(
      (item) => item.id === project.localProjectId,
    );
    if (linkedProject) {
      window.dispatchEvent(new CustomEvent("open-local-project"));
    }

    const projectSessions = Array.from(
      useAgentStore.getState().sessions.values(),
    )
      .filter((session) => session.projectId === projectId)
      .sort(
        (a, b) =>
          (b.messages.at(-1)?.timestamp || b.createdAt) -
          (a.messages.at(-1)?.timestamp || a.createdAt),
      );
    const latestSession = projectSessions[0];

    if (latestSession) {
      setCurrentSession(latestSession.id);
    } else if (currentAgentId) {
      await useAgentStore.getState().newConversation(currentAgentId, projectId);
    }
  };

  const toggleBranchSelector = async () => {
    const nextValue = !showBranchSelector;
    setShowBranchSelector(nextValue);
    setShowProjectSelector(false);
    if (!nextValue || !linkedProject) return;

    setBranchLoading(true);
    setBranchError(null);
    const projectId = linkedProject.id;
    try {
      await useLocalFileStore.getState().refreshGitBranch(linkedProject.path);
      const branches = await useLocalFileStore
        .getState()
        .listProjectBranches(projectId);
      const projectExists = useLocalFileStore
        .getState()
        .projects.some((item) => item.id === projectId);
      if (projectExists) setProjectBranches(branches);
    } catch {
      setProjectBranches([]);
      setBranchError("分支列表加载失败");
    } finally {
      setBranchLoading(false);
    }
  };

  const switchProjectBranch = async (branch: string) => {
    if (!linkedProject || branchSwitching || branch === linkedProject.branch)
      return;
    setBranchSwitching(true);
    setBranchError(null);
    const success = await useLocalFileStore
      .getState()
      .switchProjectBranch(linkedProject.id, branch);
    setBranchSwitching(false);
    if (success) {
      setShowBranchSelector(false);
      setProjectBranches([]);
    } else {
      setBranchError("切换失败，请检查未提交变更");
    }
  };

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void getCurrentWindow()
      .onDragDropEvent((event) => {
        const rect = inputRef.current?.getBoundingClientRect();
        const scale = window.devicePixelRatio || 1;
        const position =
          "position" in event.payload ? event.payload.position : null;
        const inside =
          rect && position
            ? position.x / scale >= rect.left &&
              position.x / scale <= rect.right &&
              position.y / scale >= rect.top &&
              position.y / scale <= rect.bottom
            : false;

        if (event.payload.type === "enter" || event.payload.type === "over") {
          setIsDragOverInput(inside);
          return;
        }
        if (event.payload.type === "drop") {
          setIsDragOverInput(false);
          if (inside && !disposed) {
            void Promise.all(
              event.payload.paths.map((path) => addDroppedPath(path)),
            );
          }
          return;
        }
        setIsDragOverInput(false);
      })
      .then((dispose) => {
        if (disposed) dispose();
        else unlisten = dispose;
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const handleSend = async () => {
    if (isLoading || !currentAgentId || !inputRef.current) return;
    // 发送新消息时取消手动滚动，自动滚到底部
    setIsManualScroll(false);
    // 清除之前的错误恢复卡片
    setErrorRecovery(null);
    const plainText = inputRef.current.innerText.replace(/\u00a0/g, " ").trim();
    if ((!plainText && inputTags.length === 0) || isLoading) return;

    if (!runtimeReady) {
      await useRuntimeStore
        .getState()
        .start(useLocalFileStore.getState().rootPath ?? undefined);
      const readyStatus = useRuntimeStore.getState().status;
      if (!(readyStatus.running && readyStatus.port > 0 && readyStatus.token)) {
        setErrorRecovery({
          type: "unknown",
          title: "本地 Agent 未连接",
          message:
            useRuntimeStore.getState().error ||
            "请重启 DaMaoCode-Study 或查看运行状态。",
        });
        return;
      }
    }

    // 保存到输入历史（文本 + 标签）
    if (plainText || inputTags.length > 0) {
      pushHistory(
        plainText,
        inputTags.map((t) => ({
          label: t.label,
          fullContent: t.fullContent,
          type: t.type,
        })),
      );
    }

    if (!currentSessionId) {
      await createServerSession(currentAgentId);
    }
    const sessionId = useAgentStore.getState().currentSessionId;
    if (!sessionId) return;

    let messageContent = plainText;
    // displayContent 始终用纯文本/Markdown 格式，不用 domHtml（原始 HTML 含 <span> 标签会导致渲染异常）
    let displayContent = plainText;

    // 提取图片的 inlineDatas（传给后端 AI 模型的多模态数据）
    const inlineDatas: { data: string; mimeType: string }[] = [];
    inputTags.forEach((tag) => {
      const dataUrlMatch = tag.fullContent.match(
        /data:image\/([a-zA-Z]+);base64,([A-Za-z0-9+/=]+)/,
      );
      if (dataUrlMatch) {
        inlineDatas.push({
          mimeType: `image/${dataUrlMatch[1]}`,
          data: dataUrlMatch[2],
        });
      }
    });

    const tagsContent = getInputTagsContent();
    if (tagsContent) {
      // messageContent 发给后端：按标签类型结构化注入，避免历史上下文误导当前意图
      const serverTagParts: string[] = [];
      inputTags.forEach((tag) => {
        const dataUrlMatch = tag.fullContent.match(
          /(data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+)/,
        );
        if (dataUrlMatch) {
          serverTagParts.push(`[用户上传了图片: ${tag.label}]`);
          return;
        }
        // 按标签类型明确标注角色，让 AI 区分"操作目标"和"参考信息"
        if (tag.type === "directory") {
          serverTagParts.push(
            `[当前操作目标目录: ${tag.label}]\n${tag.fullContent}`,
          );
        } else if (tag.type === "file") {
          serverTagParts.push(
            `[当前操作目标文件: ${tag.label}]\n${tag.fullContent}`,
          );
        } else if (tag.type === "connection") {
          serverTagParts.push(
            `[当前SSH连接: ${tag.label}]\n${tag.fullContent}`,
          );
        } else if (tag.type === "project") {
          serverTagParts.push(
            `[对话目标工程: ${tag.label}]\n${tag.fullContent}`,
          );
        } else if (tag.type === "terminal-selection") {
          serverTagParts.push(
            `[终端选区参考: ${tag.label}]\n${tag.fullContent}`,
          );
        } else {
          serverTagParts.push(tag.fullContent);
        }
      });
      const formattedServerTags = serverTagParts
        .join("\n\n---\n\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      // 明确告知 AI：用户当前意图由文本决定，标签仅提供操作目标/上下文
      const intentHint = plainText
        ? `${plainText}\n\n**当前操作目标和上下文（请以用户文本意图为准）：**\n${formattedServerTags}`
        : `**当前操作目标和上下文：**\n${formattedServerTags}`;
      messageContent = intentHint;

      displayContent = plainText;
    }

    // SSH 服务器上下文：优先使用用户 @ 选择的服务器标签，否则自动查找已绑定/已连接的连接
    const connectionTag = inputTags.find((t) => t.type === "connection");
    let sshContextConn: {
      connectionId: string;
      connectionName: string;
      host: string;
      port: number;
      username: string;
    } | null = null;
    if (connectionTag?.connectionInfo) {
      sshContextConn = connectionTag.connectionInfo;
    } else {
      const selectedConn = activeBinding
        ? connections.find((c) => c.id === activeBinding.connectionId)
        : connections.find(
            (c) =>
              c.id === currentConnectionId &&
              c.status === ConnectionStatus.CONNECTED,
          );
      if (selectedConn) {
        sshContextConn = {
          connectionId: selectedConn.id,
          connectionName: selectedConn.name,
          host: selectedConn.host,
          port: selectedConn.port,
          username: selectedConn.username,
        };
      }
    }
    if (sshContextConn) {
      const serverContext = `当前服务器：${sshContextConn.connectionName} (${sshContextConn.username}@${sshContextConn.host}:${sshContextConn.port})`;
      messageContent = `${serverContext}\n\n${messageContent}`;
    }

    const selectedModelId = useModelStore.getState().selectedModelId;

    const groupId = `group_${Date.now()}`;
    const contextTags = inputTags.map((tag) => {
      const imageDataUrl = tag.fullContent.match(
        /(data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+)/,
      )?.[1];
      return {
        label: tag.label,
        kind:
          tag.type === "directory"
            ? ("directory" as const)
            : tag.type === "file"
              ? ("file" as const)
              : tag.type === "connection"
                ? ("connection" as const)
                : tag.type === "project"
                  ? ("project" as const)
                  : imageDataUrl
                    ? ("image" as const)
                    : tag.label.includes("终端")
                      ? ("terminal" as const)
                      : ("custom" as const),
        imageDataUrl,
        fullContent: tag.fullContent,
      };
    });
    const userMessage: AgentMessage = {
      id: `msg_${Date.now()}`,
      role: "user",
      content: displayContent,
      timestamp: Date.now(),
      messageType: "text",
      groupId,
      contextTags,
    };
    addMessage(sessionId, userMessage);
    setInputText("");
    setSessionLoading(sessionId, true);

    // 清空输入框内容（包括文件标签）
    clearInputTags();
    if (inputRef.current) {
      inputRef.current.innerHTML = "";
      inputHtmlRef.current = "";
      setInputKey((k) => k + 1);
    }

    // 多消息流模式：不需要预创建 assistant 消息，各类型消息由回调动态创建
    // 但需要立即创建一个"思考中"占位消息，避免用户以为死机
    addThinkingMessage(sessionId, groupId, "思考中...");
    let textMsgId = ""; // 同一 groupId 下只有一条 text 消息，onText 时 upsert
    const toolCallMsgMap = new Map<string, string>(); // toolCallId → msgId 映射
    const processSegmentMessages = new Map<number, string>();

    // 更新 SSE 流状态
    useStreamStore.getState().setStatus("connecting");
    useStreamStore.getState().touchActivity();
    streamActivityAt.set(sessionId, Date.now());

    streamAbortHandlers.set(
      sessionId,
      agentApi.reactChatStream(
        currentAgentId,
        "default",
        sessionId,
        messageContent,
        (step: ReActStep) => {
          // ── 多消息流：每个 step 生成独立消息 ──
          if (step.stepType === "thinking") {
            // 降级信号：此前流式渲染的「临时最终答案」被确认是过程说明 → text 消息转为 thinking 身份
            if (step.demotePendingText) {
              if (textMsgId) {
                demoteTextMessageToThinking(sessionId, textMsgId);
                // 降级后的消息成为已完结过程段，下一段文本另起新临时答案
                textMsgId = "";
              }
              return;
            }
            // 临时最终答案：text 事件流式推送（截至当前全文），直接 upsert 到 text 消息实时渲染；
            // 身份未定——后续若无工具调用，done 就地转正；若有，先降级为 thinking
            if (step.isFinalText) {
              const content = step.content?.trim();
              if (!content) return;
              textMsgId = upsertTextMessage(sessionId, groupId, content);
            } else {
              const content = step.content?.trim();
              if (
                !content ||
                content === "思考中..." ||
                content.startsWith("步骤")
              )
                return;
              const existingMessageId = processSegmentMessages.get(
                step.stepIndex,
              );
              if (existingMessageId) {
                replaceThinkingMessageById(
                  sessionId,
                  existingMessageId,
                  content,
                );
              } else {
                const messageId = addThinkingMessage(
                  sessionId,
                  groupId,
                  content,
                );
                processSegmentMessages.set(step.stepIndex, messageId);
              }
            }
            useStreamStore.getState().setStatus("streaming");
            useStreamStore.getState().touchActivity();
            streamActivityAt.set(sessionId, Date.now());
          } else if (step.stepType === "tool_call") {
            if (step.status === "in_progress") {
              const msgId = addToolCallMessage(
                sessionId,
                groupId,
                step.toolCallId || `tc_${Date.now()}`,
                step.toolName || "unknown",
                step.toolParams || "",
              );
              if (step.toolCallId) toolCallMsgMap.set(step.toolCallId, msgId);

              // 命令执行工具 → 写入输出面板
              const commandExecTools = [
                "executeLocalCommand",
                "compileProject",
                "compileTests",
                "runUnitTests",
                "executeSshCommand",
              ];
              if (step.toolName && commandExecTools.includes(step.toolName)) {
                useOutputStore.getState().addEntry({
                  sessionId: `step-${step.stepIndex}`,
                  command: step.toolParams || "",
                  status: "running",
                  stdout: "",
                  stderr: "",
                  exitCode: null,
                  durationMs: null,
                });
              }
            } else if (step.status === "success" || step.status === "failure") {
              // 更新工具消息状态：先按 toolCallId 匹配，找不到则按 toolName 匹配最后一条 in_progress 消息
              const tcId = step.toolCallId || "";
              let msgId = tcId ? toolCallMsgMap.get(tcId) : undefined;
              if (!msgId && step.toolName) {
                const session = useAgentStore
                  .getState()
                  .sessions.get(sessionId);
                if (session) {
                  const match = [...session.messages]
                    .reverse()
                    .find(
                      (m) =>
                        m.messageType === "tool_call" &&
                        m.toolName === step.toolName &&
                        m.status === "in_progress" &&
                        m.groupId === groupId,
                    );
                  if (match) msgId = match.id;
                }
              }
              if (msgId)
                updateToolMessageStatus(
                  sessionId,
                  msgId,
                  step.status,
                  step.toolResult,
                );

              // 命令执行工具完成 → 更新输出面板
              const commandExecTools = [
                "executeLocalCommand",
                "compileProject",
                "compileTests",
                "runUnitTests",
                "executeSshCommand",
              ];
              if (step.toolName && commandExecTools.includes(step.toolName)) {
                const outputStore = useOutputStore.getState();
                const entrySessionId = `step-${step.stepIndex}`;
                let stdout = "",
                  stderr = "",
                  exitCode = -1,
                  durationMs = 0;
                if (step.toolResult) {
                  try {
                    const r = JSON.parse(step.toolResult);
                    stdout = r.output || r.stdout || "";
                    stderr = r.stderr || "";
                    exitCode = r.exitCode ?? -1;
                    durationMs = r.timeoutMs || 0;
                  } catch {
                    stdout = step.toolResult;
                  }
                }
                if (
                  outputStore.entries.find(
                    (e) => e.sessionId === entrySessionId,
                  )
                ) {
                  outputStore.updateEntry(entrySessionId, {
                    status: step.status === "success" ? "success" : "failed",
                    stdout,
                    stderr,
                    exitCode,
                    durationMs,
                  });
                } else {
                  outputStore.addEntry({
                    sessionId: entrySessionId,
                    command: step.toolParams || "",
                    status: step.status === "success" ? "success" : "failed",
                    stdout,
                    stderr: "",
                    exitCode,
                    durationMs: 0,
                  });
                }
              }

              // 本地命令执行完成 → 可能通过 rm/mv/构建产物等方式改动了文件 → 刷新本地文件树
              const localCommandTools = [
                "executeLocalCommand",
                "compileProject",
                "compileTests",
                "runUnitTests",
              ];
              if (step.toolName && localCommandTools.includes(step.toolName)) {
                const localStore = useLocalFileStore.getState();
                if (localStore.rootPath)
                  localStore
                    .refreshDirectory(localStore.rootPath)
                    .catch(() => {});
              }

              // 文件操作工具完成 → 刷新文件树 + 重载编辑器
              if (step.toolName) {
                const fileWriteTools = [
                  "writeLocalFile",
                  "createLocalFile",
                  "deleteLocalFile",
                  "writeFile",
                  "createFile",
                  "deleteFile",
                  "editLocalFile",
                  "editFile",
                  "editRemoteFile",
                  "writeRemoteFile",
                  "CodeEditTool",
                  "CodeEdit",
                  "applyEdit",
                  "applyEditTool",
                ];
                const isFileWriteTool =
                  fileWriteTools.includes(step.toolName) ||
                  step.toolName.toLowerCase().includes("edit") ||
                  step.toolName.toLowerCase().includes("write");
                if (isFileWriteTool) {
                  const payload = parseToolResultPayload(step.toolResult);
                  let changedPath =
                    (payload?.path as string | undefined) ||
                    (step.toolParams && /^\//.test(step.toolParams.trim())
                      ? step.toolParams.trim()
                      : step.toolParams?.match(/(\/\w[\w./-]+\.[\w]+)/)?.[1]) ||
                    step.toolResult?.match(/([\/][\w./-]+\.[\w]+)/)?.[1];

                  const isLocalTool = step.toolName.includes("Local");
                  const isDeleteOp =
                    step.toolName === "deleteLocalFile" ||
                    step.toolName === "deleteFile";

                  if (isLocalTool) {
                    const localStore = useLocalFileStore.getState();
                    if (changedPath && !isDeleteOp) {
                      const localTab = localStore.openTabs.find(
                        (t) => !isLocalDiffTab(t) && t.path === changedPath,
                      ) as LocalOpenTab | undefined;
                      const before = localTab?.content ?? "";
                      if (localTab) {
                        // 文件已打开 → reload 更新 tab 内容 + 创建 preview
                        localStore
                          .reloadFileByPath(changedPath)
                          .then((after) => {
                            if (after != null && after !== before)
                              useAiPatchStore.getState().upsertPreview({
                                target: "local",
                                path: changedPath!,
                                toolName: step.toolName!,
                                beforeContent: before,
                                afterContent: after,
                              });
                          })
                          .catch(() => {});
                      } else {
                        // 文件未打开 → 直接读取文件内容创建 preview（beforeContent 为空）
                        localStore
                          .readFileContent(changedPath)
                          .then((after) => {
                            if (after != null)
                              useAiPatchStore.getState().upsertPreview({
                                target: "local",
                                path: changedPath!,
                                toolName: step.toolName!,
                                beforeContent: "",
                                afterContent: after,
                              });
                          })
                          .catch(() => {});
                      }
                    }
                    if (!changedPath) {
                      const activeTab = localStore.openTabs.find(
                        (t) => t.key === localStore.activeTabKey,
                      );
                      if (activeTab && !isDeleteOp)
                        localStore
                          .reloadFileByPath(activeTab.path)
                          .catch(() => {});
                    }
                    const dir = changedPath
                      ? changedPath.substring(0, changedPath.lastIndexOf("/"))
                      : null;
                    if (dir) localStore.refreshDirectory(dir).catch(() => {});
                    else if (localStore.rootPath)
                      localStore
                        .refreshDirectory(localStore.rootPath)
                        .catch(() => {});
                  }

                  if (!isLocalTool) {
                    const connId =
                      activeBinding?.connectionId || currentConnectionId;
                    if (connId) {
                      const fileStore = useFileExplorerStore.getState();
                      if (changedPath && !isDeleteOp) {
                        const remoteTab = fileStore.openTabs.find(
                          (t) =>
                            !isDiffTab(t) &&
                            t.connectionId === connId &&
                            t.path === changedPath,
                        );
                        const before =
                          remoteTab && !isDiffTab(remoteTab)
                            ? remoteTab.content
                            : "";
                        if (remoteTab && !isDiffTab(remoteTab)) {
                          // 远程文件已打开 → reload 更新 tab 内容 + 创建 preview
                          fileStore
                            .reloadFileByPath(connId, changedPath)
                            .then((after) => {
                              if (after != null && after !== before)
                                useAiPatchStore.getState().upsertPreview({
                                  target: "remote",
                                  path: changedPath!,
                                  connectionId: connId,
                                  toolName: step.toolName!,
                                  beforeContent: before,
                                  afterContent: after,
                                });
                            })
                            .catch(() => {});
                        } else {
                          // 远程文件未打开 → 通过 API 读取文件内容创建 preview（beforeContent 为空）
                          fileStore
                            .readRemoteFileContent(connId, changedPath)
                            .then((after) => {
                              if (after != null)
                                useAiPatchStore.getState().upsertPreview({
                                  target: "remote",
                                  path: changedPath!,
                                  connectionId: connId,
                                  toolName: step.toolName!,
                                  beforeContent: "",
                                  afterContent: after,
                                });
                            })
                            .catch(() => {});
                        }
                      }
                      if (!changedPath) {
                        const activeTab = fileStore.openTabs.find(
                          (t) =>
                            t.connectionId === connId &&
                            t.key === fileStore.activeTabKey,
                        );
                        if (activeTab && !isDeleteOp)
                          fileStore
                            .reloadFileByPath(connId, activeTab.path)
                            .catch(() => {});
                      }
                      const dir = changedPath
                        ? changedPath.substring(0, changedPath.lastIndexOf("/"))
                        : null;
                      if (dir)
                        fileStore.refreshDirectory(connId, dir).catch(() => {});
                    }
                  }
                }
              }
            }
          }
        },
        (fullText: string) => {
          // 兼容非流式降级；主链路的过程说明已通过 thinking 分段推送
          textMsgId = textMsgId;
          if (fullText) useStreamStore.getState().touchActivity();
          useStreamStore.getState().setStatus("streaming");
          streamActivityAt.set(sessionId, Date.now());
        },
        (finalContent: string) => {
          // 只清掉占位；真实过程段保留为浅色可折叠历史
          removePlaceholderThinkingMessages(sessionId, groupId);
          if (finalContent && textMsgId) {
            upsertTextMessage(sessionId, groupId, finalContent);
          } else if (finalContent && !textMsgId) {
            upsertTextMessage(sessionId, groupId, finalContent);
          }
          streamAbortHandlers.delete(sessionId);
          setSessionLoading(sessionId, false);
          // 仅在无错误时重置 streamStore（部分交付时 onError 已先触发）
          const streamState = useStreamStore.getState();
          if (streamState.status !== "error") {
            streamState.reset();
          }
          const outputStore = useOutputStore.getState();
          outputStore.entries.forEach((entry) => {
            if (
              entry.status === "running" &&
              entry.sessionId.startsWith("tool-")
            ) {
              outputStore.updateEntry(entry.sessionId, { status: "success" });
            }
          });
        },
        (err: string) => {
          console.error("[reactChatStream] error:", err);
          streamAbortHandlers.delete(sessionId);
          setSessionLoading(sessionId, false);
          useStreamStore.getState().setError(err);

          // 错误时清除占位 thinking 消息
          removePlaceholderThinkingMessages(sessionId, groupId);

          const userFriendlyMsg = extractErrorMessage(err);
          addErrorMessage(sessionId, groupId, `请求失败: ${userFriendlyMsg}`);

          let errorType: ErrorRecovery["type"] = "unknown";
          let errorTitle = "对话已中断";
          if (
            err.includes("network") ||
            err.includes("Failed to fetch") ||
            err.includes("fetch") ||
            err.includes("NetworkError") ||
            err.includes("Failed")
          ) {
            errorType = "network";
            errorTitle = "网络连接异常";
          } else if (
            err.includes("413") ||
            err.includes("too large") ||
            err.includes("payload")
          ) {
            errorType = "context_limit";
            errorTitle = "请求体过大";
          } else if (err.includes("timeout") || err.includes("超时")) {
            errorType = "network";
            errorTitle = "连接超时";
          } else if (
            err.includes("500") ||
            err.includes("502") ||
            err.includes("503") ||
            err.includes("504")
          ) {
            errorType = "network";
            errorTitle = "服务暂时不可用";
          }
          setErrorRecovery({
            type: errorType,
            title: errorTitle,
            message: userFriendlyMsg,
            details: userFriendlyMsg !== err ? err : undefined,
          });
        },
        // terminalSessionId：优先使用 @ 服务器标签对应终端会话
        (() => {
          if (connectionTag?.connectionInfo) {
            const tsId = getTerminalSessionByConnection(
              connectionTag.connectionInfo.connectionId,
            );
            if (tsId) return tsId;
          }
          return activeTerminalSessionId || undefined;
        })(),
        // onTaskBreakdown
        (_breakdown: TaskBreakdownDTO) => {
          // TODO: 多消息流模式下需要新建 task_breakdown 类型消息
        },
        // onTaskProgress
        (_progress) => {},
        // onSubAgent
        (_subAgentInfo) => {},
        // onChangeSummary
        (changeSummary) => {
          addSummaryMessage(sessionId, groupId, changeSummary);

          const changedFiles = [
            ...(changeSummary.modified || []),
            ...(changeSummary.created || []),
          ];
          if (changedFiles.length === 0) return;

          const localStore = useLocalFileStore.getState();
          const patchStore = useAiPatchStore.getState();
          const connId = activeBinding?.connectionId || currentConnectionId;

          for (const file of changedFiles) {
            // ── 本地文件变更 → 创建 AiPatchPreview ──
            const localTab = localStore.openTabs.find(
              (t) => !isLocalDiffTab(t) && t.path === file.path,
            ) as LocalOpenTab | undefined;
            if (localTab) {
              const before = localTab.content ?? "";
              localStore
                .reloadFileByPath(file.path)
                .then((after) => {
                  if (after != null && after !== before) {
                    patchStore.upsertPreview({
                      target: "local",
                      path: file.path,
                      toolName:
                        file.kind === "create"
                          ? "createLocalFile"
                          : "writeLocalFile",
                      beforeContent: before,
                      afterContent: after,
                    });
                  }
                })
                .catch(() => {});
            } else if (localStore.rootPath) {
              // 文件未在编辑器打开 → 读取当前内容作为 afterContent
              const fullPath = file.path.startsWith("/")
                ? file.path
                : `${localStore.rootPath}/${file.path}`;
              localStore
                .readFileContent(fullPath)
                .then((after) => {
                  if (after != null) {
                    patchStore.upsertPreview({
                      target: "local",
                      path: fullPath,
                      toolName:
                        file.kind === "create"
                          ? "createLocalFile"
                          : "writeLocalFile",
                      beforeContent: "", // 未打开的文件无 beforeContent
                      afterContent: after,
                    });
                  }
                })
                .catch(() => {});
            }

            // ── 远程文件变更 → 创建 AiPatchPreview ──
            if (connId) {
              const fileStore = useFileExplorerStore.getState();
              const remoteTab = fileStore.openTabs.find(
                (t) =>
                  !isDiffTab(t) &&
                  t.connectionId === connId &&
                  t.path === file.path,
              );
              if (remoteTab && !isDiffTab(remoteTab)) {
                const before = remoteTab.content ?? "";
                fileStore
                  .reloadFileByPath(connId, file.path)
                  .then((after) => {
                    if (after != null && after !== before) {
                      patchStore.upsertPreview({
                        target: "remote",
                        path: file.path,
                        connectionId: connId,
                        toolName:
                          file.kind === "create" ? "createFile" : "writeFile",
                        beforeContent: before,
                        afterContent: after,
                      });
                    }
                  })
                  .catch(() => {});
              } else {
                // 远程文件未在编辑器打开 → 通过 API 读取 afterContent
                fileStore
                  .readRemoteFileContent(connId, file.path)
                  .then((after) => {
                    if (after != null) {
                      patchStore.upsertPreview({
                        target: "remote",
                        path: file.path,
                        connectionId: connId,
                        toolName:
                          file.kind === "create" ? "createFile" : "writeFile",
                        beforeContent: "",
                        afterContent: after,
                      });
                    }
                  })
                  .catch(() => {});
              }
            }
          }
        },
        // projectContext: 注入当前打开的工程信息（本地文件夹 + 远程 SSH）
        (() => {
          const localStore = useLocalFileStore.getState();
          const agentStore = useAgentStore.getState();
          const conversationProject = agentStore.conversationProjects.find(
            (item) => item.id === agentStore.activeConversationProjectId,
          );
          const activeLocalProject = localStore.projects.find(
            (item) => item.id === localStore.activeLocalProjectId,
          );
          const linkedLocalProject = localStore.projects.find(
            (item) => item.id === conversationProject?.localProjectId,
          );
          const selectedLocalProject = linkedLocalProject || activeLocalProject;

          if (selectedLocalProject?.path) {
            return {
              name: conversationProject?.name || selectedLocalProject.name,
              rootPath: selectedLocalProject.path,
              branch: selectedLocalProject.branch || null,
            };
          }

          // 兜底：取远程 SSH 文件树的当前工作目录
          const remoteCwd = currentPathByConnection[activeConnectionId || ""];
          if (remoteCwd) {
            const name = remoteCwd.split("/").filter(Boolean).pop() || "";
            return name ? { name, rootPath: remoteCwd } : null;
          }
          return null;
        })(),
        // ── 新增 SSE 事件回调 ──
        // onPermissionConfirm: 权限确认请求 → 推入 permissionStore
        (permissionData) => {
          usePermissionStore.getState().pushConfirmation({
            ...permissionData,
            arrivedAt: Date.now(),
          });
        },
        // onToolOutput: 工具实时输出片段 → 更新输出面板
        (toolCallId, outputChunk) => {
          const outputStore = useOutputStore.getState();
          const entrySessionId = `tool-${toolCallId}`;
          const existing = outputStore.entries.find(
            (e) => e.sessionId === entrySessionId,
          );
          if (existing) {
            outputStore.updateEntry(entrySessionId, {
              stdout: (existing.stdout || "") + outputChunk,
            });
          } else {
            // 首次收到输出片段，创建条目
            outputStore.addEntry({
              sessionId: entrySessionId,
              command: "",
              status: "running" as const,
              stdout: outputChunk,
              stderr: "",
              exitCode: null,
              durationMs: null,
            });
          }
        },
        // onStatus: 状态更新消息 → 更新 streamStore
        (statusMessage) => {
          useStreamStore.getState().setStatusMessage(statusMessage);
        },
        // onWarning: 警告消息
        (_warningMessage) => {},
        // onRoundStart: 新轮次开始
        (_roundIndex) => {},
        // onReconnect: 流中途断开重连
        (attempt, _maxAttempts) => {
          useStreamStore.getState().setStatus("reconnecting");
          useStreamStore.getState().setRetrying(attempt);
        },
        // onHeartbeat: 后端心跳保活
        () => {
          useStreamStore.getState().touchActivity();
          streamActivityAt.set(sessionId, Date.now());
        },
        // inlineDatas: 多模态图片数据
        inlineDatas.length > 0 ? inlineDatas : undefined,
        // modelId: 输入框选择的模型
        selectedModelId,
      ),
    );
  };

  const handleStop = () => {
    if (currentSessionId && streamAbortHandlers.has(currentSessionId)) {
      streamAbortHandlers.get(currentSessionId)?.();
      streamAbortHandlers.delete(currentSessionId);
      setSessionLoading(currentSessionId, false);
    }
    toolProgressStore.clear();

    // 将当前 groupId 下所有 in_progress 工具消息标记为 failure
    if (currentSessionId) {
      const session = sessions.get(currentSessionId);
      if (session) {
        const lastUserMsg = [...session.messages]
          .reverse()
          .find((m) => m.role === "user");
        if (lastUserMsg?.groupId) {
          markGroupInProgressAsFailure(currentSessionId, lastUserMsg.groupId);
        }
      }
    }
  };

  // IME 组合状态跟踪：
  // WebKit(Safari/WKWebView) 在"回车确认候选词"时，compositionend 会先于 keydown 触发，
  // 导致 e.nativeEvent.isComposing 已经是 false，仅靠它判断会误发送。
  // 且 compositionend 与幻影 Enter keydown 可能分属不同事件循环任务，
  // setTimeout(0) 定时器可能在两者之间先执行导致拦截失效，
  // 因此改用时间戳窗口：compositionend 后 250ms 内的 Enter 一律视为确认回车并拦截。
  const isComposingRef = useRef(false);
  const compositionEndedAtRef = useRef(0);

  const handleCompositionStart = () => {
    isComposingRef.current = true;
    compositionEndedAtRef.current = 0;
  };

  const handleCompositionEnd = () => {
    isComposingRef.current = false;
    compositionEndedAtRef.current = performance.now();
  };

  const isImeProcessing = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      isComposingRef.current ||
      e.nativeEvent.isComposing ||
      e.keyCode === 229
    ) {
      return true;
    }
    // 幻影确认回车：compositionend 刚结束不久的 Enter（人手再次按回车发送通常 >250ms）
    if (
      e.key === "Enter" &&
      compositionEndedAtRef.current > 0 &&
      performance.now() - compositionEndedAtRef.current < 250
    ) {
      return true;
    }
    return false;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isImeProcessing(e)) return;
    const isModifier = e.metaKey || e.ctrlKey;

    // --- 快捷键体系 ---
    // Ctrl/Cmd+L: 清空输入框
    if (isModifier && e.key === "l") {
      e.preventDefault();
      if (inputRef.current) {
        inputRef.current.innerHTML = "";
        inputRef.current.focus();
      }
      return;
    }
    // Ctrl/Cmd+Shift+Backspace: 清空当前会话消息（保留会话）
    if (isModifier && e.shiftKey && e.key === "Backspace") {
      e.preventDefault();
      if (currentSessionId) {
        clearMessages(currentSessionId);
      }
      return;
    }

    // --- 输入历史导航 ---
    // ↑: 上一条历史（光标在行首或输入框为空时）
    if (e.key === "ArrowUp" && !e.shiftKey && !isModifier) {
      const text = inputRef.current?.innerText || "";
      // 只在输入框为空或光标在第一行时触发
      const selection = window.getSelection();
      const isFirstLine =
        !selection || selection.anchorOffset === 0 || text.indexOf("\n") === -1;
      if (
        isFirstLine &&
        (text.length === 0 || historyIndexRef.current !== -1)
      ) {
        e.preventDefault();
        navigateHistoryUp();
        return;
      }
    }
    // ↓: 下一条历史
    if (e.key === "ArrowDown" && !e.shiftKey && !isModifier) {
      if (historyIndexRef.current !== -1) {
        const selection = window.getSelection();
        const text = inputRef.current?.innerText || "";
        const isLastLine =
          !selection ||
          selection.anchorOffset === text.length ||
          text.indexOf("\n") === -1;
        if (isLastLine) {
          e.preventDefault();
          navigateHistoryDown();
          return;
        }
      }
    }

    // --- 发送快捷键 ---
    const shouldSend =
      (e.key === "Enter" && !e.shiftKey && sendOnEnter && !isModifier) ||
      (e.key === "Enter" && isModifier && !sendOnEnter);
    if (shouldSend) {
      e.preventDefault();
      handleSend();
      return;
    }
    if (e.key === "Enter" && e.shiftKey) {
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !isModifier) {
      e.preventDefault();
    }
  };

  const selectSendMode = (mode: "enter" | "cmd") => {
    const next = mode === "enter";
    setSendOnEnter(next);
    localStorage.setItem("sendOnEnter", String(next));
    setShowSendModeDropdown(false);
  };

  const canSend =
    (inputRef.current?.innerText.trim() || inputTags.length > 0) &&
    currentAgentId &&
    !isLoading &&
    runtimeReady;
  const visibleModels = models.filter((model) => {
    const label = `${model.name} ${model.modelName}`;
    return !/damao\s*code\s*agent/i.test(label);
  });
  return (
    <div
      className="relative flex flex-col h-full flex-shrink-0 overflow-hidden"
      style={{ width, backgroundColor: colors.bgPrimary }}
    >
      <PermissionConfirmModal />
      <StreamStatusBar />
      {(() => {
        const conn = activeBinding
          ? connections.find((c) => c.id === activeBinding.connectionId)
          : connections.find((c) => c.id === currentConnectionId);
        if (!conn) return null;
        const connected = conn.status === 1;
        return (
          <div
            className="flex items-center gap-2 px-4 py-1.5 border-b"
            style={{
              backgroundColor: connected
                ? `${colors.accent}08`
                : `${colors.textDim}06`,
              borderColor: colors.border,
            }}
          >
            <div
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{
                backgroundColor: connected ? "#22c55e" : colors.textDim,
              }}
            />
            <span
              className="text-[11px] truncate"
              style={{ color: colors.textDim }}
            >
              {conn.name}（{conn.username}@{conn.host}）
              {connected ? "" : " · 未连接"}
            </span>
          </div>
        );
      })()}

      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto min-h-0"
        onScroll={() => {
          const container = messagesContainerRef.current;
          if (!container) return;
          const { scrollTop, scrollHeight, clientHeight } = container;
          const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
          // 向上滚动（非底部）进入手动模式，滚动到底部退出手动模式
          setIsManualScroll(!isAtBottom);
        }}
      >
        {!currentSession ? (
          <EmptyState
            onQuickAction={(text) => {
              if (inputRef.current) {
                inputRef.current.innerText = text;
                inputHtmlRef.current = inputRef.current.innerHTML;
                setInputText(text);
                inputRef.current.focus();
              }
            }}
          />
        ) : currentSession.messages.length === 0 ? (
          <EmptyState
            onQuickAction={(text) => {
              if (inputRef.current) {
                inputRef.current.innerText = text;
                inputHtmlRef.current = inputRef.current.innerHTML;
                setInputText(text);
                inputRef.current.focus();
              }
            }}
          />
        ) : (
          <div className="py-3 overflow-hidden min-w-0">
            <div className="flex-1">
              {/* 消息分组渲染：同 groupId 的 assistant 消息聚合为一个 AI 回合块 */}
              {(() => {
                type AiTurnItem = {
                  type: "aiTurn";
                  groupId: string;
                  msgs: AgentMessage[];
                  startIdx: number;
                  timestamp: number;
                  showDivider: boolean;
                  dividerTitle?: string;
                };
                type SingleItem = {
                  type: "single";
                  msg: AgentMessage;
                  msgIdx: number;
                  showDivider: boolean;
                  dividerTitle?: string;
                };
                type RenderItem = AiTurnItem | SingleItem;

                const items: RenderItem[] = [];
                let i = 0;
                while (i < currentSession.messages.length) {
                  const msg = currentSession.messages[i];
                  const showDivider =
                    i > 0 &&
                    (() => {
                      const prev = currentSession.messages[i - 1];
                      if (
                        msg.groupId &&
                        prev.groupId &&
                        msg.groupId !== prev.groupId
                      )
                        return true;
                      return shouldInsertTopicDivider(prev, msg).shouldInsert;
                    })();
                  const dividerTitle =
                    i > 0
                      ? (() => {
                          const prev = currentSession.messages[i - 1];
                          if (
                            msg.groupId &&
                            prev.groupId &&
                            msg.groupId !== prev.groupId
                          )
                            return "新对话";
                          return shouldInsertTopicDivider(prev, msg).title;
                        })()
                      : undefined;

                  // 用户消息 → single
                  if (msg.role === "user") {
                    items.push({
                      type: "single",
                      msg,
                      msgIdx: i,
                      showDivider,
                      dividerTitle,
                    });
                    i++;
                    continue;
                  }

                  // assistant 消息有 groupId → 聚合同 groupId 的所有 assistant 消息为一个 AI 回合
                  if (msg.groupId && msg.role === "assistant") {
                    const groupMsgs: AgentMessage[] = [msg];
                    let j = i + 1;
                    while (
                      j < currentSession.messages.length &&
                      currentSession.messages[j].groupId === msg.groupId &&
                      currentSession.messages[j].role === "assistant"
                    ) {
                      groupMsgs.push(currentSession.messages[j]);
                      j++;
                    }
                    items.push({
                      type: "aiTurn",
                      groupId: msg.groupId,
                      msgs: groupMsgs,
                      startIdx: i,
                      timestamp: msg.timestamp,
                      showDivider,
                      dividerTitle,
                    });
                    i = j;
                    continue;
                  }

                  // 兜底：无 groupId 的 assistant 消息 → single
                  items.push({
                    type: "single",
                    msg,
                    msgIdx: i,
                    showDivider,
                    dividerTitle,
                  });
                  i++;
                }

                const { colors } = useThemeStore.getState();
                // 只有最后一个 AI 回合块显示 loading 状态，避免旧对话也显示"正在分析"
                let lastAiTurnIdx = -1;
                for (let k = items.length - 1; k >= 0; k--) {
                  if (items[k].type === "aiTurn") {
                    lastAiTurnIdx = k;
                    break;
                  }
                }

                return items.map((item, idx) => {
                  const dividerEl = item.showDivider ? (
                    <TopicDivider
                      prevTimestamp={
                        currentSession.messages[
                          item.type === "single"
                            ? item.msgIdx
                            : item.startIdx - 1
                        ]?.timestamp || 0
                      }
                      currTimestamp={
                        item.type === "single"
                          ? item.msg.timestamp
                          : item.timestamp
                      }
                      topicIndex={
                        item.type === "single" ? item.msgIdx : item.startIdx
                      }
                      defaultTitle={item.dividerTitle}
                    />
                  ) : null;

                  // 用户消息或兜底单条消息
                  if (item.type === "single") {
                    return (
                      <React.Fragment key={`single_${item.msg.id}_${idx}`}>
                        {dividerEl}
                        <MessageBubble
                          message={item.msg}
                          isLoading={false}
                          onEditRetry={(msgId) => {
                            if (currentSessionId) {
                              // 先取出原消息内容，再截断；把内容填回输入框供用户编辑
                              const target = useAgentStore
                                .getState()
                                .sessions.get(currentSessionId)
                                ?.messages.find((m) => m.id === msgId);
                              editAndRetry(currentSessionId, msgId);
                              if (inputRef.current && target) {
                                inputRef.current.innerText =
                                  target.content || "";
                                inputHtmlRef.current =
                                  inputRef.current.innerHTML;
                                setInputText(target.content || "");
                              }
                              setTimeout(() => inputRef.current?.focus(), 50);
                            }
                          }}
                          onAddContextTag={handleAddSentContextTag}
                        />
                      </React.Fragment>
                    );
                  }

                  // AI 回合块
                  const isLastAiTurn = idx === lastAiTurnIdx;
                  return (
                    <React.Fragment key={`aiturn_${item.groupId}_${idx}`}>
                      {dividerEl}
                      <AiTurnBlock
                        msgs={item.msgs}
                        colors={colors}
                        isLoading={isLastAiTurn && isLoading}
                        streamStatus={streamStatus}
                        onRetry={() => {
                          setErrorRecovery(null);
                          if (
                            currentSession &&
                            currentSession.messages.length >= 2
                          ) {
                            const lastUserMsg = [...currentSession.messages]
                              .reverse()
                              .find((m) => m.role === "user");
                            if (lastUserMsg) {
                              const inputEl = inputRef.current;
                              if (inputEl) {
                                inputEl.innerText = lastUserMsg.content || "";
                              }
                              setTimeout(() => handleSend(), 100);
                            }
                          } else if (inputRef.current) {
                            setTimeout(() => handleSend(), 100);
                          }
                        }}
                      />
                    </React.Fragment>
                  );
                });
              })()}
            </div>
            {/* 错误恢复卡片 */}
            {errorRecovery && (
              <div className="px-4 py-2">
                <ErrorRecoveryCard
                  error={errorRecovery}
                  canRetry={true}
                  onRetry={() => {
                    setErrorRecovery(null);
                    if (currentSession && currentSession.messages.length >= 2) {
                      const lastUserMsg = [...currentSession.messages]
                        .reverse()
                        .find((m) => m.role === "user");
                      if (lastUserMsg) {
                        const inputEl = inputRef.current;
                        if (inputEl) {
                          inputEl.innerText = lastUserMsg.content || "";
                        }
                        setTimeout(() => handleSend(), 100);
                      }
                    } else if (inputRef.current) {
                      setTimeout(() => handleSend(), 100);
                    }
                  }}
                  onSkip={() => setErrorRecovery(null)}
                  onResetContext={() => {
                    setErrorRecovery(null);
                    if (currentSessionId) {
                      useAgentStore.getState().clearMessages(currentSessionId);
                    }
                  }}
                />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div
        className="w-full h-3 cursor-ns-resize select-none flex items-center justify-center transition-colors hover:bg-blue-500/20 flex-shrink-0"
        title="拖拽调整输入框高度"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const startY = e.clientY;
          const startHeight = inputRef.current?.offsetHeight || 120;
          const onMouseMove = (moveEvent: MouseEvent) => {
            const deltaY = startY - moveEvent.clientY;
            const newHeight = Math.max(80, Math.min(280, startHeight + deltaY));
            if (inputRef.current) {
              inputRef.current.style.height = newHeight + "px";
            }
          };
          const onMouseUp = () => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
          };
          document.addEventListener("mousemove", onMouseMove);
          document.addEventListener("mouseup", onMouseUp);
        }}
      >
        <div className="flex gap-1 opacity-30">
          <div className="w-1 h-1 rounded-full bg-gray-400" />
          <div className="w-1 h-1 rounded-full bg-gray-400" />
        </div>
      </div>

      {isLoading && currentSession && (
        <div className="flex justify-center px-4 pb-1 pt-1 flex-shrink-0">
          <AgentActionCapsule
            messages={currentSession.messages}
            streamStatus={streamStatus}
          />
        </div>
      )}

      {/* 产物汇总面板 — 参考 Android 端设计，放在输入框上方 */}
      <ArtifactSummaryPanel />

      <div
        className="mx-3 mb-3 rounded-2xl border overflow-visible flex-shrink-0"
        style={{
          backgroundColor: colors.bgSecondary,
          borderColor: `${colors.border}80`,
        }}
      >
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onToggleExpanded?.()}
              type="button"
              aria-pressed={expanded}
              className="flex items-center px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all"
              style={{
                backgroundColor: expanded
                  ? `${colors.accent}20`
                  : colors.bgTertiary,
                color: expanded ? colors.accent : colors.textSecondary,
                border: `1px solid ${expanded ? `${colors.accent}40` : "transparent"}`,
              }}
              title={expanded ? "收起输入区" : "展开输入区"}
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {expanded ? (
                  <>
                    <polyline points="4 14 10 14 10 20" />
                    <polyline points="20 10 14 10 14 4" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                    <line x1="14" y1="10" x2="21" y2="3" />
                  </>
                ) : (
                  <>
                    <polyline points="15 3 21 3 21 9" />
                    <polyline points="9 21 3 21 3 15" />
                    <line x1="21" y1="3" x2="14" y2="10" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                  </>
                )}
              </svg>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowChatExport(true)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all hover:opacity-80"
              style={{
                backgroundColor: colors.bgTertiary,
                color: colors.textSecondary,
                border: "1px solid transparent",
              }}
              title="导出对话"
            >
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
            <button
              onClick={() => setShowShortcutHelp(true)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all hover:opacity-80"
              style={{
                backgroundColor: colors.bgTertiary,
                color: colors.textSecondary,
                border: "1px solid transparent",
              }}
              title="快捷键"
            >
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M8 14h8" />
              </svg>
            </button>
            <button
              onClick={toggleHistoryPanel}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all hover:opacity-80"
              style={{
                backgroundColor: showHistoryPanel
                  ? `${colors.accent}20`
                  : colors.bgTertiary,
                color: showHistoryPanel ? colors.accent : colors.textSecondary,
                border: `1px solid ${showHistoryPanel ? `${colors.accent}40` : "transparent"}`,
              }}
              title="历史记录"
            >
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
            </button>
          </div>
        </div>

        <div className="flex flex-col relative px-4 pt-2 pb-3">
          <div
            className="relative w-full rounded-[10px] border transition-all flex flex-col"
            style={{
              backgroundColor: colors.bgInput,
              borderColor: isFocused
                ? `${colors.accent}70`
                : `${colors.border}80`,
              boxShadow: isFocused
                ? `0 0 0 1px ${colors.accent}20, 0 8px 22px rgba(0, 0, 0, 0.09)`
                : "0 6px 18px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)",
            }}
            onDragEnter={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setIsDragOverInput(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setIsDragOverInput(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setIsDragOverInput(false);
              }
            }}
            onDrop={handleNativeDrop}
          >
            {isDragOverInput && (
              <div
                className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[10px] border-2 border-dashed"
                style={{
                  backgroundColor: `${colors.accent}08`,
                  borderColor: `${colors.accent}70`,
                }}
              >
                <span
                  className="text-[11px] font-medium"
                  style={{ color: colors.accent }}
                >
                  拖入文件或文件夹
                </span>
              </div>
            )}
            {inputTags.length > 0 && (
              <div className="flex flex-wrap gap-2 px-3 pt-3 pb-1 max-h-[100px] overflow-y-auto">
                {inputTags.map((tag) => (
                  <ContextTagChip
                    key={tag.id}
                    label={tag.label}
                    kind={
                      tag.type === "terminal-selection" ? "terminal" : tag.type
                    }
                    fullContent={tag.fullContent}
                    colors={colors}
                    variant="input"
                    onRemove={() => removeInputTag(tag.id)}
                  />
                ))}
              </div>
            )}

            <div
              key={inputKey}
              ref={inputRef}
              contentEditable={!isLoading}
              suppressContentEditableWarning
              onInput={(e) => {
                setInputText(e.currentTarget.innerText.replace(/\u00a0/g, " "));
                inputHtmlRef.current = e.currentTarget.innerHTML;
                // CommandMenu 检测
                const cursorPos = window.getSelection()?.anchorOffset || 0;
                const text = e.currentTarget.innerText.replace(/\u00a0/g, " ");
                const cmdMenu = useCommandMenu(
                  text,
                  Math.min(cursorPos, text.length),
                  mentionItems,
                );
                if (cmdMenu.trigger) {
                  setCmdMenuTrigger(cmdMenu.trigger);
                  setCmdMenuIndex(cmdMenu.triggerIndex);
                  setCmdMenuQuery(cmdMenu.query);
                } else {
                  setCmdMenuTrigger(null);
                }
              }}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onMouseUp={() => {
                const selection = window.getSelection();
                if (
                  selection &&
                  selection.rangeCount > 0 &&
                  inputRef.current?.contains(selection.anchorNode)
                ) {
                  lastRangeRef.current = selection.getRangeAt(0).cloneRange();
                }
              }}
              onPaste={(e) => {
                e.preventDefault();
                // 优先检查剪贴板中的图片数据
                const imageItems = Array.from(e.clipboardData.items).filter(
                  (item) => item.type.startsWith("image/"),
                );
                if (imageItems.length > 0) {
                  const imageFile = imageItems[0].getAsFile();
                  if (imageFile) {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      const dataUrl = ev.target?.result as string;
                      if (!dataUrl) return;
                      insertTagAtCursor({
                        id: `img_${Date.now()}`,
                        label: `图片: ${imageFile.name || "粘贴图片"}`,
                        fullContent: `[图片: ${imageFile.name || "粘贴图片"}]\n${dataUrl}`,
                        type: "custom",
                      });
                    };
                    reader.readAsDataURL(imageFile);
                    return;
                  }
                }
                // 无图片时，走纯文本粘贴流程
                const rawText = e.clipboardData.getData("text/plain");
                const cleanText = stripMarkdownForPaste(rawText);
                document.execCommand("insertText", false, cleanText);
                syncInputTextFromDom();
              }}
              className="w-full bg-transparent resize-none outline-none text-[13px] leading-relaxed flex-1 whitespace-pre-wrap break-words min-h-[120px] max-h-[280px] overflow-y-auto"
              style={{
                color: isLoading ? colors.textDim : colors.text,
                padding:
                  inputTags.length > 0
                    ? "4px 16px 44px 16px"
                    : "8px 16px 44px 16px",
              }}
            />

            {(!inputText || inputText.trim() === "") &&
              inputTags.length === 0 && (
                <div
                  className="absolute pointer-events-none text-sm"
                  style={{
                    left: "16px",
                    top: "8px",
                    color: colors.textDim,
                    opacity: 0.6,
                  }}
                >
                  {inputPlaceholder()}
                </div>
              )}

            <div className="absolute right-3 bottom-3 flex items-center gap-1.5">
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAttachmentMenu(!showAttachmentMenu);
                  }}
                  className="p-1.5 rounded-md transition-colors hover:bg-black/10"
                  style={{
                    backgroundColor: colors.bgTertiary,
                    color: colors.textSecondary,
                  }}
                  title="添加上下文"
                >
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
                {showAttachmentMenu && (
                  <div
                    className="absolute bottom-full right-0 mb-1 w-32 rounded-lg border shadow-lg py-1 z-50"
                    style={{
                      backgroundColor: colors.bgPrimary,
                      borderColor: colors.border,
                    }}
                  >
                    <button
                      onClick={handleAddCurrentFile}
                      disabled={!activeTabKey}
                      className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ color: colors.text }}
                    >
                      添加当前文件
                    </button>
                    <button
                      onClick={handleAddCurrentFolder}
                      disabled={!activeConnectionId}
                      className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ color: colors.text }}
                    >
                      添加当前目录
                    </button>
                    <button
                      onClick={handleAddSelectedText}
                      className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-white/5 transition-colors"
                      style={{ color: colors.text }}
                    >
                      添加选中文本
                    </button>
                  </div>
                )}
              </div>
              <label
                className="p-1.5 rounded-md transition-colors hover:bg-black/10 cursor-pointer"
                style={{
                  backgroundColor: colors.bgTertiary,
                  color: colors.textSecondary,
                }}
                title="上传图片"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <circle cx="8.5" cy="8.5" r="1.5"></circle>
                  <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      const dataUrl = ev.target?.result as string;
                      if (!dataUrl) return;
                      // 将图片作为上下文标签插入输入框
                      insertTagAtCursor({
                        id: `img_${Date.now()}`,
                        label: `图片: ${file.name}`,
                        fullContent: `[图片: ${file.name}]\n${dataUrl}`,
                        type: "custom",
                      });
                    };
                    reader.readAsDataURL(file);
                    // 重置 input 以允许重复选择同一文件
                    e.target.value = "";
                  }}
                />
              </label>
              {isLoading ? (
                <button
                  onClick={handleStop}
                  className="p-1.5 rounded-md transition-colors"
                  style={{ backgroundColor: colors.red, color: "#fff" }}
                  title="停止"
                >
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!canSend}
                  className="p-1.5 rounded-md transition-colors"
                  style={{
                    backgroundColor: canSend
                      ? colors.accent
                      : colors.bgTertiary,
                    color: canSend ? "#fff" : colors.textSecondary,
                    opacity: canSend ? 1 : 0.5,
                    cursor: canSend ? "pointer" : "not-allowed",
                  }}
                  title="发送"
                >
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                  </svg>
                </button>
              )}
            </div>

            {runningSessions.length > 1 && (
              <button
                onClick={() => {
                  const activeIndex = runningSessions.findIndex(
                    (session) => session.id === currentSessionId,
                  );
                  const nextSession =
                    runningSessions[(activeIndex + 1) % runningSessions.length];
                  if (nextSession) setCurrentSession(nextSession.id);
                }}
                className="mt-2 flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all"
                style={{
                  backgroundColor: `${colors.green}14`,
                  color: colors.green,
                  border: `1px solid ${colors.green}66`,
                  boxShadow: `0 0 10px ${colors.green}66, 0 0 26px ${colors.green}22`,
                }}
                title={`运行中：${runningSessions.map((session) => session.name || "新对话").join("、")}`}
                aria-label="切换到下一个进行中的对话"
              >
                <span
                  className="h-1.5 w-1.5 animate-pulse rounded-full"
                  style={{ backgroundColor: colors.green }}
                />
                <span>{runningSessions.length} 个对话进行中</span>
                <span className="opacity-70">点击切换</span>
              </button>
            )}

            <div className="absolute left-3 bottom-3 right-28 flex items-center gap-1.5 z-30 min-w-0">
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  if (currentAgentId)
                    void newConversation(
                      currentAgentId,
                      activeConversationProjectId,
                    );
                }}
                className="p-1.5 shrink-0 rounded-md transition-colors hover:bg-black/10"
                style={{
                  backgroundColor: colors.bgTertiary,
                  color: colors.textSecondary,
                }}
                title="在当前项目下新建对话"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
              <div
                className="relative min-w-[54px] shrink-[2]"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <button
                  onClick={() => {
                    setShowProjectSelector((value) => !value);
                    setShowBranchSelector(false);
                  }}
                  className="h-7 max-w-[168px] min-w-0 px-2 rounded-md text-[11px] font-medium transition-colors hover:bg-black/5 flex items-center gap-1.5"
                  style={{
                    backgroundColor: colors.bgTertiary,
                    color: colors.textSecondary,
                  }}
                  title="切换对话项目"
                >
                  <svg
                    className="w-3.5 h-3.5 shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  </svg>
                  <span className="truncate">
                    {conversationProjects.find(
                      (item) => item.id === activeConversationProjectId,
                    )?.name || "默认项目"}
                  </span>
                  <svg
                    className="w-3 h-3 shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {showProjectSelector && (
                  <div
                    className="absolute bottom-full left-0 mb-1.5 w-60 max-h-56 overflow-y-auto rounded-lg border shadow-xl py-1"
                    style={{
                      backgroundColor: colors.bgPrimary,
                      borderColor: colors.border,
                    }}
                  >
                    {conversationProjects.map((project) => {
                      const linkedProject = localProjects.find(
                        (item) => item.id === project.localProjectId,
                      );
                      const branch = linkedProject?.branch;
                      const active = project.id === activeConversationProjectId;
                      return (
                        <button
                          key={project.id}
                          onClick={() => {
                            setShowProjectSelector(false);
                            void switchConversationProject(project.id);
                          }}
                          className="w-full px-2.5 py-1.5 text-left text-[11px] transition-colors hover:bg-black/5"
                          style={{
                            color: active ? colors.accent : colors.text,
                            backgroundColor: active
                              ? `${colors.accent}10`
                              : "transparent",
                          }}
                        >
                          <span className="flex items-center gap-1.5">
                            <span className="truncate font-medium">
                              {project.name}
                            </span>
                            {linkedProject && (
                              <span
                                className="rounded-full px-1.5 py-0.5 text-[9px] leading-none"
                                style={{
                                  backgroundColor: `${colors.accent}14`,
                                  color: colors.accent,
                                }}
                              >
                                工程
                              </span>
                            )}
                          </span>
                          <span
                            className="block truncate text-[10px]"
                            style={{ color: colors.textDim }}
                          >
                            {linkedProject
                              ? `${branch ? `分支 · ${branch}` : "未识别分支"}`
                              : "未关联工程"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              {linkedProject && (
                <div
                  className="relative min-w-[54px]"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <button
                    onClick={() => void toggleBranchSelector()}
                    disabled={branchLoading || branchSwitching}
                    className="h-7 max-w-[168px] min-w-0 px-2 rounded-md text-[11px] font-medium transition-colors hover:bg-black/5 flex items-center gap-1.5 disabled:opacity-60"
                    style={{
                      backgroundColor: colors.bgTertiary,
                      color: colors.textSecondary,
                    }}
                    title="切换工程分支"
                  >
                    <svg
                      className="w-3.5 h-3.5 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <circle cx="6" cy="6" r="2.5" />
                      <circle cx="6" cy="18" r="2.5" />
                      <circle cx="18" cy="8" r="2.5" />
                      <path d="M6 8.5v7M6 12c0-2.5 2.5-4 5-4h3a4 4 0 0 1 4 0" />
                    </svg>
                    <span className="truncate">
                      {linkedProject.branch || "分支"}
                    </span>
                    <svg
                      className="w-3 h-3 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {showBranchSelector && (
                    <div
                      className="absolute bottom-full left-0 mb-1.5 w-56 max-h-56 overflow-y-auto rounded-lg border shadow-xl py-1"
                      style={{
                        backgroundColor: colors.bgPrimary,
                        borderColor: colors.border,
                      }}
                    >
                      {branchLoading && (
                        <div
                          className="px-2.5 py-2 text-[11px]"
                          style={{ color: colors.textDim }}
                        >
                          加载分支...
                        </div>
                      )}
                      {!branchLoading && projectBranches.length === 0 && (
                        <div
                          className="px-2.5 py-2 text-[11px]"
                          style={{ color: colors.textDim }}
                        >
                          {branchError || "未识别到分支"}
                        </div>
                      )}
                      {!branchLoading &&
                        projectBranches.map((branch) => {
                          const active = branch === linkedProject.branch;
                          return (
                            <button
                              key={branch}
                              onClick={() => void switchProjectBranch(branch)}
                              disabled={branchSwitching}
                              className="w-full px-2.5 py-1.5 text-left text-[11px] transition-colors hover:bg-black/5 disabled:opacity-60"
                              style={{
                                color: active ? colors.accent : colors.text,
                                backgroundColor: active
                                  ? `${colors.accent}10`
                                  : "transparent",
                              }}
                            >
                              <span className="block truncate">{branch}</span>
                            </button>
                          );
                        })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* CommandMenu 弹出 */}
          {cmdMenuTrigger && (
            <CommandMenu
              trigger={cmdMenuTrigger}
              query={cmdMenuQuery}
              mentions={mentionItems}
              onSelect={(item) => {
                if (cmdMenuTrigger === "/") {
                  // 命令选择：替换输入框内容或执行操作
                  if (item.insertText) {
                    if (inputRef.current) {
                      const text = inputRef.current.innerText;
                      const before = text.slice(0, cmdMenuIndex);
                      const after = text.slice(
                        cmdMenuIndex + cmdMenuQuery.length + 1,
                      );
                      inputRef.current.focus({ preventScroll: true });
                      inputRef.current.innerText =
                        before + item.insertText + after;
                      setInputText(inputRef.current.innerText);
                      // 光标移到末尾
                      const range = document.createRange();
                      range.selectNodeContents(inputRef.current);
                      range.collapse(false);
                      const sel = window.getSelection();
                      sel?.removeAllRanges();
                      sel?.addRange(range);
                    }
                  } else if (item.id === "connect") {
                    // 打开 SSH 连接配置弹窗，切换到服务器标签
                    window.dispatchEvent(new CustomEvent("open-ssh-modal"));
                  } else if (item.id === "disconnect") {
                    // 断开当前活跃连接
                    const conn = activeBinding
                      ? connections.find(
                          (c) => c.id === activeBinding.connectionId,
                        )
                      : connections.find((c) => c.id === currentConnectionId);
                    if (conn) {
                      useConnectionStore.getState().disconnect(conn.id);
                    }
                  } else if (item.id === "clear") {
                    if (currentSessionId)
                      useAgentStore.getState().clearMessages(currentSessionId);
                  } else if (item.id === "reset") {
                    // TODO: 重置上下文 API 待后端提供
                  } else if (item.id === "export") {
                    // 导出对话
                    if (currentSession) {
                      const md = currentSession.messages
                        .map(
                          (m) =>
                            `### ${m.role === "user" ? "🧑 用户" : "🤖 助手"}\n\n${m.content}`,
                        )
                        .join("\n---\n");
                      const blob = new Blob([md], { type: "text/markdown" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `对话_${new Date().toISOString().slice(0, 10)}.md`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }
                  } else if (item.id === "debug") {
                    // 调试模式：发送提示让 AI 显示详细执行过程
                    if (inputRef.current) {
                      inputRef.current.innerText =
                        "请开启调试模式，显示详细的 ReAct 执行过程";
                      setInputText(inputRef.current.innerText);
                    }
                  } else if (item.id === "help") {
                    // 帮助：发送提示让 AI 列出可用命令
                    if (inputRef.current) {
                      inputRef.current.innerText = "请列出可用的命令和快捷键";
                      setInputText(inputRef.current.innerText);
                    }
                  }
                } else {
                  // @ 提及选择：全部创建标签（不发送，插入输入框）
                  if (item.id.startsWith("server-")) {
                    // 选择已连接的 SSH 服务器 → connection 标签
                    const connId = item.id.replace("server-", "");
                    const conn = connections.find((c) => c.id === connId);
                    if (conn) {
                      addInputTag({
                        label: conn.name,
                        fullContent: `当前服务器：${conn.name} (${conn.username}@${conn.host}:${conn.port})`,
                        type: "connection",
                        connectionInfo: {
                          connectionId: conn.id,
                          connectionName: conn.name,
                          host: conn.host,
                          port: conn.port,
                          username: conn.username,
                        },
                      });
                    }
                  } else if (item.id.startsWith("project-")) {
                    const projectId = item.id.replace("project-", "");
                    const project = localProjects.find(
                      (p) => p.id === projectId,
                    );
                    if (project) {
                      addInputTag({
                        label: `项目: ${project.name}`,
                        fullContent: `项目: ${project.name}\n路径: ${project.path}\n分支: ${project.branch || "未识别"}`,
                        type: "project",
                      });
                    }
                  } else if (item.id.startsWith("conv-project-")) {
                    // 对话项目（未关联本地工程）→ project 标签
                    const convId = item.id.replace("conv-project-", "");
                    const conv = conversationProjects.find(
                      (cp) => cp.id === convId,
                    );
                    if (conv) {
                      addInputTag({
                        label: `项目: ${conv.name}`,
                        fullContent: `项目: ${conv.name}\n路径: ${conv.path || "未指定"}`,
                        type: "project",
                      });
                    }
                  } else if (item.id === "current-file") {
                    // 当前文件 → file 标签
                    addInputTag({
                      label: "当前文件",
                      fullContent: "当前打开的文件（待获取具体路径）",
                      type: "file",
                    });
                  } else if (item.id === "current-folder") {
                    const localRoot = useLocalFileStore.getState().rootPath;
                    const remoteCwd = activeConnectionId
                      ? currentPathByConnection[activeConnectionId]
                      : undefined;
                    const cwd = localRoot || remoteCwd;
                    addInputTag({
                      label: cwd
                        ? `目录: ${cwd.split("/").filter(Boolean).pop() || cwd}`
                        : "当前目录",
                      fullContent: cwd
                        ? `当前工作目录: ${cwd}`
                        : "当前工作目录",
                      type: "directory",
                    });
                  } else if (item.id === "terminal") {
                    // 终端选中文本 → terminal-selection 标签
                    addInputTag({
                      label: "终端",
                      fullContent: "终端选中文本（待获取具体内容）",
                      type: "terminal-selection",
                    });
                  }
                  // 所有 @ 提及：移除输入框中的 @触发文本
                  if (inputRef.current) {
                    const text = inputRef.current.innerText;
                    const before = text.slice(0, cmdMenuIndex);
                    const after = text.slice(
                      cmdMenuIndex + cmdMenuQuery.length + 1,
                    );
                    inputRef.current.innerText = before + after;
                    setInputText(inputRef.current.innerText);
                    setInputKey((k) => k + 1);
                  }
                }
                setCmdMenuTrigger(null);
              }}
              onClose={() => setCmdMenuTrigger(null)}
            />
          )}

          <div
            className="flex items-center mt-2 text-[11px]"
            style={{ color: colors.textDim }}
          >
            <div className="relative flex items-center min-w-0">
              <select
                value={selectedModelId ?? ""}
                onChange={(event) =>
                  selectModel(
                    event.target.value ? Number(event.target.value) : null,
                  )
                }
                className="model-select max-w-[190px] min-w-0 h-7 pl-2.5 pr-7 rounded-lg text-[11px] font-medium outline-none cursor-pointer"
                style={{
                  backgroundColor: colors.bgTertiary,
                  border: `1px solid ${colors.border}99`,
                  color: colors.textSecondary,
                }}
                title="当前对话使用的模型"
              >
                {visibleModels.length === 0 && (
                  <option value="">默认模型</option>
                )}
                {visibleModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.modelName}
                  </option>
                ))}
              </select>
              <svg
                className="absolute right-2 w-3 h-3 pointer-events-none"
                viewBox="0 0 24 24"
                fill="none"
                stroke={colors.textDim}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
            <div className="flex-1" />
            <div className="relative">
              <button
                onClick={() => setShowSendModeDropdown(!showSendModeDropdown)}
                className="flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer transition-colors hover:bg-black/10 shrink-0 whitespace-nowrap"
                style={{
                  backgroundColor: "transparent",
                  color: colors.textDim,
                }}
                title="点击选择发送快捷键"
              >
                <svg
                  className="w-3 h-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
                {sendOnEnter ? (
                  <span style={{ fontSize: "11px", fontFamily: "monospace" }}>
                    Enter 发送
                  </span>
                ) : (
                  <span style={{ fontSize: "11px", fontFamily: "monospace" }}>
                    {currentKeyLabel} 发送
                  </span>
                )}
              </button>
              {showSendModeDropdown && (
                <div
                  className="absolute bottom-full right-0 mb-1 rounded-lg border shadow-lg py-1 min-w-[140px]"
                  style={{
                    backgroundColor: colors.bgPrimary,
                    borderColor: colors.border,
                  }}
                >
                  <button
                    onClick={() => selectSendMode("enter")}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors"
                    style={{
                      fontSize: "11px",
                      color: sendOnEnter ? colors.accent : colors.textSecondary,
                    }}
                  >
                    {sendOnEnter && (
                      <svg
                        className="w-3 h-3"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    )}
                    <span>Enter 发送</span>
                  </button>
                  <button
                    onClick={() => selectSendMode("cmd")}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors"
                    style={{
                      fontSize: "11px",
                      color: !sendOnEnter
                        ? colors.accent
                        : colors.textSecondary,
                    }}
                  >
                    {!sendOnEnter && (
                      <svg
                        className="w-3 h-3"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    )}
                    <span>{currentKeyLabel} 发送</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {/* P2: 快捷键面板 */}
      <ShortcutHelp
        open={showShortcutHelp}
        onClose={() => setShowShortcutHelp(false)}
      />
      {/* P2: 导出面板 */}
      <ChatExport
        open={showChatExport}
        onClose={() => setShowChatExport(false)}
        messages={currentSession?.messages || []}
        sessionTitle={currentSession?.name}
      />
    </div>
  );
}
