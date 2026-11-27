//让 DaMaoCode 打包后的程序能够自带 Java，而不必依赖用户电脑预先安装 Java。
// DaMaoCode/
// ├── resources/
// │   └── agent/
// │       └── runtime/
// │           ├── bin/
// │           │   └── java
// │           ├── lib/
// │           └── ...
// └── scripts/

import { createWriteStream, existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

//await execFileAsync("tar", ["-xzf", archive, "-C", unpacked]);
const execFileAsync = promisify(execFile);
const version = process.env.DAMAOCODE_JRE_VERSION || "17";
const target =
  process.env.DAMAOCODE_JRE_TARGET || `${process.platform}-${process.arch}`;
const outputRoot = join(process.cwd(), "resources", "agent", "runtime");

const platformMap = {
  "darwin-x64": { image: "mac", arch: "x64", extension: "tar.gz" },
  "darwin-arm64": { image: "mac", arch: "aarch64", extension: "tar.gz" },
  "win32-x64": { image: "windows", arch: "x64", extension: "zip" },
  "win32-arm64": { image: "windows", arch: "aarch64", extension: "zip" },
  "linux-x64": { image: "linux", arch: "x64", extension: "tar.gz" },
  "linux-arm64": { image: "linux", arch: "aarch64", extension: "tar.gz" },
};

const platform = platformMap[target];
if (!platform) {
  throw new Error(
    `不支持的 JRE 目标平台：${target}。可用值：${Object.keys(platformMap).join(", ")}`,
  );
}

//创建临时根目录
const temporaryRoot = await mkdtemp(join(tmpdir(), "damaocode-jre-"));
//压缩包路径
const archive = join(temporaryRoot, `java-runtime.${platform.extension}`);
// 解压目录
const unpacked = join(temporaryRoot, "unpacked");

async function download(file, destination) {
  const response = await fetch(file, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`下载 JRE 失败：HTTP ${response.status} ${file}`);
  }
  await pipeline(response.body, createWriteStream(destination));
}

async function extract() {
  await mkdir(unpacked, { recursive: true });
  if (platform.extension === "zip") {
    await execFileAsync("tar", ["-xf", archive, "-C", unpacked]);
  } else {
    await execFileAsync("tar", ["-xzf", archive, "-C", unpacked]);
  }
}
//找到 Java Home
async function findJava(directory) {
  const javaName = platform.image === "windows" ? "java.exe" : "java";
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(candidate);
      } else if (entry.isFile() && entry.name === javaName) {
        return dirname(dirname(candidate));
      }
    }
  }
  throw new Error(`JRE 压缩包中未找到 ${javaName}`);
}

const javaHomeCandidates = process.env.JAVA_HOME
  ? [process.env.JAVA_HOME]
  : platform.image === "mac"
    ? ["/usr/libexec/java_home"]
    : [];

//在 macOS 上尝试利用本机安装的 JDK，通过 jlink 生成一份 Runtime，而不是下载新的 JRE。
async function jlinkFromLocalJavaHome() {
  if (platform.image !== "mac") {
    return null;
  }
  const { stdout } = await execFileAsync("/usr/libexec/java_home", [
    `-v`,
    `${version}.0`,
  ]);
  const javaHome = stdout.trim();
  if (!existsSync(join(javaHome, "bin", "jlink"))) {
    return null;
  }
  const outputRoot = join(temporaryRoot, "jlink-runtime");
  //执行 jlink
  //这里执行 jlink，是为了从本机已安装的 Java 17 JDK 生成一份可随桌面应用分发的 Runtime。
  await execFileAsync(join(javaHome, "bin", "jlink"), [
    "--add-modules",
    "ALL-MODULE-PATH",
    "--strip-debug",
    "--no-man-pages",
    "--no-header-files",
    "--compress=2",
    "--output",
    outputRoot,
  ]);
  return outputRoot;
}

async function downloadTemurin() {
  const url = `https://api.adoptium.net/v3/binary/latest/${version}/ga/${platform.image}/${platform.arch}/jre/hotspot/normal/eclipse?project=jdk`;
  const archive = join(temporaryRoot, "java-runtime." + platform.extension);
  console.log(`下载 ${target} 的 Java ${version} Runtime：${url}`);
  await download(url, archive);
  await extract();
  return findJava(unpacked);
}

try {
  console.log(`准备 ${target} 的 Java ${version} Runtime`);
  let javaHome = null;
  try {
    javaHome = await jlinkFromLocalJavaHome();
  } catch (error) {
    console.warn(`本地 jlink 失败，将下载 JRE：${error.message}`);
  }
  if (!javaHome) {
    javaHome = await downloadTemurin();
  }
  await rm(outputRoot, { recursive: true, force: true });
  //创建输出目录的父目录
  await mkdir(dirname(outputRoot), { recursive: true });
  //复制 Java Runtime 到项目目录
  await cp(javaHome, outputRoot, { recursive: true, dereference: true });
  if (platform.image !== "windows") {
    await chmod(join(outputRoot, "bin", "java"), 0o755);
  } else {
    await chmod(join(outputRoot, "bin", "java.exe"), 0o755);
  }
  // jlink 输出中 legal 等目录的文件是只读的（0444）。
  // 保留只读权限会导致 tauri build 在增量构建时无法覆盖
  // target 下已存在的同名文件（fs::copy 报 Permission denied），
  // 因此这里统一给所有文件加用户写权限。
  if (platform.image !== "windows") {
    await execFileAsync("chmod", ["-R", "u+w", outputRoot]);
  }
  console.log(`Java ${version} Runtime 已准备到 ${outputRoot}`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
