const express = require('express');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { v4: uuidv4 } = require('uuid');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASS = "admin123"; // MẬT KHẨU ADMIN

// ==================================================================
// 1. CODE GIAO DIỆN ADMIN (NHÚNG TRỰC TIẾP)
// ==================================================================
const ADMIN_HTML = `
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SMM Provider Admin</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background-color: #0f172a; color: #e2e8f0; font-family: monospace; }
        .card { background-color: #1e293b; border: 1px solid #334155; }
        .form-control { background-color: #0f172a; border: 1px solid #334155; color: #fff; }
        .btn-primary { background-color: #3b82f6; }
        .log-box { height: 400px; overflow-y: scroll; background: #000; padding: 10px; border: 1px solid #333; font-size: 12px; }
        .status-badge { padding: 2px 6px; border-radius: 4px; font-size: 11px; }
        .st-Pending { background: #f59e0b; color: #000; }
        .st-Processing { background: #3b82f6; color: #fff; }
        .st-Completed { background: #10b981; color: #fff; }
        .st-Canceled { background: #ef4444; color: #fff; }
    </style>
</head>
<body class="p-3">
    <div class="container">
        <h3 class="text-center text-primary mb-4">DEV.TIEP SMM PROVIDER</h3>
        
        <div id="authBox" class="card p-4 mb-4">
            <div class="input-group">
                <input type="password" id="pass" class="form-control" placeholder="Nhập Admin Password...">
                <button class="btn btn-primary" onclick="checkAuth()">Login</button>
            </div>
        </div>

        <div id="dashboard" style="display:none;">
            <div class="card p-3 mb-3">
                <h5>⚙️ Cấu hình Hệ thống</h5>
                <div class="row g-2">
                    <div class="col-md-6">
                        <label>Proxy Key (ProxyXoay)</label>
                        <div class="input-group">
                            <input type="text" id="proxyKey" class="form-control">
                            <button class="btn btn-sm btn-outline-success" onclick="saveConfig('proxy', 'proxyKey')">Lưu</button>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <label>Cookie TikFames</label>
                        <div class="input-group">
                            <input type="text" id="ck-tikfames" class="form-control">
                            <button class="btn btn-sm btn-outline-warning" onclick="saveConfig('cookie', 'ck-tikfames', 'tikfames')">Lưu</button>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <label>Cookie TikFollowers</label>
                        <div class="input-group">
                            <input type="text" id="ck-tikfollowers" class="form-control">
                            <button class="btn btn-sm btn-outline-warning" onclick="saveConfig('cookie', 'ck-tikfollowers', 'tikfollowers')">Lưu</button>
                        </div>
                    </div>
                    <div class="col-md-6 d-flex align-items-end">
                        <button class="btn btn-danger w-100" onclick="clearLogs()">🗑️ Xóa Lịch sử Đơn</button>
                    </div>
                </div>
            </div>

            <div class="card p-3">
                <div class="d-flex justify-content-between mb-2">
                    <h5>📦 Đơn hàng gần đây (Live)</h5>
                    <button class="btn btn-sm btn-success" onclick="loadLogs()">Refresh</button>
                </div>
                <div class="log-box" id="logContainer">Loading...</div>
            </div>
        </div>
    </div>

    <script>
        let PASS = '';
        const API = '/api/admin';

        function checkAuth() {
            PASS = document.getElementById('pass').value;
            loadConfig();
        }

        async function loadConfig() {
            try {
                const res = await fetch(API + '/config?pass=' + PASS);
                const data = await res.json();
                if(!data.config) return alert('Sai mật khẩu');
                
                document.getElementById('authBox').style.display = 'none';
                document.getElementById('dashboard').style.display = 'block';
                
                document.getElementById('proxyKey').value = data.config.proxyKey;
                document.getElementById('ck-tikfames').value = data.config.cookies.tikfames;
                document.getElementById('ck-tikfollowers').value = data.config.cookies.tikfollowers;
                
                loadLogs();
                setInterval(loadLogs, 5000);
            } catch(e) { alert('Lỗi kết nối'); }
        }

        async function saveConfig(type, inputId, site) {
            const val = document.getElementById(inputId).value;
            await fetch(API + '/update?pass=' + PASS, {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ type, value: val, site })
            });
            alert('Đã lưu!');
        }

        async function clearLogs() {
            if(!confirm('Xóa hết đơn?')) return;
            await fetch(API + '/update?pass=' + PASS, {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ type: 'clear_logs' })
            });
            loadLogs();
        }

        async function loadLogs() {
            const res = await fetch('/api/logs?pass=' + PASS);
            const logs = await res.json();
            let html = '<table class="table table-dark table-sm table-bordered"><thead><tr><th>ID</th><th>Service</th><th>User/Link</th><th>Status</th><th>Msg</th></tr></thead><tbody>';
            
            logs.forEach(l => {
                html += \`<tr>
                    <td>\${l.order || l.order_id}</td>
                    <td>\${l.service || l.type}</td>
                    <td style="max-width:150px; overflow:hidden">\${l.link || l.username}</td>
                    <td><span class="status-badge st-\${l.status}">\${l.status}</span></td>
                    <td>\${l.msg || ''}</td>
                </tr>\`;
            });
            html += '</tbody></table>';
            document.getElementById('logContainer').innerHTML = html;
        }
    </script>
</body>
</html>
`;

