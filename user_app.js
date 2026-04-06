(() => {

  // ===== 제출/기간 잠금 =====
  // ✅ 편집/버튼 잠금은 state.locked(제출 상태) + 설문 기간 마감 여부로만 판단합니다.
  // (기존 isLocked 기반 잠금 로직은 제거)

// ------------------ Supabase init ------------------
const SUPABASE_URL = "https://pztlmyfutfmbmlvavwuz.supabase.co";
const SUPABASE_KEY = "sb_publishable_fnGFEvCmhZRRIWj0qrEEeA_Vex3mxac";
const EVIDENCE_UPLOAD_URL = "https://sewon-upload.mgs15158.workers.dev";

const mbToBytes = (mb) => Math.max(0, Number(mb || 0)) * 1024 * 1024;

function sanitizeEvidenceFilename(name){
  return String(name || "file")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_");
}
const supabaseLib = window.supabase;
const $ = (id) => document.getElementById(id);

// ------------------ Theme (Light/Dark) ------------------
const THEME_STORAGE_KEY = "sewon_theme_mode"; // "light" | "dark"

function getStoredTheme(){
  try{ return localStorage.getItem(THEME_STORAGE_KEY) || "light"; }
  catch(_){ return "light"; }
}

function applyTheme(theme){
  const t = (String(theme).toLowerCase() === "dark") ? "dark" : "light";

  if(t === "dark") document.body.classList.add("dark");
  else document.body.classList.remove("dark");

  try{ localStorage.setItem(THEME_STORAGE_KEY, t); }catch(_){}
}

// Apply theme ASAP on load (prevents flash + keeps setting after refresh)
document.addEventListener("DOMContentLoaded", () => {
  applyTheme(getStoredTheme());
}, true);



// ------------------ User pill (top-right) + persistence ------------------
const USER_CACHE_KEY = "sewon_user_cache_v1";

function ensureUserPill(){
  // 1) Reuse existing user pill if page already has one
  let pill =
    document.getElementById("userPill") ||
    document.getElementById("userMenuTrigger") ||
    document.getElementById("userInfoPill") ||
    document.querySelector(".user-pill") ||
    document.querySelector("[data-user-pill]");

  const topbar = document.querySelector("header.topbar");
  if (!topbar) return pill || null;

  // If we found an existing pill, normalize ids for text targets
  if (pill){
    pill.id = "userPill";

    // Ensure line containers exist
    let line1 = pill.querySelector("#userLine1") || pill.querySelector(".user-line1");
    let line2 = pill.querySelector("#userLine2") || pill.querySelector(".user-line2");

    // If the existing markup uses different structure, create our lines
    if (!line1 || !line2){
      pill.innerHTML = `
        <div class="user-line1" id="userLine1">로그인 사용자</div>
        <div class="user-line2" id="userLine2">email@domain.com</div>
      `;
    }else{
      line1.id = "userLine1";
      line2.id = "userLine2";
      line1.classList.add("user-line1");
      line2.classList.add("user-line2");
    }

    // Remove duplicate placeholder pills if any
    cleanupDuplicateUserPills();
    return pill;
  }

  // 2) If none exists, create one and append into topbar
  const actions = topbar.querySelector(".top-actions") || topbar;

  pill = document.createElement("button");
  pill.type = "button";
  pill.id = "userPill";
  pill.className = "user-pill";
  pill.innerHTML = `
    <div class="user-line1" id="userLine1">로그인 사용자</div>
    <div class="user-line2" id="userLine2">email@domain.com</div>
  `;
  actions.appendChild(pill);

  cleanupDuplicateUserPills();
  return pill;
}

function cleanupDuplicateUserPills(){
  try{
    const pills = Array.from(document.querySelectorAll(".user-pill"));
    if (pills.length <= 1) return;

    // Prefer pill that has real email (contains @ and not domain.com placeholder)
    const score = (el) => {
      const t = (el.textContent || "").trim();
      let s = 0;
      if (t.includes("@")) s += 10;
      if (!t.includes("email@domain.com")) s += 10;
      if (!t.includes("로그인 사용자")) s += 2;
      return s;
    };

    pills.sort((a,b)=>score(b)-score(a));
    const keep = pills[0];

    for (const p of pills.slice(1)){
      if (p !== keep) p.remove();
    }
  }catch(_){}
}

function setUserPillText({ company="", name="", email="" }){
  ensureUserPill();
  const line1 = document.getElementById("userLine1");
  const line2 = document.getElementById("userLine2");

  const top = [company, name].filter(Boolean).join(" ");
  if (line1) line1.textContent = top || "로그인 사용자";
  if (line2) line2.textContent = email || "email@domain.com";
}

function cacheUserProfile(p){
  try{
    if(!p) return;
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify({
      company: p.company || "",
      name: p.name || "",
      email: p.email || "",
      ts: Date.now()
    }));
  }catch(_){}
}

function hydrateUserPillFromCache(){
  try{
    const raw = localStorage.getItem(USER_CACHE_KEY);
    if(!raw) return;
    const c = JSON.parse(raw);
    if(!c) return;
    setUserPillText({ company:c.company||"", name:c.name||"", email:c.email||"" });
  }catch(_){}
}

async function readProfileFromMetadataOrDB(session){
  const user = session?.user;
  if(!user) return null;

  const md = user.user_metadata || {};
  const email = user.email || "";

  // metadata first
  const metaProfile = {
    company: md.company || md.company_name || md.organization || "",
    name: md.name || md.full_name || md.user_name || "",
    email
  };

  // If metadata has enough, return quickly
  if ((metaProfile.company || metaProfile.name) && metaProfile.email) return metaProfile;

  // Try common table names (best-effort; won't throw)
  const uid = user.id;
  const tableCandidates = [
    { table:"user_profiles", idField:"auth_user_id" },
    { table:"profiles", idField:"auth_user_id" },
    { table:"users", idField:"id" },
    { table:"members", idField:"id" },
    { table:"user_accounts", idField:"auth_user_id" },
    { table:"accounts", idField:"auth_user_id" },
  ];

  for (const t of tableCandidates){
    try{
      const { data, error } = await sb.from(t.table).select("*").eq(t.idField, uid).maybeSingle();
      if (!error && data){
        return {
          company: data.company || data.company_name || data.organization || metaProfile.company || "",
          name: data.name || data.full_name || data.user_name || metaProfile.name || "",
          email: data.email || metaProfile.email || email
        };
      }
    }catch(_){}
  }

  // fallback
  return metaProfile.email ? metaProfile : null;
}

async function syncUserPillFromSession(){
  try{
    if (!sb?.auth) return;
    const { data } = await sb.auth.getSession();
    const session = data?.session;
    if(!session){
      // not logged in: keep placeholder but clear cache
      return;
    }
    const profile = await readProfileFromMetadataOrDB(session);
    if(profile){
      setUserPillText(profile);
      cacheUserProfile(profile);
    }else{
      // at least email
      setUserPillText({ company:"", name:"", email: session.user?.email || "" });
    }
  }catch(_){}
}

// On load: show cached immediately, then sync from live session
document.addEventListener("DOMContentLoaded", () => {
  ensureUserPill();
  hydrateUserPillFromCache();
  // small delay to let Supabase initialize
  setTimeout(syncUserPillFromSession, 0);
});

// Track auth changes (initial session, refresh, sign-in/out)
try{
  if (sb?.auth?.onAuthStateChange){
    sb.auth.onAuthStateChange((_event, session) => {
      // always resync UI
      if (session) {
        setTimeout(syncUserPillFromSession, 0);
      } else {
        // cleared session
        setUserPillText({company:"",name:"",email:""});
        try{ localStorage.removeItem(USER_CACHE_KEY);}catch(_){}
      }
    });
  }
}catch(_){}



if (!supabaseLib?.createClient) {
  console.error("Supabase SDK를 불러오지 못했습니다. CDN 로드를 확인해 주세요.");
}

window.sb = supabaseLib?.createClient?.(SUPABASE_URL, SUPABASE_KEY);
const sb = window.sb;
const PDF_HEADER = new Uint8Array([
  0x25,0x50,0x44,0x46,0x2D,0x31,0x2E,0x34,0x0A,
  0x25,0xE2,0xE3,0xCF,0xD3,0x0A
]);
const nowUtcMs = () => Date.now();
const toMs = (v) => (v ? new Date(v).getTime() : null);
function withinWindow(open_from, open_to){
  const now = nowUtcMs();
  const a = toMs(open_from);
  const b = toMs(open_to);
  if (a && now < a) return { ok:false, reason:"before", a, b };
  if (b && now > b) return { ok:false, reason:"after", a, b };
  return { ok:true, reason:"ok", a, b };
}

function isExpiredNow(){
  const w = withinWindow(state?.surveyWindow?.open_from, state?.surveyWindow?.open_to);
  return (w.reason === "after");
}
function isEditingLocked(){
  return !!state?.locked || isExpiredNow();
}

// ------------------ Submitted notice (topbar) ------------------
function ensureSubmitNoticeStyles(){
  if (document.getElementById("submitNoticeStyles")) return;
  const style = document.createElement("style");
  style.id = "submitNoticeStyles";
  style.textContent = `
    #submitNotice{
      margin-top:10px;
      padding:10px 12px;
      border-radius:12px;
      border:1px solid rgba(148,163,184,.55);
      background:rgba(241,245,249,.85);
      color:#0f172a;
      font-size:13px;
      line-height:1.35;
      font-weight:700;
    }
  `;
  document.head.appendChild(style);
}

function renderSubmitNotice(){
  ensureSubmitNoticeStyles();
  const headerEl = document.querySelector("header.topbar");
  const parent = headerEl?.parentNode || document.body;
  const periodEl = document.getElementById("surveyPeriodBox");

  let box = document.getElementById("submitNotice");
  if (!box){
    box = document.createElement("div");
    box.id = "submitNotice";
    // ✅ 항상 topbar/기간박스 바로 아래에 안전하게 삽입 (insertBefore 에러 방지)
    if (periodEl && periodEl.parentNode === parent){
      parent.insertBefore(box, periodEl.nextSibling);
    } else if (headerEl && headerEl.parentNode === parent){
      parent.insertBefore(box, headerEl.nextSibling);
    } else {
      parent.appendChild(box);
    }
  }

  const w = withinWindow(state?.surveyWindow?.open_from, state?.surveyWindow?.open_to);
  const expired = (w.reason === "after");

  // ✅ 기간 마감 시: 회수 불가 안내(자동 제출/제출 완료 상태 모두 포함)
  if (expired) {
    box.style.display = "block";
    box.textContent = "설문 제출 기간이 마감되었습니다. 기간 마감 시점 기준으로 임시저장된 내용은 자동 제출 처리되며, 마감 이후에는 회수/수정이 불가능합니다. (관리자에서 기간을 연장하면 회수 후 수정 가능)";
    return;
  }

  // ✅ 제출 완료(기간 미마감): 회수 안내
  if (state?.locked){
    box.style.display = "block";
    box.textContent = "제출이 완료된 설문입니다. 수정하시려면 회수하기 버튼을 누른 뒤 수정바랍니다. 수정 후 제출하기 버튼을 다시 눌러 제출하는 것을 잊지마세요.";
  } else {
    box.style.display = "none";
    box.textContent = "";
  }
}

// ------------------ Survey period (topbar/overview) ------------------
function ensureSurveyPeriodStyles(){
  if (document.getElementById("surveyPeriodStyles")) return;
  const style = document.createElement("style");
  style.id = "surveyPeriodStyles";
  style.textContent = `
    #surveyPeriodBox{
      margin-top:10px;
      padding:10px 12px;
      border-radius:12px;
      border:1px solid rgba(148,163,184,.55);
      background:rgba(255,255,255,.85);
      color:#0f172a;
      font-size:13px;
      line-height:1.35;
      font-weight:800;
    }
    #surveyPeriodBox .muted{
      font-weight:700;
      color:#334155;
    }
  

#surveyPeriodBox{
  margin-top:10px;
}
#surveyPeriodBox .countdown{
  margin-left:8px;
  font-weight:800;
}
#surveyPeriodBox.deadline-warning{
  border-color: rgba(255, 153, 0, .55);
  box-shadow: 0 0 0 3px rgba(255, 153, 0, .12);
}
#surveyPeriodBox.deadline-warning .countdown{
  color:#b45309; /* amber-700 */
}
#surveyPeriodBox.deadline-expired{
  border-color: rgba(220, 38, 38, .55);
  box-shadow: 0 0 0 3px rgba(220, 38, 38, .10);
}
#surveyPeriodBox .expired-msg{
  font-weight:900;
  color:#b91c1c;
}
#surveyPeriodBox .period-sub{
  margin-top:4px;
  font-size:12px;
  color: var(--muted);
  font-weight:700;
}

`;
  document.head.appendChild(style);
}

function fmtKST(v){
  if (!v) return "미설정";
  try{
    // 브라우저 로컬(한국) 기준 표기
    return new Date(v).toLocaleString("ko-KR", {
      year:"numeric", month:"2-digit", day:"2-digit",
      hour:"2-digit", minute:"2-digit",
      hour12:false
    });
  }catch(_){
    return String(v);
  }
}

function fmtCountdown(ms){
  const totalSec = Math.floor(ms/1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const pad = (n)=> String(n).padStart(2,"0");
  if (days > 0) return `D-${days} ${pad(hours)}:${pad(mins)}`;
  return `${pad(hours)}:${pad(mins)}`;
}

function renderSurveyPeriod(){
  ensureSurveyPeriodStyles();
  const headerEl = document.querySelector("header.topbar");
  const parent = headerEl?.parentNode || document.body;

  let box = document.getElementById("surveyPeriodBox");
  if (!box){
    box = document.createElement("div");
    box.id = "surveyPeriodBox";
    // topbar 바로 아래에 들어가도록
    if (headerEl && headerEl.nextSibling) parent.insertBefore(box, headerEl.nextSibling);
    else parent.appendChild(box);
  }

  const of = state?.surveyWindow?.open_from || null;
  const ot = state?.surveyWindow?.open_to || null;

  if (!of && !ot){
    box.style.display = "none";
    box.textContent = "";
    box.classList.remove("deadline-warning","deadline-expired");
    return;
  }

  const w = withinWindow(of, ot);
  const expired = (w.reason === "after");
  const before = (w.reason === "before");

  box.style.display = "block";
  box.classList.toggle("deadline-expired", expired);

  // ---- Countdown ----
  let countdownHtml = "";
  if (ot && !expired){
    const remainMs = Math.max(0, toMs(ot) - nowUtcMs());
    const warn = remainMs <= 24*60*60*1000; // 24h
    box.classList.toggle("deadline-warning", warn);

    countdownHtml = ` <span class="countdown">마감까지 ${fmtCountdown(remainMs)}</span>`;
  } else {
    box.classList.remove("deadline-warning");
  }

  if (expired){
    // 요구 문구
    box.innerHTML = `
      <span class="expired-msg">제출기한이 마감된 설문입니다.</span>
      <div class="period-sub">설문 기간: ${fmtKST(of)} ~ ${fmtKST(ot)}</div>
    `;
    return;
  }

  const statusTxt = before ? " (시작 전)" : "";
  box.innerHTML = `
    <span class="muted">설문 기간</span>: ${fmtKST(of)} ~ ${fmtKST(ot)}${statusTxt}${countdownHtml}
  `;
}


let _periodTickerStarted = false;
function startPeriodTicker(){
  if (_periodTickerStarted) return;
  _periodTickerStarted = true;
  setInterval(() => {
    try{
      if (state?.surveyWindow?.open_from || state?.surveyWindow?.open_to){
        renderSurveyPeriod();
      }
    }catch(_){ }
  }, 30000);
}

// (legacy) applyEditingLockUI 제거: updateSubmitUiState()/applyEditingLockToRenderedForm()로 일원화

// ------------------ Lock form inputs (read-only after submit/expiry) ------------------
function applyEditingLockToRenderedForm(){
  const blocked = isEditingLocked();
  // 상단 메타 입력
  const compEl = document.getElementById("targetCompany");
  const nameEl = document.getElementById("targetName");
  if (compEl) compEl.disabled = blocked;
  if (nameEl) nameEl.disabled = blocked;

  // 현재 렌더링된 문항 입력들
  const root = document.getElementById("userFormRoot");
  if (root){
    root.querySelectorAll("input, textarea, select").forEach((el) => {
      // 회수/제출/임시저장 버튼 등은 updateSubmitUiState에서 제어하므로 여기선 제외
      if (el.closest("#submitArea") || el.closest("#submitActions")) return;
      el.disabled = blocked || el.disabled; // rule-disabled는 유지
    });
  }

  renderSurveyPeriod();
  renderSubmitNotice();
}


// ------------------ Auth UI helpers ------------------
function showAuthError(msg){
  const el = document.getElementById("authError");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("show", !!msg);
}

function normalizeAuthError(error) {
  if (!error) return "";
  const message = error?.message || String(error);
  if (message === "Failed to fetch" && window.location?.protocol === "file:") {
    return "로컬 파일로 실행 중이면 인증 요청이 차단될 수 있습니다. http 서버로 열어주세요.";
  }
  return message;
}

function setAuthLoading(isLoading) {
  const btnLogin = document.getElementById("btnAuthLogin");
  const btnSignUp = document.getElementById("btnAuthSignUp");
  const email = document.getElementById("authEmail");
  const password = document.getElementById("authPassword");

  if (btnLogin) {
    btnLogin.disabled = isLoading;
    btnLogin.textContent = isLoading ? "로그인 중..." : "로그인";
  }
  if (btnSignUp) {
    btnSignUp.disabled = isLoading;
  }
  if (email) email.disabled = isLoading;
  if (password) password.disabled = isLoading;
}

function openAuthModal(){
  const bd = document.getElementById("authBackdrop");
  if (bd) bd.classList.remove("hidden");
  showAuthError("");
  const email = document.getElementById("authEmail");
  if (email) email.focus();
}

function closeAuthModal(){
  const bd = document.getElementById("authBackdrop");
  if (bd) bd.classList.add("hidden");
  showAuthError("");
}

async function requireLoginOrModal(){
  if (!sb?.auth) {
    openAuthModal();
    showAuthError("Supabase 설정을 불러오지 못했습니다. CDN/키 설정을 확인해 주세요.");
    throw new Error("Supabase auth client unavailable.");
  }

  // ✅ 여기 추가: getSession 실패해도 모달은 반드시 띄움
  try {
    const { data } = await sb.auth.getSession();
   if (data?.session) {
     closeAuthModal(); // ✅ 혹시 떠있으면 닫기
     return data.session;
   }  } catch (e) {
    openAuthModal();
    showAuthError(normalizeAuthError(e));
    throw e;
  }

  return new Promise((resolve, reject) => {
    openAuthModal();

    const btnLogin = document.getElementById("btnAuthLogin");
    const btnSignUp = document.getElementById("btnAuthSignUp");

    const doLogin = async () => {
      console.log("[AUTH] login click");
  showAuthError("로그인 요청 중...");
      try{
        setAuthLoading(true);
        const email = document.getElementById("authEmail")?.value?.trim();
        const password = document.getElementById("authPassword")?.value;
        if (!email || !password) {
          setAuthLoading(false);
          return showAuthError("이메일/비밀번호를 입력해 주세요.");
        }

        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) {
          setAuthLoading(false);
          return showAuthError(normalizeAuthError(error));
        }

        closeAuthModal();
        setAuthLoading(false);
        resolve(data.session);
      } catch (e){
        setAuthLoading(false);
        showAuthError(normalizeAuthError(e));
      }
    };

    const doSignUp = async () => {
      console.log("[AUTH] signup click");
  showAuthError("회원가입 요청 중...");
      try{
        setAuthLoading(true);
        const email = document.getElementById("authEmail")?.value?.trim();
        const password = document.getElementById("authPassword")?.value;
        if (!email || !password) {
          setAuthLoading(false);
          return showAuthError("이메일/비밀번호를 입력해 주세요.");
        }

        const { error } = await sb.auth.signUp({ email, password });
        if (error) {
          setAuthLoading(false);
          return showAuthError(normalizeAuthError(error));
        }

        showAuthError("회원가입 완료. 이제 로그인 버튼을 눌러주세요.");
        setAuthLoading(false);
      } catch (e){
        setAuthLoading(false);
        showAuthError(normalizeAuthError(e));
      }
    };

    if (btnLogin) btnLogin.onclick = doLogin;
    if (btnSignUp) btnSignUp.onclick = doSignUp;

    const pw = document.getElementById("authPassword");
    if (pw) pw.onkeydown = (ev) => { if (ev.key === "Enter") doLogin(); };
  });
}




  // ------------------ UI styles (disabled overlay) ------------------
// 룰로 비활성화된 문항 위에 '옅은 회색 음영 + 안내 문구'가 덮이도록 스타일을 주입합니다.
function ensureDisabledOverlayStyles() {
  if (document.getElementById("disabledOverlayStyles")) return;
  const style = document.createElement("style");
  style.id = "disabledOverlayStyles";
  style.textContent = `
    /* Make qcard a positioning context for the overlay */
    .qcard{ position:relative; }

    /* Disabled shading overlay */
    .disabled-overlay{
      position:absolute;
      inset:0;
      border-radius:16px;
      background:rgba(243,244,246,.78); /* light gray */
      backdrop-filter: blur(1.5px);
      display:flex;
      align-items:center;
      justify-content:center;
      padding:16px;
      pointer-events:none; /* inputs are disabled separately */
      z-index:5;
      animation: disabledOverlayIn .12s ease-out;
    }

    .disabled-overlay-text{
      display:inline-block;
      padding:10px 14px;
      border-radius:12px;
      background:rgba(255,255,255,.92);
      border:1px solid rgba(148,163,184,.45);
      color:#334155;
      font-weight:700;
      font-size:13px;
      line-height:1.25;
      text-align:center;
      box-shadow: 0 8px 18px rgba(15,23,42,.08);
    }

    /* Optional: slightly mute contents behind (still readable) */
    .qcard.disabled-by-rule > *:not(.disabled-overlay){
      filter:saturate(.85);
    }

    @keyframes disabledOverlayIn{
      from{ opacity:0; transform: translateY(-2px); }
      to{ opacity:1; transform: translateY(0); }
    }
      /* Floating Next/Prev buttons (bottom-right fixed) */
.nav-floating{
  position: fixed;
  right: 18px;
  bottom: 55px;
  z-index: 50;

  display: flex;
  gap: 10px;
  align-items: center;

  padding: 10px 12px;
  border-radius: 16px;
  background: rgba(255,255,255,.92);
  border: 1px solid rgba(148,163,184,.45);
  box-shadow: 0 12px 28px rgba(15,23,42,.14);
  backdrop-filter: blur(6px);
}

/* 버튼이 너무 커 보이면 여기서 조절 */
.nav-floating button{
  padding: 10px 14px;
  border-radius: 12px;
  font-weight: 800;
}

/* 모바일/작은 화면 대응 */
@media (max-width: 520px){
  .nav-floating{
    left: 12px;
    right: 12px;
    bottom: 12px;
    justify-content: space-between;
  }
  .nav-floating button{
    flex: 1;
  }
}
  `;
  document.head.appendChild(style);
}

  // ------------------ Utils ------------------
  const escapeHtml = (str) => {
    if (str === null || str === undefined) return "";
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  };

  const sanitizeFilename = (name) => {
    return String(name || "")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 60);
  };

  const num = (v, fb = 0) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : fb;
  };

  // ------------------ Excel(XML) helpers ------------------
  function xmlEscape(s) {
    if (s === null || s === undefined) return "";
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function buildExcelXmlWorkbook({ sheets }) {
    const wbHeader =
      `<?xml version="1.0"?>\n` +
      `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n` +
      ` xmlns:o="urn:schemas-microsoft-com:office:office"\n` +
      ` xmlns:x="urn:schemas-microsoft-com:office:excel"\n` +
      ` xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"\n` +
      ` xmlns:html="http://www.w3.org/TR/REC-html40">\n`;

    const styles = `
      <Styles>
        <Style ss:ID="sHeader">
          <Font ss:Bold="1"/>
          <Interior ss:Color="#D9E1F2" ss:Pattern="Solid"/>
        </Style>
        <Style ss:ID="sText">
          <Alignment ss:Vertical="Top" ss:WrapText="1"/>
        </Style>
      </Styles>\n`;

    const wsXml = (sheets || [])
      .map(({ name, rows }) => {
        const safeName = xmlEscape(name).slice(0, 30) || "Sheet";
        const rowXml = (rows || [])
          .map((r, ri) => {
            const cells = (r || [])
              .map((c) => {
                const v = c === null || c === undefined ? "" : String(c);
                const isHeader = ri === 0;
                const style = isHeader ? ' ss:StyleID="sHeader"' : ' ss:StyleID="sText"';
                return `<Cell${style}><Data ss:Type="String">${xmlEscape(v)}</Data></Cell>`;
              })
              .join("");
            return `<Row>${cells}</Row>`;
          })
          .join("\n");
        return `<Worksheet ss:Name="${safeName}"><Table>${rowXml}</Table></Worksheet>\n`;
      })
      .join("");

    return wbHeader + styles + wsXml + `</Workbook>`;
  }

  function parseExcelXmlTableToRows(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "text/xml");
    const parseErr = doc.getElementsByTagName("parsererror")[0];
    if (parseErr) throw new Error("엑셀(XML) 파싱 실패: 파일이 손상되었거나 형식이 다릅니다.");

    const worksheets = Array.from(doc.getElementsByTagName("Worksheet"));
    const out = new Map();

    worksheets.forEach((ws) => {
const SS_NS = "urn:schemas-microsoft-com:office:spreadsheet";
const name =
  ws.getAttribute("ss:Name") ||
  ws.getAttribute("Name") ||
  ws.getAttributeNS?.(SS_NS, "Name") ||
  "Sheet";
      const table = ws.getElementsByTagName("Table")[0];
      const rows = [];
      if (table) {
        const rowNodes = Array.from(table.getElementsByTagName("Row"));
        rowNodes.forEach((rn) => {
          const cells = Array.from(rn.getElementsByTagName("Cell"));
          const row = cells.map((cn) => {
            const data = cn.getElementsByTagName("Data")[0];
            return data ? data.textContent || "" : "";
          });
          rows.push(row);
        });
      }
      out.set(name, rows);
    });

    return out;
  }

  const ensureQuestionSpec = (q) => {
    q.answerSpec = q.answerSpec || {};
    if (!q.answerSpec.mode) q.answerSpec.mode = "YES_NO";

    // 기본 라벨
    if (q.answerSpec.yesLabel === undefined) q.answerSpec.yesLabel = "예";
    if (q.answerSpec.noLabel === undefined) q.answerSpec.noLabel = "아니오";
    if (q.answerSpec.naLabel === undefined) q.answerSpec.naLabel = "해당없음";

    // 배열 필드 기본값
    if (q.answerSpec.mode === "YES_CHECKBOX" && !Array.isArray(q.answerSpec.options)) q.answerSpec.options = [];
    if (q.answerSpec.mode === "YES_MULTI_TEXT" && !Array.isArray(q.answerSpec.fields)) q.answerSpec.fields = [];

    // TEXT 계열 기본 placeholder
    if (
      (q.answerSpec.mode === "YES_TEXT" ||
        q.answerSpec.mode === "TEXT" ||
        q.answerSpec.mode === "NA_TEXT" ||
        q.answerSpec.mode === "TEXT_MULTI") &&
      q.answerSpec.placeholder === undefined
    ) {
      q.answerSpec.placeholder = "";
    }

    // ✅ 관리자용과 동일하게 'items' 지원 (세부항목 렌더링용)
    // items: [{kind:'CHECK'|'TEXT', label, placeholder?}, ...]
    if (!Array.isArray(q.answerSpec.items)) q.answerSpec.items = [];
    q.evidence = q.evidence || {};
  if (q.evidence.enabled === undefined) q.evidence.enabled = false;
  if (q.evidence.required === undefined) q.evidence.required = false;
  };

  // ------------------ State ------------------
  const state = {
  locked: false,
  autoSubmitted: false,
  surveyWindow: { open_from: null, open_to: null },

    survey: { title: "", version: "", schemaVersion: 2, groups1: [], rules: [] },
    target: { company: "", name: "" },
    answers: {}, // qid -> { norm, checks:Set, text, fields:{} }
    evidenceFiles: {}, // qid -> [{ originalName, storedName, size, type, uploadedAt }]
    evidenceLibrary: {}, // fileId -> { fileId, originalName, storedName, size, type, uploadedAt }
    g2Index: [], // flat list of {g1, g2}
    currentG2Id: null,

    importFileBase: "", // 불러온 파일명(확장자 제외)
    treeOpen: {}, // g1.id -> boolean
  };

  // ------------------ Import survey (+ optional Responses) ------------------
  function importFromSheetRows(sheetMap) {
    const pick = (...names) => {
      for (const n of names) {
        if (sheetMap.has(n)) return sheetMap.get(n);
        for (const k of sheetMap.keys()) {
          if (String(k).toLowerCase() === String(n).toLowerCase()) return sheetMap.get(k);
        }
      }
      return null;
    };

    const metaRows = pick("Meta");
    const meta = {};
    if (metaRows && metaRows.length > 1) {
      for (let i = 1; i < metaRows.length; i++) {
        const [k, v] = metaRows[i] || [];
        if (!k) continue;
        meta[String(k).trim()] = v ?? "";
      }
    }

    const g1Rows = pick("G1");
    const g2Rows = pick("G2");
    const qRows = pick("Questions", "Question");
    const rRows = pick("Rules", "Rule");
    const respRows = pick("Responses", "Response");

    if (!g1Rows || g1Rows.length < 2)
      throw new Error("G1 시트가 없거나 비어 있습니다. (관리자 템플릿 엑셀인지 확인)");

    const newSurvey = { title: "", version: "", schemaVersion: 2, groups1: [], rules: [] };
    newSurvey.schemaVersion = Number(meta.schemaVersion) || 2;
    newSurvey.title = String(meta.title || "").trim();
    newSurvey.version = String(meta.version || "").trim();

    const g1ById = new Map();
    const g2ById = new Map();

    // G1
    for (let i = 1; i < g1Rows.length; i++) {
      const [id, name, w1] = g1Rows[i] || [];
      if (!id) continue;
      const g1 = { id, name: (name || "").trim(), weight1: num(w1, 0), groups2: [] };
      newSurvey.groups1.push(g1);
      g1ById.set(id, g1);
    }

    // G2
    if (g2Rows && g2Rows.length > 1) {
      for (let i = 1; i < g2Rows.length; i++) {
        const [g2id, g1id, name, w2, alloc] = g2Rows[i] || [];
        if (!g2id || !g1id) continue;
        const parent = g1ById.get(g1id);
        if (!parent) continue;
        const g2 = {
          id: g2id,
          name: (name || "").trim(),
          weight2: num(w2, 0),
          scoring: { questionAllocation: (alloc || "EQUAL").trim() || "EQUAL" },
          questions: [],
        };
        parent.groups2.push(g2);
        g2ById.set(g2id, g2);
      }
    }

    // Questions (관리자용과 동일한 헤더 기반 파싱 + items_json 지원)
    if (qRows && qRows.length > 1) {
      const header = (qRows[0] || []).map(h => String(h || "").trim());
      const findIdx = (key) => header.findIndex(h => h.toLowerCase() === String(key).toLowerCase());
      const findInc = (key) => header.findIndex(h => h.toLowerCase().includes(String(key).toLowerCase()));
      const get = (row, idx) => (idx >= 0 ? (row[idx] ?? "") : "");

      const idx_qid      = findInc("q_id");
      const idx_g2id     = findInc("g2_id");
      const idx_text     = findInc("q_text");
      const idx_guide    = findInc("guide");
      const idx_required = findInc("required");
      const idx_points   = findInc("points");
      const idx_mode     = findInc("mode");
      const idx_yes      = findInc("yeslabel");
      const idx_no       = findInc("nolabel");
      const idx_na       = findInc("nalabel");
      const idx_opts     = findInc("options");
      const idx_fields   = findInc("fields");
      const idx_ph       = findInc("placeholder");
      const idx_items    = findInc("items_json");

      for (let i = 1; i < qRows.length; i++) {
        const row = qRows[i] || [];
        const qid = String(get(row, idx_qid) || "").trim();
        const g2id = String(get(row, idx_g2id) || "").trim();
        const text = String(get(row, idx_text) || "").trim();
        if (!qid || !g2id) continue;

        const parent = g2ById.get(g2id);
        if (!parent) continue;

        const requiredStr = get(row, idx_required);
        const pointsStr = get(row, idx_points);
        const mode = String(get(row, idx_mode) || "YES_NO").trim() || "YES_NO";
        const yesLabel = String(get(row, idx_yes) || "").trim();
        const noLabel  = String(get(row, idx_no) || "").trim();
        const naLabel  = String(get(row, idx_na) || "").trim();
        const optionsStr = String(get(row, idx_opts) || "");
        const fieldsStr  = String(get(row, idx_fields) || "");
        const placeholder = String(get(row, idx_ph) || "");
        const itemsJsonStr = String(get(row, idx_items) || "").trim();

        const q = {
          id: qid,
          text: text,
          guide: String(get(row, idx_guide) || "").trim(),
          required: String(requiredStr).trim().toLowerCase() === "true",
          points: num(pointsStr, 0),
          answerSpec: { mode }
        };

        // labels
        if (mode === "YES_NO" || mode === "YES_CHECKBOX" || mode === "YES_TEXT" || mode === "YES_MULTI_TEXT") {
          q.answerSpec.yesLabel = yesLabel;
          q.answerSpec.noLabel = noLabel;
        }
        if (mode === "NA_ONLY" || mode === "NA_TEXT") {
          q.answerSpec.yesLabel = yesLabel;
          q.answerSpec.naLabel = naLabel;
        }

        // arrays/placeholder
        if (mode === "YES_CHECKBOX") {
          q.answerSpec.options = optionsStr ? optionsStr.split("|").map(s => s.trim()).filter(Boolean) : [];
        }
        if (mode === "YES_MULTI_TEXT") {
          q.answerSpec.fields = fieldsStr ? fieldsStr.split("|").map(s => s.trim()).filter(Boolean) : [];
        }
        if (mode === "YES_TEXT" || mode === "TEXT" || mode === "NA_TEXT" || mode === "TEXT_MULTI") {
          q.answerSpec.placeholder = placeholder || "";
        }

        // ✅ items_json 우선, 없으면 하위호환(옵션/필드로 재구성)
        if (itemsJsonStr) {
          try {
            const parsed = JSON.parse(itemsJsonStr);
            if (Array.isArray(parsed)) q.answerSpec.items = parsed;
          } catch (e) {}
        } else {
          const opts = optionsStr ? optionsStr.split("|").map(s => s.trim()).filter(Boolean) : [];
          const flds = fieldsStr  ? fieldsStr.split("|").map(s => s.trim()).filter(Boolean) : [];

          if (mode === "YES_NO") {
            const items = [];
            for (const lab of opts) items.push({ kind: "CHECK", label: lab, placeholder: "" });
            for (const lab of flds) items.push({ kind: "TEXT", label: lab, placeholder: "" });
            if (flds.length === 1 && (placeholder || "").trim()) {
              const last = items[items.length - 1];
              if (last && last.kind === "TEXT") last.placeholder = placeholder;
            }
            if (items.length) q.answerSpec.items = items;
          } else if (mode === "TEXT_MULTI") {
            const items = [];
            const labels = flds.length ? flds : (opts.length ? opts : []);
            for (const lab of labels) items.push({ kind: "TEXT", label: lab, placeholder: "" });
            if (!items.length) items.push({ kind: "TEXT", label: "주관식", placeholder: placeholder || "" });
            if (items.length === 1 && (placeholder || "").trim()) items[0].placeholder = placeholder;
            q.answerSpec.items = items;
          }
        }

        ensureQuestionSpec(q);
        parent.questions.push(q);
      }
    }

    // Rules
    newSurvey.rules = [];
    if (rRows && rRows.length > 1) {
      for (let i = 1; i < rRows.length; i++) {
        const [rid, triggerQid, eq, action, targetsStr] = rRows[i] || [];
        if (!rid && !triggerQid) continue;
newSurvey.rules.push({
  id: String(rid || "").trim(),
  trigger: {
    questionId: String(triggerQid || "").trim(),
    equals: String(eq || "").trim().toUpperCase(),
  },
  action: String(action || "").trim().toUpperCase(),
  targetQuestionIds: targetsStr
    ? String(targetsStr).split("|").map((s) => s.trim()).filter(Boolean)
    : [],
});

      }
    }

    state.survey = newSurvey;

    // ✅ 트리 open 상태는 새 설문 불러올 때 초기화 (기본: 모두 열림)
    state.treeOpen = {};

    // Build flat G2 index
    state.g2Index = [];
    for (const g1 of state.survey.groups1) {
      for (const g2 of g1.groups2 || []) state.g2Index.push({ g1, g2 });
    }
    state.currentG2Id = state.g2Index[0]?.g2?.id || null;

    // Optional: Responses
    if (respRows && respRows.length > 1) {
      const answers = {};
      let company = "";
      let name = "";
      for (let i = 1; i < respRows.length; i++) {
        const [c, n, qid, norm, checksStr, text, fieldsJson] = respRows[i] || [];
        if (!qid) continue;
        company = company || (c || "");
        name = name || (n || "");
        answers[qid] = {
          norm: norm || "",
          checks: new Set((checksStr || "").split("|").filter(Boolean)),
          text: text || "",
          fields: (() => {
            try {
              return fieldsJson ? JSON.parse(fieldsJson) : {};
            } catch {
              return {};
            }
          })(),
        };
      }
      state.answers = answers;
      state.target.company = company || state.target.company;
      state.target.name = name || state.target.name;
    } else {
      state.answers = {};
    }

    renderAll();
  }
