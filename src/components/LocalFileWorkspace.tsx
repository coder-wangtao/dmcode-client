import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { DiffEditor } from '@monaco-editor/react'
import { useThemeStore } from '../stores/themeStore'
import { useLocalFileStore, isLocalDiffTab, type LocalDiffTab, type LocalOpenTab } from '../stores/localFileStore'
import { useAiPatchStore } from '../stores/aiPatchStore'
import { useSshAgentStore } from '../stores/sshAgentStore'

/** Diff 视图组件：左右对比 before / after（本地文件） */
function LocalDiffEditorView({ activeTab, onAccept, onRestore }: { activeTab: LocalDiffTab; onAccept: () => void; onRestore: () => void }) {
  const { colors, currentTheme } = useThemeStore()
  const preview = useAiPatchStore((state) => state.previews.find((p) => p.id === activeTab.previewId))
  const openSourceFile = useLocalFileStore((s) => s.openFile)

  // 点击文件名打开源文件（切换到普通编辑标签页）
  const handleOpenSource = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!preview) return
    await openSourceFile(preview.path)
  }, [preview, openSourceFile])

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-1 shrink-0 border-b" style={{ backgroundColor: colors.bgSecondary, borderColor: colors.border }}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium" style={{ color: colors.text }}>
            🔀 Diff:{' '}
          </span>
          {/* 可点击的文件名 — 跳转到源文件 */}
          <span
            onClick={handleOpenSource}
            className="text-xs font-medium underline cursor-pointer hover:opacity-70 transition-opacity"
            style={{ color: colors.accent }}
            title={`打开源文件: ${activeTab.path}`}
          >
            {activeTab.name}
          </span>
          <span className="text-[10px] font-mono" style={{ color: '#22c55e' }}>+{activeTab.addedLines}</span>
          <span className="text-[10px] font-mono" style={{ color: '#ef4444' }}>-{activeTab.removedLines}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px]" style={{ color: colors.textDim }}>{activeTab.path}</span>
          {preview && (
            <div className="flex items-center gap-2">
              <button
                onClick={onRestore}
                className="px-2 py-1 rounded text-[11px]"
                style={{ backgroundColor: `${colors.red}15`, color: colors.red }}
              >
                还原
              </button>
              <button
                onClick={onAccept}
                className="px-2 py-1 rounded text-[11px]"
                style={{ backgroundColor: colors.accent, color: '#fff' }}
              >
                接受
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <DiffEditor
          height="100%"
          language={activeTab.language}
          theme={currentTheme === 'light' ? 'vs-light' : 'vs-dark'}
          original={activeTab.beforeContent}
          modified={activeTab.afterContent}
          options={{
            readOnly: true,
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: 'on',
            renderSideBySide: true,
          }}
        />
      </div>
    </div>
  )
}

