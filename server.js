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
    proxyKey: "ulhHONDSmaqepPClsbtMkp", 
    cookies: {
        tikfames: "",      
        tikfollowers: ""   
    }
};

let BUFF_LOGS = { free: [], vip: [] };
const MAX_LOG_ENTRIES = 100; 

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
    
    fs.writeFile('buff-logs.json', JSON.stringify(BUFF_LOGS, null, 2), (err) => {
        if (err) console.error('Lỗi lưu log:', err);
    });
}

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
// II. HÀM PROXY (LOGIC THÔNG MINH: SUCCESS -> ĐỔI IP)
// ==================================================================
let PROXY_STATE = {
    ip: null,
    lastUpdate: 0,
    isUsed: false // Đánh dấu đã dùng thành công hay chưa
};

async function fetchProxyFromAPI() {
    try {
        if (!GLOBAL_CONFIG.proxyKey) return { success: false, msg: 'Chưa cấu hình Proxy Key' };
        
        const url = `https://proxyxoay.shop/api/get.php?key=${GLOBAL_CONFIG.proxyKey}`;
        const response = await axios.get(url, { timeout: 15000 });
        const data = response.data;

        if (data.status === 100 && data.proxyhttp) {
             let proxy = data.proxyhttp.replace(/http:\/\/|https:\/\/|::/g, '');
             return { success: true, proxy: proxy };
        }
        if (data.status === 101) {
            const match = data.message.match(/Con (\d+)s/);
            return { success: false, wait: match ? parseInt(match[1]) : 60, msg: data.message };
        }
        return { success: false, wait: 0, msg: data.message || 'Lỗi Proxy API' };
    } catch (e) {
        return { success: false, msg: 'Lỗi Net Proxy: ' + e.message };
    }
}

async function getZefameProxy() {
    const now = Date.now();
    const timeDiff = (now - PROXY_STATE.lastUpdate) / 1000;
    const waitTime = 60; 

    // Nếu proxy cũ đã buff thành công -> Bắt buộc lấy mới
    if (PROXY_STATE.isUsed) {
        if (timeDiff < waitTime) {
            const remaining = Math.ceil(waitTime - timeDiff);
            return { success: false, code: 'PROXY_COOLDOWN', msg: `Đang chờ đổi IP mới (${remaining}s)...`, wait: remaining };
        }
        
        console.log('🔄 Proxy cũ đã xong nhiệm vụ, lấy cái mới...');
        const result = await fetchProxyFromAPI();
        
        if (result.success) {
            PROXY_STATE.ip = result.proxy;
            PROXY_STATE.lastUpdate = Date.now();
            PROXY_STATE.isUsed = false;
            console.log('✅ New Proxy:', result.proxy);
            return { success: true, proxy: result.proxy };
        } else {
            return result;
        }
    }

    // Nếu chưa có proxy
    if (!PROXY_STATE.ip) {
        const result = await fetchProxyFromAPI();
        if (result.success) {
            PROXY_STATE.ip = result.proxy;
            PROXY_STATE.lastUpdate = Date.now();
            PROXY_STATE.isUsed = false;
            return { success: true, proxy: result.proxy };
        }
        return result;
    }

    // Nếu có proxy mà chưa buff thành công -> Dùng lại
    return { success: true, proxy: PROXY_STATE.ip };
}

function markProxyAsUsed() {
    console.log('🚫 Đã buff thành công -> Đánh dấu bỏ IP này!');
    PROXY_STATE.isUsed = true;
}

