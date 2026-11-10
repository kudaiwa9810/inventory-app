/**
 * UI管理クラス
 * 画面遷移、フォーム処理、データ表示を担当
 */
class UIManager {
  constructor() {
    this.currentScreen = 'dashboard';
    this.db = db;
    this.inventoryLogic = inventoryLogic;
    this.excelManager = excelManager;
  }

  /**
   * UIを初期化
   */
  async init() {
    this.setupNavigation();
    this.setupEventListeners();
    await this.showScreen('dashboard');
  }

  /**
   * ナビゲーションを設定
   */
  setupNavigation() {
    const navTabs = document.querySelectorAll('.nav-tab');
    navTabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        const screen = e.target.dataset.screen;
        this.showScreen(screen);
      });
    });
  }

  /**
   * 画面を表示
   * @param {string} screenName - 画面名
   */
  async showScreen(screenName) {
    // すべての画面とタブを非アクティブに
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));

    // 指定された画面とタブをアクティブに
    const screen = document.getElementById(`${screenName}-screen`);
    const tab = document.querySelector(`[data-screen="${screenName}"]`);

    if (screen) screen.classList.add('active');
    if (tab) tab.classList.add('active');

    this.currentScreen = screenName;

    // 検索マネージャーの画面情報を同期
    if (window.searchManager) {
      window.searchManager.setCurrentScreen(screenName);
    }

    // 画面ごとのデータをロード
    await this.loadScreenData(screenName);
  }

  /**
   * 画面データをロード
   * @param {string} screenName - 画面名
   */
  async loadScreenData(screenName) {
    switch (screenName) {
      case 'dashboard':
        await this.loadDashboard();
        break;
      case 'products':
        await this.loadProducts();
        break;
      case 'parts':
        await this.loadParts();
        break;
      case 'inventory':
        await this.loadInventory();
        break;
      case 'history':
        await this.loadHistory();
        break;
      case 'order':
        await this.loadOrder();
        break;
      case 'shipment':
        await this.loadShipment();
        break;
      case 'suppliers':
        await this.loadSuppliers();
        break;
    }
  }

  /**
   * イベントリスナーを設定
   */
  setupEventListeners() {
    // 製品追加
    document.getElementById('add-product-btn')?.addEventListener('click', () => this.showAddProductModal());
    document.getElementById('save-product-btn')?.addEventListener('click', () => this.saveProduct());

    // 部品追加
    document.getElementById('add-part-btn')?.addEventListener('click', () => this.showAddPartModal());
    document.getElementById('save-part-btn')?.addEventListener('click', () => this.savePart());

    // 部品編集
    document.getElementById('update-part-btn')?.addEventListener('click', () => this.updatePart());

    // 工程完了実行
    document.getElementById('execute-process-btn')?.addEventListener('click', () => this.executeProcess());

    // モーダル閉じる
    document.querySelectorAll('.modal-close, .modal-overlay').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-close') || e.target.classList.contains('modal-overlay')) {
          this.closeAllModals();
        }
      });
    });
  }

  /**
   * ダッシュボードをロード
   */
  async loadDashboard() {
    const products = await this.db.getAll('products');
    const parts = await this.db.getAll('parts');
    const inventory = await this.inventoryLogic.getAllInventory();
    const recentHistory = (await this.inventoryLogic.getStockHistory()).slice(0, 10);

    const dashboardHTML = `
      <div class="grid grid-3">
        <div class="card">
          <h3 class="card-title">📦 製品数</h3>
          <div style="font-size: 2rem; font-weight: 700; color: var(--primary);">
            ${products.length}
          </div>
        </div>
        <div class="card">
          <h3 class="card-title">🔧 部品数</h3>
          <div style="font-size: 2rem; font-weight: 700; color: var(--secondary);">
            ${parts.length}
          </div>
        </div>
        <div class="card">
          <h3 class="card-title">📊 総在庫アイテム</h3>
          <div style="font-size: 2rem; font-weight: 700; color: var(--accent);">
            ${inventory.filter(i => i.currentStock > 0).length}
          </div>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">🕒 最近の入出庫履歴</h3>
        ${recentHistory.length > 0 ? `
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>日時</th>
                  <th>部品</th>
                  <th>区分</th>
                  <th>変動数</th>
                  <th>理由</th>
                </tr>
              </thead>
              <tbody>
                ${recentHistory.map(h => `
                  <tr>
                    <td>${ModelUtils.formatDateTime(h.createdAt)}</td>
                    <td>${h.partCode} - ${h.partName}</td>
                    <td>${h.changeType}</td>
                    <td class="number-display ${h.changeAmount >= 0 ? 'positive' : 'negative'}">
                      ${h.changeAmount >= 0 ? '+' : ''}${h.changeAmount}
                    </td>
                    <td>${h.reason}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '<div class="empty-state">履歴がありません</div>'}
      </div>
    `;

    document.getElementById('dashboard-screen').innerHTML = dashboardHTML;
  }

  /**
   * 製品一覧をロード
   */
  async loadProducts() {
    const products = await this.db.getAll('products');

    const productsHTML = `
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-md); flex-wrap: wrap; gap: var(--spacing-sm);">
          <h3 class="card-title" style="margin: 0;">製品マスタ</h3>
          <div style="display: flex; gap: var(--spacing-xs);">
            <button id="import-excel-btn" class="btn btn-secondary">📥 エクセルインポート</button>
            <button id="export-excel-btn" class="btn btn-secondary">📤 エクセルエクスポート</button>
            <button id="add-product-btn" class="btn btn-primary">+ 製品追加</button>
          </div>
        </div>
        ${products.length > 0 ? `
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>製品番号</th>
                  <th>製品名</th>
                  <th>登録日</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${products.map(p => `
                  <tr>
                    <td>${p.productCode}</td>
                    <td>${p.productName}</td>
                    <td>${ModelUtils.formatDateTime(p.createdAt)}</td>
                    <td class="table-actions">
                      <button class="btn btn-sm btn-outline" onclick="uiManager.viewProductParts('${p.productCode}')">部品一覧</button>
                      <button class="btn btn-sm btn-danger" onclick="uiManager.deleteProduct('${p.productCode}')">削除</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '<div class="empty-state"><div class="empty-state-icon">📦</div>製品が登録されていません</div>'}
      </div>
    `;

    document.getElementById('products-screen').innerHTML = productsHTML;
    document.getElementById('add-product-btn')?.addEventListener('click', () => this.showAddProductModal());
    document.getElementById('import-excel-btn')?.addEventListener('click', () => this.showImportExcelDialog());
    document.getElementById('export-excel-btn')?.addEventListener('click', () => this.exportToExcel());
  }

  /**
   * 部品一覧をロード
   */
  async loadParts() {
    const parts = await this.db.getAll('parts');
    const products = await this.db.getAll('products');

    // 製品でグループ化
    const partsByProduct = parts.reduce((acc, part) => {
      if (!acc[part.productCode]) acc[part.productCode] = [];
      acc[part.productCode].push(part);
      return acc;
    }, {});

    // 部品がある製品のみ表示
    const productList = products.map(product => ({
      ...product,
      parts: partsByProduct[product.productCode] || []
    })).filter(p => p.parts.length > 0);

    // 後で参照できるよう保存（遅延描画・検索用）
    this._partsData = productList;
    if (!this._expandedParts) this._expandedParts = new Set();

    const accordionHTML = productList.length > 0
      ? productList.map(product => {
          const totalCost = product.parts.reduce((sum, p) => sum + (p.unitCost * p.quantity), 0);
          return `
          <div class="accordion-item" style="border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px; overflow: hidden;">
            <button class="accordion-header" data-product-code="${product.productCode}"
              style="width: 100%; text-align: left; padding: 12px 16px; background: var(--surface, #f8f9fa); border: none; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: 600; color: var(--primary); font-size: 1rem;">
              <span>${product.productCode} - ${product.productName}</span>
              <span style="display: flex; gap: 16px; align-items: center;">
                <span style="color: var(--success); font-weight: 600; font-size: 0.9rem;">製品コスト: ${ModelUtils.formatCurrency(totalCost)}</span>
                <span class="accordion-indicator" style="font-size: 0.85rem; color: var(--text-muted); font-weight: 400;">${product.parts.length}点 ▼</span>
              </span>
            </button>
            <div class="accordion-body" id="parts-accordion-${product.productCode}" style="display: none;"></div>
          </div>
        `;
        }).join('')
      : '<div class="empty-state"><div class="empty-state-icon">🔧</div>部品が登録されていません</div>';

    document.getElementById('parts-screen').innerHTML = `
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-sm);">
          <h3 class="card-title" style="margin: 0;">部品マスタ</h3>
          <button id="add-part-btn" class="btn btn-primary">+ 部品追加</button>
        </div>
        <p style="color: var(--text-muted); margin-bottom: var(--spacing-md);">
          製品名をクリックすると部品一覧を表示します。
        </p>
        <div id="parts-accordion">${accordionHTML}</div>
      </div>
    `;

    // アコーディオン開閉イベント
    document.querySelectorAll('#parts-accordion .accordion-header').forEach(btn => {
      btn.addEventListener('click', () => {
        const productCode = btn.dataset.productCode;
        const body = btn.nextElementSibling;
        const indicator = btn.querySelector('.accordion-indicator');
        const product = this._partsData.find(p => p.productCode === productCode);
        const isOpen = body.style.display !== 'none';

        if (isOpen) {
          body.style.display = 'none';
          indicator.textContent = `${product.parts.length}点 ▼`;
          this._expandedParts.delete(productCode);
        } else {
          if (!body.dataset.rendered) {
            // 初回クリック時のみ描画（遅延レンダリング）
            body.innerHTML = this._renderPartsTable(product);
            body.dataset.rendered = '1';
          }
          body.style.display = 'block';
          indicator.textContent = `${product.parts.length}点 ▲`;
          this._expandedParts.add(productCode);
        }
      });
    });

    // 前回開いていた製品を自動展開（部品の編集・削除後の再表示で状態を復元）
    this._expandedParts.forEach(productCode => {
      const btn = Array.from(document.querySelectorAll('#parts-accordion .accordion-header'))
        .find(b => b.dataset.productCode === productCode);
      if (btn) btn.click();
    });

    document.getElementById('add-part-btn')?.addEventListener('click', () => this.showAddPartModal());
  }

  /**
   * 部品テーブルのHTMLを生成（部品管理アコーディオンの遅延描画用）
   * @param {object} product - 製品データ（parts を含む）
   * @returns {string} テーブルHTML
   */
  _renderPartsTable(product) {
    return `
      <div class="table-container" style="padding: 0 16px 16px;">
        <table class="data-table parts-table">
          <thead>
            <tr>
              <th>部品番号</th>
              <th>部品名</th>
              <th>単体費用</th>
              <th>構成数</th>
              <th>仕入先コード</th>
              <th>仕入先</th>
              <th>発注方法</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${product.parts.map(p => `
              <tr data-part-code="${p.partCode}">
                <td>${p.partCode}</td>
                <td>${p.partName}</td>
                <td>${ModelUtils.formatCurrency(p.unitCost)}</td>
                <td class="number-display">${p.quantity}</td>
                <td>${p.supplierCode || '-'}</td>
                <td>${p.supplier || '-'}</td>
                <td>${p.orderMethod ? `<span style="font-size:0.8rem; color: var(--primary);">${p.orderMethod}</span>` : '-'}</td>
                <td class="table-actions">
                  <button class="btn btn-sm btn-accent" onclick="uiManager.showOrderModal(${p.id})">📦 発注</button>
                  <button class="btn btn-sm btn-secondary" onclick="uiManager.showEditPartModal('${p.id}')">編集</button>
                  <button class="btn btn-sm btn-danger" onclick="uiManager.deletePart('${product.productCode}', '${p.partCode}')">削除</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  /**
   * 指定の部品を含む製品のアコーディオンだけ事前描画（部品管理タブの検索用）
   */
  _renderPartsAccordionsContaining(partCode) {
    if (!this._partsData) return;
    for (const product of this._partsData) {
      if (!product.parts.some(p => p.partCode === partCode)) continue;
      const body = document.getElementById(`parts-accordion-${product.productCode}`);
      if (body && !body.dataset.rendered) {
        body.innerHTML = this._renderPartsTable(product);
        body.dataset.rendered = '1';
      }
    }
  }

  /**
   * 在庫一覧をロード（アコーディオン形式・遅延描画）
   */
  async loadInventory() {
    // 一括取得（DBアクセス3回のみ）
    const inventory = await this.inventoryLogic.getAllInventoryBulk();
    const products = await this.db.getAll('products');

    // 製品でグループ化・工程順にソート
    const inventoryByProduct = {};
    for (const item of inventory) {
      if (!inventoryByProduct[item.productCode]) inventoryByProduct[item.productCode] = [];
      inventoryByProduct[item.productCode].push(item);
    }
    for (const code in inventoryByProduct) {
      inventoryByProduct[code].sort((a, b) =>
        ModelUtils.getProcessOrder(a.process) - ModelUtils.getProcessOrder(b.process));
    }

    const productList = products
      .map(p => ({ ...p, items: inventoryByProduct[p.productCode] || [] }))
      .filter(p => p.items.length > 0);

    // 後で参照できるよう保存
    this._inventoryData = productList;
    if (!this._expandedProducts) this._expandedProducts = new Set();

    const accordionHTML = productList.length > 0
      ? productList.map(product => `
          <div class="accordion-item" style="border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px; overflow: hidden;">
            <button class="accordion-header" data-product-code="${product.productCode}"
              style="width: 100%; text-align: left; padding: 12px 16px; background: var(--surface, #f8f9fa); border: none; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: 600; color: var(--primary); font-size: 1rem;">
              <span>${product.productCode} - ${product.productName}</span>
              <span class="accordion-indicator" style="font-size: 0.85rem; color: var(--text-muted); font-weight: 400;">${product.items.length}点 ▼</span>
            </button>
            <div class="accordion-body" id="accordion-${product.productCode}" style="display: none;"></div>
          </div>
        `).join('')
      : '<div class="empty-state"><div class="empty-state-icon">📊</div>在庫データがありません</div>';

    document.getElementById('inventory-screen').innerHTML = `
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-sm); flex-wrap: wrap; gap: var(--spacing-sm);">
          <h3 class="card-title" style="margin: 0;">在庫管理</h3>
          <div style="display: flex; gap: var(--spacing-sm);">
            <input type="file" id="csv-import-input" accept=".csv" style="display: none;" />
            <button id="import-inventory-btn" class="btn btn-secondary">📥 CSV在庫インポート</button>
            <button id="export-inventory-btn" class="btn btn-secondary">📤 在庫エクスポート</button>
          </div>
        </div>
        <p style="color: var(--text-muted); margin-bottom: var(--spacing-md);">
          製品名をクリックして展開し、在庫数を直接入力してEnterキーで更新できます。
        </p>
        <div id="inventory-accordion">${accordionHTML}</div>
      </div>
    `;

    // アコーディオン開閉イベント
    document.querySelectorAll('.accordion-header').forEach(btn => {
      btn.addEventListener('click', () => {
        const productCode = btn.dataset.productCode;
        const body = document.getElementById(`accordion-${productCode}`);
        const indicator = btn.querySelector('.accordion-indicator');
        const product = this._inventoryData.find(p => p.productCode === productCode);
        const isOpen = body.style.display !== 'none';

        if (isOpen) {
          body.style.display = 'none';
          indicator.textContent = `${product.items.length}点 ▼`;
          this._expandedProducts.delete(productCode);
        } else {
          if (!body.dataset.rendered) {
            // 初回クリック時のみ描画（遅延レンダリング）
            body.innerHTML = this._renderInventoryTable(product.items);
            body.dataset.rendered = '1';
          }
          body.style.display = 'block';
          indicator.textContent = `${product.items.length}点 ▲`;
          this._expandedProducts.add(productCode);
        }
      });
    });

    // 前回開いていた製品を自動展開（在庫更新後のリロード時に状態を復元）
    this._expandedProducts.forEach(productCode => {
      const btn = document.querySelector(`.accordion-header[data-product-code="${productCode}"]`);
      if (btn) btn.click();
    });

    // イベントリスナー
    document.getElementById('export-inventory-btn')?.addEventListener('click', () => this.exportInventoryToExcel());
    document.getElementById('import-inventory-btn')?.addEventListener('click', () => {
      document.getElementById('csv-import-input').click();
    });
    document.getElementById('csv-import-input')?.addEventListener('change', async (e) => {
      await this.handleCSVImport(e);
    });
  }

  /**
   * 指定の部品を含む製品のアコーディオンだけ事前描画（在庫タブの検索用）
   * display は変えず、HTMLだけ用意する
   */
  _renderAccordionsContaining(partCode) {
    if (!this._inventoryData) return;
    for (const product of this._inventoryData) {
      if (!product.items.some(i => i.partCode === partCode)) continue;
      const body = document.getElementById(`accordion-${product.productCode}`);
      if (body && !body.dataset.rendered) {
        body.innerHTML = this._renderInventoryTable(product.items);
        body.dataset.rendered = '1';
      }
    }
  }

  /**
   * 在庫管理タブへ切り替えて、指定製品のアコーディオンを開く
   * @param {string} productCode - 製品コード
   */
  async jumpToInventoryProduct(productCode) {
    await this.showScreen('inventory');
    window.searchManager?.navigateToProduct(productCode, 'inventory');
  }

  /**
   * 全アコーディオンの内容を事前描画（検索用）
   * display は変えず、HTMLだけ用意する
   */
  _prerenderAllAccordions() {
    if (!this._inventoryData) return;
    for (const product of this._inventoryData) {
      const body = document.getElementById(`accordion-${product.productCode}`);
      if (body && !body.dataset.rendered) {
        body.innerHTML = this._renderInventoryTable(product.items);
        body.dataset.rendered = '1';
      }
    }
  }

  /**
   * 在庫テーブルのHTMLを生成（アコーディオン内の遅延描画用）
   * @param {Array} items - 部品・在庫データの配列
   * @returns {string} テーブルHTML
   */
  _renderInventoryTable(items) {
    return `
      <div class="table-container" style="padding: 0 16px 16px;">
        <table class="data-table">
          <thead>
            <tr>
              <th>部品番号</th>
              <th>部品名</th>
              <th>現在庫</th>
              <th>注残在庫</th>
              <th>単価</th>
              <th>在庫金額</th>
              <th>発注</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(i => {
              const orderRemainingClass = i.orderRemaining < 0 ? 'text-danger' : '';
              return `
                <tr>
                  <td>${i.partCode}</td>
                  <td>${i.partName}</td>
                  <td>
                    <input
                      type="number"
                      class="form-input"
                      style="width: 120px; display: inline-block; padding: 0.25rem 0.5rem;"
                      value="${i.currentStock}"
                      data-part-code="${i.partCode}"
                      data-current-stock="${i.currentStock}"
                      onkeydown="if(event.key === 'Enter') { event.target.blur(); uiManager.handleStockInput(event); }"
                      onblur="uiManager.handleStockInput(event)"
                    />
                  </td>
                  <td class="${orderRemainingClass}">${i.orderRemaining.toLocaleString('ja-JP')}</td>
                  <td>${ModelUtils.formatCurrency(i.unitCost)}</td>
                  <td>${ModelUtils.formatCurrency(i.unitCost * i.currentStock)}</td>
                  <td><button class="btn btn-sm btn-accent" onclick="uiManager.showOrderModal(${i.id})">📦 発注</button></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  /**
   * 工程完了フォームをロード
   */
  async loadProcessForm() {
    const products = await this.db.getAll('products');

    const processHTML = `
      <div class="card">
        <h3 class="card-title">工程完了入力</h3>
        <div class="form-group">
          <label class="form-label">製品選択</label>
          <select id="process-product-select" class="form-select">
            <option value="">-- 製品を選択 --</option>
            ${products.map(p => `<option value="${p.productCode}">${p.productCode} - ${p.productName}</option>`).join('')}
          </select>
        </div>
        <div id="process-parts-container"></div>
      </div>
      <div id="process-preview-container"></div>
    `;

    document.getElementById('process-screen').innerHTML = processHTML;

    document.getElementById('process-product-select').addEventListener('change', (e) => {
      this.loadProcessParts(e.target.value);
    });
  }

  /**
   * 工程選択と完了数入力フォームをロード
   */
  async loadProcessParts(productCode) {
    if (!productCode) {
      document.getElementById('process-parts-container').innerHTML = '';
      document.getElementById('process-preview-container').innerHTML = '';
      return;
    }

    const parts = await this.inventoryLogic.getProductPartsWithInventory(productCode);
    const processes = [...new Set(parts.map(p => p.process))].sort();

    const formHTML = `
      <div class="form-group">
        <label class="form-label">完了工程</label>
        <select id="process-select" class="form-select">
          <option value="">-- 工程を選択 --</option>
          ${processes.map(proc => `<option value="${proc}">工程 ${proc}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">完了数</label>
        <input type="number" id="process-quantity" class="form-input" min="1" value="1" />
      </div>
      <button id="preview-process-btn" class="btn btn-accent">変更をプレビュー</button>
    `;

    document.getElementById('process-parts-container').innerHTML = formHTML;

    document.getElementById('preview-process-btn').addEventListener('click', () => {
      this.previewProcess();
    });
  }

  /**
   * 工程完了のプレビューを表示
   */
  async previewProcess() {
    const productCode = document.getElementById('process-product-select').value;
    const process = document.getElementById('process-select').value;
    const quantity = parseInt(document.getElementById('process-quantity').value);

    if (!productCode || !process || !quantity) {
      this.showAlert('すべての項目を入力してください', 'error');
      return;
    }

    try {
      const parts = await this.db.getByIndex('parts', 'productCode', productCode);
      const completedPart = parts.find(p => p.process === process);
      const upstreamProcesses = ModelUtils.getUpstreamProcesses(process);
      const upstreamParts = parts.filter(p => upstreamProcesses.includes(p.process));

      const changes = await this.inventoryLogic.simulateStockChanges(completedPart, upstreamParts, quantity);

      const previewHTML = `
        <div class="card">
          <h3 class="card-title">変更プレビュー</h3>
          ${changes.some(c => c.newStock < 0) ? `
            <div class="alert alert-error">
              ⚠️ 在庫不足のため、この操作は実行できません
            </div>
          ` : ''}
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>部品</th>
                  <th>工程</th>
                  <th>現在庫</th>
                  <th>変動数</th>
                  <th>変更後</th>
                </tr>
              </thead>
              <tbody>
                ${changes.map(c => `
                  <tr>
                    <td>${c.partCode} - ${c.partName}</td>
                    <td><span class="badge badge-process-${c.process.toLowerCase()}">工程 ${c.process}</span></td>
                    <td class="number-display">${ModelUtils.formatNumber(c.currentStock)}</td>
                    <td class="number-display ${c.changeAmount >= 0 ? 'positive' : 'negative'}">
                      ${c.changeAmount >= 0 ? '+' : ''}${ModelUtils.formatNumber(c.changeAmount)}
                    </td>
                    <td class="number-display ${c.newStock < 0 ? 'negative' : c.newStock > c.currentStock ? 'positive' : ''}">
                      ${ModelUtils.formatNumber(c.newStock)}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${changes.every(c => c.newStock >= 0) ? `
            <button id="execute-process-btn" class="btn btn-primary" style="margin-top: var(--spacing-md);">
              ✓ 実行
            </button>
          ` : ''}
        </div>
      `;

      document.getElementById('process-preview-container').innerHTML = previewHTML;

      document.getElementById('execute-process-btn')?.addEventListener('click', () => {
        this.executeProcess();
      });

    } catch (error) {
      this.showAlert('エラー: ' + error.message, 'error');
    }
  }

  /**
   * 工程完了を実行
   */
  async executeProcess() {
    const productCode = document.getElementById('process-product-select').value;
    const process = document.getElementById('process-select').value;
    const quantity = parseInt(document.getElementById('process-quantity').value);

    const result = await this.inventoryLogic.processCompletion(productCode, process, quantity);

    if (result.success) {
      this.showAlert(result.message, 'success');
      document.getElementById('process-preview-container').innerHTML = '';
      document.getElementById('process-product-select').value = '';
      document.getElementById('process-parts-container').innerHTML = '';
    } else {
      this.showAlert(result.message, 'error');
    }
  }

  /**
   * 履歴をロード
   */
  async loadHistory() {
    const history = await this.inventoryLogic.getStockHistory();

    const historyHTML = `
      <div class="card">
        <h3 class="card-title">入出庫履歴</h3>
        ${history.length > 0 ? `
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>日時</th>
                  <th>部品</th>
                  <th>工程</th>
                  <th>区分</th>
                  <th>変動数</th>
                  <th>変更前</th>
                  <th>変更後</th>
                  <th>理由</th>
                </tr>
              </thead>
              <tbody>
                ${history.map(h => `
                  <tr>
                    <td>${ModelUtils.formatDateTime(h.createdAt)}</td>
                    <td>${h.partCode} - ${h.partName}</td>
                    <td><span class="badge badge-process-${h.process.toLowerCase()}">工程 ${h.process}</span></td>
                    <td>${h.changeType}</td>
                    <td class="number-display ${h.changeAmount >= 0 ? 'positive' : 'negative'}">
                      ${h.changeAmount >= 0 ? '+' : ''}${ModelUtils.formatNumber(h.changeAmount)}
                    </td>
                    <td class="number-display">${ModelUtils.formatNumber(h.previousStock)}</td>
                    <td class="number-display">${ModelUtils.formatNumber(h.newStock)}</td>
                    <td>${h.reason}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '<div class="empty-state"><div class="empty-state-icon">📋</div>履歴がありません</div>'}
      </div>
    `;

    document.getElementById('history-screen').innerHTML = historyHTML;
  }

  // モーダル関連メソッド
  showAddProductModal() {
    document.getElementById('product-modal').classList.add('active');
  }

  showAddPartModal() {
    document.getElementById('part-modal').classList.add('active');
  }

  async showEditPartModal(partId) {
    try {
      // 部品をIDで取得
      const part = await this.db.get('parts', parseInt(partId));

      if (!part) {
        this.showAlert('部品が見つかりません', 'error');
        return;
      }

      // 編集フォームに値をセット
      document.getElementById('edit-part-id').value = part.id;
      document.getElementById('edit-part-code').value = part.partCode;
      document.getElementById('edit-part-product-code').value = part.productCode;
      document.getElementById('edit-part-name').value = part.partName;
      document.getElementById('edit-part-cost').value = part.unitCost;
      document.getElementById('edit-part-quantity').value = part.quantity;
      document.getElementById('edit-part-supplier-code').value = part.supplierCode || '';
      document.getElementById('edit-part-supplier').value = part.supplier || '';
      document.getElementById('edit-part-order-method').value = part.orderMethod || '';
      document.getElementById('edit-part-order-link').value = part.orderLink || '';
      document.getElementById('edit-part-order-template').value = part.orderTemplate || '';
      document.getElementById('edit-part-safety-stock').value = part.safetyStock || 0;
      document.getElementById('edit-part-material-shape').value     = part.materialShape     || '';
      document.getElementById('edit-part-material-dimension').value = part.materialDimension || '';
      document.getElementById('edit-part-material-spec').value      = part.materialSpec      || '';
      document.getElementById('edit-part-material-unit').value      = part.materialUnit      || '';
      document.getElementById('edit-part-material-yield').value     = part.materialYield     || 0;
      document.getElementById('edit-part-material-memo').value      = part.materialMemo      || '';

      document.getElementById('edit-part-modal').classList.add('active');
    } catch (error) {
      console.error('部品編集モーダル表示エラー:', error);
      this.showAlert('エラー: ' + error.message, 'error');
    }
  }

  async updatePart() {
    try {
      const partId = parseInt(document.getElementById('edit-part-id').value);
      const partCode = document.getElementById('edit-part-code').value;
      const productCode = document.getElementById('edit-part-product-code').value;
      const partName = document.getElementById('edit-part-name').value;
      const unitCost = parseFloat(document.getElementById('edit-part-cost').value) || 0;
      const quantity = parseInt(document.getElementById('edit-part-quantity').value) || 1;
      const supplierCode = document.getElementById('edit-part-supplier-code').value;
      const supplier = document.getElementById('edit-part-supplier').value;
      const orderMethod = document.getElementById('edit-part-order-method').value;
      const orderLink = document.getElementById('edit-part-order-link').value;
      const orderTemplate = document.getElementById('edit-part-order-template').value;
      const safetyStock = parseInt(document.getElementById('edit-part-safety-stock').value) || 0;
      const materialShape     = document.getElementById('edit-part-material-shape').value;
      const materialDimension = document.getElementById('edit-part-material-dimension').value;
      const materialSpec      = document.getElementById('edit-part-material-spec').value;
      const materialUnit      = document.getElementById('edit-part-material-unit').value;
      const materialYield     = parseFloat(document.getElementById('edit-part-material-yield').value) || 0;
      const materialMemo      = document.getElementById('edit-part-material-memo').value;

      // 現在の部品を取得
      const currentPart = await this.db.get('parts', partId);
      if (!currentPart) {
        this.showAlert('部品が見つかりません', 'error');
        return;
      }

      // 同じ部品番号を持つすべての部品を取得
      const allPartsWithSameCode = await this.db.getByIndex('parts', 'partCode', partCode);

      let updatedCount = 0;

      for (const part of allPartsWithSameCode) {
        // 構成数以外のフィールドを更新
        part.partName = partName;
        part.unitCost = unitCost;
        part.supplierCode = supplierCode;
        part.supplier = supplier;
        part.orderMethod = orderMethod;
        part.orderLink = orderLink;
        part.orderTemplate     = orderTemplate;
        part.materialShape     = materialShape;
        part.materialDimension = materialDimension;
        part.materialSpec      = materialSpec;
        part.materialUnit      = materialUnit;
        part.materialMemo      = materialMemo;
        part.updatedAt = Date.now();

        // 現在編集している部品のみ構成数・安全在庫・取れ数も更新
        if (part.id === partId) {
          part.quantity = quantity;
          part.safetyStock = safetyStock;
          part.materialYield = materialYield;
        }

        await this.db.put('parts', part);
        updatedCount++;
      }

      this.showAlert(`部品を更新しました（${updatedCount}件の部品が更新されました）`, 'success');
      this.closeAllModals();
      await this.loadParts();
    } catch (error) {
      console.error('部品更新エラー:', error);
      this.showAlert('エラー: ' + error.message, 'error');
    }
  }

  showDirectEditModal(partCode, currentStock) {
    document.getElementById('direct-edit-part-code').value = partCode;
    document.getElementById('edit-current-stock').value = currentStock;
    document.getElementById('edit-new-stock').value = currentStock;
    document.getElementById('edit-reason').value = '';
    document.getElementById('edit-modal').classList.add('active');
  }

  closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => {
      m.classList.remove('active');
      m.style.display = '';
    });
  }

  async saveProduct() {
    const code = document.getElementById('product-code').value;
    const name = document.getElementById('product-name').value;

    const product = new Product(code, name);
    const errors = product.validate();

    if (errors.length > 0) {
      this.showAlert(errors.join('\n'), 'error');
      return;
    }

    try {
      await this.db.add('products', product.toObject());
      this.showAlert('製品を追加しました', 'success');
      this.closeAllModals();
      await this.loadProducts();
    } catch (error) {
      this.showAlert('エラー: ' + error.message, 'error');
    }
  }

  async savePart() {
    const code = document.getElementById('part-code').value;
    const productCode = document.getElementById('part-product-code').value;
    const name = document.getElementById('part-name').value;
    const cost = document.getElementById('part-cost').value;
    const quantity = document.getElementById('part-quantity').value;
    const supplier = document.getElementById('part-supplier').value;
    const supplierCode = document.getElementById('part-supplier-code').value;
    const safetyStock = parseInt(document.getElementById('part-safety-stock')?.value) || 0;
    const orderMethod = document.getElementById('part-order-method')?.value || '';
    const orderLink = document.getElementById('part-order-link')?.value || '';
    const orderTemplate = document.getElementById('part-order-template')?.value || '';

    const materialShape     = document.getElementById('part-material-shape')?.value     || '';
    const materialDimension = document.getElementById('part-material-dimension')?.value || '';
    const materialSpec      = document.getElementById('part-material-spec')?.value      || '';
    const materialUnit      = document.getElementById('part-material-unit')?.value      || '';
    const materialYield     = parseFloat(document.getElementById('part-material-yield')?.value) || 0;
    const materialMemo      = document.getElementById('part-material-memo')?.value      || '';

    const part = new Part(code, productCode, name, cost, quantity, supplier, supplierCode, safetyStock);
    part.orderMethod       = orderMethod;
    part.orderLink         = orderLink;
    part.orderTemplate     = orderTemplate;
    part.materialShape     = materialShape;
    part.materialDimension = materialDimension;
    part.materialSpec      = materialSpec;
    part.materialUnit      = materialUnit;
    part.materialYield     = materialYield;
    part.materialMemo      = materialMemo;

    const errors = part.validate();

    if (errors.length > 0) {
      this.showAlert(errors.join('\n'), 'error');
      return;
    }

    try {
      await this.db.add('parts', part.toObject());
      // 初期在庫として0を登録
      await this.db.put('inventory', new Inventory(code, 0).toObject());
      this.showAlert('部品を追加しました', 'success');
      this.closeAllModals();
      await this.loadParts();
    } catch (error) {
      this.showAlert('エラー: ' + error.message, 'error');
    }
  }

  async deleteProduct(productCode) {
    if (!confirm(`製品 ${productCode} を削除しますか？`)) return;
    await this.db.delete('products', productCode);
    this.showAlert('製品を削除しました', 'success');
    await this.loadProducts();
  }

  /**
   * 部品削除
   * @param {string} productCode - 製品コード
   * @param {string} partCode - 部品コード
   */
  async deletePart(productCode, partCode) {
    if (!confirm(`製品 ${productCode} の部品 ${partCode} を削除しますか？`)) return;

    // 製品コードと部品コードの組み合わせで削除
    const deleted = await this.db.deletePartByProductAndCode(productCode, partCode);

    if (deleted) {
      this.showAlert('部品を削除しました', 'success');
    } else {
      this.showAlert('部品が見つかりませんでした', 'error');
    }

    await this.loadParts();
  }

  async viewProductParts(productCode) {
    await this.showScreen('parts');
    if (productCode) {
      window.searchManager?.navigateToProduct(productCode, 'parts');
    }
  }

  /**
   * 在庫数の直接入力ハンドラー
   * @param {Event} event - イベントオブジェクト
   */
  async handleStockInput(event) {
    const input = event.target;
    const partCode = input.dataset.partCode;
    const currentStock = parseFloat(input.dataset.currentStock);
    const newStock = parseFloat(input.value);

    // 値が変わっていない場合は何もしない
    if (newStock === currentStock) {
      return;
    }

    // 変更理由を入力してもらう
    // 在庫変更理由を入力（任意）
    const reason = prompt('在庫変更の理由を入力してください（任意）\n（例：入荷、出荷、不良品廃棄など）');

    // キャンセルされた場合のみ処理を中止
    if (reason === null) {
      input.value = currentStock; // 元に戻す
      return;
    }

    // 理由が空でもOK（任意化）

    // 在庫を更新
    const result = await this.inventoryLogic.directStockEdit(partCode, newStock, reason.trim());

    if (result.success) {
      this.showAlert(result.message, 'success');
      // データ属性を更新
      input.dataset.currentStock = newStock;
      // 画面をリロード
      await this.loadInventory();
    } else {
      this.showAlert(result.message, 'error');
      input.value = currentStock; // 元に戻す
    }
  }

  /**
   * エクセルインポートダイアログを表示
   */
  showImportExcelDialog() {
    // ファイル選択用の input 要素を作成
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx, .xls';

    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      this.showAlert('インポート中...', 'success');

      try {
        const result = await excelManager.importExcel(file);

        if (result.success) {
          let message = `インポート完了:\n製品 ${result.productsCount}件、部品 ${result.partsCount}件を登録しました`;

          message = this._importMessage(message.replace(/\n/g, '<br>'), result.errors);
          this._recordImportErrors('Excel（製品・部品）', file.name, { ...result, message: `製品 ${result.productsCount}件、部品 ${result.partsCount}件を登録` });

          this.showAlert(message, result.errors && result.errors.length > 0 ? 'warning' : 'success');

          // 画面を更新
          await this.loadProducts();
        } else {
          this.showAlert('インポートに失敗しました: ' + (result.message || ''), 'error');
        }
      } catch (error) {
        console.error('インポートエラー詳細:', error);
        this.showAlert('インポートエラー: ' + error.message, 'error');
      }
    };

    fileInput.click();
  }

  /**
   * エクセルにエクスポート
   */
  async exportToExcel() {
    try {
      const result = await excelManager.exportToExcel();

      if (result.success) {
        this.showAlert(`${result.fileName} をダウンロードしました`, 'success');
      } else {
        this.showAlert(result.message, 'error');
      }
    } catch (error) {
      this.showAlert('エクスポートエラー: ' + error.message, 'error');
    }
  }

  /**
   * 在庫をエクセルにエクスポート
   */
  async exportInventoryToExcel() {
    try {
      const result = await excelManager.exportInventoryToExcel();

      if (result.success) {
        this.showAlert(`${result.fileName} をダウンロードしました`, 'success');
      } else {
        this.showAlert(result.message, 'error');
      }
    } catch (error) {
      this.showAlert('エクスポートエラー: ' + error.message, 'error');
    }
  }

  showAlert(message, type = 'success') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type}`;
    alertDiv.style.position = 'fixed';
    alertDiv.style.top = '20px';
    alertDiv.style.right = '20px';
    alertDiv.style.zIndex = '9999';
    alertDiv.style.maxWidth = '400px';
    alertDiv.innerHTML = message;
    document.body.appendChild(alertDiv);

    setTimeout(() => {
      alertDiv.remove();
    }, 5000);
  }

  // -------------------------
  // 発注管理
  // -------------------------

  // 発注管理をロード（サブタブ切り替え）
  async loadOrder() {
    if (!this._orderSubTab) this._orderSubTab = 'recommend';
    const screen = document.getElementById('order-screen');

    const mkBtn = (id, label, active) => `
      <button id="${id}" style="padding: 10px 24px; border: none; background: none; cursor: pointer; font-size: 0.95rem;
        font-weight: ${active ? '700' : '400'}; color: ${active ? 'var(--primary)' : 'var(--text-muted)'};
        border-bottom: ${active ? '2px solid var(--primary)' : '2px solid transparent'}; margin-bottom: -2px;">
        ${label}
      </button>`;

    screen.innerHTML = `
      <div class="section-header" style="margin-bottom: 0;">
        <h2 class="section-title">📦 発注管理</h2>
      </div>
      <div style="display: flex; gap: 0; border-bottom: 2px solid var(--border); margin-bottom: var(--spacing-md);">
        ${mkBtn('subtab-order-recommend', '📋 発注推奨', this._orderSubTab === 'recommend')}
        ${mkBtn('subtab-order-pending', '📋 発注残', this._orderSubTab === 'pending')}
        ${mkBtn('subtab-order-history', '📦 発注履歴', this._orderSubTab === 'history')}
      </div>
      <div id="order-subtab-content"></div>
    `;

    document.getElementById('subtab-order-recommend')?.addEventListener('click', () => {
      this._orderSubTab = 'recommend';
      this.loadOrder();
    });
    document.getElementById('subtab-order-pending')?.addEventListener('click', () => {
      this._orderSubTab = 'pending';
      this.loadOrder();
    });
    document.getElementById('subtab-order-history')?.addEventListener('click', () => {
      this._orderSubTab = 'history';
      this.loadOrder();
    });

    if (this._orderSubTab === 'recommend') {
      await this.loadOrderRecommendations();
    } else if (this._orderSubTab === 'pending') {
      await this.loadOrderPending();
    } else {
      await this.loadOrderHistory();
    }
  }

  // 発注推奨サブ画面
  async loadOrderRecommendations() {
    const container = document.getElementById('order-subtab-content');
    container.innerHTML = '<div class="loading"></div>';

    const [parts, allInventory, allShipments, allOrders, suppliers] = await Promise.all([
      this.db.getAll('parts'),
      this.db.getAll('inventory'),
      this.db.getAll('shipmentSchedules'),
      this.db.getAll('orderRecords'),
      this.db.getAll('suppliers')
    ]);

    const inventoryMap = new Map(allInventory.map(i => [i.partCode, i.currentStock]));
    const supplierMap  = new Map(suppliers.map(s => [s.supplierCode, s]));

    const pendingOrderMap = new Map();
    for (const order of allOrders) {
      if (order.status === 'pending') {
        pendingOrderMap.set(order.partCode,
          (pendingOrderMap.get(order.partCode) || 0) + order.orderQuantity);
      }
    }

    const shipmentByProduct = new Map();
    for (const s of allShipments.filter(isActiveShipment)) {
      shipmentByProduct.set(s.productCode,
        (shipmentByProduct.get(s.productCode) || 0) + s.shipmentQuantity);
    }

    const partCodeSeen = new Map();
    for (const part of parts) {
      const shipmentQty = shipmentByProduct.get(part.productCode) || 0;
      const required    = part.quantity * shipmentQty;
      const currentStock = inventoryMap.get(part.partCode) || 0;
      const pendingOrder = pendingOrderMap.get(part.partCode) || 0;
      const safetyStock  = part.safetyStock || 0;

      if (!partCodeSeen.has(part.partCode)) {
        partCodeSeen.set(part.partCode, {
          partCode: part.partCode,
          partName: part.partName,
          supplierCode: part.supplierCode || '',
          supplier: supplierMap.get(part.supplierCode) || null,
          orderMethod: part.orderMethod || '',
          orderLink: part.orderLink || '',
          orderTemplate: part.orderTemplate || '',
          materialShape:     part.materialShape     || '',
          materialDimension: part.materialDimension || '',
          materialSpec:      part.materialSpec      || '',
          materialUnit:      part.materialUnit      || '',
          materialYield:     part.materialYield     || 0,
          materialMemo:      part.materialMemo      || '',
          safetyStock, currentStock, pendingOrder,
          required: 0,
          partId: part.id
        });
      }
      partCodeSeen.get(part.partCode).required += required;
    }

    const recommendations = [];
    for (const item of partCodeSeen.values()) {
      const shortage = item.required - item.currentStock - item.pendingOrder;
      const rawQty = Math.max(0, shortage) + item.safetyStock;
      const materialYield = item.materialYield || 0;
      const recommendedQty = materialYield > 0
        ? Math.ceil(rawQty / materialYield)
        : rawQty;
      const belowSafety = item.safetyStock > 0 &&
        (item.currentStock - item.required - item.pendingOrder) < item.safetyStock;

      if (shortage > 0 || belowSafety) {
        recommendations.push({ ...item, shortage, recommendedQty, materialYield });
      }
    }
    recommendations.sort((a, b) => b.shortage - a.shortage);

    // onclickからインデックス参照するためグローバルに保存
    window._orderRecommendations = recommendations;

    if (recommendations.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">✅</div>
          <div>現在の出荷予定に対して、発注が必要な部品はありません</div>
        </div>`;
      return;
    }

    const methodIcon = m => ({ 'メール外注': '📧', '通販': '🛒', '電話・FAX': '📠' }[m] || '📦');

    container.innerHTML = `
      <div class="alert alert-info" style="margin-bottom: var(--spacing-md);">
        💡 出荷予定に基づく発注推奨です。発注数を確認・修正してから「発注する」を押してください。
      </div>
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>部品番号</th><th>部品名</th><th>発注方法</th><th>仕入先</th>
              <th>現在庫</th><th>発注残</th><th>必要数</th>
              <th>不足数</th><th>発注数（編集可）</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${recommendations.map((r, idx) => {
              const matLabel = getMaterialLabel(r);
              const unit = r.materialUnit || '個';
              return `
              <tr>
                <td>${r.partCode || '-'}</td>
                <td>
                  ${r.partName}
                  ${matLabel ? `<div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px;">🪨 ${matLabel}</div>` : ''}
                </td>
                <td>${r.orderMethod ? `${methodIcon(r.orderMethod)} ${r.orderMethod}` : '-'}</td>
                <td>${r.supplier ? r.supplier.supplierName : (r.supplierCode || '-')}</td>
                <td>${r.currentStock.toLocaleString('ja-JP')}</td>
                <td>${r.pendingOrder.toLocaleString('ja-JP')}</td>
                <td>${r.required.toLocaleString('ja-JP')}</td>
                <td class="${r.shortage > 0 ? 'text-danger' : ''}" style="font-weight:600;">
                  ${r.shortage > 0 ? '-' + r.shortage.toLocaleString('ja-JP') : '足りている'}
                </td>
                <td>
                  <div style="display:flex;align-items:center;gap:6px;">
                    <input type="number" class="form-input recommend-qty-input"
                      id="recommend-qty-${idx}"
                      style="width:90px;padding:0.25rem 0.5rem;"
                      value="${r.recommendedQty}" min="1" />
                    <span style="font-size:0.85rem;color:var(--text-muted);">${unit}</span>
                  </div>
                  ${r.materialYield > 0 ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">1${unit}=${r.materialYield}個取り</div>` : ''}
                </td>
                <td>
                  <button class="btn btn-sm btn-accent"
                    onclick="uiManager.executeOrderAction(${idx})">
                    発注する
                  </button>
                </td>
              </tr>
            `}).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  async executeOrderAction(idx) {
    const item = window._orderRecommendations?.[idx];
    if (!item) {
      this.showAlert('発注データが見つかりません。画面を再読み込みしてください。', 'error');
      return;
    }

    const qtyInput = document.getElementById(`recommend-qty-${idx}`);
    const orderQty = parseInt(qtyInput?.value) || item.recommendedQty;

    if (!orderQty || orderQty <= 0) {
      this.showAlert('発注数を入力してください', 'error');
      return;
    }

    let supplier = item.supplier;
    if (!supplier && item.supplierCode) {
      supplier = await this.db.get('suppliers', item.supplierCode);
    }

    const orderMethod = item.orderMethod || (supplier?.defaultOrderMethod) || '';
    const today = new Date().toISOString().slice(0, 10);

    let actionSuccess = true;

    if (orderMethod === 'メール外注') {
      actionSuccess = await this._openMailOrder(item, supplier, orderQty, today);
    } else if (orderMethod === '通販') {
      actionSuccess = this._openWebOrder(item);
    } else if (orderMethod === '電話・FAX') {
      this._openPrintOrder(item, supplier, orderQty, today);
    } else {
      await this.showOrderModal(item.partId);
      return;
    }

    if (!actionSuccess) return;

    if (confirm(`発注数 ${orderQty.toLocaleString('ja-JP')} 個を発注履歴に記録しますか？`)) {
      await this._recordOrder(item, supplier, orderQty, orderMethod, today);
    }
  }

  async _openMailOrder(item, supplier, orderQty, today) {
    const to = supplier?.email || '';
    if (!to) {
      this.showAlert('仕入先のメールアドレスが登録されていません。仕入先マスタを確認してください。', 'error');
      return false;
    }
    const subjectTemplate = supplier?.defaultEmailSubject || '【発注依頼】{部品名}';
    const subject = this._expandTemplate(subjectTemplate, item, orderQty, today);
    const bodyTemplate = item.orderTemplate ||
      `{仕入先名} 御中\n\nお世話になっております。\n以下の材料を発注いたします。\n\n部品番号: {部品番号}\n部品名: {部品名}\n材料: {材料名}\n数量: {発注数} {発注単位}\n希望納期: \n\n{材料メモ}\n\nよろしくお願いいたします。`;
    const body = this._expandTemplate(bodyTemplate, item, orderQty, today);
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return true;
  }

  _openWebOrder(item) {
    if (!item.orderLink) {
      this.showAlert('通販URLが登録されていません。部品編集から発注リンクを設定してください。', 'error');
      return false;
    }
    window.open(item.orderLink, '_blank', 'noopener,noreferrer');
    return true;
  }

  _openPrintOrder(item, supplier, orderQty, today) {
    const printWindow = window.open('', '_blank');
    const supplierName = supplier?.supplierName || item.supplierCode || '未登録';
    const fax   = supplier?.fax   || '';
    const phone = supplier?.phone || '';
    printWindow.document.write(`<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><title>発注書</title>
<style>
  body{font-family:'Meiryo',sans-serif;padding:40px;color:#000;}
  h1{font-size:24px;text-align:center;border-bottom:2px solid #000;padding-bottom:10px;}
  .meta{display:flex;justify-content:space-between;margin:20px 0;}
  .meta-block p{margin:4px 0;font-size:14px;}
  table{width:100%;border-collapse:collapse;margin-top:20px;}
  th,td{border:1px solid #000;padding:8px 12px;font-size:14px;}
  th{background:#eee;}
  @media print{button{display:none;}}
</style></head><body>
<h1>発 注 書</h1>
<div class="meta">
  <div class="meta-block">
    <p><strong>${supplierName} 御中</strong></p>
    ${fax   ? `<p>FAX: ${fax}</p>` : ''}
    ${phone ? `<p>TEL: ${phone}</p>` : ''}
  </div>
  <div class="meta-block" style="text-align:right;">
    <p>発注日: ${today}</p>
    <p>大和精機株式会社</p>
  </div>
</div>
<table>
  <thead><tr><th>部品番号</th><th>部品名</th><th>数量</th><th>備考</th></tr></thead>
  <tbody>
    <tr>
      <td>${item.partCode || '-'}</td>
      <td>
        ${item.partName}
        ${getMaterialLabel(item) ? `<br><span style="font-size:12px;color:#555;">材料: ${getMaterialLabel(item)}</span>` : ''}
      </td>
      <td style="text-align:right;">${orderQty.toLocaleString('ja-JP')} ${item.materialUnit || '個'}</td>
      <td>${item.materialMemo || ''}</td>
    </tr>
  </tbody>
</table>
<p style="margin-top:20px;">希望納期: &nbsp;&nbsp;&nbsp;&nbsp;年&nbsp;&nbsp;月&nbsp;&nbsp;日</p>
<br><button onclick="window.print()" style="padding:8px 20px;font-size:14px;cursor:pointer;">🖨️ 印刷</button>
</body></html>`);
    printWindow.document.close();
  }

  _expandTemplate(template, item, orderQty, today) {
    return template
      .replace(/{部品名}/g,   item.partName || '')
      .replace(/{部品番号}/g,  item.partCode || '')
      .replace(/{発注数}/g,    (orderQty || '').toLocaleString('ja-JP'))
      .replace(/{仕入先名}/g,  item.supplier?.supplierName || item.supplierCode || '')
      .replace(/{発注日}/g,    today)
      .replace(/{材料名}/g,    getMaterialLabel(item) || '')
      .replace(/{発注単位}/g,  item.materialUnit || '個')
      .replace(/{材料メモ}/g,  item.materialMemo || '');
  }

  async _recordOrder(item, supplier, orderQty, orderMethod, today) {
    const record = new OrderRecord({
      partCode: item.partCode,
      partName: item.partName,
      productCode: '',
      supplier: supplier?.supplierName || item.supplierCode || '',
      supplierCode: item.supplierCode || '',
      orderMethod,
      orderLink: item.orderLink || '',
      orderQuantity: orderQty,
      orderDate: today,
      expectedDeliveryDate: '',
      memo: ''
    });
    await this.db.add('orderRecords', record.toObject());
    this.showAlert('発注履歴に記録しました', 'success');
    await this.loadOrderRecommendations();
  }

  // 仕入先マスタ画面
  async loadSuppliers() {
    const suppliers = await this.db.getAll('suppliers');
    document.getElementById('suppliers-screen').innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--spacing-md);">
          <h3 class="card-title">仕入先マスタ</h3>
          <button id="add-supplier-btn" class="btn btn-primary">+ 仕入先追加</button>
        </div>
        ${suppliers.length > 0 ? `
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>仕入先コード</th><th>仕入先名</th><th>メール</th>
                  <th>電話</th><th>標準発注方法</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${suppliers.map(s => `
                  <tr>
                    <td>${s.supplierCode}</td>
                    <td>${s.supplierName}</td>
                    <td>${s.email ? `<a href="mailto:${s.email}" style="color:var(--primary);">${s.email}</a>` : '-'}</td>
                    <td>${s.phone || '-'}</td>
                    <td>${s.defaultOrderMethod || '-'}</td>
                    <td class="table-actions">
                      <button class="btn btn-sm btn-secondary" onclick="uiManager.showEditSupplierModal('${s.supplierCode}')">編集</button>
                      <button class="btn btn-sm btn-danger"    onclick="uiManager.deleteSupplier('${s.supplierCode}')">削除</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '<div class="empty-state"><div class="empty-state-icon">🏢</div>仕入先が登録されていません</div>'}
      </div>
    `;
    document.getElementById('add-supplier-btn')?.addEventListener('click', () => this.showAddSupplierModal());
  }

  showAddSupplierModal() {
    document.getElementById('supplier-modal-title').textContent = '仕入先を追加';
    document.getElementById('supplier-code').value = '';
    document.getElementById('supplier-code').disabled = false;
    document.getElementById('supplier-name').value = '';
    document.getElementById('supplier-email').value = '';
    document.getElementById('supplier-phone').value = '';
    document.getElementById('supplier-fax').value = '';
    document.getElementById('supplier-order-method').value = '';
    document.getElementById('supplier-email-subject').value = '';
    document.getElementById('supplier-notes').value = '';
    this._editingSupplierCode = null;
    document.getElementById('supplier-modal').classList.add('active');
  }

  async showEditSupplierModal(supplierCode) {
    const supplier = await this.db.get('suppliers', supplierCode);
    if (!supplier) return;
    document.getElementById('supplier-modal-title').textContent = '仕入先を編集';
    document.getElementById('supplier-code').value = supplier.supplierCode;
    document.getElementById('supplier-code').disabled = true;
    document.getElementById('supplier-name').value = supplier.supplierName;
    document.getElementById('supplier-email').value = supplier.email || '';
    document.getElementById('supplier-phone').value = supplier.phone || '';
    document.getElementById('supplier-fax').value = supplier.fax || '';
    document.getElementById('supplier-order-method').value = supplier.defaultOrderMethod || '';
    document.getElementById('supplier-email-subject').value = supplier.defaultEmailSubject || '';
    document.getElementById('supplier-notes').value = supplier.notes || '';
    this._editingSupplierCode = supplierCode;
    document.getElementById('supplier-modal').classList.add('active');
  }

  async saveSupplier() {
    const supplier = new Supplier({
      supplierCode:        document.getElementById('supplier-code').value.trim(),
      supplierName:        document.getElementById('supplier-name').value.trim(),
      email:               document.getElementById('supplier-email').value.trim(),
      phone:               document.getElementById('supplier-phone').value.trim(),
      fax:                 document.getElementById('supplier-fax').value.trim(),
      defaultOrderMethod:  document.getElementById('supplier-order-method').value,
      defaultEmailSubject: document.getElementById('supplier-email-subject').value.trim(),
      notes:               document.getElementById('supplier-notes').value.trim()
    });
    const errors = supplier.validate();
    if (errors.length > 0) {
      this.showAlert(errors.join('<br>'), 'error');
      return;
    }
    try {
      await this.db.put('suppliers', supplier.toObject());
      this.showAlert('仕入先を保存しました', 'success');
      this.closeAllModals();
      await this.loadSuppliers();
    } catch (error) {
      this.showAlert('エラー: ' + error.message, 'error');
    }
  }

  async deleteSupplier(supplierCode) {
    if (!confirm(`仕入先 ${supplierCode} を削除しますか？`)) return;
    await this.db.delete('suppliers', supplierCode);
    this.showAlert('仕入先を削除しました', 'success');
    await this.loadSuppliers();
  }

  // 発注残サブ画面
  async loadOrderPending() {
    const container = document.getElementById('order-subtab-content');
    const allOrders = await this.db.getAll('orderRecords');
    const pending = allOrders
      .filter(o => o.status === 'pending')
      .sort((a, b) => new Date(a.orderDate) - new Date(b.orderDate));

    container.innerHTML = `
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>発注日</th>
              <th>部品番号</th>
              <th>部品名</th>
              <th>発注数</th>
              <th>希望納期</th>
              <th>発注方法</th>
              <th>仕入先</th>
              <th>メモ</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${pending.map(o => `
              <tr>
                <td>${o.orderDate}</td>
                <td>${o.partCode}</td>
                <td>${o.partName}</td>
                <td>${o.orderQuantity.toLocaleString('ja-JP')}</td>
                <td>${o.expectedDeliveryDate || '-'}</td>
                <td>${o.orderMethod || '-'}</td>
                <td>${o.supplier || '-'}</td>
                <td style="max-width:200px; white-space: pre-wrap; font-size: 0.8rem;">${o.memo || '-'}</td>
                <td>
                  <button class="btn btn-sm btn-primary" onclick="uiManager.markAsDelivered('${o.id}')">✓ 納品済み</button>
                  <button class="btn btn-sm btn-danger" onclick="uiManager.deleteOrderRecord('${o.id}')">削除</button>
                </td>
              </tr>
            `).join('')}
            ${pending.length === 0 ? '<tr><td colspan="9" style="text-align:center; color:#888;">発注残はありません</td></tr>' : ''}
          </tbody>
        </table>
      </div>
    `;
  }

  // 発注履歴サブ画面
  async loadOrderHistory() {
    const container = document.getElementById('order-subtab-content');
    const allOrders = await this.db.getAll('orderRecords');
    const history = allOrders
      .filter(o => o.status === 'delivered')
      .sort((a, b) => new Date(b.deliveredAt) - new Date(a.deliveredAt));

    container.innerHTML = `
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>発注日</th>
              <th>納品日</th>
              <th>部品番号</th>
              <th>部品名</th>
              <th>発注数</th>
              <th>発注方法</th>
              <th>仕入先</th>
              <th>メモ</th>
            </tr>
          </thead>
          <tbody>
            ${history.map(o => `
              <tr>
                <td>${o.orderDate}</td>
                <td>${o.deliveredAt ? ModelUtils.formatDateTime(o.deliveredAt).slice(0, 10) : '-'}</td>
                <td>${o.partCode}</td>
                <td>${o.partName}</td>
                <td>${o.orderQuantity.toLocaleString('ja-JP')}</td>
                <td>${o.orderMethod || '-'}</td>
                <td>${o.supplier || '-'}</td>
                <td style="max-width:200px; white-space: pre-wrap; font-size: 0.8rem;">${o.memo || '-'}</td>
              </tr>
            `).join('')}
            ${history.length === 0 ? '<tr><td colspan="8" style="text-align:center; color:#888;">発注履歴はありません</td></tr>' : ''}
          </tbody>
        </table>
      </div>
    `;
  }

  // 発注モーダルを表示
  async showOrderModal(partId) {
    const part = await this.db.get('parts', parseInt(partId));
    if (!part) {
      this.showAlert('部品が見つかりません', 'error');
      return;
    }

    // 部品情報を表示
    document.getElementById('order-part-info').innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
        <div><strong>部品番号:</strong> ${part.partCode || '-'}</div>
        <div><strong>部品名:</strong> ${part.partName}</div>
        <div><strong>仕入先:</strong> ${part.supplier || '-'}</div>
        <div><strong>仕入先コード:</strong> ${part.supplierCode || '-'}</div>
        <div><strong>発注方法:</strong> ${part.orderMethod || '未設定'}</div>
      </div>
    `;

    // リンクエリア
    const link = part.orderLink || '';
    let linkHTML = '';
    if (link) {
      const isURL = /^https?:\/\//i.test(link);
      if (isURL) {
        linkHTML = `
          <div style="margin-bottom: 8px;">
            <span style="font-size: 0.85rem; color: var(--text-muted);">🔗 発注リンク:</span>
            <a href="${link}" target="_blank" rel="noopener noreferrer"
               style="display: inline-block; margin-left: 8px; color: var(--primary); word-break: break-all;">${link}</a>
          </div>`;
      } else {
        linkHTML = `
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
            <span style="font-size: 0.85rem; color: var(--text-muted);">📁 パス:</span>
            <code style="flex: 1; font-size: 0.8rem; background: #f0f0f0; padding: 4px 8px; border-radius: 4px; word-break: break-all;">${link}</code>
            <button onclick="navigator.clipboard.writeText('${link.replace(/'/g, "\\'")}').then(() => uiManager.showAlert('コピーしました', 'success'))"
              class="btn btn-sm btn-secondary">📋 コピー</button>
          </div>`;
      }
    }
    document.getElementById('order-link-area').innerHTML = linkHTML;

    // フォームをリセット・初期値セット
    document.getElementById('order-part-id').value = partId;
    document.getElementById('order-quantity').value = '';
    document.getElementById('order-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('order-expected-delivery').value = '';
    document.getElementById('order-memo').value = part.orderTemplate || '';

    document.getElementById('order-modal').classList.add('active');
  }

  // 発注記録を保存
  async saveOrder() {
    const partId = parseInt(document.getElementById('order-part-id').value);
    const quantity = parseFloat(document.getElementById('order-quantity').value);
    const orderDate = document.getElementById('order-date').value;
    const expectedDelivery = document.getElementById('order-expected-delivery').value;
    const memo = document.getElementById('order-memo').value;

    if (!quantity || quantity <= 0) {
      this.showAlert('発注数を入力してください', 'error');
      return;
    }
    if (!orderDate) {
      this.showAlert('発注日を入力してください', 'error');
      return;
    }

    const part = await this.db.get('parts', partId);
    if (!part) {
      this.showAlert('部品が見つかりません', 'error');
      return;
    }

    const record = new OrderRecord({
      partCode: part.partCode,
      partName: part.partName,
      productCode: part.productCode,
      supplier: part.supplier,
      supplierCode: part.supplierCode,
      orderMethod: part.orderMethod,
      orderLink: part.orderLink,
      orderQuantity: quantity,
      orderDate,
      expectedDeliveryDate: expectedDelivery,
      memo
    });

    await this.db.add('orderRecords', record.toObject());
    this.showAlert('発注記録を保存しました', 'success');
    this.closeAllModals();
  }

  // 納品済みにする
  async markAsDelivered(orderId) {
    if (!confirm('この発注を「納品済み」にしますか？')) return;
    const record = await this.db.get('orderRecords', orderId);
    if (!record) return;
    record.status = 'delivered';
    record.deliveredAt = Date.now();
    await this.db.put('orderRecords', record);
    this.showAlert('納品済みに更新しました', 'success');
    await this.loadOrderPending();
  }

  // 発注記録を削除
  async deleteOrderRecord(orderId) {
    if (!confirm('この発注記録を削除しますか？')) return;
    await this.db.delete('orderRecords', orderId);
    this.showAlert('発注記録を削除しました', 'success');
    if (this._orderSubTab === 'pending') {
      await this.loadOrderPending();
    } else {
      await this.loadOrderHistory();
    }
  }

  // 製品出荷記録をロード（サブタブ切り替え）
  async loadShipment() {
    if (!this._shipmentSubTab) this._shipmentSubTab = 'schedule';
    const screen = document.getElementById('shipment-screen');

    // サブタブのヘッダーだけ描画し、中身は各サブローダーに委譲
    screen.innerHTML = `
      <div class="section-header" style="margin-bottom: 0;">
        <h2 class="section-title">🚚 製品出荷記録</h2>
      </div>
      <div style="display: flex; gap: 0; border-bottom: 2px solid var(--border); margin-bottom: var(--spacing-md);">
        <button id="subtab-schedule" class="subtab-btn ${this._shipmentSubTab === 'schedule' ? 'subtab-active' : ''}"
          style="padding: 10px 24px; border: none; background: none; cursor: pointer; font-size: 0.95rem; font-weight: ${this._shipmentSubTab === 'schedule' ? '700' : '400'}; color: ${this._shipmentSubTab === 'schedule' ? 'var(--primary)' : 'var(--text-muted)'}; border-bottom: ${this._shipmentSubTab === 'schedule' ? '2px solid var(--primary)' : '2px solid transparent'}; margin-bottom: -2px;">
          📋 製品出荷予定
        </button>
        <button id="subtab-history" class="subtab-btn ${this._shipmentSubTab === 'history' ? 'subtab-active' : ''}"
          style="padding: 10px 24px; border: none; background: none; cursor: pointer; font-size: 0.95rem; font-weight: ${this._shipmentSubTab === 'history' ? '700' : '400'}; color: ${this._shipmentSubTab === 'history' ? 'var(--primary)' : 'var(--text-muted)'}; border-bottom: ${this._shipmentSubTab === 'history' ? '2px solid var(--primary)' : '2px solid transparent'}; margin-bottom: -2px;">
          📦 製品出荷履歴
        </button>
        <button id="subtab-edilog" class="subtab-btn ${this._shipmentSubTab === 'edilog' ? 'subtab-active' : ''}"
          style="padding: 10px 24px; border: none; background: none; cursor: pointer; font-size: 0.95rem; font-weight: ${this._shipmentSubTab === 'edilog' ? '700' : '400'}; color: ${this._shipmentSubTab === 'edilog' ? 'var(--primary)' : 'var(--text-muted)'}; border-bottom: ${this._shipmentSubTab === 'edilog' ? '2px solid var(--primary)' : '2px solid transparent'}; margin-bottom: -2px;">
          📝 EDI反映履歴
        </button>
      </div>
      <div id="shipment-subtab-content"></div>
    `;

    document.getElementById('subtab-schedule')?.addEventListener('click', () => {
      this._shipmentSubTab = 'schedule';
      this.loadShipment();
    });
    document.getElementById('subtab-history')?.addEventListener('click', () => {
      this._shipmentSubTab = 'history';
      this.loadShipment();
    });
    document.getElementById('subtab-edilog')?.addEventListener('click', () => {
      this._shipmentSubTab = 'edilog';
      this.loadShipment();
    });

    if (this._shipmentSubTab === 'schedule') {
      await this.loadShipmentSchedule();
    } else if (this._shipmentSubTab === 'edilog') {
      await this.loadEdiLog();
    } else {
      await this.loadShipmentHistory();
    }
  }

  /**
   * 出荷予定・出荷履歴の共通絞り込み
   *  keyword     : 発注番号・製品番号・製品名の部分一致（検索ボックスから）
   *  orderNo     : 発注番号の部分一致
   *  productCode : 製品番号の完全一致
   *  productName : 製品名の部分一致
   *  shipmentDate: 出荷日の完全一致
   */
  _filterShipments(list, filters) {
    const has = (v, q) => (v || '').toString().toLowerCase().includes(q.toLowerCase());
    return list.filter(s =>
      (!filters.keyword || has(s.orderNo, filters.keyword) || has(s.productCode, filters.keyword) || has(s.productName, filters.keyword)) &&
      (!filters.orderNo || has(s.orderNo, filters.orderNo)) &&
      (!filters.productCode || s.productCode === filters.productCode) &&
      (!filters.productName || has(s.productName, filters.productName)) &&
      (!filters.shipmentDate || s.shipmentDate === filters.shipmentDate)
    );
  }

  /** 絞り込み中の表示（解除ボタン付き） */
  _shipmentFilterBar(filters, count) {
    const labels = [];
    if (filters.keyword) labels.push(`キーワード「${filters.keyword}」`);
    if (filters.status) labels.push(`状態 ${filters.status}`);
    if (filters.orderNo) labels.push(`発注番号「${filters.orderNo}」`);
    if (filters.productCode) labels.push(`製品番号 ${filters.productCode}`);
    if (filters.productName) labels.push(`製品名「${filters.productName}」`);
    if (filters.shipmentDate) labels.push(`出荷日 ${filters.shipmentDate}`);
    if (labels.length === 0) return '';
    return `
      <div style="display: flex; align-items: center; gap: var(--spacing-sm); margin-bottom: var(--spacing-sm); color: var(--text-secondary);">
        <span>🔍 絞り込み中: ${labels.join(' ／ ')} … ${count}件</span>
        <button class="btn btn-sm btn-secondary" onclick="uiManager.clearShipmentFilter()">✕ 解除</button>
      </div>`;
  }

  /** 現在のサブタブ（予定/履歴）に絞り込みを適用（検索ボックスから呼ばれる） */
  async applyShipmentFilter(filters) {
    if (this._shipmentSubTab === 'history') {
      await this.loadShipmentHistory(filters);
    } else {
      // 状態（有効／要確認／完了…）の選択は、検索しても保つ
      const status = this._scheduleFilters?.status;
      await this.loadShipmentSchedule({ ...(status ? { status } : {}), ...filters });
    }
  }

  /** 絞り込みを解除 */
  async clearShipmentFilter() {
    const input = document.getElementById('global-search');
    if (input) input.value = '';
    await this.applyShipmentFilter({});
  }

  /**
   * 出荷予定・出荷履歴を「出荷日ごとの折りたたみ」で描画する（tbody を日付ごとに分ける）
   * @param {Array} list - 並べ替え・絞り込み済みのデータ
   * @param {'schedule'|'history'} kind - 予定 or 履歴（開閉状態を別々に覚える）
   * @param {Function} rowHtml - 1行分の <td>…</td> を返す関数
   * @param {object} filters - 現在の絞り込み条件
   * @param {string} emptyHtml - データが無いときの行
   */
  _renderShipmentDateGroups(list, kind, rowHtml, filters, emptyHtml) {
    if (list.length === 0) return `<tbody>${emptyHtml}</tbody>`;
    if (!this._shipExpanded) this._shipExpanded = {};

    // 日付ごとにまとめる（並び順は list のまま）
    const groups = [];
    const byDate = new Map();
    for (const item of list) {
      const d = item.shipmentDate || '(日付なし)';
      if (!byDate.has(d)) { byDate.set(d, []); groups.push(d); }
      byDate.get(d).push(item);
    }

    // 今日（yyyy-mm-dd）
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // 最初に開いておく日付（初回のみ）: 予定=今日以降で一番近い日、履歴=一番新しい日
    if (!this._shipExpanded[kind]) {
      const first = kind === 'schedule' ? (groups.find(d => d >= today) || groups[groups.length - 1]) : groups[0];
      this._shipExpanded[kind] = new Set(first ? [first] : []);
    }
    const expanded = this._shipExpanded[kind];
    // 絞り込み中は結果が見えるよう全部開く
    const filtering = ['keyword', 'orderNo', 'productCode', 'productName', 'shipmentDate', 'status'].some(k => filters[k]);

    const week = ['日', '月', '火', '水', '木', '金', '土'];
    const weekday = (d) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
      return m ? week[new Date(+m[1], +m[2] - 1, +m[3]).getDay()] : '';
    };

    return groups.map(d => {
      const items = byDate.get(d);
      const open = filtering || expanded.has(d);
      const total = items.reduce((sum, x) => sum + (Number(x.shipmentQuantity) || 0), 0);
      let badge = '';
      if (d === today) badge = '<span class="ship-date-badge ship-date-today">今日</span>';
      else if (kind === 'schedule' && d < today) badge = '<span class="ship-date-badge ship-date-past">過去</span>';
      const wd = weekday(d);
      return `
        <tbody class="ship-date-group" data-date="${d}">
          <tr class="ship-date-header" data-kind="${kind}" data-date="${d}" onclick="uiManager.toggleShipmentDate(this)">
            <td colspan="6">
              <span class="ship-date-indicator">${open ? '▼' : '▶'}</span>
              <b>${d}</b>${wd ? `（${wd}）` : ''} ${badge}
              <span class="ship-date-summary">${items.length}件 ・ 出荷数 合計 ${total.toLocaleString('ja-JP')}</span>
            </td>
          </tr>
          ${items.map(x => `<tr class="ship-date-row"${open ? '' : ' style="display: none;"'}>${rowHtml(x)}</tr>`).join('')}
        </tbody>`;
    }).join('');
  }

  /** 出荷日の見出しクリックで開閉 */
  toggleShipmentDate(headerRow) {
    const { kind, date } = headerRow.dataset;
    const rows = headerRow.parentElement.querySelectorAll('.ship-date-row');
    const open = rows.length > 0 && rows[0].style.display === 'none';
    rows.forEach(r => { r.style.display = open ? '' : 'none'; });
    headerRow.querySelector('.ship-date-indicator').textContent = open ? '▼' : '▶';
    if (!this._shipExpanded) this._shipExpanded = {};
    if (!this._shipExpanded[kind]) this._shipExpanded[kind] = new Set();
    if (open) this._shipExpanded[kind].add(date); else this._shipExpanded[kind].delete(date);
  }

  /** すべて開く / すべて閉じる */
  toggleAllShipmentDates(open) {
    document.querySelectorAll('#shipment-subtab-content .ship-date-header').forEach(h => {
      const rows = h.parentElement.querySelectorAll('.ship-date-row');
      const isOpen = rows.length > 0 && rows[0].style.display !== 'none';
      if (isOpen !== open) this.toggleShipmentDate(h);
    });
  }

  /** 「すべて開く／閉じる」ボタン */
  _shipmentDateButtons() {
    return `
      <button class="btn btn-sm btn-secondary" onclick="uiManager.toggleAllShipmentDates(true)">▼ すべて開く</button>
      <button class="btn btn-sm btn-secondary" onclick="uiManager.toggleAllShipmentDates(false)">▶ すべて閉じる</button>`;
  }

  // 製品出荷予定サブ画面
  async loadShipmentSchedule(filters = {}) {
    const container = document.getElementById('shipment-subtab-content');
    let shipments = await this.db.getAll('shipmentSchedules');

    shipments.sort((a, b) => {
      const dateCompare = new Date(a.shipmentDate) - new Date(b.shipmentDate);
      if (dateCompare !== 0) return dateCompare;
      return a.productCode.localeCompare(b.productCode);
    });

    // 状態: 既定は「有効（残あり）」のみ。取消・完了は状態を選ぶと見られる
    this._scheduleFilters = filters;
    const statusFilter = filters.status || '有効';
    const needsCheckCount = shipments.filter(s => s.needsCheck).length;
    shipments = shipments.filter(s => statusFilter === 'すべて' ? true
      : statusFilter === '有効' ? isActiveShipment(s)
      : statusFilter === '要確認' ? !!s.needsCheck
      : (s.status || '有効') === statusFilter);
    shipments = this._filterShipments(shipments, filters);

    const allShipments = (await this.db.getAll('shipmentSchedules')).filter(isActiveShipment);
    const uniqueProductCodes = [...new Set(allShipments.map(s => s.productCode))].sort();
    const uniqueProductNames = [...new Set(allShipments.map(s => s.productName))].sort();
    const uniqueShipmentDates = [...new Set(allShipments.map(s => s.shipmentDate))].sort();

    container.innerHTML = `
      <div style="display: flex; justify-content: flex-end; gap: var(--spacing-sm); margin-bottom: var(--spacing-md);">
        <div style="margin-right: auto; display: flex; gap: var(--spacing-sm); align-items: center;">${this._shipmentDateButtons()}</div>
        <select id="filter-status" class="filter-dropdown" title="状態で絞り込み" style="width: auto;">
          ${['有効', '要確認', '完了', '取消', 'すべて'].map(v => `<option value="${v}" ${statusFilter === v ? 'selected' : ''}>${v === '有効' ? '有効（残あり）' : v}</option>`).join('')}
        </select>
        ${needsCheckCount > 0 && statusFilter !== '要確認' ? `<button class="btn btn-sm btn-danger" title="要確認の行だけを表示" onclick="uiManager.loadShipmentSchedule({ status: '要確認' })">⚠ 要確認 ${needsCheckCount}件</button>` : ''}
        <input type="file" id="edi-import-input" accept=".csv" multiple style="display: none;" />
        <input type="file" id="ledger-import-input" accept=".xlsm,.xlsx" style="display: none;" />
        <button id="import-edi-btn" class="btn btn-accent" title="内田洋行EDIのCSV（複数選択可）">📥 EDI取込</button>
        <button id="import-ledger-btn" class="btn btn-secondary" title="内田洋行_受注台帳（Excel）で出荷予定を置き換え">📗 Excel受注台帳から取込</button>
        <button class="btn btn-primary" onclick="uiManager.showAddShipmentModal()">➕ 出荷予定を追加</button>
        <button id="clear-schedule-btn" class="btn btn-danger">🗑 すべて削除</button>
      </div>
      ${this._shipmentFilterBar(filters, shipments.length)}
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>発注番号</th>
              <th>製品番号</th>
              <th>製品名</th>
              <th>残数</th>
              <th>希望納期</th>
              <th>操作</th>
            </tr>
            <tr>
              <th>
                <input type="text" id="filter-orderNo" class="filter-dropdown" placeholder="部分一致で絞込"
                  value="${(filters.orderNo || '').replace(/"/g, '&quot;')}" style="width: 100%; min-width: 110px;" />
              </th>
              <th>
                <select id="filter-productCode" class="filter-dropdown">
                  <option value="">すべて</option>
                  ${uniqueProductCodes.map(code => `
                    <option value="${code}" ${filters.productCode === code ? 'selected' : ''}>${code}</option>
                  `).join('')}
                </select>
              </th>
              <th>
                <input type="search" id="filter-productName" class="filter-dropdown" list="dl-productName"
                  placeholder="すべて（入力で絞込）" autocomplete="off"
                  value="${(filters.productName || '').replace(/"/g, '&quot;')}" style="width: 100%;" />
                <datalist id="dl-productName">
                  ${uniqueProductNames.map(name => `<option value="${name.replace(/"/g, '&quot;')}"></option>`).join('')}
                </datalist>
              </th>
              <th></th>
              <th>
                <select id="filter-shipmentDate" class="filter-dropdown">
                  <option value="">すべて</option>
                  ${uniqueShipmentDates.map(date => `
                    <option value="${date}" ${filters.shipmentDate === date ? 'selected' : ''}>${date}</option>
                  `).join('')}
                </select>
              </th>
              <th></th>
            </tr>
          </thead>
          ${this._renderShipmentDateGroups(shipments, 'schedule', s => `
                <td>
                  ${s.orderNo || '-'}
                  ${s.needsCheck ? `<span class="needs-check" title="${String(s.needsCheck).replace(/"/g, '&quot;')}（クリックで確認済みにする）" onclick="uiManager.resolveNeedsCheck('${s.id}')">⚠ 要確認</span>` : ''}
                  ${s.status && s.status !== '有効' ? `<span class="ship-date-badge ship-date-past">${s.status}</span>` : ''}
                </td>
                <td>${s.productCode}</td>
                <td><a href="#" class="jump-inventory" data-product-code="${s.productCode}"
                       title="在庫管理タブでこの製品の部品を表示">${s.productName}</a></td>
                <td title="${s.orderQty !== undefined ? `発注 ${s.orderQty} / 出荷済 ${s.shippedQty || 0}` : ''}">
                  <b>${(Number(s.shipmentQuantity) || 0).toLocaleString('ja-JP')}</b>
                  ${s.orderQty !== undefined && (s.shippedQty || 0) > 0 ? `<span style="color: var(--text-muted); font-size: 0.8rem;">（発注 ${s.orderQty}・済 ${s.shippedQty}）</span>` : ''}
                </td>
                <td>${s.shipmentDate || '-'}</td>
                <td>
                  <button class="btn btn-small btn-secondary" onclick="uiManager.showEditShipmentModal('${s.id}')">編集</button>
                  <button class="btn btn-small btn-danger" onclick="uiManager.deleteShipment('${s.id}')">削除</button>
                </td>`, filters,
            '<tr><td colspan="6" style="text-align: center; color: #888;">出荷予定はありません</td></tr>')}
        </table>
      </div>
    `;

    document.getElementById('filter-status')?.addEventListener('change', (e) => {
      this.loadShipmentSchedule({ ...filters, status: e.target.value === '有効' ? undefined : e.target.value });
    });
    document.getElementById('import-edi-btn')?.addEventListener('click', () => {
      document.getElementById('edi-import-input').click();
    });
    document.getElementById('edi-import-input')?.addEventListener('change', (e) => this.handleEDIImport(e));
    document.getElementById('import-ledger-btn')?.addEventListener('click', () => {
      document.getElementById('ledger-import-input').click();
    });
    document.getElementById('ledger-import-input')?.addEventListener('change', (e) => this.handleLedgerImport(e));
    document.getElementById('clear-schedule-btn')?.addEventListener('click', async () => {
      if (!confirm('出荷予定をすべて削除しますか？\n（EDI反映履歴・出荷履歴は残ります）')) return;
      await this.db.clearStore('shipmentSchedules');
      this.showAlert('出荷予定をすべて削除しました', 'success');
      await this.loadShipmentSchedule();
    });

    document.getElementById('filter-orderNo')?.addEventListener('change', (e) => {
      this.loadShipmentSchedule({ ...filters, orderNo: e.target.value.trim() || undefined });
    });
    document.getElementById('filter-productCode')?.addEventListener('change', (e) => {
      this.loadShipmentSchedule({ ...filters, productCode: e.target.value || undefined });
    });
    // 製品名: 候補から選ぶ／入力してEnter／✕でクリア のどれでも絞り込み
    const onProductName_loadShipmentSchedule = (e) => {
      const v = e.target.value.trim() || undefined;
      if (v === filters.productName) return;
      this.loadShipmentSchedule({ ...filters, productName: v });
    };
    document.getElementById('filter-productName')?.addEventListener('change', onProductName_loadShipmentSchedule);
    document.getElementById('filter-productName')?.addEventListener('search', onProductName_loadShipmentSchedule);
    document.getElementById('filter-shipmentDate')?.addEventListener('change', (e) => {
      this.loadShipmentSchedule({ ...filters, shipmentDate: e.target.value || undefined });
    });
  }

  // 製品出荷履歴サブ画面
  async loadShipmentHistory(filters = {}) {
    const container = document.getElementById('shipment-subtab-content');
    let records = await this.db.getAll('shipmentHistory');

    records.sort((a, b) => {
      const dateCompare = new Date(b.shipmentDate) - new Date(a.shipmentDate);
      if (dateCompare !== 0) return dateCompare;
      return a.productCode.localeCompare(b.productCode);
    });

    records = this._filterShipments(records, filters);

    const allRecords = await this.db.getAll('shipmentHistory');
    const uniqueProductCodes = [...new Set(allRecords.map(r => r.productCode))].sort();
    const uniqueProductNames = [...new Set(allRecords.map(r => r.productName))].sort();
    const uniqueShipmentDates = [...new Set(allRecords.map(r => r.shipmentDate))].sort().reverse();

    container.innerHTML = `
      <div style="display: flex; justify-content: flex-end; gap: var(--spacing-sm); margin-bottom: var(--spacing-md);">
        <input type="file" id="history-csv-import-input" accept=".csv" style="display: none;" />
        <div style="margin-right: auto; display: flex; gap: var(--spacing-sm); align-items: center;">${this._shipmentDateButtons()}</div>
        <button id="import-history-btn" class="btn btn-secondary">📥 CSV履歴インポート</button>
        <button id="clear-history-btn" class="btn btn-danger">🗑 履歴をすべて削除</button>
      </div>
      ${this._shipmentFilterBar(filters, records.length)}
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>発注番号</th>
              <th>製品番号</th>
              <th>製品名</th>
              <th>出荷数</th>
              <th>出荷日</th>
              <th>インポート日時</th>
            </tr>
            <tr>
              <th>
                <input type="text" id="filter-hist-orderNo" class="filter-dropdown" placeholder="部分一致で絞込"
                  value="${(filters.orderNo || '').replace(/"/g, '&quot;')}" style="width: 100%; min-width: 110px;" />
              </th>
              <th>
                <select id="filter-hist-productCode" class="filter-dropdown">
                  <option value="">すべて</option>
                  ${uniqueProductCodes.map(code => `
                    <option value="${code}" ${filters.productCode === code ? 'selected' : ''}>${code}</option>
                  `).join('')}
                </select>
              </th>
              <th>
                <input type="search" id="filter-hist-productName" class="filter-dropdown" list="dl-hist-productName"
                  placeholder="すべて（入力で絞込）" autocomplete="off"
                  value="${(filters.productName || '').replace(/"/g, '&quot;')}" style="width: 100%;" />
                <datalist id="dl-hist-productName">
                  ${uniqueProductNames.map(name => `<option value="${name.replace(/"/g, '&quot;')}"></option>`).join('')}
                </datalist>
              </th>
              <th></th>
              <th>
                <select id="filter-hist-shipmentDate" class="filter-dropdown">
                  <option value="">すべて</option>
                  ${uniqueShipmentDates.map(date => `
                    <option value="${date}" ${filters.shipmentDate === date ? 'selected' : ''}>${date}</option>
                  `).join('')}
                </select>
              </th>
              <th></th>
            </tr>
          </thead>
          ${this._renderShipmentDateGroups(records, 'history', r => `
                <td>${r.orderNo || '-'}</td>
                <td>${r.productCode}</td>
                <td>${r.productName}</td>
                <td>${r.shipmentQuantity.toLocaleString('ja-JP')}</td>
                <td>${r.shipmentDate}</td>
                <td style="color: var(--text-muted); font-size: 0.85rem;">${ModelUtils.formatDateTime(r.importedAt)}</td>`, filters,
            '<tr><td colspan="6" style="text-align: center; color: #888;">出荷履歴はありません。CSVをインポートしてください。</td></tr>')}
        </table>
      </div>
    `;

    document.getElementById('import-history-btn')?.addEventListener('click', () => {
      document.getElementById('history-csv-import-input').click();
    });
    document.getElementById('history-csv-import-input')?.addEventListener('change', async (e) => {
      await this.handleShipmentHistoryCSVImport(e);
    });

    document.getElementById('clear-history-btn')?.addEventListener('click', async () => {
      if (!confirm('出荷履歴をすべて削除しますか？')) return;
      await this.db.clearStore('shipmentHistory');
      this.showAlert('出荷履歴を削除しました', 'success');
      await this.loadShipmentHistory();
    });

    document.getElementById('filter-hist-orderNo')?.addEventListener('change', (e) => {
      this.loadShipmentHistory({ ...filters, orderNo: e.target.value.trim() || undefined });
    });
    document.getElementById('filter-hist-productCode')?.addEventListener('change', (e) => {
      this.loadShipmentHistory({ ...filters, productCode: e.target.value || undefined });
    });
    // 製品名: 候補から選ぶ／入力してEnter／✕でクリア のどれでも絞り込み
    const onProductName_loadShipmentHistory = (e) => {
      const v = e.target.value.trim() || undefined;
      if (v === filters.productName) return;
      this.loadShipmentHistory({ ...filters, productName: v });
    };
    document.getElementById('filter-hist-productName')?.addEventListener('change', onProductName_loadShipmentHistory);
    document.getElementById('filter-hist-productName')?.addEventListener('search', onProductName_loadShipmentHistory);
    document.getElementById('filter-hist-shipmentDate')?.addEventListener('change', (e) => {
      this.loadShipmentHistory({ ...filters, shipmentDate: e.target.value || undefined });
    });
  }

  // 出荷予定追加モーダルを表示
  showAddShipmentModal() {
    this.currentShipmentId = null;
    document.getElementById('shipment-modal-title').textContent = '出荷予定を追加';
    document.getElementById('shipment-order-no').value = '';
    document.getElementById('shipment-product-code').value = '';
    document.getElementById('shipment-product-name').value = '';
    document.getElementById('shipment-quantity').value = '';
    document.getElementById('shipment-date').value = '';
    document.getElementById('shipment-modal').classList.add('active');

    // 製品マスタ連携のイベントリスナーを設定
    this.setupShipmentProductAutocomplete();
  }

  // 製品マスタ連携のオートコンプリート設定（cloneNodeでリスナー重複を防ぐ）
  async setupShipmentProductAutocomplete() {
    const suggestionsDiv = document.getElementById('shipment-product-suggestions');

    // 既存リスナーを完全に除去するため入力欄をcloneで置き換える
    const oldCodeInput = document.getElementById('shipment-product-code');
    const newCodeInput = oldCodeInput.cloneNode(true);
    oldCodeInput.parentNode.replaceChild(newCodeInput, oldCodeInput);

    const oldNameInput = document.getElementById('shipment-product-name');
    const newNameInput = oldNameInput.cloneNode(true);
    oldNameInput.parentNode.replaceChild(newNameInput, oldNameInput);

    const productCodeInput = document.getElementById('shipment-product-code');
    const productNameInput = document.getElementById('shipment-product-name');

    // 製品マスタを取得
    const products = await this.db.getAll('products');

    // 製品番号入力時: 製品名を自動設定
    productCodeInput.addEventListener('blur', async () => {
      const code = productCodeInput.value.trim();
      if (!code) { productNameInput.value = ''; return; }
      const product = products.find(p => p.productCode === code);
      if (product) productNameInput.value = product.productName;
    });
    productCodeInput.addEventListener('change', async () => {
      const code = productCodeInput.value.trim();
      if (!code) { productNameInput.value = ''; return; }
      const product = products.find(p => p.productCode === code);
      if (product) productNameInput.value = product.productName;
    });

    // 製品名入力時: オートコンプリートを表示
    productNameInput.addEventListener('input', () => {
      const query = productNameInput.value.toLowerCase().trim();
      if (!query) { suggestionsDiv.style.display = 'none'; return; }

      const matches = products.filter(p =>
        p.productName.toLowerCase().includes(query) ||
        p.productCode.toLowerCase().includes(query)
      ).slice(0, 10);

      if (matches.length === 0) { suggestionsDiv.style.display = 'none'; return; }

      suggestionsDiv.innerHTML = matches.map(p => `
        <div class="autocomplete-item" data-code="${p.productCode}" data-name="${p.productName}">
          <div>${p.productName}</div>
          <div class="autocomplete-item-code">${p.productCode}</div>
        </div>
      `).join('');
      suggestionsDiv.style.display = 'block';

      suggestionsDiv.querySelectorAll('.autocomplete-item').forEach(item => {
        item.addEventListener('click', () => {
          productCodeInput.value = item.dataset.code;
          productNameInput.value = item.dataset.name;
          suggestionsDiv.style.display = 'none';
        });
      });
    });

    // フォーカスが外れたらドロップダウンを閉じる
    productNameInput.addEventListener('blur', () => {
      setTimeout(() => {
        if (!suggestionsDiv.contains(document.activeElement)) {
          suggestionsDiv.style.display = 'none';
        }
      }, 200);
    });
  }

  // 出荷予定編集モーダルを表示
  async showEditShipmentModal(shipmentId) {
    this.currentShipmentId = shipmentId;
    const shipment = await this.db.get('shipmentSchedules', shipmentId);

    if (shipment) {
      document.getElementById('shipment-modal-title').textContent = '出荷予定を編集';
      document.getElementById('shipment-order-no').value = shipment.orderNo || '';
      document.getElementById('shipment-product-code').value = shipment.productCode;
      document.getElementById('shipment-product-name').value = shipment.productName;
      document.getElementById('shipment-quantity').value = shipment.shipmentQuantity;
      document.getElementById('shipment-date').value = shipment.shipmentDate;
      document.getElementById('shipment-modal').classList.add('active');

      // 製品マスタ連携のイベントリスナーを設定
      this.setupShipmentProductAutocomplete();
    }
  }

  // 出荷予定を保存
  async saveShipment() {
    const productCode = document.getElementById('shipment-product-code').value;
    const productName = document.getElementById('shipment-product-name').value;
    const quantity = document.getElementById('shipment-quantity').value;
    const shipmentDate = document.getElementById('shipment-date').value;
    const orderNo = OrderManager.normalizeOrderNo(document.getElementById('shipment-order-no').value);

    const shipment = new ShipmentSchedule(
      productCode,
      productName,
      quantity,
      shipmentDate,
      this.currentShipmentId,
      orderNo
    );

    const errors = shipment.validate();
    if (errors.length > 0) {
      this.showAlert(errors.join('<br>'), 'danger');
      return;
    }

    // 保存するデータ（既存の行は、発注数量・出荷済数・更新回数などを引き継ぐ）
    let data = shipment.toObject();
    const existing = this.currentShipmentId ? await this.db.get('shipmentSchedules', this.currentShipmentId) : null;
    if (existing) {
      data = {
        ...existing,
        orderNo: data.orderNo,
        productCode: data.productCode,
        productName: data.productName,
        shipmentDate: data.shipmentDate,
        status: existing.status || '有効',
        updatedAt: Date.now()
      };
      // 画面の数は「残数」。発注数量 = 出荷済数 + 残数 として持つ
      data.orderQty = (Number(existing.shippedQty) || 0) + Number(quantity);
      data.shippedQty = Number(existing.shippedQty) || 0;
      OrderManager.recalc(data);
    } else {
      // 手入力の追加: 発注番号があればそれをキーにする（EDIとつながる）
      if (orderNo) {
        if (await this.db.get('shipmentSchedules', orderNo)) {
          this.showAlert(`発注番号 ${orderNo} はすでに登録されています`, 'danger');
          return;
        }
        data.id = orderNo;
      }
      data.orderQty = Number(quantity);
      data.shippedQty = 0;
      data.status = '有効';
      data.needsCheck = '';
      data.source = '手入力';
      OrderManager.recalc(data);
    }

    try {
      await this.db.put('shipmentSchedules', data);
      this.showAlert(this.currentShipmentId ? '出荷予定を更新しました' : '出荷予定を追加しました');
      this.closeAllModals();
      await this.loadShipment();
    } catch (error) {
      console.error('出荷予定の保存に失敗:', error);
      this.showAlert('出荷予定の保存に失敗しました', 'danger');
    }
  }

  // 出荷予定を削除
  async deleteShipment(shipmentId) {
    if (!confirm('この出荷予定を削除しますか？')) {
      return;
    }

    try {
      await this.db.delete('shipmentSchedules', shipmentId);
      this.showAlert('出荷予定を削除しました');
      await this.loadShipment();
    } catch (error) {
      console.error('出荷予定の削除に失敗:', error);
      this.showAlert('出荷予定の削除に失敗しました', 'danger');
    }
  }

  /**
   * CSVファイルインポート処理
   * @param {Event} event - ファイル選択イベント
   */
  // -------------------------
  // 取り込みエラーの記録と表示
  // -------------------------

  /**
   * 取り込み結果のエラーを記録し、画面右下にお知らせを出す
   * @param {string} title - 取り込みの種類（例: 出荷予定CSV）
   * @param {string} fileName - ファイル名
   * @param {object} result - 取り込み結果（errors, message）
   */
  _recordImportErrors(title, fileName, result) {
    const errors = (result && result.errors) || [];
    this._lastImport = {
      title,
      fileName,
      at: new Date(),
      summary: (result && result.message ? String(result.message) : '').replace(/<[^>]*>/g, ' ').replace(/\n/g, ' '),
      errors
    };
    this._renderImportNotice();
  }

  /** 画面右下の「エラー詳細を見る」お知らせ */
  _renderImportNotice() {
    document.getElementById('import-error-notice')?.remove();
    const info = this._lastImport;
    if (!info || info.errors.length === 0) return;

    const box = document.createElement('div');
    box.id = 'import-error-notice';
    box.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:9998;background:var(--bg-card);' +
      'border:2px solid var(--warning);border-radius:10px;padding:12px 16px;box-shadow:var(--shadow-lg);' +
      'display:flex;align-items:center;gap:12px;color:var(--text-primary);max-width:520px;';
    box.innerHTML = `
      <span>⚠ 直前の取り込み（${info.title}）で <b>${info.errors.length.toLocaleString('ja-JP')}件</b> のエラー・スキップがありました</span>
      <button class="btn btn-sm btn-accent" id="import-error-open" style="white-space: nowrap;">エラー詳細を見る</button>
      <button class="btn btn-sm btn-secondary" id="import-error-dismiss" title="閉じる">✕</button>`;
    document.body.appendChild(box);
    box.querySelector('#import-error-open').addEventListener('click', () => this.showImportErrors());
    box.querySelector('#import-error-dismiss').addEventListener('click', () => box.remove());
  }

  /** 取り込みエラーの全件を表示するウィンドウ */
  showImportErrors() {
    const info = this._lastImport;
    if (!info) return;

    let modal = document.getElementById('import-error-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'import-error-modal';
      modal.className = 'modal-overlay';
      modal.addEventListener('click', (e) => { if (e.target === modal) this.closeAllModals(); });
      document.body.appendChild(modal);
    }

    // 「行 12: 内容」を 行番号 と 内容 に分ける
    const rows = info.errors.map(e => {
      const m = String(e).match(/^行\s*(\d+)\s*[:：]\s*(.*)$/);
      return m ? { line: m[1], text: m[2] } : { line: '-', text: String(e) };
    });
    const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const at = info.at.toLocaleString('ja-JP');

    modal.innerHTML = `
      <div class="modal" style="max-width: 900px;">
        <div class="modal-header">
          <h2 class="modal-title">⚠ 取り込みエラー詳細（${esc(info.title)}）</h2>
          <button class="modal-close" id="import-error-close">&times;</button>
        </div>
        <div style="color: var(--text-secondary); margin-bottom: var(--spacing-sm); line-height: 1.7;">
          ファイル: <b>${esc(info.fileName || '-')}</b>　/　取り込み日時: ${esc(at)}<br>
          ${esc(info.summary)}
        </div>
        <div style="display: flex; gap: var(--spacing-sm); margin-bottom: var(--spacing-sm); align-items: center;">
          <input type="search" id="import-error-filter" class="form-input" placeholder="内容で絞り込み（例: 見つかりません）" style="flex: 1;" />
          <span id="import-error-count" style="color: var(--text-muted); white-space: nowrap;"></span>
          <button class="btn btn-sm btn-secondary" id="import-error-copy" style="white-space: nowrap;">📋 コピー</button>
        </div>
        <div class="table-container" style="max-height: 55vh; overflow-y: auto;">
          <table class="data-table">
            <thead><tr><th style="width: 100px; white-space: nowrap;">CSVの行</th><th>内容</th></tr></thead>
            <tbody id="import-error-tbody"></tbody>
          </table>
        </div>
      </div>`;

    const tbody = modal.querySelector('#import-error-tbody');
    const count = modal.querySelector('#import-error-count');
    let shown = rows;
    const render = (q) => {
      shown = q ? rows.filter(r => r.text.toLowerCase().includes(q.toLowerCase()) || r.line === q) : rows;
      tbody.innerHTML = shown.map(r => `<tr><td>${esc(r.line)}</td><td>${esc(r.text)}</td></tr>`).join('') ||
        '<tr><td colspan="2" style="text-align:center;color:var(--text-muted);">該当なし</td></tr>';
      count.textContent = `${shown.length.toLocaleString('ja-JP')} / ${rows.length.toLocaleString('ja-JP')}件`;
    };
    render('');

    modal.querySelector('#import-error-filter').addEventListener('input', (e) => render(e.target.value.trim()));
    modal.querySelector('#import-error-close').addEventListener('click', () => this.closeAllModals());
    modal.querySelector('#import-error-copy').addEventListener('click', async () => {
      const text = ['CSVの行\t内容', ...shown.map(r => `${r.line}\t${r.text}`)].join('\n');
      try {
        await navigator.clipboard.writeText(text);
        this.showAlert(`${shown.length}件をコピーしました（Excelに貼り付けできます）`, 'success');
      } catch (e) {
        this.showAlert('コピーできませんでした。表を選択してコピーしてください。', 'warning');
      }
    });

    modal.classList.add('active');
  }

  /** 取り込み完了メッセージ（エラーは最初の3件だけ表示し、全件は詳細ボタンへ） */
  _importMessage(baseMessage, errors) {
    let message = baseMessage;
    if (errors && errors.length > 0) {
      message += '<br><br>エラー（最初の3件）:<br>' + errors.slice(0, 3).join('<br>');
      message += `<br><br>全 ${errors.length}件は画面右下の「エラー詳細を見る」で確認できます`;
    }
    return message;
  }

  // -------------------------
  // 受注管理（内田洋行EDI）
  // -------------------------

  /** 要確認の理由を表示し、確認済みにする */
  async resolveNeedsCheck(id) {
    const s = await this.db.get('shipmentSchedules', id);
    if (!s || !s.needsCheck) return;
    if (!confirm(`発注番号 ${s.orderNo}\n\n要確認の理由:\n${s.needsCheck}\n\n確認が済んだら「OK」で要確認を外します。`)) return;
    const reason = s.needsCheck;
    s.needsCheck = '';
    s.updatedAt = Date.now();
    const at = Date.now();
    await this.db.batch([
      { op: 'put', store: 'shipmentSchedules', data: s },
      { op: 'put', store: 'ediLog', data: {
          id: `EDI_${at}_C0001`, importedAt: at, fileName: '画面で確認', orderNo: s.orderNo, kubun: '確認',
          result: '要確認を解除', content: reason, productCode: s.productCode, productName: s.productName, mjsDone: true } }
    ]);
    this.showAlert(`${s.orderNo} を確認済みにしました`, 'success');
    await this.applyShipmentFilter(this._scheduleFilters || {});
  }

  /** EDI取込ボタン */
  async handleEDIImport(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length === 0) return;
    try {
      this.showAlert(`EDIを取り込み中…（${files.length}ファイル）`, 'info');
      const result = await orderManager.importEDI(files);
      this.showAlert(this._importMessage(result.message, result.errors), result.errors.length ? 'warning' : 'success');
      this._recordImportErrors('EDI取込', files.map(f => f.name).join(', '), result);
      this._shipmentSubTab = 'edilog';
      await this.loadShipment();
    } catch (error) {
      console.error('EDI取込エラー:', error);
      this.showAlert(`EDI取込に失敗しました（何も変更していません）:<br>${String(error.message).replace(/\n/g, '<br>')}`, 'danger');
    }
  }

  /** Excel受注台帳からの取込ボタン */
  async handleLedgerImport(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!confirm(`「${file.name}」の受注台帳で、出荷予定をすべて置き換えます。\n今の出荷予定は消えます。よろしいですか？`)) return;
    try {
      this.showAlert('Excel受注台帳を読み込み中…', 'info');
      const result = await orderManager.importLedgerExcel(file);
      this.showAlert(this._importMessage(result.message, result.errors), result.errors.length ? 'warning' : 'success');
      this._recordImportErrors('Excel受注台帳', file.name, result);
      this._shipExpanded = {};
      await this.loadShipmentSchedule();
    } catch (error) {
      console.error('受注台帳取込エラー:', error);
      this.showAlert(`受注台帳の取込に失敗しました（何も変更していません）:<br>${error.message}`, 'danger');
    }
  }

  /** EDI反映履歴サブ画面 */
  async loadEdiLog(filters = {}) {
    const container = document.getElementById('shipment-subtab-content');
    const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    let logs = await this.db.getAll('ediLog');
    logs.sort((a, b) => (b.importedAt - a.importedAt) || (a.id < b.id ? -1 : 1));
    const kubunList = [...new Set(logs.map(l => l.kubun))];

    if (filters.kubun) logs = logs.filter(l => l.kubun === filters.kubun);
    if (filters.notMjs) logs = logs.filter(l => !l.mjsDone);
    if (filters.keyword) {
      const q = filters.keyword.toLowerCase();
      logs = logs.filter(l => [l.orderNo, l.productCode, l.productName, l.content, l.fileName].some(v => String(v || '').toLowerCase().includes(q)));
    }
    const total = logs.length;
    const shown = logs.slice(0, 1000);
    const last = (await this.db.get('appSettings', 'lastEdiImport'))?.value;

    container.innerHTML = `
      <div style="display: flex; gap: var(--spacing-sm); align-items: center; flex-wrap: wrap; margin-bottom: var(--spacing-md);">
        <select id="edilog-kubun" class="filter-dropdown" style="width: auto;">
          <option value="">区分: すべて</option>
          ${kubunList.map(k => `<option value="${esc(k)}" ${filters.kubun === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}
        </select>
        <label style="display: flex; gap: 4px; align-items: center; color: var(--text-secondary);">
          <input type="checkbox" id="edilog-notmjs" ${filters.notMjs ? 'checked' : ''} /> MJS未反映のみ
        </label>
        <input type="search" id="edilog-keyword" class="filter-dropdown" placeholder="発注番号・製品・内容で絞込" value="${esc(filters.keyword || '')}" style="width: 260px;" />
        <span style="color: var(--text-muted); margin-left: auto;">
          ${last ? `前回のEDI取込: ${new Date(last.at).toLocaleString('ja-JP')}（${esc(last.files.join(', '))}）` : 'EDI取込はまだありません'}
        </span>
      </div>
      <div style="color: var(--text-muted); margin-bottom: var(--spacing-sm);">
        ${total.toLocaleString('ja-JP')}件${total > shown.length ? `（新しい順に ${shown.length}件を表示）` : ''}。
        並行運用中は、MJSに入力したら「MJS反映」にチェックを入れてください。前倒しはオレンジで表示します。
      </div>
      <div class="table-container">
        <table class="data-table">
          <thead><tr>
            <th>取込日時</th><th>ファイル</th><th>発注番号</th><th>区分</th><th>結果</th><th>変更内容</th><th>製品名</th><th style="white-space: nowrap;">MJS反映</th>
          </tr></thead>
          <tbody>
            ${shown.map(l => `
              <tr class="${String(l.content).includes('前倒し') ? 'edilog-advance' : ''} ${String(l.result).includes('要確認') ? 'edilog-check' : ''}">
                <td style="white-space: nowrap;">${new Date(l.importedAt).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                <td style="font-size: 0.85rem;">${esc(l.fileName)}</td>
                <td style="white-space: nowrap;">${esc(l.orderNo)}</td>
                <td>${esc(l.kubun)}</td>
                <td>${esc(l.result)}</td>
                <td>${esc(l.content)}</td>
                <td>${esc(l.productName)}</td>
                <td style="text-align: center;"><input type="checkbox" class="edilog-mjs" data-id="${esc(l.id)}" ${l.mjsDone ? 'checked' : ''} /></td>
              </tr>`).join('') || '<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">履歴はありません</td></tr>'}
          </tbody>
        </table>
      </div>
    `;

    document.getElementById('edilog-kubun')?.addEventListener('change', (e) => this.loadEdiLog({ ...filters, kubun: e.target.value || undefined }));
    document.getElementById('edilog-notmjs')?.addEventListener('change', (e) => this.loadEdiLog({ ...filters, notMjs: e.target.checked || undefined }));
    const kw = document.getElementById('edilog-keyword');
    const onKw = (e) => { const v = e.target.value.trim() || undefined; if (v !== filters.keyword) this.loadEdiLog({ ...filters, keyword: v }); };
    kw?.addEventListener('change', onKw);
    kw?.addEventListener('search', onKw);
    container.querySelectorAll('.edilog-mjs').forEach(cb => cb.addEventListener('change', async (e) => {
      const rec = await this.db.get('ediLog', e.target.dataset.id);
      if (!rec) return;
      rec.mjsDone = e.target.checked;
      await this.db.put('ediLog', rec);
    }));
  }

  async handleCSVImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    // ファイルタイプチェック
    if (!file.name.endsWith('.csv')) {
      this.showAlert('CSVファイルを選択してください', 'danger');
      return;
    }

    try {
      this.showAlert('CSVファイルをインポート中...', 'info');

      const result = await this.excelManager.importInventoryFromCSV(file);

      if (result.success) {
        let message = result.message;

        message = this._importMessage(message, result.errors);
        this._recordImportErrors('在庫CSV', file.name, result);

        this.showAlert(message, result.errorCount > 0 ? 'warning' : 'success');

        // 在庫画面を再読み込み
        await this.loadInventory();
      } else {
        this.showAlert(result.message, 'danger');
      }
    } catch (error) {
      console.error('CSVインポートエラー:', error);
      this.showAlert(`CSVインポートに失敗しました: ${error.message}`, 'danger');
    } finally {
      // ファイル入力をリセット（同じファイルを再選択可能にする）
      event.target.value = '';
    }
  }

  /**
   * 製品出荷予定CSVファイルインポート処理
   * @param {Event} event - ファイル選択イベント
   */
  async handleShipmentCSVImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    // ファイルタイプチェック
    if (!file.name.endsWith('.csv')) {
      this.showAlert('CSVファイルを選択してください', 'danger');
      return;
    }

    try {
      this.showAlert('CSVファイルをインポート中...', 'info');

      const result = await this.excelManager.importShipmentFromCSV(file);

      if (result.success) {
        let message = result.message;

        message = this._importMessage(message, result.errors);
        this._recordImportErrors('出荷予定CSV', file.name, result);

        this.showAlert(message, result.errorCount > 0 ? 'warning' : 'success');

        // 出荷予定画面を再読み込み
        await this.loadShipment();
      } else {
        this.showAlert(result.message, 'danger');
      }
    } catch (error) {
      console.error('CSV出荷予定インポートエラー:', error);
      this.showAlert(`CSVインポートに失敗しました: ${error.message}`, 'danger');
    } finally {
      event.target.value = '';
    }
  }

  /**
   * 製品出荷履歴CSVインポート処理
   * @param {Event} event - ファイル選択イベント
   */
  async handleShipmentHistoryCSVImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.csv')) {
      this.showAlert('CSVファイルを選択してください', 'danger');
      return;
    }

    try {
      this.showAlert('CSVファイルをインポート中...', 'info');

      const result = await this.excelManager.importShipmentHistoryFromCSV(file);

      if (result.success) {
        const message = this._importMessage(result.message, result.errors);
        this._recordImportErrors('出荷履歴CSV', file.name, result);
        this.showAlert(message, result.errorCount > 0 ? 'warning' : 'success');
        await this.loadShipmentHistory();
      } else {
        this.showAlert(result.message, 'danger');
      }
    } catch (error) {
      console.error('CSV出荷履歴インポートエラー:', error);
      this.showAlert(`CSVインポートに失敗しました: ${error.message}`, 'danger');
    } finally {
      event.target.value = '';
    }
  }
}

// グローバルインスタンス
const uiManager = new UIManager();
// 検索マネージャーなど他のファイルから window.uiManager で参照できるようにする
window.uiManager = uiManager;

// 製品名リンク → 在庫管理タブの該当製品へ（出荷予定など）
document.addEventListener('click', (e) => {
  const link = e.target.closest('.jump-inventory');
  if (!link) return;
  e.preventDefault();
  uiManager.jumpToInventoryProduct(link.dataset.productCode);
});
