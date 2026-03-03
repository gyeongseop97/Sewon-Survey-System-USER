// Sewon Survey System (Fixed)
// - Inline editor in G2 (create/edit questions without entering Q page)
// - New question builder includes answer type + labels/options/fields/placeholders
// - Drag & Drop reorder within G2
// - Accordion collapse/expand per question card (for screen length control)
// - Breadcrumb + Root(G1 list) view
// - Rule Builder (DEACTIVATE_QUESTIONS_IN_G2) + Scoring Simulator (Weighted redistribution)
// - Safe bindings (DOMContentLoaded)

(() => {
// ------------------ Supabase init ------------------
const SUPABASE_URL = "https://pztlmyfutfmbmlvavwuz.supabase.co";
const SUPABASE_KEY = "sb_publishable_fnGFEvCmhZRRIWj0qrEEeA_Vex3mxac";
window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const sb = window.sb;
const PDF_HEADER = new Uint8Array([
  0x25,0x50,0x44,0x46,0x2D,0x31,0x2E,0x34,0x0A, // %PDF-1.4\n
  0x25,0xE2,0xE3,0xCF,0xD3,0x0A                // %âãÏÓ\n (binary)
]);


// ✅ Auth state watcher: 로그아웃/세션 만료 시 로그인 모달 다시 표시
try{
  sb.auth.onAuthStateChange((_event, session) => {
    if (!session) {
      hideAdminBlock?.();
      setAuthMode("login");
      openAuthModal();
    }
  });
}catch(e){ /* ignore */ }

let setViewModeRef = null;
let currentAnswersSurvey = null;

// ------------------ Auth UI helpers ------------------
function showAuthError(msg){
  const el = document.getElementById("authError");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("show", !!msg);
}

function openAuthModal(){
  const bd = document.getElementById("authBackdrop");
  if (bd) {
    bd.classList.remove("hidden");
    bd.setAttribute("aria-hidden", "false");
  }
  showAuthError("");
  const email = document.getElementById("authEmail");
  if (email) email.focus();
}

function closeAuthModal(){
  const bd = document.getElementById("authBackdrop");
  if (bd) {
    bd.classList.add("hidden");
    bd.setAttribute("aria-hidden", "true");
  }
  showAuthError("");
}



// ------------------ Auth mode (login/signup) ------------------
let authMode = "login";
let authHandlersBound = false;

function getAuthEls(){
  const submitBtn = document.getElementById("btnAuthSubmit") || document.getElementById("btnAuthLogin");
  const toggleBtn = document.getElementById("btnAuthToggle") || document.getElementById("btnAuthSignUp");
  const forgotBtn = document.getElementById("btnAuthForgot");
  const signupOnly = document.getElementById("signupOnly");
  const titleEl = document.getElementById("authTitle") || document.querySelector(".auth-title");
  const subEl = document.getElementById("authSub") || document.querySelector(".auth-sub");
  return { submitBtn, toggleBtn, forgotBtn, signupOnly, titleEl, subEl };
}

function setAuthMode(mode){
  authMode = (mode === "signup") ? "signup" : "login";
  const { submitBtn, toggleBtn, signupOnly, titleEl, subEl } = getAuthEls();

  // signupOnly 섹션 토글
  if (signupOnly) signupOnly.classList.toggle("hidden", authMode !== "signup");

  // 타이틀/서브 텍스트
  if (titleEl) titleEl.textContent = (authMode === "signup") ? "회원가입" : "로그인";
  if (subEl) subEl.textContent =
    (authMode === "signup")
      ? "필수 정보 입력 후 회원가입을 눌러주세요. 인증 메일 완료 후 로그인 가능합니다."
      : "아이디(이메일)와 비밀번호를 입력해 주세요.";

  // 버튼 라벨
  if (toggleBtn) toggleBtn.textContent = (authMode === "signup") ? "로그인으로" : "회원가입";
  if (submitBtn) submitBtn.textContent = (authMode === "signup") ? "회원가입" : "로그인";

  // 회원가입 모드에서는 비밀번호 찾기 링크 숨김(선택)
  const forgot = document.getElementById("btnAuthForgot");
  if (forgot) forgot.style.display = (authMode === "signup") ? "none" : "";
}

function bindAuthModalHandlers(){
  if (authHandlersBound) return;
  const { submitBtn, toggleBtn, forgotBtn } = getAuthEls();

  // 모드 전환
  toggleBtn?.addEventListener("click", () => {
    setAuthMode(authMode === "login" ? "signup" : "login");
    showAuthError("");
  });

  // 비밀번호 찾기
  forgotBtn?.addEventListener("click", async () => {
    const email = document.getElementById("authEmail")?.value?.trim();
    if (!email) return showAuthError("아이디(이메일)를 먼저 입력해 주세요.");
    const { error } = await sb.auth.resetPasswordForEmail(email);
    if (error) return showAuthError(error.message);
    showAuthError("비밀번호 재설정 메일을 발송했습니다. 메일함을 확인해 주세요.");
  });

  // 제출(로그인/회원가입)
  submitBtn?.addEventListener("click", async () => {
    if (authMode === "signup") {
      await doSignUpFlow();
    } else {
      await doLoginFlow();
    }
  });

  // Enter 키로 제출
  ["authEmail", "authPassword", "authPassword2", "authCompany", "authName", "authEmpNo"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        (document.getElementById("btnAuthSubmit") || document.getElementById("btnAuthLogin"))?.click();
      }
    });
  });

  authHandlersBound = true;
}

async function doLoginFlow(){
  const email = document.getElementById("authEmail")?.value?.trim();
  const password = document.getElementById("authPassword")?.value;
  if (!email || !password) return showAuthError("아이디(이메일)/비밀번호를 입력해 주세요.");

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return showAuthError(error.message);

  const ok = await isAdminSession(data.session);
  if (!ok) {
    closeAuthModal();
    showAdminBlock("현재 로그인된 계정은 관리자용 프로그램을 사용할 수 없습니다. 사용자용 프로그램을 이용해 주세요.");
    return; // ✅ resolve 금지
  }

  hideAdminBlock?.();
  if (typeof window.__authResolveOnce === "function") window.__authResolveOnce(data.session);
}

async function doSignUpFlow(){
  const email = document.getElementById("authEmail")?.value?.trim();
  const password = document.getElementById("authPassword")?.value;
  const password2 = document.getElementById("authPassword2")?.value;

  const userType = document.getElementById("authUserType")?.value;
  const companyName = document.getElementById("authCompany")?.value?.trim();
  const name = document.getElementById("authName")?.value?.trim();
  const employeeNo = document.getElementById("authEmpNo")?.value?.trim();

  if (!email || !password || !password2 || !userType || !companyName || !name) {
    return showAuthError("필수 항목을 모두 입력해 주세요. (아이디/비밀번호/비밀번호 확인/회원 구분/회사명/이름)");
  }
  if (password !== password2) return showAuthError("비밀번호 확인이 일치하지 않습니다.");

  const { error } = await sb.auth.signUp({
    email,
    password,
    options: {
      data: {
        user_type: userType,
        company_name: companyName,
        name,
        employee_no: employeeNo || null,
      },
    },
  });

  if (error) return showAuthError(error.message);

  // ✅ 가입 완료(메일 인증 안내) -> 로그인 모드로 복귀
  showAuthError("회원가입 인증 메일이 발송되었습니다. 인증 완료 후 로그인해 주세요.");
  setAuthMode("login");
}

// ---------- Admin gate (role=admin only, without sign-out to avoid cross-app logout) ----------
async function getUserRole(userId){
  // prefer unified table 'user_profiles', fallback to legacy 'profiles'
  const tryTable = async (table) => {
    const { data, error } = await sb
      .from(table)
      .select("role")
      .eq("user_id", userId)
      .single();
    if (error) throw error;
    return data?.role || null;
  };

  try{
    return await tryTable("user_profiles");
  }catch(e1){
    try{
      return await tryTable("profiles");
    }catch(e2){
      // no profile/permission issue -> treat as non-admin
      return null;
    }
  }
}

async function isAdminSession(session){
  const userId = session?.user?.id;
  if (!userId) return false;
  const role = await getUserRole(userId);
  return role === "admin";
}

function ensureAdminBlockEl(){
  // ✅ 1) index.html에 이미 있는 오버레이를 우선 사용
  let el = document.getElementById("adminBlockOverlay");
  if (el) {
    const okBtn = el.querySelector("#btnAdminBlockOk");
    if (okBtn && !okBtn.__bound) {
      okBtn.__bound = true;
      okBtn.addEventListener("click", () => {
        try { window.close(); } catch (_) {}
      });
    }
    return el;
  }

  // ✅ 2) (혹시 없을 때만) CSS가 먹는 동일 구조로 생성
  el = document.createElement("div");
  el.id = "adminBlockOverlay";
  el.className = "admin-block hidden";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `
    <div class="admin-block-card" role="dialog" aria-modal="true" aria-labelledby="adminBlockTitle">
      <div id="adminBlockTitle" class="admin-block-title">관리자 권한이 없습니다.</div>
      <div id="adminBlockMsg" class="admin-block-msg">
        현재 로그인된 계정은 관리자용 프로그램을 사용할 수 없습니다. 사용자용 프로그램을 이용해 주세요.
      </div>
      <div class="admin-block-actions">
        <button class="btn" id="btnAdminBlockOk" type="button">확인</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  const okBtn = el.querySelector("#btnAdminBlockOk");
  okBtn?.addEventListener("click", () => {
    try { window.close(); } catch (_) {}
  });

  return el;
}

function showAdminBlock(message){
  const el = ensureAdminBlockEl();

  // 메시지 위치(overlay 구조 기준)
  const msgEl =
    el.querySelector("#adminBlockMsg") ||
    el.querySelector("#adminBlockDesc");

  if (msgEl) {
    msgEl.textContent = message || "현재 로그인된 계정은 관리자용 프로그램을 사용할 수 없습니다. 사용자용 프로그램을 이용해 주세요.";
  }

  el.classList.remove("hidden");
  el.setAttribute("aria-hidden", "false");
}

function hideAdminBlock(){
  const el =
    document.getElementById("adminBlockOverlay") ||
    document.getElementById("adminBlockBackdrop"); // (구버전 잔재 대비)

  if (el) {
    el.classList.add("hidden");
    el.setAttribute("aria-hidden", "true");
  }
}



async function requireLoginOrModal(){
  const { data } = await sb.auth.getSession();

  // ✅ 세션이 이미 있으면, 여기서 즉시 admin 검사
  if (data?.session) {
    const ok = await isAdminSession(data.session);
    if (!ok) {
      closeAuthModal?.(); // 혹시 떠있으면 닫기
      showAdminBlock("현재 로그인된 계정은 관리자용 프로그램을 사용할 수 없습니다. 사용자용 프로그램을 이용해 주세요.");
      return null;        // ✅ 관리자 앱 진입 차단
    }
    hideAdminBlock?.();
    return data.session;
  }

  // ---------- Auth modal (login/signup toggle) ----------
  return new Promise((resolve) => {
    // 1) 모달 열기 + 기본은 로그인 모드
    openAuthModal();
    setAuthMode("login");
    bindAuthModalHandlers();

    // 2) 이번 requireLoginOrModal 호출의 resolve를 연결
    window.__authResolveOnce = (session) => {
      try { closeAuthModal(); } catch(_) {}
      resolve(session || null);
    };
  });
}



  
  // ------------------ Helpers ------------------
  const uid = (p) =>
    `${p}_${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16).slice(-4)}`;
  const $ = (id) => document.getElementById(id);

  const SCHEMA_VERSION = 2;
  const NORM_VALUES = ["YES", "NO"];

  const defaultSurvey = () => ({
    schemaVersion: SCHEMA_VERSION,
    id: uid("survey"),
    title: "협력사 ESG 평가 설문",
    version: "v1.0",
    scoring: {
      redistribution: "WEIGHTED_NORMALIZE_WITHIN_G1",
      questionAllocation: "EQUAL_1_OVER_N_WITHIN_G2"
    },
    groups1: [],
    rules: [] // {id, trigger:{questionId, equals:'YES'|'NO'|'NA'}, action:'DEACTIVATE_QUESTIONS_IN_G2', targetQuestionIds:[...]}
  });

  let state = {
    survey: defaultSurvey(),
    selected: null, // {kind:'g1'|'g2', id} or null for root
		// Supabase(서버) 저장 상태: 최초 저장 시 id/code가 채워짐
		server: { id: null, code: null },
		// ✅ 설문 관리(내 설문 리스트) 표시용 캐시
		mySurveys: [],
    ui: {
      collapsedQ: {}, // { [qid]: boolean }
      focusQId: null,
      drag: { fromIdx: null },       // ✅ (legacy) G2 문항 reorder용
      treeDrag: null,                // ✅ 트리 DnD용 { kind:'g1'|'g2', id }
      ruleEditId: null,              // ✅ 룰 편집 모드(현재 편집중인 ruleId)
      treeCollapsed: { g1: {}, g2: {} },
      viewMode: "edit" // edit | rules | score | preview
    },
    sim: {
      answers: {}, // qid -> { norm, checks:Set, text, fields, manualEnabled, manualScore, manualReject }
      company: ""
    }
  };

  // ------------------ Find helpers ------------------
  function findG1(id) {
    return state.survey.groups1.find((x) => x.id === id) || null;
  }
  function findG2(id) {
    for (const g1 of state.survey.groups1) {
      const g2 = (g1.groups2 || []).find((x) => x.id === id);
      if (g2) return { g1, g2 };
    }
    return null;
  }
  function allG1() {
    return state.survey.groups1;
  }
  function allG2() {
    const out = [];
    for (const g1 of state.survey.groups1) for (const g2 of (g1.groups2 || [])) out.push({ g1, g2 });
    return out;
  }
  function allQuestions() {
    const out = [];
    for (const g1 of state.survey.groups1) {
      for (const g2 of (g1.groups2 || [])) {
        for (const q of (g2.questions || [])) out.push({ g1, g2, q });
      }
    }
    return out;
  }

  // ------------------ Utils ------------------
  function num(v, fallback = 0) {
    const x = Number(v);
    return Number.isFinite(x) ? x : fallback;
  }
  function sanitizeFilename(name) {
    return String(name)
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 60);
  }

  // ------------------ Scroll helpers ------------------
  // ✅ This app uses a scroll container (.canvas) rather than window/body.
  // Reset scroll to top when navigating between views/sections (menu/tree).
  function resetScrollTop({ smooth = false } = {}) {
    const canvas = document.querySelector(".canvas");
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const behavior = smooth && !prefersReduced ? "smooth" : "auto";

    if (canvas) {
      // Prefer scrollTo for smooth scrolling; fall back to scrollTop.
      try {
        canvas.scrollTo({ top: 0, left: 0, behavior });
      } catch (e) {
        canvas.scrollTop = 0;
      }
    }

    // In some environments window scroll may still be used.
    try {
      window.scrollTo({ top: 0, left: 0, behavior });
    } catch (e) {
      try { window.scrollTo(0, 0); } catch (_) {}
    }
  }

  function renderWithScrollReset() {
    // ✅ After navigation: render first, then smoothly scroll to top.
    render();
    setTimeout(() => resetScrollTop({ smooth: true }), 0);
  }

function renderHeaderActionsLegacy(header) {
  // state.selected 기반으로 pathText/showG1/showG2 결정
  let pathText = "현재: 메인 화면";
  let showG1 = false, showG2 = false;
  let g1Id = null, g2Id = null;

  if (state.selected?.kind === "g1") {
    const g1 = findG1(state.selected.id);
    if (g1) { pathText = `현재: ${g1.name}`; showG1 = true; g1Id = g1.id; }
  } else if (state.selected?.kind === "g2") {
    const ctx = findG2(state.selected.id);
    if (ctx) {
      pathText = `현재: ${ctx.g1.name} > ${ctx.g2.name}`;
      showG1 = true; showG2 = true;
      g1Id = ctx.g1.id; g2Id = ctx.g2.id;
    }
  }

  // 중복 삽입 방지
  header.querySelectorAll(".header-nav-injected").forEach(el => el.remove());

  const wrap = document.createElement("div");
  wrap.className = "header-nav-injected";
  wrap.style.marginTop = "10px";

  wrap.innerHTML = `
    <div class="hint" style="margin-bottom:8px;">${escapeHtml(pathText)}</div>
    <div style="display:flex; gap:8px; flex-wrap:wrap;">
      <button class="btn" id="go_root" style="display:${state.selected ? "" : "none"};">최상위로</button>
      <button class="btn" id="go_g1" style="display:${showG1 ? "" : "none"};">구분1로</button>
      <button class="btn" id="go_g2" style="display:${showG2 ? "" : "none"};">구분2로</button>
    </div>
  `;

const left = header.querySelector(".canvas-header-left") || header;
left.appendChild(wrap);

  const goRoot = wrap.querySelector("#go_root");
  if (goRoot) goRoot.onclick = () => { state.selected = null; state.ui.focusQId = null; renderWithScrollReset(); };

  if (showG1) wrap.querySelector("#go_g1").onclick = () => { state.selected = { kind:"g1", id:g1Id }; state.ui.focusQId=null; renderWithScrollReset(); };
  if (showG2) wrap.querySelector("#go_g2").onclick = () => { state.selected = { kind:"g2", id:g2Id }; state.ui.focusQId=null; renderWithScrollReset(); };
}

// ------------------ Excel(XML) Export/Import (Spreadsheet 2003) ------------------
// ✅ No external libs. Excel opens the generated .xls (XML Spreadsheet) reliably on Windows.
// Sheets: G1, G2, Questions, Rules
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
  const wbHeader = `<?xml version="1.0"?>\n` +
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

  const wsXml = sheets.map(({ name, rows }) => {
    const safeName = xmlEscape(name).slice(0, 30) || "Sheet";
    const rowXml = (rows || []).map((r, ri) => {
      const cells = (r || []).map((c, ci) => {
        const v = (c === null || c === undefined) ? "" : String(c);
        const isHeader = ri === 0;
        // Treat everything as String for safety (IDs, JSON fields, Korean text, etc.)
        const style = isHeader ? ' ss:StyleID="sHeader"' : ' ss:StyleID="sText"';
        return `<Cell${style}><Data ss:Type="String">${xmlEscape(v)}</Data></Cell>`;
      }).join("");
      return `<Row>${cells}</Row>`;
    }).join("\n");
    return `<Worksheet ss:Name="${safeName}"><Table>${rowXml}</Table></Worksheet>\n`;
  }).join("");

  return wbHeader + styles + wsXml + `</Workbook>`;
}

function exportSurveyAsExcelXml() {
  // ✅ Meta sheet (title/version/schemaVersion)
  const metaRows = [
    ["key", "value"],
    ["schemaVersion", String(state.survey.schemaVersion || SCHEMA_VERSION)],
    ["title", String(state.survey.title || "")],
    ["version", String(state.survey.version || "")]
  ];

  // Build flat tables
  const g1Rows = [["g1_id", "g1_name", "weight1(%)"]];
  const g2Rows = [["g2_id", "g1_id", "g2_name", "weight2(%)", "questionAllocation(EQUAL|MANUAL)"]];
  const qRows  = [[
  "q_id", "g2_id", "q_text",
  "guide",
  "required(true|false)", "points",
  "mode",
  "yesLabel", "noLabel", "naLabel",
  "options(pipe | separated)", "fields(pipe | separated)",
  "placeholder",
  "items_json"
]];
  const rRows  = [["rule_id", "trigger_qid", "equals(YES|NO|NA)", "action", "target_qids(pipe | separated)"]];

  for (const g1 of (state.survey.groups1 || [])) {
    g1Rows.push([g1.id, g1.name || "", String(Number(g1.weight1 || 0))]);
    for (const g2 of (g1.groups2 || [])) {
      ensureG2Scoring(g2);
      g2Rows.push([g2.id, g1.id, g2.name || "", String(Number(g2.weight2 || 0)), g2.scoring.questionAllocation || "EQUAL"]);
      for (const q of (g2.questions || [])) {
        ensureQuestionSpec(q);
        const as = q.answerSpec || {};
        qRows.push([
          q.id,
          g2.id,
          q.text || "",
          q.guide || "",
          q.required ? "true" : "false",
          String(Number(q.points || 0)),
          as.mode || "YES_NO",
          as.yesLabel || "",
          as.noLabel || "",
          as.naLabel || "",
          (function(){
            const items = Array.isArray(as.items) ? as.items : [];
            // For compatibility, CHECK items -> options column
            if (as.mode === "YES_NO") return items.filter(it => it && it.kind === "CHECK").map(it => it.label || "").join("|");
            return "";
          })(),
          (function(){
            const items = Array.isArray(as.items) ? as.items : [];
            // TEXT items -> fields column (YES_NO and TEXT_MULTI)
            return items.filter(it => it && it.kind === "TEXT").map(it => it.label || "").join("|");
          })(),
          (function(){
            const items = Array.isArray(as.items) ? as.items : [];
            const texts = items.filter(it => it && it.kind === "TEXT");
            if (texts.length === 1) return texts[0].placeholder || "";
            return "";
          })() || "",
          JSON.stringify(Array.isArray(as.items) ? as.items : [])
        ]);
}
    }
  }

  for (const r of (state.survey.rules || [])) {
    rRows.push([
      r.id || "",
      r.trigger?.questionId || "",
      r.trigger?.equals || "",
      r.action || "",
      Array.isArray(r.targetQuestionIds) ? r.targetQuestionIds.join("|") : ""
    ]);
  }

  const xml = buildExcelXmlWorkbook({
    sheets: [
      { name: "Meta", rows: metaRows },     // ✅ 추가
      { name: "G1", rows: g1Rows },
      { name: "G2", rows: g2Rows },
      { name: "Questions", rows: qRows },
      { name: "Rules", rows: rRows }
      // (Responses는 관리자 템플릿 export에는 없음)
    ]
  });

  const blob = new Blob([xml], { type: "application/vnd.ms-excel" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${sanitizeFilename(state.survey.title || "survey")}_${sanitizeFilename(state.survey.version || "v1")}.xls`;
  a.click();
}


function parseExcelXmlTableToRows(xmlText) {
  // Parse Spreadsheet 2003 XML (.xls)
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "text/xml");
  const parseErr = doc.getElementsByTagName("parsererror")[0];
  if (parseErr) throw new Error("엑셀(XML) 파싱 실패: 파일이 손상되었거나 형식이 다릅니다.");

  const ns = "urn:schemas-microsoft-com:office:spreadsheet";
  // We will query without namespaces by localName for robustness.
  const worksheets = Array.from(doc.getElementsByTagName("Worksheet"));
  const out = new Map(); // name -> rows
  worksheets.forEach(ws => {
    const name = ws.getAttribute("ss:Name") || ws.getAttribute("Name") || "Sheet";
    const table = ws.getElementsByTagName("Table")[0];
    const rows = [];
    if (table) {
      const rowNodes = Array.from(table.getElementsByTagName("Row"));
      rowNodes.forEach(rn => {
        const cells = Array.from(rn.getElementsByTagName("Cell"));
        const row = cells.map(cn => {
          const data = cn.getElementsByTagName("Data")[0];
          return data ? (data.textContent || "") : "";
        });
        rows.push(row);
      });
    }
    out.set(name, rows);
  });
  return out;
}

function allQuestionsFromSurvey(survey) {
  const out = [];
  for (const g1 of (survey.groups1 || [])) {
    for (const g2 of (g1.groups2 || [])) {
      for (const q of (g2.questions || [])) out.push({ g1, g2, q });
    }
  }
  return out;
}

