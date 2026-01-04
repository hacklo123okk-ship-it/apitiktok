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
const TIMEOUT_MS = 180000; // 🔥 180 GIÂY (3 PHÚT)

app.use(cors());
app.use(bodyParser.json());

// ==================================================================
// CẤU HÌNH & CONFIG
// ==================================================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/logs.html', (req, res) => res.sendFile(path.join(__dirname, 'logs.html')));

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
    fs.writeFile('buff-logs.json', JSON.stringify(BUFF_LOGS, null, 2), (err) => { if (err) console.error('Lỗi log:', err); });
}

try {
    if (fs.existsSync('buff-logs.json')) {
        BUFF_LOGS = JSON.parse(fs.readFileSync('buff-logs.json', 'utf8'));
    }
} catch (e) {}

let SERVER_COOLDOWN = { zefame: 0, tikfames: 0, tikfollowers: 0 };
function updateCooldown(server, seconds) {
    SERVER_COOLDOWN[server] = seconds;
    console.log(`⏳ Server ${server} cooldown: ${seconds}s`);
}
setInterval(() => {
    Object.keys(SERVER_COOLDOWN).forEach(s => { if (SERVER_COOLDOWN[s] > 0) SERVER_COOLDOWN[s] -= 1; });
}, 1000);
function isServerReady(server) { return SERVER_COOLDOWN[server] <= 0; }

// ==================================================================
// II. PROXY MANAGER (Smart Logic)
// ==================================================================
let PROXY_STATE = { ip: null, lastUpdate: 0, isUsed: false };

async function fetchProxyFromAPI() {
    try {
        if (!GLOBAL_CONFIG.proxyKey) return { success: false, msg: 'Chưa Config Proxy Key' };
        const response = await axios.get(`https://proxyxoay.shop/api/get.php?key=${GLOBAL_CONFIG.proxyKey}`, { timeout: 30000 });
        const data = response.data;
        if (data.status === 100 && data.proxyhttp) {
             return { success: true, proxy: data.proxyhttp.replace(/http:\/\/|https:\/\/|::/g, '') };
        }
        if (data.status === 101) {
            const match = data.message.match(/Con (\d+)s/);
            return { success: false, wait: match ? parseInt(match[1]) : 60, msg: data.message };
        }
        return { success: false, wait: 0, msg: data.message || 'Lỗi Proxy API', raw: data };
    } catch (e) { return { success: false, msg: 'Lỗi Net Proxy: ' + e.message }; }
}

async function getZefameProxy(forceNew = false) {
    const now = Date.now();
    const timeDiff = (now - PROXY_STATE.lastUpdate) / 1000;
    const waitTime = 60; 

    if (forceNew || PROXY_STATE.isUsed) {
        if (!forceNew && timeDiff < waitTime) { 
            const remaining = Math.ceil(waitTime - timeDiff);
            return { success: false, code: 'PROXY_COOLDOWN', msg: `Chờ đổi IP (${remaining}s)...`, wait: remaining };
        }
        console.log('🔄 Đang lấy Proxy mới...');
        const result = await fetchProxyFromAPI();
        if (result.success) {
            PROXY_STATE.ip = result.proxy;
            PROXY_STATE.lastUpdate = Date.now();
            PROXY_STATE.isUsed = false;
            return { success: true, proxy: result.proxy };
        }
        return result;
    }
    if (!PROXY_STATE.ip) {
        const result = await fetchProxyFromAPI();
        if (result.success) {
            PROXY_STATE.ip = result.proxy;
            PROXY_STATE.lastUpdate = Date.now();
            return { success: true, proxy: result.proxy };
        }
        return result;
    }
    return { success: true, proxy: PROXY_STATE.ip };
}

function markProxyAsUsed() { PROXY_STATE.isUsed = true; }

// ==================================================================
// III. ZEFAME (FULL DATA + RETRY + 180S)
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

async function runZefameRequest(link, proxy, isRetry = false) {
    const httpsAgent = new HttpsProxyAgent(`http://${proxy}`);
    try {
        const params = new URLSearchParams();
        params.append('service', '228'); 
        params.append('link', link);
        params.append('uuid', uuidv4());
        params.append('username', "user_" + Math.random().toString(36).substring(7));

        const response = await axios.post('https://zefame-free.com/api_free.php?action=order', params, {
            headers: ZEFAME_HEADERS, httpsAgent, timeout: TIMEOUT_MS // 🔥 180s
        });
        return { success: true, data: response.data };
    } catch (e) {
        if (!isRetry && (e.message.includes('socket') || e.message.includes('ECONNRESET'))) {
            return { success: false, needRetry: true, msg: e.message };
        }
        // Trả về FULL response data nếu có
        const errorData = e.response ? e.response.data : null;
        return { 
            success: false, 
            data: errorData, 
            msg: errorData ? JSON.stringify(errorData) : e.message 
        };
    }
}

