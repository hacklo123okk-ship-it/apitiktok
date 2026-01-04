const express = require('express');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { v4: uuidv4 } = require('uuid');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// ==================================================================
// CẤU HÌNH ĐỂ CHẠY FILE TỪ THƯ MỤC GỐC
// ==================================================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/logs.html', (req, res) => res.sendFile(path.join(__dirname, 'logs.html')));

// ==================================================================
// I. CẤU HÌNH HỆ THỐNG VÀ LOGGING
// ==================================================================
let GLOBAL_CONFIG = {
    proxyKey: "ulhHONDSmaqepPClsbtMkp", // Thay Key Proxy của ông vào đây
    cookies: {
        tikfames: "",      // Cookie lấy từ tikfames.com
        tikfollowers: ""   // Cookie lấy từ tikfollowers.com
    }
};

let BUFF_LOGS = { free: [], vip: [] };
const MAX_LOG_ENTRIES = 100; 

// Hàm thêm log (Ghi file async để không chặn luồng)
function addLog(type, data) {
    const logEntry = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        timestamp: new Date().toISOString(),
        time_display: new Date().toLocaleTimeString('vi-VN'),
        type: type,
        ...data
    };

    BUFF_LOGS[type].unshift(logEntry);
    if (BUFF_LOGS[type].length > MAX_LOG_ENTRIES) BUFF_LOGS[type].pop();

    console.log(`📝 [${type.toUpperCase()}] ${logEntry.time_display} - ${data.username} - ${data.status ? '✅' : '❌'} ${data.message}`);
    
    // Ghi file bất đồng bộ
    fs.writeFile('buff-logs.json', JSON.stringify(BUFF_LOGS, null, 2), (err) => {
        if (err) console.error('Lỗi lưu log:', err);
    });
}

// Đọc log cũ
try {
    if (fs.existsSync('buff-logs.json')) {
        BUFF_LOGS = JSON.parse(fs.readFileSync('buff-logs.json', 'utf8'));
        console.log(`📂 Đã tải log cũ: Free(${BUFF_LOGS.free.length}), VIP(${BUFF_LOGS.vip.length})`);
    }
} catch (e) { console.log('Tạo log mới'); }

// Quản lý Cooldown
let SERVER_COOLDOWN = { zefame: 0, tikfames: 0, tikfollowers: 0 };

function updateCooldown(server, seconds) {
    SERVER_COOLDOWN[server] = seconds;
    console.log(`⏳ Server ${server} cooldown: ${seconds}s`);
}

setInterval(() => {
    Object.keys(SERVER_COOLDOWN).forEach(server => {
        if (SERVER_COOLDOWN[server] > 0) SERVER_COOLDOWN[server] -= 1;
    });
}, 1000);

function isServerReady(server) { return SERVER_COOLDOWN[server] <= 0; }

// ==================================================================
// II. HÀM PROXY (CHỈ DÙNG CHO ZEFAME)
// ==================================================================
async function getNewProxy() {
    try {
        if (!GLOBAL_CONFIG.proxyKey) return { success: false, msg: 'Chưa cấu hình Proxy Key' };
        
        const url = `https://proxyxoay.shop/api/get.php?key=${GLOBAL_CONFIG.proxyKey}`;
        const response = await axios.get(url, { timeout: 10000 });
        const data = response.data;

        if (data.status === 100 && data.proxyhttp) {
             let proxy = data.proxyhttp.replace(/http:\/\/|https:\/\/|::/g, '');
             return { success: true, proxy: proxy };
        }
        if (data.status === 101) {
            const match = data.message.match(/Con (\d+)s/);
            return { success: false, wait: match ? parseInt(match[1]) : 60, msg: data.message };
        }
        return { success: false, wait: 0, msg: data.message || 'Lỗi Proxy' };
    } catch (e) {
        return { success: false, msg: 'Lỗi API Proxy: ' + e.message };
    }
}

// ==================================================================
// III. API BUFF ZEFAME (CÓ PROXY + RAW ERROR)
// ==================================================================
const ZEFAME_HEADERS = {
    'authority': 'zefame-free.com',
    'accept': 'application/json, text/javascript, */*; q=0.01',
    'origin': 'https://zefame-free.com',
    'referer': 'https://zefame-free.com/',
    'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'x-requested-with': 'XMLHttpRequest',
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
};

