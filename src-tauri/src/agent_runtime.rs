use once_cell::sync::Lazy;
use serde::Serialize;
use std::{
    fs::{self, OpenOptions},
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{atomic::{AtomicU64, Ordering}, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeStatus {
    pub running: bool,
    pub port: u16,
    pub pid: Option<u32>,
    pub token: Option<String>,
    pub jar_path: Option<String>,
    pub java_path: Option<String>,
    pub java_version: Option<String>,
    pub last_error: Option<String>,
    pub workspace: Option<String>,
    /// 启动阶段：init / resolve / prepare / spawn / booting / ready / error
    pub stage: String,
    /// 当前阶段的可读说明，用于启动页进度提示
    pub stage_message: String,
}

struct RuntimeState {
    child: Option<Child>,
    status: AgentRuntimeStatus,
    generation: u64,
    starting: bool,
}

static GENERATION: AtomicU64 = AtomicU64::new(1);

/// 运行时连接信息落盘路径（~/.damaocode/runtime.json），供 damaocode-cli 读取
fn runtime_info_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".damaocode").join("runtime.json"))
}

/// 内嵌服务端就绪后写入连接信息（port + token），CLI 据此直连
fn persist_runtime_info(port: u16, token: &str, pid: u32) {
    let Some(path) = runtime_info_path() else { return };
    if port == 0 || token.is_empty() {
        return;
    }
    let payload = serde_json::json!({
        "port": port,
        "token": token,
        "pid": pid,
        "startedAt": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    });
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let tmp = path.with_extension("json.tmp");
    if fs::write(&tmp, payload.to_string()).is_ok() {
        let _ = fs::rename(&tmp, &path);
    }
}

/// 服务端停止/退出后清理连接信息，避免 CLI 连接失效端口
fn remove_runtime_info() {
    if let Some(path) = runtime_info_path() {
        let _ = fs::remove_file(path);
    }
}
static STATE: Lazy<Mutex<RuntimeState>> = Lazy::new(|| {
    Mutex::new(RuntimeState {
        child: None,
        status: default_status(None),
        generation: 0,
        starting: false,
    })
});

fn default_status(last_error: Option<String>) -> AgentRuntimeStatus {
    AgentRuntimeStatus {
        running: false,
        port: 0,
        pid: None,
        token: None,
        jar_path: None,
        java_path: None,
        java_version: None,
        last_error,
        workspace: None,
        stage: "init".into(),
        stage_message: "等待启动".into(),
    }
}

/// 更新当前启动阶段，前端启动页据此展示进度
fn set_stage(state: &mut RuntimeState, stage: &str, message: &str) {
    state.status.stage = stage.to_string();
    state.status.stage_message = message.to_string();
}

/// 记录启动失败：阶段置为 error，写入可读错误说明
fn fail_stage(state: &mut RuntimeState, message: &str) {
    state.status.running = false;
    state.starting = false;
    state.status.last_error = Some(message.to_string());
    set_stage(state, "error", message);
}

