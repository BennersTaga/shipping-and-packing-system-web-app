function doGet(e) {
  const action = e.parameter.action;
  if (action === 'search') {
    const result = search_(e.parameter);
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService
    .createTextOutput(JSON.stringify({ success: false, error: 'unknown action' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Main search handler
function search_(p) {
  const date = p.date || '';
  const paginate = p.paginate === '1';
  const pageSize = Number(p.pageSize) || 10;
  const pageManufactured = Number(p.pageManufactured) || 1;
  const pageStock = Number(p.pageStock) || 1;
  const pageShipped = Number(p.pageShipped) || 1;
  const includeBacklog = p.includeBacklog === '1';
  const scope = p.scope || '';
  const excludeDate = p.excludeDate || '';

  const rows = getRows_();
  // buckets for different statuses
  const buckets = { manufactured: [], stock: [], shipped: [] };

  rows.sort(function(a, b){
    if (a.manufactureDate === b.manufactureDate) {
      return a.rowIndex - b.rowIndex;
    }
    return new Date(a.manufactureDate) - new Date(b.manufactureDate);
  });

  rows.forEach(function(r){
    if (scope === 'backlog') {
      if (r.status === '未処理' && r.manufactureDate !== excludeDate) {
        buckets.manufactured.push(r);
      }
      return;
    }

    if (date && r.manufactureDate !== date) {
      if (includeBacklog && r.status === '未処理') {
        buckets.backlog = buckets.backlog || [];
        buckets.backlog.push(r);
      }
      return;
    }

    if (r.status === '未処理') buckets.manufactured.push(r);
    else if (r.status === '完了') buckets.stock.push(r);
    else if (r.status === '出荷済み') buckets.shipped.push(r);
  });

  var meta = { pagination: {}, backlog: null };

  function paginateBucket(arr, page) {
    var total = arr.length;
    var totalPages = Math.max(1, Math.ceil(total / pageSize));
    var start = (page - 1) * pageSize;
    return {
      items: paginate ? arr.slice(start, start + pageSize) : arr,
      info: { total: total, page: page, pageSize: pageSize, totalPages: totalPages }
    };
  }

  if (scope === 'backlog') {
    var paged = paginateBucket(buckets.manufactured, pageManufactured);
    meta.pagination.manufactured = paged.info;
    var data = paged.items;
    return { success: true, data: data, meta: meta, masters: {} };
  }

  var m = paginateBucket(buckets.manufactured, pageManufactured);
  var s = paginateBucket(buckets.stock, pageStock);
  var sh = paginateBucket(buckets.shipped, pageShipped);
  meta.pagination.manufactured = m.info;
  meta.pagination.stock = s.info;
  meta.pagination.shipped = sh.info;

  var data = m.items.concat(s.items);
  if (date) data = data.concat(sh.items);

  if (includeBacklog) {
    var bl = buckets.backlog || [];
    meta.backlog = { count: bl.length };
  }

  return { success: true, data: data, meta: meta, masters: {} };
}

// Placeholder: fetch data from sheet and convert to objects
function getRows_() {
  // Implement sheet access here. Returning empty array keeps the script functional.
  return [];
}
