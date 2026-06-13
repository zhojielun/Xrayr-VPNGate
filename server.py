#!/usr/bin/env python3
"""VPN Gate Panel - Web Server (native implementation, SQLite + caching)"""
import base64
import csv
import http.server
import io
import json
import os
import re
import secrets
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlparse, parse_qs

DATA_DIR = Path("/root/vpngate-panel/data")
INSTANCES_FILE = DATA_DIR / "instances.json"
DB_PATH = DATA_DIR / "panel.db"
SERVERS_CACHE = DATA_DIR / "servers_cache.json"
STATUS_CACHE = {}  # {iid: status_dict}
STATUS_LOCK = threading.Lock()
LOG_DIR = "/var/log"
PORT = int(os.environ.get("PORT", 3001))
PUBLIC_DIR = Path(__file__).parent / "public"
API_URL = "https://www.vpngate.net/api/iphone/"

COUNTRY_MAP = {
    "Japan": "日本", "Korea Republic of": "韩国", "United States": "美国",
    "Singapore": "新加坡", "Taiwan": "台湾", "Hong Kong": "香港",
    "Germany": "德国", "France": "法国", "Canada": "加拿大",
    "Australia": "澳大利亚", "Netherlands": "荷兰", "United Kingdom": "英国",
    "India": "印度", "Russian Federation": "俄罗斯", "Russia": "俄罗斯",
    "Thailand": "泰国", "Vietnam": "越南", "Malaysia": "马来西亚",
    "Brazil": "巴西", "Turkey": "土耳其", "Indonesia": "印度尼西亚",
    "Italy": "意大利", "Spain": "西班牙", "Sweden": "瑞典",
    "Norway": "挪威", "Switzerland": "瑞士", "Poland": "波兰",
    "Romania": "罗马尼亚", "Ukraine": "乌克兰", "Ireland": "爱尔兰",
    "Finland": "芬兰", "Denmark": "丹麦", "Belgium": "比利时",
    "Austria": "奥地利", "Czech Republic": "捷克", "Portugal": "葡萄牙",
    "Greece": "希腊", "Hungary": "匈牙利", "Israel": "以色列",
    "New Zealand": "新西兰", "South Africa": "南非", "Mexico": "墨西哥",
    "Philippines": "菲律宾", "Cambodia": "柬埔寨", "Mongolia": "蒙古",
    "China": "中国", "Macau": "澳门", "Macao": "澳门",
    "Grenada": "格林纳达", "Viet Nam": "越南",
}


def ensure_dirs():
    DATA_DIR.mkdir(exist_ok=True, parents=True)
    _init_db()


# ─── SQLite for cron tasks ──────────────────────────────────────────────────

def _init_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("""CREATE TABLE IF NOT EXISTS cron_tasks (
        id TEXT PRIMARY KEY, instance INTEGER, schedule TEXT, proxy TEXT,
        enabled INTEGER DEFAULT 1, description TEXT, created_at TEXT
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY, password_hash TEXT, created_at TEXT
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY, username TEXT, created_at TEXT, expires_at TEXT
    )""")
    # Create default admin if no users exist
    row = conn.execute("SELECT COUNT(*) FROM users").fetchone()
    if row[0] == 0:
        import hashlib
        pw_hash = hashlib.sha256("admin".encode()).hexdigest()
        conn.execute("INSERT INTO users (username, password_hash, created_at) VALUES (?,?,?)",
                     ("admin", pw_hash, time.strftime("%Y-%m-%d %H:%M:%S")))
    conn.commit()
    conn.close()


def _cron_db():
    conn = sqlite3.connect(str(DB_PATH), timeout=5)
    conn.row_factory = sqlite3.Row
    return conn


def load_cron_tasks():
    try:
        conn = _cron_db()
        rows = conn.execute("SELECT * FROM cron_tasks ORDER BY rowid").fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception:
        return []


def save_cron_task(task):
    conn = _cron_db()
    conn.execute("INSERT OR REPLACE INTO cron_tasks (id,instance,schedule,proxy,enabled,description) VALUES (?,?,?,?,?,?)",
                 (task["id"], task["instance"], task["schedule"], task.get("proxy",""), 1 if task.get("enabled",True) else 0, task.get("description","")))
    conn.commit()
    conn.close()


def delete_cron_task(tid):
    conn = _cron_db()
    conn.execute("DELETE FROM cron_tasks WHERE id=?", (tid,))
    conn.commit()
    conn.close()


# ─── Auth ───────────────────────────────────────────────────────────────────

import hashlib

def _auth_db():
    conn = sqlite3.connect(str(DB_PATH), timeout=5)
    conn.row_factory = sqlite3.Row
    return conn

def auth_login(username, password):
    conn = _auth_db()
    pw_hash = hashlib.sha256(password.encode()).hexdigest()
    row = conn.execute("SELECT * FROM users WHERE username=? AND password_hash=?", (username, pw_hash)).fetchone()
    if not row:
        conn.close()
        return None
    token = secrets.token_hex(32)
    expires = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(time.time() + 30*86400))
    conn.execute("INSERT INTO sessions (token, username, created_at, expires_at) VALUES (?,?,?,?)",
                 (token, username, time.strftime("%Y-%m-%d %H:%M:%S"), expires))
    conn.commit()
    conn.close()
    return {"token": token, "username": username, "expires": expires}

