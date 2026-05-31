from telethon import TelegramClient, events, functions, Button
from telethon.tl import types
import psutil, platform, os, sys, subprocess, asyncio, re, json, requests
import warnings 
import time 
from datetime import datetime

# Bungkam DeprecationWarning dari library speedtest biar log bersih
warnings.filterwarnings("ignore", category=DeprecationWarning)

# --- [ KONFIGURASI ] ---
api_id = 37157919
api_hash = 'e6712f0d02d472dbeaa4ec8fae26eacb'
client = TelegramClient('sesi_userbot', api_id, api_hash)

# --- [ PATHS ] ---
IMAGE_INFO = "/home/fxxx98/bot_tele/i.jpeg"
DB_AUTH = "/home/fxxx98/bot_tele/authorized_users.json"
DB_AFK = "/home/fxxx98/bot_tele/afk_logs.json"
DB_WHITE = "/home/fxxx98/bot_tele/pm_whitelist.json"
DB_SPAM = "/home/fxxx98/bot_tele/spam_tracker.json"

# --- [ TRACKER MUTE ] ---
TEMP_MUTE = {}

def load_db(p, s=True):
    if os.path.exists(p):
        try:
            with open(p, 'r') as f:
                d = json.load(f)
                return set(map(int, d)) if s else dict(d)
        except: pass
    return set() if s else {}

def save_db(p, d):
    try:
        with open(p, 'w') as f:
            json.dump(list(d) if isinstance(d, set) else d, f)
    except: pass

# --- [ FUNGSI PENGHITUNG WAKTU AFK ] ---
def get_afk_time(since):
    diff = int(time.time() - since)
    if diff < 60: return f"{diff} detik"
    m = diff // 60
    if m < 60: return f"{m} menit"
    h = m // 60; m = m % 60
    if h < 24: return f"{h} jam {m} menit"
    d = h // 24; h = h % 24
    return f"{d} hari {h} jam"

auth_u = load_db(DB_AUTH); whitelist_pm = load_db(DB_WHITE)
afk_data = load_db(DB_AFK, False); spam_tracker = load_db(DB_SPAM, False)

HELP_TEXT = """
**DAFTAR COMMAND WAHYU BOT** 🚀

**OWNER COMMANDS:**
• `.info` - Cek spek VPS & Detail Storage
• `.speedtest` - Tes kecepatan internet VPS (MB/s)
• `.afk <alasan>` - Mode AFK
• `.approve` - Whitelist PM (Reply/ID)
• `.permgroup` - Atur izin fitur untuk satu grup
• `.perm` - Atur izin fitur user (Menu)
• `.list` - Cek daftar user & izin
• `.restart` - Muat ulang bot

**SUBUSER & OWNER COMMANDS:**
• `.ping` - Cek latency bot
• `.aigm <tanya>` - Tanya Gemini AI
• `.aigr <tanya>` - Tanya Groq AI
• `.setstyle <gaya>` - Ubah gaya bahasa AI
• `.statusai` - Cek gaya AI aktif
• `.help` - Munculin menu ini
"""

async def get_stats_text(user_name):
    n, t = chr(10), chr(96)
    svmem = psutil.virtual_memory()
    ram_total = svmem.total / (1024**3)
    ram_used = svmem.used / (1024**3)
    ram_free = svmem.available / (1024**3)
    ram_pct = svmem.percent
    disk = psutil.disk_usage('/')
    disk_total = disk.total / (1024**3)
    disk_used = disk.used / (1024**3)
    disk_free = disk.free / (1024**3)
    disk_pct = disk.percent
    try: distro = subprocess.check_output("lsb_release -ds", shell=True).decode().strip().replace('"', '')
    except: distro = platform.system()
    try: cpu = subprocess.check_output("grep -m1 'model name' /proc/cpuinfo | cut -d: -f2", shell=True).decode().strip()
    except: cpu = platform.processor()
    try:
        p = await asyncio.create_subprocess_shell("uptime -p", stdout=asyncio.subprocess.PIPE)
        out, _ = await p.communicate(); up = out.decode().replace("up ", "").strip()
    except: up = "Unknown"
    return (f"**AKASHA SYSTEM INFO** 🚀{n}{n}"
            f"👤 **User:** {t}{user_name}{t}{n}"
            f"📱 **CPU:** {t}MT6789{t}{n}"
            f"🐧 **OS:** {t}AxionOS 2.6 x Linux {t}{n}            {t}Mint 22.3{t}{n}"
            f"⏱️ **Uptime:** {t}{up}{t}{n}{n}"
            f"💾 **RAM Capacity:**{n}"
            f"  • Total: {t}{ram_total:.2f} GB{t}{n}"
            f"  • Used: {t}{ram_used:.2f} GB ({ram_pct}%){t}{n}"
            f"  • Free: {t}{ram_free:.2f} GB{t}{n}{n}"
            f"🗄️ **Disk Storage:**{n}"
            f"  • Total: {t}{disk_total:.2f} GB{t}{n}"
            f"  • Used: {t}{disk_used:.2f} GB ({disk_pct}%){t}{n}"
            f"  • Free: {t}{disk_free:.2f} GB{t}")

