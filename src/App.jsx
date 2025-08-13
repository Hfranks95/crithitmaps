// src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * CritHit Maps — 2D Battle Map (single-file React)
 * - Circular tokens fill their grid cell (optionally image-cropped)
 * - Select vs pan auto: click token selects; click empty grid pans
 * - Measurement & AOEs snap to cell centers and may start over tokens
 * - Lingering AOE zones that are draggable & editable
 * - Aura & AOE derived effects auto-apply to tokens in range
 * - Right sidebar is search-only for presets (conditions + auras/zones)
 * - Import/Export presets (JSON), merged & deduped with built-ins
 * - Left sidebar: tokens list with initiative order & controls
 * - Hidden condition prompts stealth roll; badge shown on token
 * - Edge tabs & topbar buttons to hide/show sidebars
 * - Flanking (DMG variant): auto “advantage” against flanked targets + highlight
 */

/** @typedef {{
  id:string,name:string,x:number,y:number,color:string,isEnemy?:boolean,hp?:number,note?:string,initiative?:number,
  auraRadiusCells?:number,auraName?:string,auraEffects?:string[],auraPreset?:string,auraPresetValue?:number,auraAffects?:'all'|'allies'|'enemies',
  auraPresets?:Array<{key:string,r:number,affects:'all'|'allies'|'enemies',name?:string,effects?:string[],value?:number}>,
  conditions?:string[], imageUrl?:string, imageObj?:HTMLImageElement|null, stealthRoll?:number|null
}} Token */