def auth_check(token):
    if not token:
        return None
    conn = _auth_db()
    row = conn.execute("SELECT * FROM sessions WHERE token=?", (token,)).fetchone()
    conn.close()
    if not row:
        return None
    return {"username": row["username"]}

def auth_change_password(username, old_pw, new_pw):
    conn = _auth_db()
    old_hash = hashlib.sha256(old_pw.encode()).hexdigest()
    row = conn.execute("SELECT * FROM users WHERE username=? AND password_hash=?", (username, old_hash)).fetchone()
    if not row:
        conn.close()
        return False
    new_hash = hashlib.sha256(new_pw.encode()).hexdigest()
    conn.execute("UPDATE users SET password_hash=? WHERE username=?", (new_hash, username))
    conn.commit()
    conn.close()
    return True


# ─── Server cache ───────────────────────────────────────────────────────────

_servers_cache = {"data": [], "time": 0}
_servers_lock = threading.Lock()

def get_servers_cached(country="ALL"):
    """Return servers from cache if fresh (<10 min), else fetch"""
    with _servers_lock:
        if time.time() - _servers_cache["time"] < 600 and _servers_cache["data"]:
            data = _servers_cache["data"]
        else:
            data = fetch_vpngate_servers("ALL")
            _servers_cache["data"] = data
            _servers_cache["time"] = time.time()
    if country == "ALL":
        return data
    return [s for s in data if s.get("country_code","").upper() == country.upper()]


# ─── Instance status cache ──────────────────────────────────────────────────

def get_status_cached(inst, force=False):
    """Return cached status or compute fresh"""
    iid = inst["id"]
    with STATUS_LOCK:
        if not force and iid in STATUS_CACHE and time.time() - STATUS_CACHE[iid].get("_ts",0) < 5:
            return STATUS_CACHE[iid]
    status = _compute_status(inst)
    with STATUS_LOCK:
        STATUS_CACHE[iid] = {**status, "_ts": time.time()}
    return status


def _compute_status(inst):
    """Fast status check — skip heavy subprocess calls"""
    iid = inst["id"]
    work_dir = Path(f"/etc/vpngate/{iid}")
    pid_file = work_dir / "openvpn.pid"
    exit_ip_file = work_dir / "current_exit_ip.txt"
    country_file = work_dir / "last_country.txt"
    subnet_file = work_dir / "current_subnet.txt"

    openvpn_running = False
    pid = None
    if pid_file.exists():
        try:
            pid = int(pid_file.read_text().strip())
            os.kill(pid, 0)
            openvpn_running = True
        except (ValueError, ProcessLookupError, PermissionError):
            pass

    iface = inst.get("iface", f"tun{iid-1}")
    exit_ip = exit_ip_file.read_text().strip() if exit_ip_file.exists() else ""
    country = country_file.read_text().strip() if country_file.exists() else ""
    subnet = subnet_file.read_text().strip() if subnet_file.exists() else ""

    return {
        "id": iid, "name": inst.get("name", f"实例 {iid}"), "iface": iface,
        "openvpn_running": openvpn_running, "pid": pid, "tun_ip": "",
        "exit_ip": exit_ip, "country": country, "subnet": subnet,
        "route_table": inst.get("route_table", f"tunroute{iid}"),
        "xrayr_config": inst.get("xrayr_config", f"/etc/XrayR/{iid}.yml"),
        "route_mode": inst.get("route_mode", "auto"),
        "preferred_country": inst.get("preferred_country", ""),
        "preferred_ip": inst.get("preferred_ip", ""),
        "best_node": inst.get("best_node"),
        "scanning": inst.get("scanning", False),
    }


def refresh_all_status():
    """Background thread: refresh instance status every 3s"""
    while True:
        time.sleep(3)
        try:
            instances = load_instances()
            for inst in instances:
                get_status_cached(inst, force=True)
        except Exception:
            pass