function importSurveyFromExcelXml(xmlText) {
  const sheetMap = parseExcelXmlTableToRows(xmlText);

  const pick = (...names) => {
    for (const n of names) {
      if (sheetMap.has(n)) return sheetMap.get(n);
      for (const k of sheetMap.keys()) {
        if (String(k).toLowerCase() === String(n).toLowerCase()) return sheetMap.get(k);
      }
    }
    return null;
  };

  // ✅ Sheets
  const metaRows = pick("Meta");
  const g1Rows = pick("G1");
  const g2Rows = pick("G2");
  const qRows  = pick("Questions", "Question");
  const rRows  = pick("Rules", "Rule");
  const respRows = pick("Responses", "Response"); // ✅ 여기 추가(중복 없이)

  if (!g1Rows || g1Rows.length < 2) throw new Error("G1 시트가 없거나 비어 있습니다.");

  const newSurvey = defaultSurvey();

  // ✅ Meta 적용(있으면 덮어쓰기)
  if (metaRows && metaRows.length > 1) {
    const meta = {};
    for (let i = 1; i < metaRows.length; i++) {
      const [k, v] = metaRows[i] || [];
      if (!k) continue;
      meta[String(k).trim()] = (v ?? "");
    }

    const sv = Number(meta.schemaVersion);
    if (Number.isFinite(sv) && sv > 0) newSurvey.schemaVersion = sv;

    const t = String(meta.title || "").trim();
    const v = String(meta.version || "").trim();
    if (t) newSurvey.title = t;
    if (v) newSurvey.version = v;
  } else {
    // Meta 시트 없으면 기존 UI값 유지
    newSurvey.title = state.survey.title || newSurvey.title;
    newSurvey.version = state.survey.version || newSurvey.version;
  }

  const g1ById = new Map();
  const g2ById = new Map();

  // G1: [id, name, weight1]
  for (let i = 1; i < g1Rows.length; i++) {
    const [id, name, w1] = g1Rows[i];
    if (!id) continue;
    const g1 = { id, name: (name || "").trim(), weight1: num(w1, 0), groups2: [] };
    newSurvey.groups1.push(g1);
    g1ById.set(id, g1);
  }

  // G2: [g2_id, g1_id, name, weight2, allocation]
  if (g2Rows && g2Rows.length > 1) {
    for (let i = 1; i < g2Rows.length; i++) {
      const [g2id, g1id, name, w2, alloc] = g2Rows[i];
      if (!g2id || !g1id) continue;
      const parent = g1ById.get(g1id);
      if (!parent) continue;
      const g2 = { id: g2id, name: (name || "").trim(), weight2: num(w2, 0), questions: [], scoring: { questionAllocation: (alloc || "EQUAL").trim() || "EQUAL" } };
      ensureG2Scoring(g2);
      parent.groups2.push(g2);
      g2ById.set(g2id, g2);
    }
  }

// Questions
if (qRows && qRows.length > 1) {
  const header = (qRows[0] || []).map(h => String(h || "").trim());
  const findIdx = (key) => header.findIndex(h => h.toLowerCase() === key.toLowerCase());
  const findInc = (key) => header.findIndex(h => h.toLowerCase().includes(key.toLowerCase()));

  const idx_qid  = findInc("q_id");
  const idx_g2id = findInc("g2_id");
  const idx_text = findInc("q_text");
  const idx_guide = findIdx("guide"); // ✅ 새 컬럼
  const idx_required = findInc("required");
  const idx_points = findInc("points");
  const idx_mode = findInc("mode");
  const idx_yes = findInc("yeslabel");
  const idx_no  = findInc("nolabel");
  const idx_na  = findInc("nalabel");
  const idx_opts = findInc("options");
  const idx_fields = findInc("fields");
  const idx_ph = findInc("placeholder");

  
  const idx_items_json = findInc("items_json");
const get = (row, idx) => (idx >= 0 ? (row[idx] ?? "") : "");

  for (let i = 1; i < qRows.length; i++) {
    const row = qRows[i] || [];
    const qid = get(row, idx_qid);
    const g2id = get(row, idx_g2id);
    const text = get(row, idx_text);

    if (!qid || !g2id) continue;
    const parent = g2ById.get(g2id);
    if (!parent) continue;

    const requiredStr = get(row, idx_required);
    const pointsStr = get(row, idx_points);
    const mode = get(row, idx_mode);
    const yesLabel = get(row, idx_yes);
    const noLabel = get(row, idx_no);
    const naLabel = get(row, idx_na);
    const optionsStr = get(row, idx_opts);
    const fieldsStr = get(row, idx_fields);
    const placeholder = get(row, idx_ph);

    
    const itemsJsonStr = get(row, idx_items_json);
const q = {
      id: qid,
      text: String(text || "").trim(),
      guide: String(get(row, idx_guide) || "").trim(), // ✅ guide 정상 로드
      required: String(requiredStr).trim().toLowerCase() === "true",
      points: num(pointsStr, 0),
      answerSpec: { mode: (mode || "YES_NO").trim() || "YES_NO" }
    };

    // fill answerSpec extras (기존 로직 그대로)
    const m = q.answerSpec.mode;
    if (m === "YES_NO" || m === "YES_CHECKBOX" || m === "YES_TEXT" || m === "YES_MULTI_TEXT") {
      q.answerSpec.yesLabel = String(yesLabel || "").trim();
      q.answerSpec.noLabel = String(noLabel || "").trim();
    }
    if (m === "NA_ONLY" || m === "NA_TEXT") {
      q.answerSpec.yesLabel = String(yesLabel || "").trim();
      q.answerSpec.naLabel = String(naLabel || "").trim();
    }
    if (m === "YES_CHECKBOX") {
      q.answerSpec.options = (optionsStr ? String(optionsStr).split("|").map(x => x.trim()).filter(Boolean) : []);
    }
    if (m === "YES_MULTI_TEXT") {
      q.answerSpec.fields = (fieldsStr ? String(fieldsStr).split("|").map(x => x.trim()).filter(Boolean) : []);
    }
    if (m === "YES_TEXT" || m === "TEXT" || m === "NA_TEXT") {
      q.answerSpec.placeholder = (placeholder || "");
    }

    // ✅ NEW: preserve simplified items for YES_NO / TEXT_MULTI
    // 1) items_json 우선
    const hasItemsJson = String(itemsJsonStr || "").trim();
    if (hasItemsJson) {
      try {
        const parsed = JSON.parse(hasItemsJson);
        if (Array.isArray(parsed)) q.answerSpec.items = parsed;
      } catch (e) {}
    } else {
      // 2) 하위 호환: options/fields/placeholder로 items 재구성
      const opts = (optionsStr ? String(optionsStr).split("|").map(x => x.trim()).filter(Boolean) : []);
      const flds = (fieldsStr  ? String(fieldsStr).split("|").map(x => x.trim()).filter(Boolean) : []);
      if (m === "YES_NO") {
        const items = [];
        for (const lab of opts) items.push({ kind: "CHECK", label: lab, placeholder: "" });
        for (const lab of flds) items.push({ kind: "TEXT", label: lab, placeholder: "" });
        if (flds.length === 1 && String(placeholder || "").trim()) {
          const last = items[items.length - 1];
          if (last && last.kind === "TEXT") last.placeholder = String(placeholder);
        }
        q.answerSpec.items = items;
      } else if (m === "TEXT_MULTI") {
        const items = [];
        const labels = flds.length ? flds : (opts.length ? opts : []); // 혹시 예전 파일이 fields 대신 options에 들어간 경우
        for (const lab of labels) items.push({ kind: "TEXT", label: lab, placeholder: "" });
        if (!items.length) items.push({ kind: "TEXT", label: "주관식", placeholder: String(placeholder || "") });
        if (items.length === 1 && String(placeholder || "").trim()) items[0].placeholder = String(placeholder);
        q.answerSpec.items = items;
      }
    }

    ensureQuestionSpec(q);
    parent.questions.push(q);
  }
}


  // Rules
  if (rRows && rRows.length > 1) {
    for (let i = 1; i < rRows.length; i++) {
      const [rid, triggerQid, eq, action, targetsStr] = rRows[i];
      if (!triggerQid || !eq) continue;
      const targets = targetsStr ? String(targetsStr).split("|").map(x => x.trim()).filter(Boolean) : [];
      if (!targets.length) continue;
      newSurvey.rules.push({
        id: rid || uid("rule"),
        trigger: { questionId: triggerQid, equals: String(eq).trim() },
        action: action || "DEACTIVATE_QUESTIONS_IN_G2",
        targetQuestionIds: targets
      });
    }
  }
  
  // ✅ Responses (optional) -> 채점 시뮬레이터(state.sim.answers)에 자동 주입
  if (respRows && respRows.length > 1) {
    const simAnswers = {};
    let company = "";
    let personName = "";

    // qid -> question lookup (체크박스 변환용)
    const qMap = new Map();
    for (const { q } of allQuestionsFromSurvey(newSurvey)) qMap.set(q.id, q);

    for (let i = 1; i < respRows.length; i++) {
      const [c, n, qid, norm, checksStr, text, fieldsJson] = respRows[i] || [];
      if (!qid) continue;

      company = company || (c || "");
      personName = personName || (n || "");

      const q = qMap.get(qid);
      const mode = q?.answerSpec?.mode || "YES_NO";

      // fields
      let fields = {};
      try { fields = fieldsJson ? JSON.parse(fieldsJson) : {}; } catch { fields = {}; }

      // checks 처리 (YES_CHECKBOX만 인덱스 기반으로)
      const rawChecks = (checksStr || "").split("|").map(s => s.trim()).filter(Boolean);
      let checksSet = new Set();

      if (mode === "YES_NO") {
        const items = Array.isArray(q?.answerSpec?.items) ? q.answerSpec.items : [];
        const opts = items.filter(it => it && it.kind === "CHECK").map(it => String(it.label||"").trim());
        for (const rc of rawChecks) {
          const ni = Number(rc);
          if (Number.isFinite(ni) && String(ni) === rc && ni >= 0) {
            if (ni < opts.length) checksSet.add(ni);
            continue;
          }
          const idx = opts.findIndex(o => o === rc);
          if (idx >= 0) checksSet.add(idx);
        }
      }

      simAnswers[qid] = {
        norm: (norm || "").trim() || "NO",
        checks: checksSet,
        text: text || "",
        fields,
        manualEnabled: false,
        manualReject: false,
        manualScore: 0
      };
    }

    state.sim = state.sim || { answers: {}, company: "" };
    state.sim.answers = simAnswers;
    state.sim.company = [company, personName].filter(Boolean).join(" / ");
  }

  // Final sanity
  state.survey = newSurvey;
  cleanupRulesDangling();
  state.selected = null;
  state.ui = { collapsedQ: {}, focusQId: null, drag: { fromIdx: null }, treeDrag: null, ruleEditId: null, treeCollapsed: { g1: {}, g2: {} }, viewMode: state.ui.viewMode || "edit" };
  render();
}
  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
  function escapeAttr(str) {
    return escapeHtml(str).replaceAll("\n", " ");
  }
  function clamp(x, a, b) {
    const n = Number(x);
    if (!Number.isFinite(n)) return a;
    return Math.max(a, Math.min(b, n));
  }

  // ------------------ Ensure structures ------------------
  function ensureG2Scoring(g2) {
    g2.scoring = g2.scoring || {};
    if (!g2.scoring.questionAllocation) g2.scoring.questionAllocation = "EQUAL"; // EQUAL | MANUAL
  }

  function ensureQuestionSpec(q) {
    if (q.points === undefined) q.points = 0;
    if (q.guide === undefined) q.guide = "";
    if (typeof q.guide !== "string") q.guide = q.guide ? String(q.guide) : "";
    if (q.scoreEnabled === undefined) q.scoreEnabled = true;

    q.answerSpec = q.answerSpec || {};
    const as = q.answerSpec;

    // ------------------ AnswerSpec migration (legacy -> simplified) ------------------
    // New rule:
    // - mode: "YES_NO" (base) or "TEXT_MULTI" (no YES/NO)
    // - YES_NO can contain mixed items: CHECK items and TEXT items (shown when norm === textTrigger)
    // - textTrigger: "YES" (default) or "NO" (legacy NA_TEXT support)
    const legacyMode = as.mode || "YES_NO";

    // Defaults (common)
    if (as.yesLabel === undefined) as.yesLabel = "예";
    if (as.noLabel === undefined) as.noLabel = "아니오";
    if (as.textTrigger === undefined) as.textTrigger = "YES";

    const toItemCheck = (label) => ({ kind: "CHECK", label: String(label || "").trim() || "옵션", placeholder: "" });
    const toItemText  = (label, ph) => ({ kind: "TEXT", label: String(label || "").trim() || "주관식", placeholder: String(ph || "") });

    // Legacy → New
    if (legacyMode === "YES_CHECKBOX") {
      const opts = Array.isArray(as.options) ? as.options : [];
      as.mode = "YES_NO";
      as.items = opts.map(toItemCheck);
      as.textTrigger = "YES";
      delete as.options; delete as.fields; delete as.placeholder; delete as.naLabel;
    } else if (legacyMode === "YES_TEXT") {
      as.mode = "YES_NO";
      as.items = [toItemText("주관식", as.placeholder || "")];
      as.textTrigger = "YES";
      delete as.options; delete as.fields; delete as.placeholder; delete as.naLabel;
    } else if (legacyMode === "YES_MULTI_TEXT") {
      const fs = Array.isArray(as.fields) ? as.fields : ["항목1","항목2"];
      as.mode = "YES_NO";
      as.items = fs.map((f) => toItemText(f, ""));
      as.textTrigger = "YES";
      delete as.options; delete as.fields; delete as.placeholder; delete as.naLabel;
    } else if (legacyMode === "TEXT") {
      as.mode = "TEXT_MULTI";
      as.items = [toItemText("주관식", as.placeholder || "")];
      delete as.options; delete as.fields; delete as.placeholder; delete as.naLabel; delete as.textTrigger;
    } else if (legacyMode === "NA_ONLY") {
      // "예/해당없음" -> YES_NO where NO label becomes "해당없음"
      as.mode = "YES_NO";
      if (as.naLabel !== undefined && String(as.naLabel).trim()) as.noLabel = as.naLabel;
      else as.noLabel = "해당없음";
      as.items = [];
      as.textTrigger = "YES";
      delete as.options; delete as.fields; delete as.placeholder; delete as.naLabel;
    } else if (legacyMode === "NA_TEXT") {
      // "예/해당없음(주관식)" -> YES_NO, NO label is "해당없음", textTrigger=NO
      as.mode = "YES_NO";
      if (as.naLabel !== undefined && String(as.naLabel).trim()) as.noLabel = as.naLabel;
      else as.noLabel = "해당없음";
      as.items = [toItemText("사유", as.placeholder || "")];
      as.textTrigger = "NO";
      delete as.options; delete as.fields; delete as.placeholder; delete as.naLabel;
    } else {
      // Already new (or YES_NO legacy)
      if (!as.mode) as.mode = "YES_NO";
    }

    // Final defaults for new structure
    if (as.mode !== "TEXT_MULTI" && as.mode !== "YES_NO") as.mode = "YES_NO";
    if (as.mode === "YES_NO") {
      if (!Array.isArray(as.items)) as.items = [];
      if (as.textTrigger !== "YES" && as.textTrigger !== "NO") as.textTrigger = "YES";
    }
    if (as.mode === "TEXT_MULTI") {
      if (!Array.isArray(as.items) || !as.items.length) as.items = [toItemText("주관식", "")];
      // In TEXT_MULTI, only TEXT items are used
      as.items = as.items
        .filter((it) => it && it.kind === "TEXT")
        .map((it) => toItemText(it.label, it.placeholder));
    }
  }

  // ------------------ Render root ------------------
  function render() {
    const canvas = document.querySelector(".canvas");
if (canvas) canvas.style.opacity = "0.98";

requestAnimationFrame(() => {
  if (canvas) canvas.style.opacity = "1";
});

    const overview = $("overview");
    const surveyTitle = $("surveyTitle");
    const surveyVersion = $("surveyVersion");

    if (overview) overview.textContent = `구분1 ${state.survey.groups1.length}개 · 룰 ${state.survey.rules.length}개`;
    if (surveyTitle) surveyTitle.value = state.survey.title;
    if (surveyVersion) surveyVersion.value = state.survey.version;

    renderTree();
    renderEditor();
    renderHeaderActions();
    renderPointsPanel();
    renderPreview();
  }

  // ------------------ Web-like preview (admin) ------------------
  function renderPreview() {
    const host = document.getElementById("preview");
    if (!host) return;

    const s = state.survey;

    if (!s.groups1?.length) {
      host.innerHTML = `<div class="hint">구분1이 없습니다. 왼쪽에서 구분1/2/문항을 추가하면 미리보기가 생성됩니다.</div>`;
      return;
    }

    const parts = [];
    parts.push(`<div style="padding:12px; border:1px solid rgba(255,255,255,.12); border-radius:14px; background:rgba(255,255,255,.03);">
      <div style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;">
        <div style="font-weight:800; font-size:18px;">${escapeHtml(s.title || "설문")}</div>
        <div class="hint">${escapeHtml(s.version || "")}</div>
      </div>
      <div class="hint" style="margin-top:6px;">※ 관리자용 미리보기(응답자 UI는 별도 프로그램에서 JSON을 렌더링)</div>
    </div>`);

    s.groups1.forEach((g1, i1) => {
      parts.push(`<div style="margin-top:14px; padding:12px; border:1px solid rgba(255,255,255,.12); border-radius:14px;">
        <div style="font-weight:800;">${i1 + 1}. ${escapeHtml(g1.name || "(구분1)")}
          <span class="hint" style="margin-left:8px;">(w1 ${Number(g1.weight1 || 0)}%)</span>
        </div>
      </div>`);

      (g1.groups2 || []).forEach((g2, i2) => {
        parts.push(`<div style="margin-top:10px; margin-left:12px; padding:12px; border:1px solid rgba(255,255,255,.10); border-radius:14px; background:rgba(0,0,0,.08);">
          <div style="font-weight:750;">${i1 + 1}.${i2 + 1} ${escapeHtml(g2.name || "(구분2)")}
            <span class="hint" style="margin-left:8px;">(w2 ${Number(g2.weight2 || 0)}%)</span>
          </div>
        </div>`);

        (g2.questions || []).forEach((q, qi) => {
          ensureQuestionSpec(q);
          const mode = q.answerSpec?.mode || "YES_NO";
          const reqBadge = q.required ? `<span class="hint" style="margin-left:6px;">[필수]</span>` : ``;

const qParts = [];
qParts.push(`<div style="margin-top:10px; margin-left:26px; padding:12px; border:1px solid rgba(255,255,255,.10); border-radius:14px;">
  <div><b>Q${qi + 1}.</b> ${escapeHtml(q.text || "")}${reqBadge}</div>
  <div class="hint" style="margin-top:4px;">모드: ${escapeHtml(mode)}</div>`);

// ✅ 답변 가이드: "내용이 있을 때만" 표시
const guideText = String(q.guide ?? "").trim();
if (guideText) {
  qParts.push(`
    <details class="answer-guide">
      <summary>답변 가이드</summary>
      <div class="guide-body">${escapeHtml(guideText).replace(/\n/g, "<br>")}</div>
    </details>
  `);
  }

          if (mode === "YES_NO") {
            const yesL = q.answerSpec?.yesLabel || "예";
            const noL  = q.answerSpec?.noLabel  || "아니오";
            const items = Array.isArray(q.answerSpec?.items) ? q.answerSpec.items : [];
            const checksOnly = items.filter(it=>it && it.kind==="CHECK" && !it.withText).map(it=>it.label||"");
            const checksWithText = items.filter(it=>it && it.kind==="CHECK" && it.withText).map(it=>it.label||"");
            const texts  = items.filter(it=>it && it.kind==="TEXT").map(it=>it.label||"");
            qParts.push(`<div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">
              <label><input type="radio" disabled> ${escapeHtml(yesL)}</label>
              <label><input type="radio" disabled> ${escapeHtml(noL)}</label>
            </div>`);
            if (checksOnly.length || checksWithText.length || texts.length) {
              qParts.push(`<div class="hint" style="margin-top:8px;">추가 항목</div>`);
              qParts.push(`<div style="margin-top:6px; font-size:13px; line-height:1.6;">
                ${checksOnly.length ? `<div>• 체크: ${escapeHtml(checksOnly.join(" / "))}</div>` : ``}
                ${checksWithText.length ? `<div>• 체크+주관식: ${escapeHtml(checksWithText.join(" / "))}</div>` : ``}
                ${texts.length ? `<div>• 주관식: ${escapeHtml(texts.join(" / "))}</div>` : ``}
              </div>`);
            }
          } else if (mode === "TEXT_MULTI") {
            const items = Array.isArray(q.answerSpec?.items) ? q.answerSpec.items : [];
            const texts = items.filter(it=>it && it.kind==="TEXT").map(it=>it.label||"");
            qParts.push(`<div class="hint" style="margin-top:10px;">주관식(예/아니오 없음)</div>`);
            qParts.push(`<div style="margin-top:6px; font-size:13px; line-height:1.6;">• 필드: ${escapeHtml(texts.join(" / ") || "주관식")}</div>`);
          } else if (mode === "YES_TEXT") {
            qParts.push(`<div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">
              <label><input type="radio" disabled> ${escapeHtml(q.answerSpec?.yesLabel || "예")}</label>
              <label><input type="radio" disabled> ${escapeHtml(q.answerSpec?.noLabel || "아니오")}</label>
            </div>`);
            qParts.push(`<div style="margin-top:8px;"><input disabled placeholder="${escapeAttr(q.answerSpec?.placeholder || "")}" style="width:85%;"></div>`);
          } else if (mode === "YES_MULTI_TEXT") {
            qParts.push(`<div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">
              <label><input type="radio" disabled> ${escapeHtml(q.answerSpec?.yesLabel || "예")}</label>
              <label><input type="radio" disabled> ${escapeHtml(q.answerSpec?.noLabel || "아니오")}</label>
            </div>`);
            const fields = q.answerSpec?.fields || [];
            qParts.push(`<div class="hint" style="margin-top:8px;">(YES 선택 시)</div>`);
            qParts.push(`<div style="margin-top:6px;">${fields.length ? fields.map(f=>`<div style="padding:4px 0;"><div class="hint">${escapeHtml(f)}</div><input disabled style="width:85%;" /></div>`).join("") : `<div class="hint">필드 없음</div>`}</div>`);
          } else if (mode === "TEXT") {
            qParts.push(`<div style="margin-top:10px;"><input disabled placeholder="${escapeAttr(q.answerSpec?.placeholder || "")}" style="width:85%;"></div>`);
          } else if (mode === "NA_ONLY") {
            qParts.push(`<div style="margin-top:10px;"><label><input type="radio" disabled checked> ${escapeHtml(q.answerSpec?.naLabel || "해당없음")}(NA)</label></div>`);
          } else if (mode === "NA_TEXT") {
            qParts.push(`<div style="margin-top:10px;"><label><input type="radio" disabled checked> ${escapeHtml(q.answerSpec?.naLabel || "해당없음")}(NA)</label></div>`);
            qParts.push(`<div style="margin-top:8px;"><input disabled placeholder="${escapeAttr(q.answerSpec?.placeholder || "")}" style="width:85%;"></div>`);
          }

          qParts.push(`</div>`);
          parts.push(qParts.join(""));
        });
      });
    });

    host.innerHTML = parts.join("");
  }

  // -------------------- Left tree ------------------
  function isCollapsed(kind, id) {
    const map = kind === "g1" ? state.ui.treeCollapsed.g1 : state.ui.treeCollapsed.g2;
    return !!map[id];
  }
  function setCollapsed(kind, id, val) {
    const map = kind === "g1" ? state.ui.treeCollapsed.g1 : state.ui.treeCollapsed.g2;
    map[id] = !!val;
  }

  // ------------------ Points meter (left) ------------------
  function getSelectedG2ForPoints() {
    if (state.selected?.kind !== "g2") return null;
    const ctx = findG2(state.selected.id);
    if (!ctx) return null;
    ensureG2Scoring(ctx.g2);
    return ctx.g2;
  }
  function sumQuestionPoints(g2) {
    return (g2.questions || []).reduce((a, q) => a + Number(q.points || 0), 0);
  }
  function renderPointsPanel() {
    const panel = $("pointsPanel");
    const meter = $("pointsMeter");
    const hint = $("pointsHint");
    if (!panel || !meter) return;

    const g2 = getSelectedG2ForPoints();
    if (!g2 || (g2.scoring?.questionAllocation !== "MANUAL")) {
      panel.style.display = "none";
      return;
    }
    const sum = sumQuestionPoints(g2);
    panel.style.display = "";
    meter.textContent = `${sum.toFixed(0)}/100점`;

    meter.classList.remove("good", "bad");
    if (Math.abs(sum - 100) < 1e-6) meter.classList.add("good");
    else meter.classList.add("bad");

    if (hint) {
      hint.textContent = `현재 선택된 구분2의 문항 배점 합계입니다.`;
    }
  }

  function renderTree() {
    const tree = $("tree");
    if (!tree) return;
    tree.innerHTML = "";
    // ✅ 기본값: 트리 전체 '접힘' (처음 렌더 시 g1/g2 키가 없으면 true로 세팅)
for (const g1 of state.survey.groups1) {
  if (state.ui.treeCollapsed.g1[g1.id] === undefined) state.ui.treeCollapsed.g1[g1.id] = true;
  for (const g2 of (g1.groups2 || [])) {
    if (state.ui.treeCollapsed.g2[g2.id] === undefined) state.ui.treeCollapsed.g2[g2.id] = true;
  }
}

const btnExpand = document.getElementById("btnExpand");
if (btnExpand) {
  const anyCollapsed =
    Object.values(state.ui.treeCollapsed.g1).some(v => v === true) ||
    Object.values(state.ui.treeCollapsed.g2).some(v => v === true);

  btnExpand.textContent = anyCollapsed ? "전체 펼치기" : "전체 접기";
}


    const sel = state.selected;

    // ✅ Tree Drag & Drop (G1/G2 reorder & move)
    const setTreeDrag = (kind, id) => { state.ui.treeDrag = { kind, id }; };
    const clearTreeDrag = () => { state.ui.treeDrag = null; };

    const moveG1Before = (dragId, targetId) => {
      if (dragId === targetId) return;
      const arr = state.survey.groups1;
      const from = arr.findIndex(x => x.id === dragId);
      const to = arr.findIndex(x => x.id === targetId);
      if (from < 0 || to < 0) return;
      const [item] = arr.splice(from, 1);
      const insertAt = from < to ? to - 1 : to;
      arr.splice(insertAt, 0, item);
    };

    const moveG2To = (dragG2Id, dropKind, dropId) => {
      const src = findG2(dragG2Id);
      if (!src) return;

      const srcArr = src.g1.groups2 || [];
      const from = srcArr.findIndex(x => x.id === dragG2Id);
      if (from < 0) return;
      const [item] = srcArr.splice(from, 1);

      if (dropKind === "g1") {
        const g1 = findG1(dropId);
        if (!g1) { srcArr.splice(from, 0, item); return; }
        g1.groups2 = g1.groups2 || [];
        g1.groups2.push(item); // drop on G1: append
        return;
      }

      if (dropKind === "g2") {
        const dst = findG2(dropId);
        if (!dst) { srcArr.splice(from, 0, item); return; }
        const dstArr = dst.g1.groups2 || [];
        const to = dstArr.findIndex(x => x.id === dropId);
        if (to < 0) { dstArr.push(item); return; }
        dstArr.splice(to, 0, item); // insert before target
        return;
      }

      srcArr.splice(from, 0, item);
    };

    const makeRow = ({ level, kind, id, label, meta, collapsible, collapsed, draggable = false, onClick, badgeText }) => {
      const row = document.createElement("div");
      row.className = `tree-row ${kind} ${sel?.kind === kind && sel?.id === id ? "active" : ""}`;
      row.style.paddingLeft = `${8 + level * 18}px`;

      if (draggable) row.setAttribute("draggable", "true");

      row.ondragstart = (e) => {
        if (!draggable) return;
        setTreeDrag(kind, id);
        try { e.dataTransfer.setData("text/plain", `${kind}:${id}`); } catch (_) {}
        e.dataTransfer.effectAllowed = "move";
      };
      row.ondragend = () => { clearTreeDrag(); };

      row.ondragover = (e) => {
        const d = state.ui.treeDrag;
        if (!d) return;
        const ok =
          (d.kind === "g1" && kind === "g1") ||
          (d.kind === "g2" && (kind === "g2" || kind === "g1"));
        if (!ok) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      };

      row.ondrop = (e) => {
        const d = state.ui.treeDrag;
        if (!d) return;
        const ok =
          (d.kind === "g1" && kind === "g1") ||
          (d.kind === "g2" && (kind === "g2" || kind === "g1"));
        if (!ok) return;
        e.preventDefault();

        if (d.kind === "g1" && kind === "g1") {
          moveG1Before(d.id, id);
        } else if (d.kind === "g2" && (kind === "g2" || kind === "g1")) {
          moveG2To(d.id, kind, id);
        }

        clearTreeDrag();
        render();
      };

      const toggle = document.createElement("button");
      toggle.className = "tree-toggle";
      toggle.textContent = collapsible ? (collapsed ? "+" : "−") : "";
      toggle.disabled = !collapsible;
      toggle.onclick = (e) => {
        e.stopPropagation();
        if (!collapsible) return;
        if (kind === "g1") state.ui.treeCollapsed.g1[id] = !collapsed;
        if (kind === "g2") state.ui.treeCollapsed.g2[id] = !collapsed;
        renderTree();
      };
      if (!collapsible) toggle.classList.add("spacer");

      const text = document.createElement("div");
      text.className = "tree-text";
      text.innerHTML = `
       <span class="tree-badge">${escapeHtml(badgeText || kind.toUpperCase())}</span>
       <span class="tree-label">${escapeHtml(label)}</span>
      `;

      const metaEl = document.createElement("div");
      metaEl.className = "tree-meta";
      metaEl.textContent = meta || "";

      row.appendChild(toggle);
      row.appendChild(text);
      row.appendChild(metaEl);

      row.onclick = () => onClick?.();

      return row;
    };

    for (const g1 of state.survey.groups1) {
      const g1Collapsed = isCollapsed("g1", g1.id);
      tree.appendChild(
        makeRow({
          level: 0,
          kind: "g1",
          draggable: true,
          id: g1.id,
          label: g1.name || "(이름 없음)",
          meta: `w1 ${num(g1.weight1)}%`,
          collapsible: true,
          collapsed: g1Collapsed,
          onClick: () => {
            state.selected = { kind: "g1", id: g1.id };
            renderWithScrollReset();
          }
        })
      );
      if (g1Collapsed) continue;

      for (const g2 of g1.groups2 || []) {
        const g2Collapsed = isCollapsed("g2", g2.id);
        tree.appendChild(
          makeRow({
            level: 1,
            kind: "g2",
            draggable: true,
            id: g2.id,
            label: g2.name || "(이름 없음)",
            meta: `${(g2.questions || []).length}문항 · w2 ${num(g2.weight2)}%`,
            collapsible: true,
            collapsed: g2Collapsed,
            onClick: () => {
              state.selected = { kind: "g2", id: g2.id };
            renderWithScrollReset();
            }
          })
        );
        if (g2Collapsed) continue;

(g2.questions || []).forEach((q, idx) => {
  tree.appendChild(
    makeRow({
      level: 2,
      kind: "q",
      id: q.id,
      badgeText: `Q${idx + 1}`,                 // ✅ 뱃지에 Q번호
      label: q.text || "(문항)",                 // ✅ 텍스트는 문항명만
      meta: "",
      collapsible: false,
      collapsed: false,
      draggable: false,
      onClick: () => {
        state.selected = { kind: "q", id: q.id };
        state.ui.focusQId = q.id;
        renderWithScrollReset();
      }
    })
  );
});

      }
    }


    if (!state.survey.groups1.length) {
      const empty = document.createElement("div");
      empty.className = "tree-empty muted";
      empty.textContent = "작성된 내용이 없습니다. 하단의 ‘구분1 추가’로 시작하세요.";
      tree.appendChild(empty);
    }
  }

