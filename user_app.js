(() => {
  const $ = (id) => document.getElementById(id);

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
  };

  // ------------------ State ------------------
  const state = {
    survey: { title: "", version: "", schemaVersion: 2, groups1: [], rules: [] },
    target: { company: "", name: "" },
    answers: {}, // qid -> { norm, checks:Set, text, fields:{} }
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
          disabled: false,
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
      options
        .map(
          ({ value, label }) => `
        <label style="margin-right:12px;">
          <input type="radio" name="${name}" value="${value}" ${ans.norm === value ? "checked" : ""}>
          <span>${escapeHtml(label)}</span>
        </label>
      `
        )
        .join("");

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
              ? `<input class="input" type="text" data-t="${escapeHtml(label)}"
                   value="${escapeHtml(v)}"
                   placeholder="${escapeHtml(ph || "")}"
                   style="margin-left:10px; max-width:260px;"
                   ${enabled && checked ? "" : "disabled"}>`
              : "";
            return `
              <div style="margin-top:6px;">
                <label>
                  <input type="checkbox" data-k="${escapeHtml(label)}" ${checked ? "checked" : ""} ${enabled ? "" : "disabled"}>
                  <span>${escapeHtml(label)}</span>
                </label>
                ${inputHtml}
              </div>
            `;
          }

          // TEXT
          const v = ans.fields[label] || "";
          return `
            <div style="margin-top:8px;">
              <div class="hint">${escapeHtml(label)}</div>
              <textarea rows="3" data-k="${escapeHtml(label)}" style="width:100%;" placeholder="${escapeHtml(ph)}" ${enabled ? "" : "disabled"}>${escapeHtml(v)}</textarea>
            </div>
          `;
        }).join("");

        host.innerHTML = `
          ${html}
        `;

        host.querySelectorAll("input[type=checkbox]").forEach((cb) => {
          cb.onchange = (e) => {
            const k = e.target.getAttribute("data-k");
            if (!k) return;
            if (e.target.checked) ans.checks.add(k);
            else ans.checks.delete(k);
            const inp = host.querySelector(`input[data-t="${CSS.escape(k)}"]`);
            if (inp) inp.disabled = !(enabled && e.target.checked);
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
        <div>${radioHtml(`norm_${q.id}`, [
          { value: "YES", label: yesLabel },
          { value: "NO",  label: noLabel }
        ])}</div>
        <div id="items_${escapeHtml(q.id)}"></div>
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

      const drawChecks = () => {
        const chkHost = container.querySelector(`#chk_${CSS.escape(q.id)}`);
        if (!chkHost) return;

        if (ans.norm !== "YES") {
          chkHost.innerHTML = `<div class="hint">YES일 때만 체크 가능합니다.</div>`;
          return;
        }
        if (!opts.length) {
          chkHost.innerHTML = `<div class="hint">옵션이 없습니다.</div>`;
          return;
        }

        chkHost.innerHTML = opts
          .map((o, idx) => {
            const key = String(o || `옵션${idx + 1}`);
            const checked = ans.checks.has(key);
            return `
              <label style="display:block; margin-top:4px;">
                <input type="checkbox" data-key="${escapeHtml(key)}" ${checked ? "checked" : ""}>
                <span>${escapeHtml(key)}</span>
              </label>
            `;
          })
          .join("");

        chkHost.querySelectorAll("input[type=checkbox]").forEach((cb) => {
          cb.onchange = (e) => {
            const k = e.target.getAttribute("data-key");
            if (!k) return;
            if (e.target.checked) ans.checks.add(k);
            else ans.checks.delete(k);
            const inp = host.querySelector(`input[data-t="${CSS.escape(k)}"]`);
            if (inp) inp.disabled = !(enabled && e.target.checked);
            onAnswerChanged?.();
          };
        });
      };

      container.innerHTML = `
        <div>${radioHtml(`norm_${q.id}`, [
          { value: "YES", label: yesLabel },
          { value: "NO",  label: noLabel }
        ])}</div>
        <div class="hint" style="margin-top:8px;">YES일 때만 아래 항목을 체크합니다.</div>
        <div id="chk_${escapeHtml(q.id)}" style="margin-top:8px;"></div>
      `;

      container.querySelectorAll(`input[name="norm_${q.id}"]`).forEach((r) => {
        r.onchange = (e) => {
          setNorm(e.target.value);
          drawChecks();
          onAnswerChanged?.();
        };
      });

      drawChecks();
      applyDisabled();
      return;
    }

    // YES_MULTI_TEXT
    if (mode === "YES_MULTI_TEXT") {
      const fields = q.answerSpec?.fields || [];

      container.innerHTML = `
        <div>${radioHtml(`norm_${q.id}`, [
          { value: "YES", label: yesLabel },
          { value: "NO",  label: noLabel }
        ])}</div>
        <div class="hint" style="margin-top:8px;">YES일 때만 항목 입력을 권장합니다.</div>
        <div style="margin-top:8px;" id="mf_${escapeHtml(q.id)}"></div>
      `;

      container.querySelectorAll(`input[name="norm_${q.id}"]`).forEach((r) => {
        r.onchange = (e) => {
          setNorm(e.target.value);
          onAnswerChanged?.();
        };
      });

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
    $("userCanvasHint").textContent = `총 문항 ${cur.questions?.length || 0}개 · 응답은 자동 저장됩니다.`;

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

    <div class="hint" style="margin-top:6px;">문항 ID: ${escapeHtml(q.id)}</div>

    ${q.guide ? `
      <details class="answer-guide" style="margin-top:10px;" >
        <summary>답변 가이드</summary>
        <div class="guide-body">${escapeHtml(q.guide).replaceAll("\n","<br>")}</div>
      </details>
    ` : ""}

    <div id="ctrl_${escapeHtml(q.id)}" style="margin-top:10px;"></div>

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
      const c = root.querySelector(`#ctrl_${CSS.escape(q.id)}`);
      if (c) {
        renderControls(c, q, ans, {
          disabled: disabledSet.has(q.id),
          onAnswerChanged: () => handleAnswerChanged(),
        });
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


  // ------------------ Bind UI ------------------
  function bind() {
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

  }
  ensureDisabledOverlayStyles();
  bind();
  renderAll();
})();
