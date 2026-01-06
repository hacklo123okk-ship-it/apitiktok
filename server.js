const express = require('express');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { v4: uuidv4 } = require('uuid');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASS = "admin123"; 

// ==================================================================
// 1. GIAO DIỆN ADMIN (CÓ TEST TOOL)
// ==================================================================
const ADMIN_HTML = `
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SMM Panel - Dev.Tiep</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background-color: #0f172a; color: #e2e8f0; font-family: monospace; }
        .card { background-color: #1e293b; border: 1px solid #334155; }
        .form-control, .form-select { background-color: #0f172a; border: 1px solid #334155; color: #fff; }
        .btn-primary { background-color: #3b82f6; }
        .table-dark { --bs-table-bg: #1e293b; color: #e2e8f0; }
        .status-badge { padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
        .st-Pending { background: #f59e0b; color: #000; }
        .st-Processing { background: #3b82f6; color: #fff; }
        .st-Completed { background: #10b981; color: #fff; }
        .st-Canceled { background: #ef4444; color: #fff; }
    </style>
</head>
<body class="p-3">
    <div class="container">
        <h3 class="text-center text-primary mb-4">DEV.TIEP SMM PANEL</h3>
        
        <div id="authBox" class="card p-4 mb-4 mx-auto" style="max-width: 400px;">
            <div class="input-group">
                <input type="password" id="pass" class="form-control" value="admin123">
                <button class="btn btn-primary" onclick="checkAuth()">Login</button>
            </div>
        </div>

        <div id="dashboard" style="display:none;">
            <div class="card p-3 mb-3">
                <h5>🛠️ Test Tạo Đơn (Hỗ trợ link vt.tiktok.com)</h5>
                <div class="row g-2">
                    <div class="col-md-3">
                        <select id="testService" class="form-select">
                            <option value="1">1 - Follow Zefame</option>
                            <option value="2">2 - View Zefame</option>
                            <option value="3">3 - Tim Zefame</option>
                            <option value="4">4 - Follow VIP</option>
                        </select>
                    </div>
                    <div class="col-md-7">
                        <input type="text" id="testLink" class="form-control" placeholder="https://vt.tiktok.com/...">
                    </div>
                    <div class="col-md-2">
                        <button class="btn btn-success w-100" onclick="testOrder()">🚀 Gửi</button>
                    </div>
                </div>
            </div>

            <div class="card p-3">
                <div class="d-flex justify-content-between mb-2">
                    <h5>📦 Đơn hàng gần đây</h5>
                    <button class="btn btn-sm btn-info" onclick="loadLogs()">🔄 Refresh</button>
                </div>
                <div style="max-height: 500px; overflow: auto;">
                    <table class="table table-dark table-sm table-bordered">
                        <thead><tr><th>ID</th><th>Service</th><th>Link Gốc (Sau giải mã)</th><th>Status</th><th>Msg</th></tr></thead>
                        <tbody id="logContainer"></tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>

    <script>
        let PASS = '';
        function checkAuth() {
            PASS = document.getElementById('pass').value;
            loadLogs();
            document.getElementById('authBox').style.display = 'none';
            document.getElementById('dashboard').style.display = 'block';
        }
        async function testOrder() {
            const service = document.getElementById('testService').value;
            const link = document.getElementById('testLink').value;
            const res = await fetch('/api/order', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ service, link })
            });
            const d = await res.json();
            if(d.status === 'success') { alert('✅ Lên đơn: #' + d.order); loadLogs(); }
            else alert('❌ Lỗi: ' + d.error);
        }
        async function loadLogs() {
            const res = await fetch('/api/logs?pass=' + PASS);
            const logs = await res.json();
            let html = '';
            logs.forEach(l => {
                html += \`<tr><td>#\${l.order}</td><td>\${l.service}</td><td style="font-size:11px">\${l.link}</td><td><span class="status-badge st-\${l.status}">\${l.status}</span></td><td>\${l.msg}</td></tr>\`;
            });
            document.getElementById('logContainer').innerHTML = html || '<tr><td colspan="5">Trống</td></tr>';
        }
    </script>
</body>
</html>
`;