// ------------------ Editor (right) ------------------
function renderEditor() {
  const edEdit = $("editor");
  const edRules = $("rulesRoot");
  const edScore = $("scoreRoot");

  if (edEdit) edEdit.innerHTML = "";
  if (edRules) edRules.innerHTML = "";
  if (edScore) edScore.innerHTML = "";

  const mode = state.ui.viewMode || "edit";
  const ed =
    mode === "rules" ? (edRules || edEdit) :
    mode === "score" ? (edScore || edEdit) :
    (edEdit);

  if (!ed) return;

  // ---- Edit view ----
  if (mode === "edit") {
    if (!state.selected) {
      ed.appendChild(renderRootG1List());
      return;
    }
    if (state.selected.kind === "g1") {
      const g1 = findG1(state.selected.id);
      if (!g1) return;
      ed.appendChild(renderG1Editor(g1));
      ed.appendChild(renderG2ListInG1(g1));
      ed.appendChild(renderAddG2Inline(g1));
      return;
    }
    if (state.selected.kind === "g2") {
      const ctx = findG2(state.selected.id);
      if (!ctx) return;
      ed.appendChild(renderG2Editor(ctx.g1, ctx.g2));
      ed.appendChild(renderQListInG2(ctx.g1, ctx.g2));
      return;
    }
    return;
  }

  // ---- Rules view ----
  if (mode === "rules") {
    if (!state.selected) {
      ed.appendChild(renderRuleBuilderCard());
      return;
    }
    if (state.selected.kind === "g1") {
      const g1 = findG1(state.selected.id);
      if (!g1) return;
      ed.appendChild(renderRuleBuilderCard(g1));
      return;
    }
    if (state.selected.kind === "g2") {
      const ctx = findG2(state.selected.id);
      if (!ctx) return;
      ed.appendChild(renderRuleBuilderCard(ctx.g1, ctx.g2));
      return;
    }
    return;
  }

  // ---- Score view ----
  if (mode === "score") {
    if (!state.selected) {
      ed.appendChild(renderScoringSimulatorCard());
      return;
    }
    if (state.selected.kind === "g1") {
      const g1 = findG1(state.selected.id);
      if (!g1) return;
      ed.appendChild(renderScoringSimulatorCard(g1));
      return;
    }
    if (state.selected.kind === "g2") {
      const ctx = findG2(state.selected.id);
      if (!ctx) return;
      ed.appendChild(renderScoringSimulatorCard(ctx.g1, ctx.g2));
      return;
    }
    return;
  }
}

function renderHeaderActions(header) {
  // 현재 활성 뷰(화면) 찾기
  const activeView =
    document.querySelector(".view.active") ||
    document.querySelector(`.view-${state.ui.viewMode || "edit"}`);
  if (!activeView) return;

  // ✅ 헤더 버튼을 넣을 슬롯
  const slot = activeView.querySelector("[data-header-actions]");
  if (!slot) return;

  const currentKind = state.selected?.kind || "root"; // root | g1 | g2

  // 경로/상위 id 계산
  let pathText = "현재: 메인 화면";
  let g1Id = null, g2Id = null;

  if (currentKind === "g1") {
    const g1 = findG1(state.selected.id);
    if (g1) {
      pathText = `현재: ${g1.name}`;
      g1Id = g1.id;
    }
  } else if (currentKind === "g2") {
    const ctx = findG2(state.selected.id);
    if (ctx) {
      pathText = `현재: ${ctx.g1.name} > ${ctx.g2.name}`;
      g1Id = ctx.g1.id;
      g2Id = ctx.g2.id;
    }
  }

  // ✅ “현재 위치 버튼 숨김” 규칙
  const showRootBtn = currentKind !== "root";        // 메인에서는 설문(전체) 숨김
  const showG1Btn   = currentKind !== "g1" && g1Id;  // 구분1에서는 구분1로 숨김
  const showG2Btn   = currentKind !== "g2" && g2Id;  // 구분2에서는 구분2로 숨김

  // 렌더 (중복 방지: 슬롯은 덮어쓰기)
  slot.innerHTML = `
    <div class="hint" style="margin:0 0 8px 0;">${escapeHtml(pathText)}</div>
    <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-start;">
      <button class="btn small" data-go="root" type="button"
        style="display:${showRootBtn ? "" : "none"};">최상위로</button>

      <button class="btn small" data-go="g1" type="button"
        style="display:${showG1Btn ? "" : "none"};">구분1로</button>

      <button class="btn small" data-go="g2" type="button"
        style="display:${showG2Btn ? "" : "none"};">구분2로</button>
    </div>
  `;

  // 이벤트 바인딩
  const goRoot = slot.querySelector('[data-go="root"]');
  if (goRoot) goRoot.onclick = () => {
    state.selected = null;
    state.ui.focusQId = null;
    render();
  };

  const goG1 = slot.querySelector('[data-go="g1"]');
  if (goG1) goG1.onclick = () => {
    state.selected = { kind: "g1", id: g1Id };
    state.ui.focusQId = null;
    render();
  };

  const goG2 = slot.querySelector('[data-go="g2"]');
  if (goG2) goG2.onclick = () => {
    state.selected = { kind: "g2", id: g2Id };
    state.ui.focusQId = null;
    render();
  };
}

  // ------------------ Breadcrumb ------------------
function renderBreadcrumb(ed) {
  const bar = document.createElement("div");
  bar.className = "card";

  let pathText = "현재: 메인 화면";
  let showG1 = false, showG2 = false;
  let g1Id = null, g2Id = null;

  if (state.selected?.kind === "g1") {
    const g1 = findG1(state.selected.id);
    if (g1) {
      pathText = `현재: ${g1.name}`;
      showG1 = true;
      g1Id = g1.id;
    }
  } else if (state.selected?.kind === "g2") {
    const ctx = findG2(state.selected.id);
    if (ctx) {
      pathText = `현재: ${ctx.g1.name} > ${ctx.g2.name}`;
      showG1 = true;
      showG2 = true;
      g1Id = ctx.g1.id;
      g2Id = ctx.g2.id;
    }
  }

  // ✅ "이동" 박스를 없애고, 같은 내용을 "설문 구성"으로 통합
  bar.innerHTML = `
    <b>설문 구성</b>
    <div class="hint" style="margin-top:6px;">왼쪽 트리에서 선택 후 편집하세요.</div>
    <div class="hint" style="margin-top:6px;">${escapeHtml(pathText)}</div>

    <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
      <button class="btn" id="go_root">최상위로</button>
      <button class="btn" id="go_g1" style="display:${showG1 ? "" : "none"};">구분1로</button>
      <button class="btn" id="go_g2" style="display:${showG2 ? "" : "none"};">구분2로</button>
    </div>
  `;

  // handlers
  bar.querySelector("#go_root").onclick = () => {
    state.selected = null;
    state.ui.focusQId = null;
    renderWithScrollReset();
  };
  if (showG1) {
    bar.querySelector("#go_g1").onclick = () => {
      state.selected = { kind: "g1", id: g1Id };
      state.ui.focusQId = null;
      renderWithScrollReset();
    };
  }
  if (showG2) {
    bar.querySelector("#go_g2").onclick = () => {
      state.selected = { kind: "g2", id: g2Id };
      state.ui.focusQId = null;
      renderWithScrollReset();
    };
  }
}

  // ------------------ Root list ------------------
  function renderRootG1List() {
    const wrap = document.createElement("div");
    wrap.className = "card";
    wrap.innerHTML = `
      <b>설문 구성</b>
      <div class="hint" style="margin-top:6px;">아래 구분1을 클릭하면 해당 구분1 편집 화면으로 이동합니다.</div>
      <div id="g1_root_list" style="margin-top:10px;"></div>
    `;
    const list = wrap.querySelector("#g1_root_list");

    if (state.survey.groups1.length === 0) {
      list.innerHTML = `<div class="hint">구분1이 없습니다. 왼쪽의 “+ 구분1” 버튼으로 추가하세요.</div>`;
    } else {
      state.survey.groups1.forEach((g1, idx) => {
        const row = document.createElement("div");
        row.className = "g1-structure-row";
        row.style.cursor = "pointer";
        row.innerHTML = `
          <b>${idx + 1}. ${escapeHtml(g1.name)}</b>
          <span class="hint">(w1 ${g1.weight1}%, 구분2 ${(g1.groups2 || []).length}개)</span>
        `;
        row.onclick = () => { state.selected = { kind: "g1", id: g1.id }; renderWithScrollReset(); };
        list.appendChild(row);
      });
    }
    return wrap;
  }

  // ------------------ Editors: G1 ------------------
function renderG1Editor(g1){
  const wrap = document.createElement("div");
  wrap.className = "card card-g1-edit";

  wrap.innerHTML = `
    <b>구분1 편집</b>
    <div class="hint">이름/가중치1 수정</div>

    <div class="field">
      <label>이름</label>
      <input id="g1_name" value="${escapeHtml(g1.name)}">
    </div>

    <div class="field">
      <label>가중치1(%)</label>
      <input id="g1_w1" type="number" value="${g1.weight1}">
    </div>

    <div class="row">
      <button class="btn primary" id="save_g1">저장</button>
      <button class="btn" id="del_g1">구분1 삭제</button>
    </div>
  `;

  wrap.querySelector("#save_g1").onclick = () => {
    g1.name = wrap.querySelector("#g1_name").value.trim();
    g1.weight1 = Number(wrap.querySelector("#g1_w1").value || 0);
    render();
  };

  wrap.querySelector("#del_g1").onclick = () => {
    if(confirm("구분1을 삭제할까요?")){
      state.survey.groups1 = state.survey.groups1.filter(x => x.id !== g1.id);
      state.selected = null;
      render();
    }
  };

  return wrap;
}


  function renderG2ListInG1(g1) {
    const wrap = document.createElement("div");
    wrap.className = "card";
    wrap.innerHTML = `
      <b>구분2 목록</b>
      <div class="hint" style="margin-top:6px;">클릭하면 해당 구분2 편집 화면으로 이동합니다.</div>
    `;
    const list = document.createElement("div");
    list.style.marginTop = "10px";

    const g2s = g1.groups2 || [];
    if (!g2s.length) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "등록된 구분2가 없습니다.";
      list.appendChild(empty);
    } else {
      g2s.forEach((g2) => {
        const row = document.createElement("div");
        row.className = "g2-list-row";
        row.style.cursor = "pointer";
        row.innerHTML = `<b>${escapeHtml(g2.name)}</b> <span class="hint">(w2 ${g2.weight2}%, 문항 ${(g2.questions || []).length})</span>`;
        row.onclick = () => { state.selected = { kind: "g2", id: g2.id }; render(); };
        list.appendChild(row);
      });
    }

    wrap.appendChild(list);
    return wrap;
  }

