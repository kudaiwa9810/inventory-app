/**
 * 在庫ロジック管理クラス
 * 工程完了入力と上流工程の自動減算を担当
 */
class InventoryLogic {
    constructor() {
        this.db = db;
    }

    /**
     * 工程完了入力を実行
     * @param {string} productCode - 製品番号
     * @param {string} process - 完了した工程（A, B, C...）
     * @param {number} completedQuantity - 完了数
     * @returns {Promise<object>} 実行結果
     */
    async processCompletion(productCode, process, completedQuantity) {
        try {
            // 1. 製品が存在するか確認
            const product = await this.db.get('products', productCode);
            if (!product) {
                throw new Error(`製品番号 ${productCode} が見つかりません`);
            }

            // 2. 該当製品のすべての部品を取得
            const allParts = await this.db.getByIndex('parts', 'productCode', productCode);
            if (allParts.length === 0) {
                throw new Error(`製品 ${productCode} に紐づく部品が登録されていません`);
            }

            // 3. 完了工程の部品を特定
            const completedPart = allParts.find(p => p.process === process);
            if (!completedPart) {
                throw new Error(`工程 ${process} の部品が見つかりません`);
            }

            // 4. 上流工程の部品を特定
            const upstreamProcesses = ModelUtils.getUpstreamProcesses(process);
            const upstreamParts = allParts.filter(p => upstreamProcesses.includes(p.process));

            // 5. 在庫変更のシミュレーション
            const changes = await this.simulateStockChanges(
                completedPart,
                upstreamParts,
                completedQuantity
            );

            // 6. 在庫不足チェック
            const insufficientStock = changes.filter(c => c.newStock < 0);
            if (insufficientStock.length > 0) {
                const errors = insufficientStock.map(c =>
                    `部品 ${c.partCode} (${c.partName}): 必要数 ${Math.abs(c.changeAmount)} に対して在庫 ${c.currentStock} が不足`
                );
                throw new Error('在庫不足:\n' + errors.join('\n'));
            }

            // 7. 在庫更新を実行
            await this.applyStockChanges(changes, process, completedQuantity);

            return {
                success: true,
                message: `工程 ${process} の完了処理が完了しました`,
                changes: changes
            };

        } catch (error) {
            return {
                success: false,
                message: error.message,
                changes: []
            };
        }
    }

    /**
     * 在庫変更をシミュレーション
     * @param {object} completedPart - 完了工程の部品
     * @param {Array<object>} upstreamParts - 上流工程の部品
     * @param {number} completedQuantity - 完了数
     * @returns {Promise<Array>} 変更予定の配列
     */
    async simulateStockChanges(completedPart, upstreamParts, completedQuantity) {
        const changes = [];

        // 完了工程の在庫を増加
        const completedInventory = await this.db.get('inventory', completedPart.partCode) ||
            new Inventory(completedPart.partCode, 0).toObject();

        const completedIncrease = completedQuantity * completedPart.quantity;
        changes.push({
            partCode: completedPart.partCode,
            partName: completedPart.partName,
            process: completedPart.process,
            changeType: 'increase',
            changeAmount: completedIncrease,
            currentStock: completedInventory.currentStock,
            newStock: completedInventory.currentStock + completedIncrease
        });

        // 上流工程の在庫を減少
        for (const upstreamPart of upstreamParts) {
            const upstreamInventory = await this.db.get('inventory', upstreamPart.partCode) ||
                new Inventory(upstreamPart.partCode, 0).toObject();

            const decrease = completedQuantity * upstreamPart.quantity;
            changes.push({
                partCode: upstreamPart.partCode,
                partName: upstreamPart.partName,
                process: upstreamPart.process,
                changeType: 'decrease',
                changeAmount: -decrease,
                currentStock: upstreamInventory.currentStock,
                newStock: upstreamInventory.currentStock - decrease
            });
        }

        return changes;
    }

