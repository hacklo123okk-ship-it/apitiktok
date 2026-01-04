const express = require('express');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { v4: uuidv4 } = require('uuid');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// ==================================================================
// CẤU HÌNH ĐỂ CHẠY FILE TỪ THƯ MỤC GỐC
// ==================================================================
// 1. Trang chủ (index.html)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 2. Trang Admin (admin.html)
app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ==================================================================
// I. CẤU HÌNH HỆ THỐNG (LƯU TRÊN RAM)
// ==================================================================
let GLOBAL_CONFIG = {
    proxyKey: "ulhHONDSmaqepPClsbtMkp", 
    cookies: {
        tikfames: "",      
        tikfollowers: ""   
    }
};

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
// II. API BUFF ZEFAME (FREE)
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

app.post('/api/zefame', async (req, res) => {
    const { link } = req.body;
    if (!link) return res.json({ status: false, msg: 'Thiếu link TikTok' });

    let proxyAddress = null;
    const pData = await getNewProxy();
    
    if (!pData.success) {
        return res.json({ 
            status: false, 
            code: 'PROXY_WAIT', 
            msg: pData.msg, 
            wait_seconds: pData.wait || 30 
        });
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
            return res.json({ status: true, msg: 'Buff thành công!', proxy: proxyAddress, data: data });
        } else if (textRes.includes('wait') || textRes.includes('indisponible')) {
            return res.json({ status: false, code: 'RATE_LIMIT', msg: 'Rate Limit (Chờ 12 phút)', wait_seconds: 720 });
        } else {
            return res.json({ status: false, msg: 'Lỗi API Zefame', raw: data });
        }

    } catch (e) {
        return res.json({ status: false, msg: 'Lỗi Request: ' + e.message });
    }
});

// ==================================================================
// III. API BUFF VIP (TikFames / TikFollowers)
// ==================================================================
const VIP_SITES = {
    tikfames: {
        search: "https://tikfames.com/api/search",
        process: "https://tikfames.com/api/process",
        origin: "https://tikfames.com"
    },
    tikfollowers: {
        search: "https://tikfollowers.com/api/search",
        process: "https://tikfollowers.com/api/process",
        origin: "https://tikfollowers.com"
    }
};

app.post('/api/vip/buff', async (req, res) => {
    let { site, username, cookie } = req.body; 

    if (!VIP_SITES[site]) return res.json({ status: false, msg: 'Site không hợp lệ' });
    
    if (!cookie) {
        cookie = GLOBAL_CONFIG.cookies[site];
        if (!cookie) return res.json({ status: false, msg: `Server chưa có cookie cho ${site}. Vào Admin thêm đi!` });
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
                return res.json({ status: false, code: 'COOKIE_DIE', msg: 'Cookie đã chết!' });
            }
            return res.json({ status: false, msg: res1.data.message || 'Lỗi tìm user' });
        }

        await new Promise(r => setTimeout(r, 2000)); 
        const processPayload = { ...res1.data };
        processPayload.type = (site === 'tikfollowers') ? "followers" : "follow";
        if (site === 'tikfames') processPayload.recaptchaToken = searchPayload.recaptchaToken;

        const res2 = await axios.post(cfg.process, processPayload, { headers, timeout: 15000 });
        const msg = (res2.data.message || "").toLowerCase();

        if (res2.data.success) {
            return res.json({ status: true, msg: 'Buff VIP thành công!', data: res2.data });
        } else if (msg.includes('wait') || msg.includes('minute')) {
            const match = msg.match(/(\d+)\s*(?:minute)/);
            return res.json({ status: false, code: 'RATE_LIMIT', wait_minutes: match ? match[1] : 30, msg: msg });
        } else {
            return res.json({ status: false, msg: 'Lỗi Process', raw: res2.data });
        }

    } catch (e) {
        return res.json({ status: false, msg: 'Lỗi Server VIP: ' + e.message });
    }
});

// ==================================================================
// IV. ADMIN PANEL API
// ==================================================================
app.get('/api/admin/config', (req, res) => {
    res.json({
        proxyKey: GLOBAL_CONFIG.proxyKey,
        cookies: {
            tikfames: GLOBAL_CONFIG.cookies.tikfames ? "Live (Đã lưu)" : "Empty",
            tikfollowers: GLOBAL_CONFIG.cookies.tikfollowers ? "Live (Đã lưu)" : "Empty"
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
    res.json({ success: false, msg: "Sai tham số" });
});

// ==================================================================
// V. KEEP-ALIVE
// ==================================================================
app.get('/ping', (req, res) => res.send('Pong!'));

function keepAlive() {
    const url = process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL}/ping` : `http://localhost:${PORT}/ping`;
    axios.get(url).catch(() => {});
}
setInterval(keepAlive, 10 * 60 * 1000);

app.listen(PORT, () => {
    console.log(`✅ Server running on PORT ${PORT}`);
    setTimeout(keepAlive, 5000);
});