function renderAddG2Inline(g1){
  const wrap = document.createElement("div");
  wrap.className = "card card-g2-add";

  wrap.innerHTML = `
    <b>+ 구분2 추가</b>
    <div class="hint">팝업 없이 아래 입력 후 저장하세요.</div>

    <div class="field">
      <label>이름</label>
      <input id="new_g2_name" placeholder="예: 윤리공통">
    </div>

    <div class="field">
      <label>가중치2(%)</label>
      <input id="new_g2_w2" type="number" placeholder="예: 25">
    </div>

    <div class="row">
      <button class="btn primary" id="add_g2">저장(추가)</button>
    </div>
  `;

wrap.querySelector("#add_g2").onclick = () => {
  const name = wrap.querySelector("#new_g2_name").value.trim();
  const w2 = Number(wrap.querySelector("#new_g2_w2").value || 0);
  if (!name) return alert("이름을 입력하세요");

  // ✅ 핵심: groups2로 넣기
  g1.groups2 = g1.groups2 || [];
  const newG2 = {
    id: uid("g2"),
    name,
    weight2: w2,
    questions: []
  };
  // 선택사항: scoring 초기값까지 세팅해두면 안정적
  ensureG2Scoring(newG2);

  g1.groups2.push(newG2);

  // (선택) 추가 후 바로 그 구분2로 이동
  state.selected = { kind: "g2", id: newG2.id };

  render();
};


  return wrap;
}


  // ------------------ Editors: G2 ------------------
  function renderG2Editor(g1, g2) {
    const wrap = document.createElement("div");
    wrap.className = "card";
    wrap.innerHTML = `
      <b>구분2 편집</b>
      <div class="hint" style="margin-top:6px;">상위: ${escapeHtml(g1.name)} / 이름·가중치2 수정</div>
      <div style="margin-top:10px;">이름 <input id="g2_name" value="${escapeAttr(g2.name)}"></div>
      <div style="margin-top:6px;">가중치2(%) <input id="g2_w" type="number" value="${Number(g2.weight2 || 0)}"></div>
      <div style="margin-top:10px;">
        문항 배점 방식
        <select id="g2_qalloc">
          <option value="EQUAL">균등 배점 (문항수에 따라 1/n)</option>
          <option value="MANUAL">개별 배점 (문항별 점수 입력)</option>
        </select>
        <span class="hint" id="g2_qalloc_hint" style="margin-left:8px;"></span>
      </div>
      <div class="hint" style="margin-top:8px;">※ 룰로 제외된 문항은 구분2 내부 100점 기준으로 자동 재배분됩니다.</div>
      <div style="margin-top:10px;">
        <button class="btn" id="g2_save">저장</button>
        <button class="btn" id="g2_del">구분2 삭제</button>
      </div>
    `;
    wrap.querySelector("#g2_save").onclick = () => {
      g2.name = wrap.querySelector("#g2_name").value.trim() || g2.name;
      g2.weight2 = num(wrap.querySelector("#g2_w").value, g2.weight2);
      render();
    };
    wrap.querySelector("#g2_del").onclick = () => {
      if (!confirm("구분2를 삭제할까요? 하위 문항도 함께 삭제됩니다.")) return;
      g1.groups2 = (g1.groups2 || []).filter((x) => x.id !== g2.id);
      cleanupRulesDangling();
      state.selected = { kind: "g1", id: g1.id };
      render();
    };

    ensureG2Scoring(g2);
    const selAlloc = wrap.querySelector("#g2_qalloc");
    const allocHint = wrap.querySelector("#g2_qalloc_hint");
    selAlloc.value = g2.scoring.questionAllocation || "EQUAL";

    const refreshAllocHint = () => {
      if (selAlloc.value !== "MANUAL") { allocHint.textContent = ""; return; }
      const sum = (g2.questions || []).reduce((a, q) => a + Number(q.points || 0), 0);
      allocHint.textContent = `현재 합계: ${sum.toFixed(2)}/100점`;
    };
    refreshAllocHint();

    selAlloc.onchange = () => {
      const next = selAlloc.value;
      g2.scoring.questionAllocation = next;

      if (next === "MANUAL") {
        const n = Math.max((g2.questions || []).length, 1);
        const base = 100 / n;
        const hasAny = (g2.questions || []).some(q => Number(q.points || 0) > 0);
        if (!hasAny) {
          (g2.questions || []).forEach(q => { q.points = Number(base.toFixed(2)); });
          const sum = (g2.questions || []).reduce((a, q) => a + Number(q.points || 0), 0);
          const diff = 100 - sum;
          if (g2.questions[0]) g2.questions[0].points = Number((Number(g2.questions[0].points || 0) + diff).toFixed(2));
        }
      }

      refreshAllocHint();
      renderPointsPanel();
      render();
    };

    return wrap;
  }

  // ------------------ Inline questions editor in G2 ------------------
  function renderQListInG2(g1, g2) {
    ensureG2Scoring(g2);
    const wrap = document.createElement("div");
    wrap.className = "card card-q-edit";

    const modes = [
      ["YES_NO", "예/아니오(+체크/주관식)"],
      ["TEXT_MULTI", "주관식(다중, 예/아니오 없음)"]
    ];

    const qMax = (100 / Math.max(g2.questions.length || 1, 1)).toFixed(2);
    const alloc = g2.scoring.questionAllocation || "EQUAL";
    const allocText = alloc === "MANUAL" ? "개별 배점(문항별 점수)" : "균등 배점(100/n)";
    const sumPts = alloc === "MANUAL" ? (g2.questions||[]).reduce((a,q)=>a+Number(q.points||0),0) : 100;


    wrap.innerHTML = `
      <b>문항 편집</b>
      <div class="hint" style="margin-top:6px;">
        구분2: <b>${escapeHtml(g2.name)}</b> · 배점방식: <b>${allocText}</b> · 문항 수 n=${g2.questions.length} → 문항당 기준점(참고)= ${qMax}점 (100/n) · 합계(개별배점 시)= ${sumPts.toFixed(2)}/100
      </div>

      <div class="q-add-box" style="margin-top:10px; padding:10px; border:1px solid rgba(255,255,255,.12); border-radius:12px;">
       <b>+ 문항 추가</b>
        <div class="hint" style="margin-top:6px;">
          문항/필수 여부/답변타입 등을 설정한 후 저장하세요.
        </div>

        <div style="margin-top:10px;">문항
          <input id="new_q_text" placeholder="예: 인권 정책을 보유하고 있습니까?" style="width:85%">
        </div>
<div style="margin-top:8px;">답변 가이드
  <textarea id="new_q_guide" placeholder="피평가자가 답변할 때 참고할 가이드를 입력하세요." style="width:85%; min-height:80px;"></textarea>
</div>

        <div style="margin-top:6px; display:${alloc === "MANUAL" ? "" : "none"};" id="new_q_points_wrap">
          문항 배점(점)
          <input id="new_q_points" type="number" step="0.01" min="0" placeholder="예: 5" style="width:120px;">
          <span class="hint" style="margin-left:8px;">※ 배점의 합계는 100이 되어야 합니다. (좌측 배점 합계 참고)</span>
        </div>
<div style="margin-top:8px;">
  점수 반영 여부
  <label style="margin-left:10px;">
    <input type="checkbox" id="new_q_scoreEnabled" checked>
    <span style="margin-left:4px;">반영</span>
  </label>
  <span class="hint" style="margin-left:10px;">(체크 해제 = 미반영 → 0점, 나머지 문항에 재배분)</span>
</div>
        <div style="margin-top:6px;">
          필수 여부
          <select id="new_q_req">
            <option value="true">필수</option>
            <option value="false">선택</option>
          </select>
        </div>

        <div style="margin-top:6px;">
          답변 타입
          <select id="new_q_mode">
            ${modes.map(([v,l]) => `<option value="${v}">${l}</option>`).join("")}
          </select>
        </div>

        <div id="new_q_mode_panel" style="margin-top:10px;"></div>

        <div style="margin-top:10px;">
          <button class="btn" id="new_q_add">저장(추가)</button>
        </div>
      </div>

      <div style="margin-top:12px;">
      <div style="margin-top:12px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
       <div class="hint">정렬: 문항 카드의 상단을 드래그해서 순서를 바꿀 수 있습니다.</div>
       <button class="btn small ghost" id="btnQExpand" type="button">전체 펼치기</button>
      </div>


      <div id="q_inline_list" style="margin-top:12px;"></div>
    `;

// ✅ 문항 편집: 전체 펼치기/접기 (리프레시 없이 DOM만 토글)
const btnQExpand = wrap.querySelector("#btnQExpand");
if (btnQExpand) {
  btnQExpand.onclick = () => {
    const qs = (g2.questions || []);
    const anyCollapsed = qs.some(q => state.ui.collapsedQ[q.id] === true);

    // anyCollapsed=true면 -> 전체 펼치기(false), 아니면 전체 접기(true)
    const nextCollapsed = !anyCollapsed;

    qs.forEach(q => { state.ui.collapsedQ[q.id] = nextCollapsed; });

    // ✅ 현재 화면의 카드 DOM만 반영 (render() 호출 금지)
    qs.forEach(q => {
      const body = wrap.querySelector(`[data-body="${q.id}"]`);
      const btn  = wrap.querySelector(`button[data-toggle="${q.id}"]`);
      if (body) body.style.display = nextCollapsed ? "none" : "";
      if (btn) btn.textContent = nextCollapsed ? "펼치기" : "접기";
    });

    // 버튼 라벨도 즉시 맞추고 싶으면(선택)
    // btnQExpand.textContent = nextCollapsed ? "전체 펼치기" : "전체 접기";
  };
}


    // --- New question draft (kept across re-render by closure? re-render resets anyway) ---
    const draft = {
      mode: "YES_NO",
      yesLabel: "예",
      noLabel: "아니오",
      textTrigger: "YES", // YES_NO에서 주관식(TEXT) 표시 트리거 (YES 기본)
      // YES_NO: items[] = { kind:"CHECK", label, withText:boolean, placeholder }
      // TEXT_MULTI: items[] = { kind:"TEXT", label, placeholder }
      items: []
    };

    const newModePanel = wrap.querySelector("#new_q_mode_panel");

    const yesNoPanelHtml = () => `
      <div class="hint">표시 문구(응답자 화면에 보이는 문구)</div>
      <div style="margin-top:6px;">예 문구
        <input id="new_yesLabel" value="${escapeAttr(draft.yesLabel)}" style="width:85%">
      </div>
      <div style="margin-top:6px;">아니오 문구
        <input id="new_noLabel" value="${escapeAttr(draft.noLabel)}" style="width:85%">
      </div>
    `;

    function bindNewYesNoInputs() {
      const yes = newModePanel.querySelector("#new_yesLabel");
      const no = newModePanel.querySelector("#new_noLabel");
      if (yes) yes.oninput = (e) => (draft.yesLabel = e.target.value);
      if (no) no.oninput = (e) => (draft.noLabel = e.target.value);
    }

    function renderNewModePanel() {
      const mode = wrap.querySelector("#new_q_mode").value;
      draft.mode = mode;

      const yesNoHtml = () => `${yesNoPanelHtml()}
        <div class="hint" style="margin-top:10px;">(선택) 예/아니오 선택 후 추가 입력이 필요하면 아래에서 옵션을 추가하세요.</div>
        <div style="margin-top:6px;">
          <input id="new_item_label" placeholder="옵션명 입력 (체크/주관식 공통)" style="width:55%">
          <label style="margin-left:8px; font-size:13px;">
            <input type="checkbox" id="new_item_is_text"> 체크+주관식
          </label>
          <button class="btn" id="new_item_add">+ 추가</button>
        </div>
        <div id="new_item_list" style="margin-top:10px;"></div>
      `;

      const textMultiHtml = () => `
        <div class="hint">주관식(예/아니오 없음) — 여러 입력 필드를 만들 수 있습니다.</div>
        <div style="margin-top:6px;">
          <input id="new_item_label" placeholder="필드명 입력 (예: 담당자, 비고 등)" style="width:60%">
          <button class="btn" id="new_item_add">+ 추가</button>
        </div>
        <div id="new_item_list" style="margin-top:10px;"></div>
      `;

      const drawItems = (listEl) => {
        const items = Array.isArray(draft.items) ? draft.items : (draft.items = []);
        if (!items.length) { listEl.innerHTML = `<div class="hint">추가된 항목이 없습니다.</div>`; return; }

        listEl.innerHTML = items.map((it, i) => {
          const isLegacyText = it.kind === "TEXT";
          const hasText = !!it.withText;
          const label = escapeHtml(it.label || "");
          const ph = escapeAttr(it.placeholder || "");
          return `
            <div style="padding:6px 0; border-bottom:1px dashed var(--line);">
              <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                <div style="min-width:220px;">• <b>${label}</b>
                  <span class="pill">${isLegacyText ? "주관식(구버전)" : (hasText ? "체크+주관식" : "체크")}</span>
                </div>
                ${draft.mode === "YES_NO" && !isLegacyText ? `
                  <label style="font-size:13px;">
                    <input type="checkbox" data-k="it_withText_${i}" ${hasText ? "checked":""}> 체크+주관식
                  </label>
                ` : ``}
                <button class="btn" data-k="it_del_${i}" style="padding:2px 6px;">삭제</button>
              </div>
              ${(isLegacyText || hasText) ? `
                <div style="margin-top:6px; font-size:13px;">
                  플레이스홀더 <input data-k="it_ph_${i}" value="${ph}" style="width:85%">
                </div>
              ` : ``}
            </div>
          `;
        }).join("");

        // bind
        items.forEach((it, i) => {
          const delBtn = listEl.querySelector(`button[data-k="it_del_${i}"]`);
          if (delBtn) delBtn.onclick = () => { draft.items.splice(i, 1); drawItems(listEl); };

          if (draft.mode === "YES_NO" && it.kind !== "TEXT") {
            const wtCb = listEl.querySelector(`input[data-k="it_withText_${i}"]`);
            if (wtCb) wtCb.onchange = () => {
              it.withText = !!wtCb.checked;
              if (!it.withText) it.placeholder = "";
              drawItems(listEl);
            };
          }

          const phInp = listEl.querySelector(`input[data-k="it_ph_${i}"]`);
          if (phInp) phInp.oninput = () => { it.placeholder = phInp.value; };
        });
      };

      // ---------- Render ----------
      if (mode === "YES_NO") {
        newModePanel.innerHTML = yesNoHtml();
        bindNewYesNoInputs();

        const listEl = newModePanel.querySelector("#new_item_list");
        drawItems(listEl);

        newModePanel.querySelector("#new_item_add").onclick = () => {
          const labelInp = newModePanel.querySelector("#new_item_label");
          const withText = !!newModePanel.querySelector("#new_item_is_text")?.checked;
          const v = (labelInp.value || "").trim();
          if (!v) return;
          draft.items.push({ kind: "CHECK", withText, label: v, placeholder: "" });
          labelInp.value = "";
          if (newModePanel.querySelector("#new_item_is_text")) newModePanel.querySelector("#new_item_is_text").checked = false;
          drawItems(listEl);
        };
        return;
      }

      // TEXT_MULTI
      newModePanel.innerHTML = textMultiHtml();
      const listEl = newModePanel.querySelector("#new_item_list");
      // ensure only TEXT items
      draft.items = (draft.items || []).filter((it)=>it && it.kind==="TEXT");
      if (!draft.items.length) draft.items = [{ kind:"TEXT", label:"주관식", placeholder:"" }];
      drawItems(listEl);

      newModePanel.querySelector("#new_item_add").onclick = () => {
        const labelInp = newModePanel.querySelector("#new_item_label");
        const v = (labelInp.value || "").trim();
        if (!v) return;
        draft.items.push({ kind: "TEXT", label: v, placeholder: "" });
        labelInp.value = "";
        drawItems(listEl);
      };
    }

    wrap.querySelector("#new_q_mode").onchange = () => renderNewModePanel();
    renderNewModePanel();

    wrap.querySelector("#new_q_add").onclick = () => {
      const text  = (wrap.querySelector("#new_q_text")?.value || "").trim();
      const guide = (wrap.querySelector("#new_q_guide")?.value || "").trim();
      if (!text) return alert("문항을 입력하세요.");

      const required = wrap.querySelector("#new_q_req").value === "true";
      const mode = wrap.querySelector("#new_q_mode").value;

      const points = alloc === "MANUAL" ? Number(wrap.querySelector("#new_q_points")?.value || 0) : 0;
      const scoreEnabled = !!wrap.querySelector("#new_q_scoreEnabled")?.checked;
const guideEl = wrap.querySelector("#new_q_guide");
if (guideEl) guideEl.value = "";

      const q = {
        id: uid("q"),
        text,
        guide, 
        required,
        points,
        scoreEnabled,
        answerSpec: { mode }
      };

      if (mode === "YES_NO") {
        q.answerSpec.yesLabel = draft.yesLabel || "예";
        q.answerSpec.noLabel = draft.noLabel || "아니오";
        q.answerSpec.textTrigger = "YES";
        q.answerSpec.items = (draft.items || []).map(it => {
          // 신버전: CHECK + (선택) withText
          if (it && it.kind === "CHECK") {
            return {
              kind: "CHECK",
              label: String(it.label || "").trim(),
              withText: !!it.withText,
              placeholder: String(it.placeholder || "")
            };
          }
          // 예외적으로 남아있는 구버전 TEXT는 유지
          return {
            kind: "TEXT",
            label: String(it?.label || "").trim(),
            placeholder: String(it?.placeholder || "")
          };
        }).filter(it => it.label);
      } else if (mode === "TEXT_MULTI") {
        q.answerSpec.items = (draft.items || []).map(it => ({
          kind: "TEXT",
          label: String(it.label || "").trim(),
          placeholder: String(it.placeholder || "")
        })).filter(it => it.label);
      }ensureQuestionSpec(q);
      g2.questions.push(q);

      wrap.querySelector("#new_q_text").value = "";
      wrap.querySelector("#new_q_req").value = "false";
      if (alloc === "MANUAL" && wrap.querySelector("#new_q_points")) wrap.querySelector("#new_q_points").value = "";

      // default accordion open for newly created question
      state.ui.collapsedQ[q.id] = true;
      state.ui.focusQId = q.id;

      render();
    };

    // --- Existing questions list (inline editing + accordion + DnD reorder) ---
    const list = wrap.querySelector("#q_inline_list");

    function drawQuestions() {
      if (g2.questions.length === 0) {
        list.innerHTML = `<div class="hint">등록된 문항이 없습니다.</div>`;
        return;
      }
      list.innerHTML = "";

      g2.questions.forEach((q, idx) => {
        ensureQuestionSpec(q);

if (state.ui.collapsedQ[q.id] === undefined) state.ui.collapsedQ[q.id] = true;
const isCollapsed = state.ui.collapsedQ[q.id] === true;
        const card = document.createElement("div");
        card.id = `qcard_${q.id}`;
        card.className = "qcard";
        card.style.padding = "12px";
        card.style.borderRadius = "12px";
        card.style.marginTop = "10px";
        // drag handle + header
        card.setAttribute("draggable", "true");
        card.ondragstart = () => { state.ui.drag.fromIdx = idx; };
        card.ondragover = (e) => { e.preventDefault(); };
        card.ondrop = () => {
          const from = state.ui.drag.fromIdx;
          const to = idx;
          if (from === null || from === undefined) return;
          if (from === to) return;
          const arr = g2.questions;
          const [moved] = arr.splice(from, 1);
          arr.splice(to, 0, moved);
          state.ui.drag.fromIdx = null;
          render();
        };

        const modeLabel = q.answerSpec.mode;

        card.innerHTML = `
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <span class="hint" title="드래그해서 정렬">☰</span>
              <span class="q-pill">Q${idx + 1}</span>
              <span class="hint">${escapeHtml(q.text || "")}</span>
              ${q.required ? `<span class="hint">[필수]</span>` : ``}
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button class="btn" data-toggle="${q.id}" style="padding:4px 10px;">${isCollapsed ? "펼치기" : "접기"}</button>
              <button class="btn" data-del="${q.id}" style="padding:4px 10px;">삭제</button>
            </div>
          </div>

          <div data-body="${q.id}" style="margin-top:10px; display:${isCollapsed ? "none" : ""};"></div>
        `;

        const body = card.querySelector(`[data-body="${q.id}"]`);

        // local draft for edit, saved on button click
        const draft2 = {
  text: q.text || "",
  guide: q.guide || "",
  required: !!q.required,
  scoreEnabled: q.scoreEnabled !== false,
  points: Number(q.points || 0),
  answerSpec: JSON.parse(JSON.stringify(q.answerSpec || {}))
};

        const modes2 = [
          ["YES_NO", "예/아니오(+체크/주관식)"],
          ["TEXT_MULTI", "주관식(다중, 예/아니오 없음)"]
        ];

        const yesNoHtml2 = () => `
          <div class="hint">표시 문구(응답자 화면에 그대로 노출)</div>
          <div style="margin-top:6px;">예 문구 <input data-k="yesLabel" value="${escapeAttr(draft2.answerSpec.yesLabel || "예")}" style="width:85%"></div>
          <div style="margin-top:6px;">아니오 문구 <input data-k="noLabel" value="${escapeAttr(draft2.answerSpec.noLabel || "아니오")}" style="width:85%"></div>
        `;

        function renderModePanel2(panel) {
          const as = draft2.answerSpec || (draft2.answerSpec = {});
          const mode = as.mode || "YES_NO";
          as.mode = mode;

          // defaults
          if (as.yesLabel === undefined) as.yesLabel = "예";
          if (as.noLabel === undefined) as.noLabel = "아니오";
          if (as.textTrigger === undefined) as.textTrigger = "YES";
          if (!Array.isArray(as.items)) as.items = [];

          const drawItems = (listEl) => {
            const items = as.items || (as.items = []);
            if (!items.length) { listEl.innerHTML = `<div class="hint">추가된 항목이 없습니다.</div>`; return; }

            listEl.innerHTML = items.map((it, i) => {
              const isLegacyText = it.kind === "TEXT";
              const hasText = !!it.withText;
              const label = escapeHtml(it.label || "");
              const ph = escapeAttr(it.placeholder || "");
              return `
                <div style="padding:6px 0; border-bottom:1px dashed var(--line);">
                  <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                    <div style="min-width:220px;">• <b>${label}</b>
                      <span class="pill">${isLegacyText ? "주관식(구버전)" : (hasText ? "체크+주관식" : "체크")}</span>
                    </div>
                    ${mode === "YES_NO" && !isLegacyText ? `
                      <label style="font-size:13px;">
                        <input type="checkbox" data-k="it_withText_${i}" ${hasText ? "checked":""}> 체크+주관식
                      </label>
                    ` : ``}
                    <button class="btn" data-k="it_del_${i}" style="padding:2px 6px;">삭제</button>
                  </div>
                  ${(isLegacyText || hasText) ? `
                    <div style="margin-top:6px; font-size:13px;">
                      플레이스홀더 <input data-k="it_ph_${i}" value="${ph}" style="width:85%">
                    </div>
                  ` : ``}
                </div>
              `;
            }).join("");

            items.forEach((it, i) => {
              const delBtn = listEl.querySelector(`button[data-k="it_del_${i}"]`);
              if (delBtn) delBtn.onclick = () => { as.items.splice(i, 1); drawItems(listEl); };

              if (mode === "YES_NO" && it.kind !== "TEXT") {
                const wtCb = listEl.querySelector(`input[data-k="it_withText_${i}"]`);
                if (wtCb) wtCb.onchange = () => {
                  it.withText = !!wtCb.checked;
                  if (!it.withText) it.placeholder = "";
                  drawItems(listEl);
                };
              }

              const phInp = listEl.querySelector(`input[data-k="it_ph_${i}"]`);
              if (phInp) phInp.oninput = () => { it.placeholder = phInp.value; };
            });
          };

          if (mode === "YES_NO") {
            panel.innerHTML = `
              ${yesNoHtml2()}
              <div class="hint" style="margin-top:10px;">(선택) 예/아니오 선택 후 추가 입력이 필요하면 아래에서 항목을 추가하세요.</div>
              <div style="margin-top:6px;">
                <input data-k="itemLabel" placeholder="옵션명 입력 (체크/주관식 공통)" style="width:55%">
                <label style="margin-left:8px; font-size:13px;">
                  <input type="checkbox" data-k="itemIsText"> 체크+주관식
                </label>
                <button class="btn" data-k="itemAdd">+ 추가</button>
              </div>
              <div data-k="itemList" style="margin-top:10px;"></div>
            `;
            // bind yes/no labels
            // bind yes/no label inputs
            const yesInp = panel.querySelector(`input[data-k="yesLabel"]`);
            const noInp  = panel.querySelector(`input[data-k="noLabel"]`);
            if (yesInp) yesInp.oninput = () => { as.yesLabel = yesInp.value; };
            if (noInp)  noInp.oninput  = () => { as.noLabel  = noInp.value; };

            const listEl = panel.querySelector(`[data-k="itemList"]`);
            drawItems(listEl);

            panel.querySelector(`button[data-k="itemAdd"]`).onclick = () => {
              const labelInp = panel.querySelector(`input[data-k="itemLabel"]`);
              const withText = !!panel.querySelector(`input[data-k="itemIsText"]`)?.checked;
              const v = (labelInp.value || "").trim();
              if (!v) return;
              as.items.push({ kind: "CHECK", withText, label: v, placeholder: "" });
              labelInp.value = "";
              if (panel.querySelector(`input[data-k="itemIsText"]`)) panel.querySelector(`input[data-k="itemIsText"]`).checked = false;
              drawItems(listEl);
            };
            return;
          }

          // TEXT_MULTI
          panel.innerHTML = `
            <div class="hint">주관식(예/아니오 없음) — 여러 입력 필드를 만들 수 있습니다.</div>
            <div style="margin-top:6px;">
              <input data-k="itemLabel" placeholder="필드명 입력 (예: 담당자, 비고 등)" style="width:60%">
              <button class="btn" data-k="itemAdd">+ 추가</button>
            </div>
            <div data-k="itemList" style="margin-top:10px;"></div>
          `;
          // ensure only TEXT items
          as.items = (as.items || []).filter((it)=>it && it.kind==="TEXT");
          if (!as.items.length) as.items = [{ kind:"TEXT", label:"주관식", placeholder:"" }];

          const listEl = panel.querySelector(`[data-k="itemList"]`);
          drawItems(listEl);

          panel.querySelector(`button[data-k="itemAdd"]`).onclick = () => {
            const labelInp = panel.querySelector(`input[data-k="itemLabel"]`);
            const v = (labelInp.value || "").trim();
            if (!v) return;
            as.items.push({ kind:"TEXT", label:v, placeholder:"" });
            labelInp.value = "";
            drawItems(listEl);
          };
        }

        function setMode2(newMode) {
          const prev = draft2.answerSpec || {};
          const prevYes = prev.yesLabel;
          const prevNo  = prev.noLabel;
          const prevItems = Array.isArray(prev.items) ? prev.items : [];

          draft2.answerSpec = { mode: newMode };

          if (newMode === "YES_NO") {
            draft2.answerSpec.yesLabel = prevYes ?? "예";
            draft2.answerSpec.noLabel  = prevNo  ?? "아니오";
            draft2.answerSpec.textTrigger = prev.textTrigger === "NO" ? "NO" : "YES";
            // keep items as-is (allow mixed CHECK/TEXT)
            draft2.answerSpec.items = prevItems.map(it => {
              if (it?.kind === "TEXT") {
                return {
                  kind: "TEXT",
                  label: String(it?.label || "").trim(),
                  placeholder: String(it?.placeholder || "")
                };
              }
              return {
                kind: "CHECK",
                label: String(it?.label || "").trim(),
                withText: !!it?.withText,
                placeholder: String(it?.placeholder || "")
              };
            }).filter(it => it.label);
            return;
          }

          // TEXT_MULTI
          draft2.answerSpec.items = prevItems
            .filter(it => it && it.kind === "TEXT")
            .map(it => ({
              kind: "TEXT",
              label: String(it.label || "").trim(),
              placeholder: String(it.placeholder || "")
            }))
            .filter(it => it.label);

          if (!draft2.answerSpec.items.length) {
            draft2.answerSpec.items = [{ kind:"TEXT", label:"주관식", placeholder:"" }];
          }
        }

        body.innerHTML = `
          <div style="margin-top:6px;">문항
            <input data-k="text" value="${escapeAttr(q.text)}" style="width:85%;">
          </div>

          <div style="margin-top:6px;">
            필수 여부
            <select data-k="req">
              <option value="false" ${!q.required ? "selected" : ""}>선택</option>
              <option value="true" ${q.required ? "selected" : ""}>필수</option>
            </select>
          </div>

            <div style="margin-top:8px;">
    점수 반영 여부
    <label style="margin-left:10px;">
      <input type="checkbox" data-k="scoreEnabled" ${draft2.scoreEnabled ? "checked" : ""}>
      <span style="margin-left:4px;">반영</span>
    </label>
    <span class="hint" style="margin-left:10px;">(체크 해제 = 미반영 → 0점, 나머지 문항에 재배분)</span>
  </div>

          <div style="margin-top:6px; display:${(g2.scoring.questionAllocation||"EQUAL")==="MANUAL" ? "" : "none"};">
            문항 배점(점)
            <input data-k="points" type="number" step="0.01" min="0" value="${Number(q.points||0)}" style="width:120px;">
            <span class="hint" style="margin-left:8px;">(개별 배점 모드에서 합계 100점)</span>
          </div>

          <div style="margin-top:6px;">
            답변 타입
            <select data-k="mode">
              ${modes2.map(([v,l])=>`<option value="${v}" ${q.answerSpec.mode===v?"selected":""}>${l}</option>`).join("")}
            </select>
          </div>

          <div style="margin-top:10px;" data-panel="modePanel"></div>
<div style="margin-top:10px;">
  <div class="hint" style="margin-bottom:6px;">답변 가이드</div>
  <textarea data-k="guide" placeholder="답변할 때 참고할 가이드를 입력하세요." style="width:85%; min-height:90px;">${escapeHtml(q.guide || "")}</textarea>
</div>

          <div style="margin-top:10px;">
            <button class="btn" data-save="${q.id}">저장</button>
            <span class="hint" style="margin-left:8px;">※ 저장을 눌러야 확정됩니다.</span>
          </div>
        `;


        const inputText = body.querySelector(`input[data-k="text"]`);
        const selReq = body.querySelector(`select[data-k="req"]`);
        const selMode = body.querySelector(`select[data-k="mode"]`);
        const modePanel = body.querySelector(`[data-panel="modePanel"]`);
        const chkScore = body.querySelector(`input[data-k="scoreEnabled"]`);
        if (chkScore) chkScore.onchange = (e) => (draft2.scoreEnabled = !!e.target.checked);
        const taGuide = body.querySelector(`textarea[data-k="guide"]`);
        if (taGuide) taGuide.oninput = (e) => (draft2.guide = e.target.value);


        inputText.oninput = (e) => (draft2.text = e.target.value);
        selReq.onchange = (e) => (draft2.required = e.target.value === "true");
        const inpPts = body.querySelector(`input[data-k="points"]`);
        if (inpPts) inpPts.oninput = (e) => (draft2.points = Number(e.target.value));
        selMode.onchange = (e) => { setMode2(e.target.value); renderModePanel2(modePanel); };

        renderModePanel2(modePanel);

        body.querySelector(`button[data-save="${q.id}"]`).onclick = () => {
          q.text = draft2.text.trim() || q.text;
          q.required = !!draft2.required;
          if ((g2.scoring.questionAllocation||"EQUAL")==="MANUAL") q.points = Number(draft2.points || 0);
          q.scoreEnabled = !!draft2.scoreEnabled;
          q.answerSpec = draft2.answerSpec;
          q.guide = (typeof draft2.guide === "string") ? draft2.guide : (q.guide || "");
          ensureQuestionSpec(q);
          render();
        };

        // toggle & delete handlers
card.querySelector(`button[data-toggle="${q.id}"]`).onclick = () => {
  const next = !(state.ui.collapsedQ[q.id] === true);
  state.ui.collapsedQ[q.id] = next;

  const body = card.querySelector(`[data-body="${q.id}"]`);
  if (body) body.style.display = next ? "none" : "";

  const btn = card.querySelector(`button[data-toggle="${q.id}"]`);
  if (btn) btn.textContent = next ? "펼치기" : "접기";
};


        card.querySelector(`button[data-del="${q.id}"]`).onclick = () => {
          if (!confirm("문항을 삭제할까요?")) return;
          g2.questions = g2.questions.filter((x) => x.id !== q.id);
          cleanupRulesDangling();
          delete state.ui.collapsedQ[q.id];
          if (state.ui.focusQId === q.id) state.ui.focusQId = null;
          render();
        };

        list.appendChild(card);
      });

      // focus scroll
      if (state.ui.focusQId) {
        const el = document.getElementById(`qcard_${state.ui.focusQId}`);
        if (el) {
          setTimeout(() => {
            try { el.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) {}
          }, 50);
        }
      }
    }

    drawQuestions();
    return wrap;
  }

