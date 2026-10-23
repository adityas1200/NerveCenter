// One-chat task page mock. Each block in data.js stands for one show_* call; render() draws it.
(function () {
  const T = window.TASK;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Inline `code` in data strings.
  const md = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");

  const state = { live: false, dqPassed: false, played: new Set(), waiters: {}, decisions: {}, mailSent: false, gen: 0 };
  const thread = $("#thread");
  const scroller = $("#scroll");

  /* ------------------------------------------------------------ blocks */
  const R = {
    headline: (b) => `<p class="headline">${md(b.text)}</p>`,

    tiles: (b) => `<div class="card"><div class="tiles">${b.items.map((i) => `
      <div class="tile"><div class="l">${esc(i.l)}</div><div class="v num ${i.tone}">${esc(i.v)}</div><div class="s">${esc(i.s)}</div></div>`).join("")}</div></div>`,

    schema: (b) => {
      const cells = (list, kind) => list.map((c, i) => {
        const cls = kind === "expected" ? "" : c === b.extra ? "extra" : "";
        return `<div class="col ${cls}" title="${esc(c)}">${i + 1}</div>`;
      }).join("") + (kind === "expected" ? `<div class="col gap" title="Not in contract"></div>` : "");
      return `<div class="card"><div class="card-h"><h3>${esc(b.title)}</h3><span class="meta mono">${esc(b.meta)}</span></div>
        <div class="card-b schema">
          <div class="schema-row"><span class="lab">Contract v7</span><div class="cols">${cells(b.expected, "expected")}</div></div>
          <div class="schema-row"><span class="lab">Today's file</span><div class="cols">${cells(b.found, "found")}</div></div>
          <div class="schema-row"><span></span><div class="schema-note">Column 14 <code>${esc(b.extra)}</code> is new. ${md(b.note)}</div></div>
        </div></div>`;
    },

    runs: (b) => `<div class="card"><div class="card-h"><h3>${esc(b.title)}</h3><span class="meta">${esc(b.meta)}</span></div>
      <div class="card-b"><div class="runs">${b.rows.map((r) => `
        <div class="run-row"><div class="nm">${esc(r.nm)}<small>${esc(r.sub)}</small></div>
          <div class="run-cells">${r.runs.map(([s, tip]) => `<button type="button" class="run-cell ${s}" data-tip="${esc(tip)}" aria-label="${esc(tip)}"></button>`).join("")}</div></div>`).join("")}
        <div class="run-axis"><span></span><div>${b.axis.map((a) => `<span>${esc(a)}</span>`).join("")}</div></div>
      </div><div class="run-tip" data-tip-out>Point at a run.</div></div></div>`,

    cause: (b) => `<div class="card"><div class="card-h"><h3>Root cause</h3><span class="tag ok">Confirmed</span><span class="meta">Confidence ${esc(b.confidence)}</span></div>
      <div class="card-b"><p class="cause-t">${md(b.text)}</p>
        <div class="ev">${b.evidence.map(([s, t]) => `<div class="ev-row"><span class="src">${esc(s)}</span><span class="txt">${md(t)}</span><span class="ck">✓</span></div>`).join("")}</div>
      </div></div>`,

    flow: (b) => `<div class="card"><div class="card-h"><h3>${esc(b.title)}</h3></div><div class="card-b"><div class="flow">${b.nodes.map((n) => `
      <div class="fnode ${n.st} ${n.st === "ok" ? "past" : ""}"><span class="fdot">${n.st === "ok" ? "✓" : n.st === "bad" ? "✕" : n.st === "run" ? "" : "!"}</span><span class="fl">${esc(n.l)}</span><span class="fs">${esc(n.s)}</span></div>`).join("")}</div></div></div>`,

    question: (b) => {
      const answered = state.decisions["q"] !== "open";
      return `<div class="card ${answered ? "" : "ask"}" id="blk-q"><div class="card-h"><h3>${esc(b.q)}</h3><span class="meta">${answered ? `Answered by ${esc(b.by)}` : "Sonic is waiting"}</span></div>
        <div class="card-b q-opts">${b.opts.map((o, i) => `<button type="button" class="q-opt ${answered ? (i === b.chosen ? "chosen" : "dim") : ""}" data-act="answer" data-i="${i}"><b>${esc(o.b)}</b><span>${esc(o.s)}</span></button>`).join("")}</div></div>`;
    },

    change: (b) => {
      const st = state.decisions[b.id] || b.state;
      return `<div class="card ${st === "pending" ? "ask" : ""}" id="blk-${b.id}"><div class="card-h"><h3>Code change</h3><span class="mono" style="color:rgb(var(--c-ink-3))">${esc(b.branch)}</span><span class="meta">${b.files.length} files · <span style="color:rgb(var(--ok))">+${b.files.reduce((a, f) => a + f.a, 0)}</span> <span style="color:rgb(var(--bad))">−${b.files.reduce((a, f) => a + f.r, 0)}</span></span></div>
        <div class="files">${b.files.map((f, i) => `
          <div class="file"><button type="button" class="file-h" data-act="diff" data-i="${i}"><span class="p">${esc(f.p)}</span><span class="d"><span class="a">+${f.a}</span><span class="r">−${f.r}</span></span><span>›</span></button>
          <pre class="diff" hidden>${f.diff.map(([k, l]) => `<span class="${k}">${esc(l)}</span>`).join("")}</pre></div>`).join("")}</div>
        <div class="facts">${st === "pending"
          ? `<span>Base <b class="mono">${esc(b.base)}</b></span><span>Tests and commit run after you approve</span><span>Not pushed</span>`
          : `<span>Tests <b class="num">${esc(b.tests)}</b></span><span>Commit <b class="mono">${esc(b.commit)}</b></span><span>Base <b class="mono">${esc(b.base)}</b></span><span>Not pushed</span>`}</div>
        <div class="card-f">${st === "pending"
          ? `<button class="btn primary" data-act="decide" data-id="${b.id}" data-v="approved">Approve change</button><button class="btn" data-act="decide" data-id="${b.id}" data-v="denied">Deny</button><span class="meta">Covers ${b.steps} steps: branch, 3 file writes, tests, commit</span>`
          : `<span class="decided"><span class="tag ${st === "denied" ? "bad" : "ok"}">${st === "denied" ? "Denied" : "Approved"}</span>by Mitesh Shinde · ${b.steps} steps in one decision</span>`}</div></div>`;
    },

    approval: (b) => {
      const st = state.decisions[b.id] || b.state;
      return `<div class="card ${st === "pending" ? "ask" : ""}" id="blk-${b.id}"><div class="card-h"><h3>${esc(b.title)}</h3>${st === "pending" ? `<span class="tag warn">Needs you</span>` : ""}<span class="meta">${st === "pending" ? "Sonic is waiting" : ""}</span></div>
        <div class="card-b"><p class="ask-what">${md(b.what)}</p>
          <ul class="checks">${b.checks.map((c) => `<li>${md(c)}</li>`).join("")}</ul>
          <dl class="kv">${b.kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${md(v)}</dd>`).join("")}</dl>
          <pre class="cmd" hidden>${esc(b.cmd)}</pre>
        </div>
        <div class="card-f">${st === "pending"
          ? `<button class="btn primary" data-act="decide" data-id="${b.id}" data-v="approved">Approve</button><button class="btn" data-act="decide" data-id="${b.id}" data-v="denied">Deny</button><button class="btn link" data-act="cmd">Show command</button>`
          : `<span class="decided"><span class="tag ${st === "denied" ? "bad" : "ok"}">${st === "denied" ? "Denied" : "Approved"}</span>by Mitesh Shinde${b.at ? " · " + esc(b.at) : ""}</span><button class="btn link" data-act="cmd" style="margin-left:auto">Show command</button>`}</div></div>`;
    },

    tracker: (b, opt = {}) => {
      const p = opt.progress ?? 3;
      return `<div class="card" id="blk-${b.id}"><div class="card-h"><h3>${esc(b.title)}</h3>${p >= 3 ? `<span class="tag ok">Success</span>` : `<span class="tag brand">Running</span>`}<span class="meta num">${p >= 3 ? esc(b.meta) : "started 05:37:19 UTC"}</span></div>
        <div class="card-b track">${b.tasks.map(([n, t], i) => `
          <div class="trow"><span class="tn">${esc(n)}</span><div class="bar"><i class="${i === p ? "run" : ""}" style="left:${i * 33.3}%;width:${i < p ? 33.3 : i === p ? 12 : 0}%"></i></div><span class="tt num">${i < p ? esc(t) : i === p ? "running" : ""}</span></div>`).join("")}</div></div>`;
    },

    verify: (b) => `<div class="card" id="blk-${b.id}"><div class="card-h"><h3>Verification</h3><span class="meta">${state.dqPassed ? "4 of 4 pass" : "3 of 4 pass · 1 open"}</span></div>
      <table class="vt"><thead><tr><th>Check</th><th>Evidence</th><th></th></tr></thead><tbody>${b.rows.map((r) => {
        const open = r.r === "open" && !state.dqPassed;
        return `<tr class="${r.r === "open" && state.dqPassed ? "flash" : ""}"><td>${esc(r.c)}</td><td>${open ? md(r.e) : r.r === "open" ? "Recomputed now: both pass" : md(r.e)}${open && r.act ? `<div class="row-act"><button class="btn" data-act="play" data-f="dq">Run checks now</button></div>` : ""}</td><td>${open ? `<span class="tag warn">Open</span>` : `<span class="tag ok">Pass</span>`}</td></tr>`;
      }).join("")}</tbody></table></div>`,

    records: (b) => `<div class="card"><div class="card-h"><h3>${esc(b.title)}</h3></div><div class="recs">${b.items.map((i) => `
      <div class="rec"><span class="id">${esc(i.id)}<small>${esc(i.sys)}</small></span><span><span class="move"><span class="tag mute">${esc(i.from)}</span><span class="arrow">→</span><span class="tag ${i.to === "Resolved" || i.to === "Done" ? "ok" : "brand"}">${esc(i.to)}</span></span><small style="display:block;color:rgb(var(--c-ink-4));margin-top:4px;font-size:12px">${md(i.note)}</small></span><span class="readback">✓ ${esc(i.rb)}</span></div>`).join("")}</div></div>`,

    notes: (b) => `<div><div class="next-h" style="margin-bottom:8px">${esc(b.title)}</div><ul class="notes">${b.items.map(([h, t]) => `<li><span><b>${md(h)}</b> ${md(t)}</span></li>`).join("")}</ul></div>`,

    next: (b) => `<div class="next" ${b.id ? `id="blk-${b.id}"` : ""}><div class="next-h">Next</div><div class="next-row">${b.items.map((i) => {
      const done = i.action === "dq" && state.dqPassed;
      return `<button type="button" class="act ${i.kind === "done" || done ? "done" : ""}" data-act="next" data-kind="${i.kind}" data-a="${esc(i.action || "")}" data-p="${esc(i.prompt || "")}">${esc(i.label)}${i.small ? ` <small>${esc(i.small)}</small>` : ""}${i.kind === "tool" && !done ? ` <span class="k">needs approval</span>` : ""}</button>`;
    }).join("")}</div></div>`,

    email: (b) => {
      const sent = state.mailSent;
      const body = b.body.map((p) => p.startsWith("LIST:") ? `<ul>${p.slice(5).split("|").map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p>${esc(p)}</p>`).join("");
      return `<div class="card ${sent ? "" : "ask"}" id="blk-${b.id}"><div class="card-h"><h3>Email draft</h3>${sent ? `<span class="tag ok">Sent</span>` : `<span class="tag mute">Draft</span>`}<span class="meta">Edit anything before sending</span></div>
        <div class="mail">
          <div class="mail-f"><label>To</label><input value="${esc(b.to)}" ${sent ? "readonly" : ""} /></div>
          <div class="mail-f"><label>Cc</label><input value="${esc(b.cc)}" ${sent ? "readonly" : ""} /></div>
          <div class="mail-f"><label>Subject</label><input value="${esc(b.subject)}" ${sent ? "readonly" : ""} style="font-weight:600" /></div>
          <div class="mail-body" ${sent ? "" : "contenteditable"}>${body}</div>
        </div>
        <div class="card-f">${sent
          ? `<span class="decided"><span class="tag ok">Sent</span>by you · 2 recipients · the exact text above</span>`
          : `<button class="btn primary" data-act="send">Send</button><button class="btn" data-act="tone">Shorter</button><button class="btn link">Discard</button><span class="meta">Sends the text as shown</span>`}</div></div>`;
    },
  };

  /* ----------------------------------------------------------- turns */
  function workedFold(w, open = false) {
    return `<div><button type="button" class="worked" data-act="fold" aria-expanded="${open}"><span class="chev">›</span>Worked for ${esc(w.took)}<span class="sys">${w.systems.map((s) => `<i>${esc(s)}</i>`).join("")}</span></button>
      <div class="steps" ${open ? "" : "hidden"} style="margin-top:10px">${w.groups.map((g) => `<div class="steps-g"><h4>${esc(g.h)}</h4><ul>${g.items.map((i) => `<li class="${g.blocked ? "blocked" : ""}">${esc(i)}</li>`).join("")}</ul></div>`).join("")}</div></div>`;
  }

  function userBubble(turn) {
    return `<div class="user-who">${esc(turn.who)}</div><div class="user">${md(turn.user)}${turn.userMore ? ` <button class="more" data-act="more" data-more="${esc(turn.userMore)}">more</button>` : ""}</div>`;
  }

  function staticTurn(turn) {
    const el = document.createElement("section");
    el.className = "turn"; el.id = "turn-" + turn.id;
    el.innerHTML = userBubble(turn) + workedFold(turn.worked) + turn.blocks.map((b) => R[b.t](b)).join("");
    return el;
  }

  /* --------------------------------------------------------- outcome */
  function outcome() {
    const o = $("#outcome"); const pill = $("#status-pill");
    if (state.live) {
      pill.className = "pill pill-live"; pill.textContent = "Working";
      o.innerHTML = `<span class="o-main">${esc(state.liveLine || "Working")}</span><span class="o-meta num">${esc(state.liveClock || "")}</span>`;
      return;
    }
    if (state.waiting) {
      pill.className = "pill pill-wait"; pill.textContent = "Needs you";
      o.innerHTML = `<button class="o-chip warn" data-jump="${state.waiting}"><b>Waiting for your approval</b></button><span class="o-meta">Sonic is paused</span>`;
      return;
    }
    pill.className = "pill pill-done"; pill.textContent = "Done";
    const shown = (id) => !!document.getElementById(id);
    if (!shown("blk-verify")) { o.innerHTML = `<span class="o-main">In progress</span>`; return; }
    o.innerHTML = `<span class="o-main">Recovered</span><span class="o-sep"></span>
      <button class="o-chip ok" data-jump="turn-recover">INC0031201 <b>Resolved</b></button>
      <button class="o-chip ok" data-jump="turn-recover">CDO-118 <b>Done</b></button>
      <button class="o-chip ${state.dqPassed ? "ok" : "warn"}" data-jump="blk-verify"><b>${state.dqPassed ? "All checks pass" : "1 check open"}</b></button>
      ${state.mailSent ? `<button class="o-chip ok" data-jump="blk-mail"><b>Brand team told</b></button>` : ""}
      <span class="o-meta num">20m 3s · $5.73</span>`;
  }

  function suggestions() {
    const s = $("#suggest");
    if (state.live || state.waiting || !document.getElementById("blk-verify")) { s.innerHTML = ""; return; }
    // Questions only; actions live on the cards and in Next.
    const items = [["Why did you choose run-now over repair?", "why"], ["What would it take to show plan_type on the dashboard?", "gold"]].filter(([, f]) => !state.played.has(f));
    s.innerHTML = items.map(([l, f]) => `<button class="chip" data-act="play" data-f="${f}">${esc(l)}</button>`).join("");
  }

  /* ------------------------------------------------------------ live */
  function scrollEnd() { scroller.scrollTop = scroller.scrollHeight; }

  async function streamText(el, text, gen) {
    el.classList.add("caret");
    const words = text.split(" ");
    for (let i = 0; i < words.length; i++) {
      if (gen !== state.gen) return;
      el.innerHTML = md(words.slice(0, i + 1).join(" "));
      if (i % 3 === 0) scrollEnd();
      await sleep(28);
    }
    el.classList.remove("caret");
  }

  function waitDecision(id) {
    return new Promise((resolve) => { state.waiters[id] = resolve; });
  }

  async function playTurn(turn, gen, opts = {}) {
    const el = document.createElement("section");
    el.className = "turn"; el.id = "turn-" + turn.id;
    thread.appendChild(el);
    el.insertAdjacentHTML("beforeend", userBubble(turn).replace('class="user"', 'class="user enter"'));
    scrollEnd(); await sleep(450);

    // One live line instead of a Journey graph: what Sonic is doing right now.
    const live = document.createElement("div");
    live.className = "worked-live enter";
    el.appendChild(live);
    const items = turn.worked.groups.flatMap((g) => g.items.map((i) => (g.blocked ? "Blocked: " : "") + i));
    state.live = true; outcome();
    for (let i = 0; i < items.length; i++) {
      if (gen !== state.gen) return;
      live.innerHTML = `<span class="spin"></span>${esc(items[i])}`;
      state.liveLine = items[i]; state.liveClock = turn.worked.took; outcome();
      await sleep(opts.fast ? 260 : 520);
    }
    live.outerHTML = workedFold(turn.worked);

    for (const b of turn.blocks) {
      if (gen !== state.gen) return;
      if (b.t === "headline") {
        const p = document.createElement("p"); p.className = "headline"; el.appendChild(p);
        await streamText(p, b.text, gen); await sleep(200); continue;
      }
      if ((b.t === "approval" || b.t === "change") && (opts.ask || b.state === "pending")) {
        state.decisions[b.id] = "pending";
        el.insertAdjacentHTML("beforeend", R[b.t](b).replace('class="card', 'class="enter card'));
        state.live = false; state.waiting = "blk-" + b.id; outcome(); suggestions(); scrollEnd();
        const v = await waitDecision(b.id);
        if (gen !== state.gen) return;
        state.waiting = null; state.live = true; outcome();
        if (v === "denied") { el.insertAdjacentHTML("beforeend", `<p class="prose enter">Stopped here. Nothing was run.</p>`); state.live = false; outcome(); return; }
        if (opts.onApprove) opts.onApprove(b);
        await sleep(300); continue;
      }
      state.liveLine = skelLabel(b) || state.liveLine; outcome();
      // Skeleton first: the component is streaming in.
      const sk = document.createElement("div");
      sk.className = "skel enter"; sk.innerHTML = `<span class="t">${esc(skelLabel(b))}</span><i style="width:70%"></i><i style="width:45%"></i>`;
      el.appendChild(sk); scrollEnd();
      await sleep(opts.fast ? 220 : 480);
      if (gen !== state.gen) return;
      if (b.t === "tracker") {
        sk.outerHTML = R.tracker(b, { progress: 0 });
        for (let p = 1; p <= 3; p++) {
          await sleep(700);
          if (gen !== state.gen) return;
          document.getElementById("blk-" + b.id).outerHTML = R.tracker(b, { progress: p });
        }
        continue;
      }
      if (b.t === "question" && opts.ask) {
        state.decisions["q"] = "open";
        sk.outerHTML = R.question(b);
        state.live = false; state.waiting = "blk-q"; outcome(); scrollEnd();
        await waitDecision("q");
        if (gen !== state.gen) return;
        state.waiting = null; state.live = true; outcome();
        await sleep(300); continue;
      }
      sk.outerHTML = R[b.t](b).replace(/^<(div|p)( class=")?/, (m, tag, cls) => cls ? `<${tag} class="enter ` : `<${tag} class="enter"`);
      if (b.t === "verify" || b.t === "records") outcome();
      scrollEnd(); await sleep(260);
    }
    state.live = false; state.played.add(turn.id); outcome(); suggestions(); scrollEnd();
  }

  function skelLabel(b) {
    return { tiles: "Numbers", schema: "Comparing the file to the contract", runs: "Run history", cause: "Root cause", flow: "Lineage", question: "Question", tracker: "Running job 731", verify: "Verification", records: "Records", notes: "Notes", next: "Next", email: "Email draft", change: "Code change" }[b.t] || "";
  }

  /* --------------------------------------------------------- modes */
  function renderFinished() {
    state.gen++; Object.assign(state, { live: false, waiting: null, dqPassed: false, mailSent: false, decisions: {}, played: new Set(T.turns.map((t) => t.id)) });
    thread.innerHTML = "";
    T.turns.forEach((t) => thread.appendChild(staticTurn(t)));
    outcome(); suggestions();
    scroller.scrollTop = 0;
  }

  async function replay() {
    const gen = ++state.gen;
    Object.assign(state, { live: true, waiting: null, dqPassed: false, mailSent: false, decisions: {}, played: new Set() });
    thread.innerHTML = ""; outcome(); suggestions();
    for (const t of T.turns) {
      if (gen !== state.gen) return;
      await playTurn(t, gen, { ask: true, fast: true });
      await sleep(500);
    }
  }

  async function playFollow(key) {
    if (state.live || state.waiting) return;
    if (key === "gold") {
      const gen = state.gen;
      return playTurn({ id: "gold", who: "Mitesh Shinde", user: "What would it take to show plan_type on the dashboard?", worked: { took: "30s", systems: ["Repo", "Knowledge"], groups: [{ h: "Repo · commercial-data-pipelines", items: ["Read refresh_gold_mart.py", "Read the gold.veltrix_sales_daily model"] }] },
        blocks: [
          { t: "headline", text: "One gold change and one dashboard field. plan_type is already in silver from today's run." },
          { t: "flow", title: "Where plan_type is today", nodes: [{ l: "IQVIA file", s: "has it", st: "ok" }, { l: "silver", s: "has it", st: "ok" }, { l: "gold", s: "not selected", st: "stale" }, { l: "Dashboard", s: "no field", st: "stale" }] },
          { t: "next", items: [{ label: "Open a ticket for the gold change", kind: "link" }] },
        ] }, gen);
    }
    if (key === "why") {
      const gen = state.gen;
      return playTurn({ id: "why", who: "Mitesh Shinde", user: "Why did you choose run-now over repair?", worked: { took: "5s", systems: ["Knowledge"], groups: [{ h: "Knowledge", items: ["Re-read the IQVIA Xponent runbook"] }] },
        blocks: [
          { t: "headline", text: "The runbook prescribes run-now after a contract fix, and nothing had been written, so a full run was safe." },
          { t: "notes", title: "What decided it", items: [["Repair reruns only failed tasks.", "ingest already passed on the old contract; run-now re-ingests with v8."], ["Writes use overwrite.", "A full run replaces today's rows, so no duplicates."]] },
        ] }, gen);
    }
    const f = T.followups[key]; if (!f || state.played.has(key)) return;
    const gen = state.gen;
    await playTurn({ id: key, ...f }, gen, {
      onApprove: () => {
        if (f.after === "dq") { state.dqPassed = true; refreshVerify(); }
      },
    });
  }

  function refreshVerify() {
    const turn = T.turns.find((t) => t.id === "recover");
    const v = turn.blocks.find((b) => b.t === "verify");
    const cur = document.getElementById("blk-verify"); if (cur) cur.outerHTML = R.verify(v);
    const n = turn.blocks.find((b) => b.id === "next-final");
    const nc = document.getElementById("blk-next-final"); if (nc) nc.outerHTML = R.next(n);
    outcome(); suggestions();
  }

  /* ----------------------------------------------------------- sheet */
  function openSheet() {
    const d = T.details;
    const list = (rows) => `<ul>${rows.map(([a, b]) => `<li><span>${esc(a)}</span><span>${esc(b)}</span></li>`).join("")}</ul>`;
    $("#sheet").innerHTML = `<div class="sheet-h"><h2>Details</h2><button class="ghost" data-act="close">Close</button></div>
      <div class="sec"><h3>Files</h3>${list(d.files)}</div>
      <div class="sec"><h3>Records changed</h3>${list([["INC0031201", "Resolved"], ["CDO-118", "Done"], ["Branch ticket/CDO-118-iqvia-plan-type", "local"]])}</div>
      <div class="sec"><h3>Skills</h3>${list(d.skills)}</div>
      <div class="sec"><h3>Knowledge</h3>${list(d.knowledge)}</div>
      <div class="sec"><h3>Session</h3>${list(d.session)}</div>
      <div class="sec"><h3>Admin</h3><ul><li><span>Logs</span><span>open</span></li><li><span>Raw events</span><span>195</span></li></ul></div>`;
    $("#sheet").hidden = false; $("#scrim").hidden = false;
  }
  function closeSheet() { $("#sheet").hidden = true; $("#scrim").hidden = true; }

  /* ---------------------------------------------------------- events */
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act],[data-jump]");
    if (!t) return;
    if (t.dataset.jump) { const el = document.getElementById(t.dataset.jump); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    const a = t.dataset.act;
    if (a === "fold") { const open = t.getAttribute("aria-expanded") !== "true"; t.setAttribute("aria-expanded", open); t.nextElementSibling.hidden = !open; }
    if (a === "more") { t.outerHTML = `<br/><span style="color:rgb(var(--c-ink-3))">${esc(t.dataset.more)}</span>`; }
    if (a === "diff") { const pre = t.nextElementSibling; pre.hidden = !pre.hidden; t.lastElementChild.textContent = pre.hidden ? "›" : "⌄"; }
    if (a === "cmd") { const pre = t.closest(".card").querySelector(".cmd"); pre.hidden = !pre.hidden; t.textContent = pre.hidden ? "Show command" : "Hide command"; }
    if (a === "decide") {
      const id = t.dataset.id; state.decisions[id] = t.dataset.v;
      const card = document.getElementById("blk-" + id);
      const blk = [...T.turns, ...Object.values(T.followups)].flatMap((x) => x.blocks).find((b) => b.id === id);
      if (card && blk) card.outerHTML = R[blk.t](blk);
      const w = state.waiters[id]; delete state.waiters[id]; if (w) w(t.dataset.v);
    }
    if (a === "answer") {
      const qb = T.turns[0].blocks.find((b) => b.t === "question");
      qb.chosen = Number(t.dataset.i); state.decisions["q"] = "answered";
      document.getElementById("blk-q").outerHTML = R.question(qb);
      const w = state.waiters["q"]; delete state.waiters["q"]; if (w) w(qb.chosen);
    }
    if (a === "play") playFollow(t.dataset.f);
    if (a === "next") {
      const k = t.dataset.kind;
      if (k === "tool" && t.dataset.a === "dq") playFollow("dq");
      else if (k === "prompt" && /brand team/.test(t.dataset.p)) playFollow("email");
      else if (k === "prompt") { const target = /CDO-118/.test(t.dataset.p) ? "turn-fix" : "turn-recover"; document.getElementById(target)?.scrollIntoView({ behavior: "smooth" }); }
      else if (k === "file") openSheet();
    }
    if (a === "send") { state.mailSent = true; const b = T.followups.email.blocks[0]; document.getElementById("blk-mail").outerHTML = R.email(b); outcome(); }
    if (a === "tone") { const body = t.closest(".card").querySelector(".mail-body"); body.innerHTML = `<p>Hi team,</p><p>The Veltrix dashboard is current through 24 Sep. This morning's load failed on a new IQVIA column; it is fixed and reran at 05:37 UTC. Nothing is needed from you.</p><p>Mitesh</p>`; }
    if (a === "close") closeSheet();
  });
  document.addEventListener("mouseover", (e) => {
    const c = e.target.closest(".run-cell"); if (!c) return;
    const out = c.closest(".card").querySelector("[data-tip-out]"); if (out) out.textContent = c.dataset.tip || "";
  });
  $("#scrim").addEventListener("click", closeSheet);
  $("#open-details").addEventListener("click", openSheet);
  $("#replay").addEventListener("click", replay);
  $("#reset").addEventListener("click", renderFinished);
  $("#theme").addEventListener("click", (e) => {
    const dark = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light"; e.target.textContent = dark ? "Light" : "Dark";
  });
  $("#send").addEventListener("click", () => {
    const v = $("#composer-input").value.trim(); if (!v) return;
    $("#composer-input").value = "";
    if (/email|brand|update/i.test(v)) return playFollow("email");
    if (/dq|check/i.test(v)) return playFollow("dq");
    playFollow("why");
  });
  $("#composer-input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#send").click(); } });

  renderFinished();
})();