#[tauri::command]
pub fn start_agent_runtime(
    app: tauri::AppHandle,
    workspace: Option<String>,
) -> Result<AgentRuntimeStatus, String> {
    eprintln!("[AgentRuntime] start requested workspace={workspace:?}");
    let mut state = STATE.lock().map_err(|_| "agent runtime state poisoned")?;

    //检查之前启动的 Java 子进程是否已经退出
    if let Some(child) = state.child.as_mut() {
        if let Ok(Some(_)) = child.try_wait() {
            state.child = None;
            state.status.running = false;
            state.status.last_error = Some("Agent 进程已退出".into());
        }
    }
    if state.status.running {
        return Ok(state.status.clone());
    }
    if state.starting {
        return Ok(state.status.clone());
    }

    state.starting = true;
    set_stage(&mut state, "resolve", "正在检查运行环境（Java / Agent 服务包）…");

    let jar_path = match resolve_jar_path(&app) {
        Ok(path) => path,
        Err(error) => {
            fail_stage(&mut state, &format!("未找到 Agent 服务包：{error}"));
            return Err(state.status.last_error.clone().unwrap_or_default());
        }
    };
    let java_runtime = match resolve_java_runtime(&app) {
        Ok(runtime) => runtime,
        Err(error) => {
            fail_stage(&mut state, &error);
            return Err(error);
        }
    };
    let workspace = workspace
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .filter(|value| value.is_dir())
        .or_else(|| dirs::home_dir());
    let workspace = match workspace {
        Some(dir) => dir,
        None => {
            fail_stage(&mut state, "无法确定本地工作区目录");
            return Err(state.status.last_error.clone().unwrap_or_default());
        }
    };

    set_stage(&mut state, "prepare", "正在准备数据目录与日志文件…");
    let data_dir = match app.path().app_data_dir() {
        Ok(dir) => dir,
        Err(error) => {
            let message = format!("无法定位应用数据目录: {}", error);
            fail_stage(&mut state, &message);
            return Err(message);
        }
    };
    if let Err(error) = fs::create_dir_all(&data_dir) {
        let message = format!("创建应用数据目录失败: {}", error);
        fail_stage(&mut state, &message);
        return Err(message);
    }
    let log_dir = data_dir.join("logs");
    if let Err(error) = fs::create_dir_all(&log_dir) {
        let message = format!("创建日志目录失败: {}", error);
        fail_stage(&mut state, &message);
        return Err(message);
    }
    let log_file = match OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("agent.log"))
    {
        Ok(file) => file,
        Err(error) => {
            let message = format!("打开 Agent 日志失败: {}", error);
            fail_stage(&mut state, &message);
            return Err(message);
        }
    };

    let token = generate_token();
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst);

    // 端口冲突检测：预分配一个空闲端口并显式传给服务端，避免随机端口被占用导致启动失败
    let assigned_port = match find_available_port() {
        Some(port) => port,
        None => {
            fail_stage(&mut state, "端口冲突检测失败：无法找到可用端口，请检查本机网络环境");
            return Err(state.status.last_error.clone().unwrap_or_default());
        }
    };
    eprintln!("[AgentRuntime] assigned port={assigned_port}");

    // H2 JDBC URL 需要正斜杠路径，Windows 下统一转换，避免反斜杠转义问题
    let database_path = data_dir
        .join("damaocode")
        .to_string_lossy()
        .replace('\\', "/");
    let database_url = format!(
        "jdbc:h2:file:{};MODE=MySQL;AUTO_SERVER=TRUE",
        database_path
    );
    let mut command = Command::new(&java_runtime.path);
    command
        .arg(format!("-Dspring.datasource.url={}", database_url))
        .arg("-jar")
        .arg(&jar_path)
        .arg("--spring.profiles.active=local")
        .arg(format!("--server.port={}", assigned_port))
        .arg(format!("--damaocode.local.token={}", token))
        .arg(format!("--damaocode.local.workspace={}", workspace.display()))
        .env("WALICODE_WORKSPACE", &workspace)
        .current_dir(&data_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::from(match log_file.try_clone() {
            Ok(file) => file,
            Err(error) => {
                let message = format!("复制日志句柄失败: {}", error);
                fail_stage(&mut state, &message);
                return Err(message);
            }
        }))
        .stdin(Stdio::null());
    // Windows 下避免弹出黑色控制台窗口
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    set_stage(&mut state, "spawn", "正在拉起本地 Agent 进程…");
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let message = format!("启动 dmcode-server.jar 失败: {}", error);
            fail_stage(&mut state, &message);
            return Err(message);
        }
    };
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            fail_stage(&mut state, "无法读取 Agent 进程输出，启动中止");
            return Err(state.status.last_error.clone().unwrap_or_default());
        }
    };
    let pid = child.id();
    eprintln!("[AgentRuntime] spawned pid={pid} java={}", java_runtime.path.display());

    state.child = Some(child);
    state.generation = generation;
    state.status = AgentRuntimeStatus {
        running: true,
        port: 0,
        pid: Some(pid),
        token: Some(token),
        jar_path: Some(jar_path.display().to_string()),
        java_path: Some(java_runtime.path.display().to_string()),
        java_version: java_runtime.version,
        last_error: None,
        workspace: Some(workspace.display().to_string()),
        stage: "booting".into(),
        stage_message: "Agent 服务启动中，首次加载约需 5~15 秒…".into(),
    };

    thread::spawn(move || consume_runtime_output(stdout, generation));
    Ok(state.status.clone())
}

