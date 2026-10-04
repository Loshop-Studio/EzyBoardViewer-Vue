/* eslint-disable */
/**
 * 新版云笔记笔触提取器：page_mdb/data.mdb（LMDB + ObjectBox）→ TouchSource
 *
 * 背景（逆向结论）：
 *   - 旧笔记：每页导出独立的 `<UUID>_touch.bin`，snapshot.bin 的 stroke 节点通过
 *     `sourceFileName + sourceId` 引用它，前端直接取该文件即可渲染。
 *   - 新笔记：页目录内只有 `page_mdb/data.mdb` + `snapshot.bin`，App 端**不上传**
 *     `_touch.bin`（下载规则也只保留 图片 / .mdb / snapshot.bin）。笔触数据实际存在
 *     ObjectBox 里：
 *       · TouchEventEntity  —— 每段笔触一行：线宽 width、颜色 color
 *       · TouchInfoEntity   —— 每个采样点一行：x、y、eventTime、所属 eventId
 *     App 打开笔记时按需把它们导出成 `_touch.bin`，所以 snapshot 里仍只有引用。
 *
 * 本模块直接把 mdb 解析成 `TouchSource`（即 `_touch.bin` 的 protobuf 字节），
 * 让 board.js 的 stroke() 无需任何改动即可拿到点位。
 *
 * 实测对象布局（一页 5 段笔触 / 53 个点）：
 *   8 字节 key 的 value 是 FlatBuffers；
 *   TouchEventEntity: field0=id  field1=width(float)  field2=color(int32)
 *   TouchInfoEntity : field0=id  field1=eventTime(i64) field2=x(f32) field3=y(f32) field5=eventId(i64)
 */

/** LMDB 页大小（云笔记固定 4KB） */
const PAGE_SIZE = 4096
const P_LEAF = 0x02
/** LMDB node 头长度：mn_lo(2) + mn_hi(2) + mn_flags(2) + mn_ksize(2) */
const NODE_HDR = 8
/** F_BIGDATA：value 存在 overflow 页（笔记里未出现，遇到直接跳过） */
const F_BIGDATA = 0x01

/* ==================== 1. LMDB：遍历 leaf 页取出 key/value ==================== */

/**
 * 读出 LMDB 文件里全部 leaf 记录的 key/value。
 * @param {Uint8Array} u8 data.mdb 原始字节
 * @returns {{ key: Uint8Array, val: Uint8Array }[]}
 */
export function readMdbEntries(u8) {
  const out = []
  if (!u8 || u8.length < PAGE_SIZE) return out
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const pages = Math.floor(u8.length / PAGE_SIZE)
  for (let p = 0; p < pages; p++) {
    const o = p * PAGE_SIZE
    // 页头：pgno(8) | flags(2)@+10 | lower(2)@+12 | upper(2)@+14 | ptrs[]@+16
    if ((dv.getUint16(o + 10, true) & P_LEAF) !== P_LEAF) continue
    const lower = dv.getUint16(o + 12, true)
    const upper = dv.getUint16(o + 14, true)
    if (lower < 16 || upper < lower || upper > PAGE_SIZE) continue
    const n = (lower - 16) >> 1
    for (let k = 0; k < n; k++) {
      const np = dv.getUint16(o + 16 + k * 2, true)
      if (np < 16 || np + NODE_HDR > PAGE_SIZE) continue
      const lo = dv.getUint16(o + np, true)
      const hi = dv.getUint16(o + np + 2, true)
      const flags = dv.getUint16(o + np + 4, true)
      const ksz = dv.getUint16(o + np + 6, true)
      const dsz = lo | (hi << 16)
      if (flags & F_BIGDATA) continue
      if (np + NODE_HDR + ksz + dsz > PAGE_SIZE) continue
      const ks = o + np + NODE_HDR
      out.push({ key: u8.subarray(ks, ks + ksz), val: u8.subarray(ks + ksz, ks + ksz + dsz) })
    }
  }
  return out
}

/* ==================== 2. FlatBuffers 只读取值 ==================== */

function fbTable(dv, pos) {
  if (pos < 0 || pos + 4 > dv.byteLength) return null
  const vt = pos - dv.getInt32(pos, true)
  if (vt < 0 || vt + 4 > dv.byteLength) return null
  const vtSize = dv.getUint16(vt, true)
  if (vtSize < 4 || vt + vtSize > dv.byteLength) return null
  return { pos, vt, vtSize }
}

/** 取字段值位置；字段缺失返回 -1 */
function fbField(dv, t, fieldId) {
  const slot = 4 + fieldId * 2
  if (slot + 2 > t.vtSize) return -1
  const off = dv.getUint16(t.vt + slot, true)
  if (!off) return -1
  const p = t.pos + off
  return p + 4 <= dv.byteLength ? p : -1
}

