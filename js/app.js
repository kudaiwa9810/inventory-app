/**
 * アプリケーションエントリーポイント
 * データベース初期化とUI起動
 */

// アプリケーション初期化
async function initApp() {
    try {
        console.log('🚀 アプリケーションを初期化中...');

        // データベース初期化
        await db.init();
        console.log('✅ データベース初期化完了');
        showStorageBadge();

        // UI初期化
        await uiManager.init();
        console.log('✅ UI初期化完了');

        // SearchManager初期化
        window.searchManager = new SearchManager(db);
        searchManager.init();
        console.log('✅ SearchManager初期化完了');

        // 在庫直接編集モーダルのイベントリスナー
        document.getElementById('save-edit-btn')?.addEventListener('click', async () => {
            const partCode = document.getElementById('direct-edit-part-code').value;
            const newStock = parseFloat(document.getElementById('edit-new-stock').value);
            const reason = document.getElementById('edit-reason').value;

            const result = await inventoryLogic.directStockEdit(partCode, newStock, reason);

            if (result.success) {
                uiManager.showAlert(result.message, 'success');
                uiManager.closeAllModals();
                await uiManager.loadInventory();
            } else {
                uiManager.showAlert(result.message, 'error');
            }
        });

        // 発注記録モーダルのイベントリスナー
        document.getElementById('save-order-btn')?.addEventListener('click', async () => {
            await uiManager.saveOrder();
        });

        // 出荷予定モーダルのイベントリスナー
        document.getElementById('save-shipment-btn')?.addEventListener('click', async () => {
            await uiManager.saveShipment();
        });

        // 仕入先保存ボタンのイベントリスナー
        document.getElementById('save-supplier-btn')?.addEventListener('click', async () => {
            await uiManager.saveSupplier();
        });

        // モーダルクローズボタンのイベントリスナー
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', () => {
                uiManager.closeAllModals();
            });
        });

        // モーダル背景クリックでクローズ
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    uiManager.closeAllModals();
                }
            });
        });

        // Escキーでモーダルをクローズ
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                uiManager.closeAllModals();
            }
        });

        // 他の人の更新を定期チェック（共有サーバー版）
        startUpdateWatcher();

        console.log('🎉 アプリケーション起動完了');

    } catch (error) {
        console.error('❌ 初期化エラー:', error);
        alert('アプリケーションの初期化に失敗しました: ' + error.message);
    }
}

/**
 * 画面右上に「データの保存先」と「ログイン中の人」を表示
 */
function showStorageBadge() {
    const header = document.querySelector('.app-header');
    if (!header) return;
    const box = document.createElement('div');
    box.id = 'storage-badge';
    box.style.cssText = 'position:absolute;top:16px;right:24px;font-size:0.85rem;color:rgba(255,255,255,0.9);' +
        'display:flex;gap:10px;align-items:center;';
    const isSp = db.storageLabel === 'SharePoint';
    box.innerHTML = isSp
        ? `<span title="データは SharePoint に保存されています">☁ SharePoint</span>` +
          `<span>👤 ${String(db.userName).replace(/[<>&"]/g, '')}</span>` +
          `<a href="#" id="logout-link" style="color:rgba(255,255,255,0.8);">ログアウト</a>`
        : `<span title="データは社内のサーバーPCに保存されています">🖥 サーバーPC</span>`;
    if (getComputedStyle(header).position === 'static') header.style.position = 'relative';
    header.appendChild(box);
    document.getElementById('logout-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        if (confirm('ログアウトしますか？')) db._transport.logout();
    });
}

/**
 * 他のユーザーがデータを更新したら画面上部にお知らせを出す
 * （入力途中の画面を勝手に書き換えないよう、自動では再読み込みしない）
 */