// ------------------ Rule Builder ------------------
function renderRuleBuilderCard(filterG1 = null, filterG2 = null) {
  const wrap = document.createElement("div");
  wrap.className = "card";

  const qs = allQuestions();

  const scopeHint = (() => {
    if (filterG1 && filterG2) return `현재 범위: ${filterG1.name} / ${filterG2.name}`;
    if (filterG1) return `현재 범위: ${filterG1.name}`;
    return `현재 범위: 설문 전체`;
  });

  wrap.innerHTML = `
    <b>분기 룰(비활성화) 설정</b>
    <div class="hint" style="margin-top:6px;">
      ${escapeHtml(scopeHint)} · 트리거 문항은 <b>항상 배점 제외</b> · 룰 발동 시 같은 구분2 내에서 선택한 문항만 비활성(0점)
    </div>
    <div class="hint" style="margin-top:4px;">
      비활성/트리거로 빠진 배점은 해당 구분2의 남은 활성 문항에 <b>구분2 내부 100점으로 재배분</b>됩니다.
      (EQUAL: 100/n, MANUAL: points 비율 정규화)
    </div>

    <div style="margin-top:12px; padding:10px; border:1px solid rgba(255,255,255,.12); border-radius:12px;">
      <div class="hint"><b>+ 룰 추가</b></div>

      <div style="margin-top:8px;">
        트리거 문항
        <select id="rb_q" style="max-width:100%;">
          ${qs.map(({g1,g2,q}) => `<option value="${q.id}">${escapeHtml(g1.name)} / ${escapeHtml(g2.name)} :: ${escapeHtml(q.text)}</option>`).join("")}
        </select>
      </div>

      <div style="margin-top:8px;">
        트리거 값
        <select id="rb_val">
          ${NORM_VALUES.map(v => {
            const label = v === "YES" ? "예" : v === "NO" ? "아니오" : "해당없음";
            return `<option value="${v}">${label}</option>`;
          }).join("")}
        </select>
        <span class="hint" style="margin-left:8px;">※ 해당 답변 선택 시 비활성화 기능이 작동합니다.</span>
      </div>

      <div style="margin-top:8px;">
        액션
        <select id="rb_action" disabled>
          <option value="DEACTIVATE_QUESTIONS_IN_G2">DEACTIVATE_QUESTIONS_IN_G2 (선택 문항 비활성)</option>
        </select>
      </div>

      <div style="margin-top:10px; padding:10px; border:1px dashed rgba(255,255,255,.14); border-radius:12px;">
        <div class="hint"><b>비활성 문항 선택(복수)</b> — 트리거 문항과 같은 구분2 내에서만 선택 가능</div>
        <div id="rb_g2_hint" class="hint" style="margin-top:6px;"></div>
        <div id="rb_targets" style="margin-top:8px;"></div>
      </div>

      <div style="margin-top:10px;">
        <button class="btn" id="rb_add">룰 저장(추가)</button>
      </div>
    </div>

    <div style="margin-top:12px;">
      <b>등록된 룰</b>
      <div id="rb_list" style="margin-top:8px;"></div>
    </div>
  `;

  const list = wrap.querySelector("#rb_list");

  if (qs.length === 0) {
    list.innerHTML = `<div class="hint">문항이 있어야 룰을 추가할 수 있습니다.</div>`;
    const addBtn = wrap.querySelector("#rb_add");
    if (addBtn) addBtn.disabled = true;
    return wrap;
  }

  // --- target checklist renderer ---
  function findG2ByQuestionId(qid) {
    for (const g1 of state.survey.groups1) {
      for (const g2 of (g1.groups2 || [])) {
        const idx = (g2.questions || []).findIndex(q => q.id === qid);
        if (idx >= 0) return { g1, g2, idx };
      }
    }
    return null;
  }

  const rbQ = wrap.querySelector("#rb_q");
  const rbHint = wrap.querySelector("#rb_g2_hint");
  const rbTargets = wrap.querySelector("#rb_targets");

  function drawTargets() {
    const qid = rbQ.value;
    const ctx = findG2ByQuestionId(qid);
    if (!ctx) {
      rbHint.textContent = "트리거 문항의 구분2를 찾지 못했습니다.";
      rbTargets.innerHTML = "";
      return;
    }

    rbHint.innerHTML = `대상 구분2: <b>${escapeHtml(ctx.g1.name)} / ${escapeHtml(ctx.g2.name)}</b>`;

    const items = (ctx.g2.questions || []).map((q) => {
      const disabled = q.id === qid; // 트리거 본인은 선택 금지
      return `
        <label style="display:flex; gap:8px; align-items:flex-start; padding:4px 0; opacity:${disabled ? 0.55 : 1};">
          <input type="checkbox" value="${escapeAttr(q.id)}" ${disabled ? "disabled" : ""}>
          <span>${escapeHtml(q.text || "")}</span>
          ${disabled ? `<span class="hint">(트리거 문항 — 선택 불가, 항상 배점 제외)</span>` : ``}
        </label>
      `;
    }).join("");

    rbTargets.innerHTML = items || `<div class="hint">구분2에 문항이 없습니다.</div>`;
  }

  rbQ.onchange = drawTargets;
  drawTargets();

  // --- add rule ---
  wrap.querySelector("#rb_add").onclick = () => {
    const qid = wrap.querySelector("#rb_q").value;
    const val = wrap.querySelector("#rb_val").value;

    const checked = Array.from(wrap.querySelectorAll(`#rb_targets input[type="checkbox"]:checked`))
      .map(x => x.value)
      .filter(Boolean);

    if (!qid || !val) return alert("룰 입력이 부족합니다.");
    if (!checked.length) return alert("비활성화할 문항을 1개 이상 선택하세요.");

    state.survey.rules.push({
      id: uid("rule"),
      trigger: { questionId: qid, equals: val },
      action: "DEACTIVATE_QUESTIONS_IN_G2",
      targetQuestionIds: checked
    });

    render();
  };

  // --- list renderer ---
  function drawList() {
    if (!state.survey.rules.length) {
      list.innerHTML = `<div class="hint">등록된 룰이 없습니다.</div>`;
      return;
    }

    const qMap = new Map(qs.map(({ q }) => [q.id, q]));
    function getPathByQid(qid) {
      for (const { g1, g2, q } of allQuestions()) {
        if (q.id === qid) return `${g1.name} / ${g2.name}`;
      }
      return "";
    }

    const editId = state.ui.ruleEditId;

    list.innerHTML = state.survey.rules.map((r, idx) => {
      const isEdit = editId === r.id;

      const tqid = r.trigger?.questionId || "";
      const teq  = r.trigger?.equals || "YES";
      const path = getPathByQid(tqid);
      const tq   = qMap.get(tqid);

      const targets = Array.isArray(r.targetQuestionIds) ? r.targetQuestionIds : [];
      const targetNames = targets
        .map(id => qMap.get(id)?.text || id)
        .slice(0, 6)
        .map(t => escapeHtml(t));

      if (!isEdit) {
        return `
          <div style="padding:10px; border:1px solid rgba(255,255,255,.12); border-radius:12px; margin-top:8px;">
            <div><b>#${idx + 1}</b> <span class="hint">(id: ${escapeHtml(r.id)})</span></div>
            <div class="hint" style="margin-top:6px;">
              IF <b>${escapeHtml(path ? `${path} :: ` : "")}${escapeHtml(tq ? tq.text : tqid)}</b>
              == <b>${escapeHtml(teq)}</b>
            </div>
            <div class="hint" style="margin-top:4px;">
              THEN <b>${escapeHtml(r.action || "")}</b> → 비활성 문항 <b>${targets.length}개</b>
            </div>
            <div class="hint" style="margin-top:6px;">
              ${targetNames.length ? `• ${targetNames.join("<br>• ")}` : "(대상 문항 없음)"}
              ${targets.length > 6 ? `<br>… 외 ${targets.length - 6}개` : ""}
            </div>
            <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
              <button class="btn" data-edit="${escapeAttr(r.id)}" style="padding:4px 10px;">편집</button>
              <button class="btn" data-del="${escapeAttr(r.id)}" style="padding:4px 10px;">삭제</button>
            </div>
          </div>
        `;
      }

      // edit mode
      return `
        <div style="padding:10px; border:1px solid rgba(255,255,255,.12); border-radius:12px; margin-top:8px;">
          <div><b>#${idx + 1} 룰 편집</b> <span class="hint">(id: ${escapeHtml(r.id)})</span></div>

          <div style="margin-top:10px;">
            <div class="hint"><b>트리거 문항</b></div>
            <select id="re_q_${escapeAttr(r.id)}" style="max-width:100%;">
              ${qs.map(({ g1, g2, q }) => `<option value="${q.id}" ${q.id === tqid ? "selected" : ""}>${escapeHtml(g1.name)} / ${escapeHtml(g2.name)} :: ${escapeHtml(q.text)}</option>`).join("")}
            </select>
          </div>

          <div style="margin-top:8px;">
            <div class="hint"><b>트리거 값(정규화)</b></div>
            <select id="re_val_${escapeAttr(r.id)}">
              ${NORM_VALUES.map(v => {
                const label = v === "YES" ? "예" : v === "NO" ? "아니오" : "해당없음";
                return `<option value="${v}" ${v === teq ? "selected" : ""}>${label}</option>`;
              }).join("")}
            </select>
          </div>

          <div style="margin-top:10px; padding:10px; border:1px dashed rgba(255,255,255,.14); border-radius:12px;">
            <div class="hint"><b>비활성 문항 선택(복수)</b> — 트리거 문항과 같은 구분2 내에서만 선택 가능</div>
            <div id="re_g2hint_${escapeAttr(r.id)}" class="hint" style="margin-top:6px;"></div>
            <div id="re_targets_${escapeAttr(r.id)}" style="margin-top:8px;"></div>
          </div>

          <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn" data-save="${escapeAttr(r.id)}" style="padding:4px 10px;">저장</button>
            <button class="btn" data-cancel="${escapeAttr(r.id)}" style="padding:4px 10px;">취소</button>
            <button class="btn" data-del="${escapeAttr(r.id)}" style="padding:4px 10px;">삭제</button>
          </div>
        </div>
      `;
    }).join("");

    // --- bindings: delete ---
    list.querySelectorAll("button[data-del]").forEach((b) => {
      b.onclick = () => {
        const rid = b.getAttribute("data-del");
        if (!confirm("룰을 삭제할까요?")) return;
        state.survey.rules = state.survey.rules.filter((x) => x.id !== rid);
        if (state.ui.ruleEditId === rid) state.ui.ruleEditId = null;
        render();
      };
    });

    // --- bindings: edit ---
    list.querySelectorAll("button[data-edit]").forEach((b) => {
      b.onclick = () => {
        const rid = b.getAttribute("data-edit");
        state.ui.ruleEditId = rid;
        render();
      };
    });

    // --- bindings: cancel ---
    list.querySelectorAll("button[data-cancel]").forEach((b) => {
      b.onclick = () => {
        state.ui.ruleEditId = null;
        render();
      };
    });

    // --- edit mode dynamic targets + save ---
    if (editId) {
      const rid = editId;
      const rule = state.survey.rules.find(x => x.id === rid);
      if (!rule) return;

      const selQ   = list.querySelector(`#re_q_${CSS.escape(rid)}`);
      const selVal = list.querySelector(`#re_val_${CSS.escape(rid)}`);
      const hintEl = list.querySelector(`#re_g2hint_${CSS.escape(rid)}`);
      const tgtEl  = list.querySelector(`#re_targets_${CSS.escape(rid)}`);

      const drawEditTargets = () => {
        if (!selQ || !tgtEl || !hintEl) return;
        const qid = selQ.value;
        const ctx = findG2ByQuestionId(qid);
        if (!ctx) {
          hintEl.textContent = "트리거 문항의 구분2를 찾지 못했습니다.";
          tgtEl.innerHTML = "";
          return;
        }
        hintEl.innerHTML = `대상 구분2: <b>${escapeHtml(ctx.g1.name)} / ${escapeHtml(ctx.g2.name)}</b>`;

        const current = new Set(Array.isArray(rule.targetQuestionIds) ? rule.targetQuestionIds : []);
        tgtEl.innerHTML = (ctx.g2.questions || []).map((q) => {
          const disabled = q.id === qid;
          const checked = !disabled && current.has(q.id);
          return `
            <label style="display:flex; gap:8px; align-items:flex-start; padding:4px 0; opacity:${disabled ? 0.55 : 1};">
              <input type="checkbox" value="${escapeAttr(q.id)}" ${disabled ? "disabled" : ""} ${checked ? "checked" : ""}>
              <span>${escapeHtml(q.text || "")}</span>
              ${disabled ? `<span class="hint">(트리거 문항 — 선택 불가, 항상 배점 제외)</span>` : ``}
            </label>
          `;
        }).join("") || `<div class="hint">구분2에 문항이 없습니다.</div>`;

        // 트리거가 바뀌면 "다른 구분2"에 있던 target들은 자동으로 풀리게 함(교차선택 방지)
        const allowed = new Set((ctx.g2.questions || []).map(q => q.id));
        const cleaned = Array.from(current).filter(id => allowed.has(id) && id !== qid);
        rule.targetQuestionIds = cleaned;
      };

      if (selQ) selQ.onchange = () => { drawEditTargets(); };
      drawEditTargets();

      list.querySelectorAll("button[data-save]").forEach((b) => {
        b.onclick = () => {
          const rid2 = b.getAttribute("data-save");
          const r2 = state.survey.rules.find(x => x.id === rid2);
          if (!r2) return;

          const qid = selQ ? selQ.value : r2.trigger?.questionId;
          const val = selVal ? selVal.value : r2.trigger?.equals;

          const checked = Array.from(tgtEl ? tgtEl.querySelectorAll(`input[type="checkbox"]:checked`) : [])
            .map(x => x.value)
            .filter(Boolean);

          if (!qid || !val) return alert("룰 입력이 부족합니다.");
          if (!checked.length) return alert("비활성화할 문항을 1개 이상 선택하세요.");

          r2.trigger = { questionId: qid, equals: val };
          r2.action = "DEACTIVATE_QUESTIONS_IN_G2";
          r2.targetQuestionIds = checked;

          state.ui.ruleEditId = null;
          render();
        };
      });
    }
  }

  drawList();
  return wrap;
}


function cleanupRulesDangling() {
  const qids = new Set(allQuestions().map(({ q }) => q.id));

  state.survey.rules = (state.survey.rules || []).filter((r) => {
    const tq = r?.trigger?.questionId;
    const eq = r?.trigger?.equals;
    if (!tq || !eq) return false;
    if (!qids.has(tq)) return false;

    if (r.action === "DEACTIVATE_QUESTIONS_IN_G2") {
      const targets = Array.isArray(r.targetQuestionIds) ? r.targetQuestionIds : [];
      const kept = targets.filter(id => qids.has(id));
      r.targetQuestionIds = kept; // 정리
      return kept.length > 0;      // 대상이 없으면 룰 삭제
    }

    // 옛 룰은 제거(원하면 아래에서 변환 처리)
    return false;
  });
}


// ------------------ Simulator ------------------
function ensureSimAnswer(q) {
  const id = q.id;
  state.sim.answers[id] = state.sim.answers[id] || {};
  const ans = state.sim.answers[id];

  const mode = q.answerSpec?.mode || "YES_NO";

  // YES_NO only: keep norm; TEXT_MULTI: norm not required
  if (mode === "YES_NO") {
    if (ans.norm !== "YES" && ans.norm !== "NO") ans.norm = "NO";
  } else {
    // TEXT_MULTI
    if (ans.norm !== undefined) delete ans.norm;
  }

  // ✅ Set 형태 보정 (기존 JSON/객체 로딩 시 Array로 들어올 수 있음)
  if (!ans.checks) ans.checks = new Set();
  if (Array.isArray(ans.checks)) ans.checks = new Set(ans.checks);
  if (ans.checks && typeof ans.checks === "object" && !(ans.checks instanceof Set) && Array.isArray(ans.checks.values)) {
    ans.checks = new Set(ans.checks.values);
  }

  if (!ans.checkReject) ans.checkReject = new Set();
  if (Array.isArray(ans.checkReject)) ans.checkReject = new Set(ans.checkReject);

  if (!ans.fields) ans.fields = {};
  if (typeof ans.fields !== "object") ans.fields = {};

  if (ans.text === undefined) ans.text = "";
  if (ans.manualEnabled === undefined) ans.manualEnabled = false;
  if (ans.manualReject === undefined) ans.manualReject = false;
  if (ans.manualScore === undefined) ans.manualScore = 0;

  return ans;
}

function serializeSimAnswers() {
  const out = {};
  for (const [qid, a] of Object.entries(state.sim.answers)) {
    out[qid] = {
      norm: a.norm,
      checks: Array.from(a.checks || []),
      checkReject: Array.from(a.checkReject || []),
      text: a.text || "",
      fields: a.fields || {},
      fieldReject: Array.from(a.fieldReject || []),
      manualEnabled: !!a.manualEnabled,
      manualReject: !!a.manualReject,
      manualScore: a.manualScore ?? 0
    };
  }
  return out;
}

// ===== Rule helpers (트리거는 항상 배점 제외, 룰 발동 시 target 문항 비활성) =====
function getTriggerQuestionIdSet() {
  const set = new Set();
  for (const r of state.survey.rules || []) {
    const qid = r?.trigger?.questionId;
    if (qid) set.add(qid);
  }
  return set;
}

function isTriggerQuestionId(qid) {
  if (!qid) return false;
  for (const r of state.survey.rules || []) {
    if (r?.trigger?.questionId === qid) return true;
  }
  return false;
}

// 룰 발동 결과(현재 시뮬 answers 기준)
function computeRuleEffectsFromSimAnswers() {
  const triggerAll = getTriggerQuestionIdSet(); // ✅ 트리거 문항은 항상 배점 제외(조건 무관)
  const disabled = new Set();                   // ✅ 룰 발동 시 비활성(0점) 문항들

  for (const r of state.survey.rules || []) {
    const action = r?.action;
    if (action !== "DEACTIVATE_QUESTIONS_IN_G2") continue;

    const qid = r?.trigger?.questionId;
    let eq  = r?.trigger?.equals; if (eq==="NA") eq="NO";
    if (!qid || !eq) continue;

    const actual = state.sim.answers[qid]?.norm; // YES/NO
    if (actual !== eq) continue;                 // ✅ 조건 일치할 때만 발동

    const targets = Array.isArray(r.targetQuestionIds) ? r.targetQuestionIds : [];
    for (const t of targets) disabled.add(t);
  }

  return { triggerAll, disabled };
}

// 구분2 내부에서 "활성 문항" 리스트 반환 (배점 재배분 대상)
function getActiveQuestionsInG2(g2, effects) {
  const { triggerAll, disabled } = effects;
  return (g2.questions || []).filter(q => q && q.scoreEnabled !== false && !triggerAll.has(q.id) && !disabled.has(q.id));
}

// 구분2 내부 재배점 기준으로 qMax 계산 (트리거/비활성=0)
function calcQuestionMaxInG2Active(g2, q, effects) {
  ensureG2Scoring(g2);

  const { triggerAll, disabled } = effects;
  const qid = q?.id;
  if (!qid) return 0;
  if (q.scoreEnabled === false) return 0;
  if (triggerAll.has(qid)) return 0; // 트리거는 항상 배점 제외
  if (disabled.has(qid)) return 0;   // 룰로 비활성은 0점

  const activeQs = getActiveQuestionsInG2(g2, effects);
  const n = activeQs.length;
  if (n === 0) return 0;

  const alloc = (g2.scoring.questionAllocation || "EQUAL");

  // EQUAL: 활성 문항 기준 100/n
  if (alloc !== "MANUAL") return 100 / n;

  // MANUAL: 활성 문항 points 비율로 100 정규화 (sum=0이면 EQUAL fallback)
  const sum = activeQs.reduce((a, qq) => a + Number(qq.points || 0), 0);
  if (sum <= 0) return 100 / n;

  const my = Number(q.points || 0);
  return (my / sum) * 100;
}

function computeScoreFromSim() {
  const effects = computeRuleEffectsFromSimAnswers();
  const { triggerAll, disabled } = effects;

  // 1) score per question
  const qScore = new Map();
  const g2Raw = new Map();

  for (const { g1, g2 } of allG2()) {
    g2Raw.set(g2.id, 0);
  }

  for (const { g2, q } of allQuestions()) {
    ensureQuestionSpec(q);
    const ans = ensureSimAnswer(q);
    const mode = q.answerSpec?.mode || "YES_NO";

    const qMax = calcQuestionMaxInG2Active(g2, q, effects);
if (q.scoreEnabled === false) {
  qScore.set(q.id, { raw: 0, used: 0, reason: "EXCLUDED: score disabled", qMax: 0 });
  continue;
}
    // 트리거/비활성은 무조건 0점
    if (triggerAll.has(q.id)) {
      qScore.set(q.id, { raw: 0, used: 0, reason: "TRIGGER: always excluded from scoring", qMax: 0 });
      continue;
    }
    if (disabled.has(q.id)) {
      qScore.set(q.id, { raw: 0, used: 0, reason: "DISABLED: deactivated by rule", qMax: 0 });
      continue;
    }

    let auto = 0;
    let reason = "";

    if (mode === "YES_NO") {
      if (ans.norm !== "YES") {
        auto = 0;
        reason = `YES가 아니면 0점`;
      } else {
        const items = Array.isArray(q.answerSpec?.items) ? q.answerSpec.items : [];
        const textTrigger = (q.answerSpec?.textTrigger === "NO") ? "NO" : "YES";

        // ✅ YES에서만 채점
        // - CHECK: 체크 여부로 만족
        // - CHECK(withText): "체크 + 주관식" → 체크 + 해당 주관식(비어있지 않음) 둘 다 만족해야 1개로 카운트
        // - TEXT(legacy): textTrigger===YES일 때만 단독 주관식으로 카운트
        const checkItems = items.filter(it => it && it.kind === "CHECK");
        const textItems  = items.filter(it => it && it.kind === "TEXT" && textTrigger === "YES");

        const m = checkItems.length + textItems.length;
        if (m === 0) {
          auto = qMax;
          reason = `YES_NO(항목 없음) → ${qMax.toFixed(2)}점`;
        } else {
          const checks = ans.checks ? Array.from(ans.checks) : [];
          const fields = ans.fields || {};

          let k = 0;
          // CHECK 만족
          checkItems.forEach((it, idx) => {
            const checked = checks.includes(idx);
            if (!checked) return;
            // CHECK+주관식: 체크 + 텍스트 입력 둘 다 있어야 1개 인정
            if (it.withText) {
              const key = String(it.label || "");
              if ((fields[key] || "").trim().length > 0) k += 1;
            } else {
              k += 1;
            }
          });

          // TEXT(legacy) 만족(비어있지 않음)
          const kText = textItems.filter(it => {
            const key = String(it.label || "");
            return (fields[key] || "").trim().length > 0;
          }).length;
          k += kText;

          auto = qMax * (k / m);
          reason = `YES_NO 만족 ${k}/${m} → ${qMax.toFixed(2)}×(${k}/${m})`;
        }
      }
    } else if (mode === "TEXT_MULTI") {
      const items = Array.isArray(q.answerSpec?.items) ? q.answerSpec.items : [];
      const texts = items.filter(it => it && it.kind === "TEXT");
      const m = texts.length;
      const fields = ans.fields || {};
      if (m === 0) {
        auto = 0;
        reason = `TEXT_MULTI(필드 없음) → 0점`;
      } else {
        const k = texts.filter(it => (fields[it.label||""] || "").trim().length > 0).length;
        auto = qMax * (k / m);
        reason = `TEXT_MULTI 입력 ${k}/${m} → ${qMax.toFixed(2)}×(${k}/${m})`;
      }
    } else {
      auto = 0;
      reason = `알 수 없는 모드 → 0점`;
    }

    let used = auto;
    let usedReason = `AUTO: ${reason}`;

    // 수동점수는 "활성 문항"에만 적용
    if (ans.manualEnabled) {
      if (ans.manualReject) {
        used = 0;
        usedReason = "MANUAL: 미인정(강제 0점)";
      } else {
        used = clamp(Number(ans.manualScore || 0), 0, qMax);
        usedReason = `MANUAL: ${used.toFixed(2)}점(0~${qMax.toFixed(2)})`;
      }
    }

    qScore.set(q.id, { raw: auto, used, reason: usedReason, qMax });
    g2Raw.set(g2.id, (g2Raw.get(g2.id) || 0) + used);
  }

  // 2) normalize weights within each g1 among active g2 (구분2는 전부 활성)
  const g1Scores = new Map();
  const g1Details = new Map();

  for (const g1 of allG1()) {
    const activeG2s = g1.groups2 || [];
    const sumW2 = activeG2s.reduce((a, g2) => a + Number(g2.weight2 || 0), 0);

    g1Details.set(g1.id, { weight1: Number(g1.weight1 || 0), name: g1.name, sumActiveW2: sumW2, norms: new Map() });

    let g1Score = 0;
    for (const g2 of activeG2s) {
      const raw100 = clamp(g2Raw.get(g2.id) || 0, 0, 100); // g2 내부는 이미 100 기준으로 재배점됨
      const w2 = Number(g2.weight2 || 0);
      const normW2 = sumW2 > 0 ? (w2 / sumW2) * 100 : 0;
      g1Details.get(g1.id).norms.set(g2.id, normW2);
      g1Score += (raw100 / 100) * normW2;
    }
    g1Scores.set(g1.id, g1Score);
  }

  // 3) apply weight1 to overall 100
  // NOTE: 일부 설문은 weight1 합계가 100이 아닐 수 있으므로(예: 합계=2),
  //       총점은 항상 0~100 스케일로 정규화합니다.
  const sumW1 = allG1().reduce((a, g1) => a + Number(g1.weight1 || 0), 0);

  let totalScoreRaw = 0;
  for (const g1 of allG1()) {
    const g1Score = g1Scores.get(g1.id) || 0; // 0~100
    const w1 = Number(g1.weight1 || 0);
    totalScoreRaw += (g1Score / 100) * w1;
  }

  const totalScore = sumW1 > 0 ? (totalScoreRaw / sumW1) * 100 : 0;

  const result = {
    totalScore,
    totalScoreRaw,
    rules: state.survey.rules || [],
    excluded: {
      triggerQuestions: Array.from(triggerAll),
      disabledQuestions: Array.from(disabled)
    },
    g1: []
  };

  for (const g1 of allG1()) {
    const det = g1Details.get(g1.id);
    const g1Score = g1Scores.get(g1.id) || 0;

    const g2Rows = (g1.groups2 || []).map((g2) => {
      const raw100 = clamp(g2Raw.get(g2.id) || 0, 0, 100);
      const w2 = Number(g2.weight2 || 0);
      const normW2 = det.sumActiveW2 > 0 ? (det.norms.get(g2.id) || 0) : 0;
      return {
        g2id: g2.id,
        name: g2.name,
        active: true,
        weight2: w2,
        normWeight2: normW2,
        score100: raw100
      };
    });

    result.g1.push({
      g1id: g1.id,
      name: g1.name,
      weight1: Number(g1.weight1 || 0),
      score100: g1Score,
      sumActiveW2: det.sumActiveW2,
      g2: g2Rows
    });
  }

  result.qScore = Array.from(qScore.entries()).map(([qid, v]) => ({ qid, ...v }));
  return result;
}