function rootTable(dv) {
  if (dv.byteLength < 8) return null
  return fbTable(dv, dv.getUint32(0, true))
}

const readF32 = (dv, p) => dv.getFloat32(p, true)
const readI32 = (dv, p) => dv.getInt32(p, true)
const readI64 = (dv, p) => Number(dv.getBigInt64(p, true))

/* ==================== 3. 实体识别 ==================== */

/** 毫秒时间戳下限（2017 年起），用于把 TouchInfoEntity 与其它实体区分开 */
const MIN_MS = 1.5e12
const MAX_MS = 4e13
/** 单页笔触段数的合理上限（用于校验 eventId，挡掉其它实体的误匹配） */
const MAX_SEGMENTS = 4096

/**
 * TouchEventEntity：field1 = 线宽(float)、field2 = 颜色(int32)。
 * 线宽取值 0.5~200，用它做判据（时间戳不可能落在这个量级）。
 */
function parseTouchEvent(val) {
  if (val.length < 16) return null
  const dv = new DataView(val.buffer, val.byteOffset, val.byteLength)
  const t = rootTable(dv)
  if (!t) return null
  const pw = fbField(dv, t, 1)
  const pc = fbField(dv, t, 2)
  if (pw < 0 || pc < 0) return null
  if (pw + 4 > dv.byteLength || pc + 4 > dv.byteLength) return null
  const width = readF32(dv, pw)
  if (!(width >= 0.5 && width <= 200)) return null
  const pid = fbField(dv, t, 0)
  if (pid >= 0 && pid + 8 > dv.byteLength) return null
  // f3 = 虚线间隔、f4 = 虚线段长；实线画笔这两个值为 0（或 f3 缺省）。
  // 它们必须原样带进合成的 Paint，否则虚线会被画成实线。
  const p3 = fbField(dv, t, 3)
  const p4 = fbField(dv, t, 4)
  const dashGap = p3 >= 0 && p3 + 4 <= dv.byteLength ? readF32(dv, p3) : 0
  const dashLen = p4 >= 0 && p4 + 4 <= dv.byteLength ? readF32(dv, p4) : 0
  return {
    id: pid >= 0 ? readI64(dv, pid) : 0,
    width,
    color: readI32(dv, pc),
    dashGap: Number.isFinite(dashGap) && dashGap > 0 ? dashGap : 0,
    dashLen: Number.isFinite(dashLen) && dashLen > 0 ? dashLen : 0
  }
}

/**
 * TouchInfoEntity：field1 = eventTime(i64)、field2 = x(f32)、field3 = y(f32)、field5 = eventId(i64)。
 * 判据：eventTime 落在合理毫秒区间 + eventId > 0 + 坐标有限。
 */
function parseTouchInfo(val) {
  if (val.length < 24) return null
  const dv = new DataView(val.buffer, val.byteOffset, val.byteLength)
  const t = rootTable(dv)
  if (!t) return null
  const pt = fbField(dv, t, 1)
  const px = fbField(dv, t, 2)
  const py = fbField(dv, t, 3)
  const pe = fbField(dv, t, 5)
  if (pt < 0 || px < 0 || py < 0 || pe < 0) return null
  if (pt + 8 > dv.byteLength || pe + 8 > dv.byteLength) return null
  const time = readI64(dv, pt)
  if (!(time >= MIN_MS && time <= MAX_MS)) return null
  const eventId = readI64(dv, pe)
  // 一页的笔触段数不会超过几千：用它把“刚好也满足时间/坐标判据”的其它实体挡掉
  if (!(eventId > 0 && eventId <= MAX_SEGMENTS)) return null
  const x = readF32(dv, px)
  const y = readF32(dv, py)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  if (Math.abs(x) > 1e5 || Math.abs(y) > 1e5) return null
  return { x, y, time, eventId }
}

/* ==================== 4. 合成 TouchSource（protobuf） ==================== */

function pbVarint(n) {
  const out = []
  let v = n >>> 0
  while (v > 0x7f) { out.push((v & 0x7f) | 0x80); v >>>= 7 }
  out.push(v)
  return out
}
function pbTag(field, wire) { return pbVarint((field << 3) | wire) }
function pbF32(field, val) {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setFloat32(0, val, true)
  return [...pbTag(field, 5), b[0], b[1], b[2], b[3]]
}
function pbI32(field, val) { return [...pbTag(field, 0), ...pbVarint(val | 0)] }
function pbMsg(field, bytes) { return [...pbTag(field, 2), ...pbVarint(bytes.length), ...bytes] }

