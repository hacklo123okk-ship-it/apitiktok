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

// Thêm route cho trang log
app.get('/logs.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'logs.html'));
});

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

// Biến lưu log
let BUFF_LOGS = {
    free: [],  // Log cho API free
    vip: []    // Log cho API vip
};
const MAX_LOG_ENTRIES = 100; // Giới hạn số log tối đa

// Hàm thêm log
function addLog(type, data) {
    const logEntry = {
        id: Date.now() + Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        time_display: new Date().toLocaleTimeString('vi-VN'),
        type: type, // 'free' hoặc 'vip'
        ...data
    };

    // Thêm vào đầu mảng
    BUFF_LOGS[type].unshift(logEntry);
    
    // Giới hạn số log
    if (BUFF_LOGS[type].length > MAX_LOG_ENTRIES) {
        BUFF_LOGS[type].pop();
    }

    console.log(`📝 [${type.toUpperCase()}] ${logEntry.time_display} - ${data.username} - ${data.status ? '✅' : '❌'} ${data.message}`);
    
    // Lưu log vào file (optional)
    saveLogsToFile();
}

// Hàm lưu log vào file
function saveLogsToFile() {
    try {
        fs.writeFileSync('buff-logs.json', JSON.stringify(BUFF_LOGS, null, 2));
    } catch (error) {
        console.error('Lỗi khi lưu log:', error);
    }
}

// Đọc log từ file khi khởi động
try {
    if (fs.existsSync('buff-logs.json')) {
        const data = fs.readFileSync('buff-logs.json', 'utf8');
        BUFF_LOGS = JSON.parse(data);
        console.log(`📂 Đã tải ${BUFF_LOGS.free.length + BUFF_LOGS.vip.length} log từ file`);
    }
} catch (error) {
    console.log('Không đọc được file log, bắt đầu mới');
}

// Biến lưu thời gian chờ của từng server
let SERVER_COOLDOWN = {
    zefame: 0,
    tikfames: 0,
    tikfollowers: 0
};

// Hàm cập nhật thời gian chờ
function updateCooldown(server, seconds) {
    SERVER_COOLDOWN[server] = seconds;
    console.log(`⏳ Server ${server} cooldown: ${seconds}s`);
}

// Hàm giảm thời gian chờ mỗi giây
setInterval(() => {
    Object.keys(SERVER_COOLDOWN).forEach(server => {
        if (SERVER_COOLDOWN[server] > 0) {
            SERVER_COOLDOWN[server] -= 1;
        }
    });
}, 1000);

// Kiểm tra server có sẵn sàng không
function isServerReady(server) {
    return SERVER_COOLDOWN[server] <= 0;
}

// Lấy thời gian chờ lớn nhất giữa các server
function getMaxCooldown() {
    return Math.max(
        SERVER_COOLDOWN.zefame,
        SERVER_COOLDOWN.tikfames,
        SERVER_COOLDOWN.tikfollowers
    );
}

async function getNewProxy() {
    try {
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
        return { success: false, wait: 0, msg: data.message || 'Lỗi không xác định' };
    } catch (e) {
        return { success: false, msg: e.message };
    }
}