// ==================================================================
// 2. SERVER CORE
// ==================================================================
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let GLOBAL_CONFIG = {
    proxyKey: "ulhHONDSmaqepPClsbtMkp",
    cookies: { tikfames: "", tikfollowers: "" }
};

const DB_FILE = 'orders.json';
let ORDERS_DB = [];
try { if (fs.existsSync(DB_FILE)) ORDERS_DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { ORDERS_DB = []; }

function createOrderInDb(serviceId, link) {
    const orderId = Math.floor(Date.now() + Math.random() * 1000);
    const newOrder = { order: orderId, service: serviceId, link: link, status: 'Pending', msg: 'Đang giải mã link...', created_at: new Date().toISOString() };
    ORDERS_DB.unshift(newOrder);
    if(ORDERS_DB.length > 200) ORDERS_DB.pop();
    saveDb();
    return orderId;
}
function updateOrderStatus(orderId, status, msg = '') {
    const idx = ORDERS_DB.findIndex(o => o.order == orderId);
    if (idx !== -1) { ORDERS_DB[idx].status = status; ORDERS_DB[idx].msg = msg; saveDb(); }
}
function saveDb() { try { fs.writeFileSync(DB_FILE, JSON.stringify(ORDERS_DB, null, 2)); } catch (e) {} }

// ==================================================================
// 3. LOGIC XỬ LÝ LINK & PROXY
// ==================================================================

// HÀM QUAN TRỌNG: GIẢI MÃ LINK RÚT GỌN (vt.tiktok.com)
async function getInfo(raw) {
    if (!raw) return null;
    let finalLink = raw;

    try {
        // Nếu là link rút gọn -> Gọi request lấy link thật
        if (raw.includes("vt.tiktok.com") || raw.includes("vm.tiktok.com")) {
            console.log(`🔄 Đang giải mã: ${raw}`);
            try {
                const res = await axios.get(raw, {
                    maxRedirects: 10, // Cho phép tự nhảy link
                    timeout: 8000,
                    headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' }
                });
                // axios tự động follow redirect, lấy link cuối cùng
                finalLink = res.request.res.responseUrl || raw; 
                console.log(`✅ Link gốc tìm thấy: ${finalLink}`);
            } catch (e) {
                console.log('⚠️ Lỗi giải mã link:', e.message);
                // Nếu lỗi thì cứ trả về link gốc để Zefame thử vận may
            }
        }

        // Parse Username/Link chuẩn từ Link gốc
        if (finalLink.includes("tiktok.com")) {
            const urlObj = new URL(finalLink);
            const user = urlObj.pathname.split('/').find(p => p.startsWith('@'))?.replace('@','');
            if (user) return { username: user, link: finalLink, raw: raw };
        } else {
            // Trường hợp nhập username
            const u = raw.replace('@','').trim();
            if(/^[a-zA-Z0-9._]+$/.test(u)) return { username: u, link: `https://www.tiktok.com/@${u}`, raw: raw };
        }
    } catch (e) { console.error(e.message); }
    
    // Fallback
    return { username: 'unknown', link: finalLink, raw: raw };
}

let PROXY_CACHE = { ip: null, lastUpdate: 0 };
async function getNewProxy(forceNew = false) {
    try {
        if (!GLOBAL_CONFIG.proxyKey) return { success: false, msg: 'No Key' };
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
        return { success: false, wait: 5, msg: 'Proxy Err' };
    } catch (e) { return { success: false, wait: 5, msg: e.message }; }
}

// BUFF FUNCTIONS
async function processZefameFollow(link) {
    let proxyData = null, attempt = 1;
    while (attempt <= 10) {
        const res = await getNewProxy(true);
        if (res.success) { proxyData = res; break; }
        if (res.wait) { console.log(`⏳ Proxy chờ ${res.wait}s...`); await sleep((res.wait + 1) * 1000); }
        else return { success: false, msg: res.msg };
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
        if (text.includes('wait')) return { success: false, msg: 'Zefame chờ 12p' };
        return { success: false, msg: 'Lỗi Zefame' };
    } catch (e) { return { success: false, msg: e.message }; }
}

async function processZefameNoProxy(link, type) {
    const serviceId = type === 'view' ? '229' : '232';
    try {
        // Link ở đây ĐÃ ĐƯỢC GIẢI MÃ THÀNH LINK GỐC
        const resCheck = await axios.post('https://free.zefame.com/api_free.php', new URLSearchParams({ action: 'checkVideoId', link }), { headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' } });
        let videoId = resCheck.data?.data || resCheck.data?.id || resCheck.data;
        if (!videoId || typeof videoId === 'object') return { success: false, msg: 'Video ID Not Found' };
        
        const deviceId = uuidv4();
        const resOrder = await axios.post('https://free.zefame.com/api_free.php?action=order', new URLSearchParams({ service: serviceId, link, uuid: deviceId, videoId }), { headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' } });
        const text = JSON.stringify(resOrder.data).toLowerCase();
        if (text.includes('success') && text.includes('true')) return { success: true, msg: 'Success' };
        if (text.includes('wait')) return { success: false, msg: 'Zefame chờ 5p' };
        return { success: false, msg: 'API Fail' };
    } catch (e) { return { success: false, msg: e.message }; }
}

async function processVip(siteKey, username) {
    const cfg = siteKey === 'tikfames' ? { url: "https://tikfames.com", name: 'tikfames' } : { url: "https://tikfollowers.com", name: 'tikfollowers' };
    const cookie = GLOBAL_CONFIG.cookies[siteKey];
    if (!cookie) return { success: false, msg: 'No Cookie' };
    try {
        const headers = { 'Content-Type': 'application/json', 'Cookie': cookie, 'Origin': cfg.url };
        const sRes = await axios.post(`${cfg.url}/api/search`, { input: username, type: "getUserDetails", recaptchaToken: siteKey === 'tikfames' ? "fake_"+Date.now() : undefined }, { headers, timeout: 10000 });
        if (!sRes.data.success) return { success: false, msg: 'User/Cookie Err' };
        await sleep(1000);
        const pRes = await axios.post(`${cfg.url}/api/process`, { ...sRes.data, type: siteKey === 'tikfollowers' ? "followers" : "follow" }, { headers, timeout: 15000 });
        if (pRes.data.success) return { success: true, msg: 'Success' };
        if ((pRes.data.message||"").includes('wait')) return { success: false, msg: 'Web báo chờ' };
        return { success: false, msg: 'Fail' };
    } catch (e) { return { success: false, msg: e.message }; }
}

// WORKER
async function runWorker(orderId, serviceId, link, username) {
    updateOrderStatus(orderId, 'Processing', 'Đang xử lý...');
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

// ==================================================================
// 4. API ENDPOINTS
// ==================================================================

app.get('/admin.html', (req, res) => res.send(ADMIN_HTML));
app.get('/', (req, res) => res.send(ADMIN_HTML));

app.post('/api/order', async (req, res) => {
    // 1. Nhận input
    const serviceId = String(req.body.service || req.body.type);
    const rawLink = req.body.link || req.body.url;
    
    if (!['1','2','3','4'].includes(serviceId)) return res.json({ error: 'Sai ID dịch vụ' });

    // 2. GIẢI MÃ LINK (THÊM await)
    const info = await getInfo(rawLink);
    if (!info) return res.json({ error: 'Link không hợp lệ' });

    // 3. Tạo đơn với Link Đã Giải Mã (info.link)
    const orderId = createOrderInDb(serviceId, info.link);
    
    res.json({ status: 'success', order: orderId });
    
    // 4. Chạy
    runWorker(orderId, serviceId, info.link, info.username);
});

app.post('/api/status', (req, res) => {
    const order = ORDERS_DB.find(o => o.order == (req.body.order || req.body.id));
    if (!order) return res.json({ error: 'Not Found' });
    res.json({ status: order.status, charge: "0", start_count: "0", remains: "0", currency: "VND", msg: order.msg });
});

// Admin
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

app.listen(PORT, () => console.log(`🚀 SERVER RUNNING ON PORT ${PORT}`));