export default function BattleMapApp() {
  // ===== Core State =====
  const canvasRef = useRef(null);
  const [view, setView] = useState({ zoom: 1, offsetX: 0, offsetY: 0 });
  const [grid, setGrid] = useState({ sizePx: 64, show: true, feetPerCell: 5 });
  const [bgImage, setBgImage] = useState(null);

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
      // New multi-aura array (legacy fields above are kept for back-compat)
      auraPresets: [
        {
          key: "paladin",
          r: 2,
          affects: "allies",
          name: "Aura of Protection",
          effects: ["Saving throw bonus (+X)"],
          value: 3,
        },
      ],
      conditions: [],
      imageUrl: "",
      imageObj: null,
      stealthRoll: null,
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
      imageUrl: "",
      imageObj: null,
      stealthRoll: null,
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
      imageUrl: "",
      imageObj: null,
      stealthRoll: null,
    },
  ]);

  const [selectedId, setSelectedId] = useState(null);
  const [tool, setTool] = useState("select"); // select | measure | aoe-circle | aoe-line | aoe-cone
  const [ghost, setGhost] = useState(null); // {type, start:{gx,gy}, end:{gx,gy}}
  /** @type {Array<{id:string,ownerId:string,type:'circle'|'line'|'cone',start:{gx:number,gy:number},end:{gx:number,gy:number},enabled:boolean,label?:string,affects?:'all'|'allies'|'enemies',effects?:string[]}>} */
  const [persistAOE, setPersistAOE] = useState([]);
  const [selectedAoeId, setSelectedAoeId] = useState(null);
  const dragRef = useRef(null); // { mode:'token'|'pan'|'aoe', tokenId?, aoeId?, startMouse, startMouseWorld?, startToken?, startAOE?, startOffset? }

  // Sidebar visibility + responsive auto-collapse
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 1100) {
        setShowLeft(false);
        setShowRight(false);
      }
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

  // ===== Preset search + Import/Export =====
  const [presetQuery, setPresetQuery] = useState("");
  // Imported packs (merged with built-ins for search)
  const [importedConditions, setImportedConditions] = useState([]);
  const [importedAuras, setImportedAuras] = useState([]);

  const ALL_CONDITIONS = useMemo(
    () => dedupeStrings([...CONDITION_PRESETS, ...importedConditions]),
    [importedConditions]
  );
  const ALL_AURAS = useMemo(
    () => dedupeAuras([...AURA_PRESETS, ...importedAuras]),
    [importedAuras]
  );

  const filteredConditions = useMemo(
    () =>
      ALL_CONDITIONS.filter((c) =>
        c.toLowerCase().includes(presetQuery.toLowerCase())
      ),
    [presetQuery, ALL_CONDITIONS]
  );
  const filteredAuras = useMemo(
    () =>
      ALL_AURAS.filter((a) =>
        (a.label + " " + (a.tags?.join(" ") || ""))
          .toLowerCase()
          .includes(presetQuery.toLowerCase())
      ),
    [presetQuery, ALL_AURAS]
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
    anitJagg(c); // ensure crisp lines on some browsers
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.width,
      H = c.height;

    ctx.clearRect(0, 0, W, H);

    const cellCss = grid.sizePx * view.zoom; // CSS px per cell
    const cellPx = cellCss * dpr; // device px per cell

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

    // Auras (under tokens) — support multiple
    for (const t of tokens) {
      const entries = getTokenAuraEntries(t);
      if (!entries.length) continue;
      const cx = (t.x + 0.5) * cellPx + view.offsetX * dpr;
      const cy = (t.y + 0.5) * cellPx + view.offsetY * dpr;
      for (const [i, a] of entries.entries()) {
        const rPx = a.r * cellPx;
        ctx.save();
        ctx.globalAlpha = 0.1 + Math.min(0.06 * i, 0.2); // layered visibility
        ctx.fillStyle = t.isEnemy ? "#ef4444" : "#22c55e";
        ctx.beginPath();
        ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // Grid
    if (grid.show) drawGrid(ctx, W, H, view, grid, dpr);

    // Persistent AOEs
    for (const a of persistAOE)
      if (a.enabled) drawAOE(ctx, a, view, grid, dpr, a.id === selectedAoeId);

    // Highlights (advantage / sneak attack / flanking)
    const selectedToken = tokens.find((t) => t.id === selectedId);
    const highlightIds = computeHighlightTargets(selectedToken, tokens);

    // Tokens (circles filling the cell) + circular image crop if provided
    for (const t of tokens) {
      const cx = (t.x + 0.5) * cellPx + view.offsetX * dpr;
      const cy = (t.y + 0.5) * cellPx + view.offsetY * dpr;
      const r = Math.max(2, cellPx / 2 - 2);
      const isSel = t.id === selectedId;
      const isHL = highlightIds.has(t.id);
      const isHidden = (t.conditions || []).includes("Hidden");

      ctx.save();

      // fade hidden a bit
      if (isHidden) ctx.globalAlpha = 0.85;

      // circle clip path
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();

      if (t.imageObj && t.imageObj.complete) {
        // draw image as aspect-fill in the circle square (2r x 2r)
        const side = r * 2;
        const iw = t.imageObj.naturalWidth || t.imageObj.width || 1;
        const ih = t.imageObj.naturalHeight || t.imageObj.height || 1;
        const scale = Math.max(side / iw, side / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        const dx = cx - dw / 2;
        const dy = cy - dh / 2;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(t.imageObj, dx, dy, dw, dh);
      } else {
        // fallback fill color
        ctx.fillStyle = t.color;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      }

      // restore to draw ring etc
      ctx.restore();

      // ring
      ctx.lineWidth = isSel ? 6 : 2;
      if (isHidden) {
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = "#6b7280"; // muted gray
      } else {
        ctx.setLineDash([]);
        ctx.strokeStyle = isSel ? "#f59e0b" : isHL ? "#16a34a" : "#111827";
      }
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      // name label (skip if hidden)
      if (!isHidden) {
        ctx.font = `${14 * dpr}px ui-serif, Georgia, serif`;
        ctx.fillStyle = "#1b130b";
        ctx.textAlign = "center";
        ctx.fillText(t.name, cx, cy - r - 8);
      }

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
      const effCount = tokenEffects[t.id]?.length || 0;
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

      // stealth badge (top-right) if Hidden
      if (isHidden) {
        const badgeR = 11 * dpr;
        const bx = cx + r - badgeR - 3 * dpr;
        const by = cy - r + badgeR + 3 * dpr;
        ctx.beginPath();
        ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
        ctx.fillStyle = "#111827";
        ctx.fill();
        ctx.font = `${10 * dpr}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const txt = t.stealthRoll != null ? `S:${t.stealthRoll}` : "S:?";
        ctx.fillText(txt, bx, by + 0.5);
      }

      ctx.restore();
    }

    // Ghost (measure / aoe)
    if (ghost) drawGhost(ctx, ghost, view, grid, dpr);
  }, [bgImage, grid, tokens, view, selectedId, ghost, persistAOE, tokenEffects, selectedAoeId]);

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

    // If a measurement/AOE tool is active, start from the grid center under the pointer — even if over a token
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

    // Otherwise, in Select mode try to select/drag a token first
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

    // Try to hit-test a lingering AOE to select/drag it
    const world = screenPxToWorld(mx, my, view, grid, dpr);
    const aoeHit = hitTestAOE(persistAOE, world.wx, world.wy);
    if (aoeHit) {
      setSelectedAoeId(aoeHit.id);
      dragRef.current = {
        mode: "aoe",
        aoeId: aoeHit.id,
        startMouseWorld: { wx: world.wx, wy: world.wy },
        startAOE: JSON.parse(
          JSON.stringify({ start: aoeHit.start, end: aoeHit.end })
        ),
      };
      e.target.setPointerCapture?.(e.pointerId);
      return;
    }

    // Otherwise, pan the map
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
          t.id === dragRef.current.tokenId
            ? { ...t, x: snapped.x, y: snapped.y }
            : t
        )
      );
      return;
    }

    if (dragRef.current?.mode === "aoe" && dragRef.current.aoeId) {
      const world = screenPxToWorld(mx, my, view, grid, dpr);
      const dxCells =
        Math.floor(world.wx) - Math.floor(dragRef.current.startMouseWorld.wx);
      const dyCells =
        Math.floor(world.wy) - Math.floor(dragRef.current.startMouseWorld.wy);
      const snap = (v) => Math.floor(v) + 0.5;

      const start0 = dragRef.current.startAOE.start;
      const end0 = dragRef.current.startAOE.end;

      const newStart = {
        gx: snap(start0.gx + dxCells),
        gy: snap(start0.gy + dyCells),
      };
      const newEnd = {
        gx: snap(end0.gx + dxCells),
        gy: snap(end0.gy + dyCells),
      };

      setPersistAOE((prev) =>
        prev.map((a) =>
          a.id === dragRef.current.aoeId ? { ...a, start: newStart, end: newEnd } : a
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
      if (e.key === "[") {
        e.preventDefault();
        setShowLeft((s) => !s);
        return;
      }
      if (e.key === "]") {
        e.preventDefault();
        setShowRight((s) => !s);
        return;
      }

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
        prev.map((t) =>
          t.id === selectedId ? { ...t, x: t.x + dx, y: t.y + dy } : t
        )
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
        imageUrl: "",
        imageObj: null,
        stealthRoll: null,
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
    setTokens((prev) =>
      [...prev].sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0))
    );
    setTurnIndex(0);
  }

  const nextTurn = () =>
    setTurnIndex((i) =>
      sortedTokens.length === 0 ? 0 : (i + 1) % sortedTokens.length
    );
  const prevTurn = () =>
    setTurnIndex((i) =>
      sortedTokens.length === 0 ? 0 : (i - 1 + sortedTokens.length) % sortedTokens.length
    );

  function addConditionToSelected(cond) {
    if (!selectedId) return;
    setTokens((prev) =>
      prev.map((t) => {
        if (t.id !== selectedId) return t;
        const nextConds = Array.from(new Set([...(t.conditions || []), cond]));
        // If adding Hidden, prompt for stealth roll
        if (
          cond === "Hidden" &&
          (t.stealthRoll == null || Number.isNaN(t.stealthRoll))
        ) {
          const val = window.prompt("Stealth roll for Hidden?", "");
          const num = val != null && val.trim() !== "" ? Number(val) : null;
          return {
            ...t,
            conditions: nextConds,
            stealthRoll: Number.isFinite(num) ? num : t.stealthRoll ?? null,
          };
        }
        return { ...t, conditions: nextConds };
      })
    );
  }

  // toggle (multi) aura preset in token.auraPresets[]
  function applyAuraPresetToSelected(preset) {
    if (!selectedId) return;
    setTokens((prev) =>
      prev.map((t) => {
        if (t.id !== selectedId) return t;

        const cur = Array.isArray(t.auraPresets)
          ? [...t.auraPresets]
          : getTokenAuraEntries(t);
        const existsIdx = cur.findIndex((e) => e.key === preset.key);

        if (existsIdx >= 0) {
          // remove this aura (toggle off)
          cur.splice(existsIdx, 1);
        } else {
          // add with defaults
          cur.push({
            key: preset.key,
            r: Number.isFinite(preset.defaultRadiusCells)
              ? preset.defaultRadiusCells
              : 2,
            affects: preset.affects || "allies",
            name: preset.defaultName || preset.label,
            effects: Array.isArray(preset.defaultAuraEffects)
              ? preset.defaultAuraEffects.slice()
              : [],
            value: preset.key === "paladin" ? t.auraPresetValue ?? 3 : undefined,
          });
        }

        // clear legacy single fields; store new array
        return {
          ...t,
          auraPresets: cur,
          auraPreset: "none",
          auraRadiusCells: 0,
          auraName: "",
        };
      })
    );
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
      label:
        type === "circle"
          ? "Lingering Circle"
          : type === "line"
          ? "Lingering Line"
          : "Lingering Cone",
      affects: "all", // 'all' | 'allies' | 'enemies'
      effects: defaultAoeEffects,
    };

    setPersistAOE((arr) => [base, ...arr]);
  }

  function loadImage(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setBgImage(img);
    img.src = url;
  }

  // per-token image upload
  function loadTokenImage(file, tokenId) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setTokens((prev) =>
        prev.map((t) =>
          t.id === tokenId ? { ...t, imageUrl: url, imageObj: img } : t
        )
      );
    };
    img.src = url;
  }
  function clearTokenImage(tokenId) {
    setTokens((prev) =>
      prev.map((t) =>
        t.id === tokenId ? { ...t, imageUrl: "", imageObj: null } : t
      )
    );
  }

  // ===== Import/Export Presets =====
  function handleImportPresets(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || "{}"));
        const conds = Array.isArray(data.conditions)
          ? data.conditions.filter((x) => typeof x === "string" && x.trim())
          : [];
        const auras = Array.isArray(data.auras)
          ? data.auras.filter(isAuraLike).map(normalizeAura)
          : [];
        setImportedConditions((prev) => dedupeStrings([...prev, ...conds]));
        setImportedAuras((prev) => dedupeAuras([...prev, ...auras]));
        alert(
          `Imported ${conds.length} conditions and ${auras.length} auras. They are now searchable.`
        );
      } catch (err) {
        console.error(err);
        alert("Invalid JSON file. Expect keys: conditions[], auras[].");
      }
    };
    reader.readAsText(file);
  }

  function handleExportPresets() {
    const data = {
      conditions: importedConditions,
      auras: importedAuras,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "crithit-presets.json";
    a.click();
    URL.revokeObjectURL(url);
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
          <button
            className="btn"
            onClick={() => setTool("select")}
            data-active={tool === "select"}
          >
            Select/Pan (auto)
          </button>
          <button
            className="btn"
            onClick={() => setTool("measure")}
            data-active={tool === "measure"}
          >
            Measure
          </button>
          <button
            className="btn"
            onClick={() => setTool("aoe-circle")}
            data-active={tool === "aoe-circle"}
          >
            AOE Circle
          </button>
          <button
            className="btn"
            onClick={() => setTool("aoe-line")}
            data-active={tool === "aoe-line"}
          >
            AOE Line
          </button>
          <button
            className="btn"
            onClick={() => setTool("aoe-cone")}
            data-active={tool === "aoe-cone"}
          >
            AOE Cone
          </button>
        </div>
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <button className="btn ghost" onClick={() => setShowLeft((s) => !s)}>
            {showLeft ? "Hide Left [" : "Show Left ["}
          </button>
          <button className="btn ghost" onClick={() => setShowRight((s) => !s)}>
            {showRight ? "Hide Right ]" : "Show Right ]"}
          </button>

          <label className="file">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => e.target.files && loadImage(e.target.files[0])}
            />
            <span>Upload Map</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            Grid:{" "}
            <input
              type="checkbox"
              checked={grid.show}
              onChange={(e) =>
                setGrid((g) => ({ ...g, show: e.target.checked }))
              }
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            Cell:{" "}
            <input
              type="number"
              min={32}
              max={128}
              value={grid.sizePx}
              onChange={(e) =>
                setGrid((g) => ({
                  ...g,
                  sizePx: clamp(parseInt(e.target.value), 32, 128),
                }))
              }
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
              onChange={(e) =>
                setGrid((g) => ({
                  ...g,
                  feetPerCell: clamp(parseInt(e.target.value), 1, 10),
                }))
              }
              style={{ width: 64 }}
            />
          </label>
          <button
            className="btn"
            onClick={() =>
              setView((v) => ({ ...v, zoom: 1, offsetX: 0, offsetY: 0 }))
            }
          >
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
            <button className="btn" onClick={() => addToken(false)}>
              + Add PC
            </button>
            <button className="btn" onClick={() => addToken(true)}>
              + Add Enemy
            </button>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            {sortedTokens.map((t, idx) => (
              <div
                key={t.id}
                className="card"
                data-selected={t.id === selectedId}
                onClick={() => setSelectedId(t.id)}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 999,
                      background: t.color,
                      display: "inline-block",
                      border: "1px solid #11182733",
                    }}
                  />
                  <strong>{t.name}</strong>
                  {idx === turnIndex && <span className="pill">Current</span>}
                  {t.isEnemy && <span className="pill red">Enemy</span>}
                </div>

                <div className="row">
                  <label>HP</label>
                  <input
                    type="number"
                    value={t.hp ?? 0}
                    onChange={(e) =>
                      updateToken(t.id, { hp: parseInt(e.target.value) || 0 })
                    }
                  />
                </div>
                <div className="row">
                  <label>Init</label>
                  <input
                    type="number"
                    value={t.initiative ?? 0}
                    onChange={(e) =>
                      updateToken(t.id, {
                        initiative: parseInt(e.target.value) || 0,
                      })
                    }
                  />
                </div>

                {/* Quick token image upload + clear */}
                <div className="row">
                  <label>Token image</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <label className="file small">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) =>
                          e.target.files && loadTokenImage(e.target.files[0], t.id)
                        }
                      />
                      <span>Upload</span>
                    </label>
                    {t.imageObj && (
                      <button
                        className="btn danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          clearTokenImage(t.id);
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {(t.conditions || []).includes("Hidden") && (
                  <div className="row">
                    <label>Stealth</label>
                    <input
                      type="number"
                      value={t.stealthRoll ?? 0}
                      onChange={(e) =>
                        updateToken(t.id, {
                          stealthRoll: Number(e.target.value) || 0,
                        })
                      }
                      placeholder="e.g., 18"
                    />
                  </div>
                )}

                <div className="row">
                  <label>Note</label>
                  <input
                    type="text"
                    value={t.note ?? ""}
                    onChange={(e) => updateToken(t.id, { note: e.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              className="btn danger"
              onClick={deleteSelected}
              disabled={!selectedId}
            >
              Delete Selected
            </button>
            <button className="btn" onClick={centerOnSelected} disabled={!selectedId}>
              Center
            </button>
          </div>
        </Section>

        <Section title="Turn Order">
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button className="btn" onClick={sortByInitiative}>
              Sort by Initiative
            </button>
            <button className="btn" onClick={prevTurn} disabled={sortedTokens.length === 0}>
              Prev
            </button>
            <button className="btn" onClick={nextTurn} disabled={sortedTokens.length === 0}>
              Next
            </button>
          </div>
          <ol style={{ paddingLeft: 18 }}>
            {sortedTokens.map((t, idx) => (
              <li key={t.id} style={{ marginBottom: 4 }}>
                <span style={{ fontWeight: idx === turnIndex ? 700 : 400 }}>
                  {t.name}
                </span>{" "}
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
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            cursor: tool === "select" ? "default" : "crosshair",
          }}
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
          onClick={() => setShowLeft((s) => !s)}
          data-open={showLeft ? "true" : "false"}
        >
          {showLeft ? "«" : "»"}
        </button>

        <button
          type="button"
          className="edge-tab right"
          aria-label={showRight ? "Hide right sidebar"}
          onClick={() => setShowRight((s) => !s)}
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
            placeholder="Search a condition or aura…"
            value={presetQuery}
            onChange={(e) => setPresetQuery(e.target.value)}
          />

          {/* Import/Export controls (kept) */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <label className="file small">
              <input
                type="file"
                accept="application/json"
                onChange={(e) => e.target.files && handleImportPresets(e.target.files[0])}
              />
              <span>Import Presets (JSON)</span>
            </label>
            <button className="btn" onClick={handleExportPresets}>
              Export Imported Presets
            </button>
          </div>

          {/* SEARCH-ONLY: nothing appears until they type 2+ chars */}
          {presetQuery.trim().length < 2 ? (
            <p style={{ opacity: 0.6, marginTop: 6 }}>
              Type at least 2 characters to find conditions &amp; auras.
            </p>
          ) : (
            (() => {
              const sel = tokens.find((t) => t.id === selectedId);
              const results = [
                ...filteredConditions.map((c) => ({ kind: "condition", key: c, label: c })),
                ...filteredAuras.map((a) => ({ kind: "aura", key: a.key, label: a.label, obj: a })),
              ].slice(0, 50);

              if (results.length === 0) {
                return <p style={{ opacity: 0.6, marginTop: 6 }}>No matches. Try different keywords.</p>;
              }

              return (
                <ul className="resultlist">
                  {results.map((r) => {
                    const active = r.kind === "aura" && sel ? getTokenAuraEntries(sel).some((e) => e.key === r.key) : false;
                    return (
                      <li key={`${r.kind}:${r.key}`}>
                        <button
                          className="result"
                          data-active={active ? "true" : "false"}
                          disabled={!selectedId}
                          onClick={() => {
                            if (r.kind === "condition") addConditionToSelected(r.key);
                            else applyAuraPresetToSelected(r.obj);
                          }}
                          title={r.kind === "aura" ? `${r.label} — click to ${active ? "remove" : "apply"}` : `${r.label} — click to add`}
                        >
                          <span className="badge" data-kind={r.kind}>{r.kind === "aura" ? "Aura" : "Cond"}</span>
                          <span className="label">{r.label}</span>
                          {r.kind === "aura" && active && <span className="active-dot" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              );
            })()
          )}

          {/* Quick add lingering effects remain for convenience */}
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn"
              disabled={!selectedId}
              onClick={() => toggleLingering("circle", 2)}
            >
              + Lingering Circle 10ft
            </button>
            <button
              className="btn"
              disabled={!selectedId}
              onClick={() => toggleLingering("cone", 3)}
            >
              + Lingering Cone 15ft
            </button>
            <button
              className="btn"
              disabled={!selectedId}
              onClick={() => toggleLingering("line", 6)}
            >
              + Lingering Line 30ft
            </button>
          </div>
        </Section>

        {/* Lingering AOE Editor */}
        <Section title="Lingering AOEs">
          {persistAOE.length === 0 ? (
            <p style={{ opacity: 0.6 }}>
              No lingering AOEs. Add from Presets → “+ Lingering …”
            </p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {persistAOE.map((a) => (
                <div
                  key={a.id}
                  className="card small"
                  style={{
                    outline:
                      selectedAoeId === a.id ? "2px solid #f59e0b" : "none",
                    outlineOffset: 1,
                  }}
                  onClick={() => setSelectedAoeId(a.id)}
                >
                  <div className="row">
                    <label>Label</label>
                    <input
                      value={a.label || ""}
                      onChange={(e) =>
                        setPersistAOE((prev) =>
                          prev.map((x) =>
                            x.id === a.id ? { ...x, label: e.target.value } : x
                          )
                        )
                      }
                    />
                  </div>
                  <div className="row">
                    <label>Affects</label>
                    <select
                      value={a.affects || "all"}
                      onChange={(e) =>
                        setPersistAOE((prev) =>
                          prev.map((x) =>
                            x.id === a.id ? { ...x, affects: e.target.value } : x
                          )
                        )
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
                      setPersistAOE((prev) =>
                        prev.map((x) =>
                          x.id === a.id
                            ? { ...x, effects: [...(x.effects || []), val] }
                            : x
                        )
                      )
                    }
                    onRemove={(idx) =>
                      setPersistAOE((prev) =>
                        prev.map((x) =>
                          x.id === a.id
                            ? {
                                ...x,
                                effects: (x.effects || []).filter(
                                  (_, i) => i !== idx
                                ),
                              }
                            : x
                        )
                      )
                    }
                    placeholder="Add effect and press Enter"
                  />
                  <div className="row">
                    <label>Enabled</label>
                    <input
                      type="checkbox"
                      checked={!!a.enabled}
                      onChange={(e) =>
                        setPersistAOE((prev) =>
                          prev.map((x) =>
                            x.id === a.id
                              ? { ...x, enabled: e.target.checked }
                              : x
                          )
                        )
                      }
                    />
                    <button
                      className="btn danger"
                      style={{ marginLeft: "auto" }}
                      onClick={() =>
                        setPersistAOE((prev) => prev.filter((x) => x.id !== a.id))
                      }
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
                        width: 12,
                        height: 12,
                        borderRadius: 999,
                        background: t.color,
                        display: "inline-block",
                        border: "1px solid #11182733",
                      }}
                    />
                    <strong>{t.name}</strong>
                    <span
                      style={{ marginLeft: "auto", opacity: 0.7, fontSize: 12 }}
                    >
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
                            <button
                              className="x"
                              onClick={() =>
                                updateToken(t.id, {
                                  conditions: userConds.filter(
                                    (_, idx) => idx !== i
                                  ),
                                })
                              }
                              aria-label={`Remove ${v}`}
                            >
                              ×
                            </button>
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
                            <button
                              className="x"
                              onClick={() =>
                                updateToken(t.id, {
                                  auraEffects: userEffs.filter(
                                    (_, idx) => idx !== i
                                  ),
                                })
                              }
                              aria-label={`Remove ${v}`}
                            >
                              ×
                            </button>
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
                      <label>From auras/AOEs</label>
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
              onUploadImage={(file) => loadTokenImage(file, selectedId)}
              onClearImage={() => clearTokenImage(selectedId)}
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
        .file.small span{padding:4px 8px;font-size:12px}
        .card{border:1px solid #e5e7eb;border-radius:12px;padding:8px;background:#fff}
        .card[data-selected="true"]{box-shadow:0 0 0 2px #fbbf24 inset}
        .card.small{padding:8px}
        .row{display:flex;align-items:center;gap:6px;margin-top:6px}
        .row.multi{align-items:flex-start}
        .row label{opacity:.7;width:120px}
        .row input, .row select{flex:1 1 auto;min-width:0;max-width:100%;padding:4px 6px;border:1px solid #e5e7eb;border-radius:8px}
        .pill{margin-left:8px;font-size:11px;padding:2px 6px;border-radius:999px;background:#ecfeff;border:1px solid #a5f3fc}
        .pill.red{background:#fff1f2;border-color:#fecdd3}
        .search{width:100%;padding:8px;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:8px}
        .preset-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        .chips{display:flex;flex-wrap:wrap;gap:6px;max-width:100%}
        .chips.input{align-items:center}
        .chip{padding:4px 8px;border:1px solid #e5e7eb;border-radius:999px;background:#fff}
        .chip[data-active="true"]{background:#eff6ff;border-color:#bfdbfe}
        .chip.pillchip{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border-radius:999px;background:#fff7df;border:1px solid #e5e7eb}
        .chip.pillchip .x{border:none;background:transparent;cursor:pointer;font-weight:700;color:#7a1c1c}
        .chip-input{flex:1 1 auto;min-width:0;width:100%;max-width:100%;padding:6px 8px;border:1px dashed #e5e7eb;border-radius:10px;background:#fff}

        .resultlist { list-style: none; padding: 0; margin: 6px 0 0; display: grid; gap: 6px; }
        .result {
          width: 100%;
          display: grid;
          grid-template-columns: auto 1fr auto;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          background: #fff;
          cursor: pointer;
        }
        .result[data-active="true"] { border-color: #bfdbfe; background: #eff6ff; }
        .result .label { text-align: left; }
        .badge {
          font-size: 11px; padding: 2px 6px; border-radius: 999px;
          border: 1px solid #e5e7eb; background: #fff;
        }
        .badge[data-kind="aura"] { background: #f0f9ff; border-color: #bae6fd; }
        .badge[data-kind="condition"] { background: #fff7df; border-color: #fde68a; }
        .active-dot { width: 10px; height: 10px; border-radius: 999px; background: #16a34a; justify-self: end; }

        /* Sidebar slide + fade */
        .sidebar.left, .sidebar.right {
          transition: opacity 200ms ease, transform 220ms ease, border-color 220ms ease;
          will-change: opacity, transform;
          box-sizing: border-box;
        }
        .sidebar .card, .sidebar .row, .sidebar .chips { min-width: 0; }
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
        @media (max-width: 1200px) { .row label { width:100px; } }
        @media (max-width: 980px)  { .row label { width:90px; } }
      `}</style>
    </div>
  );
}

/* ================== Subcomponents ================== */
function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 16 }}>
      <h3
        style={{
          fontSize: 14,
          textTransform: "uppercase",
          letterSpacing: ".08em",
          opacity: 0.8,
          margin: "8px 0",
        }}
      >
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
            <button
              className="x"
              onClick={() => onRemove(i)}
              aria-label={`Remove ${v}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="chip-input"
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const val = e.currentTarget.value.trim();
              if (val) {
                onAdd(val);
                e.currentTarget.value = "";
              }
            }
          }}
        />
      </div>
    </div>
  );
}

function TokenInspector({ token, onChange, onUploadImage, onClearImage }) {
  if (!token) return null;
  return (
    <div className="card">
      <div className="row">
        <label>Name</label>
        <input
          value={token.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>
      <div className="row">
        <label>Color</label>
        <input
          value={token.color}
          onChange={(e) => onChange({ color: e.target.value })}
        />
      </div>
      <div className="row">
        <label>Grid X (cell)</label>
        <input
          type="number"
          value={token.x}
          onChange={(e) =>
            onChange({ x: Math.floor(parseInt(e.target.value)) || 0 })
          }
        />
      </div>
      <div className="row">
        <label>Grid Y (cell)</label>
        <input
          type="number"
          value={token.y}
          onChange={(e) =>
            onChange({ y: Math.floor(parseInt(e.target.value)) || 0 })
          }
        />
      </div>
      <div className="row">
        <label>HP</label>
        <input
          type="number"
          value={token.hp ?? 0}
          onChange={(e) => onChange({ hp: parseInt(e.target.value) || 0 })}
        />
      </div>
      <div className="row">
        <label>Init</label>
        <input
          type="number"
          value={token.initiative ?? 0}
          onChange={(e) =>
            onChange({ initiative: parseInt(e.target.value) || 0 })
          }
        />
      </div>
      <div className="row">
        <label>Enemy?</label>
        <input
          type="checkbox"
          checked={!!token.isEnemy}
          onChange={(e) => onChange({ isEnemy: e.target.checked })}
        />
      </div>

      {/* Token image controls */}
      <div className="row">
        <label>Token image</label>
        <div style={{ display: "flex", gap: 6 }}>
          <label className="file small">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => e.target.files && onUploadImage?.(e.target.files[0])}
            />
            <span>Upload</span>
          </label>
          {token.imageObj && (
            <button className="btn danger" onClick={() => onClearImage?.()}>
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Right-panel still allows manual Effects/Conditions if you want */}
      <ChipField
        label="Effects"
        values={token.auraEffects || []}
        onAdd={(val) =>
          onChange({ auraEffects: [...(token.auraEffects || []), val] })
        }
        onRemove={(idx) =>
          onChange({
            auraEffects: (token.auraEffects || []).filter((_, i) => i !== idx),
          })
        }
        placeholder="Add effect and press Enter"
      />

      <ChipField
        label="Conditions"
        values={token.conditions || []}
        onAdd={(val) =>
          onChange({ conditions: [...(token.conditions || []), val] })
        }
        onRemove={(idx) =>
          onChange({
            conditions: (token.conditions || []).filter((_, i) => i !== idx),
          })
        }
        placeholder="Add condition and press Enter"
      />

      {/* If Hidden, allow entering stealth roll */}
      {(token.conditions || []).includes("Hidden") && (
        <div className="row">
          <label>Stealth</label>
          <input
            type="number"
            value={token.stealthRoll ?? 0}
            onChange={(e) =>
              onChange({ stealthRoll: Number(e.target.value) || 0 })
            }
            placeholder="e.g., 18"
          />
        </div>
      )}

      <div className="row">
        <label>Note</label>
        <input
          value={token.note ?? ""}
          onChange={(e) => onChange({ note: e.target.value })}
        />
      </div>
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
  for (let x = ox; x <= width; x += cell) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
  }
  for (let y = oy; y <= height; y += cell) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
  }
  ctx.stroke();
  ctx.restore();
}

function worldToScreenPx(gx, gy, view, grid, dpr) {
  const cell = grid.sizePx * view.zoom * dpr;
  return {
    x: gx * cell + view.offsetX * dpr,
    y: gy * cell + view.offsetY * dpr,
  };
}
function screenPxToWorld(sx, sy, view, grid, dpr) {
  const cell = grid.sizePx * view.zoom * dpr;
  return {
    wx: (sx - view.offsetX * dpr) / cell,
    wy: (sy - view.offsetY * dpr) / cell,
  };
}

function drawLabel(ctx, text, x, y) {
  const dpr = window.devicePixelRatio || 1;
  ctx.save();
  ctx.font = `${12 * dpr}px ui-sans-serif, system-ui, sans-serif`;
  const metrics = ctx.measureText(text);
  const pad = 6 * dpr;
  ctx.fillStyle = "rgba(17,24,39,0.8)";
  ctx.fillRect(
    x - metrics.width / 2 - pad,
    y - 14 - pad / 2,
    metrics.width + pad * 2,
    16 + pad
  );
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawAOE(ctx, aoe, view, grid, dpr, highlight = false) {
  const start = worldToScreenPx(aoe.start.gx, aoe.start.gy, view, grid, dpr);
  const end = worldToScreenPx(aoe.end.gx, aoe.end.gy, view, grid, dpr);
  const distCells = Math.hypot(
    aoe.end.gx - aoe.start.gx,
    aoe.end.gy - aoe.start.gy
  );
  const distFeet = distCells * grid.feetPerCell;

  ctx.save();
  ctx.lineWidth = highlight ? 4 : 3;
  ctx.setLineDash([8, 8]);
  ctx.strokeStyle = highlight ? "#f59e0b" : "#0ea5e9";
  ctx.fillStyle = highlight ? "rgba(245,158,11,0.18)" : "rgba(14,165,233,0.2)";

  if (aoe.type === "circle") {
    const r = distCells * grid.sizePx * view.zoom * dpr;
    ctx.beginPath();
    ctx.arc(start.x, start.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    drawLabel(ctx, `${round(distFeet)} ft radius`, start.x, start.y - r - 10 * dpr);
  } else if (aoe.type === "line") {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    drawLabel(
      ctx,
      `${round(distFeet)} ft line`,
      (start.x + end.x) / 2,
      (start.y + end.y) / 2 - 10 * dpr
    );
  } else if (aoe.type === "cone") {
    const angle = Math.atan2(aoe.end.gy - aoe.start.gy, aoe.end.gx - aoe.start.gx);
    const spread = (60 * Math.PI) / 180;
    const lenPx = distCells * grid.sizePx * view.zoom * dpr;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(
      start.x + Math.cos(angle - spread / 2) * lenPx,
      start.y + Math.sin(angle - spread / 2) * lenPx
    );
    ctx.lineTo(
      start.x + Math.cos(angle + spread / 2) * lenPx,
      start.y + Math.sin(angle + spread / 2) * lenPx
    );
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    drawLabel(ctx, `${round(distFeet)} ft cone`, start.x, start.y - 10 * dpr);
  }
  ctx.restore();
}

function drawGhost(ctx, ghost, view, grid, dpr) {
  const start = worldToScreenPx(ghost.start.gx, ghost.start.gy, view, grid, dpr);
  const end = worldToScreenPx(ghost.end.gx, ghost.end.gy, view, grid, dpr);
  const distCells = Math.hypot(
    ghost.end.gx - ghost.start.gx,
    ghost.end.gy - ghost.start.gy
  );
  const distFeet = distCells * grid.feetPerCell;

  ctx.save();
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 8]);
  ctx.strokeStyle = "#0ea5e9";
  ctx.fillStyle = "rgba(14,165,233,0.2)";

  if (ghost.type === "measure") {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    drawLabel(
      ctx,
      `${round(distFeet)} ft`,
      (start.x + end.x) / 2,
      (start.y + end.y) / 2 - 10 * dpr
    );
  }
  if (ghost.type === "circle") {
    const r = distCells * grid.sizePx * view.zoom * dpr;
    ctx.beginPath();
    ctx.arc(start.x, start.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    drawLabel(ctx, `${round(distFeet)} ft radius`, start.x, start.y - r - 10 * dpr);
  }
  if (ghost.type === "line") {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    drawLabel(
      ctx,
      `${round(distFeet)} ft line`,
      (start.x + end.x) / 2,
      (start.y + end.y) / 2 - 10 * dpr
    );
  }
  if (ghost.type === "cone") {
    const angle = Math.atan2(ghost.end.gy - ghost.start.gy, ghost.end.gx - ghost.start.gx);
    const spread = (60 * Math.PI) / 180;
    const lenPx = distCells * grid.sizePx * view.zoom * dpr;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(
      start.x + Math.cos(angle - spread / 2) * lenPx,
      start.y + Math.sin(angle - spread / 2) * lenPx
    );
    ctx.lineTo(
      start.x + Math.cos(angle + spread / 2) * lenPx,
      start.y + Math.sin(angle + spread / 2) * lenPx
    );
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    drawLabel(ctx, `${round(distFeet)} ft cone`, start.x, start.y - 10 * dpr);
  }
  ctx.restore();
}

/* ================== Effects & Presets ================== */
// 5e official conditions
const OFFICIAL_CONDITIONS = [
  "Blinded",
  "Charmed",
  "Deafened",
  "Frightened",
  "Grappled",
  "Incapacitated",
  "Invisible",
  "Paralyzed",
  "Petrified",
  "Poisoned",
  "Prone",
  "Restrained",
  "Stunned",
  "Unconscious",
  "Exhaustion",
];

// QoL extras you use during play
const EXTRA_CONDITIONS = [
  "Concentrating",
  "Dodge",
  "Disengage",
  "Dashing",
  "Ready",
  "Hide",
  "Advantage (attacks)",
  "Advantage (DEX saves)",
  "Advantage (WIS saves)",
  "Disadvantage (attacks)",
  "Sneak Attack Ready",
  "Hidden",
  "Target Marked",
  "Raging",
];

const CONDITION_PRESETS = [...OFFICIAL_CONDITIONS, ...EXTRA_CONDITIONS];

const AURA_PRESETS = [
  { key: "none", label: "None" },
  // Paladin & common auras/zones (truncated for brevity; keep your full list)
  {
    key: "paladin",
    label: "Aura of Protection (saves +X)",
    defaultRadiusCells: 2,
    defaultName: "Aura of Protection",
    affects: "allies",
    defaultAuraEffects: ["Saving throw bonus (+X)"],
    tags: ["paladin", "protection", "+cha", "save", "bonus"],
  },
  {
    key: "aura-courage",
    label: "Aura of Courage (fear immunity)",
    defaultRadiusCells: 2,
    defaultName: "Aura of Courage",
    affects: "allies",
    defaultAuraEffects: ["Immune to frightened"],
    tags: ["paladin", "courage", "fear", "frightened", "immunity"],
  },
  {
    key: "bless",
    label: "Bless (+1d4 atk & saves)",
    defaultRadiusCells: 6,
    defaultName: "Bless",
    affects: "allies",
    defaultAuraEffects: ["+1d4 to attack rolls", "+1d4 to saving throws"],
    tags: ["cleric", "buff", "+1d4", "attack", "save"],
  },
  // ... keep the rest of your large preset list here ...
];

// ---- Aura helpers (multi-auras with backward-compat) ----
function getTokenAuraEntries(t) {
  // Preferred: array entries
  if (Array.isArray(t.auraPresets) && t.auraPresets.length > 0) {
    return t.auraPresets
      .filter((e) => e && typeof e.key === "string")
      .map((e) => ({
        key: e.key,
        r: Number.isFinite(e.r) ? e.r : 2,
        affects:
          e.affects === "all" || e.affects === "allies" || e.affects === "enemies"
            ? e.affects
            : "allies",
        name: e.name || "",
        effects: Array.isArray(e.effects) ? e.effects : [],
        value: Number.isFinite(e.value) ? e.value : undefined,
      }));
  }
  // Fallback: legacy single aura fields
  if (t.auraRadiusCells > 0 && t.auraPreset && t.auraPreset !== "none") {
    return [
      {
        key: t.auraPreset,
        r: t.auraRadiusCells,
        affects: t.auraAffects || "allies",
        name: t.auraName || "",
        effects: Array.isArray(t.auraEffects) ? t.auraEffects : [],
        value: Number.isFinite(t.auraPresetValue) ? t.auraPresetValue : undefined,
      },
    ];
  }
  return [];
}

function computeAuraIndex(tokens) {
  const auras = [];
  for (const t of tokens) {
    const entries = getTokenAuraEntries(t);
    for (const e of entries) {
      auras.push({
        ownerId: t.id,
        ownerName: t.name,
        ownerIsEnemy: !!t.isEnemy,
        affects: e.affects || "allies",
        r: e.r,
        x: t.x,
        y: t.y,
        preset: e.key,
        presetValue: e.value,
        name: e.name,
        effects: e.effects,
      });
    }
  }
  return auras;
}

function computeTokenEffects(tokens, auras, aoes) {
  const out = {};
  const byId = Object.fromEntries(tokens.map((t) => [t.id, t]));

  for (const t of tokens) {
    const effects = [];

    // 1) AURAS
    for (const a of auras) {
      const owner = byId[a.ownerId];
      if (!isAffectedBy(a.affects, owner, t)) continue;
      if (!tokenInsideCircle(t, { gx: a.x + 0.5, gy: a.y + 0.5 }, a.r))
        continue;

      switch (a.preset) {
        case "paladin": {
          const bonus = Number.isFinite(a.presetValue) ? a.presetValue : 3;
          effects.push(
            `+${bonus} to all saving throws (Aura of Protection – ${a.ownerName})`
          );
          break;
        }
        case "bless":
          effects.push(
            `+1d4 to attack rolls & saving throws (Bless – ${a.ownerName})`
          );
          break;
        case "bane":
          effects.push(
            `-1d4 to attack rolls & saving throws (Bane – ${a.ownerName})`
          );
          break;
        case "prot-evil-good":
          effects.push(
            `Disadvantage for certain types to attack (Prot. Evil/Good – ${a.ownerName})`
          );
          break;
        case "spirit-guardians":
          effects.push(
            `Takes damage on start; difficult terrain (Spirit Guardians – ${a.ownerName})`
          );
          break;
        case "aura-warding":
          effects.push(
            `Resistance to spell damage (Aura of Warding – ${a.ownerName})`
          );
          break;
        case "beacon-of-hope":
          effects.push(
            `Adv. WIS/Death saves; max healing (Beacon of Hope – ${a.ownerName})`
          );
          break;
        case "haste-lite":
          effects.push(
            `+2 AC; advantage on DEX saves (Haste – ${a.ownerName})`
          );
          break;
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
        const radiusCells = Math.hypot(
          aoe.end.gx - aoe.start.gx,
          aoe.end.gy - aoe.start.gy
        );
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

    // 4) Flanking (DMG optional rule): two opponents adjacent on opposite sides/corners
    if (isFlanked(t, tokens)) {
      effects.push("Flanked: enemies have advantage on melee attacks");
    }

    out[t.id] = effects;
  }
  return out;
}

/* ================== Geometry & Utils ================== */
function isAllyOf(a, b) {
  return !!a && !!b && !!a.isEnemy === !!b.isEnemy;
}
function isAffectedBy(affects, owner, target) {
  if (affects === "all") return true;
  if (!owner || !target) return false;
  return affects === "allies" ? isAllyOf(owner, target) : !isAllyOf(owner, target);
}
function tokenInsideCircle(token, center, radiusCells) {
  const dx = token.x + 0.5 - center.gx;
  const dy = token.y + 0.5 - center.gy;
  return Math.hypot(dx, dy) <= radiusCells + 1e-6;
}
function distPointToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax,
    aby = by - ay;
  const apx = px - ax,
    apy = py - ay;
  const ab2 = abx * abx + aby * aby || 1e-9;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
  const cx = ax + t * abx,
    cy = ay + t * aby;
  return Math.hypot(px - cx, py - cy);
}
function tokenInsideLine(token, start, end, halfWidthCells = 0.5) {
  const px = token.x + 0.5,
    py = token.y + 0.5;
  const d = distPointToSegment(px, py, start.gx, start.gy, end.gx, end.gy);
  return d <= halfWidthCells + 1e-6;
}
function tokenInsideCone(token, start, end, spreadDeg = 60) {
  const px = token.x + 0.5,
    py = token.y + 0.5;
  const vx = end.gx - start.gx,
    vy = end.gy - start.gy;
  const ux = px - start.gx,
    uy = py - start.gy;
  const vlen = Math.hypot(vx, vy) || 1e-9;
  const ulen = Math.hypot(ux, uy);
  if (ulen < 1e-6) return true;
  const dot = (vx * ux + vy * uy) / (vlen * ulen);
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  const half = (spreadDeg * Math.PI) / 180 / 2;
  return angle <= half && ulen <= vlen + 1e-6;
}

/* ===== Flanking helpers (DMG variant) ===== */
function sign1(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }
function isAdjacentCells(a, b) {
  // Chebyshev distance of 1 (shares a side or a corner)
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) === 1;
}
function isOppositeAroundTarget(target, a, b) {
  // Both adjacent to target and on opposite sides/corners
  if (!isAdjacentCells(target, a) || !isAdjacentCells(target, b)) return false;
  const dx1 = sign1(a.x - target.x), dy1 = sign1(a.y - target.y);
  const dx2 = sign1(b.x - target.x), dy2 = sign1(b.y - target.y);
  if (dx1 === 0 && dy1 === 0) return false;
  return dx1 === -dx2 && dy1 === -dy2;
}
function isFlanked(target, tokens) {
  // Target is flanked if two opponents are adjacent on opposite sides/corners
  const foes = tokens.filter((u) => !isAllyOf(u, target));
  for (let i = 0; i < foes.length; i++) {
    for (let j = i + 1; j < foes.length; j++) {
      if (isOppositeAroundTarget(target, foes[i], foes[j])) return true;
    }
  }
  return false;
}
function attackerHasFlankingAdv(attacker, target, tokens) {
  // Attacker gains advantage if an ally is opposite across the target
  if (!attacker || !target) return false;
  if (isAllyOf(attacker, target)) return false;
  if (!isAdjacentCells(attacker, target)) return false; // assume 5-ft melee
  const allies = tokens.filter((t) => t.id !== attacker.id && isAllyOf(t, attacker));
  return allies.some((b) => isOppositeAroundTarget(target, attacker, b));
}

function computeHighlightTargets(selectedToken, tokens) {
  const out = new Set();
  if (!selectedToken) return out;

  const hasSA = (selectedToken.conditions || []).includes("Sneak Attack Ready");
  const hasAdvTag = (selectedToken.conditions || []).includes("Advantage (attacks)");

  for (const t of tokens) {
    if (t.id === selectedToken.id) continue;
    if (!!t.isEnemy !== !!selectedToken.isEnemy) {
      // Manual tags: advantage / SA ready highlight all enemies
      if (hasSA || hasAdvTag) out.add(t.id);
      // Flanking-based advantage
      if (attackerHasFlankingAdv(selectedToken, t, tokens)) out.add(t.id);
    }
  }
  return out;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function round(n) {
  return Math.round(n * 10) / 10;
}
function anitJagg(canvas) {
  return canvas;
}
// Random ID with crypto fallback
function cryptoRandomId() {
  try {
    if (
      typeof globalThis !== "undefined" &&
      globalThis.crypto &&
      typeof globalThis.crypto.getRandomValues === "function"
    ) {
      const arr = new Uint32Array(4);
      globalThis.crypto.getRandomValues(arr);
      return (
        arr[0].toString(16) +
        arr[1].toString(16) +
        arr[2].toString(16) +
        arr[3].toString(16)
      );
    }
  } catch {}
  // Fallback
  return (
    Date.now().toString(16) +
    Math.floor(Math.random() * 0xffffffff).toString(16)
  );
}

// Hit-tests
function hitTestToken(tokens, mx, my, view, grid, dpr) {
  const cell = grid.sizePx * view.zoom * dpr;
  const r = Math.max(2, cell / 2 - 2);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    const cx = (t.x + 0.5) * cell + view.offsetX * dpr;
    const cy = (t.y + 0.5) * cell + view.offsetY * dpr;
    const dx = mx - cx;
    const dy = my - cy;
    if (dx * dx + dy * dy <= r * r) return t;
  }
  return null;
}

function hitTestAOE(list, wx, wy) {
  // Simple bounding checks per shape in world-space
  for (let i = list.length - 1; i >= 0; i--) {
    const a = list[i];
    if (!a.enabled) continue;
    if (a.type === "circle") {
      const r = Math.hypot(a.end.gx - a.start.gx, a.end.gy - a.start.gy);
      const d = Math.hypot(wx - a.start.gx, wy - a.start.gy);
      if (d <= r + 0.5) return a;
    } else if (a.type === "line") {
      const d = distPointToSegment(wx, wy, a.start.gx, a.start.gy, a.end.gx, a.end.gy);
      if (d <= 0.6) return a;
    } else if (a.type === "cone") {
      // quick cone check similar to tokenInsideCone
      const vx = a.end.gx - a.start.gx,
        vy = a.end.gy - a.start.gy;
      const ux = wx - a.start.gx,
        uy = wy - a.start.gy;
      const vlen = Math.hypot(vx, vy) || 1e-9;
      const ulen = Math.hypot(ux, uy);
      const dot = (vx * ux + vy * uy) / (vlen * ulen || 1e-9);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      const half = (60 * Math.PI) / 180 / 2;
      if (angle <= half && ulen <= vlen + 0.6) return a;
    }
  }
  return null;
}

// Import helpers
function isAuraLike(o) {
  return (
    o &&
    typeof o === "object" &&
    typeof o.key === "string" &&
    typeof o.label === "string"
  );
}
function normalizeAura(a) {
  return {
    key: a.key,
    label: a.label,
    defaultRadiusCells:
      Number.isFinite(a.defaultRadiusCells) && a.defaultRadiusCells >= 0
        ? a.defaultRadiusCells
        : 2,
    defaultName: a.defaultName || a.label,
    affects:
      a.affects === "all" || a.affects === "allies" || a.affects === "enemies"
        ? a.affects
        : "all",
    defaultAuraEffects: Array.isArray(a.defaultAuraEffects)
      ? a.defaultAuraEffects.filter((x) => typeof x === "string" && x.trim())
      : [],
    tags: Array.isArray(a.tags)
      ? a.tags.filter((x) => typeof x === "string" && x.trim())
      : [],
  };
}
function dedupeStrings(list) {
  return Array.from(new Set(list.map((s) => String(s))));
}
function dedupeAuras(list) {
  const map = new Map();
  for (const a of list) {
    if (!isAuraLike(a)) continue;
    if (!map.has(a.key)) map.set(a.key, normalizeAura(a));
  }
  return Array.from(map.values());
}