def read_json(path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default if default is not None else {}


def write_json(path, data):
    path.parent.mkdir(exist_ok=True, parents=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def strip_ansi(text):
    return re.sub(r'\x1b\[[0-9;]*m', '', text)


def run_cmd(args, timeout=60, env=None):
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=env)
        return {"ok": r.returncode == 0, "stdout": r.stdout.strip(), "stderr": r.stderr.strip(), "code": r.returncode}
    except subprocess.TimeoutExpired:
        return {"ok": False, "stdout": "", "stderr": "执行超时", "code": -1}
    except Exception as e:
        return {"ok": False, "stdout": "", "stderr": str(e), "code": -1}


# ─── Instance Management ────────────────────────────────────────────────────

def load_instances():
    data = read_json(INSTANCES_FILE, [])
    if not isinstance(data, list):
        data = []
    return data


def save_instances(data):
    write_json(INSTANCES_FILE, data)


def get_instance_status(inst):
    """Read status from state files (no script call)"""
    iid = inst["id"]
    work_dir = Path(f"/etc/vpngate/{iid}")
    pid_file = work_dir / "openvpn.pid"
    exit_ip_file = work_dir / "current_exit_ip.txt"
    subnet_file = work_dir / "current_subnet.txt"
    country_file = work_dir / "last_country.txt"

    # Check openvpn process
    openvpn_running = False
    pid = None
    if pid_file.exists():
        try:
            pid = int(pid_file.read_text().strip())
            os.kill(pid, 0)
            openvpn_running = True
        except (ValueError, ProcessLookupError, PermissionError):
            pass

    # Check tun interface
    iface = inst.get("iface", f"tun{iid-1}")
    tun_ip = ""
    try:
        r = subprocess.run(["ip", "-4", "addr", "show", iface], capture_output=True, text=True, timeout=3)
        m = re.search(r'inet (\d+\.\d+\.\d+\.\d+)', r.stdout)
        if m:
            tun_ip = m.group(1)
    except Exception:
        pass

    exit_ip = ""
    if exit_ip_file.exists():
        try:
            exit_ip = exit_ip_file.read_text().strip()
        except Exception:
            pass

    country = ""
    if country_file.exists():
        try:
            country = country_file.read_text().strip()
        except Exception:
            pass

    subnet = ""
    if subnet_file.exists():
        try:
            subnet = subnet_file.read_text().strip()
        except Exception:
            pass

    return {
        "id": iid,
        "name": inst.get("name", f"实例 {iid}"),
        "iface": iface,
        "openvpn_running": openvpn_running,
        "pid": pid,
        "tun_ip": tun_ip,
        "exit_ip": exit_ip,
        "country": country,
        "subnet": subnet,
        "route_table": inst.get("route_table", f"tunroute{iid}"),
        "xrayr_config": inst.get("xrayr_config", f"/etc/XrayR/{iid}.yml"),
        "route_mode": inst.get("route_mode", "auto"),
        "preferred_country": inst.get("preferred_country", ""),
        "preferred_ip": inst.get("preferred_ip", ""),
        "best_node": inst.get("best_node", None),
        "scanning": inst.get("scanning", False),
    }


# ─── VPN Connection (native) ───────────────────────────────────────────────

def get_iface_ip(iface):
    try:
        r = subprocess.run(["ip", "-4", "addr", "show", iface], capture_output=True, text=True, timeout=3)
        m = re.search(r'inet (\d+\.\d+\.\d+\.\d+/\d+)', r.stdout)
        if m:
            return m.group(1).split("/")[0]
    except Exception:
        pass
    return ""


def ensure_route_table(table_id, table_name):
    try:
        content = Path("/etc/iproute2/rt_tables").read_text()
        if re.search(rf'^\s*{table_id}\s+{table_name}\s*$', content, re.M):
            return
    except FileNotFoundError:
        content = ""
    with open("/etc/iproute2/rt_tables", "a") as f:
        f.write(f"\n{table_id}    {table_name}\n")


def setup_policy_routing(iface, client_subnet, route_table, route_table_id):
    ensure_route_table(route_table_id, route_table)
    # Clean old rules
    subprocess.run(["ip", "rule", "del", "from", client_subnet, "table", route_table], capture_output=True)
    subprocess.run(["ip", "route", "flush", "table", route_table], capture_output=True)
    # Add new rules
    subprocess.run(["ip", "rule", "add", "from", client_subnet, "table", route_table], check=True, timeout=5)
    subprocess.run(["ip", "route", "add", "default", "dev", iface, "table", route_table], check=True, timeout=5)


def update_xrayr_sendip(config_path, new_ip):
    """Update SendIP in XrayR config"""
    if not os.path.exists(config_path):
        return False, "XrayR 配置文件不存在"
    try:
        content = Path(config_path).read_text()
        # Find SendIP lines
        lines = content.split("\n")
        target_line = None
        for i, line in enumerate(lines):
            if re.match(r'^\s*[Ss]end[Ii][Pp]:', line):
                target_line = i
                break
        if target_line is None:
            return False, "未找到 SendIP 配置项"

        # Backup
        backup = f"{config_path}.bak.{int(time.time())}"
        shutil.copy2(config_path, backup)

        # Update
        old_line = lines[target_line]
        old_ip = re.search(r'\d+\.\d+\.\d+\.\d+', old_line)
        old_ip_str = old_ip.group(0) if old_ip else "未知"
        lines[target_line] = re.sub(r'(Send[Ii][Pp]:\s*)\S+', rf'\g<1>{new_ip}', old_line)
        Path(config_path).write_text("\n".join(lines))

        return True, f"SendIP: {old_ip_str} → {new_ip}"
    except Exception as e:
        return False, str(e)


def restart_xrayr(service_name=None):
    """Restart XrayR service"""
    svc = service_name
    if not svc:
        for name in ["XrayR", "xrayr"]:
            r = subprocess.run(["systemctl", "list-units", "--all", "--type=service"], capture_output=True, text=True, timeout=5)
            if f"{name}.service" in r.stdout:
                svc = name
                break
    if not svc:
        return True, "未找到 XrayR 服务，跳过"
    r = subprocess.run(["systemctl", "restart", svc], capture_output=True, text=True, timeout=15)
    time.sleep(2)
    r2 = subprocess.run(["systemctl", "is-active", svc], capture_output=True, text=True, timeout=5)
    return r2.stdout.strip() == "active", f"XrayR ({svc}): {r2.stdout.strip()}"


def stop_openvpn(iface, work_dir):
    """Stop OpenVPN for a specific instance"""
    pid_file = Path(work_dir) / "openvpn.pid"
    if pid_file.exists():
        try:
            pid = int(pid_file.read_text().strip())
            os.kill(pid, signal.SIGTERM)
            time.sleep(1)
            try:
                os.kill(pid, 0)
                os.kill(pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
        except (ValueError, ProcessLookupError, PermissionError):
            pass
        pid_file.unlink(missing_ok=True)
    # Kill by interface name
    subprocess.run(["pkill", "-f", f"openvpn.*--dev {iface}"], capture_output=True)


def fetch_vpngate_servers(country="ALL"):
    """Fetch VPN Gate server list"""
    try:
        cmd = ["curl", "-sf", "--max-time", "30", API_URL]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=35)
        csv_text = r.stdout
        if not csv_text:
            return []
        lines = [l for l in csv_text.splitlines() if l and not l.startswith("*")]
        if lines and lines[0].startswith("#"):
            lines[0] = lines[0][1:]
        reader = csv.DictReader(io.StringIO("\n".join(lines)))
        servers = []
        for row in reader:
            cc = row.get("CountryShort", "").strip().upper()
            if country != "ALL" and cc != country:
                continue
            try:
                b64 = row.get("OpenVPN_ConfigData_Base64", "").strip()
                if not b64:
                    continue
                config = base64.b64decode(b64).decode("utf-8", errors="ignore")
                ip = row.get("IP", "")
                country_long = row.get("CountryLong", "")
                country_zh = COUNTRY_MAP.get(country_long, country_long)
                speed = int(row.get("Speed", 0) or 0)
                ping = int(row.get("Ping", 9999) or 9999)
                host = row.get("HostName", "")
                proto = "tcp" if "proto tcp" in config.lower() else "udp"
                servers.append({
                    "ip": ip, "country": country_zh, "country_code": cc,
                    "host": host, "speed": speed, "ping": ping,
                    "proto": proto, "config": config,
                })
            except Exception:
                continue
        servers.sort(key=lambda x: (0 if x["proto"] == "tcp" else 1, -x["speed"], x["ping"]))
        return servers[:200]
    except Exception:
        return []


# ─── Cron Tasks ─────────────────────────────────────────────────────────────

def generate_crontab(tasks):
    lines = []
    for t in tasks:
        if not t.get("enabled", True):
            continue
        env = f"VPN_INSTANCE={t['instance']}"
        if t.get("proxy"):
            env += f' PROXY_URL="{t["proxy"]}"'
        log = f">> {LOG_DIR}/vpngate{t['instance']}.log 2>&1"
        lines.append(f'{t["schedule"]} root {env} /bin/bash /root/vpngate.sh --refresh {log}')
    return "\n".join(lines) + "\n" if lines else ""


# ─── HTTP Handler ───────────────────────────────────────────────────────────

class PanelHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        try:
            parsed = urlparse(self.path)
            if parsed.path.startswith("/api/"):
                self.handle_api("GET", parsed, None)
            else:
                self.serve_static(parsed.path)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            pass

    def do_POST(self):
        try:
            parsed = urlparse(self.path)
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode() if length else ""
            self.handle_api("POST", parsed, body)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            pass

    def do_PUT(self):
        try:
            parsed = urlparse(self.path)
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode() if length else ""
            self.handle_api("PUT", parsed, body)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            pass

    def do_DELETE(self):
        try:
            parsed = urlparse(self.path)
            self.handle_api("DELETE", parsed, None)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            pass

    def do_OPTIONS(self):
        try:
            self.send_response(200)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def json_response(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False).encode())

    def handle_api(self, method, parsed, body):
        path = parsed.path
        try:
            # Auth routes (no auth required)
            if method == "POST" and path == "/api/auth/login":
                return self.json_response(200, self.api_auth_login(body))
            if method == "POST" and path == "/api/auth/logout":
                return self.json_response(200, self.api_auth_logout(body))
            if method == "GET" and path == "/api/auth/status":
                return self.json_response(200, self.api_auth_status())
            if method == "POST" and path == "/api/auth/change-password":
                return self.json_response(200, self.api_auth_change_password(body))

            # Check auth for all other API routes
            token = None
            for h in (self.headers.get("Cookie") or "").split(";"):
                h = h.strip()
                if h.startswith("session="):
                    token = h.split("=", 1)[1]
            if not token:
                token = parsed.query.split("token=")[1].split("&")[0] if "token=" in parsed.query else None
            user = auth_check(token)
            if not user:
                return self.json_response(401, {"error": "未登录"})

            if method == "GET" and path == "/api/instances":
                return self.json_response(200, self.api_instances_list())
            if method == "GET" and re.match(r"/api/instances/\d+/status$", path):
                return self.json_response(200, self.api_instance_status(path.split("/")[3]))
            if method == "POST" and re.match(r"/api/instances/\d+/start$", path):
                return self.json_response(200, self.api_instance_start(path.split("/")[3], body))
            if method == "POST" and re.match(r"/api/instances/\d+/stop$", path):
                return self.json_response(200, self.api_instance_stop(path.split("/")[3]))
            if method == "POST" and re.match(r"/api/instances/\d+/refresh$", path):
                return self.json_response(200, self.api_instance_refresh(path.split("/")[3], body))
            if method == "POST" and re.match(r"/api/instances/\d+/scan-nodes$", path):
                return self.json_response(200, self.api_scan_nodes(path.split("/")[3], body))
            if method == "POST" and re.match(r"/api/instances/\d+/pick-node$", path):
                return self.json_response(200, self.api_pick_best_node(path.split("/")[3], body))
            if method == "POST" and path == "/api/instances":
                return self.json_response(201, self.api_instance_create(body))
            if method == "PUT" and re.match(r"/api/instances/\d+$", path):
                return self.json_response(200, self.api_instance_update(path.split("/")[3], body))
            if method == "DELETE" and re.match(r"/api/instances/\d+$", path):
                return self.json_response(200, self.api_instance_delete(path.split("/")[3]))
            if method == "POST" and path == "/api/reset-dedup":
                return self.json_response(200, {"ok": True})
            if method == "GET" and path == "/api/servers":
                qs = parse_qs(parsed.query)
                return self.json_response(200, self.api_fetch_servers(qs.get("country", ["ALL"])[0]))
            if method == "GET" and path == "/api/test-node":
                qs = parse_qs(parsed.query)
                return self.json_response(200, self.api_test_node(qs.get("ip", [""])[0], int(qs.get("port", ["443"])[0])))
            if method == "GET" and path == "/api/cron-tasks":
                return self.json_response(200, load_cron_tasks())
            if method == "POST" and path == "/api/cron-tasks":
                return self.json_response(201, self.api_cron_create(body))
            if method == "PUT" and re.match(r"/api/cron-tasks/.+$", path):
                return self.json_response(200, self.api_cron_update(path.split("/")[-1], body))
            if method == "DELETE" and re.match(r"/api/cron-tasks/.+$", path):
                return self.json_response(200, self.api_cron_delete(path.split("/")[-1]))
            if method == "POST" and path == "/api/cron-tasks/apply":
                return self.json_response(200, self.api_cron_apply())
            if method == "GET" and path == "/api/cron-tasks/preview":
                return self.json_response(200, {"content": generate_crontab(load_cron_tasks())})
            if method == "GET" and re.match(r"/api/logs/\d+$", path):
                return self.json_response(200, self.api_get_log(path.split("/")[-1]))
            self.json_response(404, {"error": "Not found"})
        except Exception as e:
            self.json_response(500, {"error": str(e)})

    # ─── Instance APIs ───────────────────────────────────────────────────

    # ─── Auth APIs ────────────────────────────────────────────────────────

    def api_auth_login(self, body):
        data = json.loads(body) if body else {}
        username = data.get("username", "")
        password = data.get("password", "")
        if not username or not password:
            return {"ok": False, "error": "请输入用户名和密码"}
        result = auth_login(username, password)
        if not result:
            return {"ok": False, "error": "用户名或密码错误"}
        return {"ok": True, "token": result["token"], "username": result["username"]}

    def api_auth_logout(self, body):
        data = json.loads(body) if body else {}
        token = data.get("token", "")
        if token:
            conn = _auth_db()
            conn.execute("DELETE FROM sessions WHERE token=?", (token,))
            conn.commit()
            conn.close()
        return {"ok": True}

    def api_auth_status(self):
        token = None
        for h in (self.headers.get("Cookie") or "").split(";"):
            h = h.strip()
            if h.startswith("session="):
                token = h.split("=", 1)[1]
        user = auth_check(token)
        if user:
            return {"ok": True, "username": user["username"]}
        return {"ok": False}

    def api_auth_change_password(self, body):
        data = json.loads(body) if body else {}
        username = data.get("username", "")
        old_pw = data.get("old_password", "")
        new_pw = data.get("new_password", "")
        if not all([username, old_pw, new_pw]):
            return {"ok": False, "error": "请填写完整"}
        ok = auth_change_password(username, old_pw, new_pw)
        return {"ok": ok, "error": "" if ok else "原密码错误"}

    # ─── Instance APIs ───────────────────────────────────────────────────

    def api_instances_list(self):
        instances = load_instances()
        return [get_status_cached(inst) for inst in instances]

    def api_instance_status(self, iid):
        insts = load_instances()
        inst = next((i for i in insts if i["id"] == int(iid)), None)
        if not inst:
            return {"ok": False, "output": "实例不存在"}
        info = get_status_cached(inst, force=True)
        return {"ok": True, "output": json.dumps(info, ensure_ascii=False, indent=2)}

    def api_instance_start(self, iid, body):
        """Native VPN connection: fetch servers → pick → start openvpn → route → XrayR"""
        data = json.loads(body) if body else {}
        country = data.get("country", "ALL")
        insts = load_instances()
        inst = next((i for i in insts if i["id"] == int(iid)), None)
        if not inst:
            return {"ok": False, "output": "实例不存在"}

        iid_int = inst["id"]
        iface = inst.get("iface", f"tun{iid_int-1}")
        work_dir = Path(f"/etc/vpngate/{iid_int}")
        work_dir.mkdir(parents=True, exist_ok=True)
        ovpn_file = work_dir / "current.ovpn"
        pid_file = work_dir / "openvpn.pid"
        log_file = Path(f"{LOG_DIR}/vpngate{iid_int}.log")
        xrayr_config = inst.get("xrayr_config", f"/etc/XrayR/{iid_int}.yml")
        route_table = inst.get("route_table", f"tunroute{iid_int}")
        route_table_id = inst.get("route_table_id", 100 + iid_int - 1)
        country_file = work_dir / "last_country.txt"
        exit_ip_file = work_dir / "current_exit_ip.txt"
        subnet_file = work_dir / "current_subnet.txt"

        log_lines = []

        def log(msg):
            log_lines.append(f"[{time.strftime('%H:%M:%S')}] {msg}")

        # Save country
        country_file.write_text(country)

        # 1. Stop existing openvpn
        log("停止现有 OpenVPN 连接...")
        stop_openvpn(iface, str(work_dir))

        # 2. Check if best_node is pre-selected
        best_node = inst.get("best_node")
        if best_node and best_node.get("tcp_ok") and best_node.get("ip"):
            log(f"使用预选最佳节点: {best_node['ip']} ({best_node.get('country','')}) {best_node.get('latency_ms','?')}ms")
            servers = [best_node]  # try best node first
        else:
            servers = []

        # 3. Fetch servers if no best_node
        if not servers:
            log(f"正在拉取 VPN Gate 服务器列表（地区: {country}）...")
            servers = get_servers_cached(country)
            if not servers:
                log("未找到可用服务器")
                return {"ok": False, "output": "\n".join(log_lines)}
            log(f"找到 {len(servers)} 台候选服务器")

        # 3. Try each server
        connected = False
        exit_ip = ""
        max_retry = min(8, len(servers))
        for attempt, srv in enumerate(servers[:max_retry]):
            log(f"连接尝试 {attempt+1}/{max_retry}: {srv['host']} ({srv['ip']}) [{srv['proto']}]")

            # TCP reachability check
            if srv["proto"] == "tcp":
                try:
                    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    s.settimeout(5)
                    s.connect((srv["ip"], 443))
                    s.close()
                except Exception:
                    log(f"  TCP 不可达，跳过")
                    continue

            # Write ovpn config
            config = srv["config"]
            # Patch config
            config = re.sub(r'^dev\s+\S+', f'dev {iface}', config, flags=re.M)
            if "route-nopull" not in config:
                config += "\nroute-nopull\n"
            config = re.sub(r'^script-security\s+\S+', '', config, flags=re.M)
            config += "\nscript-security 2\n"
            for pf in ['pull-filter ignore "dhcp-option DNS"', 'pull-filter ignore "redirect-gateway"', 'pull-filter ignore "route-gateway"']:
                if pf not in config:
                    config += f"\n{pf}\n"
            if "data-ciphers" not in config and "cipher" not in config:
                config += "\ndata-ciphers AES-256-GCM:AES-128-GCM:AES-128-CBC\n"
            config += "\nverb 3\n"

            ovpn_file.write_text(config)

            # Start openvpn
            log(f"  启动 OpenVPN (dev={iface})...")
            try:
                proc = subprocess.Popen(
                    ["openvpn", "--config", str(ovpn_file), "--dev", iface, "--daemon",
                     "--writepid", str(pid_file), "--log-append", str(log_file), "--verb", "3"],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                )
            except FileNotFoundError:
                log("  错误: 未找到 openvpn 命令")
                return {"ok": False, "output": "\n".join(log_lines)}
            except Exception as e:
                log(f"  启动失败: {e}")
                continue

            # Wait for tun interface
            log(f"  等待 {iface} 出现...")
            waited = 0
            tun_ip = ""
            while waited < 30:
                time.sleep(2)
                waited += 2
                tun_ip = get_iface_ip(iface)
                if tun_ip:
                    break
            if not tun_ip:
                log(f"  {iface} 未在 30s 内出现，换下一台")
                stop_openvpn(iface, str(work_dir))
                continue

            log(f"  {iface} 已出现 (IP: {tun_ip})")

            # Verify exit IP
            log("  验证出口 IP...")
            try:
                r = subprocess.run(
                    ["curl", "-sf", "--max-time", "12", "--interface", iface, "https://api.ipify.org"],
                    capture_output=True, text=True, timeout=15
                )
                exit_ip = r.stdout.strip()
            except Exception:
                exit_ip = ""

            if not exit_ip:
                log("  验证失败，换下一台")
                stop_openvpn(iface, str(work_dir))
                continue

            log(f"  出口 IP: {exit_ip}")
            connected = True
            break

        if not connected:
            log(f"全部 {max_retry} 台均失败")
            return {"ok": False, "output": "\n".join(log_lines)}

        # 4. Post-connect: routing + XrayR
        client_subnet = f"{tun_ip}/32"
        subnet_file.write_text(client_subnet)
        exit_ip_file.write_text(exit_ip)

        log("配置策略路由...")
        try:
            setup_policy_routing(iface, client_subnet, route_table, route_table_id)
            log(f"  策略路由完成: from {client_subnet} → table {route_table} → dev {iface}")
        except Exception as e:
            log(f"  策略路由失败: {e}")

        log(f"更新 XrayR SendIP ({xrayr_config})...")
        ok, msg = update_xrayr_sendip(xrayr_config, tun_ip)
        log(f"  {msg}")

        log("重启 XrayR...")
        ok, msg = restart_xrayr()
        log(f"  {msg}")

        log(f"VPN 已连接! 出口 IP: {exit_ip}, 网卡: {iface}, 客户端网段: {client_subnet}")
        return {"ok": True, "output": "\n".join(log_lines)}

    def api_instance_stop(self, iid):
        insts = load_instances()
        inst = next((i for i in insts if i["id"] == int(iid)), None)
        if not inst:
            return {"ok": False, "output": "实例不存在"}

        iid_int = inst["id"]
        iface = inst.get("iface", f"tun{iid_int-1}")
        work_dir = f"/etc/vpngate/{iid_int}"
        route_table = inst.get("route_table", f"tunroute{iid_int}")
        subnet_file = Path(work_dir) / "current_subnet.txt"

        lines = []
        # Read subnet before cleanup
        client_subnet = ""
        if subnet_file.exists():
            client_subnet = subnet_file.read_text().strip()

        # Stop openvpn
        stop_openvpn(iface, work_dir)
        lines.append(f"已停止 OpenVPN (iface: {iface})")

        # Cleanup routes
        if client_subnet:
            subprocess.run(["ip", "rule", "del", "from", client_subnet, "table", route_table], capture_output=True)
            subprocess.run(["ip", "route", "flush", "table", route_table], capture_output=True)
            lines.append(f"策略路由已清理 (table: {route_table}, subnet: {client_subnet})")
            subnet_file.unlink(missing_ok=True)

        return {"ok": True, "output": "\n".join(lines)}

    def api_instance_refresh(self, iid, body):
        insts = load_instances()
        inst = next((i for i in insts if i["id"] == int(iid)), None)
        if not inst:
            return {"ok": False, "output": "实例不存在"}

        iid_int = inst["id"]
        iface = inst.get("iface", f"tun{iid_int-1}")
        work_dir = Path(f"/etc/vpngate/{iid_int}")
        exit_ip_file = work_dir / "current_exit_ip.txt"
        country_file = work_dir / "last_country.txt"

        # Check if VPN is alive
        tun_ip = get_iface_ip(iface)
        if not tun_ip:
            return {"ok": False, "output": f"{iface} 不存在，VPN 已断线"}

        # Try to reach ipify through the interface
        try:
            r = subprocess.run(
                ["curl", "-sf", "--max-time", "12", "--interface", iface, "https://api.ipify.org"],
                capture_output=True, text=True, timeout=15
            )
            if r.stdout.strip():
                return {"ok": True, "output": f"VPN 正常，出口 IP: {r.stdout.strip()}"}
        except Exception:
            pass

        return {"ok": False, "output": "VPN 失效，开始重连..."}

    def api_scan_nodes(self, iid, body):
        """Scan all VPN Gate nodes for an instance, test TCP reachability with multi-threading"""
        data = json.loads(body) if body else {}
        insts = load_instances()
        inst = next((i for i in insts if i["id"] == int(iid)), None)
        if not inst:
            return {"ok": False, "output": "实例不存在"}

        iid_int = inst["id"]
        country = data.get("country", inst.get("preferred_country", "ALL"))

        # Mark scanning
        inst["scanning"] = True
        save_instances(insts)

        try:
            servers = get_servers_cached(country)
            if not servers:
                inst["scanning"] = False
                save_instances(insts)
                return {"ok": False, "output": "未找到可用服务器"}

            # Multi-threaded TCP ping test
            import concurrent.futures
            def test_tcp(srv):
                try:
                    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    s.settimeout(3)
                    start = time.time()
                    s.connect((srv["ip"], 443))
                    latency = int((time.time() - start) * 1000)
                    s.close()
                    return {**srv, "tcp_ok": True, "latency_ms": latency}
                except Exception:
                    return {**srv, "tcp_ok": False, "latency_ms": 9999}

            results = []
            with concurrent.futures.ThreadPoolExecutor(max_workers=30) as ex:
                futures = {ex.submit(test_tcp, s): s for s in servers[:200]}
                for f in concurrent.futures.as_completed(futures):
                    results.append(f.result())

            # Sort: TCP ok first, then by latency
            results.sort(key=lambda x: (0 if x["tcp_ok"] else 1, x["latency_ms"]))

            # Store scan results in instance
            inst["scan_results"] = results
            inst["scanning"] = False
            inst["last_scan_time"] = time.strftime("%Y-%m-%d %H:%M:%S")
            save_instances(insts)

            ok_count = sum(1 for r in results if r["tcp_ok"])
            return {"ok": True, "output": f"扫描完成: {len(results)} 个节点, {ok_count} 个可达", "results": results}
        except Exception as e:
            inst["scanning"] = False
            save_instances(insts)
            return {"ok": False, "output": f"扫描失败: {e}"}

    def api_pick_best_node(self, iid, body):
        """Pick the best node based on route_mode and save to instance config"""
        data = json.loads(body) if body else {}
        insts = load_instances()
        inst = next((i for i in insts if i["id"] == int(iid)), None)
        if not inst:
            return {"ok": False, "output": "实例不存在"}

        route_mode = data.get("route_mode", inst.get("route_mode", "auto"))
        preferred_country = data.get("preferred_country", inst.get("preferred_country", ""))
        preferred_ip = data.get("preferred_ip", inst.get("preferred_ip", ""))

        inst["route_mode"] = route_mode
        inst["preferred_country"] = preferred_country
        inst["preferred_ip"] = preferred_ip

        scan_results = inst.get("scan_results", [])
        if not scan_results:
            save_instances(insts)
            return {"ok": False, "output": "请先扫描节点"}

        # Filter based on route_mode
        candidates = [r for r in scan_results if r.get("tcp_ok")]

        if route_mode == "fixed_ip" and preferred_ip:
            # Fixed IP mode: find specific node
            matched = [r for r in candidates if r["ip"] == preferred_ip]
            if matched:
                inst["best_node"] = matched[0]
                save_instances(insts)
                return {"ok": True, "output": f"已锁定节点: {preferred_ip}", "node": matched[0]}
            else:
                inst["best_node"] = None
                save_instances(insts)
                return {"ok": False, "output": f"未找到 IP {preferred_ip} 的可达节点"}

        elif route_mode == "fixed_country" and preferred_country:
            # Fixed country mode: best node from specific country
            country_nodes = [r for r in candidates if r.get("country_code", "").upper() == preferred_country.upper()]
            if country_nodes:
                best = country_nodes[0]  # already sorted by latency
                inst["best_node"] = best
                save_instances(insts)
                return {"ok": True, "output": f"最佳节点 ({preferred_country}): {best['ip']} {best['latency_ms']}ms", "node": best}
            else:
                inst["best_node"] = None
                save_instances(insts)
                return {"ok": False, "output": f"{preferred_country} 无可达节点"}

        else:
            # Auto mode: pick overall best
            if candidates:
                best = candidates[0]
                inst["best_node"] = best
                save_instances(insts)
                return {"ok": True, "output": f"最佳节点: {best['ip']} ({best['country']}) {best['latency_ms']}ms", "node": best}
            else:
                inst["best_node"] = None
                save_instances(insts)
                return {"ok": False, "output": "无可达节点"}

    def api_instance_create(self, body):
        data = json.loads(body)
        instances = load_instances()
        max_id = max((i["id"] for i in instances), default=0)
        new_id = max_id + 1
        tun_idx = new_id - 1
        inst = {
            "id": new_id,
            "name": data.get("name", f"VPN 实例 {new_id}"),
            "iface": f"tun{tun_idx}",
            "route_table": f"tunroute{new_id}",
            "route_table_id": 100 + tun_idx,
            "xrayr_config": data.get("xrayr_config", f"/etc/XrayR/{new_id}.yml"),
        }
        instances.append(inst)
        save_instances(instances)
        return inst

    def api_instance_update(self, iid, body):
        data = json.loads(body)
        instances = load_instances()
        for inst in instances:
            if inst["id"] == int(iid):
                inst.update({k: v for k, v in data.items() if k != "id"})
                save_instances(instances)
                return inst
        return {"error": "Not found"}

    def api_instance_delete(self, iid):
        instances = load_instances()
        instances = [i for i in instances if i["id"] != int(iid)]
        save_instances(instances)
        return {"ok": True}

    def api_fetch_servers(self, country):
        servers = get_servers_cached(country)
        for s in servers:
            s.pop("config", None)
        return servers

    def api_test_node(self, ip, port):
        if not ip:
            return {"ok": False, "message": "IP 为空"}
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(5)
            s.connect((ip, port))
            s.close()
            return {"ok": True, "message": f"TCP {ip}:{port} 可达"}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    def api_cron_create(self, body):
        data = json.loads(body)
        new_id = f"{int(time.time()*1000):x}{secrets.token_hex(3)}"
        task = {"id": new_id, "instance": data.get("instance", 1), "schedule": data.get("schedule", "*/10 * * * *"),
                "proxy": data.get("proxy", ""), "enabled": data.get("enabled", True), "description": data.get("description", "")}
        save_cron_task(task)
        return task

    def api_cron_update(self, tid, body):
        data = json.loads(body)
        tasks = load_cron_tasks()
        for t in tasks:
            if t["id"] == tid:
                t.update({k: v for k, v in data.items() if k != "id"})
                save_cron_task(t)
                return t
        return {"error": "Not found"}

    def api_cron_delete(self, tid):
        delete_cron_task(tid)
        return {"ok": True}

    def api_cron_apply(self):
        tasks = load_cron_tasks()
        content = generate_crontab(tasks)
        cron_path = "/tmp/vpngate-crontab"
        with open(cron_path, "w") as f:
            f.write("# VPN Gate auto-refresh tasks\n" + content)
        try:
            r = subprocess.run(["crontab", cron_path], capture_output=True, text=True, timeout=10)
            ok = r.returncode == 0
        except Exception:
            ok = False
        return {"ok": ok, "cron_content": content}

    def api_get_log(self, iid):
        log_file = f"{LOG_DIR}/vpngate{iid}.log"
        try:
            with open(log_file) as f:
                lines = f.readlines()
            return {"content": strip_ansi("".join(lines[-200:]))}
        except FileNotFoundError:
            return {"content": ""}

    def serve_static(self, path):
        if path == "/":
            path = "/index.html"
        file_path = PUBLIC_DIR / path.lstrip("/")
        if not file_path.exists() or not file_path.is_file():
            file_path = PUBLIC_DIR / "index.html"
        mime = {".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
                ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
                ".png": "image/png", ".svg": "image/svg+xml"}
        try:
            data = file_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mime.get(file_path.suffix, "application/octet-stream"))
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            try:
                self.send_response(404)
                self.end_headers()
            except Exception:
                pass


def main():
    ensure_dirs()
    # Preload servers in background
    def _preload():
        try:
            get_servers_cached("ALL")
        except Exception:
            pass
    threading.Thread(target=_preload, daemon=True).start()
    # Start background status refresher
    t = threading.Thread(target=refresh_all_status, daemon=True)
    t.start()
    server = http.server.HTTPServer(("0.0.0.0", PORT), PanelHandler)
    print(f"VPN Gate Panel running at http://127.0.0.1:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