// ==================================================================
// II. API BUFF ZEFAME
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
        return { 
            status: false, 
            code: 'COOLDOWN', 
            msg: `Zefame đang chờ ${waitTime}s`,
            wait_seconds: waitTime,
            server: 'zefame'
        };
    }

    let proxyAddress = null;
    const pData = await getNewProxy();
    
    if (!pData.success) {
        return { 
            status: false, 
            code: 'PROXY_WAIT', 
            msg: pData.msg, 
            wait_seconds: pData.wait || 30,
            server: 'zefame'
        };
    }
    proxyAddress = pData.proxy;

    const proxyUrl = `http://${proxyAddress}`;
    const httpsAgent = new HttpsProxyAgent(proxyUrl);
    const deviceId = uuidv4();
    const fakeUser = "user_" + Math.random().toString(36).substring(7);

    try {
        const params = new URLSearchParams();
        params.append('service', '228');
        params.append('link', link);
        params.append('uuid', deviceId);
        params.append('username', fakeUser);

        const response = await axios.post('https://zefame-free.com/api_free.php?action=order', params, {
            headers: ZEFAME_HEADERS,
            httpsAgent: httpsAgent,
            timeout: 15000
        });

        const data = response.data;
        const textRes = JSON.stringify(data).toLowerCase();

        if (textRes.includes('success') && textRes.includes('true')) {
            return { 
                status: true, 
                msg: 'Buff Zefame thành công!', 
                proxy: proxyAddress, 
                data: data,
                server: 'zefame'
            };
        } else if (textRes.includes('wait') || textRes.includes('indisponible')) {
            const waitTime = 720;
            updateCooldown('zefame', waitTime);
            return { 
                status: false, 
                code: 'RATE_LIMIT', 
                msg: `Zefame: Rate Limit (Chờ ${Math.floor(waitTime/60)} phút)`, 
                wait_seconds: waitTime,
                server: 'zefame'
            };
        } else {
            return { 
                status: false, 
                msg: 'Lỗi API Zefame', 
                raw: data,
                server: 'zefame'
            };
        }

    } catch (e) {
        return { 
            status: false, 
            msg: 'Lỗi Request Zefame: ' + e.message,
            server: 'zefame'
        };
    }
}

// ==================================================================
// III. API BUFF VIP (TikFames / TikFollowers)
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
    if (!VIP_SITES[site]) {
        return { status: false, msg: 'Site không hợp lệ', server: site };
    }

    const serverName = VIP_SITES[site].serverName;
    
    if (!isServerReady(serverName)) {
        const waitTime = SERVER_COOLDOWN[serverName];
        return { 
            status: false, 
            code: 'COOLDOWN', 
            msg: `${serverName} đang chờ ${waitTime}s`,
            wait_seconds: waitTime,
            server: serverName
        };
    }
    
    if (!cookie) {
        cookie = GLOBAL_CONFIG.cookies[site];
        if (!cookie) {
            return { status: false, msg: `Server chưa có cookie cho ${site}. Vào Admin thêm đi!`, server: serverName };
        }
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
        const searchPayload = { input: cleanUser, type: "getUserDetails" };
        if (site === 'tikfames') searchPayload.recaptchaToken = "fake_" + Math.random().toString(36);

        const res1 = await axios.post(cfg.search, searchPayload, { headers, timeout: 10000 });
        
        if (!res1.data.success) {
            if (JSON.stringify(res1.data).includes('login')) {
                return { status: false, code: 'COOKIE_DIE', msg: 'Cookie đã chết!', server: serverName };
            }
            return { status: false, msg: res1.data.message || 'Lỗi tìm user', server: serverName };
        }

        await new Promise(r => setTimeout(r, 2000)); 
        const processPayload = { ...res1.data };
        processPayload.type = (site === 'tikfollowers') ? "followers" : "follow";
        if (site === 'tikfames') processPayload.recaptchaToken = searchPayload.recaptchaToken;

        const res2 = await axios.post(cfg.process, processPayload, { headers, timeout: 15000 });
        const msg = (res2.data.message || "").toLowerCase();

        if (res2.data.success) {
            return { 
                status: true, 
                msg: `Buff ${serverName} thành công!`, 
                data: res2.data,
                server: serverName
            };
        } else if (msg.includes('wait') || msg.includes('minute')) {
            let waitMinutes = 30;
            const minuteMatch = msg.match(/(\d+)\s*(?:minute|phút)/i);
            const secondMatch = msg.match(/(\d+)\s*(?:second|giây)/i);
            
            if (minuteMatch) {
                waitMinutes = parseInt(minuteMatch[1]);
            } else if (secondMatch) {
                waitMinutes = Math.ceil(parseInt(secondMatch[1]) / 60);
            }
            
            const waitSeconds = waitMinutes * 60;
            updateCooldown(serverName, waitSeconds);
            
            return { 
                status: false, 
                code: 'RATE_LIMIT', 
                msg: `${serverName}: Rate Limit (Chờ ${waitMinutes} phút)`, 
                wait_seconds: waitSeconds,
                server: serverName
            };
        } else {
            return { status: false, msg: 'Lỗi Process', raw: res2.data, server: serverName };
        }

    } catch (e) {
        return { status: false, msg: 'Lỗi Server VIP: ' + e.message, server: serverName };
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
    
    const maxCooldown = getMaxCooldown();
    
    if (maxCooldown > 0) {
        return {
            status: false,
            code: 'ALL_COOLDOWN',
            msg: `Tất cả servers đang chờ ${maxCooldown}s`,
            wait_seconds: maxCooldown,
            cooldowns: { ...SERVER_COOLDOWN },
            details: serversToBuff.map(server => ({
                server,
                wait: SERVER_COOLDOWN[server],
                ready: isServerReady(server)
            }))
        };
    }

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
        
        if (result.code === 'RATE_LIMIT' || result.code === 'COOLDOWN') {
            const waitTime = result.wait_seconds || 60;
            serversToBuff.forEach(s => {
                if (SERVER_COOLDOWN[s] < waitTime) {
                    updateCooldown(s, waitTime);
                }
            });
            
            return {
                status: false,
                code: 'PARTIAL_COOLDOWN',
                msg: `Server ${result.server} bị rate limit, tất cả servers chờ ${waitTime}s`,
                wait_seconds: waitTime,
                completed: results.filter(r => r.status).length,
                total: serversToBuff.length,
                blocking_server: result.server,
                details: results
            };
        }
        
        if (server !== serversToBuff[serversToBuff.length - 1]) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    const successCount = results.filter(r => r.status === true).length;
    
    return {
        status: successCount > 0,
        msg: `${isVip ? 'VIP' : 'Free'} Buff: ${successCount}/${results.length} thành công`,
        total: results.length,
        success: successCount,
        failed: results.length - successCount,
        cooldowns: { ...SERVER_COOLDOWN },
        details: results
    };
}