    /**
     * 在庫変更を適用
     * @param {Array} changes - 変更内容の配列
     * @param {string} relatedProcess - 関連工程
     * @param {number} completedQuantity - 完了数
     * @returns {Promise<void>}
     */
    async applyStockChanges(changes, relatedProcess, completedQuantity) {
        await this.db.transaction(['inventory', 'stockHistory'], (transaction) => {
            const inventoryStore = transaction.objectStore('inventory');
            const historyStore = transaction.objectStore('stockHistory');

            for (const change of changes) {
                // 在庫更新
                const inventoryData = {
                    partCode: change.partCode,
                    currentStock: change.newStock,
                    updatedAt: Date.now()
                };
                inventoryStore.put(inventoryData);

                // 履歴記録
                const historyData = new StockHistory(
                    change.partCode,
                    '工程完了',
                    change.changeAmount,
                    change.currentStock,
                    change.newStock,
                    `工程 ${relatedProcess} 完了: ${completedQuantity}個`,
                    relatedProcess
                ).toObject();
                historyStore.add(historyData);
            }
        });
    }

    /**
     * 在庫を直接編集
     * @param {string} partCode - 部品番号
     * @param {number} newStock - 新しい在庫数
     * @param {string} reason - 変更理由
     * @returns {Promise<object>} 実行結果
     */
    async directStockEdit(partCode, newStock, reason) {
        try {
            // 1. 部品の存在確認（getAll経由で検索）
            const allParts = await this.db.getAll('parts');
            const part = allParts.find(p => p.partCode === partCode);
            if (!part) {
                throw new Error(`部品番号 ${partCode} が見つかりません`);
            }

            // 2. 変更理由のチェック（任意なので削除）

            // 3. 現在の在庫を取得
            const currentInventory = await this.db.get('inventory', partCode) ||
                new Inventory(partCode, 0).toObject();

            const previousStock = currentInventory.currentStock;
            const changeAmount = newStock - previousStock;

            // 4. 在庫更新と履歴記録
            await this.db.transaction(['inventory', 'stockHistory'], (transaction) => {
                const inventoryStore = transaction.objectStore('inventory');
                const historyStore = transaction.objectStore('stockHistory');

                // 在庫更新
                inventoryStore.put({
                    partCode: partCode,
                    currentStock: newStock,
                    updatedAt: Date.now()
                });

                // 履歴記録
                const historyData = new StockHistory(
                    partCode,
                    '直接編集',
                    changeAmount,
                    previousStock,
                    newStock,
                    reason || '理由なし', // 空の場合デフォルト値
                    ''
                ).toObject();
                historyStore.add(historyData);
            });

            return {
                success: true,
                message: '在庫を更新しました',
                change: {
                    partCode: partCode,
                    partName: part.partName,
                    previousStock: previousStock,
                    newStock: newStock,
                    changeAmount: changeAmount
                }
            };

        } catch (error) {
            return {
                success: false,
                message: error.message,
                change: null
            };
        }
    }

    /**
     * 部品の在庫情報を取得（部品情報と在庫を結合）
     * @param {string} partCode - 部品番号
     * @returns {Promise<object>} 部品と在庫の結合情報
     */
    async getPartWithInventory(partCode) {
        const parts = await this.db.getByIndex('parts', 'partCode', partCode);
        const part = parts[0] || null;
        const inventory = await this.db.get('inventory', partCode);

        if (!part) {
            return null;
        }

        return {
            ...part,
            currentStock: inventory ? inventory.currentStock : 0,
            inventoryUpdatedAt: inventory ? inventory.updatedAt : null
        };
    }

    /**
     * 製品のすべての部品の在庫情報を取得
     * @param {string} productCode - 製品番号
     * @returns {Promise<Array>} 部品と在庫の結合情報の配列
     */
    async getProductPartsWithInventory(productCode) {
        const parts = await this.db.getByIndex('parts', 'productCode', productCode);

        const partsWithInventory = await Promise.all(
            parts.map(async (part) => {
                const inventory = await this.db.get('inventory', part.partCode);
                return {
                    ...part,
                    currentStock: inventory ? inventory.currentStock : 0,
                    inventoryUpdatedAt: inventory ? inventory.updatedAt : null
                };
            })
        );

        // 工程順にソート
        return partsWithInventory.sort((a, b) =>
            ModelUtils.getProcessOrder(a.process) - ModelUtils.getProcessOrder(b.process)
        );
    }