function applySurveyJsonFromServer(surveyJson){
  if (!surveyJson) throw new Error("서버 설문 데이터(survey_json)가 비어있습니다.");

  state.survey = surveyJson;

  state.treeOpen = {};
  state.answers = {};

  state.g2Index = [];
  for (const g1 of state.survey.groups1 || []) {
    for (const g2 of g1.groups2 || []) state.g2Index.push({ g1, g2 });
  }
  state.currentG2Id = state.g2Index[0]?.g2?.id || null;

  renderAll();
}

async function loadSurveyByCode(){
  const code = (document.getElementById("surveyCodeInput")?.value || "").trim().toLowerCase();
  if (!code) return alert("설문 코드를 입력해 주세요.");

  await requireLoginOrModal();

  // ✅ RPC로 "공개 설문 1개"만 가져오기
  const { data, error } = await sb.rpc("get_published_survey_by_code", { p_code: code });

  if (error) throw error;
  if (!data || !data.length) throw new Error("해당 코드의 설문을 찾지 못했습니다. (코드/게시 여부 확인)");

  const row = data[0];
  state.server = { id: row.id, code: row.code, title: row.title || "" };
  // 설문 기간(open_from/open_to) 로드
// ✅ 주의: surveys 테이블은 사용자 RLS로 select가 막혀 있을 수 있으므로,
//    1) RPC 결과(row)에 open_from/open_to가 포함되면 그 값을 사용
//    2) 없으면 surveys select 시도
//    3) 그래도 안 되면 보조 RPC(get_survey_window_by_id)로 조회 (SQL 아래 제공)
try{
  if (row.open_from || row.open_to){
    state.surveyWindow = { open_from: row.open_from || null, open_to: row.open_to || null };
  } else {
    const { data: wrow, error: werr } = await sb
      .from("surveys")
      .select("open_from, open_to")
      .eq("id", row.id)
      .maybeSingle();

    if (!werr && wrow){
      state.surveyWindow = { open_from: wrow.open_from || null, open_to: wrow.open_to || null };
    } else {
      // RLS 차단 가능 → 보조 RPC로 재시도
      const { data: w2, error: e2 } = await sb.rpc("get_survey_window_by_id", { p_id: row.id });
      if (!e2 && w2){
        state.surveyWindow = { open_from: w2.open_from || null, open_to: w2.open_to || null };
      } else {
        state.surveyWindow = { open_from: null, open_to: null };
      }
    }
  }
} catch(_){
  try{
    const { data: w2, error: e2 } = await sb.rpc("get_survey_window_by_id", { p_id: row.id });
    if (!e2 && w2){
      state.surveyWindow = { open_from: w2.open_from || null, open_to: w2.open_to || null };
    } else {
      state.surveyWindow = { open_from: null, open_to: null };
    }
  } catch(__){
    state.surveyWindow = { open_from: null, open_to: null };
  }
}

  // ✅ 설문 메타 캐시(설문 관리 목록 표시용)
  try{
    cacheSurveyMeta(row.id, {
      code: row.code || "",
      title: row.title || "",
      open_from: state.surveyWindow?.open_from || null,
      open_to: state.surveyWindow?.open_to || null,
    });
  }catch(_){}



  // 기간 체크 (마감이면 로드 직후 자동 제출 시도)
  await maybeAutoSubmitIfExpired();
  const w = withinWindow(state.surveyWindow?.open_from, state.surveyWindow?.open_to);
  if (!w.ok && w.reason === "before"){
    alert("아직 설문 작성 기간이 시작되지 않았습니다.");
  }
  if (!w.ok && w.reason === "after"){
    // 마감 후에는 제출/임시저장/회수 불가 (자동 제출은 위에서 처리)
    updateSubmitUiState();
  }
  applySurveyJsonFromServer(row.survey_json);
  await loadMyDraftForCurrentSurvey();
  // 마감 여부에 따라 버튼 상태 반영
  updateSubmitUiState();

  const titleEl = document.getElementById("surveyTitleUser");
  if (titleEl) titleEl.value = row.title || "";

  alert(`설문 불러오기 완료!\n- 설문명: ${row.title || ""}\n- 설문 코드: ${row.code || ""}`);
}


  function importFromExcelXml(xmlText) {
    const sheetMap = parseExcelXmlTableToRows(xmlText);
    importFromSheetRows(sheetMap);
  }

  // ------------------ Export filled survey ------------------
  function exportFilledSurveyAsExcelXml() {
    if (!state.survey?.groups1?.length) throw new Error("설문이 없습니다. 먼저 설문을 불러오세요.");

    const company = (state.target.company || "").trim();
    const name = (state.target.name || "").trim();

    const metaRows = [
      ["key", "value"],
      ["schemaVersion", String(state.survey.schemaVersion || 2)],
      ["title", String(state.survey.title || "")],
      ["version", String(state.survey.version || "")],
    ];

    const g1Rows = [["g1_id", "g1_name", "weight1(%)"]];
    const g2Rows = [["g2_id", "g1_id", "g2_name", "weight2(%)", "questionAllocation(EQUAL|MANUAL)"]];
const qRows = [
  [
    "q_id",
    "g2_id",
    "q_text",
    "guide",
    "required(true|false)",
    "points",
    "mode",
    "yesLabel",
    "noLabel",
    "naLabel",
    "options(pipe | separated)",
    "fields(pipe | separated)",
    "placeholder",
    "items_json",
  ],
];

    const rRows = [["rule_id", "trigger_qid", "equals(YES|NO|NA)", "action", "target_qids(pipe | separated)"]];

    for (const g1 of state.survey.groups1 || []) {
      g1Rows.push([g1.id, g1.name || "", String(Number(g1.weight1 || 0))]);
      for (const g2 of g1.groups2 || []) {
        const alloc = g2?.scoring?.questionAllocation || "EQUAL";
        g2Rows.push([g2.id, g1.id, g2.name || "", String(Number(g2.weight2 || 0)), String(alloc)]);
        for (const q of g2.questions || []) {
          ensureQuestionSpec(q);
          const as = q.answerSpec || {};

qRows.push([
  q.id,
  g2.id,
  q.text || "",
  q.guide || "",                               // ✅ 추가
  q.required ? "true" : "false",
  String(Number(q.points || 0)),
  as.mode || "YES_NO",
  as.yesLabel || "",
  as.noLabel || "",
  as.naLabel || "",
  Array.isArray(as.options) ? as.options.join("|") : "",
  Array.isArray(as.fields) ? as.fields.join("|") : "",
  as.placeholder || "",
  JSON.stringify(Array.isArray(as.items) ? as.items : []), // ✅ 추가(핵심)
]);

        }
      }
    }

    for (const r of state.survey.rules || []) {
      rRows.push([
        r.id || "",
        r.trigger?.questionId || "",
        r.trigger?.equals || "",
        r.action || "",
        Array.isArray(r.targetQuestionIds) ? r.targetQuestionIds.join("|") : "",
      ]);
    }

    const respRows = [["company", "name", "q_id", "norm", "checks(pipe)", "text", "fields_json"]];
    for (const g1 of state.survey.groups1 || []) {
      for (const g2 of g1.groups2 || []) {
        for (const q of g2.questions || []) {
          const ans = state.answers[q.id] || { norm: "", checks: new Set(), text: "", fields: {} };
          respRows.push([
            company,
            name,
            q.id,
            ans.norm || "",
            Array.from(ans.checks || []).join("|"),
            ans.text || "",
            JSON.stringify(ans.fields || {}),
          ]);
        }
      }
    }

    const xml = buildExcelXmlWorkbook({
      sheets: [
        { name: "Meta", rows: metaRows },
        { name: "G1", rows: g1Rows },
        { name: "G2", rows: g2Rows },
        { name: "Questions", rows: qRows },
        { name: "Rules", rows: rRows },
        { name: "Responses", rows: respRows },
      ],
    });

    // ✅ 제목은 "불러온 파일명(확장자 제외)" 우선
    const title = sanitizeFilename(state.importFileBase || state.survey.title || "survey");
    const outName = `${title}_${sanitizeFilename(company || "company")}_${sanitizeFilename(name || "name")}.xls`;

    const blob = new Blob([xml], { type: "application/vnd.ms-excel" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = outName;
    a.click();
  }

  // ------------------ Rules (disable set) ------------------
function computeDisabledSetFromUserAnswers() {
  const disabled = new Set();

  for (const r of state.survey.rules || []) {
    const action = String(r?.action || "").trim().toUpperCase();
    if (action !== "DEACTIVATE_QUESTIONS_IN_G2") continue;

    const qid = String(r?.trigger?.questionId || "").trim();
    const eq  = String(r?.trigger?.equals || "").trim().toUpperCase(); // YES/NO/NA
    if (!qid || !eq) continue;

    const actual = String(state.answers[qid]?.norm || "").trim().toUpperCase();
    if (actual !== eq) continue;

    const targets = Array.isArray(r.targetQuestionIds) ? r.targetQuestionIds : [];
    for (const t of targets) disabled.add(t);
  }

  return disabled;
}



  // ------------------ Partial UI update (no full rerender on typing/checking) ------------------
  function applyDisabledToCard(qid, isDisabled) {
    const card = document.querySelector(`.qcard[data-qid="${CSS.escape(qid)}"]`);
    if (!card) return;
    const already = card.classList.contains("disabled-by-rule");
    if (already === !!isDisabled) return;

    card.classList.toggle("disabled-by-rule", !!isDisabled);

    // overlay toggle
    let ov = card.querySelector(".disabled-overlay");
    if (isDisabled) {
      if (!ov) {
        ov = document.createElement("div");
        ov.className = "disabled-overlay";
        ov.innerHTML = `<div class="disabled-overlay-text">이전 문항 답변에 따라 비활성화 되었습니다.</div>`;
        card.appendChild(ov);
      }
    } else {
      if (ov) ov.remove();
    }

    // force-disable inputs inside this card when disabled
    card.querySelectorAll("#ctrl_" + CSS.escape(qid) + " input, #ctrl_" + CSS.escape(qid) + " textarea, #ctrl_" + CSS.escape(qid) + " select, #ctrl_" + CSS.escape(qid) + " button").forEach((el) => {
      el.disabled = !!isDisabled;
    });

    // If re-enabled, reapply per-item enabling (e.g., CHECK.withText) by re-running renderControls on this card only
    if (!isDisabled) {
      const q = (state._currentQuestions || []).find((qq) => qq.id === qid);
      if (!q) return;
      ensureQuestionSpec(q);
      const ans = ensureAnswer(q);
      const c = card.querySelector(`#ctrl_${CSS.escape(qid)}`);
      if (c) {
        renderControls(c, q, ans, {
          disabled: isEditingLocked(),
          onAnswerChanged: () => handleAnswerChanged(),
        });
      }
    }
  }

function handleAnswerChanged() {
  const disabledSet = computeDisabledSetFromUserAnswers();

  // ✅ 룰 결과가 이전과 같으면 아무 것도 하지 않음 (커서 튐 방지 핵심)
  const key = Array.from(disabledSet).sort().join("|");
  if (state._disabledKey === key) return;

  state._disabledKey = key;
  state._currentDisabledSet = disabledSet;

  // Update only visible/current G2 cards
  const qs = state._currentQuestions || [];
  qs.forEach((q) => applyDisabledToCard(q.id, disabledSet.has(q.id)));
}



  // ------------------ Answer UI ------------------
  function ensureAnswer(q) {
    if (!state.answers[q.id]) {
      const mode = q.answerSpec?.mode || "YES_NO";
      state.answers[q.id] = {
        norm: mode === "NA_ONLY" || mode === "NA_TEXT" ? "NA" : "",
        checks: new Set(),
        text: "",
        fields: {},
      };
    }
    return state.answers[q.id];
  }

  function renderControls(container, q, ans, { disabled = false, onAnswerChanged = null } = {}) {
    const mode = q.answerSpec?.mode || "YES_NO";
    const yesLabel = q.answerSpec?.yesLabel || "예";
    const noLabel = q.answerSpec?.noLabel || "아니오";
    const naLabel = q.answerSpec?.naLabel || "해당없음";

    const applyDisabled = () => {
      if (!disabled) return;
      container.querySelectorAll("input, textarea, select, button").forEach((el) => (el.disabled = true));
      container.style.opacity = "0.55";
    };

const radioHtml = (name, options) =>
  `
    <div class="answer-radio-group">
      ${options.map(({ value, label }) => `
        <label class="answer-radio-row">
          <input type="radio" name="${name}" value="${value}" ${ans.norm === value ? "checked" : ""}>
          <span>${escapeHtml(label)}</span>
        </label>
      `).join("")}
    </div>
  `;

    const setNorm = (v) => {
      ans.norm = v;
    };

    // YES/NO (+ items: CHECK/TEXT)
    if (mode === "YES_NO") {
      const items = Array.isArray(q.answerSpec?.items) ? q.answerSpec.items : [];

      const drawItems = () => {
        const host = container.querySelector(`#items_${CSS.escape(q.id)}`);
        if (!host) return;
        if (!items.length) {
          host.innerHTML = "";
          return;
        }

        const enabled = ans.norm === "YES";
const html = items.map((it, idx) => {
  const kind = (it?.kind || "").toUpperCase();
  const label = String(it?.label || (kind === "CHECK" ? `체크${idx + 1}` : `입력${idx + 1}`));
  const ph = String(it?.placeholder || q.answerSpec?.placeholder || "");

  if (kind === "CHECK") {
    const checked = ans.checks.has(label);
    const withText = !!it.withText;
    const v = ans.fields[label] || "";
    const inputHtml = withText
      ? `
        <div class="answer-sub-inline">
          <input
            class="input answer-sub-text"
            type="text"
            data-t="${escapeHtml(label)}"
            value="${escapeHtml(v)}"
            placeholder="${escapeHtml(ph || "")}"
            ${enabled && checked ? "" : "disabled"}>
        </div>
      `
      : "";

    return `
      <div class="answer-sub-item">
        <label class="answer-check-row">
          <input type="checkbox" data-k="${escapeHtml(label)}" ${checked ? "checked" : ""} ${enabled ? "" : "disabled"}>
          <span>${escapeHtml(label)}</span>
        </label>
        ${inputHtml}
      </div>
    `;
  }

  const v = ans.fields[label] || "";
  return `
    <div class="answer-sub-item">
      <div class="hint answer-sub-label">${escapeHtml(label)}</div>
      <textarea
        rows="3"
        data-k="${escapeHtml(label)}"
        class="answer-sub-textarea"
        placeholder="${escapeHtml(ph)}"
        ${enabled ? "" : "disabled"}>${escapeHtml(v)}</textarea>
    </div>
  `;
}).join("");

host.innerHTML = `
  <div class="answer-subgroup ${ans.norm === "YES" ? "is-open" : "is-closed"}">
    ${html}
  </div>
`;

        host.querySelectorAll("input[type=checkbox]").forEach((cb) => {
          cb.onchange = (e) => {
            const k = e.target.getAttribute("data-k");
            if (!k) return;
            if (e.target.checked) ans.checks.add(k);
            else ans.checks.delete(k);
            onAnswerChanged?.();
          };
        });
        host.querySelectorAll("input[data-t]").forEach((inp) => {
          inp.oninput = (e) => {
            const k = e.target.getAttribute("data-t");
            if (!k) return;
            ans.fields[k] = e.target.value;
            onAnswerChanged?.();
          };
        });
        host.querySelectorAll("textarea").forEach((ta) => {
          ta.oninput = (e) => {
            const k = e.target.getAttribute("data-k");
            if (!k) return;
            ans.fields[k] = e.target.value;
            onAnswerChanged?.();
          };
        });
      };

container.innerHTML = `
  <div class="answer-main-group">
    <label class="answer-radio-row">
      <input type="radio" name="norm_${escapeHtml(q.id)}" value="YES" ${ans.norm === "YES" ? "checked" : ""}>
      <span>${escapeHtml(yesLabel)}</span>
    </label>

    <div id="items_${escapeHtml(q.id)}"></div>

    <label class="answer-radio-row">
      <input type="radio" name="norm_${escapeHtml(q.id)}" value="NO" ${ans.norm === "NO" ? "checked" : ""}>
      <span>${escapeHtml(noLabel)}</span>
    </label>
  </div>
`;

      container.querySelectorAll(`input[name="norm_${q.id}"]`).forEach((r) => {
        r.onchange = (e) => {
          setNorm(e.target.value);
          // NO로 바꾸면 items 입력/체크 초기화(옵션)
          if (e.target.value !== "YES") {
            ans.checks = new Set();
            ans.fields = {};
          }
          drawItems();
          onAnswerChanged?.();
        };
      });

      drawItems();
      applyDisabled();
      return;
    }

    // NA only
    if (mode === "NA_ONLY") {
      container.innerHTML = `<div>${radioHtml(`norm_${q.id}`, [{ value: "NA", label: naLabel }])}</div>`;
      container.querySelectorAll(`input[name="norm_${q.id}"]`).forEach((r) => {
        r.onchange = (e) => {
          setNorm(e.target.value);
          onAnswerChanged?.();
        };
      });
      applyDisabled();
      return;
    }

    // YES_TEXT / TEXT
    if (mode === "YES_TEXT" || mode === "TEXT") {
      container.innerHTML = `
        <div>${radioHtml(`norm_${q.id}`, [
          ...(mode === "YES_TEXT"
            ? [
                { value: "YES", label: yesLabel },
                { value: "NO", label: noLabel },
              ]
            : []),
        ])}</div>
        <div style="margin-top:8px;">
          <textarea rows="3" style="width:100%;" placeholder="${escapeHtml(q.answerSpec?.placeholder || "")}">${escapeHtml(
        ans.text || ""
      )}</textarea>
        </div>
      `;
      const ta = container.querySelector("textarea");
      if (ta) {
        ta.oninput = (e) => {
          ans.text = e.target.value;
          onAnswerChanged?.();
        };
      }
      if (mode === "YES_TEXT") {
        container.querySelectorAll(`input[name="norm_${q.id}"]`).forEach((r) => {
          r.onchange = (e) => {
            setNorm(e.target.value);
            onAnswerChanged?.();
          };
        });
      }
      applyDisabled();
      return;
    }

    // NA_TEXT: YES + NA + textarea(NA일 때만 활성)
    if (mode === "NA_TEXT") {
      const name = `norm_${q.id}`;

      const drawTextEnabled = () => {
        const ta = container.querySelector("textarea");
        if (!ta) return;
        const enabled = ans.norm === "NA";
        ta.disabled = disabled || !enabled;
        ta.style.opacity = !disabled && enabled ? "1" : "0.55";
      };

      container.innerHTML = `
        <div>${radioHtml(name, [
          { value: "YES", label: yesLabel },
          { value: "NA",  label: naLabel }
        ])}</div>
        <div style="margin-top:8px;">
          <textarea rows="3" style="width:100%;" placeholder="${escapeHtml(q.answerSpec?.placeholder || "")}">${escapeHtml(
        ans.text || ""
      )}</textarea>
          <div class="hint" style="margin-top:6px;">※ ‘${escapeHtml(naLabel)}’ 선택 시에만 사유를 입력합니다.</div>
        </div>
      `;

      container.querySelectorAll(`input[name="${name}"]`).forEach((r) => {
        r.onchange = (e) => {
          setNorm(e.target.value);
          drawTextEnabled();
          onAnswerChanged?.();
        };
      });

      const ta = container.querySelector("textarea");
      if (ta) {
        ta.oninput = (e) => {
          ans.text = e.target.value;
          onAnswerChanged?.();
        };
      }

      drawTextEnabled();
      applyDisabled();
      return;
    }

    // YES_CHECKBOX
if (mode === "YES_CHECKBOX") {
  const opts = q.answerSpec?.options || [];
  const name = `norm_${q.id}`;

  const drawYesChecks = () => {
    const yesHost = container.querySelector(`#yes_chk_${CSS.escape(q.id)}`);
    if (!yesHost) return;

    if (ans.norm !== "YES" || !opts.length) {
      yesHost.innerHTML = "";
      return;
    }

    yesHost.innerHTML = `
      <div class="answer-subgroup is-open">
        ${opts.map((o, idx) => {
          const key = String(o || `옵션${idx + 1}`);
          const checked = ans.checks.has(key);
          return `
            <div class="answer-sub-item">
              <label class="answer-check-row">
                <input type="checkbox" data-key="${escapeHtml(key)}" ${checked ? "checked" : ""}>
                <span>${escapeHtml(key)}</span>
              </label>
            </div>
          `;
        }).join("")}
      </div>
    `;

    yesHost.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.onchange = (e) => {
        const k = e.target.getAttribute("data-key");
        if (!k) return;

        if (e.target.checked) ans.checks.add(k);
        else ans.checks.delete(k);

        onAnswerChanged?.();
      };
    });
  };

  container.innerHTML = `
    <div class="answer-main-group">
      <label class="answer-radio-row">
        <input type="radio" name="${name}" value="YES" ${ans.norm === "YES" ? "checked" : ""}>
        <span>${escapeHtml(yesLabel)}</span>
      </label>

      <div id="yes_chk_${escapeHtml(q.id)}"></div>

      <label class="answer-radio-row">
        <input type="radio" name="${name}" value="NO" ${ans.norm === "NO" ? "checked" : ""}>
        <span>${escapeHtml(noLabel)}</span>
      </label>
    </div>
  `;

  container.querySelectorAll(`input[name="${name}"]`).forEach((r) => {
    r.onchange = (e) => {
      setNorm(e.target.value);

      if (e.target.value !== "YES") {
        ans.checks = new Set();
      }

      drawYesChecks();
      onAnswerChanged?.();
    };
  });

  drawYesChecks();
  applyDisabled();
  return;
}

    // YES_MULTI_TEXT
    if (mode === "YES_MULTI_TEXT") {
      const fields = q.answerSpec?.fields || [];

container.innerHTML = `
  <div class="answer-main-group">
    ${radioHtml(`norm_${q.id}`, [
      { value: "YES", label: yesLabel },
      { value: "NO",  label: noLabel }
    ])}
  </div>
  <div style="margin-top:8px;" id="mf_${escapeHtml(q.id)}"></div>
`;

const drawMultiFields = () => {
  const host = container.querySelector(`#mf_${CSS.escape(q.id)}`);
  if (!host) return;

  host.innerHTML = `
    <div class="answer-subgroup ${ans.norm === "YES" ? "is-open" : "is-closed"}">
      ${(fields || []).map((f) => {
        const key = String(f || "");
        const val = ans.fields[key] || "";
        return `
          <div class="answer-sub-item">
            <div class="hint answer-sub-label">${escapeHtml(key)}</div>
            <input type="text" class="input answer-sub-text" data-k="${escapeHtml(key)}" value="${escapeHtml(val)}" ${ans.norm === "YES" ? "" : "disabled"}>
          </div>
        `;
      }).join("")}
    </div>
  `;

  host.querySelectorAll("input[type=text]").forEach((inp) => {
    inp.oninput = (e) => {
      const k = e.target.getAttribute("data-k");
      if (!k) return;
      ans.fields[k] = e.target.value;
      onAnswerChanged?.();
    };
  });
};

container.querySelectorAll(`input[name="norm_${q.id}"]`).forEach((r) => {
  r.onchange = (e) => {
    setNorm(e.target.value);
    drawMultiFields();
    onAnswerChanged?.();
  };
});

drawMultiFields();
applyDisabled();
return;

      const host = container.querySelector(`#mf_${CSS.escape(q.id)}`);
      if (host) {
        host.innerHTML = fields
          .map((f) => {
            const key = String(f || "");
            const val = ans.fields[key] || "";
            return `
              <div style="margin-top:6px;">
                <div class="hint">${escapeHtml(key)}</div>
                <input type="text" data-k="${escapeHtml(key)}" value="${escapeHtml(val)}" style="width:100%;">
              </div>
            `;
          })
          .join("");

        host.querySelectorAll("input[type=text]").forEach((inp) => {
          inp.oninput = (e) => {
            const k = e.target.getAttribute("data-k");
            if (!k) return;
            ans.fields[k] = e.target.value;
            onAnswerChanged?.();
          };
        });
      }

      applyDisabled();
      return;
    }

    
    // TEXT_MULTI (items 기반: 여러 개 주관식 입력)
    if (mode === "TEXT_MULTI") {
      const items = Array.isArray(q.answerSpec?.items) && q.answerSpec.items.length
        ? q.answerSpec.items
        : [{ kind: "TEXT", label: "주관식", placeholder: q.answerSpec?.placeholder || "" }];

      container.innerHTML = `
        <div class="hint" style="margin-bottom:8px;">아래 항목을 입력하세요.</div>
        <div id="tm_${escapeHtml(q.id)}"></div>
      `;

      const host = container.querySelector(`#tm_${CSS.escape(q.id)}`);
      if (host) {
        host.innerHTML = items.map((it, idx) => {
          const label = String(it?.label || `항목${idx + 1}`);
          const ph = String(it?.placeholder || q.answerSpec?.placeholder || "");
          const v = ans.fields[label] || ans.text || "";
          const rows = items.length === 1 ? 4 : 3;
          return `
            <div style="margin-top:8px;">
              <div class="hint">${escapeHtml(label)}</div>
              <textarea rows="${rows}" data-k="${escapeHtml(label)}" style="width:100%;" placeholder="${escapeHtml(ph)}">${escapeHtml(v)}</textarea>
            </div>
          `;
        }).join("");

        host.querySelectorAll("input[data-t]").forEach((inp) => {
          inp.oninput = (e) => {
            const k = e.target.getAttribute("data-t");
            if (!k) return;
            ans.fields[k] = e.target.value;
            onAnswerChanged?.();
          };
        });
        host.querySelectorAll("textarea").forEach((ta) => {
          ta.oninput = (e) => {
            const k = e.target.getAttribute("data-k");
            if (!k) return;
            ans.fields[k] = e.target.value;
            // 단일 항목인 경우 기존 ans.text도 같이 동기화(내보내기 호환)
            if (items.length === 1) ans.text = e.target.value;
            onAnswerChanged?.();
          };
        });
      }

      applyDisabled();
      return;
    }

// fallback
    container.innerHTML = `<div class="hint">지원하지 않는 문항 타입: ${escapeHtml(mode)}</div>`;
    applyDisabled();
  }