// ==================================================================
// V. ENDPOINT FREE (CHỈ DÙNG 2 API VIP)
// ==================================================================
app.post('/api/free/buff', async (req, res) => {
    const { username } = req.body;
    
    if (!username) {
        return res.json({ status: false, msg: 'Thiếu username TikTok' });
    }

    const result = await buffAllServers(username, null, false);
    
    // Thêm log
    addLog('free', {
        username: username,
        status: result.status,
        message: result.msg,
        success_count: result.success || 0,
        total_servers: result.total || 2,
        details: result.details || [],
        wait_time: result.wait_seconds || 0
    });
    
    res.json(result);
});

// ==================================================================
// VI. ENDPOINT VIP/PAID (DÙNG CẢ 3 API)
// ==================================================================
app.post('/api/vip/buff', async (req, res) => {
    const { link, username } = req.body;
    
    if (!link && !username) {
        return res.json({ status: false, msg: 'Thiếu link hoặc username TikTok' });
    }

    const result = await buffAllServers(username, link, true);
    
    // Thêm log
    addLog('vip', {
        username: username,
        link: link || 'Không có link',
        status: result.status,
        message: result.msg,
        success_count: result.success || 0,
        total_servers: result.total || 3,
        details: result.details || [],
        wait_time: result.wait_seconds || 0
    });
    
    res.json(result);
});

// ==================================================================
// VII. ENDPOINT RIÊNG CHO TỪNG SERVICE
// ==================================================================
app.post('/api/buff/zefame', async (req, res) => {
    const { link, username } = req.body;
    if (!link) return res.json({ status: false, msg: 'Thiếu link TikTok' });
    
    if (!isServerReady('zefame')) {
        const waitTime = SERVER_COOLDOWN.zefame;
        return res.json({
            status: false,
            code: 'COOLDOWN',
            msg: `Zefame đang chờ ${waitTime}s`,
            wait_seconds: waitTime,
            server: 'zefame'
        });
    }
    
    const result = await buffZefame(link);
    res.json(result);
});

