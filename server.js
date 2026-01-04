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
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/logs.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'logs.html'));
});

// ==================================================================
// I. CẤU HÌNH HỆ THỐNG VÀ LOGGING
// ==================================================================
let GLOBAL_CONFIG = {
    proxyKey: "", // Key Proxy chỉ dùng cho Zefame
    cookies: {
        tikfames: "",      
        tikfollowers: ""   
    }
};

// Biến lưu log
let BUFF_LOGS = {
    free: [],
    vip: []
};
const MAX_LOG_ENTRIES = 100;

function addLog(type, data) {
    const logEntry = {
        id: Date.now() + Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        time_display: new Date().toLocaleTimeString('vi-VN'),
        type: type,
        ...data
    };
    BUFF_LOGS[type].unshift(logEntry);
    if (BUFF_LOGS[type].length > MAX_LOG_ENTRIES) BUFF_LOGS[type].pop();
    console.log(`📝 [${type.toUpperCase()}] ${logEntry.time_display} - ${data.username} - ${data.status ? '✅' : '❌'} ${data.message}`);
    saveLogsToFile();
}

function saveLogsToFile() {
    try {
        fs.writeFileSync('buff-logs.json', JSON.stringify(BUFF_LOGS, null, 2));
    } catch (error) {
        console.error('Lỗi khi lưu log:', error);
    }
}

try {
    if (fs.existsSync('buff-logs.json')) {
        const data = fs.readFileSync('buff-logs.json', 'utf8');
        BUFF_LOGS = JSON.parse(data);
    }
} catch (error) {}

// Biến lưu thời gian chờ của từng server
let SERVER_COOLDOWN = {
    zefame: 0,
    tikfames: 0,
    tikfollowers: 0
};

function updateCooldown(server, seconds) {
    SERVER_COOLDOWN[server] = seconds;
    console.log(`⏳ Server ${server} cooldown: ${seconds}s`);
}

setInterval(() => {
    Object.keys(SERVER_COOLDOWN).forEach(server => {
        if (SERVER_COOLDOWN[server] > 0) {
            SERVER_COOLDOWN[server] -= 1;
        }
    });
}, 1000);

function isServerReady(server) {
    return SERVER_COOLDOWN[server] <= 0;
}

function getMaxCooldown() {
    return Math.max(SERVER_COOLDOWN.zefame, SERVER_COOLDOWN.tikfames, SERVER_COOLDOWN.tikfollowers);
}

// Hàm lấy Proxy (CHỈ DÙNG CHO ZEFAME)
async function getNewProxy() {
    try {
        if (!GLOBAL_CONFIG.proxyKey) return { success: false, msg: "Chưa cấu hình Proxy Key trong Admin" };
        
        const url = `https://proxyxoay.shop/api/get.php?key=${GLOBAL_CONFIG.proxyKey}`;
        const response = await axios.get(url, { timeout: 15000 }); // Lấy proxy thì timeout 15s thôi
        const data = response.data;

        if (data.status === 100 && data.proxyhttp) {
             let proxy = data.proxyhttp.replace(/http:\/\/|https:\/\/|::/g, '');
             return { success: true, proxy: proxy };
        }
        if (data.status === 101) {
            const match = data.message.match(/Con (\d+)s/);
            return { success: false, wait: match ? parseInt(match[1]) : 60, msg: data.message };
        }
        return { success: false, wait: 0, msg: data.message || 'Lỗi lấy proxy không xác định' };
    } catch (e) {
        return { success: false, msg: e.message };
    }
}

// ==================================================================
// II. API BUFF ZEFAME (CÓ PROXY + KHÔNG TIMEOUT)
// ==================================================================
const ZEFAME_HEADERS = {
    'authority': 'zefame-free.com',
    'accept': 'application/json, text/javascript, */*; q=0.01',
    'origin': 'https://zefame.com',
    'referer': 'https://zefame.com/',
    'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
    'x-requested-with': 'XMLHttpRequest',
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
};

