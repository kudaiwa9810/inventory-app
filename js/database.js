/**
 * データベース管理クラス（共有サーバー版）
 *
 * 以前はブラウザ内の IndexedDB に保存していましたが、
 * 社内共有のためサーバー（server/server.py）の SQLite に保存するように変更しました。
 * 呼び出し方（add / put / get / getAll / getByIndex / delete / transaction など）は以前と同じです。
 *
 * 【読み込みキャッシュ】
 * 部品が1万件を超えるため、1件ずつサーバーに問い合わせると通信が溢れて失敗します。
 * そこで各ストア（製品・部品・在庫…）を初回に1回だけまとめて取得し、
 * 以降の get / getAll / getByIndex は手元のコピーから返します。
 * 他の人が更新した場合は、約2秒以内に検知してコピーを取り直します。
 */

// ストア定義（サーバー側 server.py の STORES と同じ）
const DB_STORE_DEFS = {
    products:          { keyPath: 'productCode',  indexes: { productName: 'productName' } },
    parts:             { keyPath: 'id', auto: true,
                         indexes: { partCode: 'partCode', productCode: 'productCode',
                                    productCode_partCode: ['productCode', 'partCode'], process: 'process' } },
    inventory:         { keyPath: 'partCode',     indexes: { currentStock: 'currentStock' } },
    stockHistory:      { keyPath: 'id',           indexes: { partCode: 'partCode', changeType: 'changeType', createdAt: 'createdAt' } },
    shipmentSchedules: { keyPath: 'id',           indexes: { productCode: 'productCode', shipmentDate: 'shipmentDate', orderNo: 'orderNo' } },
    shipmentHistory:   { keyPath: 'id',           indexes: { productCode: 'productCode', shipmentDate: 'shipmentDate', importedAt: 'importedAt', orderNo: 'orderNo' } },
    orderRecords:      { keyPath: 'id',           indexes: { partCode: 'partCode', status: 'status', orderDate: 'orderDate' } },
    suppliers:         { keyPath: 'supplierCode', indexes: { supplierName: 'supplierName' } },
    ediLog:            { keyPath: 'id',           indexes: { orderNo: 'orderNo', importedAt: 'importedAt' } },
    appSettings:       { keyPath: 'key',          indexes: {} }
};

const FRESH_MS = 2000;  // この時間内は、サーバーへの更新確認を省略する

/**
 * 社内サーバーPC（server/server.py）に保存する場合の通信
 */
class ServerTransport {
    get label() { return 'サーバーPC'; }

    async init() {
        if (location.protocol === 'file:') {
            throw new Error('このアプリはサーバー経由で開いてください（例: http://サーバーPC名:8000/ ）');
        }
        // サーバー起動直後などに備えて、数回リトライする（約10秒）
        let res = null;
        for (let i = 0; i < 10; i++) {
            try {
                res = await fetch('api/ping', { cache: 'no-store' });
                if (res.ok) break;
            } catch (e) {
                res = null;
            }
            await new Promise(r => setTimeout(r, 1000));
        }
        if (!res) {
            throw new Error('サーバーに接続できません。サーバーPCで「サーバー起動.bat」の黒い画面が開いているか確認してください。');
        }
        if (!res.ok) {
            throw new Error(`サーバー応答エラー (${res.status})。ポート8000で別のソフトが動いている可能性があります。`);
        }
    }

    async ping() {
        const res = await fetch('api/ping', { cache: 'no-store' });
        return res.json();
    }

    async send(ops, atomic) {
        let res;
        try {
            res = await fetch('api/db', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ops, atomic })
            });
        } catch (e) {
            console.error('サーバー通信エラー', ops.map(o => `${o.op}:${o.store || ''}`).join(','), e);
            const err = new Error(`サーバーとの通信に失敗しました（${e.name}: ${e.message}）。サーバーPCを確認してください。`);
            err.name = 'NetworkError';
            throw err;
        }
        let body;
        try {
            body = await res.json();
        } catch (e) {
            throw new Error(`サーバー応答エラー (${res.status})`);
        }
        if (!body.ok) {
            const err = new Error(body.error || 'サーバーでエラーが発生しました');
            err.name = body.name || 'Error';
            throw err;
        }
        return body;
    }
}

class Database {
    constructor() {
        this.apiUrl = 'api/db';
        this.db = null;             // 互換用（以前は IDBDatabase が入っていた）
        this.revision = null;       // 手元のコピーが対応しているサーバーの更新番号
        this.externalChanged = false; // 他の人の更新を検知したか（画面の更新通知用）
        this._cache = new Map();    // store -> { map: Map(keyText -> record), sorted: Array|null }
        this._loading = new Map();  // store -> Promise
        this._lastCheck = 0;
        this._checking = null;
    }