/**
 * 把解析出的笔触段与采样点编码成 TouchSource。
 * 结构与 board.js 的 stroke() 对齐：
 *   TouchSource { repeated TouchInfo = 1 }
 *   TouchInfo   { repeated Point = 1; Paint paint = 2 }
 *   Point       { float x = 3; float y = 4 }
 *   Paint       { float width = 1; int32 color = 2 }
 * 注意：snapshot.bin 里 stroke 的 field7(sourceId) 是段序号，
 * 而 App 写入时按 TouchEventEntity 的 id 升序排列，故这里保持同样顺序。
 */
export function encodeTouchSource(segments) {
  const out = []
  for (const seg of segments) {
    const body = []
    for (const pt of seg.points) {
      body.push(...pbMsg(1, [...pbF32(3, pt.x), ...pbF32(4, pt.y)]))
    }
    const paint = [...pbF32(1, seg.width), ...pbI32(2, seg.color)]
    // Paint.f3 = 虚线间隔、f4 = 虚线段长；board.js 只在 f3 > 0 时按虚线渲染，缺了就成了实线
    if (seg.dashGap > 0) paint.push(...pbF32(3, seg.dashGap), ...pbF32(4, seg.dashLen || 1))
    body.push(...pbMsg(2, paint))
    out.push(...pbMsg(1, body))
  }
  return new Uint8Array(out)
}

/* ==================== 5. 背景线配置（BackgroundLineConfigEntity） ==================== */

/**
 * BackgroundLineConfigEntity 的 ObjectBox 类型号（取自其 schema 记录 key 的低位 0x18）。
 * 数据记录 key 前 4 字节编码类型号：((key[2] << 8) | key[3]) >> 2。
 */
const TYPE_BG_LINE_CONFIG = 0x18

/** 解析一条 BackgroundLineConfigEntity：f1=线色(int32)、f2=间距(f32)、f3=类型(int)、f4=线宽(f32) */
function readBgLineFields(val) {
  const dv = new DataView(val.buffer, val.byteOffset, val.byteLength)
  const t = rootTable(dv)
  if (!t) return null
  const p1 = fbField(dv, t, 1)
  const p2 = fbField(dv, t, 2)
  const p3 = fbField(dv, t, 3)
  const p4 = fbField(dv, t, 4)
  if (p1 < 0 || p2 < 0 || p4 < 0) return null
  const spacing = readF32(dv, p2)
  const width = readF32(dv, p4)
  // 合理性校验，挡掉其它实体的误匹配
  if (!Number.isFinite(spacing) || spacing <= 0 || spacing > 4096) return null
  if (!Number.isFinite(width) || width <= 0 || width > spacing) return null
  return {
    color: readI32(dv, p1),
    spacing,
    width,
    lineType: p3 >= 0 ? readI32(dv, p3) : 1
  }
}

/**
 * 读取该页背景网格 / 横线配置。
 *
 * 新版笔记既不上传 header.bin，也不上传任何背景文件，背景线配置就存在
 * BackgroundLineConfigEntity 里（LineSpace / LineType / LineWidth / LineColor）。
 * 编辑过程中会写入多份，取其 id 最小的一份作为生效配置。
 *
 * @param {Uint8Array} u8 page_mdb/data.mdb
 * @returns {{ color: number, spacing: number, width: number, cross: boolean } | null}
 *          cross = true 为横竖交错网格；null 表示该页没有背景线
 */
export function readBgLineConfig(u8) {
  let best = null
  for (const { key, val } of readMdbEntries(u8)) {
    if (key.length !== 8 || val.length < 16) continue
    if ((((key[2] << 8) | key[3]) >> 2) !== TYPE_BG_LINE_CONFIG) continue
    const f = readBgLineFields(val)
    if (!f) continue
    const id = ((key[4] << 24) | (key[5] << 16) | (key[6] << 8) | key[7]) >>> 0
    if (!best || id < best.id) best = { id, ...f }
  }
  if (!best) return null
  return { color: best.color, spacing: best.spacing, width: best.width, cross: best.lineType === 1 }
}

/* ==================== 6. 页头（HeaderEntity）：画布底色 ==================== */

/** HeaderEntity 的 ObjectBox 类型号 */
const TYPE_HEADER = 0x06

/**
 * 读取该页画布背景色。
 *
 * 新版笔记不上传 header.bin，底色存在 HeaderEntity 里：
 * 实测字段 f11 = defaultBackgroundColor、f12 = lastBackgroundColor，
 * 均为 int32 0xAARRGGBB（本次样本 0xFFF6F0E9，即米色底）。
 *
 * @param {Uint8Array} u8 page_mdb/data.mdb
 * @returns {number | null} int32（0xAARRGGBB）；null 表示没找到
 */
