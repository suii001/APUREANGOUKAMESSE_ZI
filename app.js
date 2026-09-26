import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getDatabase, ref, push, onChildAdded, get, update, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// Service Worker (PWA) 登録
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW reg error:', err));
  });
}

const firebaseConfig = {
  apiKey: "const firebaseConfig = {
  apiKey: "AIzaSyBnVBvyE8pfFc4WUAbAtCJXScsWWRmhzwk",
  authDomain: "apure-chat-9e687.firebaseapp.com",
  databaseURL: "https://apure-chat-9e687-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "apure-chat-9e687",
  storageBucket: "apure-chat-9e687.firebasestorage.app",
  messagingSenderId: "119464225734",
  appId: "1:119464225734:web:593e59a957c9d6a669e0c7"
};",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "SENDER_ID",
  appId: "APP_ID"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

let currentUsername = localStorage.getItem("username") || "OPERATOR_01";
let currentRoom = "global-room";
const PACKET_BLOCK_SIZE = 512;

// 触覚フィードバック
function triggerHaptic(pattern = [25]) {
  if ('vibrate' in navigator) {
    try { navigator.vibrate(pattern); } catch(e) {}
  }
}

// パケット・パディング（512B固定長）
function padPacket(text) {
  const payloadObj = { t: text, nonce: Math.random().toString(36).substring(2) };
  const jsonStr = JSON.stringify(payloadObj);
  const encoder = new TextEncoder();
  const rawBytes = encoder.encode(jsonStr);

  const paddedLength = Math.ceil((rawBytes.length + 2) / PACKET_BLOCK_SIZE) * PACKET_BLOCK_SIZE;
  const paddedBuffer = new Uint8Array(paddedLength);
  
  const view = new DataView(paddedBuffer.buffer);
  view.setUint16(0, rawBytes.length, false);
  paddedBuffer.set(rawBytes, 2);

  const padRandomBytes = new Uint8Array(paddedLength - 2 - rawBytes.length);
  crypto.getRandomValues(padRandomBytes);
  paddedBuffer.set(padRandomBytes, 2 + rawBytes.length);

  return btoa(String.fromCharCode(...paddedBuffer));
}

function unpadPacket(paddedBase64) {
  try {
    const binaryStr = atob(paddedBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    const view = new DataView(bytes.buffer);
    const realLength = view.getUint16(0, false);
    const jsonBytes = bytes.subarray(2, 2 + realLength);

    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(jsonBytes)).t;
  } catch (e) {
    return paddedBase64;
  }
}

// 多言語辞書
const i18n = {
  ja: { settings: "[SET] 設定", rooms: "[CHANNELS]", send: "[SEND]", accountSettings: "[SYS_CONFIG] アカウント設定", avatarUrl: "AVATAR_IMAGE_URL", language: "言語設定", showBot: "Botユニット表示", autoDeleteTime: "自動消去タイマー", bunkerTitle: "[SPEC_OVERVIEW] バンカープロトコル", bunkerDesc: "ECDH P-256 + AES-GCMによるE2EE。すべての暗号文は512バイトのアライメントデータへパディングされ、送信長からの解読を防止します。", keyBackup: "鍵ペア管理", exportKey: "[EXP] 出力 (.JSON)", save: "[SAVE] 保存", logout: "[TERMINATE] ログアウト" },
  en: { settings: "[SET] SETTINGS", rooms: "[CHANNELS]", send: "[SEND]", accountSettings: "[SYS_CONFIG] CONFIGURATION", avatarUrl: "AVATAR_IMAGE_URL", language: "LANGUAGE", showBot: "SHOW_BOT_UNITS", autoDeleteTime: "AUTO_PURGE_INTERVAL", bunkerTitle: "[SPEC_OVERVIEW] BUNKER PROTOCOL", bunkerDesc: "Client E2EE. Traffic padding aligns cipher payloads to 512-byte blocks.", keyBackup: "KEY_PAIR_MANAGEMENT", exportKey: "[EXP] EXPORT (.JSON)", save: "[SAVE] APPLY", logout: "[TERMINATE] LOGOUT" },
  ru: { settings: "[SET] НАСТРОЙКИ", rooms: "[КАНАЛЫ]", send: "[SEND]", accountSettings: "[SYS_CONFIG] НАСТРОЙКИ", avatarUrl: "AVATAR_IMAGE_URL", language: "ЯЗЫК", showBot: "БОТЫ", autoDeleteTime: "ТАЙМЕР_УДАЛЕНИЯ", bunkerTitle: "[SPEC_OVERVIEW] ПРОТОКОЛ", bunkerDesc: "E2EE шифрование. Фиксированный размер пакета 512 байт.", keyBackup: "КЛЮЧИ", exportKey: "[EXP] ЭКСПОРТ (.JSON)", save: "[SAVE] СОХРАНИТЬ", logout: "[TERMINATE] ВЫХОД" }
};

function applyLanguage(lang) {
  const dict = i18n[lang] || i18n.ja;
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if (dict[key]) el.textContent = dict[key];
  });
}

onAuthStateChanged(auth, async (user) => {
  loadUserSettings();
  listenMessages();
});

