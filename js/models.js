/**
 * データモデルクラスとバリデーション
 */

/**
 * 製品モデル
 */
class Product {
    constructor(productCode, productName) {
        this.productCode = productCode;
        this.productName = productName;
        this.createdAt = Date.now();
        this.updatedAt = Date.now();
    }

    /**
     * バリデーション
     * @returns {Array<string>} エラーメッセージの配列
     */
    validate() {
        const errors = [];

        // 製品番号は空白OK（バリデーションなし）

        if (!this.productName || this.productName.trim().length === 0) {
            errors.push('製品名を入力してください');
        }

        return errors;
    }

    /**
     * データベース保存用のオブジェクトに変換
     * @returns {object}
     */
    toObject() {
        return {
            productCode: this.productCode,
            productName: this.productName,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }
}

/**
 * 部品モデル
 */
class Part {
    constructor(partCode, productCode, partName, unitCost, quantity, supplier, supplierCode = '', safetyStock = 0, id = null) {
        this.id = id; // 自動生成されるID（新規作成時はnull）
        this.partCode = partCode || ''; // 空白OK
        this.productCode = productCode || ''; // 空白OK
        this.partName = partName;
        this.process = this.extractProcess(partCode);
        this.unitCost = parseFloat(unitCost) || 0; // マイナスOK
        this.quantity = parseInt(quantity) || 1;
        this.supplier = supplier || ''; // 空白OK
        this.supplierCode = supplierCode || ''; // 空白OK
        this.safetyStock = parseInt(safetyStock) || 0; // 安全在庫数（新規）
        this.orderMethod = '';   // 発注方法（メール外注/通販/電話・FAX/その他）
        this.orderLink = '';     // 発注リンク・URL・ネットワークパス
        this.orderTemplate = ''; // 発注テンプレート（メモ雛形）
        this.materialShape     = ''; // 形状（丸棒/六角材/四角材/帯板/板材/その他）
        this.materialDimension = ''; // 寸法（φ50、AF17、□25 など）
        this.materialSpec      = ''; // 材料規格（SS400、SUS304 など）
        this.materialUnit      = ''; // 発注単位（本、枚、kg など）
        this.materialYield     = 0;  // 1単位あたりの取れ数（0=未設定）
        this.materialMemo      = ''; // 材料メモ
        this.createdAt = Date.now();
        this.updatedAt = Date.now();
    }

    /**
     * 部品番号から工程を抽出
     * @param {string} partCode - 部品番号（例: 1234-56A）
     * @returns {string} 工程（A, B, C...）
     */
    extractProcess(partCode) {
        if (!partCode) return '';
        // 部品番号から工程を抽出（最後の英字）
        const match = partCode.match(/([A-Z])$/);
        return match ? match[1] : ''; // 抽出できない場合は空文字
    }

    /**
     * バリデーション
     * @returns {Array<string>} エラーメッセージの配列
     */
    validate() {
        const errors = [];

        // 部品番号は空白OK（バリデーションなし）

        // 製品番号は空白OK（バリデーションなし）

        if (!this.partName || this.partName.trim().length === 0) {
            errors.push('部品名を入力してください');
        }

        // 単体費用はマイナスOK（バリデーションなし）

        if (this.quantity <= 0) {
            errors.push('構成数は1以上である必要があります');
        }

        // 仕入先、仕入先コードは空白OK（バリデーションなし）

        return errors;
    }

    /**
     * データベース保存用のオブジェクトに変換
     * @returns {object}
     */
    toObject() {
        const obj = {
            partCode: this.partCode,
            productCode: this.productCode,
            partName: this.partName,
            process: this.process,
            unitCost: this.unitCost,
            quantity: this.quantity,
            supplier: this.supplier,
            supplierCode: this.supplierCode,
            safetyStock: this.safetyStock,
            orderMethod: this.orderMethod,
            orderLink: this.orderLink,
            orderTemplate: this.orderTemplate,
            materialShape:     this.materialShape,
            materialDimension: this.materialDimension,
            materialSpec:      this.materialSpec,
            materialUnit:      this.materialUnit,
            materialYield:     this.materialYield,
            materialMemo:      this.materialMemo,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };

        // idが存在する場合のみ含める（新規作成時はnull）
        if (this.id !== null) {
            obj.id = this.id;
        }

        return obj;
    }
}

/**
 * 在庫モデル
 */
class Inventory {
    constructor(partCode, currentStock = 0) {
        this.partCode = partCode;
        this.currentStock = parseFloat(currentStock) || 0;
        this.updatedAt = Date.now();
    }