function renderScoringSimulatorCard(filterG1 = null, filterG2 = null) {
  const wrap = document.createElement("div");
  wrap.className = "card";

  const qsAll = allQuestions();
  if (qsAll.length === 0) {
    wrap.innerHTML = `
      <b>채점 시뮬레이터</b>
      <div class="hint" style="margin-top:6px;">문항이 있어야 시뮬레이션이 가능합니다.</div>
    `;
    return wrap;
  }

  let qs = qsAll;
  let scopeText = "설문 전체";
  if (filterG1 && filterG2) {
    qs = qsAll.filter((x) => x.g2.id === filterG2.id);
    scopeText = `${filterG1.name} / ${filterG2.name}`;
  } else if (filterG1) {
    qs = qsAll.filter((x) => x.g1.id === filterG1.id);
    scopeText = `${filterG1.name}`;
  }

  wrap.innerHTML = `
    <b>채점 시뮬레이터</b>
    <div class="hint" style="margin-top:6px;">범위: ${escapeHtml(scopeText)} · 룰 적용 + 구분2 내부 배점 재분배(정규화) · 총점 100점</div>

    <div style="margin-top:10px; padding:10px; border:1px solid rgba(255,255,255,.12); border-radius:12px;">
      <div class="hint"><b>시뮬레이션 입력</b></div>
      <div style="margin-top:8px;">
        피평가 회사명(옵션)
        <input id="sim_company" placeholder="예: OO정밀" style="width:60%;" value="${escapeAttr(state.sim.company || "")}">
        <button class="btn" id="sim_reset" style="margin-left:8px; padding:4px 10px;">응답 초기화</button>
      </div>
      <div class="hint" style="margin-top:6px;">TEXT/주관식은 기본 자동점수 0점이며, “수동점수”로 반영할 수 있습니다.</div>
    </div>

    <div id="sim_form" style="margin-top:12px;"></div>

    <div style="margin-top:12px; padding:10px; border:1px solid rgba(255,255,255,.12); border-radius:12px;">
<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
  <button class="btn" id="sim_calc">점수 계산</button>
  <button class="btn" id="sim_export_json">시뮬 응답 JSON(내부확인용) 내보내기</button>
  ${state.sim.responseRid ? `<button class="btn" id="sim_save" style="border-color:rgba(255,255,255,.25)">저장(서버 반영)</button>` : ""}
</div>
      <div id="sim_result" style="margin-top:10px;"></div>
    </div>
  `;

  wrap.querySelector("#sim_company").oninput = (e) => (state.sim.company = e.target.value);
  wrap.querySelector("#sim_reset").onclick = () => {
    if (!confirm("시뮬레이터 응답을 초기화할까요?")) return;
    state.sim.answers = {};
    render();
  };

  const form = wrap.querySelector("#sim_form");
  const effects = computeRuleEffectsFromSimAnswers();

  qs.forEach(({ g1, g2, q }) => {
    ensureQuestionSpec(q);
    const ans = ensureSimAnswer(q);
    const mode = q.answerSpec?.mode || "YES_NO";

    const isTriggerExcluded = effects.triggerAll.has(q.id); // ✅ 항상 배점 제외
    const isDisabledByRule  = effects.disabled.has(q.id);   // ✅ 룰 발동 시 비활성(0점)
    const qMax = calcQuestionMaxInG2Active(g2, q, effects); // ✅ 재배점 반영된 최대점

    const block = document.createElement("div");
    block.style.padding = "10px";
    block.style.border = "1px solid rgba(255,255,255,.12)";
    block.style.borderRadius = "12px";
    block.style.marginTop = "10px";

    block.innerHTML = `
      <div><b>${escapeHtml(g1.name)} / ${escapeHtml(g2.name)}</b> <span class="hint">(문항 최대 ${qMax.toFixed(2)}점)</span></div>
      <div style="margin-top:6px;"><b>Q.</b> ${escapeHtml(q.text)} ${q.required ? `<span class="hint">[필수]</span>` : ``}</div>
      <div class="hint" style="margin-top:4px;">모드: ${escapeHtml(mode)} · 내부정규화: YES/NO/NA</div>

      <div id="sim_controls_${q.id}" style="margin-top:10px;"></div>

      <div style="margin-top:10px; padding-top:10px; border-top:1px dashed rgba(255,255,255,.12);">
        <label style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <input type="checkbox" id="sim_manual_${q.id}" ${ans.manualEnabled ? "checked" : ""}>
          <span><b>수동점수 사용</b></span>
          <span class="hint">(주관식 검증/미인정 처리용)</span>
        </label>
        <div id="sim_manual_panel_${q.id}" style="margin-top:8px; display:${ans.manualEnabled ? "" : "none"};"></div>
      </div>
    `;

    form.appendChild(block);

    const controls    = block.querySelector(`#sim_controls_${q.id}`);
    const cbManual    = block.querySelector(`#sim_manual_${q.id}`);
    const manualPanel = block.querySelector(`#sim_manual_panel_${q.id}`);

    // ---- 비활성화 처리 ----
    if (isDisabledByRule) {
      controls.innerHTML = `<div class="hint">룰 발동으로 이 문항은 비활성화(0점) 되었습니다.</div>`;
      if (cbManual) {
        cbManual.checked = false;
        cbManual.disabled = true;
      }
      if (manualPanel) {
        manualPanel.style.display = "none";
        manualPanel.innerHTML = "";
      }
      return; // ✅ 비활성 문항은 여기서 끝
    }

    // ---- 트리거 문항 안내(컨트롤 유지, 배점 제외) ----
    if (isTriggerExcluded) {
      controls.insertAdjacentHTML(
        "afterbegin",
        `<div class="hint" style="margin-bottom:8px;">[트리거 문항] 응답은 룰 판정에 사용되며, 점수에서는 항상 제외됩니다(0점).</div>`
      );
      if (cbManual) {
        cbManual.checked = false;
        cbManual.disabled = true; // 트리거는 점수에 영향 없으니 수동점수 막음
      }
      if (manualPanel) {
        manualPanel.style.display = "none";
        manualPanel.innerHTML = "";
      }
    }

    // ✅ 활성/트리거(컨트롤은 필요) 컨트롤 렌더
    renderSimControls(controls, q, ans);

// ---- 수동점수 패널 ----
const drawManual = () => {
  if (!cbManual) return;

  manualPanel.style.display = ans.manualEnabled ? "" : "none";
  if (!ans.manualEnabled) {
    manualPanel.innerHTML = "";
    return;
  }

  manualPanel.innerHTML = `
    <div class="hint">※ 수동점수는 이 문항의 자동점수를 덮어씁니다. (0 ~ ${qMax.toFixed(2)}점)</div>
    <div style="margin-top:6px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <div>
        점수
        <input type="number" id="ms_${q.id}" value="${Number(ans.manualScore || 0)}"
               min="0" max="${qMax}" step="0.01" style="width:120px;">
      </div>

      <label style="display:flex; align-items:center; gap:6px;">
        <input type="checkbox" id="mr_${q.id}" ${ans.manualReject ? "checked" : ""}>
        <span><b>미인정(강제 0점)</b></span>
      </label>
    </div>
  `;

  const inp = manualPanel.querySelector(`#ms_${CSS.escape(q.id)}`);
  const rej = manualPanel.querySelector(`#mr_${CSS.escape(q.id)}`);

  if (inp) {
    inp.oninput = () => {
      ans.manualScore = Number(inp.value || 0);
    };
  }
  if (rej) {
    rej.onchange = () => {
      ans.manualReject = !!rej.checked;
      // 미인정이면 점수 입력칸 비활성화(선택)
      if (inp) inp.disabled = ans.manualReject;
    };
    // 초기 반영
    if (inp) inp.disabled = !!ans.manualReject;
  }
};

// 수동점수 체크박스 바인딩
if (cbManual) {
  cbManual.onchange = () => {
    ans.manualEnabled = !!cbManual.checked;
    if (!ans.manualEnabled) {
      ans.manualReject = false;
      ans.manualScore = 0;
    }
    drawManual();
  };
}

	// 최초 1회 렌더
	drawManual();
	}); // ✅ qs.forEach 끝 (닫는 괄호/세미콜론 누락으로 SyntaxError 발생)

	  wrap.querySelector("#sim_calc").onclick = () => {
    const result = computeScoreFromSim();
    wrap.querySelector("#sim_result").innerHTML = renderScoreResultHtml(result);
  };

  wrap.querySelector("#sim_export_json").onclick = () => {
    const payload = { company: state.sim.company || "", answers: serializeSimAnswers() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${sanitizeFilename(state.survey.title || "survey")}_SIM_${sanitizeFilename(state.sim.company || "company")}.json`;
    a.click();
  };
const btnSave = wrap.querySelector("#sim_save");
if (btnSave) {
  btnSave.onclick = async () => {
    const rid = state.sim.responseRid;
    if (!rid) return;

    try {
      const result = computeScoreFromSim();
      const totalScore = Number(result?.totalScore ?? 0);

      const newSubmitted = {
        ...(state.sim.originalSubmitted || {}),
        answers: serializeSimAnswers(),
        score: totalScore
      };

      const { error } = await sb
        .from("responses")
        .update({
          submitted_json: newSubmitted,
          score: totalScore
        })
        .eq("id", rid);

      if (error) throw error;

      alert("저장 완료 (서버 반영됨)");
    } catch (e) {
      console.error(e);
      alert("저장 실패: " + (e?.message || e));
    }
  };
}

  return wrap;
}

function renderSimControls(container, q, ans) {
  const as = q.answerSpec || {};
  const mode = as.mode || "YES_NO";

  const yesLabel = as.yesLabel || "예";
  const noLabel  = as.noLabel  || "아니오";
  const textTrigger = (as.textTrigger === "NO") ? "NO" : "YES";
  const items = Array.isArray(as.items) ? as.items : [];

  const checkItems = items.filter(it => it && it.kind === "CHECK");
  const textItems  = items.filter(it => it && it.kind === "TEXT"); // legacy 단독 주관식(YES/NO 트리거)

  const setNorm = (v) => { ans.norm = v; render(); };
  const setCheck = (idx, on) => {
    if (!ans.checks) ans.checks = new Set();
    if (on) ans.checks.add(idx); else ans.checks.delete(idx);
    render();
  };
  const setField = (k, v) => {
    if (!ans.fields) ans.fields = {};
    ans.fields[k] = v;
  };

  // helpers
  const radioHtml = (name, items) =>
    items.map(({ value, label }) => `
      <label style="margin-right:12px; display:inline-flex; align-items:center; gap:6px;">
        <input type="radio" name="${name}" value="${escapeAttr(value)}" ${ans.norm === value ? "checked" : ""}>
        <span>${escapeHtml(label)}</span>
      </label>
    `).join("");

  // Mode: TEXT_MULTI (no YES/NO)
  if (mode === "TEXT_MULTI") {
    if (!ans.fields) ans.fields = {};
    container.innerHTML = `
      <div class="hint">주관식 입력</div>
      <div style="margin-top:8px;">
        ${textItems.map((it) => `
          <div style="margin-top:8px;">
            <div class="hint" style="margin-bottom:4px;">${escapeHtml(it.label || "주관식")}</div>
            <input class="input" data-k="f_${escapeAttr(it.label||"")}" placeholder="${escapeAttr(it.placeholder||"")}" value="${escapeAttr(ans.fields[it.label||""] || "")}">
          </div>
        `).join("")}
      </div>
    `;
    container.querySelectorAll(`input[data-k^="f_"]`).forEach((inp) => {
      const key = inp.getAttribute("data-k").slice(2);
      inp.oninput = (e) => setField(key, e.target.value);
    });
    return;
  }

  // Mode: YES_NO (base)
  if (ans.norm !== "YES" && ans.norm !== "NO") ans.norm = "NO";

  container.innerHTML = `
    <div>${radioHtml(`norm_${q.id}`, [
      { value: "YES", label: yesLabel },
      { value: "NO",  label: noLabel }
    ])}</div>

    ${ (ans.norm === "YES" && checkItems.length) ? `
      <div class="hint" style="margin-top:10px;">체크 항목</div>
      <div style="margin-top:6px;">
        ${checkItems.map((it, i) => {
          const checked = ans.checks && ans.checks.has(i);
          const hasText = !!it.withText;
          const key = String(it.label || "");
          const ph = escapeAttr(it.placeholder || "");
          const v  = escapeAttr(((ans.fields||{})[key] || ""));
          return `
            <div style="margin:6px 0;">
              <label style="display:flex; align-items:center; gap:8px;">
                <input type="checkbox" data-k="c_${i}" ${checked ? "checked" : ""}>
                <span>${escapeHtml(it.label || ("옵션"+(i+1)))}</span>
                ${hasText ? `<span class="pill">체크+주관식</span>` : ``}
              </label>
              ${hasText ? `
                <div style="margin-left:22px; margin-top:6px;">
                  <input class="input" data-k="ft_${escapeAttr(key)}" placeholder="${ph}" value="${v}" ${checked ? "" : "disabled"}>
                  <div class="hint" style="margin-top:4px;">※ 체크한 경우에만 주관식 입력이 활성화됩니다.</div>
                </div>
              ` : ``}
            </div>
          `;
        }).join("")}
      </div>
    ` : ""}

    ${ (ans.norm === textTrigger && textItems.length) ? `
      <div class="hint" style="margin-top:10px;">주관식</div>
      <div style="margin-top:6px;">
        ${textItems.map((it) => `
          <div style="margin-top:8px;">
            <div class="hint" style="margin-bottom:4px;">${escapeHtml(it.label || "주관식")}</div>
            <input class="input" data-k="f_${escapeAttr(it.label||"")}" placeholder="${escapeAttr(it.placeholder||"")}" value="${escapeAttr((ans.fields||{})[it.label||""] || "")}">
          </div>
        `).join("")}
      </div>
    ` : ""}
  `;

  container.querySelectorAll(`input[name="norm_${q.id}"]`).forEach((r) => r.onchange = (e) => setNorm(e.target.value));
  container.querySelectorAll(`input[data-k^="c_"]`).forEach((cb) => {
    const idx = Number(cb.getAttribute("data-k").slice(2));
    cb.onchange = (e) => setCheck(idx, e.target.checked);
  });
  container.querySelectorAll(`input[data-k^="ft_"]`).forEach((inp) => {
    const key = inp.getAttribute("data-k").slice(3);
    inp.oninput = (e) => setField(key, e.target.value);
  });
  container.querySelectorAll(`input[data-k^="f_"]`).forEach((inp) => {
    const key = inp.getAttribute("data-k").slice(2);
    inp.oninput = (e) => setField(key, e.target.value);
  });
}

function renderScoreResultHtml(result) {
  const lines = [];

  lines.push(`<div><b>총점:</b> ${result.totalScore.toFixed(2)} / 100</div>`);

  lines.push(`
    <div class="hint" style="margin-top:6px;">
      트리거 제외 문항: ${result.excluded.triggerQuestions.length}개 · 룰 비활성 문항: ${result.excluded.disabledQuestions.length}개
    </div>
  `);

  lines.push(`<div style="margin-top:10px;">`);
  result.g1.forEach((g1) => {
    lines.push(`
      <div style="margin-top:10px; padding:10px; border:1px solid rgba(255,255,255,.12); border-radius:12px;">
        <div><b>${escapeHtml(g1.name)}</b> <span class="hint">(w1 ${g1.weight1}%, 점수 ${g1.score100.toFixed(2)}/100 → ${(g1.score100 / 100 * g1.weight1).toFixed(2)}점)</span></div>
        <div class="hint" style="margin-top:4px;">활성 구분2 가중치 합: ${g1.sumActiveW2.toFixed(2)}%</div>
        <div style="margin-top:8px;">
          ${g1.g2.map((g2) => `
            <div style="padding:4px 0;">
              • <b>${escapeHtml(g2.name)}</b>
              <span class="hint"> (w2 ${g2.weight2}%, 정규화 ${g2.normWeight2.toFixed(2)}%, 점수 ${g2.score100.toFixed(2)}/100)</span>
            </div>
          `).join("")}
        </div>
      </div>
    `);
  });
  lines.push(`</div>`);

  if (result.rules && result.rules.length) {
    lines.push(`<div style="margin-top:10px;"><b>등록 룰</b></div>`);
    lines.push(result.rules.map((r, i) => `
      <div class="hint">
        - #${i + 1} IF ${escapeHtml(r.trigger?.questionId || "")} == ${escapeHtml(r.trigger?.equals || "")}
        THEN ${escapeHtml(r.action || "")} → targets ${Array.isArray(r.targetQuestionIds) ? r.targetQuestionIds.length : 0}개
      </div>
    `).join(""));
  } else {
    lines.push(`<div style="margin-top:10px;" class="hint">등록 룰 없음</div>`);
  }

  return lines.join("");
}

// ------------------ Bindings (topbar/left buttons) ------------------
function bindTop() {
  const surveyTitle = $("surveyTitle");
  const surveyVersion = $("surveyVersion");
  const btnNew = $("btnNew");
  const addG1Btn = $("addG1");
  const btnValidate = $("btnValidate");
  const btnExport = $("btnExport");
  const fileImport = $("fileImport");
  const fileImportXls = $("fileImportXls");
  const btnExportXls = $("btnExportXls");
  const btnSaveServer = $("btnSaveServer");
  const btnExpand = $("btnExpand");
  const addRule = $("addRule");
  const btnLogout = $("btnLogout");

  if (surveyTitle) surveyTitle.addEventListener("input", (e) => (state.survey.title = e.target.value));
  if (surveyVersion) surveyVersion.addEventListener("input", (e) => (state.survey.version = e.target.value));

  // ✅ 로그아웃
  if (btnLogout) btnLogout.onclick = async () => {
    try {
      await sb.auth.signOut();
    } catch (e) {
      console.error(e);
    }
    // 화면 잠금/로그인 모달 재표시
    hideAdminBlock?.();
    setAuthMode("login");
    openAuthModal();
    showAuthError("로그아웃 되었습니다.");
  };


  if (btnNew) btnNew.onclick = () => {
    if (!confirm("새 설문을 시작할까요? (현재 작업 내용은 사라집니다)")) return;
    state.survey = defaultSurvey();
    state.selected = null;
    state.ui = { collapsedQ: {}, focusQId: null, drag: { fromIdx: null }, treeDrag: null, ruleEditId: null, treeCollapsed: { g1: {}, g2: {} }, viewMode: "edit" };
    state.sim = { answers: {}, company: "" };
    state.server = { id: null, code: null };
    render();
  };

  // ✅ 서버(Supabase) 저장
  if (btnSaveServer) btnSaveServer.onclick = () => saveSurveyToServer();

if (addG1Btn) addG1Btn.onclick = () => {
  // ✅ EXE 환경에서 prompt()가 막힐 수 있으므로, 팝업 없이 즉시 생성 → 우측 편집창에서 바로 수정
  const newG1 = {
    id: uid("g1"),
    name: "새 구분1",
    weight1: 25,
    groups2: []
  };

  state.survey.groups1.push(newG1);

  // 생성된 구분1을 바로 선택해서 "구분1 편집" 카드가 보이게 함
  state.selected = { kind: "g1", id: newG1.id };
  state.ui.focusQId = null;

  render();

  // 렌더 후 포커스(UX)
  setTimeout(() => {
    const inp = document.getElementById("g1_name");
    if (inp) {
      inp.focus();
      inp.select();
    }
  }, 0);
};


  // optional legacy buttons
  const addG2Btn = document.getElementById("addG2");
  if (addG2Btn) addG2Btn.onclick = () => alert("구분2 추가는 오른쪽 편집 화면에서 진행하세요. (구분1을 선택하세요)");
  const addQBtn = document.getElementById("addQ");
  if (addQBtn) addQBtn.onclick = () => alert("문항 추가는 오른쪽 편집 화면에서 진행하세요. (구분2를 선택하세요)");
  const delBtn = document.getElementById("btnDelete");
  if (delBtn) delBtn.onclick = () => alert("삭제는 오른쪽 편집 화면에서 진행하세요.");

  if (btnValidate) btnValidate.onclick = () => {
    const msgs = [];
    const sumW1 = state.survey.groups1.reduce((a, x) => a + Number(x.weight1 || 0), 0);
    if (Math.abs(sumW1 - 100) > 1e-6) msgs.push(`가중치1 합계: ${sumW1.toFixed(2)}% (기대: 100%)`);

    for (const g1 of state.survey.groups1) {
      const sumW2 = (g1.groups2 || []).reduce((a, x) => a + Number(x.weight2 || 0), 0);
      if ((g1.groups2 || []).length && Math.abs(sumW2 - 100) > 1e-6) {
        msgs.push(`[${g1.name}] 가중치2 합계: ${sumW2.toFixed(2)}% (기대: 100%)`);
      }
    }

    // per-question manual points validation
    for (const { g1, g2 } of allG2()) {
      ensureG2Scoring(g2);
      if ((g2.scoring.questionAllocation || "EQUAL") === "MANUAL") {
        const sumP = (g2.questions || []).reduce((a, q) => a + Number(q.points || 0), 0);
        if (Math.abs(sumP - 100) > 1e-6) msgs.push(`[${g1.name} > ${g2.name}] 문항 배점 합계: ${sumP.toFixed(2)}점 (기대: 100점)`);
      }
    }

    alert(msgs.length ? msgs.join("\n") : "OK: 가중치 합계가 모두 100% 입니다.");
  };

  if (btnExport) btnExport.onclick = () => {
    if (!state.survey.schemaVersion) state.survey.schemaVersion = SCHEMA_VERSION;
    if (!state.survey.scoring) {
      state.survey.scoring = {
        redistribution: "WEIGHTED_NORMALIZE_WITHIN_G1",
        questionAllocation: "EQUAL_1_OVER_N_WITHIN_G2"
      };
    }
    const data = JSON.stringify(state.survey, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${sanitizeFilename(state.survey.title || "survey")}_${state.survey.version || "v1"}.json`;
    a.click();
  };


// ✅ Excel(.xls XML) export
if (btnExportXls) btnExportXls.onclick = () => {
  try {
    exportSurveyAsExcelXml();
  } catch (err) {
    alert("엑셀 내보내기 실패: " + (err?.message || err));
  }
};

// ✅ Excel(.xls XML) import
if (fileImportXls) fileImportXls.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const txt = await f.text();
    importSurveyFromExcelXml(txt);
  } catch (err) {
    alert("엑셀 불러오기 실패: " + (err?.message || err));
  }
  e.target.value = "";
});


  if (fileImport) fileImport.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      if (!obj.groups1) throw new Error("groups1 missing");

      if (!obj.schemaVersion) obj.schemaVersion = 1;
      if (!obj.scoring) {
        obj.scoring = {
          redistribution: "WEIGHTED_NORMALIZE_WITHIN_G1",
          questionAllocation: "EQUAL_1_OVER_N_WITHIN_G2"
        };
      }

      // 룰 스키마 구버전 호환(가능한 경우만 변환)
      if (obj.rules && obj.rules.length) {
        obj.rules = obj.rules.map((r) => {
          // legacy: {trigger_question_id, when_value, action, target_ids:[qid...]}
          if (r.trigger_question_id) {
            return {
              id: r.id || uid("rule"),
              trigger: { questionId: r.trigger_question_id, equals: (String(r.when_value || "NO").trim()==="NA" ? "NO" : String(r.when_value || "NO").trim()) },
              action: "DEACTIVATE_QUESTIONS_IN_G2",
              targetQuestionIds: Array.isArray(r.target_ids) ? r.target_ids : []
            };
          }
          // already new
          return r;
        });
      } else {
        obj.rules = obj.rules || [];
      }

      // ensure question arrays exist
      obj.groups1.forEach((g1) => {
        g1.groups2 = g1.groups2 || [];
        g1.groups2.forEach((g2) => {
          ensureG2Scoring(g2);
          g2.questions = g2.questions || [];
          g2.questions.forEach((q) => ensureQuestionSpec(q));
        });
      });

      state.survey = obj;
      cleanupRulesDangling();
      state.selected = null;
      state.ui = { collapsedQ: {}, focusQId: null, drag: { fromIdx: null }, treeDrag: null, ruleEditId: null, treeCollapsed: { g1: {}, g2: {} }, viewMode: "edit" };
      render();
    } catch (err) {
      alert("불러오기 실패: " + err.message);
    }
    e.target.value = "";
  });