async function buffZefame(link) {
    if (!isServerReady('zefame')) {
        const waitTime = SERVER_COOLDOWN.zefame;
        return { status: false, code: 'COOLDOWN', msg: `Zefame đang chờ ${waitTime}s`, server: 'zefame' };
    }

    // ZEFAME BẮT BUỘC DÙNG PROXY
    const pData = await getNewProxy();
    if (!pData.success) {
        return { status: false, code: 'PROXY_WAIT', msg: "Lỗi Proxy Zefame: " + pData.msg, server: 'zefame' };
    }
    
    const proxyAddress = pData.proxy;
    const httpsAgent = new HttpsProxyAgent(`http://${proxyAddress}`);
    const deviceId = uuidv4();
    const fakeUser = "user_" + Math.random().toString(36).substring(7);

    try {
        console.log(`🔄 Zefame đang chạy qua Proxy: ${proxyAddress} (No Timeout)`);
        
        const params = new URLSearchParams();
        params.append('service', '228');
        params.append('link', link);
        params.append('uuid', deviceId);
        params.append('username', fakeUser);

        // TIMEOUT = 0 (Chờ vô hạn)
        const response = await axios.post('https://zefame-free.com/api_free.php?action=order', params, {
            headers: ZEFAME_HEADERS,
            httpsAgent: httpsAgent,
            timeout: 0 
        });

        const data = response.data;
        const textRes = JSON.stringify(data).toLowerCase();

        if (textRes.includes('success') && textRes.includes('true')) {
            return { status: true, msg: 'Buff Zefame thành công!', data: data, server: 'zefame' };
        } else if (textRes.includes('wait') || textRes.includes('indisponible')) {
            updateCooldown('zefame', 720);
            return { status: false, code: 'RATE_LIMIT', msg: `Zefame bắt chờ 12 phút`, server: 'zefame' };
        } else {
            return { status: false, msg: 'Lỗi API Zefame', raw: data, server: 'zefame' };
        }

    } catch (e) {
        return { status: false, msg: 'Lỗi Zefame: ' + e.message, server: 'zefame' };
    }
}

// ==================================================================
// III. API BUFF VIP (TIKFAMES/TIKFOLLOWERS) 
// KHÔNG PROXY + KHÔNG TIMEOUT
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

async function buffVipSite(site, username, cookie = null) {
    if (!VIP_SITES[site]) return { status: false, msg: 'Site không hợp lệ', server: site };
    const serverName = VIP_SITES[site].serverName;
    
    if (!isServerReady(serverName)) {
        return { status: false, code: 'COOLDOWN', msg: `${serverName} chờ ${SERVER_COOLDOWN[serverName]}s`, server: serverName };
    }
    
    if (!cookie) {
        cookie = GLOBAL_CONFIG.cookies[site];
        if (!cookie) return { status: false, msg: `Thiếu cookie ${site}`, server: serverName };
    }

    const cfg = VIP_SITES[site];
    const cleanUser = username.replace('@', '');
    
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Content-Type': 'application/json',
        'Origin': cfg.origin,
        'Cookie': cookie
    };

    try {
        console.log(`🚀 ${serverName} đang chạy IP GỐC (No Timeout)...`);

        const searchPayload = { input: cleanUser, type: "getUserDetails" };
        if (site === 'tikfames') searchPayload.recaptchaToken = "fake_" + Math.random().toString(36);

        // REQUEST 1: TÌM USER - TIMEOUT = 0 (Vô hạn)
        const res1 = await axios.post(cfg.search, searchPayload, { 
            headers, 
            timeout: 0 
        });
        
        if (!res1.data.success) {
            if (JSON.stringify(res1.data).includes('login')) {
                return { status: false, code: 'COOKIE_DIE', msg: 'Cookie chết!', server: serverName };
            }
            return { status: false, msg: res1.data.message || 'Không tìm thấy user', server: serverName };
        }

        await new Promise(r => setTimeout(r, 2000)); 

        const processPayload = { ...res1.data };
        processPayload.type = (site === 'tikfollowers') ? "followers" : "follow";
        if (site === 'tikfames') processPayload.recaptchaToken = searchPayload.recaptchaToken;

        // REQUEST 2: BUFF - TIMEOUT = 0 (Vô hạn)
        const res2 = await axios.post(cfg.process, processPayload, { 
            headers, 
            timeout: 0 
        });
        
        const msg = (res2.data.message || "").toLowerCase();

        if (res2.data.success) {
            return { status: true, msg: `✅ ${serverName} OK!`, data: res2.data, server: serverName };
        } else if (msg.includes('wait') || msg.includes('minute')) {
            let waitMinutes = 30;
            const minuteMatch = msg.match(/(\d+)\s*(?:minute|phút)/i);
            const secondMatch = msg.match(/(\d+)\s*(?:second|giây)/i);
            if (minuteMatch) waitMinutes = parseInt(minuteMatch[1]);
            else if (secondMatch) waitMinutes = Math.ceil(parseInt(secondMatch[1]) / 60);
            
            updateCooldown(serverName, waitMinutes * 60);
            return { status: false, code: 'RATE_LIMIT', msg: `${serverName} chờ ${waitMinutes}p`, server: serverName };
        } else {
            return { status: false, msg: 'Lỗi: ' + msg, raw: res2.data, server: serverName };
        }

    } catch (e) {
        return { status: false, msg: `Lỗi kết nối ${serverName}: ${e.message}`, server: serverName };
    }
}

