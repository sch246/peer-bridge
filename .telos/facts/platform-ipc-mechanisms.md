# Fact: Cross-Platform IPC Mechanisms

> 外部约束。三平台（Linux、macOS、Windows）上 daemon 与 CLI/extension 通信的 IPC 机制差异。

## Linux / macOS: Unix Domain Socket

| 属性 | 值 |
|---|---|
| **路径** | `<data_dir>/daemon.sock` |
| **权限** | Unix file permissions (`chmod 600` 等效：仅 owner 可读写) |
| **进程间** | 同一主机任意用户进程可连接（受权限控制） |
| **协议** | 原始字节流，上层用 HTTP | 
| **Node.js API** | `net.createServer()` → `server.listen('/path/to/socket')` |
| **客户端** | `net.createConnection('/path/to/socket')` 或 `http.request({ socketPath })` |

**性质**：
- 文件系统中的 inode，清理不当会留下 stale socket 文件
- 启动时自动删除旧的 stale socket 文件
- 进程退出时 socket 文件自动消失（但异常中断可能残留）

## Windows: Named Pipe

| 属性 | 值 |
|---|---|
| **路径** | `\\.\pipe\peer-bridge-<username>` |
| **权限** | NTFS ACL（daemon 启动时设置仅当前用户可访问） |
| **进程间** | 同一主机任意用户进程可连接（受 ACL 控制） |
| **协议** | 原始字节流，上层用 HTTP |
| **Node.js API** | `net.createServer()` → `server.listen('\\\\.\\pipe\\name')` |

**性质**：
- 不接触文件系统，无 stale 文件问题
- 进程退出时 pipe 自动销毁
- Path 长度限制：256 字符

## Node.js 等价抽象

Node.js `net` 模块在 Linux/macOS 和 Windows 上都支持 socket listen / connect：
```javascript
import net from 'node:net';

// Server: 平台无关（仅路径格式不同）
const server = net.createServer();
server.listen(socketPath); // Unix socket path or Windows pipe path

// Client:
const client = net.createConnection(socketPath);
```

## HTTP over IPC

上层封装 HTTP 协议：
- **Linux/macOS**：`http.request({ socketPath: '/path/to/daemon.sock', path: '/rooms/...' })`
- **Windows**：Node.js `http` 模块对 named pipe 支持存在限制。某些 Node 版本不支持 `http.request` 直接连 named pipe。需要使用 `net.createConnection` + 手动组装 HTTP

**备选方案**：使用 plain line-delimited JSON（JSONL over socket），而非 HTTP。更简单可移植：
```
请求: { "method": "GET", "path": "/rooms", "id": 1 }\n
响应: { "id": 1, "status": 200, "body": {...} }\n
事件: { "event": "message", "data": {...} }\n
```

无论选 HTTP 还是 JSONL，跨平台约束是：路径格式不同，但 `net` 模块抽象统一。

## 对 peer-bridge 的影响

1. **daemon 必须跨平台启动 IPC server**：根据 `process.platform` 选择路径格式
2. **client 抽象**：core 提供统一 IPC client，根据平台自动选择路径
3. **Windows 权限**：daemon 启动时调 PowerShell 脚本设置 pipe ACL
4. **stale socket 清理**：Linux/macOS 上 daemon 启动前 `fs.unlinkSync()` 旧 socket 文件（如果存在）
5. **CI 矩阵**：三平台各跑 IPC 集成测试
6. **占位文件**：Windows 上 `<data_dir>/daemon.pipe` 为空占位文件，指示 pipe 路径

## 参考

- Node.js `net` 模块：https://nodejs.org/api/net.html
- Windows Named Pipes：https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipes
- Unix Domain Sockets：https://man7.org/linux/man-pages/man7/unix.7.html
- libuv pipe implementation（Node.js 底层）：https://github.com/libuv/libuv