if (btnExpand) btnExpand.onclick = () => {
  // ✅ 현재 접힘이 하나라도 있으면(=true) -> 전체 펼치기(=false)
  const anyCollapsed =
    Object.values(state.ui.treeCollapsed.g1).some(v => v === true) ||
    Object.values(state.ui.treeCollapsed.g2).some(v => v === true);

  if (anyCollapsed) {
    // 전체 펼치기
    for (const g1 of state.survey.groups1) {
      state.ui.treeCollapsed.g1[g1.id] = false;
      for (const g2 of (g1.groups2 || [])) state.ui.treeCollapsed.g2[g2.id] = false;
    }
  } else {
    // 전체 접기
    for (const g1 of state.survey.groups1) {
      state.ui.treeCollapsed.g1[g1.id] = true;
      for (const g2 of (g1.groups2 || [])) state.ui.treeCollapsed.g2[g2.id] = true;
    }
  }
renderTree();
};


  if (addRule) addRule.onclick = () => {
    alert("룰 추가는 오른쪽 ‘분기 룰(비활성화) 설정’ 카드에서 진행하세요. (설문(전체)로 이동하면 보입니다)");
  };
}

// ------------------ Supabase: 설문 서버 저장 ------------------
function genSurveyCode(len = 8) {
  // 충돌 가능성을 낮추기 위해 base36을 2번 섞음
  const raw = (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).toLowerCase();
  return raw.replace(/[^a-z0-9]/g, "").slice(0, len);
}

async function getMyProfile() {
  const session = await requireLoginOrModal();
  const uid = session?.user?.id;
  if (!uid) throw new Error("로그인이 필요합니다.");

  let { data, error } = await sb.from("profiles").select("user_id, role, name").eq("user_id", uid).maybeSingle();
  if (error) throw error;

  // 첫 로그인인데 profiles가 없으면 자동 생성(기본 role=user)
  if (!data) {
    const ins = await sb.from("profiles").insert({ user_id: uid, role: "user" }).select("user_id, role").maybeSingle();
    if (ins.error) throw ins.error;
    data = ins.data;
  }
  return data;
}

async function saveSurveyToServer() {
  // 1) 로그인/권한 체크
  const session = await requireLoginOrModal();
  const profile = await getMyProfile();
  if (profile.role !== "admin") {
    throw new Error("이 계정은 admin 권한이 아닙니다. (profiles.role을 admin으로 바꾼 뒤 다시 시도하세요)");
  }

  // 2) 저장할 설문 데이터 준비
  const title = (state.survey?.title || "").trim();
  if (!title) throw new Error("설문 제목이 비어있습니다. 왼쪽 ‘설문 정보 > 제목’을 먼저 입력하세요.");

  let code = state.server?.code;
  if (!code) code = genSurveyCode(8);

  const payload = {
    owner_id: session.user.id,
    title,
    code,
    survey_json: state.survey,
    is_published: true,
  };

  // 3) insert(처음) or update(기존)
  let saved = null;

  if (state.server?.id) {
    const { data, error } = await sb.from("surveys").update(payload).eq("id", state.server.id).select("id, code, title").single();
    if (error) throw error;
    saved = data;
  } else {
    // code unique 충돌 가능 → 3번까지 재시도
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await sb.from("surveys").insert(payload).select("id, code, title").single();
      if (!error) {
        saved = data;
        break;
      }

      // unique violation이면 코드 다시 생성 후 재시도
      const msg = String(error?.message || "");
      if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
        payload.code = genSurveyCode(8);
        continue;
      }
      throw error;
    }
    if (!saved) throw new Error("저장 실패: 설문 코드가 계속 중복됩니다. 다시 시도하세요.");
  }

  // 4) 상태 반영
  state.server = { id: saved.id, code: saved.code };
  // ✅ 저장 후 ‘설문 관리’의 내 설문 리스트 즉시 갱신
  try { await loadMySurveys(); } catch (_) {}
  alert(`서버 저장 완료!\n- 설문명: ${saved.title}\n- 설문 코드: ${saved.code}`);
}

// ------------------ Supabase: 내 설문 리스트 로드/표시 ------------------
function pickMySurveyListEls(){
  // HTML이 버전마다 조금 달라도 동작하게 후보를 여러 개 둡니다.
  const tbody =
    document.getElementById("mySurveyTbody") ||
    document.getElementById("mySurveyListBody") ||
    document.querySelector("#mySurveyList tbody") ||
    document.querySelector("#mySurveys tbody") ||
    null;

  const empty =
    document.getElementById("mySurveyEmpty") ||
    document.getElementById("mySurveyEmptyMsg") ||
    document.querySelector("#mySurveyListEmpty") ||
    null;

  return { tbody, empty };
}


async function updateSurveyWindow(surveyId, openFromStr, openToStr){
  const session = await requireLoginOrModal();

  // datetime-local("YYYY-MM-DDTHH:mm") -> ISO(UTC) 저장
  const toIsoOrNull = (v) => {
    const s = String(v || "").trim();
    if (!s) return null;
    const d = new Date(s); // local time으로 해석됨
    if (Number.isNaN(d.getTime())) throw new Error("날짜/시간 형식이 올바르지 않습니다: " + s);
    return d.toISOString();
  };

  const open_from = toIsoOrNull(openFromStr);
  const open_to = toIsoOrNull(openToStr);

  // 내 설문(owner_id)만 업데이트
  const { error } = await sb
    .from("surveys")
    .update({ open_from, open_to })
    .eq("id", surveyId)
    .eq("owner_id", session.user.id);

  if (error) throw error;
}

async function loadMySurveys(){
  const session = await requireLoginOrModal();
  if (!session?.user?.id) throw new Error("로그인이 필요합니다.");

  // ✅ 내 계정(owner_id) 기준으로만 가져옵니다.
  const { data, error } = await sb
    .from("surveys")
    .select("id, title, code, owner_id, created_at, open_from, open_to")
    .eq("owner_id", session.user.id)
    .order("created_at", { ascending: false });

  if (error) throw error;
  state.mySurveys = Array.isArray(data) ? data : [];
  renderMySurveyList();
  return state.mySurveys;
}


function formatWindowText(s){
  const fmt = (iso) => {
    if (!iso) return "-";
    try{
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso);
      // YYYY-MM-DD HH:mm
      const y = d.getFullYear();
      const m = String(d.getMonth()+1).padStart(2,"0");
      const dd = String(d.getDate()).padStart(2,"0");
      const hh = String(d.getHours()).padStart(2,"0");
      const mm = String(d.getMinutes()).padStart(2,"0");
      return `${y}-${m}-${dd} ${hh}:${mm}`;
    } catch(e){
      return String(iso);
    }
  };
  return `${fmt(s?.open_from)} ~ ${fmt(s?.open_to)}`;
}

// ------------------ Survey answer window (UI modal) ------------------
function toDateTimeLocalValue(iso){
  if (!iso) return "";
  try{
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    const dd = String(d.getDate()).padStart(2,"0");
    const hh = String(d.getHours()).padStart(2,"0");
    const mm = String(d.getMinutes()).padStart(2,"0");
    return `${y}-${m}-${dd}T${hh}:${mm}`;
  } catch(e){
    return "";
  }
}
function nowLocalDateTime(){
  const d = new Date();
  return toDateTimeLocalValue(d.toISOString());
}
function addDaysToLocalInput(dtLocalStr, days){
  const s = String(dtLocalStr || "").trim();
  const base = s ? new Date(s) : new Date();
  if (Number.isNaN(base.getTime())) return "";
  base.setDate(base.getDate() + (days||0));
  const y = base.getFullYear();
  const m = String(base.getMonth()+1).padStart(2,"0");
  const dd = String(base.getDate()).padStart(2,"0");
  const hh = String(base.getHours()).padStart(2,"0");
  const mm = String(base.getMinutes()).padStart(2,"0");
  return `${y}-${m}-${dd}T${hh}:${mm}`;
}
function ensureWindowModal(){
  let wrap = document.getElementById("surveyWindowModal");
  if (wrap) return wrap;

  wrap = document.createElement("div");
  wrap.id = "surveyWindowModal";
  wrap.style.cssText = [
    "position:fixed","inset:0","display:none","align-items:center","justify-content:center",
    "background:rgba(17,24,39,.55)","z-index:99999","padding:24px"
  ].join(";");

  wrap.innerHTML = `
    <div style="width:min(520px,100%);background:#fff;border:1px solid #e6e8ef;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.25);overflow:hidden;">
      <div style="padding:16px 18px;border-bottom:1px solid #e6e8ef;display:flex;align-items:center;justify-content:space-between;">
        <div style="font-weight:800;font-size:16px;">설문 답변 기간 설정</div>
        <button id="swmClose" class="btn" style="padding:8px 10px;">닫기</button>
      </div>

      <div style="padding:18px;">
        <div class="muted" id="swmTitle" style="margin-bottom:10px;"></div>

        <label style="display:block;font-weight:700;margin:10px 0 6px;">시작일시</label>
        <input id="swmFrom" type="datetime-local" style="width:100%;padding:10px;border:1px solid #e6e8ef;border-radius:10px;" />

        <label style="display:block;font-weight:700;margin:14px 0 6px;">마감일시</label>
        <div style="display:flex;gap:8px;align-items:center;">
          <input id="swmTo" type="datetime-local" style="flex:1;padding:10px;border:1px solid #e6e8ef;border-radius:10px;" />
          <button id="swmPlus1" class="btn" title="+1일" style="white-space:nowrap;">+1일</button>
        </div>

        <div class="muted" style="font-size:12px;margin-top:10px;line-height:1.5;">
          • 시작/마감이 비어있으면 기간 제한이 없습니다.<br/>
          • 마감 이후에는 사용자용에서 제출/임시저장/회수가 제한됩니다(관리자에서 기간 연장 시 회수 가능).
        </div>
      </div>

      <div style="padding:14px 18px;border-top:1px solid #e6e8ef;display:flex;gap:8px;justify-content:flex-end;background:#fafbff;">
        <button id="swmClearTo" class="btn">마감 비우기</button>
        <button id="swmSave" class="btn primary">저장</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  // overlay click close
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) wrap.style.display = "none";
  });
  wrap.querySelector("#swmClose")?.addEventListener("click", () => (wrap.style.display = "none"));

  return wrap;
}

async function openSurveyWindowModal(srow){
  const wrap = ensureWindowModal();
  const fromEl = wrap.querySelector("#swmFrom");
  const toEl = wrap.querySelector("#swmTo");
  const titleEl = wrap.querySelector("#swmTitle");

  // 초기값: 시작=현재(기존 값이 있으면 그 값), 마감=비움(기존 값이 있으면 그 값)
  if (titleEl) titleEl.textContent = `설문: ${srow?.title || "-"}  /  코드: ${srow?.code || "-"}`;

  const fromInit = srow?.open_from ? toDateTimeLocalValue(srow.open_from) : nowLocalDateTime();
  const toInit = srow?.open_to ? toDateTimeLocalValue(srow.open_to) : "";

  if (fromEl) fromEl.value = fromInit;
  if (toEl) toEl.value = toInit;

  const plusBtn = wrap.querySelector("#swmPlus1");
  if (plusBtn) plusBtn.onclick = () => {
    const base = (toEl?.value || "").trim() || (fromEl?.value || "").trim() || nowLocalDateTime();
    if (toEl) toEl.value = addDaysToLocalInput(base, 1);
  };

  const clearBtn = wrap.querySelector("#swmClearTo");
  if (clearBtn) clearBtn.onclick = () => { if (toEl) toEl.value = ""; };

  const saveBtn = wrap.querySelector("#swmSave");
  if (saveBtn) saveBtn.onclick = async () => {
    const fromVal = (fromEl?.value || "").trim();
    const toVal = (toEl?.value || "").trim();
    try{
      await updateSurveyWindow(srow.id, fromVal, toVal);
      wrap.style.display = "none";
      await loadMySurveys();
      alert("기간 저장 완료: " + (fromVal || "-") + " ~ " + (toVal || "-"));
    } catch(e){
      alert("기간 저장 실패: " + (e?.message || e));
    }
  };

  wrap.style.display = "flex";
}


function renderMySurveyList(){
  const { tbody, empty } = pickMySurveyListEls();
  if (!tbody) return; // HTML에 해당 영역이 없으면 조용히 종료

  const rows = state.mySurveys || [];
  tbody.innerHTML = "";

  if (!rows.length) {
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  rows.forEach((s, i) => {
    const tr = document.createElement("tr");

    // 설문 기간: "~" 기준으로 줄바꿈(두 줄 표시)
    const _winText = formatWindowText(s) || "-";
    const winHtml = escapeHtml(_winText).replace(/\s*~\s*/g, " ~<br>");

    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${escapeHtml(s.title || "")}</td>
      <td><code>${escapeHtml(s.code || "")}</code></td>
<td>
  <div class="survey-window-wrap">
    <div class="survey-window">${winHtml}</div>
    <button class="btn btn-compact" data-act="window" data-id="${s.id}">기간설정</button>
  </div>
</td>
<td>
  <div class="action-group single">
    <button class="btn" data-act="edit" data-id="${s.id}">편집</button>
  </div>
</td>
      <td>
        <div class="action-group single">
          <button class="btn" data-act="answers" data-id="${s.id}">제출된 답변 보기</button>
        </div>
      </td>
      <td>
        <div class="action-group single">
          <button class="btn danger" data-act="delete" data-id="${s.id}">삭제</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // 이벤트 위임(테이블 내부 버튼)
  tbody.onclick = async (ev) => {
    const btn = ev.target?.closest?.("button[data-act]");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    const act = btn.getAttribute("data-act");

    try{
      if (act === "edit") {
        await openSurveyFromServer(id);
      } else if (act === "answers") {
  const survey = state.mySurveys.find((x) => x.id === id);
  if (!survey) {
    alert("설문 정보를 찾을 수 없습니다.");
    return;
  }
  openSubmittedAnswers(survey);
      } else if (act === "window") {
  const srow = state.mySurveys.find((x)=>x.id===id);
  if (!srow) return alert("설문 정보를 찾을 수 없습니다.");
  await openSurveyWindowModal(srow);
}
else if (act === "delete") {
  const session = await requireLoginOrModal();
  if (!confirm("정말 삭제하시겠습니까? (삭제 후 복구 불가)")) return;

  const { error } = await sb
    .from("surveys")
    .delete()
    .eq("id", id)
    .eq("owner_id", session.user.id); // 내 것만 삭제 안전장치

  if (error) throw error;

  // 지금 편집 중인 설문을 삭제한 경우 로컬 상태도 초기화
  if (state.server?.id === id) {
    state.server = { id: null, code: null };
  }

  await loadMySurveys(); // 리스트 새로고침
}
document.getElementById("btnAnswersBack")?.addEventListener("click", () => {
  if (setViewModeRef) setViewModeRef("manage");
});

    } catch (e){
      alert("처리 실패: " + (e?.message || e));
    }
  };
}
async function openSubmittedAnswers(survey){
  currentAnswersSurvey = survey;

  // 화면 이동
  if (setViewModeRef) setViewModeRef("answers");

  // 제목 표시
  const titleEl = document.getElementById("submittedSurveyTitle");
  if (titleEl) titleEl.textContent = `[${survey.title}]`;

  // ✅ 우측 상단: 일괄 전송 버튼(HTML에 고정 배치: #btnBulkSend)
  const bulkBtn = document.getElementById("btnBulkSend");
  if (bulkBtn){
    bulkBtn.title = "제출된 응답을 모두 일괄 전송합니다. (이미 전송된 건도 최신 점수로 다시 전송/갱신됩니다.)";
    bulkBtn.style.display = "";
  }

  // ✅ 우측 상단: 일괄 회수 버튼(#btnBulkRecall)
  const bulkRecallBtn = document.getElementById("btnBulkRecall");
  if (bulkRecallBtn){
    bulkRecallBtn.title = "결과가 전송된 응답을 모두 일괄 회수합니다.";
    bulkRecallBtn.style.display = "";
  }

  await loadSubmittedAnswersTable();
}

async function loadSubmittedAnswersTable(){
  const tbody = document.getElementById("submittedTbody");
  if (!tbody) return;

  // 컬럼 수가 변경될 수 있으니 넉넉히
  tbody.innerHTML = `<tr><td colspan="10" class="muted">불러오는 중...</td></tr>`;

  const surveyId = currentAnswersSurvey?.id;
  if (!surveyId){
    tbody.innerHTML = `<tr><td colspan="10" class="muted">설문 정보가 없습니다.</td></tr>`;
    return;
  }


  // ✅ 제출 답변 화면에서 점수 계산/편집(미리보기)에 쓰기 위해 survey_json을 추가로 로드
  let surveyJsonForAnswers = null;
  try{
    const { data: srow, error: serr } = await sb
      .from("surveys")
      .select("survey_json, title, code, id")
      .eq("id", surveyId)
      .single();
    if (serr) throw serr;
    surveyJsonForAnswers = srow?.survey_json || null;
  } catch(e){
    console.warn("[answers] failed to load survey_json for scoring/edit", e);
    surveyJsonForAnswers = null;
  }

// ✅ USER 앱 answers -> (관리자 PREVIEW/채점) sim.answers 형식으로 변환 (고정버전)
function convertUserAnswersToSim(surveyJson, payloadAnswers){
  const sim = {};
  const pa = payloadAnswers || {};

  const normStr = (v) =>
    String(v ?? "")
      .replace(/\r?\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  // 🔥 survey 문항들을 map으로 만들어둔다
  const questionMap = {};
  for (const g1 of (surveyJson?.groups1 || [])){
    for (const g2 of (g1?.groups2 || [])){
      for (const q of (g2?.questions || [])){
        questionMap[q.id] = q;
      }
    }
  }

  // 🔥 제출된 answers 기준으로 돌린다 (이게 핵심 차이)
  for (const qid of Object.keys(pa)){
    const q = questionMap[qid];
    if (!q) continue;  // 관리자 설문에 없는 문항이면 무시

    ensureQuestionSpec(q);

    const ua = pa[qid] || {};
    const mode = q?.answerSpec?.mode || "YES_NO";

    const simAns = {
      norm: ua.norm || "",
      text: ua.text || "",
      fields: ua.fields || {},
      checks: []
    };

    const rawChecks = Array.isArray(ua.checks) ? ua.checks : [];

    if (mode === "YES_NO") {
      const items = q.answerSpec?.items || [];
      const checkItems = items.filter(it => String(it?.kind || "").toUpperCase() === "CHECK");

      const checkedLabels = new Set(rawChecks.map(normStr));

      simAns.checks = checkItems
  simAns.checks = new Set(simAns.checks || []);
    }

    else if (mode === "YES_CHECKBOX") {
      const opts = q.answerSpec?.options || [];
      const checkedLabels = new Set(rawChecks.map(normStr));

      simAns.checks = opts
  simAns.checks = new Set(simAns.checks || []);
    }

    sim[qid] = simAns;
  }

  return sim;
}


 function computeSubmittedScore100(surveyJson, submittedJson){
  console.log("SIM ANSWERS:", state.sim.answers);
  if (!surveyJson || !submittedJson) return 0;
if (typeof submittedJson === "string") {
  try { submittedJson = JSON.parse(submittedJson); } catch(e) {}
}

  // ✅ answers가 어디에 있든 뽑아오기
  const qids = new Set(
    (surveyJson.groups1 || [])
      .flatMap(g1 => (g1.groups2 || []).flatMap(g2 => (g2.questions || []).map(q => q.id)))
  );

  let answersPayload = submittedJson.answers;

  // submittedJson 자체가 answers 맵인 경우(키가 qid들)
  if (!answersPayload && submittedJson && typeof submittedJson === "object") {
    const keys = Object.keys(submittedJson);
    const hit = keys.some(k => qids.has(k));
    if (hit) answersPayload = submittedJson;
  }

  // 그래도 없으면 빈값
  answersPayload = answersPayload || {};

  const prevSurvey = state.survey;
  const prevSim = state.sim;

  try{
    state.survey = surveyJson;
    state.sim = state.sim || { enabled: true, answers: {} };
    state.sim.enabled = true;

    // ✅ 여기서 변환 -> 기존 채점 로직 그대로 사용
// submittedJson이 {answers:{...}} 이든, answers맵 자체이든 둘 다 지원
const payload = (submittedJson && submittedJson.answers) ? submittedJson.answers : (submittedJson || {});
state.sim.answers = convertUserAnswersToSimForReport(surveyJson, payload);

    const res = computeScoreFromSim();
return Math.round((res?.totalScore || 0) * 10) / 10;
  } catch(e){
    console.warn("[answers] score calc failed", e);
    return 0;
  } finally {
    state.survey = prevSurvey;
    state.sim = prevSim;
  }
}

  // responses 테이블에서 제출본 조회 (컬럼명이 두 버전일 수 있어서 넓게 처리)
  let q = sb.from("responses").select("*").eq("survey_id", surveyId);

  // 네 첫번째 스키마: submitted_at 존재
  // 네 두번째 스키마: status='SUBMITTED' 존재
  // 둘 다 커버 (에러 나면 그냥 전체에서 걸러냄)
  const { data, error } = await q;
  if (error){
    tbody.innerHTML = `<tr><td colspan="10" class="muted">조회 오류: ${error.message}</td></tr>`;
    return;
  }

  const rows = (data || []).filter(r => {
    const hasSubmittedAt = !!r.submitted_at;
    const hasStatusSubmitted = (String(r.status || "").toUpperCase() === "SUBMITTED");
    const isRecalled = (String(r.status || "").toUpperCase() === "RECALLED");
    if (isRecalled) return false;
    const hasSubmittedJson = !!r.submitted_json;
    return hasSubmittedAt || hasStatusSubmitted || hasSubmittedJson;
  });

  if (rows.length === 0){
    tbody.innerHTML = `<tr><td colspan="10" class="muted">제출된 답변이 없습니다.</td></tr>`;
    return;
  }
  // 점수 계산: submitted_json에 score가 있으면 그거 우선, 없으면 0 표시
  // (네 사용자용 앱에서 score를 넣도록 해두면 가장 안정적)
// rows = responses 목록 (r.user_id가 있어야 함)

const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))];

let profileMap = {};
if (userIds.length) {
  const { data: profiles, error } = await sb
    .from("profiles")
    .select("user_id, name, email, company_name")
    .in("user_id", userIds);

  if (error) {
    console.error("profiles load error:", error);
  } else {
    profileMap = Object.fromEntries((profiles || []).map(p => [p.user_id, p]));
  }
}

tbody.innerHTML = "";
rows.forEach((r, idx) => {
  const submitted = r.submitted_json || r.answers || {};
  const p = profileMap[r.user_id] || {};

  // ✅ profiles 우선, 없으면 기존 JSON fallback
  const company = p.company_name
    || getMeta(submitted, ["company", "company_name", "companyName", "회사명"])
    || "-";

  const name = p.name
    || getMeta(submitted, ["name", "userName", "이름"])
    || "-";

  const email = p.email
    || (r.respondent_email || "")
    || getMeta(submitted, ["email", "userEmail", "아이디"])
    || (r.user_id || "-");

  const score = computeSubmittedScore100(surveyJsonForAnswers, submitted);

  // ✅ 결과 전송(사용자용 결과 다운로드 활성화) 상태
  const resultSent = !!getMeta(submitted, ["result_sent", "resultSent"]);

  

  const submittedAt = r.submitted_at ? new Date(r.submitted_at).toLocaleString("ko-KR", { hour12:false }) : "-";
const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${idx + 1}</td>
    <td style="word-break:break-all;">${company}</td>
    <td style="word-break:break-all;">${name}</td>
    <td style="word-break:break-all;">${email}</td>
    <td class="submitted-at">${submittedAt}</td>
    <td>${score}</td>
    <td><button class="btn btn-edit-response" data-rid="${r.id}">편집</button></td>
    <td><button class="btn btn-dl-response" data-rid="${r.id}">다운로드</button></td>
    <td><button class="btn btn-dl-result-response" data-rid="${r.id}">결과 다운로드</button></td>
    <td>
      <div class="action-group single">
        <button class="btn btn-send-result-response" data-rid="${r.id}">${resultSent ? "결과 회수" : "결과 전송"}</button>
      </div>
    </td>
  `;
  tbody.appendChild(tr);
});




  // ✅ 결과 다운로드에서 재사용할 수 있도록 캐시
  window.__answersCtx = {
    survey: currentAnswersSurvey || null,
    surveyJson: surveyJsonForAnswers || null,
    rows: Array.isArray(rows) ? rows : [],
    profileMap: profileMap || {}
  };

  // 버튼 이벤트(편집/다운로드)
  tbody.querySelectorAll(".btn-edit-response").forEach(btn => {
    btn.addEventListener("click", async () => {
      const rid = btn.dataset.rid;
      const found = rows.find(x => x.id === rid);
      const submitted = found?.submitted_json || found?.answers || null;
      if (!submitted) return alert("제출 데이터(submitted_json)를 찾지 못했습니다.");
      if (!surveyJsonForAnswers) return alert("설문 원문(survey_json)을 불러오지 못했습니다.");

      try{
        // ✅ 제출 답변을 '미리보기(PREVIEW)' 화면에서 그대로 확인/재채점
        state.survey = surveyJsonForAnswers;
        state.sim = state.sim || { enabled:true, answers:{} };
        state.sim.enabled = true;
        state.sim.responseRid = rid;
        state.sim.originalSubmitted = submitted;

        state.sim.answers = convertUserAnswersToSimForReport(surveyJsonForAnswers, submitted.answers || {});
        state.sim.company = getMeta(submitted, ["company","company_name","companyName","회사명"]) || "";
        state.ui.viewMode = "PREVIEW";
renderWithScrollReset();
      } catch(e){
        alert("편집 열기 실패: " + (e?.message || e));
      }
    });
  });

  tbody.querySelectorAll(".btn-dl-response").forEach(btn => {
    btn.addEventListener("click", () => {
      const rid = btn.dataset.rid;
      const found = rows.find(x => x.id === rid);
      const payload = found?.submitted_json || found?.answers || {};
      const fileName = `response_${currentAnswersSurvey?.code || "survey"}_${rid}.json`;

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  });

  tbody.querySelectorAll(".btn-dl-result-response").forEach(btn => {
    btn.addEventListener("click", async () => {
      const rid = btn.getAttribute("data-rid");
      try{
        await downloadResultPdfByResponseId(rid);
      } catch(e){
        console.error(e);
        alert("결과 PDF 생성 실패: " + (e?.message || e));
      }
    });
  });

  // ✅ 결과 전송/회수 토글(사용자용 결과 다운로드 버튼 ON/OFF)
  tbody.querySelectorAll(".btn-send-result-response").forEach(btn => {
    btn.addEventListener("click", async () => {
      const rid = btn.dataset.rid;
      if (!rid) return;

      const isRecall = (btn.textContent || "").includes("회수");

      if (!isRecall){
        if (!confirm("사용자용 프로그램에서 해당 응답자의 '결과 다운로드'를 활성화할까요?\n(관리자 편집/채점 결과 기준 PDF가 출력됩니다.)")) return;
      } else {
        if (!confirm("사용자용 프로그램에서 전송한 결과를 회수할까요?\n(사용자용의 결과 다운로드 버튼이 다시 숨겨집니다.)")) return;
      }

      try {
        const { data, error } = await sb.from("responses").select("submitted_json").eq("id", rid).single();
        if (error) throw error;
        const sj = normalizeSubmittedJson((data && data.submitted_json) ? data.submitted_json : null);

        if (!isRecall){
          // ✅ 관리자 화면에서 최종 편집/채점된 제출본 기준으로 리포트 데이터 생성 후 함께 저장
          try{
            const ctx = window.__answersCtx || {};
            const sJson = ctx.surveyJson || null;
            if (sJson) {
              // report_payload는 가능한 경우 생성. 실패해도 전송 플래그는 업데이트한다.
              try{
                const rep = computeSubmittedReport(sJson, sj);
                sj.report_payload = rep;
                sj.report_generated_at = new Date().toISOString();
              }catch(repErr){
                console.warn("[bulk_send] report_payload generation failed", rid, repErr);
                // 기존 report_payload가 있으면 유지하고, 없으면 최소 메타만 남김
                if(!sj.report_generated_at) sj.report_generated_at = new Date().toISOString();
              }
            }
          }catch(e){
            console.warn("[result_send] report_payload generation failed", e);
          }

          sj.result_sent = true;
          sj.result_sent_at = new Date().toISOString();
          sj.result_recalled_at = null;
        } else {
          sj.result_sent = false;
          sj.result_recalled_at = new Date().toISOString();
          // report_payload는 남겨도 되지만(관리자 재전송 대비), 사용자 노출은 result_sent로 제어
        }

        const { error: upErr } = await sb.from("responses").update({ submitted_json: sj }).eq("id", rid);
        if (upErr) throw upErr;

        btn.textContent = isRecall ? "결과 전송" : "결과 회수";
        alert(isRecall ? "회수 완료! (사용자용 결과 다운로드가 비활성화됩니다)" : "전송 완료! (사용자용에서 결과 다운로드가 활성화됩니다)");
      } catch (e) {
        console.error(e);
        alert((isRecall ? "결과 회수" : "결과 전송") + " 실패: " + (e?.message || e));
      }
    });
  });

  // ✅ 일괄 전송(아직 전송 안 된 응답만)
  const bulkBtn = document.getElementById("btnBulkSend");
  if (bulkBtn && !bulkBtn.__bound){
    bulkBtn.__bound = true;
    bulkBtn.addEventListener("click", async () => {
      try{
        const ctx = window.__answersCtx || {};
        const sJson = ctx.surveyJson || null;
        if (!sJson) return alert("설문 원문(survey_json)을 불러오지 못해 일괄 전송을 수행할 수 없습니다.");

        const targets = (ctx.rows || []);

        if (!targets.length){
          alert("전송할 대상이 없습니다.");
          return;
        }

        if (!confirm(`총 ${targets.length}건을 일괄 전송할까요? (이미 전송된 건도 최신 점수로 다시 전송/갱신됩니다.)`)) return;

        bulkBtn.disabled = true;
        const prevText = bulkBtn.textContent;
        bulkBtn.textContent = `일괄 전송 중... (0/${targets.length})`;

        let ok = 0;
        for (let i=0; i<targets.length; i++){
          const r = targets[i];
          const rid = r.id;
          try{
            const { data, error } = await sb.from("responses").select("submitted_json").eq("id", rid).single();
            if (error) throw error;
            const sj = normalizeSubmittedJson((data && data.submitted_json) ? data.submitted_json : null);

            const rep = computeSubmittedReport(sJson, sj);
            sj.report_payload = rep;
            sj.report_generated_at = new Date().toISOString();
            sj.result_sent = true;
            sj.result_sent_at = new Date().toISOString();
            sj.result_recalled_at = null;

            const { error: upErr } = await sb.from("responses").update({ submitted_json: sj }).eq("id", rid);
            if (upErr) throw upErr;
            ok++;
          }catch(e){
            console.warn("[bulk_send] failed", rid, e);
          } finally {
            bulkBtn.textContent = `일괄 전송 중... (${i+1}/${targets.length})`;
          }
        }

        alert(`일괄 전송 완료: 성공 ${ok}건 / 전체 ${targets.length}건`);
        await loadSubmittedAnswersTable();
      }catch(e){
        console.error(e);
        alert("일괄 전송 실패: " + (e?.message || e));
      } finally {
        const bb = document.getElementById("btnBulkSend");
        if (bb){
          bb.disabled = false;
          bb.textContent = "일괄 전송";
        }
      }
    });
  }
}

  // ✅ 일괄 회수(전송된 응답만)
  const bulkRecallBtn = document.getElementById("btnBulkRecall");
  if (bulkRecallBtn && !bulkRecallBtn.__bound){
    bulkRecallBtn.__bound = true;
    bulkRecallBtn.addEventListener("click", async () => {
      try{
        const ctx = window.__answersCtx || {};
        const targets = (ctx.rows || []).filter(r => {
          const sj = r.submitted_json || r.answers || {};
          const sent = !!getMeta(sj, ["result_sent", "resultSent"]);
          return sent;
        });

        if (!targets.length){
          alert("회수할 대상이 없습니다. (전송된 결과가 없음)");
          return;
        }

        if (!confirm(`전송된 결과 ${targets.length}건을 일괄 회수할까요? (사용자용 결과 다운로드가 모두 비활성화됩니다.)`)) return;

        bulkRecallBtn.disabled = true;
        bulkRecallBtn.textContent = `일괄 회수 중... (0/${targets.length})`;

        let ok = 0;
        for (let i=0; i<targets.length; i++){
          const r = targets[i];
          const rid = r.id;
          try{
            const { data, error } = await sb.from("responses").select("submitted_json").eq("id", rid).single();
            if (error) throw error;
            const sj = normalizeSubmittedJson((data && data.submitted_json) ? data.submitted_json : null);

            sj.result_sent = false;
            sj.result_recalled_at = new Date().toISOString();
            sj.result_sent_at = null;

            const { error: upErr } = await sb.from("responses").update({ submitted_json: sj }).eq("id", rid);
            if (upErr) throw upErr;
            ok++;
          }catch(e){
            console.warn("[bulk_recall] failed", rid, e);
          } finally {
            bulkRecallBtn.textContent = `일괄 회수 중... (${i+1}/${targets.length})`;
          }
        }

        alert(`일괄 회수 완료: 성공 ${ok}건 / 전체 ${targets.length}건`);
        await loadSubmittedAnswersTable();
      }catch(e){
        console.error(e);
        alert("일괄 회수 실패: " + (e?.message || e));
      } finally {
        const br = document.getElementById("btnBulkRecall");
        if (br){
          br.disabled = false;
          br.textContent = "일괄 회수";
        }
      }
    });
  }


async function openSurveyFromServer(surveyId){
  const session = await requireLoginOrModal();
  if (!session?.user?.id) throw new Error("로그인이 필요합니다.");

  const { data, error } = await sb
    .from("surveys")
    .select("id, code, title, owner_id, survey_json")
    .eq("id", surveyId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("서버에서 설문을 찾지 못했습니다.");
  if (data.owner_id !== session.user.id) throw new Error("권한이 없습니다.");

  const obj = data.survey_json;
  if (!obj || !obj.groups1) throw new Error("설문 데이터가 올바르지 않습니다. (survey_json/groups1 없음)");

  // 로컬 편집 상태로 로드
  state.survey = obj;
  state.server = { id: data.id, code: data.code };
  state.selected = null;
  state.ui.focusQId = null;

  // 화면 갱신
  renderWithScrollReset();
}

// ------------------ Start ------------------
window.addEventListener("DOMContentLoaded", async () => {
  try {
    const session = await requireLoginOrModal();
    if (!session) return; // ✅ non-admin이면 여기서 끊김

    // 여기부터 admin만 실행되는 영역
    bindTop();

    // ✅ 로그인 직후: ‘설문 관리’의 “내 설문 리스트”를 먼저 로드
    try { await loadMySurveys(); } catch (e) { console.warn("loadMySurveys failed", e); }

    // ===== Top navigation (state.ui.viewMode 연동) =====
    function setViewMode(mode) {
      state.ui.viewMode = mode;

      // 버튼 active 토글
      document.querySelectorAll(".nav-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.view === mode);
      });

      // 뷰 영역 active 토글 (있을 때만)
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
      const target = document.querySelector(`.view-${mode}`);
      if (target) target.classList.add("active");

      // ✅ 메뉴(뷰) 이동 시: 스크롤은 부드럽게 최상단으로
      renderWithScrollReset();
    }
    setViewModeRef = setViewMode;

    // 메뉴 버튼 바인딩
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => setViewMode(btn.dataset.view));
    });

    // ✅ 초기 화면 (state에 저장된 값 우선)
    setViewMode(state.ui.viewMode || "edit");

    renderWithScrollReset();
  } catch (e) {
    alert("로그인이 필요합니다.");
    console.error(e);
    return;
  }
});


