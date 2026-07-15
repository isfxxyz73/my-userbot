const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage
} = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const readline = require('readline')
const fs = require('fs')
const path = require('path')
const { execSync, exec, spawn } = require('child_process')
const os = require('os')

require('dotenv').config()
// Pastikan NO_WA diisi dengan format 628xxxxxxxxxx di file .env
const OWNER_NUMBER = process.env.NO_WA || ''
const DB_DIR = path.join(__dirname, 'db')
const DB_AFK    = path.join(DB_DIR, 'afk.json')
const DB_WHITE  = path.join(DB_DIR, 'whitelist.json')
const DB_SPAM   = path.join(DB_DIR, 'spam.json')

const SPAM_LIMIT  = 5
const SPAM_WINDOW = 10000
const TEMP_MUTE_DURATION = 300

const REPLY_DELAY_MIN = 1200
const REPLY_DELAY_MAX = 3500

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true })

function loadDB(p, def = {}) {
    try {
        if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'))
    } catch (_) {}
    return def
}

function saveDB(p, data) {
    try { fs.writeFileSync(p, JSON.stringify(data, null, 2)) } catch (_) {}
}

let afkData    = loadDB(DB_AFK, {})   
let whitelist  = loadDB(DB_WHITE, [])  
let spamTrack  = loadDB(DB_SPAM, {})  
let tempMute   = {}                  
let afkReplied = {}        
const AFK_REPLY_COOLDOWN = 3 * 60 * 1000 // 3 menit
let pairingRequested = false

// Map untuk melacak pesan yang dikirim oleh bot sendiri agar tidak memicu Auto-UnAFK
const botSentMessages = new Map()

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (text) => new Promise(resolve => rl.question(text, resolve))
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

function humanDelay(min = REPLY_DELAY_MIN, max = REPLY_DELAY_MAX) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min
    return delay(ms)
}

async function sendHuman(sock, jid, content, options = {}) {
    try {
        await sock.sendPresenceUpdate('composing', jid)
        const text = typeof content === 'string' ? content : content.text || content.caption || ''
        const typingTime = Math.min(Math.max(text.length * 30, REPLY_DELAY_MIN), REPLY_DELAY_MAX)
        await delay(typingTime)
        await sock.sendPresenceUpdate('paused', jid)
        await delay(300)

        // Catat pesan yang dikirim oleh bot sendiri agar tidak memicu fromMe (Auto-UnAFK)
        if (text) {
            botSentMessages.set(text.trim(), Date.now())
        }

        return await sock.sendMessage(jid, typeof content === 'string' ? { text: content } : content, options)
    } catch (_) {
        const text = typeof content === 'string' ? content : content.text || content.caption || ''
        if (text) {
            botSentMessages.set(text.trim(), Date.now())
        }
        return await sock.sendMessage(jid, typeof content === 'string' ? { text: content } : content, options)
    }
}

function getOwnerJid() {
    return OWNER_NUMBER.replace(/[^0-9]/g, '') + '@s.whatsapp.net'
}

function normalizeJid(jid) {
    return jid?.replace(/:[0-9]+(@)/, '$1') || jid
}

function getAfkDuration(since) {
    const diff = Math.floor((Date.now() / 1000) - since)
    if (diff < 60) return `${diff} detik`
    const m = Math.floor(diff / 60)
    if (m < 60) return `${m} menit`
    const h = Math.floor(m / 60); const rm = m % 60
    if (h < 24) return `${h} jam ${rm} menit`
    const d = Math.floor(h / 24); const rh = h % 24
    return `${d} hari ${rh} jam`
}

