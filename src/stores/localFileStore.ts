import { create } from "zustand";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import {
  readDir,
  readFile,
  readTextFile,
  writeTextFile,
  type DirEntry,
} from "@tauri-apps/plugin-fs";
import { useAiPatchStore } from "./aiPatchStore";
import { parseClassFile, MAX_CLASS_PARSE_BYTES } from "../api/fileParse";

/** 本地文件节点 */
export interface LocalFileNode {
  name: string;
  path: string;
  directory: boolean;
  size: number | null;
  children?: LocalFileNode[];
  /** 是否已加载过子节点 */
  loaded: boolean;
  branch?: string | null;
}

/** 打开的文件标签 */
export interface LocalOpenTab {
  key: string;
  path: string;
  name: string;
  content: string;
  loading: boolean;
  modified: boolean;
  error?: string;
  language: string;
  /** 二进制文件的解析类型（如 "java-class"），非空表示 content 为解析后的结构视图（只读） */
  parsedType?: string;
  /** 每次外部（AI）重载内容时递增，用于强制 Monaco Editor 刷新 */
  contentVersion?: number;
}

/** Diff 标签页：用于在编辑器中对比 AI 修改前后的内容（本地文件） */
export interface LocalDiffTab {
  key: string;
  /** 标记为 diff 类型 */
  kind: "diff";
  /** 关联的 AiPatchPreview id */
  previewId: string;
  path: string;
  name: string;
  language: string;
  /** 修改前的原始内容 */
  beforeContent: string;
  /** 修改后的内容 */
  afterContent: string;
  /** 新增行数 */
  addedLines: number;
  /** 删除行数 */
  removedLines: number;
}

export type LocalAnyTab = LocalOpenTab | LocalDiffTab;

/** 已打开的本地工程 */
export interface LocalProject {
  id: string;
  path: string;
  name: string;
  branch: string | null;
}

export function isLocalDiffTab(
  tab: LocalAnyTab | null | undefined,
): tab is LocalDiffTab {
  return !!tab && (tab as LocalDiffTab).kind === "diff";
}

/** 根据扩展名推断语言 */
export function getLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "js":
      return "javascript";
    case "jsx":
      return "javascript";
    case "ts":
      return "typescript";
    case "tsx":
      return "typescript";
    case "json":
      return "json";
    case "html":
      return "html";
    case "css":
      return "css";
    case "scss":
      return "scss";
    case "less":
      return "less";
    case "md":
      return "markdown";
    case "py":
      return "python";
    case "java":
      return "java";
    case "class":
      return "java";
    case "kt":
      return "kotlin";
    case "go":
      return "go";
    case "rs":
      return "rust";
    case "c":
      return "c";
    case "cpp":
      return "cpp";
    case "h":
      return "c";
    case "sh":
      return "shell";
    case "bash":
      return "shell";
    case "yml":
      return "yaml";
    case "yaml":
      return "yaml";
    case "xml":
      return "xml";
    case "sql":
      return "sql";
    case "vue":
      return "html";
    case "php":
      return "php";
    case "rb":
      return "ruby";
    case "swift":
      return "swift";
    case "toml":
      return "ini";
    case "ini":
      return "ini";
    case "conf":
      return "ini";
    default:
      return "plaintext";
  }
}

/** 忽略的目录名 */
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "target",
  ".cache",
  "__pycache__",
  ".idea",
  ".vscode",
  ".gradle",
  ".mvn",
  "venv",
  ".venv",
  "env",
]);

/** Maven/Gradle 标准 Java 源码集 scope */
const JAVA_SOURCE_SCOPES = ["main", "test", "integrationTest", "it", "e2e"];

/** 忽略的文件 */
const IGNORED_FILES = new Set([".DS_Store", "Thumbs.db"]);

/**
 * 拼接路径，处理 macOS/Linux 路径
 */
function joinPath(parent: string, child: string): string {
  if (parent.endsWith("/")) return `${parent}${child}`;
  return `${parent}/${child}`;
}

function getPathSegments(targetPath: string): string[] {
  return targetPath
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
}

function getPathBasename(targetPath: string): string {
  const normalized = targetPath.replace(/\\/g, "/").replace(/\/+$/g, "");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] || normalized;
}

