const express = require('express');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { v4: uuidv4 } = require('uuid');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASS = "admin123"; 

// ==================================================================
// 1. CẤU HÌNH DỊCH VỤ (SERVICE MAPPING)
// Web chỉ cần gửi service ID (ví dụ: 1, 2, 3) cho chuẩn
// ==================================================================
const SERVICE_MAP = {
    '1': { type: 'follow', name: 'Zefame Follow', server: 'zefame' },
    '2': { type: 'view',   name: 'Zefame View',   server: 'zefame_views' },
    '3': { type: 'heart',  name: 'Zefame Heart',  server: 'zefame_hearts' },
    '4': { type: 'vip',    name: 'VIP Follow',    server: 'vip' } // TikFames + TikFollowers
};

let GLOBAL_CONFIG = {
    proxyKey: "ulhHONDSmaqepPClsbtMkp",
    cookies: { tikfames: "", tikfollowers: "" }
};

// ==================================================================
// 2. DATABASE ĐƠN HÀNG (JSON FILE)
// Lưu trạng thái thật để Web check
// ==================================================================
const DB_FILE = 'orders.json';
let ORDERS_DB = [];

// Load DB khi khởi động
try {
    if (fs.existsSync(DB_FILE)) ORDERS_DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} catch (e) { ORDERS_DB = []; }

// Hàm lưu đơn mới
function createOrderInDb(serviceId, link) {
    const orderId = Math.floor(Date.now() + Math.random() * 1000); // Unique ID
    const newOrder = {
        order: orderId,
        service: serviceId,
        link: link,
        status: 'Pending', // Trạng thái ban đầu
        start_count: 0,
        remains: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        msg: 'Waiting for process'
    };
    ORDERS_DB.unshift(newOrder);
    // Giữ lại 1000 đơn gần nhất
    if (ORDERS_DB.length > 1000) ORDERS_DB.pop();
    saveDb();
    return orderId;
}

// Hàm cập nhật trạng thái đơn
function updateOrderStatus(orderId, status, msg = '') {
    const index = ORDERS_DB.findIndex(o => o.order == orderId);
    if (index !== -1) {
        ORDERS_DB[index].status = status; // Pending, Processing, Completed, Canceled
        ORDERS_DB[index].msg = msg;
        ORDERS_DB[index].updated_at = new Date().toISOString();
        saveDb();
        console.log(`📝 [ORDER ${orderId}] Update -> ${status} (${msg})`);
    }
}

function saveDb() {
    try { fs.writeFileSync(DB_FILE, JSON.stringify(ORDERS_DB, null, 2)); } catch (e) {}
}

// ==================================================================
// 3. CORE & PROXY
// ==================================================================
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true })); // Chuẩn cho PHP

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let PROXY_CACHE = { ip: null, lastUpdate: 0 };