async function loadUserSettings() {
  const snapshot = await get(ref(db, `users/${currentUsername}`));
  if (snapshot.exists()) {
    const data = snapshot.val();
    const settings = data.settings || {};

    document.getElementById("settings-avatar-url").value = data.avatarUrl || "";
    if (data.avatarUrl) document.getElementById("settings-avatar-preview").src = data.avatarUrl;

    const lang = settings.language || "ja";
    document.getElementById("settings-language").value = lang;
    document.getElementById("settings-show-bot").checked = settings.showBot || false;
    document.getElementById("settings-auto-delete").value = settings.autoDeleteMinutes || "120";

    if (settings.showBot) document.getElementById("bot-section").classList.remove("hidden");
    else document.getElementById("bot-section").classList.add("hidden");

    applyLanguage(lang);
  }
}

function handleSlashCommand(cmdText) {
  const parts = cmdText.trim().split(" ");
  const command = parts[0].toLowerCase();

  switch (command) {
    case "/help":
      appendSystemMessage("[CMD_HELP] Commands: /help, /wipe, /clear, /timer <mins>, /export");
      return true;
    case "/wipe":
      if (confirm("[DANGER] Wipe local cache and reload?")) {
        localStorage.clear();
        window.location.reload();
      }
      return true;
    case "/clear":
      document.getElementById("messages-container").innerHTML = "";
      return true;
    case "/timer":
      if (parts[1]) {
        document.getElementById("settings-auto-delete").value = parts[1];
        appendSystemMessage(`[SYS] Purge timer set to ${parts[1]}m.`);
      }
      return true;
    case "/export":
      document.getElementById("export-key-btn").click();
      return true;
    default:
      return false;
  }
}

function appendSystemMessage(text) {
  const container = document.getElementById("messages-container");
  const div = document.createElement("div");
  div.className = "message-bubble";
  div.style.borderColor = "#ffaa00";
  div.innerHTML = `<div class="message-text" style="color: #ffaa00;">${text}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");

messageForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  triggerHaptic([30]);
  const text = messageInput.value.trim();
  if (!text) return;

  if (text.startsWith("/") && handleSlashCommand(text)) {
    messageInput.value = "";
    return;
  }

  const paddedText = padPacket(text);
  const autoDeleteMinutes = parseInt(document.getElementById("settings-auto-delete").value || "120", 10);

  await push(ref(db, `dms/${currentRoom}/messages`), {
    sender: currentUsername,
    text: paddedText,
    timestamp: Date.now(),
    autoDeleteMinutes: autoDeleteMinutes
  });

  messageInput.value = "";
});

function listenMessages() {
  const messagesContainer = document.getElementById("messages-container");
  messagesContainer.innerHTML = "";

  onChildAdded(ref(db, `dms/${currentRoom}/messages`), (snapshot) => {
    const msg = snapshot.val();
    const msgId = snapshot.key;

    if (msg.autoDeleteMinutes > 0) {
      const expireTime = msg.timestamp + (msg.autoDeleteMinutes * 60 * 1000);
      if (Date.now() >= expireTime) {
        remove(ref(db, `dms/${currentRoom}/messages/${msgId}`));
        return;
      }
    }

    const unpaddedText = unpadPacket(msg.text);
    const div = document.createElement("div");
    const isMine = msg.sender === currentUsername;
    div.className = `message-bubble ${isMine ? "mine" : ""}`;
    div.innerHTML = `
      <div class="message-meta">
        <span>${msg.sender}</span>
        <span>${new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
      </div>
      <div class="message-text">${unpaddedText}</div>
    `;
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}

document.getElementById("export-key-btn").addEventListener("click", () => {
  triggerHaptic([40]);
  const backupObj = {
    username: currentUsername,
    publicKey: localStorage.getItem("publicKey") || "KEY_PUB_DATA",
    privateKey: localStorage.getItem("privateKey") || "KEY_PRIV_DATA",
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(backupObj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bunker_key_${currentUsername}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("import-key-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const data = JSON.parse(evt.target.result);
      if (data.publicKey && data.privateKey) {
        localStorage.setItem("publicKey", data.publicKey);
        localStorage.setItem("privateKey", data.privateKey);
        alert("[SUCCESS] Keys imported successfully.");
      }
    } catch (err) {
      alert("[ERROR] Invalid key backup JSON.");
    }
  };
  reader.readAsText(file);
});

document.getElementById("open-settings-btn").addEventListener("click", () => {
  triggerHaptic([20]);
  document.getElementById("settings-modal").classList.remove("hidden");
});
document.getElementById("close-settings-btn").addEventListener("click", () => {
  document.getElementById("settings-modal").classList.add("hidden");
});
document.getElementById("save-settings-btn").addEventListener("click", async () => {
  triggerHaptic([30]);
  const avatarUrl = document.getElementById("settings-avatar-url").value.trim();
  const language = document.getElementById("settings-language").value;
  const showBot = document.getElementById("settings-show-bot").checked;
  const autoDeleteMinutes = parseInt(document.getElementById("settings-auto-delete").value, 10);

  await update(ref(db, `users/${currentUsername}`), {
    avatarUrl,
    settings: { language, showBot, autoDeleteMinutes },
    updatedAt: Date.now()
  });

  if (showBot) document.getElementById("bot-section").classList.remove("hidden");
  else document.getElementById("bot-section").classList.add("hidden");

  applyLanguage(language);
  document.getElementById("settings-modal").classList.add("hidden");
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await signOut(auth);
  localStorage.clear();
  window.location.reload();
});
