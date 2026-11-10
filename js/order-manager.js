/**
 * 受注管理（内田洋行EDI）
 *
 * 出荷予定（shipmentSchedules）を「発注番号-明細番号」（例: 7489926-001）で管理する。
 *  - EDI取込        : EDIのCSV（Shift_JIS）を読み、新規・変更・取消を出荷予定に反映
 *  - Excel台帳取込  : 「内田洋行_受注台帳_マクロ版.xlsm」の受注台帳シートを初期データとして読み込む
 *  - 出荷の反映     : 出荷履歴の取込で、発注番号が一致する出荷予定の残数を減らす
 *
 * 出荷予定1件のデータ:
 *  id / orderNo     … 発注番号-明細番号（キー）
 *  productCode      … 製品番号（EDI: 商品コード(発注者体系)）
 *  productName      … 製品名（EDI: 商品名１）
 *  orderQty         … 発注数量
 *  shippedQty       … 出荷済数
 *  shipmentQuantity … 残数（= 発注数量 - 出荷済数。在庫の引当計算に使う）
 *  shipmentDate     … 希望納期（YYYY-MM-DD）
 *  status           … 有効 / 取消 / 完了
 *  needsCheck       … 要確認の理由（空なら問題なし）
 *  rev              … EDIの明細更新回数（同じEDIを二度取り込んでも二重反映しないため）
 *
 * 判定の考え方は Excel マクロ（modEDI.bas の ImportEDI）と同じ。
 */
class OrderManager {
    constructor(db) {
        this.db = db;
    }

    // EDI の列位置（0始まり）と、その位置にあるべき見出し
    static EDI_COLUMNS = {
        orderNo:     [3,  '発注番号'],               // D
        detailNo:    [4,  '発注明細番号'],           // E
        createdDate: [7,  '作成年月日データ'],       // H
        createdTime: [8,  '作成時刻データ'],         // I
        orderDate:   [12, '発注年月日'],             // M
        kubun:       [46, '明細処理区分'],           // AU  1:新規 2:変更 3:取消
        rev:         [49, '明細更新回数'],           // AX
        dueDate:     [51, '希望納期'],               // AZ
        deliveryTo:  [56, '納入先名'],               // BE
        productCode: [70, '商品コード(発注者体系)'], // BS
        productName: [71, '商品名１'],               // BT
        productName2:[72, '商品名２'],               // BU
        received:    [75, '入荷済数量'],             // BX
        orderQty:    [76, '発注数量'],               // BY
        unitPrice:   [78, '発注単価'],               // CA
    };

    static KUBUN_LABEL = { '1': '新規', '2': '変更', '3': '取消' };

    // ------------------------------------------------------------
    // 共通の小道具
    // ------------------------------------------------------------

    /** 発注番号と明細番号から「0000000-000」の形を作る */
    static makeOrderNo(orderNo, detailNo) {
        const o = String(orderNo ?? '').trim();
        const d = String(detailNo ?? '').trim();
        if (!o) return '';
        return `${o}-${String(parseInt(d, 10) || 0).padStart(3, '0')}`;
    }

    /** 「7489926-1」「7489926-001」などを「7489926-001」に揃える */
    static normalizeOrderNo(value) {
        const v = String(value ?? '').normalize('NFKC').trim();
        const m = /^(\d+)\s*[-ー－]\s*(\d+)$/.exec(v);
        return m ? OrderManager.makeOrderNo(m[1], m[2]) : v;
    }

    /** 全角空白・連続空白を整える */
    static cleanText(s) {
        return String(s ?? '').replace(/　/g, ' ').replace(/\s+/g, ' ').trim();
    }

    /** 「20261207」→「2026-12-07」（0や空は null） */
    static ymd8(s) {
        const v = String(s ?? '').trim();
        if (!/^\d{8}$/.test(v) || v === '00000000') return null;
        return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
    }

    static todayYmd() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    static fmtDate(ymd) {
        return ymd ? ymd.replace(/-/g, '/') : '-';
    }

    /** 残数と状態を整える */
    static recalc(s) {
        s.orderQty = Number(s.orderQty) || 0;
        s.shippedQty = Number(s.shippedQty) || 0;
        const remaining = Math.max(0, s.orderQty - s.shippedQty);
        s.shipmentQuantity = s.status === '有効' ? remaining : 0;
        return s;
    }