    /**
     * すべての在庫情報を取得（部品情報と結合）
     * @returns {Promise<Array>} すべての部品と在庫の結合情報
     */
    async getAllInventory() {
        const parts = await this.db.getAll('parts');

        const inventory = await Promise.all(
            parts.map(async (part) => {
                const inv = await this.db.get('inventory', part.partCode);
                return {
                    ...part,
                    currentStock: inv ? inv.currentStock : 0,
                    inventoryUpdatedAt: inv ? inv.updatedAt : null
                };
            })
        );

        return inventory;
    }

    /**
     * 在庫履歴を取得（フィルタ付き）
     * @param {object} filters - フィルタ条件
     * @returns {Promise<Array>} 履歴データの配列
     */
    async getStockHistory(filters = {}) {
        let history = await this.db.getAll('stockHistory');

        // 部品番号でフィルタ
        if (filters.partCode) {
            history = history.filter(h => h.partCode === filters.partCode);
        }

        // 変更区分でフィルタ
        if (filters.changeType) {
            history = history.filter(h => h.changeType === filters.changeType);
        }

        // 日付範囲でフィルタ
        if (filters.startDate) {
            const startTime = new Date(filters.startDate).getTime();
            history = history.filter(h => h.createdAt >= startTime);
        }

        if (filters.endDate) {
            const endTime = new Date(filters.endDate).getTime() + 86400000; // +1日
            history = history.filter(h => h.createdAt < endTime);
        }

        // 新しい順にソート
        history.sort((a, b) => b.createdAt - a.createdAt);

        // 部品名を付与
        const historyWithPartNames = await Promise.all(
            history.map(async (h) => {
                const partResults = await this.db.getByIndex('parts', 'partCode', h.partCode);
                const part = partResults[0] || null;
                return {
                    ...h,
                    partName: part ? part.partName : '不明',
                    process: part ? part.process : ''
                };
            })
        );

        return historyWithPartNames;
    }

    /**
     * 注残在庫を計算
     * 注残在庫 = 現在庫 - Σ(構成数 × 該当する製品の出荷数)
     * @param {string} partCode - 部品番号
     * @returns {Promise<number>} 注残在庫
     */
    async calculateOrderRemainingStock(partCode) {
        try {
            // 現在庫を取得
            const inventory = await this.db.get('inventory', partCode);
            const currentStock = inventory?.currentStock || 0;

            // この部品を含む全ての製品を取得
            const parts = await this.db.getByIndex('parts', 'partCode', partCode);

            let reservedStock = 0;
            for (const part of parts) {
                // この製品の出荷予定を取得
                const shipments = await this.db.getByIndex('shipmentSchedules', 'productCode', part.productCode);

                // 未出荷の出荷予定の合計（取消・完了は除く）
                for (const shipment of shipments.filter(isActiveShipment)) {
                    reservedStock += part.quantity * shipment.shipmentQuantity;
                }
            }

            return currentStock - reservedStock;
        } catch (error) {
            console.error('注残在庫の計算に失敗:', error);
            return 0;
        }
    }

