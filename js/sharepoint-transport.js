/**
 * SharePoint 保存（Microsoft Graph 経由）
 *
 * サーバーPCを使わず、データを SharePoint のフォルダに保存する。
 *  - ストア（製品・部品・在庫…）ごとに 1 つの JSON ファイル（例: parts.json）
 *  - 読み込み: ファイルを丸ごと取得（部品 1 万件でも 1 回の通信）
 *  - 保存: 「読み込んだ時から誰も変えていなければ保存」（If-Match）。
 *          他の人が先に保存していたら、最新を読み直して自分の変更だけを再適用する
 *          → 2 人が同時に保存しても、どちらの変更も消えない
 *  - SharePoint のバージョン履歴が自動で残るので、前の状態に戻すこともできる
 *
 * database.js（Database クラス）から呼ばれる。画面側のコードは変更不要。
 */
class SharePointTransport {
    /**
     * @param {object} cfg - js/config.js の sharepoint 設定
     *   tenantId, clientId, folderUrl, graphBase(省略可), mock(テスト用)
     */
    constructor(cfg) {
        this.cfg = cfg || {};
        this.graph = (this.cfg.graphBase || 'https://graph.microsoft.com/v1.0').replace(/\/$/, '');
        this.scopes = ['User.Read', 'Files.ReadWrite.All'];
        this.msal = null;
        this.account = null;
        this.userName = '';
        this.driveId = null;
        this.folderId = null;
        this.folderWebUrl = '';
        this._listing = null;      // { at, map: name -> {id, eTag} }
        this._raw = new Map();     // store -> { eTag, id, records: Map(keyText -> rec), nextId }
        this._listingPromise = null;
    }

    get label() { return 'SharePoint'; }

    // ------------------------------------------------------------
    // ログイン（Microsoft 365 アカウント）
    // ------------------------------------------------------------

    async init() {
        if (this.cfg.mock) {
            this.userName = this.cfg.mockUser || 'テストユーザー';
        } else {
            if (typeof msal === 'undefined') throw new Error('ログイン用の部品（MSAL）が読み込まれていません。');
            if (!this.cfg.tenantId || !this.cfg.clientId || !this.cfg.folderUrl) {
                throw new Error('js/config.js に SharePoint の設定（tenantId / clientId / folderUrl）がありません。');
            }
            this.msal = new msal.PublicClientApplication({
                auth: {
                    clientId: this.cfg.clientId,
                    authority: `https://login.microsoftonline.com/${this.cfg.tenantId}`,
                    redirectUri: new URL('redirect.html', location.href).href
                },
                cache: { cacheLocation: 'localStorage' }
            });
            await this.msal.initialize();
            const res = await this.msal.handleRedirectPromise();
            this.account = res?.account || this.msal.getActiveAccount() || this.msal.getAllAccounts()[0] || null;
            if (!this.account) {
                // 未ログイン → Microsoft のログイン画面へ（戻ってきたら続きから）
                await this.msal.loginRedirect({ scopes: this.scopes });
                return new Promise(() => {});   // 画面遷移するので先へ進まない
            }
            this.msal.setActiveAccount(this.account);
            this.userName = this.account.name || this.account.username || '';
        }
        await this._resolveFolder();
        await this._list(true);
        return this;
    }

    async _token() {
        if (this.cfg.mock) return 'mock-token';
        try {
            const r = await this.msal.acquireTokenSilent({ scopes: this.scopes, account: this.account });
            return r.accessToken;
        } catch (e) {
            if (e instanceof msal.InteractionRequiredAuthError || /interaction_required|login_required|consent_required/.test(String(e.errorCode || e.message))) {
                await this.msal.acquireTokenRedirect({ scopes: this.scopes, account: this.account });
                return new Promise(() => {});
            }
            throw e;
        }
    }

    async logout() {
        if (this.msal) await this.msal.logoutRedirect({ account: this.account });
    }

    // ------------------------------------------------------------
    // Graph 通信
    // ------------------------------------------------------------