    /**
     * バリデーション
     * @returns {Array<string>} エラーメッセージの配列
     */
    validate() {
        const errors = [];

        if (!this.partCode) {
            errors.push('部品番号が指定されていません');
        }

        return errors;
    }

    /**
     * データベース保存用のオブジェクトに変換
     * @returns {object}
     */
    toObject() {
        return {
            partCode: this.partCode,
            currentStock: this.currentStock,
            updatedAt: this.updatedAt
        };
    }
}

/**
 * 入出庫履歴モデル
 */
class StockHistory {
    constructor(partCode, changeType, changeAmount, previousStock, newStock, reason, relatedProcess = '') {
        this.id = this.generateId();
        this.partCode = partCode;
        this.changeType = changeType; // '工程完了', '直接編集', '調整'
        this.changeAmount = parseFloat(changeAmount) || 0;
        this.previousStock = parseFloat(previousStock) || 0;
        this.newStock = parseFloat(newStock) || 0;
        this.reason = reason || '';
        this.relatedProcess = relatedProcess;
        this.createdAt = Date.now();
        this.createdBy = 'システム'; // 将来拡張用
    }

    /**
     * UUID生成（簡易版）
     * @returns {string}
     */
    generateId() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    /**
     * バリデーション
     * @returns {Array<string>} エラーメッセージの配列
     */
    validate() {
        const errors = [];

        if (!this.partCode) {
            errors.push('部品番号が指定されていません');
        }

        if (!this.changeType) {
            errors.push('変更区分が指定されていません');
        }

        return errors;
    }

    /**
     * データベース保存用のオブジェクトに変換
     * @returns {object}
     */
    toObject() {
        return {
            id: this.id,
            partCode: this.partCode,
            changeType: this.changeType,
            changeAmount: this.changeAmount,
            previousStock: this.previousStock,
            newStock: this.newStock,
            reason: this.reason,
            relatedProcess: this.relatedProcess,
            createdAt: this.createdAt,
            createdBy: this.createdBy
        };
    }
}

/**
 * ユーティリティ関数
 */
class ModelUtils {
    /**
     * 工程のアルファベット順序を取得
     * @param {string} process - 工程（A, B, C...）
     * @returns {number} 順序（0始まり）
     */
    static getProcessOrder(process) {
        return process.charCodeAt(0) - 'A'.charCodeAt(0);
    }

    /**
     * 上流工程を取得（例: C → [A, B]）
     * @param {string} currentProcess - 現在の工程
     * @returns {Array<string>} 上流工程の配列
     */
    static getUpstreamProcesses(currentProcess) {
        const allProcesses = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
        const currentIndex = allProcesses.indexOf(currentProcess);

        if (currentIndex === -1) return [];
        return allProcesses.slice(0, currentIndex);
    }

    /**
     * 下流工程を取得（例: A → [B, C, ...]）
     * @param {string} currentProcess - 現在の工程
     * @returns {Array<string>} 下流工程の配列
     */
    static getDownstreamProcesses(currentProcess) {
        const allProcesses = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
        const currentIndex = allProcesses.indexOf(currentProcess);

        if (currentIndex === -1) return [];
        return allProcesses.slice(currentIndex + 1);
    }

    /**
     * 日時をフォーマット
     * @param {number} timestamp - タイムスタンプ
     * @returns {string} フォーマット済み日時
     */
    static formatDateTime(timestamp) {
        const date = new Date(timestamp);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');

        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }

    /**
     * 数値をカンマ区切りにフォーマット
     * @param {number} value - 数値
     * @returns {string} フォーマット済み文字列
     */
    static formatNumber(value) {
        return value.toLocaleString('ja-JP');
    }

    /**
     * 金額をフォーマット
     * @param {number} value - 金額
     * @returns {string} フォーマット済み金額
     */
    static formatCurrency(value) {
        if (value === null || value === undefined || value === '') {
            return '-';
        }
        const num = parseFloat(value);
        if (isNaN(num)) {
            return '-';
        }
        return `¥${num.toLocaleString('ja-JP')}`;
    }
}

/**
 * 発注記録モデル
 */
class OrderRecord {
    constructor({ partCode, partName, productCode, supplier, supplierCode, orderMethod, orderLink, orderQuantity, orderDate, expectedDeliveryDate, memo }) {
        this.id = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.partCode = partCode || '';
        this.partName = partName || '';
        this.productCode = productCode || '';
        this.supplier = supplier || '';
        this.supplierCode = supplierCode || '';
        this.orderMethod = orderMethod || '';
        this.orderLink = orderLink || '';
        this.orderQuantity = parseFloat(orderQuantity) || 0;
        this.orderDate = orderDate || '';
        this.expectedDeliveryDate = expectedDeliveryDate || '';
        this.memo = memo || '';
        this.status = 'pending'; // 'pending' | 'delivered'
        this.deliveredAt = null;
        this.createdAt = Date.now();
    }