// ==================================================================
// IV. HÀM XỬ LÝ BUFF ĐỒNG BỘ
// ==================================================================
async function buffAllServers(username, link = null, isVip = false) {
    const results = [];
    const serversToBuff = isVip 
        ? ['zefame', 'tikfames', 'tikfollowers']
        : ['tikfames', 'tikfollowers'];
    
    // Bỏ qua check cooldown tổng, cứ chạy từng cái
    for (const server of serversToBuff) {
        let result;
        if (server === 'zefame' && link) {
            result = await buffZefame(link);
        } else if (server === 'tikfames' || server === 'tikfollowers') {
            result = await buffVipSite(server, username);
        } else {
            continue;
        }
        results.push(result);
        
        // Nghỉ 1s giữa các server
        if (server !== serversToBuff[serversToBuff.length - 1]) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    const successCount = results.filter(r => r.status === true).length;
    return {
        status: successCount > 0,
        msg: `${isVip ? 'VIP' : 'Free'} Buff: ${successCount}/${results.length} thành công`,
        details: results
    };
}

// ==================================================================
// V. ENDPOINTS
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
    if (!link && !username) return res.json({ status: false, msg: 'Thiếu info' });
    const result = await buffAllServers(username, link, true);
    addLog('vip', { username, link: link||'', status: result.status, message: result.msg, details: result.details });
    res.json(result);
});

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

// Admin APIs
app.get('/api/admin/config', (req, res) => {
    res.json({
        proxyKey: GLOBAL_CONFIG.proxyKey,
        cookies: {
            tikfames: GLOBAL_CONFIG.cookies.tikfames ? "OK" : "Empty",
            tikfollowers: GLOBAL_CONFIG.cookies.tikfollowers ? "OK" : "Empty"
        },
        cooldowns: SERVER_COOLDOWN
    });
});

app.post('/api/admin/update', (req, res) => {
    const { type, value, site } = req.body;
    if (type === 'proxy') {
        GLOBAL_CONFIG.proxyKey = value.trim();
        return res.json({ success: true, msg: "Updated Proxy Key!" });
    }
    if (type === 'cookie' && VIP_SITES[site]) {
        GLOBAL_CONFIG.cookies[site] = value.trim();
        return res.json({ success: true, msg: `Updated Cookie ${site}!` });
    }
    if (type === 'reset_cooldown') {
        SERVER_COOLDOWN[value] = 0;
        return res.json({ success: true, msg: `Reset ${value}!` });
    }
    res.json({ success: false, msg: "Sai tham số" });
});

app.get('/api/servers/status', (req, res) => {
    res.json({
        servers: {
            zefame: { ready: isServerReady('zefame'), cooldown: SERVER_COOLDOWN.zefame },
            tikfames: { ready: isServerReady('tikfames'), cooldown: SERVER_COOLDOWN.tikfames },
            tikfollowers: { ready: isServerReady('tikfollowers'), cooldown: SERVER_COOLDOWN.tikfollowers }
        }
    });
});

// Ping
app.get('/ping', (req, res) => res.send('Pong!'));
function keepAlive() {
    const url = process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL}/ping` : `http://localhost:${PORT}/ping`;
    axios.get(url).catch(() => {});
}
setInterval(keepAlive, 10 * 60 * 1000);

app.listen(PORT, () => {
    console.log(`✅ Server running PORT ${PORT} | No Timeout Mode`);
    console.log(`- Zefame: PROXY ON`);
    console.log(`- TikFames/TikFollowers: PROXY OFF`);
});