    /** Graph に要求を送る（混雑時は待って再試行） */
    async _fetch(url, opts = {}, attempt = 0) {
        const headers = { Authorization: `Bearer ${await this._token()}`, ...(opts.headers || {}) };
        let res;
        try {
            res = await fetch(url.startsWith('http') ? url : this.graph + url, { ...opts, headers });
        } catch (e) {
            const err = new Error(`SharePoint に接続できません（${e.message}）。インターネット接続を確認してください。`);
            err.name = 'NetworkError';
            throw err;
        }
        if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < 6) {
            const wait = (parseInt(res.headers.get('Retry-After') || '0', 10) || Math.min(2 ** attempt, 20)) * 1000;
            await new Promise(r => setTimeout(r, wait));
            return this._fetch(url, opts, attempt + 1);
        }
        return res;
    }

    async _json(url, opts) {
        const res = await this._fetch(url, opts);
        if (!res.ok) throw await this._error(res, url);
        return res.json();
    }

    async _error(res, what) {
        let detail = '';
        try { detail = (await res.json())?.error?.message || ''; } catch (e) { /* 本文なし */ }
        const msgs = {
            401: 'ログインの有効期限が切れました。ページを再読み込みしてください。',
            403: 'SharePoint のフォルダにアクセスする権限がありません。フォルダの共有設定を確認してください。',
            404: 'SharePoint のフォルダが見つかりません。js/config.js の folderUrl を確認してください。'
        };
        const err = new Error(`${msgs[res.status] || `SharePoint エラー (${res.status})`}${detail ? `\n詳細: ${detail}` : ''}`);
        err.status = res.status;
        err.name = res.status === 412 || res.status === 409 ? 'ConflictError' : 'Error';
        return err;
    }

    /** SharePoint のフォルダURLから、ドライブとフォルダのIDを調べる */
    async _resolveFolder() {
        const url = String(this.cfg.folderUrl).trim();
        const cacheKey = `inv_sp_folder_${url}`;
        try {
            const c = JSON.parse(localStorage.getItem(cacheKey) || 'null');
            if (c && c.driveId && c.folderId) Object.assign(this, c);
        } catch (e) { /* 使えない環境 */ }
        if (this.driveId && this.folderId) return;

        let item = null;
        const u0 = new URL(url);
        const isBrowserUrl = u0.searchParams.has('id') || /\/Forms\//i.test(u0.pathname);
        // ① 共有リンク（https://…/:f:/s/…）は、そのまま Graph に渡す
        if (!isBrowserUrl) {
            try {
                const b64 = btoa(unescape(encodeURIComponent(url))).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
                item = await this._json(`/shares/u!${b64}/driveItem?$select=id,name,webUrl,folder,parentReference`);
                if (!item.folder) item = null;
            } catch (e) {
                item = null;
            }
        }
        // ② ブラウザで開いたフォルダのURL（…/Forms/AllItems.aspx?id=/sites/…）を分解する
        if (!item) {
            const u = new URL(url);
            const serverPath = decodeURIComponent(u.searchParams.get('id') || u.pathname).replace(/\/Forms\/[^/]+\.aspx$/i, '');
            const seg = serverPath.split('/').filter(Boolean);
            const sitePath = (seg[0] === 'sites' || seg[0] === 'teams') ? `/${seg[0]}/${seg[1]}` : '';
            const site = await this._json(`/sites/${u.hostname}:${sitePath || '/'}`);
            const drives = (await this._json(`/sites/${site.id}/drives?$select=id,name,webUrl`)).value || [];
            const full = `${u.origin}${serverPath}`;
            const drive = drives
                .filter(d => full.startsWith(decodeURIComponent(d.webUrl)))
                .sort((a, b) => b.webUrl.length - a.webUrl.length)[0];
            if (!drive) throw new Error('SharePoint のフォルダURLから、ドキュメントライブラリを特定できませんでした。');
            const rel = full.slice(decodeURIComponent(drive.webUrl).length).replace(/^\/+/, '');
            item = await this._json(`/drives/${drive.id}/root${rel ? `:/${encodeURIComponent(rel).replace(/%2F/g, '/')}:` : ''}?$select=id,name,webUrl,folder,parentReference`);
            item.parentReference = { ...(item.parentReference || {}), driveId: drive.id };
        }
        if (!item.folder) throw new Error('folderUrl がフォルダではありません。データ用フォルダのURLを指定してください。');
        this.driveId = item.parentReference.driveId;
        this.folderId = item.id;
        this.folderWebUrl = item.webUrl || url;
        try {
            localStorage.setItem(cacheKey, JSON.stringify({ driveId: this.driveId, folderId: this.folderId, folderWebUrl: this.folderWebUrl }));
        } catch (e) { /* 使えない環境 */ }
    }

    static fileName(store) { return `${store}.json`; }

    /** フォルダ内のファイル一覧（ストアごとの版 = eTag） */
    async _list(force = false) {
        if (!force && this._listing && Date.now() - this._listing.at < 1000) return this._listing.map;
        if (!this._listingPromise) {
            this._listingPromise = (async () => {
                const map = new Map();
                let next = `/drives/${this.driveId}/items/${this.folderId}/children?$select=id,name,eTag&$top=200`;
                while (next) {
                    const page = await this._json(next);
                    for (const it of page.value || []) map.set(it.name, { id: it.id, eTag: it.eTag });
                    next = page['@odata.nextLink'] || null;
                }
                this._listing = { at: Date.now(), map };
                return map;
            })().finally(() => { this._listingPromise = null; });
        }
        return this._listingPromise;
    }

    _versions(map) {
        const v = {};
        for (const name of Object.keys(DB_STORE_DEFS)) v[name] = map.get(SharePointTransport.fileName(name))?.eTag || '';
        return v;
    }

    static revisionOf(versions) {
        return Object.keys(versions).sort().map(k => `${k}=${versions[k]}`).join('|');
    }

    /** ストアのファイルを読む（版が同じなら手元のものを使う） */
    async _load(store, map) {
        const entry = map.get(SharePointTransport.fileName(store));
        if (!entry) {
            return { eTag: '', id: null, records: new Map(), nextId: 1 };
        }
        const cached = this._raw.get(store);
        if (cached && cached.eTag === entry.eTag) return cached;

        const meta = await this._json(`/drives/${this.driveId}/items/${entry.id}?$select=id,eTag,@microsoft.graph.downloadUrl`);
        const dl = meta['@microsoft.graph.downloadUrl'];
        let res;
        try {
            res = await fetch(dl, { cache: 'no-store' });
        } catch (e) {
            const err = new Error(`SharePoint からデータを読み込めません（${e.message}）`);
            err.name = 'NetworkError';
            throw err;
        }
        if (!res.ok) throw await this._error(res, store);
        const body = await res.json();
        const kp = DB_STORE_DEFS[store].keyPath;
        const records = new Map();
        for (const r of body.records || []) records.set(Database._keyText(r[kp]), r);
        const raw = { eTag: meta.eTag, id: meta.id, records, nextId: Number(body.nextId) || 1 };
        this._raw.set(store, raw);
        return raw;
    }

    /** ストアのファイルを保存（誰かが先に保存していたら ConflictError） */
    async _save(store, raw, records, nextId) {
        const body = JSON.stringify({
            format: 'inventory-store',
            version: 1,
            store,
            nextId,
            updatedAt: new Date().toISOString(),
            updatedBy: this.userName,
            count: records.size,
            records: [...records.values()]
        });
        let url, headers = { 'Content-Type': 'application/json' };
        if (raw.id) {
            url = `/drives/${this.driveId}/items/${raw.id}/content`;
            headers['If-Match'] = raw.eTag;
        } else {
            url = `/drives/${this.driveId}/items/${this.folderId}:/${SharePointTransport.fileName(store)}:/content?@microsoft.graph.conflictBehavior=fail`;
        }
        const res = await this._fetch(url, { method: 'PUT', headers, body });
        if (!res.ok) throw await this._error(res, store);
        const item = await res.json();
        const saved = { eTag: item.eTag, id: item.id, records, nextId };
        this._raw.set(store, saved);
        return saved;
    }

    // ------------------------------------------------------------
    // 操作の実行（サーバー版 server.py と同じ意味）
    // ------------------------------------------------------------

    static _err(message, name) {
        const e = new Error(message);
        e.name = name;
        return e;
    }

    /** 1 ストア分の操作を、作業用コピーに適用する */
    static _apply(store, records, nextId, items) {
        const def = DB_STORE_DEFS[store];
        const kp = def.keyPath;
        const results = [];
        for (const { op } of items) {
            if (op.op === 'clearStore' || op.op === 'clearAll') {
                records.clear();
                results.push(null);
            } else if (op.op === 'delete') {
                records.delete(Database._keyText(op.key));
                results.push(null);
            } else if (op.op === 'put' || op.op === 'add') {
                if (!op.data || typeof op.data !== 'object') {
                    throw SharePointTransport._err('保存データがオブジェクトではありません', 'DataError');
                }
                const data = structuredClone(op.data);
                let key = data[kp];
                if (def.auto) {
                    if (key === undefined || key === null) {
                        key = nextId++;
                        data[kp] = key;
                    } else if (typeof key === 'number' && key >= nextId) {
                        nextId = Math.floor(key) + 1;
                    }
                }
                if (!Database._isKey(key)) {
                    throw SharePointTransport._err(`${store}: 主キー「${kp}」が不正です (${JSON.stringify(key)})`, 'DataError');
                }
                const kt = Database._keyText(key);
                if (op.op === 'add' && records.has(kt)) {
                    throw SharePointTransport._err(`${store}: 主キー ${key} は既に存在します`, 'ConstraintError');
                }
                records.set(kt, data);
                results.push(key);
            }
        }
        return { results, nextId };
    }

    /** 読み込み操作の結果 */
    static _read(store, raw, op) {
        if (op.op === 'getAll') return [...raw.records.values()];
        if (op.op === 'get') return raw.records.get(Database._keyText(op.key)) ?? null;
        if (op.op === 'getByIndex') {
            const path = DB_STORE_DEFS[store].indexes[op.index];
            if (path === undefined) throw SharePointTransport._err(`${store}: 不明なインデックス ${op.index}`, 'NotFoundError');
            const want = Database._keyText(op.value);
            return [...raw.records.values()].filter(r => {
                const v = Database._extract(r, path);
                return v !== undefined && Database._keyText(v) === want;
            });
        }
        throw SharePointTransport._err(`不明な操作: ${op.op}`, 'Error');
    }

    /** 版の確認（他の人の更新の検知用） */
    async ping() {
        const map = await this._list(true);
        const versions = this._versions(map);
        return { revision: SharePointTransport.revisionOf(versions), versions };
    }

    /**
     * 操作をまとめて実行する
     * @returns {{ok, results, revision, prevRevision, versions, prevVersions}}
     */
    async send(ops) {
        const WRITE = ['add', 'put', 'delete', 'clearStore', 'clearAll'];
        const isWrite = ops.some(o => WRITE.includes(o.op));
        if (isWrite) {
            // 同じ画面からの保存は 1 つずつ順番に（自分どうしで取り合わないように）
            const run = () => this._send(ops, WRITE, isWrite);
            const p = (this._writeChain || Promise.resolve()).then(run, run);
            this._writeChain = p.catch(() => {});
            return p;
        }
        return this._send(ops, WRITE, isWrite);
    }

    async _send(ops, WRITE, isWrite) {
        let map = await this._list(isWrite);   // 書き込み時は必ず最新の版を見る
        const prevVersions = this._versions(map);
        const results = new Array(ops.length).fill(null);

        // 読み込み
        for (let i = 0; i < ops.length; i++) {
            const op = ops[i];
            if (WRITE.includes(op.op)) continue;
            if (!DB_STORE_DEFS[op.store]) throw SharePointTransport._err(`不明なストア: ${op.store}`, 'NotFoundError');
            const raw = await this._load(op.store, map);
            results[i] = SharePointTransport._read(op.store, raw, op);
        }
        if (!isWrite) {
            const versions = this._versions(map);
            const revision = SharePointTransport.revisionOf(versions);
            return { ok: true, results, revision, prevRevision: revision, versions, prevVersions: versions };
        }

        // 書き込み: ストアごとに操作をまとめる（clearAll は全ストア）
        const byStore = new Map();
        ops.forEach((op, i) => {
            if (!WRITE.includes(op.op)) return;
            const stores = op.op === 'clearAll' ? Object.keys(DB_STORE_DEFS) : [op.store];
            for (const s of stores) {
                if (!DB_STORE_DEFS[s]) throw SharePointTransport._err(`不明なストア: ${s}`, 'NotFoundError');
                if (!byStore.has(s)) byStore.set(s, []);
                byStore.get(s).push({ op: op.op === 'clearAll' ? { op: 'clearAll' } : op, index: i });
            }
        });

        // ① まず全ストアを手元で試す（エラーがあれば何も保存しない）
        const plan = new Map();
        for (const [store, items] of byStore) {
            const raw = await this._load(store, map);
            const records = new Map(raw.records);
            const { results: r, nextId } = SharePointTransport._apply(store, records, raw.nextId, items);
            plan.set(store, { raw, records, nextId, r });
        }

        // ② ストアごとに保存。先に誰かが保存していたら、読み直して自分の操作だけ再適用
        for (const [store, items] of byStore) {
            let { raw, records, nextId, r } = plan.get(store);
            for (let attempt = 0; ; attempt++) {
                try {
                    await this._save(store, raw, records, nextId);
                    break;
                } catch (e) {
                    if (e.name !== 'ConflictError' || attempt >= 8) throw e;
                    await new Promise(res => setTimeout(res, 150 + Math.random() * 350 * (attempt + 1)));
                    map = await this._list(true);
                    raw = await this._load(store, map);
                    records = new Map(raw.records);
                    ({ results: r, nextId } = SharePointTransport._apply(store, records, raw.nextId, items));
                }
            }
            items.forEach((it, k) => {
                if (it.op.op !== 'clearAll') results[it.index] = r[k];
            });
        }

        // ③ 保存後の版（他の人の更新を見落とさないよう、一覧を取り直す）
        map = await this._list(true);
        const versions = this._versions(map);
        return {
            ok: true, results,
            revision: SharePointTransport.revisionOf(versions),
            prevRevision: SharePointTransport.revisionOf(prevVersions),
            versions, prevVersions
        };
    }
}