// ------------------ UX helpers: scroll + tree follow ------------------
function findScrollableAncestor(el) {
  let cur = el;
  while (cur && cur !== document.body) {
    const cs = window.getComputedStyle(cur);
    const oy = cs.overflowY;
    const canScroll = (oy === "auto" || oy === "scroll") && cur.scrollHeight > cur.clientHeight;
    if (canScroll) return cur;
    cur = cur.parentElement;
  }
  return null;
}

function scrollCanvasTop() {
  const root = document.getElementById("userFormRoot");
  if (!root) return;

  const scroller = findScrollableAncestor(root);
  if (scroller && typeof scroller.scrollTo === "function") {
    scroller.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    // 최후 fallback
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}



function getCurrentG1IdByG2Id(g2Id) {
  if (!state?.survey?.groups1 || !g2Id) return null;
  for (const g1 of state.survey.groups1) {
    for (const g2 of g1.groups2 || []) {
      if (g2.id === g2Id) return g1.id;
    }
  }
  return null;
}

function syncTreeToCurrentG2() {
  // 현재 G2가 속한 G1만 열고, 나머지는 닫기
  const g1Id = getCurrentG1IdByG2Id(state.currentG2Id);
  if (!g1Id) return;

  // treeOpen이 없으면 생성
  if (!state.treeOpen) state.treeOpen = {};

  // 모두 닫고 현재만 열기
  for (const g1 of state.survey.groups1 || []) state.treeOpen[g1.id] = false;
  state.treeOpen[g1Id] = true;
}
function getSurveyEvidenceSettings(){
  const es = state?.survey?.evidenceSettings || {};
  return {
    enabled: es.enabled !== false,
    defaultMaxFiles: Math.max(1, Number(es.defaultMaxFiles || 5)),
    defaultMaxSizeMB: Math.max(1, Number(es.defaultMaxSizeMB || 200)),
    allowedExt: Array.isArray(es.allowedExt)
      ? es.allowedExt.map(x => String(x).trim().toLowerCase()).filter(Boolean)
      : ["pdf", "jpg", "jpeg", "png", "xlsx", "xls", "docx", "doc", "zip"],
    totalSurveyLimitMB: Math.max(1, Number(es.totalSurveyLimitMB || 1024))
  };
}

function isEvidenceEnabledForQuestion(q){
  const es = getSurveyEvidenceSettings();
  return !!(es.enabled && q?.evidence?.enabled);
}

function getEvidenceFiles(qid){
  if (!Array.isArray(state.evidenceFiles[qid])) state.evidenceFiles[qid] = [];
  return state.evidenceFiles[qid];
}

function getEvidenceLibraryArray(){
  const lib = state.evidenceLibrary || {};
  return Object.values(lib);
}

function getLinkedQuestionsForFile(fileMeta){
  const out = [];
  if (!fileMeta) return out;

  for (const g1 of state.survey.groups1 || []) {
    for (const g2 of g1.groups2 || []) {
      for (const q of g2.questions || []) {
        const files = getEvidenceFiles(q.id);

        const linked = files.some(f => {
          // 신형 구조: fileId 비교
          if (fileMeta.fileId && f.fileId && f.fileId === fileMeta.fileId) return true;

          // 구형 구조 호환: storedName 비교
          if (fileMeta.storedName && f.storedName && f.storedName === fileMeta.storedName) return true;

          return false;
        });

        if (linked) {
          out.push({
            qid: q.id,
            g1Name: g1.name || "",
            g2Name: g2.name || "",
            qText: q.text || ""
          });
        }
      }
    }
  }

  return out;
}

function removeLibraryFile(fileKey){
  if (!fileKey) return;

  for (const [k, meta] of Object.entries(state.evidenceLibrary || {})) {
    if ((meta.fileId || meta.storedName) === fileKey || k === fileKey) {
      delete state.evidenceLibrary[k];
    }
  }

  for (const qid of Object.keys(state.evidenceFiles || {})) {
    state.evidenceFiles[qid] = (state.evidenceFiles[qid] || []).filter(f => {
      return (f.fileId || f.storedName) !== fileKey;
    });
  }
}

function formatFileSizeMB(size){
  return `${(Number(size || 0) / 1024 / 1024).toFixed(2)}MB`;
}

function formatBytesToMB(bytes){
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(2)}MB`;
}

function renderLibraryCapacityInfo(){
  const el = document.getElementById("libraryCapacityInfo");
  if (!el) return;

  const es = getSurveyEvidenceSettings();
  const totalBytes = getTotalEvidenceBytes();
  const totalLimitBytes = mbToBytes(es.totalSurveyLimitMB || 0);
  const remainBytes = Math.max(0, totalLimitBytes - totalBytes);

  el.innerHTML = `
    총 업로드 용량: <b>${formatBytesToMB(totalBytes)}</b>
    &nbsp;|&nbsp;
    남은 용량: <b>${formatBytesToMB(remainBytes)}</b>
    &nbsp;|&nbsp;
    전체 한도: <b>${Number(es.totalSurveyLimitMB || 0).toFixed(0)}MB</b>
  `;
}

function saveLibraryFile(meta){
  if (!meta?.fileId) return;
  state.evidenceLibrary[meta.fileId] = { ...meta };
}

function attachLibraryFileToQuestion(qid, meta){
  const arr = getEvidenceFiles(qid);
  if (arr.some(x => x.fileId === meta.fileId)) return;

  arr.push({
    fileId: meta.fileId,
    originalName: meta.originalName,
    storedName: meta.storedName,
    size: Number(meta.size || 0),
    type: meta.type || "",
    uploadedAt: meta.uploadedAt || ""
  });
}

function getQuestionEvidenceBytes(qid){
  return getEvidenceFiles(qid).reduce((sum, f) => sum + Number(f.size || 0), 0);
}

function getTotalEvidenceBytes(){
  return Object.values(state.evidenceLibrary || {})
    .reduce((sum, f) => sum + Number(f.size || 0), 0);
}

function getQuestionPathInfo(qid){
  let g1Index = 0;
  for (const g1 of state.survey.groups1 || []) {
    g1Index += 1;
    let g2Index = 0;
    for (const g2 of g1.groups2 || []) {
      g2Index += 1;
      let qIndex = 0;
      for (const q of g2.questions || []) {
        qIndex += 1;
        if (q.id === qid) {
          return { g1Index, g2Index, qIndex, g1, g2, q };
        }
      }
    }
  }
  return null;
}

function makeEvidenceStoredName(qid, originalName){
  const info = getQuestionPathInfo(qid) || { g1Index: 0, g2Index: 0, qIndex: 0 };
  return `${info.g1Index}_${info.g2Index}_${info.qIndex}.${sanitizeEvidenceFilename(originalName)}`;
}

function makeEvidenceFileId(){
  return "lib_" + Math.random().toString(36).slice(2, 10);
}

function makeLibraryStoredName(fileId, originalName){
  return `${fileId}.${sanitizeEvidenceFilename(originalName)}`;
}

function validateEvidenceFile(file){
  const es = getSurveyEvidenceSettings();
  const ext = String(file?.name || "").split(".").pop().toLowerCase();
  if (es.allowedExt.length && !es.allowedExt.includes(ext)) {
    throw new Error(`허용되지 않는 파일 형식입니다. (${ext || "확장자 없음"})`);
  }
}

async function uploadEvidenceFileToWorker(file){
  const fileId = makeEvidenceFileId();
  const storedName = makeLibraryStoredName(fileId, file.name);

  const form = new FormData();
  form.append("file", file);
  form.append("fileName", storedName);

  const res = await fetch(EVIDENCE_UPLOAD_URL, {
    method: "POST",
    body: form
  });

  let data = {};
  try { data = await res.json(); } catch(_) {}

  if (!res.ok || !data.ok) {
    throw new Error(data?.error || "증빙자료 업로드에 실패했습니다.");
  }

  return {
    fileId,
    originalName: file.name,
    storedName: data.fileName || storedName,
    size: Number(file.size || 0),
    type: file.type || "",
    uploadedAt: new Date().toISOString()
  };
}

function openEvidenceLibraryPicker(qid, onSelected){
  const lib = getEvidenceLibraryArray();

  const backdrop = document.createElement("div");
  backdrop.style.position = "fixed";
  backdrop.style.inset = "0";
  backdrop.style.background = "rgba(15,23,42,.35)";
  backdrop.style.zIndex = "99999";
  backdrop.style.display = "flex";
  backdrop.style.alignItems = "center";
  backdrop.style.justifyContent = "center";

  const currentIds = new Set(getEvidenceFiles(qid).map(f => f.fileId));

  backdrop.innerHTML = `
    <div style="width:min(760px, 92vw); max-height:80vh; overflow:auto; background:#fff; border-radius:16px; padding:18px; box-shadow:0 20px 40px rgba(0,0,0,.16);">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <div style="font-weight:900; font-size:18px;">기존 자료 선택</div>
        <button type="button" id="evi_picker_close" class="btn small ghost">닫기</button>
      </div>

      <div style="margin-top:12px;" id="evi_picker_list">
        ${
          lib.length
            ? lib.map(meta => `
              <label style="display:flex; align-items:flex-start; gap:10px; padding:10px; border:1px solid rgba(148,163,184,.3); border-radius:10px; margin-top:8px;">
                <input type="checkbox" value="${escapeHtml(meta.fileId)}" ${currentIds.has(meta.fileId) ? "checked" : ""}>
                <div>
                  <div style="font-weight:800;">${escapeHtml(meta.originalName)}</div>
                  <div class="hint" style="margin-top:4px;">
                    저장명: ${escapeHtml(meta.storedName)} · ${(Number(meta.size || 0)/1024/1024).toFixed(2)}MB
                  </div>
                </div>
              </label>
            `).join("")
            : `<div class="hint">기존 업로드 자료가 없습니다.</div>`
        }
      </div>

      <div style="margin-top:16px; display:flex; justify-content:flex-end; gap:8px;">
        <button type="button" id="evi_picker_cancel" class="btn small ghost">취소</button>
        <button type="button" id="evi_picker_apply" class="btn small">선택 적용</button>
      </div>
    </div>
  `;

  const close = () => backdrop.remove();

  backdrop.querySelector("#evi_picker_close").onclick = close;
  backdrop.querySelector("#evi_picker_cancel").onclick = close;

  backdrop.querySelector("#evi_picker_apply").onclick = () => {
    const checkedIds = Array.from(backdrop.querySelectorAll('#evi_picker_list input[type="checkbox"]:checked'))
      .map(el => el.value);

    const next = checkedIds
      .map(id => state.evidenceLibrary[id])
      .filter(Boolean)
      .map(meta => ({
        fileId: meta.fileId,
        originalName: meta.originalName,
        storedName: meta.storedName,
        size: Number(meta.size || 0),
        type: meta.type || "",
        uploadedAt: meta.uploadedAt || ""
      }));

    state.evidenceFiles[qid] = next;
    close();
    if (typeof onSelected === "function") onSelected();
  };

  backdrop.onclick = (e) => {
    if (e.target === backdrop) close();
  };

  document.body.appendChild(backdrop);
}

function renderEvidenceUploader(host, q, { disabled = false } = {}){
  if (!host) return;

  if (!isEvidenceEnabledForQuestion(q)) {
    host.innerHTML = "";
    return;
  }

  const es = getSurveyEvidenceSettings();
  const files = getEvidenceFiles(q.id);
  const accept = es.allowedExt.map(ext => "." + ext).join(",");

  host.innerHTML = `
    <div style="margin-top:10px; padding:12px; border:1px dashed rgba(148,163,184,.45); border-radius:14px; background:rgba(255,255,255,.55);">
      <div style="font-weight:800;">증빙자료 첨부 ${q.evidence?.required ? '<span style="color:#dc2626;">*</span>' : ''}</div>
      <div class="hint" style="margin-top:6px;">
        최대 파일 수: ${es.defaultMaxFiles}개 · 문항당 최대 용량: ${es.defaultMaxSizeMB}MB · 전체 최대 용량: ${es.totalSurveyLimitMB}MB
      </div>

<div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
  <input type="file" id="evi_input_${escapeHtml(q.id)}" ${disabled ? "disabled" : ""} ${accept ? `accept="${escapeHtml(accept)}"` : ""} multiple style="display:none;">
  <button type="button" id="evi_new_${escapeHtml(q.id)}" ${disabled ? "disabled" : ""} class="btn small">새 자료 업로드</button>
  <button type="button" id="evi_pick_${escapeHtml(q.id)}" ${disabled ? "disabled" : ""} class="btn small ghost">기존 자료 선택</button>
</div>

      <div id="evi_status_${escapeHtml(q.id)}" class="hint" style="margin-top:8px;"></div>

      <div id="evi_list_${escapeHtml(q.id)}" style="margin-top:10px;">
        ${
files.length
  ? files.map((f, i) => `
    <div style="padding:8px 10px; border:1px solid rgba(148,163,184,.35); border-radius:10px; margin-top:6px; background:#fff;">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
        <div style="font-weight:700;">${escapeHtml(f.originalName)}</div>
        ${disabled ? "" : `
          <button type="button"
                  data-del-evi="${escapeHtml(q.id)}"
                  data-del-idx="${i}"
                  style="padding:4px 8px; border-radius:8px; border:1px solid rgba(220,38,38,.25); background:#fff; color:#dc2626; cursor:pointer;">
            삭제
          </button>
        `}
      </div>
      <div class="hint" style="margin-top:4px;">
        저장명: ${escapeHtml(f.storedName)} · ${(Number(f.size || 0)/1024/1024).toFixed(2)}MB
      </div>
    </div>
  `).join("")
            : `<div class="hint">첨부된 증빙자료가 없습니다.</div>`
        }
      </div>
    </div>
  `;

  const input = host.querySelector(`#evi_input_${CSS.escape(q.id)}`);
    const btnNew = host.querySelector(`#evi_new_${CSS.escape(q.id)}`);
  const btnPick = host.querySelector(`#evi_pick_${CSS.escape(q.id)}`);
  if (btnPick) {
    btnPick.onclick = () => {
      if (disabled) return;
      openEvidenceLibraryPicker(q.id, () => {
        renderEvidenceUploader(host, q, { disabled });
      });
    };
  }
  if (btnNew) {
    btnNew.onclick = () => {
      if (!disabled) input?.click();
    };
  }
  const statusEl = host.querySelector(`#evi_status_${CSS.escape(q.id)}`);

  if (!input) return;

  input.onchange = async (e) => {
    const picked = Array.from(e.target.files || []);
    if (!picked.length) return;

    const currentFiles = getEvidenceFiles(q.id);
    const remainCount = Math.max(0, es.defaultMaxFiles - currentFiles.length);
    if (remainCount <= 0) {
      alert(`이 문항에는 최대 ${es.defaultMaxFiles}개까지만 첨부할 수 있습니다.`);
      e.target.value = "";
      return;
    }

    const selected = picked.slice(0, remainCount);
    let qBytes = getQuestionEvidenceBytes(q.id);
    let totalBytes = getTotalEvidenceBytes();

    input.disabled = true;
    if (statusEl) statusEl.textContent = "업로드 중...";

    try {
      for (const file of selected) {
        validateEvidenceFile(file);

        if (qBytes + file.size > mbToBytes(es.defaultMaxSizeMB)) {
          throw new Error(`문항당 최대 용량(${es.defaultMaxSizeMB}MB)을 초과했습니다.`);
        }

        if (totalBytes + file.size > mbToBytes(es.totalSurveyLimitMB)) {
          throw new Error(`설문 전체 최대 용량(${es.totalSurveyLimitMB}MB)을 초과했습니다.`);
        }

const meta = await uploadEvidenceFileToWorker(file);
saveLibraryFile(meta);
attachLibraryFileToQuestion(q.id, meta);

        qBytes += Number(file.size || 0);
        totalBytes += Number(file.size || 0);
      }

if (statusEl) statusEl.textContent = "업로드 완료";
renderEvidenceUploader(host, q, { disabled });
renderLibraryCapacityInfo();
    } catch (err) {
      if (statusEl) statusEl.textContent = "";
      alert(err?.message || err);
    } finally {
      input.disabled = disabled;
      e.target.value = "";
    }
  };
    host.querySelectorAll(`[data-del-evi="${CSS.escape(q.id)}"]`).forEach((btn) => {
    btn.onclick = () => {
      const idx = Number(btn.getAttribute("data-del-idx"));
      const files = getEvidenceFiles(q.id);

      if (Number.isNaN(idx) || !files[idx]) return;
      if (!confirm("이 증빙자료를 목록에서 제거할까요?")) return;

      files.splice(idx, 1);
      renderEvidenceUploader(host, q, { disabled });
    };
  });
}