    /**
     * サーバーへの接続確認
     */
    async init() {
        // 保存先: js/config.js の storage（'sharepoint' / 'server' / 'auto'）
        //  auto … https で開いていて SharePoint の設定があれば SharePoint、それ以外はサーバーPC
        const cfg = window.APP_CONFIG || {};
        const sp = cfg.sharepoint || {};
        const useSharePoint = cfg.storage === 'sharepoint' ||
            (cfg.storage !== 'server' && sp.clientId && location.protocol === 'https:');
        this._transport = useSharePoint ? new SharePointTransport(sp) : new ServerTransport();
        await this._transport.init();
        const info = await this._transport.ping();
        this.revision = info.revision;
        this._versions = info.versions || null;   // SharePoint: ストアごとの版
        this._lastCheck = Date.now();
        this.db = this;
        return this;
    }

    /** 保存先の表示名（'SharePoint' / 'サーバーPC'） */
    get storageLabel() { return this._transport?.label || ''; }
    /** ログイン中のユーザー名（SharePoint のみ） */
    get userName() { return this._transport?.userName || ''; }

    // ------------------------------------------------------------
    // キーの扱い（IndexedDB と同じ並び順: 数値 < 文字列 < 配列）
    // ------------------------------------------------------------
    static _keyText(k) { return JSON.stringify(k); }

    static _isKey(v) {
        if (typeof v === 'number') return !Number.isNaN(v);
        if (typeof v === 'string') return true;
        if (Array.isArray(v)) return v.every(Database._isKey);
        return false;
    }

    static _cmp(a, b) {
        const rank = (v) => typeof v === 'number' ? 1 : typeof v === 'string' ? 3 : Array.isArray(v) ? 4 : 9;
        const ra = rank(a), rb = rank(b);
        if (ra !== rb) return ra - rb;
        if (ra === 4) {
            for (let i = 0; i < Math.min(a.length, b.length); i++) {
                const c = Database._cmp(a[i], b[i]);
                if (c !== 0) return c;
            }
            return a.length - b.length;
        }
        return a < b ? -1 : a > b ? 1 : 0;
    }

    static _extract(record, path) {
        if (Array.isArray(path)) {
            const vals = path.map(p => Database._extract(record, p));
            return vals.some(v => v === undefined) ? undefined : vals;
        }
        const v = record ? record[path] : undefined;
        return Database._isKey(v) ? v : undefined;
    }

    static _clone(v) {
        return v === undefined || v === null ? v : structuredClone(v);
    }

    // ------------------------------------------------------------
    // 通信
    // ------------------------------------------------------------
    /**
     * サーバーに操作をまとめて送る
     * @param {Array<object>} ops - 操作の配列
     * @param {boolean} atomic - true なら全部成功 or 全部取り消し
     * @returns {Promise<{results: Array, revision: string}>}
     */
    async _post(ops, atomic = false) {
        const body = await this._transport.send(ops, atomic);
        const isWrite = ops.some(o => ['add', 'put', 'delete', 'clearStore', 'clearAll'].includes(o.op));
        this._lastCheck = Date.now();

        if (body.versions) {
            // SharePoint: ストア（ファイル）ごとに、手元のコピーが最新かを判断する
            const written = new Set();
            for (const o of ops) {
                if (o.op === 'clearAll') Object.keys(DB_STORE_DEFS).forEach(n => written.add(n));
                else if (['add', 'put', 'delete', 'clearStore'].includes(o.op)) written.add(o.store);
            }
            if (isWrite) {
                // 書く前の手元のコピーが最新でなければ捨てる（取り直させる）
                for (const name of written) {
                    const entry = this._cache.get(name);
                    if (entry && entry.version !== body.prevVersions[name]) {
                        this._cache.delete(name);
                        this.externalChanged = true;
                    }
                }
                // 手元にコピーがあるストアだけ反映（無いものは次に読むとき取得する）
                this._applyToCache(ops, body.results);
                for (const name of written) {
                    const entry = this._cache.get(name);
                    if (entry) entry.version = body.versions[name];
                }
            }
            this._dropStale(body.versions, written);
            this.revision = body.revision;
            this._versions = body.versions;
            return { results: body.results, revision: body.revision, versions: body.versions };
        }

        if (isWrite) {
            if (body.prevRevision !== this.revision) {
                // 自分の書き込みの前に、他の人の更新があった
                this._onExternalChange(body.revision);
            } else {
                this.revision = body.revision;
                this._applyToCache(ops, body.results);
            }
        } else if (body.revision !== this.revision) {
            this._onExternalChange(body.revision);
        }
        return { results: body.results, revision: body.revision };
    }