#[tauri::command]
pub fn stop_agent_runtime() -> Result<AgentRuntimeStatus, String> {
    let mut state = STATE.lock().map_err(|_| "agent runtime state poisoned")?;

    if let Some(child) = state.child.take() {
        terminate_child(child);
    }
    remove_runtime_info();

    state.generation = GENERATION.fetch_add(1, Ordering::SeqCst);
    state.starting = false;
    state.status = AgentRuntimeStatus {
        running: false,
        port: 0,
        pid: None,
        token: None,
        jar_path: state.status.jar_path.clone(),
        java_path: state.status.java_path.clone(),
        java_version: state.status.java_version.clone(),
        last_error: None,
        workspace: None,
        stage: "init".into(),
        stage_message: "已停止".into(),
    };

    Ok(state.status.clone())
}

fn terminate_child(mut child: Child) {
    #[cfg(unix)]
    unsafe {
        libc::kill(child.id() as libc::pid_t, libc::SIGTERM);
    }
    #[cfg(not(unix))]
    let _ = child.kill();

    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        if let Ok(Some(_)) = child.try_wait() {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }

    let _ = child.kill();
    let _ = child.wait();
}

#[tauri::command]
pub fn get_agent_runtime_status() -> AgentRuntimeStatus {
    let mut guard = match STATE.lock() {
        Ok(guard) => guard,
        Err(_) => return default_status(Some("agent runtime state poisoned".into())),
    };

    if let Some(child) = guard.child.as_mut() {
        if let Ok(Some(exit_status)) = child.try_wait() {
            guard.child = None;
            guard.status.running = false;
            guard.starting = false;
            guard.status.last_error = Some(format!("Agent 进程已退出: {}", exit_status));
            set_stage(&mut guard, "error", "Agent 进程异常退出");
            remove_runtime_info();
        }
    }
    guard.status.clone()
}

struct JavaRuntime {
    path: PathBuf,
    version: Option<String>,
}

fn consume_runtime_output(stdout: impl std::io::Read, generation: u64) {
    let reader = BufReader::new(stdout);
    for line in reader.lines() {
        let line = match line {
            Ok(value) => value,
            Err(_) => break,
        };

        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
            if value.get("event").and_then(serde_json::Value::as_str) == Some("ready") {
                let port = value
                    .get("port")
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(0) as u16;
                let token = value
                    .get("token")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string);
                let pid = value
                    .get("pid")
                    .and_then(serde_json::Value::as_u64)
                    .map(|value| value as u32);

                if let Ok(mut state) = STATE.lock() {
                    if state.generation == generation {
                        state.status.port = port;
                        state.status.pid = pid;
                        state.status.token = token.clone();
                        state.starting = false;
                        set_stage(&mut state, "ready", "Agent 服务已就绪");
                        if let Some(ref token_value) = token {
                            persist_runtime_info(port, token_value, pid.unwrap_or(0));
                        }
                    }
                }
            }
        }
    }

    if let Ok(mut state) = STATE.lock() {
        if state.generation == generation {
            state.status.running = false;
            state.starting = false;
            // 若已经 ready 后进程退出（如用户手动停止外的崩溃），给出明确提示
            let was_ready = state.status.stage == "ready";
            state.status.last_error = Some(if was_ready {
                "Agent 进程已退出".into()
            } else {
                "Agent 服务启动失败：进程在完成初始化前退出，请查看日志目录下的 agent.log".into()
            });
            set_stage(&mut state, "error", "Agent 进程已退出");
            remove_runtime_info();
        }
    }
}

fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("生成 Agent Token 失败");
    bytes.iter().map(|byte| format!("{:02x}", byte)).collect()
}

/// 探测一个空闲的本地回环端口：绑定成功后立即释放。
/// 该端口随后显式传给 Spring Boot（--server.port），避免随机端口与
/// 系统上其他进程冲突导致 Web server 启动失败。
fn find_available_port() -> Option<u16> {
    for _ in 0..10 {
        if let Ok(socket) = std::net::TcpListener::bind("127.0.0.1:0") {
            let port = socket.local_addr().ok()?.port();
            drop(socket);
            return Some(port);
        }
    }
    None
}

fn resolve_jar_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("WALICODE_SERVER_JAR").map(PathBuf::from) {
        return validate_jar(path);
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let path = resource_dir.join("agent/dmcode-server.jar");
        if path.is_file() {
            return validate_jar(path);
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let candidates = [
                parent.join("dmcode-server.jar"),
                // Windows (NSIS)：资源随 exe 平铺在安装目录
                parent.join("agent/dmcode-server.jar"),
                parent.join("resources/agent/dmcode-server.jar"),
                // macOS (.app)：Contents/Resources 下
                parent.join("../Resources/agent/dmcode-server.jar"),
            ];
            for candidate in candidates {
                if candidate.is_file() {
                    return validate_jar(candidate);
                }
            }
        }
    }

    let development_jar = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../dmcode-server/dmcode-server-app/target/dmcode-server.jar");
    validate_jar(development_jar)
}

fn resolve_java_runtime(app: &tauri::AppHandle) -> Result<JavaRuntime, String> {
    if let Some(path) = std::env::var_os("WALICODE_JAVA").map(PathBuf::from) {
        return inspect_java(path);
    }

    if let Ok(path) = which::which(java_binary_name()) {
        if let Ok(runtime) = inspect_java(path) {
            return Ok(runtime);
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let path = resource_dir
            .join("agent/runtime/bin")
            .join(java_binary_name());
        if path.is_file() {
            return inspect_java(path);
        }
    }

    let development_runtime = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../resources/agent/runtime/bin")
        .join(java_binary_name());
    if development_runtime.is_file() {
        return inspect_java(development_runtime);
    }

    if let Ok(path) = which::which(java_binary_name()) {
        return inspect_java(path);
    }

    Err("找不到可用的 Java 17 Runtime。请内置 agent/runtime 或设置 WALICODE_JAVA 后重新构建。".into())
}

fn validate_jar(path: PathBuf) -> Result<PathBuf, String> {
    let path = fs::canonicalize(path)
        .map_err(|error| format!("找不到 dmcode-server.jar: {}", error))?;
    if !path.is_file() {
        return Err(format!("路径不是文件: {}", path.display()));
    }
    Ok(path)
}

fn java_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "java.exe"
    } else {
        "java"
    }
}

fn inspect_java(path: PathBuf) -> Result<JavaRuntime, String> {
    let mut command = Command::new(&path);
    command.arg("-version");
    // Windows 下避免 java -version 弹出控制台窗口
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let output = command
        .output()
        .map_err(|error| format!("无法启动 Java Runtime {}: {}", path.display(), error))?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if !output.status.success() {
        return Err(format!("Java Runtime 检查失败: {}", path.display()));
    }

    let version = text
        .split("version \"")
        .nth(1)
        .and_then(|rest| rest.split('"').next())
        .map(str::to_string);
    let major = version.as_deref().and_then(parse_java_major);
    if major.map(|value| value < 17).unwrap_or(false) {
        return Err(format!(
            "DaMaoCode-Study 需要 Java 17 或更高版本，当前为 {}",
            version.unwrap_or_else(|| "未知版本".into())
        ));
    }
    Ok(JavaRuntime { path, version })
}

fn parse_java_major(version: &str) -> Option<u32> {
    let normalized = version.strip_prefix("1.").unwrap_or(version);
    normalized
        .split(['.', '-'])
        .next()
        .and_then(|value| value.parse().ok())
}
