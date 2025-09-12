function getUserConfig(user) {
  const CONFIG_SHEET_ID = '1D9M3IEPtD7Vbdt7THBvNm8CiQ3qdrelyR-EdgNmd6go'; // ✅ ID de la base centrale
  const sheet = SpreadsheetApp.openById(CONFIG_SHEET_ID).getSheets()[0];

  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => h.toString().toLowerCase().trim());

  Logger.log("🔍 Recherche pour user : " + user);

  for (let i = 1; i < data.length; i++) {
    const rowUser = (data[i][0] || "").toString().toLowerCase().trim();
    Logger.log(`🆚 Comparaison : "${rowUser}" vs "${user}"`);

    if (rowUser === user) {
      const result = {};
      headers.forEach((h, j) => result[h] = data[i][j]);
      Logger.log("✅ Config trouvée : " + JSON.stringify(result));
      return result;
    }
  }

  Logger.log("❌ Aucun utilisateur trouvé correspondant.");
  return null;
}



function doGet(e) {
  const user = e?.parameter?.user?.toLowerCase().trim();
  Logger.log("📩 Paramètre reçu : " + user);

  if (!user) {
    return ContentService.createTextOutput(JSON.stringify({ error: "user manquant" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const config = getUserConfig(user);
  if (!config || !config.apiurl) {
    return ContentService.createTextOutput(JSON.stringify({ error: "utilisateur introuvable ou apiurl manquante" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const response = {
    apiurl: config.apiurl
  };

  return ContentService
    .createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}