    toObject() {
        return {
            id: this.id,
            partCode: this.partCode,
            partName: this.partName,
            productCode: this.productCode,
            supplier: this.supplier,
            supplierCode: this.supplierCode,
            orderMethod: this.orderMethod,
            orderLink: this.orderLink,
            orderQuantity: this.orderQuantity,
            orderDate: this.orderDate,
            expectedDeliveryDate: this.expectedDeliveryDate,
            memo: this.memo,
            status: this.status,
            deliveredAt: this.deliveredAt,
            createdAt: this.createdAt
        };
    }
}

/**
 * 仕入先モデル
 */
class Supplier {
    constructor({
        supplierCode,
        supplierName,
        email = '',
        phone = '',
        fax = '',
        defaultOrderMethod = '',
        defaultEmailSubject = '',
        notes = ''
    }) {
        this.supplierCode = supplierCode;
        this.supplierName = supplierName;
        this.email = email;
        this.phone = phone;
        this.fax = fax;
        this.defaultOrderMethod = defaultOrderMethod; // 'メール外注'|'通販'|'電話・FAX'|'その他'
        this.defaultEmailSubject = defaultEmailSubject;
        this.notes = notes;
        this.createdAt = Date.now();
        this.updatedAt = Date.now();
    }

    validate() {
        const errors = [];
        if (!this.supplierCode || this.supplierCode.trim() === '') {
            errors.push('仕入先コードは必須です');
        }
        if (!this.supplierName || this.supplierName.trim() === '') {
            errors.push('仕入先名は必須です');
        }
        return errors;
    }

    toObject() {
        return {
            supplierCode: this.supplierCode,
            supplierName: this.supplierName,
            email: this.email,
            phone: this.phone,
            fax: this.fax,
            defaultOrderMethod: this.defaultOrderMethod,
            defaultEmailSubject: this.defaultEmailSubject,
            notes: this.notes,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }
}

/**
 * 発注材料名を生成（規格 + 形状 + 寸法）
 * @param {object} part - 部品データ
 * @returns {string} 例: "SS400 丸棒 φ50"
 */
function getMaterialLabel(part) {
    const segments = [part.materialSpec, part.materialShape, part.materialDimension]
        .filter(v => v && v.trim() !== '');
    return segments.join(' ');
}

/**
 * 製品出荷予定モデル
 */
class ShipmentSchedule {
    constructor(productCode, productName, shipmentQuantity, shipmentDate, id = null, orderNo = '') {
        this.id = id || this.generateId();
        this.orderNo = (orderNo || '').toString().trim();  // 発注番号（0000000-000。EDI・出荷履歴とつなぐキー）
        this.productCode = productCode;        // 製品番号
        this.productName = productName;        // 製品名
        this.shipmentQuantity = parseFloat(shipmentQuantity) || 0;  // 出荷数
        this.shipmentDate = shipmentDate;      // 出荷日（YYYY-MM-DD形式）
        this.createdAt = Date.now();
        this.updatedAt = Date.now();
    }

    // UUID生成（簡易版）
    // @returns {string}
    generateId() {
        return `shipment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // バリデーション
    // @returns {Array<string>} エラーメッセージの配列
    validate() {
        const errors = [];
        if (!this.productCode || this.productCode.trim() === '') {
            errors.push('製品番号は必須です');
        }
        if (!this.productName || this.productName.trim() === '') {
            errors.push('製品名は必須です');
        }
        if (this.shipmentQuantity <= 0) {
            errors.push('出荷数は0より大きい値を入力してください');
        }
        if (!this.shipmentDate) {
            errors.push('出荷日は必須です');
        }
        return errors;
    }

    // データベース保存用のオブジェクトに変換
    // @returns {object}
    toObject() {
        return {
            id: this.id,
            orderNo: this.orderNo,
            productCode: this.productCode,
            productName: this.productName,
            shipmentQuantity: this.shipmentQuantity,
            shipmentDate: this.shipmentDate,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }
}

/**
 * 出荷予定が「有効（まだ出荷が残っている）」かどうか
 * EDI取込で 取消・完了 になった行は、在庫の引当計算や一覧から除外する
 * @param {object} s - 出荷予定データ
 * @returns {boolean}
 */
function isActiveShipment(s) {
    return (!s.status || s.status === '有効') && (Number(s.shipmentQuantity) || 0) > 0;
}
