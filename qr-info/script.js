/* 생활정보 QR — 생성기(index.html) + 뷰어(view.html) 공용 스크립트
 *
 * 데이터 흐름:
 *   입력값 → JSON → AES-GCM 암호화 → base64url → view.html#데이터
 *   URL 해시(#) 부분은 서버로 전송되지 않으므로 GitHub에는 실제 정보가 저장되지 않는다.
 *   단, 복호화 키는 이 파일 안에 있으므로 "QR 주소를 아는 사람"은 내용을 볼 수 있다.
 *   (매장에 붙이는 안내 QR이므로, 스캔한 사람에게 보여주는 것이 목적이다.)
 */

const SECRET = "qr-info-v1::saenghwal-qr";

function b64uEncode(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64uDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function getKey() {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SECRET));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptData(obj) {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(JSON.stringify(obj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64uEncode(out);
}

async function decryptData(str) {
  const key = await getKey();
  const data = b64uDecode(str);
  const iv = data.slice(0, 12);
  const ct = data.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(pt));
}

function copyText(text, btn) {
  const done = () => {
    const orig = btn.textContent;
    btn.textContent = "복사됨 ✓";
    btn.classList.add("done");
    setTimeout(() => {
      btn.textContent = orig;
      btn.classList.remove("done");
    }, 1500);
  };
  const fallback = () => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { alert("복사에 실패했습니다. 직접 선택해 주세요."); }
    document.body.removeChild(ta);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(fallback);
  } else {
    fallback();
  }
}

/* ============================== 생성기 ============================== */

function initGenerator() {
  const pairs = [
    ["chkAccount", "fsAccount"],
    ["chkWifi", "fsWifi"],
    ["chkToilet", "fsToilet"],
  ];
  for (const [chkId, fsId] of pairs) {
    const chk = document.getElementById(chkId);
    const fs = document.getElementById(fsId);
    chk.addEventListener("change", () => {
      fs.hidden = !chk.checked;
      fs.disabled = !chk.checked;
    });
  }

  // view.html 주소 자동 채우기 (생성기가 배포된 위치 기준)
  const baseInput = document.getElementById("baseUrl");
  const auto = location.href.split("#")[0].split("?")[0].replace(/index\.html$/, "").replace(/\/$/, "/");
  baseInput.value = (auto.endsWith("/") ? auto : auto + "/") + "view.html";

  const err = document.getElementById("makeError");
  document.getElementById("btnMake").addEventListener("click", async () => {
    err.hidden = true;
    const data = {};
    const purposes = [];

    if (document.getElementById("chkAccount").checked) {
      const bank = document.getElementById("accBank").value.trim();
      const num = document.getElementById("accNum").value.trim();
      const holder = document.getElementById("accHolder").value.trim();
      if (!bank || !num) return showErr("계좌정보: 은행명과 계좌번호를 입력해 주세요.");
      data.a = { b: bank, n: num };
      if (holder) data.a.h = holder;
      purposes.push("계좌");
    }
    if (document.getElementById("chkWifi").checked) {
      const ssid = document.getElementById("wifiSsid").value.trim();
      const pw = document.getElementById("wifiPw").value.trim();
      if (!ssid || !pw) return showErr("Wi-Fi: 네트워크 이름과 비밀번호를 입력해 주세요.");
      data.w = { s: ssid, p: pw };
      purposes.push("Wi-Fi");
    }
    if (document.getElementById("chkToilet").checked) {
      const pw = document.getElementById("toiletPw").value.trim();
      if (!pw) return showErr("화장실 비밀번호를 입력해 주세요.");
      data.t = { p: pw };
      purposes.push("화장실");
    }
    if (purposes.length === 0) return showErr("항목을 하나 이상 선택해 주세요.");

    const base = baseInput.value.trim();
    if (!base) return showErr("표시 페이지 주소(view.html)를 입력해 주세요.");

    const enc = await encryptData(data);
    const url = base + "#" + enc;
    const label = purposes.join(" · ") + " 안내";

    drawQR(url, label);
    document.getElementById("qrPurpose").textContent = label;
    document.getElementById("qrUrl").textContent = url;
    document.getElementById("result").hidden = false;

    const canvas = document.getElementById("qrCanvas");
    document.getElementById("btnSave").onclick = () => {
      const a = document.createElement("a");
      a.download = "QR_" + purposes.join("_") + ".png";
      a.href = canvas.toDataURL("image/png");
      a.click();
    };
    document.getElementById("btnPreview").onclick = () => window.open(url, "_blank");
    document.getElementById("result").scrollIntoView({ behavior: "smooth" });

    function showErr(msg) {
      err.textContent = msg;
      err.hidden = false;
    }
  });
}

function drawQR(url, label) {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();

  const count = qr.getModuleCount();
  const cell = 8;
  const margin = cell * 4;
  const size = count * cell + margin * 2;
  const labelH = 56;

  const canvas = document.getElementById("qrCanvas");
  canvas.width = size;
  canvas.height = size + labelH;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) ctx.fillRect(margin + c * cell, margin + r * cell, cell, cell);
    }
  }
  ctx.font = "bold 26px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, size / 2, size + labelH / 2 - 8);
}

/* ============================== 뷰어 ============================== */

async function initViewer() {
  const loading = document.getElementById("viewLoading");
  const errBox = document.getElementById("viewError");
  const content = document.getElementById("viewContent");

  const hash = location.hash.slice(1);
  if (!hash) {
    loading.hidden = true;
    errBox.hidden = false;
    return;
  }

  let data;
  try {
    data = await decryptData(hash);
  } catch (e) {
    loading.hidden = true;
    errBox.hidden = false;
    return;
  }

  // 계좌 → 복사 버튼 / Wi-Fi → 비밀번호 복사 버튼 / 화장실 → 크게 표시, 복사 없음
  if (data.a) {
    const card = makeCard("💳 계좌정보");
    const main = el("div", "info-main", data.a.n);
    card.appendChild(el("div", "info-sub", data.a.b + (data.a.h ? " · " + data.a.h : "")));
    card.appendChild(main);
    const btn = el("button", "copy", "계좌번호 복사");
    btn.addEventListener("click", () => copyText(data.a.n, btn));
    card.appendChild(btn);
    content.appendChild(card);
  }

  if (data.w) {
    const card = makeCard("📶 Wi-Fi");
    card.appendChild(el("div", "info-sub", "네트워크: " + data.w.s));
    card.appendChild(el("div", "info-main", data.w.p));
    const btn = el("button", "copy", "비밀번호 복사");
    btn.addEventListener("click", () => copyText(data.w.p, btn));
    card.appendChild(btn);
    content.appendChild(card);
  }

  if (data.t) {
    const card = makeCard("🚻 화장실 비밀번호");
    card.appendChild(el("div", "toilet-pw", data.t.p));
    content.appendChild(card);
  }

  loading.hidden = true;
  content.hidden = false;

  function makeCard(title) {
    const card = el("div", "info-card");
    const h = document.createElement("h2");
    h.textContent = title;
    card.appendChild(h);
    return card;
  }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
}

/* ============================== 진입점 ============================== */

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("btnMake")) initGenerator();
  if (document.getElementById("viewContent")) initViewer();
});