async function buffZefame(link) {
    if (!isServerReady('zefame')) return { status: false, code: 'COOLDOWN', msg: `Zefame chờ ${SERVER_COOLDOWN.zefame}s`, server: 'zefame' };

    let pData = await getZefameProxy();
    if (!pData.success) return { status: false, msg: pData.msg, wait_seconds: pData.wait || 10, server: 'zefame', raw: pData.raw };
    
    let result = await runZefameRequest(link, pData.proxy);

    // Retry logic
    if (!result.success && result.needRetry) {
        console.log('⚠️ Proxy lỗi, đang thử lại...');
        pData = await getZefameProxy(true);
        if (pData.success) {
            result = await runZefameRequest(link, pData.proxy, true);
        } else {
            return { status: false, msg: 'Lỗi lấy Proxy Retry', server: 'zefame' };
        }
    }

    // --- RETURN FULL DATA ---
    const textRes = result.data ? JSON.stringify(result.data).toLowerCase() : "";
    
    if (result.success && textRes.includes('success') && textRes.includes('true')) {
        markProxyAsUsed(); 
        return { status: true, msg: 'Zefame thành công!', server: 'zefame', raw: result.data };
    } 
    
    if (textRes.includes('wait') || textRes.includes('indisponible')) {
        updateCooldown('zefame', 600); markProxyAsUsed();
        return { status: false, code: 'RATE_LIMIT', msg: `Zefame Limit: ${JSON.stringify(result.data)}`, server: 'zefame', raw: result.data };
    }
    
    if (textRes.includes('profil')) {
         return { status: false, msg: `Lỗi Link: Phải dùng Link Profile!`, server: 'zefame', raw: result.data };
    }

    return { 
        status: false, 
        msg: `Zefame Fail: ${JSON.stringify(result.data || result.msg)}`, 
        server: 'zefame', 
        raw: result.data // Trả về gốc
    };
}

// ==================================================================
// IV. VIP SITES (FULL RAW DATA + 180S)
// ==================================================================
const VIP_SITES = {
    tikfames: { search: "https://tikfames.com/api/search", process: "https://tikfames.com/api/process", origin: "https://tikfames.com", serverName: 'tikfames' },
    tikfollowers: { search: "https://tikfollowers.com/api/search", process: "https://tikfollowers.com/api/process", origin: "https://tikfollowers.com", serverName: 'tikfollowers' }
};

function handleVipResponse(data, serverName) {
    const msgStr = JSON.stringify(data).toLowerCase();
    if (msgStr.includes('wait') || msgStr.includes('minute') || msgStr.includes('second')) {
        let waitSeconds = 1800;
        const minMatch = msgStr.match(/(\d+)\s*minute/);
        const secMatch = msgStr.match(/(\d+)\s*second/);
        if (minMatch) waitSeconds = parseInt(minMatch[1]) * 60;
        if (secMatch) waitSeconds += parseInt(secMatch[1]);
        
        updateCooldown(serverName, waitSeconds);
        return { isCooldown: true, msg: `Đang chờ: ${minMatch ? minMatch[1] : 0}p ${secMatch ? secMatch[1] : 0}s` };
    }
    return { isCooldown: false };
}