function startUpdateWatcher() {
    const bar = document.createElement('div');
    bar.id = 'update-notice';
    bar.style.cssText = 'display:none;position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:9999;' +
        'background:#f59e0b;color:#1a1a2e;padding:8px 16px;border-radius:0 0 8px 8px;font-weight:600;' +
        'box-shadow:0 2px 8px rgba(0,0,0,.3);cursor:pointer;';
    bar.textContent = '🔄 他の人がデータを更新しました（クリックで最新表示）';
    bar.addEventListener('click', async () => {
        bar.style.display = 'none';
        await uiManager.loadScreenData(uiManager.currentScreen);
    });
    document.body.appendChild(bar);

    let offline = false;
    setInterval(async () => {
        try {
            const changed = await db.checkForUpdates();
            if (offline) {
                offline = false;
                uiManager.showAlert('サーバーに再接続しました', 'success');
            }
            if (changed) {
                bar.style.display = 'block';
            }
        } catch (e) {
            if (!offline) {
                offline = true;
                uiManager.showAlert('サーバーに接続できません。サーバーPCを確認してください。', 'error');
            }
        }
    }, 15000);
}

// サンプルデータを投入（開発用）
async function loadSampleData() {
    try {
        console.log('📦 サンプルデータを投入中...');

        // 製品追加
        const product1 = new Product('12345678', '製品A');
        await db.put('products', product1.toObject());

        const product2 = new Product('87654321', '製品B');
        await db.put('products', product2.toObject());

        // 部品追加（製品A）
        const parts = [
            new Part('1234-01-A', '12345678', '材料X', 100, 2, '株式会社材料商社'),
            new Part('1234-02-B', '12345678', '加工品Y', 200, 1, '株式会社加工工場'),
            new Part('1234-03-C', '12345678', '完成品Z', 300, 1, ''),

            // 製品B
            new Part('5678-01-A', '87654321', '材料P', 150, 3, '株式会社材料商社'),
            new Part('5678-02-B', '87654321', '加工品Q', 250, 1, '株式会社加工工場'),
            new Part('5678-03-C', '87654321', '表面処理R', 350, 1, '株式会社表面処理'),
            new Part('5678-04-D', '87654321', '完成品S', 400, 1, ''),
        ];

        for (const part of parts) {
            await db.put('parts', part.toObject());
            // 初期在庫
            await db.put('inventory', new Inventory(part.partCode, 0).toObject());
        }

        // 初期在庫を設定
        await db.put('inventory', new Inventory('1234-01-A', 100).toObject());
        await db.put('inventory', new Inventory('5678-01-A', 200).toObject());

        // 履歴記録
        const history1 = new StockHistory(
            '1234-01-A',
            '調整',
            100,
            0,
            100,
            '初期在庫設定',
            ''
        );
        await db.add('stockHistory', history1.toObject());

        const history2 = new StockHistory(
            '5678-01-A',
            '調整',
            200,
            0,
            200,
            '初期在庫設定',
            ''
        );
        await db.add('stockHistory', history2.toObject());

        console.log('✅ サンプルデータ投入完了');
        uiManager.showAlert('サンプルデータを投入しました', 'success');
        await uiManager.loadScreenData(uiManager.currentScreen);

    } catch (error) {
        console.error('❌ サンプルデータ投入エラー:', error);
        uiManager.showAlert('サンプルデータの投入に失敗しました', 'error');
    }
}

// データベースをクリア（開発用）
async function clearAllData() {
    if (!confirm('すべてのデータを削除しますか？この操作は取り消せません。')) {
        return;
    }

    try {
        await db.clearAll();
        console.log('✅ データをクリアしました');
        uiManager.showAlert('すべてのデータを削除しました', 'success');
        await uiManager.loadScreenData(uiManager.currentScreen);
    } catch (error) {
        console.error('❌ データクリアエラー:', error);
        uiManager.showAlert('データの削除に失敗しました', 'error');
    }
}

// 開発用コマンドをグローバルに公開
window.loadSampleData = loadSampleData;
window.clearAllData = clearAllData;

// DOMContentLoaded時に初期化
document.addEventListener('DOMContentLoaded', () => {
    initApp();

    // 開発用ヒントを表示
    console.log('%c開発用コマンド', 'color: #6366f1; font-size: 16px; font-weight: bold;');
    console.log('%cloadSampleData() - サンプルデータを投入', 'color: #10b981;');
    console.log('%cclearAllData() - すべてのデータを削除', 'color: #ef4444;');
});