    /**
     * 期限切れ出荷予定を処理
     * 出荷日の翌日になった出荷予定を自動的に処理（在庫減算＆削除）
     * @returns {Promise<number>} 処理した出荷予定の件数
     */
    async processExpiredShipments() {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const allShipments = await this.db.getAll('shipmentSchedules');

            // 出荷日の翌日になった出荷予定を抽出
            const expiredShipments = allShipments.filter(s => {
                const shipDate = new Date(s.shipmentDate);
                const nextDay = new Date(shipDate);
                nextDay.setDate(nextDay.getDate() + 1);
                nextDay.setHours(0, 0, 0, 0);
                return today >= nextDay;
            });

            // 各出荷予定を処理
            for (const shipment of expiredShipments) {
                await this.executeShipment(shipment);
                await this.db.delete('shipmentSchedules', shipment.id);
                console.log(`出荷予定を処理: ${shipment.productName} (${shipment.productCode}) ${shipment.shipmentQuantity}個`);
            }

            return expiredShipments.length;
        } catch (error) {
            console.error('期限切れ出荷予定の処理に失敗:', error);
            return 0;
        }
    }

    /**
     * 出荷を実行（在庫減算と履歴記録）
     * @param {object} shipment - 出荷予定オブジェクト
     * @returns {Promise<void>}
     */
    async executeShipment(shipment) {
        try {
            // この製品の全部品を取得
            const parts = await this.db.getByIndex('parts', 'productCode', shipment.productCode);

            for (const part of parts) {
                // 在庫を取得
                const inventory = await this.db.get('inventory', part.partCode);
                const currentStock = inventory?.currentStock || 0;
                const deduction = part.quantity * shipment.shipmentQuantity;
                const newStock = currentStock - deduction;

                // 在庫を更新
                await this.db.put('inventory', {
                    partCode: part.partCode,
                    currentStock: newStock,
                    updatedAt: Date.now()
                });

                // 履歴を記録
                const history = new StockHistory(
                    part.partCode,
                    '出荷',
                    -deduction,
                    currentStock,
                    newStock,
                    `製品出荷: ${shipment.productName} (${shipment.productCode}) ${shipment.shipmentQuantity}個 [出荷日: ${shipment.shipmentDate}]`,
                    part.process || ''
                );
                await this.db.add('stockHistory', history.toObject());

                console.log(`在庫減算: ${part.partCode} ${currentStock} → ${newStock} (${deduction}個)`);
            }
        } catch (error) {
            console.error('出荷実行に失敗:', error);
            throw error;
        }
    }

    /**
     * CSV一括インポート用の高速在庫更新
     * @param {Array<{partCode: string, newStock: number, partName: string}>} updates - 更新データの配列
     * @returns {Promise<{success: boolean, count: number, message: string}>}
     */
    async bulkStockUpdate(updates) {
        try {
            // サーバーへ 1 回でまとめて送信（全部成功 or 全部取り消し）
            const timestamp = Date.now();
            const ops = updates.map(update => ({
                op: 'put',
                store: 'inventory',
                data: {
                    partCode: update.partCode,
                    currentStock: update.newStock,
                    updatedAt: timestamp
                }
            }));
            const successCount = ops.length;

            // 履歴を1件だけ記録
            const history = new StockHistory(
                'CSV_BULK_IMPORT',
                'CSV一括インポート',
                0,
                0,
                0,
                `CSV一括インポート: ${successCount}件の在庫を更新`,
                ''
            );
            ops.push({ op: 'add', store: 'stockHistory', data: history.toObject() });

            await this.db.batch(ops);

            return {
                success: true,
                count: successCount,
                message: `${successCount}件の在庫を一括更新しました`
            };
        } catch (error) {
            console.error('一括在庫更新に失敗:', error);
            return {
                success: false,
                count: 0,
                message: `一括更新に失敗しました: ${error.message}`
            };
        }
    }

    /**
     * 全在庫情報を一括取得（高速版）
     * DBアクセスを3回のみに抑え、注残在庫もメモリ上で計算する
     * @returns {Promise<Array>} 部品・在庫・注残在庫の結合データ
     */
    async getAllInventoryBulk() {
        const [parts, allInventory, allShipments] = await Promise.all([
            this.db.getAll('parts'),
            this.db.getAll('inventory'),
            this.db.getAll('shipmentSchedules')
        ]);

        // 在庫をpartCodeキーのMapに変換
        const inventoryMap = new Map(allInventory.map(inv => [inv.partCode, inv.currentStock]));

        // 出荷予定を製品コード別に合計（取消・完了は除く）
        const shipmentTotalByProduct = new Map();
        for (const s of allShipments.filter(isActiveShipment)) {
            shipmentTotalByProduct.set(s.productCode, (shipmentTotalByProduct.get(s.productCode) || 0) + s.shipmentQuantity);
        }

        // partCodeごとの引当数を計算（同一partCodeが複数製品にまたがる場合も考慮）
        const reservedByPartCode = new Map();
        for (const part of parts) {
            const shipmentQty = shipmentTotalByProduct.get(part.productCode) || 0;
            const reserved = part.quantity * shipmentQty;
            reservedByPartCode.set(part.partCode, (reservedByPartCode.get(part.partCode) || 0) + reserved);
        }

        return parts.map(part => {
            const currentStock = inventoryMap.get(part.partCode) || 0;
            const reserved = reservedByPartCode.get(part.partCode) || 0;
            return {
                ...part,
                currentStock,
                orderRemaining: currentStock - reserved
            };
        });
    }
}

// インスタンスをエクスポート
const inventoryLogic = new InventoryLogic();