async function buffZefame(link) {
    if (!isServerReady('zefame')) return { status: false, code: 'COOLDOWN', msg: `Zefame chờ ${SERVER_COOLDOWN.zefame}s`, server: 'zefame' };

    const pData = await getNewProxy();
    if (!pData.success) return { status: false, code: 'PROXY_WAIT', msg: `Lỗi Proxy: ${pData.msg}`, wait_seconds: pData.wait || 30, server: 'zefame' };
    
    const httpsAgent = new HttpsProxyAgent(`http://${pData.proxy}`);
    
    try {
        const params = new URLSearchParams();
        params.append('service', '228'); 
        params.append('link', link); // Link chuẩn của acc cần buff
        params.append('uuid', uuidv4());
        params.append('username', "user_" + Math.random().toString(36).substring(7)); // Fake user đi buff

        const response = await axios.post('https://zefame-free.com/api_free.php?action=order', params, {
            headers: ZEFAME_HEADERS,
            httpsAgent: httpsAgent,
            timeout: 20000
        });

        const data = response.data;
        const textRes = JSON.stringify(data).toLowerCase();

        // 1. Success
        if (textRes.includes('success') && textRes.includes('true')) {
            return { status: true, msg: 'Zefame thành công!', server: 'zefame' };
        } 
        
        // 2. Rate Limit
        if (textRes.includes('wait') || textRes.includes('indisponible')) {
            updateCooldown('zefame', 600); 
            return { status: false, code: 'RATE_LIMIT', msg: `Zefame Limit: ${JSON.stringify(data)}`, server: 'zefame' };
        }

        // 3. Lỗi khác -> Trả về nguyên văn JSON
        return { 
            status: false, 
            msg: `Zefame Error: ${JSON.stringify(data)}`, 
            server: 'zefame', 
            raw: data 
        };

    } catch (e) {
        const errorData = e.response ? e.response.data : e.message;
        return { 
            status: false, 
            msg: `Lỗi Zefame: ${typeof errorData === 'object' ? JSON.stringify(errorData) : errorData}`, 
            server: 'zefame' 
        };
    }
}

// ==================================================================
// IV. API BUFF VIP (TikFames / TikFollowers) - DIRECT + RAW ERROR
// ==================================================================
const VIP_SITES = {
    tikfames: {
        search: "https://tikfames.com/api/search",
        process: "https://tikfames.com/api/process",
        origin: "https://tikfames.com",
        serverName: 'tikfames'
    },
    tikfollowers: {
        search: "https://tikfollowers.com/api/search",
        process: "https://tikfollowers.com/api/process",
        origin: "https://tikfollowers.com",
        serverName: 'tikfollowers'
    }
};

async function buffVipSite(site, username) {
    if (!VIP_SITES[site]) return { status: false, msg: 'Site invalid', server: site };
    const cfg = VIP_SITES[site];
    const serverName = cfg.serverName;

    if (!isServerReady(serverName)) {
        return { status: false, code: 'COOLDOWN', msg: `${serverName} chờ ${SERVER_COOLDOWN[serverName]}s`, server: serverName };
    }

    const cookie = GLOBAL_CONFIG.cookies[site];
    if (!cookie) return { status: false, msg: `Thiếu cookie ${site}`, server: serverName };

    // Header Fake như thật
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Content-Type': 'application/json',
        'Origin': cfg.origin,
        'Cookie': cookie,
        'Referer': cfg.origin + '/'
    };

    try {
        const cleanUser = username.replace('@', '');
        const searchPayload = { input: cleanUser, type: "getUserDetails" };
        if (site === 'tikfames') searchPayload.recaptchaToken = "fake_" + Math.random().toString(36); 

        // --- BƯỚC 1: SEARCH ---
        const res1 = await axios.post(cfg.search, searchPayload, { headers, timeout: 15000 });
        
        if (!res1.data.success) {
            if (JSON.stringify(res1.data).includes('login')) return { status: false, code: 'COOKIE_DIE', msg: 'Cookie Die (Cần lấy lại cookie)', server: serverName };
            // Trả về nguyên văn lỗi search
            return { status: false, msg: `Search Error: ${JSON.stringify(res1.data)}`, server: serverName };
        }

        await new Promise(r => setTimeout(r, 1000)); // Delay nhẹ

        // --- BƯỚC 2: PROCESS ---
        const processPayload = { ...res1.data }; // Lấy data từ bước 1
        processPayload.type = (site === 'tikfollowers') ? "followers" : "follow";
        if (site === 'tikfames') processPayload.recaptchaToken = searchPayload.recaptchaToken;

        const res2 = await axios.post(cfg.process, processPayload, { headers, timeout: 20000 });

        if (res2.data.success) {
            return { status: true, msg: `${serverName} thành công!`, server: serverName };
        } 
        
        const msgStr = JSON.stringify(res2.data).toLowerCase();
        
        if (msgStr.includes('wait') || msgStr.includes('minute') || msgStr.includes('second')) {
            let waitSeconds = 1800;
            const minMatch = msgStr.match(/(\d+)\s*minute/);
            if (minMatch) waitSeconds = parseInt(minMatch[1]) * 60;
            
            updateCooldown(serverName, waitSeconds);
            return { status: false, code: 'RATE_LIMIT', msg: `Rate Limit: ${JSON.stringify(res2.data)}`, server: serverName };
        }

        // Trả về nguyên văn lỗi process
        return { status: false, msg: `Process Error: ${JSON.stringify(res2.data)}`, server: serverName };

    } catch (e) {
        const errorDetail = e.response ? e.response.data : e.message;
        return { status: false, msg: `Lỗi Kết Nối ${serverName}: ${typeof errorDetail === 'object' ? JSON.stringify(errorDetail) : errorDetail}`, server: serverName };
    }
}