@client.on(events.NewMessage(incoming=True))
async def handler_incoming(event):
    if not event.sender_id: return
    me = await client.get_me(); sid = int(event.sender_id); sid_s = str(sid); mid_s = str(me.id)
    txt = event.raw_text; t_l = txt.lower()
    
    is_white = (sid in whitelist_pm) 
    is_muted = sid in TEMP_MUTE and time.time() < TEMP_MUTE[sid]

    if mid_s in afk_data and not (sid == me.id):
        reason = afk_data[mid_s].get('reason', 'YNDTKTS')
        # Ambil waktu AFK dan ubah ke format yang bisa dibaca
        since_time = afk_data[mid_s].get('since', time.time())
        afk_duration = get_afk_time(since_time)
        
        if event.is_private:
            if is_white: 
                return await event.reply(f"💤 **Bentar yaa lagi AFK alasan : {reason}**\n⏳ `(Sejak {afk_duration} yang lalu)`")
            else:
                c = spam_tracker.get(sid_s, 0) + 1; spam_tracker[sid_s] = c; save_db(DB_SPAM, spam_tracker)
                if c >= 5: 
                    await event.reply("🚫 **Limit chat PM tercapai. Lo diblock.**")
                    return await client(functions.contacts.BlockRequest(id=sid))
                if not is_muted:
                    return await event.reply(f"🙏 **PM belum di-approve, jangan spam atau di blok tunggu di bales.**\n⏳ **AFK: {reason}** `(Sejak {afk_duration} yang lalu)` **({c}/5)**")
        else:
            is_reply_to_me = False
            if event.is_reply:
                rep_msg = await event.get_reply_message()
                if rep_msg and rep_msg.sender_id == me.id: is_reply_to_me = True
            if event.mentioned or is_reply_to_me: 
                return await event.reply(f"💤**Bentar yaa lagi AFK alasan : {reason}**\n⏳ `(Sejak {afk_duration} yang lalu)`")

    elif event.is_private and not (sid == me.id or is_white):
        c = spam_tracker.get(sid_s, 0) + 1; spam_tracker[sid_s] = c; save_db(DB_SPAM, spam_tracker)
        if c >= 5: 
            await event.reply("🚫 **Limit chat PM tercapai. Lo diblock.**")
            return await client(functions.contacts.BlockRequest(id=sid))
        if not is_muted:
            return await event.reply(f"🙏 **PM belum di-approve owner.**\n⏳ **Status: {c}/5 chat sebelum block.**")

@client.on(events.NewMessage(outgoing=True))
async def handler_outgoing(event):
    txt, me = event.raw_text, await client.get_me()
    mid_s, sid_s, t_l = str(me.id), str(me.id), txt.lower()
    
    if event.is_private and not txt.startswith("."):
        TEMP_MUTE[event.chat_id] = time.time() + 300 
        if str(event.chat_id) in spam_tracker:
            spam_tracker[str(event.chat_id)] = 0; save_db(DB_SPAM, spam_tracker)

    if mid_s in afk_data and not t_l.startswith(".afk"):
        # Ambil data sebelum dihapus
        reason = afk_data[mid_s].get('reason', 'YNDTKTS')
        since_time = afk_data[mid_s].get('since', time.time())
        afk_duration = get_afk_time(since_time)
        
        # Hapus status AFK
        del afk_data[mid_s]
        save_db(DB_AFK, afk_data)
        
        # Kirim pesan comeback
        await event.respond(f"💋 **Muach gwejh back ygy!**\n⏳ `(Kembali setelah {afk_duration} AFK - Alasan: {reason})`")
    if t_l.startswith(".afk"):
        r = txt[5:].strip()
        # Catat waktu saat lu nge-AFK
        afk_data[mid_s] = {'reason': r if r else "YNDTKTS", 'since': time.time()} 
        save_db(DB_AFK, afk_data)
        await event.edit(f"💤 **BYE gaiss AFK duluuu alasan : {afk_data[mid_s]['reason']}**")
    elif t_l == ".ping":
        start = datetime.now(); await event.edit("`Pinging...` ")
        await event.edit(f"**Pong !!**\n🚀 `Latency: {(datetime.now()-start).total_seconds()*1000:.2f} ms` ")
    elif t_l == ".info":
        await event.edit("`Sekk...` "); res = await get_stats_text(me.first_name)
        if os.path.exists(IMAGE_INFO): await client.send_file(event.chat_id, IMAGE_INFO, caption=res); await event.delete()
        else: await event.edit(res)
    elif t_l == ".speedtest":
        await event.edit("`Running Speedtest... 🚀` ")
        try:
            res = subprocess.check_output([sys.executable, "-m", "speedtest", "--simple", "--bytes", "--secure"]).decode("utf-8")
            await event.edit(f"**🚀 Speedtest Results (MB/s):**\n```{res}```")
        except Exception as e: await event.edit(f"❌ Speedtest Error: `{str(e)}`")
    elif t_l.startswith(".approve"):
        try:
            tid = (await event.get_reply_message()).sender_id if event.is_reply else int(txt.split(" ", 1)[1])
            whitelist_pm.add(tid); save_db(DB_WHITE, whitelist_pm)
            if str(tid) in spam_tracker: del spam_tracker[str(tid)]; save_db(DB_SPAM, spam_tracker)
            if tid in TEMP_MUTE: del TEMP_MUTE[tid] 
            await event.edit(f"✅ User `{tid}` Whitelisted PM!")
        except: await event.edit("❌ Gagal.")
    elif t_l == ".list":
        msg = "**📜 DAFTAR IZIN AKTIF**\n\n**Whitelist PM:** " + (", ".join([f"`{u}`" for u in whitelist_pm]) or "-") 
        await event.edit(msg) 
    elif t_l == ".help": await event.edit(HELP_TEXT)
    elif t_l == ".restart":
        for i in range(3, 0, -1): await event.edit(f"`♻️ Restarting in {i}s...` "); await asyncio.sleep(1)
        await event.edit("`♻️ Restarting now...` "); await client.disconnect()
        subprocess.Popen([sys.executable, sys.argv[0]], start_new_session=True); os._exit(0)
    
print("------------------------------------------------")
print("------ AKASHA USERBOT IS READY TO USE SAR ------")
print("------------------------------------------------")
client.start(); client.run_until_disconnected()