function findJavaSourcePattern(segments: string[]): number {
  for (let i = 0; i <= segments.length - 3; i++) {
    if (
      segments[i] === "src" &&
      JAVA_SOURCE_SCOPES.includes(segments[i + 1]) &&
      segments[i + 2] === "java"
    ) {
      return i + 2;
    }
  }
  return -1;
}

function isInsideJavaSourcePath(dirPath: string): boolean {
  const segments = getPathSegments(dirPath);
  const javaIdx = findJavaSourcePattern(segments);
  if (javaIdx === -1) return false;
  return segments.length > javaIdx + 1;
}

function filterVisibleEntries(entries: DirEntry[]): DirEntry[] {
  return entries.filter((entry) => {
    if (IGNORED_FILES.has(entry.name)) return false;
    if (entry.isDirectory && IGNORED_DIRS.has(entry.name)) return false;
    return true;
  });
}

async function readVisibleEntries(dirPath: string): Promise<DirEntry[]> {
  const entries = await readDir(dirPath);
  return filterVisibleEntries(entries);
}

/**
 * 读取文件用于预览：.class 文件走字节码解析（服务端 /api/v1/file/parse-class），
 * 其余文件按 UTF-8 文本读取。
 */
async function readFileForPreview(
  path: string,
): Promise<{ content: string; parsedType?: string }> {
  const name = getPathBasename(path);
  if (name.toLowerCase().endsWith(".class")) {
    const bytes = await readFile(path);
    if (bytes.length > MAX_CLASS_PARSE_BYTES) {
      throw new Error(
        `class 文件过大（${(bytes.length / 1024 / 1024).toFixed(1)}MB > 16MB），暂不支持解析预览`,
      );
    }
    const res = await parseClassFile(name, bytes);
    if (res.code === "0000" && res.data?.content) {
      return {
        content: res.data.content,
        parsedType: res.data.parsedType ?? "java-class",
      };
    }
    throw new Error(res.info || "class 文件解析失败");
  }
  return { content: await readTextFile(path) };
}

interface LocalFileStore {
  rootPath: string | null;
  gitBranch: string | null;
  projects: LocalProject[];
  activeProjectId: string | null;
  activeLocalProjectId: string | null;
  tree: LocalFileNode[];
  expandedPaths: Set<string>;
  selectedPath: string | null;
  loading: boolean;
  error: string | null;

  openTabs: LocalAnyTab[];
  activeTabKey: string | null;

  openFolder: () => Promise<void>;
  closeProject: (projectId: string) => Promise<void>;
  switchProject: (projectId: string) => Promise<void>;
  clearActiveProject: () => void;
  refreshGitBranch: (path?: string) => Promise<void>;
  listProjectBranches: (projectId: string) => Promise<string[]>;
  switchProjectBranch: (projectId: string, branch: string) => Promise<boolean>;
  readDirectory: (
    dirPath: string,
    maxDepth?: number,
  ) => Promise<LocalFileNode[]>;
  toggleDirectory: (path: string) => Promise<void>;
  expandDirectory: (path: string) => Promise<void>;
  openFile: (path: string) => Promise<void>;
  updateFileContent: (key: string, content: string) => void;
  saveFile: (key: string) => Promise<boolean>;
  setActiveTab: (key: string) => void;
  closeTab: (key: string) => void;
  closeAllTabs: () => void;
  closeOtherTabs: (key: string) => void;
  /** 关闭指定标签左侧的所有标签 */
  closeTabsToLeft: (key: string) => void;
  /** 关闭指定标签右侧的所有标签 */
  closeTabsToRight: (key: string) => void;
  refreshDirectory: (path: string) => Promise<void>;
  /** 强制重新读取当前活动标签的文件内容（AI 修改文件后刷新编辑器） */
  reloadActiveFile: () => Promise<void>;
  /** 按文件路径重载指定标签内容，返回重载后的文本 */
  reloadFileByPath: (path: string) => Promise<string | null>;
  /** 读取文件内容（不打开 tab），用于 AI 变更后获取 afterContent */
  readFileContent: (path: string) => Promise<string | null>;
  /** 按文件路径恢复指定内容，并落盘保存 */
  restoreFileContent: (path: string, content: string) => Promise<boolean>;
  setSelectedPath: (path: string | null) => void;
  closeFolder: () => void;
  restoreFolder: () => Promise<boolean>;
  /** 打开本地文件的 Diff 标签页 */
  openDiffTab: (previewId: string) => void;
  /** 关闭本地文件的 Diff 标签页 */
  closeDiffTab: (previewId: string) => void;
  /** 展开文件树到指定路径的目录（确保文件在树中可见） */
  expandPathTo: (filePath: string) => Promise<void>;
}