function validateRequiredEvidenceBeforeSubmit(){
  const disabledSet = computeDisabledSetFromUserAnswers();
  const missing = [];

  for (const g1 of state.survey.groups1 || []) {
    for (const g2 of g1.groups2 || []) {
      for (const q of g2.questions || []) {
        ensureQuestionSpec(q);

        if (!isEvidenceEnabledForQuestion(q)) continue;
        if (!q.evidence?.required) continue;
        if (disabledSet.has(q.id)) continue;

        const files = getEvidenceFiles(q.id);
        if (!files.length) {
          missing.push(`${g1.name} > ${g2.name} > ${q.text}`);
        }
      }
    }
  }

  if (missing.length) {
    alert(
      "다음 문항은 증빙자료 첨부가 필요합니다.\n\n" +
      missing.slice(0, 10).join("\n")
    );
    return false;
  }

  return true;
}

  // ------------------ Rendering ------------------
  function renderTree() {
    const host = $("userTree");
    if (!host) return;

    if (!state.survey?.groups1?.length) {
      host.innerHTML = `<div class="tree-empty hint">설문을 불러오면 트리가 표시됩니다.</div>`;
      return;
    }

    // 기본: 모두 열림
    for (const g1 of state.survey.groups1) {
      if (state.treeOpen[g1.id] === undefined) state.treeOpen[g1.id] = false;
    }

    const rows = [];

    for (const g1 of state.survey.groups1) {
      const open = !!state.treeOpen[g1.id];
      const g2Count = (g1.groups2 || []).length;

      rows.push(`
        <div class="tree-row g1" data-kind="g1" data-id="${escapeHtml(g1.id)}">
          <button class="tree-toggle" data-toggle="g1" data-id="${escapeHtml(g1.id)}" type="button">
            ${open ? "−" : "+"}
          </button>
          <div class="tree-text">
            <span class="tree-badge">G1</span>
            <span class="tree-label">${escapeHtml(g1.name || "(무제 구분1)")}</span>
          </div>
          <div class="tree-meta">${g2Count}개</div>
        </div>
      `);

      if (open) {
        for (const g2 of g1.groups2 || []) {
          const active = state.currentG2Id === g2.id;
          const qCount = (g2.questions || []).length;

          rows.push(`
            <div class="tree-row g2 ${active ? "active" : ""}" data-kind="g2" data-id="${escapeHtml(g2.id)}">
              <div class="tree-toggle spacer"></div>
              <div class="tree-text">
                <span class="tree-badge">G2</span>
                <span class="tree-label">${escapeHtml(g2.name || "(무제 구분2)")}</span>
              </div>
              <div class="tree-meta">${qCount}문항</div>
            </div>
          `);
        }
      }
    }

    host.innerHTML = rows.join("");

    // 이벤트 위임
    host.onclick = (e) => {
      const t = e.target;

      // 1) toggle 버튼
      const toggleBtn = t.closest?.("[data-toggle=g1]");
      if (toggleBtn) {
        e.preventDefault();
        e.stopPropagation();
        const id = toggleBtn.getAttribute("data-id");
        if (!id) return;
        state.treeOpen[id] = !state.treeOpen[id];
        renderTree();
        return;
      }

      // 2) g1 행 클릭도 접기/펼치기
      const g1Row = t.closest?.(".tree-row.g1[data-kind=g1]");
      if (g1Row) {
        const id = g1Row.getAttribute("data-id");
        if (!id) return;
        state.treeOpen[id] = !state.treeOpen[id];
        renderTree();
        return;
      }

// 3) g2 클릭 -> 이동
const g2Row = t.closest?.(".tree-row.g2[data-kind=g2]");
if (g2Row) {
  const id = g2Row.getAttribute("data-id");
  if (!id) return;

  state.currentG2Id = id;

  syncTreeToCurrentG2();   // ✅ 현재 G2의 G1만 열기(나머지 닫기)
  renderAll();
  scrollCanvasTop();       // ✅ 최상단 이동
// 트리에서 현재 active(G2) 항목이 보이도록 자동 스크롤
const active = host.querySelector(".tree-row.g2.active");
if (active) active.scrollIntoView({ block: "nearest" });
  return;
}

    };
  }

function renderEvidenceLibraryView(){
  const tbody = document.getElementById("libraryTbody");
  renderLibraryCapacityInfo();
  if (!tbody) return;

  const files = getEvidenceLibraryArray()
    .slice()
    .sort((a, b) => String(b.uploadedAt || "").localeCompare(String(a.uploadedAt || "")));

  if (!files.length){
    tbody.innerHTML = `<tr><td colspan="7" class="muted" style="padding:14px;">저장된 자료가 없습니다.</td></tr>`;
    return;
  }

  tbody.innerHTML = files.map((meta, idx) => {
    const links = getLinkedQuestionsForFile(meta);

    const linkedHtml = links.length
      ? links.map(x => `
          <div style="margin-bottom:4px;">
            ${escapeHtml(x.g1Name)} &gt; ${escapeHtml(x.g2Name)} &gt; ${escapeHtml(x.qText)}
          </div>
        `).join("")
      : `<span class="muted">연결된 문항 없음</span>`;

return `
  <tr>
    <td class="center">${idx + 1}</td>
    <td>
      <div style="font-weight:700;">${escapeHtml(meta.originalName || "")}</div>
    </td>
    <td class="center">${escapeHtml(formatFileSizeMB(meta.size))}</td>
    <td>${linkedHtml}</td>
    <td class="center">${escapeHtml(_fmtKstCompact(meta.uploadedAt || ""))}</td>
    <td class="center">
      <button class="btn small" data-lib-del="${escapeHtml(meta.fileId || meta.storedName || "")}" type="button">삭제</button>
    </td>
  </tr>
`;
  }).join("");

  tbody.querySelectorAll("[data-lib-del]").forEach((btn) => {
    btn.onclick = () => {
const fileKey = btn.getAttribute("data-lib-del");
if (!fileKey) return;

const meta = files.find(x => (x.fileId || x.storedName) === fileKey);
if (!meta) return;

const links = getLinkedQuestionsForFile(meta);
const msg = links.length
  ? `이 자료를 삭제하면 연결된 문항에서도 모두 제거됩니다.\n\n삭제할까요?`
  : `이 자료를 삭제할까요?`;

if (!confirm(msg)) return;

removeLibraryFile(meta.fileId || meta.storedName);
renderEvidenceLibraryView();
renderAll();
    };
  });
}

  function renderCurrentG2Form() {
    const root = $("userFormRoot");
    if (!root) return;

    const disabledSet = computeDisabledSetFromUserAnswers();
    state._currentDisabledSet = disabledSet;

    if (!state.currentG2Id) {
      root.innerHTML = `<div class="hint">불러온 설문지가 없습니다.</div>`;
      return;
    }

    // find current g2
    let cur = null;
    let curG1Name = "";
    for (const g1 of state.survey.groups1) {
      for (const g2 of g1.groups2 || []) {
        if (g2.id === state.currentG2Id) {
          cur = g2;
          curG1Name = g1.name || "";
          break;
        }
      }
      if (cur) break;
    }

    if (!cur) {
      root.innerHTML = `<div class="hint">선택한 구분2를 찾을 수 없습니다.</div>`;
      return;
    }

    $("userCanvasTitle").textContent = `${curG1Name ? curG1Name + " > " : ""}${cur.name || "구분2"}`;
    $("userCanvasHint").textContent = `총 문항 ${cur.questions?.length || 0}개`;

    const qs = cur.questions || [];
    state._currentQuestions = qs;
    if (!qs.length) {
      root.innerHTML = `<div class="hint">이 구분2에 문항이 없습니다.</div>`;
      return;
    }

root.innerHTML = qs.map((q, idx) => {
  const requiredMark = q.required ? `<span style="color:#ff6f91; margin-left:6px;">*</span>` : "";
  const isDisabled = disabledSet.has(q.id);

return `
  <div class="qcard ${isDisabled ? "disabled-by-rule" : ""}" data-qid="${escapeHtml(q.id)}">
    <div style="font-weight:800;">${idx + 1}. ${escapeHtml(q.text || "")}${requiredMark}</div>

    <div class="hint" style="margin-top:6px;">
      ${q.required ? '<span class="pill" style="margin-left:6px; border-color:rgba(255,111,145,.35); background:rgba(255,111,145,.10); color:#9d174d;">필수</span>' : ''}
    </div>

    ${q.guide ? `
      <details class="answer-guide" style="margin-top:10px;" >
        <summary>답변 가이드</summary>
        <div class="guide-body">${escapeHtml(q.guide).replaceAll("\n","<br>")}</div>
      </details>
    ` : ""}

    <div id="ctrl_${escapeHtml(q.id)}" style="margin-top:10px;"></div>
    ${isEvidenceEnabledForQuestion(q) ? `
  <div id="evidence_${escapeHtml(q.id)}" style="margin-top:10px;"></div>
` : ""}

    ${isDisabled ? `
      <div class="disabled-overlay">
        <div class="disabled-overlay-text">이전 문항 답변에 따라 비활성화 되었습니다.</div>
      </div>
    ` : ""}
  </div>
`;

}).join("");


    // mount controls
qs.forEach((q) => {
  ensureQuestionSpec(q);
  const ans = ensureAnswer(q);
  const isLockedNow = (disabledSet.has(q.id) || isEditingLocked());

  const c = root.querySelector(`#ctrl_${CSS.escape(q.id)}`);
  if (c) {
    renderControls(c, q, ans, {
      disabled: isLockedNow,
      onAnswerChanged: () => handleAnswerChanged(),
    });
  }

  const evi = root.querySelector(`#evidence_${CSS.escape(q.id)}`);
  if (evi) {
    renderEvidenceUploader(evi, q, { disabled: isLockedNow });
  }
});
  }

function renderHeader() {
  // ✅ 제목은 불러온 파일명(확장자 제외) 우선
  const titleEl = $("surveyTitleUser");
  const compEl = $("targetCompany");
  const nameEl = $("targetName");
  const ovEl = $("userOverview");

  if (titleEl) titleEl.value = state.importFileBase || state.survey.title || "";
  if (compEl) compEl.value = state.target.company || "";
  if (nameEl) nameEl.value = state.target.name || "";

  const g2Count = state.g2Index.length || 0;
  const idx = state.g2Index.findIndex((x) => x.g2.id === state.currentG2Id);
  const cur = Math.max(0, idx) + (g2Count ? 1 : 0);

  if (ovEl) ovEl.textContent = `구분2 진행: ${cur}/${g2Count}`;
}


  function renderAll() {
    renderHeader();
    renderTree();
    renderCurrentG2Form();
  }

// ------------------ Navigation: Next button ------------------
function goNextG2() {
  if (!state.g2Index.length) return;

  const idx = state.g2Index.findIndex((x) => x.g2.id === state.currentG2Id);
  const next = state.g2Index[Math.min(idx + 1, state.g2Index.length - 1)];
  if (!next) return;

  state.currentG2Id = next.g2.id;

  syncTreeToCurrentG2();
  renderAll();
requestAnimationFrame(scrollCanvasTop);
}