// ================== Result PDF download ==================
async function downloadResultPdfByResponseId(responseId){
  const ctx = window.__answersCtx || {};
  const survey = ctx.survey || currentAnswersSurvey;
  const surveyJson = ctx.surveyJson;
  if (!survey || !surveyJson) throw new Error("설문 정보(survey_json)가 없어 결과를 생성할 수 없습니다.");

  const row = (ctx.rows || []).find(x => String(x.id) === String(responseId));
  if (!row) {
    // fallback fetch
    const { data, error } = await sb.from("responses").select("*").eq("id", responseId).single();
    if (error) throw error;
    return downloadResultPdfCore(survey, surveyJson, data, {});
  }
  const prof = (ctx.profileMap || {})[row.user_id] || {};
  return downloadResultPdfCore(survey, surveyJson, row, prof);
}


// ✅ meta extractor (shared)
// - USER 앱 저장 포맷: { target:{company,name,email}, answers:{...}, savedAt }
// - ADMIN 앱/구버전: 루트에 company_name/name/email 등이 있을 수 있음
function getMeta(obj, keys){
  const t = obj?.target || {};
  for (const k of keys){
    if (t && t[k] != null && t[k] !== "") return t[k];          // target 우선
    if (obj && obj[k] != null && obj[k] !== "") return obj[k];  // 그 다음 루트
  }
  return "";
}

// ✅ submitted_json 정규화 (string/json/null 모두 지원)
function normalizeSubmittedJson(v){
  if (!v) return {};
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch(_) { return {}; }
  }
  if (typeof v === "object") return v;
  return {};
}



function normalizeFilename(s){
  return String(s || "result")
    .replace(/[\\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

// (Result PDF) footer logo loader (optional)
// - 우선순위: window.__REPORT_LOGO_DATAURL > surveyJson.meta.logoDataUrl > img#companyLogo.src
async function loadReportLogoImage(surveyJson){
  try{
    if (window.__reportLogoImage && window.__reportLogoImage.complete) return window.__reportLogoImage;

    const src =
      window.__REPORT_LOGO_DATAURL
      || surveyJson?.meta?.logoDataUrl
      || surveyJson?.logoDataUrl
      || document.querySelector("img#companyLogo")?.src
      || null;

    if (!src) {
      window.__reportLogoImage = null;
      return null;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    const p = new Promise((resolve) => {
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
    });
    img.src = src;

    const loaded = await p;
    window.__reportLogoImage = loaded;
    return loaded;
  }catch(e){
    window.__reportLogoImage = null;
    return null;
  }
}


async function downloadResultPdfCore(survey, surveyJson, responseRow, profile){
  let submitted = responseRow?.submitted_json || responseRow?.answers || {};
  if (typeof submitted === "string") {
    try { submitted = JSON.parse(submitted); } catch(e) {}
  }

  const company =
    profile?.company_name
    || getMeta(submitted, ["company", "company_name", "companyName", "회사명"])
    || "company";

  const report = computeSubmittedReport(surveyJson, submitted);

  await loadReportLogoImage(surveyJson);

  const canvas = await renderResultReportCanvas({
    surveyTitle: survey?.title || surveyJson?.title || "설문",
    companyName: company,
    totalScore: report.totalScore,
    g1Rows: report.g1Rows
  });

  const pdfBytes = pdfFromCanvasMultiPage(canvas, 595, 842); // A4 portrait in points (자동 페이지 분할)

  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0,10).replace(/-/g,"");
  a.download = normalizeFilename(`survey_result_${company}_${stamp}.pdf`);
  a.href = url;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1500);
}

// ---- compute report breakdown (scores + exclusions) ----

// (보고서용) 제출 answers -> sim.answers 변환 (checks는 Set으로 보존)
function convertUserAnswersToSimForReport(surveyJson, payloadAnswers){
  const sim = {};
  const pa = payloadAnswers || {};

  const normStr = (v) =>
    String(v ?? "")
      .replace(/\r?\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const questionMap = {};
  for (const g1 of (surveyJson?.groups1 || [])){
    for (const g2 of (g1?.groups2 || [])){
      for (const q of (g2?.questions || [])){
        questionMap[q.id] = q;
      }
    }
  }

  for (const qid of Object.keys(pa)){
    const q = questionMap[qid];
    if (!q) continue;

    ensureQuestionSpec(q);

    const ua = pa[qid] || {};
    const mode = q?.answerSpec?.mode || "YES_NO";

    const simAns = {
      norm: ua.norm || "",
      text: ua.text || "",
      fields: ua.fields || {},
      checks: new Set()
    };

    const rawChecks = Array.isArray(ua.checks) ? ua.checks : [];

    const isIndexChecks = rawChecks.some(v => {
      if (typeof v === "number") return true;
      if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return true;
      return false;
    });

    if (mode === "YES_NO") {
      const items = q.answerSpec?.items || [];
      const checkItems = items.filter(it => String(it?.kind || "").toUpperCase() === "CHECK");

      let idxs = [];
      if (isIndexChecks) {
        idxs = rawChecks
          .map(v => Number(v))
          .filter(n => Number.isFinite(n) && n >= 0 && n < checkItems.length);
      } else {
        const checkedLabels = new Set(rawChecks.map(normStr));
        idxs = checkItems
          .map((it, idx) => (checkedLabels.has(normStr(it.label)) ? idx : null))
          .filter(v => v !== null);
      }
      simAns.checks = new Set(idxs);
    }
    else if (mode === "YES_CHECKBOX") {
      const opts = q.answerSpec?.options || [];
      let idxs = [];
      if (isIndexChecks) {
        idxs = rawChecks
          .map(v => Number(v))
          .filter(n => Number.isFinite(n) && n >= 0 && n < opts.length);
      } else {
        const checkedLabels = new Set(rawChecks.map(normStr));
        idxs = opts
          .map((lab, idx) => (checkedLabels.has(normStr(lab)) ? idx : null))
          .filter(v => v !== null);
      }
      simAns.checks = new Set(idxs);
    }

    sim[qid] = simAns;
  }

  return sim;
}

function computeSubmittedReport(surveyJson, submittedJson){
  if (typeof submittedJson === "string") {
    try { submittedJson = JSON.parse(submittedJson); } catch(e) {}
  }

  const qids = new Set(
    (surveyJson.groups1 || [])
      .flatMap(g1 => (g1.groups2 || []).flatMap(g2 => (g2.questions || []).map(q => q.id)))
  );

  let answersPayload = submittedJson?.answers;

  if (!answersPayload && submittedJson && typeof submittedJson === "object") {
    const keys = Object.keys(submittedJson);
    const hit = keys.some(k => qids.has(k));
    if (hit) answersPayload = submittedJson;
  }
  answersPayload = answersPayload || {};

  const prevSurvey = state.survey;
  const prevSim = state.sim;

  try{
    state.survey = surveyJson;
    state.sim = state.sim || { enabled: true, answers: {} };
    state.sim.enabled = true;

    state.sim.answers = convertUserAnswersToSimForReport(surveyJson, answersPayload);

    const effects = computeRuleEffectsFromSimAnswers();

    const g2Max = new Map();
    for (const { g1, g2 } of allG2()){
      g2Max.set(g2.id, 0);
    }
    for (const { g2, q } of allQuestions()){
      ensureQuestionSpec(q);
      const mx = calcQuestionMaxInG2Active(g2, q, effects);
      g2Max.set(g2.id, (g2Max.get(g2.id) || 0) + mx);
    }

    const scoreRes = computeScoreFromSim();

    // ✅ weight1(구분1 가중치) 반영된 "전체 100점 기준" 점수로 변환
    const sumW1 = (scoreRes.g1 || []).reduce((a, r) => a + Number(r.weight1 || 0), 0) || 0;

    const fmtScore = (n) => {
      if (!Number.isFinite(n)) return "0.0점";
      const v = Math.round(n * 10) / 10;
      return v.toFixed(1) + "점";
    };

    const g1Rows = (scoreRes.g1 || []).map(g1r => {
      const w1 = Number(g1r.weight1 || 0);
      const weightExcluded = (w1 <= 0) || (sumW1 <= 0);

      // ✅ 영역별 점수/상세 점수는 "각 영역/항목 100점 만점 기준"으로 표기
      const g2Rows = (g1r.g2 || []).map(g2r => {
        const mx = g2Max.get(g2r.g2id) || 0;
        const excluded = weightExcluded || (mx <= 0.000001);
        return {
          name: g2r.name,
          score100Text: excluded ? "배점제외" : fmtScore(Number(g2r.score100 || 0)),
          excluded
        };
      });

      const g1Excluded = weightExcluded || (g2Rows.length > 0 && g2Rows.every(x => x.excluded));
      return {
        name: g1r.name,
        score100Text: g1Excluded ? "배점제외" : fmtScore(Number(g1r.score100 || 0)),
        excluded: g1Excluded,
        g2: g2Rows
      };
    });

    // ✅ totalScore는 0~100 스케일(가중치 반영 후)는 이미 0~100 스케일로 정규화된 값(가중치 반영 후)
    const totalScore = Number(scoreRes.totalScore || 0);

    return { totalScore, g1Rows };

  } finally {
    state.survey = prevSurvey;
    state.sim = prevSim;
  }
}

// ---- canvas renderer (Korean OK) ----

async function renderResultReportCanvas({ surveyTitle, companyName, totalScore, g1Rows }){
  // A4 비율(약 1:1.414)에 맞춘 고해상도 캔버스 (PDF 변환 전용)
  const pageW = 1240;
  const pageH = 1754;

  const fmtPoint = (n) => {
    if (!Number.isFinite(n)) return "0.0점";
    return (Math.round(n * 10) / 10).toFixed(1) + "점";
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
    const show = isExcluded ? "배점제외" : fmtPoint(Number(v)); // ✅ x.x점 통일
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
      const show = isExcluded ? "배점제외" : fmtPoint(Number(v)); // ✅ x.x점 통일
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

// ---- minimal PDF (single page) from JPEG ----
function pdfFromJpegDataUrl(dataUrl, pageWpt, pageHpt){
  const base64 = (dataUrl.split(",")[1] || "");
  const binStr = atob(base64);
  const imgBytes = new Uint8Array(binStr.length);
  for (let i=0;i<binStr.length;i++) imgBytes[i] = binStr.charCodeAt(i);

  const enc = new TextEncoder();
  const parts = [];
  const push = (x) => parts.push(typeof x === "string" ? enc.encode(x) : x);

  const offsets = {};
  const curLen = () => parts.reduce((a,b)=>a+b.length,0);
  const startObj = (n) => { offsets[n] = curLen(); push(`${n} 0 obj\n`); };
  const endObj = () => push(`endobj\n`);

  push(PDF_HEADER);

  startObj(1);
  push(`<< /Type /Catalog /Pages 2 0 R >>\n`);
  endObj();

  startObj(2);
  push(`<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n`);
  endObj();

  startObj(3);
  push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWpt} ${pageHpt}] /Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>\n`);
  endObj();

  startObj(4);
  push(`<< /Type /XObject /Subtype /Image /Width 1240 /Height 1754 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgBytes.length} >>\nstream\n`);
  push(imgBytes);
  push(`\nendstream\n`);
  endObj();

  const content = `q\n${pageWpt} 0 0 ${pageHpt} 0 0 cm\n/Im0 Do\nQ\n`;
  const contentBytes = enc.encode(content);
  startObj(5);
  push(`<< /Length ${contentBytes.length} >>\nstream\n`);
  push(contentBytes);
  push(`endstream\n`);
  endObj();

  const xrefOffset = curLen();
  push(`xref\n0 6\n`);
  push(`0000000000 65535 f \n`);
  for (let i=1;i<=5;i++){
    const off = offsets[i] || 0;
    push(String(off).padStart(10,"0") + " 00000 n \n");
  }
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  const totalLen = curLen();
  const out = new Uint8Array(totalLen);
  let p = 0;
  for (const b of parts){
    out.set(b, p);
    p += b.length;
  }
  return out;
}
})();