// ==================================================================
// III. API BUFF ZEFAME (AUTO LINK + SMART PROXY + RAW ERROR)
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

    const pData = await getZefameProxy();
    
    if (!pData.success) {
        return { 
            status: false, 
            code: 'PROXY_WAIT', 
            msg: pData.msg, 
            wait_seconds: pData.wait || 10, 
            server: 'zefame' 
        };
    }
    
    const httpsAgent = new HttpsProxyAgent(`http://${pData.proxy}`);
    
    try {
        const params = new URLSearchParams();
        params.append('service', '228'); 
        params.append('link', link);
        params.append('uuid', uuidv4());
        params.append('username', "user_" + Math.random().toString(36).substring(7));

        const response = await axios.post('https://zefame-free.com/api_free.php?action=order', params, {
            headers: ZEFAME_HEADERS,
            httpsAgent: httpsAgent,
            timeout: 60000
        });

        const data = response.data;
        const textRes = JSON.stringify(data).toLowerCase();

        // 1. Thành công -> Đánh dấu IP đã dùng
        if (textRes.includes('success') && textRes.includes('true')) {
            markProxyAsUsed(); 
            return { status: true, msg: 'Zefame thành công!', server: 'zefame' };
        } 
        
        // 2. Rate Limit -> Cũng đánh dấu IP để lần sau đổi cái khác
        if (textRes.includes('wait') || textRes.includes('indisponible')) {
            updateCooldown('zefame', 600); 
            markProxyAsUsed();
            return { status: false, code: 'RATE_LIMIT', msg: `Zefame Limit: ${JSON.stringify(data)}`, server: 'zefame' };
        }

        // 3. Lỗi Link Profile
        if (textRes.includes('profil')) {
             return { status: false, msg: `Zefame Lỗi Link: Phải dùng Link Profile!`, server: 'zefame', raw: data };
        }

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
// IV. API BUFF VIP (TIKFAMES/FOLLOWERS)
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

        const res1 = await axios.post(cfg.search, searchPayload, { headers, timeout: 30000 });
        
        if (!res1.data.success) {
            if (JSON.stringify(res1.data).includes('login')) return { status: false, code: 'COOKIE_DIE', msg: 'Cookie Die (Login lại)', server: serverName };
            return { status: false, msg: `Search Error: ${JSON.stringify(res1.data)}`, server: serverName };
        }

        await new Promise(r => setTimeout(r, 1000)); 

        const processPayload = { ...res1.data }; 
        processPayload.type = (site === 'tikfollowers') ? "followers" : "follow";
        if (site === 'tikfames') processPayload.recaptchaToken = searchPayload.recaptchaToken;

        const res2 = await axios.post(cfg.process, processPayload, { headers, timeout: 60000 });

        if (res2.data.success) {
            return { status: true, msg: `${serverName} thành công!`, server: serverName };
        } 
        
        const msgStr = JSON.stringify(res2.data).toLowerCase();
        
        if (msgStr.includes('wait') || msgStr.includes('minute') || msgStr.includes('second')) {
            let waitSeconds = 1800;
            const minMatch = msgStr.match(/(\d+)\s*minute/);
            const secMatch = msgStr.match(/(\d+)\s*second/);
            
            if (minMatch) waitSeconds = parseInt(minMatch[1]) * 60;
            if (secMatch) waitSeconds += parseInt(secMatch[1]);
            
            updateCooldown(serverName, waitSeconds);
            return { status: false, code: 'RATE_LIMIT', msg: `Đang chờ: ${minMatch ? minMatch[1] : 0}p ${secMatch ? secMatch[1] : 0}s`, server: serverName };
        }

        return { status: false, msg: `Process Error: ${JSON.stringify(res2.data)}`, server: serverName };

    } catch (e) {
        const errorDetail = e.response ? e.response.data : e.message;
        if (e.code === 'ECONNABORTED') return { status: false, msg: `Timeout: Server ${serverName} phản hồi quá lâu`, server: serverName };
        return { status: false, msg: `Lỗi Kết Nối ${serverName}: ${typeof errorDetail === 'object' ? JSON.stringify(errorDetail) : errorDetail}`, server: serverName };
    }
}

// ==================================================================
// V. HÀM XỬ LÝ SONG SONG & HELPER
// ==================================================================
function generateProfileLink(inputUser) {
    const cleanUser = inputUser.toString().trim().replace(/^@/, '');
    return `https://www.tiktok.com/@${cleanUser}`;
}

async function buffAllServers(username, link = null, isVip = false) {
    const jobs = [];
    jobs.push(buffVipSite('tikfames', username));
    jobs.push(buffVipSite('tikfollowers', username));
    
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
// VI. ENDPOINTS
// ==================================================================
app.post('/api/free/buff', async (req, res) => {
    const { username } = req.body;
    if (!username) return res.json({ status: false, msg: 'Thiếu username' });

    const result = await buffAllServers(username, null, false);
    addLog('free', { username, status: result.status, message: result.msg, details: result.details });
    res.json(result);
});

app.post('/api/vip/buff', async (req, res) => {
    const { username } = req.body; // Chỉ cần username
    if (!username) return res.json({ status: false, msg: 'Thiếu username' });

    const autoLink = generateProfileLink(username); // Tự tạo link cho Zefame
    const result = await buffAllServers(username, autoLink, true);
    
    addLog('vip', { username, link: autoLink, status: result.status, message: result.msg, details: result.details });
    res.json(result);
});

// Admin Update
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
    if (type === 'reset_cooldown') {
        SERVER_COOLDOWN[value] = 0;
        return res.json({ success: true, msg: `Reset cooldown ${value}` });
    }
    res.json({ success: false });
});

app.get('/api/admin/config', (req, res) => {
    res.json({
        proxyKey: GLOBAL_CONFIG.proxyKey,
        cookies: GLOBAL_CONFIG.cookies,
        cooldowns: SERVER_COOLDOWN,
        proxyState: PROXY_STATE
    });
});

app.get('/api/logs', (req, res) => {
    const { type } = req.query;
    if(type === 'free') res.json({logs: BUFF_LOGS.free});
    else if(type === 'vip') res.json({logs: BUFF_LOGS.vip});
    else res.json({logs: [...BUFF_LOGS.free, ...BUFF_LOGS.vip]});
});

// Endpoint test lẻ
app.post('/api/buff/zefame', async (req, res) => {
    const { username, link } = req.body;
    let targetLink = link;
    if (!targetLink && username) targetLink = generateProfileLink(username);
    
    if (!targetLink) return res.json({ status: false, msg: 'Thiếu link/username' });
    const result = await buffZefame(targetLink);
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

app.listen(PORT, () => {
    console.log(`🚀 Server Tiệp Gà Cui running on PORT ${PORT}`);
    console.log(`- Final Stable Version`);
});
