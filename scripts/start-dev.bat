@echo off
REM ==============================================================================
REM DaMaoCode 一键启动脚本 (Windows)
REM 流程: 清理缓存 -> 检查 dmcode-server -> 检测/构建最新 jar -> 启动后端 -> 启动前端
REM 用法: scripts\start-dev.bat [--clean] [--rebuild] [--no-server] [--no-client]
REM   --clean      深度清理(删除 node_modules\.vite 并重新 npm install)
REM   --rebuild    强制重新构建服务端 jar
REM   --no-server  跳过后端启动
REM   --no-client  跳过前端启动
REM ==============================================================================
setlocal enabledelayedexpansion
chcp 65001 >nul

set "CLIENT_DIR=%~dp0.."
for %%i in ("%CLIENT_DIR%") do set "CLIENT_DIR=%%~fi"
for %%i in ("%CLIENT_DIR%\..") do set "PARENT_DIR=%%~fi"
set "SERVER_DIR=%PARENT_DIR%\dmcode-server"
set "PORT=8091"
set "LOG_FILE=%TEMP%\dmcode-server-dev.log"

set "CLEAN=0"
set "REBUILD=0"
set "START_SERVER=1"
set "START_CLIENT=1"

:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--clean"     set "CLEAN=1"
if /i "%~1"=="--rebuild"   set "REBUILD=1"
if /i "%~1"=="--no-server" set "START_SERVER=0"
if /i "%~1"=="--no-client" set "START_CLIENT=0"
shift
goto parse_args
:args_done

echo ==============================================
echo   DaMaoCode 一键启动 (dev 模式)
echo   客户端目录: %CLIENT_DIR%
echo ==============================================

REM ---------- 1. 缓存清理 ----------
echo [INFO] 清理前端缓存...
if exist "%CLIENT_DIR%\node_modules\.vite" rmdir /s /q "%CLIENT_DIR%\node_modules\.vite"
if exist "%CLIENT_DIR%\tsconfig.tsbuildinfo" del /q "%CLIENT_DIR%\tsconfig.tsbuildinfo"
if exist "%CLIENT_DIR%\src-tauri\tsconfig.tsbuildinfo" del /q "%CLIENT_DIR%\src-tauri\tsconfig.tsbuildinfo"

REM 清理占用端口的旧进程（8091=后端, 5173=Vite）
for %%p in (8091 5173) do (
    for /f "tokens=5" %%q in ('netstat -ano ^| findstr ":%%p " ^| findstr "LISTENING"') do (
        echo [WARN] 端口 %%p 被占用 (PID: %%q)，正在终止...
        taskkill /f /pid %%q >nul 2>&1
    )
)
echo [ OK ] 缓存清理完成

if "%CLEAN%"=="1" (
    echo [INFO] 深度清理: 重新安装依赖...
    pushd "%CLIENT_DIR%"
    call npm install || goto :npm_fail
    popd
    echo [ OK ] 依赖安装完成
)

REM ---------- 2. 检查 dmcode-server ----------
if not exist "%SERVER_DIR%\" (
    echo.
    echo [FAIL] 未找到 dmcode-server 工程!
    echo   预期路径: %SERVER_DIR%
    echo   请将 dmcode-server 下载/克隆到 damaocode-client 的【同层级】目录下:
    echo       cd %PARENT_DIR%
    echo       git clone ^<dmcode-server 仓库地址^>
    echo   即最终目录结构为:
    echo       %PARENT_DIR%\
    echo       ├── damaocode-client\   ^= 当前工程
    echo       └── dmcode-server\   ^= 需要放在这里
    echo.
    pause
    exit /b 1
)
echo [ OK ] 找到 dmcode-server: %SERVER_DIR%

REM ---------- 3. 检查基础工具 ----------
where node >nul 2>&1 || (echo [FAIL] 未检测到 node，请先安装 Node.js ^(^>=18^) & pause & exit /b 1)
where npm  >nul 2>&1 || (echo [FAIL] 未检测到 npm & pause & exit /b 1)

REM ---------- 4. 选择 Java 运行时 ----------
set "JAVA_BIN=java"
set "BUNDLED_JRE=%CLIENT_DIR%\resources\agent\runtime"
where java >nul 2>&1
if errorlevel 1 (
    if exist "%BUNDLED_JRE%\bin\java.exe" (
        set "JAVA_BIN=%BUNDLED_JRE%\bin\java.exe"
        set "PATH=%BUNDLED_JRE%\bin;%PATH%"
        echo [ OK ] 使用工程内置 JRE: %BUNDLED_JRE%
    ) else (
        echo [FAIL] 未检测到 Java ^(需要 17+^)。
        echo   可安装 Temurin 17: https://adoptium.net/
        echo   或在客户端工程执行 npm run agent:runtime 下载内置 JRE 后重试。
        pause
        exit /b 1
    )
)
for /f "tokens=3" %%v in ('java -version 2^>^&1 ^| findstr /i "version"') do set "JAVA_VER=%%v"
echo [ OK ] Java: !JAVA_VER!