export function LocalFileWorkspace() {
  const { colors, currentTheme } = useThemeStore()
  const { openTabs, activeTabKey, updateFileContent, saveFile, setActiveTab, closeTab, restoreFileContent, closeOtherTabs, closeAllTabs, closeTabsToLeft, closeTabsToRight } = useLocalFileStore()
  const removePreview = useAiPatchStore((state) => state.removePreview)
  const [hasSelection, setHasSelection] = useState(false)
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; tabKey: string } | null>(null)
  const [tabDropdownOpen, setTabDropdownOpen] = useState(false)
  const tabsScrollRef = useRef<HTMLDivElement>(null)

  // 点击外部 / Esc 关闭标签右键菜单
  useEffect(() => {
    if (!tabContextMenu) return
    const close = () => setTabContextMenu(null)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTabContextMenu(null)
    }
    document.addEventListener('click', close)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [tabContextMenu])

  // 点击外部关闭标签下拉面板
  useEffect(() => {
    if (!tabDropdownOpen) return
    const close = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('[data-local-tab-dropdown]')) {
        setTabDropdownOpen(false)
      }
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [tabDropdownOpen])

  // 活动标签变化时滚动到可见位置
  useEffect(() => {
    if (!activeTabKey || !tabsScrollRef.current) return
    const el = tabsScrollRef.current.querySelector(`[data-local-tab-key="${CSS.escape(activeTabKey)}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTabKey])

  const activeTab = useMemo(
    () => openTabs.find((tab) => tab.key === activeTabKey) ?? null,
    [openTabs, activeTabKey],
  )

  const isDiffTab = isLocalDiffTab(activeTab)
  const fileTab = isDiffTab ? null : (activeTab as LocalOpenTab | null)
  const diffTab = isDiffTab ? (activeTab as LocalDiffTab) : null

  // Diff Tab 接受/还原回调 — 必须在条件分支前调用（hooks 规则）
  const handleAcceptDiff = useCallback(() => {
    if (!diffTab) return
    removePreview(diffTab.previewId)
    closeTab(diffTab.key)
  }, [diffTab, removePreview, closeTab])

  const handleRestoreDiff = useCallback(async () => {
    if (!diffTab) return
    const preview = useAiPatchStore.getState().previews.find((p) => p.id === diffTab.previewId)
    if (!preview) return
    const success = await restoreFileContent(preview.path, preview.beforeContent)
    if (success) {
      removePreview(diffTab.previewId)
      closeTab(diffTab.key)
    }
  }, [diffTab, restoreFileContent, removePreview, closeTab])

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (activeTabKey && value !== undefined) {
        updateFileContent(activeTabKey, value)
      }
    },
    [activeTabKey, updateFileContent],
  )

  const handleSave = useCallback(async () => {
    if (activeTabKey) {
      const currentTab = useLocalFileStore.getState().openTabs.find((t) => t.key === activeTabKey)
      // 解析视图（如 class 字节码结构）只读，不触发保存
      if (currentTab && !isLocalDiffTab(currentTab) && currentTab.parsedType) return
      const success = await saveFile(activeTabKey)
      if (!success) {
        alert('保存失败，请检查文件权限')
      }
    }
  }, [activeTabKey, saveFile])

  const handleEditorMount = useCallback(
    (editor: any) => {
      // @ts-ignore
      window.__activeMonacoEditor = editor

      editor.addCommand(
        // 2048 = Cmd/Ctrl modifier, 49 = 'S' key
        2048 | 49,
        () => {
          void handleSave()
        },
      )

      editor.onDidChangeCursorSelection((e: any) => {
        setHasSelection(!e.selection.isEmpty())
      })

      // 右键菜单：添加到 AI 对话
      editor.addAction({
        id: 'add-to-ai-chat',
        label: '添加到 AI 对话',
        contextMenuGroupId: '1_modification',
        contextMenuOrder: 1,
        run: (ed: any) => {
          const selection = ed.getSelection()
          if (!selection) return
          const text = ed.getModel()?.getValueInRange(selection)

          const currentTab = useLocalFileStore.getState().openTabs.find(
            (t) => !isLocalDiffTab(t) && t.key === useLocalFileStore.getState().activeTabKey,
          ) as LocalOpenTab | undefined
          if (!currentTab) return

          if (text && text.trim()) {
            useSshAgentStore.getState().addInputTag({
              label: `选中: ${currentTab.name}`,
              fullContent: `本地文件: ${currentTab.path}\n选中的代码/文本:\n\`\`\`\n${text}\n\`\`\``,
              type: 'terminal-selection',
            })
          } else {
            useSshAgentStore.getState().addInputTag({
              label: `文件: ${currentTab.name}`,
              fullContent: `本地文件: ${currentTab.path}\n\n\`\`\`\n${currentTab.content}\n\`\`\``,
              type: 'file',
            })
          }
        },
      })
    },
    [handleSave],
  )

  // ── 标签栏（共用） ──
  const contextTabIndex = tabContextMenu ? openTabs.findIndex((t) => t.key === tabContextMenu.tabKey) : -1
  const tabBar = (
    <div className="relative h-9 border-b flex items-center pl-2 flex-shrink-0" style={{ backgroundColor: colors.bgSecondary, borderColor: colors.border }}>
      <div ref={tabsScrollRef} className="flex-1 min-w-0 h-full flex items-center gap-1 overflow-x-auto no-scrollbar">
        {openTabs.map((tab) => {
          const isActive = activeTabKey === tab.key
          const isDiff = isLocalDiffTab(tab)
          return (
            <button
              key={tab.key}
              data-local-tab-key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setTabDropdownOpen(false)
                setTabContextMenu({ x: e.clientX, y: e.clientY, tabKey: tab.key })
              }}
              className="group h-7 px-3 rounded-md flex items-center gap-2 text-xs max-w-[200px] flex-shrink-0 transition-colors"
              style={{
                color: isActive ? colors.text : colors.textSecondary,
                backgroundColor: isActive ? colors.bgPrimary : 'transparent',
                border: `1px solid ${isActive ? colors.border : 'transparent'}`,
              }}
            >
              {isDiff && <span className="text-[10px] flex-shrink-0" title="Diff 对比">🔀</span>}
              {!isDiff && tab.modified && (
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: colors.yellow }} />
              )}
              <span className="truncate">{tab.name}</span>
              <span
                onClick={(e) => { e.stopPropagation(); closeTab(tab.key) }}
                className="opacity-0 group-hover:opacity-60 hover:!opacity-100 flex items-center justify-center w-4 h-4 rounded-sm"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </span>
            </button>
          )
        })}
      </div>

      {/* 展开全部标签（含数量） */}
      {openTabs.length > 0 && (
        <div data-local-tab-dropdown className="relative flex-shrink-0 flex items-center pr-1 pl-1 border-l" style={{ borderColor: colors.border }}>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setTabContextMenu(null)
              setTabDropdownOpen(!tabDropdownOpen)
            }}
            className="h-7 px-2 rounded-md flex items-center gap-1 text-xs hover:bg-white/5 transition-colors"
            style={{ color: colors.textSecondary }}
            title="展开全部打开的文件"
          >
            <span className="font-mono text-[10px] bg-black/10 px-1 rounded">{openTabs.length}</span>
            <svg
              className="w-3.5 h-3.5 transition-transform"
              style={{ transform: tabDropdownOpen ? 'rotate(180deg)' : '' }}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            >
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>

          {tabDropdownOpen && (
            <div
              className="absolute top-full right-0 mt-1 w-64 rounded-lg border py-1 z-[100] max-h-80 overflow-y-auto shadow-xl"
              style={{ backgroundColor: colors.bgSecondary, borderColor: colors.border }}
            >
              <div className="px-3 py-1.5 text-[11px] uppercase font-medium tracking-wider border-b mb-1" style={{ color: colors.textDim, borderColor: colors.border }}>
                打开的文件（{openTabs.length}）
              </div>
              {openTabs.map((tab) => {
                const isActive = activeTabKey === tab.key
                const isDiff = isLocalDiffTab(tab)
                return (
                  <button
                    key={`dropdown-${tab.key}`}
                    className="w-full text-left px-3 py-1.5 text-xs flex items-center justify-between gap-2 hover:bg-white/5 transition-colors"
                    style={{ color: isActive ? colors.accent : colors.text }}
                    title={tab.path}
                    onClick={() => {
                      setActiveTab(tab.key)
                      setTabDropdownOpen(false)
                    }}
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      {isDiff && <span className="text-[10px] flex-shrink-0">🔀</span>}
                      {!isDiff && tab.modified && (
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: colors.yellow }} />
                      )}
                      <span className="truncate">{tab.name}</span>
                    </span>
                    <span
                      className="opacity-60 hover:opacity-100 flex-shrink-0 flex items-center justify-center w-4 h-4 rounded-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        closeTab(tab.key)
                      }}
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* 标签右键菜单 */}
      {tabContextMenu && contextTabIndex >= 0 && (
        <div
          className="fixed z-[100] w-44 rounded-md shadow-lg border py-1"
          style={{
            left: Math.min(tabContextMenu.x, window.innerWidth - 190),
            top: Math.min(tabContextMenu.y, window.innerHeight - 180),
            backgroundColor: colors.bgSecondary,
            borderColor: colors.border,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors"
            style={{ color: colors.text }}
            onClick={() => { closeTab(tabContextMenu.tabKey); setTabContextMenu(null) }}
          >
            关闭
          </button>
          <button
            disabled={contextTabIndex === 0}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
            style={{ color: colors.text }}
            onClick={() => { closeTabsToLeft(tabContextMenu.tabKey); setTabContextMenu(null) }}
          >
            关闭左侧
          </button>
          <button
            disabled={contextTabIndex === openTabs.length - 1}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
            style={{ color: colors.text }}
            onClick={() => { closeTabsToRight(tabContextMenu.tabKey); setTabContextMenu(null) }}
          >
            关闭右侧
          </button>
          <button
            disabled={openTabs.length <= 1}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
            style={{ color: colors.text }}
            onClick={() => { closeOtherTabs(tabContextMenu.tabKey); setTabContextMenu(null) }}
          >
            关闭其他
          </button>
          <div className="my-1 mx-2" style={{ height: 1, backgroundColor: colors.border }} />
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors"
            style={{ color: colors.text }}
            onClick={() => { closeAllTabs(); setTabContextMenu(null) }}
          >
            全部关闭
          </button>
        </div>
      )}
    </div>
  )

  // ── 渲染分支 ──
  // 所有 hooks 已在上层调用完毕，以下只做条件渲染

  // 1. Diff Tab
  if (isDiffTab && activeTab) {
    return (
      <div className="h-full flex flex-col min-w-0" style={{ backgroundColor: colors.bgTertiary }}>
        {tabBar}
        <LocalDiffEditorView activeTab={activeTab} onAccept={handleAcceptDiff} onRestore={handleRestoreDiff} />
      </div>
    )
  }

  // 2. 无活动 tab
  if (!fileTab) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: colors.bgTertiary }}>
        <div className="text-center">
          <svg className="w-16 h-16 mx-auto mb-4 opacity-20" viewBox="0 0 24 24" fill="none" stroke={colors.textDim} strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
          <p className="text-sm" style={{ color: colors.textSecondary }}>打开一个文件开始编辑</p>
          <p className="text-xs mt-1" style={{ color: colors.textDim }}>从左侧文件树点击文件</p>
        </div>
      </div>
    )
  }

  // 3. 加载中
  if (fileTab.loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: colors.bgTertiary }}>
        <p className="text-sm" style={{ color: colors.textSecondary }}>加载中...</p>
      </div>
    )
  }

  // 4. 错误
  if (fileTab.error) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: colors.bgTertiary }}>
        <p className="text-sm" style={{ color: colors.red }}>{fileTab.error}</p>
      </div>
    )
  }

  // 5. 正常文件编辑
  return (
    <div className="h-full flex flex-col min-w-0" style={{ backgroundColor: colors.bgTertiary }}>
      {tabBar}

      {/* 解析视图提示（class 字节码等只读内容） */}
      {fileTab.parsedType === 'java-class' && (
        <div className="text-xs px-3 py-2 shrink-0 border-b flex items-center gap-1.5" style={{ backgroundColor: `${colors.accent}10`, color: colors.accent, borderColor: colors.border }}>
          <span>☕</span>
          <span>class 字节码已解析为结构视图（只读，不可编辑保存）</span>
        </div>
      )}

      {/* 工具栏 */}
      <div className="flex items-center justify-between px-3 py-1 shrink-0 border-b" style={{ backgroundColor: colors.bgSecondary, borderColor: colors.border }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs truncate" style={{ color: colors.textDim }}>{fileTab.path}</span>
          {fileTab.modified && (
            <span className="text-xs flex-shrink-0" style={{ color: colors.yellow }}>● 已修改</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasSelection && (
            <button
              onClick={() => {
                // @ts-ignore
                const editor = window.__activeMonacoEditor
                if (editor) {
                  editor.getAction('add-to-ai-chat')?.run()
                }
              }}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors"
              style={{ backgroundColor: colors.accent, color: '#fff' }}
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              发送至 AI
            </button>
          )}
        </div>
      </div>

      {/* Monaco 编辑器 */}
      <div className="flex-1 min-h-0 relative">
        <Editor
          key={`${fileTab.key}:${fileTab.contentVersion ?? 0}`}
          height="100%"
          language={fileTab.language}
          theme={currentTheme === 'light' ? 'vs-light' : 'vs-dark'}
          value={fileTab.content}
          path={fileTab.path}
          onChange={handleChange}
          onMount={handleEditorMount}
          options={{
            readOnly: !!fileTab.parsedType,
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: 'on',
            lineNumbers: 'on',
            renderWhitespace: 'selection',
            padding: { top: 16 },
            tabSize: 2,
            formatOnPaste: true,
            formatOnType: true,
          }}
        />
      </div>
    </div>
  )
}