function getSystemInfo() {
    const mem = os.totalmem()
    const freeMem = os.freemem()
    const usedMem = mem - freeMem
    const memPct = ((usedMem / mem) * 100).toFixed(1)

    let cpu = 'Unknown'
    let disk = 'Unknown'
    let distro = os.type()
    let uptime = ''

    try { cpu = execSync("grep -m1 'model name' /proc/cpuinfo | cut -d: -f2").toString().trim() } catch (_) {}
    try { distro = execSync('lsb_release -ds').toString().trim().replace(/"/g, '') } catch (_) {}
    try {
        const raw = execSync('uptime -p').toString().trim().replace('up ', '')
        uptime = raw
    } catch (_) { uptime = `${Math.floor(os.uptime() / 3600)} jam` }
    try {
        const df = execSync("df -h / | tail -1").toString().trim().split(/\s+/)
        disk = `Total: ${df[1]} | Used: ${df[2]} (${df[4]}) | Free: ${df[3]}`
    } catch (_) {}

    return (
        `🚀 *AKASHA SYSTEM INFO*\n\n` +
        `🖥️ *CPU:* \`${cpu}\`\n` +
        `🐧 *OS:* \`${distro}\`\n` +
        `⏱️ *Uptime:* \`${uptime}\`\n\n` +
        `💾 *RAM:*\n` +
        `  • Total: \`${(mem / 1024 ** 3).toFixed(2)} GB\`\n` +
        `  • Used: \`${(usedMem / 1024 ** 3).toFixed(2)} GB (${memPct}%)\`\n` +
        `  • Free: \`${(freeMem / 1024 ** 3).toFixed(2)} GB\`\n\n` +
        `🗄️ *Disk:* \`${disk}\``
    )
}

function formatMbps(value) {
    return `${Number(value).toFixed(2)} Mbps`
}

function parseSpeedtestResult(raw) {
    const data = JSON.parse(raw)

    if (data.download?.bandwidth || data.upload?.bandwidth) {
        const download = ((data.download?.bandwidth || 0) * 8) / 1000000
        const upload = ((data.upload?.bandwidth || 0) * 8) / 1000000
        const ping = data.ping?.latency ?? 0
        const server = data.server?.name || data.server?.location || 'Unknown'
        const isp = data.isp || 'Unknown'

        return `*SPEEDTEST RESULT*\n\n` +
            `Download: \`${formatMbps(download)}\`\n` +
            `Upload: \`${formatMbps(upload)}\`\n` +
            `Ping: \`${Number(ping).toFixed(2)} ms\`\n` +
            `Server: \`${server}\`\n` +
            `ISP: \`${isp}\``
    }

    const download = (data.download || 0) / 1000000
    const upload = (data.upload || 0) / 1000000
    const ping = data.ping || 0
    const server = data.server?.name || data.server?.sponsor || 'Unknown'
    const isp = data.client?.isp || 'Unknown'

    return `*SPEEDTEST RESULT*\n\n` +
        `Download: \`${formatMbps(download)}\`\n` +
        `Upload: \`${formatMbps(upload)}\`\n` +
        `Ping: \`${Number(ping).toFixed(2)} ms\`\n` +
        `Server: \`${server}\`\n` +
        `ISP: \`${isp}\``
}

function runSpeedtestCommand(command) {
    return new Promise((resolve, reject) => {
        exec(command, { timeout: 120000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) return reject(new Error(stderr || error.message))
            resolve(stdout)
        })
    })
}

async function getSpeedtestInfo() {
    const commands = [
        'speedtest --accept-license --accept-gdpr -f json',
        'speedtest-cli --json'
    ]

    for (const command of commands) {
        try {
            const raw = await runSpeedtestCommand(command)
            return parseSpeedtestResult(raw)
        } catch (_) {}
    }

    return 'Speedtest belum tersedia di VPS. Install salah satu: `speedtest` atau `speedtest-cli`.'
}

const HELP_TEXT = `🚀 *AKASHA USERBOT - WA EDITION*

*OWNER COMMANDS:*
• \`.ping\` - Cek latensi bot
• \`.afk <alasan>\` - Mode AFK
• \`.approve <nomor>\` - Whitelist PM (628xxx)
• \`.unapprove <nomor>\` - Hapus dari whitelist
• \`.list\` - Lihat whitelist PM
• \`.info\` - Info sistem VPS
• \`.speedtest\` - Menguji koneksi internet
• \`.restart\` - Restart bot
• \`.help\` - Menu ini`

// ─────────────────────────────────────────
//  MAIN BOT
// ─────────────────────────────────────────
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth')

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: require('pino')({ level: 'silent' }) // matiin spam log
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
            console.log('✅ AKASHA WA USERBOT - CONNECTED!')
            console.log('----------------------------------')
        }

        if (connection === 'close') {
            const code = new Boom(lastDisconnect?.error)?.output?.statusCode
            if (code === DisconnectReason.loggedOut) {
                console.log('❌ Logged out! Hapus folder auth dan jalanin ulang.')
                process.exit(1)
            } else {
                console.log(`🔄 Reconnecting... (code: ${code})`)
                startBot()
            }
        }

        if (!sock.authState.creds.registered && !pairingRequested) {
            pairingRequested = true
            const number = await question('📱 Masukkin nomor WA (628xxxxxxxxxx): ')
            await delay(3000)
            try {
                const code = await sock.requestPairingCode(number.trim())
                console.log(`\n🔑 Pairing code: ${code}\n`)
                console.log('Masukkin kode di WA → Linked Devices → Link with phone number\n')
            } catch (e) {
                console.log('❌ Gagal dapat pairing code:', e.message)
            }
        }
    })

    // ── MESSAGE HANDLER ──
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return

        for (const msg of messages) {
            if (!msg.message) continue

            const jid = msg.key.remoteJid
            const senderJid = normalizeJid(msg.key.participant || jid)
            const ownerJid = getOwnerJid()
            const isOwner = senderJid === ownerJid || normalizeJid(jid) === ownerJid
            const fromMe = msg.key.fromMe
            const isGroup = jid.endsWith('@g.us')
            const isPrivate = jid.endsWith('@s.whatsapp.net')

            const text = (
                msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                msg.message?.imageMessage?.caption ||
                msg.message?.videoMessage?.caption || ''
            ).trim()

            const tl = text.toLowerCase()
            const now = Date.now()

            // Bersihkan botSentMessages yang sudah lebih dari 60 detik (memory management)
            for (const [msgText, timestamp] of botSentMessages.entries()) {
                if (now - timestamp > 60000) {
                    botSentMessages.delete(msgText)
                }
            }

            // Jika pesan ini adalah pesan balasan yang baru dikirim oleh bot sendiri, abaikan
            if (fromMe && botSentMessages.has(text)) {
                return
            }

            // ── HANDLER PESAN KELUAR (OWNER COMMANDS) ──
            if (fromMe) {
                // Auto unafk kalau owner ngetik apapun selain .afk dan selain auto-reply bot
                const ownerKey = ownerJid
                if (afkData[ownerKey] && !tl.startsWith('.afk')) {
                    // Proteksi ganda: pastikan bukan teks auto-reply dari bot
                    if (!tl.startsWith('💤') && !tl.startsWith('🙏') && !tl.startsWith("i'm back")) {
                        const { reason, since } = afkData[ownerKey]
                        const dur = getAfkDuration(since)
                        delete afkData[ownerKey]
                        afkReplied = {}
                        saveDB(DB_AFK, afkData)
                        await sendHuman(sock, jid, `I'M BACK NlGGA!!\n⏳ _(Kembali setelah ${dur} AFK - Alasan: ${reason})_`)
                    }
                }

                if (isPrivate && !tl.startsWith('.')) {
                    const chatJid = normalizeJid(jid)
                    if (spamTrack[chatJid]) {
                        delete spamTrack[chatJid]
                        saveDB(DB_SPAM, spamTrack)
                    }
                    tempMute[chatJid] = now / 1000 + TEMP_MUTE_DURATION
                }

                // ── COMMANDS ──
                if (tl === '.ping') {
                    const start = Date.now()
                    await sendHuman(sock, jid, '_Pinging..._', { quoted: msg })
                    const latency = Date.now() - start
                    await sendHuman(sock, jid, `*Pong!!* 🏓\n🚀 \`Latency: ${latency} ms\``)

                } else if (tl.startsWith('.afk')) {
                    const reason = text.slice(4).trim() || 'YNTKTS'
                    afkData[ownerJid] = { reason, since: Math.floor(now / 1000) }
                    saveDB(DB_AFK, afkData)
                    await sendHuman(sock, jid, `💤 *BYE gaiss AFK duluuu!*\nAlasan: ${reason}`)

                } else if (tl.startsWith('.approve')) {
                    const num = text.split(' ')[1]?.replace(/[^0-9]/g, '')
                    if (!num) {
                        await sendHuman(sock, jid, '❌ Format: .approve 628xxxxxxxxxx')
                    } else {
                        const targetJid = num + '@s.whatsapp.net'
                        if (!whitelist.includes(targetJid)) {
                            whitelist.push(targetJid)
                            saveDB(DB_WHITE, whitelist)
                            if (spamTrack[targetJid]) { delete spamTrack[targetJid]; saveDB(DB_SPAM, spamTrack) }
                            if (tempMute[targetJid]) delete tempMute[targetJid]
                        }
                        await sendHuman(sock, jid, `✅ \`${num}\` berhasil di-whitelist!`)
                    }

                } else if (tl.startsWith('.unapprove')) {
                    const num = text.split(' ')[1]?.replace(/[^0-9]/g, '')
                    if (!num) {
                        await sendHuman(sock, jid, '❌ Format: .unapprove 628xxxxxxxxxx')
                    } else {
                        const targetJid = num + '@s.whatsapp.net'
                        whitelist = whitelist.filter(j => j !== targetJid)
                        saveDB(DB_WHITE, whitelist)
                        await sendHuman(sock, jid, `✅ \`${num}\` dihapus dari whitelist.`)
                    }

                } else if (tl === '.list') {
                    const wlList = whitelist.length
                        ? whitelist.map(j => `• \`${j.replace('@s.whatsapp.net', '')}\``).join('\n')
                        : '_Belum ada_'
                    await sendHuman(sock, jid, `📜 *WHITELIST PM:*\n${wlList}`)

                } else if (tl === '.info') {
                    await sendHuman(sock, jid, '_Fetching info..._ ⏳')
                    const info = getSystemInfo()
                    const bannerPath = 'image_banner.png'
                    if (fs.existsSync(bannerPath)) {
                        botSentMessages.set(info.trim(), Date.now())
                        await sock.sendMessage(jid, {
                            image: fs.readFileSync(bannerPath),
                            caption: info
                        })
                    } else {
                        await sendHuman(sock, jid, info)
                    }

                } else if (tl === '.speedtest') {
                    await sendHuman(sock, jid, '_Running speedtest..._ ⏳')
                    const result = await getSpeedtestInfo()
                    await sendHuman(sock, jid, result)

                } else if (tl === '.restart') {
                    await sendHuman(sock, jid, '♻️ _Restarting bot..._ ')
                    await delay(1500)
                    await sendHuman(sock, jid, '♻️ _Restarting now..._ ')
                    await sock.end()
                    spawn(process.execPath, process.argv.slice(1), {
                        detached: true,
                        stdio: 'inherit'
                    }).unref()
                    process.exit(0)

                } else if (tl === '.help') {
                    await sendHuman(sock, jid, HELP_TEXT)
                }

                continue // skip incoming handler untuk pesan owner
            }

            if (!isOwner) {
                const senderKey = normalizeJid(senderJid)
                const isWhitelisted = whitelist.includes(senderKey)
                const isMuted = tempMute[senderKey] && (now / 1000) < tempMute[senderKey]

                // ── ANTI SPAM (PM only) ──
                if (isPrivate) {
                    if (!spamTrack[senderKey]) {
                        spamTrack[senderKey] = { count: 1, lastTime: now }
                    } else {
                        const d = spamTrack[senderKey]
                        if (now - d.lastTime > SPAM_WINDOW) {
                            d.count = 1; d.lastTime = now
                        } else {
                            d.count++
                        }
                        spamTrack[senderKey] = d
                        saveDB(DB_SPAM, spamTrack)

                        if (d.count >= SPAM_LIMIT && !isWhitelisted) {
                            await sendHuman(sock, jid, '🚫 *Limit chat PM tercapai. Lo di-block.*', { quoted: msg })
                            // block user
                            try {
                                await sock.updateBlockStatus(senderJid, 'block')
                            } catch (_) {}
                            continue
                        }
                    }
                }

                // ── AFK HANDLER ──
                const ownerKey = ownerJid
                if (afkData[ownerKey]) {
                    const { reason, since } = afkData[ownerKey]
                    const dur = getAfkDuration(since)

                    if (isPrivate) {
                        if (isWhitelisted) {
                            const replyKey = senderKey
                            if (now - (afkReplied[replyKey] || 0) >= AFK_REPLY_COOLDOWN) {
                                afkReplied[replyKey] = now
                                await sendHuman(sock, jid, `💤 *Bentar yaa lagi AFK!*\nAlasan: ${reason}\n⏳ _(Sejak ${dur} yang lalu)_`, { quoted: msg })
                            }
                        } else if (!isMuted) {
                            // Beri peringatan PM belum di-approve dengan jeda 30 detik agar tidak flood
                            const replyKey = senderKey
                            if (now - (afkReplied[replyKey] || 0) >= 30000) {
                                afkReplied[replyKey] = now
                                const count = spamTrack[senderKey]?.count || 1
                                await sendHuman(sock, jid, `🙏 *PM belum di-approve, jangan spam atau di-block!*\n⏳ *AFK: ${reason}* _(Sejak ${dur} yang lalu)_ *(${count}/${SPAM_LIMIT})*`, { quoted: msg })
                            }
                        }
                    } else if (isGroup) {
                        const isMention = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.includes(ownerJid)
                        const replyTo = msg.message?.extendedTextMessage?.contextInfo?.participant
                        const isReplyToOwner = replyTo && normalizeJid(replyTo) === ownerJid

                        if (isMention || isReplyToOwner) {
                            const replyKey = `${jid}_${senderKey}`
                            if (now - (afkReplied[replyKey] || 0) >= AFK_REPLY_COOLDOWN) {
                                afkReplied[replyKey] = now
                                await sendHuman(sock, jid, `💤 *Bentar yaa lagi AFK!*\nAlasan: ${reason}\n⏳ _(Sejak ${dur} yang lalu)_`, { quoted: msg })
                            }
                        }
                    }
                } else if (isPrivate && !isWhitelisted && !isMuted) {
                    const count = spamTrack[senderKey]?.count || 1
                    await sendHuman(sock, jid, `🙏 *PM belum di-approve owner.*\n⏳ Status: *${count}/${SPAM_LIMIT}* chat sebelum block.`, { quoted: msg })
                }
            }
        }
    })
}

console.log('------------------------------------------------')
console.log('-------  AKASHA WA USERBOT - STARTING   -------')
console.log('------------------------------------------------')
startBot()