    /** Shift_JIS のファイルを文字列で読む */
    static async readSjis(file) {
        const buf = await file.arrayBuffer();
        try {
            return new TextDecoder('shift_jis', { fatal: true }).decode(buf);
        } catch (e) {
            return new TextDecoder('utf-8').decode(buf);
        }
    }

    /** CSV 1行を分割（ダブルクォート対応） */
    static parseCsvLine(line) {
        const out = [];
        let cur = '', inQ = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQ) {
                if (ch === '"') {
                    if (line[i + 1] === '"') { cur += '"'; i++; } else { inQ = false; }
                } else cur += ch;
            } else if (ch === '"') inQ = true;
            else if (ch === ',') { out.push(cur); cur = ''; }
            else cur += ch;
        }
        out.push(cur);
        return out;
    }

    /** 初期データ基準日（この日以降の発注で台帳にない「変更」は新規として扱う） */
    async getBaseDate() {
        const rec = await this.db.get('appSettings', 'orderBaseDate');
        return rec?.value || null;
    }

    // ------------------------------------------------------------
    // EDI取込
    // ------------------------------------------------------------

    /**
     * EDIのCSVを1つ読み、明細の配列にする
     * @returns {Promise<Array>} 明細
     */
    async parseEDIFile(file) {
        const text = await OrderManager.readSjis(file);
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length === 0) return [];

        // 列の位置を見出しで確認（違うファイルを取り込まないため）
        const header = OrderManager.parseCsvLine(lines[0]).map(h => h.trim());
        const C = OrderManager.EDI_COLUMNS;
        const colName = (i) => { let s = ''; i++; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
        for (const [, [idx, name]] of Object.entries(C)) {
            if ((header[idx] || '') !== name) {
                throw new Error(`内田洋行のEDIファイルではないようです（${file.name}）。\n` +
                    `${colName(idx)}列は「${name}」のはずですが「${header[idx] || '(なし)'}」でした。`);
            }
        }

        const recs = [];
        for (let i = 1; i < lines.length; i++) {
            const v = OrderManager.parseCsvLine(lines[i]);
            if (v.length <= C.unitPrice[0]) continue;
            const get = (k) => (v[C[k][0]] ?? '').trim();
            const orderNo = OrderManager.makeOrderNo(get('orderNo'), get('detailNo'));
            if (!orderNo) continue;
            const rev = parseInt(get('rev'), 10) || 0;
            recs.push({
                line: i + 1,
                fileName: file.name,
                orderNo,
                kubun: get('kubun'),
                rev,
                sortKey: `${get('createdDate')}${get('createdTime').padStart(6, '0')}${String(rev).padStart(5, '0')}`,
                orderDate: OrderManager.ymd8(get('orderDate')),
                productCode: get('productCode'),
                // 全角英数（ＤＰ－ＣＯ３）を半角（DP-CO3）にそろえる（製品マスタ・Excel台帳と同じ表記）
                productName: OrderManager.cleanText((get('productName') + ' ' + get('productName2')).normalize('NFKC')),
                orderQty: parseFloat(get('orderQty')) || 0,
                unitPrice: parseFloat(get('unitPrice')) || 0,
                dueDate: OrderManager.ymd8(get('dueDate')),
                deliveryTo: OrderManager.cleanText(get('deliveryTo')),
                received: parseFloat(get('received')) || 0,
            });
        }
        return recs;
    }

    /** 変更点の説明（Excel マクロの DiffText と同じ） */
    static diffText(old, rec) {
        const parts = [];
        if ((Number(old.orderQty) || 0) !== rec.orderQty) parts.push(`発注数量:${old.orderQty}→${rec.orderQty}`);
        if ((Number(old.unitPrice) || 0) !== rec.unitPrice) parts.push(`単価:${old.unitPrice ?? '-'}→${rec.unitPrice}`);
        if (rec.dueDate && old.shipmentDate !== rec.dueDate) {
            let t = `希望納期:${OrderManager.fmtDate(old.shipmentDate)}→${OrderManager.fmtDate(rec.dueDate)}`;
            if (old.shipmentDate && rec.dueDate < old.shipmentDate) t += '【前倒し】';
            parts.push(t);
        }
        if (old.productCode !== rec.productCode) parts.push(`商品コード:${old.productCode}→${rec.productCode}`);
        return parts.length ? parts.join(' / ') : '差分なし';
    }

    /**
     * EDIのCSV（複数可）を取り込み、出荷予定に反映する
     * @param {FileList|Array<File>} files
     * @returns {Promise<object>} 結果（件数・エラー・メッセージ）
     */
    async importEDI(files) {
        const started = performance.now();
        const fileList = Array.from(files);

        // 1) 全ファイルの明細を集め、作成日時 → 更新回数の順に並べる
        let recs = [];
        for (const f of fileList) recs = recs.concat(await this.parseEDIFile(f));
        if (recs.length === 0) {
            return { success: true, errors: [], message: '取り込む明細がありませんでした。' };
        }
        recs.sort((a, b) => a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);

        // 2) 今の出荷予定・製品マスタ
        const [schedules, products, baseDate] = await Promise.all([
            this.db.getAll('shipmentSchedules'),
            this.db.getAll('products'),
            this.getBaseDate()
        ]);
        const map = new Map(schedules.map(s => [s.id, s]));
        const productSet = new Set(products.map(p => p.productCode));
        const changed = new Map();   // 書き込む出荷予定
        const logs = [];
        const errors = [];
        const importedAt = Date.now();
        const cnt = { new: 0, upd: 0, can: 0, skip: 0, chk: 0 };

        // 3) 1行ずつ反映
        for (const rec of recs) {
            const kubunLabel = OrderManager.KUBUN_LABEL[rec.kubun] || rec.kubun;
            let s = map.get(rec.orderNo);
            let result, content = '';

            if (s && (Number(s.rev) || 0) > 0 && rec.rev <= (Number(s.rev) || 0)) {
                // すでに同じかそれより新しい内容を反映済み
                cnt.skip++;
                continue;
            }

            if (s) {
                s = { ...s };
                if (rec.kubun === '3') {
                    s.status = '取消';
                    result = '取消'; content = '取消';
                    cnt.can++;
                } else {
                    content = OrderManager.diffText(s, rec);
                    s.productCode = rec.productCode;
                    s.productName = rec.productName || s.productName;
                    s.orderQty = rec.orderQty;
                    s.unitPrice = rec.unitPrice;
                    if (rec.dueDate) s.shipmentDate = rec.dueDate;
                    s.deliveryTo = rec.deliveryTo || s.deliveryTo;
                    if (s.status === '完了' && s.orderQty > (Number(s.shippedQty) || 0)) {
                        s.status = '有効';
                        s.needsCheck = '完了扱いの注文に変更が来た。要確認';
                        cnt.chk++;
                    } else if (s.status === '取消') {
                        s.needsCheck = '取消済みの注文に変更が来た。要確認';
                        cnt.chk++;
                    }
                    result = '更新';
                    cnt.upd++;
                }
            } else {
                // 出荷予定にない発注番号 → 追加
                const isNew = rec.kubun === '1' || (baseDate && rec.orderDate && rec.orderDate >= baseDate);
                s = {
                    id: rec.orderNo,
                    orderNo: rec.orderNo,
                    productCode: rec.productCode,
                    productName: rec.productName,
                    orderQty: rec.orderQty,
                    shippedQty: rec.received,
                    unitPrice: rec.unitPrice,
                    shipmentDate: rec.dueDate,
                    orderDate: rec.orderDate,
                    deliveryTo: rec.deliveryTo,
                    status: rec.kubun === '3' ? '取消' : '有効',
                    needsCheck: '',
                    createdAt: importedAt
                };
                if (!isNew) {
                    s.needsCheck = '台帳にない注文への変更。出荷済の可能性あり、要確認';
                    result = '追加（要確認）';
                    cnt.chk++;
                } else {
                    result = '追加';
                }
                content = `${rec.productName} ${rec.orderQty}個 納期${OrderManager.fmtDate(rec.dueDate)}`;
                cnt.new++;
            }

            if (!productSet.has(s.productCode)) {
                const msg = '製品マスタに無い商品コード';
                if (!String(s.needsCheck || '').includes(msg)) {
                    s.needsCheck = s.needsCheck ? `${s.needsCheck} / ${msg}` : msg;
                }
                errors.push(`行 ${rec.line}: ${rec.orderNo} の商品コード ${rec.productCode} が製品マスタにありません（${rec.fileName}）`);
            }

            s.rev = rec.rev;
            s.updatedAt = importedAt;
            s.source = rec.fileName;
            OrderManager.recalc(s);
            map.set(s.id, s);
            changed.set(s.id, s);

            if (content !== '差分なし') {
                logs.push({
                    id: `EDI_${importedAt}_${String(logs.length + 1).padStart(4, '0')}`,
                    importedAt,
                    fileName: rec.fileName,
                    orderNo: rec.orderNo,
                    kubun: kubunLabel,
                    result,
                    content,
                    productCode: s.productCode,
                    productName: s.productName,
                    mjsDone: false
                });
            }
        }

        // 3.5) 出荷履歴が先に取り込まれていた発注番号（出荷予定に無かったもの）を、ここで反映する
        const pendingHistory = (await this.db.getAll('shipmentHistory'))
            .filter(h => h.orderNo && h.applied === false && map.has(h.orderNo));
        const historyUpdates = [];
        let lateApplied = 0;
        for (const h of pendingHistory) {
            const s = { ...map.get(h.orderNo) };
            if (s.status === '取消') continue;
            const before = Math.max(0, (Number(s.orderQty) || 0) - (Number(s.shippedQty) || 0));
            s.shippedQty = (Number(s.shippedQty) || 0) + (Number(h.shipmentQuantity) || 0);
            let content = `先に取り込まれていた出荷 ${h.shipmentQuantity}個（${OrderManager.fmtDate(h.shipmentDate)}）を反映 残 ${before}→${Math.max(0, s.orderQty - s.shippedQty)}`;
            if (s.status === '有効' && s.shippedQty >= s.orderQty) { s.status = '完了'; content += ' → 完了'; }
            if (s.shippedQty > s.orderQty) {
                const msg = `発注数を超えて出荷（発注 ${s.orderQty}・出荷済 ${s.shippedQty}）`;
                s.needsCheck = s.needsCheck ? `${s.needsCheck} / ${msg}` : msg;
                content += ' 【発注数超過】';
            }
            OrderManager.recalc(s);
            map.set(s.id, s);
            changed.set(s.id, s);
            historyUpdates.push({ ...h, applied: true });
            lateApplied++;
            logs.push({
                id: `EDI_${importedAt}_${String(logs.length + 1).padStart(4, '0')}`,
                importedAt, fileName: h.slipNo ? `売上伝票 ${h.slipNo}` : '出荷履歴', orderNo: h.orderNo,
                kubun: '出荷', result: '出荷済数を更新', content,
                productCode: s.productCode, productName: s.productName, mjsDone: true
            });
        }

        // 4) まとめて保存（全部成功 or 全部取り消し）
        const ops = [
            ...historyUpdates.map(data => ({ op: 'put', store: 'shipmentHistory', data })),
            ...[...changed.values()].map(data => ({ op: 'put', store: 'shipmentSchedules', data })),
            ...logs.map(data => ({ op: 'put', store: 'ediLog', data })),
            {
                op: 'put', store: 'appSettings', data: {
                    key: 'lastEdiImport', value: {
                        at: importedAt, files: fileList.map(f => f.name),
                        rows: recs.length, ...cnt
                    }
                }
            }
        ];
        await this.db.batch(ops);

        const sec = ((performance.now() - started) / 1000).toFixed(1);
        return {
            success: true,
            errors,
            counts: cnt,
            message: `EDI取込完了（${fileList.length}ファイル・${recs.length}行）: ` +
                `新規 ${cnt.new}・更新 ${cnt.upd}・取消 ${cnt.can}・反映済のためスキップ ${cnt.skip}・要確認 ${cnt.chk}` +
                (lateApplied ? `、先に取り込まれていた出荷 ${lateApplied}件を反映` : '') + `（${sec}秒）`
        };
    }

    // ------------------------------------------------------------
    // Excel 受注台帳からの初期取込
    // ------------------------------------------------------------

    /**
     * 「受注台帳」シートを読み込み、出荷予定をすべて置き換える
     * @param {File} file - 内田洋行_受注台帳_マクロ版.xlsm
     */
    async importLedgerExcel(file) {
        if (typeof XLSX === 'undefined') {
            throw new Error('Excel読み込み用の部品（SheetJS）が読み込まれていません。インターネット接続を確認してください。');
        }
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const ws = wb.Sheets['受注台帳'];
        if (!ws) throw new Error('「受注台帳」シートが見つかりません。内田洋行_受注台帳のファイルを選んでください。');

        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
        const header = (rows[0] || []).map(h => String(h ?? '').trim());
        const col = (name) => header.indexOf(name);
        const need = ['発注番号-明細', '商品コード', '商品名', '発注数量', '出荷済数', '希望納期', '状態'];
        const missing = need.filter(n => col(n) < 0);
        if (missing.length) throw new Error(`受注台帳シートに必要な列がありません: ${missing.join('、')}`);

        // Excel の日付（シリアル値）→ YYYY-MM-DD
        const toYmd = (v) => {
            if (v === null || v === '') return null;
            if (typeof v === 'number') {
                const d = XLSX.SSF.parse_date_code(v);
                return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null;
            }
            const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(String(v));
            return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
        };
        const num = (v) => Number(v) || 0;
        const str = (v) => (v === null || v === undefined) ? '' : String(v).trim();

        // 初期データ基準日（設定シート B1）
        let baseDate = null;
        const conf = wb.Sheets['設定'];
        if (conf && conf.B1) baseDate = toYmd(conf.B1.v);

        const products = await this.db.getAll('products');
        const productSet = new Set(products.map(p => p.productCode));
        const importedAt = Date.now();
        const errors = [];
        const list = [];
        const seen = new Set();
        const cnt = { 有効: 0, 完了: 0, 取消: 0 };

        for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            const orderNo = OrderManager.normalizeOrderNo(str(r[col('発注番号-明細')]));
            if (!orderNo) continue;
            if (seen.has(orderNo)) {
                errors.push(`行 ${i + 1}: 発注番号 ${orderNo} が重複しています（後の行を使用）`);
            }
            seen.add(orderNo);

            const status = ['有効', '完了', '取消'].includes(str(r[col('状態')])) ? str(r[col('状態')]) : '有効';
            const productCode = str(r[col('商品コード')]);
            const s = {
                id: orderNo,
                orderNo,
                productCode,
                productName: str(r[col('商品名')]),
                orderQty: num(r[col('発注数量')]),
                shippedQty: num(r[col('出荷済数')]),
                unitPrice: col('単価') >= 0 ? num(r[col('単価')]) : 0,
                shipmentDate: toYmd(r[col('希望納期')]),
                orderDate: col('発注日') >= 0 ? toYmd(r[col('発注日')]) : null,
                deliveryTo: col('納入先') >= 0 ? str(r[col('納入先')]) : '',
                status,
                needsCheck: col('要確認') >= 0 ? str(r[col('要確認')]) : '',
                rev: col('EDI更新回数') >= 0 ? num(r[col('EDI更新回数')]) : 0,
                note: col('備考') >= 0 ? str(r[col('備考')]) : '',
                source: `Excel台帳（${col('更新元') >= 0 ? str(r[col('更新元')]) : ''}）`,
                createdAt: importedAt,
                updatedAt: importedAt
            };
            if (!productSet.has(productCode)) {
                errors.push(`行 ${i + 1}: ${orderNo} の商品コード ${productCode}（${s.productName}）が製品マスタにありません`);
                if (!s.needsCheck.includes('製品マスタに無い')) {
                    s.needsCheck = s.needsCheck ? `${s.needsCheck} / 製品マスタに無い商品コード` : '製品マスタに無い商品コード';
                }
            }
            OrderManager.recalc(s);
            cnt[status] = (cnt[status] || 0) + 1;
            list.push(s);
        }

        const byId = new Map(list.map(s => [s.id, s]));   // 重複は後の行を採用
        const active = [...byId.values()].filter(isActiveShipment);
        const remainTotal = active.reduce((a, s) => a + s.shipmentQuantity, 0);

        await this.db.batch([
            { op: 'clearStore', store: 'shipmentSchedules' },
            ...[...byId.values()].map(data => ({ op: 'put', store: 'shipmentSchedules', data })),
            ...(baseDate ? [{ op: 'put', store: 'appSettings', data: { key: 'orderBaseDate', value: baseDate } }] : []),
            {
                op: 'put', store: 'ediLog', data: {
                    id: `EDI_${importedAt}_0000`, importedAt, fileName: file.name, orderNo: '(全体)',
                    kubun: '初期取込', result: '置き換え',
                    content: `Excel受注台帳から ${byId.size}行（有効 ${cnt.有効}・完了 ${cnt.完了}・取消 ${cnt.取消}）。基準日 ${OrderManager.fmtDate(baseDate)}`,
                    productCode: '', productName: '', mjsDone: true
                }
            }
        ]);

        return {
            success: true,
            errors,
            message: `Excel受注台帳を取り込みました: ${byId.size}行（有効 ${cnt.有効}・完了 ${cnt.完了}・取消 ${cnt.取消}）、` +
                `注残 ${active.length}行・${remainTotal.toLocaleString('ja-JP')}個。基準日 ${OrderManager.fmtDate(baseDate)}`
        };
    }

    // ------------------------------------------------------------
    // 出荷履歴 → 出荷予定の残数を減らす
    // ------------------------------------------------------------

    /**
     * 出荷実績（発注番号つき）を出荷予定に反映するための書き込み操作を作る
     * @param {Array<{orderNo, shipmentQuantity, shipmentDate, line}>} shipped - 新しく取り込む出荷実績
     * @param {string} fileName
     * @returns {Promise<{ops: Array, errors: Array, applied: number, completed: number}>}
     */
    async buildShipmentApplyOps(shipped, fileName) {
        const schedules = await this.db.getAll('shipmentSchedules');
        const map = new Map(schedules.map(s => [s.id, { ...s }]));
        const touched = new Map();
        const logs = [];
        const errors = [];
        const at = Date.now();
        let applied = 0, completed = 0;

        const appliedIds = new Set();
        for (const h of shipped) {
            const s = map.get(h.orderNo);
            if (!s) {
                errors.push(`行 ${h.line}: 発注番号 ${h.orderNo} が出荷予定にありません` +
                    `（出荷履歴には登録しました。あとでこの発注番号がEDIで届いたら、自動で出荷済に反映します）`);
                continue;
            }
            if (h.id) appliedIds.add(h.id);
            const before = Math.max(0, (Number(s.orderQty) || 0) - (Number(s.shippedQty) || 0));
            s.shippedQty = (Number(s.shippedQty) || 0) + h.shipmentQuantity;
            const after = Math.max(0, s.orderQty - s.shippedQty);
            let content = `出荷 ${h.shipmentQuantity}個（${OrderManager.fmtDate(h.shipmentDate)}）残 ${before}→${after}`;
            if (s.status === '有効' && after === 0) {
                s.status = '完了';
                content += ' → 完了';
                completed++;
            }
            const addCheck = (msg) => {
                if (!String(s.needsCheck || '').includes(msg)) s.needsCheck = s.needsCheck ? `${s.needsCheck} / ${msg}` : msg;
            };
            if (s.status === '取消') {
                errors.push(`行 ${h.line}: 発注番号 ${h.orderNo} は取消済みですが出荷がありました（要確認）`);
                addCheck('取消済みの注文に出荷あり');
            }
            if (s.shippedQty > s.orderQty) {
                errors.push(`行 ${h.line}: 発注番号 ${h.orderNo} の出荷済数（${s.shippedQty}）が発注数量（${s.orderQty}）を超えています（要確認）`);
                addCheck(`発注数を超えて出荷（発注 ${s.orderQty}・出荷済 ${s.shippedQty}）`);
                content += ' 【発注数超過】';
            }
            s.updatedAt = at;
            OrderManager.recalc(s);
            touched.set(s.id, s);
            applied++;
            logs.push({
                id: `EDI_${at}_S${String(logs.length + 1).padStart(4, '0')}`,
                importedAt: at, fileName, orderNo: h.orderNo, kubun: '出荷', result: '出荷済数を更新',
                content, productCode: s.productCode, productName: s.productName, mjsDone: true
            });
        }

        const ops = [
            ...[...touched.values()].map(data => ({ op: 'put', store: 'shipmentSchedules', data })),
            ...logs.map(data => ({ op: 'put', store: 'ediLog', data }))
        ];
        return { ops, errors, applied, completed, appliedIds };
    }
}

const orderManager = new OrderManager(db);