    /** SharePoint: 版が変わったストアだけ手元のコピーを捨てる */
    _dropStale(versions, except = new Set()) {
        for (const [name, entry] of [...this._cache.entries()]) {
            if (except.has(name)) continue;
            if (versions[name] !== undefined && entry.version !== versions[name]) {
                this._cache.delete(name);
                this.externalChanged = true;
            }
        }
    }

    /** 他の人の更新を検知したら、手元のコピーを捨てて取り直させる */
    _onExternalChange(newRevision) {
        this._cache.clear();
        this._loading.clear();
        this.revision = newRevision;
        this.externalChanged = true;
    }

    /** 2秒以上確認していなければ、サーバーの更新番号を確認する */
    async _ensureFresh() {
        if (Date.now() - this._lastCheck < FRESH_MS) return;
        if (!this._checking) {
            this._checking = (async () => {
                try {
                    const info = await this._transport.ping();
                    this._lastCheck = Date.now();
                    if (info.versions) {
                        this._dropStale(info.versions);
                        this.revision = info.revision;
                        this._versions = info.versions;
                    } else if (info.revision !== this.revision) {
                        this._onExternalChange(info.revision);
                    }
                } finally {
                    this._checking = null;
                }
            })();
        }
        try {
            await this._checking;
        } catch (e) {
            // 確認に失敗しても、手元のコピーがあればそれを使う
        }
    }

    /** ストアのコピーを用意する（無ければサーバーから全件取得） */
    async _store(storeName) {
        if (!DB_STORE_DEFS[storeName]) throw new Error(`不明なストア: ${storeName}`);
        await this._ensureFresh();
        const cached = this._cache.get(storeName);
        if (cached) return cached;
        if (!this._loading.has(storeName)) {
            const p = (async () => {
                const { results, revision, versions } = await this._post([{ op: 'getAll', store: storeName }]);
                const kp = DB_STORE_DEFS[storeName].keyPath;
                const map = new Map();
                for (const r of results[0] || []) map.set(Database._keyText(r[kp]), r);
                const entry = { map, sorted: null, idx: new Map(), version: versions ? versions[storeName] : undefined };
                if (versions || revision === this.revision) this._cache.set(storeName, entry);
                return entry;
            })();
            this._loading.set(storeName, p);
            p.finally(() => { if (this._loading.get(storeName) === p) this._loading.delete(storeName); });
        }
        return this._loading.get(storeName);
    }

    _sorted(storeName, entry) {
        if (!entry.sorted) {
            const kp = DB_STORE_DEFS[storeName].keyPath;
            entry.sorted = [...entry.map.values()].sort((a, b) => Database._cmp(a[kp], b[kp]));
        }
        return entry.sorted;
    }

    /** 書き込みが成功したら、手元のコピーにも反映する */
    _applyToCache(ops, results) {
        ops.forEach((op, i) => {
            if (op.op === 'clearAll') {
                for (const name of Object.keys(DB_STORE_DEFS)) this._cache.set(name, { map: new Map(), sorted: null, idx: new Map() });
                return;
            }
            const entry = this._cache.get(op.store);
            if (!entry) return;
            entry.sorted = null;
            entry.idx.clear();
            const kp = DB_STORE_DEFS[op.store].keyPath;
            if (op.op === 'put' || op.op === 'add') {
                const rec = structuredClone(op.data);
                rec[kp] = results[i];
                entry.map.set(Database._keyText(results[i]), rec);
            } else if (op.op === 'delete') {
                entry.map.delete(Database._keyText(op.key));
            } else if (op.op === 'clearStore') {
                entry.map.clear();
            }
        });
    }

    async _write(ops, atomic = true) {
        const { results } = await this._post(ops, atomic);
        // 自動採番されたIDを元のオブジェクトにも反映（IndexedDB と同じ挙動）
        ops.forEach((op, i) => {
            if ((op.op === 'add' || op.op === 'put') && DB_STORE_DEFS[op.store]?.auto && op.data) {
                const kp = DB_STORE_DEFS[op.store].keyPath;
                if (op.data[kp] === undefined || op.data[kp] === null) op.data[kp] = results[i];
            }
        });
        return results;
    }

