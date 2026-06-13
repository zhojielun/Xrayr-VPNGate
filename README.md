# VPN Gate Panel

VPN Gate 可视化管理面板，支持多实例管理、节点测速、XrayR 对接、定时任务等功能。

## 功能

- **多实例管理** — 创建/编辑/删除 VPN 实例，每个实例独立 tun 网卡和路由表
- **一键启动** — 自动拉取 VPN Gate 服务器、连接 OpenVPN、配置策略路由、对接 XrayR
- **节点测速** — 多线程并发 TCP 测试，按地区分类，自动选择延迟最低的可达节点
- **路由模式** — 智能自动（自动漂移）、固定国家、固定 IP 三种模式
- **定时任务** — 可视化管理 cron 心跳检测，支持一键应用到系统 crontab
- **运行日志** — 实时查看各实例运行日志
- **用户登录** — SHA256 哈希认证，支持修改密码
- **性能优化** — SQLite 存储、内存缓存、后台预加载，页面秒开

## 快速开始

### 方式一：Docker

```bash
docker run -d --name vpngate-panel \
  --cap-add=NET_ADMIN \
  --device=/dev/net/tun \
  -p 3001:3001 \
  -v /etc/XrayR:/etc/XrayR \
  -v /etc/vpngate:/etc/vpngate \
  ghcr.io/your-user/vpngate-panel:latest
```

### 方式二：直接运行

```bash
# 安装依赖
apt install python3 openvpn curl netcat-openbsd iproute2

# 克隆项目
git clone https://github.com/your-user/vpngate-panel.git
cd vpngate-panel

# 启动
python3 server.py
```

访问 `http://your-server:3001`，默认账号 `admin` / `admin`。

## 使用方法

### 创建实例

1. 点击「新建实例」
2. 输入实例名称、选择地区、填写 XrayR 配置路径
3. 点击「创建并启动」

### 节点测速

1. 点击实例列表中的 ⚡ 按钮
2. 选择路由模式（智能自动 / 固定国家 / 固定 IP）
3. 点击「开始扫描」
4. 扫描完成后点击「应用最佳节点」

### 定时任务

1. 切换到「定时任务」页面
2. 点击「新建任务」
3. 选择实例、设置 cron 表达式
4. 点击「应用到系统」写入 crontab

## 项目结构

```
vpngate-panel/
├── server.py              # Python 后端（SQLite + 缓存）
├── start.sh               # 启动脚本
├── Dockerfile
├── .github/workflows/     # GitHub Actions CI/CD
└── public/
    ├── index.html
    ├── css/base.css       # 样式（Worker 风格）
    └── js/app.js          # 前端 SPA
```

## 技术栈

- **后端**: Python 3 + http.server + SQLite
- **前端**: 原生 JS（无框架）
- **存储**: SQLite (cron/用户) + JSON (实例)
- **VPN**: OpenVPN + 策略路由
- **对接**: XrayR SendIP 自动配置

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3001` | 面板端口 |

## License

MIT