app.post('/api/buff/tikfames', async (req, res) => {
    const { username } = req.body;
    if (!username) return res.json({ status: false, msg: 'Thiếu username TikTok' });
    
    if (!isServerReady('tikfames')) {
        const waitTime = SERVER_COOLDOWN.tikfames;
        return res.json({
            status: false,
            code: 'COOLDOWN',
            msg: `TikFames đang chờ ${waitTime}s`,
            wait_seconds: waitTime,
            server: 'tikfames'
        });
    }
    
    const result = await buffVipSite('tikfames', username);
    res.json(result);
});

app.post('/api/buff/tikfollowers', async (req, res) => {
    const { username } = req.body;
    if (!username) return res.json({ status: false, msg: 'Thiếu username TikTok' });
    
    if (!isServerReady('tikfollowers')) {
        const waitTime = SERVER_COOLDOWN.tikfollowers;
        return res.json({
            status: false,
            code: 'COOLDOWN',
            msg: `TikFollowers đang chờ ${waitTime}s`,
            wait_seconds: waitTime,
            server: 'tikfollowers'
        });
    }
    
    const result = await buffVipSite('tikfollowers', username);
    res.json(result);
});

// ==================================================================
// VIII. API LẤY LOG
// ==================================================================
app.get('/api/logs', (req, res) => {
    const { type, limit } = req.query;
    let logs = [];
    
    if (type === 'free') {
        logs = BUFF_LOGS.free;
    } else if (type === 'vip') {
        logs = BUFF_LOGS.vip;
    } else {
        // Lấy tất cả log, gộp và sort theo thời gian
        logs = [...BUFF_LOGS.free, ...BUFF_LOGS.vip]
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }
    
    // Giới hạn số lượng log
    const logLimit = parseInt(limit) || 50;
    const limitedLogs = logs.slice(0, logLimit);
    
    res.json({
        success: true,
        count: limitedLogs.length,
        total_free: BUFF_LOGS.free.length,
        total_vip: BUFF_LOGS.vip.length,
        logs: limitedLogs
    });
});

// Xóa log
app.delete('/api/logs', (req, res) => {
    const { type } = req.body;
    
    if (type === 'free') {
        BUFF_LOGS.free = [];
        res.json({ success: true, msg: 'Đã xóa tất cả log free' });
    } else if (type === 'vip') {
        BUFF_LOGS.vip = [];
        res.json({ success: true, msg: 'Đã xóa tất cả log vip' });
    } else {
        BUFF_LOGS.free = [];
        BUFF_LOGS.vip = [];
        res.json({ success: true, msg: 'Đã xóa tất cả log' });
    }
    
    saveLogsToFile();
});

// ==================================================================
// IX. ENDPOINT KIỂM TRA TRẠNG THÁI SERVERS
// ==================================================================
app.get('/api/servers/status', (req, res) => {
    res.json({
        timestamp: new Date().toISOString(),
        servers: {
            zefame: {
                ready: isServerReady('zefame'),
                cooldown: SERVER_COOLDOWN.zefame,
                message: SERVER_COOLDOWN.zefame > 0 
                    ? `Chờ ${SERVER_COOLDOWN.zefame}s` 
                    : 'Sẵn sàng'
            },
            tikfames: {
                ready: isServerReady('tikfames'),
                cooldown: SERVER_COOLDOWN.tikfames,
                message: SERVER_COOLDOWN.tikfames > 0 
                    ? `Chờ ${SERVER_COOLDOWN.tikfames}s` 
                    : 'Sẵn sàng'
            },
            tikfollowers: {
                ready: isServerReady('tikfollowers'),
                cooldown: SERVER_COOLDOWN.tikfollowers,
                message: SERVER_COOLDOWN.tikfollowers > 0 
                    ? `Chờ ${SERVER_COOLDOWN.tikfollowers}s` 
                    : 'Sẵn sàng'
            }
        },
        max_cooldown: getMaxCooldown(),
        all_ready: getMaxCooldown() <= 0,
        log_stats: {
            free_logs: BUFF_LOGS.free.length,
            vip_logs: BUFF_LOGS.vip.length
        }
    });
});