// ==================================================================
// V. HÀM XỬ LÝ SONG SONG (Promise.all)
// ==================================================================
async function buffAllServers(username, link = null, isVip = false) {
    const jobs = [];

    // Chạy song song TikFames + TikFollowers
    jobs.push(buffVipSite('tikfames', username));
    jobs.push(buffVipSite('tikfollowers', username));
    
    // Nếu là VIP mode thì chạy thêm Zefame
    if (isVip && link) {
        jobs.push(buffZefame(link));
    }

    const results = await Promise.all(jobs);
    const successCount = results.filter(r => r.status).length;
    
    return {
        status: successCount > 0,
        msg: `Hoàn thành: ${successCount}/${results.length} thành công`,
        details: results
    };
}

// ==================================================================
// VI. ENDPOINTS API
// ==================================================================
app.post('/api/free/buff', async (req, res) => {
    const { username } = req.body;
    if (!username) return res.json({ status: false, msg: 'Thiếu username' });

    const result = await buffAllServers(username, null, false);
    addLog('free', { username, status: result.status, message: result.msg, details: result.details });
    res.json(result);
});

app.post('/api/vip/buff', async (req, res) => {
    const { link, username } = req.body;
    if (!link || !username) return res.json({ status: false, msg: 'Thiếu info' });

    const result = await buffAllServers(username, link, true);
    addLog('vip', { username, link, status: result.status, message: result.msg, details: result.details });
    res.json(result);
});

// Endpoint lẻ để test từng cái
app.post('/api/buff/zefame', async (req, res) => {
    const { link } = req.body;
    if (!link) return res.json({ status: false, msg: 'Thiếu link' });
    const result = await buffZefame(link);
    res.json(result);
});

app.post('/api/buff/tikfames', async (req, res) => {
    const { username } = req.body;
    if (!username) return res.json({ status: false, msg: 'Thiếu username' });
    const result = await buffVipSite('tikfames', username);
    res.json(result);
});

app.post('/api/buff/tikfollowers', async (req, res) => {
    const { username } = req.body;
    if (!username) return res.json({ status: false, msg: 'Thiếu username' });
    const result = await buffVipSite('tikfollowers', username);
    res.json(result);
});

// Admin config endpoint
app.post('/api/admin/update', (req, res) => {
    const { type, value, site } = req.body;
    if (type === 'proxy') {
        GLOBAL_CONFIG.proxyKey = value.trim();
        return res.json({ success: true, msg: "Updated Proxy Key" });
    }
    if (type === 'cookie') {
        GLOBAL_CONFIG.cookies[site] = value.trim();
        return res.json({ success: true, msg: `Updated Cookie ${site}` });
    }
    res.json({ success: false });
});

app.get('/api/admin/config', (req, res) => {
    res.json({
        proxyKey: GLOBAL_CONFIG.proxyKey,
        cookies: GLOBAL_CONFIG.cookies,
        cooldowns: SERVER_COOLDOWN
    });
});

app.get('/api/servers/status', (req, res) => {
    res.json(SERVER_COOLDOWN);
});

app.get('/api/logs', (req, res) => {
    const { type } = req.query;
    if(type === 'free') res.json({logs: BUFF_LOGS.free});
    else if(type === 'vip') res.json({logs: BUFF_LOGS.vip});
    else res.json({logs: [...BUFF_LOGS.free, ...BUFF_LOGS.vip]});
});

app.listen(PORT, () => {
    console.log(`🚀 Server Tiệp Gà Cui đang chạy port ${PORT}`);
    console.log(`- Zefame: Proxy + Fake User + Real Link`);
    console.log(`- VIP Sites: Direct + Fake Token + Real Cookie`);
    console.log(`- Error Handling: RAW JSON return`);
});