// ==================================================================
// 2. SERVER CONFIG & DATABASE
// ==================================================================
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let GLOBAL_CONFIG = {
    proxyKey: "ulhHONDSmaqepPClsbtMkp",
    cookies: { tikfames: "", tikfollowers: "" }
};

// Database Đơn hàng
const DB_FILE = 'orders.json';
let ORDERS_DB = [];
try { if (fs.existsSync(DB_FILE)) ORDERS_DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { ORDERS_DB = []; }

function createOrderInDb(serviceId, link) {
    const orderId = Math.floor(Date.now() + Math.random() * 1000);
    const newOrder = { order: orderId, service: serviceId, link: link, status: 'Pending', msg: 'Waiting...', updated_at: new Date().toISOString() };
    ORDERS_DB.unshift(newOrder);
    if (ORDERS_DB.length > 500) ORDERS_DB.pop();
    saveDb();
    return orderId;
}

function updateOrderStatus(orderId, status, msg = '') {
    const index = ORDERS_DB.findIndex(o => o.order == orderId);
    if (index !== -1) {
        ORDERS_DB[index].status = status;
        ORDERS_DB[index].msg = msg;
        saveDb();
    }
}
function saveDb() { try { fs.writeFileSync(DB_FILE, JSON.stringify(ORDERS_DB, null, 2)); } catch (e) {} }

// ==================================================================
// 3. PROXY & BUFF LOGIC
// ==================================================================
let PROXY_CACHE = { ip: null, lastUpdate: 0 };
async function getNewProxy(forceNew = false) {
    try {
        if (!GLOBAL_CONFIG.proxyKey) return { success: false, msg: 'No Proxy Key' };
        const now = Date.now();
        if (!forceNew && PROXY_CACHE.ip && (now - PROXY_CACHE.lastUpdate < 60000)) return { success: true, proxy: PROXY_CACHE.ip };
        const res = await axios.get(`https://proxyxoay.shop/api/get.php?key=${GLOBAL_CONFIG.proxyKey}`, { timeout: 10000 });
        if (res.data.status === 100 && res.data.proxyhttp) {
             let proxy = res.data.proxyhttp.replace(/http:\/\/|https:\/\/|::/g, '');
             PROXY_CACHE.ip = proxy; PROXY_CACHE.lastUpdate = Date.now();
             return { success: true, proxy: proxy };
        }
        if (res.data.status === 101) {
            const match = res.data.message.match(/(\d+)s/);
            return { success: false, wait: match ? parseInt(match[1]) : 10, msg: res.data.message };
        }
        return { success: false, wait: 5, msg: 'Proxy Error' };
    } catch (e) { return { success: false, wait: 5, msg: e.message }; }
}

// ZEFAME FOLLOW
async function processZefameFollow(link) {
    let proxyData = null, attempt = 1;
    while (attempt <= 5) {
        const res = await getNewProxy(true);
        if (res.success) { proxyData = res; break; }
        if (res.wait) await sleep((res.wait + 1) * 1000); else return { success: false, msg: res.msg };
        attempt++;
    }
    if (!proxyData) return { success: false, msg: 'Proxy Timeout' };
    const agent = new HttpsProxyAgent(`http://${proxyData.proxy}`);
    const deviceId = uuidv4();
    const fakeUser = "user_" + Math.random().toString(36).substring(7);
    try {
        await axios.get('https://free.zefame.com/api_free.php', { params: { action: 'check', device: deviceId, service: '228', username: fakeUser }, headers: { 'authority': 'free.zefame.com', 'user-agent': 'Mozilla/5.0' }, httpsAgent: agent, timeout: 10000 }).catch(()=>{});
        const res = await axios.post('https://free.zefame.com/api_free.php?action=order', new URLSearchParams({ service: '228', link: link, uuid: deviceId, username: fakeUser }), { headers: { 'authority': 'free.zefame.com', 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' }, httpsAgent: agent, timeout: 20000 });
        const text = JSON.stringify(res.data).toLowerCase();
        if (text.includes('success') && text.includes('true')) return { success: true, msg: 'Success' };
        if (text.includes('wait')) return { success: false, msg: 'Rate Limit' };
        return { success: false, msg: 'API Error' };
    } catch (e) { return { success: false, msg: e.message }; }
}

// ZEFAME VIEW/HEART
async function processZefameNoProxy(link, type) {
    const serviceId = type === 'view' ? '229' : '232';
    try {
        const resCheck = await axios.post('https://free.zefame.com/api_free.php', new URLSearchParams({ action: 'checkVideoId', link }), { headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' } });
        let videoId = resCheck.data?.data || resCheck.data?.id || resCheck.data;
        if (!videoId || typeof videoId === 'object') return { success: false, msg: 'Video ID Not Found' };
        const deviceId = uuidv4();
        const resOrder = await axios.post('https://free.zefame.com/api_free.php?action=order', new URLSearchParams({ service: serviceId, link, uuid: deviceId, videoId }), { headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' } });
        const text = JSON.stringify(resOrder.data).toLowerCase();
        if (text.includes('success') && text.includes('true')) return { success: true, msg: 'Success' };
        if (text.includes('wait')) return { success: false, msg: 'Rate Limit' };
        return { success: false, msg: 'API Fail' };
    } catch (e) { return { success: false, msg: e.message }; }
}

// VIP SITES
async function processVip(siteKey, username) {
    const cfg = siteKey === 'tikfames' ? { url: "https://tikfames.com", name: 'tikfames' } : { url: "https://tikfollowers.com", name: 'tikfollowers' };
    const cookie = GLOBAL_CONFIG.cookies[siteKey];
    if (!cookie) return { success: false, msg: 'No Cookie' };
    try {
        const headers = { 'Content-Type': 'application/json', 'Cookie': cookie, 'Origin': cfg.url };
        const sRes = await axios.post(`${cfg.url}/api/search`, { input: username, type: "getUserDetails", recaptchaToken: siteKey === 'tikfames' ? "fake_"+Date.now() : undefined }, { headers, timeout: 10000 });
        if (!sRes.data.success) return { success: false, msg: 'User Error' };
        await sleep(1000);
        const pRes = await axios.post(`${cfg.url}/api/process`, { ...sRes.data, type: siteKey === 'tikfollowers' ? "followers" : "follow" }, { headers, timeout: 15000 });
        if (pRes.data.success) return { success: true, msg: 'Success' };
        if ((pRes.data.message||"").includes('wait')) return { success: false, msg: 'Rate Limit' };
        return { success: false, msg: 'Process Fail' };
    } catch (e) { return { success: false, msg: e.message }; }
}

async function runWorker(orderId, serviceId, link, username) {
    updateOrderStatus(orderId, 'Processing', 'Starting...');
    let result = { success: false, msg: 'Err' };
    
    if (serviceId == '1') result = await processZefameFollow(link);
    else if (serviceId == '2') result = await processZefameNoProxy(link, 'view');
    else if (serviceId == '3') result = await processZefameNoProxy(link, 'heart');
    else if (serviceId == '4') {
        const r1 = await processVip('tikfames', username);
        const r2 = await processVip('tikfollowers', username);
        result = (r1.success || r2.success) ? { success: true, msg: 'Done VIP' } : { success: false, msg: 'VIP Fail' };
    }
    updateOrderStatus(orderId, result.success ? 'Completed' : 'Canceled', result.msg);
}

function getInfo(raw) {
    if (!raw) return null;
    try {
        if (raw.includes("tiktok.com")) {
            const u = new URL(raw).pathname.split('/').find(p => p.startsWith('@'))?.replace('@','');
            if (u) return { username: u, link: `https://www.tiktok.com/@${u}` };
        } else {
            const u = raw.replace('@','').trim();
            return { username: u, link: `https://www.tiktok.com/@${u}` };
        }
    } catch (e) { return null; }
    return null;
}

// ==================================================================
// 4. ROUTES
// ==================================================================

// 4.1 ROUTE QUAN TRỌNG: TRẢ HTML ADMIN
app.get('/admin.html', (req, res) => {
    res.send(ADMIN_HTML);
});
app.get('/', (req, res) => res.send('SERVER ONLINE'));

// 4.2 API CREATE ORDER
app.post('/api/order', (req, res) => {
    const serviceId = String(req.body.service || req.body.type);
    const rawLink = req.body.link || req.body.url;
    
    const info = getInfo(rawLink);
    if (!info) return res.json({ error: 'Link Error' });
    if (!['1','2','3','4'].includes(serviceId)) return res.json({ error: 'Service ID Error (1-4)' });

    const orderId = createOrderInDb(serviceId, info.link);
    res.json({ status: 'success', order: orderId });
    
    runWorker(orderId, serviceId, info.link, info.username);
});

// 4.3 API STATUS
app.post('/api/status', (req, res) => {
    const order = ORDERS_DB.find(o => o.order == (req.body.order || req.body.id));
    if (!order) return res.json({ error: 'Not Found' });
    res.json({ status: order.status, charge: "0", start_count: "0", remains: "0", currency: "VND", msg: order.msg });
});

// 4.4 ADMIN APIs
const checkAdmin = (req, res, next) => {
    if ((req.headers['x-admin-pass'] || req.query.pass) === ADMIN_PASS) next();
    else res.status(403).json({ success: false });
};
app.get('/api/admin/config', checkAdmin, (req, res) => res.json({ config: GLOBAL_CONFIG }));
app.post('/api/admin/update', checkAdmin, (req, res) => {
    const { type, value, site } = req.body;
    if (type === 'proxy') GLOBAL_CONFIG.proxyKey = value;
    if (type === 'cookie') GLOBAL_CONFIG.cookies[site] = value;
    if (type === 'clear_logs') ORDERS_DB = [];
    saveDb();
    res.json({ success: true });
});
app.get('/api/logs', checkAdmin, (req, res) => res.json(ORDERS_DB));

app.listen(PORT, () => console.log(`🚀 RUNNING ON PORT ${PORT}`));