REM ---------- 5. 检测 jar ----------
set "JAR_FILE=%SERVER_DIR%\dmcode-server-app\target\dmcode-server.jar"
set "NEED_BUILD=0"

if "%REBUILD%"=="1" (
    set "NEED_BUILD=1"
    echo [INFO] 已指定 --rebuild，将强制重新构建 jar
) else if not exist "%JAR_FILE%" (
    set "NEED_BUILD=1"
    echo [INFO] 未找到 jar 包，需要构建
) else (
    REM 检测是否有比 jar 更新的源码
    for /f %%d in ('dir /b /o-d "%SERVER_DIR%\dmcode-server-app\src\main\java" "%SERVER_DIR%\pom.xml" 2^>nul') do rem
    for /f "delims=" %%f in ('powershell -NoProfile -Command "$jar=(Get-Item '%JAR_FILE%').LastWriteTime; $newer=Get-ChildItem -Path '%SERVER_DIR%' -Recurse -Include *.java,pom.xml,*.yml -File ^| Where-Object { $_.FullName -notmatch '\\\\target\\\\' -and $_.LastWriteTime -gt $jar } ^| Select-Object -First 1; if($newer){Write-Output 'YES'}else{Write-Output 'NO'}"') do set "SRC_NEWER=%%f"
    if "!SRC_NEWER!"=="YES" (
        set "NEED_BUILD=1"
        echo [INFO] 检测到 jar 包不是最新（源码有更新），将重新构建
    ) else (
        echo [ OK ] jar 包已是最新: %JAR_FILE%
    )
)

if "%NEED_BUILD%"=="1" (
    where mvn >nul 2>&1
    if errorlevel 1 (
        if exist "%JAR_FILE%" (
            echo [WARN] 未检测到 mvn，跳过构建，使用现有 jar
        ) else (
            echo [FAIL] 未检测到 mvn 且没有现成 jar，无法启动后端。请安装 Maven: https://maven.apache.org/
            pause
            exit /b 1
        )
    ) else (
        echo [INFO] 正在构建服务端 jar ^(mvn -DskipTests package，首次可能较慢^)...
        pushd "%SERVER_DIR%"
        call mvn -q -DskipTests package
        if errorlevel 1 (
            popd
            echo [FAIL] 服务端构建失败，请检查 dmcode-server 代码
            pause
            exit /b 1
        )
        popd
        echo [ OK ] 服务端构建完成
    )
)

REM ---------- 6. 启动后端 ----------
if "%START_SERVER%"=="1" (
    echo [INFO] 启动后端服务 ^(profile=local, port=%PORT%^)，Spring Boot 启动约需 40-60 秒...
    echo [INFO] 日志文件: %LOG_FILE%
    pushd "%SERVER_DIR%"
    start "dmcode-server" /min cmd /c ""%JAVA_BIN%" -jar "%JAR_FILE%" --spring.profiles.active=local --server.port=%PORT% > "%LOG_FILE%" 2>&1"
    popd

    set "READY=0"
    for /l %%i in (1,1,120) do (
        if "!READY!"=="0" (
            powershell -NoProfile -Command "(Test-NetConnection -ComputerName 127.0.0.1 -Port %PORT% -WarningAction SilentlyContinue).TcpTestSucceeded" 2>nul | findstr /i "True" >nul && set "READY=1"
            if "!READY!"=="0" (
                <nul set /p "=."
                timeout /t 2 /nobreak >nul
            )
        )
    )

    if "!READY!"=="1" (
        echo.
        echo [ OK ] 后端已就绪: http://localhost:%PORT%
    ) else (
        echo.
        echo [FAIL] 等待后端启动超时（约 240 秒），请查看日志: %LOG_FILE%
        pause
        exit /b 1
    )
) else (
    echo [WARN] 跳过后端启动（--no-server）
)

REM ---------- 7. 启动桌面客户端 (Tauri) ----------
if not exist "%CLIENT_DIR%\node_modules" (
    echo [INFO] 未检测到 node_modules，正在安装依赖...
    pushd "%CLIENT_DIR%"
    call npm install || goto :npm_fail
    popd
    echo [ OK ] 依赖安装完成
)

where cargo >nul 2>&1
if errorlevel 1 (
    echo [FAIL] 未检测到 cargo ^(Rust^)，桌面客户端需要 Rust 环境。
    echo   安装: 访问 https://rustup.rs/ 下载 rustup-init.exe 并安装
    pause
    exit /b 1
)

if "%START_CLIENT%"=="1" (
    echo [INFO] 启动桌面客户端 ^(Tauri dev^)，稍后 DaMaoCode 桌面窗口将自动弹出...
    echo [INFO] 关闭桌面窗口后按提示回车，将自动停止后端进程
    pushd "%CLIENT_DIR%"
    call npm run tauri dev
    popd
    echo [ OK ] 桌面客户端已退出
) else (
    echo [ OK ] 全部完成（--no-client，桌面客户端未启动）
)
goto :eof

:npm_fail
echo [FAIL] npm install 失败，请检查网络或 node 版本
popd
pause
exit /b 1
