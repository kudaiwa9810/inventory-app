/**
 * インクリメンタル検索マネージャー
 */
class SearchManager {
    constructor(db) {
        this.db = db;
        this.searchInput = null;
        this.autocompleteContainer = null;
        this.searchResults = [];
        this.currentResultIndex = -1;
        this.isSearchMode = false;
        this.currentScreen = 'dashboard';
    }

    /**
     * 初期化
     */
    init() {
        this.searchInput = document.getElementById('global-search');
        this.autocompleteContainer = document.getElementById('search-autocomplete');
        const searchBtn = document.getElementById('search-btn');

        if (!this.searchInput || !this.autocompleteContainer) return;

        // イベントリスナー設定
        this.searchInput.addEventListener('input', (e) => this.handleInput(e));
        this.searchInput.addEventListener('keydown', (e) => this.handleKeydown(e));
        this.searchInput.addEventListener('blur', () => {
            setTimeout(() => this.hideAutocomplete(), 200);
        });

        searchBtn.addEventListener('click', () => this.executeSearch());

        // 画面外クリックでオートコンプリートを閉じる
        document.addEventListener('click', (e) => {
            if (!this.searchInput.contains(e.target) && !this.autocompleteContainer.contains(e.target)) {
                this.hideAutocomplete();
            }
        });
    }

    /**
     * 現在の画面を設定
     */
    setCurrentScreen(screenName) {
        this.currentScreen = screenName;
    }

    /**
     * 入力ハンドラー
     */
    async handleInput(e) {
        const query = e.target.value.trim();

        if (query.length < 1) {
            this.hideAutocomplete();
            // 出荷記録タブで検索欄を空にしたら、絞り込みを解除
            if (this.currentScreen === 'shipment') window.uiManager?.applyShipmentFilter({});
            return;
        }

        await this.showAutocomplete(query);
    }

    /**
     * キーダウンハンドラー
     */
    handleKeydown(e) {
        const items = this.autocompleteContainer.querySelectorAll('.autocomplete-item');

        switch (e.key) {
            case 'Enter':
                e.preventDefault();
                if (this.autocompleteContainer.classList.contains('show') && items.length > 0) {
                    const selected = this.autocompleteContainer.querySelector('.autocomplete-item.selected');
                    if (selected) {
                        selected.click();
                    } else {
                        this.executeSearch();
                    }
                } else {
                    this.executeSearch();
                }
                break;

            case 'ArrowDown':
                e.preventDefault();
                if (this.isSearchMode) {
                    this.navigateResults(1);
                } else if (items.length > 0) {
                    this.selectNextAutocomplete(items, 1);
                }
                break;

            case 'ArrowUp':
                e.preventDefault();
                if (this.isSearchMode) {
                    this.navigateResults(-1);
                } else if (items.length > 0) {
                    this.selectNextAutocomplete(items, -1);
                }
                break;

            case 'Escape':
                e.preventDefault();
                this.exitSearchMode();
                break;
        }
    }

    /**
     * オートコンプリート項目の選択
     */
    selectNextAutocomplete(items, direction) {
        const selected = this.autocompleteContainer.querySelector('.autocomplete-item.selected');
        let index = selected ? Array.from(items).indexOf(selected) : -1;

        if (selected) {
            selected.classList.remove('selected');
        }

        index = (index + direction + items.length) % items.length;
        items[index].classList.add('selected');
        items[index].scrollIntoView({ block: 'nearest' });
    }

