// src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * CritHit Maps — 2D Battle Map (single-file React)
 */

export default function BattleMapApp() {
  // ===== Core State =====
  const canvasRef = useRef(null);
  const [view, setView] = useState({ zoom: 1, offsetX: 0, offsetY: 0 });
  const [grid, setGrid] = useState({ sizePx: 64, show: true, feetPerCell: 5 });
  const [bgImage, setBgImage] = useState(null);

  /** @typedef {{id:string,name:string,x:number,y:number,color:string,isEnemy?:boolean,hp?:number,note?:string,initiative?:number,auraRadiusCells?:number,auraName?:string,auraEffects?:string[],auraPreset?:string,auraPresetValue?:number,auraAffects?:'all'|'allies'|'enemies',conditions?:string[]}} Token */
  /** @type {Token[]} */
  const [tokens, setTokens] = useState(() => [
    {
      id: cryptoRandomId(),
      name: "Paladin",
      x: 5,
      y: 5,
      color: "#3b82f6",
      hp: 42,
      initiative: 15,
      auraRadiusCells: 2,
      auraName: "Aura of Protection",
      auraEffects: ["Saving throw bonus (+X)"],
      auraPreset: "paladin",
      auraPresetValue: 3,
      auraAffects: "allies",
      conditions: [],
    },
    {
      id: cryptoRandomId(),
      name: "Rogue",
      x: 7,
      y: 6,
      color: "#10b981",
      hp: 28,
      initiative: 16,
      conditions: ["Sneak Attack Ready"],
    },
    {
      id: cryptoRandomId(),
      name: "Goblin",
      x: 10,
      y: 7,
      color: "#ef4444",
      isEnemy: true,
      hp: 12,
      initiative: 12,
      conditions: [],
    },
  ]);

  const [selectedId, setSelectedId] = useState(null);
  const [tool, setTool] = useState("select"); // select | measure | aoe-circle | aoe-line | aoe-cone
  const [ghost, setGhost] = useState(null); // {type, start:{gx,gy}, end:{gx,gy}}
  /** @type {Array<{id:string,ownerId:string,type:'circle'|'line'|'cone',start:{gx:number,gy:number},end:{gx:number,gy:number},enabled:boolean,label?:string,affects?:'all'|'allies'|'enemies',effects?:string[]}>} */
  const [persistAOE, setPersistAOE] = useState([]);
  const dragRef = useRef(null); // { mode:'token'|'pan', tokenId?, startMouse, startToken?, startOffset? }

  // Sidebar visibility + responsive auto-collapse
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 1100) { setShowLeft(false); setShowRight(false); }
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Initiative order (desc)
  const sortedTokens = useMemo(
    () => [...tokens].sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0)),
    [tokens]
  );
  const [turnIndex, setTurnIndex] = useState(0);
  useEffect(() => {
    setTurnIndex((i) =>
      sortedTokens.length ? Math.min(i, sortedTokens.length - 1) : 0
    );
  }, [sortedTokens.length]);
  const current = sortedTokens[turnIndex];
  useEffect(() => {
    if (current) setSelectedId(current.id);
  }, [turnIndex]); // eslint-disable-line

  // Preset search
  const [presetQuery, setPresetQuery] = useState("");
  const filteredConditions = useMemo(
    () =>
      CONDITION_PRESETS.filter((c) =>
        c.toLowerCase().includes(presetQuery.toLowerCase())
      ),
    [presetQuery]
  );
  const filteredAuras = useMemo(
    () =>
      AURA_PRESETS.filter((a) =>
        (a.label + " " + (a.tags?.join(" ") || ""))
          .toLowerCase()
          .includes(presetQuery.toLowerCase())
      ),
    [presetQuery]
  );

  // Effects (derived from auras + lingering AOEs + manual conditions)
  const auraIndex = useMemo(() => computeAuraIndex(tokens), [tokens]);
  const tokenEffects = useMemo(
    () => computeTokenEffects(tokens, auraIndex, persistAOE),
    [tokens, auraIndex, persistAOE]
  );

  // ===== Canvas Sizing =====
  useEffect(() => {
    const onResize = () => {
      const c = canvasRef.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = c.getBoundingClientRect();
      c.width = Math.max(800, Math.floor(rect.width * dpr));
      c.height = Math.max(500, Math.floor(rect.height * dpr));
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ===== Render =====
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.width, H = c.height;

    ctx.clearRect(0, 0, W, H);

    const cellCss = grid.sizePx * view.zoom; // CSS px per cell
    const cellPx  = cellCss * dpr;           // device px per cell

    // Background image (world space)
    if (bgImage) {
      const imgAspect = bgImage.width / bgImage.height;
      const imgWorldH = H / dpr / cellCss; // in cells
      const imgWorldW = imgWorldH * imgAspect; // in cells
      ctx.save();
      ctx.translate(view.offsetX * dpr, view.offsetY * dpr);
      ctx.scale(cellCss, cellCss); // 1 unit = 1 cell
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(bgImage, 0, 0, imgWorldW, imgWorldH);
      ctx.restore();
    }

    // Grid
    if (grid.show) drawGrid(ctx, W, H, view, grid, dpr);

    // Auras (under tokens)
    for (const t of tokens) {
      if (!t.auraRadiusCells || t.auraRadiusCells <= 0) continue;
      const cx = (t.x + 0.5) * cellPx + view.offsetX * dpr;
      const cy = (t.y + 0.5) * cellPx + view.offsetY * dpr;
      const r = t.auraRadiusCells * cellPx;
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = t.isEnemy ? "#ef4444" : "#22c55e";
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Persistent AOEs
    for (const a of persistAOE) if (a.enabled) drawAOE(ctx, a, view, grid, dpr);

    // Highlights (advantage / sneak attack)
    const selectedToken = tokens.find((t) => t.id === selectedId);
    const highlightIds = computeHighlightTargets(selectedToken, tokens);

    // Tokens (circles filling the cell)
    for (const t of tokens) {
      const cx = (t.x + 0.5) * cellPx + view.offsetX * dpr;
      const cy = (t.y + 0.5) * cellPx + view.offsetY * dpr;
      const r  = Math.max(2, cellPx / 2 - 2);
      const isSel = t.id === selectedId;
      const isHL  = highlightIds.has(t.id);

      ctx.save();
      // body
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = t.color;
      ctx.fill();
      // ring
      ctx.lineWidth = isSel ? 6 : 2;
      ctx.strokeStyle = isSel ? "#f59e0b" : isHL ? "#16a34a" : "#111827";
      ctx.stroke();

      // name label
      ctx.font = `${14 * dpr}px ui-serif, Georgia, serif`;
      ctx.fillStyle = "#1b130b";
      ctx.textAlign = "center";
      ctx.fillText(t.name, cx, cy - r - 8);

      // condition chips (show up to 3 below token)
      if (t.conditions?.length) {
        let y = cy + r + 16 * dpr;
        let x = cx - r;
        ctx.font = `${12 * dpr}px ui-serif, Georgia, serif`;
        for (const cond of t.conditions.slice(0, 3)) {
          const txt = cond;
          const w = ctx.measureText(txt).width + 10 * dpr;
          ctx.fillStyle = "rgba(201,162,39,0.85)";
          ctx.fillRect(x, y - 12 * dpr, w, 16 * dpr);
          ctx.fillStyle = "#1b130b";
          ctx.textAlign = "left";
          ctx.fillText(txt, x + 6, y);
          x += w + 6 * dpr;
          if (x > cx + r) break;
        }
      }

      // effects badge (bottom-right)
      const effCount = (tokenEffects[t.id]?.length || 0);
      if (effCount > 0) {
        const badgeR = 10 * dpr;
        const bx = cx + r - badgeR - 3 * dpr;
        const by = cy + r - badgeR - 3 * dpr;
        ctx.beginPath();
        ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
        ctx.fillStyle = "#111827";
        ctx.fill();
        ctx.font = `${11 * dpr}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(effCount), bx, by + 0.5);
      }

      ctx.restore();
    }

    // Ghost (measure / aoe)
    if (ghost) drawGhost(ctx, ghost, view, grid, dpr);
  }, [bgImage, grid, tokens, view, selectedId, ghost, persistAOE, tokenEffects]);

  // ===== Interaction =====
  const onWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setView((v) => ({ ...v, zoom: clamp(v.zoom * factor, 0.25, 3) }));
  };

  const onPointerDown = (e) => {
    const c = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * dpr;
    const my = (e.clientY - rect.top) * dpr;

    // 1) try to select/drag token first (circle hit-test)
    const hit = hitTestToken(tokens, mx, my, view, grid, dpr);
    if (hit) {
      setSelectedId(hit.id);
      dragRef.current = {
        mode: "token",
        tokenId: hit.id,
        startMouse: { x: mx, y: my },
        startToken: { x: hit.x, y: hit.y },
      };
      e.target.setPointerCapture?.(e.pointerId);
      return;
    }

    // 2) if tool active, start at center of square
    if (tool !== "select") {
      const world = screenPxToWorld(mx, my, view, grid, dpr);
      const snapped = {
        gx: Math.floor(world.wx) + 0.5,
        gy: Math.floor(world.wy) + 0.5,
      };
      const type =
        tool === "measure"
          ? "measure"
          : tool === "aoe-circle"
          ? "circle"
          : tool === "aoe-line"
          ? "line"
          : "cone";
      setGhost({ type, start: snapped, end: snapped });
      e.target.setPointerCapture?.(e.pointerId);
      return;
    }

    // 3) otherwise pan
    dragRef.current = {
      mode: "pan",
      startMouse: { x: mx, y: my },
      startOffset: { x: view.offsetX, y: view.offsetY },
    };
    e.target.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    const c = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * dpr;
    const my = (e.clientY - rect.top) * dpr;

    if (dragRef.current?.mode === "pan" && dragRef.current.startOffset) {
      const dx = (mx - dragRef.current.startMouse.x) / dpr;
      const dy = (my - dragRef.current.startMouse.y) / dpr;
      setView((v) => ({
        ...v,
        offsetX: (dragRef.current.startOffset.x + dx) | 0,
        offsetY: (dragRef.current.startOffset.y + dy) | 0,
      }));
      return;
    }

    if (dragRef.current?.mode === "token" && dragRef.current.tokenId) {
      const world = screenPxToWorld(mx, my, view, grid, dpr);
      const snapped = { x: Math.floor(world.wx), y: Math.floor(world.wy) };
      setTokens((prev) =>
        prev.map((t) =>
          t.id === dragRef.current.tokenId ? { ...t, x: snapped.x, y: snapped.y } : t
        )
      );
      return;
    }

    if (ghost) {
      const world = screenPxToWorld(mx, my, view, grid, dpr);
      const snapped = {
        gx: Math.floor(world.wx) + 0.5,
        gy: Math.floor(world.wy) + 0.5,
      };
      setGhost((g) => (g ? { ...g, end: snapped } : null));
    }
  };

  const onPointerUp = () => {
    if (ghost) setGhost(null);
    dragRef.current = null;
  };

  const onCanvasDoubleClick = (e) => {
    const c = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * dpr;
    const my = (e.clientY - rect.top) * dpr;
    const hit = hitTestToken(tokens, mx, my, view, grid, dpr);
    if (hit) {
      const newName = window.prompt("Rename token:", hit.name);
      if (newName && newName.trim())
        setTokens((prev) =>
          prev.map((t) => (t.id === hit.id ? { ...t, name: newName.trim() } : t))
        );
    }
  };

  // Keyboard: sidebars + nudge token
  useEffect(() => {
    const onKey = (e) => {
      // Sidebar toggles
      if (e.key === "[") { e.preventDefault(); setShowLeft((s) => !s); return; }
      if (e.key === "]") { e.preventDefault(); setShowRight((s) => !s); return; }

      // Token nudges
      if (!selectedId) return;
      const d =
        {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        }[e.key] || null;
      if (!d) return;
      e.preventDefault();
      const [dx, dy] = d;
      setTokens((prev) =>
        prev.map((t) => (t.id === selectedId ? { ...t, x: t.x + dx, y: t.y + dy } : t))
      );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  // ===== Handlers =====
  function updateToken(id, patch) {
    setTokens((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function addToken(isEnemy = false) {
    const defaultName = isEnemy
      ? `Enemy ${tokens.filter((t) => t.isEnemy).length + 1}`
      : `PC ${tokens.filter((t) => !t.isEnemy).length + 1}`;
    const name = window.prompt("Name this token:", defaultName) || defaultName;
    const color = isEnemy ? "#ef4444" : "#10b981";
    setTokens((t) => [
      ...t,
      {
        id: cryptoRandomId(),
        name,
        x: 2 + Math.floor(Math.random() * 6),
        y: 2 + Math.floor(Math.random() * 6),
        color,
        isEnemy,
        hp: isEnemy ? 10 : 30,
        initiative: 10,
        conditions: [],
      },
    ]);
  }

  function deleteSelected() {
    if (!selectedId) return;
    setTokens((t) => t.filter((x) => x.id !== selectedId));
    setSelectedId(null);
  }

  function centerOnSelected() {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const width = c.width / dpr;
    const height = c.height / dpr;
    const t = tokens.find((x) => x.id === selectedId);
    if (!t) return;
    setView((v) => ({
      ...v,
      offsetX: width / 2 - (t.x + 0.5) * grid.sizePx * v.zoom,
      offsetY: height / 2 - (t.y + 0.5) * grid.sizePx * v.zoom,
    }));
  }

  function sortByInitiative() {
    setTokens((prev) => [...prev].sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0)));
    setTurnIndex(0);
  }

  const nextTurn = () =>
    setTurnIndex((i) => (sortedTokens.length === 0 ? 0 : (i + 1) % sortedTokens.length));
  const prevTurn = () =>
    setTurnIndex((i) => (sortedTokens.length === 0 ? 0 : (i - 1 + sortedTokens.length) % sortedTokens.length));

  function addConditionToSelected(cond) {
    if (!selectedId) return;
    setTokens((prev) =>
      prev.map((t) =>
        t.id === selectedId
          ? { ...t, conditions: Array.from(new Set([...(t.conditions || []), cond])) }
          : t
      )
    );
  }

  function applyAuraPresetToSelected(preset) {
    if (!selectedId) return;
    setTokens(prev => prev.map(t => {
      if (t.id !== selectedId) return t;
      // merge default aura effects (no duplicates)
      const cur = t.auraEffects || [];
      const add = preset.defaultAuraEffects || [];
      const merged = Array.from(new Set([...cur, ...add]));
      return {
        ...t,
        auraPreset: preset.key,
        auraName: preset.defaultName || t.auraName,
        auraRadiusCells: preset.defaultRadiusCells ?? t.auraRadiusCells ?? 2,
        auraPresetValue: preset.key === "paladin" ? (t.auraPresetValue ?? 3) : t.auraPresetValue,
        auraAffects: preset.affects || "allies",
        auraEffects: merged
      };
    }));
  }

  function toggleLingering(type, radiusCellsOrLen) {
    const src = tokens.find((t) => t.id === selectedId);
    if (!src) return;

    const center = { gx: src.x + 0.5, gy: src.y + 0.5 };
    const id = cryptoRandomId();

    // sensible defaults per type
    const defaultAoeEffects =
      type === "circle"
        ? ["Difficult terrain", "Start-of-turn damage"]
        : type === "line"
        ? ["Line damage"]
        : ["Cone damage"]; // cone

    const base = {
      id,
      ownerId: src.id,
      type, // 'circle' | 'line' | 'cone'
      start: center,
      end: { gx: center.gx + radiusCellsOrLen, gy: center.gy },
      enabled: true,
      label: type === "circle" ? "Lingering Circle" : type === "line" ? "Lingering Line" : "Lingering Cone",
      affects: "all",         // 'all' | 'allies' | 'enemies'
      effects: defaultAoeEffects,
    };

    setPersistAOE(arr => [base, ...arr]);
  }

  function loadImage(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setBgImage(img);
    img.src = url;
  }

  // ===== UI =====
  return (
    <div
      className="app"
      style={{
        // CSS vars so we can animate grid-template-columns
        ["--left-w"]: showLeft ? "300px" : "0px",
        ["--right-w"]: showRight ? "360px" : "0px",

        display: "grid",
        gridTemplateColumns: "var(--left-w) 1fr var(--right-w)",
        gridTemplateRows: "auto 1fr",
        height: "100vh",
        maxWidth: "100vw",
        overflow: "hidden",
      }}
    >
      {/* Top Bar */}
      <div
        className="topbar"
        style={{
          gridColumn: "1 / span 3",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: 12,
          borderBottom: "1px solid #e5e7eb",
          background: "#fff",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <strong style={{ fontSize: 18 }}>CritHit Maps — 2D Battle Map</strong>
        <div style={{ display: "flex", gap: 8, marginLeft: 12 }}>
          <button className="btn" onClick={() => setTool("select")} data-active={tool === "select"}>
            Select/Pan (auto)
          </button>
          <button className="btn" onClick={() => setTool("measure")} data-active={tool === "measure"}>
            Measure
          </button>
          <button className="btn" onClick={() => setTool("aoe-circle")} data-active={tool === "aoe-circle"}>
            AOE Circle
          </button>
          <button className="btn" onClick={() => setTool("aoe-line")} data-active={tool === "aoe-line"}>
            AOE Line
          </button>
          <button className="btn" onClick={() => setTool("aoe-cone")} data-active={tool === "aoe-cone"}>
            AOE Cone
          </button>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <button className="btn ghost" onClick={() => setShowLeft((s) => !s)}>
            {showLeft ? "Hide Left [" : "Show Left ["}
          </button>
          <button className="btn ghost" onClick={() => setShowRight((s) => !s)}>
            {showRight ? "Hide Right ]" : "Show Right ]"}
          </button>

          <label className="file">
            <input type="file" accept="image/*" onChange={(e) => e.target.files && loadImage(e.target.files[0])} />
            <span>Upload Map</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            Grid: <input type="checkbox" checked={grid.show} onChange={(e) => setGrid((g) => ({ ...g, show: e.target.checked }))} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            Cell:{" "}
            <input
              type="number"
              min={32}
              max={128}
              value={grid.sizePx}
              onChange={(e) => setGrid((g) => ({ ...g, sizePx: clamp(parseInt(e.target.value), 32, 128) }))}
              style={{ width: 64 }}
            />{" "}
            px
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            Feet/Cell:{" "}
            <input
              type="number"
              min={1}
              max={10}
              value={grid.feetPerCell}
              onChange={(e) => setGrid((g) => ({ ...g, feetPerCell: clamp(parseInt(e.target.value), 1, 10) }))}
              style={{ width: 64 }}
            />
          </label>
          <button className="btn" onClick={() => setView((v) => ({ ...v, zoom: 1, offsetX: 0, offsetY: 0 }))}>
            Reset View
          </button>
        </div>
      </div>

      {/* Left Sidebar */}
      <div
        className="sidebar left"
        aria-hidden={!showLeft}
        style={{
          padding: 12,
          borderRight: showLeft ? "1px solid #e5e7eb" : "1px solid transparent",
          overflowY: "auto",
          overflowX: "hidden",
          visibility: showLeft ? "visible" : "hidden",
          pointerEvents: showLeft ? "auto" : "none",
        }}
      >
        <Section title="Tokens">
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button className="btn" onClick={() => addToken(false)}>+ Add PC</button>
            <button className="btn" onClick={() => addToken(true)}>+ Add Enemy</button>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            {sortedTokens.map((t, idx) => (
              <div key={t.id} className="card" data-selected={t.id === selectedId} onClick={() => setSelectedId(t.id)}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      width: 14, height: 14, borderRadius: 999, background: t.color,
                      display: "inline-block", border: "1px solid #11182733",
                    }}
                  />
                  <strong>{t.name}</strong>
                  {idx === turnIndex && <span className="pill">Current</span>}
                  {t.isEnemy && <span className="pill red">Enemy</span>}
                </div>

                <div className="row">
                  <label>HP</label>
                  <input type="number" value={t.hp ?? 0} onChange={(e) => updateToken(t.id, { hp: parseInt(e.target.value) || 0 })} />
                </div>
                <div className="row">
                  <label>Init</label>
                  <input type="number" value={t.initiative ?? 0} onChange={(e) => updateToken(t.id, { initiative: parseInt(e.target.value) || 0 })} />
                </div>
                <div className="row">
                  <label>Aura r (cells)</label>
                  <input type="number" min={0} value={t.auraRadiusCells ?? 0}
                         onChange={(e) => updateToken(t.id, { auraRadiusCells: clamp(parseInt(e.target.value), 0, 20) })} />
                </div>
                <div className="row">
                  <label>Aura name</label>
                  <input type="text" value={t.auraName ?? ""} onChange={(e) => updateToken(t.id, { auraName: e.target.value })} />
                </div>

                {/* Effects chips */}
                <ChipField
                  label="Effects"
                  values={t.auraEffects || []}
                  onAdd={(val) => updateToken(t.id, { auraEffects: [...(t.auraEffects || []), val] })}
                  onRemove={(idx) => updateToken(t.id, { auraEffects: (t.auraEffects || []).filter((_, i) => i !== idx) })}
                  placeholder="Add effect and press Enter"
                />

                {/* Conditions chips */}
                <ChipField
                  label="Conditions"
                  values={t.conditions || []}
                  onAdd={(val) => updateToken(t.id, { conditions: [...(t.conditions || []), val] })}
                  onRemove={(idx) => updateToken(t.id, { conditions: (t.conditions || []).filter((_, i) => i !== idx) })}
                  placeholder="Add condition and press Enter"
                />

                <div className="row">
                  <label>Note</label>
                  <input type="text" value={t.note ?? ""} onChange={(e) => updateToken(t.id, { note: e.target.value })} />
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn danger" onClick={deleteSelected} disabled={!selectedId}>Delete Selected</button>
            <button className="btn" onClick={centerOnSelected} disabled={!selectedId}>Center</button>
          </div>
        </Section>

        <Section title="Turn Order">
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button className="btn" onClick={sortByInitiative}>Sort by Initiative</button>
            <button className="btn" onClick={prevTurn} disabled={sortedTokens.length === 0}>Prev</button>
            <button className="btn" onClick={nextTurn} disabled={sortedTokens.length === 0}>Next</button>
          </div>
          <ol style={{ paddingLeft: 18 }}>
            {sortedTokens.map((t, idx) => (
              <li key={t.id} style={{ marginBottom: 4 }}>
                <span style={{ fontWeight: idx === turnIndex ? 700 : 400 }}>{t.name}</span>{" "}
                <em style={{ opacity: 0.7 }}>({t.initiative ?? 0})</em>
              </li>
            ))}
          </ol>
        </Section>
      </div>

      {/* Canvas Center */}
      <div style={{ position: "relative", background: "#f8fafc" }}>
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", display: "block", cursor: tool === "select" ? "default" : "crosshair" }}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={onCanvasDoubleClick}
        />

        {/* Edge Tabs */}
        <button
          type="button"
          className="edge-tab left"
          aria-label={showLeft ? "Hide left sidebar" : "Show left sidebar"}
          onClick={() => setShowLeft(s => !s)}
          data-open={showLeft ? "true" : "false"}
        >
          {showLeft ? "«" : "»"}
        </button>

        <button
          type="button"
          className="edge-tab right"
          aria-label={showRight ? "Hide right sidebar" : "Show right sidebar"}
          onClick={() => setShowRight(s => !s)}
          data-open={showRight ? "true" : "false"}
        >
          {showRight ? "»" : "«"}
        </button>
      </div>

      {/* Right Sidebar */}
      <div
        className="sidebar right"
        aria-hidden={!showRight}
        style={{
          padding: 12,
          borderLeft: showRight ? "1px solid #e5e7eb" : "1px solid transparent",
          overflowY: "auto",
          overflowX: "hidden",
          display: "grid",
          gap: 12,
          visibility: showRight ? "visible" : "hidden",
          pointerEvents: showRight ? "auto" : "none",
        }}
      >
        <Section title="Presets (search & apply)">
          <input
            className="search"
            placeholder="Search conditions/auras…"
            value={presetQuery}
            onChange={(e) => setPresetQuery(e.target.value)}
          />
          <div className="preset-grid">
            <div>
              <h4>Conditions</h4>
              <div className="chips">
                {filteredConditions.map((c) => (
                  <button key={c} className="chip" disabled={!selectedId} onClick={() => addConditionToSelected(c)}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <h4>Auras</h4>
              <div className="chips">
                {filteredAuras.map((a) => (
                  <button key={a.key} className="chip" disabled={!selectedId} onClick={() => applyAuraPresetToSelected(a)}>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" disabled={!selectedId} onClick={() => toggleLingering("circle", 2)}>
              + Lingering Circle 10ft
            </button>
            <button className="btn" disabled={!selectedId} onClick={() => toggleLingering("cone", 3)}>
              + Lingering Cone 15ft
            </button>
            <button className="btn" disabled={!selectedId} onClick={() => toggleLingering("line", 6)}>
              + Lingering Line 30ft
            </button>
          </div>
        </Section>

        {/* Lingering AOE Editor */}
        <Section title="Lingering AOEs">
          {persistAOE.length === 0 ? (
            <p style={{ opacity: .6 }}>No lingering AOEs. Add from Presets → “+ Lingering …”</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {persistAOE.map((a) => (
                <div key={a.id} className="card small">
                  <div className="row">
                    <label>Label</label>
                    <input
                      value={a.label || ""}
                      onChange={(e) =>
                        setPersistAOE(prev => prev.map(x => x.id === a.id ? { ...x, label: e.target.value } : x))
                      }
                    />
                  </div>
                  <div className="row">
                    <label>Affects</label>
                    <select
                      value={a.affects || "all"}
                      onChange={(e) =>
                        setPersistAOE(prev => prev.map(x => x.id === a.id ? { ...x, affects: e.target.value } : x))
                      }
                    >
                      <option value="all">Everyone</option>
                      <option value="allies">Allies of caster</option>
                      <option value="enemies">Enemies of caster</option>
                    </select>
                  </div>
                  <ChipField
                    label="Effects"
                    values={a.effects || []}
                    onAdd={(val) =>
                      setPersistAOE(prev => prev.map(x => x.id === a.id ? { ...x, effects: [ ...(x.effects||[]), val ] } : x))
                    }
                    onRemove={(idx) =>
                      setPersistAOE(prev => prev.map(x => x.id === a.id ? { ...x, effects: (x.effects||[]).filter((_,i)=>i!==idx) } : x))
                    }
                    placeholder="Add effect and press Enter"
                  />
                  <div className="row">
                    <label>Enabled</label>
                    <input
                      type="checkbox"
                      checked={!!a.enabled}
                      onChange={(e) =>
                        setPersistAOE(prev => prev.map(x => x.id === a.id ? { ...x, enabled: e.target.checked } : x))
                      }
                    />
                    <button
                      className="btn danger"
                      style={{ marginLeft: "auto" }}
                      onClick={() => setPersistAOE(prev => prev.filter(x => x.id !== a.id))}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Live Effects (by Token)">
          <div style={{ display: "grid", gap: 8 }}>
            {tokens.map((t) => {
              const userConds = t.conditions || [];
              const userEffs = t.auraEffects || [];
              const derived = (tokenEffects[t.id] || []).filter(
                (e) => !userConds.includes(e) && !userEffs.includes(e)
              );
              return (
                <div key={t.id} className="card small">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        width: 12, height: 12, borderRadius: 999, background: t.color,
                        display: "inline-block", border: "1px solid #11182733",
                      }}
                    />
                    <strong>{t.name}</strong>
                    <span style={{ marginLeft: "auto", opacity: .7, fontSize: 12 }}>
                      {tokenEffects[t.id]?.length || 0} effects
                    </span>
                  </div>

                  {/* Removable Conditions */}
                  <div className="row multi">
                    <label>Conditions</label>
                    <div className="chips input">
                      {userConds.length ? (
                        userConds.map((v, i) => (
                          <span key={i} className="chip pillchip">
                            <span className="txt">{v}</span>
                            <button className="x" onClick={() =>
                              updateToken(t.id, { conditions: userConds.filter((_, idx) => idx !== i) })
                            } aria-label={`Remove ${v}`}>×</button>
                          </span>
                        ))
                      ) : (
                        <span style={{ opacity: 0.6 }}>—</span>
                      )}
                    </div>
                  </div>

                  {/* Removable Token Effects */}
                  <div className="row multi">
                    <label>Effects</label>
                    <div className="chips input">
                      {userEffs.length ? (
                        userEffs.map((v, i) => (
                          <span key={i} className="chip pillchip">
                            <span className="txt">{v}</span>
                            <button className="x" onClick={() =>
                              updateToken(t.id, { auraEffects: userEffs.filter((_, idx) => idx !== i) })
                            } aria-label={`Remove ${v}`}>×</button>
                          </span>
                        ))
                      ) : (
                        <span style={{ opacity: 0.6 }}>—</span>
                      )}
                    </div>
                  </div>

                  {/* Read-only derived effects from auras/AOEs */}
                  {derived.length > 0 && (
                    <div className="row multi">
                      <label>From auras/AOE</label>
                      <div className="chips">
                        {derived.map((v, i) => (
                          <span key={i} className="chip" style={{ opacity: 0.85 }}>
                            {v}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="Selected Token">
          {selectedId ? (
            <TokenInspector
              token={tokens.find((t) => t.id === selectedId)}
              onChange={(patch) => updateToken(selectedId, patch)}
            />
          ) : (
            <p style={{ opacity: 0.6 }}>Select a token to edit.</p>
          )}
        </Section>
      </div>

      {/* Styles */}
      <style>{`
        /* Animate grid columns */
        .app { transition: grid-template-columns 220ms ease; }
        html, body { overflow-x: hidden; }

        .btn{padding:6px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;cursor:pointer}
        .btn[data-active="true"]{border-color:#0ea5e9;box-shadow:0 0 0 2px #bae6fd inset}
        .btn.danger{border-color:#fecaca;background:#fff5f5;color:#b91c1c}
        .btn.ghost{background:#fff;border:1px dashed #cbd5e1;color:#334155}
        .btn.ghost:hover{border-style:solid}
        .file input{display:none}
        .file span{padding:6px 10px;border:1px dashed #cbd5e1;border-radius:10px;cursor:pointer}
        .card{border:1px solid #e5e7eb;border-radius:12px;padding:8px;background:#fff}
        .card[data-selected="true"]{box-shadow:0 0 0 2px #fbbf24 inset}
        .card.small{padding:8px}
        .row{display:flex;align-items:center;gap:6px;margin-top:6px}
        .row.multi{align-items:flex-start}
        .row label{opacity:.7;width:120px}
        .row input, .row select{flex:1;padding:4px 6px;border:1px solid #e5e7eb;border-radius:8px}
        .pill{margin-left:8px;font-size:11px;padding:2px 6px;border-radius:999px;background:#ecfeff;border:1px solid #a5f3fc}
        .pill.red{background:#fff1f2;border-color:#fecdd3}
        .search{width:100%;padding:8px;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:8px}
        .preset-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        .chips{display:flex;flex-wrap:wrap;gap:6px}
        .chips.input{align-items:center}
        .chip{padding:4px 8px;border:1px solid #e5e7eb;border-radius:999px;background:#fff}
        .chip.pillchip{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border-radius:999px;background:#fff7df;border:1px solid #e5e7eb}
        .chip.pillchip .x{border:none;background:transparent;cursor:pointer;font-weight:700;color:#7a1c1c}
        .chip-input{min-width:140px;padding:6px 8px;border:1px dashed #e5e7eb;border-radius:10px;background:#fff}

        /* Sidebar slide + fade */
        .sidebar.left, .sidebar.right {
          transition: opacity 200ms ease, transform 220ms ease, border-color 220ms ease;
          will-change: opacity, transform;
          box-sizing: border-box;
        }
        .sidebar * { max-width: 100%; word-break: break-word; }
        .sidebar.left[aria-hidden="true"]  { opacity: 0; transform: translateX(-8px); }
        .sidebar.right[aria-hidden="true"] { opacity: 0; transform: translateX(8px); }

        /* Edge tabs */
        .edge-tab {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          width: 36px; height: 64px;
          border-radius: 10px;
          border: 1px solid #e5e7eb;
          background: #ffffffee;
          backdrop-filter: blur(2px);
          box-shadow: 0 2px 6px rgba(0,0,0,0.08);
          display: grid; place-items: center;
          font-size: 20px; line-height: 1;
          cursor: pointer;
          transition: opacity 200ms ease, transform 220ms ease, border-color 220ms ease;
          z-index: 5;
        }
        .edge-tab:hover { border-color: #cbd5e1; }
        .edge-tab.left  { left: 8px; }
        .edge-tab.right { right: 8px; }
        .edge-tab[data-open="false"].left  { transform: translate(-2px, -50%); }
        .edge-tab[data-open="false"].right { transform: translate( 2px, -50%); }

        @media (max-width: 900px) {
          .edge-tab { width: 30px; height: 56px; }
        }
      `}</style>
    </div>
  );
}

/* ================== Subcomponents ================== */
function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: ".08em", opacity: 0.8, margin: "8px 0" }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function ChipField({ label, values, onAdd, onRemove, placeholder }) {
  return (
    <div className="row multi">
      <label>{label}</label>
      <div className="chips input">
        {values.map((v, i) => (
          <span key={i} className="chip pillchip">
            <span className="txt">{v}</span>
            <button className="x" onClick={() => onRemove(i)} aria-label={`Remove ${v}`}>×</button>
          </span>
        ))}
        <input
          className="chip-input"
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const val = e.currentTarget.value.trim();
              if (val) { onAdd(val); e.currentTarget.value = ""; }
            }
          }}
        />
      </div>
    </div>
  );
}

function TokenInspector({ token, onChange }) {
  if (!token) return null;
  return (
    <div className="card">
      <div className="row"><label>Name</label><input value={token.name} onChange={(e) => onChange({ name: e.target.value })} /></div>
      <div className="row"><label>Color</label><input value={token.color} onChange={(e) => onChange({ color: e.target.value })} /></div>
      <div className="row"><label>Grid X (cell)</label><input type="number" value={token.x} onChange={(e) => onChange({ x: Math.floor(parseInt(e.target.value)) || 0 })} /></div>
      <div className="row"><label>Grid Y (cell)</label><input type="number" value={token.y} onChange={(e) => onChange({ y: Math.floor(parseInt(e.target.value)) || 0 })} /></div>
      <div className="row"><label>HP</label><input type="number" value={token.hp ?? 0} onChange={(e) => onChange({ hp: parseInt(e.target.value) || 0 })} /></div>
      <div className="row"><label>Init</label><input type="number" value={token.initiative ?? 0} onChange={(e) => onChange({ initiative: parseInt(e.target.value) || 0 })} /></div>
      <div className="row"><label>Enemy?</label><input type="checkbox" checked={!!token.isEnemy} onChange={(e) => onChange({ isEnemy: e.target.checked })} /></div>
      <div className="row"><label>Aura r (cells)</label><input type="number" min={0} value={token.auraRadiusCells ?? 0} onChange={(e) => onChange({ auraRadiusCells: clamp(parseInt(e.target.value), 0, 20) })} /></div>
      <div className="row"><label>Aura name</label><input value={token.auraName ?? ""} onChange={(e) => onChange({ auraName: e.target.value })} /></div>

      <ChipField
        label="Effects"
        values={token.auraEffects || []}
        onAdd={(val) => onChange({ auraEffects: [...(token.auraEffects || []), val] })}
        onRemove={(idx) => onChange({ auraEffects: (token.auraEffects || []).filter((_, i) => i !== idx) })}
        placeholder="Add effect and press Enter"
      />

      <ChipField
        label="Conditions"
        values={token.conditions || []}
        onAdd={(val) => onChange({ conditions: [...(token.conditions || []), val] })}
        onRemove={(idx) => onChange({ conditions: (token.conditions || []).filter((_, i) => i !== idx) })}
        placeholder="Add condition and press Enter"
      />

      <div className="row"><label>Note</label><input value={token.note ?? ""} onChange={(e) => onChange({ note: e.target.value })} /></div>
    </div>
  );
}

/* ================== Drawing Helpers ================== */
function drawGrid(ctx, width, height, view, grid, dpr) {
  const cell = grid.sizePx * view.zoom * dpr;
  const ox = (view.offsetX * dpr) % cell;
  const oy = (view.offsetY * dpr) % cell;
  ctx.save();
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = ox; x <= width; x += cell) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, height); }
  for (let y = oy; y <= height; y += cell) { ctx.moveTo(0, y + 0.5); ctx.lineTo(width, y + 0.5); }
  ctx.stroke();
  ctx.restore();
}

function worldToScreenPx(gx, gy, view, grid, dpr) {
  const cell = grid.sizePx * view.zoom * dpr;
  return { x: gx * cell + view.offsetX * dpr, y: gy * cell + view.offsetY * dpr };
}
function screenPxToWorld(sx, sy, view, grid, dpr) {
  const cell = grid.sizePx * view.zoom * dpr;
  return { wx: (sx - view.offsetX * dpr) / cell, wy: (sy - view.offsetY * dpr) / cell };
}

function drawLabel(ctx, text, x, y) {
  const dpr = window.devicePixelRatio || 1;
  ctx.save();
  ctx.font = `${12 * dpr}px ui-sans-serif, system-ui, sans-serif`;
  const metrics = ctx.measureText(text);
  const pad = 6 * dpr;
  ctx.fillStyle = "rgba(17,24,39,0.8)";
  ctx.fillRect(x - metrics.width / 2 - pad, y - 14 - pad / 2, metrics.width + pad * 2, 16 + pad);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawAOE(ctx, aoe, view, grid, dpr) {
  const start = worldToScreenPx(aoe.start.gx, aoe.start.gy, view, grid, dpr);
  const end   = worldToScreenPx(aoe.end.gx, aoe.end.gy, view, grid, dpr);
  const distCells = Math.hypot(aoe.end.gx - aoe.start.gx, aoe.end.gy - aoe.start.gy);
  const distFeet  = distCells * grid.feetPerCell;

  ctx.save();
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 8]);
  ctx.strokeStyle = "#0ea5e9";
  ctx.fillStyle = "rgba(14,165,233,0.2)";

  if (aoe.type === "circle") {
    const r = distCells * grid.sizePx * view.zoom * dpr;
    ctx.beginPath(); ctx.arc(start.x, start.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    drawLabel(ctx, `${round(distFeet)} ft radius`, start.x, start.y - r - 10 * dpr);
  } else if (aoe.type === "line") {
    ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
    drawLabel(ctx, `${round(distFeet)} ft line`, (start.x + end.x) / 2, (start.y + end.y) / 2 - 10 * dpr);
  } else if (aoe.type === "cone") {
    const angle = Math.atan2(aoe.end.gy - aoe.start.gy, aoe.end.gx - aoe.start.gx);
    const spread = (60 * Math.PI) / 180;
    const lenPx = distCells * grid.sizePx * view.zoom * dpr;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(start.x + Math.cos(angle - spread / 2) * lenPx, start.y + Math.sin(angle - spread / 2) * lenPx);
    ctx.lineTo(start.x + Math.cos(angle + spread / 2) * lenPx, start.y + Math.sin(angle + spread / 2) * lenPx);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    drawLabel(ctx, `${round(distFeet)} ft cone`, start.x, start.y - 10 * dpr);
  }
  ctx.restore();
}

function drawGhost(ctx, ghost, view, grid, dpr) {
  const start = worldToScreenPx(ghost.start.gx, ghost.start.gy, view, grid, dpr);
  const end   = worldToScreenPx(ghost.end.gx, ghost.end.gy, view, grid, dpr);
  const distCells = Math.hypot(ghost.end.gx - ghost.start.gx, ghost.end.gy - ghost.start.gy);
  const distFeet  = distCells * grid.feetPerCell;

  ctx.save();
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 8]);
  ctx.strokeStyle = "#0ea5e9";
  ctx.fillStyle = "rgba(14,165,233,0.2)";

  if (ghost.type === "measure") {
    ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
    drawLabel(ctx, `${round(distFeet)} ft`, (start.x + end.x) / 2, (start.y + end.y) / 2 - 10 * dpr);
  }
  if (ghost.type === "circle") {
    const r = distCells * grid.sizePx * view.zoom * dpr;
    ctx.beginPath(); ctx.arc(start.x, start.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    drawLabel(ctx, `${round(distFeet)} ft radius`, start.x, start.y - r - 10 * dpr);
  }
  if (ghost.type === "line") {
    ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
    drawLabel(ctx, `${round(distFeet)} ft line`, (start.x + end.x) / 2, (start.y + end.y) / 2 - 10 * dpr);
  }
  if (ghost.type === "cone") {
    const angle = Math.atan2(ghost.end.gy - ghost.start.gy, ghost.end.gx - ghost.start.gx);
    const spread = (60 * Math.PI) / 180;
    const lenPx = distCells * grid.sizePx * view.zoom * dpr;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(start.x + Math.cos(angle - spread / 2) * lenPx, start.y + Math.sin(angle - spread / 2) * lenPx);
    ctx.lineTo(start.x + Math.cos(angle + spread / 2) * lenPx, start.y + Math.sin(angle + spread / 2) * lenPx);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    drawLabel(ctx, `${round(distFeet)} ft cone`, start.x, start.y - 10 * dpr);
  }
  ctx.restore();
}

/* ================== Effects & Presets ================== */
const CONDITION_PRESETS = [
  "Blinded","Charmed","Deafened","Frightened","Grappled","Incapacitated","Invisible","Paralyzed",
  "Petrified","Poisoned","Prone","Restrained","Stunned","Unconscious","Concentrating","Dodge",
  "Disengage","Dashing","Ready","Hide","Advantage (attacks)","Advantage (DEX saves)","Advantage (WIS saves)",
  "Disadvantage (attacks)","Sneak Attack Ready","Target Marked","Raging",
];

const AURA_PRESETS = [
  { key: "none", label: "None" },
  // Allies
  { key: "paladin", label: "Aura of Protection (saves +X)", defaultRadiusCells: 2, defaultName: "Aura of Protection", affects: "allies", defaultAuraEffects: ["Saving throw bonus (+X)"] },
  { key: "aura-warding", label: "Aura of Warding (resistance to spell damage)", defaultRadiusCells: 2, defaultName: "Aura of Warding", affects: "allies", defaultAuraEffects: ["Resistance to spell damage"] },
  { key: "beacon-of-hope", label: "Beacon of Hope (adv WIS/Death saves; max healing)", defaultRadiusCells: 6, defaultName: "Beacon of Hope", affects: "allies", defaultAuraEffects: ["Advantage on WIS/Death saves", "Max healing received"] },
  { key: "haste-lite", label: "Haste (partial: +2 AC; adv DEX saves)", defaultRadiusCells: 6, defaultName: "Haste", affects: "allies", defaultAuraEffects: ["+2 AC", "Advantage on DEX saves"] },
  { key: "bless", label: "Bless (+1d4 atk & saves)", defaultRadiusCells: 6, defaultName: "Bless", affects: "allies", defaultAuraEffects: ["+1d4 to attack rolls", "+1d4 to saving throws"] },
  // Enemies
  { key: "bane", label: "Bane (-1d4 atk & saves)", defaultRadiusCells: 6, defaultName: "Bane", affects: "enemies", defaultAuraEffects: ["-1d4 to attack rolls", "-1d4 to saving throws"] },
  { key: "spirit-guardians", label: "Spirit Guardians (damage in aura; difficult terrain)", defaultRadiusCells: 3, defaultName: "Spirit Guardians", affects: "enemies", defaultAuraEffects: ["Difficult terrain", "Start-of-turn damage"] },
  // Protection
  { key: "prot-evil-good", label: "Protection from Evil & Good (disadvantage vs types)", defaultRadiusCells: 1, defaultName: "Prot. Evil/Good", affects: "allies", defaultAuraEffects: ["Disadv. to be attacked (certain types)"] },
];

function computeAuraIndex(tokens) {
  const auras = [];
  for (const t of tokens) {
    if (t.auraRadiusCells && t.auraRadiusCells > 0 && t.auraPreset && t.auraPreset !== "none") {
      auras.push({
        ownerId: t.id,
        ownerName: t.name,
        ownerIsEnemy: !!t.isEnemy,
        affects: t.auraAffects || "allies",
        r: t.auraRadiusCells,
        x: t.x,
        y: t.y,
        preset: t.auraPreset,
        presetValue: t.auraPresetValue,
        name: t.auraName,
        effects: t.auraEffects,
      });
    }
  }
  return auras;
}

function computeTokenEffects(tokens, auras, aoes) {
  const out = {};
  const byId = Object.fromEntries(tokens.map(t => [t.id, t]));

  for (const t of tokens) {
    const effects = [];

    // 1) AURAS
    for (const a of auras) {
      const owner = byId[a.ownerId];
      if (!isAffectedBy(a.affects, owner, t)) continue;
      if (!tokenInsideCircle(t, { gx: a.x + 0.5, gy: a.y + 0.5 }, a.r)) continue;

      switch (a.preset) {
        case "paladin": {
          const bonus = Number.isFinite(a.presetValue) ? a.presetValue : 3;
          effects.push(`+${bonus} to all saving throws (Aura of Protection – ${a.ownerName})`);
          break;
        }
        case "bless": effects.push(`+1d4 to attack rolls & saving throws (Bless – ${a.ownerName})`); break;
        case "bane":  effects.push(`-1d4 to attack rolls & saving throws (Bane – ${a.ownerName})`); break;
        case "prot-evil-good": effects.push(`Disadvantage for certain types to attack (Prot. Evil/Good – ${a.ownerName})`); break;
        case "spirit-guardians": effects.push(`Takes damage on start; difficult terrain (Spirit Guardians – ${a.ownerName})`); break;
        case "aura-warding": effects.push(`Resistance to spell damage (Aura of Warding – ${a.ownerName})`); break;
        case "beacon-of-hope": effects.push(`Adv. WIS/Death saves; max healing (Beacon of Hope – ${a.ownerName})`); break;
        case "haste-lite": effects.push(`+2 AC; advantage on DEX saves (Haste – ${a.ownerName})`); break;
      }
      if (a.name) effects.push(`${a.name} (${a.ownerName})`);
      if (a.effects?.length) effects.push(...a.effects);
    }

    // 2) LINGERING AOEs
    for (const aoe of aoes) {
      if (!aoe.enabled) continue;
      const owner = byId[aoe.ownerId];
      if (!isAffectedBy(aoe.affects || "all", owner, t)) continue;

      let inside = false;
      if (aoe.type === "circle") {
        const radiusCells = Math.hypot(aoe.end.gx - aoe.start.gx, aoe.end.gy - aoe.start.gy);
        inside = tokenInsideCircle(t, aoe.start, radiusCells);
      } else if (aoe.type === "line") {
        inside = tokenInsideLine(t, aoe.start, aoe.end, 0.5);
      } else if (aoe.type === "cone") {
        inside = tokenInsideCone(t, aoe.start, aoe.end, 60);
      }
      if (!inside) continue;

      if (aoe.label) effects.push(`${aoe.label}`);
      if (Array.isArray(aoe.effects)) effects.push(...aoe.effects);
    }

    // 3) User-set token conditions also appear
    for (const cond of t.conditions || []) effects.push(cond);

    out[t.id] = effects;
  }
  return out;
}

/* ================== Geometry & Utils ================== */
function isAllyOf(a, b) { return !!a && !!b && (!!a.isEnemy === !!b.isEnemy); }
function isAffectedBy(affects, owner, target) {
  if (affects === "all") return true;
  if (!owner || !target) return false;
  return affects === "allies" ? isAllyOf(owner, target) : !isAllyOf(owner, target);
}
function tokenInsideCircle(token, center, radiusCells) {
  const dx = (token.x + 0.5) - center.gx;
  const dy = (token.y + 0.5) - center.gy;
  return Math.hypot(dx, dy) <= radiusCells + 1e-6;
}
function distPointToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const ab2 = abx*abx + aby*aby || 1e-9;
  const t = Math.max(0, Math.min(1, (apx*abx + apy*aby) / ab2));
  const cx = ax + t*abx, cy = ay + t*aby;
  return Math.hypot(px - cx, py - cy);
}
function tokenInsideLine(token, start, end, halfWidthCells = 0.5) {
  const px = token.x + 0.5, py = token.y + 0.5;
  const d = distPointToSegment(px, py, start.gx, start.gy, end.gx, end.gy);
  return d <= halfWidthCells + 1e-6;
}
function tokenInsideCone(token, start, end, spreadDeg = 60) {
  const px = token.x + 0.5, py = token.y + 0.5;
  const vx = end.gx - start.gx, vy = end.gy - start.gy;
  const ux = px - start.gx,  uy = py - start.gy;
  const lenV = Math.hypot(vx, vy) || 1e-9;
  const lenU = Math.hypot(ux, uy);
  if (lenU > lenV + 1e-6) return false; // beyond length
  const cos = (vx*ux + vy*uy) / (lenV * lenU || 1e-9);
  const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
  const half = (spreadDeg * Math.PI/180) / 2;
  return angle <= half + 1e-6;
}
function clamp(n, a, b) { const num = Number(n); if (!Number.isFinite(num)) return a; return Math.max(a, Math.min(b, num)); }
function round(n, prec = 1) { const p = Math.pow(10, prec); return Math.round(n * p) / p; }
function cryptoRandomId() {
  try {
    const g = typeof globalThis !== "undefined" ? globalThis : window;
    if (g && g.crypto && typeof g.crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(8);
      g.crypto.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch (_) {}
  // fallback
  let out = "";
  for (let i = 0; i < 8; i++) out += ((Math.random() * 256) | 0).toString(16).padStart(2, "0");
  return out;
}
function hitTestToken(tokens, mx, my, view, grid, dpr) {
  const cell = grid.sizePx * view.zoom * dpr;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    const cx = (t.x + 0.5) * cell + view.offsetX * dpr;
    const cy = (t.y + 0.5) * cell + view.offsetY * dpr;
    const r = Math.max(2, cell / 2 - 2);
    if (Math.hypot(mx - cx, my - cy) <= r) return t;
  }
  return null;
}

/* ================== Advantage / Sneak Highlight ================== */
function computeHighlightTargets(selectedToken, tokens) {
  const out = new Set();
  if (!selectedToken) return out;
  const hasAdv = (selectedToken.conditions || []).includes("Advantage (attacks)");
  const hasSneak = (selectedToken.conditions || []).includes("Sneak Attack Ready");
  if (hasAdv) {
    for (const t of tokens) if (t.isEnemy) out.add(t.id);
  }
  if (hasSneak) {
    for (const enemy of tokens.filter((t) => t.isEnemy)) {
      if (hasAdv) { out.add(enemy.id); continue; }
      const allyAdjacent = tokens.some(
        (p) => !p.isEnemy && p.id !== selectedToken.id && Math.hypot(p.x - enemy.x, p.y - enemy.y) <= 1.01
      );
      if (allyAdjacent) out.add(enemy.id);
    }
  }
  return out;
}

/* ================== Dev Self-tests (non-fatal) ================== */
if (import.meta.env?.DEV) {
  try {
    const a = cryptoRandomId(), b = cryptoRandomId();
    console.assert(/^[0-9a-f]{16}$/i.test(a) && a !== b, "cryptoRandomId format/uniqueness");

    const pals = [{ id: "A", name: "Pally", x: 0, y: 0, auraRadiusCells: 2, auraPreset: "paladin", auraPresetValue: 3 }];
    const pcs  = [{ id: "B", name: "Rogue", x: 1, y: 1 }];
    const eff  = computeTokenEffects([...pals, ...pcs], computeAuraIndex([...pals, ...pcs]), []);
    console.assert(eff["B"].some((s) => s.includes("saving throws")), "Paladin aura applies");

    const rogue = { id: "R", name: "Rogue", x: 0, y: 0, conditions: ["Sneak Attack Ready"] };
    const ally = { id: "Al", name: "Fighter", x: 1, y: 0 };
    const foeNear = { id: "E1", isEnemy: true, x: 1, y: 0 };
    const foeFar  = { id: "E2", isEnemy: true, x: 5, y: 5 };
    const hs = computeHighlightTargets(rogue, [rogue, ally, foeNear, foeFar]);
    console.assert(hs.has("E1") && !hs.has("E2"), "Sneak attack highlight ok");

    console.log("✅ Dev self-tests passed");
  } catch (err) {
    console.warn("⚠️ Self-tests failed:", err);
  }
}