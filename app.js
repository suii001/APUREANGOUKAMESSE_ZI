const firebaseConfig = {
  apiKey: "AIzaSyBnVBvyE8pfFc4WUAbAtCJXScsWWRmhzwk",
  databaseURL: "https://apure-chat-9e687-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "apure-chat-9e687"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let myUsername = null;
let myKeyPair = null;
let activeTarget = null;
let activeSharedKey = null;

const BLOCK_SIZE = 512; // 【保護機能1】固定長パディング（全データを512バイト単位に切り上げ）

function padData(str) {
  const enc = new TextEncoder().encode(str);
  const paddedLen = Math.ceil((enc.length + 2) / BLOCK_SIZE) * BLOCK_SIZE;
  const padded = new Uint8Array(paddedLen);
  padded[0] = (enc.length >> 8) & 0xff;
  padded[1] = enc.length & 0xff;
  padded.set(enc, 2);
  return padded;
}

function unpadData(buffer) {
  const arr = new Uint8Array(buffer);
  const len = (arr[0] << 8) | arr[1];
  return new TextDecoder().decode(arr.slice(2, 2 + len));
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// 鍵生成と暗号化（ECDH + AES-GCM）
async function generateKeys() {
  return await window.crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
}

async function exportKey(key) {
  return bufferToBase64(await window.crypto.subtle.exportKey("spki", key));
}

async function importPublicKey(base64) {
  const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return await window.crypto.subtle.importKey("spki", binary, { name: "ECDH", namedCurve: "P-256" }, true, []);
}

async function deriveSharedKey(privKey, pubKey) {
  return await window.crypto.subtle.deriveKey({ name: "ECDH", public: pubKey }, privKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function encryptText(text, key) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const paddedBuffer = padData(text);
  const enc = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, paddedBuffer);
  const combined = new Uint8Array(12 + enc.byteLength);
  combined.set(iv, 0); combined.set(new Uint8Array(enc), 12);
  return bufferToBase64(combined);
}

async function decryptText(base64, key) {
  const data = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const dec = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: data.slice(0, 12) }, key, data.slice(12));
  return unpadData(dec);
}

// ユーザー登録
document.getElementById('register-btn').addEventListener('click', async () => {
  const val = document.getElementById('username-input').value.trim();
  if (!val) return alert('IDを入力してください');

  myKeyPair = await generateKeys();
  const pubB64 = await exportKey(myKeyPair.publicKey);
  await db.ref(`users/${val}`).set({ publicKey: pubB64 });

  myUsername = val;
  document.getElementById('my-id-display').textContent = `@${myUsername}`;
  document.getElementById('login-section').style.display = 'none';
  document.getElementById('chat-section').style.display = 'flex';
});

// 通信開始
document.getElementById('connect-target-btn').addEventListener('click', async () => {
  const target = document.getElementById('target-input').value.trim();
  if (!target) return;

  const snap = await db.ref(`users/${target}`).once('value');
  if (!snap.exists()) return alert('相手が見つかりません');

  const targetPubKey = await importPublicKey(snap.val().publicKey);
  activeSharedKey = await deriveSharedKey(myKeyPair.privateKey, targetPubKey);
  activeTarget = target;

  const roomId = [myUsername, target].sort().join('___');
  db.ref(`dms/${roomId}/messages`).on('value', async (snapshot) => {
    const box = document.getElementById('chat-messages');
    box.innerHTML = '';
    if (!snapshot.exists()) return;

    const data = snapshot.val();
    for (let id in data) {
      try {
        const plain = await decryptText(data[id].ciphertext, activeSharedKey);
        // 【保護機能2】Sealed Sender：復号成功後に初めて暗号文内部から送信者IDを取り出す
        const m = JSON.parse(plain); 
        box.innerHTML += `<div><b>@${m.sender}:</b> ${m.text}</div>`;
      } catch (e) {
        box.innerHTML += `<div style="color:red;">[復号エラー]</div>`;
      }
    }
    box.scrollTop = box.scrollHeight;
  });
});

// 送信（送信者情報を外側のデータ構造から完全削除）
document.getElementById('send-btn').addEventListener('click', async () => {
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text || !activeSharedKey || !activeTarget) return;

  const roomId = [myUsername, activeTarget].sort().join('___');
  
  // 送信者ID (sender) を外側のヘッダーではなく暗号化データの中に閉じ込める
  const payload = JSON.stringify({ sender: myUsername, text: text, timestamp: Date.now() });
  const encrypted = await encryptText(payload, activeSharedKey);

  // サーバーへ渡すデータには「暗号文」のみ（誰が送ったかというメタデータをサーバーに残さない）
  await db.ref(`dms/${roomId}/messages`).push({ ciphertext: encrypted });
  input.value = '';
});
