/**
 * コスト計算クラス
 * 製品別・工程別のコスト分析を担当
 */
class CostCalculator {
    constructor() {
        this.db = db;
    }

    /**
     * 製品の合計コストを計算
     * @param {string} productCode - 製品番号
     * @returns {Promise<object>} コスト詳細
     */
    async calculateProductCost(productCode) {
        try {
            // 製品情報を取得
            const product = await this.db.get('products', productCode);
            if (!product) {
                throw new Error(`製品番号 ${productCode} が見つかりません`);
            }

            // 部品情報を取得
            const parts = await this.db.getByIndex('parts', 'productCode', productCode);
            if (parts.length === 0) {
                return {
                    productCode: productCode,
                    productName: product.productName,
                    totalCost: 0,
                    processCosts: [],
                    parts: []
                };
            }

            // 工程順にソート
            parts.sort((a, b) =>
                ModelUtils.getProcessOrder(a.process) - ModelUtils.getProcessOrder(b.process)
            );

            // 各部品のコストを計算
            const partCosts = parts.map(part => ({
                partCode: part.partCode,
                partName: part.partName,
                process: part.process,
                unitCost: part.unitCost,
                quantity: part.quantity,
                totalCost: part.unitCost * part.quantity
            }));

            // 工程別コストを集計
            const processCostMap = new Map();
            partCosts.forEach(pc => {
                const current = processCostMap.get(pc.process) || 0;
                processCostMap.set(pc.process, current + pc.totalCost);
            });

            const processCosts = Array.from(processCostMap.entries()).map(([process, cost]) => ({
                process: process,
                cost: cost
            }));

            // 合計コストを計算
            const totalCost = partCosts.reduce((sum, pc) => sum + pc.totalCost, 0);

            return {
                productCode: productCode,
                productName: product.productName,
                totalCost: totalCost,
                processCosts: processCosts,
                parts: partCosts
            };

        } catch (error) {
            throw error;
        }
    }

    /**
     * すべての製品のコストを計算
     * @returns {Promise<Array>} すべての製品のコスト情報
     */
    async calculateAllProductCosts() {
        const products = await this.db.getAll('products');

        const costs = await Promise.all(
            products.map(product => this.calculateProductCost(product.productCode))
        );

        // 合計コストの降順にソート
        costs.sort((a, b) => b.totalCost - a.totalCost);

        return costs;
    }

    /**
     * 工程別コスト分析
     * @returns {Promise<object>} 工程別の集計
     */
    async analyzeByProcess() {
        const parts = await this.db.getAll('parts');

        const processCostMap = new Map();
        const processCountMap = new Map();

        parts.forEach(part => {
            const cost = part.unitCost * part.quantity;
            const currentCost = processCostMap.get(part.process) || 0;
            const currentCount = processCountMap.get(part.process) || 0;

            processCostMap.set(part.process, currentCost + cost);
            processCountMap.set(part.process, currentCount + 1);
        });

        const analysis = Array.from(processCostMap.entries()).map(([process, totalCost]) => ({
            process: process,
            totalCost: totalCost,
            partCount: processCountMap.get(process),
            averageCost: totalCost / processCountMap.get(process)
        }));

        // 工程順にソート
        analysis.sort((a, b) =>
            ModelUtils.getProcessOrder(a.process) - ModelUtils.getProcessOrder(b.process)
        );

        return {
            processAnalysis: analysis,
            grandTotal: analysis.reduce((sum, a) => sum + a.totalCost, 0)
        };
    }

    /**
     * 仕入先別コスト分析
     * @returns {Promise<Array>} 仕入先別の集計
     */
    async analyzeBySupplier() {
        const parts = await this.db.getAll('parts');

        const supplierCostMap = new Map();
        const supplierCountMap = new Map();

        parts.forEach(part => {
            const supplier = part.supplier || '仕入先未設定';
            const cost = part.unitCost * part.quantity;
            const currentCost = supplierCostMap.get(supplier) || 0;
            const currentCount = supplierCountMap.get(supplier) || 0;

            supplierCostMap.set(supplier, currentCost + cost);
            supplierCountMap.set(supplier, currentCount + 1);
        });

        const analysis = Array.from(supplierCostMap.entries()).map(([supplier, totalCost]) => ({
            supplier: supplier,
            totalCost: totalCost,
            partCount: supplierCountMap.get(supplier),
            averageCost: totalCost / supplierCountMap.get(supplier)
        }));

        // コストの降順にソート
        analysis.sort((a, b) => b.totalCost - a.totalCost);

        return analysis;
    }

    /**
     * 在庫金額を計算
     * @returns {Promise<object>} 在庫金額の詳細
     */
    async calculateInventoryValue() {
        const parts = await this.db.getAll('parts');

        const inventoryValues = await Promise.all(
            parts.map(async (part) => {
                const inventory = await this.db.get('inventory', part.partCode);
                const currentStock = inventory ? inventory.currentStock : 0;
                const value = part.unitCost * currentStock;

                return {
                    partCode: part.partCode,
                    partName: part.partName,
                    process: part.process,
                    currentStock: currentStock,
                    unitCost: part.unitCost,
                    totalValue: value
                };
            })
        );

        // 工程別に集計
        const processTotalMap = new Map();
        inventoryValues.forEach(iv => {
            const current = processTotalMap.get(iv.process) || 0;
            processTotalMap.set(iv.process, current + iv.totalValue);
        });

        const processValues = Array.from(processTotalMap.entries()).map(([process, value]) => ({
            process: process,
            totalValue: value
        }));

        // 工程順にソート
        processValues.sort((a, b) =>
            ModelUtils.getProcessOrder(a.process) - ModelUtils.getProcessOrder(b.process)
        );

        const grandTotal = inventoryValues.reduce((sum, iv) => sum + iv.totalValue, 0);

        return {
            inventoryValues: inventoryValues,
            processTotals: processValues,
            grandTotal: grandTotal
        };
    }
}

// インスタンスをエクスポート
const costCalculator = new CostCalculator();