    // ------------------------------------------------------------
    // 公開メソッド（以前の IndexedDB 版と同じ呼び出し方）
    // ------------------------------------------------------------

    /** データを追加（同じキーが既にあればエラー） */
    async add(storeName, data) {
        return (await this._write([{ op: 'add', store: storeName, data }]))[0];
    }

    /** データを更新（存在しない場合は追加） */
    async put(storeName, data) {
        return (await this._write([{ op: 'put', store: storeName, data }]))[0];
    }

    /** キーで 1 件取得（無ければ undefined） */
    async get(storeName, key) {
        const entry = await this._store(storeName);
        return Database._clone(entry.map.get(Database._keyText(key)));
    }

    /** すべて取得 */
    async getAll(storeName) {
        const entry = await this._store(storeName);
        return this._sorted(storeName, entry).map(Database._clone);
    }

    /** インデックスで取得 */
    async getByIndex(storeName, indexName, value) {
        const path = DB_STORE_DEFS[storeName]?.indexes[indexName];
        if (path === undefined) throw new Error(`${storeName}: 不明なインデックス ${indexName}`);
        const entry = await this._store(storeName);
        // 索引（値 → レコード一覧）を初回だけ作る
        let index = entry.idx.get(indexName);
        if (!index) {
            index = new Map();
            for (const r of this._sorted(storeName, entry)) {
                const v = Database._extract(r, path);
                if (v === undefined) continue;
                const k = Database._keyText(v);
                if (!index.has(k)) index.set(k, []);
                index.get(k).push(r);
            }
            entry.idx.set(indexName, index);
        }
        return (index.get(Database._keyText(value)) || []).map(Database._clone);
    }

    /** キーで削除 */
    async delete(storeName, key) {
        await this._write([{ op: 'delete', store: storeName, key }]);
    }

    /** 製品コード＋部品コードで部品を取得 */
    async getPartByProductAndCode(productCode, partCode) {
        const rows = await this.getByIndex('parts', 'productCode_partCode', [productCode, partCode]);
        return rows[0] || null;
    }

    /** 製品コード＋部品コードで部品を削除 */
    async deletePartByProductAndCode(productCode, partCode) {
        const part = await this.getPartByProductAndCode(productCode, partCode);
        if (!part) return false;
        await this.delete('parts', part.id);
        return true;
    }

    /**
     * 複数の書き込みをまとめて実行（全部成功 or 全部取り消し）
     * callback には以前と同じく transaction 風のオブジェクトが渡されます。
     *   tx.objectStore('inventory').put({...})
     *   tx.objectStore('stockHistory').add({...})
     * ※ callback 内での読み込み（get）は使えません。読み込みは事前に行ってください。
     */
    async transaction(storeNames, callback) {
        const ops = [];
        const tx = {
            objectStore: (name) => {
                if (!storeNames.includes(name)) {
                    throw new Error(`トランザクション対象外のストアです: ${name}`);
                }
                return {
                    add: (data) => { ops.push({ op: 'add', store: name, data }); },
                    put: (data) => { ops.push({ op: 'put', store: name, data }); },
                    delete: (key) => { ops.push({ op: 'delete', store: name, key }); },
                    clear: () => { ops.push({ op: 'clearStore', store: name }); }
                };
            }
        };
        callback(tx);
        if (ops.length > 0) {
            await this._write(ops, true);
        }
    }

    /** 書き込み操作の配列をまとめて実行（一括処理用） */
    async batch(ops) {
        return this._write(ops, true);
    }

    /** 指定ストアを全削除 */
    async clearStore(storeName) {
        await this._write([{ op: 'clearStore', store: storeName }]);
    }

    /** 全データ削除（開発・テスト用） */
    async clearAll() {
        await this._write([{ op: 'clearAll' }]);
    }

    /**
     * 他の人の更新があったか確認（画面の更新通知用）
     * サーバーに繋がらない場合は例外を投げる
     * @returns {Promise<boolean>}
     */
    async checkForUpdates() {
        const info = await this._transport.ping();
        this._lastCheck = Date.now();
        if (info.versions) {
            this._dropStale(info.versions);
            this.revision = info.revision;
            this._versions = info.versions;
        } else if (info.revision !== this.revision) {
            this._onExternalChange(info.revision);
        }
        const changed = this.externalChanged;
        this.externalChanged = false;
        return changed;
    }
}

// シングルトンインスタンスをエクスポート
const db = new Database();