export function readHeaderBgColor(u8) {
  for (const { key, val } of readMdbEntries(u8)) {
    if (key.length !== 8 || val.length < 16) continue
    if ((((key[2] << 8) | key[3]) >> 2) !== TYPE_HEADER) continue
    const dv = new DataView(val.buffer, val.byteOffset, val.byteLength)
    const t = rootTable(dv)
    if (!t) continue
    // 先 lastBackgroundColor 再 defaultBackgroundColor；两者实测一致
    for (const fid of [12, 11]) {
      const p = fbField(dv, t, fid)
      if (p < 0) continue
      const u = dv.getUint32(p, true)
      if ((u >>> 24) === 0xff) return (u | 0)      // alpha 必须为不透明，挡掉时间戳等大整数
    }
  }
  return null
}

/* ==================== 7. 对外主入口 ==================== */

/**
 * 解析一页的 page_mdb/data.mdb，产出 TouchSource 字节。
 * @param {Uint8Array} u8 data.mdb
 * @returns {Uint8Array | null} null = 没找到笔触数据
 */
export function buildTouchSourceFromMdb(u8) {
  const entries = readMdbEntries(u8)
  if (!entries.length) return null
  const points = []                    // { x, y, time, eventId }
  /** 候选“笔触段”实体：key 前缀 → (id → { width, color }) */
  const cands = new Map()

  for (const { key, val } of entries) {
    // 只处理 8 字节对象 key（LMDB 数据对象；12/16 字节的是关系索引，其 value 为空）
    if (key.length !== 8 || val.length < 16) continue
    const info = parseTouchInfo(val)
    if (info) { points.push(info); continue }
    const ev = parseTouchEvent(val)
    if (!ev) continue
    // 线宽这一判据偏弱（其它实体也可能带 0.5~200 的 float 字段），
    // 因此按 key 前缀分组，稍后用 eventId 集合精确挑出真正的实体。
    const prefix = ((key[0] << 24) | (key[1] << 16) | (key[2] << 8) | key[3]) >>> 0
    if (!cands.has(prefix)) cands.set(prefix, new Map())
    cands.get(prefix).set(ev.id, ev)
  }
  if (!points.length || !cands.size) return null

  // 采样点里出现过的 eventId 集合 —— 真正的“笔触段”实体的 id 应与之恰好吻合
  const need = new Set(points.map(p => p.eventId))
  if (globalThis.__MDB_DEBUG__) {
    console.log('[mdb] points =', points.length,
      '| need =', [...need].sort((a, b) => a - b).join(','),
      '| cands =', [...cands.entries()].map(([p, m]) => p.toString(16) + ':' + m.size + '[' + [...m.keys()].join(',') + ']').join('  '))
  }
  let exact = null, fallback = null
  for (const m of cands.values()) {
    let ok = m.size >= need.size
    if (ok) for (const id of need) if (!m.has(id)) { ok = false; break }
    if (!ok) continue
    if (m.size === need.size) { if (!exact || m.size < exact.size) exact = m }
    else if (!fallback || m.size < fallback.size) fallback = m
  }
  const events = exact || fallback
  if (!events) return null

  // 按 eventId 分组，组内按时间排序还原笔迹
  const byEvent = new Map()
  for (const pt of points) {
    if (!byEvent.has(pt.eventId)) byEvent.set(pt.eventId, [])
    byEvent.get(pt.eventId).push(pt)
  }
  const ids = [...events.keys()].filter(id => byEvent.has(id)).sort((a, b) => a - b)
  const segments = []
  for (const id of ids) {
    const pts = byEvent.get(id)
    pts.sort((a, b) => a.time - b.time)
    const ev = events.get(id)
    segments.push({
      width: ev.width,
      color: ev.color,
      dashGap: ev.dashGap || 0,
      dashLen: ev.dashLen || 0,
      points: pts
    })
  }
  if (!segments.length) return null
  return encodeTouchSource(segments)
}

/**
 * 从 snapshot.bin 里收集所有被引用的 `*_touch.bin` 文件名。
 * snapshot 的 GraphSnapshot 用 field6 存 sourceFileName、field7 存 sourceId。
 * @param {Uint8Array} u8 snapshot.bin
 * @param {(m: any, n: number) => any} M field → 子消息
 * @param {(m: any, n: number) => any} S field → 字符串
 * @param {(m: any, n: number) => any[]} A field → repeated 子消息
 * @param {(u8: Uint8Array) => any} pb 原始解码
 */
export function collectTouchRefs(u8, tools) {
  const { pb, M, S, A } = tools
  const found = new Set()
  let sn
  try { sn = pb(u8) } catch { return [] }
  const gs = M(sn, 2)
  if (!gs) return []
  const walk = (g) => {
    const src = S(g, 6)
    if (/_touch\.bin$/i.test(src)) found.add(src)
    for (const c of A(g, 5)) walk(c)
  }
  walk(gs)
  return [...found]
}
