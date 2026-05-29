# Decision: Windows First-Class Platform

> status: decided | date: 2025-01
> supersedes: none

## Context

用户要求 Linux + macOS + Windows 全部为 first-class 支持。

## Alternatives Considered

### A. Linux only + macOS "尽力支持"（❌ 已否决）

不符合用户明确要求。

### B. 三平台但 Windows 用 WSL（❌ 已否决）

让 Windows 用户安装 WSL 再运行 peer-bridge。

**否决理由**：
- WSL 是额外的安装负担
- named pipe / Windows Service 才是原生 Windows 体验
- 用户明确要求 "Windows first-class"

### C. 三平台原生（✅ 选定）

## Decision

三平台全部 first-class：
- **IPC**: Windows 用 named pipe (`\\.\pipe\peer-bridge-<username>`)，Linux/macOS 用 Unix socket
- **权限**: Windows 用 NTFS ACL 检查 `identity.key` 权限，Unix 用文件权限 `0600`
- **daemon 部署**: Windows 支持 `peer-bridge-daemon install-service` 安装为 Windows Service
- **通知 hook**: 支持 `.bat`/`.ps1` 脚本（环境变量传参）
- **CI 矩阵**: 每个 milestone 必须三平台绿灯才能合并
- **data_dir**: Windows 用 `%APPDATA%\peer-bridge\`，Unix 用 `~/.peer-bridge/`

## 具体迁移规则

| 功能 | Linux/macOS | Windows |
|---|---|---|
| IPC | `<data_dir>/daemon.sock` (Unix socket) | `\\.\pipe\peer-bridge-<username>` (named pipe) |
| Daemon 启动 | systemd user service / launchd LaunchAgent | 前台运行，或 `install-service` 安装 Windows Service |
| identity.key 权限 | `chmod 600` | NTFS ACL: owner = current user, no other read |
| Hook 脚本 | `.sh` | `.bat` / `.ps1` |
| Data dir | `~/.peer-bridge/` | `%APPDATA%\peer-bridge\` |

## Consequences

| 正面 | 负面 |
|---|---|
| 三平台用户体验一致 | 开发和测试工作量 3x |
| 不强制 WSL | Windows Service 和 named pipe 的 Node.js 支持需要验证 |
| CI 覆盖保证质量 | NTFS ACL 操作需额外实现 |

## Related

- Fact: `platform-ipc-mechanisms.md`
- DESIGN.md §4（data_dir 路径）
- DESIGN.md §13.7（用户偏好）
