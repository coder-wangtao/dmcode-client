/**
 * HTTP 请求客户端
 * 封装 fetch，统一处理响应格式和错误
 *
 * 默认行为（dev 模式）：baseUrl = ''，走 Vite proxy
 * 生产模式（Tauri）：由本地 Agent Runtime 启动后动态指定直连地址
 */

/** 后端统一响应结构 */
export interface ApiResponse<T = unknown> {
  code: string;
  info: string;
  data: T | null;
}

let authToken: string | null = null;

/**
 * 服务端基础地址
 * - dev 模式默认空字符串（走 Vite proxy）
 * - 生产模式由本地 Agent Runtime 启动后覆盖
 */
let baseUrl = "";

/** 获取当前服务端地址（Runtime 启动前为空字符串） */
export function getBaseUrl(): string {
  return baseUrl;
}

/** 构建原始 fetch 使用的认证头 */
export function getAuthHeaders(
  extraHeaders: Record<string, string> = {},
): Record<string, string> {
  return authToken
    ? { ...extraHeaders, Authorization: `Bearer ${authToken}` }
    : extraHeaders;
}

/** 设置本地 Agent 动态地址和一次性 Token */
export function setRequestBaseUrl(url: string, token: string | null): void {
  const trimmed = url.trim().replace(/\/+$/, "");
  baseUrl = trimmed;
  authToken = token;
  localStorage.removeItem("damaossh_server_url");
  if (token) {
    localStorage.setItem("damaocode_runtime_token", token);
  } else {
    localStorage.removeItem("damaocode_runtime_token");
  }
}

/** 请求超时（毫秒） */
const TIMEOUT_MS = 15000;

/**
 * 通用请求方法
 */
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, string>,
): Promise<ApiResponse<T>> {
  // 拼接 query string
  let url = `${baseUrl}${path}`;
  if (params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    if (qs) url += `?${qs}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method,
      headers: getAuthHeaders(
        body ? { "Content-Type": "application/json" } : {},
      ),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      return { code: String(res.status), info: res.statusText, data: null };
    }

    return (await res.json()) as ApiResponse<T>;
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return { code: "TIMEOUT", info: "请求超时", data: null };
    }
    return {
      code: "NETWORK_ERROR",
      info: err?.message || "网络错误",
      data: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** GET 请求 */
export function get<T>(path: string, params?: Record<string, string>) {
  return request<T>("GET", path, undefined, params);
}

/** POST 请求（JSON body + 可选 query params） */
export function post<T>(
  path: string,
  body?: unknown,
  params?: Record<string, string>,
) {
  return request<T>("POST", path, body, params);
}

/** POST FormData 请求（用于上传文件），无默认超时，支持外部传入 signal 取消 */
export async function postFormData<T>(
  path: string,
  formData: FormData,
  signal?: AbortSignal,
): Promise<ApiResponse<T>> {
  let url = `${baseUrl}${path}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: getAuthHeaders(),
      body: formData,
      signal,
    });

    if (!res.ok) {
      return { code: String(res.status), info: res.statusText, data: null };
    }
    return (await res.json()) as ApiResponse<T>;
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return { code: "CANCELLED", info: "上传已取消", data: null };
    }
    return {
      code: "NETWORK_ERROR",
      info: err?.message || "网络错误",
      data: null,
    };
  }
}

/** PUT 请求 */
export function put<T>(
  path: string,
  body?: unknown,
  params?: Record<string, string>,
) {
  return request<T>("PUT", path, body, params);
}

/** DELETE 请求 */
export function del<T>(path: string, params?: Record<string, string>) {
  return request<T>("DELETE", path, undefined, params);
}
