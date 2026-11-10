/**
 * エクセルファイルのインポート/エクスポート管理クラス
 */
class ExcelManager {
    constructor() {
        this.db = db;
    }

    /**
     * エクセルファイルをインポート
     * @param {File} file - インポートするエクセルファイル
     * @returns {Promise<object>} インポート結果
     */
    async importExcel(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = async (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });

                    console.log('ワークブック読み込み成功');
                    console.log('シート名一覧:', workbook.SheetNames);

                    // 最初のシートを取得
                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];

                    console.log('シート名:', sheetName);

                    // JSONに変換（ヘッダー行を含む）
                    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                    console.log('JSON変換成功、行数:', jsonData?.length);
                    if (jsonData && jsonData.length > 0) {
                        console.log('最初の3行:', jsonData.slice(0, 3));
                    }

                    // データを解析して登録
                    const result = await this.parseAndImportData(jsonData);
                    resolve(result);

                } catch (error) {
                    console.error('エクセル読み込みエラー:', error);
                    reject(error);
                }
            };

            reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
            reader.readAsArrayBuffer(file);
        });
    }

    /**
     * データを解析してデータベースに登録（高速版）
     * @param {Array} jsonData - エクセルから読み込んだデータ
     * @returns {Promise<object>} 登録結果
     */
    async parseAndImportData(jsonData) {
        if (!jsonData || !Array.isArray(jsonData) || jsonData.length === 0) {
            throw new Error('エクセルファイルが空、または読み込めませんでした');
        }

        console.log(`エクセルインポート開始: ${jsonData.length - 1}行のデータ`);
        const startTime = performance.now();

        // ヘッダー行を解析
        const headers = jsonData[0].map(h => h?.toString().trim() || '');
        console.log('エクセルヘッダー:', headers);

        // 列インデックスを検出（柔軟なマッピング）
        const productCodeIndex = headers.findIndex(h => h === 'セット商品ｺｰﾄﾞ' || h === '製品番号');
        const productNameIndex = headers.findIndex(h => h === 'セット商品名' || h === '製品名');
        const partCodeIndex = headers.findIndex(h => h === '商品ｺｰﾄﾞ' || h === '部品番号');
        const partNameIndex = headers.findIndex(h => h === '商品名' || h === '部品名');
        const quantityIndex = headers.findIndex(h => h === '数量' || h === '構成数');
        const unitCostIndex = headers.findIndex(h => h === '原価単価' || h === '単体費用');
        const supplierCodeIndex = headers.findIndex(h => h === '仕入先ｺｰﾄﾞ' || h === '仕入先コード');
        const supplierNameIndex = headers.findIndex(h => h === '仕入先名' || h === '仕入先');

        if (productCodeIndex === -1 || partCodeIndex === -1) {
            const missingColumns = [];
            if (productCodeIndex === -1) missingColumns.push('セット商品ｺｰﾄﾞ');
            if (partCodeIndex === -1) missingColumns.push('商品ｺｰﾄﾞ');

            throw new Error(
                `必要な列が見つかりません。\n` +
                `見つからない列: ${missingColumns.join(', ')}\n` +
                `検出されたヘッダー: ${headers.join(', ')}\n\n` +
                `エクセルには「セット商品ｺｰﾄﾞ」「商品ｺｰﾄﾞ」の列が必要です。`
            );
        }

        const products = new Map();
        const parts = [];
        let successCount = 0;
        let skipCount = 0;

        // データ行を処理（ヘッダー行をスキップ）
        for (let i = 1; i < jsonData.length; i++) {
            const row = jsonData[i];

            // 空行をスキップ
            if (!row || row.length === 0) {
                skipCount++;
                continue;
            }

            const productCode = row[productCodeIndex]?.toString().trim();
            const productName = row[productNameIndex]?.toString().trim();
            const partCode = row[partCodeIndex]?.toString().trim();
            const partName = row[partNameIndex]?.toString().trim();
            const quantity = quantityIndex !== -1 ? parseFloat(row[quantityIndex]) : 0;
            const unitCost = unitCostIndex !== -1 ? parseFloat(row[unitCostIndex]) : 0;
            const supplierCode = supplierCodeIndex !== -1 ? row[supplierCodeIndex]?.toString().trim() : '';
            const supplierName = supplierNameIndex !== -1 ? row[supplierNameIndex]?.toString().trim() : '';

            // 必須項目のチェック
            if (!productCode || !partCode) {
                skipCount++;
                continue;
            }

            // 製品を登録（重複チェック）
            if (!products.has(productCode)) {
                products.set(productCode, {
                    productCode,
                    productName: productName || productCode,
                    description: '',
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                });
            }

            // 部品を登録
            parts.push({
                productCode,
                partCode,
                partName: partName || partCode,
                process: '',
                quantity: isNaN(quantity) ? 0 : quantity,
                unitCost: isNaN(unitCost) ? 0 : unitCost,
                supplierCode: supplierCode || '',
                supplier: supplierName || '',
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
            successCount++;
        }

        const parseTime = performance.now() - startTime;
        console.log(`エクセル解析完了: ${parseTime.toFixed(0)}ms`);

        // データベースに保存
        try {
            console.log(`${products.size}件の製品、${parts.length}件の部品を登録中...`);
            const saveStartTime = performance.now();

            // 製品を保存
            for (const product of products.values()) {
                await this.db.put('products', product);
            }

            // 部品を保存（既存の場合は更新、新規の場合は追加）
            let addedCount = 0;
            let updatedCount = 0;

            for (const part of parts) {
                // 製品番号と部品番号の組み合わせで既存部品を検索
                const existingParts = await this.db.getByIndex('parts', 'productCode_partCode', [part.productCode, part.partCode]);

                if (existingParts && existingParts.length > 0) {
                    // 既存部品が見つかった場合は更新
                    const existing = existingParts[0];
                    part.id = existing.id; // 既存のIDを使用
                    part.createdAt = existing.createdAt; // 作成日時は保持
                    part.updatedAt = Date.now(); // 更新日時は現在時刻
                    await this.db.put('parts', part);
                    updatedCount++;
                } else {
                    // 新規部品の場合は追加
                    delete part.id; // idは自動生成
                    await this.db.add('parts', part);
                    addedCount++;
                }
            }

            console.log(`部品: 新規追加 ${addedCount}件、更新 ${updatedCount}件`);


            const saveTime = performance.now() - saveStartTime;
            console.log(`登録完了: ${saveTime.toFixed(0)}ms`);

            const totalTime = performance.now() - startTime;
            console.log(`総処理時間: ${totalTime.toFixed(0)}ms`);

            return {
                success: true,
                productsCount: products.size,
                partsCount: parts.length,
                partsAdded: addedCount,
                partsUpdated: updatedCount,
                message: `インポート完了: 製品 ${products.size}件、部品 新規${addedCount}件/更新${updatedCount}件 (${(totalTime / 1000).toFixed(1)}秒)`
            };
        } catch (error) {
            console.error('インポートエラー:', error);
            return {
                success: false,
                message: 'インポートに失敗しました: ' + error.message
            };
        }
    }

    /**
     * データをエクセルファイルにエクスポート
     * @returns {Promise<void>}
     */
    async exportToExcel() {
        try {
            // 製品と部品のデータを取得
            const products = await this.db.getAll('products');
            const parts = await this.db.getAll('parts');

            // エクセル用データを作成
            const excelData = [];

            // ヘッダー行
            excelData.push([
                '製品番号',
                '製品名',
                '部品番号',
                '部品名',
                '工程',
                '構成数',
                '単価'
            ]);

            // データ行
            for (const product of products) {
                const productParts = parts.filter(p => p.productCode === product.productCode);

                for (const part of productParts) {
                    excelData.push([
                        product.productCode,
                        product.productName,
                        part.partCode,
                        part.partName,
                        part.process || '',
                        part.quantity,
                        part.unitCost
                    ]);
                }
            }

            // ワークシートを作成
            const worksheet = XLSX.utils.aoa_to_sheet(excelData);

            // 列幅を設定
            worksheet['!cols'] = [
                { wch: 12 },  // 製品番号
                { wch: 25 },  // 製品名
                { wch: 15 },  // 部品番号
                { wch: 25 },  // 部品名
                { wch: 10 },  // 工程
                { wch: 10 },  // 構成数
                { wch: 12 }   // 単価
            ];

            // ワークブックを作成
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, '製品部品一覧');

            // ファイル名を生成
            const today = new Date();
            const fileName = `製品部品一覧_${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}.xlsx`;

            // ファイルをダウンロード
            XLSX.writeFile(workbook, fileName);

            return { success: true, fileName };

        } catch (error) {
            console.error('エクスポートエラー:', error);
            return { success: false, message: 'エクスポートに失敗しました: ' + error.message };
        }
    }

    /**
     * 在庫データをエクスポート
     * @returns {Promise<void>}
     */
    async exportInventoryToExcel() {
        try {
            // 在庫データを取得
            const inventory = await inventoryLogic.getAllInventory();
            const products = await this.db.getAll('products');

            // 製品でグループ化
            const inventoryByProduct = inventory.reduce((acc, item) => {
                if (!acc[item.productCode]) acc[item.productCode] = [];
                acc[item.productCode].push(item);
                return acc;
            }, {});

            // エクセル用データを作成
            const excelData = [];

            // ヘッダー行
            excelData.push([
                '製品番号',
                '製品名',
                '部品番号',
                '部品名',
                '現在庫',
                '単価',
                '在庫金額'
            ]);

            // 製品ごとにデータを追加
            for (const product of products) {
                const productInventory = inventoryByProduct[product.productCode] || [];

                for (const item of productInventory) {
                    excelData.push([
                        product.productCode,
                        product.productName,
                        item.partCode,
                        item.partName,
                        item.currentStock,
                        item.unitCost,
                        item.unitCost * item.currentStock
                    ]);
                }
            }

            // ワークシートを作成
            const worksheet = XLSX.utils.aoa_to_sheet(excelData);

            // 列幅を設定
            worksheet['!cols'] = [
                { wch: 12 },  // 製品番号
                { wch: 25 },  // 製品名
                { wch: 15 },  // 部品番号
                { wch: 25 },  // 部品名
                { wch: 10 },  // 現在庫
                { wch: 12 },  // 単価
                { wch: 15 }   // 在庫金額
            ];

            // ワークブックを作成
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, '在庫一覧');

            // ファイル名を生成
            const today = new Date();
            const fileName = `在庫一覧_${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}.xlsx`;

            // ファイルをダウンロード
            XLSX.writeFile(workbook, fileName);

            return {
                success: true,
                message: '在庫データをエクスポートしました',
                fileName
            };

        } catch (error) {
            return {
                success: false,
                message: 'エクスポートに失敗しました: ' + error.message
            };
        }
    }

    /**
     * CSVファイルから在庫データをインポート
     * @param {File} file - CSVファイル
     * @returns {Promise<object>} インポート結果
     */
    async importInventoryFromCSV(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = async (e) => {
                try {
                    const text = e.target.result;
                    const result = await this.parseAndImportCSV(text);
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));

            // Shift-JISで読み込み（日本語CSVの一般的なエンコーディング）
            try {
                reader.readAsText(file, 'Shift-JIS');
            } catch (error) {
                reader.readAsText(file, 'UTF-8');
            }
        });
    }

    /**
     * CSVテキストをパースして在庫を更新（高速一括処理版）
     * @param {string} csvText - CSVテキスト
     * @returns {Promise<object>} 更新結果
     */
    async parseAndImportCSV(csvText) {
        const lines = csvText.split(/\r?\n/).filter(line => line.trim());

        if (lines.length === 0) {
            throw new Error('CSVファイルが空です');
        }

        console.log(`CSV処理開始: ${lines.length - 1}行のデータ`);
        const startTime = performance.now();

        // ヘッダー行を解析
        const headers = this.parseCSVLine(lines[0]).map(h => h.trim());
        console.log('CSVヘッダー:', headers);

        // より柔軟なヘッダーマッチング
        const codeIndex = headers.findIndex(h => h === '商品ｺｰﾄﾞ' || h === '商品コード');
        const nameIndex = headers.findIndex(h => h === '商品名');
        const stockIndex = headers.findIndex(h => h === '現在在庫数' || h === '現在庫');

        if (codeIndex === -1 || nameIndex === -1 || stockIndex === -1) {
            const missingColumns = [];
            if (codeIndex === -1) missingColumns.push('商品ｺｰﾄﾞ');
            if (nameIndex === -1) missingColumns.push('商品名');
            if (stockIndex === -1) missingColumns.push('現在在庫数');

            throw new Error(
                `必要な列が見つかりません。\n` +
                `見つからない列: ${missingColumns.join(', ')}\n` +
                `検出されたヘッダー: ${headers.join(', ')}\n\n` +
                `CSVには「商品ｺｰﾄﾞ」「商品名」「現在在庫数」の列が必要です。`
            );
        }

        // 全部品をメモリに読み込み、Map構造で高速検索可能にする
        console.log('全部品データを読み込み中...');
        const allParts = await this.db.getAll('parts');
        const partMap = new Map();

        // 部品番号でグループ化
        for (const part of allParts) {
            if (!partMap.has(part.partCode)) {
                partMap.set(part.partCode, []);
            }
            partMap.get(part.partCode).push(part);
        }

        console.log(`${allParts.length}件の部品データを読み込みました`);
        console.log(`一意の部品番号: ${partMap.size}件`);

        let successCount = 0;
        let skipCount = 0;
        let errorCount = 0;
        const errors = [];
        const updates = []; // 一括更新用の配列

        // データ行を処理
        for (let i = 1; i < lines.length; i++) {
            const values = this.parseCSVLine(lines[i]);

            if (values.length <= Math.max(codeIndex, nameIndex, stockIndex)) {
                skipCount++;
                continue;
            }

            const partCode = values[codeIndex]?.trim();
            const partName = values[nameIndex]?.trim();
            const stockValue = values[stockIndex]?.trim();

            if (!partCode || !stockValue) {
                skipCount++;
                continue;
            }

            const newStock = parseFloat(stockValue);
            if (isNaN(newStock)) {
                errors.push(`行 ${i + 1}: 在庫数が数値ではありません (${stockValue})`);
                errorCount++;
                continue;
            }

            // Map構造で高速検索（O(1)）
            const parts = partMap.get(partCode);
            if (!parts || parts.length === 0) {
                errors.push(`行 ${i + 1}: 部品番号 ${partCode} が見つかりません`);
                skipCount++;
                continue;
            }

            // 更新データを配列に追加
            updates.push({
                partCode,
                newStock,
                partName
            });
            successCount++;
        }

        const parseTime = performance.now() - startTime;
        console.log(`CSV解析完了: ${parseTime.toFixed(0)}ms`);

        // 一括更新を実行
        if (updates.length > 0) {
            console.log(`${updates.length}件の在庫を一括更新中...`);
            const updateStartTime = performance.now();

            const result = await inventoryLogic.bulkStockUpdate(updates);

            const updateTime = performance.now() - updateStartTime;
            console.log(`一括更新完了: ${updateTime.toFixed(0)}ms`);

            if (!result.success) {
                throw new Error(result.message);
            }
        }

        const totalTime = performance.now() - startTime;
        console.log(`総処理時間: ${totalTime.toFixed(0)}ms`);

        return {
            success: true,
            successCount,
            skipCount,
            errorCount,
            errors,
            message: `インポート完了: 成功 ${successCount}件、スキップ ${skipCount}件、エラー ${errorCount}件 (${(totalTime / 1000).toFixed(1)}秒)`
        };
    }

    /**
     * CSV行をパース（カンマ区切り、ダブルクォート対応）
     * @param {string} line - CSV行
     * @returns {Array<string>} パースされた値の配列
     */
    parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];

            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    // エスケープされたダブルクォート
                    current += '"';
                    i++; // 次の文字をスキップ
                } else {
                    // クォートの開始/終了
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                // フィールドの区切り
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }

        result.push(current); // 最後のフィールド
        return result;
    }

    /**
     * 「発注番号」の列を探す（出荷履歴CSV用）
     *  - 「発注番号」列に 7489926-001 の形で入っている場合
     *  - 「発注番号」と「発注明細番号」が別の列の場合
     * の両方に対応。表記ゆれ（全角・空白・「発注No」など）も吸収する。
     * @returns {{orderIdx: number, detailIdx: number}}
     */
    findPurchaseOrderColumns(headers) {
        const norm = (h) => (h || '').normalize('NFKC').replace(/[\s.．]/g, '').toLowerCase();
        const names = headers.map(norm);
        const orderIdx = names.findIndex(h => ['発注番号', '発注番号-明細', '発注no', '発注番号明細', '相手先注文no'].includes(h));
        const detailIdx = names.findIndex(h => ['発注明細番号', '明細番号', '発注明細no'].includes(h));
        return { orderIdx, detailIdx };
    }

    /**
     * 「受注伝票No」列の位置を探す（無ければ -1）
     * 「受注伝票No.」「受注伝票ＮＯ」「受注伝票 No」などの表記ゆれも同じ列とみなす
     * @param {Array<string>} headers - ヘッダー行
     * @returns {number}
     */
    findOrderNoColumn(headers) {
        const norm = (h) => (h || '')
            .normalize('NFKC')          // 全角英数 → 半角
            .replace(/[\s.．]/g, '')    // 空白・ピリオドを除去
            .toLowerCase();
        return headers.findIndex(h => norm(h) === '受注伝票no');
    }

    /**
     * CSVファイルから製品出荷予定をインポート
     * @param {File} file - CSVファイル
     * @returns {Promise<object>} インポート結果
     */
    async importShipmentFromCSV(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = async (e) => {
                try {
                    const text = e.target.result;
                    const result = await this.parseAndImportShipmentCSV(text);
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));

            // Shift-JISで読み込み
            try {
                reader.readAsText(file, 'Shift-JIS');
            } catch (error) {
                reader.readAsText(file, 'UTF-8');
            }
        });
    }

    /**
     * CSVテキストをパースして製品出荷予定を登録
     * @param {string} csvText - CSVテキスト
     * @returns {Promise<object>} 登録結果
     */
    async parseAndImportShipmentCSV(csvText) {
        const lines = csvText.split(/\r?\n/).filter(line => line.trim());

        if (lines.length === 0) {
            throw new Error('CSVファイルが空です');
        }

        console.log(`出荷予定CSV処理開始: ${lines.length - 1}行のデータ`);
        const startTime = performance.now();

        // ヘッダー行を解析
        const headers = this.parseCSVLine(lines[0]).map(h => h.trim());
        console.log('CSVヘッダー:', headers);

        // ヘッダーマッチング
        const codeIndex = headers.findIndex(h => h === '商品ｺｰﾄﾞ' || h === '商品コード' || h === '製品番号');
        const nameIndex = headers.findIndex(h => h === '商品名' || h === '製品名');
        const quantityIndex = headers.findIndex(h => h === '数量' || h === '出荷数');
        const dateIndex = headers.findIndex(h => h === '出荷予定日' || h === '出荷日');
        const orderNoIndex = this.findOrderNoColumn(headers);  // 受注伝票Noごとに更新するため必須

        if (codeIndex === -1 || quantityIndex === -1 || dateIndex === -1 || orderNoIndex === -1) {
            const missingColumns = [];
            if (orderNoIndex === -1) missingColumns.push('受注伝票No');
            if (codeIndex === -1) missingColumns.push('商品ｺｰﾄﾞ');
            if (quantityIndex === -1) missingColumns.push('数量');
            if (dateIndex === -1) missingColumns.push('出荷予定日');

            throw new Error(
                `必要な列が見つかりません。\n` +
                `見つからない列: ${missingColumns.join(', ')}\n` +
                `検出されたヘッダー: ${headers.join(', ')}\n\n` +
                `CSVには「受注伝票No」「商品ｺｰﾄﾞ」「数量」「出荷予定日」の列が必要です。`
            );
        }

        // 全製品をメモリに読み込み
        console.log('全製品データを読み込み中...');
        const allProducts = await this.db.getAll('products');
        const productMap = new Map();

        for (const product of allProducts) {
            productMap.set(product.productCode, product);
        }

        console.log(`${allProducts.length}件の製品データを読み込みました`);

        let successCount = 0;
        let skipCount = 0;
        let errorCount = 0;
        const errors = [];
        const shipments = []; // 登録用の配列

        // データ行を処理
        for (let i = 1; i < lines.length; i++) {
            const values = this.parseCSVLine(lines[i]);

            if (values.length <= Math.max(codeIndex, nameIndex, quantityIndex, dateIndex)) {
                skipCount++;
                continue;
            }

            const productCode = values[codeIndex]?.trim();
            const productName = values[nameIndex]?.trim();
            const quantityValue = values[quantityIndex]?.trim();
            const dateValue = values[dateIndex]?.trim();
            const orderNo = (values[orderNoIndex] || '').trim();

            if (!productCode || !quantityValue || !dateValue) {
                skipCount++;
                continue;
            }

            if (!orderNo) {
                errors.push(`行 ${i + 1}: 受注伝票No が空のため取り込みません (${productCode})`);
                skipCount++;
                continue;
            }

            const quantity = parseFloat(quantityValue);
            if (isNaN(quantity)) {
                errors.push(`行 ${i + 1}: 数量が数値ではありません (${quantityValue})`);
                errorCount++;
                continue;
            }

            // 製品が存在するか確認
            const product = productMap.get(productCode);
            if (!product) {
                errors.push(`行 ${i + 1}: 製品番号 ${productCode} が見つかりません`);
                skipCount++;
                continue;
            }

            // 日付の検証（簡易的）
            if (!this.isValidDate(dateValue)) {
                errors.push(`行 ${i + 1}: 出荷日の形式が不正です (${dateValue})`);
                errorCount++;
                continue;
            }

            // 出荷予定データを配列に追加
            shipments.push({
                id: `SHIP_${Date.now()}_${i}`,
                orderNo,
                productCode,
                productName: productName || product.productName,
                shipmentQuantity: quantity,
                shipmentDate: this.normalizeDate(dateValue),
                createdAt: Date.now()
            });
            successCount++;
        }

        const parseTime = performance.now() - startTime;
        console.log(`CSV解析完了: ${parseTime.toFixed(0)}ms`);

        // 受注伝票Noごとに置き換え
        //  ・CSVにある伝票No → 既存のその伝票の行をすべて削除し、CSVの行で置き換え
        //  ・既存に無い伝票No → 新規追加
        //  ・CSVに無い伝票No → そのまま残す
        const csvOrderNos = new Set(shipments.map(s => s.orderNo));
        let updatedOrders = 0;
        let newOrders = 0;
        let removedRows = 0;

        if (shipments.length > 0) {
            const saveStartTime = performance.now();
            const existing = await this.db.getAll('shipmentSchedules');
            const existingOrderNos = new Set(existing.map(s => s.orderNo).filter(Boolean));

            const toDelete = existing.filter(s => s.orderNo && csvOrderNos.has(s.orderNo));
            removedRows = toDelete.length;
            for (const no of csvOrderNos) {
                if (existingOrderNos.has(no)) updatedOrders++; else newOrders++;
            }

            // 1回の通信で実行（全部成功 or 全部取り消し）
            await this.db.batch([
                ...toDelete.map(s => ({ op: 'delete', store: 'shipmentSchedules', key: s.id })),
                ...shipments.map(data => ({ op: 'put', store: 'shipmentSchedules', data }))
            ]);

            const saveTime = performance.now() - saveStartTime;
            console.log(`登録完了: ${saveTime.toFixed(0)}ms（更新伝票 ${updatedOrders}件 / 新規伝票 ${newOrders}件）`);
        }

        const totalTime = performance.now() - startTime;
        console.log(`総処理時間: ${totalTime.toFixed(0)}ms`);

        return {
            success: true,
            successCount,
            skipCount,
            errorCount,
            errors,
            updatedOrders,
            newOrders,
            message: `インポート完了: 受注伝票 更新 ${updatedOrders}件・新規 ${newOrders}件` +
                `（取込 ${successCount}行、スキップ ${skipCount}行、エラー ${errorCount}行） ` +
                `(${(totalTime / 1000).toFixed(1)}秒)`
        };
    }

    /**
     * CSVファイルから製品出荷履歴をインポート（追記）
     * @param {File} file - CSVファイル
     * @returns {Promise<object>} インポート結果
     */
    async importShipmentHistoryFromCSV(file) {
        this._currentFileName = file.name;
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = async (e) => {
                try {
                    const text = e.target.result;
                    const result = await this.parseAndImportShipmentHistoryCSV(text);
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));

            try {
                reader.readAsText(file, 'Shift-JIS');
            } catch (error) {
                reader.readAsText(file, 'UTF-8');
            }
        });
    }

    /**
     * CSVテキストをパースして製品出荷履歴を登録（追記）
     * 出荷予定CSVと同じ列形式。既存データは削除せず追記する。
     * @param {string} csvText - CSVテキスト
     * @returns {Promise<object>} 登録結果
     */
    async parseAndImportShipmentHistoryCSV(csvText) {
        const lines = csvText.split(/\r?\n/).filter(line => line.trim());

        if (lines.length === 0) {
            throw new Error('CSVファイルが空です');
        }

        const startTime = performance.now();
        const headers = this.parseCSVLine(lines[0]).map(h => h.trim());

        const codeIndex = headers.findIndex(h => h === '商品ｺｰﾄﾞ' || h === '商品コード' || h === '製品番号');
        const nameIndex = headers.findIndex(h => h === '商品名' || h === '製品名');
        const quantityIndex = headers.findIndex(h => h === '数量' || h === '出荷数');
        const dateIndex = headers.findIndex(h => h === '出荷予定日' || h === '出荷日' || h === '出荷実績日' || h === '発行日');
        const { orderIdx, detailIdx } = this.findPurchaseOrderColumns(headers);  // 任意列（あれば出荷予定の残数を減らす）
        // MJS 売上明細表の場合: 伝票NO＋行NO で1行を特定（二重取込の判定に使う）、取引区分で返品などを区別
        const slipIdx = headers.indexOf('伝票NO');
        const slipLineIdx = headers.indexOf('行NO');
        const tradeIdx = headers.indexOf('取引区分名');

        if (codeIndex === -1 || quantityIndex === -1 || dateIndex === -1) {
            const missing = [];
            if (codeIndex === -1) missing.push('商品ｺｰﾄﾞ');
            if (quantityIndex === -1) missing.push('数量');
            if (dateIndex === -1) missing.push('出荷予定日');
            throw new Error(
                `必要な列が見つかりません。\n見つからない列: ${missing.join(', ')}\n` +
                `検出されたヘッダー: ${headers.join(', ')}\n\n` +
                `CSVには「商品ｺｰﾄﾞ」「数量」「出荷予定日」の列が必要です。`
            );
        }

        const allProducts = await this.db.getAll('products');
        const productMap = new Map(allProducts.map(p => [p.productCode, p]));

        let successCount = 0;
        let skipCount = 0;
        let errorCount = 0;
        let duplicateCount = 0;
        const errors = [];
        const records = [];
        const importedAt = Date.now();

        // 同じ出荷履歴を二度取り込んでも、出荷済数が二重に増えないようにする
        const existingIds = new Set((await this.db.getAll('shipmentHistory')).map(r => r.id));
        const occurrence = new Map();

        for (let i = 1; i < lines.length; i++) {
            const values = this.parseCSVLine(lines[i]);

            if (values.length <= Math.max(codeIndex, quantityIndex, dateIndex)) {
                skipCount++;
                continue;
            }

            const productCode = values[codeIndex]?.trim();
            const productName = values[nameIndex]?.trim();
            const quantityValue = values[quantityIndex]?.trim();
            const dateValue = values[dateIndex]?.trim();

            if (!productCode || !quantityValue || !dateValue) {
                skipCount++;
                continue;
            }

            const quantity = parseFloat(quantityValue);
            if (isNaN(quantity)) {
                errors.push(`行 ${i + 1}: 数量が数値ではありません (${quantityValue})`);
                errorCount++;
                continue;
            }

            const product = productMap.get(productCode);
            if (!product) {
                errors.push(`行 ${i + 1}: 製品番号 ${productCode} が製品マスタにありません（出荷履歴には登録します）`);
            }

            if (!this.isValidDate(dateValue)) {
                errors.push(`行 ${i + 1}: 出荷日の形式が不正です (${dateValue})`);
                errorCount++;
                continue;
            }

            // 発注番号（7489926-001 の形にそろえる）
            let orderNo = '';
            if (orderIdx >= 0) {
                const raw = (values[orderIdx] || '').trim();
                orderNo = (detailIdx >= 0 && raw && !raw.includes('-'))
                    ? OrderManager.makeOrderNo(raw, values[detailIdx])
                    : OrderManager.normalizeOrderNo(raw);
            }
            const shipmentDate = this.normalizeDate(dateValue);

            // 同じ行は同じIDになる → 二重取込を防ぐ
            //  MJS売上明細: 伝票NO＋行NO ／ それ以外: 発注番号・日付・数量
            const slipNo = slipIdx >= 0 ? (values[slipIdx] || '').trim() : '';
            let id;
            if (slipNo) {
                id = `HIST_MJS_${slipNo}_${slipLineIdx >= 0 ? (values[slipLineIdx] || '1').trim() : '1'}`;
            } else {
                const baseId = `HIST_${orderNo || productCode}_${shipmentDate}_${quantity}`;
                const n = (occurrence.get(baseId) || 0) + 1;
                occurrence.set(baseId, n);
                id = `${baseId}_${n}`;
            }
            if (existingIds.has(id)) {
                duplicateCount++;
                continue;
            }

            // 返品・値引きなど「売上」以外や、数量0以下は出荷予定に反映しない
            const trade = tradeIdx >= 0 ? (values[tradeIdx] || '').trim() : '';
            const applicable = quantity > 0 && (!trade || trade === '売上');
            if (orderNo && !applicable) {
                errors.push(`行 ${i + 1}: ${orderNo} は「${trade || '数量' + quantity}」のため出荷予定には反映していません（要確認）`);
            }

            records.push({
                id,
                orderNo,
                slipNo,
                productCode,
                productName: productName || product?.productName || '',
                shipmentQuantity: quantity,
                shipmentDate,
                importedAt,
                line: i + 1,
                applicable
            });
            successCount++;
        }

        // 発注番号がある出荷は、出荷予定の残数を減らす（残0で完了 → 出荷予定から消える）
        const withOrder = records.filter(r => r.orderNo && r.applicable);
        const apply = withOrder.length > 0
            ? await orderManager.buildShipmentApplyOps(withOrder, this._currentFileName || '出荷履歴CSV')
            : { ops: [], errors: [], applied: 0, completed: 0 };
        errors.push(...apply.errors);

        // 出荷予定へ反映したか（false の行は、あとでEDIでその発注番号が届いたときに反映する）
        for (const r of records) {
            if (r.orderNo && r.applicable) r.applied = !!apply.appliedIds?.has(r.id);
        }

        // 出荷履歴の追記と出荷予定の更新を、1回の通信でまとめて実行
        if (records.length > 0) {
            await this.db.batch([
                ...records.map(({ line, applicable, ...data }) => ({ op: 'put', store: 'shipmentHistory', data })),
                ...apply.ops
            ]);
        }

        const totalTime = performance.now() - startTime;
        return {
            success: true,
            successCount,
            skipCount,
            errorCount,
            errors,
            message: `インポート完了: 成功 ${successCount}件、取込済みのため除外 ${duplicateCount}件、スキップ ${skipCount}件、エラー ${errorCount}件` +
                (orderIdx >= 0 ? `<br>出荷予定に反映: ${apply.applied}件（うち完了 ${apply.completed}件）` : '<br>※「発注番号」列が無いため、出荷予定には反映していません') +
                ` (${(totalTime / 1000).toFixed(1)}秒)`
        };
    }

    /**
     * 日付文字列の妥当性チェック
     * @param {string} dateStr - 日付文字列
     * @returns {boolean} 妥当な日付かどうか
     */
    isValidDate(dateStr) {
        // YYYY-MM-DD, YYYY/MM/DD, MM/DD形式などに対応
        const date = new Date(dateStr);
        return !isNaN(date.getTime());
    }

    /**
     * 日付文字列をYYYY-MM-DD形式に正規化
     * @param {string} dateStr - 日付文字列
     * @returns {string} YYYY-MM-DD形式の日付
     */
    normalizeDate(dateStr) {
        const date = new Date(dateStr);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
}

// インスタンスをエクスポート
const excelManager = new ExcelManager();