// ------------------ Navigation: Prev button ------------------
function goPrevG2() {
  if (!state.g2Index.length) return;

  const idx = state.g2Index.findIndex((x) => x.g2.id === state.currentG2Id);
  const prev = state.g2Index[Math.max(idx - 1, 0)];
  if (!prev) return;

  state.currentG2Id = prev.g2.id;
  syncTreeToCurrentG2();
  renderAll();
requestAnimationFrame(scrollCanvasTop);
}

function serializeAnswersForServer() {
  const answers = {};
  for (const [qid, a] of Object.entries(state.answers || {})) {
    answers[qid] = {
      norm: a?.norm || "",
      checks: Array.from(a?.checks || []),
      text: a?.text || "",
      fields: a?.fields || {},
    };
  }

  const evidenceFiles = {};
  for (const [qid, files] of Object.entries(state.evidenceFiles || {})) {
    evidenceFiles[qid] = Array.isArray(files)
      ? files.map(f => ({
          originalName: f.originalName || "",
          storedName: f.storedName || "",
          size: Number(f.size || 0),
          type: f.type || "",
          uploadedAt: f.uploadedAt || ""
        }))
      : [];
  }

    const evidenceLibrary = {};
  for (const [fileId, meta] of Object.entries(state.evidenceLibrary || {})) {
    evidenceLibrary[fileId] = {
      fileId: meta.fileId || "",
      originalName: meta.originalName || "",
      storedName: meta.storedName || "",
      size: Number(meta.size || 0),
      type: meta.type || "",
      uploadedAt: meta.uploadedAt || ""
    };
  }

  return {
    target: { ...state.target },
    answers,
    evidenceFiles,
    evidenceLibrary,
    savedAt: new Date().toISOString(),
  };
}

function applyAnswersFromServer(payload) {
  if (!payload) return;

  if (payload.target) state.target = { ...state.target, ...payload.target };

  const next = {};
  for (const [qid, a] of Object.entries(payload.answers || {})) {
    next[qid] = {
      norm: a?.norm || "",
      checks: new Set(a?.checks || []),
      text: a?.text || "",
      fields: a?.fields || {},
    };
  }
  state.answers = next;

  const nextEvidence = {};
  for (const [qid, files] of Object.entries(payload.evidenceFiles || {})) {
    nextEvidence[qid] = Array.isArray(files) ? files : [];
  }
  state.evidenceFiles = nextEvidence;

  const nextLibrary = {};
  for (const [fileId, meta] of Object.entries(payload.evidenceLibrary || {})) {
    nextLibrary[fileId] = meta;
  }
  state.evidenceLibrary = nextLibrary;
  renderAll();
}

async function loadMyDraftForCurrentSurvey() {
  if (!state.server?.id) return; // 설문 로드 전이면 패스
  const session = await requireLoginOrModal();
  const uid = session?.user?.id;
  if (!uid) return;

  const { data, error } = await sb
    .from("responses")
    .select("id, draft_json, submitted_json, submitted_at, status")
    .eq("survey_id", state.server.id)
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;

  // ✅ 메타 캐시 (결과 전송/리포트 포함)
  state.myResponseMeta = {
    id: data?.id || null,
    submittedAt: data?.submitted_at || null,
    resultSent: !!(data?.submitted_json && (data.submitted_json.result_sent || data.submitted_json.resultSent)),
    reportPayload: (data?.submitted_json && data.submitted_json.report_payload) ? data.submitted_json.report_payload : null,
  };
  updateResultDownloadUI();

  // 제출본이 있으면 제출본 우선
  if (data?.submitted_json) {
    state.locked = true;
    state.autoSubmitted = String(data?.status || "").toUpperCase() === "AUTO_SUBMITTED";
    applyAnswersFromServer(data.submitted_json);
    updateSubmitUiState();
    updateResultDownloadUI();
    return;
  }

  state.locked = false;
  state.autoSubmitted = false;
  updateSubmitUiState();

  if (data?.draft_json) {
    applyAnswersFromServer(data.draft_json);
  }
  updateSubmitUiState();

  updateResultDownloadUI();
}


