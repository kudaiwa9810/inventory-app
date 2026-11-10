/**
 * アプリの設定
 *
 * storage（データの保存先）
 *   'auto'       … https で開いていて、下の SharePoint 設定が入っていれば SharePoint、
 *                   それ以外（http://サーバーPC名:8000/ など）はサーバーPC
 *   'sharepoint' … 常に SharePoint
 *   'server'     … 常にサーバーPC（server/server.py）
 *
 * sharepoint（Microsoft 365 の設定。パスワードではないので、ここに書いて大丈夫です）
 *   tenantId  … Entra の「ディレクトリ (テナント) ID」
 *   clientId  … Entra の「アプリケーション (クライアント) ID」
 *   folderUrl … データを置く SharePoint フォルダの URL（ブラウザで開いたときのアドレス）
 */
window.APP_CONFIG = {
    storage: 'auto',
    sharepoint: {
        tenantId: '0bbcbb8c-276d-4640-83b2-612d4168a6e5',   // ディレクトリ (テナント) ID
        clientId: 'f41f98ca-26f6-4479-a1f7-2a7de0efc698',   // アプリケーション (クライアント) ID
        // 全社共有板 > S製造_&_出荷 > 在庫管理データ
        folderUrl: 'https://daiwaseikilimited.sharepoint.com/sites/msteams_ae4d98/Shared%20Documents/Forms/AllItems.aspx?FolderCTID=0x0120007222609F7FC8DF458684AAE1CFD03FA6&id=%2Fsites%2Fmsteams%5Fae4d98%2FShared%20Documents%2F%E5%85%A8%E7%A4%BE%E5%85%B1%E6%9C%89%E6%9D%BF%2FS%E8%A3%BD%E9%80%A0%5F%26%5F%E5%87%BA%E8%8D%B7%2F%E5%9C%A8%E5%BA%AB%E7%AE%A1%E7%90%86%E3%83%87%E3%83%BC%E3%82%BF'
    }
};
