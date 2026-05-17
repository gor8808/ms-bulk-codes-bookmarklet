(function () {
  async function parseFile(file) {
    try {
      if (!window.XLSX) {
        return { rows: [], skipped: [], error: 'Библиотека XLSX не загружена' };
      }

      const arrayBuffer = await file.arrayBuffer();
      const workbook = window.XLSX.read(arrayBuffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];

      if (!sheet) {
        return { rows: [], skipped: [], error: 'В файле нет листов' };
      }

      const rawRows = window.XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        defval: '',
      });

      if (!rawRows.length) {
        return { rows: [], skipped: [], error: 'Первый лист пустой' };
      }

      return window.MSXlsxParserCore.parseRows(rawRows);
    } catch (error) {
      return {
        rows: [],
        skipped: [],
        error: error && error.message ? `Не удалось прочитать XLSX: ${error.message}` : 'Не удалось прочитать XLSX',
      };
    }
  }

  window.MSXlsxParser = { parseFile };
}());