const STORAGE_KEY = "damaocode-local-projects";

interface SavedProjects {
  projects: LocalProject[];
  activeProjectId: string | null;
  activeLocalProjectId: string | null;
}

/** 从 localStorage 恢复上次打开的文件夹 */
function loadSavedProjects(): SavedProjects | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const legacyPath = localStorage.getItem("damaocode-local-folder");
      if (!legacyPath) return null;
      return {
        projects: [
          {
            id: legacyPath,
            path: legacyPath,
            name: getPathBasename(legacyPath),
            branch: null,
          },
        ],
        activeProjectId: legacyPath,
        activeLocalProjectId: legacyPath,
      };
    }

    const parsed = JSON.parse(raw) as Partial<SavedProjects>;
    if (!Array.isArray(parsed.projects) || parsed.projects.length === 0)
      return null;
    const projects = parsed.projects
      .filter((project) => typeof project?.path === "string" && project.path)
      .map((project) => ({
        id: project.id || project.path!,
        path: project.path!,
        name: project.name || getPathBasename(project.path!),
        branch: project.branch ?? null,
      }));
    if (projects.length === 0) return null;
    return {
      projects,
      activeProjectId: projects.some((p) => p.id === parsed.activeProjectId)
        ? parsed.activeProjectId!
        : projects[0].id,
      activeLocalProjectId: projects.some(
        (p) => p.id === parsed.activeProjectId,
      )
        ? parsed.activeProjectId!
        : projects[0].id,
    };
  } catch {
    return null;
  }
}

/** 保存文件夹路径到 localStorage */
function saveProjects(
  projects: LocalProject[],
  activeProjectId: string | null,
) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ projects, activeProjectId }),
    );
    localStorage.removeItem("damaocode-local-folder");
  } catch {
    /* ignore */
  }
}

/** 清除保存的文件夹 */
function clearSavedFolder() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem("damaocode-local-folder");
  } catch {
    /* ignore */
  }
}

