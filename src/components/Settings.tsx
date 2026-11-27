import { useState, useEffect, useCallback, useRef } from "react";
import { useThemeStore, themes, type ThemeName } from "../stores/themeStore";
import { useRuntimeStore } from "../stores/runtimeStore";
import { useModelStore } from "../stores/modelStore";
import {
  normalizeBaseUrl,
  revealModelKey,
  testModel,
  type ModelConfigPayload,
} from "../api/modelConfig";
import { invoke } from "@tauri-apps/api/core";

interface SettingsProps {
  open: boolean;
  onClose: () => void;
}

type Section =
  | "communication"
  | "models"
  | "appearance"
  | "general"
  | "cli"
  | "about";

const SUPPORTED_COMPLETIONS_PATH = "chat/completions";

export function Settings({ open, onClose }: SettingsProps) {
  const { currentTheme, setTheme } = useThemeStore();
  const runtime = useRuntimeStore();
  const { models, loading, error, fetchModels, saveModelConfig, removeModel } =
    useModelStore();

  // ── 各设置项的本地编辑状态 ──
  const [inputLang, setInputLang] = useState("简体中文");
  const [inputFont, setInputFont] = useState("JetBrains Mono");
  const [inputFontSize, setInputFontSize] = useState(13);
  const [section, setSection] = useState<Section>("communication");

  // CLI 工具状态
  const [cliInstalled, setCliInstalled] = useState(false);
  const [cliLoading, setCliLoading] = useState<
    "idle" | "installing" | "uninstalling"
  >("idle");
  const [copied, setCopied] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelConfigPayload>({
    name: "",
    baseUrl: "",
    apiKey: "",
    modelName: "",
    completionsPath: SUPPORTED_COMPLETIONS_PATH,
  });
  const [modelSaving, setModelSaving] = useState(false);
  const [modelTesting, setModelTesting] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [revealedApiKey, setRevealedApiKey] = useState<string | null>(null);
  const [modelMessage, setModelMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // ── 可拖拽缩放 ──
  const dialogRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 960, h: 640 });
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

  // 同步 store → 本地
  // 检查 CLI 注册状态
  useEffect(() => {
    invoke<boolean>("check_cli_installed")
      .then(setCliInstalled)
      .catch(() => setCliInstalled(false));
  }, []);

  useEffect(() => {
    if (open && section === "models") {
      void fetchModels({ silent: true });
    }
  }, [open, section, fetchModels]);

  // ── 判断是否有修改 ──
  /** 取消：还原所有本地状态 */
  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  // ── 拖拽缩放逻辑 ──
  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      dragStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const nw = Math.max(
          700,
          dragStart.current.w + ev.clientX - dragStart.current.x,
        );
        const nh = Math.max(
          460,
          dragStart.current.h + ev.clientY - dragStart.current.y,
        );
        setSize({ w: nw, h: nh });
      };
      const onUp = () => {
        dragging.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [size],
  );

  // ── ESC 关闭 ──
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, handleCancel]);

  /** 复制 damaocode-cli 命令 */
  const handleCopyCli = useCallback(async () => {
    try {
      await navigator.clipboard.writeText("damaocode-cli");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 降级：用 execCommand
      const ta = document.createElement("textarea");
      ta.value = "damaocode-cli";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {}
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, []);

  const resetModelForm = useCallback(() => {
    setEditingModel({
      name: "",
      baseUrl: "",
      apiKey: "",
      modelName: "",
      completionsPath: SUPPORTED_COMPLETIONS_PATH,
    });
  }, []);

  const handleToggleApiKey = useCallback(async () => {
    if (!showApiKey && editingModel.id && revealedApiKey === null) {
      const existingModel = models.find(
        (model) => model.id === editingModel.id,
      );
      if (existingModel?.hasApiKey) {
        const res = await revealModelKey(editingModel.id);
        if (res.code !== "0000") {
          if (res.code === "404" && existingModel.apiKeyMasked) {
            setRevealedApiKey(existingModel.apiKeyMasked);
          } else {
            setModelMessage({
              type: "error",
              text: res.info || "查看 API Key 失败",
            });
            return;
          }
        } else {
          setRevealedApiKey(res.data ?? "");
        }
      } else {
        setRevealedApiKey("");
      }
    }
    setShowApiKey((visible) => !visible);
  }, [editingModel.id, models, revealedApiKey, showApiKey]);

  const submitModel = useCallback(async () => {
    setModelMessage(null);
    setModelSaving(true);
    const saved = await saveModelConfig({
      ...editingModel,
      baseUrl: normalizeBaseUrl(editingModel.baseUrl),
    });
    setModelSaving(false);
    if (saved) {
      resetModelForm();
      setModelMessage({ type: "success", text: "模型配置已保存" });
    } else {
      setModelMessage({
        type: "error",
        text: useModelStore.getState().error || "保存失败",
      });
    }
  }, [editingModel, saveModelConfig, resetModelForm]);

  const testModelConnection = useCallback(async () => {
    setModelMessage(null);
    setModelTesting(true);
    const res = await testModel({
      ...editingModel,
      baseUrl: normalizeBaseUrl(editingModel.baseUrl),
    });
    setModelTesting(false);
    setModelMessage(
      res.code === "0000"
        ? { type: "success", text: "连接成功" }
        : { type: "error", text: res.info || "连接失败" },
    );
  }, [editingModel]);

  const handleDeleteModel = useCallback(
    async (id: number) => {
      const success = await removeModel(id);
      setModelMessage({
        type: success ? "success" : "error",
        text: success
          ? "模型已删除"
          : useModelStore.getState().error || "删除失败",
      });
    },
    [removeModel],
  );

  const { colors } = useThemeStore();
  const themeList = Object.entries(themes) as [
    ThemeName,
    (typeof themes)[ThemeName],
  ][];

  if (!open) return null;

  const sections: { id: Section; label: string; icon: string }[] = [
    { id: "communication", label: "通信", icon: "⚙️" },
    { id: "models", label: "模型", icon: "🧠" },
    { id: "appearance", label: "外观", icon: "🎨" },
    { id: "general", label: "通用", icon: "💻" },
    { id: "cli", label: "CLI 工具", icon: "⌨️" },
    { id: "about", label: "关于", icon: "ℹ️" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
    >
      <div
        ref={dialogRef}
        className="rounded-xl shadow-2xl flex flex-col overflow-hidden relative select-none"
        style={{
          backgroundColor: colors.bgSecondary,
          border: `1px solid ${colors.border}`,
          width: size.w,
          height: size.h,
          minWidth: 700,
          minHeight: 460,
        }}
      >
        {/* ── 顶栏 ── */}
        <div
          className="flex items-center justify-between px-6 py-3.5 shrink-0"
          style={{
            backgroundColor: colors.bgPrimary,
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <span
            className="text-[14px] font-semibold"
            style={{ color: colors.text }}
          >
            设置
          </span>
          <button
            onClick={handleCancel}
            className="w-7 h-7 rounded-full flex items-center justify-center text-sm hover:bg-white/10 transition-colors"
            style={{ color: colors.textDim }}
          >
            ✕
          </button>
        </div>

        {/* ── 主体：左侧导航 + 右侧内容 ── */}
        <div className="flex flex-1 min-h-0">
          {/* 左侧导航 */}
          <div
            className="w-56 p-4 border-r flex flex-col gap-1 shrink-0"
            style={{ borderColor: colors.border }}
          >
            {sections.map((item) => (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className="flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-[13px] text-left transition-colors"
                style={{
                  backgroundColor:
                    section === item.id ? colors.accentSoft : "transparent",
                  color:
                    section === item.id ? colors.accent : colors.textSecondary,
                  fontWeight: section === item.id ? 600 : 400,
                }}
              >
                <span className="text-[15px]">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>

          {/* 右侧内容区 */}
          <div className="flex-1 p-8 overflow-y-auto">
            {/* 通信（原通用） */}
            {section === "communication" && (
              <div className="space-y-6">
                <h2
                  className="text-[15px] font-semibold"
                  style={{ color: colors.text }}
                >
                  通信设置
                </h2>

                {/* 本地 Agent Runtime */}
                <div
                  className="rounded-lg p-4"
                  style={{
                    backgroundColor: colors.bgTertiary,
                    border: `1px solid ${colors.border}`,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3
                        className="text-[14px] font-semibold"
                        style={{ color: colors.text }}
                      >
                        本地 Agent
                      </h3>
                      <p
                        className="mt-1 text-[12px]"
                        style={{ color: colors.textDim }}
                      >
                        {runtime.status.running
                          ? `运行中 · http://127.0.0.1:${runtime.status.port}`
                          : runtime.starting
                            ? "启动中..."
                            : "未运行"}
                      </p>
                      {runtime.status.javaVersion && (
                        <p
                          className="text-[12px]"
                          style={{ color: colors.textDim }}
                        >
                          Java {runtime.status.javaVersion}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() =>
                        void (runtime.status.running
                          ? runtime.stop()
                          : runtime.start())
                      }
                      disabled={runtime.starting}
                      className="px-4 py-2 rounded-md text-[13px] font-medium transition-colors"
                      style={{
                        backgroundColor: runtime.status.running
                          ? colors.bgInput
                          : colors.accentSoft,
                        border: `1px solid ${colors.border}`,
                        color: runtime.status.running
                          ? colors.red
                          : colors.accent,
                      }}
                    >
                      {runtime.status.running ? "停止" : "启动"}
                    </button>
                  </div>
                  {runtime.error && (
                    <p
                      className="mt-3 text-[12px]"
                      style={{ color: colors.red }}
                    >
                      {runtime.error}
                    </p>
                  )}
                  {runtime.status.jarPath && (
                    <p
                      className="mt-3 text-[12px] font-mono break-all"
                      style={{ color: colors.textDim }}
                    >
                      {runtime.status.jarPath}
                    </p>
                  )}
                </div>

                {/* 语言 */}
                <div>
                  <label
                    className="block text-[13px] mb-2"
                    style={{ color: colors.textDim }}
                  >
                    语言
                  </label>
                  <select
                    value={inputLang}
                    onChange={(e) => setInputLang(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-md text-[13px] outline-none"
                    style={{
                      backgroundColor: colors.bgInput,
                      border: `1px solid ${colors.border}`,
                      color: colors.text,
                    }}
                  >
                    <option>简体中文</option>
                    <option>English</option>
                  </select>
                </div>
              </div>
            )}

            {/* 模型配置 */}
            {section === "models" && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2
                    className="text-[15px] font-semibold"
                    style={{ color: colors.text }}
                  >
                    模型配置
                  </h2>
                  <button
                    onClick={() => {
                      resetModelForm();
                      setShowApiKey(false);
                      setModelMessage(null);
                    }}
                    className="px-3 py-1.5 rounded-md text-[12px]"
                    style={{
                      backgroundColor: colors.bgTertiary,
                      border: `1px solid ${colors.border}`,
                      color: colors.textSecondary,
                    }}
                  >
                    新增模型
                  </button>
                </div>

                {error && (
                  <p className="text-[12px]" style={{ color: colors.red }}>
                    {error}
                  </p>
                )}

                <div className="space-y-2">
                  {loading && (
                    <p
                      className="text-[12px]"
                      style={{ color: colors.textDim }}
                    >
                      加载中...
                    </p>
                  )}
                  {models.map((model) => (
                    <div
                      key={model.id}
                      className="rounded-lg p-3 flex items-center justify-between gap-3"
                      style={{
                        backgroundColor: colors.bgTertiary,
                        border: `1px solid ${colors.border}`,
                      }}
                    >
                      <div className="min-w-0">
                        <div
                          className="text-[13px] font-medium truncate"
                          style={{ color: colors.text }}
                        >
                          {model.name}
                        </div>
                        <div
                          className="text-[11px] truncate"
                          style={{ color: colors.textDim }}
                        >
                          {model.modelName} · {model.baseUrl}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => {
                            resetModelForm();
                            setEditingModel({
                              id: model.id,
                              name: model.name,
                              baseUrl: model.baseUrl,
                              apiKey: "",
                              modelName: model.modelName,
                              completionsPath: SUPPORTED_COMPLETIONS_PATH,
                            });
                            setModelMessage(null);
                          }}
                          className="px-3 py-1.5 rounded-md text-[12px]"
                          style={{
                            backgroundColor: colors.bgInput,
                            border: `1px solid ${colors.border}`,
                            color: colors.accent,
                          }}
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => void handleDeleteModel(model.id)}
                          className="px-3 py-1.5 rounded-md text-[12px]"
                          style={{
                            backgroundColor: colors.bgInput,
                            border: `1px solid ${colors.border}`,
                            color: colors.red,
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div
                  className="rounded-lg p-4 space-y-3"
                  style={{
                    backgroundColor: colors.bgInput,
                    border: `1px solid ${colors.border}`,
                  }}
                >
                  <h3
                    className="text-[13px] font-semibold"
                    style={{ color: colors.text }}
                  >
                    {editingModel.id ? "编辑模型" : "新增模型"}
                  </h3>
                  {editingModel.id && (
                    <p
                      className="text-[11px]"
                      style={{ color: colors.textDim }}
                    >
                      当前密钥：
                      {models.find((m) => m.id === editingModel.id)
                        ?.apiKeyMasked || "****"}
                      ；留空表示保留原密钥。
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block space-y-1">
                      <span
                        className="text-[12px]"
                        style={{ color: colors.textDim }}
                      >
                        显示名称
                      </span>
                      <input
                        value={editingModel.name}
                        onChange={(e) =>
                          setEditingModel({
                            ...editingModel,
                            name: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 rounded-md text-[13px]"
                        style={{
                          backgroundColor: colors.bgTertiary,
                          border: `1px solid ${colors.border}`,
                          color: colors.text,
                        }}
                      />
                    </label>
                    <label className="block space-y-1">
                      <span
                        className="text-[12px]"
                        style={{ color: colors.textDim }}
                      >
                        模型 ID
                      </span>
                      <input
                        value={editingModel.modelName}
                        onChange={(e) =>
                          setEditingModel({
                            ...editingModel,
                            modelName: e.target.value,
                          })
                        }
                        placeholder="deepseek-v4-flash"
                        className="w-full px-3 py-2 rounded-md text-[13px]"
                        style={{
                          backgroundColor: colors.bgTertiary,
                          border: `1px solid ${colors.border}`,
                          color: colors.text,
                        }}
                      />
                    </label>
                    <label className="block col-span-2 space-y-1">
                      <span
                        className="text-[12px]"
                        style={{ color: colors.textDim }}
                      >
                        Base URL
                      </span>
                      <input
                        value={editingModel.baseUrl}
                        onChange={(e) =>
                          setEditingModel({
                            ...editingModel,
                            baseUrl: e.target.value,
                          })
                        }
                        placeholder="https://api.openai.com/v1"
                        className="w-full px-3 py-2 rounded-md text-[13px]"
                        style={{
                          backgroundColor: colors.bgTertiary,
                          border: `1px solid ${colors.border}`,
                          color: colors.text,
                        }}
                      />
                    </label>
                    <label className="block space-y-1">
                      <span
                        className="text-[12px]"
                        style={{ color: colors.textDim }}
                      >
                        API Key
                      </span>
                      <div className="relative">
                        <input
                          type={showApiKey ? "text" : "password"}
                          value={
                            showApiKey &&
                            editingModel.id &&
                            editingModel.apiKey === ""
                              ? (revealedApiKey ?? "")
                              : editingModel.apiKey
                          }
                          onChange={(e) =>
                            setEditingModel({
                              ...editingModel,
                              apiKey: e.target.value,
                            })
                          }
                          placeholder={
                            editingModel.id ? "留空保留原密钥" : "sk-..."
                          }
                          className="w-full px-3 py-2 pr-10 rounded-md text-[13px]"
                          style={{
                            backgroundColor: colors.bgTertiary,
                            border: `1px solid ${colors.border}`,
                            color: colors.text,
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => void handleToggleApiKey()}
                          aria-label={
                            showApiKey ? "隐藏 API Key" : "显示 API Key"
                          }
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded"
                          style={{ color: colors.textDim }}
                        >
                          {showApiKey ? (
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                              <circle cx="12" cy="12" r="3" />
                              <path d="m3 3 18 18" />
                            </svg>
                          ) : (
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </label>
                    <label className="block space-y-1">
                      <span
                        className="text-[12px]"
                        style={{ color: colors.textDim }}
                      >
                        Chat Completions Path
                      </span>
                      <select
                        value={
                          editingModel.completionsPath ||
                          SUPPORTED_COMPLETIONS_PATH
                        }
                        onChange={(e) =>
                          setEditingModel({
                            ...editingModel,
                            completionsPath: e.target.value,
                          })
                        }
                        className="h-[38px] w-full px-3 py-2 rounded-md text-[13px] outline-none"
                        style={{
                          backgroundColor: colors.bgTertiary,
                          border: `1px solid ${colors.border}`,
                          color: colors.text,
                        }}
                      >
                        <option value={SUPPORTED_COMPLETIONS_PATH}>
                          {SUPPORTED_COMPLETIONS_PATH}
                        </option>
                      </select>
                    </label>
                  </div>
                  {modelMessage && (
                    <p
                      className="text-[12px]"
                      style={{
                        color:
                          modelMessage.type === "success"
                            ? colors.green
                            : colors.red,
                      }}
                    >
                      {modelMessage.text}
                    </p>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => void submitModel()}
                      disabled={modelSaving}
                      className="px-4 py-2 rounded-md text-[13px] font-medium disabled:opacity-60"
                      style={{
                        backgroundColor: colors.accentSoft,
                        border: `1px solid ${colors.border}`,
                        color: colors.accent,
                      }}
                    >
                      {modelSaving ? "保存中..." : "保存"}
                    </button>
                    <button
                      onClick={() => void testModelConnection()}
                      disabled={modelTesting}
                      className="px-4 py-2 rounded-md text-[13px] font-medium disabled:opacity-60"
                      style={{
                        backgroundColor: colors.bgTertiary,
                        border: `1px solid ${colors.border}`,
                        color: colors.textSecondary,
                      }}
                    >
                      {modelTesting ? "测试中..." : "测试连接"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 外观 */}
            {section === "appearance" && (
              <div className="space-y-6">
                <h2
                  className="text-[15px] font-semibold"
                  style={{ color: colors.text }}
                >
                  外观设置
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  {themeList.map(([name, config]) => {
                    const previewColors =
                      name === "system" ? colors : config.colors;
                    return (
                      <button
                        key={name}
                        onClick={() => setTheme(name)}
                        className="p-4 rounded-lg text-left transition-all border-2"
                        style={{
                          backgroundColor: previewColors.bgPrimary,
                          borderColor:
                            currentTheme === name
                              ? previewColors.accent
                              : previewColors.border,
                        }}
                      >
                        <div className="flex gap-1.5 mb-3">
                          {[
                            previewColors.bgPrimary,
                            previewColors.bgSecondary,
                            previewColors.accent,
                            previewColors.green,
                          ].map((c, i) => (
                            <div
                              key={i}
                              className="w-5 h-5 rounded-full border"
                              style={{
                                backgroundColor: c,
                                borderColor: previewColors.border,
                              }}
                            />
                          ))}
                        </div>
                        <span
                          className="text-[13px] font-medium"
                          style={{ color: previewColors.text }}
                        >
                          {config.label}
                        </span>
                        {currentTheme === name && (
                          <span
                            className="ml-2 text-xs"
                            style={{ color: previewColors.accent }}
                          >
                            ✓
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 通用（原终端） */}
            {section === "general" && (
              <div className="space-y-6">
                <h2
                  className="text-[15px] font-semibold"
                  style={{ color: colors.text }}
                >
                  通用设置
                </h2>

                {/* 字体 */}
                <div>
                  <label
                    className="block text-[13px] mb-2"
                    style={{ color: colors.textDim }}
                  >
                    字体
                  </label>
                  <select
                    value={inputFont}
                    onChange={(e) => setInputFont(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-md text-[13px] outline-none"
                    style={{
                      backgroundColor: colors.bgInput,
                      border: `1px solid ${colors.border}`,
                      color: colors.text,
                    }}
                  >
                    <option>JetBrains Mono</option>
                    <option>Fira Code</option>
                    <option>Menlo</option>
                    <option>Source Code Pro</option>
                  </select>
                </div>

                {/* 字号 */}
                <div>
                  <label
                    className="block text-[13px] mb-2"
                    style={{ color: colors.textDim }}
                  >
                    字号
                  </label>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min="10"
                      max="24"
                      value={inputFontSize}
                      onChange={(e) => setInputFontSize(Number(e.target.value))}
                      className="flex-1"
                    />
                    <span
                      className="text-[13px] w-8 text-right tabular-nums"
                      style={{ color: colors.text }}
                    >
                      {inputFontSize}px
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* CLI 工具（独立栏目） */}
            {section === "cli" && (
              <div className="space-y-6">
                <h2
                  className="text-[15px] font-semibold"
                  style={{ color: colors.text }}
                >
                  CLI 工具
                </h2>

                {/* 配置区 */}
                <div
                  className="p-4 rounded-lg space-y-3"
                  style={{
                    backgroundColor: colors.bgInput,
                    border: `1px solid ${colors.border}`,
                  }}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="text-[14px] font-semibold"
                      style={{ color: colors.text }}
                    >
                      damaocode-cli
                    </span>
                    {cliInstalled ? (
                      <span
                        className="px-2 py-0.5 rounded text-[11px] font-medium"
                        style={{
                          backgroundColor: colors.green + "22",
                          color: colors.green,
                        }}
                      >
                        已注册
                      </span>
                    ) : (
                      <span
                        className="px-2 py-0.5 rounded text-[11px] font-medium"
                        style={{
                          backgroundColor: colors.textDim + "22",
                          color: colors.textDim,
                        }}
                      >
                        未注册
                      </span>
                    )}
                  </div>
                  <p className="text-[12px]" style={{ color: colors.textDim }}>
                    将{" "}
                    <code
                      className="px-1 py-0.5 rounded text-[11px]"
                      style={{
                        backgroundColor: colors.bgSecondary,
                        color: colors.accent,
                      }}
                    >
                      damaocode-cli
                    </code>{" "}
                    注册到系统 PATH，终端中可直接启动应用。
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    {cliInstalled ? (
                      <button
                        onClick={async () => {
                          setCliLoading("uninstalling");
                          try {
                            await invoke<string>("uninstall_cli_command");
                            setCliInstalled(false);
                          } catch (e) {
                            alert(`移除失败: ${e}。可能需要管理员权限。`);
                          }
                          setCliLoading("idle");
                        }}
                        disabled={cliLoading !== "idle"}
                        className="px-4 py-1.5 rounded-md text-[12px] font-medium transition-colors"
                        style={{
                          backgroundColor: colors.bgTertiary,
                          border: `1px solid ${colors.border}`,
                          color: colors.textSecondary,
                          cursor:
                            cliLoading !== "idle" ? "not-allowed" : "pointer",
                        }}
                      >
                        {cliLoading === "uninstalling"
                          ? "移除中..."
                          : "移除命令"}
                      </button>
                    ) : (
                      <button
                        onClick={async () => {
                          setCliLoading("installing");
                          try {
                            await invoke<string>("install_cli_command");
                            setCliInstalled(true);
                          } catch (e) {
                            alert(`注册失败: ${e}。可能需要管理员权限。`);
                          }
                          setCliLoading("idle");
                        }}
                        disabled={cliLoading !== "idle"}
                        className="px-4 py-1.5 rounded-md text-[12px] font-medium transition-colors"
                        style={{
                          backgroundColor:
                            cliLoading === "idle"
                              ? colors.accent
                              : colors.bgTertiary,
                          color:
                            cliLoading === "idle" ? "#fff" : colors.textDim,
                          cursor:
                            cliLoading !== "idle" ? "not-allowed" : "pointer",
                        }}
                      >
                        {cliLoading === "installing" ? "安装中..." : "点击安装"}
                      </button>
                    )}
                  </div>
                </div>

                {/* 使用说明区 */}
                <div
                  className="p-4 rounded-lg space-y-3"
                  style={{
                    backgroundColor: colors.bgInput,
                    border: `1px solid ${colors.border}`,
                  }}
                >
                  <h3
                    className="text-[13px] font-semibold"
                    style={{ color: colors.text }}
                  >
                    使用说明
                  </h3>
                  <p
                    className="text-[13px]"
                    style={{ color: colors.textSecondary }}
                  >
                    安装{" "}
                    <code
                      className="px-1 py-0.5 rounded text-[11px]"
                      style={{
                        backgroundColor: colors.bgSecondary,
                        color: colors.accent,
                      }}
                    >
                      damaocode-cli
                    </code>{" "}
                    后，可在任意终端使用以下命令：
                  </p>

                  {/* 命令块：点击整块复制 */}
                  <button
                    onClick={handleCopyCli}
                    className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-md text-left transition-colors group hover:brightness-110"
                    style={{
                      backgroundColor: colors.bgSecondary,
                      border: `1px solid ${colors.border}`,
                    }}
                  >
                    <code
                      className="text-[13px] font-mono"
                      style={{ color: colors.text }}
                    >
                      $ damaocode-cli
                    </code>
                    <span
                      className="text-[11px] font-medium shrink-0 transition-colors"
                      style={{ color: copied ? colors.green : colors.textDim }}
                    >
                      {copied ? "✓ 已复制" : "点击复制"}
                    </span>
                  </button>

                  <ul
                    className="text-[12px] space-y-1.5 pt-1"
                    style={{ color: colors.textDim }}
                  >
                    <li>
                      • 在系统任意终端输入{" "}
                      <code style={{ color: colors.accent }}>
                        damaocode-cli
                      </code>{" "}
                      即可启动 DaMaoCode-Study
                    </li>
                    <li>
                      • 支持 macOS / Linux（写入{" "}
                      <code style={{ color: colors.accent }}>~/.local/bin</code>
                      ）
                    </li>
                    <li>
                      • 需重启终端或执行{" "}
                      <code style={{ color: colors.accent }}>
                        source ~/.zshrc
                      </code>{" "}
                      让 PATH 生效
                    </li>
                  </ul>
                </div>
              </div>
            )}

            {/* 关于 */}
            {section === "about" && (
              <div className="flex flex-col items-center py-10">
                <img
                  src="/logo.png"
                  alt="DaMaoCode-Study"
                  className="w-20 h-20 rounded-xl mb-4"
                />
                <h3
                  className="text-lg font-semibold mb-1"
                  style={{ color: colors.text }}
                >
                  DaMaoCode-Study
                </h3>
                <p
                  className="text-[13px] mb-6"
                  style={{ color: colors.textDim }}
                >
                  v0.1.0 · AI + SSH 智能终端
                </p>
                <div
                  className="w-full max-w-sm p-4 rounded-lg text-[13px] space-y-3"
                  style={{ backgroundColor: colors.bgInput }}
                >
                  {[
                    ["前端", "Tauri 2.0 + React 19"],
                    ["后端", "Spring AI + Google ADK"],
                    ["构建", "Vite 7 + TypeScript"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <span style={{ color: colors.textDim }}>{k}</span>
                      <span style={{ color: colors.textSecondary }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── 底栏 ── */}
        <div
          className="flex items-center justify-end gap-3 px-6 py-3.5 shrink-0"
          style={{
            backgroundColor: colors.bgPrimary,
            borderTop: `1px solid ${colors.border}`,
          }}
        >
          <button
            onClick={handleCancel}
            className="px-5 py-2 rounded-md text-[13px] font-medium transition-colors"
            style={{
              backgroundColor: colors.bgTertiary,
              border: `1px solid ${colors.border}`,
              color: colors.textSecondary,
            }}
          >
            关闭
          </button>
        </div>

        {/* ── 右下角拖拽缩放手柄 ── */}
        <div
          onMouseDown={onResizeMouseDown}
          className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize flex items-end justify-end p-0.5"
          style={{ color: colors.textDim }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <circle cx="8" cy="2" r="1" />
            <circle cx="8" cy="5" r="1" />
            <circle cx="5" cy="5" r="1" />
            <circle cx="8" cy="8" r="1" />
            <circle cx="5" cy="8" r="1" />
            <circle cx="2" cy="8" r="1" />
          </svg>
        </div>
      </div>
    </div>
  );
}