    /**
     * オートコンプリートを表示
     */
    async showAutocomplete(query) {
        const suggestions = await this.getSuggestions(query);

        if (suggestions.length === 0) {
            this.hideAutocomplete();
            return;
        }

        this.autocompleteContainer.innerHTML = suggestions.map(item => `
      <div class="autocomplete-item" data-value="${item.value}" data-text="${item.text}" data-type="${item.type}">
        <div class="autocomplete-category">${item.category}</div>
        <div class="autocomplete-text">${this.highlightMatch(item.text, query)}</div>
      </div>
    `).join('');

        // クリックイベント
        this.autocompleteContainer.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('click', () => {
                this.searchInput.value = item.dataset.value;
                this.hideAutocomplete();

                // 出荷記録タブは一覧を絞り込む
                if (this.currentScreen === 'shipment') {
                    if (item.dataset.type === 'order') {
                        window.uiManager?.applyShipmentFilter({ orderNo: item.dataset.value });
                    } else {
                        window.uiManager?.applyShipmentFilter({ productCode: item.dataset.value });
                    }
                    return;
                }

                // 在庫タブ・部品タブ（折りたたみ表示）はデータ起点で該当箇所へ移動
                if (this._isAccordionScreen()) {
                    if (item.dataset.type === 'product') {
                        this.navigateToProduct(item.dataset.value);
                    } else {
                        this.navigateToPart(item.dataset.value);
                    }
                } else {
                    // 他タブは表示テキスト全体で完全部分一致検索
                    this.executeSearchExact(item.dataset.text);
                }
            });
        });

        this.autocompleteContainer.classList.add('show');
    }

    /**
     * オートコンプリートを非表示
     */
    hideAutocomplete() {
        this.autocompleteContainer.classList.remove('show');
    }

    /**
     * サジェスト候補を取得
     */
    async getSuggestions(query) {
        const suggestions = [];
        const lowerQuery = query.toLowerCase();

        try {
            // 出荷記録タブ: いま表示中の一覧（予定 or 履歴）から製品・発注番号を候補にする
            if (this.currentScreen === 'shipment') {
                return await this.getShipmentSuggestions(lowerQuery);
            }

            // 現在の画面に応じてデータを取得
            let products = [];
            let parts = [];

            if (['products', 'dashboard', 'inventory', 'parts'].includes(this.currentScreen)) {
                products = await this.db.getAll('products');
            }

            if (this.currentScreen === 'parts' || this.currentScreen === 'inventory' || this.currentScreen === 'dashboard') {
                parts = await this.db.getAll('parts');
            }

            // 製品候補
            products.forEach(p => {
                if (this.fuzzyMatch(p.productCode, lowerQuery) || this.fuzzyMatch(p.productName, lowerQuery)) {
                    suggestions.push({
                        category: '製品番号',
                        type: 'product',
                        text: `${p.productCode} - ${p.productName}`,
                        value: p.productCode
                    });
                }
            });

            // 部品候補
            const addedParts = new Set();
            parts.forEach(p => {
                const key = `${p.partCode}-${p.partName}`;
                if (addedParts.has(key)) return;

                if (this.fuzzyMatch(p.partCode, lowerQuery) ||
                    this.fuzzyMatch(p.partName, lowerQuery) ||
                    this.fuzzyMatch(p.supplier, lowerQuery) ||
                    this.fuzzyMatch(p.supplierCode, lowerQuery)) {
                    suggestions.push({
                        category: '部品',
                        type: 'part',
                        text: `${p.partCode} - ${p.partName}`,
                        value: p.partCode
                    });
                    addedParts.add(key);
                }
            });

            const productHits = suggestions.filter(s => s.type === 'product').slice(0, 5);
            const partHits = suggestions.filter(s => s.type === 'part');
            return [...productHits, ...partHits].slice(0, 10); // 最大10件
        } catch (error) {
            console.error('Failed to get suggestions:', error);
            return [];
        }
    }

    /**
     * 出荷記録タブ用の候補（製品・発注番号）
     */
    async getShipmentSuggestions(lowerQuery) {
        const store = window.uiManager?._shipmentSubTab === 'history' ? 'shipmentHistory' : 'shipmentSchedules';
        let rows = await this.db.getAll(store);
        if (store === 'shipmentSchedules') rows = rows.filter(isActiveShipment);
        const has = (v) => (v || '').toString().toLowerCase().includes(lowerQuery);

        const products = new Map();
        const orders = new Map();
        for (const r of rows) {
            if ((has(r.productCode) || has(r.productName)) && !products.has(r.productCode)) {
                products.set(r.productCode, r.productName);
            }
            if (r.orderNo && has(r.orderNo)) {
                orders.set(r.orderNo, (orders.get(r.orderNo) || 0) + 1);
            }
        }
        const list = [];
        for (const [code, name] of products) {
            list.push({ category: '製品', type: 'product', text: `${code} - ${name}`, value: code });
        }
        for (const [no, n] of orders) {
            list.push({ category: '発注番号', type: 'order', text: `${no}（${n}行）`, value: no });
        }
        return list.slice(0, 10);
    }

    /**
     * ファジーマッチング
     */
    fuzzyMatch(text, query) {
        if (!text) return false;
        const lowerText = text.toLowerCase();
        const lowerQuery = query.toLowerCase();

        // 完全一致または部分一致
        if (lowerText.includes(lowerQuery)) return true;

        // ファジーマッチング: queryの各文字が順番に含まれているか
        let textIndex = 0;
        for (let i = 0; i < lowerQuery.length; i++) {
            textIndex = lowerText.indexOf(lowerQuery[i], textIndex);
            if (textIndex === -1) return false;
            textIndex++;
        }
        return true;
    }

    /**
     * マッチ部分をハイライト
     */
    highlightMatch(text, query) {
        const lowerText = text.toLowerCase();
        const lowerQuery = query.toLowerCase();

        const index = lowerText.indexOf(lowerQuery);
        if (index !== -1) {
            return text.substring(0, index) +
                `<span class="highlight-match">${text.substring(index, index + query.length)}</span>` +
                text.substring(index + query.length);
        }
        return text;
    }

    /**
     * 検索を実行（ファジーマッチ：手入力検索用）
     */
    async executeSearch() {
        const query = this.searchInput.value.trim();
        if (!query) return;

        this.hideAutocomplete();

        // 出荷記録タブはキーワードで一覧を絞り込む
        if (this.currentScreen === 'shipment') {
            await window.uiManager?.applyShipmentFilter({ keyword: query });
            return;
        }

        // 在庫タブ・部品タブは DB 検索 → 該当箇所へ移動
        if (this._isAccordionScreen()) {
            await this.searchAccordionByText(query);
            return;
        }

        // 他タブは DOM テキスト検索
        this.searchResults = await this.findMatches(query);
        this.currentResultIndex = 0;
        this.isSearchMode = true;

        if (this.searchResults.length > 0) {
            this.highlightAndScroll(this.searchResults[0]);
            this.showSearchStatus();
        } else {
            alert('検索結果が見つかりませんでした');
            this.isSearchMode = false;
        }
    }

    /**
     * 完全部分一致で検索を実行（オートコンプリート選択時・他タブ用）
     * @param {string} fullText - 表示テキスト全体（例: "12345678 - 製品A"）
     */
    async executeSearchExact(fullText) {
        this.hideAutocomplete();

        // "コード - 名前" 形式の場合、DOM 上は別セルのためコード部分のみで検索
        const searchKey = fullText.includes(' - ') ? fullText.split(' - ')[0] : fullText;
        const lowerQuery = searchKey.toLowerCase();

        this.searchResults = await this.findMatchesExact(lowerQuery);
        this.currentResultIndex = 0;
        this.isSearchMode = true;

        if (this.searchResults.length > 0) {
            this.highlightAndScroll(this.searchResults[0]);
            this.showSearchStatus();
        } else {
            alert('検索結果が見つかりませんでした');
            this.isSearchMode = false;
        }
    }

    /** 折りたたみ表示の画面か（在庫管理・部品管理） */
    _isAccordionScreen(screen = this.currentScreen) {
        return screen === 'inventory' || screen === 'parts';
    }

    /**
     * 在庫タブ・部品タブ: テキストで DB を検索して該当行へナビゲート
     */
    async searchAccordionByText(query) {
        const allParts = await this.db.getAll('parts');
        const lowerQuery = query.toLowerCase();

        const matched = allParts.filter(p =>
            p.partCode?.toLowerCase().includes(lowerQuery) ||
            p.partName?.toLowerCase().includes(lowerQuery)
        );

        if (matched.length === 0) {
            // 部品で見つからなければ製品番号・製品名で探す
            const products = await this.db.getAll('products');
            const hitProduct = products.find(p =>
                p.productCode?.toLowerCase().includes(lowerQuery) ||
                p.productName?.toLowerCase().includes(lowerQuery)
            );
            if (hitProduct) {
                this.navigateToProduct(hitProduct.productCode);
                return;
            }
            alert('検索結果が見つかりませんでした');
            return;
        }

        // 最初にヒットした部品コードでナビゲート
        await this.navigateToPart(matched[0].partCode);
    }

    /**
     * 在庫タブ・部品タブ: 部品コードで対応するアコーディオン行を開いてスクロール
     * data-part-code 属性を起点にするため DOM テキスト検索不要
     */
    async navigateToPart(partCode, screen = this.currentScreen) {
        const ui = window.uiManager;
        // この部品を含む製品のアコーディオンだけ描画（閉じているものも含め innerHTML を確定させる）
        if (screen === 'parts') {
            ui?._renderPartsAccordionsContaining?.(partCode);
        } else {
            ui?._renderAccordionsContaining?.(partCode);
        }

        // 対象画面の中から data-part-code を持つ要素を探し、その行 <tr> を集める
        const screenEl = document.getElementById(`${screen}-screen`);
        const rows = [];
        screenEl?.querySelectorAll('[data-part-code]').forEach(el => {
            if (el.dataset.partCode !== partCode) return;
            const tr = el.closest('tr');
            if (tr && !rows.includes(tr)) rows.push(tr);
        });

        if (rows.length === 0) {
            alert('検索結果が見つかりませんでした');
            return;
        }

        // 同部品が複数製品にある場合は ↑↓キーで移動できる
        this.searchResults = rows;
        this.currentResultIndex = 0;
        this.isSearchMode = true;

        this.highlightAndScroll(this.searchResults[0]);
        this.showSearchStatus();
    }

    /**
     * 在庫タブ・部品タブ: 製品コードで対応するアコーディオンを開いて見出しへスクロール
     */
    navigateToProduct(productCode, screen = this.currentScreen) {
        const screenEl = document.getElementById(`${screen}-screen`);
        const header = Array.from(screenEl?.querySelectorAll('.accordion-header[data-product-code]') || [])
            .find(btn => btn.dataset.productCode === productCode);
        if (!header) {
            alert(screen === 'parts'
                ? 'この製品には部品が登録されていません'
                : 'この製品には在庫表示する部品がありません');
            return;
        }
        const body = header.nextElementSibling;
        if (body && body.style.display === 'none') header.click();  // 閉じていれば開く

        document.querySelectorAll('.search-highlight').forEach(el => el.classList.remove('search-highlight'));
        header.classList.add('search-highlight');
        this.searchResults = [header];
        this.currentResultIndex = 0;
        this.isSearchMode = true;
        setTimeout(() => header.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
        this.showSearchStatus();
    }

    // 旧名（他の箇所からの呼び出し互換）
    navigateToInventoryProduct(productCode) { return this.navigateToProduct(productCode, 'inventory'); }
    navigateToInventoryPart(partCode) { return this.navigateToPart(partCode, 'inventory'); }

    /**
     * マッチする要素を検索（ファジーマッチ）
     */
    async findMatches(query) {
        const results = [];
        const lowerQuery = query.toLowerCase();

        // 現在表示されている画面のテキストを検索
        const currentScreenElement = document.querySelector('.screen.active');
        if (!currentScreenElement) return results;

        // すべてのテキストノードを検索
        const walker = document.createTreeWalker(
            currentScreenElement,
            NodeFilter.SHOW_TEXT,
            null
        );

        let node;
        while (node = walker.nextNode()) {
            const text = node.textContent.trim();
            if (text && this.fuzzyMatch(text, lowerQuery)) {
                const element = node.parentElement;
                const isVisible = element.offsetParent !== null;
                const isInsideAccordion = element.closest('.accordion-body') !== null;
                if (element && (isVisible || isInsideAccordion)) {
                    results.push(element);
                }
            }
        }

        return results;
    }

    /**
     * マッチする要素を検索（完全部分一致）
     * @param {string} lowerQuery - 小文字化済みの検索文字列
     */
    async findMatchesExact(lowerQuery) {
        const results = [];

        const currentScreenElement = document.querySelector('.screen.active');
        if (!currentScreenElement) return results;

        const walker = document.createTreeWalker(
            currentScreenElement,
            NodeFilter.SHOW_TEXT,
            null
        );

        let node;
        while (node = walker.nextNode()) {
            const text = node.textContent.trim();
            if (text && text.toLowerCase().includes(lowerQuery)) {
                const element = node.parentElement;
                const isVisible = element.offsetParent !== null;
                const isInsideAccordion = element.closest('.accordion-body') !== null;
                if (element && (isVisible || isInsideAccordion)) {
                    results.push(element);
                }
            }
        }

        return results;
    }

    /**
     * 結果間をナビゲート
     */
    navigateResults(direction) {
        if (this.searchResults.length === 0) return;

        this.currentResultIndex = (this.currentResultIndex + direction + this.searchResults.length) % this.searchResults.length;
        this.highlightAndScroll(this.searchResults[this.currentResultIndex]);
        this.showSearchStatus();
    }

    /**
     * ハイライトしてスクロール（アコーディオンが閉じていれば自動展開）
     */
    highlightAndScroll(element) {
        // 既存のハイライトを削除
        document.querySelectorAll('.search-highlight').forEach(el => {
            el.classList.remove('search-highlight');
        });

        // アコーディオン内の場合は展開する
        const accordionBody = element.closest('.accordion-body');
        if (accordionBody && accordionBody.style.display === 'none') {
            const headerBtn = accordionBody.previousElementSibling;
            if (headerBtn?.classList.contains('accordion-header')) {
                headerBtn.click();
            }
        }

        // 新しい要素をハイライト
        element.classList.add('search-highlight');

        // スクロール（展開アニメーション後に実行）
        setTimeout(() => {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
    }

    /**
     * 検索ステータスを表示
     */
    showSearchStatus() {
        const total = this.searchResults.length;
        const current = this.currentResultIndex + 1;
        console.log(`検索結果: ${current} / ${total}`);
    }

    /**
     * 検索モードを終了
     */
    exitSearchMode() {
        this.isSearchMode = false;
        this.searchResults = [];
        this.currentResultIndex = -1;
        this.searchInput.value = '';
        this.hideAutocomplete();

        // ハイライトを削除
        document.querySelectorAll('.search-highlight').forEach(el => {
            el.classList.remove('search-highlight');
        });
    }
}