async function readGitBranch(projectPath: string): Promise<string | null> {
  let currentPath = projectPath.replace(/\/+$/, "");

  try {
    const result = await invoke<{
      success: boolean;
      stdout: string;
      stderr: string;
    }>("execute_shell_cmd", {
      command: "git rev-parse --abbrev-ref HEAD",
      cwd: currentPath,
      timeoutMs: 2000,
      autoBackground: false,
    });
    const branch = result.stdout.trim();
    if (result.success && branch && branch !== "HEAD") return branch;
  } catch {
    /* fall back to .git/HEAD below */
  }

  for (let depth = 0; depth < 6; depth += 1) {
    try {
      const head = (
        await readTextFile(joinPath(currentPath, ".git/HEAD"))
      ).trim();
      const branchMatch = head.match(/^ref:\s+refs\/heads\/(.+)$/);

      if (branchMatch) return branchMatch[1];
      return head.replace(/^refs\//, "") || null;
    } catch {
      const parentPath = currentPath.split("/").slice(0, -1).join("/");
      if (!parentPath || parentPath === currentPath) return null;
      currentPath = parentPath;
    }
  }

  return null;
}

export const useLocalFileStore = create<LocalFileStore>((set, get) => ({
  rootPath: null,
  gitBranch: null,
  projects: [],
  activeProjectId: null,
  activeLocalProjectId: null,
  tree: [],
  expandedPaths: new Set(),
  selectedPath: null,
  loading: false,
  error: null,
  openTabs: [],
  activeTabKey: null,

  openFolder: async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "选择文件夹",
      });

      if (!selected || typeof selected !== "string") return;

      set({ loading: true, error: null });

      const tree = await get().readDirectory(selected, 1);
      const gitBranch = await readGitBranch(selected);
      const project: LocalProject = {
        id: selected,
        path: selected,
        name: getPathBasename(selected),
        branch: gitBranch,
      };
      const existingProjects = get().projects;
      const projects = existingProjects.some((p) => p.id === selected)
        ? existingProjects.map((p) => (p.id === selected ? project : p))
        : [...existingProjects, project];

      set({
        rootPath: selected,
        gitBranch,
        projects,
        activeProjectId: selected,
        activeLocalProjectId: selected,
        tree,
        expandedPaths: new Set([selected]),
        loading: false,
        openTabs: [],
        activeTabKey: null,
        selectedPath: null,
      });
      saveProjects(projects, selected);
    } catch (err: any) {
      set({ loading: false, error: err?.message || "打开文件夹失败" });
    }
  },

  closeProject: async (projectId) => {
    const { projects, activeProjectId } = get();
    if (!projects.some((item) => item.id === projectId)) return;

    const remainingProjects = projects.filter((item) => item.id !== projectId);
    const nextActiveProjectId =
      activeProjectId === projectId
        ? (remainingProjects[0]?.id ?? null)
        : activeProjectId;
    saveProjects(remainingProjects, nextActiveProjectId);
    set({ projects: remainingProjects, activeProjectId: nextActiveProjectId });

    if (remainingProjects.length === 0) {
      set({
        rootPath: null,
        gitBranch: null,
        activeProjectId: null,
        activeLocalProjectId: null,
        tree: [],
        expandedPaths: new Set(),
        selectedPath: null,
        openTabs: [],
        activeTabKey: null,
      });
      return;
    }

    if (activeProjectId === projectId) {
      if (nextActiveProjectId) await get().switchProject(nextActiveProjectId);
    }
  },

  switchProject: async (projectId) => {
    const project = get().projects.find((p) => p.id === projectId);
    if (!project || project.id === get().activeProjectId) return;

    try {
      set({ loading: true, error: null });
      const [tree, gitBranch] = await Promise.all([
        get().readDirectory(project.path, 1),
        readGitBranch(project.path),
      ]);
      const nextProject = { ...project, branch: gitBranch };

      set({
        rootPath: project.path,
        gitBranch,
        activeProjectId: project.id,
        activeLocalProjectId: project.id,
        projects: get().projects.map((p) =>
          p.id === project.id ? nextProject : p,
        ),
        tree,
        expandedPaths: new Set([project.path]),
        loading: false,
        openTabs: [],
        activeTabKey: null,
        selectedPath: null,
      });
      saveProjects(get().projects, project.id);
    } catch (err: any) {
      set({ loading: false, error: err?.message || "切换项目失败" });
    }
  },

  clearActiveProject: () => {
    set({
      rootPath: null,
      gitBranch: null,
      activeProjectId: null,
      activeLocalProjectId: null,
      tree: [],
      expandedPaths: new Set(),
      selectedPath: null,
      openTabs: [],
      activeTabKey: null,
    });
  },

  readDirectory: async (
    dirPath: string,
    maxDepth = 1,
  ): Promise<LocalFileNode[]> => {
    const result: LocalFileNode[] = [];

    try {
      const entries = await readVisibleEntries(dirPath);

      for (const entry of entries) {
        const entryPath = joinPath(dirPath, entry.name);
        if (!entry.isDirectory) {
          result.push({
            name: entry.name,
            path: entryPath,
            directory: false,
            size: null,
            loaded: false,
          });
          continue;
        }

        if (isInsideJavaSourcePath(entryPath)) {
          let currentPath = entryPath;
          const mergedSegments = [getPathBasename(entryPath)];

          try {
            while (true) {
              const childEntries = await readVisibleEntries(currentPath);
              const childDirs = childEntries.filter((item) => item.isDirectory);
              const childFiles = childEntries.filter(
                (item) => !item.isDirectory,
              );
              if (childFiles.length > 0 || childDirs.length !== 1) break;

              const onlyChild = childDirs[0];
              currentPath = joinPath(currentPath, onlyChild.name);
              mergedSegments.push(onlyChild.name);
            }
          } catch {
            // 目录扫描失败时保留当前层级，避免整个树渲染中断
          }

          const node: LocalFileNode = {
            name: mergedSegments.join("."),
            path: currentPath,
            directory: true,
            size: null,
            loaded: false,
          };

          if (maxDepth > 0) {
            try {
              node.children = await get().readDirectory(
                currentPath,
                maxDepth - 1,
              );
              node.loaded = true;
            } catch {
              node.children = [];
              node.loaded = false;
            }
          }

          result.push(node);
          continue;
        }

        const node: LocalFileNode = {
          name: entry.name,
          path: entryPath,
          directory: true,
          size: null,
          loaded: false,
        };

        if (maxDepth > 0) {
          try {
            node.children = await get().readDirectory(entryPath, maxDepth - 1);
            node.loaded = true;
          } catch {
            node.children = [];
            node.loaded = false;
          }
        }

        result.push(node);
      }
    } catch (err) {
      console.error("readDirectory error:", dirPath, err);
    }

    // 目录在前，文件在后
    result.sort((a, b) => {
      if (a.directory !== b.directory) return a.directory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return result;
  },

  refreshGitBranch: async (path) => {
    const projectPath = path ?? get().rootPath;
    if (!projectPath) return;

    const gitBranch = await readGitBranch(projectPath);
    set((state) => {
      const projects = state.projects.map((project) =>
        project.path === projectPath
          ? { ...project, branch: gitBranch }
          : project,
      );
      saveProjects(projects, state.activeProjectId);
      return { gitBranch, projects };
    });
  },

  listProjectBranches: async (projectId) => {
    const project = get().projects.find((item) => item.id === projectId);
    if (!project) return [];

    try {
      const result = await invoke<{
        success: boolean;
        stdout: string;
        stderr: string;
      }>("execute_shell_cmd", {
        command: "git branch --format='%(refname:short)'",
        cwd: project.path,
        timeoutMs: 2000,
        autoBackground: false,
      });
      if (!result.success) return [];
      const branches = result.stdout
        .split("\n")
        .map((branch) => branch.trim())
        .filter(Boolean);
      return project.branch && !branches.includes(project.branch)
        ? [project.branch, ...branches]
        : branches;
    } catch {
      return project.branch ? [project.branch] : [];
    }
  },

  switchProjectBranch: async (projectId, branch) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)) return false;
    const project = get().projects.find((item) => item.id === projectId);
    if (!project) return false;

    try {
      const result = await invoke<{
        success: boolean;
        stdout: string;
        stderr: string;
      }>("execute_shell_cmd", {
        command: `git checkout ${branch}`,
        cwd: project.path,
        timeoutMs: 10000,
        autoBackground: false,
      });
      if (!result.success) return false;

      const gitBranch = await readGitBranch(project.path);
      set((state) => ({
        gitBranch:
          state.activeProjectId === projectId ? gitBranch : state.gitBranch,
        projects: state.projects.map((item) =>
          item.id === projectId ? { ...item, branch: gitBranch } : item,
        ),
      }));
      saveProjects(get().projects, get().activeProjectId);
      if (get().rootPath === project.path) {
        await get().refreshDirectory(project.path);
      }
      return true;
    } catch {
      return false;
    }
  },

  toggleDirectory: async (path: string) => {
    const expanded = new Set(get().expandedPaths);
    if (expanded.has(path)) {
      expanded.delete(path);
      set({ expandedPaths: expanded });
    } else {
      expanded.add(path);
      set({ expandedPaths: expanded });
      // 加载子目录内容
      await get().expandDirectory(path);
    }
  },

  expandDirectory: async (path: string) => {
    /**
     * 在树中找到目标目录节点并加载其 children。
     * 使用不可变更新确保 React 检测到变化。
     */
    const loadChildren = (nodes: LocalFileNode[]): LocalFileNode[] => {
      return nodes.map((node) => {
        if (node.path === path && node.directory && !node.loaded) {
          // 异步加载子节点
          get()
            .readDirectory(path, 1)
            .then((children) => {
              set((state) => ({
                tree: updateNodeInTree(state.tree, path, {
                  children,
                  loaded: true,
                }),
              }));
            })
            .catch(() => {});
          return { ...node, children: [], loaded: false }; // 占位，实际由上面的 set 更新
        }
        if (node.children && node.children.length > 0) {
          return { ...node, children: loadChildren(node.children) };
        }
        return node;
      });
    };

    const newTree = loadChildren(get().tree);
    // 如果有变化才更新（避免不必要的渲染）
    set({ tree: newTree });
  },

  openFile: async (path: string) => {
    const key = path;
    const existing = get().openTabs.find((t) => t.key === key);
    if (existing) {
      // 文件已打开：激活 tab 并定位到文件树
      set({ activeTabKey: key, selectedPath: path });
      // 展开文件树到文件所在目录
      await get().expandPathTo(path);
      return;
    }

    const name = path.split("/").pop() || path;
    const language = getLanguage(name);

    set((state) => ({
      openTabs: [
        ...state.openTabs,
        {
          key,
          path,
          name,
          content: "",
          loading: true,
          modified: false,
          language,
        },
      ],
      activeTabKey: key,
      selectedPath: path,
    }));
    // 展开文件树到文件所在目录
    await get().expandPathTo(path);

    try {
      const { content, parsedType } = await readFileForPreview(path);
      set((state) => ({
        openTabs: state.openTabs.map((t) =>
          t.key === key ? { ...t, content, parsedType, loading: false } : t,
        ),
      }));
    } catch (err: any) {
      console.error("readFileForPreview error:", path, err);
      set((state) => ({
        openTabs: state.openTabs.map((t) =>
          t.key === key
            ? { ...t, loading: false, error: err?.message || "无法读取文件" }
            : t,
        ),
      }));
    }
  },

  updateFileContent: (key, content) => {
    set((state) => ({
      openTabs: state.openTabs.map((t) =>
        !isLocalDiffTab(t) && t.key === key && t.content !== content
          ? { ...t, content, modified: true }
          : t,
      ),
    }));
  },

  saveFile: async (key: string) => {
    const tab = get().openTabs.find(
      (t) => !isLocalDiffTab(t) && t.key === key,
    ) as LocalOpenTab | undefined;
    if (!tab) return false;
    // 解析视图（如 class 字节码结构）只读，禁止落盘覆盖二进制文件
    if (tab.parsedType) {
      console.warn(
        "[localFileStore] saveFile blocked: parsed readonly view",
        tab.path,
      );
      return false;
    }

    try {
      await writeTextFile(tab.path, tab.content);
      set((state) => ({
        openTabs: state.openTabs.map((t) =>
          t.key === key ? { ...t, modified: false } : t,
        ),
      }));
      return true;
    } catch (err: any) {
      set((state) => ({
        openTabs: state.openTabs.map((t) =>
          t.key === key ? { ...t, error: err?.message || "保存失败" } : t,
        ),
      }));
      return false;
    }
  },

  setActiveTab: (key) => {
    const tab = get().openTabs.find((t) => t.key === key);
    set({ activeTabKey: key, selectedPath: tab?.path || null });
  },

  closeTab: (key) => {
    set((state) => {
      const tabs = state.openTabs.filter((t) => t.key !== key);
      let nextKey = state.activeTabKey;
      if (state.activeTabKey === key) {
        nextKey = tabs.length ? tabs[tabs.length - 1].key : null;
      }
      return { openTabs: tabs, activeTabKey: nextKey };
    });
  },

  closeAllTabs: () => set({ openTabs: [], activeTabKey: null }),

  closeOtherTabs: (key) =>
    set((state) => ({
      openTabs: state.openTabs.filter((t) => t.key === key),
      activeTabKey: key,
    })),

  closeTabsToLeft: (key) =>
    set((state) => {
      const idx = state.openTabs.findIndex((t) => t.key === key);
      if (idx <= 0) return {};
      const openTabs = state.openTabs.slice(idx);
      const activeTabKey =
        state.activeTabKey && openTabs.some((t) => t.key === state.activeTabKey)
          ? state.activeTabKey
          : key;
      return { openTabs, activeTabKey };
    }),

  closeTabsToRight: (key) =>
    set((state) => {
      const idx = state.openTabs.findIndex((t) => t.key === key);
      if (idx === -1 || idx === state.openTabs.length - 1) return {};
      const openTabs = state.openTabs.slice(0, idx + 1);
      const activeTabKey =
        state.activeTabKey && openTabs.some((t) => t.key === state.activeTabKey)
          ? state.activeTabKey
          : key;
      return { openTabs, activeTabKey };
    }),

  refreshDirectory: async (path: string) => {
    const { readDirectory, rootPath, expandedPaths } = get();

    if (path === rootPath) {
      // tree 存的是根目录的 children（不含 rootPath 节点本身），
      // updateNodeInTree 永远匹配不到根节点 → 必须整体替换
      const children = await readDirectory(path, 1);
      const tree = await refreshExpandedNodes(
        children,
        expandedPaths,
        readDirectory,
      );
      const gitBranch = await readGitBranch(path);
      set({ tree, gitBranch });
      return;
    }

    const children = await readDirectory(path, 1);
    const refreshedChildren = await refreshExpandedNodes(
      children,
      expandedPaths,
      readDirectory,
    );
    set((state) => ({
      tree: updateNodeInTree(state.tree, path, {
        children: refreshedChildren,
        loaded: true,
      }),
    }));
  },

  reloadActiveFile: async () => {
    const { activeTabKey, openTabs } = get();
    if (!activeTabKey) return;
    const tab = openTabs.find((t) => t.key === activeTabKey);
    if (!tab) return;
    try {
      const { content, parsedType } = await readFileForPreview(tab.path);
      set((state) => ({
        openTabs: state.openTabs.map((t) =>
          t.key === activeTabKey
            ? {
                ...t,
                content,
                parsedType,
                loading: false,
                modified: false,
                contentVersion: ((t as LocalOpenTab).contentVersion ?? 0) + 1,
              }
            : t,
        ),
      }));
    } catch (err: any) {
      console.error("[localFileStore] reloadActiveFile error:", tab.path, err);
    }
  },

  reloadFileByPath: async (path: string) => {
    const tab = get().openTabs.find((t) => t.path === path);
    if (!tab) return null;
    try {
      const { content, parsedType } = await readFileForPreview(path);
      set((state) => ({
        openTabs: state.openTabs.map((t) =>
          t.path === path
            ? {
                ...t,
                content,
                parsedType,
                loading: false,
                modified: false,
                error: undefined,
                contentVersion: ((t as LocalOpenTab).contentVersion ?? 0) + 1,
              }
            : t,
        ),
      }));
      return content;
    } catch (err: any) {
      console.error("[localFileStore] reloadFileByPath error:", path, err);
      return null;
    }
  },

  readFileContent: async (path: string) => {
    try {
      const { content } = await readFileForPreview(path);
      return content;
    } catch (err: any) {
      console.error("[localFileStore] readFileContent error:", path, err);
      return null;
    }
  },

  restoreFileContent: async (path: string, content: string) => {
    try {
      await writeTextFile(path, content);
      set((state) => ({
        openTabs: state.openTabs.map((t) =>
          t.path === path
            ? {
                ...t,
                content,
                loading: false,
                modified: false,
                error: undefined,
              }
            : t,
        ),
      }));
      return true;
    } catch (err: any) {
      console.error("[localFileStore] restoreFileContent error:", path, err);
      set((state) => ({
        openTabs: state.openTabs.map((t) =>
          t.path === path ? { ...t, error: err?.message || "恢复文件失败" } : t,
        ),
      }));
      return false;
    }
  },

  setSelectedPath: (path) => set({ selectedPath: path }),

  closeFolder: async () => {
    const { projects, activeProjectId } = get();
    const activeProject = projects.find(
      (project) => project.id === activeProjectId,
    );
    const remainingProjects = activeProject
      ? projects.filter((project) => project.id !== activeProject.id)
      : projects;

    if (remainingProjects.length === 0) {
      clearSavedFolder();
      set({
        rootPath: null,
        gitBranch: null,
        projects: [],
        activeProjectId: null,
        tree: [],
        expandedPaths: new Set(),
        selectedPath: null,
        openTabs: [],
        activeTabKey: null,
      });
      return;
    }

    await get().switchProject(remainingProjects[0].id);
    saveProjects(get().projects, get().activeProjectId);
  },

  restoreFolder: async (): Promise<boolean> => {
    const saved = loadSavedProjects();
    if (!saved) return false;

    const projectsWithBranches = await Promise.all(
      saved.projects.map(async (project) => ({
        ...project,
        branch: await readGitBranch(project.path),
      })),
    );
    const activeProject =
      projectsWithBranches.find(
        (project) => project.id === saved.activeProjectId,
      ) || projectsWithBranches[0];

    try {
      set({ loading: true, error: null });
      const tree = await get().readDirectory(activeProject.path, 1);
      const gitBranch = await readGitBranch(activeProject.path);
      const activeProjectWithBranch = { ...activeProject, branch: gitBranch };
      const projects = projectsWithBranches.map((project) =>
        project.id === activeProjectWithBranch.id
          ? activeProjectWithBranch
          : project,
      );
      set({
        rootPath: activeProject.path,
        gitBranch,
        projects,
        activeProjectId: activeProjectWithBranch.id,
        tree,
        expandedPaths: new Set([activeProject.path]),
        loading: false,
      });
      saveProjects(projects, activeProjectWithBranch.id);
      return true;
    } catch (err: any) {
      // 保存的路径可能不存在了，清除它
      clearSavedFolder();
      set({ loading: false, error: null });
      return false;
    }
  },

  /** 打开本地文件 Diff 标签页：通过 AiPatchPreview id 查找 preview，创建 LocalDiffTab */
  openDiffTab: (previewId) => {
    const preview = useAiPatchStore
      .getState()
      .previews.find((p) => p.id === previewId);
    if (!preview) return;

    const key = `diff:${previewId}`;
    const existing = get().openTabs.find((t) => t.key === key);
    if (existing) {
      get().setActiveTab(key);
      return;
    }

    const sep = preview.path.lastIndexOf("/");
    const name = sep >= 0 ? preview.path.substring(sep + 1) : preview.path;
    const language = getLanguage(name);

    const newTab: LocalDiffTab = {
      kind: "diff",
      key,
      previewId: preview.id,
      path: preview.path,
      name,
      language,
      beforeContent: preview.beforeContent,
      afterContent: preview.afterContent,
      addedLines: preview.addedLines,
      removedLines: preview.removedLines,
    };

    set((state) => ({ openTabs: [...state.openTabs, newTab] }));
    get().setActiveTab(key);
  },

  /** 关闭本地文件 Diff 标签页 */
  closeDiffTab: (previewId) => {
    const key = `diff:${previewId}`;
    get().closeTab(key);
  },

  /** 展开文件树到指定路径的目录层级（确保文件在树中可见并被选中） */
  expandPathTo: async (filePath: string) => {
    const { rootPath, expandedPaths } = get();
    if (!rootPath) return;

    // 从根目录开始，逐级展开到文件所在目录
    const normalized = filePath.replace(/\\/g, "/");
    const segments = normalized
      .replace(rootPath + "/", "")
      .replace(rootPath, "")
      .split("/")
      .filter(Boolean);
    // 文件名在最后，目录路径是除最后一段以外的全部
    const dirSegments = segments.slice(0, -1);

    const newExpanded = new Set(expandedPaths);
    let currentPath = rootPath;
    let needsTreeUpdate = false;

    for (const seg of dirSegments) {
      currentPath = joinPath(currentPath, seg);
      if (!newExpanded.has(currentPath)) {
        newExpanded.add(currentPath);
        needsTreeUpdate = true;
        // 确保该目录已加载子节点
        await get().expandDirectory(currentPath);
      }
    }

    if (needsTreeUpdate) {
      set({ expandedPaths: newExpanded, selectedPath: filePath });
    } else {
      set({ selectedPath: filePath });
    }
  },
}));