// ------------------ Save draft / Submit ------------------
async function saveDraftToServer(){
  const w0 = withinWindow(state.surveyWindow?.open_from, state.surveyWindow?.open_to);
  if (w0.reason === "after") return alert("설문 기간이 마감되어 임시저장할 수 없습니다.");
  if (state.locked) return alert("이미 제출된 설문입니다. 수정하려면 먼저 회수하기를 눌러주세요.");
  if (!state.server?.id) return alert("설문을 먼저 불러오세요.");
  const session = await requireLoginOrModal();
  const uid = session?.user?.id;
  if (!uid) return;

  // ✅ 회사명/이름은 제출/임시저장 전 반드시 확보 (비밀번호 저장 X)
  const company = (state.target.company || "").trim();
  const name = (state.target.name || "").trim();
  if (!company || !name){
    alert("회사명/이름을 입력해 주세요. (제출 메타에 포함되어야 관리자 화면에서 정상 표시됩니다.)");
    document.getElementById("targetCompany")?.focus();
    return;
  }
if (!validateRequiredEvidenceBeforeSubmit()) return;
  const payload = serializeAnswersForServer();
  // ✅ 관리자 화면 호환: 루트에도 메타 저장
  payload.company = company;
  payload.name = name;
  payload.email = session?.user?.email || "";
  attachSurveyMeta(payload);

  const { error } = await sb
    .from("responses")
    .upsert(
      {
        user_id: uid,
        respondent_email: session?.user?.email || null,
        survey_id: state.server.id,
        draft_json: payload,
        submitted_json: null,
        submitted_at: null,
        status: "DRAFT",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,survey_id" }
    );

  if (error) throw error;
  alert("임시저장 완료!");
}

async function submitToServer(){
  // 기간 마감이면 제출/수정 불가 (자동 제출은 별도 로직)
  const w0 = withinWindow(state.surveyWindow?.open_from, state.surveyWindow?.open_to);
  if (w0.reason === "after") return alert("설문 기간이 마감되었습니다. (임시저장 내용은 자동 제출 처리됩니다.)");
  if (state.locked) return alert("이미 제출된 설문입니다. 수정하려면 먼저 회수하기를 눌러주세요.");
  if (!state.server?.id) return alert("설문을 먼저 불러오세요.");
  const session = await requireLoginOrModal();
  const uid = session?.user?.id;
  if (!uid) return;

  const company = (state.target.company || "").trim();
  const name = (state.target.name || "").trim();
  if (!company || !name){
    alert("회사명/이름을 입력해 주세요. (제출 메타에 포함되어야 관리자 화면에서 정상 표시됩니다.)");
    document.getElementById("targetCompany")?.focus();
    return;
  }
if (!validateRequiredEvidenceBeforeSubmit()) return;
  const payload = serializeAnswersForServer();
  // ✅ 관리자 화면 호환: 루트에도 메타 저장
  payload.company = company;
  payload.name = name;
  payload.email = session?.user?.email || "";
  attachSurveyMeta(payload);

  const { error } = await sb
    .from("responses")
    .upsert(
      {
        user_id: uid,
        respondent_email: session?.user?.email || null,
        survey_id: state.server.id,
        draft_json: null,
        submitted_json: payload,
        submitted_at: new Date().toISOString(),
        status: "SUBMITTED",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,survey_id" }
    );

  if (error) throw error;
  state.locked = true;
  state.autoSubmitted = false;
  updateSubmitUiState();
  renderAll();
  alert("제출 완료! 관리자에서 제출 답변을 확인할 수 있습니다.");
}


async function recallSubmission(){
  if (!state.server?.id) return alert("설문을 먼저 불러오세요.");
  const session = await requireLoginOrModal();
  const uid = session?.user?.id;
  if (!uid) return;

  // 마감 후에는 회수 불가(기간 연장되면 다시 가능)
  const w = withinWindow(state.surveyWindow?.open_from, state.surveyWindow?.open_to);
  if (w.reason === "after") {
    return alert("설문 기간이 마감되어 회수할 수 없습니다. (관리자에서 기간 연장 시 회수 가능)");
  }

  // 현재 제출본을 draft로 되돌리고, 제출본은 null 처리
  const { data: cur, error: rerr } = await sb
    .from("responses")
    .select("submitted_json, draft_json")
    .eq("survey_id", state.server.id)
    .eq("user_id", uid)
    .maybeSingle();
  if (rerr) throw rerr;
  if (!cur?.submitted_json) return alert("회수할 제출본이 없습니다.");

  const nextDraft = cur.submitted_json; // 제출본을 그대로 초안으로 되돌림

  // status 컬럼이 없는 스키마도 있을 수 있어 2단계로 시도
  let u1 = await sb.from("responses").update({
    draft_json: nextDraft,
    submitted_json: null,
    submitted_at: null,
    status: "RECALLED",
    updated_at: new Date().toISOString(),
  }).eq("survey_id", state.server.id).eq("user_id", uid);

  if (u1.error) {
    // status 컬럼 없으면 다시 시도
    const u2 = await sb.from("responses").update({
      draft_json: nextDraft,
      submitted_json: null,
      submitted_at: null,
      updated_at: new Date().toISOString(),
    }).eq("survey_id", state.server.id).eq("user_id", uid);
    if (u2.error) throw u2.error;
  }

  state.locked = false;
  state.autoSubmitted = false;
  applyAnswersFromServer(nextDraft);
  updateSubmitUiState();
  alert("회수 완료! 이제 수정 후 다시 제출할 수 있습니다. (회수된 상태는 관리자 화면에서 조회되지 않습니다.)");
}

async function maybeAutoSubmitIfExpired(){
  if (!state.server?.id) return;
  const w = withinWindow(state.surveyWindow?.open_from, state.surveyWindow?.open_to);
  if (w.reason !== "after") return;

  const session = await requireLoginOrModal();
  const uid = session?.user?.id;
  if (!uid) return;

  const { data, error } = await sb
    .from("responses")
    .select("id, draft_json, submitted_json, submitted_at, status")
    .eq("survey_id", state.server.id)
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw error;

  state.myResponseMeta = {
    id: data?.id || null,
    submittedAt: data?.submitted_at || null,
    resultSent: !!(data?.submitted_json && (data.submitted_json.result_sent || data.submitted_json.resultSent)),
    reportPayload: (data?.submitted_json && data.submitted_json.report_payload) ? data.submitted_json.report_payload : null,
  };
  updateResultDownloadUI();

  // 이미 제출되어 있으면 패스
  if (data?.submitted_json || data?.submitted_at || String(data?.status||"").toUpperCase()==="SUBMITTED") {
    state.locked = true;
    state.autoSubmitted = String(data?.status||"").toUpperCase()==="AUTO_SUBMITTED";
    updateSubmitUiState();
    return;
  }

  // draft가 있으면 자동 제출
  if (data?.draft_json) {
    const payload = attachSurveyMeta({ ...(data.draft_json || {}) });
    // status 컬럼 있는 경우 우선
    let u1 = await sb.from("responses").upsert({
      user_id: uid,
      respondent_email: session?.user?.email || null,
      survey_id: state.server.id,
      draft_json: null,
      submitted_json: payload,
      submitted_at: new Date().toISOString(),
      status: "AUTO_SUBMITTED",
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,survey_id" });

    if (u1.error){
      // status 컬럼 없으면 다시
      const u2 = await sb.from("responses").upsert({
        user_id: uid,
        respondent_email: session?.user?.email || null,
        survey_id: state.server.id,
        draft_json: null,
        submitted_json: payload,
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,survey_id" });
      if (u2.error) throw u2.error;
    }

    state.locked = true;
    state.autoSubmitted = true;
    updateSubmitUiState();
    alert("설문 기간이 마감되어, 임시저장된 내용이 자동 제출 처리되었습니다.");
  } else {
    // draft도 없으면 그냥 잠금만
    state.locked = true;
    state.autoSubmitted = false;
    updateSubmitUiState();
  }
}

function updateSubmitUiState(){
  const btnDraft = document.getElementById("btnSaveDraft");
  const btnSubmit = document.getElementById("btnSubmitSurvey");
  const btnRecall = document.getElementById("btnRecallSurvey");

  const w = withinWindow(state.surveyWindow?.open_from, state.surveyWindow?.open_to);
  const expired = (w.reason === "after");

  // 제출 잠금: 제출된 상태이거나 기간 마감이면 임시저장/제출 불가
  const disabled = !!state.locked || expired;

  if (btnDraft) btnDraft.disabled = disabled;
  if (btnSubmit) btnSubmit.disabled = disabled;

  // 회수 버튼은 제출된 상태 && 기간 미마감일 때만
  if (btnRecall) {
    btnRecall.disabled = (!state.locked) || expired;
    btnRecall.style.display = "inline-block";
  }
  // ✅ 제출 상태에 따라 입력창/문항 편집 잠금 및 안내 문구 반영
  applyEditingLockToRenderedForm();
}


  // ================== Survey Meta Helpers ==================
  const _SURVEY_META_LS_KEY = "user_survey_meta_cache_v1";

  function _getSurveyMetaCache(){
    try{
      const raw = localStorage.getItem(_SURVEY_META_LS_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      return (obj && typeof obj === "object") ? obj : {};
    }catch(_){
      return {};
    }
  }
  function getCachedSurveyMeta(surveyId){
    if (!surveyId) return null;
    const cache = _getSurveyMetaCache();
    return cache[String(surveyId)] || null;
  }
  function cacheSurveyMeta(surveyId, meta){
    if (!surveyId || !meta) return;
    try{
      const cache = _getSurveyMetaCache();
      const key = String(surveyId);
      cache[key] = { ...(cache[key] || {}), ...(meta || {}) };
      localStorage.setItem(_SURVEY_META_LS_KEY, JSON.stringify(cache));
    }catch(_){}
  }

  // payload(draft/submitted)에 설문 메타를 항상 포함시키기 (설문 관리 목록 표시/편집용)
  function attachSurveyMeta(payload){
    if (!payload || typeof payload !== "object") return payload;
    try{
      payload.survey_id = payload.survey_id || state?.server?.id || null;
      payload.survey_code = payload.survey_code || state?.server?.code || (document.getElementById("surveyCodeInput")?.value || "").trim().toLowerCase() || "";
      payload.survey_title = payload.survey_title || state?.survey?.title || state?.server?.title || (document.getElementById("surveyTitleUser")?.value || "") || "";
      if (!payload.survey_window || typeof payload.survey_window !== "object"){
        payload.survey_window = {
          open_from: state?.surveyWindow?.open_from || null,
          open_to: state?.surveyWindow?.open_to || null,
        };
      } else {
        payload.survey_window.open_from = payload.survey_window.open_from ?? (state?.surveyWindow?.open_from || null);
        payload.survey_window.open_to = payload.survey_window.open_to ?? (state?.surveyWindow?.open_to || null);
      }
    }catch(_){}
    return payload;
  }

  async function fetchSurveyMetaMapByIds(surveyIds){
    const out = {};
    const ids = Array.from(new Set((surveyIds || []).filter(Boolean).map((v)=>String(v))));
    if (!ids.length) return out;
    try{
      const { data, error } = await sb
        .from("surveys")
        .select("id, code, title, open_from, open_to")
        .in("id", ids);
      if (!error && Array.isArray(data)){
        for (const m of data){
          if (m?.id) out[String(m.id)] = m;
        }
      }
    }catch(_){}
    return out;
  }

  async function fetchSurveyWindowByIdSafe(surveyId){
    if (!surveyId) return null;
    // 1) surveys select (가능하면)
    try{
      const { data, error } = await sb
        .from("surveys")
        .select("open_from, open_to")
        .eq("id", surveyId)
        .maybeSingle();
      if (!error && data){
        return { open_from: data.open_from || null, open_to: data.open_to || null };
      }
    }catch(_){}

    // 2) fallback RPC (있으면)
    try{
      const { data: w2, error: e2 } = await sb.rpc("get_survey_window_by_id", { p_id: surveyId });
      if (!e2 && w2){
        return { open_from: w2.open_from || null, open_to: w2.open_to || null };
      }
    }catch(_){}
    return null;
  }



  // ================== User View: 설문 작성 / 설문 관리 ==================
  function _fmtKstCompact(v){
    if (!v) return "-";
    try{
      return new Date(v).toLocaleString("ko-KR", {
        year:"numeric", month:"2-digit", day:"2-digit",
        hour:"2-digit", minute:"2-digit", hour12:false
      });
    }catch(_){
      return String(v);
    }
  }


  function _canDownloadFromSubmittedJson(sj){
    if (!sj) return false;
    // 관리자 결과 전송 플래그(키 변형 대비)
    const sent = !!(sj.result_sent || sj.resultSent);
    if (!sent) return false;

    // 1) 클라이언트에서 PDF 생성 가능한 리포트 payload
    const rep = sj.report_payload || sj.reportPayload;
    if (rep && (rep.g1Rows || rep.g1_rows)) return true;

    // 2) 직접 다운로드/뷰 URL
    const directUrl = sj.result_pdf_url || sj.resultPdfUrl || sj.result_url || sj.resultUrl || sj.report_url || sj.reportUrl || sj.pdf_url || sj.pdfUrl;
    if (directUrl) return true;

    return false;
  }

  function _manageStatusBadge({ canDownload, expired, submitted }){
    if (canDownload) return { cls:"result", text:"결과확인" };
    if (expired) return { cls:"closed", text:"설문마감" };
    if (submitted) return { cls:"done", text:"제출완료" };
    return { cls:"progress", text:"진행 중" };
  }

  function switchCanvasView(nextId){
    const next = document.getElementById(nextId);
    if (!next) return;

    const cur = document.querySelector(".canvas .view.active");
    if (cur === next) return;

    if (cur){
      cur.classList.add("is-leave");
      cur.classList.remove("active");
    }

    next.classList.add("is-enter");
    requestAnimationFrame(() => {
      next.classList.add("active");
      next.classList.remove("is-enter");
      setTimeout(() => {
        if (cur) cur.classList.remove("is-leave");
      }, 220);
    });
  }

async function setUserView(view){
  const navFill = document.getElementById("navFill");
  const navManage = document.getElementById("navManage");
  const navLibrary = document.getElementById("navLibrary");

  if (navFill) navFill.classList.remove("active");
  if (navManage) navManage.classList.remove("active");
  if (navLibrary) navLibrary.classList.remove("active");

  if (view === "manage"){
    if (navManage) navManage.classList.add("active");
    switchCanvasView("viewManage");
    await refreshSurveyManageList();
    return;
  }

  if (view === "library"){
    if (navLibrary) navLibrary.classList.add("active");
    switchCanvasView("viewLibrary");
    renderEvidenceLibraryView();
    return;
  }

  if (navFill) navFill.classList.add("active");
  switchCanvasView("viewFill");
  try{ updateSubmitUiState(); }catch(_){}
  try{ updateResultDownloadUI(); }catch(_){}
  }

  async function downloadResultPdfFromSubmittedJson(sj){
    if (!sj) throw new Error("제출된 응답이 없습니다.");
    if (!(sj.result_sent || sj.resultSent)) throw new Error("아직 관리자가 결과 전송을 하지 않았습니다.");

    const rep = sj.report_payload;
    const directUrl =
      sj.result_pdf_url ||
      sj.result_url ||
      sj.report_url ||
      sj.pdf_url ||
      null;

    // 1) 관리자에서 report_payload를 내려준 경우: 클라이언트에서 동일 포맷으로 PDF 생성
    if (rep && rep.g1Rows){
      const surveyTitle = sj.survey_title || state?.server?.title || state?.survey?.title || "설문";
      const companyName = (sj?.target?.company || sj?.company || "").trim();
      const totalScore = Number(rep.totalScore || 0);
      const g1Rows = rep.g1Rows || [];
      await downloadResultPdfCore({ surveyTitle, companyName, totalScore, g1Rows });
      return;
    }

    // 2) URL로 결과(PDF)를 제공하는 방식인 경우: URL 오픈/다운로드
    if (directUrl){
      const a = document.createElement("a");
      a.href = directUrl;
      a.target = "_blank";
      a.rel = "noopener";
      try{ a.download = ""; }catch(_){}
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }

    throw new Error("리포트 데이터가 없습니다. 관리자에서 '결과 전송'을 다시 눌러 주세요.");
  }



  async function downloadResultForSurveyId(surveyId, fallbackTitle){
    const session = await requireLoginOrModal();
    const uid = session?.user?.id;
    if (!uid) throw new Error("로그인이 필요합니다.");

    const { data, error } = await sb
      .from("responses")
      .select("submitted_json")
      .eq("survey_id", surveyId)
      .eq("user_id", uid)
      .maybeSingle();

    if (error) throw error;

    const sj = data?.submitted_json || null;
    if (sj && fallbackTitle && !sj.survey_title) sj.survey_title = fallbackTitle;
    await downloadResultPdfFromSubmittedJson(sj);
  }

  async function refreshSurveyManageList(){
    const tbody = document.getElementById("userManageTbody");
    // ✅ 컬럼: NO | 상태 | 설문 제목 | 설문 코드 | 설문 기한 | 최종 작성일 | 설문 편집 | 결과 다운로드 (총 8)
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="muted" style="padding:14px;">불러오는 중...</td></tr>';

    const session = await requireLoginOrModal();
    const uid = session?.user?.id;
    if (!uid){
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="muted" style="padding:14px;">로그인이 필요합니다.</td></tr>';
      return;
    }
    try{

    const { data, error } = await sb
      .from("responses")
      .select("id, survey_id, status, updated_at, submitted_at, draft_json, submitted_json")
      .eq("user_id", uid)
      .order("updated_at", { ascending: false });

    if (error){
      console.error(error);
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="muted" style="padding:14px;">불러오기 실패: ' + escapeHtml(error.message || error) + '</td></tr>';
      return;
    }

    const rows = data || [];
    if (!rows.length){
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="muted" style="padding:14px;">임시저장 또는 제출한 설문이 없습니다.</td></tr>';
      return;
    }

    // ---- 1) 설문 메타(제목/코드/기간) 보강: surveys 테이블(가능하면) + localStorage 캐시 ----
    const surveyIds = Array.from(new Set(rows.map(r => r?.survey_id).filter(Boolean).map(v => String(v))));
    const metaFromDb = await fetchSurveyMetaMapByIds(surveyIds);

    const metaById = {};
    for (const sid of surveyIds){
      const cached = getCachedSurveyMeta(sid) || {};
      const dbm = metaFromDb[sid] || {};
      const merged = { ...(cached || {}), ...(dbm || {}) };

      // db에서 온 경우 캐시 업데이트
      if (merged && (merged.code || merged.title || merged.open_from || merged.open_to)){
        cacheSurveyMeta(sid, {
          code: merged.code || "",
          title: merged.title || "",
          open_from: merged.open_from || null,
          open_to: merged.open_to || null,
        });
      }
      metaById[sid] = merged;
    }

    // ---- 2) 기간(open_from/open_to)만이라도 못 가져온 설문은 RPC로 보완 ----
    const needWinIds = surveyIds.filter((sid) => {
      const m = metaById[sid] || {};
      return !(m.open_from || m.open_to);
    });

    if (needWinIds.length){
      const uniq = Array.from(new Set(needWinIds));
      const results = await Promise.allSettled(uniq.map((sid) => fetchSurveyWindowByIdSafe(sid)));
      for (let i=0; i<uniq.length; i++){
        const sid = uniq[i];
        const res = results[i];
        const w = (res && res.status === "fulfilled") ? res.value : null;
        if (w && (w.open_from || w.open_to)){
          metaById[sid] = { ...(metaById[sid] || {}), ...(w || {}) };
          cacheSurveyMeta(sid, {
            open_from: w.open_from || null,
            open_to: w.open_to || null,
          });
        }
      }
    }

    // ---- 3) (선택) responses JSON에 메타가 없으면, 본인 데이터에만 한 번 백필 ----
    //  - 다음부터는 surveys 조회가 막혀도 목록이 정상 표시됨
    try{
      const patchTasks = [];
      for (const r of rows){
        const sid = String(r?.survey_id || "");
        const m = metaById[sid] || null;
        if (!m) continue;

        const wantCode = (m.code || "").trim();
        const wantTitle = (m.title || "").trim();
        const wantWin = { open_from: m.open_from || null, open_to: m.open_to || null };

        if (r.draft_json && typeof r.draft_json === "object"){
          const dj = r.draft_json;
          const need =
            (!dj.survey_code && wantCode) ||
            (!dj.survey_title && wantTitle) ||
            (!dj.survey_window && (wantWin.open_from || wantWin.open_to));
          if (need){
            const next = { ...(dj || {}) };
            if (!next.survey_code && wantCode) next.survey_code = wantCode;
            if (!next.survey_title && wantTitle) next.survey_title = wantTitle;
            if (!next.survey_window && (wantWin.open_from || wantWin.open_to)) next.survey_window = { ...wantWin };
            patchTasks.push(
              sb.from("responses").update({ draft_json: next, updated_at: new Date().toISOString() }).eq("id", r.id)
            );
          }
        }

        if (r.submitted_json && typeof r.submitted_json === "object"){
          const sj = r.submitted_json;
          const need =
            (!sj.survey_code && wantCode) ||
            (!sj.survey_title && wantTitle) ||
            (!sj.survey_window && (wantWin.open_from || wantWin.open_to));
          if (need){
            const next = { ...(sj || {}) };
            if (!next.survey_code && wantCode) next.survey_code = wantCode;
            if (!next.survey_title && wantTitle) next.survey_title = wantTitle;
            if (!next.survey_window && (wantWin.open_from || wantWin.open_to)) next.survey_window = { ...wantWin };
            patchTasks.push(
              sb.from("responses").update({ submitted_json: next, updated_at: new Date().toISOString() }).eq("id", r.id)
            );
          }
        }
      }
      if (patchTasks.length) await Promise.allSettled(patchTasks);
    }catch(_){}

    // ---- 4) Render rows ----
    const html = [];
    for (let i=0; i<rows.length; i++){
      const r = rows[i] || {};
      const sj = r.submitted_json || null;
      const dj = r.draft_json || null;
      const sid = String(r?.survey_id || "");

      const meta = metaById[sid] || {};
      const surveyTitle = (meta.title || sj?.survey_title || dj?.survey_title || "(제목 정보 없음)");
      const surveyCode  = (meta.code  || sj?.survey_code  || dj?.survey_code  || "");

      const win = meta.open_from || meta.open_to
        ? { open_from: meta.open_from || null, open_to: meta.open_to || null }
        : (sj?.survey_window || dj?.survey_window || null);

      let periodHtml = "-";
      if (win?.open_from || win?.open_to){
        const s = escapeHtml(_fmtKstCompact(win.open_from));
        const e = escapeHtml(_fmtKstCompact(win.open_to));
        periodHtml = `<div>${s}</div><div>~ ${e}</div>`;
      }
      const lastAt = r.updated_at || r.submitted_at || "-";

      const canDownload = _canDownloadFromSubmittedJson(sj);

      const endMs = (win?.open_to ? new Date(win.open_to).getTime() : null);
      const expired = !!(endMs && Date.now() > endMs);

      const badge = _manageStatusBadge({ canDownload, expired, submitted: !!sj });

      html.push(`
        <tr data-idx="${i}">
          <td class="center">${i+1}</td>
          <td class="center"><span class="badge-status ${badge.cls}">${badge.text}</span></td>
          <td>
            <div class="cell-ellipsis" title="${escapeHtml(surveyTitle)}">${escapeHtml(surveyTitle)}</div>
          </td>
          <td>${escapeHtml(surveyCode || "-")}</td>
          <td>${periodHtml}</td>
          <td>${escapeHtml(_fmtKstCompact(lastAt))}</td>
          <td class="center">
            <button class="btn small" data-act="edit" data-idx="${i}" ${surveyCode ? "" : "disabled"} title="${surveyCode ? "" : "설문 코드 정보를 찾지 못했습니다."}">
              설문 편집
            </button>
          </td>
          <td class="center">
            <button class="btn small" data-act="download" data-idx="${i}" ${canDownload ? "" : "disabled"}>
              결과 다운로드
            </button>
          </td>
        </tr>
      `);
    }
    if (tbody) tbody.innerHTML = html.join("");

    // ✅ 이벤트 핸들러가 최신 rows/meta를 보도록 tbody에 저장 (클로저 stale 방지)
    if (tbody) tbody.__manageData = { rows, metaById };

    // Bind actions (event delegation) - only once
    if (tbody && !tbody.__boundManage){
      tbody.__boundManage = true;
      tbody.addEventListener("click", async (ev) => {
        const btn = ev.target?.closest?.("button[data-act]");
        if (!btn) return;

        const act = btn.getAttribute("data-act");
        const idx = Number(btn.getAttribute("data-idx"));

        const ctx = tbody.__manageData || {};
        const rowsNow = ctx.rows || [];
        const metaNow = ctx.metaById || {};
        const row = rowsNow[idx];
        if (!row) return;

        const sj = row.submitted_json || null;
        const dj = row.draft_json || null;
        const sid = String(row?.survey_id || "");
        const meta = metaNow[sid] || {};

        const surveyTitle = (meta.title || sj?.survey_title || dj?.survey_title || "(제목 정보 없음)");
        const surveyCode = String((meta.code || sj?.survey_code || dj?.survey_code || "") || "").trim();

        if (act === "edit"){
          if (!surveyCode){
            return alert("설문 코드 정보를 찾지 못했습니다. (surveys 테이블 조회 권한/RLS 또는 응답 JSON 메타 저장 구조를 확인해 주세요.)");
          }
          const codeInput = document.getElementById("surveyCodeInput");
          if (codeInput) codeInput.value = surveyCode;

          try{
            await loadSurveyByCode();
            await setUserView("fill");
          }catch(e){
            alert("설문 불러오기 실패: " + (e?.message || e));
            console.error(e);
          }
        }

        if (act === "download"){
          if (btn.disabled) return;
          try{
            await downloadResultForSurveyId(row.survey_id, surveyTitle);
          }catch(e){
            alert("결과 다운로드 실패: " + (e?.message || e));
            console.error(e);
          }
        }
      });
    }

    }catch(e){
      console.error(e);
      if (tbody){
        const msg = (e && (e.message || e.toString())) ? (e.message || e.toString()) : String(e);
        tbody.innerHTML = '<tr><td colspan="7" class="muted" style="padding:14px;">불러오기 실패: ' + escapeHtml(msg) + '</td></tr>';
      }
    }

  }




  

// ================== Result Report PDF Core (global) ==================
// expose to window for any inline/global callers
try{ window.downloadResultPdfCore = downloadResultPdfCore; }catch(_){ }
// ---- Report PDF core (ported from admin) ----
function normalizeFilename(name){
  return String(name || "").replace(/[\\/:*?\"<>|]/g, "_").trim() || "result";
}

function drawText(ctx, text, x, y, size, weight, align, color){
  ctx.save();
  ctx.font = `${weight || 400} ${size || 14}px Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", Arial, sans-serif`;
  ctx.fillStyle = color || "#111827";
  ctx.textAlign = align || "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r){
  const rr = Math.min(r||0, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
}

function card(ctx, x, y, w, h, r){
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.10)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = "#FFFFFF";
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.restore();
}

async function renderResultReportCanvas({ surveyTitle, companyName, totalScore, g1Rows }){
  // A4 비율(약 1:1.414)에 맞춘 고해상도 캔버스 (PDF 변환 전용)
  const pageW = 1240;
  const pageH = 1754;

  const fmtPoint = (n) => {
    if (!Number.isFinite(n)) return "0.0점";
    return (Math.round(n * 10) / 10).toFixed(1) + "점";
};

  // 숫자/문자(예: "8.1점") 어떤 형태든 점수로 안전 변환
  const toNum = (v) => {
    if (v == null) return 0;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const s = String(v).replace(/,/g, "");
    const m = s.match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : 0;
  };

  // ✅ 구분이 많아도 잘리지 않도록: 필요한 전체 높이를 산정해 캔버스를 세로로 확장
  const estimateReportHeight = () => {
    const margin = 80;
    let y = 70;

    // cover header
    y += 140;

    // basic info card
    y += 170;

    // total score card
    y += 140;

    // area scores
    y += 40;
    const colsPerRow = 7;
    const blockH = 120;
    const g1Count = Array.isArray(g1Rows) ? g1Rows.length : 0;
    y += Math.max(1, Math.ceil(g1Count / colsPerRow)) * (blockH + 18);

    // detail scores
    y += 40;
    const g2Cols = 4;
    const g2BlockH = 115;
    for (const g1 of (g1Rows || [])) {
      y += 72; // g1 header row
      const g2Count = (g1.g2 || []).length;
      y += Math.max(1, Math.ceil(g2Count / g2Cols)) * (g2BlockH + 14);
      y += 12;
    }

    return y + margin;
  };

  const c = document.createElement("canvas");
  c.width = pageW;
  c.height = Math.max(pageH, estimateReportHeight());
  const ctx = c.getContext("2d");

  // ---- theme ----
  const COLOR = {
    bg: "#F3F5F9",
    card: "#FFFFFF",
    ink: "#111827",
    muted: "#6B7280",
    border: "#D7DBE3",
    header: "#1F4D8F",
    header2: "#2B6CB0",
    tableHead: "#EEF2F7",
    chip: "#E9F2FF",
    danger: "#B91C1C"
  };
// ===== Section title spacing (tune here) =====
const TITLE_GAP_TOP = 26;     // 제목 위(이전 개체와) 간격 ↑
const TITLE_GAP_BOTTOM = 14;  // 제목 아래(다음 개체와) 간격 ↓

  // background
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, pageW, c.height);

  const margin = 80;
  let y = 70;


      // ===== pagination helper (avoid splitting a table/card across pages) =====
  // pdfFromCanvasMultiPage() slices this tall canvas by:
  //   CONTENT_H = PAGE_H_PX - TOP_PAD - BOTTOM_PAD
  // so we keep blocks aligned to that same boundary to avoid mid-table cuts.
  const CONTENT_H = pageH - (typeof TOP_PAD === "number" ? TOP_PAD : 70) - (typeof BOTTOM_PAD === "number" ? BOTTOM_PAD : 110);

  const moveToNextPage = (topGap = 24) => {
    const nextPageTop = Math.ceil((y + 0.0001) / CONTENT_H) * CONTENT_H;
    y = nextPageTop + topGap;
  };

  // Ensure the next block (height needH) doesn't cross a page boundary.
  // Call this RIGHT BEFORE drawing a card/table block.
  const ensureNoSplit = (needH, topGap = 24) => {
    if (needH <= 0) return;
    const pageTop = Math.floor(y / CONTENT_H) * CONTENT_H;
    const used = y - pageTop;
    if (used + needH > CONTENT_H) moveToNextPage(topGap);
  };

// helpers
  const setFont = (size, weight=400) => {
    ctx.font = `${weight} ${size}px "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
  };

  const roundedRectPath = (x, y, w, h, r) => {
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  };

  const card = (x, y, w, h, r=18) => {
    // shadow
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.10)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    roundedRectPath(x, y, w, h, r);
    ctx.fillStyle = COLOR.card;
    ctx.fill();
    ctx.restore();

    // border
    ctx.save();
    roundedRectPath(x, y, w, h, r);
    ctx.strokeStyle = COLOR.border;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  };

  const hLine = (x1, y1, x2, y2, w=2, color=COLOR.border) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  };

  const vLine = (x1, y1, x2, y2, w=2, color=COLOR.border) => hLine(x1,y1,x2,y2,w,color);

  const drawText = (t, x, y, size=24, weight=400, align="left", color=COLOR.ink) => {
    ctx.save();
    setFont(size, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillText(String(t ?? ""), x, y);
    ctx.restore();
  };

  const pill = (x, y, textVal, wPad=18, h=38) => {
    ctx.save();
    setFont(18, 700);
    const tw = ctx.measureText(textVal).width;
    const w = tw + wPad*2;
    const rx = x;
    const ry = y - h/2;
    roundedRectPath(rx, ry, w, h, 999);
    ctx.fillStyle = COLOR.chip;
    ctx.fill();
    ctx.strokeStyle = "rgba(31,77,143,0.25)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = COLOR.header;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(textVal, rx + wPad, y);
    ctx.restore();
    return w;
  };

  // ================== Cover Header ==================
  // header band
  ctx.save();
  roundedRectPath(margin, y, pageW - margin*2, 110, 22);
  const grd = ctx.createLinearGradient(margin, y, pageW-margin, y);
  grd.addColorStop(0, COLOR.header);
  grd.addColorStop(1, COLOR.header2);
  ctx.fillStyle = grd;
  ctx.fill();
  ctx.restore();

  drawText(`${surveyTitle} 결과`, margin + 36, y + 55, 34, 800, "left", "#FFFFFF");
  drawText(companyName, pageW - margin - 36, y + 55, 20, 600, "right", "rgba(255,255,255,0.92)");

  y += 140;

// ================== Basic Info ==================
const cardW = pageW - margin*2;
y += TITLE_GAP_TOP;
drawText("기본 정보", margin, y, 22, 800, "left", COLOR.header);
y += TITLE_GAP_BOTTOM;
  ensureNoSplit(140 + 18, 24);
card(margin, y, cardW, 140, 18);

const tx = margin + 28;
const leftW = 190;

// ✅ 표 영역(카드 내부) top/bottom
const innerTop = y + 22;
const innerBottom = y + 128;

// ✅ 2행이므로 행 높이 계산
const rowH = (innerBottom - innerTop) / 2;

// ✅ "평가명 ↔ 회사명" 사이 가로줄 (정중앙)
const midLineY = innerTop + rowH;

// ✅ 좌/우 컬럼 세로줄은 그대로
vLine(tx + leftW, innerTop, tx + leftW, innerBottom, 2, COLOR.border);

// ✅ 가로줄을 중간으로 이동
hLine(margin + 24, midLineY, margin + cardW - 24, midLineY, 2, COLOR.border);

// ✅ 각 행의 텍스트 Y(행 가운데)
const row1CY = innerTop + rowH * 0.5;
const row2CY = innerTop + rowH * 1.5;

drawText("평가명", tx, row1CY, 20, 700);
drawText(surveyTitle, tx + leftW + 18, row1CY, 20, 500);

drawText("회사명", tx, row2CY, 20, 700);
drawText(companyName, tx + leftW + 18, row2CY, 20, 500);


// 4) ✅ 카드(140) + 아래 여백(26) = 다음 섹션 시작 위치
y += 140 + 26;
// ✅ 페이지 안전영역(상단/하단바)과 겹치지 않게 자동 페이지 넘김
function ensureSpace(needH){
  return;
}

// ================== Total Score ==================
ensureSpace(170);
y += TITLE_GAP_TOP;
drawText("평가 결과", margin, y, 22, 800, "left", COLOR.header);
y += TITLE_GAP_BOTTOM;
const RESULT_H = 92; // ✅ 110 -> 92로 축소
  ensureNoSplit(RESULT_H + 18, 24);
card(margin, y, cardW, RESULT_H, 18);

const totalStr = fmtPoint(Number(totalScore || 0)); // 이미 "x.x점" 형태면 그대로 OK
drawText(`${surveyTitle}의 총점은`, margin + 28, y + 46, 22, 500);
drawText(`${totalStr}`, pageW - margin - 28, y + 46, 30, 900, "right", COLOR.ink);

// hint도 위로 당김
drawText("※ 배점 제외 항목은 점수 산정에서 제외됩니다.", margin + 28, y + 70, 16, 400, "left", COLOR.muted);

y += RESULT_H + 22; // ✅ 아래 여백도 살짝 줄임 (기존 28)

// ================== Area Scores ==================
ensureSpace(120);
y += TITLE_GAP_TOP;
drawText("영역별 점수", margin, y, 22, 800, "left", COLOR.header);
y += TITLE_GAP_BOTTOM;

const colsPerRow = 7;
const colW = cardW / colsPerRow;
const headH = 44;
const valH = 56;
const blockH = headH + valH;

for (let base=0; base<(g1Rows||[]).length; base+=colsPerRow){
  ensureSpace(blockH + 22);

  const chunk = (g1Rows||[]).slice(base, base+colsPerRow);

  ensureNoSplit(blockH + 18, 24);

  card(margin, y, cardW, blockH, 16);

  // header row background
  ctx.save();
  roundedRectPath(margin, y, cardW, headH, 16);
  ctx.clip();
  ctx.fillStyle = COLOR.tableHead;
  ctx.fillRect(margin, y, cardW, headH);
  ctx.restore();

  // grid
  hLine(margin, y + headH, margin + cardW, y + headH, 2, COLOR.border);
  for (let i=1;i<colsPerRow;i++){
    vLine(margin + colW*i, y, margin + colW*i, y + blockH, 2, COLOR.border);
  }

  chunk.forEach((g, i)=>{
    drawText(g.name, margin + colW*i + colW/2, y + headH/2, 16, 800, "center", COLOR.ink);

    // ✅ 영역별 점수는 100점 기준(score100Text) 표시
    const v = String(g.score100Text ?? "");
    const isExcluded = v === "배점제외";
    const show = isExcluded ? "배점제외" : fmtPoint(toNum(v)); // ✅ x.x점 통일
    drawText(show, margin + colW*i + colW/2, y + headH + valH/2, 20, 900, "center", isExcluded ? COLOR.muted : COLOR.ink);
  });

  y += blockH + 18;
}


// ================== Detail Scores ==================
ensureSpace(90);
y += TITLE_GAP_TOP;
drawText("상세 점수", margin, y, 22, 800, "left", COLOR.header);
y += TITLE_GAP_BOTTOM;

const g2Cols = 4;
const g2ColW = cardW / g2Cols;
const g2HeadH = 44;
const g2ValH = 52;
const g2BlockH = g2HeadH + g2ValH;

for (const g1 of (g1Rows || [])) {
  ensureSpace(70);

  // ✅ G1 title (no box, no G1 score)
  drawText(g1.name, margin, y + 22, 22, 900, "left", COLOR.ink);
  if (g1.excluded) {
    drawText("배점제외", pageW - margin, y + 22, 18, 700, "right", COLOR.muted);
  }

  // divider line
  hLine(margin, y + 40, margin + cardW, y + 40, 2, COLOR.border);
  y += 54;

  const g2 = g1.g2 || [];
  for (let base=0;base<g2.length;base+=g2Cols){
    ensureSpace(g2BlockH + 20);

    const chunk = g2.slice(base, base+g2Cols);

  ensureNoSplit(g2BlockH + 20, 24);

    card(margin, y, cardW, g2BlockH, 16);

    // header bg
    ctx.save();
    roundedRectPath(margin, y, cardW, g2HeadH, 16);
    ctx.clip();
    ctx.fillStyle = COLOR.tableHead;
    ctx.fillRect(margin, y, cardW, g2HeadH);
    ctx.restore();

    hLine(margin, y + g2HeadH, margin + cardW, y + g2HeadH, 2, COLOR.border);
    for (let i=1;i<g2Cols;i++){
      vLine(margin + g2ColW*i, y, margin + g2ColW*i, y + g2BlockH, 2, COLOR.border);
    }

    chunk.forEach((g, i)=>{
      drawText(g.name, margin + g2ColW*i + g2ColW/2, y + g2HeadH/2, 16, 800, "center");

      // ✅ 상세 점수(구분2)도 100점 기준(score100Text) 표시
      const v = String(g.score100Text ?? "");
      const isExcluded = v === "배점제외";
      const show = isExcluded ? "배점제외" : fmtPoint(toNum(v)); // ✅ x.x점 통일
      drawText(show, margin + g2ColW*i + g2ColW/2, y + g2HeadH + g2ValH/2, 20, 900, "center", isExcluded ? COLOR.muted : COLOR.ink);
    });

    y += g2BlockH + 14;
  }

  y += 16;
}

return c;
}

// ===== PDF Page Padding (global) =====
const TOP_PAD = 70;
const BOTTOM_PAD = 110;


// ---- canvas -> multi-page PDF (A4) ----
function pdfFromCanvasMultiPage(canvas, pageWpt, pageHpt){
  const PAGE_W_PX = 1240;
  const PAGE_H_PX = 1754;
  const CONTENT_H = PAGE_H_PX - TOP_PAD - BOTTOM_PAD;

  const totalPages = Math.max(1, Math.ceil(canvas.height / CONTENT_H));
  const urls = [];

  const getLogoImage = () =>
    (window.__reportLogoImage && window.__reportLogoImage.complete) ? window.__reportLogoImage : null;

  for (let i=0;i<totalPages;i++){
    const slice = document.createElement("canvas");
    slice.width = PAGE_W_PX;
    slice.height = PAGE_H_PX;
    const sctx = slice.getContext("2d");

    // page bg
    sctx.fillStyle = "#ffffff";
    sctx.fillRect(0,0,PAGE_W_PX,PAGE_H_PX);

    // --- header/footer bars (always reserved) ---
    const TOP_BAR_H = TOP_PAD;
    const BOT_BAR_H = BOTTOM_PAD;

    sctx.fillStyle = "#F3F5F9";
    sctx.fillRect(0, 0, PAGE_W_PX, TOP_BAR_H);

    sctx.fillStyle = "#F3F5F9";
    sctx.fillRect(0, PAGE_H_PX - BOT_BAR_H, PAGE_W_PX, BOT_BAR_H);

    sctx.strokeStyle = "rgba(31,77,143,0.18)";
    sctx.lineWidth = 2;

    sctx.beginPath();
    sctx.moveTo(60, TOP_BAR_H);
    sctx.lineTo(PAGE_W_PX - 60, TOP_BAR_H);
    sctx.stroke();

    sctx.beginPath();
    sctx.moveTo(60, PAGE_H_PX - BOT_BAR_H);
    sctx.lineTo(PAGE_W_PX - 60, PAGE_H_PX - BOT_BAR_H);
    sctx.stroke();

    // draw portion into content area (crop slice)
    const sy = i * CONTENT_H;
    const sh = Math.min(CONTENT_H, canvas.height - sy);

    // ✅ keep content background consistent even when the last slice is shorter
    sctx.fillStyle = "#F6F7FB";
    sctx.fillRect(0, TOP_PAD, PAGE_W_PX, CONTENT_H);

    if (sh > 0) {
      sctx.drawImage(
        canvas,
        0, sy, PAGE_W_PX, sh,
        0, TOP_PAD, PAGE_W_PX, sh
      );
    }

    const footerY = PAGE_H_PX - BOT_BAR_H + (BOT_BAR_H / 2);

    // footer divider
    const footerTop = PAGE_H_PX - BOTTOM_PAD + 18;
    sctx.strokeStyle = "rgba(0,0,0,0.12)";
    sctx.lineWidth = 2;
    sctx.beginPath();
    sctx.moveTo(70, footerTop);
    sctx.lineTo(PAGE_W_PX - 70, footerTop);
    sctx.stroke();

    // logo (left)
    const logo = getLogoImage();
    if (logo){
      const targetH = 28;
      const ratio = (logo.naturalWidth || logo.width || 1) / (logo.naturalHeight || logo.height || 1);
      const targetW = Math.max(24, targetH * ratio);
      sctx.drawImage(logo, 70, footerY - targetH/2, targetW, targetH);
    } else {
      sctx.fillStyle = "rgba(0,0,0,0.55)";
      sctx.font = '700 18px "Noto Sans KR","Malgun Gothic",sans-serif';
      sctx.textBaseline = "middle";
      sctx.fillText("© Sewon Survey System", 70, footerY);
    }

    // page number (right)
    const pageText = `${i+1} / ${totalPages}`;
    sctx.fillStyle = "rgba(0,0,0,0.55)";
    sctx.font = '600 16px "Noto Sans KR","Malgun Gothic",sans-serif';
    sctx.textBaseline = "middle";
    const tw = sctx.measureText(pageText).width;
    sctx.fillText(pageText, PAGE_W_PX - 70 - tw, footerY);

    // ✅ 핵심: 페이지 이미지를 urls에 저장
    urls.push(slice.toDataURL("image/jpeg", 0.92));
  }

  // ✅ 핵심: return은 for문 밖에서 한 번만
  return pdfFromJpegDataUrls(urls, pageWpt, pageHpt);
}


// ---- minimal PDF (multi page) from JPEGs (same size each) ----
function pdfFromJpegDataUrls(dataUrls, pageWpt, pageHpt){
  const enc = new TextEncoder();
  const parts = [];
  const push = (x) => parts.push(typeof x === "string" ? enc.encode(x) : x);

  const curLen = () => parts.reduce((a,b)=>a+b.length,0);
  const offsets = {};
  const startObj = (n) => { offsets[n] = curLen(); push(`${n} 0 obj\n`); };
  const endObj = () => push(`endobj\n`);

  const urls = Array.isArray(dataUrls) ? dataUrls : [dataUrls];
  const N = urls.length;

  // convert all images first
  const images = urls.map((dataUrl) => {
    const base64 = (String(dataUrl).split(",")[1] || "");
    const binStr = atob(base64);
    const imgBytes = new Uint8Array(binStr.length);
    for (let i=0;i<binStr.length;i++) imgBytes[i] = binStr.charCodeAt(i);
    return imgBytes;
  });

  push(PDF_HEADER);

  // 1: Catalog
  startObj(1);
  push(`<< /Type /Catalog /Pages 2 0 R >>\n`);
  endObj();

  // 2: Pages
  const kids = [];
  for (let i=0;i<N;i++){
    const pageNum = 3 + i*3;
    kids.push(`${pageNum} 0 R`);
  }
  startObj(2);
  push(`<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${N} >>\n`);
  endObj();

  // Per page objects
  for (let i=0;i<N;i++){
    const pageNum = 3 + i*3;
    const imgNum  = 4 + i*3;
    const contNum = 5 + i*3;

    startObj(pageNum);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWpt} ${pageHpt}] /Resources << /XObject << /Im0 ${imgNum} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${contNum} 0 R >>\n`);
    endObj();

    const imgBytes = images[i];
    startObj(imgNum);
    push(`<< /Type /XObject /Subtype /Image /Width 1240 /Height 1754 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgBytes.length} >>\nstream\n`);
    push(imgBytes);
    push(`\nendstream\n`);
    endObj();

    const content = `q\n${pageWpt} 0 0 ${pageHpt} 0 0 cm\n/Im0 Do\nQ\n`;
    const contentBytes = enc.encode(content);
    startObj(contNum);
    push(`<< /Length ${contentBytes.length} >>\nstream\n`);
    push(contentBytes);
    push(`\nendstream\n`);
    endObj();
  }

  const objCount = 2 + N*3;
  const xrefOffset = curLen();
  push(`xref\n0 ${objCount+1}\n`);
  push(`0000000000 65535 f \n`);
  for (let i=1;i<=objCount;i++){
    const off = offsets[i] || 0;
    push(String(off).padStart(10,"0") + " 00000 n \n");
  }
  push(`trailer\n<< /Size ${objCount+1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  const totalLen = curLen();
  const out = new Uint8Array(totalLen);
  let p = 0;
  for (const b of parts){
    out.set(b, p);
    p += b.length;
  }
  return out;
}


async function downloadResultPdfCore({ surveyTitle, companyName, totalScore, g1Rows }){
  const canvas = await renderResultReportCanvas({ surveyTitle, companyName, totalScore, g1Rows });
  const pdfBytes = pdfFromCanvasMultiPage(canvas, 595.28, 841.89); // A4 portrait in points
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = normalizeFilename(`${surveyTitle}_result_${companyName || ''}`) + '.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

// ------------------ Bind UI ------------------
  function bind() {
    // --- Top nav (설문 작성 / 설문 관리) ---
const navFill = document.getElementById("navFill");
const navManage = document.getElementById("navManage");
const navLibrary = document.getElementById("navLibrary");

if (navFill) navFill.onclick = () => setUserView("fill");
if (navManage) navManage.onclick = () => setUserView("manage");
if (navLibrary) navLibrary.onclick = () => setUserView("library");

const btnLibraryRefresh = document.getElementById("btnLibraryRefresh");
if (btnLibraryRefresh) btnLibraryRefresh.onclick = () => renderEvidenceLibraryView();
    const btnManageRefresh = document.getElementById("btnManageRefresh");
    if (btnManageRefresh) btnManageRefresh.onclick = () => refreshSurveyManageList();

    const f = $("fileImportXlsUser");
    const btnExp = $("btnExportXlsUser");

    if (f) {
      f.addEventListener("change", async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
          // ✅ 파일명(확장자 제외) 저장
          state.importFileBase = String(file.name || "").replace(/\.[^.]+$/, "").trim();

          // 1) 우선 text로 읽어 SpreadsheetML(관리자 내보내기 .xls)인지 확인
          // 2) text 파싱이 실패하거나, 바이너리로 보이면 (window.XLSX가 있을 때만) SheetJS로 파싱
          const buf = await file.arrayBuffer();
          let asText = "";
          try {
            // 앞부분만 디코딩해도 판별 가능
            asText = new TextDecoder("utf-8").decode(buf.slice(0, 2000));
          } catch (e) {}

          const looksLikeXml = asText.includes("<Workbook") || asText.trim().startsWith("<?xml");

          if (looksLikeXml) {
            const fullText = new TextDecoder("utf-8").decode(buf);
            importFromExcelXml(fullText);
          } else {
            if (!window.XLSX) {
              throw new Error("현재 업로드한 엑셀은 바이너리(.xls/.xlsx) 형식입니다. 관리자용 내보내기(.xls) 파일이거나, user.html에 SheetJS(XLSX) 스크립트를 추가해야 합니다.");
            }
            // SheetJS로 rows Map 생성 후 import 재사용
            const wb = window.XLSX.read(buf, { type: "array" });
            const sheetMap = new Map();
            (wb.SheetNames || []).forEach((name) => {
              const ws = wb.Sheets[name];
              const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
              sheetMap.set(name, rows || []);
            });
            importFromSheetRows(sheetMap);
          }
        } catch (err) {
          alert("설문 불러오기 실패: " + (err?.message || err));
        }
        e.target.value = "";
      });
    }
const btnLoad = $("btnLoadByCode");
if (btnLoad) {
  btnLoad.onclick = async (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }

    try { await loadSurveyByCode(); }
    catch (e) { alert("코드 불러오기 실패: " + (e?.message || e)); }
  };
}

const btnDraft = document.getElementById("btnSaveDraft");
if (btnDraft) {
  btnDraft.onclick = async () => {
    try {
      await saveDraftToServer();
    } catch (e) {
      alert("임시저장 실패: " + (e?.message || e));
      console.error(e);
    }
  };
}

const btnSubmit = document.getElementById("btnSubmitSurvey");
if (btnSubmit) {
  btnSubmit.onclick = async () => {
    try {
      await submitToServer();
    } catch (e) {
      alert("제출 실패: " + (e?.message || e));
      console.error(e);
    }
  };
}



const btnRecall = document.getElementById("btnRecallSurvey");
if (btnRecall) {
  btnRecall.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log("[UI] btnRecallSurvey click");
    try {
      await recallSubmission();
    } catch (err) {
      alert("회수 실패: " + (err?.message || err));
      console.error(err);
    }
  });
}

const codeInput = $("surveyCodeInput");
if (codeInput) {
  codeInput.onkeydown = (ev) => {
    if (ev.key === "Enter") btnLoad?.click();
  };

  // ✅ 결과 다운로드 버튼(관리자가 '결과 전송'을 눌렀을 때만 노출)
  if (!document.getElementById("btnDownloadResult")) {
    const btnRes = document.createElement("button");
    btnRes.id = "btnDownloadResult";
    btnRes.className = "btn";
    btnRes.type = "button";
    btnRes.textContent = "결과 다운로드";
    btnRes.style.display = "none";
    btnRes.style.marginRight = "8px";
    btnRes.onclick = async () => {
      try {
        await downloadMyResultPdf();
      } catch (e) {
        alert("결과 다운로드 실패: " + (e?.message || e));
        console.error(e);
      }
    };

    // input 앞(좌측)에 삽입 (✅ insertBefore 에러 방지: codeInput이 DOM에서 교체/이동되는 경우 대비)
    try{
      if (codeInput.isConnected){
        codeInput.insertAdjacentElement("beforebegin", btnRes);
      }else{
        const parent = codeInput.parentElement;
        if (parent) parent.prepend(btnRes);
      }
    }catch(_e){
      const parent = codeInput.parentElement;
      if (parent) parent.prepend(btnRes);
    }
  }
}

    $("targetCompany").oninput = (e) => {
      state.target.company = e.target.value;
    };
    $("targetName").oninput = (e) => {
      state.target.name = e.target.value;
    };

    if (btnExp) {
      btnExp.onclick = () => {
        try {
          exportFilledSurveyAsExcelXml();
        } catch (err) {
          alert("설문 내보내기 실패: " + (err?.message || err));
        }
      };
    }
  const btnLogout = $("btnLogout");
  if (btnLogout) {
    btnLogout.onclick = async () => {
      try {
        await sb.auth.signOut();   // ← 여기
        openAuthModal();           // ← 그리고 여기
      } catch (e) {
        alert("로그아웃 실패: " + (e?.message || e));
      }
    };
  }
const btnNext = $("btnNextG2");
const btnPrev = $("btnPrevG2");

if (btnNext && btnPrev) {
  // ✅ fixed가 transform(.view) 영향 안 받도록 body로 옮겨서 플로팅
  let floating = document.getElementById("floatingNav");
  if (!floating) {
    floating = document.createElement("div");
    floating.id = "floatingNav";
    floating.className = "nav-floating";
    document.body.appendChild(floating);
  } else {
    floating.classList.add("nav-floating");
  }

  // 버튼을 기존 자리에서 분리해서 body의 floating 컨테이너로 이동
  floating.appendChild(btnPrev);
  floating.appendChild(btnNext);

  btnNext.onclick = () => goNextG2();
  btnPrev.onclick = () => goPrevG2();
}

// ================== Result Download (user) ==================
function updateResultDownloadUI(){
  const btn = document.getElementById("btnDownloadResult");
  if(!btn) return;
  const sent = !!(state.myResponseMeta && state.myResponseMeta.resultSent);
  btn.style.display = sent ? "" : "none";
  btn.disabled = !sent;
}

// expose for any global callers (safe)
try{ window.updateResultDownloadUI = updateResultDownloadUI; }catch(_){ }

async function downloadMyResultPdf(){
  // 1) 로그인 확인
  const session = await requireLoginOrModal();
  const uid = session?.user?.id;
  if (!uid) throw new Error("로그인이 필요합니다.");

  // 2) 설문/응답 확인
  if (!state.server?.id) throw new Error("설문을 먼저 불러오세요.");

  const { data, error } = await sb
    .from("responses")
    .select("submitted_json")
    .eq("survey_id", state.server.id)
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw error;
  const sj = data?.submitted_json;
  if (!sj) throw new Error("제출된 응답이 없습니다.");
  if (!(sj.result_sent || sj.resultSent)) throw new Error("아직 관리자가 결과 전송을 하지 않았습니다.");

  // 3) 관리자에서 생성해 둔 report_payload 사용
  const rep = sj.report_payload;
  if (!rep || !rep.g1Rows) throw new Error("리포트 데이터가 없습니다. 관리자에서 '결과 전송'을 다시 눌러 주세요.");

  const surveyTitle = state.server?.title || state.survey?.title || "설문";
  const companyName = (state.target?.company || sj?.target?.company || sj?.company || "").trim();
  const totalScore = Number(rep.totalScore || 0);
  const g1Rows = rep.g1Rows || [];

  await downloadResultPdfCore({ surveyTitle, companyName, totalScore, g1Rows });
}
// expose for button handler fallback
try{ window.downloadMyResultPdf = downloadMyResultPdf; }catch(_){ }


// ---- Report PDF core (ported from admin) ----
function normalizeFilename(name){
  return String(name || "").replace(/[\\/:*?\"<>|]/g, "_").trim() || "result";
}

function drawText(ctx, text, x, y, size, weight, align, color){
  ctx.save();
  ctx.font = `${weight || 400} ${size || 14}px Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", Arial, sans-serif`;
  ctx.fillStyle = color || "#111827";
  ctx.textAlign = align || "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r){
  const rr = Math.min(r||0, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
}

function card(ctx, x, y, w, h, r){
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.10)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = "#FFFFFF";
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.restore();
}

async function renderResultReportCanvas({ surveyTitle, companyName, totalScore, g1Rows }){
  // A4 비율(약 1:1.414)에 맞춘 고해상도 캔버스 (PDF 변환 전용)
  const pageW = 1240;
  const pageH = 1754;

  const fmtPoint = (n) => {
    if (!Number.isFinite(n)) return "0.0점";
    return (Math.round(n * 10) / 10).toFixed(1) + "점";
};

  // 숫자/문자(예: "8.1점") 어떤 형태든 점수로 안전 변환
  const toNum = (v) => {
    if (v == null) return 0;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const s = String(v).replace(/,/g, "");
    const m = s.match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : 0;
  };

  // ✅ 구분이 많아도 잘리지 않도록: 필요한 전체 높이를 산정해 캔버스를 세로로 확장
  const estimateReportHeight = () => {
    const margin = 80;
    let y = 70;

    // cover header
    y += 140;

    // basic info card
    y += 170;

    // total score card
    y += 140;

    // area scores
    y += 40;
    const colsPerRow = 7;
    const blockH = 120;
    const g1Count = Array.isArray(g1Rows) ? g1Rows.length : 0;
    y += Math.max(1, Math.ceil(g1Count / colsPerRow)) * (blockH + 18);

    // detail scores
    y += 40;
    const g2Cols = 4;
    const g2BlockH = 115;
    for (const g1 of (g1Rows || [])) {
      y += 72; // g1 header row
      const g2Count = (g1.g2 || []).length;
      y += Math.max(1, Math.ceil(g2Count / g2Cols)) * (g2BlockH + 14);
      y += 12;
    }

    return y + margin;
  };

  const c = document.createElement("canvas");
  c.width = pageW;
  c.height = Math.max(pageH, estimateReportHeight());
  const ctx = c.getContext("2d");

  // ---- theme ----
  const COLOR = {
    bg: "#F3F5F9",
    card: "#FFFFFF",
    ink: "#111827",
    muted: "#6B7280",
    border: "#D7DBE3",
    header: "#1F4D8F",
    header2: "#2B6CB0",
    tableHead: "#EEF2F7",
    chip: "#E9F2FF",
    danger: "#B91C1C"
  };
// ===== Section title spacing (tune here) =====
const TITLE_GAP_TOP = 26;     // 제목 위(이전 개체와) 간격 ↑
const TITLE_GAP_BOTTOM = 14;  // 제목 아래(다음 개체와) 간격 ↓

  // background
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, pageW, c.height);

  const margin = 80;
  let y = 70;


      // ===== pagination helper (avoid splitting a table/card across pages) =====
  // pdfFromCanvasMultiPage() slices this tall canvas by:
  //   CONTENT_H = PAGE_H_PX - TOP_PAD - BOTTOM_PAD
  // so we keep blocks aligned to that same boundary to avoid mid-table cuts.
  const CONTENT_H = pageH - (typeof TOP_PAD === "number" ? TOP_PAD : 70) - (typeof BOTTOM_PAD === "number" ? BOTTOM_PAD : 110);

  const moveToNextPage = (topGap = 24) => {
    const nextPageTop = Math.ceil((y + 0.0001) / CONTENT_H) * CONTENT_H;
    y = nextPageTop + topGap;
  };

  // Ensure the next block (height needH) doesn't cross a page boundary.
  // Call this RIGHT BEFORE drawing a card/table block.
  const ensureNoSplit = (needH, topGap = 24) => {
    if (needH <= 0) return;
    const pageTop = Math.floor(y / CONTENT_H) * CONTENT_H;
    const used = y - pageTop;
    if (used + needH > CONTENT_H) moveToNextPage(topGap);
  };

// helpers
  const setFont = (size, weight=400) => {
    ctx.font = `${weight} ${size}px "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
  };

  const roundedRectPath = (x, y, w, h, r) => {
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  };

  const card = (x, y, w, h, r=18) => {
    // shadow
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.10)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    roundedRectPath(x, y, w, h, r);
    ctx.fillStyle = COLOR.card;
    ctx.fill();
    ctx.restore();

    // border
    ctx.save();
    roundedRectPath(x, y, w, h, r);
    ctx.strokeStyle = COLOR.border;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  };

  const hLine = (x1, y1, x2, y2, w=2, color=COLOR.border) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  };

  const vLine = (x1, y1, x2, y2, w=2, color=COLOR.border) => hLine(x1,y1,x2,y2,w,color);

  const drawText = (t, x, y, size=24, weight=400, align="left", color=COLOR.ink) => {
    ctx.save();
    setFont(size, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillText(String(t ?? ""), x, y);
    ctx.restore();
  };

  const pill = (x, y, textVal, wPad=18, h=38) => {
    ctx.save();
    setFont(18, 700);
    const tw = ctx.measureText(textVal).width;
    const w = tw + wPad*2;
    const rx = x;
    const ry = y - h/2;
    roundedRectPath(rx, ry, w, h, 999);
    ctx.fillStyle = COLOR.chip;
    ctx.fill();
    ctx.strokeStyle = "rgba(31,77,143,0.25)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = COLOR.header;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(textVal, rx + wPad, y);
    ctx.restore();
    return w;
  };

  // ================== Cover Header ==================
  // header band
  ctx.save();
  roundedRectPath(margin, y, pageW - margin*2, 110, 22);
  const grd = ctx.createLinearGradient(margin, y, pageW-margin, y);
  grd.addColorStop(0, COLOR.header);
  grd.addColorStop(1, COLOR.header2);
  ctx.fillStyle = grd;
  ctx.fill();
  ctx.restore();

  drawText(`${surveyTitle} 결과`, margin + 36, y + 55, 34, 800, "left", "#FFFFFF");
  drawText(companyName, pageW - margin - 36, y + 55, 20, 600, "right", "rgba(255,255,255,0.92)");

  y += 140;

// ================== Basic Info ==================
const cardW = pageW - margin*2;
y += TITLE_GAP_TOP;
drawText("기본 정보", margin, y, 22, 800, "left", COLOR.header);
y += TITLE_GAP_BOTTOM;
  ensureNoSplit(140 + 18, 24);
card(margin, y, cardW, 140, 18);

const tx = margin + 28;
const leftW = 190;

// ✅ 표 영역(카드 내부) top/bottom
const innerTop = y + 22;
const innerBottom = y + 128;

// ✅ 2행이므로 행 높이 계산
const rowH = (innerBottom - innerTop) / 2;

// ✅ "평가명 ↔ 회사명" 사이 가로줄 (정중앙)
const midLineY = innerTop + rowH;

// ✅ 좌/우 컬럼 세로줄은 그대로
vLine(tx + leftW, innerTop, tx + leftW, innerBottom, 2, COLOR.border);

// ✅ 가로줄을 중간으로 이동
hLine(margin + 24, midLineY, margin + cardW - 24, midLineY, 2, COLOR.border);

// ✅ 각 행의 텍스트 Y(행 가운데)
const row1CY = innerTop + rowH * 0.5;
const row2CY = innerTop + rowH * 1.5;

drawText("평가명", tx, row1CY, 20, 700);
drawText(surveyTitle, tx + leftW + 18, row1CY, 20, 500);

drawText("회사명", tx, row2CY, 20, 700);
drawText(companyName, tx + leftW + 18, row2CY, 20, 500);


// 4) ✅ 카드(140) + 아래 여백(26) = 다음 섹션 시작 위치
y += 140 + 26;
// ✅ 페이지 안전영역(상단/하단바)과 겹치지 않게 자동 페이지 넘김
function ensureSpace(needH){
  return;
}

// ================== Total Score ==================
ensureSpace(170);
y += TITLE_GAP_TOP;
drawText("평가 결과", margin, y, 22, 800, "left", COLOR.header);
y += TITLE_GAP_BOTTOM;
const RESULT_H = 92; // ✅ 110 -> 92로 축소
  ensureNoSplit(RESULT_H + 18, 24);
card(margin, y, cardW, RESULT_H, 18);

const totalStr = fmtPoint(Number(totalScore || 0)); // 이미 "x.x점" 형태면 그대로 OK
drawText(`${surveyTitle}의 총점은`, margin + 28, y + 46, 22, 500);
drawText(`${totalStr}`, pageW - margin - 28, y + 46, 30, 900, "right", COLOR.ink);

// hint도 위로 당김
drawText("※ 배점 제외 항목은 점수 산정에서 제외됩니다.", margin + 28, y + 70, 16, 400, "left", COLOR.muted);

y += RESULT_H + 22; // ✅ 아래 여백도 살짝 줄임 (기존 28)

// ================== Area Scores ==================
ensureSpace(120);
y += TITLE_GAP_TOP;
drawText("영역별 점수", margin, y, 22, 800, "left", COLOR.header);
y += TITLE_GAP_BOTTOM;

const colsPerRow = 7;
const colW = cardW / colsPerRow;
const headH = 44;
const valH = 56;
const blockH = headH + valH;

for (let base=0; base<(g1Rows||[]).length; base+=colsPerRow){
  ensureSpace(blockH + 22);

  const chunk = (g1Rows||[]).slice(base, base+colsPerRow);

  ensureNoSplit(blockH + 18, 24);

  card(margin, y, cardW, blockH, 16);

  // header row background
  ctx.save();
  roundedRectPath(margin, y, cardW, headH, 16);
  ctx.clip();
  ctx.fillStyle = COLOR.tableHead;
  ctx.fillRect(margin, y, cardW, headH);
  ctx.restore();

  // grid
  hLine(margin, y + headH, margin + cardW, y + headH, 2, COLOR.border);
  for (let i=1;i<colsPerRow;i++){
    vLine(margin + colW*i, y, margin + colW*i, y + blockH, 2, COLOR.border);
  }

  chunk.forEach((g, i)=>{
    drawText(g.name, margin + colW*i + colW/2, y + headH/2, 16, 800, "center", COLOR.ink);

    // ✅ 영역별 점수는 100점 기준(score100Text) 표시
    const v = String(g.score100Text ?? "");
    const isExcluded = v === "배점제외";
    const show = isExcluded ? "배점제외" : fmtPoint(toNum(v)); // ✅ x.x점 통일
    drawText(show, margin + colW*i + colW/2, y + headH + valH/2, 20, 900, "center", isExcluded ? COLOR.muted : COLOR.ink);
  });

  y += blockH + 18;
}


// ================== Detail Scores ==================
ensureSpace(90);
y += TITLE_GAP_TOP;
drawText("상세 점수", margin, y, 22, 800, "left", COLOR.header);
y += TITLE_GAP_BOTTOM;

const g2Cols = 4;
const g2ColW = cardW / g2Cols;
const g2HeadH = 44;
const g2ValH = 52;
const g2BlockH = g2HeadH + g2ValH;

for (const g1 of (g1Rows || [])) {
  ensureSpace(70);

  // ✅ G1 title (no box, no G1 score)
  drawText(g1.name, margin, y + 22, 22, 900, "left", COLOR.ink);
  if (g1.excluded) {
    drawText("배점제외", pageW - margin, y + 22, 18, 700, "right", COLOR.muted);
  }

  // divider line
  hLine(margin, y + 40, margin + cardW, y + 40, 2, COLOR.border);
  y += 54;

  const g2 = g1.g2 || [];
  for (let base=0;base<g2.length;base+=g2Cols){
    ensureSpace(g2BlockH + 20);

    const chunk = g2.slice(base, base+g2Cols);

  ensureNoSplit(g2BlockH + 20, 24);

    card(margin, y, cardW, g2BlockH, 16);

    // header bg
    ctx.save();
    roundedRectPath(margin, y, cardW, g2HeadH, 16);
    ctx.clip();
    ctx.fillStyle = COLOR.tableHead;
    ctx.fillRect(margin, y, cardW, g2HeadH);
    ctx.restore();

    hLine(margin, y + g2HeadH, margin + cardW, y + g2HeadH, 2, COLOR.border);
    for (let i=1;i<g2Cols;i++){
      vLine(margin + g2ColW*i, y, margin + g2ColW*i, y + g2BlockH, 2, COLOR.border);
    }

    chunk.forEach((g, i)=>{
      drawText(g.name, margin + g2ColW*i + g2ColW/2, y + g2HeadH/2, 16, 800, "center");

      // ✅ 상세 점수(구분2)도 100점 기준(score100Text) 표시
      const v = String(g.score100Text ?? "");
      const isExcluded = v === "배점제외";
      const show = isExcluded ? "배점제외" : fmtPoint(toNum(v)); // ✅ x.x점 통일
      drawText(show, margin + g2ColW*i + g2ColW/2, y + g2HeadH + g2ValH/2, 20, 900, "center", isExcluded ? COLOR.muted : COLOR.ink);
    });

    y += g2BlockH + 14;
  }

  y += 16;
}

return c;
}

// ===== PDF Page Padding (global) =====
const TOP_PAD = 70;
const BOTTOM_PAD = 110;


// ---- canvas -> multi-page PDF (A4) ----
function pdfFromCanvasMultiPage(canvas, pageWpt, pageHpt){
  const PAGE_W_PX = 1240;
  const PAGE_H_PX = 1754;
  const CONTENT_H = PAGE_H_PX - TOP_PAD - BOTTOM_PAD;

  const totalPages = Math.max(1, Math.ceil(canvas.height / CONTENT_H));
  const urls = [];

  const getLogoImage = () =>
    (window.__reportLogoImage && window.__reportLogoImage.complete) ? window.__reportLogoImage : null;

  for (let i=0;i<totalPages;i++){
    const slice = document.createElement("canvas");
    slice.width = PAGE_W_PX;
    slice.height = PAGE_H_PX;
    const sctx = slice.getContext("2d");

    // page bg
    sctx.fillStyle = "#ffffff";
    sctx.fillRect(0,0,PAGE_W_PX,PAGE_H_PX);

    // --- header/footer bars (always reserved) ---
    const TOP_BAR_H = TOP_PAD;
    const BOT_BAR_H = BOTTOM_PAD;

    sctx.fillStyle = "#F3F5F9";
    sctx.fillRect(0, 0, PAGE_W_PX, TOP_BAR_H);

    sctx.fillStyle = "#F3F5F9";
    sctx.fillRect(0, PAGE_H_PX - BOT_BAR_H, PAGE_W_PX, BOT_BAR_H);

    sctx.strokeStyle = "rgba(31,77,143,0.18)";
    sctx.lineWidth = 2;

    sctx.beginPath();
    sctx.moveTo(60, TOP_BAR_H);
    sctx.lineTo(PAGE_W_PX - 60, TOP_BAR_H);
    sctx.stroke();

    sctx.beginPath();
    sctx.moveTo(60, PAGE_H_PX - BOT_BAR_H);
    sctx.lineTo(PAGE_W_PX - 60, PAGE_H_PX - BOT_BAR_H);
    sctx.stroke();

    // draw portion into content area (crop slice)
    const sy = i * CONTENT_H;
    const sh = Math.min(CONTENT_H, canvas.height - sy);

    // ✅ keep content background consistent even when the last slice is shorter
    sctx.fillStyle = "#F6F7FB";
    sctx.fillRect(0, TOP_PAD, PAGE_W_PX, CONTENT_H);

    if (sh > 0) {
      sctx.drawImage(
        canvas,
        0, sy, PAGE_W_PX, sh,
        0, TOP_PAD, PAGE_W_PX, sh
      );
    }

    const footerY = PAGE_H_PX - BOT_BAR_H + (BOT_BAR_H / 2);

    // footer divider
    const footerTop = PAGE_H_PX - BOTTOM_PAD + 18;
    sctx.strokeStyle = "rgba(0,0,0,0.12)";
    sctx.lineWidth = 2;
    sctx.beginPath();
    sctx.moveTo(70, footerTop);
    sctx.lineTo(PAGE_W_PX - 70, footerTop);
    sctx.stroke();

    // logo (left)
    const logo = getLogoImage();
    if (logo){
      const targetH = 28;
      const ratio = (logo.naturalWidth || logo.width || 1) / (logo.naturalHeight || logo.height || 1);
      const targetW = Math.max(24, targetH * ratio);
      sctx.drawImage(logo, 70, footerY - targetH/2, targetW, targetH);
    } else {
      sctx.fillStyle = "rgba(0,0,0,0.55)";
      sctx.font = '700 18px "Noto Sans KR","Malgun Gothic",sans-serif';
      sctx.textBaseline = "middle";
      sctx.fillText("© Sewon Survey System", 70, footerY);
    }

    // page number (right)
    const pageText = `${i+1} / ${totalPages}`;
    sctx.fillStyle = "rgba(0,0,0,0.55)";
    sctx.font = '600 16px "Noto Sans KR","Malgun Gothic",sans-serif';
    sctx.textBaseline = "middle";
    const tw = sctx.measureText(pageText).width;
    sctx.fillText(pageText, PAGE_W_PX - 70 - tw, footerY);

    // ✅ 핵심: 페이지 이미지를 urls에 저장
    urls.push(slice.toDataURL("image/jpeg", 0.92));
  }

  // ✅ 핵심: return은 for문 밖에서 한 번만
  return pdfFromJpegDataUrls(urls, pageWpt, pageHpt);
}


// ---- minimal PDF (multi page) from JPEGs (same size each) ----
function pdfFromJpegDataUrls(dataUrls, pageWpt, pageHpt){
  const enc = new TextEncoder();
  const parts = [];
  const push = (x) => parts.push(typeof x === "string" ? enc.encode(x) : x);

  const curLen = () => parts.reduce((a,b)=>a+b.length,0);
  const offsets = {};
  const startObj = (n) => { offsets[n] = curLen(); push(`${n} 0 obj\n`); };
  const endObj = () => push(`endobj\n`);

  const urls = Array.isArray(dataUrls) ? dataUrls : [dataUrls];
  const N = urls.length;

  // convert all images first
  const images = urls.map((dataUrl) => {
    const base64 = (String(dataUrl).split(",")[1] || "");
    const binStr = atob(base64);
    const imgBytes = new Uint8Array(binStr.length);
    for (let i=0;i<binStr.length;i++) imgBytes[i] = binStr.charCodeAt(i);
    return imgBytes;
  });

  push(PDF_HEADER);

  // 1: Catalog
  startObj(1);
  push(`<< /Type /Catalog /Pages 2 0 R >>\n`);
  endObj();

  // 2: Pages
  const kids = [];
  for (let i=0;i<N;i++){
    const pageNum = 3 + i*3;
    kids.push(`${pageNum} 0 R`);
  }
  startObj(2);
  push(`<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${N} >>\n`);
  endObj();

  // Per page objects
  for (let i=0;i<N;i++){
    const pageNum = 3 + i*3;
    const imgNum  = 4 + i*3;
    const contNum = 5 + i*3;

    startObj(pageNum);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWpt} ${pageHpt}] /Resources << /XObject << /Im0 ${imgNum} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${contNum} 0 R >>\n`);
    endObj();

    const imgBytes = images[i];
    startObj(imgNum);
    push(`<< /Type /XObject /Subtype /Image /Width 1240 /Height 1754 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgBytes.length} >>\nstream\n`);
    push(imgBytes);
    push(`\nendstream\n`);
    endObj();

    const content = `q\n${pageWpt} 0 0 ${pageHpt} 0 0 cm\n/Im0 Do\nQ\n`;
    const contentBytes = enc.encode(content);
    startObj(contNum);
    push(`<< /Length ${contentBytes.length} >>\nstream\n`);
    push(contentBytes);
    push(`\nendstream\n`);
    endObj();
  }

  const objCount = 2 + N*3;
  const xrefOffset = curLen();
  push(`xref\n0 ${objCount+1}\n`);
  push(`0000000000 65535 f \n`);
  for (let i=1;i<=objCount;i++){
    const off = offsets[i] || 0;
    push(String(off).padStart(10,"0") + " 00000 n \n");
  }
  push(`trailer\n<< /Size ${objCount+1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  const totalLen = curLen();
  const out = new Uint8Array(totalLen);
  let p = 0;
  for (const b of parts){
    out.set(b, p);
    p += b.length;
  }
  return out;
}


async function downloadResultPdfCore({ surveyTitle, companyName, totalScore, g1Rows }){
  const canvas = await renderResultReportCanvas({ surveyTitle, companyName, totalScore, g1Rows });
  const pdfBytes = pdfFromCanvasMultiPage(canvas, 595.28, 841.89); // A4 portrait in points
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = normalizeFilename(`${surveyTitle}_result_${companyName || ''}`) + '.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

  }
document.addEventListener("DOMContentLoaded", () => {
  ensureDisabledOverlayStyles();
  bind();
  renderAll();
  updateSubmitUiState();
    openAuthModal();

  (async () => {
    try {
      await requireLoginOrModal();
    } catch (e) {
      console.error(e);
    }
  })();
});


// ================== User pill click menu (dropdown) ==================
let ss_dropdownEl = null;

function ss_escape(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}

function ss_mapMemberTypeLabel(memberType, role){
  // reuse existing mapMemberType if present
  let label = "";
  try{
    if (typeof mapMemberType === "function") label = mapMemberType(memberType);
    else label = String(memberType ?? "");
  }catch(_){
    label = String(memberType ?? "");
  }
  if(!label) return "";
  const r = String(role ?? "").toLowerCase();
  if(r === "admin") return label + "(ADMIN)";
  if(r === "user") return label + "(USER)";
  return label;
}

async function ss_getProfileForModal(){
  try{
    const { data } = await sb.auth.getSession();
    const session = data?.session;
    if(!session) return null;

    const user = session.user;
    const md = user.user_metadata || {};

    const baseProfile = {
      email: user.email || "",
      name: md.name || md.full_name || md.user_name || "",
      company: md.company || md.company_name || md.organization || "",
      member_type: md.member_type || md.user_type || md.memberType || md.account_type || "",
      role: md.role || md.account_role || md.user_role || "",
      emp_no: md.emp_no || md.employee_no || md.sabun || md.employee_id || ""
    };

    // If missing important fields, try DB lookup (best-effort)
    const uid = user.id;
    const tables = [
      { table:"user_profiles", idField:"auth_user_id" },
      { table:"profiles", idField:"auth_user_id" },
      { table:"users", idField:"id" },
      { table:"members", idField:"id" },
      { table:"user_accounts", idField:"auth_user_id" },
      { table:"accounts", idField:"auth_user_id" },
    ];

    for(const t of tables){
      try{
        const { data: row, error } = await sb.from(t.table).select("*").eq(t.idField, uid).maybeSingle();
        if(!error && row){
          return {
            email: row.email || baseProfile.email,
            name: row.name || row.full_name || row.user_name || baseProfile.name,
            company: row.company || row.company_name || row.organization || baseProfile.company,
            member_type: row.member_type || row.user_type || row.memberType || row.account_type || baseProfile.member_type,
            role: row.role || row.account_role || row.user_role || baseProfile.role,
            emp_no: row.emp_no || row.employee_no || row.sabun || row.employee_id || baseProfile.emp_no
          };
        }
      }catch(_){}
    }

    return baseProfile;
  }catch(_){
    return null;
  }
}

function ss_ensureDropdown(){
  if(ss_dropdownEl) return ss_dropdownEl;

  const el = document.createElement("div");
  el.id = "ssUserDropdown";
  el.className = "user-dropdown";
  el.style.position = "absolute";
  el.style.minWidth = "180px";
  el.style.zIndex = "100000";
  el.style.display = "none";

  el.innerHTML = `
    <button type="button" class="dropdown-item" data-act="profile">개인정보 관리</button>
    <button type="button" class="dropdown-item" data-act="settings">설정</button>
    <div class="divider"></div>
    <button type="button" class="dropdown-item" data-act="logout">로그아웃</button>
  `;
  document.body.appendChild(el);
  ss_dropdownEl = el;

  el.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if(!btn) return;
    const act = btn.getAttribute("data-act");
    ss_hideDropdown();

    if(act === "profile"){
      ss_openProfileModal();
    }else if(act === "settings"){
      ss_openSettingsModal();
    }else if(act === "logout"){
      await ss_logout();
    }
  });

  return el;
}

function ss_positionDropdown(){
  const pill = document.getElementById("userPill") || document.querySelector(".user-pill");
  if(!pill || !ss_dropdownEl) return;

  // Use FIXED positioning so DevTools/scroll doesn't break coordinates
  ss_dropdownEl.style.position = "fixed";

  const r = pill.getBoundingClientRect();

  // Ensure dropdown has a measurable size
  const dr = ss_dropdownEl.getBoundingClientRect();
  const dw = dr.width || ss_dropdownEl.offsetWidth || 180;

  const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);

  const top = Math.min(r.bottom + 8, (window.innerHeight || 0) - 8); // safe
  let left = r.right - dw;
  left = Math.max(8, Math.min(left, vw - dw - 8));

  ss_dropdownEl.style.top = `${top}px`;
  ss_dropdownEl.style.left = `${left}px`;
}

function ss_showDropdown(){
  ss_ensureDropdown();

  // Force display even if CSS has display:none !important
  ss_dropdownEl.style.setProperty("display", "block", "important");
  ss_dropdownEl.style.visibility = "hidden";

  // Next frame: measure + position, then reveal
  requestAnimationFrame(() => {
    try{ ss_positionDropdown(); }catch(_){}
    ss_dropdownEl.style.visibility = "visible";
  });
}

function ss_hideDropdown(){
  if(ss_dropdownEl) ss_dropdownEl.style.display = "none";
}

function ss_toggleDropdown(){
  ss_ensureDropdown();
  const open = ss_dropdownEl.style.display === "block";
  if(open) ss_hideDropdown();
  else ss_showDropdown();
}

function ss_openModal(title, bodyHtml, footerHtml){
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.style.position = "fixed";
  wrap.style.inset = "0";
  wrap.style.zIndex = "100001";

  wrap.innerHTML = `
    <div class="modal-card" style="
      position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
      width:min(760px, calc(100vw - 40px));
      border-radius:18px; overflow:hidden;
      background: var(--panel, #fff);
      border: 1px solid var(--line, #e5e7eb);
    ">
      <div style="display:flex; align-items:center; justify-content:space-between; padding:16px 18px; border-bottom:1px solid var(--line, #e5e7eb);">
        <div style="font-weight:900;">${ss_escape(title)}</div>
        <button type="button" class="modal-close" data-close="1" style="width:34px; height:34px; border-radius:10px;">✕</button>
      </div>
      <div style="padding:18px;">${bodyHtml}</div>
      ${footerHtml ? `<div style="padding:14px 18px; border-top:1px solid var(--line, #e5e7eb); display:flex; justify-content:flex-end; gap:10px;">${footerHtml}</div>` : ""}
    </div>
  `;

  wrap.addEventListener("click", (e) => {
    if(e.target === wrap || e.target.closest("[data-close]")) wrap.remove();
  });

  document.body.appendChild(wrap);
  return wrap;
}

async function ss_openProfileModal(){
  const p = await ss_getProfileForModal();

  const memberLabel = ss_mapMemberTypeLabel(p?.member_type || "", p?.role || "");

  const body = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
      <label style="display:flex; flex-direction:column; gap:6px; font-weight:800;">
        이름
        <input type="text" value="${ss_escape(p?.name || "")}" readonly />
      </label>
      <label style="display:flex; flex-direction:column; gap:6px; font-weight:800;">
        회원구분
        <input type="text" value="${ss_escape(memberLabel)}" readonly />
      </label>
      <label style="display:flex; flex-direction:column; gap:6px; font-weight:800;">
        회사
        <input type="text" value="${ss_escape(p?.company || "")}" readonly />
      </label>
      <label style="display:flex; flex-direction:column; gap:6px; font-weight:800;" id="ssEmpRow">
        사번(세원임직원일 경우)
        <input type="text" value="${ss_escape(p?.emp_no || "")}" readonly />
      </label>
      <label style="grid-column:1 / -1; display:flex; flex-direction:column; gap:6px; font-weight:800;">
        이메일 주소
        <input type="text" value="${ss_escape(p?.email || "")}" readonly />
      </label>
    </div>
  `;

  const modal = ss_openModal("개인정보 관리", body, `<button type="button" class="btn" data-close="1">닫기</button>`);

  if(!p?.emp_no){
    const empRow = modal.querySelector("#ssEmpRow");
    if(empRow) empRow.style.display = "none";
  }
}

function ss_openSettingsModal(){
  const cur = document.body.classList.contains("dark") ? "dark" : "light";
  const body = `
    <div style="display:flex; flex-direction:column; gap:12px;">
      <div style="font-weight:900;">보기</div>
      <label style="display:flex; align-items:center; gap:10px; font-weight:800;">
        <input type="radio" name="ssThemeMode" value="light" ${cur==="light"?"checked":""}/>
        라이트 모드
      </label>
      <label style="display:flex; align-items:center; gap:10px; font-weight:800;">
        <input type="radio" name="ssThemeMode" value="dark" ${cur==="dark"?"checked":""}/>
        다크 모드
      </label>
    </div>
  `;

  const modal = ss_openModal(
    "설정",
    body,
    `<button type="button" class="btn" data-close="1">닫기</button>
     <button type="button" class="btn primary" id="ssThemeSaveBtn">저장</button>`
  );

  const saveBtn = modal.querySelector("#ssThemeSaveBtn");
  if(saveBtn){
    saveBtn.addEventListener("click", () => {
      const v = modal.querySelector('input[name="ssThemeMode"]:checked')?.value || "light";
      try{ localStorage.setItem(THEME_STORAGE_KEY, v); }catch(_){}
      applyTheme(v);
      modal.remove();
    });
  }
}

async function ss_logout(){
  try{ await sb.auth.signOut(); }catch(_){}
  try{ localStorage.removeItem(USER_CACHE_KEY); }catch(_){}
  // keep placeholder UI
  setUserPillText({company:"", name:"", email:""});
  if(typeof openAuthModal === "function"){
    try{ openAuthModal(); }catch(_){}
  }
}

// --- Click binding that works even if an overlay steals the click (hit-test) ---
function ss_bindUserMenuClick(){
  if(window.__ssUserMenuBound) return;
  window.__ssUserMenuBound = true;

  // Ensure dropdown exists early
  ss_ensureDropdown();

  // Close on outside click / ESC
  document.addEventListener("click", (e) => {
    if (ss_dropdownEl && ss_dropdownEl.style.display === "block"){
      if (!e.target.closest("#ssUserDropdown")) ss_hideDropdown();
    }
  }, true);

  document.addEventListener("keydown", (e) => {
    if(e.key === "Escape") ss_hideDropdown();
  });

  window.addEventListener("resize", () => {
    if(ss_dropdownEl && ss_dropdownEl.style.display === "block") ss_positionDropdown();
  });
  window.addEventListener("scroll", () => {
    if(ss_dropdownEl && ss_dropdownEl.style.display === "block") ss_positionDropdown();
  }, true);

  // Main: coordinate hit test
  document.addEventListener("click", (e) => {
    const pill = document.getElementById("userPill") || document.querySelector(".user-pill");
    if(!pill) return;

    const r = pill.getBoundingClientRect();
    const x = e.clientX, y = e.clientY;
    const inside = (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);

    if(inside){
      e.preventDefault();
      e.stopPropagation();
      ss_toggleDropdown();
    }
  }, true);
}

document.addEventListener("DOMContentLoaded", () => {
  try{ ss_bindUserMenuClick(); }catch(_){}
}, true);

// =====================================================================

})();