// ==================================================================
// X. ADMIN PANEL API
// ==================================================================
app.get('/api/admin/config', (req, res) => {
    res.json({
        proxyKey: GLOBAL_CONFIG.proxyKey,
        cookies: {
            tikfames: GLOBAL_CONFIG.cookies.tikfames ? "Live (Đã lưu)" : "Empty",
            tikfollowers: GLOBAL_CONFIG.cookies.tikfollowers ? "Live (Đã lưu)" : "Empty"
        },
        cooldowns: SERVER_COOLDOWN,
        log_stats: {
            free: BUFF_LOGS.free.length,
            vip: BUFF_LOGS.vip.length
        },
        endpoints: {
            free: '/api/free/buff (chỉ 2 API VIP)',
            vip: '/api/vip/buff (3 API: Zefame + 2 VIP)',
            individual: '/api/buff/:service',
            status: '/api/servers/status',
            logs: '/api/logs',
            logs_page: '/logs.html'
        }
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
    if (type === 'reset_cooldown' && SERVER_COOLDOWN[value] !== undefined) {
        SERVER_COOLDOWN[value] = 0;
        return res.json({ success: true, msg: `Reset cooldown ${value}!` });
    }
    res.json({ success: false, msg: "Sai tham số" });
});

// ==================================================================
// XI. KEEP-ALIVE & HEALTH CHECK
// ==================================================================
app.get('/ping', (req, res) => res.send('Pong!'));

app.get('/status', (req, res) => {
    res.json({
        status: 'running',
        server_time: new Date().toISOString(),
        cooldowns: SERVER_COOLDOWN,
        log_stats: {
            free: BUFF_LOGS.free.length,
            vip: BUFF_LOGS.vip.length
        },
        endpoints: [
            { path: '/api/free/buff', method: 'POST', desc: 'Free - chỉ 2 API VIP' },
            { path: '/api/vip/buff', method: 'POST', desc: 'VIP - cả 3 API' },
            { path: '/api/buff/zefame', method: 'POST', desc: 'Chỉ Zefame' },
            { path: '/api/buff/tikfames', method: 'POST', desc: 'Chỉ TikFames' },
            { path: '/api/buff/tikfollowers', method: 'POST', desc: 'Chỉ TikFollowers' },
            { path: '/api/servers/status', method: 'GET', desc: 'Kiểm tra trạng thái servers' },
            { path: '/api/logs', method: 'GET', desc: 'Lấy log buff' },
            { path: '/logs.html', method: 'GET', desc: 'Giao diện xem log' }
        ]
    });
});

function keepAlive() {
    const url = process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL}/ping` : `http://localhost:${PORT}/ping`;
    axios.get(url).catch(() => {});
}
setInterval(keepAlive, 10 * 60 * 1000);

app.listen(PORT, () => {
    console.log(`✅ Server running on PORT ${PORT}`);
    console.log(`🔗 Free API: POST /api/free/buff`);
    console.log(`💰 VIP API: POST /api/vip/buff`);
    console.log(`📊 Server Status: GET /api/servers/status`);
    console.log(`📝 Logs Page: /logs.html`);
    console.log(`🔧 Admin: /admin.html`);
    console.log(`📂 Logs loaded: Free(${BUFF_LOGS.free.length}), VIP(${BUFF_LOGS.vip.length})`);
    
    setInterval(() => {
        console.log(`⏳ Cooldowns - Zefame: ${SERVER_COOLDOWN.zefame}s, TikFames: ${SERVER_COOLDOWN.tikfames}s, TikFollowers: ${SERVER_COOLDOWN.tikfollowers}s`);
    }, 30000);
    
    setTimeout(keepAlive, 5000);
});
[file content end]