async function buffVipSite(site, username) {
    if (!VIP_SITES[site]) return { status: false, msg: 'Site invalid', server: site };
    const cfg = VIP_SITES[site];
    const serverName = cfg.serverName;

    if (!isServerReady(serverName)) return { status: false, code: 'COOLDOWN', msg: `${serverName} chờ ${SERVER_COOLDOWN[serverName]}s`, server: serverName };

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

        // SEARCH REQUEST
        const res1 = await axios.post(cfg.search, searchPayload, { headers, timeout: TIMEOUT_MS }); // 🔥 180s
        
        if (!res1.data.success) {
            if (JSON.stringify(res1.data).includes('login')) return { status: false, code: 'COOKIE_DIE', msg: 'Cookie Die', server: serverName, raw: res1.data };
            return { status: false, msg: `Search Error: ${JSON.stringify(res1.data)}`, server: serverName, raw: res1.data };
        }
        
        await new Promise(r => setTimeout(r, 1000)); 

        const processPayload = { ...res1.data }; 
        processPayload.type = (site === 'tikfollowers') ? "followers" : "follow";
        if (site === 'tikfames') processPayload.recaptchaToken = searchPayload.recaptchaToken;

        // PROCESS REQUEST
        const res2 = await axios.post(cfg.process, processPayload, { headers, timeout: TIMEOUT_MS }); // 🔥 180s

        if (res2.data.success) return { status: true, msg: `${serverName} thành công!`, server: serverName, raw: res2.data };
        
        const check = handleVipResponse(res2.data, serverName);
        if (check.isCooldown) return { status: false, code: 'RATE_LIMIT', msg: check.msg, server: serverName, raw: res2.data };

        return { status: false, msg: `Process Fail: ${JSON.stringify(res2.data)}`, server: serverName, raw: res2.data };

    } catch (e) {
        // --- QUAN TRỌNG: LẤY FULL DATA LỖI ---
        const errorData = e.response ? e.response.data : null;
        
        if (errorData) {
            // Check coi có phải cooldown ẩn trong lỗi 400/500 không
            const check = handleVipResponse(errorData, serverName);
            if (check.isCooldown) {
                return { status: false, code: 'RATE_LIMIT', msg: check.msg, server: serverName, raw: errorData };
            }
            return { status: false, msg: `Lỗi API (${e.response.status}): ${JSON.stringify(errorData)}`, server: serverName, raw: errorData };
        }
        
        if (e.code === 'ECONNABORTED') return { status: false, msg: `Timeout > 180s`, server: serverName };
        return { status: false, msg: `Lỗi Kết Nối: ${e.message}`, server: serverName };
    }
}

// ==================================================================
// V. ENDPOINTS
// ==================================================================
function generateProfileLink(inputUser) {
    const cleanUser = inputUser.toString().trim().replace(/^@/, '');
    return `https://www.tiktok.com/@${cleanUser}`;
}

async function buffAllServers(username, link = null, isVip = false) {
    const jobs = [buffVipSite('tikfames', username), buffVipSite('tikfollowers', username)];
    if (isVip && link) jobs.push(buffZefame(link));

    const results = await Promise.all(jobs);
    const successCount = results.filter(r => r.status).length;
    return { status: successCount > 0, msg: `Hoàn thành: ${successCount}/${results.length} thành công`, details: results };
}

app.post('/api/free/buff', async (req, res) => {
    const { username } = req.body;
    if (!username) return res.json({ status: false, msg: 'Thiếu username' });
    const result = await buffAllServers(username, null, false);
    addLog('free', { username, status: result.status, message: result.msg, details: result.details });
    res.json(result);
});

app.post('/api/vip/buff', async (req, res) => {
    const { username } = req.body;
    if (!username) return res.json({ status: false, msg: 'Thiếu username' });
    const autoLink = generateProfileLink(username);
    const result = await buffAllServers(username, autoLink, true);
    addLog('vip', { username, link: autoLink, status: result.status, message: result.msg, details: result.details });
    res.json(result);
});

app.post('/api/admin/update', (req, res) => {
    const { type, value, site } = req.body;
    if (type === 'proxy') GLOBAL_CONFIG.proxyKey = value.trim();
    if (type === 'cookie') GLOBAL_CONFIG.cookies[site] = value.trim();
    if (type === 'reset_cooldown') SERVER_COOLDOWN[value] = 0;
    res.json({ success: true, msg: "Updated!" });
});

app.get('/api/admin/config', (req, res) => res.json({ proxyKey: GLOBAL_CONFIG.proxyKey, cookies: GLOBAL_CONFIG.cookies, cooldowns: SERVER_COOLDOWN, proxyState: PROXY_STATE }));
app.get('/api/logs', (req, res) => {
    const { type } = req.query;
    res.json({ logs: type ? BUFF_LOGS[type] : [...BUFF_LOGS.free, ...BUFF_LOGS.vip] });
});

app.post('/api/buff/zefame', async (req, res) => {
    const { username, link } = req.body;
    let targetLink = link || (username ? generateProfileLink(username) : null);
    if (!targetLink) return res.json({ status: false, msg: 'Thiếu link/username' });
    res.json(await buffZefame(targetLink));
});
app.post('/api/buff/tikfames', async (req, res) => {
    if (!req.body.username) return res.json({ status: false });
    res.json(await buffVipSite('tikfames', req.body.username));
});
app.post('/api/buff/tikfollowers', async (req, res) => {
    if (!req.body.username) return res.json({ status: false });
    res.json(await buffVipSite('tikfollowers', req.body.username));
});

app.listen(PORT, () => console.log(`🚀 Server Tiệp Gà Cui running on PORT ${PORT}`));