async function getNewProxy(forceNew = false) {
    try {
        if (!GLOBAL_CONFIG.proxyKey) return { success: false, msg: 'No Proxy Key' };
        const now = Date.now();
        if (!forceNew && PROXY_CACHE.ip && (now - PROXY_CACHE.lastUpdate < 60000)) {
            return { success: true, proxy: PROXY_CACHE.ip };
        }
        
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

// ==================================================================
// 4. BUFF FUNCTIONS (TRẢ VỀ KẾT QUẢ ĐỂ UPDATE DB)
// ==================================================================

// ZEFAME FOLLOW (Có Proxy + Retry)
async function processZefameFollow(link) {
    let proxyData = null, attempt = 1;
    while (attempt <= 5) { // Thử tối đa 5 lần lấy proxy
        const res = await getNewProxy(true);
        if (res.success) { proxyData = res; break; }
        if (res.wait) await sleep((res.wait + 1) * 1000);
        else return { success: false, msg: res.msg };
        attempt++;
    }
    if (!proxyData) return { success: false, msg: 'Proxy Timeout' };

    const agent = new HttpsProxyAgent(`http://${proxyData.proxy}`);
    const deviceId = uuidv4();
    const fakeUser = "user_" + Math.random().toString(36).substring(7);

    try {
        await axios.get('https://free.zefame.com/api_free.php', {
            params: { action: 'check', device: deviceId, service: '228', username: fakeUser },
            headers: { 'authority': 'free.zefame.com', 'user-agent': 'Mozilla/5.0' },
            httpsAgent: agent, timeout: 10000
        }).catch(()=>{});

        const res = await axios.post('https://free.zefame.com/api_free.php?action=order', 
            new URLSearchParams({ service: '228', link: link, uuid: deviceId, username: fakeUser }), 
            { headers: { 'authority': 'free.zefame.com', 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' }, httpsAgent: agent, timeout: 20000 }
        );

        const text = JSON.stringify(res.data).toLowerCase();
        if (text.includes('success') && text.includes('true')) return { success: true, msg: 'Success' };
        if (text.includes('wait') || text.includes('limit')) return { success: false, msg: 'Rate Limit (Web tự xử lý)' }; // Fail để Web biết mà hoàn tiền hoặc chờ
        return { success: false, msg: 'API Error' };
    } catch (e) { return { success: false, msg: e.message }; }
}

// ZEFAME VIEW/HEART (No Proxy)
async function processZefameNoProxy(link, type) {
    const serviceId = type === 'view' ? '229' : '232';
    try {
        const resCheck = await axios.post('https://free.zefame.com/api_free.php', new URLSearchParams({ action: 'checkVideoId', link }), { headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' } });
        let videoId = resCheck.data?.data || resCheck.data?.id || resCheck.data;
        if (!videoId || typeof videoId === 'object') return { success: false, msg: 'Video ID Not Found' };

        const deviceId = uuidv4();
        const resOrder = await axios.post('https://free.zefame.com/api_free.php?action=order', 
            new URLSearchParams({ service: serviceId, link, uuid: deviceId, videoId }), 
            { headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' } }
        );
        
        const text = JSON.stringify(resOrder.data).toLowerCase();
        if (text.includes('success') && text.includes('true')) return { success: true, msg: 'Success' };
        if (text.includes('wait')) return { success: false, msg: 'Rate Limit' };
        return { success: false, msg: 'API Fail' };
    } catch (e) { return { success: false, msg: e.message }; }
}

// VIP SITES
async function processVip(siteKey, username) {
    const cfg = siteKey === 'tikfames' 
        ? { url: "https://tikfames.com", name: 'tikfames' } 
        : { url: "https://tikfollowers.com", name: 'tikfollowers' };
    
    const cookie = GLOBAL_CONFIG.cookies[siteKey];
    if (!cookie) return { success: false, msg: 'No Cookie' };

    try {
        const headers = { 'Content-Type': 'application/json', 'Cookie': cookie, 'Origin': cfg.url };
        const sRes = await axios.post(`${cfg.url}/api/search`, { 
            input: username, type: "getUserDetails", recaptchaToken: siteKey === 'tikfames' ? "fake_"+Date.now() : undefined 
        }, { headers, timeout: 10000 });

        if (!sRes.data.success) return { success: false, msg: 'User/Cookie Error' };
        await sleep(1000);

        const pPayload = { ...sRes.data, type: siteKey === 'tikfollowers' ? "followers" : "follow" };
        const pRes = await axios.post(`${cfg.url}/api/process`, pPayload, { headers, timeout: 15000 });

        if (pRes.data.success) return { success: true, msg: 'Success' };
        if ((pRes.data.message||"").includes('wait')) return { success: false, msg: 'Rate Limit' };
        return { success: false, msg: 'Process Fail' };
    } catch (e) { return { success: false, msg: e.message }; }
}

// ==================================================================
// 5. TRÌNH XỬ LÝ HÀNG ĐỢI (WORKER)
// Hàm này chạy ngầm sau khi trả kết quả cho Web
// ==================================================================
async function runWorker(orderId, serviceType, link, username) {
    updateOrderStatus(orderId, 'Processing', 'Đang xử lý...');
    
    let result = { success: false, msg: 'Unknown Error' };

    // Điều hướng logic
    if (serviceType === 'follow') {
        result = await processZefameFollow(link);
    } 
    else if (serviceType === 'view') {
        result = await processZefameNoProxy(link, 'view');
    }
    else if (serviceType === 'heart') {
        result = await processZefameNoProxy(link, 'heart');
    }
    else if (serviceType === 'vip') {
        // VIP chạy cả 2 server, 1 cái ăn là tính Success
        const r1 = await processVip('tikfames', username);
        const r2 = await processVip('tikfollowers', username);
        if (r1.success || r2.success) {
            result = { success: true, msg: `Done (Fames:${r1.success}|Followers:${r2.success})` };
        } else {
            result = { success: false, msg: `All Fail: ${r1.msg} | ${r2.msg}` };
        }
    }

    // Update DB cuối cùng
    if (result.success) {
        updateOrderStatus(orderId, 'Completed', result.msg);
    } else {
        // Web thường coi "Canceled" là lỗi để hoàn tiền
        updateOrderStatus(orderId, 'Canceled', result.msg); 
    }
}

// ==================================================================
// 6. API ENDPOINTS (PANEL STANDARD)
// ==================================================================

// Helper lấy info
function getInfo(raw) {
    if (!raw) return null;
    try {
        if (raw.includes("tiktok.com")) {
            const urlObj = new URL(raw);
            const user = urlObj.pathname.split('/').find(p => p.startsWith('@'))?.replace('@','');
            if (user) return { username: user, link: `https://www.tiktok.com/@${user}`, raw: raw };
        } else {
            const u = raw.replace('@','').trim();
            return { username: u, link: `https://www.tiktok.com/@${u}`, raw: raw };
        }
    } catch (e) { return null; }
    return null;
}

/**
 * API TẠO ĐƠN (Standard SMM v2)
 * Input: service (ID), link
 * Output: order (ID)
 */
app.post('/api/order', (req, res) => {
    // 1. Lấy input
    const serviceId = String(req.body.service || req.body.type); // Ép về string '1', '2'...
    const rawLink = req.body.link || req.body.url;
    
    // 2. Validate Service
    const serviceConfig = SERVICE_MAP[serviceId];
    if (!serviceConfig) {
        return res.json({ error: 'Sai ID dịch vụ (Dùng 1,2,3,4)' });
    }

    // 3. Validate Link
    const info = getInfo(rawLink);
    if (!info) {
        return res.json({ error: 'Link TikTok không hợp lệ' });
    }

    // 4. Tạo đơn trong DB (Pending)
    const orderId = createOrderInDb(serviceId, info.link);

    // 5. Trả về ngay lập tức cho Web (Non-blocking)
    res.json({
        status: 'success', // Có thể dùng 'pending' tùy code web
        order: orderId
    });

    // 6. Chạy Worker ngầm (Fire and Forget)
    // Server Node tự chạy cái này, Web PHP không cần chờ
    runWorker(orderId, serviceConfig.type, info.link, info.username);
});

/**
 * API CHECK STATUS (Standard SMM v2)
 * Input: order (ID)
 * Output: status, start_count, remains
 */
app.post('/api/status', (req, res) => {
    const orderId = req.body.order || req.body.id;
    const order = ORDERS_DB.find(o => o.order == orderId);

    if (!order) {
        return res.json({ error: 'Incorrect order ID' });
    }

    res.json({
        status: order.status, // Pending, Processing, Completed, Canceled
        charge: "0",
        start_count: "0",
        remains: "0",
        currency: "VND",
        msg: order.msg // Thêm tin nhắn lỗi/thành công để debug
    });
});

/**
 * API SERVICES (Để Web lấy danh sách dịch vụ nếu cần)
 */
app.get('/api/services', (req, res) => {
    const list = Object.keys(SERVICE_MAP).map(k => ({
        service: k,
        name: SERVICE_MAP[k].name,
        type: 'Default',
        category: 'TikTok Free',
        rate: 0,
        min: 1,
        max: 1000
    }));
    res.json(list);
});

// Admin Routes
const checkAdmin = (req, res, next) => {
    if ((req.headers['x-admin-pass'] || req.query.pass) === ADMIN_PASS) next();
    else res.status(403).json({ success: false });
};
app.get('/api/admin/config', checkAdmin, (req, res) => res.json({ config: GLOBAL_CONFIG }));
app.post('/api/admin/update', checkAdmin, (req, res) => {
    const { type, value, site } = req.body;
    if (type === 'proxy') GLOBAL_CONFIG.proxyKey = value;
    if (type === 'cookie') GLOBAL_CONFIG.cookies[site] = value;
    res.json({ success: true });
});
app.get('/api/logs', checkAdmin, (req, res) => res.json(ORDERS_DB.slice(0, 100)));

app.listen(PORT, () => console.log(`🚀 SMM PROVIDER RUNNING ON PORT ${PORT}`));