/**
 * 不可变更新：在树中找到指定路径的节点并合并新属性
 */
function updateNodeInTree(
  nodes: LocalFileNode[],
  targetPath: string,
  updates: Partial<LocalFileNode>,
): LocalFileNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return { ...node, ...updates };
    }
    if (node.children) {
      return {
        ...node,
        children: updateNodeInTree(node.children, targetPath, updates),
      };
    }
    return node;
  });
}

/**
 * 递归刷新已展开（或已加载过 children）的子目录，
 * 返回刷新后的节点列表。文件/目录被删除时自然从树中消失。
 */
async function refreshExpandedNodes(
  nodes: LocalFileNode[],
  expandedPaths: Set<string>,
  readDir: (p: string, maxDepth?: number) => Promise<LocalFileNode[]>,
): Promise<LocalFileNode[]> {
  return Promise.all(
    nodes.map(async (node) => {
      if (!node.directory || !(node.loaded || expandedPaths.has(node.path)))
        return node;
      try {
        const children = await readDir(node.path, 1);
        const refreshedChildren = await refreshExpandedNodes(
          children,
          expandedPaths,
          readDir,
        );
        return { ...node, children: refreshedChildren, loaded: true };
      } catch {
        // 目录读取失败（可能已被删除）：保留原节点，是否消失由父级刷新结果决定
        return node;
      }
    }),
  );
}
